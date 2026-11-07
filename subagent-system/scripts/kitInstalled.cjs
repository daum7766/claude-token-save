'use strict';

// 깐 상태 기록(subagent-system/bundles.lock.json)을 읽고 쓰는 도우미다. CJS 훅과 ESM 스크립트가 모두 쓰려고 .cjs로 둔다.
// 기록은 깐 묶음 목록의 원본이다. 꼴: { lockVersion: 1, installed: { <묶음>: { options: [...], parts: { <조각>: { origin: 'kit'|'local', commit?, hooks?, gitHooks? } } } } }
// 키트 조각은 깔 때의 훅과 git 조각 정의 사본을 담고, 로컬 조각은 origin만 담는다(설치본이 정본이라 정의는 그때그때 local-bundles에서 읽음).
// 파일이 없거나 깨졌으면 읽는 쪽은 「모름」으로 보고 깔린 것으로 친다(옛 설치에서 지금 동작을 지키는 쪽).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const LOCK_VERSION = 1;
const COMMANDS = ['install', 'add', 'update', 'sync', 'set-profile', 'hook-off', 'remove', 'uninstall'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => JSON.parse(JSON.stringify(v));

function defaultConfigDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

const lockPath = (configDir = defaultConfigDir()) => path.join(configDir, 'subagent-system', 'bundles.lock.json');

// 없거나 깨졌거나 꼴이 틀리면 null.
function readLock(configDir = defaultConfigDir()) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(lockPath(configDir), 'utf8'));
  } catch {
    return null;
  }
  if (!isObj(parsed) || !isObj(parsed.installed)) return null;
  if (!Object.values(parsed.installed).every((e) => isObj(e) && (e.parts === undefined || isObj(e.parts)))) return null;
  return parsed;
}

function installedBundles(configDir = defaultConfigDir()) {
  const lock = readLock(configDir);
  return lock === null ? null : new Set(Object.keys(lock.installed));
}

// 기록이 없거나 깨졌으면 true(모름은 깔림). 바닥은 늘 깔려 있다.
function hasBundle(name, configDir = defaultConfigDir()) {
  if (name === 'base') return true;
  const installed = installedBundles(configDir);
  return installed === null ? true : installed.has(name);
}

const isLocalPart = (p) => isObj(p) && p.origin === 'local';

// 명령이 끝난 뒤의 기록을 낸다. 키트 조각 항목만 고치고, 로컬 조각 항목과 로컬 묶음 항목은 그대로 둔다.
// 로컬 항목을 지우는 것은 그 묶음을 이름으로 고른 remove와 uninstall뿐이다.
//   old       지금 기록(없으면 null)
//   command   install | add | update | sync | set-profile | hook-off | remove | uninstall
//   bundles   remove와 add가 다루는 묶음 이름들(install, update, sync, set-profile, hook-off는 쓰지 않음)
//   kitParts  이 명령이 새로 적을 키트 조각: { <묶음>: { options?: [...], parts: { <조각>: { origin: 'kit', commit, hooks, gitHooks } } } }
//   localParts(덧붙임)  local-bundles에서 새로 찾은 로컬 조각: kitParts와 같은 꼴, origin 'local'. 이미 기록에 있는 로컬 조각은 건드리지 않고 없는 것만 더한다
// install은 키트 조각을 kitParts로 새로 짜고, update, sync, set-profile, hook-off는 kitParts에 든 묶음의 키트 조각만 갈아 끼운다(든 묶음의 옛 키트 조각 가운데 kitParts에 없는 것은 빠짐).
// add는 kitParts의 묶음을 더하거나 갈아 끼우고, remove는 bundles의 묶음 항목을 통째로 지운다.
function mergeLock(old, { command, bundles = [], kitParts = {}, localParts = {} } = {}) {
  if (!COMMANDS.includes(command)) throw new Error(`모르는 명령: ${command}`);
  const base = isObj(old) && isObj(old.installed) ? clone(old) : { lockVersion: LOCK_VERSION, installed: {} };
  const installed = base.installed;

  if (command === 'uninstall') return { ...base, lockVersion: LOCK_VERSION, installed: {} };
  if (command === 'remove') {
    for (const name of bundles) {
      if (name === 'base') throw new Error('바닥(base)은 remove로 뺄 수 없습니다. 모두 빼려면 uninstall을 쓰세요');
      delete installed[name];
    }
    return { ...base, lockVersion: LOCK_VERSION, installed };
  }

  // install은 옛 키트 조각을 버리고 새로 짠다. 로컬 조각은 남는다.
  if (command === 'install') {
    for (const [name, entry] of Object.entries(installed)) {
      const keptParts = Object.fromEntries(Object.entries(entry.parts ?? {}).filter(([, p]) => isLocalPart(p)));
      if (Object.keys(keptParts).length) installed[name] = { ...entry, options: entry.options ?? [], parts: keptParts };
      else delete installed[name];
    }
  }

  // update류는 이미 깐 묶음만 갈아 끼운다(새 묶음은 알림으로만 보임). add는 bundles에 든 묶음만 더한다.
  const refreshOnly = ['update', 'sync', 'set-profile', 'hook-off'].includes(command);
  for (const [name, next] of Object.entries(kitParts)) {
    if (refreshOnly && !(name in installed)) continue;
    if (command === 'add' && bundles.length && !bundles.includes(name)) continue;
    const entry = installed[name] ?? { options: [], parts: {} };
    const keptLocal = Object.fromEntries(Object.entries(entry.parts ?? {}).filter(([, p]) => isLocalPart(p)));
    installed[name] = {
      ...entry,
      options: next.options !== undefined ? [...next.options] : (entry.options ?? []),
      parts: { ...clone(next.parts ?? {}), ...keptLocal },
    };
  }

  for (const [name, next] of Object.entries(localParts)) {
    const entry = installed[name] ?? { options: [], parts: {} };
    const parts = { ...(entry.parts ?? {}) };
    for (const [part, def] of Object.entries(next.parts ?? {})) if (!(part in parts)) parts[part] = { origin: 'local', ...def };
    installed[name] = { ...entry, options: entry.options ?? [], parts };
  }

  return { ...base, lockVersion: LOCK_VERSION, installed };
}

// 임시 파일에 쓰고 바꿔 끼운다. 읽는 훅이 반쯤 쓴 파일을 보지 않게 하려는 것이다.
function writeLock(configDir, lock) {
  const file = lockPath(configDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(lock, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

module.exports = { LOCK_VERSION, lockPath, readLock, installedBundles, hasBundle, mergeLock, writeLock };
