#!/usr/bin/env node
'use strict';

/**
 * PreToolUse(Bash) 훅. 재귀 삭제(rm -r, -rf, -fr)의 대상을 따져 묻지 않고 통과, 다시 쓰는 법과 함께 거절, 승인 창 셋 가운데 하나를 낸다.
 * - Claude 임시 폴더(/private/tmp/claude-<uid>/ 아래) 안이면 묻지 않는다. uid 폴더 자체는 묻는다. 지우면 모든 세션의 임시 폴더가 함께 사라지기 때문이다.
 * - 존재하는 일반 파일이나 심링크 하나는 재귀 플래그가 있어도 폴더가 아니라 그 하나만 지우므로 묻지 않는다.
 * - git rm --cached는 인덱스에서만 빼고 작업 트리의 파일은 지우지 않으므로 묻지 않는다.
 * - -f 없는 git rm -r은 HEAD와 같은 추적 파일만 지우고 고친 파일이 있으면 git이 거절해, 늘 git에서 되살릴 수 있어 묻지 않는다.
 * - 같은 명령 안의 cd와 변수 대입(X=..., export X=...)을 따라가 실제 대상을 계산한다. for 반복 변수는 나열한 값마다 따진다. heredoc 본문은 셸에 넘길 때만 명령으로 본다.
 * - 다시 만들어지는 캐시(__pycache__, .pytest_cache, node_modules/.vite-*)는 어디서든 묻지 않는다.
 * - 워크트리 안의 임시 폴더(config.json safetyTempDirs에 든 이름)는 워크트리를 지우면 함께 사라지므로 묻지 않는다. 본 폴더의 같은 이름 폴더는 인계 문서가 있을 수 있어 묻는다.
 *   키가 없거나 비면 이 통과 갈래는 꺼진다(묻는 쪽).
 * - 대상을 알 수 없는 꼴(모르는 변수, 명령 치환, xargs, 모르는 폴더의 상대 경로, 해석 실패)과 Claude 임시 폴더가 아닌 /tmp 아래는 묻지 않고 거절하며 다시 쓰는 법을 알린다.
 *   왜: 이런 승인 창은 위험해서가 아니라 명령 모양 때문에 떠서 사용자 시간만 쓴다. 거절은 확인보다 엄격해 막는 힘은 그대로다.
 * - git이 추적하고 고친 것이 없는 파일만 든 폴더는 git에서 되살릴 수 있어 묻지 않는다. 추적 안 하는 파일, 무시 파일, 고친 파일, 안쪽 .git이 하나라도 있거나 저장소 맨 위면 묻는다.
 *   왜: 되살릴 수 있는 삭제는 물어도 막는 것이 없고, 승인 창은 사용자 시간을 쓰고 자리를 비운 동안 일을 세운다.
 * - 그 밖의 대상(임시 폴더 밖의 실제 경로)은 승인 창을 띄운다.
 * - config.json deleteToTrash가 true면 임시 폴더와 캐시 밖의 rm(파일 하나 포함)과 --cached 없는 git rm을 거절하고 휴지통 스크립트(scripts/trash.js)를 쓰게 한다.
 *   왜: 지운 뒤 문제가 생겨도 휴지통에서 되돌릴 수 있게 하려는 것이다. 꺼져 있으면 위 판정 그대로다.
 * 띄우거나 거절할 때마다 승인 창 기록(ask-log.js의 logAsk)에 한 줄을 남기고, 회고가 그 기록으로 이 훅을 고친다.
 * 전제: 낱말 나누기와 경로 풀기는 guardShared.cjs가 처음 쓰인 파이썬 판과 같게 한다. 훅 안의 예상 못 한 오류는 통과로 끝난다(훅 오류로 일을 막지 않게).
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const sh = require('./guardShared.cjs');
const { logAsk } = require('./ask-log.js');
const { readConfig } = require('../scripts/userSettings.cjs');

const { W, D, S, NS, END, word } = sh;
const ALLOWED = new RegExp('^/private/tmp/claude-' + D + '+/[^\\n]+', 'u');
const SEP = ';&|()\n';
const ASSIGN = new RegExp(`^([A-Za-z_]${W}*)=([\\s\\S]*)$`, 'u');
const CACHE = new RegExp(`/(?:__pycache__|\\.pytest_cache)${END}|/node_modules/\\.vite-[^/]+${END}`, 'u');
const CONFIG = readConfig();
const TEMP_DIRS = (() => {
  const v = CONFIG.safetyTempDirs;
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : [];
})();
const WT_TEMP = TEMP_DIRS.length
  ? new RegExp(`/\\.claude/worktrees/[^/]+/(?:${TEMP_DIRS.map((d) => sh.escapeRe(d.replace(/^\/+|\/+$/g, ''))).join('|')})(?:/|${END})`, 'u')
  : /(?!)/;
const PREFIX_OK = new Set(['sudo', 'command', 'builtin', 'do', 'then', 'else', '{', '!', 'time']);
// 대입 값이 `$(mktemp -d)`(글자 그대로인 틀이나 -t 이름만 붙은 것 포함)면 새로 만든 임시 폴더로 본다. 그 밖의 명령 치환은 모르는 값이다.
const WC = `[\\p{L}\\p{N}_.\\-]`;
const MKTEMP = new RegExp(`\\$\\(mktemp -d(?: -t ${WC}+| [\\p{L}\\p{N}_./\\-]*X{3,}${WC}*)?\\)`, 'gu');
const FRESH_TMP = '/private/tmp/claude-0/mktemp-fresh';
const SHELLS = new Set(['bash', 'sh', 'zsh']);
const HEREDOC = new RegExp(`(?<!<)<<(?!<)(-?)${S}*(["']?)([A-Za-z_]${WC}*)\\2`, 'gu');
const RM = new RegExp(word('rm'), 'u');
const RM_RECURSIVE = new RegExp(`${word('rm')}${S}+(?:-${NS}*[rR]|--recursive)`, 'u');
const VAR = new RegExp(`\\$\\{(${W}+)\\}|\\$(${W}+)`, 'gu');
const VAR_HEAD = new RegExp(`\\$\\{?(${W}+)`, 'gu');
const OTHER_TMP = new RegExp(`^/private/tmp/(?!claude-${D}+(?:/|${END}))`, 'u');
const REDIRECT = new RegExp(`^${D}*[<>]`, 'u');
const REDIRECT_ALONE = new RegExp(`^${D}*[<>]+&?$`, 'u');
// 켜면(config.json deleteToTrash가 true) 임시 폴더와 캐시 밖의 rm과 작업 트리에서도 지우는 git rm은 모두 막고 휴지통 스크립트를 쓰게 한다.
// 임시 폴더와 캐시는 AI가 만든 산출물이라 지금처럼 지우게 둔다(휴지통을 채우기만 한다).
const TO_TRASH = CONFIG.deleteToTrash === true;
const TRASH_SCRIPT = path.join(__dirname, '..', 'scripts', 'trash.js');
const shellWord = (w) => (/^[\p{L}\p{N}_@%+=:,./~$-]+$/u.test(w) ? w : `'${w.replace(/'/g, "'\\''")}'`);
const REWRITE = ' 다시 쓰는 법: 지울 대상을 절대 경로 글자 그대로 rm 뒤에 적는다(변수, 명령 치환, xargs, 모르는 cd 없이). '
  + `임시 파일은 /tmp 대신 세션 scratchpad에 둔다. ${TO_TRASH ? '임시 폴더 밖은 rm 대신 휴지통 스크립트로 옮긴다.' : '그 꼴로도 임시 폴더 밖이면 사용자 확인이 뜬다.'}`;

const hasGlob = (p) => /[*?[]/.test(p);

class Decision {
  constructor(decision, reason) {
    this.decision = decision;
    this.reason = reason;
  }
}

let data;
function ask(reason) {
  logAsk(data, 'rm-guard', reason);
  throw new Decision('ask', reason);
}
function denyToTrash(t, targets) {
  const reason = `휴지통으로 옮기는 설정(deleteToTrash)이라 영구 삭제를 막는다: ${t}. 대신 node "${TRASH_SCRIPT}" ${targets.map(shellWord).join(' ')} 로 휴지통에 옮긴다. `
    + 'git 안 파일은 옮긴 뒤 그 파일만 지정해 커밋한다(git commit -- <대상>).';
  logAsk(data, 'rm-guard:trash', reason);
  throw new Decision('deny', reason);
}
function deny(reason) {
  logAsk(data, 'rm-guard:deny', reason);
  throw new Decision('deny', reason + REWRITE);
}

// 아는 변수만 풀어 쓴다. 명령 치환이나 모르는 변수가 남으면 null.
function expand(s, env) {
  if (s.includes('`') || s.includes('$(')) return null;
  let unknown = false;
  const out = s.replace(VAR, (_, a, b) => {
    const name = a ?? b;
    if (!env.has(name)) {
      unknown = true;
      return '';
    }
    return env.get(name);
  });
  if (unknown || out.includes('$')) return null;
  return sh.expanduser(out);
}

function* product(lists) {
  if (!lists.length) {
    yield [];
    return;
  }
  for (const v of lists[0]) for (const rest of product(lists.slice(1))) yield [v, ...rest];
}

// for 반복 변수가 들어 있으면 나열한 값마다 풀어 본다. 하나라도 모르면 null.
function expandLoops(s, env, loops) {
  const names = [...new Set([...s.matchAll(VAR)].map((m) => m[1] ?? m[2]))].filter((n) => loops.has(n));
  const out = [];
  for (const combo of product(names.map((n) => loops.get(n)))) {
    const e = new Map(env);
    names.forEach((n, i) => e.set(n, combo[i]));
    const p = expand(s, e);
    if (p === null) return null;
    out.push(p);
  }
  return out;
}

// heredoc 본문은 파일 내용이라 명령으로 읽지 않는다. 셸(bash, sh, zsh)에 넘기는 본문만 남긴다.
function stripHeredocs(cmd) {
  const lines = cmd.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    out.push(line);
    i += 1;
    for (const m of line.matchAll(HEREDOC)) {
      const dash = m[1];
      const delim = m[3];
      let end = null;
      for (let j = i; j < lines.length; j += 1) {
        if ((dash ? lines[j].replace(/^\t+/, '') : lines[j]) === delim) {
          end = j;
          break;
        }
      }
      if (end === null) return cmd;
      const before = line.slice(0, m.index).match(new RegExp(`${WC}+`, 'gu')) ?? [];
      if (before.some((w) => SHELLS.has(w))) out.push(...lines.slice(i, end));
      out.push('');
      i = end + 1;
    }
  }
  return out.join('\n');
}

function allowed(p, cwd) {
  if (!sh.isAbs(p)) p = sh.join(cwd, p);
  if (!hasGlob(p) && CACHE.test(sh.realpath(p))) return true;
  if (hasGlob(p)) {
    p = p.slice(0, Math.min(...['*', '?', '['].map((c) => p.indexOf(c)).filter((n) => n >= 0)));
    p = `${sh.dirname(p)}/x`;
  }
  const name = sh.basename(p);
  // 마지막 이름이 .이나 ..이면 위 폴더를 가리키므로 이름을 떼지 않고 통째로 푼다. 떼면 uid 폴더 자신을 놓친다.
  const real = name === '.' || name === '..' ? sh.realpath(p) : `${sh.realpath(sh.dirname(p))}/${name}`;
  return ALLOWED.test(real) || WT_TEMP.test(real);
}

function hasGitInside(dir) {
  let ents;
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const e of ents) {
    if (e.name === '.git') return true;
    if (e.isDirectory() && hasGitInside(`${dir}/${e.name}`)) return true;
  }
  return false;
}

// 모든 파일이 커밋된 그대로이고 그 밖의 파일이 없으면 git checkout으로 되살릴 수 있다.
function gitRestorable(full) {
  if (!sh.isDir(full) || sh.isLink(full)) return false;
  try {
    const git = (...a) => {
      const r = spawnSync('git', ['-C', full, ...a], { encoding: 'utf8', timeout: 5000 });
      if (r.error) throw r.error;
      return r;
    };
    const top = git('rev-parse', '--show-toplevel');
    if (top.status !== 0 || sh.realpath(top.stdout.trim()) === full) return false;
    if (hasGitInside(full)) return false;
    const tracked = git('ls-files', '--', '.');
    const status = git('status', '--porcelain', '--ignored', '--untracked-files=all', '--', '.');
    return tracked.status === 0 && status.status === 0 && Boolean(tracked.stdout.trim()) && !status.stdout.trim();
  } catch {
    return false;
  }
}

// 글롭이 있는 대상과 없는 대상은 기존 판정을 따른다.
function plainTarget(p, base) {
  if (hasGlob(p)) return false;
  const full = sh.isAbs(p) ? p : sh.join(base, p);
  return sh.isLink(full) || sh.isFile(full);
}

// 따옴표 안의 | ; & 는 나누지 않는다. 나누는 기호와 줄바꿈만 명령 경계로 본다.
function segments(cmd) {
  const out = [];
  let seg = [];
  for (const tok of sh.shlexTokens(cmd, { punctuation: SEP, whitespace: ' \t\r', commenters: '#' })) {
    if (tok && [...tok].every((c) => SEP.includes(c))) {
      out.push([seg, tok]);
      seg = [];
    } else seg.push(tok);
  }
  out.push([seg, '']);
  return out;
}

// 옮겨 간 폴더를 추적한다. 알 수 없거나 없는 폴더면 null.
function changeDir(cur, words, env) {
  const arg = words.length > 1 ? words[1] : '~';
  let p = arg === '-' ? null : expand(arg, env);
  if (p === null) return null;
  if (!sh.isAbs(p)) {
    if (cur === null) return null;
    p = sh.join(cur, p);
  }
  p = sh.realpath(p);
  return sh.isDir(p) ? p : null;
}

function targetsOf(args) {
  const out = [];
  let skip = false;
  for (const a of args) {
    if (skip) {
      skip = false;
      continue;
    }
    if (REDIRECT.test(a)) {
      skip = REDIRECT_ALONE.test(a);
      continue;
    }
    if (!a.startsWith('-')) out.push(a);
  }
  return out;
}

function checkRm(words, cur, cwd, env, loops) {
  const i = words.indexOf('rm');
  const before = words.slice(0, i);
  const args = words.slice(i + 1);
  const flags = args.filter((a) => a.startsWith('-') && a !== '--');
  const recursive = flags.some((a) => a === '--recursive' || (!a.startsWith('--') && /[rR]/.test(a)));
  if (!recursive && !TO_TRASH) return;
  if (before[before.length - 1] === 'git' && !before.includes('xargs') && args.includes('--cached')) return;
  const gitRm = before.length === 1 && before[0] === 'git';
  if (gitRm && !TO_TRASH && !flags.some((a) => a === '--force' || (!a.startsWith('--') && a.includes('f')))) {
    // -f 없는 git rm은 HEAD와 같은 추적 파일만 지우고 고친 파일이 있으면 거절해 git에서 늘 되살릴 수 있다.
    return;
  }
  const what = recursive ? '재귀 삭제' : '삭제';
  if (before.includes('xargs') || (!(gitRm && TO_TRASH) && before.some((w) => !PREFIX_OK.has(w) && !ASSIGN.test(w)))) deny(`${what} 대상을 미리 알 수 없습니다`);
  const targets = targetsOf(args);
  if (!targets.length) deny(`${what} 대상이 없습니다`);
  for (const t of targets) {
    const ps = expandLoops(t, env, loops);
    if (ps === null) deny(`값을 알 수 없는 변수로 ${what}: ${t}`);
    for (const p of ps) {
      if (p.startsWith(FRESH_TMP) && p.slice(FRESH_TMP.length).split('/').includes('..')) deny(`새로 만든 임시 폴더 밖을 가리키는 ${what}: ${t}`);
      if (cur === null && !sh.isAbs(p)) deny(`어느 폴더인지 알 수 없는 곳에서 상대 경로 ${what}: ${t}`);
      if (TO_TRASH) {
        if (allowed(p, cur ?? cwd)) continue;
        denyToTrash(t, targets);
      }
      if (plainTarget(p, cur ?? cwd)) continue;
      if (!allowed(p, cur ?? cwd)) {
        const full = sh.realpath(sh.isAbs(p) ? p : sh.join(cur ?? cwd, p));
        if (OTHER_TMP.test(full)) deny(`Claude 임시 폴더가 아닌 /tmp 재귀 삭제: ${t}`);
        if (!hasGlob(p) && gitRestorable(full)) continue;
        ask(`Claude 임시 폴더 밖 재귀 삭제: ${t}`);
      }
    }
  }
}

function main(raw) {
  data = JSON.parse(raw);
  const inp = data.tool_input === undefined ? {} : data.tool_input;
  let cmd = inp.command === undefined ? '' : inp.command;
  if (typeof cmd !== 'string') return;
  const cwd = data.cwd || process.cwd();
  if (!RM.test(cmd)) return;

  cmd = stripHeredocs(cmd);
  // `$(mktemp -d)`는 이 명령이 방금 만든 빈 임시 폴더라 지워도 잃을 것이 없다. 실제 경로는 몰라 허용 폴더 아래 자리 이름으로 바꿔 읽는다(`$T/..`처럼 벗어나면 막힌다).
  cmd = cmd.replace(MKTEMP, FRESH_TMP);
  if (!RM.test(cmd)) return;
  let segs;
  try {
    segs = segments(cmd);
  } catch (e) {
    if (!(e instanceof sh.ShlexError)) throw e;
    // heredoc 본문의 작은따옴표처럼 해석이 안 될 때: 재귀 삭제가 보일 때만 막는다.
    if (RM_RECURSIVE.test(cmd)) deny('삭제 명령을 해석하지 못했습니다');
    return;
  }

  let cur = cwd;
  let env = new Map([['HOME', sh.expanduser('~')]]);
  let loops = new Map();
  const stack = [];
  for (const [words, sep] of segs) {
    // 반복문과 조건문 안의 대입(`do T=...`)도 대입으로 읽는다. 앞머리 do, then 같은 말은 판정에 상관없다.
    let lead = 0;
    while (lead < words.length && PREFIX_OK.has(words[lead])) lead += 1;
    let head = words.slice(lead);
    if (head[0] === 'export') head = head.slice(1);
    if (head.length && head.every((w) => ASSIGN.test(w))) {
      for (const w of head) {
        const [, name, value] = ASSIGN.exec(w);
        loops.delete(name);
        env.delete(name);
        const vs = expandLoops(value, env, loops);
        if (vs === null) continue;
        if (vs.length === 1 && ![...value.matchAll(VAR_HEAD)].some((m) => loops.has(m[1]))) env.set(name, vs[0]);
        // 반복 변수로 만든 값은 반복 변수처럼 나올 수 있는 값 모두를 들고 간다.
        else loops.set(name, vs);
      }
    } else if (words.length && words[0] === 'cd') cur = changeDir(cur, words, env);
    else if (words.length >= 3 && words[0] === 'for' && words[2] === 'in') {
      const vals = words.slice(3).map((w) => expand(w, env));
      if (vals.every((v) => v !== null && !hasGlob(v))) loops.set(words[1], vals);
      else loops.delete(words[1]);
      env.delete(words[1]);
    } else if (words.includes('rm')) checkRm(words, cur, cwd, env, loops);
    for (const c of sep) {
      if (c === '(') stack.push([cur, new Map(env), new Map(loops)]);
      else if (c === ')' && stack.length) [cur, env, loops] = stack.pop();
    }
  }
}

try {
  main(fs.readFileSync(0, 'utf8'));
} catch (e) {
  if (e instanceof Decision) {
    process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: e.decision, permissionDecisionReason: e.reason } })}\n`);
  }
}
process.exit(0);
