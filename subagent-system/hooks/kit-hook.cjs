#!/usr/bin/env node
'use strict';

/**
 * 훅 감싸개. `node kit-hook.cjs <이름> <명령> [인자…]`로 훅 명령을 돌리고, 0.5초 넘게 걸린 실행과 끝나지 못한 실행(시간 제한으로 끊김)을
 * records/hook-time.tsv에 남긴다. 표준 입력, 표준 출력, 표준 에러, 종료 코드는 그대로 넘긴다.
 * 왜: 훅 안에서 재면 시간 제한으로 끊긴 실행이 남지 않는다. 훅마다 재는 코드를 넣지 않고 감싸개 하나로 모든 훅을 잰다. zsh가 없는 컴퓨터에서도 돌게 node로 짰다.
 * 전제:
 *  - 감싸개 자신은 표준 출력에 아무것도 쓰지 않는다. 막는 훅은 종료 2가 아니라 종료 0과 표준 출력 JSON으로 막기 때문이다. 감싸개 오류는 표준 에러로만 낸다.
 *  - 자식이 신호로 죽으면 128 + 신호 번호로 끝난다(그대로 넘기면 0, 성공이 되어 막는 훅이 꺼진다). 자식을 못 띄우면(명령 없음) 표준 에러에 까닭을 쓰고 1로 끝난다.
 *  - 시작할 때 표시 파일을 두고 끝나면 지운다. 다음 실행 때 15초 넘게 남은 표시는 끊긴 실행으로 적고 지운다(표시 이름의 pid가 살아 있으면 끊김이 아님).
 *  - 기록을 못 써도 훅 실행은 막지 않는다. 기록 자리는 SUBAGENT_RECORDS_DIR가 있으면 그것, 없으면 설정 폴더의 subagent-system/records다(키트의 다른 기록 훅과 같은 이름).
 * 훅이 대화에 넣은 글자 수는 records/hook-output.tsv(시각, 이름, 글자 수)에 한 줄로 남긴다. 글자가 0이면 적지 않는다. 왜: 장치 층 비용(훅이 대화에 넣는 글자)과 한 번도 걸리지 않은 훅을 훅 안 고치고 감싸개 하나로 재려는 것이다(work-metrics.js waste).
 *  - 글자 수는 표준 출력 JSON의 additionalContext, systemMessage, reason, permissionDecisionReason 길이 합이고, 그 꼴이 아니면 표준 출력 전체 길이(`{}`는 0)다. 종료 2면 표준 에러 길이를 더한다.
 *  - 표준 출력과 표준 에러는 끝난 뒤 그대로 넘긴다(관을 거침). 훅이 뒷일꾼을 떼어 내 관을 잡고 있으면 끝나지 않으므로 키트 훅은 그렇게 하지 않는다.
 * 표시 파일 이름(<이름>.<pid>.<시작 초>)과 기록 줄 꼴(시각, 이름, 걸린 ms, 상태의 4열)은 zsh 감싸개와 같아 둘이 서로의 끊긴 표시를 읽는다.
 * 막음 기록: 훅이 막는 출력(표준 출력 JSON의 decision block이나 permissionDecision deny, 종료 코드 2)을 내면 records/hook-blocks.tsv(시각, 세션, 판정 이름, 도구, 입력)에 한 줄씩 적는다.
 *  왜: 훅마다 기록 코드를 덧대면 빠진 훅이 회고의 낭비 보기(work-metrics.js waste)에 안 잡힌다. 지시문 점검이 그렇게 빠져 헛막음 3번이 보이지 않았다(2026-11-08 키트 목적 판정). 막는 훅은 모두 감싸개를 거치므로 여기서 한 번에 적는다.
 *  - 세션, 도구, 입력은 표준 입력 JSON에서 읽는다. 감싸개가 표준 입력을 읽어 자식에게 그대로 넘긴다(터미널이면 읽지 않고 이어 준다).
 *  - 판정 이름은 훅이 알려 준 것을 먼저 쓴다. 훅은 막는 출력 객체에 `named(출력, 이름들)`로 이름을 붙이고(JSON에는 실리지 않는다) 끝에서 `reportBlocks(출력)`을 부르면, 환경 변수 KIT_HOOK_BLOCKS_FILE이 가리키는 파일에 한 줄에 하나씩 적힌다.
 *    이름 뒤에 탭과 입력 글을 붙이면 그 줄의 입력 칸이 된다. 훅이 이름을 안 알리면 사유의 쌍점 앞 짧은 말, 그것도 없으면 훅 이름을 쓴다.
 *  - 훅 코드는 기록 파일을 직접 쓰지 않는다(겹쳐 쓰지 않으려는 것). 감싸개 없이 훅을 직접 돌리면(시험, 수동 실행) 막음 기록이 남지 않는다.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BROKEN_AFTER_SEC = 15;
const SLOW_MS = 500;

const recordsDir = () => process.env.SUBAGENT_RECORDS_DIR || path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'subagent-system', 'records');

function stamp(sec) {
  const d = new Date(sec * 1000);
  const z = (n, w = 2) => String(n).padStart(w, '0');
  const off = -d.getTimezoneOffset();
  const sign = off < 0 ? '-' : '+';
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}${sign}${z(Math.floor(Math.abs(off) / 60))}${z(Math.abs(off) % 60)}`;
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function logLine(rec, line) {
  try {
    fs.appendFileSync(path.join(rec, 'hook-time.tsv'), `${line}\n`);
  } catch {
    // 기록 실패가 훅 실행을 막지 않게 한다.
  }
}

// 앞서 끊긴 실행: 표시의 시작 초가 15초 넘게 지났고 그 pid가 이미 없으면 적고 지운다.
function recordBroken(run, rec, mark, nowSec) {
  let files;
  try {
    files = fs.readdirSync(run);
  } catch {
    return;
  }
  for (const f of files) {
    const file = path.join(run, f);
    if (file === mark) continue;
    const parts = f.split('.');
    if (parts.length < 3) continue;
    const start = Number(parts[parts.length - 1]);
    const pid = Number(parts[parts.length - 2]);
    if (!Number.isFinite(start) || !Number.isInteger(pid) || pid <= 0 || alive(pid)) continue;
    if (nowSec - start <= BROKEN_AFTER_SEC) continue;
    try {
      fs.unlinkSync(file);
    } catch {
      continue; // 동시에 도는 훅 가운데 지우기에 성공한 하나만 적는다.
    }
    logLine(rec, `${stamp(start)}\t${parts[0]}\t\t끊김(끝나지 못함)`);
  }
}

const BLOCKS_ENV = 'KIT_HOOK_BLOCKS_FILE';

// 훅이 막는 출력 객체에 판정 이름을 붙인다. 열거되지 않는 속성이라 JSON으로 나가지 않는다.
function named(out, names) {
  if (out && typeof out === 'object') Object.defineProperty(out, 'blockNames', { value: names, enumerable: false, configurable: true });
  return out;
}

// 훅 쪽에서 부른다. 감싸개가 준 파일에 판정 이름을 한 줄에 하나씩 적는다. 감싸개 밖이면 아무것도 하지 않는다.
function reportBlocks(out) {
  const file = process.env[BLOCKS_ENV];
  if (!file || !out || !Array.isArray(out.blockNames) || !out.blockNames.length) return;
  try {
    fs.appendFileSync(file, `${out.blockNames.map((n) => String(n).replace(/\n/g, ' ')).join('\n')}\n`);
  } catch {
    // 기록 실패가 훅 실행을 막지 않게 한다.
  }
}

// 표준 입력을 끝까지 읽는다. 터미널이거나 읽지 못하면 null(그때는 자식에게 입력을 그대로 이어 준다).
// 맥의 관은 비동기라 EAGAIN이 날 수 있어 기다렸다 다시 읽는다. process.stdin을 건드리면 입력이 비동기로 바뀌어 쓰지 않는다.
function readStdin() {
  try {
    if (require('node:tty').isatty(0)) return null;
  } catch {
    return null;
  }
  const chunks = [];
  const buf = Buffer.alloc(65536);
  for (;;) {
    let n;
    try {
      n = fs.readSync(0, buf, 0, buf.length, null);
    } catch (e) {
      if (e.code === 'EAGAIN') {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
        continue;
      }
      if (e.code === 'EOF') break;
      return null;
    }
    if (n === 0) break;
    chunks.push(Buffer.from(buf.subarray(0, n)));
  }
  return Buffer.concat(chunks);
}

// 막는 출력이면 사유를, 아니면 null. 막는 출력: 종료 코드 2, decision이 block, permissionDecision이 deny.
function blockReason(r) {
  const out = r.stdout ? r.stdout.toString('utf8').trim() : '';
  if (out && out !== '{}') {
    try {
      const j = JSON.parse(out);
      const h = j && typeof j === 'object' ? j.hookSpecificOutput || {} : {};
      if (j && j.decision === 'block') return String(j.reason || '');
      if (h.permissionDecision === 'deny') return String(h.permissionDecisionReason || '');
    } catch {
      // JSON이 아니면 종료 코드만 본다.
    }
  }
  if (r.status === 2) return r.stderr ? r.stderr.toString('utf8') : '';
  return null;
}

// 판정 이름: 사유가 「짧은 말: …」로 시작하면 그 짧은 말, 아니면 훅 이름.
function guessName(reason, hook) {
  const head = String(reason).split(':')[0].trim();
  return String(reason).includes(':') && /^[^\n.。]{1,16}$/.test(head) ? head : hook;
}

function recordBlocks(rec, hook, nowSec, input, r, reported) {
  const reason = blockReason(r);
  if (reason === null) return;
  const lines = reported.length ? reported : [guessName(reason, hook)];
  const sid = String(input.session_id || 'none');
  const tool = input.tool_name || input.hook_event_name || '';
  const key = input.tool_name ? `${input.tool_name}:${JSON.stringify(input.tool_input || {})}`.slice(0, 160) : '';
  const rows = lines.map((l) => {
    const [name, given] = String(l).split('\t');
    return [new Date(nowSec * 1000).toISOString(), sid, name, tool, given ?? key].map((c) => String(c).replace(/[\t\n]/g, ' ')).join('\t');
  });
  try {
    fs.appendFileSync(path.join(rec, 'hook-blocks.tsv'), `${rows.join('\n')}\n`);
  } catch {
    // 기록 실패가 훅 실행을 막지 않게 한다.
  }
}

// 훅이 대화에 넣은 글자 수. JSON이면 대화에 실리는 문구 필드만, 아니면 표준 출력 전체를 센다.
function outputChars(r) {
  const out = r.stdout ? r.stdout.toString('utf8') : '';
  let n = 0;
  const text = out.trim();
  if (text && text !== '{}') {
    try {
      const j = JSON.parse(text);
      const h = j && typeof j === 'object' ? j.hookSpecificOutput || {} : {};
      const len = (v) => (typeof v === 'string' ? v.length : 0);
      n = len(h.additionalContext) + len(h.permissionDecisionReason) + len(j.reason) + len(j.systemMessage) + len(j.additionalContext);
    } catch {
      n = text.length;
    }
  }
  if (r.status === 2 && r.stderr) n += r.stderr.toString('utf8').length;
  return n;
}

function main(argv) {
  const [name, cmd, ...args] = argv;
  if (!name || !cmd) {
    process.stderr.write('kit-hook: 사용법: kit-hook.cjs <이름> <명령> [인자…]\n');
    return 1;
  }
  const rec = recordsDir();
  const run = path.join(rec, 'hook-running');
  const t0 = Date.now();
  const nowSec = Math.floor(t0 / 1000);
  const mark = path.join(run, `${name}.${process.pid}.${nowSec}`);
  try {
    fs.mkdirSync(run, { recursive: true });
    fs.writeFileSync(mark, '');
    recordBroken(run, rec, mark, nowSec);
  } catch {
    // 표시를 못 둬도 훅은 돌린다.
  }

  const stdin = readStdin();
  const blocksFile = `${mark}.blocks`;
  const r = spawnSync(cmd, args, {
    stdio: [stdin === null ? 'inherit' : 'pipe', 'pipe', 'pipe'],
    input: stdin === null ? undefined : stdin,
    env: { ...process.env, [BLOCKS_ENV]: blocksFile },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.stdout && r.stdout.length) process.stdout.write(r.stdout);
  if (r.stderr && r.stderr.length) process.stderr.write(r.stderr);

  const ms = Date.now() - t0;
  try {
    fs.unlinkSync(mark);
  } catch {
    // 이미 없으면 그만이다.
  }
  if (ms > SLOW_MS) logLine(rec, `${stamp(nowSec)}\t${name}\t${ms}\t끝남`);

  let input = {};
  try {
    input = stdin ? JSON.parse(stdin.toString('utf8')) || {} : {};
  } catch {
    input = {};
  }
  let reported = [];
  try {
    reported = fs.readFileSync(blocksFile, 'utf8').split('\n').filter(Boolean);
    fs.unlinkSync(blocksFile);
  } catch {
    // 훅이 이름을 알리지 않았으면 파일이 없다.
  }
  recordBlocks(rec, name, nowSec, input, r, reported);

  const chars = outputChars(r);
  if (chars > 0) {
    try {
      fs.appendFileSync(path.join(rec, 'hook-output.tsv'), `${stamp(nowSec)}\t${name}\t${chars}\n`);
    } catch {
      // 기록 실패가 훅 실행을 막지 않게 한다.
    }
  }

  if (r.error) {
    process.stderr.write(`kit-hook: ${name}: 명령을 띄우지 못했습니다(${cmd}): ${r.error.message}\n`);
    return 1;
  }
  if (typeof r.status === 'number') return r.status;
  const num = os.constants.signals[r.signal];
  return 128 + (typeof num === 'number' ? num : 0);
}

// exit 대신 exitCode: 맥의 관(pipe) 쓰기는 비동기라 process.exit가 큰 출력을 자를 수 있다.
if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { named, reportBlocks, blockReason, guessName };
