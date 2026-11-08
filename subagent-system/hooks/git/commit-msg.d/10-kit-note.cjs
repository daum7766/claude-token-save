'use strict';

/**
 * 키트 쪽 고침 자리 검사(base 묶음의 git 조각). 설치본 저장소의 커밋 메시지가 「키트 <번호> 같은 고침」 꼬리의 번호를 비워 두면 막는다.
 * 또 KIT_DRIFT_SKIP=1로 고정 파일 검사를 건너뛴 커밋은 메시지에 키트 쪽 고침의 자리(키트 커밋 해시나 판 번호)가 있어야 통과한다.
 * 왜: 키트가 놓은 파일을 설치본에서만 고치고 메시지 꼬리에 「(키트  같은 고침)」처럼 번호를 비운 채 들어간 커밋 셋이 다음 sync에 덮여 같은 고침을 다시 했다. 건너뛰기가 그 틈이었고, sync의 알림은 덮은 뒤에야 온다.
 * 전제:
 *  - config에 kitSourcePath가 있고 이 커밋이 설치본 저장소(설정 폴더)의 것일 때만 돈다. merge 커밋과 `fixup!`, `squash!`, `amend!`는 통과한다.
 *  - 번호는 키트 커밋 해시(7~40자리 16진수)나 판 번호(2026.11.8.11 꼴)다. 해시는 원본 저장소에서 찾을 수 있으면 실제 커밋인지도 본다(원본을 못 읽으면 꼴만 본다).
 *  - 건너뛰기를 안 쓴 커밋은 꼬리 번호가 빈 때만 막는다(check-staged가 이미 원본과의 차이를 본다). commitCheck가 off여도 돈다(check-staged처럼 이 장치는 commitCheck와 상관없다).
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { EXEMPT, bodyOf, NO_MESSAGE_ARG } = require('../gitHookShared.cjs');

const TAIL = /키트[ \t]+([^\s()]*)[ \t]*같은 고침/g;
const HASH = /^[0-9a-f]{7,40}$/i;
const VERSION = /^\d{4}\.\d+\.\d+\.\d+$/;
const REF = /키트[ \t]+(?:[0-9a-f]{7,40}|\d{4}\.\d+\.\d+\.\d+)(?![\w.])/i;

// 통과면 null, 아니면 막는 말. opts: { skip: 건너뛰기를 썼는가, resolves(해시): 원본에 있는 커밋인가 }.
function checkKitNote(raw, opts = {}) {
  const body = bodyOf(raw);
  if (body === '' || EXEMPT.test(body)) return null;
  const problems = [];
  for (const m of body.matchAll(TAIL)) {
    const num = m[1];
    if (num === '') problems.push('「키트  같은 고침」의 키트 번호가 비어 있습니다');
    else if (!HASH.test(num) && !VERSION.test(num)) problems.push(`「키트 ${num} 같은 고침」의 번호가 키트 커밋 해시나 판 번호 꼴이 아닙니다`);
    else if (HASH.test(num) && opts.resolves && !opts.resolves(num)) problems.push(`키트 원본에 ${num} 커밋이 없습니다`);
  }
  if (problems.length === 0 && opts.skip && !REF.test(body)) problems.push('KIT_DRIFT_SKIP=1로 건너뛰었는데 메시지에 키트 쪽 고침의 자리가 없습니다');
  if (problems.length === 0) return null;
  return [
    '커밋을 막았습니다. 키트 쪽 고침의 자리가 없습니다.',
    ...problems.map((p) => `  ${p}`),
    '키트 파일을 설치본에서만 고치면 다음 sync가 덮습니다. 원본(kitSourcePath)에 같은 고침을 먼저 커밋하고, 메시지에 `(키트 <커밋 해시> 같은 고침)`을 적어 다시 커밋합니다.',
    '키트와 상관없는 고침이면 꼬리의 「키트 … 같은 고침」을 지웁니다.',
  ].join('\n');
}

const real = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
};

function run(ctx) {
  const source = ctx.config.kitSourcePath;
  if (typeof source !== 'string' || source.trim() === '') return null;
  if (!ctx.repoTop || real(ctx.repoTop) === null || real(ctx.repoTop) !== real(ctx.configDir)) return null;
  const file = ctx.args[0];
  if (!file) return NO_MESSAGE_ARG;
  const resolves = (hash) => {
    if (!fs.existsSync(path.join(source, '.git'))) return true;
    try {
      execFileSync('git', ['-C', source, 'cat-file', '-e', `${hash}^{commit}`], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  };
  return checkKitNote(fs.readFileSync(file, 'utf8'), { skip: process.env.KIT_DRIFT_SKIP === '1', resolves });
}

module.exports = { name: 'kit-note', run, checkKitNote };
