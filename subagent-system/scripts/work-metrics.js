#!/usr/bin/env node
/**
 * 일하는 방식의 성과를 숫자로 보게 하는 지표. 회고와 메인이 읽는다.
 *   budget start|end|cause|list  작업 단위 예산 원장(어림과 실제, 차이의 원인)
 *   pair add|list                같은 입력을 두 정의에 보낸 짝 시험 기록과 칸별 모음
 *   unused                       스킬, 정의, 스크립트 하위 명령, 문서 절의 마지막 사용일
 *   asks                         사용자에게 온 질문 수(최종 보고의 「정할 것」 줄과 확인 창)
 *   lint                         고침 기록 메모의 표시로 센 검수 지적의 기계화 비율과 린트 규칙별 효과
 *   docs                         저장소별 날짜별 문서(.md) 줄과 파일 증감, 지금 총량(문서가 늘기만 하는지 보려고)
 *   waste                        회고 때 재는 낭비 넷(막는 장치 시간, 문서 읽기 비용, 문서 순증, 대화 낭비)
 *   health                       문서 상태 점검(다 쓴 기록, 멈춘 진행 기록, 부푼 문서, 끊긴 경로, 재기만 하는 지표, 메모리)의 후보와 증거
 *   score                        한 구간의 사람 말, 훅 되돌림, 재지시, 대표 지적, 메인 토큰(일하는 방식 전후를 같은 숫자로 재는 셈)
 *   exp add|list|due|close       일하는 방식을 바꾼 실험 장부(바꾼 것, 기대, 볼 때, 전후 score, 남김|되돌림|더봄)
 *   devices                      장치(훅, 훅 안 판정, 커밋 훅, 스킬, 정의, 부품) 전체의 막음, 헛막음 후보, 알림, 고친 횟수, 마지막 쓰인 날(시스템 점검의 첫 판)
 * 자세한 사용법은 인자 없이 실행하면 나온다.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
import { repoTop, analyzeRepo, analyzeMemory, compareMetrics, appendHistory, healthHistoryFile, totalsHistory, countsOf, formatHealth, staleFixTargets } from './docHealth.js';
import { parseFixes } from './kitShared.js';
import { score as scoreRange, formatScore } from './work-score.js';
import { inventory, candidateFiles, scanTranscript, blockEvents, tally, commitCount, readJsonFile } from './deviceCensus.js';

const require = createRequire(import.meta.url);
const lockApi = require('./kitInstalled.cjs');
const userSettings = require('./userSettings.cjs');
const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));
const BIN = 'node "$HOME/.claude/subagent-system/scripts/work-metrics.js"';

const USAGE = [
  `사용: ${BIN} <하위 명령> ...`,
  '  budget start --id <작업> --tokens <어림 토큰> --secs <어림 초> [--project <폴더>] [--session <id>] [--at <시각>] [--force]',
  '  budget end --id <작업> [--cause "<원인>"] [--over 2] [--under 0.5] [--session <id>] [--at <시각>]',
  '  budget cause --id <작업> --text "<원인>"',
  '  budget list [--since YYYY-MM-DD 또는 ISO 시각]',
  '  pair add --cell "<칸>" --task "<입력 요약>" --a <정의> --cost-a <$> --quality-a 통과|모자람|실패 --b <정의> --cost-b <$> --quality-b 통과|모자람|실패 [--memo "<메모>"]',
  '  pair list [--cell "<칸>"]',
  '  unused [--kind skills|agents|scripts|docs] [--days 30] [--work-days 10] [--skills <폴더>] [--agents <폴더>] [--scripts <폴더>] [--docs <파일이나 폴더>] [--files <프로젝트 문서 폴더>]',
  '  asks [--since YYYY-MM-DD 또는 ISO 시각] [--project <폴더>] [--asks-file <파일>]',
  '  lint [--since YYYY-MM-DD 또는 ISO 시각]  (고침 기록 메모의 [검수:기계가능] [검수:기계불가] [린트:<규칙>] [린트오탐:<규칙>] [린트우회:<규칙>] 표시를 센다)',
  '  docs [--repo <저장소>]... [--days 7]  (--repo를 빼면 지금 폴더의 저장소와 설정 폴더)',
  '예산은 GUIDE 「기록과 회고」의 예산 문턱(서브에이전트를 띄우거나 도구 호출이 열 번 넘을 것으로 어림되는 작업)을 넘는 일에만 잰다. budget start는 일을 정한 뒤 서브에이전트를 띄우기 전에, budget end는 최종 보고 직전에 부른다. 어림은 budget list의 비슷한 지난 작업 실제값으로 잡는다. budget start는 같은 프로젝트에서 최근 끝난 작업(3건 이상)의 실제 토큰 중앙값의 10분의 1보다 작은 어림을 받지 않는다(정말 작은 일이면 --force). 사용 기록의 토큰 열은 마지막 요청 하나의 문맥 크기라 요청마다 더한 이 토큰과 단위가 다르니, 쓰려면 에이전트마다 토큰 열 × 도구 호출 수 ÷ 2로 바꿔 더하고 메인 몫을 얹는다(문맥이 고르게 자란다는 어림. 토큰 열을 그대로 더한 어림은 45~190배 모자랐다).',
  '  waste [--since YYYY-MM-DD 또는 ISO 시각] [--days 7] [--repo <저장소>]... [--record]  (회고 때 낭비 넷: 막는 장치 비용, 문서 읽기 비용, 문서 순증, 대화 낭비와 장치 층 크기 ⑤. --record를 줄 때만 ⑤의 값을 device-layer-history.tsv에 남김)',
  '  health [--repo <저장소>]... [--memory <메모리 폴더>]... [--days 3] [--json] [--record]  (문서 상태 점검: 다 쓴 작업 기록 후보, 멈춘 진행 기록, 부푼 문서, 끊긴 경로, 재기만 하는 지표, 메모리의 후보와 증거. 후보일 뿐 판정은 사람이 한다. 쓰는 것은 없고, 처음 보는 지표의 값과 --record를 줬을 때의 지표 값만 기록 폴더의 health-history.tsv에 남긴다)',
  '  score [--since <ISO 또는 YYYY-MM-DD>] [--until <ISO>] [--project <폴더>] [--json]  (한 구간의 사람 말, 메인과 실무자 되돌림과 갈래, 재지시, 대표 지적, 메인 토큰. --since 기본은 7일 전. 일 종류는 config.json의 scoreKinds 정규식, 없으면 사용 기록의 일 종류 이름)',
  '  exp add --what "<바꾼 것>" --why "<왜>" --expect "<기대: 어느 숫자가 어떻게>" [--days 3] [--kit <커밋>] [--at <시각>]  (실험 장부 experiments.tsv에 시작 줄을 덧붙임)',
  '  devices [--days 30] [--kit <키트 원본>] [--no-transcripts] [--json]  (장치 전체 셈: 훅과 훅 안 판정, 커밋 훅, 스킬, 정의, 부품마다 막음(기록, 대화 기록), 헛막음 후보, 막힌 뒤 다른 입력으로 낸 수, 알림, 승인 창, 고친 횟수(고침 기록/커밋), 마지막 쓰인 날과 실마리. 목록은 등록과 파일에서 뽑는다. 판정은 RETRO 「규칙 점검」과 「막는 장치 효과 보기」로 사람이 한다)',
  '  exp list  |  exp due [--count] [--now <ISO>]  (볼 때가 된 실험마다 시작 전 같은 길이 구간과 시작 뒤 구간의 score를 나란히 찍음. --count는 건수만)  |  exp close --id <번호> --result 남김|되돌림|더봄 --memo "<숫자 요지>"',
  '  실험 판정 기준: 기대한 숫자가 나아지고 다른 숫자(특히 대표 지적, 토큰)가 나빠지지 않으면 남김, 나빠지면 되돌림(바꾼 것을 걷음), 표본이 작으면(전후 구간 사람 말이 20 아래) 더봄(--days만큼 더 본 뒤 다시 due에 뜸).',
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
// 기록의 시각 칸(Z와 +0900이 섞임)이 since(밀리초) 이후인지 시각을 풀어서 견준다. 글자로 견주면 +0900 기록이 9시간 어긋난다(2026-11-08 판정).
const atOrAfter = (label, sinceMs) => Date.parse(label ?? '') >= sinceMs;

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

// 같은 프로젝트에서 최근 끝난 작업(최대 5건, 3건 이상일 때만)의 실제 토큰 중앙값의 10분의 1보다 작은 어림을 찾는다.
// 까닭: 실무자 몫만 어림해 실제(세션 누적)가 수십 배 넘는 일이 문장 규칙 뒤에도 37번 되풀이됐다(2026-10-31~11-03, 걸린 37건 모두 실제 2배 넘음, 오탐 0).
export function tooLowEstimate(rows, project, tokens) {
  const recent = rows.filter((r) => r['종류'] === '끝' && r['프로젝트'] === project && Number(r['실제 토큰']) > 0).slice(-5);
  if (recent.length < 3) return null;
  const vals = recent.map((r) => Number(r['실제 토큰'])).sort((a, b) => a - b);
  const mid = Math.floor(vals.length / 2);
  const median = vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
  return tokens < median / 10 ? { median: Math.round(median), count: recent.length } : null;
}

function budgetStart(flags) {
  const id = cell(need(flags, 'id'));
  const tokens = number(flags, 'tokens');
  const secs = number(flags, 'secs');
  if (tokens === undefined || secs === undefined) fail(`--tokens와 --secs가 필요합니다.\n${USAGE}`);
  const project = projectRoot(one(flags, 'project') ?? process.cwd());
  const session = findSession({ id: one(flags, 'session'), project });
  const open = openStarts().get(id);
  if (open) fail(`작업 ${id}는 ${open['시각']}에 시작해 아직 끝나지 않았습니다. 같은 이름을 쓰려면 먼저 budget end로 끝내세요.`);
  const low = tooLowEstimate(budgetRows(), project, tokens);
  if (low && !flags.force)
    fail(
      `어림 ${tokens.toLocaleString('en-US')}토큰이 이 프로젝트에서 최근 끝난 작업 ${low.count}건의 실제 토큰 중앙값 ${low.median.toLocaleString('en-US')}의 10분의 1보다 작습니다. ` +
        `실제 토큰은 메인 문맥을 요청마다 더한 세션 값이라 실무자 몫만 어림하면 수십 배 넘음으로 찍힙니다. budget list의 비슷한 지난 작업 실제값으로 다시 잡거나, 정말 작은 일이면 --force를 붙이세요.`
    );
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
  // 까닭: 비싸게 성공한 일은 지적이 없어 회고 신호에 안 잡히므로, 끝날 때 기계로 바꿀 길을 찾게 한다(2026-11-06 사용자 지시).
  if (/토큰 넘음|시간 넘음/.test(verdict)) console.log(`예산을 넘긴 일입니다. 끝내기 전에 기계로 바꾸거나 싸게 할 길을 하나 이상 찾아 바로 시험하거나 제안 목록에 올리세요(GUIDE 「기록과 회고」 예산).`);
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

// 린트 효과: 고침 기록(fixes.tsv)의 메모 표시를 센다. 열은 시각, 프로젝트, 범위, 신호, 이름표, 곳, 방식, 줄 수, 메모 순이다.
// 까닭: 검수 지적 가운데 기계로 잡을 수 있던 비율과 린트 규칙마다 잘된 것과 못된 것을 회고가 숫자로 견주게 한다.
const FIXES_FILE = path.join(RECORDS_DIR, 'fixes.tsv');
export function summarizeLint(rows) {
  const out = { can: 0, cannot: 0, rules: new Map() };
  const rule = (n) => out.rules.get(n) ?? out.rules.set(n, { added: 0, falsePositive: 0, bypass: 0 }).get(n);
  for (const c of rows) {
    const memo = c[8] ?? '';
    if (memo.includes('[검수:기계가능]')) out.can++;
    if (memo.includes('[검수:기계불가]')) out.cannot++;
    for (const [, kind, name] of memo.matchAll(/\[(린트|린트오탐|린트우회):([^\]]+)\]/g)) {
      const r = rule(name.trim());
      if (kind === '린트') r.added++;
      else if (kind === '린트오탐') r.falsePositive++;
      else r.bypass++;
    }
  }
  return out;
}

function lint(flags) {
  const since = timeFlag(flags, 'since', 0);
  const rows = readTsv(FIXES_FILE, '시각').filter((c) => Date.parse(c[0]) >= since);
  const r = summarizeLint(rows);
  const total = r.can + r.cannot;
  console.log(total ? `검수 지적 ${total}건 가운데 기계로 잡을 수 있던 것 ${r.can}건(${Math.round((r.can / total) * 100)}%)` : '검수 지적 표시가 없습니다.');
  if (r.rules.size) printTable([['린트 규칙', '넣음', '오탐', '우회'], ...[...r.rules].map(([n, v]) => [n, v.added, v.falsePositive, v.bypass])], 1);
  else console.log('린트 규칙 표시가 없습니다.');
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
  const ev = { skills: [], agents: [], bash: [], talk: [], reads: [], prompts: [] };
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
        if (x.name === 'Read' && typeof x.input?.file_path === 'string') ev.reads.push(x.input.file_path);
        if ((x.name === 'Agent' || x.name === 'Task') && typeof x.input?.prompt === 'string') ev.prompts.push(x.input.prompt);
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

// 프로젝트 문서는 절 이름을 말하는 일이 드물어 파일째 본다. 폴더 안 상대 경로(예: setup/install_guide.md)가
// 도구 입력(파일 읽기, 셸 명령)이나 대화에 나오면 쓴 것으로 센다. 이름이 같은 파일이 여러 폴더에 있어도 가르려고 상대 경로를 쓴다.
export function fileItems(paths) {
  const out = [];
  for (const root of paths) {
    if (!fs.existsSync(root)) continue;
    const files = fs.statSync(root).isDirectory() ? walkFiles(root, (n) => n.endsWith('.md')) : [root];
    for (const f of files) {
      const rel = fs.statSync(root).isDirectory() ? path.relative(root, f).split(path.sep).join('/') : path.basename(f);
      if (/(^|\/)_temp\//.test(rel)) continue;
      out.push({ kind: '문서 파일', name: rel, hit: (ev) => ev.talk.some((t) => t.includes(rel)) || ev.bash.some((t) => t.includes(rel)), needles: [escapeRe(rel)] });
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
    ...(flags.files && (kind === 'all' || kind === 'files') ? fileItems(flags.files) : []),
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

// 대화 기록에서 질문 창(AskUserQuestion) 호출의 질문 수를 센다. 한 호출에 질문이 여럿이면 질문마다 센다. 호출 id가 같은 중복 기록은 한 번만 센다.
export function countAskWindowQuestions(file) {
  const seen = new Set();
  const found = [];
  for (const d of jsonlRows(file)) {
    const c = d.message?.content;
    if (d.type !== 'assistant' || !Array.isArray(c)) continue;
    for (const x of c) {
      if (x?.type !== 'tool_use' || x.name !== 'AskUserQuestion') continue;
      if (x.id) {
        if (seen.has(x.id)) continue;
        seen.add(x.id);
      }
      const q = Array.isArray(x.input?.questions) ? x.input.questions.length : 1;
      found.push({ ts: d.timestamp, n: Math.max(q, 1) });
    }
  }
  return found;
}

const NO_COMPANY = '회사 규칙 없음';

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
  // 정할 것 셈은 회사 규칙(보고 모양)이 깔렸을 때만 한다. 질문 창 셈은 선택지 받는 꼴이 질문 창일 때만 한다.
  const hasCompany = lockApi.hasBundle('company');
  const windowForm = userSettings.readUserSettings().values.choiceForm === '질문 창';
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
      g.reports++;
      if (!hasCompany) continue;
      const n = countDecisionLines(r.text);
      if (n > 0) g.asked++;
      g.lines += n;
    }
    if (windowForm) {
      for (const a of countAskWindowQuestions(s.file)) {
        const t = Date.parse(a.ts);
        if (!(t >= since && t <= now)) continue;
        const g = day(t);
        g.windowQ = (g.windowQ ?? 0) + a.n;
      }
    }
  }
  const byHook = new Map();
  const refused = new Map();
  const byTarget = new Map();
  const sessionFiles = new Map(listSessions().map((x) => [path.basename(x.file, '.jsonl'), x.file]));
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
      // 막는 훅이 Claude에게 거절만 돌려준 줄(rm-guard:deny, rm-guard:trash)은 사용자 화면에 창이 뜨지 않아 따로 센다.
      // 왜: 거절까지 확인 창으로 세어 창 수가 실제보다 많이 찍혔다(11-08 검토). 전제: 훅 이름 끝의 :deny, :trash는 거절 표시다.
      if (/:(?:deny|trash)$/.test(d.hook ?? '')) {
        refused.set(d.hook, (refused.get(d.hook) ?? 0) + 1);
        continue;
      }
      askTotal++;
      day(t).asks++;
      byHook.set(d.hook ?? '?', (byHook.get(d.hook ?? '?') ?? 0) + 1);
      // 바깥 도구(MCP) 창은 어느 대상(DB 프로젝트 등)을 향했는지 대화 기록의 같은 호출에서 찾는다. 운영과 개발을 갈라 개발 쪽만 풀 후보로 보려는 것이다.
      if (typeof d.tool === 'string' && d.tool.startsWith('mcp__')) {
        const target = mcpTarget(d, sessionFiles);
        const k = `${d.tool.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, '')} ${target}`;
        byTarget.set(k, (byTarget.get(k) ?? 0) + 1);
      }
    }
  } else console.log(`확인 창 기록이 없습니다: ${askFile}`);
  const all = [...days.values()].reduce((a, g) => ({ reports: a.reports + g.reports, asked: a.asked + g.asked, lines: a.lines + g.lines, asks: a.asks + g.asks, windowQ: a.windowQ + (g.windowQ ?? 0) }), { reports: 0, asked: 0, lines: 0, asks: 0, windowQ: 0 });
  const cell = (v) => (hasCompany ? v : NO_COMPANY);
  console.log(`기간: ${localDate(since)} 이후, 세션 ${sessions}개${projectFilter ? `, 프로젝트 ${projectFilter}` : ''}`);
  const head = ['날짜', '최종 보고', '정할 것 있는 보고', '정할 것 줄', '확인 창'];
  if (windowForm) head.push('질문 창');
  const row = (k, g) => [k, g.reports, cell(g.asked), cell(g.lines), g.asks, ...(windowForm ? [g.windowQ ?? 0] : [])];
  printTable([head, ...[...days].sort((a, b) => a[0].localeCompare(b[0])).map(([k, g]) => row(k, g)), row('합계', all)], 1);
  if (!hasCompany) console.log(`\n사용자에게 온 질문: 정할 것 ${NO_COMPANY} + 확인 창 ${askTotal}건${windowForm ? ` + 질문 창 ${all.windowQ}건` : ''} = ${askTotal + all.windowQ}건`);
  else console.log(`\n사용자에게 온 질문: 정할 것 ${all.lines}줄 + 확인 창 ${askTotal}건${windowForm ? ` + 질문 창 ${all.windowQ}건` : ''} = ${all.lines + askTotal + all.windowQ}건 (정할 것이 있는 보고 ${all.asked}건당 평균 ${all.asked ? (all.lines / all.asked).toFixed(2) : '-'}줄)`);
  if (byHook.size) console.log(`확인 창을 띄운 훅: ${[...byHook].sort((a, b) => b[1] - a[1]).map(([h, n]) => `${h} ${n}`).join(', ')}`);
  if (byTarget.size) console.log(`바깥 도구 창의 대상(도구 대상): ${[...byTarget].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  if (refused.size) console.log(`창이 아닌 거절(Claude만 받음, 위 수에서 뺌): ${[...refused].map(([h, n]) => `${h} ${n}`).join(', ')}`);
}

// 확인 창 기록 한 줄의 바깥 도구 호출이 향한 대상. 기록에는 조회어만 남아, 같은 세션 대화 기록에서 같은 도구와 같은 입력 앞부분의 호출을 찾아 project_id류 값을 읽는다. 못 찾으면 「모름」.
const targetCache = new Map();
function mcpTarget(d, sessionFiles) {
  const file = sessionFiles.get(d.session ?? '');
  if (!file) return mcpServerTarget(d);
  if (!targetCache.has(file)) {
    const calls = [];
    try {
      for (const line of splitLines(fs.readFileSync(file, 'utf8'))) {
        if (!line.includes('"tool_use"') || !line.includes('mcp__')) continue;
        let o;
        try { o = JSON.parse(line); } catch { continue; }
        for (const c of o?.message?.content ?? []) if (c?.type === 'tool_use' && String(c.name).startsWith('mcp__')) calls.push(c);
      }
    } catch { /* 못 읽음 */ }
    targetCache.set(file, calls);
  }
  const head = String(d.input ?? '').slice(0, 200);
  for (const c of targetCache.get(file)) {
    if (c.name !== d.tool) continue;
    const inp = c.input ?? {};
    if (String(inp.command || inp.query || JSON.stringify(inp)).slice(0, 200) !== head) continue;
    if (inp.project_id || inp.project_ref || inp.projectId) return String(inp.project_id || inp.project_ref || inp.projectId);
    return mcpServerTarget(d);
  }
  return mcpServerTarget(d);
}

// 호출 입력에 대상이 없으면 그 폴더의 .mcp.json에서 같은 서버 주소의 project_ref를 읽는다(서버가 한 프로젝트에 묶인 설정). 없으면 「모름」.
function mcpServerTarget(d) {
  const server = String(d.tool ?? '').split('__')[1] ?? '';
  // 세션 폴더가 저장소 안 하위 폴더일 수 있어 위로 올라가며 처음 만나는 .mcp.json을 쓴다.
  let dir = typeof d.cwd === 'string' ? d.cwd : '';
  let file = '';
  while (dir && dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.mcp.json'))) { file = path.join(dir, '.mcp.json'); break; }
    dir = path.dirname(dir);
  }
  try {
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    const url = String(cfg?.mcpServers?.[server]?.url ?? '');
    const m = /[?&]project_ref=([\w-]+)/.exec(url);
    if (m) return `${m[1]}(서버 고정)`;
  } catch { /* 설정 없음 */ }
  return '모름';
}

// git log --numstat --format=@<시각> 출력을 날짜별 { add, del, newFiles, goneFiles }로 모은다. 이름 바꿈({a => b})은 증감만 센다.
export function docsByDay(numstatText, statusText) {
  const days = new Map();
  const day = (k) => {
    if (!days.has(k)) days.set(k, { add: 0, del: 0, newFiles: 0, goneFiles: 0 });
    return days.get(k);
  };
  let cur = null;
  for (const line of splitLines(numstatText)) {
    if (line.startsWith('@')) { cur = day(localDate(Number(line.slice(1)) * 1000)); continue; }
    const m = /^(\d+|-)\t(\d+|-)\t/.exec(line);
    if (m && cur) { cur.add += m[1] === '-' ? 0 : Number(m[1]); cur.del += m[2] === '-' ? 0 : Number(m[2]); }
  }
  cur = null;
  for (const line of splitLines(statusText)) {
    if (line.startsWith('@')) { cur = day(localDate(Number(line.slice(1)) * 1000)); continue; }
    if (!cur) continue;
    if (/^A\t/.test(line)) cur.newFiles++;
    else if (/^D\t/.test(line)) cur.goneFiles++;
  }
  return days;
}

function docs(flags) {
  const days = Number(one(flags, 'days') ?? 7);
  const top = (dir) => {
    const r = spawnSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
    return r.status === 0 ? r.stdout.trim() : null;
  };
  const repos = [...new Set((flags.repo ?? [process.cwd(), CLAUDE_DIR]).map(top).filter(Boolean))];
  if (!repos.length) fail('git 저장소를 찾지 못했습니다. --repo <저장소>를 주세요.');
  for (const repo of repos) {
    const git = (args) => spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout ?? '';
    const range = [`--since=${days}.days`, '--no-merges'];
    const byDay = docsByDay(git(['log', ...range, '--numstat', '--format=@%ct', '--', '*.md']), git(['log', ...range, '--name-status', '--format=@%ct', '--', '*.md']));
    const files = splitLines(git(['ls-files', '--', '*.md']));
    let lines = 0;
    for (const f of files) {
      try { lines += splitLines(fs.readFileSync(path.join(repo, f), 'utf8')).length; } catch { /* 지워진 파일 */ }
    }
    // git이 보지 않는 문서도 센다. 진행 기록과 임시 산출물이 커밋 없이 쌓여 늘기만 하는 것을 놓치지 않게(검수 3회차 13번).
    // 의존성, 플러그인, 키트 사본, 백업, 다른 워크트리는 우리가 쓴 문서가 아니거나 같은 문서의 사본이라 뺀다.
    const outside = (extra) => {
      const fs2 = splitLines(git(['ls-files', '--others', ...extra, '--exclude-standard', '--', '*.md'])).filter((f) => !/(?:^|\/)(?:node_modules|\.git|vendor|plugins|\.kit-base|worktrees|[^/]*-backup-[^/]*)\//.test(f));
      let n = 0;
      for (const f of fs2) { try { n += splitLines(fs.readFileSync(path.join(repo, f), 'utf8')).length; } catch { /* 사라진 파일 */ } }
      return `${fs2.length}개, ${n}줄`;
    };
    const rows = [...byDay].sort((a, b) => a[0].localeCompare(b[0])).map(([k, g]) => [k, g.add, g.del, g.add - g.del, g.newFiles, g.goneFiles]);
    const sum = rows.reduce((a, r) => a.map((v, i) => (i ? v + r[i] : v)), ['합계', 0, 0, 0, 0, 0]);
    console.log(`\n${repo}  지금 문서 ${files.length}개, ${lines}줄 (최근 ${days}일)`);
    console.log(`  git 밖 문서: 추적 안 함 ${outside([])}, 무시됨 ${outside(['--ignored'])}`);
    printTable([['날짜', '더한 줄', '뺀 줄', '순증', '새 파일', '지운 파일'], ...rows, sum], 1);
  }
}

// 낭비 넷: 회고 때 같은 모양으로 재서 앞 회고와 견주게 한다. 아무것도 쓰지 않는다.
// 까닭: 사용자가 짚은 낭비(막는 장치, 문서 읽기, 문서 불어남, 같은 말 되풀이)를 손셈 없이 숫자로 보려는 것이다.

// ④ 「다시」 꼴: 같은 말을 다시 시키거나 되풀이해 묻는 차례. 정의는 RETRO 「낭비의 꼴」 1번(통째로 다시 함)과 5번(같은 탐색 되풀이)에 맞춘다.
// 「또는」 「또한」 「다시마」 같은 다른 낱말은 세지 않는다. 「왜 안 되는지」 같은 물음도 되풀이가 아니라 세지 않는다.
const AGAIN_FORM = /(?:^|[\s,.!?])(?:다시(?!마)|또(?!는|한|래|박)|재차|아까\s*말|말했(?:잖|는데)|왜\s*또)/u;
const normPrompt = (t) => t.replace(/[\s\p{P}]+/gu, '').toLowerCase().slice(0, 60);

// 사용자가 친 차례만 글로 모은다(도구 결과, 메타 줄, 시스템 알림 제외).
export function userTurns(file) {
  const out = [];
  for (const d of jsonlRows(file)) {
    const c = d.message?.content;
    if (d.type !== 'user' || !d.message || d.isMeta) continue;
    const text = typeof c === 'string' ? c : Array.isArray(c) && !c.some((x) => x?.type === 'tool_result') ? c.filter((x) => x?.type === 'text').map((x) => x.text).join('\n') : '';
    if (!text.trim() || /^\s*(?:<(?:system-reminder|command-|local-command|task-notification|teammate-message|artifact-content)|Another Claude session sent|This session is being continued|\/compact)/.test(text)) continue;
    out.push({ text, ts: d.timestamp });
  }
  return out;
}

// 차례 목록에서 같은 질문 되풀이(앞에 같은 글이 있음)와 「다시」 꼴 차례 수를 센다.
export function conversationWaste(turns) {
  const seen = new Set();
  let repeats = 0;
  let again = 0;
  for (const t of turns) {
    const k = normPrompt(t.text);
    if (k.length >= 8) {
      if (seen.has(k)) repeats++;
      seen.add(k);
    }
    if (AGAIN_FORM.test(t.text)) again++;
  }
  return { turns: turns.length, repeats, again };
}

// ② 대화 기록의 Read 호출 가운데 .md 파일을 센다. 읽은 글자는 그 호출의 결과 길이다.
export function docReads(file) {
  const pending = new Map();
  let calls = 0;
  let chars = 0;
  for (const d of jsonlRows(file)) {
    const c = d.message?.content;
    if (!Array.isArray(c)) continue;
    for (const x of c) {
      if (d.type === 'assistant' && x?.type === 'tool_use' && x.name === 'Read' && /\.md$/i.test(String(x.input?.file_path ?? ''))) pending.set(x.id, true);
      else if (d.type === 'user' && x?.type === 'tool_result' && pending.has(x.tool_use_id)) {
        pending.delete(x.tool_use_id);
        calls++;
        chars += typeof x.content === 'string' ? x.content.length : Array.isArray(x.content) ? x.content.reduce((a, y) => a + (typeof y?.text === 'string' ? y.text.length : 0), 0) : 0;
      }
    }
  }
  return { calls, chars };
}

// ③ 저장소의 .md 순증(더한 줄 - 뺀 줄)과 파일 증감 합. docs 하위 명령과 같은 셈이다.
function docNet(repo, days) {
  const git = (args) => spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout ?? '';
  const range = [`--since=${days}.days`, '--no-merges'];
  const byDay = docsByDay(git(['log', ...range, '--numstat', '--format=@%ct', '--', '*.md']), git(['log', ...range, '--name-status', '--format=@%ct', '--', '*.md']));
  return [...byDay.values()].reduce((a, g) => ({ add: a.add + g.add, del: a.del + g.del, newFiles: a.newFiles + g.newFiles, goneFiles: a.goneFiles + g.goneFiles }), { add: 0, del: 0, newFiles: 0, goneFiles: 0 });
}

// ⑤ 장치 층: 깐 훅 수, 늘 읽는 글자, 훅이 대화에 넣은 글자, 한 번도 걸리지 않은 훅을 재고 앞 값과 견준다.
// 왜: 장치가 늘 때마다 막은 수만 보면 장치 층 전체가 커지는 것이 안 보인다(대표 지시 2026-11-08). 전제: 훅 글자 수는 감싸개(kit-hook.cjs)가 hook-output.tsv에 남기므로 감싸개를 거치지 않는 훅은 세지 않는다.
const DEVICE_HISTORY = path.join(RECORDS_DIR, 'device-layer-history.tsv');

// settings.json의 훅 수(이벤트별)와 감싸개 이름표.
export function hookCensus(settings) {
  const byEvent = {};
  const names = [];
  for (const [event, groups] of Object.entries(settings?.hooks ?? {})) {
    for (const g of Array.isArray(groups) ? groups : []) {
      for (const h of Array.isArray(g?.hooks) ? g.hooks : []) {
        byEvent[event] = (byEvent[event] ?? 0) + 1;
        const m = /kit-hook\.cjs"?\s+(\S+)\s/.exec(String(h?.command ?? ''));
        if (m) names.push(m[1]);
      }
    }
  }
  return { byEvent, total: Object.values(byEvent).reduce((a, n) => a + n, 0), names: [...new Set(names)] };
}

// 늘 읽는 글자: 설정 폴더의 CLAUDE.md, rules/*.md, 그것들이 @로 부르는 문서(재귀).
export function alwaysReadChars(dir) {
  const seen = new Map();
  const visit = (file) => {
    const f = path.resolve(file);
    if (seen.has(f) || !fs.existsSync(f) || !fs.statSync(f).isFile()) return;
    const text = fs.readFileSync(f, 'utf8');
    seen.set(f, text.length);
    for (const m of text.matchAll(/(?:^|\s)@((?:~\/|\.{0,2}\/)?[\w.\-/]+\.md)\b/g)) {
      visit(m[1].startsWith('~/') ? path.join(os.homedir(), m[1].slice(2)) : path.resolve(path.dirname(f), m[1]));
    }
  };
  visit(path.join(dir, 'CLAUDE.md'));
  const rules = path.join(dir, 'rules');
  if (fs.existsSync(rules)) for (const n of fs.readdirSync(rules).sort()) if (n.endsWith('.md')) visit(path.join(rules, n));
  return { total: [...seen.values()].reduce((a, n) => a + n, 0), files: seen.size };
}

// hook-output.tsv 줄(시각, 이름, 글자)을 훅별로 묶는다.
export function outputByHook(rows) {
  const m = new Map();
  for (const c of rows) {
    const n = Number(c[2]);
    if (!Number.isFinite(n)) continue;
    const e = m.get(c[1]) ?? m.set(c[1], { runs: 0, chars: 0 }).get(c[1]);
    e.runs++;
    e.chars += n;
  }
  return m;
}

// 뺄 후보를 띄우려면 기록이 이 날수는 쌓여 있어야 한다. 하루치로 훅 11개를 띄운 일이 있었다(11-08).
const MIN_DEVICE_DAYS = 7;
// 한 세션에서 이만큼 넘게 같은 장치가 막으면 비율이 절반 아래여도 좁힐 후보다(결정 대조가 한 세션 46번 막았는데 비율은 43%라 빠졌다).
const SESSION_MAX_BLOCKS = 10;
// 하루치로 나눌 때 기간의 바닥(일). 바닥이 1일이면 하루보다 짧은 구간은 합계가 그대로 하루 평균이 되어, 시간만 흘러도 늘어난 것으로 찍힌다.
const RATE_FLOOR_DAYS = 1 / 24;

function deviceLayer({ sinceLabel, since, now, caught, narrow, record }) {
  console.log('\n⑤ 장치 층');
  let settings = null;
  try {
    settings = JSON.parse(fs.readFileSync(path.join(CLAUDE_DIR, 'settings.json'), 'utf8'));
  } catch {
    // 설정이 없거나 깨졌으면 훅 수는 0으로 둔다.
  }
  const census = hookCensus(settings);
  const reading = alwaysReadChars(CLAUDE_DIR);
  console.log(`  깐 훅 ${census.total}개${Object.entries(census.byEvent).map(([e, n]) => ` ${e} ${n}`).join(',')} (감싸개를 거치는 훅 ${census.names.length}개)`);
  console.log(`  늘 읽는 글자: ${reading.total} (설정 폴더 CLAUDE.md, rules, @로 부르는 문서 ${reading.files}개)`);

  const outFile = path.join(RECORDS_DIR, 'hook-output.tsv');
  const rows = readTsv(outFile, '시각').filter((c) => atOrAfter(c[0], since));
  let injectedPerDay = null;
  const fired = new Set();
  let windowLabel = sinceLabel;
  let windowStart = since;
  if (!rows.length) {
    console.log('  훅이 대화에 넣은 글자: 기록 없음(hook-output.tsv는 감싸개를 새로 깐 뒤부터 쌓임). 한 번도 걸리지 않은 훅 판정 보류');
  } else {
    const first = rows.reduce((a, c) => (c[0] < a ? c[0] : a), rows[0][0]);
    // 기록은 첫 줄부터 믿을 수 있으므로 판정 기간은 그날부터다.
    if (first.slice(0, 10) > sinceLabel.slice(0, 10)) {
      windowLabel = first.slice(0, 10);
      windowStart = Date.parse(`${windowLabel}T00:00:00`);
    }
    const by = outputByHook(rows);
    const total = [...by.values()].reduce((a, e) => a + e.chars, 0);
    const effDays = Math.max(RATE_FLOOR_DAYS, (now - windowStart) / 86400000);
    injectedPerDay = Math.round(total / effDays);
    console.log(`  훅이 대화에 넣은 글자: 합계 ${total}, 하루 평균 ${injectedPerDay} (${windowLabel}부터 ${effDays.toFixed(2)}일)`);
    for (const [h, e] of [...by].sort((a, b) => b[1].chars - a[1].chars)) console.log(`    ${h}: ${e.runs}번, ${e.chars}자`);
    for (const h of by.keys()) fired.add(h);
  }
  const blockNames = readTsv(path.join(RECORDS_DIR, 'hook-blocks.tsv'), '시각').filter((c) => atOrAfter(c[0], windowStart)).map((c) => c[2] ?? '');
  const never = rows.length ? census.names.filter((n) => !fired.has(n) && !blockNames.some((b) => b.includes(n))) : [];
  if (rows.length) {
    const recordDays = Math.floor((now - windowStart) / 86400000);
    if (recordDays < MIN_DEVICE_DAYS) console.log(`  뺄 후보: 판정 보류(기록 ${Math.max(0, recordDays)}일, ${MIN_DEVICE_DAYS}일은 쌓여야 띄운다)`);
    else {
      console.log(`  뺄 후보(${windowLabel}부터 ${recordDays}일, 막음도 넣은 글자도 없는 훅): ${never.length ? never.join(', ') : '없음'}`);
      console.log('    (훅 안에서 말이 없는 채 기록만 하는 훅이면 막거나 넣는 일이 원래 없다. 뺄지는 그 훅의 목적으로 가른다)');
    }
  }
  if (narrow.length) console.log(`  좁힐 후보(① 헛막음이 잡은 수보다 많음, 또는 한 세션 최대가 ${SESSION_MAX_BLOCKS}번을 넘음): ${narrow.join(', ')}`);

  // 앞 값과 견주기
  const prevRows = readTsv(DEVICE_HISTORY, '시각');
  const prev = prevRows.at(-1);
  // 잡은 수는 --since 구간의 합이라 구간 길이가 다른 회고끼리 견주려면 하루치로 나눈다. 기간 일수는 기록의 여섯째 열이고, 그 열이 없는 옛 줄과는 하루치를 견주지 않는다.
  const days = Math.max(RATE_FLOOR_DAYS, (now - since) / 86400000);
  const now5 = { hooks: census.total, reading: reading.total, injected: injectedPerDay, caught, days };
  if (!prev) console.log('  앞 값: 없음(--record로 남기면 다음 회고부터 견준다)');
  else {
    const num = (v) => (v === undefined || v === '' ? null : Number(v));
    const p = { hooks: Number(prev[1]), reading: Number(prev[2]), injected: num(prev[3]), caught: num(prev[4]), days: num(prev[5]) };
    const rated = p.days !== null && Number.isFinite(p.days) && p.days > 0;
    const perDay = (n, dd) => (n === null || !Number.isFinite(n) ? null : Math.round(n / dd));
    const caughtNow = perDay(now5.caught, now5.days);
    const caughtPrev = rated ? perDay(p.caught, p.days) : null;
    const d = (a, b) => (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b) ? '비교 불가' : `${b - a >= 0 ? '+' : ''}${b - a}`);
    const noDays = rated ? '' : ', 앞 값에 기간이 없어 하루치는 견주지 않음';
    console.log(`  앞 값(${prev[0]})과 견줌: 훅 ${p.hooks} → ${now5.hooks} (${d(p.hooks, now5.hooks)}), 늘 읽는 글자 ${p.reading} → ${now5.reading} (${d(p.reading, now5.reading)}), 하루 넣은 글자 ${rated ? p.injected ?? '-' : '-'} → ${now5.injected ?? '-'} (${d(rated ? p.injected : null, now5.injected)}), 하루 잡은 수 ${caughtPrev ?? '-'} → ${caughtNow ?? '-'} (${d(caughtPrev, caughtNow)})${noDays}`);
    const grew = [];
    if (now5.hooks > p.hooks) grew.push('훅 수');
    if (now5.reading > p.reading) grew.push('늘 읽는 글자');
    if (rated && p.injected !== null && now5.injected !== null && now5.injected > p.injected * 1.1) grew.push('훅이 넣는 글자');
    if (grew.length) {
      const more = caughtPrev !== null && caughtNow !== null && caughtNow > caughtPrev;
      console.log(more ? `  늘어난 쪽: ${grew.join(', ')}. 잡은 수도 늘었다.` : `  늘어난 쪽: ${grew.join(', ')}. 잡은 수는 늘지 않았다: 좁히거나 빼거나 기계 검사(린트, 커밋 때 검사)로 옮길 후보로 올린다.`);
    } else console.log('  늘어난 쪽: 없음');
  }
  if (record) {
    const line = [new Date(now).toISOString(), now5.hooks, now5.reading, now5.injected ?? '', now5.caught ?? '', now5.days.toFixed(3)].join('\t');
    appendWithHeader(DEVICE_HISTORY, '시각\t훅 수\t늘 읽는 글자\t하루 넣은 글자\t잡은 수\t기간 일수', [line]);
    console.log(`  기록함: ${DEVICE_HISTORY}`);
  }
}

async function waste(flags) {
  const now = Date.now();
  const sinceDate = one(flags, 'since');
  // 회고의 「추출 시작 시점」은 시각(ISO)으로 찍혀 그대로 넘겨도 받는다. 날짜만 오면 그날 0시(로컬)다.
  const sinceIsTime = sinceDate !== undefined && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(sinceDate) && !Number.isNaN(Date.parse(sinceDate));
  if (sinceDate !== undefined && !sinceIsTime && !/^\d{4}-\d{2}-\d{2}$/.test(sinceDate)) fail('--since에는 YYYY-MM-DD 날짜나 ISO 시각을 줍니다.');
  const days = Number(one(flags, 'days') ?? 7);
  const since = sinceIsTime ? Date.parse(sinceDate) : sinceDate ? Date.parse(`${sinceDate}T00:00:00`) : now - days * 86400000;
  const sinceLabel = sinceDate ?? localDate(since);
  console.log(`낭비 넷 (${sinceLabel} 이후)`);

  // ① 막는 장치 비용
  const timeRows = readTsv(path.join(RECORDS_DIR, 'hook-time.tsv'), '시각').filter((c) => atOrAfter(c[0], since));
  let totalMs = 0;
  let broken = 0;
  for (const c of timeRows) {
    const n = Number(c[2]);
    if (c[2] !== '' && Number.isFinite(n)) totalMs += n;
    if ((c[3] ?? '').startsWith('끊김')) broken++;
  }
  console.log(`\n① 막는 장치 비용\n  훅 시간: ${timeRows.length}건, 끊김 ${broken}건, 합계 ${totalMs}ms (0.5초 넘게 걸린 실행과 끊김만 기록됨)`);
  let caught = null;
  const narrow = [];
  let helpers = null;
  const helperFile = path.join(SELF_DIR, 'fixLogHelpers.js');
  if (lockApi.hasBundle('feedback') && fs.existsSync(helperFile)) helpers = await import(pathToFileURL(helperFile).href);
  if (!helpers) console.log('  막음과 오탐 후보: 피드백 없음');
  else {
    const read = (f) => (fs.existsSync(path.join(RECORDS_DIR, f)) ? fs.readFileSync(path.join(RECORDS_DIR, f), 'utf8') : '');
    const stats = helpers.hookStats({ timeText: '', blocksText: read('hook-blocks.tsv'), falsePositiveText: read('hook-false-positive.tsv'), since });
    const sum = (m) => [...m.values()].reduce((a, e) => a + e.count, 0);
    console.log(`  막음: ${sum(stats.blocks)}건${[...stats.blocks].map(([h, e]) => ` ${h} ${e.count}`).join(',')}`);
    // 이유 열이 「오탐 후보」인 줄만 오탐 후보다. 「지시된 재시도」처럼 다른 이유는 따로 센다.
    const split = (want) => new Map([...stats.falsePositives].filter(([k]) => (k.split('\t')[1] === '오탐 후보') === want));
    const show = (m) => `${sum(m)}건${[...m].map(([k, e]) => ` ${k.replace('\t', '/')} ${e.count}`).join(',')}`;
    console.log(`  오탐 후보: ${show(split(true))}`);
    console.log(`  지시된 재시도 등 다른 이유: ${show(split(false))}`);
    // 장치마다 헛막음 후보(막힌 뒤 같은 입력을 그대로 다시 내 통과했거나, 답 끝 막음 뒤 고친 것 없이 한 줄만 단 것)를 막음과 견준다.
    // 왜: 이유 열로만 가르면 「지시된 재시도」가 오탐에서 빠져 헛막음이 0건으로 찍혔다(11-08 검토). 전제: 다시 내서 그대로 통과한 막음은 그 차례에 잡은 것이 없다.
    const rows = (f) => read(f).split('\n').map((l) => l.split('\t')).filter((c) => /^\d{4}-/.test(c[0] ?? '') && atOrAfter(c[0], since));
    const per = new Map();
    const get = (h) => per.get(h) ?? per.set(h, { blocks: 0, empty: 0, sessions: new Map() }).get(h);
    for (const c of rows('hook-blocks.tsv')) {
      const e = get(c[2] ?? '');
      e.blocks++;
      e.sessions.set(c[1] ?? '', (e.sessions.get(c[1] ?? '') ?? 0) + 1);
    }
    for (const c of rows('hook-false-positive.tsv')) if ((c[4] ?? '') === '통과') get(c[2] ?? '').empty++;
    caught = [...per.values()].reduce((a, e) => a + Math.max(0, e.blocks - e.empty), 0);
    if (per.size) {
      console.log('  장치별 헛막음 후보(막음 / 다시 내 통과나 고친 것 없음 / 한 세션 최대):');
      for (const [h, e] of [...per].sort((a, b) => b[1].blocks - a[1].blocks)) {
        const top = Math.max(0, ...e.sessions.values());
        const flag = e.empty > e.blocks - e.empty ? ' 좁힐 후보' : top > SESSION_MAX_BLOCKS ? ` 좁힐 후보(한 세션 ${SESSION_MAX_BLOCKS}번 넘음)` : '';
        if (flag) narrow.push(h);
        console.log(`    ${h}: ${e.blocks} / ${e.empty} / ${top}${flag}`);
      }
    }
  }

  // ②, ④ 대화 기록
  let reads = { calls: 0, chars: 0 };
  let conv = { turns: 0, repeats: 0, again: 0 };
  let sessions = 0;
  for (const s of listSessions().filter((x) => x.mtime >= since)) {
    sessions++;
    const r = docReads(s.file);
    reads.calls += r.calls;
    reads.chars += r.chars;
    const w = conversationWaste(userTurns(s.file).filter((t) => Date.parse(t.ts) >= since));
    conv = { turns: conv.turns + w.turns, repeats: conv.repeats + w.repeats, again: conv.again + w.again };
  }
  console.log(`\n② 문서 읽기 비용 (세션 ${sessions}개)\n  .md Read 호출 ${reads.calls}건, 읽은 글자 ${reads.chars}`);

  // ③ 문서 순증
  console.log('\n③ 문서 순증 (docs 하위 명령의 합)');
  const repos = [...new Set((flags.repo ?? [process.cwd(), CLAUDE_DIR]).map((d) => {
    const r = spawnSync('git', ['-C', d, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
    return r.status === 0 ? r.stdout.trim() : null;
  }).filter(Boolean))];
  if (!repos.length) console.log('  git 저장소 없음');
  const span = Math.max(1, Math.ceil((now - since) / 86400000));
  for (const repo of repos) {
    const g = docNet(repo, span);
    console.log(`  ${repo}: 더한 ${g.add}줄, 뺀 ${g.del}줄, 순증 ${g.add - g.del}줄, 새 파일 ${g.newFiles}, 지운 파일 ${g.goneFiles}`);
  }

  console.log(`\n④ 대화 낭비\n  사용자 차례 ${conv.turns}개 가운데 같은 말 되풀이 ${conv.repeats}개, 「다시」 꼴 ${conv.again}개`);

  deviceLayer({ sinceLabel, since, now, caught, narrow, record: flags.record !== undefined });
}

// 장치 전체 셈. 목록은 등록(settings.json, 깐 상태 기록)과 파일(설정 폴더, 키트 원본)에서 뽑아 장치가 늘거나 줄어도 고치지 않는다.
// 왜: 막는 장치 효과(waste ①)는 막은 장치만, unused는 스킬과 정의만 봐서, 쓰이지 않는 훅과 커밋 훅, 헛막음이 많은 판정을 한 표로 볼 수 없었다(11-10).
async function devices(flags) {
  const now = Date.now();
  const days = number(flags, 'days', 30);
  const since = now - days * 86400000;
  const config = readJsonFile(path.join(CLAUDE_DIR, 'subagent-system', 'config.json')) ?? {};
  const kitGiven = one(flags, 'kit') ?? (typeof config.kitSourcePath === 'string' ? config.kitSourcePath.trim() : '');
  const kitDir = kitGiven && fs.existsSync(kitGiven) ? path.resolve(kitGiven) : '';
  const settings = readJsonFile(path.join(CLAUDE_DIR, 'settings.json'));
  const lock = lockApi.readLock(CLAUDE_DIR);
  const inv = inventory({ configDir: CLAUDE_DIR, kitDir, settings, lock });
  let events = [];
  let scanned = 0;
  if (flags['no-transcripts'] === undefined) {
    const files = candidateFiles(PROJECTS_ROOT, since);
    const seen = new Set();
    for (const f of files) {
      const scan = await scanTranscript(f, since);
      events.push(...blockEvents(inv.devices, [scan], seen));
      scanned++;
    }
  }
  // 스킬은 Skill 도구로 부른 것(부름)과, 그 스킬 폴더의 파일을 Read로 읽거나 그 폴더의 스크립트를 돌리거나 실무자 지시에 그 경로를 준 것(읽음)을 따로 센다.
  // 고치기, 찾기, 옮기기(Edit, grep, cp)는 쓰임이 아니라 뺀다(키트 손질이 쓰임으로 잡히지 않게).
  const items = [];
  const key = new Map();
  for (const d of inv.devices.filter((x) => x.kind === '스킬' && !x.notInstalled)) {
    const call = { kind: '스킬', name: d.name, hit: (ev) => ev.skills.some((s) => s === d.name || s.endsWith(`:${d.name}`)), needles: [`"skill":"(?:[^":]*:)?${escapeRe(d.name)}"`, `<command-name>/?(?:[^<:]*:)?${escapeRe(d.name)}</command-name>`] };
    const needle = `skills/${d.name}/`;
    const runs = new RegExp(`(?:^|[\\s;&|(])(?:python3?|node|bash|sh|blender)\\b[^;&|\\n]*${escapeRe(needle)}`);
    const read = { kind: '스킬', name: d.name, hit: (ev) => ev.reads.some((f) => f.includes(needle)) || ev.prompts.some((t) => t.includes(needle)) || ev.bash.some((b) => runs.test(b)), needles: [escapeRe(needle)] };
    items.push(call, read);
    key.set(call, [d, 'calls']);
    key.set(read, [d, 'reads']);
  }
  for (const d of inv.devices.filter((x) => x.kind === '정의')) {
    const call = { kind: '정의', name: d.name, hit: (ev) => ev.agents.includes(d.name), needles: [`"subagent_type":"${escapeRe(d.name)}"`] };
    items.push(call);
    key.set(call, [d, 'calls']);
  }
  const usage = new Map();
  if (items.length) {
    const stat = await lastUses(items, PROJECTS_ROOT);
    for (const [item, s] of stat) {
      const [d, field] = key.get(item);
      const u = usage.get(`${d.kind}\t${d.name}`) ?? usage.set(`${d.kind}\t${d.name}`, { calls: 0, reads: 0, last: 0 }).get(`${d.kind}\t${d.name}`);
      // 대화 기록은 보관 기간 전체를 읽으므로 기간 밖 쓰임은 횟수에 넣지 않고 마지막 날만 남긴다.
      if (s.last >= since) u[field] = s.count;
      u.last = Math.max(u.last, s.last);
    }
  }
  const sinceIso = new Date(since).toISOString();
  const commits = new Map(inv.devices.map((d) => [d, commitCount(d, { configDir: CLAUDE_DIR, kitDir, sinceIso })]));
  const fixRows = parseFixes(fs.existsSync(FIXES_FILE) ? fs.readFileSync(FIXES_FILE, 'utf8') : '').filter((f) => Date.parse(f.at) >= since);
  const t = tally({ devices: inv.devices, recordsDir: RECORDS_DIR, configDir: CLAUDE_DIR, since, events, fixRows, usage, commits });
  // 장치 줄 바로 밑에 그 장치의 판정 줄을 막음이 많은 순으로 둔다(표와 json이 같은 차례).
  const busy = (r) => Math.max(r.blocksRec, r.blocksTx);
  t.rows.sort((a, b) => a.device.kind.localeCompare(b.device.kind) || a.device.name.localeCompare(b.device.name) || (a.key === null ? -1 : b.key === null ? 1 : busy(b) - busy(a)));
  if (flags.json !== undefined) {
    const plain = t.rows.map((r) => ({ kind: r.device.kind, name: r.device.name, bundle: r.device.bundle, verdict: r.label, ...Object.fromEntries(Object.entries(r).filter(([k]) => !['device', 'key', 'label', 'sessions'].includes(k))) }));
    return console.log(JSON.stringify({ since: sinceIso, scanned, rows: plain, unmatched: t.unmatched, outside: inv.outside, anomalies: inv.anomalies, recordsFrom: t.recordsFrom }, null, 2));
  }
  const day = (ms) => (ms ? localDate(ms) : '-');
  const counts = {};
  for (const d of inv.devices) counts[d.kind] = (counts[d.kind] ?? 0) + 1;
  const verdicts = t.rows.filter((r) => r.key !== null).length;
  console.log(`장치 셈 (${localDate(since)} 이후 ${days}일, 대화 기록 ${flags['no-transcripts'] === undefined ? `${scanned}개` : '안 읽음'})`);
  console.log(`  장치 ${inv.devices.length}개: ${Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(', ')}, 훅 안 판정 ${verdicts}개. 바깥 도구 훅 ${inv.outside}개는 뺐다.`);
  console.log(`  기록 시작: 막음 기록 ${t.recordsFrom.blocks ?? '-'}, 훅 글 기록 ${t.recordsFrom.output ?? '-'} (그 앞은 대화 기록 막음만 있다)`);
  console.log('\n훅과 커밋 훅 (막음 기록 / 그 가운데 한 세션 최대 / 막음 대화 / 헛막음 후보(Stop 기록+다시 내 통과) / 다른 입력으로 냄 / 알림(막지 않고 대화에 넣은 글 줄, 커밋 훅은 알림 글이 실린 커밋) / 승인 창 / 기록 줄 / 고침 기록·커밋 / 마지막)');
  const hookRows = t.rows.filter((r) => ['훅', '커밋 훅', '부품'].includes(r.device.kind));
  printTable(
    [
      ['갈래', '장치', '묶음', '막음 기록', '세션 최대', '막음 대화', '헛막음', '다른 입력', '알림', '승인 창', '기록 줄', '고침/커밋', '마지막', '실마리'],
      ...hookRows.map((r) => [
        r.key === null ? r.device.kind : '',
        r.key === null ? r.device.name : `  └ ${r.label}`,
        r.key === null ? r.device.bundle : '',
        r.blocksRec,
        r.sessionMax,
        r.blocksTx,
        r.fpStop + r.resendPass,
        r.otherInput,
        r.key === null ? (r.device.kind === '커밋 훅' ? r.notes : Math.max(0, r.runs - r.blocksRec)) : '',
        r.key === null ? r.asks : '',
        r.key === null ? r.records ?? '-' : '',
        `${r.fixes}/${r.key === null ? r.commits : '-'}`,
        day(r.last),
        r.hint,
      ]),
    ],
    3
  );
  console.log('\n스킬과 정의 (부름: Skill 도구와 subagent_type, 읽음: 도구 입력에 든 skills/<이름>/ 경로)');
  const useRows = t.rows.filter((r) => ['스킬', '정의'].includes(r.device.kind));
  printTable([['갈래', '이름', '출처', '부름', '읽음', '고침/커밋', '마지막', '실마리'], ...useRows.map((r) => [r.device.kind, r.device.name, r.device.bundle, r.calls ?? 0, r.device.kind === '스킬' ? r.reads ?? 0 : '-', `${r.fixes}/${r.commits}`, day(r.last), r.hint])], 3);
  console.log('\n짝 맞추기');
  console.log(`  등록과 파일의 짝 없는 장치: ${inv.devices.filter((d) => d.unregistered || d.notInstalled).map((d) => `${d.name}(${d.notInstalled ? '안 깐 묶음' : '등록 없음'})`).join(', ') || '없음'}`);
  if (inv.anomalies.length) console.log(`  깐 상태 기록과 등록이 어긋남: ${inv.anomalies.join('; ')}`);
  // 「[조건]: 」이나 「[command hook N]: 」으로 시작하는 Stop 글은 프로젝트와 목표 조건(/goal 같은)이 단 훅이라 장치가 아니다.
  const outer = t.unmatched.filter((u) => u.name.startsWith('(대화) ['));
  const tx = t.unmatched.filter((u) => u.name.startsWith('(대화)') && !u.name.startsWith('(대화) ['));
  const rec = t.unmatched.filter((u) => !u.name.startsWith('(대화)'));
  console.log(`  기록에만 있는 이름(옛 이름, 걷은 판정) ${rec.length}개: ${rec.map((u) => `${u.name} ${u.n}번(마지막 ${day(u.last)})`).join(', ') || '없음'}`);
  console.log(`  주인 못 가른 대화 막음 ${tx.reduce((a, u) => a + u.n, 0)}건${tx.length ? ` (많은 순: ${tx.slice(0, 5).map((u) => `「${u.name.slice(5, 35)}」 ${u.n}`).join(', ')})` : ''}. 옛 장치나 설정 폴더 밖 훅의 글이다.`);
  console.log(`  장치가 아닌 훅 글(「[조건]: 」 꼴, 프로젝트와 목표 조건 훅) ${outer.reduce((a, u) => a + u.n, 0)}건`);
  console.log('\n읽는 법: 헛막음은 막힌 뒤 같은 입력을 다시 내 통과했거나(도구) 훅이 통과로 적은 것(Stop)이고, 막음에서 헛막음을 뺀 수가 잡은 수의 상한이다. 「다른 입력」은 막힌 뒤 같은 도구를 다른 입력으로 낸 수(고친 수의 실마리)다. 한 사유에 판정이 여럿이면 판정마다 센다. 판정은 RETRO 「막는 장치 효과 보기」와 「규칙 점검」으로 한다.');
}

// 문서 상태 점검. 후보와 증거만 찍고 문서는 건드리지 않는다. 기록은 지표 값(health-history.tsv)뿐이다.
async function health(flags) {
  const days = number(flags, 'days', 3);
  const repos = [...new Set((flags.repo ?? [process.cwd(), CLAUDE_DIR]).map(repoTop).filter(Boolean))];
  if (!repos.length) fail('git 저장소를 찾지 못했습니다. --repo <저장소>를 주세요.');
  const now = Date.now();
  const results = repos.map((repo) => {
    const net = docNet(repo, 7);
    return analyzeRepo(repo, { days, now, projectsRoot: PROJECTS_ROOT, extraMetrics: { '최근 7일 문서 순증 줄': net.add - net.del } });
  });
  const metrics = Object.assign({}, ...results.map((r) => r.metrics));
  const historyFile = healthHistoryFile(RECORDS_DIR);
  const { rose, fresh } = compareMetrics(metrics, historyFile);
  const since = Date.parse(totalsHistory(historyFile).at(-1)?.at ?? '') || 0;
  const memories = (flags.memory ?? []).map((m) => analyzeMemory(path.resolve(m), { repos, now, since }));
  const fixesFile = path.join(RECORDS_DIR, 'fixes.tsv');
  const fixRows = fs.existsSync(fixesFile) ? parseFixes(fs.readFileSync(fixesFile, 'utf8')) : [];
  // 피드백 묶음(fix-log.js)이 없는 설치는 옮김 표와 기록 없는 장치 고침을 건너뛴다.
  const fixLogFile = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fix-log.js');
  const fixLog = fs.existsSync(fixLogFile) ? await import(pathToFileURL(fixLogFile).href) : null;
  const moves = fixLog ? fixLog.movedLookup() : null;
  const staleFixes = staleFixTargets(fixRows, { claudeDir: CLAUDE_DIR, projectOf: projectRoot, kitDir: moves?.kitDir ?? '', moved: moves?.lookup });
  const deviceCommits = fixLog ? fixLog.unrecordedNow(fixRows, { days }) : { fix: [], featHook: [], rootless: [] };
  const result = { repos: results, memories, rose, seeded: fresh, staleFixes, deviceCommits, deviceDays: days };
  const stamp = new Date(now).toISOString();
  const toWrite = flags.record !== undefined ? Object.entries(metrics) : fresh.map((f) => [f.key, f.value]);
  appendHistory(historyFile, toWrite.map(([k, v]) => [stamp, '지표', k, v, '']));
  if (flags.json !== undefined) {
    const { counts, total } = countsOf(result);
    return console.log(JSON.stringify({ ...result, repos: results.map(({ metrics: _m, ...r }) => r), counts, total }, null, 2));
  }
  console.log(formatHealth(result, { days }));
}

// 점수와 실험 장부

function scoreCmd(flags) {
  const now = Date.now();
  const until = timeFlag(flags, 'until', Number.POSITIVE_INFINITY);
  const since = timeFlag(flags, 'since', (Number.isFinite(until) ? until : now) - 7 * 86400000);
  const project = one(flags, 'project');
  const r = scoreRange({ since, until, project: project || null });
  if (flags.json !== undefined) return console.log(JSON.stringify(r, null, 2));
  console.log(formatScore(r));
}

const EXP_FILE = path.join(RECORDS_DIR, 'experiments.tsv');
const EXP_COLS = ['번호', '시각', '줄', '바뀐 것', '왜', '기대', '볼 날수', '키트 커밋', '결과', '메모'];
const EXP_RESULTS = ['남김', '되돌림', '더봄'];
const DAY = 86400000;
const expRows = () => readTsv(EXP_FILE, '번호').map((c) => Object.fromEntries(EXP_COLS.map((k, i) => [k, c[i] ?? ''])));

// 덧붙이기만 한 줄들을 실험마다 모은다: 시작 줄 하나와 닫음 줄들. 마지막 닫음이 남김이나 되돌림이면 끝난 것이고, 더봄이면 그 시각부터 다시 날수를 센다.
export function foldExperiments(rows) {
  const byId = new Map();
  for (const r of rows) {
    const e = byId.get(r['번호']) ?? { id: r['번호'], start: null, closes: [] };
    if (r['줄'] === '시작') e.start = r;
    else if (r['줄'] === '닫음') e.closes.push(r);
    byId.set(r['번호'], e);
  }
  return [...byId.values()]
    .filter((e) => e.start)
    .map((e) => {
      const last = e.closes.at(-1);
      const state = !last ? '열림' : last['결과'] === '더봄' ? '더봄' : last['결과'];
      const days = Number(e.start['볼 날수']) || 3;
      const checkpoint = Date.parse(last?.['시각'] || e.start['시각']);
      return { ...e, state, days, startMs: Date.parse(e.start['시각']), dueMs: checkpoint + days * DAY, open: state === '열림' || state === '더봄' };
    })
    .sort((a, b) => Number(a.id) - Number(b.id));
}
export const dueExperiments = (rows, now) => foldExperiments(rows).filter((e) => e.open && now >= e.dueMs);

function expAdd(flags) {
  const rows = expRows();
  const id = String(rows.reduce((m, r) => Math.max(m, Number(r['번호']) || 0), 0) + 1);
  const days = number(flags, 'days', 3);
  if (days < 1) fail('--days는 1 이상이어야 합니다.');
  const at = timeFlag(flags, 'at', Date.now());
  const row = { 번호: id, 시각: new Date(at).toISOString(), 줄: '시작', '바뀐 것': need(flags, 'what'), 왜: need(flags, 'why'), 기대: need(flags, 'expect'), '볼 날수': days, '키트 커밋': one(flags, 'kit') ?? '', 결과: '', 메모: '' };
  appendWithHeader(EXP_FILE, EXP_COLS.join('\t'), [EXP_COLS.map((k) => cell(row[k])).join('\t')]);
  console.log(`실험 ${id}을 적었습니다. ${days}일 뒤(${localDate(at + days * DAY)})부터 exp due에 뜹니다: ${row['바뀐 것']}`);
}

function expList() {
  const exps = foldExperiments(expRows());
  if (!exps.length) return console.log('실험 장부가 비어 있습니다.');
  printTable([['번호', '시작', '날수', '상태', '바뀐 것', '기대'], ...exps.map((e) => [e.id, localDate(e.startMs), e.days, e.state, e.start['바뀐 것'], e.start['기대']])], 6);
}

function expClose(flags) {
  const id = need(flags, 'id');
  const result = need(flags, 'result');
  if (!EXP_RESULTS.includes(result)) fail(`--result는 ${EXP_RESULTS.join(', ')} 가운데 하나여야 합니다: ${result}`);
  const e = foldExperiments(expRows()).find((x) => x.id === id);
  if (!e) fail(`실험 ${id}이 장부에 없습니다. exp list로 번호를 봅니다.`);
  if (!e.open) fail(`실험 ${id}은 이미 ${e.state}으로 닫혔습니다.`);
  const row = { 번호: id, 시각: new Date().toISOString(), 줄: '닫음', 결과: result, 메모: need(flags, 'memo') };
  appendWithHeader(EXP_FILE, EXP_COLS.join('\t'), [EXP_COLS.map((k) => cell(row[k])).join('\t')]);
  console.log(`실험 ${id}을 ${result}으로 적었습니다.${result === '더봄' ? ` ${e.days}일 뒤 exp due에 다시 뜹니다.` : result === '되돌림' ? ' 바꾼 것을 걷는 일은 따로 합니다.' : ''}`);
}

// 같은 길이의 앞뒤 구간 점수를 나란히 찍는다. 나빠짐 표시는 사람 말당 값이 10% 넘게 오른 것에만 붙인다(참고용, 판정은 기대한 숫자와 함께 사람이 한다).
export function compareRows(before, after) {
  const f = (v, d = 2) => (v === null ? '-' : d ? v.toFixed(d) : String(Math.round(v)));
  const mark = (b, a) => (b !== null && a !== null && b > 0 && a > b * 1.1 ? ' (나빠짐)' : '');
  const lines = [
    ['사람 말', String(before.human), String(after.human), ''],
    ['메인 되돌림 말당', f(before.mainPerHuman), f(after.mainPerHuman), mark(before.mainPerHuman, after.mainPerHuman)],
    ['실무자 되돌림', String(before.subEvents), String(after.subEvents), ''],
    ['재지시 말당', f(before.resendPerHuman), f(after.resendPerHuman), mark(before.resendPerHuman, after.resendPerHuman)],
    ['대표 지적 말당', f(before.critiquePerHuman), f(after.critiquePerHuman), mark(before.critiquePerHuman, after.critiquePerHuman)],
    ['메인 토큰 말당', f(before.tokensPerHuman, 0), f(after.tokensPerHuman, 0), mark(before.tokensPerHuman, after.tokensPerHuman)],
  ];
  return [['숫자', '시작 전', '시작 뒤', ''], ...lines.map((l) => l.map((x, i) => (i === 3 ? x.trim() : x)))];
}

function expDue(flags) {
  const now = timeFlag(flags, 'now', Date.now());
  const due = dueExperiments(expRows(), now);
  if (flags.count !== undefined) return console.log(String(due.length));
  if (!due.length) return console.log('볼 실험이 없습니다.');
  for (const e of due) {
    const elapsed = now - e.startMs;
    const before = scoreRange({ since: e.startMs - elapsed, until: e.startMs });
    const after = scoreRange({ since: e.startMs, until: now });
    console.log(`## 실험 ${e.id} (${localDate(e.startMs)}부터 ${Math.round(elapsed / DAY)}일, 상태 ${e.state})`);
    console.log(`바뀐 것: ${e.start['바뀐 것']}${e.start['키트 커밋'] ? ` (키트 ${e.start['키트 커밋']})` : ''}`);
    console.log(`왜: ${e.start['왜']}`);
    console.log(`기대: ${e.start['기대']}`);
    for (const c of e.closes) console.log(`지난 판단: ${c['결과']} (${localDate(Date.parse(c['시각']))}) ${c['메모']}`);
    printTable(compareRows(before, after), 1);
    const small = Math.min(before.human, after.human) < 20;
    console.log(small ? '표본이 작음(사람 말 20 아래): 더봄이 기본입니다.' : '표본이 충분함: 기대한 숫자가 나아지고 대표 지적과 토큰이 나빠지지 않았으면 남김, 나빠졌으면 되돌림.');
    console.log(`닫기: exp close --id ${e.id} --result 남김|되돌림|더봄 --memo "<숫자 요지>"\n`);
  }
}

function expCmd(sub, flags) {
  if (sub === 'add') return expAdd(flags);
  if (sub === 'list') return expList();
  if (sub === 'due') return expDue(flags);
  if (sub === 'close') return expClose(flags);
  fail(USAGE);
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
  if (cmd === 'lint') return lint(flags);
  if (cmd === 'docs') return docs(flags);
  if (cmd === 'waste') return waste(flags);
  if (cmd === 'health') return health(flags);
  if (cmd === 'score') return scoreCmd(flags);
  if (cmd === 'exp') return expCmd(sub, flags);
  if (cmd === 'devices') return devices(flags);
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
