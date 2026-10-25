/**
 * 회고의 병목 분석이 쓰는 계산. 대화 기록에서 절차 회차를 찾고, 속도 개선 대상을 고르고, 적용 효과를 견준다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { sessionCwd, projectRoot } from './claudeProjectPaths.js';
import { analyzeTranscript, readMessageRows } from './transcriptTiming.js';
import { UP_MIN_COUNT, UP_MIN_RATIO } from './subagentRetroHelpers.js';

// Agent 호출은 거의 모두 백그라운드라 호출 시작끼리만 재면 긴 단계 뒤에서 회차가 잘못 갈린다. 그래서 앞 호출들이 끝난 시각(서브에이전트 활동 끝 포함)부터 잰다.
export const RUN_GAP_SEC = 3600;

const STEP_LABEL = /^\[(.+?) (\d+)\]/;

export function parseStepLabel(description) {
  const m = STEP_LABEL.exec(description || '');
  return m ? { name: m[1], step: Number(m[2]) } : null;
}

const ms = (s) => new Date(s).getTime();

function union(iv) {
  const s = iv.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [a, b] of s) {
    if (out.length && a <= out.at(-1)[1]) out.at(-1)[1] = Math.max(out.at(-1)[1], b);
    else out.push([a, b]);
  }
  return out;
}
const clip = (iv, lo, hi) => iv.map(([a, b]) => [Math.max(a, lo), Math.min(b, hi)]).filter(([a, b]) => b > a);
const lengthOf = (u) => u.reduce((s, [a, b]) => s + (b - a), 0);
// u에서 v와 겹치는 부분을 뺀 구간들. 둘 다 union된 상태여야 한다.
function subtract(u, v) {
  const out = [];
  for (const [a, b] of u) {
    let cur = a;
    for (const [c, d] of v) {
      if (d <= cur || c >= b) continue;
      if (c > cur) out.push([cur, c]);
      cur = Math.max(cur, d);
      if (cur >= b) break;
    }
    if (cur < b) out.push([cur, b]);
  }
  return out;
}

const isToolResultRow = (row) => Array.isArray(row.message?.content) && row.message.content.some((x) => x.type === 'tool_result');
const isRealUserRow = (row) => row.type === 'user' && !row.isMeta && row.origin?.kind !== 'task-notification' && !isToolResultRow(row);

// SendMessage로 이어서 시킨 일이 같은 기록에 덧붙으므로, 처음부터 끝을 한 구간으로 쓰면 그 사이 쉰 시간이 활동으로 센다.
// 도구 결과가 아닌 user 메시지가 올 때마다 새 구간을 열고, 구간은 그 메시지부터 다음 그런 메시지 직전의 마지막 줄까지다.
function activitySegments(file) {
  let rows;
  try {
    rows = readMessageRows(file);
  } catch {
    return [];
  }
  const segs = [];
  for (const r of rows) {
    const t = ms(r.timestamp);
    if (isRealUserRow(r) || segs.length === 0) segs.push([t, t]);
    else segs.at(-1)[1] = Math.max(segs.at(-1)[1], t);
  }
  return segs;
}

// 사용자가 응답하기를 기다린 구간. 마지막이 도구 호출 없는 assistant 글이고 다음 사용자 메시지까지 비는 때다.
// 작업 알림은 사용자 메시지가 아니라서 이 구간을 끊지 않는다.
function idleIntervals(rows) {
  const out = [];
  let idleStart = null;
  for (const r of rows) {
    if (r.origin?.kind === 'task-notification') continue;
    const t = ms(r.timestamp);
    if (r.type === 'assistant') {
      const hasTool = Array.isArray(r.message.content) && r.message.content.some((x) => x.type === 'tool_use');
      idleStart = hasTool ? null : t;
    } else if (isToolResultRow(r)) {
      idleStart = null;
    } else if (isRealUserRow(r)) {
      if (idleStart !== null) out.push([idleStart, t]);
      idleStart = null;
    }
  }
  return out;
}

export function findProcedureRuns(sessionFile, opts = {}) {
  const sinceMs = opts.sinceMs ?? 0;
  const rows = readMessageRows(sessionFile);
  const session = path.basename(sessionFile).replace(/\.jsonl$/, '');
  const subDir = path.join(path.dirname(sessionFile), session, 'subagents');

  const calls = new Map();
  for (const r of rows) {
    const c = r.message.content;
    if (!Array.isArray(c)) continue;
    for (const x of c) {
      if (r.type === 'assistant' && x.type === 'tool_use') {
        const label = parseStepLabel(x.input?.description);
        if (label && ms(r.timestamp) >= sinceMs) calls.set(x.id, { ...label, start: ms(r.timestamp), end: ms(r.timestamp), agentId: null });
      } else if (r.type === 'user' && x.type === 'tool_result' && calls.has(x.tool_use_id)) {
        const call = calls.get(x.tool_use_id);
        call.end = Math.max(call.end, ms(r.timestamp));
        const agentId = r.toolUseResult?.agentId;
        if (typeof agentId === 'string') call.agentId = agentId;
      }
    }
  }
  if (calls.size === 0) return [];

  const segsByAgent = new Map();
  const segsOf = (id) => {
    if (!segsByAgent.has(id)) {
      const f = path.join(subDir, `agent-${id}.jsonl`);
      segsByAgent.set(id, fs.existsSync(f) ? activitySegments(f) : []);
    }
    return segsByAgent.get(id);
  };
  const list = [...calls.values()].map((c) => {
    const segs = c.agentId ? segsOf(c.agentId) : [];
    return { ...c, end: Math.max(c.end, ...segs.map((s) => s[1])) };
  });

  const project = projectRoot(sessionCwd(sessionFile) || '');
  const byName = new Map();
  for (const c of list) {
    if (!byName.has(c.name)) byName.set(c.name, []);
    byName.get(c.name).push(c);
  }
  const groups = [];
  for (const [name, cs] of byName) {
    cs.sort((a, b) => a.start - b.start);
    let cur = null;
    for (const c of cs) {
      if (cur && c.start - cur.end <= RUN_GAP_SEC * 1000) {
        cur.calls.push(c);
        cur.end = Math.max(cur.end, c.end);
      } else {
        cur = { name, calls: [c], end: c.end };
        groups.push(cur);
      }
    }
  }

  const idle = idleIntervals(rows);
  const waits = analyzeTranscript(sessionFile)?.calls.filter((k) => k.wait > 0).map((k) => [k.end - k.wait * 1000, k.end]) ?? [];

  return groups
    .map((g) => {
      const start = Math.min(...g.calls.map((c) => c.start));
      const end = g.end;
      const agents = [...new Set(g.calls.map((c) => c.agentId).filter(Boolean))];
      const sub = union(clip(agents.flatMap(segsOf), start, end));
      const user = subtract(union([...clip(idle, start, end), ...clip(waits, start, end)]), sub);
      const sec = (v) => Math.round(v / 1000);
      const totalSec = sec(end - start);
      const subagentSec = Math.min(sec(lengthOf(sub)), totalSec);
      const userWaitSec = Math.min(sec(lengthOf(user)), totalSec - subagentSec);
      return {
        project,
        session,
        name: g.name,
        start,
        end,
        steps: g.calls.map((c) => ({ step: c.step, start: c.start, end: c.end, sec: sec(c.end - c.start) })),
        agents,
        mainSec: totalSec - subagentSec - userWaitSec,
        subagentSec,
        userWaitSec,
        totalSec,
      };
    })
    .sort((a, b) => a.start - b.start);
}

// 회고 자체의 일은 병목 분석 대상이 아니다. 회고가 회고를 고치려 들면 끝이 없다.
export const EXCLUDED_KINDS = ['자동 회고', '회고 정정 분류', '작업 기록 병목 분석', '문서 내용 검토'];

// 전 문제 건수는 적용 전 기록에서 올림, 재지시, 정정이 붙은 건수다. 절차의 대화 기록은 보존 기간이 지나면 사라져 나중에 다시 셀 수 없으므로 적용할 때 남긴다.
export const SPEED_LOG_HEADER = '시각\t종류\t대상\t무엇\t전 평균 초\t전 건수\t사용 기록 줄 수\t내용\t전 문제 건수';

// 메모 첫 낱말에 `add4fa4fc4b15a337(이어서)`처럼 꼬리가 붙을 수 있어 앞의 16진수 글자만 agentId로 쓴다.
export const agentIdOf = (word) => (word ? /^[0-9a-f]+/.exec(word)?.[0] ?? word : word);

// 같은 agentId의 줄은 재지시 구간마다 초가 따로 적혀 있으므로 더해 한 에이전트로 센다. 초를 적지 않은 에이전트는 평균을 흐리므로 뺀다.
export function cellCandidates(usageRows) {
  const cells = new Map();
  for (const r of usageRows) {
    if (EXCLUDED_KINDS.includes(r.kind) || r.seconds === null || r.seconds === undefined) continue;
    const key = `${r.def}\u0000${r.kind}`;
    if (!cells.has(key)) cells.set(key, { def: r.def, kindName: r.kind, agents: new Map() });
    const agents = cells.get(key).agents;
    const id = agentIdOf(r.agentId) || `행${r.line}`;
    const cur = agents.get(id) ?? { id, sec: 0, line: 0 };
    cur.sec += r.seconds;
    cur.line = Math.max(cur.line, r.line);
    agents.set(id, cur);
  }
  return [...cells.values()].map((c) => {
    const agents = [...c.agents.values()];
    return { target: `칸:${c.def}/${c.kindName}`, kind: 'cell', def: c.def, kindName: c.kindName, agents, totalSec: agents.reduce((s, a) => s + a.sec, 0) };
  });
}

// 프로젝트를 모르면(대화 기록 첫 줄에 cwd가 없음) 같은 프로젝트의 절차인지 가를 수 없어 대상 이름을 만들지 못한다.
export function procedureCandidates(runs) {
  const groups = new Map();
  for (const r of runs) {
    if (!r.project) continue;
    const key = `${r.project}\u0000${r.name}`;
    if (!groups.has(key)) groups.set(key, { project: r.project, name: r.name, runs: [] });
    groups.get(key).runs.push(r);
  }
  return [...groups.values()].map((g) => ({ target: `절차:${g.project}/${g.name}`, kind: 'procedure', runs: g.runs, totalSec: g.runs.reduce((s, r) => s + r.totalSec, 0) }));
}

// 제목의 대상과 바꿀 요지는 ` / `로 가른다. 대상 안의 슬래시는 앞뒤에 공백이 없다.
const PENDING_TITLE = /^## (?:속도 개선|측정 요청): (.+?)(?: \/ .*)?$/;

export function pendingTargets(pendingText) {
  const out = new Set();
  for (const line of (pendingText ?? '').split(/\r?\n/)) {
    const m = PENDING_TITLE.exec(line);
    if (m) out.add(m[1].trim());
  }
  return out;
}

const dash = (v) => (v === null || v === undefined ? '-' : String(v));
const undash = (v) => (v === '-' || v === '' || v === undefined ? null : Number(v));

export function speedLogLine(e) {
  const note = String(e.note ?? '').replace(/[\t\r\n]+/g, ' ');
  return [e.at, e.type, e.target, e.what, dash(e.beforeAvg), dash(e.beforeCount), dash(e.usageLines), note, dash(e.beforeBad)].join('\t');
}

export function parseSpeedLog(text) {
  const out = [];
  for (const line of (text ?? '').split(/\r?\n/)) {
    const c = line.split('\t');
    if (c.length < 8 || c[0] === '시각') continue;
    out.push({ at: c[0], type: c[1], target: c[2], what: c[3], beforeAvg: undash(c[4]), beforeCount: undash(c[5]), usageLines: undash(c[6]), note: c[7], beforeBad: undash(c[8]) });
  }
  return out;
}

const sizeOf = (c) => (c.kind === 'cell' ? c.agents.length : c.runs.length);
// 칸은 사용 기록 줄 번호로, 절차는 회차 시작 시각으로 적용 앞뒤를 가른다.
const isAfter = (c, applied) => (c.kind === 'cell' ? (a) => a.line > (applied.usageLines ?? 0) : (r) => r.start >= Date.parse(applied.at));
const afterItems = (c, applied) => (c.kind === 'cell' ? c.agents : c.runs).filter(isAfter(c, applied));
const secOf = (item) => item.sec ?? item.totalSec;
const mean = (items) => (items.length ? items.reduce((s, x) => s + secOf(x), 0) / items.length : null);

// 칸의 에이전트 절반 이상이 한 절차의 회차 안에 있으면 그 절차가 칸을 품는다.
// 사용 기록 메모에는 agentId 앞 8자만 남고 대화 기록의 toolUseResult에는 전체가 있어, 앞부분이 같으면 같은 에이전트로 본다.
const AGENT_ID_PREFIX_MIN = 6;
export const sameAgent = (a, b) => a === b || (Math.min(a.length, b.length) >= AGENT_ID_PREFIX_MIN && (a.startsWith(b) || b.startsWith(a)));

export function embraces(procedure, cell) {
  const ids = procedure.runs.flatMap((r) => r.agents);
  return cell.agents.filter((a) => ids.some((id) => sameAgent(a.id, id))).length * 2 >= cell.agents.length;
}

// 측정 지시가 문서에 계속 남지 않게, 측정 요청 뒤 쌓인 측정이 이 수에 닿은 대상은 순위와 상관없이 먼저 본다.
export const MEASURES_TO_REVIEW = 2;

// 가장 최근 측정 요청을 기준으로 삼는다. 그 뒤 속도 개선이 적용됐으면 측정이 다음 회고의 몫이 아니라 끝난 일이다.
export function measuredFirstTargets(speedLog, pending) {
  const requests = new Map();
  for (const e of speedLog) if (e.type === '적용' && e.what === '측정 요청') requests.set(e.target, Date.parse(e.at));
  return [...requests]
    .filter(([target, at]) => {
      if (pending.has(target)) return false;
      const mine = speedLog.filter((e) => e.target === target && Date.parse(e.at) > at);
      return mine.filter((e) => e.type === '측정').length >= MEASURES_TO_REVIEW && !mine.some((e) => e.type === '적용' && e.what === '속도 개선');
    })
    .sort((a, b) => a[1] - b[1])
    .map(([target]) => target);
}

// 먼저 볼 대상은 크기와 상관없이 후보에서 찾는다. 후보에 없으면 다음 대상, 그것도 없으면 평소 순위로 간다.
export function pickTarget({ cells, procedures, pending = new Set(), speedLog = [] }) {
  const all = [...cells, ...procedures];
  for (const target of measuredFirstTargets(speedLog, pending)) {
    const c = all.find((x) => x.target === target);
    if (c) return c;
  }
  const lastApplied = new Map();
  for (const e of speedLog) if (e.type === '적용') lastApplied.set(e.target, e);
  const eligible = (c) => {
    if (sizeOf(c) < 2 || pending.has(c.target)) return false;
    const applied = lastApplied.get(c.target);
    return !applied || afterItems(c, applied).length > 0;
  };
  const ok = [...cells, ...procedures].filter(eligible).sort((a, b) => b.totalSec - a.totalSec);
  const top = ok[0];
  if (!top) return null;
  if (top.kind === 'cell') return ok.find((c) => c.kind === 'procedure' && embraces(c, top)) ?? top;
  return top;
}

// 적용 뒤 이만큼 모이기 전에는 품질을 판정하지 않는다. 한두 건의 우연한 올림을 품질 하락으로 읽지 않으려는 것이다.
export const QUALITY_MIN_AFTER = 3;

// 문제 건수의 비율이 적용 전보다 UP_MIN_RATIO 넘게 늘고 문제가 UP_MIN_COUNT건 이상이면 떨어진 것이다(올리기 후보와 같은 기준).
// 건수가 모자라거나 적용 전 기록이 없으면 판정하지 않는다.
export function qualityVerdict({ beforeBad, beforeCount, afterBad, afterCount }) {
  if (beforeBad === null || beforeBad === undefined || !beforeCount) return '판정 불가';
  if (afterCount < QUALITY_MIN_AFTER) return '기다림';
  return afterBad >= UP_MIN_COUNT && afterBad / afterCount - beforeBad / beforeCount >= UP_MIN_RATIO ? '떨어짐' : '유지';
}

const badItem = (kind, item, isBad) => (kind === 'cell' ? isBad(item.id) : item.agents.some((id) => isBad(id)));

// 같은 대상의 적용이 여러 번이면 각 적용은 다음 적용 직전까지의 기록만 자기 뒤로 센다.
// isBad(agentId)를 주면 적용 뒤 항목 가운데 문제가 붙은 것을 세어 quality에 담는다. 절차 회차는 에이전트 하나라도 문제가 있으면 문제 회차다.
export function effects({ speedLog, cellsAll, proceduresAll, isBad = null }) {
  const byTarget = new Map([...cellsAll, ...proceduresAll].map((c) => [c.target, c]));
  const applies = speedLog.filter((e) => e.type === '적용');
  return applies
    .filter((e) => e.what === '속도 개선')
    .map((e) => {
      const next = applies.find((o) => o.target === e.target && Date.parse(o.at) > Date.parse(e.at));
      const c = byTarget.get(e.target);
      let items = c ? afterItems(c, e) : [];
      if (next && c) {
        const laterOnes = new Set(afterItems(c, next));
        items = items.filter((x) => !laterOnes.has(x));
      }
      let quality = null;
      if (isBad) {
        const afterBad = items.filter((x) => badItem(c.kind, x, isBad)).length;
        const q = { beforeBad: e.beforeBad ?? null, beforeCount: e.beforeCount, afterBad, afterCount: items.length };
        quality = { ...q, verdict: qualityVerdict(q) };
      }
      return { target: e.target, appliedAt: e.at, what: e.what, note: e.note, beforeAvg: e.beforeAvg, beforeCount: e.beforeCount, afterAvg: mean(items), afterCount: items.length, quality };
    });
}

// 칸 후보나 절차 후보 안에서 문제가 붙은 항목 수. 적용할 때 적용 전 품질로 남긴다.
export const countBad = (candidate, isBad) => (candidate.kind === 'cell' ? candidate.agents : candidate.runs).filter((x) => badItem(candidate.kind, x, isBad)).length;
