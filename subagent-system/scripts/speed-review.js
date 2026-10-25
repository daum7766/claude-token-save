#!/usr/bin/env node
/**
 * 회고의 병목 분석에 쓰는 자료와 속도 기록을 만든다.
 * 사용: node "$HOME/.claude/subagent-system/scripts/speed-review.js" --pick --out <파일>
 *       node "$HOME/.claude/subagent-system/scripts/speed-review.js" --measure "<대상>" --items "<항목> <초>, ..."
 *       node "$HOME/.claude/subagent-system/scripts/speed-review.js" --applied "<대상>" --what "속도 개선"|"측정 요청" --note "<요지>"
 *       node "$HOME/.claude/subagent-system/scripts/speed-review.js" --effects
 * 대상 이름: 칸은 `칸:<정의>/<일 종류>`, 절차는 `절차:<프로젝트 경로>/<절차 이름>`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RECORDS_DIR, PROJECTS_ROOT, appendWithHeader, listSessions } from './claudeProjectPaths.js';
import { parseUsage, parseCorrections, extractSince } from './subagentRetroHelpers.js';
import { analyzeTranscript, fileHasLine } from './transcriptTiming.js';
import {
  findProcedureRuns,
  cellCandidates,
  procedureCandidates,
  pendingTargets,
  parseSpeedLog,
  speedLogLine,
  pickTarget,
  measuredFirstTargets,
  effects,
  countBad,
  QUALITY_MIN_AFTER,
  agentIdOf,
  embraces,
  sameAgent,
  SPEED_LOG_HEADER,
} from './speedReviewHelpers.js';

const USAGE = [
  '사용: node "$HOME/.claude/subagent-system/scripts/speed-review.js" --pick --out <파일>',
  '      node "$HOME/.claude/subagent-system/scripts/speed-review.js" --measure "<대상>" --items "<항목> <초>, ..."',
  '      node "$HOME/.claude/subagent-system/scripts/speed-review.js" --applied "<대상>" --what "속도 개선"|"측정 요청" --note "<요지>"',
  '      node "$HOME/.claude/subagent-system/scripts/speed-review.js" --effects',
].join('\n');
const WHATS = ['속도 개선', '측정 요청'];
const LONG_CALL_TOP = 15;
const sizeOf = (c) => (c.kind === 'cell' ? c.agents.length : c.runs.length);

const USAGE_FILE = path.join(RECORDS_DIR, 'subagent-usage.tsv');
const SPEED_LOG_FILE = path.join(RECORDS_DIR, 'speed-log.tsv');
const PENDING_FILE = path.join(RECORDS_DIR, 'retro-pending.md');
const CORRECTIONS_FILE = path.join(RECORDS_DIR, 'subagent-corrections.tsv');

const readOrNull = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);
const min1 = (sec) => (sec / 60).toFixed(1);
const iso = (ms) => new Date(ms).toISOString();
const usageParsed = () => parseUsage(readOrNull(USAGE_FILE) ?? '');

// 대화 기록은 합쳐 1GB가 넘을 수 있어, 찾는 구간보다 먼저 수정이 끝난 파일은 읽지 않고 단계 표시가 없는 파일은 파싱하지 않는다.
const STEP_MARK = /"description":\s*"\[[^"\]]+ \d+\]/;
function scanProcedures(sinceMs) {
  const out = [];
  for (const s of listSessions()) {
    if (s.mtime < sinceMs) continue;
    let runs;
    try {
      if (!fileHasLine(s.file, STEP_MARK)) continue;
      runs = findProcedureRuns(s.file, { sinceMs });
    } catch {
      continue;
    }
    if (runs.length) out.push({ file: s.file, runs });
  }
  return out;
}

// agentId로 서브에이전트 대화 기록을 찾기 위해 모든 프로젝트의 서브에이전트 폴더 이름만 훑는다.
function agentIndex() {
  const index = new Map();
  const ls = (dir) => {
    try {
      return fs.readdirSync(dir);
    } catch {
      return [];
    }
  };
  for (const proj of ls(PROJECTS_ROOT)) {
    for (const session of ls(path.join(PROJECTS_ROOT, proj))) {
      const sub = path.join(PROJECTS_ROOT, proj, session, 'subagents');
      for (const f of ls(sub)) {
        const m = f.match(/^agent-(.+)\.jsonl$/);
        if (m) index.set(m[1], path.join(sub, f));
      }
    }
  }
  return index;
}

// 사용 기록의 agentId는 앞 8자만 있으므로 정확히 같은 키가 없으면 앞부분이 같은 키를 찾는다.
const findAgentFile = (index, id) => {
  if (index.has(id)) return index.get(id);
  for (const [key, file] of index) if (sameAgent(id, key)) return file;
  return undefined;
};

const sessionLabel = (file) => {
  const base = path.basename(file, '.jsonl');
  return base.startsWith('agent-') ? `${path.basename(path.dirname(path.dirname(file)))}/${base}` : base;
};

const SCRIPT_PATH = /[^\s"'`;&|<>()=]+\.(?:js|mjs|py|sh)\b/g;
function scriptStates(cmd) {
  const cd = /^\s*cd\s+("[^"]+"|'[^']+'|[^\s;&|]+)\s*(?:&&|;)/.exec(cmd);
  const cwd = cd ? cd[1].replace(/^["']|["']$/g, '') : null;
  return [...new Set(cmd.match(SCRIPT_PATH) ?? [])].map((p) => {
    const full = p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : path.isAbsolute(p) ? p : cwd ? path.resolve(cwd, p) : null;
    return full === null ? `${p}: 위치 모름` : `${p}: ${fs.existsSync(full) ? '남아 있음' : '지워짐'}`;
  });
}

function longCallsSection(calls) {
  const top = calls.sort((a, b) => b.sec - a.sec).slice(0, LONG_CALL_TOP);
  if (!top.length) return ['(도구 호출 없음)'];
  const lines = [];
  top.forEach((c, i) => {
    lines.push(`${i + 1}. ${Math.round(c.sec)}초, 사용자 기다림 ${Math.round(c.wait)}초, ${iso(c.at)}, 세션 ${c.session}`, '```', c.cmd, '```');
    for (const st of scriptStates(c.cmd)) lines.push(`   스크립트 ${st}`);
  });
  return lines;
}

const tableLine = (a) => `전체 ${min1(a.total)}분, 모델 ${min1(a.model)}분, 도구 ${min1(a.tool)}분, 사용자 기다림 ${min1(a.userWait)}분`;

function buildMaterial(picked, ctx) {
  const { parsed, speedLog } = ctx;
  const doc = [];
  const size = picked.kind === 'cell' ? picked.agents.length : picked.runs.length;
  const targetEffects = effects({
    speedLog,
    cellsAll: picked.kind === 'cell' ? cellCandidates(parsed.all) : [],
    proceduresAll: picked.kind === 'procedure' ? [picked] : [],
  }).filter((e) => e.target === picked.target);
  let missing = 0;
  const calls = [];
  const transcriptFiles = [];
  const analyses = new Map();
  const analyze = (file) => {
    if (!analyses.has(file)) {
      let a = null;
      try {
        a = analyzeTranscript(file);
      } catch {
        // 읽다 실패한 기록은 기록 없음으로 센다.
      }
      analyses.set(file, a);
    }
    return analyses.get(file);
  };
  const addCalls = (file, filter = () => true) => {
    const a = analyze(file);
    for (const c of a?.calls ?? []) if (c.name !== 'Agent' && filter(c)) calls.push({ ...c, session: sessionLabel(file) });
  };

  doc.push(`# 병목 분석 자료: ${picked.target}`, '', '## 1. 대상과 고른 까닭', `- 합계 ${min1(picked.totalSec)}분, ${size}회, 회당 평균 ${min1(picked.totalSec / size)}분. 회고 구간에서 합계가 가장 큰 후보다.`);
  if (picked.kind === 'procedure') {
    const embraced = cellCandidates(parsed.target).filter((c) => c.agents.length >= 2 && embraces(picked, c));
    doc.push(`- 품은 칸: ${embraced.length ? embraced.map((c) => c.target).join(', ') : '없음'}`);
  }

  doc.push('', '## 2. 회차별 시간표');
  let timed;
  if (picked.kind === 'procedure') {
    timed = picked.runs.map((r) => ({ id: `${r.session.slice(0, 8)} ${iso(r.start)}`, sec: r.totalSec }));
    for (const r of picked.runs) {
      doc.push(`- ${r.session.slice(0, 8)} ${iso(r.start)}: 전체 ${min1(r.totalSec)}분, 메인 직접 ${min1(r.mainSec)}분, 서브에이전트 기다림 ${min1(r.subagentSec)}분, 사용자 기다림 ${min1(r.userWaitSec)}분`);
      doc.push(`  단계별: ${[...r.steps].sort((a, b) => a.start - b.start).map((s) => `${s.step}단계 ${min1(s.sec)}분`).join(', ')}`);
      const file = ctx.sessionFiles.get(r.session);
      if (file) {
        const dir = path.join(path.dirname(file), r.session, 'subagents');
        for (const id of r.agents) {
          const f = path.join(dir, `agent-${id}.jsonl`);
          if (fs.existsSync(f)) {
            transcriptFiles.push(f);
            addCalls(f);
          } else {
            missing++;
          }
        }
        if (!transcriptFiles.includes(file)) transcriptFiles.push(file);
        addCalls(file, (c) => c.at >= r.start && c.at <= r.end);
      }
    }
  } else {
    timed = picked.agents.map((a) => ({ id: a.id, sec: a.sec }));
    for (const a of picked.agents) {
      const file = findAgentFile(ctx.agentFiles, a.id);
      const an = file ? analyze(file) : null;
      if (an) {
        transcriptFiles.push(file);
        addCalls(file);
        doc.push(`- ${a.id}: 사용 기록 ${min1(a.sec)}분, ${tableLine(an)}`);
      } else {
        missing++;
        doc.push(`- ${a.id}: 사용 기록 ${min1(a.sec)}분, 대화 기록 없음`);
      }
    }
  }

  const fast = timed.reduce((a, b) => (b.sec < a.sec ? b : a));
  const slow = timed.reduce((a, b) => (b.sec > a.sec ? b : a));
  doc.push('', '## 3. 가장 빠른 회차와 가장 느린 회차', `- 빠름: ${fast.id}, ${min1(fast.sec)}분`, `- 느림: ${slow.id}, ${min1(slow.sec)}분`);

  doc.push('', `## 4. 긴 도구 호출 상위 ${LONG_CALL_TOP}개`, ...longCallsSection(calls));

  doc.push('', '## 5. 서브에이전트 지시문 위치(대화 기록 파일의 첫 사용자 메시지)');
  const agentFilesOnly = [...new Set(transcriptFiles)].filter((f) => path.basename(f).startsWith('agent-'));
  doc.push(...(agentFilesOnly.length ? agentFilesOnly.map((f) => `- ${f}`) : ['- 없음']));

  doc.push('', '## 6. 측정과 지난 적용');
  const mine = speedLog.filter((e) => e.target === picked.target);
  if (mine.length) for (const e of mine) doc.push(`- ${e.at} ${e.type}${e.what !== '-' ? ` ${e.what}` : ''}: ${e.note}${e.type === '적용' ? ` (적용 전 평균 ${e.beforeAvg === null ? '-' : min1(e.beforeAvg)}분, ${e.beforeCount ?? 0}회)` : ''}`);
  else doc.push('- 이 대상의 측정과 적용 기록 없음');
  for (const e of targetEffects) doc.push(`- 적용 전후: 전 ${e.beforeAvg === null ? '-' : min1(e.beforeAvg)}분(${e.beforeCount ?? 0}회) → ${e.afterAvg === null ? '기다림' : `뒤 ${min1(e.afterAvg)}분(${e.afterCount}회)`}`);

  doc.push('', '## 7. 대화 기록이 지워진 에이전트', `- 기록 없음 ${missing}건`);
  return doc.join('\n') + '\n';
}

function pick(outFile) {
  const text = readOrNull(USAGE_FILE);
  const parsed = parseUsage(text ?? '');
  const { at } = extractSince(parsed);
  const sinceMs = at ? at.getTime() : 0;
  const cells = cellCandidates(parsed.target);
  const scanned = scanProcedures(sinceMs);
  const procedures = procedureCandidates(scanned.flatMap((s) => s.runs));
  const speedLog = parseSpeedLog(readOrNull(SPEED_LOG_FILE));
  const pending = pendingTargets(readOrNull(PENDING_FILE));
  // 측정을 먼저 볼 대상은 회고 구간에 회차가 모자랄 수 있어 남은 기록 전체에서 자료를 만든다.
  const measured = measuredFirstTargets(speedLog, pending);
  const full = measured.length ? [...cellCandidates(parsed.all), ...procedureCandidates(scanProcedures(0).flatMap((s) => s.runs))] : [];
  const picked = measured.map((t) => full.find((c) => c.target === t)).find(Boolean) ?? pickTarget({ cells, procedures, pending, speedLog });
  if (!picked) {
    console.log('대상 없음');
    return;
  }
  const sessionFiles = new Map(scanned.flatMap((s) => s.runs.map((r) => [r.session, s.file])));
  const material = buildMaterial(picked, { parsed, speedLog, sessionFiles, agentFiles: agentIndex() });
  fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
  fs.writeFileSync(outFile, material);
  const n = picked.kind === 'cell' ? picked.agents.length : picked.runs.length;
  console.log(`대상: ${picked.target} (합계 ${min1(picked.totalSec)}분, ${n}회)`);
  console.log(`자료: ${outFile}`);
}

function append(entry) {
  const line = speedLogLine(entry);
  appendWithHeader(SPEED_LOG_FILE, SPEED_LOG_HEADER, [line]);
  console.log(line);
}

function measure(target, items) {
  append({ at: new Date().toISOString(), type: '측정', target, what: '-', beforeAvg: null, beforeCount: null, usageLines: null, note: items });
}

// 품질 신호는 사용 기록의 올림, 재지시와 정정 기록이다. 사용 기록의 agentId는 앞 8자라 대화 기록의 전체 id와 앞부분이 같으면 같은 에이전트로 본다.
function badPredicate() {
  const ids = [
    ...usageParsed().all.filter((r) => r.result === '올림' || r.result === '재지시').map((r) => agentIdOf(r.agentId)),
    ...parseCorrections(readOrNull(CORRECTIONS_FILE) ?? '').map((c) => c.agentId),
  ].filter((id) => id && id !== '-' && id !== '메인');
  return (id) => ids.some((bad) => sameAgent(id, bad));
}

function beforeStats(target) {
  const isBad = badPredicate();
  const stats = (c) => (c ? { avg: Math.round(c.totalSec / sizeOf(c)), count: sizeOf(c), bad: countBad(c, isBad) } : { avg: null, count: 0, bad: 0 });
  if (target.startsWith('칸:')) return stats(cellCandidates(usageParsed().all).find((x) => x.target === target));
  return stats(procedureCandidates(scanProcedures(0).flatMap((s) => s.runs)).find((x) => x.target === target));
}

function applied(target, what, note) {
  const { avg, count, bad } = beforeStats(target);
  if (what === '속도 개선' && !note.includes('되돌리기')) console.error('경고: 내용에 되돌릴 방법이 없습니다. 품질이 떨어졌을 때 되돌리려면 --note에 "되돌리기: <방법>"을 적으세요.');
  append({ at: new Date().toISOString(), type: '적용', target, what, beforeAvg: avg, beforeCount: count, beforeBad: bad, usageLines: usageParsed().lineCount, note });
}

const QUALITY_TEXT = {
  유지: '품질 유지',
  기다림: `품질 기다림(뒤 ${QUALITY_MIN_AFTER}건 이상 쌓이면 판정)`,
  '판정 불가': '품질 판정 불가(적용 전 품질 기록 없음)',
};

// 문제는 올림, 재지시, 정정이 붙은 건수다. 떨어졌으면 시간이 줄었어도 되돌리자고 제안하도록 적용 때 적은 내용(되돌릴 방법 포함)을 함께 찍는다.
function qualityText(e) {
  const q = e.quality;
  if (!q) return '';
  const counts = q.beforeBad === null ? '' : `: 문제 전 ${q.beforeBad}/${q.beforeCount}건 → 뒤 ${q.afterBad}/${q.afterCount}건`;
  if (q.verdict === '떨어짐') return `  품질 떨어짐${counts}. 빨라졌어도 되돌리자고 제안(적용 내용: ${e.note || '없음'})`;
  return `  ${QUALITY_TEXT[q.verdict]}${q.verdict === '유지' ? counts : ''}`;
}

function printEffects() {
  const speedLog = parseSpeedLog(readOrNull(SPEED_LOG_FILE));
  const improved = speedLog.filter((e) => e.type === '적용' && e.what === '속도 개선');
  if (!improved.length) {
    console.log('적용한 속도 개선 없음');
    return;
  }
  const cellsAll = cellCandidates(usageParsed().all);
  const procTargets = new Set(improved.filter((e) => e.target.startsWith('절차:')).map((e) => e.target));
  const sinceMs = Math.min(...improved.filter((e) => procTargets.has(e.target)).map((e) => Date.parse(e.at)));
  const proceduresAll = procTargets.size ? procedureCandidates(scanProcedures(sinceMs).flatMap((s) => s.runs)) : [];
  for (const e of effects({ speedLog, cellsAll, proceduresAll, isBad: badPredicate() })) {
    const before = `전 ${e.beforeAvg === null ? '-' : min1(e.beforeAvg)}분(${e.beforeCount ?? 0}회)`;
    console.log(`${e.target}: ${before} → ${e.afterAvg === null ? '기다림' : `뒤 ${min1(e.afterAvg)}분(${e.afterCount}회)`}${qualityText(e)}`);
  }
}

function parseArgs(argv) {
  const o = {};
  const flags = ['--pick', '--out', '--measure', '--items', '--applied', '--what', '--note', '--effects'];
  for (let i = 0; i < argv.length; i++) {
    if (!flags.includes(argv[i])) return null;
    const key = argv[i].slice(2);
    if (key === 'pick' || key === 'effects') o[key] = true;
    else if (i + 1 < argv.length) o[key] = argv[++i];
    else return null;
  }
  return o;
}

const o = parseArgs(process.argv.slice(2));
const modes = o ? ['pick', 'measure', 'applied', 'effects'].filter((k) => o[k] !== undefined) : [];
const valid =
  modes.length === 1 &&
  ((o.pick && o.out) || (o.measure && o.items !== undefined) || (o.applied && WHATS.includes(o.what)) || o.effects);
if (!valid) {
  console.error(USAGE);
  process.exit(1);
}
if (o.pick) pick(o.out);
else if (o.measure) measure(o.measure, o.items);
else if (o.applied) applied(o.applied, o.what, o.note ?? '');
else printEffects();
