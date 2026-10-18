// 서브에이전트 회고 준비용 순수 함수. 파일 입출력은 subagent-retro.js가 한다.

import { createHash } from 'node:crypto';
import { localDate, projectRoot, baseModel, splitLines, LINE_BREAK, DEFAULT_RETENTION_DAYS } from './claudeProjectPaths.js';

const TRIVIAL_REPLIES = new Set([
  '좋아', '좋아요', '응', 'ㅇㅇ', 'ㅇㅋ', '오케이', 'ok', '진행해', '진행해줘', '진행', '계속', '계속해', '고마워', '네', '그래',
  '그렇게해', '그렇게해줘', '추천대로', '추천대로해줘',
  'yes', 'yeah', 'yep', 'sure', 'thanks', 'thankyou', 'continue', 'go', 'goahead', 'proceed', 'lgtm', 'okay', 'soundsgood', 'doit', 'next',
]);

const SPAWN_STATUSES = new Set(['async_launched', 'teammate_spawned']);
const MAX_ENDED = 5;
// 올려 보낸 일만 받는 정의라 내려 볼 칸이 아니다. fable-high는 정의 파일 없이 Agent 호출의 model과 effort로만 보내므로 표 칸도 정의 파일도 없다.
const ESCALATION_ONLY_DEFS = new Set(['opus-xhigh', 'fable-high']);
const CONFIRM_EACH_DEF = 'fable-high';
// 내릴 곳이 없는 정의. haiku-low는 맨 아래 칸이다.
const NO_LOWER_DEFS = new Set(['haiku-low']);
const ALWAYS_OPUS_DEF = 'opus-high';
const ALWAYS_OPUS_KIND = '무조건 Opus';
// Claude가 문서의 인용 부호(「」)를 빼고 (고정)만 붙여도 고정 칸으로 읽히게 낫표는 있어도 없어도 받는다.
const PIN_MARK = /「\(고정\)」|\(고정\)/g;
// 최저선 표시. 내림 실패가 쌓인 칸을 이 정의 아래로는 내려 보지 않는다. 고정 표시처럼 낫표와 정의 이름의 백틱은 있어도 없어도 받는다.
const FLOOR_MARK = /「\(최저:\s*`?([a-z]+-[a-z]+)`?\s*\)」|\(최저:\s*`?([a-z]+-[a-z]+)`?\s*\)/g;
// 내려 보기와 올리기가 쓰는 사다리를 아래부터 적었다. 바로 아래 칸은 앞 원소, 바로 위 칸은 뒤 원소다(low의 아래는 아래 모델의 high).
// Haiku와 Sonnet의 xhigh는 쓰지 않는 칸이라 사다리에 없다. 맨 위 fable-high는 opus-xhigh로도 안 풀린 일만 가는 단계다.
export const LADDER = ['haiku-low', 'haiku-medium', 'haiku-high', 'sonnet-low', 'sonnet-medium', 'sonnet-high', 'opus-low', 'opus-medium', 'opus-high', 'opus-xhigh', 'fable-high'];
const defRank = (def) => {
  const i = LADDER.indexOf(def);
  return i < 0 ? null : i;
};
export const lowerDef = (def) => (defRank(def) ? LADDER[defRank(def) - 1] : null);
// fable-high는 올릴 때마다 사용자 확인을 받는 정의라 최저선으로 박아 둘 수 없다. 그래서 opus-xhigh 위는 없다.
export const upperDef = (def) => {
  const up = defRank(def) !== null ? LADDER[defRank(def) + 1] : undefined;
  return up && up !== CONFIRM_EACH_DEF ? up : null;
};
// 같은 칸의 내림 실패가 이 횟수가 되면 회고가 최저선을 달자고 제안한다. 최저선이 있으면 이 횟수에 비율(UP_MIN_RATIO)까지 넘어야 올리기 후보다.
export const DOWN_FAIL_LIMIT = 2; // 출력과 문서의 「두 번」과 함께 바꾼다.
// 섞인 칸: 회고 구간에서 한 일 종류의 실패가 MIXED_MIN_FAILS건 이상이면서 성공이 MIXED_MIN_OKS건 이상.
export const MIXED_MIN_FAILS = 2; // 문서의 「2건」과 함께 바꾼다.
export const MIXED_MIN_OKS = 3; // 문서의 「3건」과 함께 바꾼다.
// 최저선을 단 뒤 이만큼 회고가 지나면 최저선 바로 아래 정의로 다시 시험하자고 제안한다. 다시 시험이 실패할 때마다 두 배로 늘린다.
export const RETRIAL_START = 2; // 출력과 문서의 「2번, 4번, 8번」과 함께 바꾼다.
// 시험 비용이 원래 칸 평균의 이 비율 안이면 비슷한 것으로 보고 걸린 시간으로 판정한다.
export const COST_SIMILAR_RATIO = 0.1; // 문서의 「10%」와 함께 바꾼다.
// 같은 시험이 이 횟수만큼 이어 판정 불가이면 표시를 지운다. 최저선 다시 시험은 실패로 보지 않고 간격만 다음 단계로 넘긴다.
export const UNDECIDED_LIMIT = 2; // 출력과 문서의 「두 번」과 함께 바꾼다.
const PREV_CHARS = 200;
const RESEND_PREFIX_CHARS = 15;

// 오타만 고쳐 다시 보낸 메시지가 같은 지적으로 두 번 세어지지 않게, 공백과 문장부호를 뺀 앞부분으로 비교한다.
const isResend = (prevText, text) => {
  if (prevText === null) return false;
  const squash = (t) => t.replace(/[\s\p{P}]/gu, '');
  const a = squash(prevText);
  const b = squash(text);
  if (a.length >= RESEND_PREFIX_CHARS && b.length >= RESEND_PREFIX_CHARS) {
    return a.slice(0, RESEND_PREFIX_CHARS) === b.slice(0, RESEND_PREFIX_CHARS);
  }
  return prevText === text;
};

const toNumber = (v) => (v !== undefined && /^-?\d+(\.\d+)?$/.test(String(v).trim()) ? Number(v) : null);
export const stripAnnex = (kind) => kind.replace(/\s*[(（][^()（）]*[)）]\s*$/, '').trim();

// 사용 기록 안의 표시 줄은 정의 열(세 번째)에 이 값이 들어 있고 데이터 줄이 아니다.
export const RETRO_MARK = '회고';
export const SNOOZE_MARK = '미룸';
// 회고를 물을 기록 줄 수. 표를 처음 맞추는 동안은 자주 묻고 회고가 쌓일수록 늘린다.
// 지금까지 한 회고 수가 인덱스이고, 배열 끝을 넘으면 마지막 값이다.
export const RETRO_STAGES = [30, 50, 100];
// 사용자가 미룬 뒤 다시 묻기까지 더 쌓여야 하는 줄 수는 min(기준의 절반, SNOOZE_MAX_LINES)다.
export const SNOOZE_MAX_LINES = 20;
// 바꾼 칸이 0인 회고가 STABLE_RETROS번 이어지면 표가 안정된 것으로 보고 기준을 STABLE_THRESHOLD로 늘린다.
export const STABLE_THRESHOLD = 200;
export const STABLE_RETROS = 2;
// 올리기 후보: 칸의 에이전트 중 올림이나 정정이 붙은 에이전트가 UP_MIN_COUNT명 이상이면서 UP_MIN_RATIO 이상. 명수만 넘고 비율이 낮은 칸은 지켜볼 칸이다.
// 에이전트는 agentId로 센다. 한 에이전트에 올림 줄과 정정이 여럿 붙어도 1이고, 재지시로 줄이 여럿이어도 분모에서 1이다.
export const UP_MIN_COUNT = 2;
export const UP_MIN_RATIO = 0.2; // 문서의 「20%」와 함께 바꾼다.

// 미룸 줄 메모 칸에서 무엇을 미뤘는지 읽는다. 옛 줄은 `-`이고 건수 기준만 미룬 것으로 본다(기간 기준은 미루지 않은 쪽이 안전하다).
// cost는 미룰 때 비용 기록에만 있던 에이전트 수(미룬 날 것)다. 옛 줄은 0이라 미룬 날의 비용 기록을 모두 새 기록으로 센다.
function parseSnoozeMemo(memo) {
  const legacy = { count: true, period: false, ups: new Map(), cost: 0 };
  try {
    const o = JSON.parse(memo);
    if (!o || typeof o !== 'object') return legacy;
    const ups = new Map();
    for (const [def, kind, n] of Array.isArray(o.올림) ? o.올림 : []) {
      if (typeof def === 'string' && typeof kind === 'string' && Number.isFinite(n)) ups.set(cellKey({ def, kind }), n);
    }
    return { count: o.건수 !== false, period: o.기간 === true, ups, cost: Number.isInteger(o.비용) && o.비용 > 0 ? o.비용 : 0 };
  } catch {
    return legacy;
  }
}

export function parseUsage(text) {
  const all = [];
  let boundaryCols = null;
  let boundaryLine = 0;
  let snooze = null;
  // 기간 기준을 미룬 마지막 미룸 줄. 건수나 올림만 미룬 줄이 그 뒤에 와도 기간 셈은 이 줄에서 시작한다.
  let periodSnooze = null;
  // 건수 기준을 미룬 마지막 미룸 줄. 기간이나 올림만 미룬 줄이 그 뒤에 와도 건수 기준의 미룸은 이 줄에서 센다.
  let countSnooze = null;
  // 회고 표시마다 바꾼 칸 수. 숫자가 없는 옛 표시는 null(모름)이다.
  const retroChanged = [];
  // 회고 표시마다 그 회고가 본 기록의 끝(cutoff)과 회고가 끝난 뒤의 표 모양(없으면 null). 내림 실패를 다시 셀 때 쓴다.
  const retros = [];
  const lines = splitLines(text);
  lines.forEach((raw, i) => {
    const cols = raw.split('\t');
    if (raw === '' || cols[0] === '날짜') return;
    const line = i + 1;
    if (cols[2] === RETRO_MARK) {
      boundaryCols = cols;
      boundaryLine = line;
      retroChanged.push(/^\d+$/.test(cols[5] ?? '') ? Number(cols[5]) : null);
      retros.push({ line, cutoff: /^\d+$/.test(cols[4] ?? '') ? Number(cols[4]) : line, at: cols[3] ?? '', snapshot: parseSnapshot(cols[7]) });
      return;
    }
    if (cols[2] === SNOOZE_MARK) {
      snooze = { line, at: cols[3] ?? '', ...parseSnoozeMemo(cols.slice(8).join('\t')) };
      if (snooze.period) periodSnooze = snooze;
      if (snooze.count) countSnooze = snooze;
      return;
    }
    const memo = cols.slice(8).join('\t');
    all.push({
      line,
      date: cols[0],
      project: cols[1],
      def: cols[2],
      kind: stripAnnex(cols[3] ?? ''),
      seconds: toNumber(cols[6]),
      result: cols[7] ?? '',
      memo,
      agentId: memo.split(/\s+/)[0] || null,
    });
  });
  if (!boundaryCols) return { all, target: all, boundary: null, snooze, periodSnooze, countSnooze, lineCount: lines.length, retroChanged, retros };

  const memo = boundaryCols.slice(8).join('\t');
  const n = /^\d+$/.test(boundaryCols[4]) ? Number(boundaryCols[4]) : null;
  let at = null;
  if (n !== null) {
    const d = new Date(boundaryCols[3]);
    at = Number.isNaN(d.getTime()) ? null : d;
  } else {
    const m = memo.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) at = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const after = n ?? boundaryLine;
  return {
    all,
    target: all.filter((r) => r.line > after),
    boundary: { at, date: at ? localDate(at) : null, lineCount: n, memo, line: boundaryLine },
    snooze,
    periodSnooze,
    countSnooze,
    lineCount: lines.length,
    retroChanged,
    retros,
  };
}

// 회고 표시가 없는 첫 회고가 키트 설치 전 대화까지 뽑지 않도록, 사용 기록 첫 날짜의 로컬 0시를 시작으로 쓴다.
export function extractSince(parsed) {
  if (parsed.boundary?.at) return { at: parsed.boundary.at, source: 'boundary' };
  let first = null;
  for (const r of parsed.target) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(r.date ?? '');
    if (!m) continue;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (first === null || d < first) first = d;
  }
  return first ? { at: first, source: 'firstUsage' } : { at: null, source: 'none' };
}

export function parseCost(texts) {
  const map = new Map();
  for (const text of texts) {
    for (const raw of splitLines(text)) {
      const c = raw.split('\t');
      if (c[0] === '날짜' || c.length < 15) continue;
      // 비용 열은 숫자이거나, 모를 때 `?` 또는 `?:<요율표에 없는 모델,...>`이다.
      const unknown = c[14].startsWith('?:') ? c[14].slice(2).split(',').filter(Boolean) : [];
      const entry = { def: c[4], session: c[2], model: c[5], description: c[7], date: c[0], requests: toNumber(c[12]) ?? 0, seconds: toNumber(c[13]), cost: toNumber(c[14]), unknownModels: unknown };
      // 같은 agentId는 마지막 줄이 최종이다. 이어서 시킨 에이전트의 누적 줄과 다시 계산한 줄이 모두 뒤에 덧붙는다.
      map.set(c[3], entry);
    }
  }
  return map;
}

export function parseCorrections(text) {
  return splitLines(text).flatMap((raw) => {
    const c = raw.split('\t');
    if (c[0] === '날짜' || c.length < 10) return [];
    return [{ date: c[0], project: c[1], session: c[2], time: c[3], target: c[4], agentId: c[5], def: c[6], kind: c[7], label: c[8], message: c.slice(9).join('\t') }];
  });
}

const cellKey = (r) => `${r.def}\u0000${r.kind}`;

export function lastLineByAgent(rows) {
  const last = new Map();
  for (const r of rows) if (r.agentId) last.set(r.agentId, r);
  return last;
}

// 칸(정의와 일 종류)마다 에이전트 수를 센다. 분모는 칸에 줄이 있는 서로 다른 agentId,
// 분자는 그 가운데 칸 안에 올림 줄이 있거나 마지막 줄이 이 칸이면서 정정이 붙은 agentId다.
// 정정은 agentId에 붙어 있고(correctionsByAgent), 칸에는 summarize가 정정 건수를 묶는 단위와 같게 그 에이전트의 마지막 줄 칸으로 묶는다.
// agentId가 없는 줄은 줄마다 다른 에이전트로 본다.
export function agentTally(rows, correctionsByAgent = new Map()) {
  const last = lastLineByAgent(rows);
  const cells = new Map();
  rows.forEach((r, i) => {
    let cell = cells.get(cellKey(r));
    if (!cell) {
      cell = { def: r.def, kind: r.kind, agents: new Set(), upAgents: new Set() };
      cells.set(cellKey(r), cell);
    }
    const id = r.agentId || `\u0000line${i}`;
    cell.agents.add(id);
    const corrected = r.agentId && last.get(r.agentId) === r && (correctionsByAgent.get(r.agentId) ?? 0) > 0;
    if (r.result === '올림' || corrected) cell.upAgents.add(id);
  });
  return cells;
}

export function summarize(target, costMap, agentCorrections, { all = target, since = null } = {}) {
  const last = lastLineByAgent(target);
  const tally = agentTally(target, agentCorrections);
  const cells = new Map();
  let noCost = 0;
  for (const r of target) {
    let cell = cells.get(cellKey(r));
    if (!cell) {
      cell = { def: r.def, kind: r.kind, count: 0, ok: 0, redo: 0, up: 0, corrections: 0, agents: tally.get(cellKey(r)).agents.size, upAgents: tally.get(cellKey(r)).upAgents.size, costSum: 0, paired: 0, costKnown: 0, costUnknown: 0, secSum: 0, secN: 0 };
      cells.set(cellKey(r), cell);
    }
    cell.count++;
    if (r.result === 'ok') cell.ok++;
    else if (r.result === '재지시') cell.redo++;
    else if (r.result === '올림') cell.up++;

    const cost = r.agentId ? costMap.get(r.agentId) : undefined;
    const isLast = r.agentId && last.get(r.agentId) === r;
    let seconds = r.seconds;
    if (cost) {
      seconds = isLast ? cost.seconds : null;
      if (isLast) {
        cell.paired++;
        // 비용을 모르는 에이전트는 합계와 평균에서 빼고 건수만 센다.
        if (cost.cost === null) cell.costUnknown++;
        else {
          cell.costKnown++;
          cell.costSum += cost.cost;
        }
      }
    } else {
      noCost++;
    }
    if (isLast) cell.corrections += agentCorrections.get(r.agentId) ?? 0;
    if (seconds !== null) {
      cell.secSum += seconds;
      cell.secN++;
    }
  }

  const finish = (c) => ({
    def: c.def,
    kind: c.kind,
    count: c.count,
    ok: c.ok,
    redo: c.redo,
    up: c.up,
    corrections: c.corrections,
    agents: c.agents,
    upAgents: c.upAgents,
    costSum: c.costSum,
    paired: c.paired,
    costKnown: c.costKnown,
    costUnknown: c.costUnknown,
    costAvg: c.costKnown ? c.costSum / c.costKnown : null,
    avgSeconds: c.secN ? Math.round(c.secSum / c.secN) : null,
  });
  const list = [...cells.values()].sort((a, b) => a.def.localeCompare(b.def) || a.kind.localeCompare(b.kind));
  const sum = (key) => list.reduce((s, c) => s + c[key], 0);
  const total = finish({
    def: '합계',
    kind: '',
    count: sum('count'),
    ok: sum('ok'),
    redo: sum('redo'),
    up: sum('up'),
    corrections: sum('corrections'),
    agents: sum('agents'),
    upAgents: sum('upAgents'),
    costSum: sum('costSum'),
    paired: sum('paired'),
    costKnown: sum('costKnown'),
    costUnknown: sum('costUnknown'),
    secSum: sum('secSum'),
    secN: sum('secN'),
  });

  const knownIds = new Set(all.map((r) => r.agentId));
  const costOnly = [...costMap]
    .filter(([id, c]) => !knownIds.has(id) && (!since || c.date >= since))
    .map(([agentId, c]) => ({ agentId, def: c.def, description: c.description, cost: c.cost }));
  return { rows: list.map(finish), total, noCost, costOnly };
}

// 비용 기록 전체(agentId마다 마지막 줄)에서 요율표에 없던 모델과 그 에이전트 수를 센다.
// 모델 이름 없이 비용만 모르는 줄(옛 기록, 요율표 읽기 실패, 사용량 0 줄 때문에 모른 줄)은 unnamed로 센다.
// 옛 기록에는 꼬리([1m], 날짜)가 붙은 이름이 남아 있어, 요율표 키로 쓸 이름(baseModel)으로 합쳐 세고 한 에이전트는 한 번만 센다.
export function unknownModelSummary(costMap) {
  const models = new Map();
  let unnamed = 0;
  for (const c of costMap.values()) {
    if (c.cost !== null) continue;
    if (!c.unknownModels.length) unnamed++;
    for (const m of new Set(c.unknownModels.map(baseModel))) models.set(m, (models.get(m) ?? 0) + 1);
  }
  return { models: [...models].map(([model, count]) => ({ model, count })).sort((a, b) => b.count - a.count || a.model.localeCompare(b.model)), unnamed };
}

// pinnedCells는 표에서 「(고정)」이 붙은 칸의 cellKey 집합이다. 표를 못 읽어 비어 있어도 「무조건 Opus」 영역은 이름으로 뺀다.
// floors는 일 종류마다 최저선 정의다. 바로 아래 칸이 최저선보다 아래이면 후보에서 뺀다.
export function downCandidates(all, correctionsByAgent, pinnedCells = new Set(), floors = new Map()) {
  const corrected = (r) => r.agentId && (correctionsByAgent.get(r.agentId) ?? 0) > 0;
  const groups = new Map();
  for (const r of all) {
    if (!groups.has(cellKey(r))) groups.set(cellKey(r), []);
    groups.get(cellKey(r)).push(r);
  }
  const down = [];
  for (const rows of groups.values()) {
    if (ESCALATION_ONLY_DEFS.has(rows[0].def) || NO_LOWER_DEFS.has(rows[0].def)) continue;
    // 사다리 밖 정의(Explore 등 키트 정의가 아닌 에이전트)는 표의 칸이 아니라 바로 아래 칸을 가리킬 수 없다.
    if (defRank(rows[0].def) === null) continue;
    if (rows[0].def === ALWAYS_OPUS_DEF && rows[0].kind.includes(ALWAYS_OPUS_KIND)) continue;
    if (pinnedCells.has(cellKey(rows[0]))) continue;
    const floor = floors.get(rows[0].kind);
    const below = lowerDef(rows[0].def);
    if (floor && defRank(floor) !== null && (below === null || defRank(below) < defRank(floor))) continue;
    const lastFive = rows.slice(-5);
    if (lastFive.length === 5 && lastFive.every((r) => r.result === 'ok' && !corrected(r))) down.push({ def: rows[0].def, kind: rows[0].kind });
  }
  return down;
}

// 회고를 사용자에게 물을 때인지 정한다. 마지막 회고 표시 뒤 기록이 threshold줄 이상이고,
// 그 뒤에 미룸 표시가 없거나 미룸 표시 뒤 기록이 snoozeLines줄 이상이면 ask다. 표시 줄은 세지 않는다.
// 미룸이 마지막 회고 표시보다 앞이면 그 회고로 끝난 일이라 무시한다.
// 같은 칸에 올림이 붙은 에이전트가 UP_MIN_COUNT명 이상 쌓인 때도 ask다(retroDue).
// 사용 기록은 메인이 손으로 적어 빠질 수 있어서, 사용 기록에 없는 agentId의 비용 기록(훅이 빠짐없이 쌓음)을 표시 날짜부터 더해 센다.
// 비용 기록은 날짜만 있어 표시 날짜 당일 것은 표시 앞뒤를 못 가르므로 당일도 넣는다(조금 일찍 묻는 쪽이 늦는 쪽보다 낫다).
// 미룸 줄은 미룰 때 이 수를 메모에 남기고(snoozeLine의 costOnly), 미룸 뒤 새 기록을 셀 때는 그 수를 뺀 늘어난 몫만 센다(newCostSince).
// afork-는 사용자가 직접 띄운 포크라 맡긴 일이 아니다.
export const unloggedCostSince = (all, costMap, sinceDate) => {
  if (!costMap || !sinceDate) return 0;
  const logged = new Set(all.map((r) => r.agentId).filter(Boolean));
  let n = 0;
  for (const [agentId, c] of costMap) {
    if (agentId.startsWith('afork-') || logged.has(agentId)) continue;
    if (/^\d{4}-\d{2}-\d{2}$/.test(c.date ?? '') && c.date >= sinceDate) n++;
  }
  return n;
};

// 미룸 줄 뒤에 늘어난 비용 기록만 새 기록으로 센다. 미룬 날 당일의 비용 기록 가운데 미룰 때 이미 있던 것은 미룸 앞의 일이다.
const newCostSince = (all, costMap, snooze) => {
  const d = new Date(snooze.at);
  const date = Number.isNaN(d.getTime()) ? null : localDate(d);
  return Math.max(0, unloggedCostSince(all, costMap, date) - snooze.cost);
};

// 마지막 STABLE_RETROS번의 회고가 모두 바꾼 칸 0이면 표 안정이다. 바꾼 칸을 모르는 옛 표시가 끼면 안정으로 보지 않는다.
// 시험 표시만 붙인 회고도 바꾼 칸이 0이라, 판정 전 시험 표시가 표에 있으면(trialsPending) 안정으로 보지 않는다. 안정으로 보면 기준이 200건으로 늘어 시험 판정이 그만큼 밀린다.
export function isStable(retroChanged = [], { trialsPending = false } = {}) {
  if (trialsPending) return false;
  return retroChanged.length >= STABLE_RETROS && retroChanged.slice(-STABLE_RETROS).every((n) => n === 0);
}

// 회고 표시 수(retroChanged 길이)로 지금 단계의 기준과 미룸 간격을 정한다. 표 안정이면 단계 배열보다 우선한다.
export function retroStage(retroChanged = [], { trialsPending = false } = {}) {
  const retros = retroChanged.length;
  const stable = isStable(retroChanged, { trialsPending });
  const held = trialsPending && isStable(retroChanged);
  const threshold = stable ? STABLE_THRESHOLD : RETRO_STAGES[Math.min(retros, RETRO_STAGES.length - 1)];
  const snoozeLines = Math.min(Math.floor(threshold / 2), SNOOZE_MAX_LINES);
  const phase = stable ? '표 안정' : retros === 0 ? '첫 회고 전' : `회고 ${retros}번 뒤`;
  const base = stable ? `표 안정(기준 ${threshold}건)` : retros === 0 ? `첫 회고 기준 ${threshold}건` : `회고 ${retros}번 뒤 기준 ${threshold}건`;
  const label = held ? `${base}, 판정 전 시험 표시가 있어 표 안정으로 보지 않음` : base;
  return { retros, stable, held, threshold, snoozeLines, phase, label };
}

// 올리기 후보(upCandidates)와 같은 조건으로 고른 칸이다. 올림이 붙은 에이전트가 UP_MIN_COUNT명 이상이면서 그 칸 에이전트의 UP_MIN_RATIO 이상이다.
// 올릴 칸이 없는 정의(upperDef가 null인 opus-xhigh, fable-high, 사다리 밖 정의)는 뺀다. 넣으면 묻고 회고해도 할 일이 없다.
// rows는 마지막 회고 뒤 기록(parsed.target)이고, 분모 total은 회고 표의 c.agents와 같게 그 범위에서 그 칸(정의와 일 종류)에 줄이 있는 서로 다른 agentId 수다.
// 정정 기록을 읽는 쪽만 correctionsByAgent를 넘긴다(--due는 정정 기록을 읽지 않아 올림 줄만 센다). 재지시는 지시문 탓이라 표의 문제가 아니므로 분자에 넣지 않는다.
export function upPiles(rows, correctionsByAgent = new Map()) {
  return [...agentTally(rows, correctionsByAgent).values()]
    .map((c) => ({ def: c.def, kind: c.kind, count: c.upAgents.size, total: c.agents.size }))
    .filter((p) => upperDef(p.def) !== null && p.count >= UP_MIN_COUNT && p.count / p.total >= UP_MIN_RATIO)
    .sort((a, b) => b.count - a.count || a.def.localeCompare(b.def) || a.kind.localeCompare(b.kind));
}

// 건수 기준과 올림 기준 중 하나라도 걸리면 ask다. 올림 기준은 올리기 후보와 같은 조건(upPiles)을 만족하는 칸이 있는 때이고, 기록 건수와 상관없다.
// 올림이 쌓이면 회고가 칸을 내린 뒤에도 다음 기준 건수까지 표가 낮은 채로 남아 같은 일을 위 정의로 다시 보내게 되기 때문이다.
// 비율 조건을 맞춘 것은, 묻고 회고했는데 올릴 칸이 없는 일이 없게 하고 칸의 에이전트가 많은데 올림이 몇 명뿐이면 일찍 물을 이유가 약해서다.
// 미룸 뒤에는 미룰 때 조건을 만족하던 칸이 올림이 붙은 에이전트 1명을 더 받고 조건을 다시 만족할 때까지 그 칸으로는 묻지 않는다. 건수 기준은 위의 미룸 규칙을 그대로 따른다.
// 기간 기준: 마지막 회고(없으면 사용 기록 첫 줄, 기간 기준을 미룬 미룸이 그 뒤에 있으면 그 미룸) 날짜부터 (보존 기간 - 5일)이 지나면 건수와 상관없이 ask다.
// Claude Code가 보존 기간이 지난 대화 기록을 지워, 회고 사이가 길면 정정이 소리 없이 사라지기 때문이다. 5일 이하인 보존 기간은 (보존 기간 - 1)일로 한다.
// 뽑을 새 기록이 없으면 지워질 정정도 없으므로 걸지 않는다. 셈 시작이 기간 미룸 줄이면 그 줄 뒤의 기록만 새 기록으로 센다.
// 건수나 올림 기준만 걸려 미룬 줄은 기간 셈을 옮기지 않는다. 옮기면 건수로 물었다가 미룬 사이에 오래된 대화가 지워진 뒤에야 기간 기준이 묻게 된다.
export const RETENTION_MARGIN_DAYS = 5;
export const periodLimitDays = (retentionDays) => (retentionDays > RETENTION_MARGIN_DAYS ? retentionDays - RETENTION_MARGIN_DAYS : retentionDays - 1);

const dayNumber = (dateText) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText ?? '');
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000 : null;
};

const addDays = (dateText, n) => {
  const [y, m, d] = dateText.split('-').map(Number);
  return localDate(new Date(y, m - 1, d + n));
};

// 기간 기준을 오늘 미루면 다음 기간 질문은 오늘 + 기간 간격(periodLimit)일이고, 그때 보존 기간이 지나 있는 대화는 (그 날 - 보존 기간)일 이전 것이다.
// 이 날짜 이전 대화의 정정은 다음 회고가 보기 전에 지워질 수 있다.
export const periodSnoozeLossDate = (d, now = new Date()) => addDays(localDate(now), d.periodLimit - d.retentionDays);

// 보존 기간에 닿았거나 지났으면 오늘 - 보존 기간 이전 대화는 Claude Code가 이미 지웠을 수 있다.
export const retentionLossDate = (d, now = new Date()) => addDays(localDate(now), -d.retentionDays);

function periodAnchor(parsed, snooze) {
  if (snooze) {
    const d = new Date(snooze.at);
    if (!Number.isNaN(d.getTime())) return localDate(d);
  }
  if (parsed.boundary) return parsed.boundary.date;
  return parsed.all.length ? parsed.all[0].date : null;
}

export function retroDue(parsed, { threshold = null, snoozeLines = null, costMap = null, trialsPending = false, retentionDays = DEFAULT_RETENTION_DAYS, now = new Date() } = {}) {
  const stage = retroStage(parsed.retroChanged, { trialsPending });
  const { stable } = stage;
  if (threshold === null) threshold = stage.threshold;
  if (snoozeLines === null) snoozeLines = Math.min(Math.floor(threshold / 2), SNOOZE_MAX_LINES);
  const usageCount = parsed.target.length;
  const missed = unloggedCostSince(parsed.all, costMap, parsed.boundary ? parsed.boundary.date : '0000-00-00');
  const count = usageCount + missed;
  const snooze = parsed.snooze && parsed.snooze.line > (parsed.boundary?.line ?? 0) ? parsed.snooze : null;
  const countSnooze = parsed.countSnooze && parsed.countSnooze.line > (parsed.boundary?.line ?? 0) ? parsed.countSnooze : null;
  let afterSnooze = null;
  if (countSnooze) afterSnooze = parsed.target.filter((r) => r.line > countSnooze.line).length + newCostSince(parsed.all, costMap, countSnooze);
  const remaining = Math.max(threshold - count, afterSnooze === null ? 0 : snoozeLines - afterSnooze);
  const piles = upPiles(parsed.target);
  const upCells = piles.filter((p) => p.count > (snooze?.ups.get(cellKey(p)) ?? 0));
  const periodSnooze = parsed.periodSnooze && parsed.periodSnooze.line > (parsed.boundary?.line ?? 0) ? parsed.periodSnooze : null;
  const anchor = periodAnchor(parsed, periodSnooze);
  const limit = periodLimitDays(retentionDays);
  const anchorDay = dayNumber(anchor);
  const elapsed = anchorDay === null ? null : dayNumber(localDate(now)) - anchorDay;
  const periodSnoozeAtValid = periodSnooze && !Number.isNaN(new Date(periodSnooze.at).getTime());
  const newSincePeriodStart = periodSnoozeAtValid ? parsed.target.filter((r) => r.line > periodSnooze.line).length + newCostSince(parsed.all, costMap, periodSnooze) : count;
  const byPeriod = elapsed !== null && elapsed >= limit && newSincePeriodStart > 0;
  const period = { retentionDays, periodLimit: limit, periodElapsed: elapsed, periodAnchor: anchorDay === null ? null : anchor, periodDueDate: anchorDay === null ? null : addDays(anchor, limit), byPeriod };
  const info = { count, usageCount, stable, threshold, snoozeLines, label: stage.label, byCount: remaining <= 0, piles, upCells, ...period };
  return remaining > 0 && !upCells.length && !byPeriod ? { status: 'wait', remaining, ...info } : { status: 'ask', remaining: 0, ...info };
}

// 회고 표시 줄. 9열이고 여섯째 열에 바꾼 칸 수를 담는다(모르면 `-`). 이 열은 데이터 줄에서 도구 수 자리라 표시 줄에서는 비어 있었다.
// 여덟째 열(데이터 줄의 결과 자리)에는 회고가 끝난 뒤의 표 모양(tableSnapshot)을 담는다. 표를 못 읽었으면 `-`다.
export function retroLine(extractedAt, usageLines, changed, memo, snapshot = '-') {
  return ['회고', '-', '회고', extractedAt, usageLines, changed === null ? '-' : changed, '-', snapshot || '-', memo].join('\t');
}

// 사용 기록에 덧붙이는 미룸 표시 줄. 회고 표시 줄과 같은 9열이고 정의 열이 `미룸`이다.
// 메모 칸에는 미룰 때 올림이 쌓여 있던 칸과 올림이 붙은 에이전트 수(ups: {def, kind, count} 목록)를 JSON으로 남긴다.
// 건수 기준 미룸이 아니면(countSnoozed=false) 그 사실도 남기고, 기간 기준을 미뤘으면(periodSnoozed) 기간: true를 남긴다.
// 미룰 때 비용 기록에만 있던 에이전트 수(costOnly, 미룬 날 것)가 있으면 비용: N을 남긴다. 모두 평범하면 옛 줄과 같게 `-`다.
export function snoozeLine(now = new Date(), { countSnoozed = true, periodSnoozed = false, ups = [], costOnly = 0 } = {}) {
  const memo = countSnoozed && !periodSnoozed && !ups.length && !costOnly ? '-' : JSON.stringify({ 건수: countSnoozed, ...(periodSnoozed ? { 기간: true } : {}), ...(costOnly ? { 비용: costOnly } : {}), 올림: ups.map((u) => [u.def, u.kind, u.count]) });
  return [SNOOZE_MARK, '-', SNOOZE_MARK, now.toISOString(), '-', '-', '-', '-', memo].join('\t');
}

// 추출한 뒤 다른 세션이 회고를 끝내 쓴 경계 줄(사용 기록의 afterLine번째 줄 뒤)을 찾는다.
export function findLaterBoundary(usageText, afterLine) {
  const lines = splitLines(usageText);
  for (let i = afterLine; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    if (cols[2] === RETRO_MARK) return { line: i + 1, memo: cols.slice(8).join('\t') };
  }
  return null;
}

// 사다리 밖 정의(키트 정의가 아닌 에이전트)는 표에 칸이 없고, opus-xhigh와 fable-high는 올릴 칸이 없어(upperDef가 null) 올릴 대상이 아니라 뺀다.
// count는 올림이나 정정이 붙은 에이전트 수, total은 그 칸의 회고 구간 에이전트 수다. 후보와 지켜볼 칸을 나눠 돌려준다.
export function upCandidates(summaryRows) {
  const up = [];
  const watch = [];
  for (const c of summaryRows) {
    const count = c.upAgents;
    if (count < UP_MIN_COUNT || upperDef(c.def) === null) continue;
    const item = { def: c.def, kind: c.kind, count, total: c.agents, ratio: c.agents ? count / c.agents : 0 };
    (item.ratio >= UP_MIN_RATIO ? up : watch).push(item);
  }
  return { up, watch };
}

// 올리기 후보 칸에서 올림이 붙은 에이전트를 어느 정의로 다시 보냈는지 찾는다. 사용 기록에는 다시 보낸 줄이 어느 올림에서 나왔는지 적는 열이 없어서 순서로 짝짓는다.
// 올림이 붙은 에이전트(마지막 올림 줄이나 정정이 붙은 마지막 줄)마다, 그 줄 뒤에서 같은 일 종류의 더 높은 정의의 ok 줄 가운데 아직 짝이 없고 다른 에이전트인 첫 줄을 그 재전송으로 본다.
// 한계: 같은 일 종류의 다른 일을 높은 정의로 맡긴 ok 줄도 짝이 될 수 있고, 같은 프로젝트인지는 보지 않는다. 그래서 건수는 최대치로 읽는다.
// target은 올림을 찾을 회고 뒤 기록, all은 재전송을 찾을 전체 기록이다.
export function resendsOf(target, all, def, kind, correctionsByAgent = new Map()) {
  const corrected = (id) => id && (correctionsByAgent.get(id) ?? 0) > 0;
  const last = lastLineByAgent(target);
  const anchors = new Map();
  for (const r of target) {
    if (r.def !== def || r.kind !== kind) continue;
    if (!(r.result === '올림' || (r.agentId && last.get(r.agentId) === r && corrected(r.agentId)))) continue;
    const unit = r.agentId || `\u0000line${r.line}`;
    anchors.set(unit, { agentId: r.agentId, line: Math.max(r.line, anchors.get(unit)?.line ?? 0) });
  }
  const used = new Set();
  const byDef = new Map();
  for (const a of [...anchors.values()].sort((x, y) => x.line - y.line)) {
    const hit = all.find((r) => r.line > a.line && !used.has(r.line) && r.kind === kind && r.result === 'ok' && r.agentId !== a.agentId && !corrected(r.agentId) && defRank(r.def) !== null && defRank(r.def) > defRank(def));
    if (!hit) continue;
    used.add(hit.line);
    byDef.set(hit.def, (byDef.get(hit.def) ?? 0) + 1);
  }
  return [...byDef].map(([d, count]) => ({ def: d, count })).sort((x, y) => y.count - x.count || defRank(x.def) - defRank(y.def));
}

export function isTrivial(text) {
  if (/^\/[a-z][\w:-]*$/i.test(text.trim())) return true;
  const bare = text.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
  if (!bare) return false;
  return /^[a-e]$/.test(bare) || /^\d$/.test(bare) || /^q\d+([a-e]|\d)$/.test(bare) || TRIVIAL_REPLIES.has(bare);
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((b) => b?.type === 'text').map((b) => b.text ?? '').join('');
}

// 대화 기록의 사람 메시지는 origin.kind가 human이다. origin 없이 turnOrigin만 human인 줄도 있는데, 대부분 `!` 명령의 출력(<bash-stdout> 등)이라
// 이 꼴은 Claude Code가 넣은 글 접두사가 아니고 도구 결과가 아닌 것만 받는다.
function isHumanTurn(o, text) {
  if (o.origin?.kind === 'human') return true;
  if (o.origin != null || o.turnOrigin !== 'human' || o.toolUseResult) return false;
  const lower = text.trim().toLowerCase();
  return !SYSTEM_TEXT_PREFIXES.some((p) => lower.startsWith(p));
}

export function extractMessages(lines, since) {
  const sinceMs = since == null ? null : new Date(since).getTime();
  const toolUses = new Map();
  const agents = new Map();
  const nameToId = new Map();
  const messages = [];
  let ended = [];
  let prev = '';
  let lastHuman = null;
  let total = 0;
  let filtered = 0;

  const end = (id) => {
    if (!agents.has(id)) return;
    ended = ended.filter((x) => x !== id);
    ended.push(id);
  };

  for (const o of lines) {
    const content = o.message?.content;
    if (o.type === 'assistant' && Array.isArray(content)) {
      for (const b of content) {
        if (b.type === 'tool_use' && (b.name === 'Agent' || b.name === 'Task')) toolUses.set(b.id, b.input ?? {});
        else if (b.type === 'text' && b.text) prev = b.text;
      }
      continue;
    }
    if (o.type !== 'user') continue;

    const r = o.toolUseResult;
    const agentId = r?.agentId ?? r?.agent_id;
    if (agentId) {
      const toolId = Array.isArray(content) ? content.find((b) => b?.tool_use_id)?.tool_use_id : undefined;
      const input = toolUses.get(toolId) ?? {};
      agents.set(agentId, { agentId, def: input.subagent_type ?? r.agent_type ?? '?', description: input.description ?? r.description ?? '' });
      const name = r.name ?? input.name;
      if (name) nameToId.set(name, agentId);
      if (typeof r.status === 'string' && !SPAWN_STATUSES.has(r.status)) end(agentId);
    }

    const text = textOf(content);
    if (isHumanTurn(o, text)) {
      if (!text.trim()) continue;
      const repeated = isResend(lastHuman, text.trim());
      const doneAgents = ended.slice(-MAX_ENDED).map((id) => agents.get(id));
      lastHuman = text.trim();
      ended = [];
      if (sinceMs !== null && Date.parse(o.timestamp) < sinceMs) continue;
      total++;
      if (repeated || isTrivial(text)) {
        filtered++;
        continue;
      }
      messages.push({ time: o.timestamp, text, prev: prev.slice(-PREV_CHARS), agents: doneAgents });
    } else if (text.includes('<task-notification>')) {
      const id = text.match(/<task-id>([^<]*)<\/task-id>/)?.[1];
      const status = text.match(/<status>([^<]*)<\/status>/)?.[1];
      if (id && status === 'completed') end(id);
    } else if (text.includes('idle_notification')) {
      const name = text.match(/<teammate-message teammate_id="([^"]+)"/)?.[1];
      if (name && nameToId.has(name)) end(nameToId.get(name));
    }
  }
  return { messages, total, filtered };
}

// 반복 찾기: 같은 꼴이 REPEAT_MIN_COUNT번 이상이면서 REPEAT_MIN_SESSIONS개 세션 이상에 걸친 것만 후보다.
// 한 세션 안의 반복은 그 일을 푸는 과정일 수 있어, 세션이 갈려도 되풀이되는 것만 습관으로 본다.
export const REPEAT_MIN_COUNT = 3;
export const REPEAT_MIN_SESSIONS = 2;
export const REPEAT_TOP = 20;
export const REPEAT_KINDS = ['user', 'bash', 'agent'];
const REPEAT_MIN_USER_CHARS = 10;
// 키트 자신의 스크립트는 회고마다 부르는 것이 정상이라 반복으로 세지 않는다.
const KIT_SCRIPT = /subagent-(?:retro|usage)\.js/;
// 앞에 `cd <경로> &&`가 붙은 꼴도 같이 거르려고 묶은 꼴(normalizeShape의 결과)에 대고 본다. 파이프와 && 등으로 이은 명령은 확인만 하는 명령이 아니라 거르지 않는다.
const SHORT_CHECK = /^(?:ls|pwd|date|whoami|which|git (?:status|diff|log|branch|show|remote))(?: [^|&;\n]*)?$/;
// 경로를 <경로>로 지우면 파일이 달라도 같은 꼴이 되므로 단일 파일을 읽기만 하는 명령은 반복이 아니다. 리다이렉션(>, <)이 있으면 읽기가 아니라 쓰기일 수 있어 남긴다.
const FILE_READ = /^(?:cat|head|tail|wc|sed -n)(?: [^|&;<>\n]*)?$/;
const PLACEHOLDER = /<(?:경로|문자열|id)>/g;
// 마크다운 제목, 구분선, 빈 줄은 서로 다른 지시문이 같은 머리말을 공유하는 자리라 꼴로 쓰지 않는다.
const SKIPPED_LINE = /^(?:#.*|[-*_=]{3,})$/;
// 사용자가 친 메시지가 아니라 Claude Code가 넣은 글이다.
const SYSTEM_TEXT_PREFIXES = ['[request interrupted', '<command-', '<local-command', '<bash-', '<system-reminder', '<task-notification'];

// 매번 달라지는 부분을 지워 같은 꼴끼리 비교하게 한다. 경로는 셸 연산자(; | & < > 괄호)에서 끊어야 `cat /x; rm /y` 같은 묶음의 연산자가 경로에 먹히지 않는다. 따옴표 안을 먼저 지워야 그 안의 경로와 숫자가 따로 잡히지 않고,
// 경로를 숫자보다 먼저 지워야 경로 속 숫자가 N으로 쪼개지지 않는다. 영문을 먼저 소문자로 바꿔 N만 대문자로 남겨 둔다.
export function normalizeShape(text) {
  return String(text)
    .toLowerCase()
    .replace(/"[^"]*"|“[^”]*”|(?<![\p{L}\p{N}])'[^']*'|(?<![\p{L}\p{N}])‘[^’]*’/gu, '<문자열>')
    .replace(/(?<![\p{L}\p{N}_.:<>/\\-])(?:(?:~|\$home|\$\{home\})(?:\/[^\s;|&<>()]*)?|\/[^\s/;|&<>()][^\s;|&<>()]*|[a-z]:[\\/][^\s;|&<>()]*|\$env:[a-z_]+(?:[\\/][^\s;|&<>()]*)?|%[a-z_]+%[\\/][^\s;|&<>()]*)/gu, '<경로>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, '<id>')
    .replace(/\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{7,}\b/g, '<id>')
    .replace(/\d+(?:[.,:]\d+)*/g, 'N')
    .replace(/\s+/g, ' ')
    .trim();
}

// kind는 user, bash, agent. 반복 후보에서 뺄 것이면 true다.
export function isExcludedRepeat(kind, text) {
  const trimmed = String(text).trim();
  if (kind === 'bash') {
    if (KIT_SCRIPT.test(trimmed)) return true;
    const shape = normalizeShape(trimmed).replace(/^cd \S+ (?:&&|;) /, '');
    return SHORT_CHECK.test(shape) || FILE_READ.test(shape.replace(PLACEHOLDER, 'x'));
  }
  if (kind === 'user') {
    if ([...trimmed].length < REPEAT_MIN_USER_CHARS || isTrivial(trimmed)) return true;
    const lower = trimmed.toLowerCase();
    return SYSTEM_TEXT_PREFIXES.some((p) => lower.startsWith(p));
  }
  return false;
}

const resultChars = (content) => {
  if (typeof content === 'string') return content.length;
  return Array.isArray(content) ? content.reduce((n, b) => n + (typeof b?.text === 'string' ? b.text.length : 0), 0) : 0;
};

// 한 세션의 줄에서 사용자 메시지, Bash 명령, Agent 지시문(제목과 구분선과 빈 줄을 건너뛴 첫 내용 줄)을 모은다. since 앞의 것은 세지 않는다.
// chars는 그 입력과 같은 id의 tool_result 글자 수를 더한 값이라 어림 토큰(글자 수 / 3)의 바탕이 된다.
export function extractRepeatItems(lines, since) {
  const sinceMs = since == null ? null : new Date(since).getTime();
  const beforeSince = (o) => sinceMs !== null && Date.parse(o.timestamp) < sinceMs;
  const items = [];
  const byToolId = new Map();
  const add = (kind, text, chars) => {
    if (isExcludedRepeat(kind, text)) return null;
    const shape = normalizeShape(text);
    if (!shape) return null;
    const item = { kind, shape, text, chars };
    items.push(item);
    return item;
  };

  for (const o of lines) {
    const content = o.message?.content;
    if (o.type === 'assistant' && Array.isArray(content)) {
      if (beforeSince(o)) continue;
      for (const b of content) {
        if (b?.type !== 'tool_use') continue;
        let item = null;
        if (b.name === 'Bash' && typeof b.input?.command === 'string') {
          item = add('bash', b.input.command, b.input.command.length);
        } else if ((b.name === 'Agent' || b.name === 'Task') && typeof b.input?.prompt === 'string') {
          const first = b.input.prompt.split(LINE_BREAK).map((l) => l.trim()).find((l) => l && !SKIPPED_LINE.test(l));
          if (first) item = add('agent', first, b.input.prompt.length);
        }
        if (item) byToolId.set(b.id, item);
      }
    } else if (o.type === 'user') {
      if (Array.isArray(content)) {
        for (const b of content) {
          const item = b?.type === 'tool_result' ? byToolId.get(b.tool_use_id) : undefined;
          if (item) item.chars += resultChars(b.content);
        }
      }
      const text = textOf(content);
      if (!isHumanTurn(o, text) || beforeSince(o)) continue;
      if (text.trim()) add('user', text, text.length);
    }
  }
  return items;
}

// items는 extractRepeatItems의 결과에 session(세션 id)과 project를 붙인 것이다.
// 종류별로 후보만 골라 횟수, 세션 수 순으로 top개씩 돌려준다. tokens는 같은 꼴의 글자 수 합을 3으로 나눈 어림값이다.
export function rankRepeats(items, { top = REPEAT_TOP } = {}) {
  const out = Object.fromEntries(REPEAT_KINDS.map((k) => [k, []]));
  const groups = new Map();
  for (const it of items) {
    const key = `${it.kind}\u0000${it.shape}`;
    const g = groups.get(key) ?? { kind: it.kind, shape: it.shape, count: 0, sessions: new Set(), projects: new Set(), chars: 0, example: it.text };
    g.count++;
    g.sessions.add(it.session);
    g.projects.add(it.project);
    g.chars += it.chars;
    groups.set(key, g);
  }
  for (const g of groups.values()) {
    if (g.count < REPEAT_MIN_COUNT || g.sessions.size < REPEAT_MIN_SESSIONS) continue;
    out[g.kind].push({ shape: g.shape, count: g.count, sessions: g.sessions.size, projects: g.projects.size, tokens: Math.round(g.chars / 3), example: g.example });
  }
  for (const k of REPEAT_KINDS) {
    out[k].sort((a, b) => b.count - a.count || b.sessions - a.sessions || a.shape.localeCompare(b.shape));
    out[k] = out[k].slice(0, top);
  }
  return out;
}

const KINDS = new Set(['정정', '방향 전환', '해당 없음']);

export function parseLabels(text, messages) {
  const byN = new Map(messages.map((m) => [m.n, m]));
  const labels = [];
  const skipped = [];
  const seen = new Set();
  for (const raw of text.split(LINE_BREAK)) {
    const line = raw.trim();
    if (!line || line.startsWith('```')) continue;
    const cells = (line.includes('\t') ? line.split('\t') : line.includes('|') ? line.replace(/^\||\|$/g, '').split('|') : line.split(/ {2,}/)).map((c) => c.trim());
    if (!/^\d+$/.test(cells[0])) continue;
    const n = Number(cells[0]);
    const skip = (reason) => skipped.push({ n, line, reason });
    const msg = byN.get(n);
    if (!msg) {
      skip('없는 번호');
      continue;
    }
    if (seen.has(n)) {
      skip('중복 번호');
      continue;
    }
    const kind = cells[1];
    if (!KINDS.has(kind)) {
      skip('잘못된 분류');
      continue;
    }
    if (kind !== '정정') {
      seen.add(n);
      labels.push({ n, kind, target: '-', label: '-' });
      continue;
    }
    let target = cells[2] ?? '';
    if (target === '서브에이전트' && msg.agents.length === 1) target = msg.agents[0].agentId;
    if (target !== '메인' && !msg.agents.some((a) => a.agentId === target)) {
      skip('목록 밖 대상');
      continue;
    }
    seen.add(n);
    labels.push({ n, kind, target, label: cells[3] || '-' });
  }
  const handled = new Set([...labels.map((l) => l.n), ...skipped.map((x) => x.n)]);
  return { labels, skipped, unlabeled: messages.filter((m) => !handled.has(m.n)).map((m) => m.n) };
}

// 끝난 에이전트 칸(`agentId:정의:설명|...`)에서 agentId만 읽는다. 정의 이름에 쌍점이 들어 있을 수 있다.
export function agentsFromCell(cell) {
  return cell === '-' ? [] : cell.split('|').map((p) => ({ agentId: p.split(':')[0] }));
}

export function repeatedLabels(historyRows, minCount = 2) {
  const groups = new Map();
  for (const r of historyRows) {
    if (!r.label || r.label === '-') continue;
    if (!groups.has(r.label)) groups.set(r.label, []);
    groups.get(r.label).push(r);
  }
  return [...groups]
    .filter(([, rows]) => rows.length >= minCount)
    .map(([label, rows]) => {
      const dates = rows.map((r) => r.date).sort();
      return { label, count: rows.length, first: dates[0], last: dates.at(-1), examples: rows.slice(0, 2).map((r) => r.message) };
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

const EFFORTS = ['low', 'medium', 'high', 'xhigh'];

// 괄호 안 쉼표로 이름이 쪼개지지 않게 괄호 깊이가 0일 때만 나눈다.
function splitOutsideParens(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(' || ch === '（') depth++;
    else if ((ch === ')' || ch === '）') && depth > 0) depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

// 사용 기록의 일 종류는 괄호 부연을 뺀 이름이라, 표 칸의 이름도 괄호를 모두 걷어 같은 꼴로 만든다.
// 「」는 이름의 일부일 수 있어(「무조건 Opus」) 내려 보기 시험과 고정 표시의 낫표만 지운다.
// 「(고정)」이 붙은 이름은 pinned에도 담는다. 원칙 때문에 high에 둔 칸이라 내려 보기 후보에서 빠진다.
// 시험 표시는 그 이름 바로 뒤에 붙으므로 어느 일의 시험인지 trials에 이름과 정의를 짝지어 담는다.
// 시험 표시도 낫표를 빼고 적을 수 있다. 정의 이름이 백틱으로 든 (시험: …)만 시험 표시로 받아, 일반 괄호 부연과 섞이지 않는다.
const TRIAL_MARK = /「\(시험:[^)]*\)」|\(시험:[^)]*`[^`)]+`[^)]*\)/g;
const plainKindName = (text) => text.replace(/\([^()]*(\([^()]*\)[^()]*)*\)/g, '').replace(/\s+/g, ' ').trim();
// 사람이 말한 일 이름을 표 칸의 이름과 기록의 일 종류가 쓰는 꼴(표시와 괄호 부연이 없는 이름)로 만든다.
export const kindNameOf = (text) => plainKindName(String(text).replace(TRIAL_MARK, '').replace(FLOOR_MARK, '').replace(PIN_MARK, ''));
function cellKinds(cell) {
  const items = splitOutsideParens(cell);
  const kinds = [];
  const pinned = [];
  const trials = [];
  const floors = [];
  for (const item of items) {
    const marks = item.match(TRIAL_MARK) ?? [];
    const floorDefs = [...item.matchAll(FLOOR_MARK)].map((m) => m[1] ?? m[2]);
    const bare = item.replace(TRIAL_MARK, '').replace(FLOOR_MARK, '');
    const unpinned = bare.replace(PIN_MARK, '');
    const name = plainKindName(unpinned);
    if (!name) continue;
    kinds.push(name);
    if (unpinned !== bare) pinned.push(name);
    for (const m of marks) {
      const def = m.match(/`([^`]+)`/)?.[1];
      if (def) trials.push({ kind: name, def });
    }
    if (floorDefs.length) floors.push({ kind: name, def: floorDefs.at(-1) });
  }
  return { kinds, pinned, trials, floors };
}

const tableCells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

// GUIDE의 모델 x effort 표를 읽는다. 못 읽으면 problems에 까닭을 담아 돌려주고 호출한 쪽이 그대로 보인다.
export function parseRoutingTable(text) {
  const lines = splitLines(text);
  const headIdx = lines.findIndex((l) => {
    const c = tableCells(l);
    return l.trim().startsWith('|') && EFFORTS.every((e) => c.includes(e));
  });
  if (headIdx < 0) return { cells: [], problems: ['effort 머리줄(low, medium, high, xhigh)이 있는 표를 찾지 못했습니다'] };

  const head = tableCells(lines[headIdx]);
  const efforts = head.slice(1);
  const problems = [];
  if (efforts.join() !== EFFORTS.join()) problems.push(`effort 열 순서가 ${EFFORTS.join(', ')}가 아닙니다: ${efforts.join(', ')}`);
  const cells = [];
  for (let i = headIdx + 2; i < lines.length && lines[i].trim().startsWith('|'); i++) {
    const c = tableCells(lines[i]);
    const model = c[0].replace(/\*/g, '').trim().toLowerCase();
    if (c.length !== head.length) {
      problems.push(`${i + 1}번째 줄(${model || '모델 이름 없음'})의 칸 수가 ${c.length}개로 머리줄의 ${head.length}개와 다릅니다`);
      continue;
    }
    efforts.forEach((effort, k) => cells.push({ model, effort, ...cellKinds(c[k + 1]) }));
  }
  if (!cells.length) problems.push('모델 줄이 없습니다');
  else if (!cells.some((x) => x.kinds.length)) problems.push('일 이름이 하나도 없습니다');
  return { cells, problems };
}

// 정의 파일의 frontmatter description. 없으면 빈 문자열.
export function descriptionOf(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return '';
  const lines = m[1].split(/\r?\n/);
  const i = lines.findIndex((l) => l.startsWith('description:'));
  if (i < 0) return '';
  let value = lines[i].slice('description:'.length).trim();
  if (value === '' || /^[>|][+-]?$/.test(value)) {
    const folded = [];
    for (let k = i + 1; k < lines.length && /^\s/.test(lines[k]); k++) folded.push(lines[k].trim());
    value = folded.join(' ');
  }
  return value.replace(/^(["'])(.*)\1$/, '$2').trim();
}

// 정의 description은 「일반 성격 한 문장. 일 이름을 쉼표로 나열. (가이드 경로)」 꼴이다.
// 첫 문장은 괄호 밖의 「. 」까지이고, 그 뒤 나열을 표 칸과 같은 규칙으로 나눈다.
// 첫 문장 끝을 못 찾으면 나열이 있는지 없는지 가릴 수 없으므로 split을 false로 돌려주고 호출한 쪽이 문자열 포함만 본다.
export function descriptionKinds(description) {
  const body = description.replace(/\s*\(`[^`]*`\)\s*$/, '').replace(/\.\s*$/, '');
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '(' || ch === '（') depth++;
    else if ((ch === ')' || ch === '）') && depth > 0) depth--;
    else if (ch === '.' && depth === 0 && /\s/.test(body[i + 1] ?? '')) return { kinds: cellKinds(body.slice(i + 1)).kinds, split: true };
  }
  return { kinds: [], split: false };
}

const addTo = (map, key, value) => map.set(key, (map.get(key) ?? new Set()).add(value));

// 표와 실제 배정이 어긋난 곳을 네 가지로 모은다.
// usage는 사용 기록 줄(없으면 null), descriptions는 정의 이름마다 description(정의 파일이 없으면 null).
// removedDefs는 회고가 일부러 지운 정의 이름이라 정의 파일이 없어도 문제로 보지 않는다.
// 다만 표의 칸에 일이 남아 있으면 메인이 없는 정의로 일을 보내게 되므로 removedConflicts로 따로 모은다.
export function checkRouting({ cells, usage, descriptions, removedDefs = [] }) {
  const removed = new Set(removedDefs);
  const owners = new Map();
  const trials = new Map();
  const wanted = new Map();
  for (const c of cells) {
    const def = `${c.model}-${c.effort}`;
    for (const kind of c.kinds) addTo(owners, kind, def);
    for (const t of c.trials ?? []) addTo(trials, t.kind, t.def);
    if (c.kinds.length) wanted.set(def, c.kinds);
  }

  const groups = new Map();
  for (const r of usage ?? []) {
    const own = owners.get(r.kind);
    if (!own || own.has(r.def) || r.result === '올림' || ESCALATION_ONLY_DEFS.has(r.def) || trials.get(r.kind)?.has(r.def)) continue;
    const key = `${r.kind}\u0000${r.def}`;
    const g = groups.get(key) ?? { kind: r.kind, def: r.def, expected: [...own], count: 0, last: '' };
    g.count++;
    if (r.date > g.last) g.last = r.date;
    groups.set(key, g);
  }
  const mismatched = [...groups.values()].sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind) || a.def.localeCompare(b.def));

  const descriptionDiffs = [];
  const missingDefs = [];
  const loose = [];
  const removedConflicts = [];
  for (const [def, kinds] of wanted) {
    if (removed.has(def)) {
      removedConflicts.push({ def, kinds });
      continue;
    }
    const desc = descriptions.get(def);
    if (desc === null || desc === undefined) {
      missingDefs.push({ def, kinds });
      continue;
    }
    if (ESCALATION_ONLY_DEFS.has(def)) continue;
    const { kinds: listed, split } = descriptionKinds(desc);
    const missing = split ? kinds.filter((k) => !listed.includes(k)) : kinds.filter((k) => !desc.includes(k));
    const extra = split ? listed.filter((k) => !kinds.includes(k)) : [];
    if (missing.length || extra.length) descriptionDiffs.push({ def, missing, extra });
    else if (!split) loose.push(def);
  }
  return { mismatched, descriptionDiffs, missingDefs, removedConflicts, loose };
}

export const tableKindSet = (cells) => new Set(cells.flatMap((c) => c.kinds));

// 「(고정)」이 붙은 칸을 downCandidates가 쓰는 cellKey(정의와 일 종류) 집합으로 돌려준다.
export const pinnedCellSet = (cells) => new Set(cells.flatMap((c) => c.pinned.map((kind) => cellKey({ def: `${c.model}-${c.effort}`, kind }))));

// 일 종류마다 최저선 정의.
export const floorMap = (cells) => new Map(cells.flatMap((c) => (c.floors ?? []).map((f) => [f.kind, f.def])));

// 표의 시험 표시마다 원래 칸의 정의(cellDef)와 시험할 정의(def)를 짝짓는다.
export const tableTrials = (cells) => cells.flatMap((c) => (c.trials ?? []).map((t) => ({ kind: t.kind, cellDef: `${c.model}-${c.effort}`, def: t.def })));

// 회고 표시 줄에 남기는 표 모양. 회고마다 남긴 모양을 이어 보면 칸이 언제 어느 정의로 옮겨졌는지, 어떤 시험이 걸려 있었는지,
// 최저선이 언제 바뀌었는지 알 수 있어 내림 실패를 기록만으로 다시 셀 수 있다.
export function tableSnapshot(cells) {
  const 칸 = [];
  for (const c of cells) for (const k of c.kinds) 칸.push([`${c.model}-${c.effort}`, k]);
  return JSON.stringify({ 칸, 시험: tableTrials(cells).map((t) => [t.kind, t.def]), 최저: [...floorMap(cells)] });
}

// 깨졌거나 없으면 null이다. 표 모양이 없는 회고 표시(옛 표시, 표를 못 읽은 회고)는 이동 기록이 없는 것으로 본다.
export function parseSnapshot(text) {
  if (!text || text === '-') return null;
  try {
    const o = JSON.parse(text);
    if (!o || !Array.isArray(o.칸)) return null;
    const cells = new Map();
    for (const [def, kind] of o.칸) if (typeof def === 'string' && typeof kind === 'string' && !cells.has(kind)) cells.set(kind, def);
    const pairs = (v) => (Array.isArray(v) ? v.filter((x) => Array.isArray(x) && typeof x[0] === 'string' && typeof x[1] === 'string') : []);
    const trials = pairs(o.시험).map(([kind, def]) => ({ kind, cellDef: cells.get(kind) ?? null, def }));
    return { cells, trials, floors: new Map(pairs(o.최저)) };
  } catch {
    return null;
  }
}

// 표의 시험 표시 하나를 그 구간 기록(rows)으로 판정한다. 대기는 그 정의와 일 종류 기록이 없음, 보냄은 있음이다.
// 시험한 1건이 ok이고 정정이 없을 때 어림 비용을 원래 칸의 그 구간 평균과 견준다. COST_SIMILAR_RATIO 넘게 낮으면 통과, 넘게 높으면 실패다.
// 그 안이면 비용이 비슷한 것이라 걸린 시간(사용 기록의 초 열)이 원래 칸 평균보다 짧으면 통과, 아니면 실패다. 결과가 같고 비용이 비슷하면 빠른 쪽이 낫기 때문이다.
// 올림이나 정정이 있으면 결과가 모자란 것이라 실패이고 내림 실패로 센다(downFail). 비용 쪽과 속도 쪽 실패는 결과가 모자란 것이 아니라 세지 않는다.
// 재지시는 지시문 탓이라 내림 실패로 보지 않고 지시문을 고쳐 다시 시험하므로 판정 불가다. 비용이나 (비용이 비슷할 때) 시간을 모르면 비교할 수 없어 판정 불가다.
export function trialVerdict(trial, rows, costMap = new Map(), correctionsByAgent = new Map()) {
  const sent = rows.filter((r) => r.def === trial.def && r.kind === trial.kind);
  if (!sent.length) return { ...trial, state: '대기', verdict: null, downFail: false, sentAgents: 0 };
  const agentId = sent[0].agentId;
  const lines = agentId ? sent.filter((r) => r.agentId === agentId) : [sent[0]];
  const sentAgents = new Set(sent.map((r) => r.agentId ?? `줄${r.line}`)).size;
  const base = { ...trial, state: '보냄', agentId, sentAgents, downFail: false };
  if (lines.some((r) => r.result === '올림') || (agentId && (correctionsByAgent.get(agentId) ?? 0) > 0)) return { ...base, verdict: '실패', downFail: true, reason: '올림 또는 정정' };
  if (lines.some((r) => r.result === '재지시')) return { ...base, verdict: '판정 불가', reason: '재지시(지시문 탓)' };
  const cost = agentId ? costMap.get(agentId)?.cost ?? null : null;
  const baseline = trial.cellDef ? summarize(rows.filter((r) => r.def === trial.cellDef && r.kind === trial.kind), costMap, new Map()).total.costAvg : null;
  if (cost === null) return { ...base, verdict: '판정 불가', reason: '시험 1건의 비용 모름', cost, baseline };
  if (baseline === null) return { ...base, verdict: '판정 불가', reason: '원래 칸의 회고 구간 비용 없음', cost, baseline };
  const priced = { ...base, cost, baseline };
  if (cost < baseline * (1 - COST_SIMILAR_RATIO)) return { ...priced, verdict: '통과' };
  if (cost > baseline * (1 + COST_SIMILAR_RATIO)) return { ...priced, verdict: '실패', reason: '비용이 줄지 않음' };
  const known = (list) => list.map((r) => r.seconds).filter((x) => x !== null);
  const trialSecs = known(lines);
  const baseSecs = known(rows.filter((r) => r.def === trial.cellDef && r.kind === trial.kind));
  const seconds = trialSecs.length ? trialSecs.reduce((a, b) => a + b, 0) : null;
  const baselineSeconds = baseSecs.length ? baseSecs.reduce((a, b) => a + b, 0) / baseSecs.length : null;
  const timed = { ...priced, seconds, baselineSeconds };
  if (seconds === null) return { ...timed, verdict: '판정 불가', reason: '비용 비슷, 시험 1건의 걸린 시간 모름' };
  if (baselineSeconds === null) return { ...timed, verdict: '판정 불가', reason: '비용 비슷, 원래 칸의 회고 구간 시간 없음' };
  return seconds < baselineSeconds ? { ...timed, verdict: '통과', reason: '비용 비슷, 더 빠름' } : { ...timed, verdict: '실패', reason: '비용 비슷, 빠르지 않음' };
}

// 표 모양에 이어 남은 시험 표시마다 판정 불가가 몇 번 이어졌는지 센다. 열쇠는 `일 종류\u0000시험 정의`이고 마지막 표 모양에 남은 시험만 담는다.
// 대기는 보내지 않은 것이라 횟수를 바꾸지 않고, 통과나 실패가 나거나 표시가 지워지면 0이다. 표 모양이 없는 회고 표시를 만나면 앞뒤를 못 이어 0부터 다시 센다(옛 기록은 0번).
export function undecidedRuns(parsed, costMap = new Map(), correctionsByAgent = new Map()) {
  let runs = new Map();
  let prev = null;
  let prevCutoff = 0;
  for (const r of parsed.retros ?? []) {
    const snap = r.snapshot;
    const next = new Map();
    if (snap && prev) {
      const rows = parsed.all.filter((x) => x.line > prevCutoff && x.line <= r.cutoff);
      for (const t of prev.trials) {
        const key = undecidedKey(t);
        const v = trialVerdict(t, rows, costMap, correctionsByAgent);
        const n = v.verdict === '판정 불가' ? (runs.get(key) ?? 0) + 1 : v.state === '대기' ? runs.get(key) ?? 0 : 0;
        if (n && snap.trials.some((x) => x.kind === t.kind && x.def === t.def)) next.set(key, n);
      }
    }
    runs = next;
    prev = snap;
    prevCutoff = r.cutoff;
  }
  return runs;
}
export const undecidedKey = (t) => `${t.kind}\u0000${t.def}`;

// 일 종류마다 내림 실패를 회고 표시의 표 모양으로 다시 센다. 앞 표 모양과 다음 표 모양 사이의 기록이 한 구간이다.
// 내림 실패는 앞 모양에 걸린 시험이 그 구간에서 실패(downFail)한 것과, 내린 칸(lowered)이 다음 모양에서 다시 위 정의로 올라간 것이다.
// 최저선이 달리거나 바뀌거나 떼이면 그 구간까지 센 횟수를 0으로 돌린다. 사용자가 그 칸의 바닥을 새로 정한 것이라, 그 뒤의 실패만으로 다음 제안을 판단한다.
// 표 모양이 없는 회고 표시를 만나면 앞뒤를 비교할 수 없어 사슬이 끊기고, 다음 모양부터 다시 비교한다(그동안의 횟수는 남는다).
// 최저선 아래로 보낸 다시 시험은 최저선 위의 실패가 아니라 세지 않는다. floorSince는 지금 최저선으로 세기 시작한 기록 끝(줄 번호)이고, 올리기 후보 비율의 분모를 고를 때 쓴다.
export function downFailHistory(parsed, costMap = new Map(), correctionsByAgent = new Map()) {
  const state = new Map();
  const get = (kind) => {
    if (!state.has(kind)) state.set(kind, { kind, count: 0, failedDefs: [], lowered: false, events: [] });
    return state.get(kind);
  };
  let prev = null;
  let prevCutoff = 0;
  for (const r of parsed.retros ?? []) {
    const snap = r.snapshot;
    if (prev && snap) {
      const date = /^\d{4}-\d{2}-\d{2}/.test(r.at) ? r.at.slice(0, 10) : '';
      const rows = parsed.all.filter((x) => x.line > prevCutoff && x.line <= r.cutoff);
      for (const t of prev.trials) {
        if (isRetrial(t.kind, t.def, prev.floors)) continue;
        if (!trialVerdict(t, rows, costMap, correctionsByAgent).downFail) continue;
        const s = get(t.kind);
        s.count++;
        s.failedDefs.push(t.def);
        s.events.push({ date, type: '시험 실패', def: t.def });
      }
      for (const [kind, def] of snap.cells) {
        const before = prev.cells.get(kind);
        if (!before || before === def || defRank(before) === null || defRank(def) === null) continue;
        const s = get(kind);
        if (defRank(def) < defRank(before)) {
          s.lowered = true;
          s.events.push({ date, type: '내림', def });
        } else if (s.lowered) {
          s.count++;
          s.failedDefs.push(before);
          s.lowered = false;
          s.events.push({ date, type: '내린 뒤 올림', def: before });
        }
      }
      // 최저선은 그 회고의 칸 이동을 보고 단 것이라, 같은 구간의 실패까지 센 뒤에 0으로 돌린다.
      const kinds = new Set([...prev.floors.keys(), ...snap.floors.keys()]);
      for (const kind of kinds) {
        if (prev.floors.get(kind) === snap.floors.get(kind)) continue;
        const s = get(kind);
        Object.assign(s, { count: 0, failedDefs: [], lowered: false, floorSince: snap.floors.has(kind) ? r.cutoff : undefined });
        s.events.push({ date, type: '최저선 바뀜', def: snap.floors.get(kind) ?? null });
      }
    }
    if (snap) {
      for (const kind of snap.floors.keys()) {
        const s = get(kind);
        if (s.floorSince === undefined) s.floorSince = r.cutoff;
      }
    }
    prev = snap;
    prevCutoff = r.cutoff;
  }
  return state;
}

// 최저선 아래 정의로 보낸 시험(다시 시험)인지. 최저선을 막 단 칸의 내려 보기 후보는 최저선 아래로 나오지 않으므로, 최저선 아래를 가리키는 시험 표시는 다시 시험뿐이다.
export function isRetrial(kind, def, floors = new Map()) {
  const floor = floors.get(kind);
  return Boolean(floor) && defRank(floor) !== null && defRank(def) !== null && defRank(def) < defRank(floor);
}

const highestDef = (defs) => defs.filter((d) => defRank(d) !== null).sort((a, b) => defRank(b) - defRank(a))[0];

// 이번 회고에서 생길 내림 실패를 더해 최저선을 처음 다는 제안을 만든다. 이번 회고의 내림 실패는 시험 실패(trialVerdicts의 downFail)와,
// 내린 칸(history의 lowered)이 올리기 후보가 된 것이다. 합이 DOWN_FAIL_LIMIT 이상이면 실패한 정의 가운데 가장 높은 것의 바로 위 칸을 최저선으로 제안한다.
// 최저선이 이미 있는 칸은 aboveFloor에 그 뒤(최저선 위)의 내림 실패 수를 담고, 이번 회고에 새 실패가 있으며 DOWN_FAIL_LIMIT번 이상이면서
// 최저선을 단 뒤 그 일 기록의 UP_MIN_RATIO 이상일 때만 올리기 후보(raise)로 찍는다. 건수만 보고 올리면 어려운 일이 섞인 칸은
// 바닥이 계속 올라가 결국 모든 일이 Opus로 돌 수 있어서, 칸 기록이 많은데 실패가 몇 건뿐이면 올리지 않는다.
// 분모는 all에서 그 일 종류의 floorSince 뒤 기록이고, floorSince를 모르면(최저선이 아직 표 모양에 없음) 이번 회고 구간(target)이다.
export function floorProposals({ history = new Map(), trialVerdicts = [], upCands = [], floors = new Map(), cellOf = new Map(), all = [], target = [] }) {
  const fresh = new Map();
  const add = (kind, def, why) => {
    const f = fresh.get(kind) ?? { defs: [], why: [] };
    f.defs.push(def);
    f.why.push(why);
    fresh.set(kind, f);
  };
  for (const v of trialVerdicts) if (v.downFail && !isRetrial(v.kind, v.def, floors)) add(v.kind, v.def, `${v.def} 시험 실패`);
  for (const c of upCands) if (history.get(c.kind)?.lowered) add(c.kind, c.def, `${c.def} 정의로 내린 뒤 올리기 후보`);
  const proposals = [];
  const aboveFloor = [];
  const raise = [];
  for (const kind of new Set([...fresh.keys(), ...floors.keys()])) {
    const f = fresh.get(kind) ?? { defs: [], why: [] };
    const h = history.get(kind) ?? { count: 0, failedDefs: [] };
    const count = h.count + f.defs.length;
    const base = { kind, cellDef: cellOf.get(kind) ?? null, count, before: h.count, why: f.why };
    if (floors.has(kind)) {
      if (!count) continue;
      const current = floors.get(kind);
      const total = (h.floorSince === undefined ? target : all.filter((r) => r.line > h.floorSince)).filter((r) => r.kind === kind).length;
      const item = { ...base, current, total, ratio: total ? count / total : 0 };
      aboveFloor.push(item);
      if (!f.defs.length || count < DOWN_FAIL_LIMIT || item.ratio < UP_MIN_RATIO) continue;
      const top = highestDef([...h.failedDefs, ...f.defs, current]);
      const floor = top ? upperDef(top) : null;
      if (floor) raise.push({ ...item, floor });
      continue;
    }
    if (count < DOWN_FAIL_LIMIT) continue;
    const top = highestDef([...h.failedDefs, ...f.defs]);
    const floor = top ? upperDef(top) : null;
    if (floor) proposals.push({ ...base, floor });
  }
  const byKind = (a, b) => a.kind.localeCompare(b.kind);
  return { proposals: proposals.sort(byKind), aboveFloor: aboveFloor.sort(byKind), raise: raise.sort(byKind) };
}

// 회고 구간 기록(rows)에서 일 종류마다 실패와 성공을 에이전트 단위로 나눠 섞인 칸을 찾는다. 같은 일이라도 쉬운 건과 어려운 건이 섞여
// 성공과 실패가 함께 쌓이는 칸은, 회고가 두 묶음의 지시문을 비교해 맡기기 전에 볼 수 있는 기준으로 쪼갤 수 있는지 본다.
// 실패는 올림이 있거나 정정이 붙은 에이전트다(시험과 내린 칸의 실패도 올림이나 정정이라 여기 들어간다). 성공은 모든 줄이 ok이고 정정이 없는 에이전트다.
// 재지시가 섞인 에이전트는 지시문 탓이라 어느 쪽에도 넣지 않는다. 표의 칸(cellOf)보다 위 정의의 성공은 아래에서 올림을 받고 다시 보낸 건일 수 있어 성공에서 뺀다.
export function mixedCells(rows, correctionsByAgent = new Map(), cellOf = new Map()) {
  const groups = new Map();
  for (const r of rows) {
    const g = groups.get(r.kind) ?? new Map();
    const unit = r.agentId ?? `줄${r.line}`;
    const a = g.get(unit) ?? { agentId: r.agentId, def: r.def, results: [] };
    a.results.push(r.result);
    g.set(unit, a);
    groups.set(r.kind, g);
  }
  const out = [];
  for (const [kind, agents] of groups) {
    const cellDef = cellOf.get(kind) ?? null;
    const fails = [];
    const oks = [];
    for (const a of agents.values()) {
      const corrected = a.agentId && (correctionsByAgent.get(a.agentId) ?? 0) > 0;
      if (a.results.includes('올림') || corrected) fails.push({ agentId: a.agentId, def: a.def });
      else if (a.results.every((x) => x === 'ok') && !(cellDef && defRank(cellDef) !== null && defRank(a.def) !== null && defRank(a.def) > defRank(cellDef))) oks.push({ agentId: a.agentId, def: a.def });
    }
    if (fails.length >= MIXED_MIN_FAILS && oks.length >= MIXED_MIN_OKS) out.push({ kind, cellDef, fails, oks });
  }
  return out.sort((a, b) => b.fails.length - a.fails.length || a.kind.localeCompare(b.kind));
}

// 최저선이 있는 일 종류마다 다시 시험 간격을 회고 표시의 표 모양으로 다시 센다. anchor는 간격을 세기 시작한 회고 표시의 순번(parsed.retros의 인덱스)이다.
// 최저선이 처음 보이거나 바뀐 회고에서 간격을 RETRIAL_START로 두고, 앞 모양에 걸린 다시 시험이 그 구간에서 실패하면 두 배로, 통과하면 처음으로 돌린다.
// 대기와 판정 불가는 표시가 남아 다음 회고에서 다시 보므로 간격을 바꾸지 않는다. 기록 형식은 따로 늘리지 않고 표 모양의 시험과 최저선으로 가린다.
export function retrialHistory(parsed, costMap = new Map(), correctionsByAgent = new Map()) {
  const state = new Map();
  let prev = null;
  let prevCutoff = 0;
  (parsed.retros ?? []).forEach((r, i) => {
    const snap = r.snapshot;
    if (snap) {
      if (prev) {
        const date = /^\d{4}-\d{2}-\d{2}/.test(r.at) ? r.at.slice(0, 10) : '';
        const rows = parsed.all.filter((x) => x.line > prevCutoff && x.line <= r.cutoff);
        for (const t of prev.trials) {
          const s = state.get(t.kind);
          if (!s || !isRetrial(t.kind, t.def, prev.floors)) continue;
          const v = trialVerdict(t, rows, costMap, correctionsByAgent);
          if (v.verdict === '판정 불가') {
            s.undecided = (s.undecided ?? 0) + 1;
            if (s.undecided < UNDECIDED_LIMIT) continue;
            Object.assign(s, { interval: s.interval * 2, anchor: i, undecided: 0, last: { date, def: t.def, verdict: `판정 불가 ${UNDECIDED_LIMIT}번`, agentId: v.agentId } });
            continue;
          }
          if (v.verdict !== '실패' && v.verdict !== '통과') continue;
          Object.assign(s, { interval: v.verdict === '실패' ? s.interval * 2 : RETRIAL_START, anchor: i, undecided: 0, last: { date, def: t.def, verdict: v.verdict, agentId: v.agentId } });
        }
      }
      for (const [kind, floor] of snap.floors) {
        const s = state.get(kind);
        if (!s || s.floor !== floor) state.set(kind, { kind, floor, interval: RETRIAL_START, anchor: i, undecided: 0, last: s?.last ?? null });
      }
      for (const kind of [...state.keys()]) if (!snap.floors.has(kind)) state.delete(kind);
    }
    prev = snap;
    prevCutoff = r.cutoff;
  });
  return state;
}

// 그 정의로 마지막에 돈 모델 ID. 비용 기록에서 날짜가 가장 늦은 줄이고, 모델을 모르면 없는 것으로 본다.
const latestModel = (costMap, def) => {
  let best = null;
  for (const c of costMap.values()) {
    if (c.def !== def || !c.model || c.model === '?') continue;
    if (!best || (c.date ?? '') >= best.date) best = { date: c.date ?? '', model: c.model };
  }
  return best?.model ?? null;
};

// 이번 회고의 다시 시험 제안을 정한다. states는 retrialHistory, retroCount는 지금까지의 회고 표시 수(이번 회고가 남길 표시의 순번),
// verdicts는 지금 표의 시험 표시를 이번 회고 구간으로 판정한 것이다. 지금 표에 걸린 다시 시험이 통과하면 최저선을 한 칸 내리자고(lowerFloor) 하고 간격을 처음으로,
// 실패하면 간격을 두 배로 한다. 때가 된 칸(남은 회고 0)과, 최저선 아래 정의의 마지막 실패 때 모델과 지금 모델이 다른 칸이 후보이고,
// 한 회고에 한 칸만 제안한다. 모델이 바뀐 칸을 먼저, 그다음 그 일의 기록이 많은 칸을 고른다. 다시 시험이 걸려 있거나 더 내릴 곳이 없거나 「(고정)」인 칸은 제안하지 않는다.
export function retrialPlan({ states = new Map(), retroCount = 0, floors = new Map(), cellOf = new Map(), pinned = new Set(), verdicts = [], all = [], costMap = new Map(), correctionsByAgent = new Map() }) {
  const pending = new Map(verdicts.filter((v) => isRetrial(v.kind, v.def, floors)).map((v) => [v.kind, v]));
  const corrected = (id) => id && (correctionsByAgent.get(id) ?? 0) > 0;
  const lowerFloor = [];
  const waits = [];
  const candidates = [];
  for (const [kind, floor] of floors) {
    const below = lowerDef(floor);
    const cellDef = cellOf.get(kind) ?? null;
    const known = states.get(kind);
    const s = known && known.floor === floor ? { ...known } : { kind, floor, interval: RETRIAL_START, anchor: retroCount, last: null };
    const v = pending.get(kind);
    if (v?.verdict === '통과' || v?.verdict === '실패') {
      Object.assign(s, { interval: v.verdict === '실패' ? s.interval * 2 : RETRIAL_START, anchor: retroCount, last: { date: '이번 회고', def: v.def, verdict: v.verdict, agentId: v.agentId } });
      if (v.verdict === '통과') lowerFloor.push({ kind, cellDef, floor, to: v.def, agentId: v.agentId });
    } else if (v?.verdict === '판정 불가' && (s.undecided ?? 0) + 1 >= UNDECIDED_LIMIT) {
      Object.assign(s, { interval: s.interval * 2, anchor: retroCount, last: { date: '이번 회고', def: v.def, verdict: `판정 불가 ${UNDECIDED_LIMIT}번`, agentId: v.agentId } });
    }
    const remaining = Math.max(0, s.interval - (retroCount - s.anchor));
    let modelChange = null;
    if (below) {
      const lastFail = all.findLast((r) => r.def === below && r.kind === kind && (r.result === '올림' || corrected(r.agentId)));
      const from = lastFail?.agentId ? costMap.get(lastFail.agentId)?.model : null;
      const to = latestModel(costMap, below);
      if (from && from !== '?' && to && baseModel(from) !== baseModel(to)) modelChange = { from, to };
    }
    const item = { kind, cellDef, floor, def: below, interval: s.interval, remaining, last: s.last, pending: v ?? null, modelChange, records: all.filter((r) => r.kind === kind).length };
    waits.push(item);
    if (!below || v || (cellDef && pinned.has(cellKey({ def: cellDef, kind })))) continue;
    if (remaining === 0 || modelChange) candidates.push(item);
  }
  candidates.sort((a, b) => Number(Boolean(b.modelChange)) - Number(Boolean(a.modelChange)) || b.records - a.records || a.kind.localeCompare(b.kind));
  const byKind = (a, b) => a.kind.localeCompare(b.kind);
  return { proposal: candidates[0] ?? null, deferred: candidates.slice(1), waits: waits.sort(byKind), lowerFloor: lowerFloor.sort(byKind) };
}

// 표에 없는 일 종류를 일 이름별로 묶는다. summarize 행(정의, 일 종류별)을 받아 이름 하나로 합친다.
export function unknownKindGroups(summaryRows, known) {
  const groups = new Map();
  for (const r of summaryRows) {
    if (known.has(r.kind)) continue;
    let g = groups.get(r.kind);
    if (!g) {
      g = { kind: r.kind, count: 0, ok: 0, redo: 0, up: 0, corrections: 0, costSum: 0, paired: 0, costKnown: 0, costUnknown: 0, defs: new Map() };
      groups.set(r.kind, g);
    }
    for (const key of ['count', 'ok', 'redo', 'up', 'corrections', 'costSum', 'paired', 'costKnown', 'costUnknown']) g[key] += r[key];
    g.defs.set(r.def, (g.defs.get(r.def) ?? 0) + r.count);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
}

// 기록 전체에서 표에 없는 이름과 건수, 마지막 날짜(메인이 이미 쓴 이름을 다시 쓰려고 본다).
export function unknownKindNames(all, known) {
  const names = new Map();
  for (const r of all) {
    if (known.has(r.kind)) continue;
    const n = names.get(r.kind) ?? { kind: r.kind, count: 0, last: '' };
    n.count++;
    if (r.date > n.last) n.last = r.date;
    names.set(r.kind, n);
  }
  return [...names.values()].sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
}

export const USAGE_RESULTS = ['ok', '재지시', '올림'];
const LOG_KEYS = ['def', 'kind', 'result', 'memo', 'tokens', 'tools', 'secs', 'project', 'date'];
const LOG_REQUIRED = ['project', 'def', 'kind', 'result', 'memo'];
const LOG_NUMBERS = ['tokens', 'tools', 'secs'];
// 탭과 줄바꿈은 열과 줄 경계라 값 안에 있으면 기록이 깨지므로 공백으로 바꾼다.
const flatCell = (v) => v.replace(/[\t\r\n]/g, ' ').trim();
const isAbsolutePath = (p) => p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\');

// `--log`의 이름 붙은 인자로 사용 기록 한 줄(9열)을 만든다. 열 순서는 날짜, 프로젝트, 정의, 일 종류, 토큰, 도구 호출, 걸린 초, 결과, 메모다.
// 프로젝트를 생략할 수 없는 까닭: 열의 값은 세션을 시작한 폴더인데, 이 스크립트가 아는 cwd는 세션 중 cd로 바뀌어 있을 수 있어
// 생략값으로 쓰면 다른 프로젝트로 조용히 갈린다. 시작 폴더를 아는 메인이 넘기면 워크트리 꼬리는 여기서 뗀다.
export function usageLineFromArgs(argv, now = new Date()) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--log') continue;
    const key = arg.startsWith('--') ? arg.slice(2) : null;
    if (!LOG_KEYS.includes(key)) return { error: `알 수 없는 인자입니다: ${arg}(값에 공백이 있으면 큰따옴표로 감싸야 합니다)` };
    const value = argv[++i];
    if (value === undefined || (value.startsWith('--') && LOG_KEYS.includes(value.slice(2)))) return { error: `--${key}에 값이 없습니다` };
    if (key in opts) return { error: `--${key}를 두 번 줬습니다` };
    opts[key] = flatCell(value);
  }
  for (const key of LOG_REQUIRED) if (!opts[key]) return { error: `--${key}가 필요합니다` };
  if (!USAGE_RESULTS.includes(opts.result)) return { error: `--result는 ${USAGE_RESULTS.join(', ')} 중 하나여야 합니다: ${opts.result}` };
  if (!isAbsolutePath(opts.project)) return { error: `--project는 세션을 시작한 폴더의 절대 경로여야 합니다: ${opts.project}` };
  if (opts.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(opts.date)) return { error: `--date는 YYYY-MM-DD 꼴이어야 합니다: ${opts.date}` };
  for (const key of LOG_NUMBERS) {
    if (opts[key] !== undefined && opts[key] !== '-' && !/^\d+(\.\d+)?$/.test(opts[key])) return { error: `--${key}는 숫자 또는 -여야 합니다: ${opts[key]}` };
  }
  const line = [opts.date ?? localDate(now), projectRoot(opts.project), opts.def, opts.kind, opts.tokens ?? '-', opts.tools ?? '-', opts.secs ?? '-', opts.result, opts.memo].join('\t');
  return { line };
}

// 회고 방식. ask는 회고할 때가 되면 사용자에게 묻고, auto는 회고할지 묻지 않고 백그라운드 회고를 띄운다.
export const RETRO_MODES = ['ask', 'auto'];
const DEFAULT_COMMAND_NAME = 'retro';
// 설치 때 이 이름으로 폴더와 파일을 만들므로 경로 구분자와 점이 들어가지 않는 이름만 받는다.
const COMMAND_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

function parseConfigObject(text) {
  try {
    const o = JSON.parse(text);
    return o && typeof o === 'object' && !Array.isArray(o) ? o : null;
  } catch {
    return null;
  }
}

// 자동 회고가 이 횟수만큼 이어 실패하면 묻기로 돌아간다. 권한 확인 창을 거부하거나 권한 모드가 쓰기를 막아 실패하는 경우 매번 같은 실패를 되풀이하지 않게 하려는 것이다.
export const RETRO_FAIL_LIMIT = 2; // 출력 문구의 「두 번」과 함께 바꾼다.

// 파일이 없거나 JSON이 깨졌거나 값이 모르는 것이면 ask로 본다. 회고를 멋대로 자동으로 돌리지 않으려는 것이다.
export function parseConfig(text) {
  const o = text ? parseConfigObject(text) : null;
  return {
    retroMode: RETRO_MODES.includes(o?.retroMode) ? o.retroMode : 'ask',
    commandName: typeof o?.commandName === 'string' && COMMAND_NAME.test(o.commandName) ? o.commandName : DEFAULT_COMMAND_NAME,
    retroFailures: Number.isInteger(o?.retroFailures) && o.retroFailures > 0 ? o.retroFailures : 0,
    removedDefs: Array.isArray(o?.removedDefs) ? o.removedDefs.filter((d) => typeof d === 'string') : [],
    removedKinds: Array.isArray(o?.removedKinds) ? o.removedKinds.filter((d) => typeof d === 'string') : [],
    claudeMdKeptLines: Number.isInteger(o?.claudeMdKeptLines) && o.claudeMdKeptLines >= 0 ? o.claudeMdKeptLines : null,
  };
}

// CLAUDE.md 정리 제안의 기준 줄 수와, 정리 뒤 남긴 줄 수보다 이만큼 넘게 늘어야 다시 제안하는 여유다. 문서의 「200줄」, 「20줄」과 함께 바꾼다.
export const CLAUDE_MD_LIMIT_LINES = 200;
export const CLAUDE_MD_KEPT_MARGIN_LINES = 20;
// 키트가 CLAUDE.md에 넣는 구역의 표시 주석 쌍이다. 이 안은 정리 제안 대상이 아니라 따로 센다.
const CLAUDE_MD_KIT_BLOCKS = [
  ['<!-- subagent-system 시작 -->', '<!-- subagent-system 끝 -->'],
  ['<!-- claude-setup-kit extras 시작 -->', '<!-- claude-setup-kit extras 끝 -->'],
];

// text가 null이면 CLAUDE.md가 없는 것이다. 키트 구역 줄 수에는 표시 줄도 넣고, 끝 표시가 없는 시작 표시는 구역으로 세지 않는다.
export function claudeMdSummary(text, keptLines = null) {
  if (text === null) return { exists: false };
  const lines = splitLines(text);
  const total = lines.length;
  let kit = 0;
  for (const [start, end] of CLAUDE_MD_KIT_BLOCKS) {
    const from = lines.findIndex((l) => l.trim() === start);
    const to = from < 0 ? -1 : lines.findIndex((l, i) => i > from && l.trim() === end);
    if (to > from) kit += to - from + 1;
  }
  const target = total > CLAUDE_MD_LIMIT_LINES && (keptLines === null || total > keptLines + CLAUDE_MD_KEPT_MARGIN_LINES);
  let reason = '';
  if (!target) reason = total <= CLAUDE_MD_LIMIT_LINES ? `${CLAUDE_MD_LIMIT_LINES}줄 이하` : `정리 뒤 남긴 ${keptLines}줄에서 ${CLAUDE_MD_KEPT_MARGIN_LINES}줄 이내`;
  return { exists: true, total, kit, target, reason, keptLines };
}

// 다른 키(commandName, removedDefs 등 모르는 키 포함)는 그대로 두고 retroMode만 바꾼 설정 파일 내용을 만든다. 깨진 파일은 새로 쓴다.
// 방식을 바꾸면 연속 실패 횟수(retroFailures)는 0으로 돌아가므로 키를 뺀다.
export function configTextWithMode(text, retroMode) {
  const { retroFailures, ...rest } = (text ? parseConfigObject(text) : null) ?? {};
  return JSON.stringify({ ...rest, retroMode }, null, 2) + '\n';
}

// 다른 키는 그대로 두고 claudeMdKeptLines만 뺀 설정 파일 내용을 만든다. 깨진 파일이면 null이라 호출하는 쪽이 쓰지 않고 넘어간다.
export function configTextWithoutKeptLines(text) {
  const o = text ? parseConfigObject(text) : null;
  if (!o) return null;
  const { claudeMdKeptLines, ...rest } = o;
  return JSON.stringify(rest, null, 2) + '\n';
}

// 다른 키는 그대로 두고 claudeMdKeptLines만 lines로 바꾼 설정 파일 내용을 만든다. 깨진 파일이면 null이라 호출하는 쪽이 쓰지 않고 넘어간다.
export function configTextWithKeptLines(text, lines) {
  const o = text ? parseConfigObject(text) : null;
  if (!o) return null;
  return JSON.stringify({ ...o, claudeMdKeptLines: lines }, null, 2) + '\n';
}

// 다른 키는 그대로 두고 removedKinds만 kinds로 바꾼 설정 파일 내용을 만든다. 빈 배열이면 키를 뺀다.
// 파일이 없으면(text가 빈 문자열) 새로 쓰고, 깨졌으면 null이라 호출하는 쪽이 쓰지 않고 넘어간다.
export function configTextWithRemovedKinds(text, kinds) {
  const o = text ? parseConfigObject(text) : {};
  if (!o) return null;
  const { removedKinds, ...rest } = o;
  return JSON.stringify(kinds.length ? { ...rest, removedKinds: kinds } : rest, null, 2) + '\n';
}

// 연속 실패 횟수만 바꾼 설정 파일 내용을 만든다. 0이면 키를 뺀다.
export function configTextWithFailures(text, failures) {
  const { retroFailures, ...rest } = (text ? parseConfigObject(text) : null) ?? {};
  return JSON.stringify(failures > 0 ? { ...rest, retroFailures: failures } : rest, null, 2) + '\n';
}

// 업데이트가 통째로 바꾸는 키트 파일의 해시를 config.json의 kitFileHashes에 남기고, 업데이트 때 설치본이 기록과 다른 파일만 사용자가 손으로 고친 것으로 가린다.
// 회고가 고치는 곳(GUIDE의 세 구역, 정의의 description)과 사용자가 고른 글쓰기 줄은 사용자 칸이라 해시에서 뺀다.
export const KIT_DEF_NAMES = ['haiku-low', 'haiku-medium', 'haiku-high', 'sonnet-low', 'sonnet-medium', 'sonnet-high', 'opus-low', 'opus-medium', 'opus-high', 'opus-xhigh'];
const GUIDE_ZONES = [
  ['<!-- 사용자 표 시작 -->', '<!-- 사용자 표 끝 -->'],
  ['<!-- 무조건 Opus 시작 -->', '<!-- 무조건 Opus 끝 -->'],
  ['<!-- 사용자 규칙 시작 -->', '<!-- 사용자 규칙 끝 -->'],
];
const WRITING_LINE_MARK = '글은 필요한 말만 쓴다';

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');

// 표시 줄은 남기고 표시 사이만 뺀다. 끝 표시가 없는 시작 표시는 구역으로 세지 않는다.
export function guideTextOutsideZones(text) {
  const lines = text.split(LINE_BREAK);
  const drop = new Set();
  for (const [start, end] of GUIDE_ZONES) {
    const from = lines.findIndex((l) => l.trim() === start);
    const to = from < 0 ? -1 : lines.findIndex((l, i) => i > from && l.trim() === end);
    if (to > from) for (let i = from + 1; i < to; i++) drop.add(i);
  }
  return lines.filter((_, i) => !drop.has(i)).join('\n');
}

// frontmatter의 description 줄과 글쓰기 줄을 뺀 정의 내용이다.
// 글쓰기 줄은 본문 끝에 빈 줄을 사이에 두고 더해졌을 수 있어, 줄을 뺀 뒤 끝의 공백과 빈 줄은 줄 바꿈 한 개로 맞춘다.
export function definitionTextForHash(text) {
  const lines = text.split(LINE_BREAK);
  const close = lines[0]?.trim() === '---' ? lines.findIndex((l, i) => i > 0 && l.trim() === '---') : -1;
  return `${lines.filter((l, i) => !(close > 0 && i < close && l.startsWith('description:')) && !l.includes(WRITING_LINE_MARK)).join('\n').trimEnd()}\n`;
}

// 값이 sha256 16진 문자열인 항목만 남긴다. 없거나 객체가 아니면 null이라 기록이 없는 설치본과 같게 본다.
export function kitFileHashesOf(o) {
  const v = o?.kitFileHashes;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  return Object.fromEntries(Object.entries(v).filter(([, h]) => typeof h === 'string' && /^[0-9a-f]{64}$/.test(h)));
}

// 기록과 현재 해시를 견준다. 기록에 있는 파일만 본다(현재만 있는 파일은 키트가 놓지 않은 것이라 견주지 않는다).
// removedDefs에 든 이름의 정의 파일이 없는 것은 사용자가 지운 것이 아니라 회고가 지운 것이라 missing과 따로 센다.
export function diffKitHashes(recorded, current, removedDefs = []) {
  const changed = [];
  const missing = [];
  const removed = [];
  let same = 0;
  const removedKeys = new Set(removedDefs.map((d) => `agents/${d}.md`));
  for (const [key, hash] of Object.entries(recorded)) {
    if (!current.has(key)) (removedKeys.has(key) ? removed : missing).push(key);
    else if (current.get(key) !== hash) changed.push(key);
    else same += 1;
  }
  return { changed, missing, removed, same };
}

// 다른 키는 그대로 두고 kitFileHashes만 hashes로 바꾼 설정 파일 내용을 만든다. 파일이 없거나 깨졌으면 null이라 호출하는 쪽이 쓰지 않고 넘어간다.
export function configTextWithKitHashes(text, hashes) {
  const o = text ? parseConfigObject(text) : null;
  if (!o) return null;
  return JSON.stringify({ ...o, kitFileHashes: hashes }, null, 2) + '\n';
}

// 회고를 시작한 세션이 비정상 종료해 잠금이 남아도 이 시간이 지나면 버려진 것으로 본다.
export const LOCK_STALE_MS = 3 * 60 * 60 * 1000;

// 잠금 파일의 수정 시각(없으면 null)으로 상태를 가린다. live는 회고가 진행 중이라는 뜻이다.
export function lockState(mtimeMs, nowMs = Date.now()) {
  if (mtimeMs === null || mtimeMs === undefined) return 'none';
  return nowMs - mtimeMs > LOCK_STALE_MS ? 'stale' : 'live';
}

// 물을 것 파일(retro-pending.md)에서 항목 수를 센다. 항목은 `## `로 시작하는 줄 하나씩이다.
export function countPending(text) {
  return splitLines(text ?? '').filter((l) => /^## \S/.test(l)).length;
}

// --due의 첫 줄. 잠금이 살아 있으면 다른 세션이 회고 중이라 묻지도 띄우지도 않으므로 wait다.
export function dueHead(d, { mode = 'ask', lockLive = false } = {}) {
  if (lockLive || d.status !== 'ask') return `wait ${d.remaining}`;
  return mode === 'auto' ? 'auto' : 'ask';
}
