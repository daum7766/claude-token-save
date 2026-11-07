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
 * 표시 파일 이름(<이름>.<pid>.<시작 초>)과 기록 줄 꼴(시각, 이름, 걸린 ms, 상태의 4열)은 zsh 감싸개와 같아 둘이 서로의 끊긴 표시를 읽는다.
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

  const r = spawnSync(cmd, args, { stdio: 'inherit' });

  const ms = Date.now() - t0;
  try {
    fs.unlinkSync(mark);
  } catch {
    // 이미 없으면 그만이다.
  }
  if (ms > SLOW_MS) logLine(rec, `${stamp(nowSec)}\t${name}\t${ms}\t끝남`);

  if (r.error) {
    process.stderr.write(`kit-hook: ${name}: 명령을 띄우지 못했습니다(${cmd}): ${r.error.message}\n`);
    return 1;
  }
  if (typeof r.status === 'number') return r.status;
  const num = os.constants.signals[r.signal];
  return 128 + (typeof num === 'number' ? num : 0);
}

process.exit(main(process.argv.slice(2)));
