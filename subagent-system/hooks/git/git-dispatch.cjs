#!/usr/bin/env node
'use strict';

/**
 * git 훅 이어 부르기. `node git-dispatch.cjs <훅> <git이 준 인자…>`로 같은 폴더의 `<훅>.d/*.cjs` 조각을 차례로 불러 검사한다.
 * 조각 하나는 `module.exports = { name, run(ctx) }`이고 막을 말(문자열)을 돌려주면 그 말을 표준 에러에 찍고 종료 1로 끝낸다(첫 막힘에서 멈춤). 통과면 null.
 *   ctx = { hook, args, repoTop, configDir, config, hasBundle(이름) }
 * 왜: 묶음마다 git 검사가 따로 깔리고 빠지게 하려는 것이다. 한 파일에 합쳐 두면 묶음을 빼도 검사가 남거나 코드를 조각내 지워야 한다. 조각을 같은 프로세스에서 부르는 것은 커밋마다 node를 조각 수만큼 띄우지 않으려는 것이다.
 * 전제:
 *  - 조각을 불러오지 못하거나(없는 모듈, 문법 오류) run이 던지면 커밋을 막는다. 건너뛰고 통과시키면 반쯤 깔린 판에서 검사가 소리 없이 꺼진다. 표준 에러에 조각 이름, 오류 첫 줄, `git commit --no-verify` 안내를 낸다.
 *  - 조각 안에서 git 호출이 실패하는 것처럼 「검사하지 않음」으로 다룰 일은 조각이 스스로 잡아 null을 돌려준다.
 *  - 조각 차례는 파일 이름 앞 숫자 차례다(숫자가 같으면 이름 차례). .d 폴더가 없거나 비면 아무것도 하지 않고 0으로 끝난다.
 *  - 저장소 자체 훅(.githooks)은 이 파일이 아니라 sh 래퍼(commit-msg, pre-commit)가 이어 부른다.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { configDirOf, readConfig } = require('./gitHookShared.cjs');

const SKIP_HINT = '한 번 건너뛰려면 `git commit --no-verify`로 커밋합니다.';

const firstLine = (e) => String((e && e.message) || e).split('\n')[0];

function pieceFiles(dir, hook) {
  let names;
  try {
    names = fs.readdirSync(path.join(dir, `${hook}.d`));
  } catch {
    return [];
  }
  const order = (n) => Number((/^(\d+)/.exec(n) || [])[1] ?? Infinity);
  return names.filter((n) => n.endsWith('.cjs')).sort((a, b) => order(a) - order(b) || (a < b ? -1 : a > b ? 1 : 0));
}

function repoTopOf() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

function main(argv) {
  const [hook, ...args] = argv;
  if (!hook || !/^[a-z][a-z-]*$/.test(hook)) {
    process.stderr.write('git-dispatch: 사용법: git-dispatch.cjs <훅> [인자…]\n');
    return 1;
  }
  const files = pieceFiles(__dirname, hook);
  if (files.length === 0) return 0;
  const configDir = configDirOf(__dirname);
  const ctx = {
    hook,
    args,
    repoTop: repoTopOf(),
    configDir,
    config: readConfig(configDir),
    hasBundle: (name) => require('../../scripts/kitInstalled.cjs').hasBundle(name, configDir),
  };
  for (const file of files) {
    const label = `${hook}.d/${file}`;
    let result;
    try {
      const piece = require(path.join(__dirname, `${hook}.d`, file));
      if (!piece || typeof piece.run !== 'function') throw new Error('run 함수가 없습니다');
      result = piece.run(ctx);
    } catch (e) {
      process.stderr.write(`kit git 훅: 조각 ${label}을 돌리지 못해 커밋을 막았습니다(${firstLine(e)}). ${SKIP_HINT}\n`);
      return 1;
    }
    if (typeof result === 'string' && result !== '') {
      process.stderr.write(`${result}\n`);
      return 1;
    }
  }
  return 0;
}

process.exit(main(process.argv.slice(2)));
