#!/usr/bin/env node
// 무엇: PermissionRequest(matcher *) 훅. Claude Code가 사용자에게 승인 창을 띄울 때마다 무엇을 물었는지 한 줄씩 기록 파일에 덧붙인다.
//   기록 파일은 설정 폴더(CLAUDE_CONFIG_DIR, 없으면 ~/.claude)의 permission-asks.jsonl이고 환경 변수 ASK_LOG_FILE로 바꾼다.
//   줄 꼴(JSON): ts(UTC), session, agent_id, agent_type, cwd, tool, hook, reason, input(명령 또는 조회어, 없으면 입력 JSON, 4000자까지).
//   `hook` 값은 이 훅이 적으면 `claude-code`이고, 사용자가 둔 검사 훅이 같은 파일에 자기 이름을 달아 적어도 된다.
// 왜: 승인 창은 사용자가 자리를 비운 동안 일을 세우고 사용자의 시간을 쓴다. 무엇이 얼마나 자주 물었는지 기록이 있어야 회고가 이를 넷으로 나눠 줄인다(RETRO 「승인 창 보기」).
// 전제:
//   - 아무것도 출력하지 않고 항상 0으로 끝낸다. 출력하면 승인 결정에 끼어들기 때문이다. 훅 안의 오류는 모두 조용히 통과로 처리한다.
//   - retro-write-allow.js가 허용하는 요청(회고 잠금 동안 회고 서브에이전트의 방법 파일 쓰기)은 적지 않는다. 사용자에게 창이 뜨지 않는 요청이 승인 창으로 세어지면 회고가 자기 쓰기를 「매번 같은 안전한 요청」으로 보기 때문이다. 판정은 그 훅의 shouldAllow를 불러 쓰므로 조건의 원본은 한 곳이다.
//     다만 그 훅이 설정 폴더 settings.json의 PermissionRequest에 실제로 걸려 있을 때만 건너뛴다. retroWriteAllow를 켰어도 훅을 걸기 전(update 전)에는 창이 뜨는데 건너뛰면 뜬 창이 기록에서 빠지기 때문이다.
//   - 같은 입력이 10초 안에 이미 적혀 있으면 적지 않는다. 사용자의 검사 훅이나 같은 일을 하는 다른 훅이 같은 창을 먼저 적었을 수 있기 때문이다(기록 끝 20000바이트만 본다).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEDUPE_MS = 10000;
const TAIL_BYTES = 20000;
const MAX_INPUT = 4000;

function logFile() {
  if (process.env.ASK_LOG_FILE) return process.env.ASK_LOG_FILE;
  const dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(dir, 'permission-asks.jsonl');
}

function inputKey(data) {
  const inp = data.tool_input && typeof data.tool_input === 'object' ? data.tool_input : {};
  return String(inp.command || inp.query || JSON.stringify(inp)).slice(0, MAX_INPUT);
}

function recentlyLogged(file, key, now) {
  if (!fs.existsSync(file)) return false;
  const size = fs.statSync(file).size;
  const start = Math.max(0, size - TAIL_BYTES);
  const fd = fs.openSync(file, 'r');
  let text;
  try {
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    text = buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
  const lines = text.split('\n').slice(start ? 1 : 0);
  for (const line of lines) {
    try {
      const r = JSON.parse(line);
      if (r.input === key && now - Date.parse(r.ts) < DEDUPE_MS) return true;
    } catch {
      // 잘린 줄이나 다른 꼴의 줄은 건너뛴다
    }
  }
  return false;
}

// settings.json의 PermissionRequest에 retro-write-allow 훅 명령이 걸려 있는지. 읽지 못하면 안 걸린 것으로 본다.
function retroWriteHookRegistered() {
  const dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const groups = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')).hooks?.PermissionRequest;
  if (!Array.isArray(groups)) return false;
  return groups.some((g) => g && Array.isArray(g.hooks) && g.hooks.some((h) => h && /retro-write-allow\.js/.test(String(h.command || ''))));
}

// retro-write-allow.js를 불러오지 못하거나 판정이 던지면 허용이 아니라고 보고 적는다(기록이 빠지는 쪽보다 더 적히는 쪽이 낫다).
function allowedByRetroWrite(data) {
  try {
    return retroWriteHookRegistered() && require('./retro-write-allow.js').shouldAllow(data) === true;
  } catch {
    return false;
  }
}

function main(raw) {
  const data = JSON.parse(raw);
  if (allowedByRetroWrite(data)) return;
  const file = logFile();
  const key = inputKey(data);
  const now = Date.now();
  if (recentlyLogged(file, key, now)) return;
  const row = {
    ts: new Date(now).toISOString().replace(/\.\d+Z$/, 'Z'),
    session: data.session_id || '',
    agent_id: data.agent_id || '',
    agent_type: data.agent_type || '',
    cwd: data.cwd || '',
    tool: data.tool_name || '',
    hook: 'claude-code',
    reason: 'Claude Code 승인 창',
    input: key,
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`, 'utf8');
}

try {
  main(fs.readFileSync(0, 'utf8'));
} catch {
  // 기록 실패가 승인 흐름을 막지 않게 한다
}
process.exit(0);
