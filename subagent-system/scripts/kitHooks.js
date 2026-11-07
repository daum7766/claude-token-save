// settings.json의 훅 등록을 묶음 정의에 맞추는 순수 함수 모음이다. 파일을 읽거나 쓰지 않는다(쓰기는 kit-setup.js가 마지막에 한다).
// 설치, 갱신, 넣기, 빼기, set-profile, hook-off, retroWriteAllow 설정이 모두 syncHooks 하나를 부른다.
// 키트가 단 훅 명령은 끝에 셸 주석 이름표 `# kit:<묶음>/<이름>`을 달고, 이름표와 이벤트가 등록 하나를 가린다. 이름표 없는 명령은 사용자 훅이라 건드리지 않는다(옛 꼴로 알아보는 것만 갈아 끼움).

import os from 'node:os';
import { PROFILES, profileOf } from './kitProfile.js';

const WRAPPER_PATH = '$HOME/.claude/subagent-system/hooks/kit-hook.cjs';
const LABEL_RE = /\s#\s*kit:([a-z][a-z0-9-]*)\/([a-z][a-z0-9-]*)\s*$/;
// 훅 이벤트 이름으로 알려진 것. 목록에 없으면 막지 않고 경고만 한다(모르는 이벤트는 Claude Code가 그 항목만 건너뜀).
const KNOWN_EVENTS = new Set([
  'UserPromptSubmit', 'UserPromptExpansion', 'Stop', 'StopFailure', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PostToolBatch', 'SubagentStart', 'SubagentStop',
  'PermissionRequest', 'PermissionDenied', 'Notification', 'SessionStart', 'SessionEnd', 'Setup', 'PreCompact', 'PostCompact', 'InstructionsLoaded', 'ConfigChange',
  'CwdChanged', 'FileChanged', 'WorktreeCreate', 'WorktreeRemove', 'TaskCreated', 'TaskCompleted', 'TeammateIdle', 'Elicitation', 'ElicitationResult',
]);

const clone = (v) => JSON.parse(JSON.stringify(v));
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const slash = (p) => String(p).replace(/\\/g, '/');

// 키 순서와 상관없이 같은 값이면 같은 글자가 되게 한다.
const canon = (v) => JSON.stringify(v, (_, x) => (isObj(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));

export const labelOf = (command) => {
  const m = LABEL_RE.exec(String(command ?? ''));
  return m ? { bundle: m[1], name: m[2], id: `${m[1]}/${m[2]}` } : null;
};

// 설정 폴더가 기본(~/.claude)이 아니면 명령의 $HOME/.claude를 그 경로로 바꾼다.
const swapHome = (text, configDir) => (configDir ? text.split('$HOME/.claude').join(slash(configDir)) : text);

// 정의 하나를 settings.json에 달 명령 글자로 만든다. 감싸개와 이름표를 붙인다(timed가 false면 이름표만).
export function buildCommand(def, { bundle, configDir } = {}) {
  const label = `# kit:${bundle}/${def.name}`;
  const command = swapHome(def.command, configDir);
  if (def.timed === false) return `${command} ${label}`;
  return `node "${swapHome(WRAPPER_PATH, configDir)}" ${def.name} ${command} ${label}`;
}

// 경로 글자를 한 꼴로 맞춘다: 역슬래시는 /로, 설정 폴더와 $HOME, ${HOME}, 홈 절대 경로는 ~로.
export function normalizeCommand(cmd, { home = os.homedir(), configDir } = {}) {
  let out = slash(cmd);
  if (configDir) out = out.split(slash(configDir)).join('~/.claude');
  out = out.split('${HOME}').join('~').split('$HOME').join('~');
  if (home) out = out.split(slash(home)).join('~');
  return out;
}

const SCRIPT_RE = /\.(?:c?js|mjs|py)$/;
const WRAPPER_FILES = new Set(['kit-hook.cjs', 'timed.zsh']);

// 명령 안의 스크립트 경로(.js .cjs .mjs .py). 감싸개 경로는 뺀다. 이름표 주석은 보지 않는다.
export function scriptPathsOf(cmd) {
  const body = String(cmd ?? '').replace(LABEL_RE, '');
  return body
    .split(/\s+/)
    .map((t) => t.replace(/^["']+|["']+$/g, ''))
    .filter((t) => SCRIPT_RE.test(t) && !WRAPPER_FILES.has(t.split(/[\\/]/).pop()));
}

// 감싸개(kit-hook.cjs나 timed.zsh와 이름)와 이름표를 벗긴 명령. 따옴표는 견줄 때 걸림돌이라 뺀다.
function unwrapped(cmd, opts) {
  let c = normalizeCommand(cmd, opts).replace(LABEL_RE, '').trim();
  c = c.replace(/^(?:\S*\/)?zsh\s+"?\S*timed\.zsh"?\s+\S+\s+/, '').replace(/^(?:\S*\/)?node\s+"?\S*kit-hook\.cjs"?\s+\S+\s+/, '');
  return c.replace(/["']/g, '').replace(/\s+/g, ' ').trim();
}

// settings.hooks를 (이벤트, matcher, 감싸개를 벗긴 명령, timeout) 줄로 편다.
function flatten(settings, opts) {
  const rows = [];
  for (const [event, groups] of Object.entries(settings?.hooks ?? {})) {
    if (!Array.isArray(groups)) continue;
    for (const g of groups) {
      for (const h of Array.isArray(g?.hooks) ? g.hooks : []) {
        if (typeof h?.command !== 'string') continue;
        rows.push({ event, matcher: g.matcher ?? '', command: unwrapped(h.command, opts), timeout: h.timeout ?? null });
      }
    }
  }
  return rows;
}

// 두 settings의 훅 등록을 감싸개와 경로 글자를 벗기고 견준다. 같은 줄이 둘이면 두 개로 센다(같은 훅이 두 번 걸린 것을 잡으려는 것).
// changed는 이벤트와 명령은 같은데 matcher나 timeout이 다른 짝이다.
export function compareHooks(a, b, opts = {}) {
  const rowsA = flatten(a, opts);
  const rowsB = flatten(b, opts);
  const same = (x, y) => x.event === y.event && x.matcher === y.matcher && x.command === y.command && x.timeout === y.timeout;
  const onlyA = [];
  const poolB = [...rowsB];
  for (const x of rowsA) {
    const i = poolB.findIndex((y) => same(x, y));
    if (i < 0) onlyA.push(x);
    else poolB.splice(i, 1);
  }
  const onlyB = poolB;
  const changed = [];
  for (const x of [...onlyA]) {
    const j = onlyB.findIndex((y) => y.event === x.event && y.command === x.command);
    if (j < 0) continue;
    changed.push({ a: x, b: onlyB[j] });
    onlyA.splice(onlyA.indexOf(x), 1);
    onlyB.splice(j, 1);
  }
  return { onlyA, onlyB, changed };
}

// when 조건. config에 키가 없으면 사용 방식의 기본값으로 판정한다(키 없는 옛 설치에서 등록이 빠지지 않게).
function whenOk(def, config) {
  if (!def.when) return true;
  const have = config && Object.hasOwn(config, def.when.config) ? config[def.when.config] : PROFILES[profileOf(config)]?.[def.when.config];
  return have === def.when.equals;
}

const handlerOf = (def, bundle, configDir) => ({ type: 'command', command: buildCommand(def, { bundle, configDir }), timeout: def.timeout });

// settings.json의 훅 등록을 정의에 맞춘다(순수 함수, 입력을 바꾸지 않고 새 settings를 낸다).
//   defs     loadDefinitions의 결과(parts를 씀). 옛 꼴 알아보기에 키트와 로컬의 모든 정의를 쓴다
//   lock     깐 상태 기록. 깐 키트 조각의 훅은 여기 적힌 사본을, 로컬 조각의 훅은 defs의 정의를 쓴다
//   config   config.json 객체(when 조건, disabledHooks)
//   configDir  기본이 아닌 설정 폴더일 때만(명령의 $HOME/.claude를 이 경로로 바꿈)
//   home     홈 폴더(옛 꼴의 절대 경로를 알아보는 데 씀, 기본은 이 컴퓨터의 홈)
export function syncHooks(settings, { defs = { parts: [] }, lock, config = {}, configDir, home = os.homedir() } = {}) {
  const out = clone(settings ?? {});
  const changes = { added: [], removed: [], replaced: [], kept: 0, unknownKept: [], warnings: [], changed: false };
  if (!isObj(lock) || !isObj(lock.installed)) {
    changes.warnings.push('깐 상태 기록이 없어 훅 등록을 건드리지 않았습니다');
    return { settings: out, changes };
  }
  const norm = { home, configDir };

  // 1. 정의 모으기. 정의를 못 읽은 로컬 조각의 묶음은 모름으로 둔다.
  const localDefs = new Map(defs.parts.filter((p) => p.origin === 'local').map((p) => [`${p.bundle}.${p.part}`, p]));
  const unknownBundles = new Set();
  const collected = [];
  for (const [bundle, entry] of Object.entries(lock.installed)) {
    for (const [part, p] of Object.entries(entry?.parts ?? {})) {
      let hooks;
      if (p?.origin === 'local') {
        const local = localDefs.get(`${bundle}.${part}`);
        if (!local) unknownBundles.add(bundle);
        hooks = local?.hooks ?? [];
      } else hooks = p?.hooks ?? [];
      for (const def of hooks) collected.push({ bundle, def });
    }
  }
  // 2. 원하는 등록.
  const disabled = new Set(Array.isArray(config?.disabledHooks) ? config.disabledHooks : []);
  const desired = new Map();
  for (const c of collected) {
    const id = `${c.bundle}/${c.def.name}`;
    if (!whenOk(c.def, config) || disabled.has(id)) continue;
    const key = `${id}|${c.def.event}`;
    if (!desired.has(key)) desired.set(key, c);
  }
  // 옛 꼴을 알아볼 정의: 깔지 않은 묶음과 로컬 정의를 포함한 모든 것.
  const known = [...collected, ...defs.parts.flatMap((p) => p.hooks.map((def) => ({ bundle: p.bundle, def })))];
  const knownPaths = known.map((k) => ({ ...k, paths: scriptPathsOf(normalizeCommand(k.def.command, norm)) }));

  const hooks = isObj(out.hooks) ? out.hooks : {};
  const existing = new Map(); // key -> [{ event, group, handler }]
  const oldForm = new Map(); // key -> 옛 명령 원문
  const dropped = new Set();

  // 3, 4. 이름표 달린 등록과 옛 꼴을 훑는다.
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (!isObj(group) || !Array.isArray(group.hooks)) continue;
      group.hooks = group.hooks.filter((h) => {
        const command = typeof h?.command === 'string' ? h.command : null;
        if (command === null) return true;
        const label = labelOf(command);
        if (label) {
          const key = `${label.id}|${event}`;
          if (desired.has(key)) {
            existing.set(key, [...(existing.get(key) ?? []), { event, group, handler: h }]);
            return true;
          }
          if (lock.installed[label.bundle] && unknownBundles.has(label.bundle)) {
            changes.unknownKept.push(label.id);
            changes.warnings.push(`${label.id}: 정의를 못 읽어 등록을 그대로 둠`);
            return true;
          }
          changes.removed.push({ label: label.id, event, command });
          dropped.add(group);
          return false;
        }
        const normalized = normalizeCommand(command, norm);
        if (event === 'SessionStart' && /subagent-system\/scripts\/subagent-retro\.js/.test(normalized) && normalized.includes('--session-start')) {
          changes.removed.push({ label: null, event, command });
          dropped.add(group);
          return false;
        }
        const paths = scriptPathsOf(normalized);
        const match = paths.length ? knownPaths.find((k) => k.def.event === event && k.paths.some((p) => paths.includes(p))) : null;
        if (!match) {
          changes.kept += 1;
          return true;
        }
        const key = `${match.bundle}/${match.def.name}|${event}`;
        dropped.add(group);
        if (desired.has(key)) oldForm.set(key, command);
        else changes.removed.push({ label: `${match.bundle}/${match.def.name}`, event, command });
        return false;
      });
    }
  }

  const removeHandler = (e) => {
    e.group.hooks = e.group.hooks.filter((h) => h !== e.handler);
    dropped.add(e.group);
  };

  // 5. 견주기와 더하기.
  for (const [key, c] of desired) {
    const { bundle, def } = c;
    const id = `${bundle}/${def.name}`;
    if (!KNOWN_EVENTS.has(def.event)) changes.warnings.push(`${id}: 모르는 이벤트 이름입니다(${def.event}). 등록은 하지만 Claude Code가 건너뛸 수 있습니다`);
    const want = handlerOf(def, bundle, configDir);
    const have = existing.get(key) ?? [];
    const exact = have.find((e) => (e.group.matcher ?? null) === (def.matcher ?? null) && canon(e.handler) === canon(want));
    if (exact) {
      for (const e of have) {
        if (e === exact) continue;
        removeHandler(e);
        changes.removed.push({ label: id, event: def.event, command: e.handler.command, duplicate: true });
      }
      continue;
    }
    for (const e of have) removeHandler(e);
    if (!Array.isArray(hooks[def.event])) hooks[def.event] = [];
    hooks[def.event].push({ ...(def.matcher === undefined ? {} : { matcher: def.matcher }), hooks: [want] });
    if (have.length) changes.replaced.push({ label: id, event: def.event, old: have[0].handler.command, new: want.command });
    else if (oldForm.has(key)) changes.replaced.push({ label: id, event: def.event, old: oldForm.get(key), new: want.command });
    else changes.added.push({ label: id, event: def.event, command: want.command });
  }

  // 비게 된 묶음(matcher 그룹)과 이벤트를 치운다. 건드리지 않은 빈 것은 둔다.
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    const left = groups.filter((g) => !(dropped.has(g) && Array.isArray(g.hooks) && g.hooks.length === 0));
    if (left.length === groups.length) continue;
    if (left.length) hooks[event] = left;
    else delete hooks[event];
  }
  if (isObj(out.hooks) || Object.keys(hooks).length) out.hooks = hooks;
  changes.changed = Boolean(changes.added.length || changes.removed.length || changes.replaced.length);
  return { settings: out, changes };
}
