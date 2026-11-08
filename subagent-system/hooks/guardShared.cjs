'use strict';

/**
 * 안전장치 훅(rm-guard, git-discard-guard)이 함께 쓰는 셸 낱말 나누기와 경로 풀기.
 * 왜: 막는 판정이 낱말 나누기와 경로 풀기에 그대로 기대므로, 처음 쓰인 파이썬 판(shlex, os.path, re)과 글자 하나까지 같은 결과를 내야 같은 명령을 같게 막는다.
 *   그래서 파이썬의 버릇도 옮겼다: 낱말 가운데의 #도 주석으로 보고, 따옴표에 싸인 ;도 나누는 기호로 보고, 정규식의 $는 끝의 줄바꿈 하나 앞에서도 맞는다.
 * 전제: 경로 풀기는 파이썬 3.14의 os.path.realpath(없는 경로는 있는 데까지만 풀기)를 따른다. 경로에 NUL 글자가 있으면 파이썬처럼 던진다(훅은 통과로 끝난다).
 */

const fs = require('node:fs');
const os = require('node:os');

// 파이썬 re의 \w, \d, \s(유니코드)와 같은 글자 모음. JS의 \w와 \b는 영문만 봐서 한글에 붙은 낱말의 경계가 달라진다.
const W = '[\\p{L}\\p{N}_]';
const D = '\\p{Nd}';
const SPACE_CHARS = '\\t\\n\\v\\f\\r \\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const S = `[${SPACE_CHARS}]`;
const NS = `[^${SPACE_CHARS}]`;
const END = '(?=\\n?$)';
const word = (re) => `(?<!${W})(?:${re})(?!${W})`;
const escapeRe = (s) => s.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');

class ShlexError extends Error {}

// 파이썬 shlex.shlex(posix=True, whitespace_split=True)의 낱말들. punctuation은 punctuation_chars다.
function shlexTokens(text, { punctuation = '', whitespace = ' \t\r\n', commenters = '#' } = {}) {
  const chars = Array.from(text);
  let pos = 0;
  const pushback = [];
  let state = ' ';
  const has = (set, c) => c !== '' && set.includes(c);
  const readline = () => {
    while (pos < chars.length) if (chars[pos++] === '\n') break;
  };
  const readToken = () => {
    let quoted = false;
    let escapedState = ' ';
    let token = '';
    for (;;) {
      const c = pushback.length ? pushback.pop() : pos < chars.length ? chars[pos++] : '';
      if (state === null) {
        token = '';
        break;
      }
      if (state === ' ') {
        if (!c) {
          state = null;
          break;
        }
        if (has(whitespace, c)) {
          if (token || quoted) break;
        } else if (has(commenters, c)) readline();
        else if (c === '\\') {
          escapedState = 'a';
          state = c;
        } else if (has(punctuation, c)) {
          token = c;
          state = 'c';
        } else if (has('\'"', c)) state = c;
        else {
          token = c;
          state = 'a';
        }
      } else if (state === '\'' || state === '"') {
        quoted = true;
        if (!c) throw new ShlexError('No closing quotation');
        if (c === state) state = 'a';
        else if (c === '\\' && state === '"') {
          escapedState = state;
          state = c;
        } else token += c;
      } else if (state === '\\') {
        if (!c) throw new ShlexError('No escaped character');
        if ((escapedState === '\'' || escapedState === '"') && c !== state && c !== escapedState) token += state;
        token += c;
        state = escapedState;
      } else {
        if (!c) {
          state = null;
          break;
        }
        if (has(whitespace, c)) {
          state = ' ';
          if (token || quoted) break;
        } else if (has(commenters, c)) {
          readline();
          state = ' ';
          if (token || quoted) break;
        } else if (state === 'c') {
          if (has(punctuation, c)) token += c;
          else {
            if (!has(whitespace, c)) pushback.push(c);
            state = ' ';
            break;
          }
        } else if (has('\'"', c)) state = c;
        else if (c === '\\') {
          escapedState = 'a';
          state = c;
        } else if (!has(punctuation, c)) token += c;
        else {
          pushback.push(c);
          state = ' ';
          if (token || quoted) break;
        }
      }
    }
    return !quoted && token === '' ? null : token;
  };
  const out = [];
  for (let t = readToken(); t !== null; t = readToken()) out.push(t);
  return out;
}

// 파이썬 shlex.split(s)
const shlexSplit = (s) => shlexTokens(s, { commenters: '' });

const isAbs = (p) => p.startsWith('/');

function join(a, ...rest) {
  let out = a;
  for (const b of rest) {
    if (isAbs(b)) out = b;
    else if (!out || out.endsWith('/')) out += b;
    else out += `/${b}`;
  }
  return out;
}

function dirname(p) {
  const head = p.slice(0, p.lastIndexOf('/') + 1);
  return head && head !== '/'.repeat(head.length) ? head.replace(/\/+$/, '') : head;
}

const basename = (p) => p.slice(p.lastIndexOf('/') + 1);

function expanduser(p) {
  if (!p.startsWith('~')) return p;
  let i = p.indexOf('/', 1);
  if (i < 0) i = p.length;
  let home;
  if (i === 1) home = process.env.HOME ?? os.userInfo().homedir;
  else {
    const me = os.userInfo();
    if (p.slice(1, i) !== me.username) return p;
    home = me.homedir;
  }
  return `${home.replace(/\/+$/, '')}${p.slice(i)}` || '/';
}

// NUL이 든 경로: 파이썬 os.lstat은 OSError가 아닌 ValueError를 던져 realpath 밖으로 나간다.
const nulError = (e) => e && e.code === 'ERR_INVALID_ARG_VALUE';

function realpath(filename) {
  const rest = filename.split('/').reverse();
  let partCount = rest.length;
  let p = isAbs(filename) ? '/' : process.cwd();
  const seen = new Map();
  while (partCount) {
    const name = rest.pop();
    if (name === null) {
      seen.set(rest.pop(), p);
      continue;
    }
    partCount -= 1;
    if (!name || name === '.') continue;
    if (name === '..') {
      p = p.slice(0, p.lastIndexOf('/')) || '/';
      continue;
    }
    const next = p === '/' ? p + name : `${p}/${name}`;
    let target;
    try {
      if (!fs.lstatSync(next).isSymbolicLink()) {
        p = next;
        continue;
      }
      if (seen.has(next)) {
        p = seen.get(next) ?? next;
        continue;
      }
      target = fs.readlinkSync(next);
    } catch (e) {
      if (nulError(e)) throw e;
      p = next;
      continue;
    }
    if (isAbs(target)) p = '/';
    seen.set(next, null);
    rest.push(next, null);
    const parts = target.split('/').reverse();
    rest.push(...parts);
    partCount += parts.length;
  }
  return p;
}

const statOk = (fn) => (p) => {
  try {
    return fn(p);
  } catch {
    return false;
  }
};
const isDir = statOk((p) => fs.statSync(p).isDirectory());
const isFile = statOk((p) => fs.statSync(p).isFile());
const isLink = statOk((p) => fs.lstatSync(p).isSymbolicLink());
const exists = statOk((p) => Boolean(fs.statSync(p)));

module.exports = { W, D, S, NS, END, word, escapeRe, ShlexError, shlexTokens, shlexSplit, isAbs, join, dirname, basename, expanduser, realpath, isDir, isFile, isLink, exists };
