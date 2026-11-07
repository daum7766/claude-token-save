// 묶음 정의를 읽고, 깔 파일 목록을 만드는 순수한 읽기 모듈이다. 설치 바닥(kit-setup.js)이 부른다.
// 정의 자리: 키트 원본의 bundles/<묶음>/bundle.json과 <조각>.part.json, 설치본의 subagent-system/local-bundles/<묶음>/ 아래 같은 꼴(로컬 조각, 설치본이 정본).
// 조각은 묶음 안에서 파일이 어디를 정본으로 삼는지 가르는 가장 작은 단위이고, 파일은 조각 하나에만 든다(겹침, 배정 없음은 error).
// 이 모듈은 아무것도 쓰지 않는다. 깐 상태 기록은 kitInstalled.cjs, 훅 등록은 kitHooks.js가 맡는다.

import fs from 'node:fs';
import path from 'node:path';

// 정의에 이름만 올려 두고 아직 만들지 않은 파일(설치 키). 아직 없으면 warn, 이 목록 밖의 정의 파일이 없으면 error다.
// 새 파일을 정의에 올리면서 아직 만들지 않았을 때 이 목록에 더하고, 만든 단위가 끝나면 목록에서 뺀다. 마지막 단위(U5)가 비웠다.
export const NEW_FILES = [];

// 원본에서 「설치 대상」으로 훑는 자리. 여기 든 파일은 모두 조각 하나에 배정돼야 한다.
const SCAN_DIRS = ['subagent-system/docs', 'subagent-system/scripts', 'subagent-system/hooks', 'subagent-system/agents', 'subagent-system/rules', 'subagent-system/skills', 'extras'];
const SCAN_FILES = ['subagent-system/rates.json', 'subagent-system/VERSION'];
// 설치 키와 원본 경로가 다른 세 갈래. 그 밖의 키는 원본에서도 같은 경로다.
const KEY_ROOTS = ['agents', 'rules', 'skills'];
const KINDS = ['merge', 'code', 'once', 'rates'];
const NAME_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const PART_FILE_RE = /^([^/]+)\/(bundle\.json|([^/]+)\.part\.json)$/;
const LOCAL_DIR = 'subagent-system/local-bundles';

export function srcOf(key) {
  for (const d of KEY_ROOTS) if (key === d || key.startsWith(`${d}/`)) return `subagent-system/${key}`;
  return key;
}

const keyOfSrc = (src) => {
  for (const d of KEY_ROOTS) if (src.startsWith(`subagent-system/${d}/`)) return src.slice('subagent-system/'.length);
  return src;
};

// *.bak-*, *.bak은 백업이라 어느 조각에도 넣지 않는다(점 파일과 node_modules는 목록 읽기에서 이미 빠진다).
const isBackup = (name) => /\.bak-/.test(name) || /\.bak$/.test(name);

function fsSource(root) {
  const abs = (rel) => path.join(root, ...rel.split('/').filter(Boolean));
  const walk = (dir, rel, out) => {
    let ents;
    try {
      ents = fs.readdirSync(path.join(dir, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(dir, r, out);
      else if (e.isFile()) out.push(r);
    }
  };
  return {
    root,
    // dir 아래 파일을 dir 기준 상대 경로로, 정렬해서
    list: (dir) => {
      const out = [];
      walk(abs(dir), '', out);
      return out.sort();
    },
    exists: (rel) => {
      try {
        return fs.statSync(abs(rel)).isFile();
      } catch {
        return false;
      }
    },
    read: (rel) => fs.readFileSync(abs(rel), 'utf8'),
  };
}

const hasGlob = (p) => /[*?]/.test(p);

function globRe(p) {
  let re = '';
  for (let i = 0; i < p.length; i += 1) {
    const c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') {
        i += 1;
        if (p[i + 1] === '/') {
          re += '(?:.*/)?';
          i += 1;
        } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

const staticDirOf = (pattern) => {
  const segs = pattern.split('/');
  const at = segs.findIndex((s) => hasGlob(s));
  return segs.slice(0, at < 0 ? segs.length : at).join('/');
};

const matchesAny = (patterns, key) => patterns.some((p) => (hasGlob(p) ? globRe(p).test(key) : p === key));

function expandKeys(source, patterns, mapSrc) {
  const out = new Set();
  for (const p of patterns) {
    if (!hasGlob(p)) {
      if (!isBackup(p) && source.exists(mapSrc(p))) out.add(p);
      continue;
    }
    const dir = staticDirOf(p);
    const re = globRe(p);
    for (const rel of source.list(mapSrc(dir))) {
      const key = dir ? `${dir}/${rel}` : rel;
      if (re.test(key) && !isBackup(key)) out.add(key);
    }
  }
  return [...out].sort();
}

// 조각이 가진 설치 키(글롭을 푼 것, 늘 빼는 백업과 점 파일 제외). 이미 없는 파일은 빠진다.
export function expandFiles(part) {
  const mapSrc = part.origin === 'local' ? (k) => k : srcOf;
  return expandKeys(part.source, part.files, mapSrc);
}

function defaultKind(key) {
  const inCode = key.startsWith('subagent-system/scripts/') || key.startsWith('subagent-system/hooks/') || key.startsWith('hooks/');
  return inCode && !key.endsWith('.md') ? 'code' : 'merge';
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.trim() !== '';
const strList = (v) => Array.isArray(v) && v.every(isStr);

function readJson(source, rel) {
  try {
    return { value: JSON.parse(source.read(rel)) };
  } catch (e) {
    return { error: e instanceof SyntaxError ? `JSON을 읽지 못했습니다: ${e.message}` : `읽지 못했습니다: ${e.message}` };
  }
}

function checkUses(uses, where, problems) {
  if (uses === undefined) return [];
  if (!Array.isArray(uses)) {
    problems.push({ level: 'error', msg: `${where}: uses가 배열이 아닙니다` });
    return [];
  }
  const out = [];
  for (const u of uses) {
    if (!isObj(u) || !isStr(u.bundle) || !Number.isInteger(u.link) || u.link < 1 || !isStr(u.without)) {
      problems.push({ level: 'error', msg: `${where}: uses 항목은 { bundle, link(1 이상 정수), without }이어야 합니다: ${JSON.stringify(u)}` });
      continue;
    }
    out.push({ bundle: u.bundle, link: u.link, without: u.without });
  }
  return out;
}

function normalizeBundle(raw, dirName, where, problems) {
  const err = (msg) => problems.push({ level: 'error', msg: `${where}: ${msg}` });
  if (!isObj(raw)) return err('최상위가 객체가 아닙니다'), null;
  if (raw.name !== dirName) return err(`name(${raw.name})이 폴더 이름(${dirName})과 다릅니다`), null;
  if (!NAME_RE.test(raw.name)) return err('name은 영문 소문자와 하이픈이어야 합니다'), null;
  if (!isStr(raw.title) || !isStr(raw.summary)) return err('title과 summary가 필요합니다'), null;
  if (typeof raw.order !== 'number') return err('order가 숫자가 아닙니다'), null;
  if (raw.selectable !== undefined && typeof raw.selectable !== 'boolean') return err('selectable이 true/false가 아닙니다'), null;
  if (!strList(raw.alwaysRules ?? [])) return err('alwaysRules가 문자열 배열이 아닙니다'), null;
  if (!strList(raw.configKeys ?? [])) return err('configKeys가 문자열 배열이 아닙니다'), null;
  if (!strList(raw.records ?? [])) return err('records가 문자열 배열이 아닙니다'), null;
  const options = [];
  for (const o of raw.options ?? []) {
    if (!isObj(o) || !NAME_RE.test(o.id ?? '') || !isStr(o.title) || !strList(o.files) || !o.files.length || typeof o.default !== 'boolean') {
      err(`options 항목은 { id, title, files, default }이어야 합니다: ${JSON.stringify(o)}`);
      continue;
    }
    options.push({ id: o.id, title: o.title, files: o.files, default: o.default });
  }
  return {
    name: raw.name,
    title: raw.title,
    summary: raw.summary,
    order: raw.order,
    selectable: raw.selectable ?? true,
    alwaysRules: raw.alwaysRules ?? [],
    options,
    configKeys: raw.configKeys ?? [],
    uses: checkUses(raw.uses, where, problems),
    records: raw.records ?? [],
  };
}

function normalizePart(raw, bundleDir, partName, where, folderOrigin, problems) {
  const err = (msg) => problems.push({ level: 'error', msg: `${where}: ${msg}` });
  if (!isObj(raw)) return err('최상위가 객체가 아닙니다'), null;
  if (raw.bundle !== bundleDir) return err(`bundle(${raw.bundle})이 폴더 이름(${bundleDir})과 다릅니다`), null;
  if (raw.part !== partName) return err(`part(${raw.part})가 파일 이름(${partName})과 다릅니다`), null;
  if (!NAME_RE.test(partName)) return err('조각 이름은 영문 소문자와 하이픈이어야 합니다'), null;
  const origin = raw.origin ?? folderOrigin;
  if (origin !== folderOrigin) return err(`origin(${origin})이 놓인 자리(${folderOrigin} 조각 자리)와 다릅니다`), null;
  if (!strList(raw.files) || raw.files.some((f) => f.startsWith('/') || f.split('/').includes('..'))) return err('files가 설치 키 문자열 배열이 아닙니다'), null;
  const kinds = raw.kinds ?? {};
  const exec = raw.exec ?? [];
  const kitOnly = raw.kitOnly ?? [];
  const rename = raw.rename ?? {};
  if (origin === 'local' && (Object.keys(kinds).length || exec.length || kitOnly.length || Object.keys(rename).length)) {
    return err('로컬 조각은 kinds, exec, kitOnly, rename을 쓰지 않습니다'), null;
  }
  if (!isObj(kinds) || Object.values(kinds).some((k) => !KINDS.includes(k))) return err(`kinds는 { 설치 키: ${KINDS.join('|')} }이어야 합니다`), null;
  if (!strList(exec) || !strList(kitOnly)) return err('exec와 kitOnly는 문자열 배열이어야 합니다'), null;
  if (!isObj(rename) || Object.entries(rename).some(([k, v]) => !k.endsWith('/') || v !== 'commandName')) return err('rename은 { "<끝이 /인 접두>": "commandName" }이어야 합니다'), null;
  for (const k of exec) if (!matchesAny(raw.files, k)) err(`exec의 ${k}가 files에 없습니다`);
  const hooks = [];
  for (const h of raw.hooks ?? []) {
    const ok = isObj(h) && NAME_RE.test(h.name ?? '') && isStr(h.event) && isStr(h.command) && typeof h.timeout === 'number' && h.timeout > 0
      && (h.matcher === undefined || typeof h.matcher === 'string')
      && (h.timed === undefined || typeof h.timed === 'boolean')
      && (h.when === undefined || (isObj(h.when) && isStr(h.when.config) && 'equals' in h.when));
    if (!ok) {
      err(`hooks 항목은 { name, event, command, timeout, matcher?, timed?, when? }이어야 합니다: ${JSON.stringify(h)}`);
      continue;
    }
    hooks.push(h);
  }
  const gitHooks = [];
  for (const g of raw.gitHooks ?? []) {
    const ok = isObj(g) && isStr(g.hook) && NAME_RE.test(g.name ?? '') && typeof g.order === 'number' && isStr(g.file);
    if (!ok) {
      err(`gitHooks 항목은 { hook, name, order, file }이어야 합니다: ${JSON.stringify(g)}`);
      continue;
    }
    if (!matchesAny(raw.files, g.file)) err(`gitHooks의 ${g.file}가 files에 없습니다`);
    gitHooks.push(g);
  }
  return {
    bundle: bundleDir,
    part: partName,
    id: `${bundleDir}.${partName}`,
    origin,
    files: raw.files,
    kinds,
    exec,
    kitOnly,
    rename,
    hooks,
    gitHooks,
    uses: checkUses(raw.uses, where, problems),
  };
}

// 한 원본(키트나 추가 원본)과 설치본 로컬 자리에서 정의 파일을 읽는다.
function readDefinitionFiles(source, baseDir, folderOrigin, sourceName, problems) {
  const bundles = [];
  const parts = [];
  for (const rel of source.list(baseDir)) {
    const m = PART_FILE_RE.exec(rel);
    if (!m) continue;
    const file = `${baseDir}/${rel}`;
    const where = `${sourceName}:${file}`;
    const read = readJson(source, file);
    if (read.error) {
      problems.push({ level: 'error', msg: `${where}: ${read.error}` });
      continue;
    }
    if (m[2] === 'bundle.json') {
      const b = normalizeBundle(read.value, m[1], where, problems);
      if (b) bundles.push({ ...b, origin: folderOrigin, sourceName, defFile: file });
    } else {
      const p = normalizePart(read.value, m[1], m[3], where, folderOrigin, problems);
      if (p) parts.push({ ...p, root: source.root, source, sourceName, defFile: file });
    }
  }
  return { bundles, parts };
}

// 정의를 모두 읽어 검사한다. 조각 정의가 키트 원본(kitRoot)과 추가 원본(kitSources)과 설치본 로컬 자리(configDir)에 있을 수 있다.
// 같은 조각이 두 곳에 있으면 partSource({ '<묶음>.<조각>': '<원본 이름>' })가 고르고, 없으면 error다. 키트 원본의 이름은 kit이다.
// 읽은 원본은 파일 시스템이다. 다른 읽기 길(git 커밋)은 opts.source({ list, exists, read }, 키트 원본 상대 경로)로 바꿔 끼운다.
export function loadDefinitions({ kitRoot, configDir, kitSources = {}, partSource = {}, source } = {}) {
  const problems = [];
  const err = (msg) => problems.push({ level: 'error', msg });
  const warn = (msg) => problems.push({ level: 'warn', msg });

  const sources = [{ name: 'kit', source: source ? { root: kitRoot, ...source } : fsSource(kitRoot) }];
  for (const [name, root] of Object.entries(kitSources ?? {})) {
    if (name === 'kit') {
      err('kitSources 이름 kit은 키트 원본이 쓰는 이름입니다');
      continue;
    }
    if (typeof root !== 'string' || !path.isAbsolute(root)) {
      err(`kitSources.${name}가 절대 경로가 아닙니다`);
      continue;
    }
    if (!fs.existsSync(root)) {
      warn(`kitSources.${name}의 폴더가 없습니다: ${root}`);
      continue;
    }
    sources.push({ name, source: fsSource(root) });
  }

  const bundleByName = new Map();
  const found = new Map(); // 조각 id -> [{ sourceName, part }]
  const add = (read) => {
    for (const b of read.bundles) {
      const have = bundleByName.get(b.name);
      if (have) {
        warn(`묶음 ${b.name}의 bundle.json이 ${have.sourceName}와 ${b.sourceName} 두 곳에 있습니다. ${have.sourceName} 것을 씁니다`);
        continue;
      }
      bundleByName.set(b.name, b);
    }
    for (const p of read.parts) {
      if (!found.has(p.id)) found.set(p.id, []);
      found.get(p.id).push(p);
    }
  };
  for (const s of sources) add(readDefinitionFiles(s.source, 'bundles', 'kit', s.name, problems));
  if (configDir) add(readDefinitionFiles(fsSource(configDir), LOCAL_DIR, 'local', 'local', problems));

  const parts = [];
  for (const [id, list] of found) {
    if (list.length === 1) {
      parts.push(list[0]);
      continue;
    }
    const names = list.map((p) => p.sourceName);
    const chosen = partSource?.[id];
    if (chosen === undefined) {
      err(`조각 ${id}의 정의가 둘 이상입니다(${names.join(', ')}). partSource로 하나를 고르세요`);
      continue;
    }
    const pick = list.find((p) => p.sourceName === chosen);
    if (!pick) {
      err(`partSource.${id}=${chosen}인데 그 원본에 정의가 없습니다(${names.join(', ')})`);
      continue;
    }
    parts.push(pick);
  }
  const bundleOrder = (name) => bundleByName.get(name)?.order ?? Infinity;
  parts.sort((a, b) => bundleOrder(a.bundle) - bundleOrder(b.bundle) || a.bundle.localeCompare(b.bundle) || a.part.localeCompare(b.part));

  for (const p of parts) {
    if (!bundleByName.has(p.bundle)) err(`조각 ${p.id}의 묶음 ${p.bundle}의 bundle.json이 없습니다(${p.defFile})`);
  }
  const base = bundleByName.get('base');
  if (!base) err('바닥 묶음(base)의 bundle.json이 없습니다');
  else if (base.selectable) err('바닥 묶음(base)은 selectable이 false여야 합니다');
  if (!bundleByName.has('base') || !parts.some((p) => p.bundle === 'base')) err('바닥 묶음(base)에 조각이 없습니다');

  // 설정 키의 주인은 하나다.
  const keyOwner = new Map();
  for (const b of bundleByName.values()) {
    for (const k of b.configKeys) {
      if (keyOwner.has(k) && keyOwner.get(k) !== b.name) err(`설정 키 ${k}의 주인이 둘입니다(${keyOwner.get(k)}, ${b.name})`);
      else keyOwner.set(k, b.name);
    }
  }

  // 묶음의 늘 깔 규칙과 고를 항목은 그 묶음 조각의 files에 든 파일이어야 한다.
  for (const b of bundleByName.values()) {
    const patterns = parts.filter((p) => p.bundle === b.name).flatMap((p) => p.files);
    const optionIds = new Set();
    const optionFiles = [];
    for (const o of b.options) {
      if (optionIds.has(o.id)) err(`묶음 ${b.name}의 고를 항목 id ${o.id}가 겹칩니다`);
      optionIds.add(o.id);
      for (const f of o.files) {
        optionFiles.push(f);
        if (!matchesAny(patterns, f)) err(`묶음 ${b.name}의 고를 항목 ${o.id}의 ${f}가 조각 files에 없습니다`);
      }
    }
    for (const f of b.alwaysRules) {
      if (!matchesAny(patterns, f)) err(`묶음 ${b.name}의 alwaysRules ${f}가 조각 files에 없습니다`);
      if (matchesAny(optionFiles, f)) err(`묶음 ${b.name}의 alwaysRules ${f}가 고를 항목에도 들어 있습니다`);
    }
  }

  // 걸침(uses)이 가리키는 묶음은 있어야 하고, 바닥과 자기 자신은 가리키지 않는다.
  // 공개판처럼 묶음 일부만 내보낸 키트 원본은 bundles/omitted.json({ "omitted": [묶음 이름] })에 뺀 묶음을 적는다. 그 묶음을 가리키는 걸침은 오류가 아니다(그 묶음이 없으면 걸침 쪽 갈래가 돌지 않을 뿐이다).
  const omittedRead = sources[0].source.exists?.('bundles/omitted.json') ? readJson(sources[0].source, 'bundles/omitted.json') : { value: null };
  if (omittedRead.error) err(`kit:bundles/omitted.json: ${omittedRead.error}`);
  const omitted = new Set(Array.isArray(omittedRead.value?.omitted) ? omittedRead.value.omitted.filter((n) => typeof n === 'string') : []);
  const checkUseTargets = (uses, owner, where) => {
    for (const u of uses) {
      if (u.bundle === 'outside') continue;
      if (!bundleByName.has(u.bundle) && omitted.has(u.bundle)) continue;
      if (u.bundle === owner) err(`${where}: 자기 자신을 uses로 가리킵니다`);
      else if (u.bundle === 'base') err(`${where}: 바닥은 uses로 적지 않습니다(바닥에 기대는 것은 걸침이 아님)`);
      else if (!bundleByName.has(u.bundle)) err(`${where}: uses가 모르는 묶음 ${u.bundle}를 가리킵니다`);
    }
  };
  for (const b of bundleByName.values()) checkUseTargets(b.uses, b.name, `묶음 ${b.name}`);
  for (const p of parts) checkUseTargets(p.uses, p.bundle, `조각 ${p.id}`);

  // 훅 이름표(묶음/이름)와 이벤트, git 조각(훅, 이름)은 묶음 안에서 겹치지 않는다.
  const hookSeen = new Map();
  const gitSeen = new Map();
  for (const p of parts) {
    for (const h of p.hooks) {
      const k = `${p.bundle}/${h.name}|${h.event}|${h.matcher ?? ''}`;
      if (hookSeen.has(k)) err(`훅 ${p.bundle}/${h.name}(${h.event})이 ${hookSeen.get(k)}와 ${p.id}에 겹칩니다`);
      else hookSeen.set(k, p.id);
    }
    for (const g of p.gitHooks) {
      const k = `${g.hook}|${g.name}`;
      if (gitSeen.has(k)) err(`git 조각 ${g.hook}/${g.name}이 ${gitSeen.get(k)}와 ${p.id}에 겹칩니다`);
      else gitSeen.set(k, p.id);
    }
  }

  // 파일: 이름으로 적은 파일은 있어야 한다(NEW_FILES는 없어도 warn). 키트 조각만 원본을 본다. 로컬 조각은 설치본 사정이라 warn이다.
  const newSet = new Set(NEW_FILES);
  const owners = new Map(); // 설치 키 -> 조각 id들
  const own = (key, id) => owners.set(key, [...(owners.get(key) ?? []), id]);
  for (const p of parts) {
    const mapSrc = p.origin === 'local' ? (k) => k : srcOf;
    const explicit = [...p.files, ...p.kitOnly].filter((f) => !hasGlob(f));
    for (const f of explicit) {
      if (p.source.exists(mapSrc(f))) continue;
      if (p.origin === 'local') warn(`로컬 조각 ${p.id}의 파일이 없습니다: ${f}`);
      else if (newSet.has(f)) warn(`아직 없는 새 파일(NEW_FILES): ${f}`);
      else err(`조각 ${p.id}의 파일이 원본에 없습니다: ${f}`);
    }
    const keys = new Set([...expandFiles(p), ...explicit]);
    for (const k of keys) own(k, p.id);
  }
  for (const f of newSet) {
    if (!owners.has(f)) err(`NEW_FILES의 ${f}가 어느 조각에도 올라 있지 않습니다`);
  }
  for (const [key, ids] of owners) {
    if (ids.length > 1) err(`겹침: ${key}가 조각 ${ids.join(', ')}에 모두 들어 있습니다`);
  }

  // 키트 원본의 설치 대상 파일은 모두 조각에 배정돼야 한다.
  const kitSource = sources[0].source;
  const scanned = new Set();
  for (const dir of SCAN_DIRS) for (const rel of kitSource.list(dir)) scanned.add(keyOfSrc(`${dir}/${rel}`));
  for (const f of SCAN_FILES) if (kitSource.exists(f)) scanned.add(f);
  for (const key of [...scanned].sort()) {
    if (isBackup(key)) continue;
    if (!owners.has(key)) err(`배정 없음: 원본의 ${key}가 어느 조각에도 없습니다`);
  }

  return { bundles: bundleByName, parts, problems, omitted: [...omitted].sort() };
}

// 걸침 번호를 묶음과 조각의 uses가 얼마나 덮는지.
export function linksCovered(defs) {
  const links = new Set();
  for (const b of defs.bundles.values()) for (const u of b.uses) links.add(u.link);
  for (const p of defs.parts) for (const u of p.uses) links.add(u.link);
  return links;
}

// 고를 수 있는 묶음 이름(바닥 제외, 차례대로)과 고를 항목 id(`<묶음>.<항목>` 꼴).
export const selectableBundles = (defs) => [...defs.bundles.values()].filter((b) => b.selectable).sort((a, b) => a.order - b.order).map((b) => b.name);
export function optionIds(defs, { bundles, onlyDefault = false } = {}) {
  const names = bundles ?? [...defs.bundles.keys()];
  return names.flatMap((n) => (defs.bundles.get(n)?.options ?? []).filter((o) => !onlyDefault || o.default).map((o) => `${n}.${o.id}`));
}

// 깔 파일 목록. selection은 { bundles: 묶음 이름들, options: '<묶음>.<항목>'들 }이고 바닥은 늘 든다.
// 고를 항목(options)에 든 파일은 그 항목을 골랐을 때만, 그 밖 파일은 묶음을 고르면 늘 든다. 로컬 조각 파일은 kind local로 내고 src는 null이다.
export function entriesFor(defs, selection, { removedDefs = [], commandName = 'retro' } = {}) {
  const wantBundles = new Set(['base', ...(selection?.bundles ?? [])]);
  const wantOptions = new Set(selection?.options ?? []);
  for (const n of wantBundles) if (!defs.bundles.has(n)) throw new Error(`모르는 묶음: ${n}`);
  for (const o of wantOptions) {
    const [b, id] = o.split('.');
    if (!defs.bundles.get(b)?.options.some((x) => x.id === id)) throw new Error(`모르는 고를 항목: ${o}`);
  }
  const removed = new Set(removedDefs.map((n) => `agents/${n}.md`));
  const out = [];
  for (const part of defs.parts) {
    if (!wantBundles.has(part.bundle)) continue;
    const bundle = defs.bundles.get(part.bundle);
    const gated = bundle.options.map((o) => ({ id: `${bundle.name}.${o.id}`, files: o.files }));
    for (const key of expandFiles(part)) {
      const gate = gated.find((g) => matchesAny(g.files, key));
      if (gate && !wantOptions.has(gate.id)) continue;
      if (removed.has(key)) continue;
      if (part.origin === 'local') {
        out.push({ key, src: null, kind: 'local', exec: false, bundle: part.bundle, part: part.part });
        continue;
      }
      let outKey = key;
      for (const prefix of Object.keys(part.rename)) {
        if (key.startsWith(prefix)) outKey = `${prefix.replace(/[^/]+\/$/, `${commandName}/`)}${key.slice(prefix.length)}`;
      }
      out.push({ key: outKey, src: srcOf(key), kind: part.kinds[key] ?? defaultKind(key), exec: part.exec.includes(key), bundle: part.bundle, part: part.part });
    }
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}
