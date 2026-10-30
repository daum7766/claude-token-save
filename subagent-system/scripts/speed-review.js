#!/usr/bin/env node
/**
 * 회고의 병목 분석에 쓰는 자료와 속도 기록을 만든다.
 * 사용: node "$HOME/.claude/subagent-system/scripts/speed-review.js" --pick --out <파일>
 *       node "$HOME/.claude/subagent-system/scripts/speed-review.js" --measure "<대상>" --items "<항목> <초>, ..."
 *       node "$HOME/.claude/subagent-system/scripts/speed-review.js" --applied "<대상>" --what "속도 개선"|"측정 요청" --note "<요지>"
 *       node "$HOME/.claude/subagent-system/scripts/speed-review.js" --effects
 *       node "$HOME/.claude/subagent-system/scripts/speed-review.js" --breakdown [--since <ISO 시각 또는 YYYY-MM-DD>] [--top 3] [--kind "<일 종류>"]
 * --breakdown은 서브에이전트가 걸린 시간이 모델, 도구, 그 밖 중 어디에 드는지 일 종류별로 쪼갠다.
 * --since와 --kind가 모두 없으면 사용 기록의 마지막 회고 줄 뒤 기록을 본다.
 * 대상 이름: 칸은 `칸:<정의>/<일 종류>`, 절차는 `절차:<프로젝트 경로>/<절차 이름>`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RECORDS_DIR, CLAUDE_DIR, PROJECTS_ROOT, appendWithHeader, listSessions, splitLines } from './claudeProjectPaths.js';
import { parseUsage, parseCorrections, extractSince, stripAnnex } from './subagentRetroHelpers.js';
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
  '      node "$HOME/.claude/subagent-system/scripts/speed-review.js" --breakdown [--since <ISO 시각 또는 YYYY-MM-DD>] [--top 3] [--kind "<일 종류>"]',
].join('\n');
const WHATS = ['속도 개선', '측정 요청'];
const LONG_CALL_TOP = 15;
const sizeOf = (c) => (c.kind === 'cell' ? c.agents.length : c.runs.length);

const USAGE_FILE = path.join(RECORDS_DIR, 'subagent-usage.tsv');
const SPEED_LOG_FILE = path.join(RECORDS_DIR, 'speed-log.tsv');
const PROPOSALS_FILE = process.env.SUBAGENT_PROPOSALS_FILE ?? path.join(CLAUDE_DIR, 'docs', 'PROPOSALS.md');
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
// 맞는 파일이 둘 이상이면 어느 쪽인지 알 수 없으므로 찾지 못한 것으로 둔다.
const findAgentFile = (index, id) => {
  if (index.has(id)) return index.get(id);
  const hits = [...index].filter(([key]) => sameAgent(id, key));
  return hits.length === 1 ? hits[0][1] : undefined;
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
  const pending = pendingTargets(readOrNull(PROPOSALS_FILE));
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

const localDay = (ms) => {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function breakdown({ since, top, kind }) {
  let fromDay = '0000-00-00';
  if (since) {
    // 날짜만 쓰면 Date가 UTC 자정으로 읽으므로 지역 자정으로 맞춘다.
    fromDay = localDay(new Date(/^\d{4}-\d{2}-\d{2}$/.test(since) ? `${since}T00:00:00` : since).getTime());
  }
  const text = readOrNull(USAGE_FILE);
  if (text === null) {
    console.error(`사용 기록이 없습니다: ${USAGE_FILE}`);
    process.exit(1);
  }
  const toRow = (c, i) => ({ def: c[2], kind: stripAnnex(c[3]), sec: c[6] !== '-' && c[6] !== '' && Number.isFinite(Number(c[6])) ? Number(c[6]) : null, agentId: agentIdOf((c[8] || '').split(/\s+/)[0]) || `행${i}` });
  // 기간도 일 종류도 안 주면 회고 줄 위치로 가른다. 날짜로 자르면 같은 날 회고 앞뒤 기록이 섞인다.
  const byRetro = !since && !kind;
  // 사용 기록에는 날짜만 있어 시각으로 거를 수 없다. 날짜 단위로 자른다.
  const usageAll = byRetro
    ? parseUsage(text).target.map((r, i) => ({ def: r.def, kind: r.kind, sec: r.seconds, agentId: agentIdOf(r.agentId) || `행${i}` }))
    : splitLines(text)
        .map((l) => l.split('\t'))
        .filter((c) => c.length >= 9 && c[0] !== '회고' && c[0] !== '미룸' && /^\d{4}-/.test(c[0]) && c[0] >= fromDay)
        .map(toRow);
  // 일 종류는 끝 괄호 부연을 떼고 거른다. 이름이 정확히 같은 줄이 있으면 그 줄만 보고, 없을 때만 부분 일치로 찾는다.
  const kindWanted = kind ? stripAnnex(kind) : null;
  const exactKind = kindWanted ? usageAll.filter((u) => u.kind === kindWanted) : [];
  const usage = !kindWanted ? usageAll : exactKind.length ? exactKind : usageAll.filter((u) => u.kind.includes(kindWanted));

  const index = agentIndex();
  const groups = new Map();
  for (const u of usage) {
    const k = `${u.def}\t${u.kind}`;
    if (!groups.has(k)) groups.set(k, { def: u.def, kind: u.kind, rows: [] });
    groups.get(k).rows.push(u);
  }
  // 재지시한 에이전트는 줄마다 그 구간의 초가 적히므로 같은 agentId의 초를 더해 한 에이전트의 초로 쓴다. 일 종류를 지정하면 기록이 한 건뿐이어도 본다.
  const minAgents = kind ? 1 : 2;
  for (const g of groups.values()) {
    const secs = new Map();
    for (const r of g.rows) {
      // 초를 적지 않은 줄(-)만 있는 에이전트는 평균에서 뺀다.
      secs.set(r.agentId, r.sec === null ? secs.get(r.agentId) ?? null : (secs.get(r.agentId) ?? 0) + r.sec);
    }
    g.agents = secs.size;
    const timed = [...secs.values()].filter((v) => v !== null);
    g.avg = timed.length ? timed.reduce((s, v) => s + v, 0) / timed.length : 0;
  }
  const picked = [...groups.values()].filter((g) => g.agents >= minAgents).sort((a, b) => b.avg - a.avg).slice(0, top);

  const pct = (a, b) => (b > 0 ? `${Math.round((100 * a) / b)}%` : '0%');
  console.log(`기준: ${since ?? (byRetro ? '마지막 회고 줄' : '전체')} 이후${kind ? `, 일 종류 "${kind}"` : ''}. 사용 기록 ${usage.length}줄, ${minAgents}건 이상 묶음 ${[...groups.values()].filter((g) => g.agents >= minAgents).length}개 중 평균 초가 긴 ${picked.length}개\n`);
  if (picked.length === 0) console.log('조건에 맞는 묶음이 없습니다.');

  for (const g of picked) {
    const ids = [...new Set(g.rows.map((r) => r.agentId))];
    const found = [];
    let missing = 0;
    for (const id of ids) {
      const file = findAgentFile(index, id);
      let a = null;
      try {
        a = file ? analyzeTranscript(file) : null;
      } catch {
        // 읽다 실패한 기록은 기록 없음으로 센다.
      }
      if (a) found.push({ id, ...a });
      else missing++;
    }
    console.log(`== ${g.def} / ${g.kind}`);
    console.log(`  건수 ${g.agents}, 평균 ${min1(g.avg)}분, 대화 기록 분석 ${found.length}건, 기록 없음 ${missing}건`);
    if (found.length === 0) {
      console.log('');
      continue;
    }
    const sum = (k) => found.reduce((s, a) => s + a[k], 0);
    const total = sum('total');
    const model = sum('model');
    const tool = sum('tool');
    const testTime = sum('testTime');
    const userWait = sum('userWait');
    const other = total - model - tool - userWait;
    console.log(`  합 ${min1(total)}분: 모델 ${min1(model)}분 (${pct(model, total)}), 도구 ${min1(tool)}분 (${pct(tool, total)}), 그 밖 ${min1(other)}분 (${pct(other, total)}), 사용자 기다림 ${min1(userWait)}분`);
    console.log(`  도구 중 테스트 실행 ${min1(testTime)}분 (${pct(testTime, tool)})`);
    const bash = new Map();
    for (const a of found) for (const [k, v] of a.bash) bash.set(k, (bash.get(k) || 0) + v);
    const sample = new Map();
    for (const a of found) for (const [k, v] of a.bashSample) if (!sample.has(k)) sample.set(k, v);
    const topBash = [...bash].sort((a, b) => b[1] - a[1]).slice(0, 3);
    const oneLine = (c) => {
      const t = c.replace(/\s+/g, ' ').trim();
      return t.length > 120 ? `${t.slice(0, 120)}…` : t;
    };
    console.log(`  시간이 큰 Bash 명령:${topBash.length ? '' : ' 없음'}`);
    for (const [k, v] of topBash) console.log(`    "${k}" ${min1(v)}분: ${oneLine(sample.get(k) ?? '')}`);
    const rep = found
      .map((a) => ({ id: a.id, n: [...a.tests.values()].reduce((s, c) => s + Math.max(0, c - 1), 0), cmd: [...a.tests].sort((x, y) => y[1] - x[1])[0] }))
      .filter((r) => r.n > 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, 3);
    console.log(`  같은 테스트 명령을 되풀이한 횟수 상위: ${rep.map((r) => `${r.id.slice(0, 8)} ${r.n}회 ("${r.cmd[0].slice(0, 30)}" ${r.cmd[1]}번)`).join(', ') || '없음'}`);
    console.log(`  한 차례 모델 시간이 60초 넘는 차례: ${sum('longTurns')}번`);
    console.log('');
  }

  console.log('읽는 법');
  console.log('  모델 비율이 크면 지시 범위나 effort를 줄여 생각 시간을 덜고, 도구 비율이 크면 위 Bash 명령 줄과 테스트 몫을 본다.');
  console.log('  테스트 몫이 크고 되풀이가 많으면 전체 대신 바뀐 파일만 돌리게 하고, 그 밖 비율이 크면 메인 메시지나 기다림이 낀 것이다.');
  console.log('  60초 넘는 차례가 많으면 한 번에 긴 글이나 파일을 쓰는 단계라 쪼갤 수 있는지 본다.');
}

function parseArgs(argv) {
  const o = {};
  const flags = ['--pick', '--out', '--measure', '--items', '--applied', '--what', '--note', '--effects', '--breakdown', '--since', '--top', '--kind'];
  for (let i = 0; i < argv.length; i++) {
    if (!flags.includes(argv[i])) return null;
    const key = argv[i].slice(2);
    if (key === 'pick' || key === 'effects' || key === 'breakdown') o[key] = true;
    else if (i + 1 < argv.length) o[key] = argv[++i];
    else return null;
  }
  return o;
}

const o = parseArgs(process.argv.slice(2));
const modes = o ? ['pick', 'measure', 'applied', 'effects', 'breakdown'].filter((k) => o[k] !== undefined) : [];
const topN = o?.top === undefined ? 3 : Number(o.top);
const sinceOk = o?.since === undefined || !Number.isNaN(new Date(/^\d{4}-\d{2}-\d{2}$/.test(o.since) ? `${o.since}T00:00:00` : o.since).getTime());
const valid =
  modes.length === 1 &&
  ((o.pick && o.out) || (o.measure && o.items !== undefined) || (o.applied && WHATS.includes(o.what)) || o.effects || (o.breakdown && Number.isInteger(topN) && topN >= 1 && sinceOk));
if (!valid) {
  console.error(USAGE);
  process.exit(1);
}
if (o.pick) pick(o.out);
else if (o.measure) measure(o.measure, o.items);
else if (o.applied) applied(o.applied, o.what, o.note ?? '');
else if (o.breakdown) breakdown({ since: o.since ?? null, top: topN, kind: o.kind ?? null });
else printEffects();
