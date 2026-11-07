// 키트 원본과 설치본이 벌어지지 않게 하는 순수 함수. 파일 입출력과 git은 kit-setup.js가 한다.
// 설치 값 자리: 키트 파일 안에서 설치마다 값이 다른 곳이다. 체크리스트의 「이 설치에서 더한 줄」 절과 정의의 description 줄이 그렇다.
// 까닭: 이 자리를 비교와 덮어쓰기에서 따로 다뤄야 키트 고침만 받고 설치 값은 지킨다.

import { descriptionOf, kindNameOf, parseRoutingTable, splitOutsideParens, ESCALATION_ONLY_DEFS } from './kitShared.js';

export const CHECKLIST_KEY = 'subagent-system/docs/SUBAGENT_BRIEF_CHECKLIST.md';
export const CHECKLIST_ZONE_HEADING = '## 이 설치에서 더한 줄';
export const DEF_KEY_RE = /^agents\/[^/]+\.md$/;
export const SKIP_ENV = 'KIT_DRIFT_SKIP';
export const DEFAULT_GUIDE_PATH = '~/.claude/subagent-system/docs/SUBAGENT_GUIDE.md';

const nl = (t) => t.replace(/\r\n/g, '\n');

// 체크리스트에서 설치 값 절(제목 줄부터 다음 `## ` 절 앞까지)을 떼어 낸다. kit은 절을 뺀 글, zone은 절 글(없으면 빈 문자열)이다.
export function splitChecklistZone(text) {
  const lines = nl(text).split('\n');
  const from = lines.findIndex((l) => l.trim() === CHECKLIST_ZONE_HEADING);
  if (from < 0) return { kit: nl(text), zone: '' };
  let to = lines.findIndex((l, i) => i > from && /^## /.test(l));
  if (to < 0) to = lines.length;
  const head = lines.slice(0, from).join('\n').replace(/\s+$/, '');
  const tail = lines.slice(to).join('\n');
  const zone = lines.slice(from, to).join('\n').replace(/\s+$/, '');
  return { kit: `${head}\n${tail ? `\n${tail.replace(/\s+$/, '')}\n` : ''}`, zone };
}

export function withChecklistZone(kitText, zone) {
  if (!zone) return kitText;
  return `${nl(kitText).replace(/\s+$/, '')}\n\n${zone}\n`;
}

// frontmatter의 description 줄(`description:`로 시작하고 접은 글이면 뒤따르는 들여쓴 줄까지)의 줄 번호 범위다. 없으면 null.
function descriptionRange(lines) {
  if (lines[0]?.trim() !== '---') return null;
  const close = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (close < 0) return null;
  const from = lines.findIndex((l, i) => i < close && l.startsWith('description:'));
  if (from < 0) return null;
  let to = from + 1;
  while (to < close && /^\s/.test(lines[to])) to += 1;
  return { from, to };
}

export function descriptionBlock(text) {
  const lines = nl(text).split('\n');
  const r = descriptionRange(lines);
  return r ? lines.slice(r.from, r.to).join('\n') : null;
}

export function withDescriptionBlock(text, block) {
  if (block === null || block === undefined) return text;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = nl(text).split('\n');
  const r = descriptionRange(lines);
  if (!r) return text;
  lines.splice(r.from, r.to - r.from, ...block.split('\n'));
  return lines.join(eol);
}

// 정의 description에서 설치 값은 첫 문장 뒤 일 이름 나열(과 설치 폴더에 따라 바뀌는 가이드 경로)이다. 첫 문장과 승급 전용 정의의 description 전체는 키트 몫이라
// 견주고 맞출 때 가리지 않는다(설치본 검수 4회차 6번: 줄 전체를 가려 키트가 고친 첫 문장이 diff, sync, 커밋 검사에서 모두 빠졌다).
function descParts(key, text) {
  if (ESCALATION_ONLY_DEFS.has(key.replace(/^agents\//, '').replace(/\.md$/, ''))) return null;
  const d = descriptionOf(nl(text));
  if (!d) return null;
  const { first, list } = firstSentenceOf(d);
  return { first, list, tail: guidePathOf(d) };
}

// 설치 값 자리를 비운 글이다. 키트 쪽과 설치본 쪽을 견줄 때 이 글끼리 견준다.
export function maskZones(key, text) {
  if (key === CHECKLIST_KEY) return splitChecklistZone(text).kit;
  if (DEF_KEY_RE.test(key)) {
    const p = descParts(key, text);
    // 가이드 경로는 설치 폴더에 따라 글이 바뀌어(CLAUDE_CONFIG_DIR) 견주지 않는다.
    return p ? withDescriptionBlock(nl(text), `description: ${p.first}. <설치 값>`) : nl(text);
  }
  return nl(text);
}

export function zoneOf(key, text) {
  if (key === CHECKLIST_KEY) return splitChecklistZone(text).zone;
  if (DEF_KEY_RE.test(key)) return descParts(key, text)?.list ?? '';
  return '';
}

// 키트 글에 설치본의 설치 값 자리를 얹는다. 설치본에 그 자리가 없으면 키트 글 그대로다.
export function overlayZones(key, kitText, installedText) {
  if (installedText === null || installedText === undefined) return kitText;
  if (key === CHECKLIST_KEY) return withChecklistZone(kitText, splitChecklistZone(installedText).zone);
  if (DEF_KEY_RE.test(key)) {
    // 키트의 첫 문장과 가이드 경로에 설치본의 일 이름 나열을 얹는다.
    const k = descParts(key, kitText);
    const i = descParts(key, installedText);
    if (!k || !i || !i.list) return kitText;
    return withDescriptionBlock(kitText, `description: ${yamlScalar(`${k.first}. ${i.list}. (\`${k.tail ?? i.tail ?? DEFAULT_GUIDE_PATH}\`)`)}`);
  }
  return kitText;
}

export const STATUS = {
  same: 'same',
  kitAhead: 'kit-ahead',
  installedZone: 'installed-zone',
  installedOnly: 'installed-only',
  both: 'both',
  kitOnly: 'kit-only',
  installedExtra: 'installed-extra',
};

// 설치본과 원본과 기준본을 대 한 파일의 상태를 가른다. 모두 설치 값 자리를 비운 글로 견준다.
// installedZone은 키트가 놓은 부분은 같고 설치 값 자리만 다른 것이다. base가 null이면 어느 쪽이 고쳤는지 알 수 없어 설치본이 고친 것으로 본다(noBase).
export function classifyFile({ key, installed, base, kit }) {
  if (installed === null) return { status: STATUS.kitOnly };
  const I = maskZones(key, installed);
  const K = maskZones(key, kit);
  if (I === K) return { status: zoneOf(key, installed) === zoneOf(key, kit) ? STATUS.same : STATUS.installedZone };
  const lines = new Set(K.split('\n'));
  const changed = I.split('\n').filter((l) => l.trim() && !lines.has(l));
  if (base === null || base === undefined) return { status: STATUS.installedOnly, noBase: true, changed };
  const B = maskZones(key, base);
  if (I === B) return { status: STATUS.kitAhead };
  if (K === B) return { status: STATUS.installedOnly, changed };
  return { status: STATUS.both, changed };
}

export const markersIn = (lines, markers) => (Array.isArray(markers) ? markers.filter((m) => typeof m === 'string' && m && lines.some((l) => l.includes(m))) : []);

// ---- 정의 description ----

// 괄호 밖 「. 」까지가 첫 문장이다(끝 점은 뺌). 가이드 경로 `(\`…\`)`는 뺀다. 첫 문장 끝이 없으면 전체가 첫 문장이다.
export function firstSentenceOf(description) {
  const body = description.replace(/\s*\(`[^`]*`\)\s*$/, '').replace(/\.\s*$/, '');
  let depth = 0;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === '(' || ch === '（') depth += 1;
    else if ((ch === ')' || ch === '）') && depth > 0) depth -= 1;
    else if (ch === '.' && depth === 0 && /\s/.test(body[i + 1] ?? '')) return { first: body.slice(0, i), list: body.slice(i + 1).trim() };
  }
  return { first: body, list: '' };
}

const guidePathOf = (description) => description.match(/\(`([^`]*)`\)\s*$/)?.[1] ?? null;

// YAML이 깨지는 글(`: `, ` #`, 맨 앞의 특수 문자, 끝 `:`)이면 큰따옴표로 감싼다.
export function yamlScalar(value) {
  if (/: | #|:$|^[\s[\]{}>|*&!%@`'"?,#-]/.test(value) || /^\s|\s$/.test(value)) return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  return value;
}

// 표 칸의 일 이름으로 정의 description 줄을 만든다. 첫 문장은 firstSource(키트 정의의 description)의 것이고, 나열은 표에서 만든다.
// 지금 description에 이미 있는 일 이름은 괄호 부연까지 그대로 두고 새 이름만 이름 그대로 넣는다. 바뀐 것이 없으면 null을 돌려준다(줄을 건드리지 않음).
export function buildDescriptionLine({ firstSource, current, kinds }) {
  const cur = firstSentenceOf(current);
  const src = firstSentenceOf(firstSource || current);
  const keep = new Map();
  for (const item of splitOutsideParens(cur.list.replace(/\.\s*$/, ''))) {
    const name = kindNameOf(item);
    if (name) keep.set(name, item.trim());
  }
  const items = kinds.map((k) => keep.get(k) ?? k);
  const tail = guidePathOf(firstSource || '') ?? guidePathOf(current) ?? DEFAULT_GUIDE_PATH;
  const value = `${src.first}. ${items.join(', ')}. (\`${tail}\`)`;
  if (value === current) return null;
  return `description: ${yamlScalar(value)}`;
}

// 라우팅 표 글에서 정의 이름마다 일 이름 목록을 뽑는다.
export function tableKindsByDef(tableText) {
  const { cells, problems } = parseRoutingTable(tableText);
  const out = new Map();
  for (const c of cells) if (c.kinds.length) out.set(`${c.model}-${c.effort}`, c.kinds);
  return { byDef: out, problems };
}

// 정의 한 개의 새 description 줄. 표에 일이 없는 정의와 승급 전용 정의는 건드리지 않는다(null).
export function descriptionLineFor({ def, byDef, current, firstSource }) {
  if (ESCALATION_ONLY_DEFS.has(def)) return null;
  const kinds = byDef.get(def);
  if (!kinds || !current) return null;
  return buildDescriptionLine({ firstSource, current, kinds });
}

export const currentDescription = (text) => descriptionOf(text);

// ---- 커밋 때 검사의 막음 글 ----

export function blockMessage(files) {
  return [
    `키트가 놓은 고정 파일을 원본과 다르게 고쳐 커밋하려 합니다(${files.length}개).`,
    ...files.map((f) => `  ${f}`),
    '누구에게나 통하는 고침이면 원본(kitSourcePath)에 같은 고침을 커밋한 뒤 kit-setup.js sync로 내리고, 이 설치에만 맞는 것이면 설치 값 자리(체크리스트의 「이 설치에서 더한 줄」, 정의의 description, 라우팅 표, config)로 옮기세요.',
    `그래도 이번 한 번은 이대로 커밋하려면 ${SKIP_ENV}=1을 붙여 다시 커밋합니다.`,
  ].join('\n');
}
