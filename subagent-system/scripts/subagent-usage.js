#!/usr/bin/env node

/**
 * subagent-usage.js
 *
 * 세션 기록(~/.claude/projects/<프로젝트 폴더>/<세션id>/subagents/)에서 서브에이전트마다
 * 입력, 캐시 쓰기, 캐시 읽기, 출력 토큰과 어림 비용을 집계한다.
 * Agent 결과에 붙는 총 토큰 하나로는 가격이 크게 다른 입력, 출력, 캐시 읽기를 나눠 볼 수 없어서
 * 모델과 effort 배정을 실측으로 조절하려고 만들었다.
 *
 * 실행(--help가 같은 내용을 찍고, 모르는 인자는 사용법과 함께 종료 코드 1로 끝난다):
 *   node scripts/subagent-usage.js                    모든 프로젝트 중 가장 최근에 수정된 세션 하나
 *   node scripts/subagent-usage.js --hook             SubagentStop 훅용. stdin의 서브에이전트 하나를 records/subagent-cost.tsv에 기록
 *   node scripts/subagent-usage.js --recost           비용이 ?인 에이전트를 세션 기록으로 다시 계산해 같은 agentId의 새 줄로 덧붙임(--dry-run은 쓰지 않고 보기만)
 *
 * 한 요청(requestId)은 여러 줄로 나뉘어 기록된다. 입력과 캐시 값은 줄마다 같고
 * 출력만 늘어나 마지막 줄에서 확정되므로, 요청마다 마지막 줄 하나만 센다.
 * --hook은 Claude Code가 서브에이전트별 비용을 주지 않아 만든 모드다. 기록 파일은 프로젝트와 상관없이
 * records/ 한 곳이고 프로젝트는 줄의 열로 남긴다. 세션 여러 개의 훅이 동시에 돌아 파일을 통째로 다시 쓰면
 * 줄이 덮이므로 한 줄씩 덧붙이기만 한다. 훅은 서브에이전트가 멈출 때마다 불리고, 그때마다 그 에이전트
 * 기록 전체를 다시 집계해 적으므로 이어서 일시킨 에이전트의 줄은 그때까지의 누적값이다.
 * 그래서 같은 agentId는 마지막 줄이 최종이다(--recost도 새 줄을 덧붙일 뿐 옛 줄을 고치지 않는다).
 * 요율표는 ../rates.json이다. 표에 없는 모델이 요청 하나에라도 있으면 그 에이전트의 비용은 모른다고 보고
 * 비용 열에 `?:<표에 없는 모델,...>`을 적어 회고가 어느 모델이 빠졌는지 알게 한다(열 개수와 순서는 그대로고,
 * 옛 읽기 쪽은 숫자가 아니라서 모름으로 읽는다). 사용량이 모두 0인 줄(`<synthetic>` 등 내부용)은 건너뛴다.
 * 훅이 작업을 막으면 안 되므로 어떤 오류도 stderr 한 줄과 종료 코드 0으로 끝낸다.
 * 「총」은 마지막 요청의 입력+캐시 쓰기+캐시 읽기+출력으로, Agent 결과의 총 토큰과 같다
 * (요청별 합이 아니라 마지막 요청이 본 문맥 크기).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RECORDS_DIR, PROJECTS_ROOT, listSessions, readJsonl, sessionCwd, projectRoot, baseModel, localDate, printTable, appendWithHeader, splitLines } from './claudeProjectPaths.js';

export const RATES_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'rates.json');
const RATE_KEYS = ['input', 'write5m', 'write1h', 'cacheRead', 'output'];
const isRate = (r) => r !== null && typeof r === 'object' && RATE_KEYS.every((k) => Number.isFinite(r[k]));

// 훅이 예외로 끝나면 안 되므로 파일이 없거나 깨졌으면 rates를 null로 돌려주고 까닭만 담는다.
// 이름이 `_`로 시작하는 키는 출처와 확인 날짜 같은 설명이라 모델로 보지 않는다.
export function loadRates(file = RATES_FILE) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data === null || typeof data !== 'object' || Array.isArray(data)) return { rates: null, error: '최상위가 객체가 아닙니다' };
    const rates = {};
    for (const [model, r] of Object.entries(data)) {
      if (!model.startsWith('_') && isRate(r) && (r.longPrompt === undefined || (isRate(r.longPrompt) && Number.isFinite(r.longPrompt.over)))) rates[model] = r;
    }
    return { rates, error: null };
  } catch (err) {
    return { rates: null, error: err.message };
  }
}

const USAGE = `사용법:
  node scripts/subagent-usage.js              모든 프로젝트 중 가장 최근에 수정된 세션 하나의 비용을 집계해 찍음
  node scripts/subagent-usage.js --hook       SubagentStop 훅용. stdin의 서브에이전트 하나를 records/subagent-cost.tsv에 기록
  node scripts/subagent-usage.js --recost [--dry-run]   비용이 ?인 에이전트를 다시 계산해 덧붙임(--dry-run은 쓰지 않고 보기만)
  node scripts/subagent-usage.js --help       이 사용법을 찍음`;

function parseArgs(argv) {
  const opts = { hook: false, recost: false, dryRun: false, help: false, unknown: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--hook') opts.hook = true;
    else if (argv[i] === '--recost') opts.recost = true;
    else if (argv[i] === '--dry-run') opts.dryRun = true;
    else if (argv[i] === '--help') opts.help = true;
    else opts.unknown.push(argv[i]);
  }
  return opts;
}

// 사용량이 모두 0인 줄은 `<synthetic>` 같은 내부용 줄이라 요율표에 모델이 없다. 비용과 모델 판정에서 뺀다.
const hasUsage = (u) => (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.output_tokens ?? 0) > 0;

// 순서는 첫 등장 순서를 유지한다.
export function lastLinePerRequest(lines) {
  const byId = new Map();
  for (const o of lines) {
    if (o.type !== 'assistant' || !o.message?.usage) continue;
    const key = o.requestId || o.message.id || o.uuid;
    byId.set(key, o);
  }
  return [...byId.values()].filter((o) => hasUsage(o.message.usage));
}

export function toCounts(o) {
  const u = o.message.usage;
  const write1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const write = u.cache_creation_input_tokens ?? 0;
  const advisor = (u.iterations ?? []).filter((it) => it.type === 'advisor_message');
  return {
    model: o.message.model,
    input: u.input_tokens ?? 0,
    write5m: write - write1h,
    write1h,
    read: u.cache_read_input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    advisorCalls: advisor.length,
    advisorTokens: advisor.reduce(
      (s, it) =>
        s +
        (it.input_tokens ?? 0) +
        (it.output_tokens ?? 0) +
        (it.cache_read_input_tokens ?? 0) +
        (it.cache_creation_input_tokens ?? 0),
      0
    ),
  };
}

// agent-meter가 꼬리를 뗀 이름으로만 요율을 찾으므로 여기도 같은 규칙으로 찾아 두 곳의 비용이 어긋나지 않게 한다.
export function cost(c, rates) {
  let r = typeof c.model === 'string' ? rates?.[baseModel(c.model)] : undefined;
  if (!r) return null;
  if (r.longPrompt && c.input + c.write5m + c.write1h + c.read > r.longPrompt.over) r = r.longPrompt;
  return (
    (c.input * r.input + c.write5m * r.write5m + c.write1h * r.write1h + c.read * r.cacheRead + c.output * r.output) /
    1e6
  );
}

function sumCounts(list) {
  const total = { input: 0, write5m: 0, write1h: 0, read: 0, output: 0, advisorCalls: 0, advisorTokens: 0 };
  for (const c of list) for (const k of Object.keys(total)) total[k] += c[k];
  return total;
}

export function sumCost(list, rates) {
  let sum = 0;
  for (const c of list) {
    const v = cost(c, rates);
    if (v === null) return null;
    sum += v;
  }
  return sum;
}

// 요율표를 읽지 못했을 때는 모든 모델이 빠진 것이라 이름을 대지 않는다. 그 경우는 호출한 쪽이 따로 알린다.
// 찍는 이름은 cost()가 요율표에서 찾는 이름(baseModel)과 같아, 그대로 요율표 키로 넣으면 된다.
export function unknownModels(list, rates) {
  if (!rates) return [];
  return [...new Set(list.filter((c) => cost(c, rates) === null).map((c) => (typeof c.model === 'string' ? baseModel(c.model) : '?')))];
}

export function collectAgent(jsonlFile, fallbackType, rates) {
  const metaFile = jsonlFile.replace(/\.jsonl$/, '.meta.json');
  const meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : { agentType: fallbackType };
  const requests = lastLinePerRequest(readJsonl(jsonlFile));
  if (requests.length === 0) return null;
  const counts = requests.map(toCounts);
  const sum = sumCounts(counts);
  const last = counts[counts.length - 1];
  const times = requests.map((o) => new Date(o.timestamp).getTime());
  return {
    start: requests[0].timestamp,
    date: localDate(requests[0].timestamp),
    agentType: (meta.customAgentType ?? meta.agentType) ?? '?',
    model: last.model ?? meta.model ?? '?',
    effort: requests.find((o) => o.effort)?.effort ?? '?',
    description: (meta.description ?? '').replace(/\s+/g, ' '),
    sum,
    requests: requests.length,
    seconds: Math.round((Math.max(...times) - Math.min(...times)) / 1000),
    cost: sumCost(counts, rates),
    unknown: unknownModels(counts, rates),
    context: last.input + last.write5m + last.write1h + last.read + last.output,
  };
}

function collectMain(sessionFile, rates) {
  const counts = lastLinePerRequest(readJsonl(sessionFile)).map(toCounts);
  return { sum: sumCounts(counts), requests: counts.length, cost: sumCost(counts, rates), unknown: unknownModels(counts, rates) };
}

function pickSessions() {
  return listSessions().sort((a, b) => b.mtime - a.mtime).slice(0, 1);
}

const n = (v) => v.toLocaleString('en-US');
const money = (v, digits = 3) => (v === null ? '?' : v.toFixed(digits));
const writes = (s) => s.write5m + s.write1h;
// 비용 열이 `?`면 모르는 것이고, 뒤의 `:모델,...`은 요율표에 없던 모델이다.
const costCell = (a) => (a.cost !== null ? money(a.cost) : a.unknown.length ? `?:${a.unknown.join(',')}` : '?');

const HOOK_FILE = path.join(RECORDS_DIR, 'subagent-cost.tsv');
const HOOK_HEADER = ['날짜', '프로젝트', '세션', 'agentId', '정의', '모델', 'effort', '설명', '입력', '캐시 쓰기', '캐시 읽기', '출력', '요청 수', '걸린 초', '어림 비용($)'].join('\t');

function runHook() {
  try {
    const input = JSON.parse(fs.readFileSync(0, 'utf8'));
    const transcript = input.agent_transcript_path;
    const { rates, error } = loadRates();
    if (error) console.error(`subagent-usage --hook: ${RATES_FILE}을 읽지 못해 비용을 ?로 적습니다: ${error}`);
    const a = collectAgent(transcript, input.agent_type, rates);
    if (!a) return;
    const agentId = input.agent_id ?? path.basename(transcript, '.jsonl').replace(/^agent-/, '');
    const sessionId = input.session_id ?? path.basename(path.dirname(path.dirname(transcript)));
    const sessionDir = path.dirname(path.dirname(transcript));
    // 세션 중 cd로 훅 입력의 cwd가 하위 폴더로 바뀔 수 있어, 세션이 시작한 cwd(세션 기록 맨 앞)를 먼저 쓴다.
    const cwd = sessionCwd(`${sessionDir}.jsonl`) ?? input.cwd ?? sessionCwd(transcript) ?? path.basename(path.dirname(sessionDir));
    const line = [a.date, projectRoot(cwd), sessionId, agentId, a.agentType, a.model, a.effort, a.description, a.sum.input, writes(a.sum), a.sum.read, a.sum.output, a.requests, a.seconds, costCell(a)].join('\t');
    appendWithHeader(HOOK_FILE, HOOK_HEADER, [line]);
  } catch (err) {
    console.error(`subagent-usage --hook: ${err.message}`);
  }
}

// 비용 기록은 덧붙이기만 하는 파일이라 옛 줄을 고치지 않고, 같은 agentId의 새 줄을 덧붙인다.
// 읽는 쪽이 마지막 줄을 쓰므로 새 줄이 옛 `?` 줄을 대신한다. 세션 기록이 지워진 에이전트는 채울 수 없다.
export function recostRows(costText, rates, locate) {
  const last = new Map();
  for (const raw of splitLines(costText)) {
    const c = raw.split('\t');
    if (c[0] === '날짜' || c.length < 15) continue;
    last.set(c[3], c);
  }
  const result = { targets: 0, lines: [], filled: 0, stillUnknown: new Map(), missing: [] };
  for (const [agentId, c] of last) {
    if (!c[14].startsWith('?')) continue;
    result.targets++;
    const transcript = locate(c[2], agentId);
    if (!transcript) {
      result.missing.push(agentId);
      continue;
    }
    const a = collectAgent(transcript, c[4], rates);
    if (!a) {
      result.missing.push(agentId);
      continue;
    }
    const cell = costCell(a);
    if (a.cost !== null) result.filled++;
    else for (const m of a.unknown) result.stillUnknown.set(m, (result.stillUnknown.get(m) ?? 0) + 1);
    // 아직 모르는 채로 옛 줄과 같으면 다시 돌릴 때마다 같은 줄이 쌓이지 않게 덧붙이지 않는다.
    if (cell === c[14]) continue;
    result.lines.push([c[0], c[1], c[2], agentId, c[4], a.model, a.effort, c[7], a.sum.input, writes(a.sum), a.sum.read, a.sum.output, a.requests, a.seconds, cell].join('\t'));
  }
  return result;
}

export function locateTranscript(session, agentId) {
  let dirs;
  try {
    dirs = fs.readdirSync(PROJECTS_ROOT);
  } catch {
    return null;
  }
  for (const d of dirs) {
    const file = path.join(PROJECTS_ROOT, d, session, 'subagents', `agent-${agentId}.jsonl`);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

function runRecost(opts) {
  const { rates, error } = loadRates();
  if (error) {
    console.error(`${RATES_FILE}을 읽지 못해 다시 계산할 수 없습니다: ${error}`);
    process.exit(1);
  }
  if (!fs.existsSync(HOOK_FILE)) {
    console.error(`비용 기록이 없습니다: ${HOOK_FILE}`);
    process.exit(1);
  }
  const r = recostRows(fs.readFileSync(HOOK_FILE, 'utf8'), rates, locateTranscript);
  if (!opts.dryRun && r.lines.length) appendWithHeader(HOOK_FILE, HOOK_HEADER, r.lines);
  console.log(`비용이 ?인 에이전트 ${r.targets}건`);
  console.log(`  채운 건 ${r.filled}건${opts.dryRun ? '(--dry-run이라 쓰지 않았습니다)' : ''}, 덧붙인 줄 ${opts.dryRun ? 0 : r.lines.length}줄`);
  const unknown = [...r.stillUnknown].map(([m, n]) => `${m} ${n}건`).join(', ');
  console.log(`  요율표에 없는 모델이라 아직 모름: ${unknown || '없음'}${unknown ? '(rates.json에 넣은 뒤 다시 실행)' : ''}`);
  console.log(`  세션 기록이 없어 못 채움: ${r.missing.length}건${r.missing.length ? `(${r.missing.slice(0, 10).join(', ')}${r.missing.length > 10 ? ' ...' : ''})` : ''}`);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(USAGE);
    return;
  }
  // 훅은 작업을 막으면 안 되므로 --hook이면 모르는 인자가 있어도 훅으로 돈다.
  if (opts.hook) {
    runHook();
    return;
  }
  if (opts.unknown.length) {
    console.error(`모르는 인자: ${opts.unknown.join(' ')}\n${USAGE}`);
    process.exit(1);
  }
  if (opts.recost) {
    runRecost(opts);
    return;
  }
  const { rates, error: ratesError } = loadRates();
  if (ratesError) console.error(`${RATES_FILE}을 읽지 못해 비용을 모두 ?로 찍습니다: ${ratesError}`);
  const unknownSeen = new Set();
  const sessions = pickSessions();
  if (sessions.length === 0) {
    console.error('조건에 맞는 세션이 없습니다.');
    process.exit(1);
  }

  for (const s of sessions) {
    const dir = path.join(s.dir, s.id, 'subagents');
    const agents = fs.existsSync(dir)
      ? fs
          .readdirSync(dir)
          .filter((f) => f.endsWith('.jsonl') && fs.existsSync(path.join(dir, f.replace(/\.jsonl$/, '.meta.json'))))
          .map((f) => collectAgent(path.join(dir, f), undefined, rates))
          .filter(Boolean)
          .sort((a, b) => a.start.localeCompare(b.start))
      : [];

    for (const a of agents) for (const m of a.unknown) unknownSeen.add(m);
    console.log(`세션 ${s.id}`);
    const rows = [['정의', '모델', 'effort', '설명', '요청', '입력', '캐시쓰기', '캐시읽기', '출력', '총', '초', '$']];
    for (const a of agents) {
      rows.push([
        a.agentType, a.model, a.effort, a.description, a.requests,
        n(a.sum.input), n(writes(a.sum)), n(a.sum.read), n(a.sum.output), n(a.context), a.seconds,
        money(a.cost) + (a.sum.advisorCalls ? '*' : ''),
      ]);
    }
    const all = agents.map((a) => a.sum);
    const total = sumCounts(all);
    const agentCosts = agents.map((a) => a.cost);
    rows.push([
      '합계', '', '', '', agents.reduce((x, a) => x + a.requests, 0),
      n(total.input), n(writes(total)), n(total.read), n(total.output), '', '',
      money(agentCosts.some((c) => c === null) ? null : agentCosts.reduce((x, c) => x + c, 0)),
    ]);
    printTable(rows, 5);

    const main = collectMain(s.file, rates);
    for (const m of main.unknown) unknownSeen.add(m);
    console.log(
      `메인 세션: 요청 ${main.requests}, 입력 ${n(main.sum.input)}, 캐시쓰기 ${n(writes(main.sum))}, 캐시읽기 ${n(main.sum.read)}, 출력 ${n(main.sum.output)}, $${money(main.cost)}`
    );
    const advisorCalls = total.advisorCalls + main.sum.advisorCalls;
    if (advisorCalls) {
      console.log(`* advisor 호출 ${advisorCalls}회(${n(total.advisorTokens + main.sum.advisorTokens)} 토큰)는 다른 모델 요율이라 비용에 넣지 않았습니다.`);
    }
    console.log('');
  }
  if (unknownSeen.size) console.error(`요율표에 없는 모델: ${[...unknownSeen].join(', ')}. ${RATES_FILE}에 찍힌 이름 그대로 키로 넣으면 비용이 계산됩니다.`);
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
