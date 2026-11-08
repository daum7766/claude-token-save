#!/usr/bin/env node
'use strict';

/**
 * PreToolUse(Bash) 훅. 커밋하지 않은 변경이 있는 파일을 git checkout <파일>, git checkout -- <파일>, git restore <파일>로 되돌리려 하면 막는다.
 * --staged만 쓴 restore는 작업 트리를 건드리지 않아 둔다.
 * 왜: 시험용으로 붙인 한 줄을 떼려고 파일을 되돌리면, 그 파일에 다른 실무자가 해 둔 미커밋 고침까지 함께 사라지고 다시 찾을 기록이 없다. 문장 규칙으로는 막지 못했다.
 * 전제: 명령은 셸 꼴 그대로 들어오고, 대상 파일은 명령 안의 cd나 세션 cwd 기준 상대 경로다. 해석에 실패하면 통과한다(훅 오류로 일을 막지 않게).
 *   낱말 나누기는 guardShared.cjs가 처음 쓰인 파이썬 판(shlex.split)과 같게 한다.
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const sh = require('./guardShared.cjs');
const { callName } = require('../scripts/userSettings.cjs');

const GIT_VERB = new RegExp(`${sh.word('git')}[^;&|\\n]*${sh.word('checkout|restore')}`, 'u');

function changed(repo, p) {
  try {
    const r = spawnSync('git', ['-C', repo, 'status', '--porcelain', '--', p], { encoding: 'utf8', timeout: 5000 });
    return !r.error && Boolean(r.stdout.trim());
  } catch {
    return false;
  }
}

function main(data) {
  if (data.tool_name !== 'Bash') return null;
  const cmd = data.tool_input?.command ?? '';
  if (!cmd.includes('git') || !GIT_VERB.test(cmd)) return null;
  let cwd = data.cwd || process.cwd();
  for (const part of cmd.split(/&&|\|\||;|\n/)) {
    let toks;
    try {
      toks = sh.shlexSplit(part);
    } catch (e) {
      if (e instanceof sh.ShlexError) continue;
      throw e;
    }
    if (toks.length >= 2 && toks[0] === 'cd') {
      cwd = sh.join(cwd, sh.expanduser(toks[1]));
      continue;
    }
    if (!toks.includes('git')) continue;
    let rest = toks.slice(toks.indexOf('git') + 1);
    let repo = cwd;
    while (rest.length >= 2 && rest[0] === '-C') {
      repo = sh.join(cwd, rest[1]);
      rest = rest.slice(2);
    }
    if (!rest.length || !['checkout', 'restore'].includes(rest[0])) continue;
    const [verb, ...args] = rest;
    const has = (...f) => f.some((x) => args.includes(x));
    if (verb === 'restore' && has('--staged', '-S') && !has('--worktree', '-W')) continue;
    const paths = args.includes('--') ? args.slice(args.indexOf('--') + 1) : args.filter((a) => !a.startsWith('-'));
    for (const p of paths) {
      if (!sh.exists(sh.join(repo, p))) continue; // 브랜치 이름 등
      if (changed(repo, p)) {
        return `커밋하지 않은 변경이 있는 「${p}」를 git ${verb}로 되돌리려 한다. 그 변경은 다시 찾을 기록이 없다(남의 고침일 수 있다). `
          + `붙인 줄만 지우려면 그 줄을 직접 지우고, 시험은 임시 사본이나 시험 데이터로 한다. 정말 버릴 것이면 ${callName()}에게 묻는다.`;
      }
    }
  }
  return null;
}

try {
  const reason = main(JSON.parse(fs.readFileSync(0, 'utf8')));
  if (reason) process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } })}\n`);
} catch {
  // 해석하지 못한 명령은 통과시킨다
}
process.exit(0);
