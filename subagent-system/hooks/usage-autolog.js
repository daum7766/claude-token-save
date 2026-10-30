#!/usr/bin/env node
/**
 * SubagentStop 훅. 서브에이전트가 끝날 때마다 사용 기록(subagent-usage.tsv)에 한 줄을 자동으로 적는다.
 *
 * 무엇을: 정의, 일 이름(Agent description), 토큰, 도구 호출, 걸린 초, agentId를 `subagent-retro.js --log`와 같은 9열 꼴로 덧붙인다. 결과 칸은 늘 ok다.
 * 왜: 메인이 손으로 적느라 서브에이전트의 21%가 기록에서 빠졌다. 메인은 나쁜 결과와 모자람만 `--log`로 같은 agentId의 줄을 덧붙인다(읽는 쪽이 agentId의 마지막 줄을 쓴다).
 * 전제:
 *  - 열 순서: 날짜, 프로젝트, 정의, 일 종류, 토큰, 도구 호출, 걸린 초, 결과, 메모(메모 첫 낱말이 agentId).
 *  - 훅 입력에는 일 이름과 사용량이 없어(공식 SubagentStop 입력: agent_id, agent_type, agent_transcript_path, last_assistant_message 등) 서브에이전트 기록과 옆의 .meta.json에서 읽는다.
 *  - 토큰은 마지막 요청의 입력, 캐시, 출력 합(완료 알림의 토큰과 같은 값), 초는 첫 요청부터 마지막 요청까지다.
 *  - 일 종류 칸에는 description에서 라우팅 표(docs/ROUTING_TABLE.md, SUBAGENT_ROUTING_FILE로 바꿈)의 일 이름을 찾아 가장 긴 이름을 넣고 메모를 `<agentId> 표에서 찾음`으로 적는다. 못 찾으면 description 그대로에 메모가 agentId 하나뿐이고, 회고가 이 줄을 표 밖 일 종류(auto)로 센다.
 *  - 같은 agentId가 이미 있으면 적지 않는다. 기록 폴더는 SUBAGENT_RECORDS_DIR가 있으면 그것, 없으면 <CLAUDE_CONFIG_DIR 또는 ~/.claude>/subagent-system/records다.
 *  - 어떤 실패도 서브에이전트를 막지 않는다(경고만 stderr에 찍고 종료 코드 0).
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROUTED_MEMO_SUFFIX = '표에서 찾음';
const MAX_TRANSCRIPT_BYTES = 200 * 1024 * 1024;
const LOCK_WAIT_MS = 3000;
const LOCK_STALE_MS = 15000;

const flat = (v) => String(v ?? '').replace(/[\t\r\n]+/g, ' ').trim();
const projectRoot = (cwd) => cwd.replace(/[\\/]\.claude[\\/]worktrees[\\/][^\\/]+([\\/].*)?$/, '');

function recordsDir(env = process.env) {
  if (env.SUBAGENT_RECORDS_DIR) return env.SUBAGENT_RECORDS_DIR;
  return path.join(env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'subagent-system', 'records');
}

const routingFile = (env = process.env) => env.SUBAGENT_ROUTING_FILE || path.join(__dirname, '..', 'docs', 'ROUTING_TABLE.md');

// 표 칸 이름의 꼴은 subagentRetroHelpers.js의 cellKinds와 같다(시험, 최저, 고정 표시와 괄호 부연을 뺀 이름).
const MARKS = [/「\(시험:[^)]*\)」/g, /\(시험:[^)]*`[^`)]+`[^)]*\)/g, /「\(최저:[^)]*\)」/g, /\(최저:[^)]*\)/g, /「\(고정\)」/g, /\(고정\)/g];
const plainKindName = (text) => MARKS.reduce((t, re) => t.replace(re, ''), text).replace(/\([^()]*(\([^()]*\)[^()]*)*\)/g, '').replace(/\s+/g, ' ').trim();

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

function routingKinds(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const names = new Set();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    if (!/^\*\*(Haiku|Sonnet|Opus)\*\*$/i.test(cells[0])) continue;
    for (const cell of cells.slice(1)) for (const item of splitOutsideParens(cell)) {
      const name = plainKindName(item);
      if (name) names.add(name);
    }
  }
  return [...names];
}

// description에 든 표 일 이름 가운데 가장 긴 것. 없으면 null.
function routedKind(description, env = process.env) {
  let best = null;
  for (const name of routingKinds(routingFile(env))) if (description.includes(name) && (!best || name.length > best.length)) best = name;
  return best;
}

function readJsonl(file) {
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // 쓰는 중이라 마지막 줄이 잘렸을 수 있다.
    }
  }
  return out;
}

function localDate(value) {
  const d = new Date(value);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// 같은 요청이 여러 줄로 쓰이므로 요청마다 마지막 줄만 센다. 사용량이 모두 0인 내부 줄은 뺀다.
function requestsOf(lines) {
  const byId = new Map();
  for (const o of lines) {
    if (o.type !== 'assistant' || !o.message?.usage) continue;
    byId.set(o.requestId || o.message.id || o.uuid, o);
  }
  return [...byId.values()].filter((o) => {
    const u = o.message.usage;
    return (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.output_tokens ?? 0) > 0;
  });
}

function statsOf(transcript) {
  if (!transcript || !fs.existsSync(transcript) || fs.statSync(transcript).size > MAX_TRANSCRIPT_BYTES) return null;
  const requests = requestsOf(readJsonl(transcript));
  if (requests.length === 0) return null;
  const u = requests[requests.length - 1].message.usage;
  const times = requests.map((o) => new Date(o.timestamp).getTime()).filter((t) => !Number.isNaN(t));
  const tools = requests.reduce((s, o) => s + (Array.isArray(o.message.content) ? o.message.content.filter((b) => b?.type === 'tool_use').length : 0), 0);
  return {
    date: times.length ? localDate(requests[0].timestamp) : null,
    tokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.output_tokens ?? 0),
    tools,
    secs: times.length ? Math.round((Math.max(...times) - Math.min(...times)) / 1000) : null,
  };
}

function metaOf(transcript) {
  if (!transcript) return {};
  try {
    return JSON.parse(fs.readFileSync(transcript.replace(/\.jsonl$/, '.meta.json'), 'utf8'));
  } catch {
    return {};
  }
}

// 세션 중 cd로 입력의 cwd가 하위 폴더로 바뀔 수 있어 세션 기록 맨 앞의 cwd를 먼저 쓴다.
function startCwd(input) {
  const file = input.transcript_path;
  if (file && fs.existsSync(file)) {
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(65536);
      const text = buf.toString('utf8', 0, fs.readSync(fd, buf, 0, buf.length, 0));
      for (const line of text.split(/\r?\n/).slice(0, 20)) {
        try {
          const cwd = JSON.parse(line).cwd;
          if (typeof cwd === 'string') return cwd;
        } catch {
          // 앞부분만 읽어 마지막 줄이 잘렸을 수 있다.
        }
      }
    } finally {
      fs.closeSync(fd);
    }
  }
  return typeof input.cwd === 'string' ? input.cwd : null;
}

function agentIdOf(input) {
  if (input.agent_id) return String(input.agent_id);
  const t = input.agent_transcript_path;
  return t ? path.basename(t, '.jsonl').replace(/^agent-/, '') : null;
}

// 훅 입력으로 사용 기록 한 줄을 만든다. 적지 않을 입력(내부 에이전트, 포크, 식별 불가)이면 null.
function buildLine(input) {
  const agentId = agentIdOf(input);
  const meta = metaOf(input.agent_transcript_path);
  const def = flat(input.agent_type || meta.customAgentType || meta.agentType);
  if (!agentId || !def || agentId.startsWith('afork-')) return null;
  const cwd = startCwd(input);
  if (!cwd) return null;
  let stats = null;
  try {
    stats = statsOf(input.agent_transcript_path);
  } catch (err) {
    process.stderr.write(`usage-autolog: 기록을 읽지 못해 사용량을 -로 적습니다: ${err.message}\n`);
  }
  const description = flat(meta.description);
  const routed = description ? routedKind(description) : null;
  const num = (v) => (v === null || v === undefined ? '-' : String(v));
  return {
    agentId,
    line: [
      stats?.date ?? localDate(new Date()),
      projectRoot(cwd),
      def,
      routed || description || '-',
      num(stats?.tokens),
      num(stats?.tools),
      num(stats?.secs),
      'ok',
      routed ? `${agentId} ${ROUTED_MEMO_SUFFIX}` : agentId,
    ].join('\t'),
  };
}

function hasAgent(file, agentId) {
  if (!fs.existsSync(file)) return false;
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).some((raw) => {
    const memo = raw.split('\t').slice(8).join('\t');
    return memo.split(/\s+/)[0] === agentId;
  });
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// 같은 훅이 겹쳐 돌아도 확인과 덧붙이기 사이에 끼어들지 못하게 한다.
function withLock(lockDir, fn) {
  const start = Date.now();
  for (;;) {
    try {
      fs.mkdirSync(lockDir);
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      try {
        if (Date.now() - fs.statSync(lockDir).mtimeMs > LOCK_STALE_MS) fs.rmdirSync(lockDir);
      } catch {
        // 다른 훅이 방금 풀었다.
      }
      if (Date.now() - start > LOCK_WAIT_MS) throw new Error('기록 잠금을 얻지 못했습니다');
      sleepMs(25);
    }
  }
  try {
    return fn();
  } finally {
    try {
      fs.rmdirSync(lockDir);
    } catch {
      // 이미 지워졌으면 할 일이 없다.
    }
  }
}

function logAgent(input, dir = recordsDir()) {
  const built = buildLine(input);
  if (!built) return 'skipped';
  const file = path.join(dir, 'subagent-usage.tsv');
  fs.mkdirSync(dir, { recursive: true });
  return withLock(path.join(dir, 'usage-autolog.lock'), () => {
    if (hasAgent(file, built.agentId)) return 'duplicate';
    fs.appendFileSync(file, built.line + '\n', 'utf8');
    return 'logged';
  });
}

function main() {
  try {
    logAgent(JSON.parse(fs.readFileSync(0, 'utf8')));
  } catch (err) {
    process.stderr.write(`usage-autolog: ${err.message}\n`);
  }
}

module.exports = { buildLine, logAgent, hasAgent, recordsDir };

if (require.main === module) main();
