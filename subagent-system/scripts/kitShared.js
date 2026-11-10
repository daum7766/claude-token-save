// 라우팅(회고)과 피드백(고침 기록)과 설치 바닥이 함께 쓰는 순수 함수. 어느 한쪽 스크립트가 없어도 이 파일만으로 돈다.
// 태그 읽기(사용 기록 메모의 모자람, 개선 표시), 비슷한 태그 찾기, 고침 기록 읽기, agentId 읽기가 든다.
// 정의 description과 라우팅 표를 읽는 함수도 든다. 설치 바닥(kitDrift.js)이 라우팅 스크립트 없이 설치 값 자리를 다루려는 것이다.

import os from 'node:os';
import path from 'node:path';
import { splitLines } from './claudeProjectPaths.js';

export const isAbsolutePath = (p) => p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\');

// 사용 기록 메모의 표시 `모자람(<태그>[,<태그>…]): <요지>`, `개선(<태그>): <요지>`를 읽는다. 닫는 괄호 바로 뒤에 `: `가 올 때만 표시다.
// 옛 꼴 `모자람: <요지>`는 태그가 없어 판정에는 들지 않는다.
export const normTag = (t) => String(t).replace(/\s+/g, '');
export function memoMarks(memo) {
  const marks = [];
  const tagged = /(?:^|\s)(모자람|개선)\(([^()]*)\):(?: |$)/g;
  let m;
  while ((m = tagged.exec(memo ?? '')) !== null) {
    const tags = m[2].split(',').map((t) => t.trim()).filter(Boolean);
    if (tags.length) marks.push({ kind: m[1], tags });
  }
  if (/(?:^|\s)모자람:/.test(memo ?? '')) marks.push({ kind: '모자람', tags: [] });
  return marks;
}

export const FIX_SIGNALS = ['정정', '모자람', '개선', '재발'];
export const FIX_HOWS = ['문장', '체크리스트', '스크립트', '훅', '되돌림', '물음', '유지', '무관'];

export function parseFixes(text) {
  return splitLines(text ?? '').flatMap((raw) => {
    const c = raw.split('\t');
    if (c[0] === '시각' || c.length < 9) return [];
    const anchor = /^\d+$/.test(c[7]) ? Number(c[7]) : null;
    const ok = !Number.isNaN(Date.parse(c[0])) && ['전역', '프로젝트'].includes(c[2]) && FIX_SIGNALS.includes(c[3]) && c[4] && FIX_HOWS.includes(c[6]) && anchor !== null;
    return ok ? [{ at: c[0], project: c[1], scope: c[2], signal: c[3], label: c[4], where: c[5], how: c[6], anchor, memo: c[8], root: c[9] ?? '' }] : [];
  });
}


// 고침 줄의 뿌리나 고친 곳 글 맨 앞의 파일 경로(확장자가 있는 것). 파일이 아닌 값(「선택지 1#자리」)은 null이다.
const FIX_FILE = /^(\S+?\.[A-Za-z0-9]+)(?:#|\s|$)/;
export const fixFileOf = (raw) => {
  const m = FIX_FILE.exec(raw ?? '');
  return m ? m[1].replace(/\\/g, '/') : null;
};
// 그 경로가 놓였을 만한 실제 경로들. `~/.claude/`는 설치 폴더(kitDir가 있으면 키트 원본의 같은 자리도), `~/`는 홈, 절대 경로는 그대로, 상대 경로는 프로젝트 루트와 설치 폴더(와 키트 원본)에서 찾는다.
// 까닭: 범위를 잘못 적은 프로젝트 줄이 설치 폴더 파일을 가리키는 일이 있고, 키트 원본 기준 경로를 설치 쪽에서 적은 줄도 있어서다.
export function fixFileCandidates(file, project, { claudeDir, home = os.homedir(), projectOf = (p) => p, kitDir = '' } = {}) {
  const extra = (rest) => (kitDir ? [path.join(kitDir, rest)] : []);
  if (file.startsWith('~/.claude/')) return [path.join(claudeDir, file.slice('~/.claude/'.length)), ...extra(file.slice('~/.claude/'.length))];
  if (file.startsWith('~/')) return [path.join(home, file.slice(2))];
  if (isAbsolutePath(file)) return [file];
  return [...new Set([projectOf(project), project, claudeDir, ...(kitDir ? [kitDir] : [])])].map((r) => path.join(r, file));
}

function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

// 공백을 뺀 문자열이 서로를 포함하거나 편집 거리가 2 이하이면 비슷한 태그다. 공백을 뺀 값이 같으면 같은 태그라 뺀다.
export function similarTags(tag, known) {
  const t = normTag(tag);
  const seen = new Set();
  return known.filter((k) => {
    const n = normTag(k);
    if (n === t || seen.has(n)) return false;
    seen.add(n);
    return n.includes(t) || t.includes(n) || editDistance(n, t) <= 2;
  });
}

// 고침 기록 이름표, 사용 기록 태그, 정정 이름표를 공백을 뺀 기준으로 묶는다.
export function tagUniverse({ fixes = [], usage = [], corrections = [] }) {
  const map = new Map();
  const add = (name, date) => {
    const key = normTag(name);
    if (!key || key === '-') return;
    const e = map.get(key) ?? { key, names: new Map(), count: 0, last: '' };
    e.names.set(name, (e.names.get(name) ?? 0) + 1);
    e.count++;
    if (date > e.last) e.last = date;
    map.set(key, e);
  };
  for (const f of fixes) add(f.label, f.at.slice(0, 10));
  for (const r of usage) for (const m of memoMarks(r.memo)) for (const t of m.tags) add(t, r.date ?? '');
  for (const c of corrections) add(c.label, c.date ?? '');
  for (const e of map.values()) e.name = [...e.names].sort((a, b) => b[1] - a[1])[0][0];
  return map;
}

// 메모 첫 낱말에 `add4fa4(이어서)`처럼 괄호 꼬리가 붙을 수 있어 꼬리만 떼고 agentId로 쓴다. `afinal-qr-1d66`처럼 이름이 붙은 agentId는 그대로 둔다.
// 영문, 숫자, 밑줄, 붙임표로만 된 낱말만 agentId로 받는다. 메모 첫 낱말이 「56회차」 같은 글이면 null을 내어 읽는 쪽이 줄마다 따로 센다(같은 글을 한 에이전트로 묶어 회차 수가 줄던 것을 막음).
export const agentIdOf = (word) => {
  if (!word) return word ?? null;
  const id = word.replace(/\(.*$/, '');
  return /^[A-Za-z0-9_-]+$/.test(id) ? id : null;
};

// 올려 보낸 일만 받는 정의라 내려 볼 칸이 아니다. fable-high는 정의 파일 없이 Agent 호출의 model과 effort로만 보내므로 표 칸도 정의 파일도 없다.
export const ESCALATION_ONLY_DEFS = new Set(['opus-xhigh', 'fable-high']);
// Claude가 문서의 인용 부호(「」)를 빼고 (고정)만 붙여도 고정 칸으로 읽히게 낫표는 있어도 없어도 받는다.
const PIN_MARK = /「\(고정\)」|\(고정\)/g;
// 최저선 표시. 내림 실패가 쌓인 칸을 이 정의 아래로는 내려 보지 않는다. 고정 표시처럼 낫표와 정의 이름의 백틱은 있어도 없어도 받는다.
const FLOOR_MARK = /「\(최저:\s*`?([a-z]+-[a-z]+)`?\s*\)」|\(최저:\s*`?([a-z]+-[a-z]+)`?\s*\)/g;

const EFFORTS = ['low', 'medium', 'high', 'xhigh'];

// 괄호 안 쉼표로 이름이 쪼개지지 않게 괄호 깊이가 0일 때만 나눈다.
export function splitOutsideParens(text) {
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

// 사용 기록의 일 종류는 괄호 부연을 뺀 이름이라, 표 칸의 이름도 괄호를 모두 걷어 같은 꼴로 만든다.
// 「」는 이름의 일부일 수 있어(「무조건 Opus」) 내려 보기 시험과 고정 표시의 낫표만 지운다.
// 「(고정)」이 붙은 이름은 pinned에도 담는다. 원칙 때문에 high에 둔 칸이라 내려 보기 후보에서 빠진다.
// 시험 표시는 그 이름 바로 뒤에 붙으므로 어느 일의 시험인지 trials에 이름과 정의를 짝지어 담는다.
// 시험 표시도 낫표를 빼고 적을 수 있다. 정의 이름이 백틱으로 든 (시험: …)만 시험 표시로 받아, 일반 괄호 부연과 섞이지 않는다.
const TRIAL_MARK = /「\(시험:[^)]*\)」|\(시험:[^)]*`[^`)]+`[^)]*\)/g;
const plainKindName = (text) => text.replace(/\([^()]*(\([^()]*\)[^()]*)*\)/g, '').replace(/\s+/g, ' ').trim();
// 사람이 말한 일 이름을 표 칸의 이름과 기록의 일 종류가 쓰는 꼴(표시와 괄호 부연이 없는 이름)로 만든다.
export const kindNameOf = (text) => plainKindName(String(text).replace(TRIAL_MARK, '').replace(FLOOR_MARK, '').replace(PIN_MARK, ''));
export function cellKinds(cell) {
  const items = splitOutsideParens(cell);
  const kinds = [];
  const pinned = [];
  const trials = [];
  const floors = [];
  for (const item of items) {
    const marks = item.match(TRIAL_MARK) ?? [];
    const floorDefs = [...item.matchAll(FLOOR_MARK)].map((m) => m[1] ?? m[2]);
    const bare = item.replace(TRIAL_MARK, '').replace(FLOOR_MARK, '');
    const unpinned = bare.replace(PIN_MARK, '');
    const name = plainKindName(unpinned);
    if (!name) continue;
    kinds.push(name);
    if (unpinned !== bare) pinned.push(name);
    for (const m of marks) {
      const def = m.match(/`([^`]+)`/)?.[1];
      if (def) trials.push({ kind: name, def });
    }
    if (floorDefs.length) floors.push({ kind: name, def: floorDefs.at(-1) });
  }
  return { kinds, pinned, trials, floors };
}

const tableCells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

// GUIDE의 모델 x effort 표를 읽는다. 못 읽으면 problems에 까닭을 담아 돌려주고 호출한 쪽이 그대로 보인다.
export function parseRoutingTable(text) {
  const lines = splitLines(text);
  const headIdx = lines.findIndex((l) => {
    const c = tableCells(l);
    return l.trim().startsWith('|') && EFFORTS.every((e) => c.includes(e));
  });
  if (headIdx < 0) return { cells: [], problems: ['effort 머리줄(low, medium, high, xhigh)이 있는 표를 찾지 못했습니다'] };

  const head = tableCells(lines[headIdx]);
  const efforts = head.slice(1);
  const problems = [];
  if (efforts.join() !== EFFORTS.join()) problems.push(`effort 열 순서가 ${EFFORTS.join(', ')}가 아닙니다: ${efforts.join(', ')}`);
  const cells = [];
  for (let i = headIdx + 2; i < lines.length && lines[i].trim().startsWith('|'); i++) {
    const c = tableCells(lines[i]);
    const model = c[0].replace(/\*/g, '').trim().toLowerCase();
    if (c.length !== head.length) {
      problems.push(`${i + 1}번째 줄(${model || '모델 이름 없음'})의 칸 수가 ${c.length}개로 머리줄의 ${head.length}개와 다릅니다`);
      continue;
    }
    efforts.forEach((effort, k) => cells.push({ model, effort, ...cellKinds(c[k + 1]) }));
  }
  if (!cells.length) problems.push('모델 줄이 없습니다');
  else if (!cells.some((x) => x.kinds.length)) problems.push('일 이름이 하나도 없습니다');
  return { cells, problems };
}

// 정의 파일의 frontmatter description. 없으면 빈 문자열.
export function descriptionOf(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return '';
  const lines = m[1].split(/\r?\n/);
  const i = lines.findIndex((l) => l.startsWith('description:'));
  if (i < 0) return '';
  let value = lines[i].slice('description:'.length).trim();
  if (value === '' || /^[>|][+-]?$/.test(value)) {
    const folded = [];
    for (let k = i + 1; k < lines.length && /^\s/.test(lines[k]); k++) folded.push(lines[k].trim());
    value = folded.join(' ');
  }
  return value.replace(/^(["'])(.*)\1$/, '$2').trim();
}
