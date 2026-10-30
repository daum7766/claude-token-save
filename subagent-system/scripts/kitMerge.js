import { createHash } from 'node:crypto';

// 순수 JS 줄 단위 3방향 병합이다. `git merge-file`은 PATH의 git, 임시 파일, 종료 코드(충돌 수, 127 상한) 해석에 기대는데
// Windows 쪽 node에서는 git이 PATH에 없을 수 있어, node 18만 있으면 같은 결과가 나오도록 직접 구현했다.

export const MARK_INSTALLED = '<<<<<<< 설치본';
export const MARK_SEPARATOR = '=======';
export const MARK_NEXT = '>>>>>>> 새 키트';

// 이보다 큰 줄 수 곱이면 LCS 표를 만들지 않고 가운데 부분을 통째로 바뀐 것으로 본다(메모리 상한).
const LCS_CELL_LIMIT = 16_000_000;

const normalizeEol = (text) => text.replace(/\r\n/g, '\n');

function splitLines(text) {
  const norm = normalizeEol(text);
  if (norm === '') return { lines: [], finalNewline: false };
  const lines = norm.split('\n');
  const finalNewline = lines[lines.length - 1] === '';
  if (finalNewline) lines.pop();
  return { lines, finalNewline };
}

const sameLines = (x, y) => x.length === y.length && x.every((l, i) => l === y[i]);

// x의 각 줄이 y의 어느 줄과 짝인지(없으면 -1). 짝은 순서를 지키는 최장 공통 부분열이다.
function matchMap(x, y) {
  const map = new Array(x.length).fill(-1);
  let head = 0;
  while (head < x.length && head < y.length && x[head] === y[head]) {
    map[head] = head;
    head++;
  }
  let tail = 0;
  while (tail < x.length - head && tail < y.length - head && x[x.length - 1 - tail] === y[y.length - 1 - tail]) {
    map[x.length - 1 - tail] = y.length - 1 - tail;
    tail++;
  }
  const n = x.length - head - tail;
  const m = y.length - head - tail;
  if (n === 0 || m === 0 || (n + 1) * (m + 1) > LCS_CELL_LIMIT) return map;

  const width = m + 1;
  const table = new Uint16Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] = x[head + i] === y[head + j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[head + i] === y[head + j]) {
      map[head + i] = head + j;
      i++;
      j++;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) i++;
    else j++;
  }
  return map;
}

// 고쳐진 두 쪽에서 앞뒤로 같은 줄은 충돌 밖으로 빼서 충돌 표시를 줄인다.
function trimmedConflict(a, b) {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  return {
    before: a.slice(0, head),
    a: a.slice(head, a.length - tail),
    b: b.slice(head, b.length - tail),
    after: a.slice(a.length - tail),
  };
}

// baseless이면 기준본이 없어 어느 쪽이 고친 것인지 모르므로, 두 쪽이 다른 덩어리는 모두 충돌로 둔다.
function resolveHunk(baseHunk, aHunk, bHunk, baseless) {
  if (sameLines(aHunk, bHunk)) return { lines: aHunk };
  if (!baseless) {
    if (sameLines(aHunk, baseHunk)) return { lines: bHunk };
    if (sameLines(bHunk, baseHunk)) return { lines: aHunk };
  }
  return { conflict: true };
}

function diff3(base, a, b, baseless) {
  const ma = matchMap(base, a);
  const mb = matchMap(base, b);
  const out = [];
  const conflicts = [];
  let bi = 0;
  let ai = 0;
  let ci = 0;
  for (let i = 0; i <= base.length; i++) {
    const end = i === base.length;
    if (!end && !(ma[i] >= 0 && mb[i] >= 0)) continue;
    const aj = end ? a.length : ma[i];
    const bj = end ? b.length : mb[i];
    const baseHunk = base.slice(bi, i);
    const aHunk = a.slice(ai, aj);
    const bHunk = b.slice(ci, bj);
    const r = resolveHunk(baseHunk, aHunk, bHunk, baseless);
    if (!r.conflict) out.push(...r.lines);
    else {
      const t = trimmedConflict(aHunk, bHunk);
      out.push(...t.before);
      conflicts.push({ line: out.length + 1, installed: t.a, base: baseless ? null : baseHunk, next: t.b });
      out.push(MARK_INSTALLED, ...t.a, MARK_SEPARATOR, ...t.b, MARK_NEXT, ...t.after);
    }
    if (!end) out.push(base[i]);
    bi = i + 1;
    ai = aj + 1;
    ci = bj + 1;
  }
  return { lines: out, conflicts };
}

function joinLines(lines, eol, finalNewline) {
  if (!lines.length) return '';
  return lines.join(eol) + (finalNewline ? eol : '');
}

const eolOf = (installed) => (installed.includes('\r\n') ? '\r\n' : '\n');

// 3방향 병합. 설치본의 고침은 남기고 키트의 고침을 넣는다. 같은 자리를 다르게 고친 곳만 충돌 표시(git 꼴)로 남긴다.
// 기준본(base)이 null이면 어느 쪽이 고쳤는지 모르므로 설치본과 새 키트가 다른 덩어리는 모두 충돌이다.
// 줄 끝은 설치본을 따르고, 끝 줄바꿈은 설치본이 기준본과 같으면 새 키트를, 다르면 설치본을 따른다.
// conflicts[].line은 결과 text에서 `<<<<<<<` 줄의 1부터 센 줄 번호이고, base는 기준본이 없으면 null이다.
export function mergeKitFile({ installed, base, next }) {
  const i = splitLines(installed);
  const n = splitLines(next);
  const baseless = base === null || base === undefined;
  const b = baseless ? { lines: [], finalNewline: n.finalNewline } : splitLines(base);
  const { lines, conflicts } = diff3(baseless ? i.lines : b.lines, i.lines, n.lines, baseless);
  const finalNewline = baseless ? i.finalNewline : i.finalNewline === b.finalNewline ? n.finalNewline : i.finalNewline;
  return { text: joinLines(lines, eolOf(installed), finalNewline), conflicts };
}

// 충돌을 풀지 않은 채 남은 표시가 있는지. 있으면 그 파일에 다시 병합하면 표시가 섞여 들어가므로 호출한 쪽이 먼저 멈춘다.
export function hasConflictMarkers(text) {
  const lines = normalizeEol(text).split('\n');
  return lines.includes(MARK_INSTALLED) && lines.includes(MARK_NEXT);
}

// 옛 kitFileHashes(subagent-retro.js --record-kit-hashes)가 적던 해시 꼴이다. 옛 설치본의 기록은 이 꼴로 남아 있어 고쳐 쓰면 안 맞는다.
const LEGACY_ZONES = [
  ['<!-- 사용자 표 시작 -->', '<!-- 사용자 표 끝 -->'],
  ['<!-- 무조건 Opus 시작 -->', '<!-- 무조건 Opus 끝 -->'],
  ['<!-- 사용자 규칙 시작 -->', '<!-- 사용자 규칙 끝 -->'],
];
const WRITING_LINE_MARK = '글은 필요한 말만 쓴다';

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

function zoneRange(lines, start, end) {
  const from = lines.findIndex((l) => l.trim() === start);
  const to = from < 0 ? -1 : lines.findIndex((l, k) => k > from && l.trim() === end);
  return to > from ? { from, to } : null;
}

function legacyTextOutsideZones(text) {
  const lines = text.split(/\r?\n/);
  const drop = new Set();
  for (const [start, end] of LEGACY_ZONES) {
    const r = zoneRange(lines, start, end);
    if (r) for (let k = r.from + 1; k < r.to; k++) drop.add(k);
  }
  return lines.filter((_, k) => !drop.has(k)).join('\n');
}

function legacyDefinitionText(text) {
  const lines = text.split(/\r?\n/);
  const close = lines[0]?.trim() === '---' ? lines.findIndex((l, k) => k > 0 && l.trim() === '---') : -1;
  return `${lines.filter((l, k) => !(close > 0 && k < close && l.startsWith('description:')) && !l.includes(WRITING_LINE_MARK)).join('\n').trimEnd()}\n`;
}

// key는 kitFileHashes의 키다. GUIDE는 구역 밖, 정의는 description과 글쓰기 줄 밖, 나머지는 통째로 해시한다.
export function legacyHashOf(key, text) {
  if (key.endsWith('/SUBAGENT_GUIDE.md')) return sha256(legacyTextOutsideZones(text));
  if (/^agents\/[^/]+\.md$/.test(key)) return sha256(legacyDefinitionText(text));
  return sha256(text);
}

// 구역 표시와 그 안의 줄을 모두 뺀다. 끝 표시가 없는 시작 표시는 구역으로 세지 않는다.
export function stripLegacyZones(guide) {
  const lines = guide.split('\n');
  const drop = new Set();
  for (const [start, end] of LEGACY_ZONES) {
    const r = zoneRange(lines.map((l) => l.replace(/\r$/, '')), start, end);
    if (r) for (let k = r.from; k <= r.to; k++) drop.add(k);
  }
  return lines.filter((_, k) => !drop.has(k)).join('\n');
}

// 설치본 한 파일을 새 키트로 바꿀 방법을 정한다.
// status: unchanged(바꿀 것 없음), replaced(사용자가 안 고쳐서 새 키트로 교체), merged(병합 완료), conflict(충돌 표시가 든 text), unresolved-markers(이전 충돌이 안 풀려 건드리지 않음)
// reason: base-equal, hash-equal, base-merge, no-base-modified(기준본 없고 기록과 다름), no-base-no-hash(기준본도 기록도 없음)
// key는 kitFileHashes의 키(예: subagent-system/docs/RETRO.md, agents/opus-high.md)이고 recordedHashes는 config의 kitFileHashes(없으면 null)다.
export function planKitFileUpdate({ key, installed, base, next, recordedHashes }) {
  if (hasConflictMarkers(installed)) return { status: 'unresolved-markers', text: installed, conflicts: [], reason: 'markers' };
  const eol = eolOf(installed);
  const sameAsNext = normalizeEol(installed) === normalizeEol(next);
  if (sameAsNext) return { status: 'unchanged', text: installed, conflicts: [], reason: 'same-as-next' };

  const replaced = (reason) => ({ status: 'replaced', text: eol === '\r\n' ? normalizeEol(next).replace(/\n/g, '\r\n') : normalizeEol(next), conflicts: [], reason });
  const hasBase = base !== null && base !== undefined;
  if (hasBase && normalizeEol(installed) === normalizeEol(base)) return replaced('base-equal');

  const isGuide = key.endsWith('/SUBAGENT_GUIDE.md');
  const target = isGuide ? stripLegacyZones(installed) : installed;
  if (hasBase) {
    const r = mergeKitFile({ installed: target, base: isGuide ? stripLegacyZones(base) : base, next });
    if (r.conflicts.length) return { status: 'conflict', text: r.text, conflicts: r.conflicts, reason: 'base-merge' };
    return { status: r.text === installed ? 'unchanged' : 'merged', text: r.text, conflicts: [], reason: 'base-merge' };
  }

  const recorded = recordedHashes?.[key];
  if (typeof recorded === 'string' && recorded === legacyHashOf(key, installed)) return replaced('hash-equal');
  const r = mergeKitFile({ installed: target, base: null, next });
  return { status: 'conflict', text: r.text, conflicts: r.conflicts, reason: typeof recorded === 'string' ? 'no-base-modified' : 'no-base-no-hash' };
}

const isHtmlComment = (l) => /^\s*<!--.*-->\s*$/.test(l);
const KIT_EXAMPLE_MARK = '키트 원본의 예시';

function zoneBody(lines, [start, end]) {
  const r = zoneRange(lines, start, end);
  if (!r) return null;
  const body = lines.slice(r.from + 1, r.to);
  return { isKitExample: body.some((l) => isHtmlComment(l) && l.includes(KIT_EXAMPLE_MARK)), lines: body.filter((l) => !isHtmlComment(l)) };
}

// 불릿 하나는 `- `로 시작하는 줄과 그 뒤에 이어지는 들여쓴 줄이다.
function bulletsOf(lines) {
  const out = [];
  for (const l of lines) {
    if (/^\s*[-*] /.test(l)) out.push(l.trim().replace(/^[-*] /, ''));
    else if (l.trim() && out.length) out[out.length - 1] += ` ${l.trim()}`;
  }
  return out;
}

export const ROUTING_TABLE_TITLE = '# 라우팅 표';
export const ROUTING_UNCONDITIONAL_HEADING = '## 무조건 Opus';

// 옛 GUIDE의 사용자 구역 셋을 새 구조로 옮길 값으로 뽑는다. 구역이 없으면 hasZones가 false이고 나머지는 비어 있다.
// 키트 원본의 예시 표시 줄이 든 구역은 사용자가 고르지 않은 예시이므로 isKitExample이 true다(옮기지 않고 새 키트 기본을 쓰는 쪽을 호출한 쪽이 고른다).
export function migrateLegacyZones(guide) {
  const lines = guide.split('\n').map((l) => l.replace(/\r$/, ''));
  const table = zoneBody(lines, LEGACY_ZONES[0]);
  const opus = zoneBody(lines, LEGACY_ZONES[1]);
  const rules = zoneBody(lines, LEGACY_ZONES[2]);
  const tableText = table ? table.lines.filter((l) => l.trim().startsWith('|')).join('\n') : '';
  const opusItems = opus ? bulletsOf(opus.lines) : [];
  const userRules = rules ? bulletsOf(rules.lines) : [];
  const parts = [ROUTING_TABLE_TITLE, '', tableText];
  if (opusItems.length) parts.push('', ROUTING_UNCONDITIONAL_HEADING, '', ...opusItems.map((x) => `- ${x}`));
  return {
    hasZones: Boolean(table || opus || rules),
    table: { found: Boolean(table), isKitExample: table?.isKitExample ?? false, text: tableText },
    unconditionalOpus: { found: Boolean(opus), isKitExample: opus?.isKitExample ?? false, items: opusItems },
    userRules,
    routingTableText: tableText || opusItems.length ? `${parts.join('\n')}\n` : '',
  };
}
