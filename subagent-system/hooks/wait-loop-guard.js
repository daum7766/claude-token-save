#!/usr/bin/env node
'use strict';

/**
 * PreToolUse(Bash) 훅. 서브에이전트(훅 입력에 agent_id가 있음)가 결과를 기다리느라 셸에서 시간을 버리는 꼴을 막는다. 메인 세션의 호출은 그대로 통과시킨다.
 * 막는 꼴(같은 종류):
 *  - until이나 while 반복문과 sleep이 한 명령에 함께 있는 것(`until [ -s out ]; do sleep 5; done`, `while pgrep -f x; do sleep 3; done`).
 *  - 30초 이상의 `sleep N`(`sleep 100`, `sleep 1m`, `sleep infinity`). 변수로 준 `sleep $N`은 길이를 몰라 반복문 안에서만 막는다.
 *  - 위 꼴이 든 .sh 파일 실행(`bash w.sh`, `./w.sh`, `source w.sh`, 같은 명령에서 heredoc으로 쓴 .sh를 곧바로 실행하는 것). 파일은 명령 안의 cd와 `VAR=값` 대입을 따라 풀고, 못 풀거나 못 읽으면 통과한다.
 *  막지 않는 반복문: 조건이 `mkdir`, `flock`처럼 잠금을 얻는 명령인 것(`until mkdir "$LOCK"; do sleep 15; done`). 결과가 아니라 차례를 기다리는 것이고 다른 길이 없다. 지난 10일 기록에서 프로젝트의 전체 시험 잠금 스크립트가 이 꼴로 4번 걸렸다.
 *  조건이 `curl`인 반복문(서버가 뜨기를 기다리는 것)은 막되 `curl --retry-connrefused`로 한 번에 기다리는 법을 알린다.
 *  heredoc 본문과 따옴표 안 글은 명령으로 보지 않는다. 다만 셸(bash, sh, zsh)에 넘기는 heredoc 본문, `bash -c`와 `eval`의 글은 셸 글이라 같은 눈으로 본다.
 * 왜: 기다리는 반복문은 셸 제한(180초)에 걸려 다시 기다리거나 완료 알림을 놓치게 한다. 서브에이전트 정의에 「sleep이나 until로 기다리지 않음」 문장이 있는데도 한 회차에 20번 되풀이됐다
 *  (대화 기록 7건 가운데 5건, 반복문 약 46분). 문장으로 안 막혀 막는 훅으로 옮겼다.
 * 전제:
 *  - 낱말 나누기는 guardShared.cjs(안전장치 묶음의 부품)를 쓴다. 그 파일이 없으면 이 훅은 아무것도 막지 않는다.
 *  - 해석하지 못한 명령(따옴표 짝이 안 맞음 등)과 훅 안의 오류는 통과로 끝난다(훅 오류로 일을 막지 않게).
 *  - for 반복문과 python, node 안의 기다림은 보지 않는다. 막을 때마다 승인 창 기록(ask-log.js의 logAsk)에 한 줄을 남긴다.
 */

const fs = require('node:fs');
const path = require('node:path');

let sh = null;
try {
  sh = require('./guardShared.cjs');
} catch {
  sh = null;
}
let logAsk = () => {};
try {
  ({ logAsk } = require('./ask-log.js'));
} catch {
  // 기록 모듈이 없어도 판정은 낸다
}

const MESSAGE = '결과를 기다리는 반복문은 막습니다. 남은 일이 결과뿐이면 앞에서 돌리고(제한 10분), 뒤에서 돌렸으면 완료 알림을 받습니다.';
const LONG_SLEEP_SEC = 30;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_DEPTH = 3;
const SEP = ';&|()\n';
// 반복문의 조건이 이 명령이면 결과를 기다리는 것이 아니라 잠금을 얻으려고 차례를 기다리는 것이라 막지 않는다(`until mkdir "$LOCK"; do sleep 15; done`). 기다릴 다른 길이 없다.
const LOCK_CMDS = new Set(['mkdir', 'flock', 'shlock', 'lockf']);
// 이 명령이 조건이면 서버가 뜨기를 기다리는 꼴이라 막으면서 반복문 없이 기다리는 법을 알린다.
const READY_CMDS = new Set(['curl', 'wget', 'nc', 'ncat']);
const READY_HINT = '서버가 뜨기를 기다리는 것이면 `curl --retry-connrefused --retry 30 --retry-delay 1 <주소>` 한 번으로 기다립니다.';
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash']);
const PREFIX = new Set(['do', 'then', 'else', 'elif', '{', '!', 'time', 'command', 'builtin', 'nohup', 'exec', 'sudo', 'env']);
const ASSIGN = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s;
const HEREDOC = /(?<!<)<<(?!<)(-?)[ \t]*(["']?)([A-Za-z_][\w.-]*)\2/g;
const SCRIPT_WRITE = /(?:\bcat\b[^<\n]*?>>?\s*|\btee\s+(?:-a\s+)?)(["']?)([^\s"'<>|;&]+\.sh)\1/;
const UNIT_SEC = { '': 1, s: 1, m: 60, h: 3600, d: 86400 };

const base = (w) => w.slice(w.lastIndexOf('/') + 1);

// heredoc 본문을 걷어 낸다. 셸에 넘기는 본문만 남기고, `cat > x.sh <<EOF` 꼴로 쓰는 .sh 본문은 따로 모은다. 닫는 줄이 없으면 글을 그대로 둔다.
function stripHeredocs(text) {
  const lines = text.split('\n');
  const out = [];
  const written = new Map();
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    out.push(line);
    i += 1;
    for (const m of line.matchAll(HEREDOC)) {
      const dash = m[1];
      const delim = m[3];
      let end = -1;
      for (let j = i; j < lines.length; j += 1) {
        if ((dash ? lines[j].replace(/^\t+/, '') : lines[j]) === delim) {
          end = j;
          break;
        }
      }
      if (end < 0) return { text, written: new Map() };
      const body = lines.slice(i, end).join('\n');
      const before = line.slice(0, m.index);
      const w = SCRIPT_WRITE.exec(before);
      if (w) written.set(w[2], body);
      if ((before.match(/[\p{L}\p{N}_.-]+/gu) ?? []).some((x) => SHELLS.has(x))) out.push(...lines.slice(i, end));
      out.push('');
      i = end + 1;
    }
  }
  return { text: out.join('\n'), written };
}

function segmentsOf(tokens) {
  const out = [];
  let seg = [];
  for (const t of tokens) {
    if (t && [...t].every((c) => SEP.includes(c))) {
      out.push(seg);
      seg = [];
    } else seg.push(t);
  }
  out.push(seg);
  return out.filter((s) => s.length);
}

// 앞의 대입(VAR=값)과 do, then 같은 접두 낱말 뒤 첫 낱말의 자리. 접두 `timeout 60`, `nice -n 5`도 건너뛴다.
function headIndex(words) {
  let k = 0;
  for (;;) {
    while (k < words.length && (PREFIX.has(words[k]) || ASSIGN.test(words[k]))) k += 1;
    if (k < words.length && /^(?:timeout|nice)$/.test(words[k])) {
      const t = words[k] === 'timeout';
      k += 1;
      while (k < words.length && words[k].startsWith('-')) k += /^-[nsk]$/.test(words[k]) ? 2 : 1;
      if (t) k += 1;
      continue;
    }
    return k;
  }
}

// sleep의 인자를 초로. 한 인자라도 읽지 못하면(변수 등) null, infinity는 Infinity.
function sleepSeconds(args) {
  const vals = args.filter((a) => !a.startsWith('-') || /^-\d/.test(a));
  if (!vals.length) return null;
  let sum = 0;
  for (const a of vals) {
    if (/^inf(?:inity)?$/i.test(a)) return Infinity;
    const m = /^(\d+(?:\.\d+)?)([smhd]?)$/.exec(a);
    if (!m) return null;
    sum += Number(m[1]) * UNIT_SEC[m[2]];
  }
  return sum;
}

function expandVars(s, env) {
  let unknown = false;
  const out = s.replace(/\$\{(\w+)\}|\$(\w+)/g, (_, a, b) => {
    const v = env.get(a ?? b);
    if (v === undefined) unknown = true;
    return v ?? '';
  });
  return unknown || /[`$]/.test(out) ? null : out;
}

function resolveScript(p, ctx) {
  const e = expandVars(p, ctx.env);
  if (e === null) return null;
  const x = sh.expanduser(e);
  if (sh.isAbs(x)) return path.normalize(x);
  return ctx.cwd === null ? null : path.normalize(path.join(ctx.cwd, x));
}

// text를 훑어 state(loops, lockLoops, sleeps, hit)에 쌓는다. 셸 글을 품은 낱말(bash -c, eval)과 .sh 실행은 재귀로 본다.
function scan(text, ctx, state, depth) {
  const { text: body, written } = stripHeredocs(text);
  for (const [f, b] of written) ctx.written.set(f, b);
  let tokens;
  try {
    tokens = sh.shlexTokens(body, { punctuation: SEP, whitespace: ' \t\r', commenters: '#' });
  } catch {
    return;
  }
  for (const words of segmentsOf(tokens)) {
    const head = words.slice(0, headIndex(words));
    for (const w of head) {
      const a = ASSIGN.exec(w);
      if (a && head.length === words.length) ctx.env.set(a[1], a[2]);
    }
    const i = headIndex(words);
    if (i >= words.length) continue;
    const cmd = base(words[i]);
    const args = words.slice(i + 1);
    if (cmd === 'until' || cmd === 'while') {
      state.loops += 1;
      const cond = args.find((a) => a !== '!') ?? '';
      if (LOCK_CMDS.has(base(cond))) state.lockLoops += 1;
      else if (READY_CMDS.has(base(cond))) state.ready = true;
    } else if (cmd === 'cd') {
      const t = args.find((a) => !a.startsWith('-'));
      const e = t === undefined || t === '-' ? null : expandVars(t, ctx.env);
      if (e === null) ctx.cwd = null;
      else {
        const x = sh.expanduser(e);
        ctx.cwd = sh.isAbs(x) ? x : ctx.cwd === null ? null : sh.join(ctx.cwd, x);
      }
    } else if (cmd === 'export') {
      for (const a of args) {
        const m = ASSIGN.exec(a);
        if (m) ctx.env.set(m[1], m[2]);
      }
    } else if (cmd === 'sleep') state.sleeps.push(sleepSeconds(args));
    else if (cmd === 'eval' && args.length && depth < MAX_DEPTH) scan(args.join(' '), ctx, state, depth + 1);
    const inline = SHELLS.has(cmd) ? args.findIndex((a) => /^-[a-z]*c[a-z]*$/.test(a)) : -1;
    if (inline >= 0 && args[inline + 1] !== undefined && depth < MAX_DEPTH) scan(args[inline + 1], ctx, state, depth + 1);
    const script = scriptOf(words, i, cmd, args, inline);
    if (script && !state.hit && depth < MAX_DEPTH) {
      const hit = checkScript(script, ctx, depth);
      if (hit) state.hit = hit;
    }
  }
}

// 이 낱말들이 .sh 파일을 실행하면 그 경로 글자를 돌려준다.
function scriptOf(words, i, cmd, args, inline) {
  if (/\.sh$/.test(words[i]) && !SHELLS.has(cmd)) return words[i];
  if ((SHELLS.has(cmd) || cmd === 'source' || cmd === '.') && inline < 0 && !args.includes('-n')) {
    const f = args.find((a) => !a.startsWith('-'));
    if (f && /\.sh$/.test(f)) return f;
  }
  return null;
}

// .sh 안에 막을 꼴이 있나. 같은 명령에서 방금 쓴 본문이 있으면 그것을, 아니면 디스크의 파일을 읽는다. 못 풀거나 못 읽으면 통과.
function checkScript(p, ctx, depth) {
  const file = resolveScript(p, ctx);
  if (file === null || ctx.seen.has(file)) return null;
  ctx.seen.add(file);
  let text = ctx.written.get(p);
  if (text === undefined) {
    const same = [...ctx.written].find(([f]) => path.basename(f) === path.basename(p));
    if (same) text = same[1];
  }
  if (text === undefined) {
    try {
      if (fs.statSync(file).size > MAX_FILE_BYTES) return null;
      text = fs.readFileSync(file, 'utf8');
    } catch {
      return null;
    }
  }
  const inner = newState();
  scan(text, { ...ctx, env: new Map(ctx.env), written: new Map() }, inner, depth + 1);
  const hit = inner.hit ?? verdict(inner);
  return hit ? `${path.basename(file)} 안: ${hit}` : null;
}

function verdict(state) {
  if (state.loops > state.lockLoops && state.sleeps.length) return `until이나 while 반복문 안의 sleep${state.ready ? `. ${READY_HINT}` : ''}`;
  const long = state.sleeps.find((s) => s !== null && s >= LONG_SLEEP_SEC);
  if (long !== undefined) return `${long === Infinity ? '끝없는' : `${long}초`} sleep`;
  return null;
}

const newState = () => ({ loops: 0, lockLoops: 0, ready: false, sleeps: [], hit: null });

function judge(data) {
  if (!sh || !data || data.tool_name !== 'Bash' || !data.agent_id) return null;
  const cmd = data.tool_input?.command;
  if (typeof cmd !== 'string' || !/sleep|\.sh\b/.test(cmd)) return null;
  const ctx = { cwd: data.cwd || process.cwd(), env: new Map(), written: new Map(), seen: new Set() };
  const state = newState();
  scan(cmd, ctx, state, 0);
  const hit = state.hit ?? verdict(state);
  return hit ? `${MESSAGE} (${hit})` : null;
}

if (require.main === module) {
  try {
    const data = JSON.parse(fs.readFileSync(0, 'utf8'));
    const reason = judge(data);
    if (reason) {
      logAsk(data, 'wait-loop-guard', reason);
      process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } })}\n`);
    }
  } catch {
    // 해석하지 못한 명령과 훅 안의 오류는 통과시킨다
  }
  process.exit(0);
}

module.exports = { judge };
