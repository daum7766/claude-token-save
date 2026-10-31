#!/usr/bin/env node
/**
 * 일하는 방식의 성과를 숫자로 보게 하는 지표 넷. 회고와 메인이 읽는다.
 *   budget start|end|cause|list  작업 단위 예산 원장(어림과 실제, 차이의 원인)
 *   pair add|list                같은 입력을 두 정의에 보낸 짝 시험 기록과 칸별 모음
 *   unused                       스킬, 정의, 스크립트 하위 명령, 문서 절의 마지막 사용일
 *   asks                         사용자에게 온 질문 수(최종 보고의 「정할 것」 줄과 확인 창)
 * 자세한 사용법은 인자 없이 실행하면 나온다.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  CLAUDE_DIR,
  AGENTS_DIR,
  PROJECTS_ROOT,
  RECORDS_DIR,
  listSessions,
  sessionCwd,
  projectRoot,
  retentionDays,
  localDate,
  printTable,
  appendWithHeader,
  splitLines,
} from './claudeProjectPaths.js';
import { loadRates, toCounts, cost, lastLinePerRequest } from './subagent-usage.js';
import { jsonlRows, analyzeTranscript } from './transcriptTiming.js';

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));
const BIN = 'node "$HOME/.claude/subagent-system/scripts/work-metrics.js"';

const USAGE = [
  `사용: ${BIN} <하위 명령> ...`,
  '  budget start --id <작업> --tokens <어림 토큰> --secs <어림 초> [--project <폴더>] [--session <id>] [--at <시각>]',
  '  budget end --id <작업> [--cause "<원인>"] [--over 2] [--under 0.5] [--session <id>] [--at <시각>]',
  '  budget cause --id <작업> --text "<원인>"',
  '  budget list [--since YYYY-MM-DD]',
  '  pair add --cell "<칸>" --task "<입력 요약>" --a <정의> --cost-a <$> --quality-a 통과|모자람|실패 --b <정의> --cost-b <$> --quality-b 통과|모자람|실패 [--memo "<메모>"]',
  '  pair list [--cell "<칸>"]',
  '  unused [--kind skills|agents|scripts|docs] [--days 30] [--work-days 10] [--skills <폴더>] [--agents <폴더>] [--scripts <폴더>] [--docs <파일이나 폴더>]',
  '  asks [--since YYYY-MM-DD] [--project <폴더>] [--asks-file <파일>]',
  '예산은 GUIDE 「기록과 회고」의 예산 문턱(서브에이전트를 띄우거나 도구 호출이 열 번 넘을 것으로 어림되는 작업)을 넘는 일에만 잰다. budget start는 일을 정한 뒤 서브에이전트를 띄우기 전에, budget end는 최종 보고 직전에 부른다. 어림은 budget list의 비슷한 지난 작업 실제값으로 잡는다. 사용 기록의 토큰 열은 마지막 요청 하나의 문맥 크기라 요청마다 더한 이 토큰과 단위가 다르니, 쓰려면 에이전트마다 토큰 열 × 도구 호출 수 ÷ 2로 바꿔 더하고 메인 몫을 얹는다(문맥이 고르게 자란다는 어림. 토큰 열을 그대로 더한 어림은 45~190배 모자랐다).',
  'budget end는 실제가 어림의 --over배 이상이면 넘음, --under배 이하면 덜 듦으로 적고, 이 둘이면 원인을 --cause나 budget cause로 남긴다. 세션을 못 찾으면 --session <id>를 준다.',
  '시작과 끝의 짝이 안 맞은 작업은 budget list에 열린 작업으로 보이니 같은 이름을 다시 쓰려면 먼저 끝낸다. unused와 asks는 회고 준비가 돌려 지울 후보와 질문 수를 보는 것이라 메인이 평소에 부르지 않는다.',
  '토큰은 입력, 캐시 쓰기, 캐시 읽기, 출력의 합이다. 시간은 사용자를 기다린 시간을 뺀 초다. 기록은 기록 폴더(subagent-retro.js --where)에 쌓인다.',
].join('\n');

function fail(message) {
  console.error(message);
  process.exit(1);
}

// `--키 값`을 모으고 같은 키가 여럿이면 배열로 쌓는다. 앞의 위치 인자(budget, start 같은)는 _에 담는다.
export function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--') && a.length > 2) {
      const v = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : '';
      (out.flags[a.slice(2)] ??= []).push(v);
    } else out._.push(a);
  }
  return out;
}
const one = (flags, key) => flags[key]?.at(-1);
const need = (flags, key) => {
  const v = one(flags, key);
  if (v === undefined || v === '') fail(`--${key}가 필요합니다.\n${USAGE}`);
  return v;
};
const number = (flags, key, fallback) => {
  const v = one(flags, key);
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) fail(`--${key}는 0 이상의 숫자여야 합니다: ${v}`);
  return n;
};
// 날짜만 쓰면 Date가 UTC 자정으로 읽으므로 지역 자정으로 맞춘다.
export function parseTime(value) {
  const t = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value).getTime();
  return Number.isNaN(t) ? null : t;
}
const timeFlag = (flags, key, fallback) => {
  const v = one(flags, key);
  if (v === undefined) return fallback;
  const t = parseTime(v);
  if (t === null) fail(`--${key}를 시각으로 읽지 못했습니다: ${v}`);
  return t;
};

const cell = (v) => String(v ?? '').replace(/[\t\r\n]+/g, ' ').trim();
function readTsv(file, headFirst) {
  if (!fs.existsSync(file)) return [];
  return splitLines(fs.readFileSync(file, 'utf8'))
    .map((l) => l.split('\t'))
    .filter((c) => c.length > 1 && c[0] !== headFirst);
}

// 예산 원장

const BUDGET_FILE = path.join(RECORDS_DIR, 'work-budget.tsv');
const BUDGET_COLS = ['시각', '종류', '작업', '프로젝트', '세션', '어림 토큰', '어림 초', '실제 토큰', '실제 초', '기다린 초', '메인 토큰', '서브 토큰', '메인 비용', '서브 비용', '비용 모름', '판정', '원인'];
const budgetLine = (o) => BUDGET_COLS.map((k) => cell(o[k])).join('\t');
const budgetRows = () => readTsv(BUDGET_FILE, '시각').map((c) => Object.fromEntries(BUDGET_COLS.map((k, i) => [k, c[i] ?? ''])));

function findSession({ id, project }) {
  const sessions = listSessions();
  if (id) return sessions.find((s) => s.id === id) ?? null;
  const root = projectRoot(project);
  return (
    sessions
      .sort((a, b) => b.mtime - a.mtime)
      .find((s) => {
        const cwd = sessionCwd(s.file);
        return cwd && projectRoot(cwd) === root;
      }) ?? null
  );
}

const sumCounts = (counts, rates) => {
  const total = { tokens: 0, cost: 0, unknown: 0 };
  for (const c of counts) {
    total.tokens += c.input + c.write5m + c.write1h + c.read + c.output;
    const v = cost(c, rates);
    if (v === null) total.unknown++;
    else total.cost += v;
  }
  return total;
};

// 시각이 [from, to]인 줄만 센다. 한 요청이 여러 줄에 찍히므로 요청마다 마지막 줄 하나만 센다.
function windowUsage(file, from, to, rates, tapFd) {
  const usageRows = [];
  for (const d of jsonlRows(file)) {
    const t = d.timestamp ? Date.parse(d.timestamp) : NaN;
    if (!(t >= from && t <= to)) continue;
    if (tapFd !== undefined) fs.writeSync(tapFd, JSON.stringify(d) + '\n');
    if (d.type === 'assistant' && d.message?.usage) usageRows.push({ type: 'assistant', uuid: d.uuid, requestId: d.requestId, message: { id: d.message.id, model: d.message.model, usage: d.message.usage } });
  }
  return sumCounts(lastLinePerRequest(usageRows).map(toCounts), rates);
}

export function measureWindow(session, from, to, rates) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-metrics-'));
  try {
    const tapFile = path.join(tmp, 'window.jsonl');
    const fd = fs.openSync(tapFile, 'w');
    let main;
    try {
      main = windowUsage(session.file, from, to, rates, fd);
    } finally {
      fs.closeSync(fd);
    }
    const timing = analyzeTranscript(tapFile);
    const subDir = path.join(session.dir, session.id, 'subagents');
    const sub = { tokens: 0, cost: 0, unknown: 0 };
    const subFiles = fs.existsSync(subDir) ? fs.readdirSync(subDir).filter((f) => /^agent-.*\.jsonl$/.test(f)) : [];
    for (const f of subFiles) {
      const u = windowUsage(path.join(subDir, f), from, to, rates);
      for (const k of Object.keys(sub)) sub[k] += u[k];
    }
    const wall = timing?.total ?? 0;
    const wait = timing?.userWait ?? 0;
    return { main, sub, subAgents: subFiles.length, wallSecs: wall, waitSecs: wait, activeSecs: Math.max(0, wall - wait) };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// 비율이 over 이상이면 넘음, under 이하이면 덜 듦. 어림이 0이면 잴 수 없다.
export function judge(estimate, actual, { over, under }) {
  if (!(estimate > 0)) return '어림 없음';
  const r = actual / estimate;
  if (r >= over) return '넘음';
  if (r <= under) return '덜 듦';
  return '범위 안';
}

const ratio = (actual, est) => (est > 0 ? `${(actual / est).toFixed(2)}배` : '-');
const money = (v) => `$${Number(v).toFixed(2)}`;

function budgetStart(flags) {
  const id = cell(need(flags, 'id'));
  const tokens = number(flags, 'tokens');
  const secs = number(flags, 'secs');
  if (tokens === undefined || secs === undefined) fail(`--tokens와 --secs가 필요합니다.\n${USAGE}`);
  const project = projectRoot(one(flags, 'project') ?? process.cwd());
  const session = findSession({ id: one(flags, 'session'), project });
  const open = openStarts().get(id);
  if (open) fail(`작업 ${id}는 ${open['시각']}에 시작해 아직 끝나지 않았습니다. 같은 이름을 쓰려면 먼저 budget end로 끝내세요.`);
  const at = new Date(timeFlag(flags, 'at', Date.now())).toISOString();
  appendWithHeader(BUDGET_FILE, BUDGET_COLS.join('\t'), [budgetLine({ 시각: at, 종류: '시작', 작업: id, 프로젝트: project, 세션: session?.id ?? '', '어림 토큰': tokens, '어림 초': secs })]);
  console.log(`시작: ${id} 어림 ${tokens.toLocaleString('en-US')}토큰 ${secs}초, 세션 ${session ? session.id.slice(0, 8) : '찾지 못함(끝낼 때 --session 필요)'}`);
}

// 시작 줄 뒤에 같은 작업의 끝 줄이 없는 것만 열린 작업이다.
function openStarts() {
  const open = new Map();
  for (const r of budgetRows()) {
    if (r['종류'] === '시작') open.set(r['작업'], r);
    else if (r['종류'] === '끝') open.delete(r['작업']);
  }
  return open;
}

function budgetEnd(flags) {
  const id = cell(need(flags, 'id'));
  const start = openStarts().get(id);
  if (!start) fail(`끝나지 않은 작업 ${id}가 없습니다. budget start로 먼저 시작하세요.`);
  const sessionId = one(flags, 'session') || start['세션'];
  const session = sessionId ? findSession({ id: sessionId }) : null;
  if (!session) fail(`세션 ${sessionId || '(기록 없음)'}의 대화 기록을 찾지 못했습니다. --session <id>로 알려 주세요.`);
  const { rates, error } = loadRates();
  if (error) fail(`요율표를 읽지 못했습니다: ${error}`);
  const from = Date.parse(start['시각']);
  const to = timeFlag(flags, 'at', Date.now());
  const m = measureWindow(session, from, to, rates);
  const th = { over: number(flags, 'over', 2), under: number(flags, 'under', 0.5) };
  const tokens = m.main.tokens + m.sub.tokens;
  const estTokens = Number(start['어림 토큰']);
  const estSecs = Number(start['어림 초']);
  const verdictTokens = judge(estTokens, tokens, th);
  const verdictSecs = judge(estSecs, m.activeSecs, th);
  const verdict = `토큰 ${verdictTokens}, 시간 ${verdictSecs}`;
  const cause = cell(one(flags, 'cause') ?? '');
  const row = {
    시각: new Date(to).toISOString(),
    종류: '끝',
    작업: id,
    프로젝트: start['프로젝트'],
    세션: session.id,
    '어림 토큰': estTokens,
    '어림 초': estSecs,
    '실제 토큰': tokens,
    '실제 초': Math.round(m.activeSecs),
    '기다린 초': Math.round(m.waitSecs),
    '메인 토큰': m.main.tokens,
    '서브 토큰': m.sub.tokens,
    '메인 비용': m.main.cost.toFixed(3),
    '서브 비용': m.sub.cost.toFixed(3),
    '비용 모름': m.main.unknown + m.sub.unknown,
    판정: verdict,
    원인: cause,
  };
  appendWithHeader(BUDGET_FILE, BUDGET_COLS.join('\t'), [budgetLine(row)]);
  printTable(
    [
      ['', '어림', '실제', '비율'],
      ['토큰', estTokens.toLocaleString('en-US'), tokens.toLocaleString('en-US'), ratio(tokens, estTokens)],
      ['초(기다림 뺌)', estSecs, Math.round(m.activeSecs), ratio(m.activeSecs, estSecs)],
    ],
    1
  );
  console.log(`메인 ${m.main.tokens.toLocaleString('en-US')}토큰 ${money(m.main.cost)}, 서브에이전트 ${m.subAgents}명 ${m.sub.tokens.toLocaleString('en-US')}토큰 ${money(m.sub.cost)}, 사용자 기다림 ${Math.round(m.waitSecs)}초`);
  if (row['비용 모름'] > 0) console.log(`요율표에 없는 모델의 응답 ${row['비용 모름']}건은 비용에서 빠졌습니다(rates.json에 모델을 넣으세요).`);
  console.log(`판정: ${verdict}`);
  const flagged = /넘음|덜 듦/.test(verdict);
  if (flagged && !cause) console.log(`원인 칸이 비었습니다. 다음 어림에 쓰도록 남기세요: ${BIN} budget cause --id ${id} --text "<원인>"`);
}

function budgetCause(flags) {
  const id = cell(need(flags, 'id'));
  const text = cell(need(flags, 'text'));
  if (!budgetRows().some((r) => r['작업'] === id && r['종류'] === '끝')) fail(`끝난 작업 ${id}가 없습니다.`);
  appendWithHeader(BUDGET_FILE, BUDGET_COLS.join('\t'), [budgetLine({ 시각: new Date().toISOString(), 종류: '원인', 작업: id, 원인: text })]);
  console.log(`원인을 남겼습니다: ${id}`);
}

// 작업마다 마지막 끝 줄과 그 뒤에 덧붙은 원인 줄 가운데 마지막 것을 합친다.
export function summarizeBudget(rows) {
  const done = new Map();
  for (const r of rows) {
    if (r['종류'] === '끝') done.set(r['작업'], { ...r });
    else if (r['종류'] === '원인' && done.has(r['작업'])) done.get(r['작업'])['원인'] = r['원인'];
  }
  return [...done.values()];
}

function budgetList(flags) {
  const since = timeFlag(flags, 'since', 0);
  const rows = budgetRows();
  const done = summarizeBudget(rows).filter((r) => Date.parse(r['시각']) >= since);
  const open = [...openStarts().values()].filter((r) => Date.parse(r['시각']) >= since);
  if (done.length === 0 && open.length === 0) return console.log('예산 기록이 없습니다.');
  if (done.length) {
    printTable(
      [
        ['작업', '어림 토큰', '실제 토큰', '비율', '어림 초', '실제 초', '비율', '비용', '판정', '원인'],
        ...done.map((r) => {
          const t = Number(r['실제 토큰']);
          const s = Number(r['실제 초']);
          return [r['작업'], Number(r['어림 토큰']).toLocaleString('en-US'), t.toLocaleString('en-US'), ratio(t, Number(r['어림 토큰'])), r['어림 초'], s, ratio(s, Number(r['어림 초'])), money(Number(r['메인 비용']) + Number(r['서브 비용'])), r['판정'], r['원인'] || '-'];
        }),
      ],
      1
    );
    const flagged = done.filter((r) => /넘음|덜 듦/.test(r['판정']));
    const noCause = flagged.filter((r) => !r['원인']);
    console.log(`\n끝난 ${done.length}건, 넘음이나 덜 듦 ${flagged.length}건, 그 가운데 원인이 빈 것 ${noCause.length}건${noCause.length ? ` (${noCause.map((r) => r['작업']).join(', ')})` : ''}`);
  }
  if (open.length) console.log(`끝나지 않은 작업 ${open.length}건: ${open.map((r) => r['작업']).join(', ')}`);
}

// 짝 시험

const PAIR_FILE = path.join(RECORDS_DIR, 'pair-trials.tsv');
const PAIR_COLS = ['시각', '칸', '입력', '정의 A', '비용 A', '품질 A', '정의 B', '비용 B', '품질 B', '메모'];
const QUALITIES = ['통과', '모자람', '실패'];
const pairRows = () => readTsv(PAIR_FILE, '시각').map((c) => Object.fromEntries(PAIR_COLS.map((k, i) => [k, c[i] ?? ''])));

function pairAdd(flags) {
  const row = { 시각: new Date().toISOString(), 칸: need(flags, 'cell'), 입력: need(flags, 'task'), '정의 A': need(flags, 'a'), '정의 B': need(flags, 'b'), 메모: one(flags, 'memo') ?? '' };
  for (const side of ['a', 'b']) {
    const S = side.toUpperCase();
    const c = Number(need(flags, `cost-${side}`));
    if (!Number.isFinite(c) || c < 0) fail(`--cost-${side}는 0 이상의 숫자여야 합니다.`);
    const q = need(flags, `quality-${side}`);
    if (!QUALITIES.includes(q)) fail(`--quality-${side}는 ${QUALITIES.join(', ')} 가운데 하나여야 합니다: ${q}`);
    row[`비용 ${S}`] = c;
    row[`품질 ${S}`] = q;
  }
  if (row['정의 A'] === row['정의 B']) fail('--a와 --b가 같은 정의입니다.');
  appendWithHeader(PAIR_FILE, PAIR_COLS.join('\t'), [PAIR_COLS.map((k) => cell(row[k])).join('\t')]);
  console.log(`짝 시험을 적었습니다: ${row['칸']} ${row['정의 A']} 대 ${row['정의 B']}`);
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// 칸과 정의 쌍(순서 없이)마다 건수, 어느 쪽이 통과했는지, 비용 중앙값을 모은다. 싼 쪽은 건마다 비용으로 가른다.
export function summarizePairs(rows) {
  const groups = new Map();
  for (const r of rows) {
    const [x, y] = [r['정의 A'], r['정의 B']].sort();
    const key = `${r['칸']}\t${x}\t${y}`;
    if (!groups.has(key)) groups.set(key, { cell: r['칸'], x, y, n: 0, bothPass: 0, onlyCheap: 0, onlyDear: 0, neither: 0, costs: { [x]: [], [y]: [] }, cheapWins: { [x]: 0, [y]: 0 } });
    const g = groups.get(key);
    const side = { [r['정의 A']]: { cost: Number(r['비용 A']), ok: r['품질 A'] === '통과' }, [r['정의 B']]: { cost: Number(r['비용 B']), ok: r['품질 B'] === '통과' } };
    g.n++;
    for (const d of [x, y]) g.costs[d].push(side[d].cost);
    const [cheap, dear] = side[x].cost <= side[y].cost ? [x, y] : [y, x];
    g.cheapWins[cheap]++;
    if (side[cheap].ok && side[dear].ok) g.bothPass++;
    else if (side[cheap].ok) g.onlyCheap++;
    else if (side[dear].ok) g.onlyDear++;
    else g.neither++;
  }
  return [...groups.values()];
}

function pairList(flags) {
  const cellFilter = one(flags, 'cell');
  const groups = summarizePairs(pairRows().filter((r) => !cellFilter || r['칸'] === cellFilter));
  if (groups.length === 0) return console.log('짝 시험 기록이 없습니다.');
  printTable(
    [
      ['칸', '정의 쌍', '건수', '둘 다 통과', '싼 쪽만 통과', '비싼 쪽만 통과', '둘 다 못함', '비용 중앙값'],
      ...groups.map((g) => [g.cell, `${g.x} 대 ${g.y}`, g.n, g.bothPass, g.onlyCheap, g.onlyDear, g.neither, `${g.x} ${money(median(g.costs[g.x]))} / ${g.y} ${money(median(g.costs[g.y]))}`]),
    ],
    2
  );
  console.log('\n읽는 법: 둘 다 통과와 싼 쪽만 통과가 건수를 거의 채우면 싼 쪽으로 내려도 품질이 같다는 뜻이다. 비싼 쪽만 통과가 있으면 싼 쪽이 그 입력을 놓친 것이니 건수가 쌓일 때까지 내리지 않는다.');
}

// 안 쓰는 매뉴얼

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function walkFiles(root, test, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(root, e.name);
    if (e.isDirectory()) walkFiles(p, test, out);
    else if (test(e.name)) out.push(p);
  }
  return out;
}

const hasRg = () => process.env.WORK_METRICS_NO_RG !== '1' && spawnSync('rg', ['--version'], { stdio: 'ignore' }).status === 0;

// 정규식 가운데 하나라도 맞는 줄만 넘긴다. rg가 없으면 파일을 직접 읽는다.
async function grepLines(root, patterns, onLine) {
  if (patterns.length === 0 || !fs.existsSync(root)) return;
  if (!hasRg()) {
    const re = new RegExp(patterns.join('|'));
    for (const f of walkFiles(root, (n) => n.endsWith('.jsonl'))) {
      let text;
      try {
        text = fs.readFileSync(f, 'utf8');
      } catch {
        continue;
      }
      for (const line of text.split(/\r?\n/)) if (line && re.test(line)) onLine(line);
    }
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-metrics-rg-'));
  try {
    const patFile = path.join(tmp, 'patterns.txt');
    fs.writeFileSync(patFile, patterns.join('\n') + '\n');
    const child = spawn('rg', ['--no-filename', '--no-heading', '-N', '--no-ignore', '--hidden', '--no-messages', '--glob', '*.jsonl', '-f', patFile, root], { stdio: ['ignore', 'pipe', 'ignore'] });
    let buf = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (line) onLine(line);
      }
    });
    await new Promise((resolve) => child.on('close', resolve));
    if (buf) onLine(buf);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// 줄 하나에서 매뉴얼을 쓴 흔적을 종류별로 뽑는다. 도구 결과(파일을 읽어 온 본문)는 쓴 흔적이 아니라 뺀다.
export function evidence(d) {
  const ev = { skills: [], agents: [], bash: [], talk: [] };
  const c = d.message?.content;
  const slash = (text) => {
    for (const m of text.matchAll(/<command-name>\/?([^<]+)<\/command-name>/g)) ev.skills.push(m[1].trim());
  };
  if (d.type === 'assistant' && Array.isArray(c)) {
    for (const x of c) {
      if (x?.type === 'text' && typeof x.text === 'string') ev.talk.push(x.text);
      else if (x?.type === 'tool_use') {
        if (x.name === 'Skill' && typeof x.input?.skill === 'string') ev.skills.push(x.input.skill);
        else if ((x.name === 'Agent' || x.name === 'Task') && typeof x.input?.subagent_type === 'string') ev.agents.push(x.input.subagent_type);
        else if (x.name === 'Bash' && typeof x.input?.command === 'string') ev.bash.push(x.input.command);
        if (x.name !== 'Bash') ev.talk.push(JSON.stringify(x.input ?? {}));
      }
    }
  } else if (d.type === 'user') {
    const texts = typeof c === 'string' ? [c] : Array.isArray(c) ? c.filter((x) => x?.type === 'text' && typeof x.text === 'string').map((x) => x.text) : [];
    for (const t of texts) {
      ev.talk.push(t);
      slash(t);
    }
  }
  return ev;
}

const skillMatches = (name) => (s) => s === name || s.endsWith(`:${name}`);

export function skillItems(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'SKILL.md')))
    .map((e) => ({ kind: '스킬', name: e.name, hit: (ev) => ev.skills.some(skillMatches(e.name)), needles: [`"skill":"(?:[^":]*:)?${escapeRe(e.name)}"`, `<command-name>/?(?:[^<:]*:)?${escapeRe(e.name)}</command-name>`] }));
}

export function agentItems(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''))
    .map((name) => ({ kind: '정의', name, hit: (ev) => ev.agents.includes(name), needles: [`"subagent_type":"${escapeRe(name)}"`] }));
}

// 인자를 읽는 스크립트에서 따옴표로 둘러싸인 `--플래그`를 하위 명령으로 본다. 다른 프로그램을 부르는 줄(git, rg의 인자)은 이 스크립트의 하위 명령이 아니라 뺀다.
export function flagsOf(source) {
  const own = splitLines(source).filter((line) => !/\b(?:spawn|spawnSync|execFile|execFileSync)\(/.test(line));
  return [...new Set(own.flatMap((line) => [...line.matchAll(/['"`](--[a-z][a-z0-9-]*)['"`]/g)].map((m) => m[1])))].sort();
}

export function scriptItems(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    const source = fs.readFileSync(path.join(dir, f), 'utf8');
    if (!source.includes('process.argv')) continue;
    const needle = escapeRe(f);
    out.push({ kind: '스크립트', name: f, hit: (ev) => ev.bash.some((b) => b.includes(f)), needles: [needle] });
    for (const flag of flagsOf(source)) {
      const flagRe = new RegExp(`(?<![\\w-])${escapeRe(flag)}(?![\\w-])`);
      out.push({ kind: '하위 명령', name: `${f} ${flag}`, hit: (ev) => ev.bash.some((b) => b.includes(f) && flagRe.test(b)), needles: [needle] });
    }
  }
  return out;
}

export function docItems(paths) {
  const files = paths.flatMap((p) => (fs.existsSync(p) ? (fs.statSync(p).isDirectory() ? walkFiles(p, (n) => n.endsWith('.md')) : [p]) : []));
  const out = [];
  for (const f of files) {
    let inFence = false;
    for (const line of splitLines(fs.readFileSync(f, 'utf8'))) {
      if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
      const m = !inFence && line.match(/^#{2,3}\s+(.+?)\s*$/);
      if (!m) continue;
      const title = m[1];
      const quoted = `「${title}」`;
      out.push({ kind: '문서 절', name: `${path.basename(f)} ${title}`, hit: (ev) => ev.talk.some((t) => t.includes(quoted)), needles: [escapeRe(quoted)] });
    }
  }
  return out;
}

export async function lastUses(items, root) {
  const stat = new Map(items.map((i) => [i, { last: 0, count: 0 }]));
  const needles = [...new Set(items.flatMap((i) => i.needles))];
  await grepLines(root, needles, (line) => {
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      return;
    }
    const t = d.timestamp ? Date.parse(d.timestamp) : NaN;
    if (Number.isNaN(t)) return;
    const ev = evidence(d);
    for (const item of items) {
      if (!item.hit(ev)) continue;
      const s = stat.get(item);
      s.count++;
      if (t > s.last) s.last = t;
    }
  });
  return stat;
}

async function unused(flags) {
  const kind = one(flags, 'kind') ?? 'all';
  const days = number(flags, 'days', 30);
  const now = timeFlag(flags, 'now', Date.now());
  const want = (k) => kind === 'all' || kind === k;
  const items = [
    ...(want('skills') ? (flags.skills ?? [path.join(CLAUDE_DIR, 'skills')]).flatMap(skillItems) : []),
    ...(want('agents') ? (flags.agents ?? [AGENTS_DIR]).flatMap(agentItems) : []),
    ...(want('scripts') ? (flags.scripts ?? [SELF_DIR]).flatMap(scriptItems) : []),
    ...(want('docs') ? docItems(flags.docs ?? [path.join(CLAUDE_DIR, 'docs'), path.join(CLAUDE_DIR, 'subagent-system', 'docs')]) : []),
  ];
  if (items.length === 0) return console.log('찾을 매뉴얼이 없습니다(폴더 인자를 확인하세요).');
  const stat = await lastUses(items, PROJECTS_ROOT);
  const files = walkFiles(PROJECTS_ROOT, (n) => n.endsWith('.jsonl'));
  const oldest = files.length ? Math.min(...files.map((f) => fs.statSync(f).mtimeMs)) : null;
  // 쉬다 돌아오면 달력 날짜만으로는 모두 안 쓴 것이 된다. 대화 기록이 남은 날(작업일)이 기간 안에 --work-days만큼 모일 때까지 기간을 뒤로 늘린다.
  const workDays = number(flags, 'work-days', 10);
  const active = [...new Set(files.flatMap((f) => { const st = fs.statSync(f); return [st.mtimeMs, st.birthtimeMs].filter((t) => t > 0 && t <= now).map(localDate); }))].sort().reverse();
  const workCutoff = workDays <= 0 ? Infinity : active.length >= workDays ? Date.parse(active[workDays - 1]) : 0;
  const cutoff = Math.min(now - days * 86400000, workCutoff);
  const stale = items.filter((i) => stat.get(i).last === 0 || stat.get(i).last < cutoff).sort((a, b) => stat.get(a).last - stat.get(b).last || a.name.localeCompare(b.name));
  console.log(`대화 기록 ${files.length}개를 봤습니다(가장 오래된 수정 ${oldest ? localDate(oldest) : '-'}, 보관 기간 ${retentionDays()}일). 이 기간 밖의 사용은 보이지 않으니 기록이 짧으면 안 쓴다고 단정하지 마세요.`);
  console.log(`매뉴얼 ${items.length}개 가운데 ${days}일(작업일 ${workDays}일이 모자라면 더 거슬러) 안에 쓴 것 ${items.length - stale.length}개, 안 쓴 것 ${stale.length}개${kind === 'docs' || kind === 'all' ? ' (문서 절은 「절 이름」을 말한 것만 쓴 것으로 센다)' : ''}`);
  if (stale.length === 0) return;
  printTable(
    [['종류', '이름', '마지막 사용일', '횟수'], ...stale.map((i) => [i.kind, i.name, stat.get(i).last ? localDate(stat.get(i).last) : '기록 없음', stat.get(i).count])],
    3
  );
}

// 사용자에게 온 질문 수

const DECISION_LABEL = /^[\s>#*\-•]*[「"*]*(?:정할 것|결정할 것)[」"*]*(?:\s*[:：]\s*(.*)|\s*)$/;
const LIST_ITEM = /^\s*(?:[-*•·]|\d+[.)]|[①-⑳])/;
const HEADING_LIKE = /^\s*(?:#+\s|---|\*\*[^*]+\*\*\s*[:：]?\s*(?:[（(][^)）]*[)）])?\s*$|(?:[①-⑳]|\d+[.)])?\s*[「"*]*(?:알아 둘 것|결과 지표|하고 알린 것|제안|선택지|한 일)[」"*]*\s*[:：]?\s*$)/;
const EMPTY_ITEM = /^[\s\-*•·]*(?:없음|해당 없음|-)?\s*$/;

// 최종 보고 글에서 「정할 것」 아래 질문 줄 수를 센다. 들여쓴 줄(선택지 a, b, c)은 질문 하나에 딸린 것이라 세지 않는다.
export function countDecisionLines(text) {
  const lines = text.split(/\r?\n/);
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(DECISION_LABEL);
    if (!m) continue;
    if (m[1] && !EMPTY_ITEM.test(m[1])) count++;
    let sawBlank = false;
    for (i++; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === '') {
        sawBlank = true;
        continue;
      }
      if (DECISION_LABEL.test(line) || (sawBlank && !LIST_ITEM.test(line)) || HEADING_LIKE.test(line)) {
        i--;
        break;
      }
      sawBlank = false;
      if (line.match(/^\s*/)[0].length > 1 || EMPTY_ITEM.test(line)) continue;
      count++;
    }
  }
  return count;
}

// 대화 한 번(사용자 입력 하나)의 마지막 어시스턴트 글이 최종 보고다.
export function finalReports(file) {
  const reports = [];
  let lastId = null;
  let buf = '';
  let ts = null;
  const flush = () => {
    if (buf) reports.push({ text: buf, ts });
    lastId = null;
    buf = '';
  };
  for (const d of jsonlRows(file)) {
    const c = d.message?.content;
    if (d.type === 'user' && d.message && !d.isMeta) {
      const isPrompt = typeof c === 'string' || (Array.isArray(c) && c.some((x) => x?.type === 'text') && !c.some((x) => x?.type === 'tool_result'));
      if (isPrompt) flush();
    } else if (d.type === 'assistant' && Array.isArray(c)) {
      const texts = c.filter((x) => x?.type === 'text' && typeof x.text === 'string').map((x) => x.text);
      if (texts.length === 0) continue;
      const id = d.message?.id ?? d.uuid;
      if (id !== lastId) buf = '';
      lastId = id;
      buf += texts.join('\n') + '\n';
      ts = d.timestamp;
    }
  }
  flush();
  return reports;
}

async function asks(flags) {
  const now = timeFlag(flags, 'now', Date.now());
  const since = timeFlag(flags, 'since', now - 30 * 86400000);
  const projectFilter = one(flags, 'project') ? projectRoot(one(flags, 'project')) : null;
  const askFile = one(flags, 'asks-file') ?? path.join(CLAUDE_DIR, 'permission-asks.jsonl');
  const days = new Map();
  const day = (t) => {
    const k = localDate(t);
    if (!days.has(k)) days.set(k, { reports: 0, asked: 0, lines: 0, asks: 0 });
    return days.get(k);
  };
  let sessions = 0;
  for (const s of listSessions().filter((x) => x.mtime >= since)) {
    if (projectFilter) {
      const cwd = sessionCwd(s.file);
      if (!cwd || projectRoot(cwd) !== projectFilter) continue;
    }
    sessions++;
    for (const r of finalReports(s.file)) {
      const t = Date.parse(r.ts);
      if (!(t >= since && t <= now)) continue;
      const g = day(t);
      const n = countDecisionLines(r.text);
      g.reports++;
      if (n > 0) g.asked++;
      g.lines += n;
    }
  }
  const byHook = new Map();
  let askTotal = 0;
  if (fs.existsSync(askFile)) {
    for (const line of splitLines(fs.readFileSync(askFile, 'utf8'))) {
      let d;
      try {
        d = JSON.parse(line);
      } catch {
        continue;
      }
      const t = Date.parse(d.ts);
      if (!(t >= since && t <= now)) continue;
      if (projectFilter && (typeof d.cwd !== 'string' || projectRoot(d.cwd) !== projectFilter)) continue;
      askTotal++;
      day(t).asks++;
      byHook.set(d.hook ?? '?', (byHook.get(d.hook ?? '?') ?? 0) + 1);
    }
  } else console.log(`확인 창 기록이 없습니다: ${askFile}`);
  const all = [...days.values()].reduce((a, g) => ({ reports: a.reports + g.reports, asked: a.asked + g.asked, lines: a.lines + g.lines, asks: a.asks + g.asks }), { reports: 0, asked: 0, lines: 0, asks: 0 });
  console.log(`기간: ${localDate(since)} 이후, 세션 ${sessions}개${projectFilter ? `, 프로젝트 ${projectFilter}` : ''}`);
  printTable([['날짜', '최종 보고', '정할 것 있는 보고', '정할 것 줄', '확인 창'], ...[...days].sort((a, b) => a[0].localeCompare(b[0])).map(([k, g]) => [k, g.reports, g.asked, g.lines, g.asks]), ['합계', all.reports, all.asked, all.lines, all.asks]], 1);
  console.log(`\n사용자에게 온 질문: 정할 것 ${all.lines}줄 + 확인 창 ${askTotal}건 = ${all.lines + askTotal}건 (정할 것이 있는 보고 ${all.asked}건당 평균 ${all.asked ? (all.lines / all.asked).toFixed(2) : '-'}줄)`);
  if (byHook.size) console.log(`확인 창을 띄운 훅: ${[...byHook].sort((a, b) => b[1] - a[1]).map(([h, n]) => `${h} ${n}`).join(', ')}`);
}

async function main() {
  const { _: pos, flags } = parseArgs(process.argv.slice(2));
  if (flags.help) return console.log(USAGE);
  const [cmd, sub] = pos;
  if (cmd === 'budget' && sub === 'start') return budgetStart(flags);
  if (cmd === 'budget' && sub === 'end') return budgetEnd(flags);
  if (cmd === 'budget' && sub === 'cause') return budgetCause(flags);
  if (cmd === 'budget' && sub === 'list') return budgetList(flags);
  if (cmd === 'pair' && sub === 'add') return pairAdd(flags);
  if (cmd === 'pair' && sub === 'list') return pairList(flags);
  if (cmd === 'unused') return unused(flags);
  if (cmd === 'asks') return asks(flags);
  fail(USAGE);
}

// 시험이 순수 함수를 가져다 쓸 수 있게, 직접 실행했을 때만 돈다.
const isEntry = (() => {
  try {
    return process.argv[1] !== undefined && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (isEntry) main();
