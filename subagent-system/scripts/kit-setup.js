#!/usr/bin/env node

/**
 * kit-setup.js
 *
 * 키트 설치, 업데이트, 제거를 맡는 명령 모음. 키트 폴더(이 파일이 든 subagent-system/scripts의 두 단계 위)에서 돌린다.
 * 같은 폴더의 kitMerge.js(3방향 병합), claudeMdTidy.js(CLAUDE.md 판정), kitProfile.js(개인용과 회사용 판정)를 불러온다.
 * 설정 폴더는 CLAUDE_CONFIG_DIR이 있으면 그것, 없으면 ~/.claude다. 회고 스크립트는 설치본 scripts의 한 단계 위 config.json을 읽으므로 둘은 같은 파일이다.
 * update에서 설치본에 .kit-base가 없는 파일은, 키트가 git 저장소이고 설치본 VERSION과 같은 VERSION의 커밋이 있으면 그 커밋의 원문을 기준본으로 3방향 병합한다. 없으면 기록 해시 대조 뒤 2방향이다.
 * 백업은 한 가지다. 고치는 파일 옆에 <파일>.bak-<이름>-<날짜-시각>으로 복사한다(claudeMdTidy가 찍는 CLAUDE.md 백업 경로와 같은 꼴).
 * 오류가 나면 메시지를 오류 출력에 찍고 종료 코드 1로 끝난다. 설정 파일은 쓰기 전에 모두 읽고 검사한다.
 * update는 config.json에 profile이 없으면(업데이트 전 설치본) 아무것도 바꾸지 않고 JSON(needsProfile)을 찍은 뒤 종료 코드 2로 끝난다. 사용자가 고른 profile을 set-profile로 쓴 다음 update를 다시 돌린다.
 *
 * 하위 명령(결과는 JSON으로 찍는다)
 *   install --profile personal|company [--rules 이름,…] [--skills 이름,…] [--hooks 이름,…] [--command-name 이름] [--roles 직군,…] [--kit 폴더] [--dry-run] [--no-git-ask]
 *   update [--kit 폴더] [--dry-run] [--git-ask] [--allow-older]   profile이 없으면 멈춤(종료 코드 2). 옛 records/retro-pending.md의 항목은 docs/PROPOSALS.md의 `## 제안` 아래로 옮기고 원본은 옆 백업으로 남김
 *   add [--rules 이름,…] [--skills 이름,…] [--hooks 이름,…] [--kit 폴더] [--dry-run]   설치본에 없는 규칙, 스킬, 선택 훅(commit-msg) 파일을 놓고 .kit-base에 기준본을 둠. 이미 있는 파일은 건너뛰고 알림
 *   uninstall --records keep|delete|<옮길 경로> [--kit 폴더] [--dry-run]
 *   set-profile personal|company                                 바꾸는 것은 profile과 retroMode(이전 profile의 기본값 그대로일 때만)뿐이고, 옛 판정 키가 있으면 지움. 권한과 보호 스위치(retroWriteAllow, commitCheck)는 바꾸지 않고 새 기본값과 다르면 notes로 알림. profile이 없던 설치는 기본값과 같은 값을 따로 정한 값으로 보지 않음. 개인용으로 가면 출력의 settings.gitAsk.keptCommitAsks로 전역 permissions.ask에 남은 commit 확인을 보임(settings.json은 쓰지 않음)
 *
 * 낱개 플래그
 *   --add-answers <config.json>                                  표준 입력의 JSON 객체를 installAnswers에 합침
 *   --finish-answers <config.json> [keep]                        installAnswers의 keptOutsideLines를 outsideLinesKept로 옮기고 installAnswers(keep이면 keptOutsideLines만)를 지움
 *   --keep-outside-line <config.json>                            표준 입력의 {"line", "kit"} 쌍을 outsideLinesKept에 더하거나 바꿈(kit이 없으면 지움)
 *   --add-config-lines <config.json> <키>                        표준 입력의 줄을 키의 배열에 중복 없이 더함
 *   --config-set <config.json> <키> <JSON 값>                    키의 값을 정함(profile은 set-profile과 같고, 개인용의 retroMode는 auto만 받음. profile이 정하는 옛 판정 키는 거절). retroWriteAllow는 settings.json의 retro-write-allow 훅 등록도 함께 맞춤
 *   --config-unset <파일> <키>                                   키를 지움(retroWriteAllow는 훅 등록도 뺌)
 *   --set-command-name <config.json> <이름>                      commandName을 정함
 *   --set-roles <config.json> [직군…]                            roles를 정함
 *   --checklist-synced <config.json> <VERSION 파일>              checklistSyncedVersion을 그 파일의 값으로 정함
 *   --add-hooks <settings.json> <settings-hook.json> <이벤트…>   키트 훅을 settings.json에 더함
 *   --remove-hooks <settings.json> <이벤트…>                     이 키트의 훅 명령만 뺌
 *   --merge-git-ask <settings.json> <git-permissions.json> <config.json> check|merge   permissions.ask에 키트 항목을 더함(개인용은 personal 목록)
 *   --remove-agent-meter <settings.json> <agent-meter 폴더>      env에서 agent-meter 경로와 keep-alive 키를 뺌
 *   --move-agent-meter <agent-meter 폴더>                        폴더를 같은 위치의 agent-meter-backup-<날짜-시각>으로 옮김
 *   --backup-file <파일> <이름>                                  <파일>.bak-<이름>-<날짜-시각>으로 복사
 *   --check-json <파일…>                                         JSON으로 읽히는지 봄
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { planKitFileUpdate, migrateLegacyZones, legacyHashOf } from './kitMerge.js';
import { analyzeClaudeMd, claudeMdSettingsOf } from './claudeMdTidy.js';
import { PROFILES, RETIRED_POLICY_KEYS, profileOf } from './kitProfile.js';

const stamp = () => {
  const d = new Date();
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
};

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const configDir = () => path.resolve(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'));
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJson = (f, o) => fs.writeFileSync(f, JSON.stringify(o, null, 2) + '\n');

// 같은 이름이 있으면 덮어쓰지 않고 -1, -2를 붙인다.
function freePath(base) {
  let out = base;
  for (let i = 1; fs.existsSync(out); i += 1) out = `${base}-${i}`;
  return out;
}

// settings.json은 심볼릭 링크면 실제 파일에 쓰고, 임시 파일에 쓴 뒤 바꿔 끼워 도중에 끊겨도 원본이 남게 하며, 파일 권한을 지킨다.
function openSettings(file, { mustExist = false } = {}) {
  let f = file;
  try {
    f = fs.realpathSync(f);
  } catch {
    // 없는 파일은 그 경로 그대로 새로 만든다.
  }
  const ex = fs.existsSync(f);
  if (mustExist && !ex) throw new Error(`파일이 없습니다: ${f}`);
  const text = ex ? fs.readFileSync(f, 'utf8').replace(/^﻿/, '').trim() : '';
  const s = JSON.parse(text || '{}');
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error('settings.json 최상위가 객체가 아닙니다');
  return { f, ex, s };
}

function saveSettings({ f, ex, s }) {
  const t = `${f}.tmp-${process.pid}`;
  fs.writeFileSync(t, JSON.stringify(s, null, 2) + '\n');
  if (ex) fs.chmodSync(t, fs.statSync(f).mode & 0o7777);
  fs.renameSync(t, f);
}

function readStdin() {
  return fs.readFileSync(0, 'utf8');
}

const KIT_DEFS = ['haiku-low', 'haiku-medium', 'haiku-high', 'sonnet-low', 'sonnet-medium', 'sonnet-high', 'opus-low', 'opus-medium', 'opus-high', 'opus-xhigh'];

// 배열 값은 더하고(문자열 원소는 중복 없이, line이 든 객체는 같은 line이면 새 것으로 바꾸고, 그 밖의 원소는 같은 것이 없을 때만), 그 밖의 값은 새 값으로 바꾼다.
function mergeArray(prev, next) {
  const out = [...prev];
  for (const e of next) {
    const hasLine = e && typeof e === 'object' && typeof e.line === 'string';
    const i = out.findIndex((x) => (hasLine ? x && x.line === e.line : JSON.stringify(x) === JSON.stringify(e)));
    if (i < 0) out.push(e);
    else if (hasLine) out[i] = e;
  }
  return out;
}

function addAnswers(file) {
  const o = readJson(file);
  const n = JSON.parse(readStdin());
  const r = isObject(o.installAnswers) ? o.installAnswers : {};
  for (const k of Object.keys(n)) r[k] = Array.isArray(n[k]) && Array.isArray(r[k]) ? mergeArray(r[k], n[k]) : n[k];
  o.installAnswers = r;
  writeJson(file, o);
}

function finishAnswers(file, mode) {
  const o = readJson(file);
  const a = isObject(o.installAnswers) ? o.installAnswers : {};
  const k = Array.isArray(a.keptOutsideLines) ? a.keptOutsideLines : [];
  if (k.length) {
    const kept = (Array.isArray(o.outsideLinesKept) ? o.outsideLinesKept : []).filter((x) => x && !k.some((y) => y && y.line === x.line));
    o.outsideLinesKept = kept.concat(k);
  }
  if (mode === 'keep') delete a.keptOutsideLines;
  else delete o.installAnswers;
  writeJson(file, o);
}

function keepOutsideLine(file) {
  const o = readJson(file);
  const n = JSON.parse(readStdin());
  const a = (Array.isArray(o.outsideLinesKept) ? o.outsideLinesKept : []).filter((x) => x && x.line !== n.line);
  if (typeof n.kit === 'string') a.push(n);
  if (a.length) o.outsideLinesKept = a;
  else delete o.outsideLinesKept;
  writeJson(file, o);
}

function addConfigLines(file, key) {
  const o = readJson(file);
  const a = Array.isArray(o[key]) ? o[key] : [];
  for (const l of readStdin().split(/\r?\n/)) {
    const s = l.trim();
    if (s && a.indexOf(s) < 0) a.push(s);
  }
  o[key] = a;
  writeJson(file, o);
}

// retroWriteAllow를 켜거나 끄면 settings.json의 retro-write-allow 훅 등록을 바로 맞춘다. 켜는 것은 사용자가 답한 뒤 이 명령으로만 하는 일이라 등록도 같은 자리에서 끝낸다.
// 까닭: 값은 켜졌는데 훅이 없으면 회고 쓰기마다 확인 창이 뜨고, 값을 껐는데 훅이 남으면 꺼진 줄 알고 있는 사이 등록만 남는다.
// 설정 폴더의 config.json이 아닌 파일(시험용 사본)이면 settings.json을 건드리지 않는다. 훅 정의는 키트의 settings-hook.json에서 읽으므로 설치본 스크립트로 돌리면 켤 때 훅을 못 걸고 update를 안내한다.
function syncWriteAllowHook(file, enabled) {
  const cfg = configDir();
  if (comparablePath(file) !== comparablePath(path.join(cfg, 'subagent-system', 'config.json'))) return null;
  const st = openSettings(path.join(cfg, 'settings.json'));
  let result;
  if (enabled) {
    const kitFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'settings-hook.json');
    if (!fs.existsSync(kitFile)) return { hook: 'not-registered', note: '키트 폴더가 아닌 곳에서 돌려 retro-write-allow 훅을 걸지 못했습니다. 키트 폴더에서 update를 돌리면 걸립니다' };
    const groups = readJson(kitFile).hooks.PermissionRequest.map((g) => ({ ...g, hooks: g.hooks.filter((x) => HOOK_IDS['retro-write-allow'](x.command)) })).filter((g) => g.hooks.length);
    result = applyKitHooks(st.s, { PermissionRequest: groups }, ['PermissionRequest']).length ? 'registered' : 'already-registered';
  } else {
    result = dropKitHooks(st.s, ['PermissionRequest'], 'retro-write-allow') ? 'removed' : 'already-absent';
  }
  if (result === 'registered' || result === 'removed') {
    const backup = freePath(`${st.f}.bak-write-allow-${stamp()}`);
    if (st.ex) fs.copyFileSync(st.f, backup);
    saveSettings(st);
    return { hook: result, backup: st.ex ? backup : null };
  }
  return { hook: result };
}

function configSet(file, key, value) {
  const v = JSON.parse(value);
  if (key === 'profile') {
    const { notes } = setProfileFile(file, v);
    if (notes.length) console.log(JSON.stringify({ notes }, null, 2));
    return;
  }
  if (RETIRED_POLICY_KEYS.includes(key)) throw new Error(`${key}는 설정 키가 아니라 profile이 정하는 판정입니다. 바꾸려면 set-profile personal|company`);
  const o = readJson(file);
  if (key === 'retroMode' && profileOf(o) === 'personal' && v !== 'auto') throw new Error('개인용은 retroMode가 auto여야 합니다. 바꾸려면 set-profile company');
  // settings.json을 먼저 열어 깨졌으면 config.json도 바꾸지 않는다.
  const hook = key === 'retroWriteAllow' ? syncWriteAllowHook(file, v === true) : null;
  o[key] = v;
  writeJson(file, o);
  if (hook) console.log(JSON.stringify({ key, value: v, ...hook }, null, 2));
}

function configUnset(file, key) {
  const o = readJson(file);
  const hook = key === 'retroWriteAllow' ? syncWriteAllowHook(file, false) : null;
  delete o[key];
  writeJson(file, o);
  if (hook) console.log(JSON.stringify({ key, removed: true, ...hook }, null, 2));
}

function setCommandName(file, name) {
  const o = readJson(file);
  o.commandName = name;
  writeJson(file, o);
}

function setRoles(file, roles) {
  const o = readJson(file);
  o.roles = roles;
  writeJson(file, o);
}

function checklistSynced(file, versionFile) {
  const o = readJson(file);
  o.checklistSyncedVersion = fs.readFileSync(versionFile, 'utf8').trim();
  writeJson(file, o);
}

// 훅 명령이 이 키트의 것인지 가리는 조건. 사용자가 같은 묶음에 넣은 다른 명령은 건드리지 않으려고 묶음이 아니라 명령 하나씩 본다.
// 같은 파일 이름의 사용자 훅을 지우지 않게 키트 폴더(subagent-system/hooks 또는 scripts) 경로를 가리키는 명령만 키트 것으로 본다.
const ADDABLE_HOOKS = ['SubagentStop', 'PermissionRequest', 'PreToolUse'];
const kitCommand = (c, dir, file) => c.replace(/\\/g, '/').includes(`subagent-system/${dir}/${file}`);
const HOOK_IDS = {
  'subagent-usage': (c) => kitCommand(c, 'scripts', 'subagent-usage.js'),
  'usage-autolog': (c) => kitCommand(c, 'hooks', 'usage-autolog.js'),
  'retro-write-allow': (c) => kitCommand(c, 'hooks', 'retro-write-allow.js'),
  'brief-check': (c) => kitCommand(c, 'hooks', 'brief-check.js'),
  'ask-log': (c) => kitCommand(c, 'hooks', 'ask-log.js'),
  'session-start': (c) => kitCommand(c, 'scripts', 'subagent-retro.js') && c.includes('--session-start'),
};
const hookIdOf = (command) => Object.keys(HOOK_IDS).find((k) => HOOK_IDS[k](String(command || ''))) ?? null;
const KIT_HOOKS = {
  SubagentStop: (c) => HOOK_IDS['subagent-usage'](c) || HOOK_IDS['usage-autolog'](c),
  SessionStart: HOOK_IDS['session-start'],
  PermissionRequest: (c) => HOOK_IDS['retro-write-allow'](c) || HOOK_IDS['ask-log'](c),
  PreToolUse: HOOK_IDS['brief-check'],
};

const settingsHookCommands = (groups) => (Array.isArray(groups) ? groups.flatMap((g) => (g && Array.isArray(g.hooks) ? g.hooks : [])) : []);

// 이벤트마다 settings.json에 없는 키트 훅 명령만 새 묶음으로 더한다. 더한 이벤트 이름을 돌려준다.
function applyKitHooks(s, kit, events, log = () => {}) {
  const d = process.env.CLAUDE_CONFIG_DIR ? path.resolve(process.env.CLAUDE_CONFIG_DIR).split(path.sep).join('/') : '';
  const home = '$HOME/.claude';
  if (s.hooks === undefined) s.hooks = {};
  if (!isObject(s.hooks)) throw new Error('hooks가 객체가 아닙니다');
  const added = [];
  for (const e of events) {
    if (!kit[e] || !ADDABLE_HOOKS.includes(e)) throw new Error(`모르는 이벤트: ${e}`);
    if (s.hooks[e] === undefined) s.hooks[e] = [];
    const a = s.hooks[e];
    if (!Array.isArray(a)) throw new Error(`hooks.${e}가 배열이 아닙니다`);
    const have = new Set(settingsHookCommands(a).map((x) => hookIdOf(x && x.command)).filter(Boolean));
    const add = [];
    for (const g of JSON.parse(JSON.stringify(kit[e]))) {
      const missing = (g.hooks || []).filter((x) => !have.has(hookIdOf(x.command)));
      if (!missing.length) continue;
      for (const x of missing) if (d) x.command = x.command.split(home).join(d);
      add.push({ ...g, hooks: missing });
    }
    if (!add.length) {
      log(`이미 있음: ${e}`);
      continue;
    }
    a.push(...add);
    added.push(e);
    log(`더함: ${e}`);
  }
  return added;
}

function addHooks(file, kitFile, events) {
  const st = openSettings(file);
  const added = applyKitHooks(st.s, readJson(kitFile).hooks, events, (m) => console.log(m));
  if (added.length) saveSettings(st);
}

// 지정한 이벤트에서 이 키트의 훅 명령만 빼고 센 개수를 돌려준다.
// only를 주면 HOOK_IDS의 그 훅 하나만 뺀다.
function dropKitHooks(s, events, only = null) {
  for (const e of events) if (!KIT_HOOKS[e]) throw new Error(`모르는 이벤트: ${e}`);
  let n = 0;
  const H = isObject(s.hooks) ? s.hooks : null;
  for (const e of Object.keys(KIT_HOOKS).filter((x) => events.includes(x))) {
    const a = H && H[e];
    if (!Array.isArray(a)) continue;
    const hit = new Set();
    for (const g of a) {
      if (!(g && Array.isArray(g.hooks))) continue;
      const match = only ? HOOK_IDS[only] : KIT_HOOKS[e];
      const kept = g.hooks.filter((x) => !match(String(x && x.command || '')));
      if (kept.length < g.hooks.length) {
        n += g.hooks.length - kept.length;
        g.hooks = kept;
        hit.add(g);
      }
    }
    H[e] = a.filter((g) => !(hit.has(g) && g.hooks.length === 0));
    if (!H[e].length) delete H[e];
  }
  if (H && !Object.keys(H).length) delete s.hooks;
  return n;
}

function removeHooks(file, events) {
  for (const e of events) if (!KIT_HOOKS[e]) throw new Error(`모르는 이벤트: ${e}`);
  const st = openSettings(file, { mustExist: true });
  const n = dropKitHooks(st.s, events);
  if (n) saveSettings(st);
  console.log(`뺀 명령: ${n}개`);
}

// 개인용이면 commit, merge, rebase, push 확인이 빠진 personal 목록을, 회사용이면 전체 목록을 쓴다. 이미 있는 항목은 건드리지 않고 더하기만 한다.
function gitAskList(kitJson, profile) {
  const list = profile === 'personal' ? kitJson.personal?.permissions?.ask : kitJson.permissions?.ask;
  if (!Array.isArray(list)) throw new Error(`git 권한 파일에 ${profile === 'personal' ? 'personal.permissions.ask' : 'permissions.ask'}가 없습니다`);
  return list;
}

// 거절한 항목(gitAskDeclined)은 회사용만 지킨다. 개인용은 그 키를 쓰지 않는다.
function gitAskTodo(s, kitJson, config, profile) {
  const kit = gitAskList(kitJson, profile);
  const declined = profile === 'company' && Array.isArray(config.gitAskDeclined) ? config.gitAskDeclined : [];
  if (s.permissions === undefined) s.permissions = {};
  const pm = s.permissions;
  if (!isObject(pm)) throw new Error('permissions가 객체가 아닙니다');
  if (pm.ask === undefined) pm.ask = [];
  if (!Array.isArray(pm.ask)) throw new Error('permissions.ask가 배열이 아닙니다');
  return { pm, todo: kit.filter((x) => !pm.ask.includes(x) && !declined.includes(x)) };
}

// 개인용인데 전역 permissions.ask에 남은 commit, merge, rebase, push 확인이다. update와 set-profile이 같은 식으로 찾아 보인다.
function keptCommitAsksOf(pm) {
  return Array.isArray(pm?.ask) ? pm.ask.filter((x) => /\bgit (\* )?(commit|merge|rebase|push)\b/.test(x)) : [];
}

function mergeGitAsk(file, kitFile, configFile, mode) {
  const st = openSettings(file);
  const { s } = st;
  let cf = {};
  try {
    cf = readJson(configFile);
  } catch {
    // 설정 파일이 없거나 깨졌으면 넣지 않기로 한 항목이 없고 회사용인 것으로 본다.
  }
  const { pm, todo } = gitAskTodo(s, readJson(kitFile), cf, profileOf(cf));
  const allow = Array.isArray(pm.allow) ? pm.allow : [];
  if (mode === 'check') {
    for (const x of todo) if (allow.includes(x)) console.log(`allow에도 있음: ${x}`);
    console.log(`더할 항목: ${todo.length}개`);
  } else if (todo.length) {
    pm.ask.push(...todo);
    saveSettings(st);
    console.log(`더함: ${todo.length}개`);
  } else {
    console.log('더할 항목 없음');
  }
}

// 경로 비교용. 윈도우는 대소문자를 가리지 않고, 셸이 풀지 않은 ~도 홈 폴더로 본다(PowerShell).
function comparablePath(e) {
  let q = e.trim();
  if (q === '~' || q.startsWith('~/') || q.startsWith('~\\')) q = os.homedir() + q.slice(1);
  q = path.resolve(q);
  return process.platform === 'win32' ? q.toLowerCase() : q;
}

function removeAgentMeter(file, dir) {
  const st = openSettings(file);
  const { f, s } = st;
  const t = comparablePath(dir);
  const env = s.env;
  if (!isObject(env)) return console.log('뺄 것 없음: env가 없다');
  const all = String(env.CLAUDE_CODE_PLUGIN_DIRS || '').split(path.delimiter).filter(Boolean);
  const keep = all.filter((e) => comparablePath(e) !== t);
  const old = env.AGENT_METER_KEEPALIVE;
  const hasKey = 'AGENT_METER_KEEPALIVE' in env;
  if (keep.length === all.length && !hasKey) return console.log('뺄 것 없음: agent-meter 경로도 AGENT_METER_KEEPALIVE도 없다');
  console.log(`뺀 경로: ${all.length - keep.length}개`);
  const off = ['0', 'false', 'off'].includes(String(old).trim().toLowerCase());
  console.log(`예전 keep-alive 값: ${hasKey ? `${off ? '끔' : '켬'} ("${old}")` : '키 없음(켬)'}`);
  if (keep.length) env.CLAUDE_CODE_PLUGIN_DIRS = keep.join(path.delimiter);
  else delete env.CLAUDE_CODE_PLUGIN_DIRS;
  delete env.AGENT_METER_KEEPALIVE;
  if (!Object.keys(env).length) delete s.env;
  const b = freePath(`${f}.bak-agent-meter-${stamp()}`);
  fs.copyFileSync(f, b);
  console.log(`백업: ${b}`);
  saveSettings(st);
}

function moveAgentMeter(dir) {
  if (!fs.existsSync(dir)) return console.log('옮길 폴더 없음');
  const b = freePath(path.join(path.dirname(path.dirname(dir)), `agent-meter-backup-${stamp()}`));
  fs.renameSync(dir, b);
  console.log(`옮김: ${b}`);
}

function backupFile(file, name) {
  const b = freePath(`${file}.bak-${name}-${stamp()}`);
  fs.copyFileSync(file, b);
  console.log(b);
}

function checkJson(files) {
  for (const f of files) {
    try {
      readJson(f);
    } catch (e) {
      throw new Error(`${f}: ${e.message}`);
    }
  }
}

// ---- 개인용과 회사용 ----

// 개인용과 회사용의 판정은 kitProfile.js가 원본이다. 여기서는 설정 키의 기본값(PROFILES)을 채우고, 옛 판정 키를 지운다.
const OBSOLETE_CONFIG_KEYS = ['goalMethodDeclined', 'checklistDeclined'];

// 권한과 보호 스위치다. 원칙은 「명령은 보호를 느슨하게 바꾸지 않는다」이다. 키트의 어떤 명령(install, update, set-profile, --config-unset)도 이 키를 느슨한 쪽으로 바꾸지 않고, 푸는 것은 사용자가 답한 뒤 --config-set으로만 한다.
// 조이는 쪽은 명령이 한다: 회사용으로 가는 set-profile과 다른 profile로 다시 돌린 install은 retroWriteAllow를 끄고 retro-write-allow 훅 등록을 빼며 retroMode를 ask로 하고 notes로 알린다. commitCheck는 사용자 커밋에 걸리는 장치라 어느 쪽으로도 바꾸지 않고 notes로만 알린다.
// 키가 없으면 안전한 쪽으로 읽힌다: retroWriteAllow는 허용 안 함(훅이 true일 때만 허용), commitCheck는 검사(commit-msg 훅이 off일 때만 건너뜀), retroMode는 ask.
// 까닭: 보호를 푸는 것은 사용자 승인 몫이고 조이는 것은 승인이 필요 없는데, 둘을 가르지 않고 조합마다 따로 막으면 조합 막음이 회차마다 새로 나왔다(12회차: 끊긴 처음 설치를 회사용으로 다시 돌리면 쓰기 허용이 소리 없이 남음).
const PROTECTED_SWITCHES = ['retroWriteAllow', 'commitCheck'];

// config에 남은 옛 판정 키를 지우고 지운 키 이름을 돌려준다. 값은 읽지 않는다(profile이 정함).
function dropRetiredKeys(next, changes) {
  const dropped = RETIRED_POLICY_KEYS.filter((k) => k in next);
  for (const k of dropped) {
    changes.push(`${k}: 지움(profile이 정함)`);
    delete next[k];
  }
  return dropped;
}

const retiredNote = (dropped, profile) => `옛 설정 키 ${dropped.join(', ')}를 config.json에서 지웠습니다. 무엇을 묻고 바로 고칠지는 이제 profile(${profile})이 정하고 키 값은 읽지 않습니다`;

function requireProfile(name) {
  if (!PROFILES[name]) throw new Error(`profile은 personal 또는 company여야 합니다: ${name}`);
  return name;
}

// 설정을 profile과 맞춘다. 없는 키는 기본값으로 채우고, 개인용인데 retroMode가 auto가 아니면 auto로 고친다.
// 이미 다른 profile이 적힌 설정(VERSION이 없는 끊긴 처음 설치를 다른 profile로 다시 돌림)은 switchProfile과 같은 규칙으로 먼저 옮긴다: 조이는 쪽은 하고 느슨한 쪽은 두고 notes로 알린다.
// 권한과 보호 스위치(PROTECTED_SWITCHES)는 처음 설치(freshInstall)에서만 profile의 기본값으로 채운다.
// 업데이트로 키가 없을 때는 안전한 쪽으로 채운다: retroWriteAllow는 false, commitCheck는 commit-msg 훅이 깔려 있으면 block(키가 없을 때 훅이 이미 검사하므로 지금 동작을 지킴)이고 훅이 없으면 기본값이다.
// 켜는 것은 업데이트 절차(APPLY_GUIDE 6단계)가 사용자에게 묻고 --config-set으로 한다.
// tightened에 든 키는 값을 조였다는 뜻이고, retroWriteAllow가 들면 호출한 쪽이 settings.json의 훅 등록을 뺀다.
function reconcileConfig(config, profile, { freshInstall = false, commitHookInstalled = false } = {}) {
  let next = { ...config };
  const changes = [];
  const notes = [];
  const retired = [];
  let tightened = [];
  if (PROFILES[config.profile] && config.profile !== profile) {
    const sw = switchProfile(config, profile);
    next = { ...sw.next };
    changes.push(...sw.changes);
    notes.push(...sw.notes);
    retired.push(...sw.retired);
    tightened = sw.tightened;
  }
  const set = (k, v) => {
    if (JSON.stringify(next[k]) !== JSON.stringify(v)) {
      changes.push(`${k}: ${k in next ? JSON.stringify(next[k]) : '없음'} -> ${JSON.stringify(v)}`);
      next[k] = v;
    }
  };
  const safeFill = (k, v) => {
    if (freshInstall) return v;
    if (k === 'retroWriteAllow') return false;
    if (k === 'commitCheck' && commitHookInstalled) return 'block';
    return v;
  };
  set('profile', profile);
  for (const [k, v] of Object.entries(PROFILES[profile])) if (!(k in next)) set(k, PROTECTED_SWITCHES.includes(k) ? safeFill(k, v) : v);
  if (profile === 'personal') set('retroMode', 'auto');
  retired.push(...dropRetiredKeys(next, changes));
  for (const k of OBSOLETE_CONFIG_KEYS) if (k in next) {
    changes.push(`${k}: 지움`);
    delete next[k];
  }
  if (profile === 'personal' && 'gitAskDeclined' in next) {
    changes.push('gitAskDeclined: 지움(회사용만 씀)');
    delete next.gitAskDeclined;
  }
  return { next, changes, retired, notes, tightened };
}

// 권한과 보호 스위치(retroWriteAllow, commitCheck와 이 둘이 거는 훅)는 키트의 어떤 명령도 느슨한 쪽으로 바꾸지 않는다. 푸는 것은 사용자가 답한 뒤 --config-set으로만 한다. 조이는 쪽은 이 명령이 한다.
// 까닭: 보호를 푸는 것은 사용자 승인 몫이고 조이는 것은 승인이 필요 없다. 회사용으로 가면서 쓰기 허용이 남으면 회사용 표(확인 창이 뜸)와 어긋난다.
// 이 명령이 바꾸는 것은 profile, retroMode(회고를 언제 누가 돌리나, 묻기 판정 쪽), 회사용으로 갈 때의 retroWriteAllow(true면 false로)다. retroMode는 이전 profile의 기본값 그대로일 때만 새 기본값으로 바꾸고 따로 정한 값은 둔다.
// profile이 없던 설치(업데이트 전)는 이전 profile을 모르므로, 어느 profile의 기본값과든 같은 값은 따로 정한 값이 아니라고 본다.
// 그 밖에 권한 스위치 값이 새 profile의 기본값과 다르면 두고 notes로 알린다. 없는 키는 안전한 쪽으로 읽히므로(PROTECTED_SWITCHES) 만들지 않는다.
// tightened에 retroWriteAllow가 들면 호출한 쪽이 settings.json의 retro-write-allow 훅 등록을 뺀다.
function switchProfile(config, to) {
  const from = PROFILES[config.profile] ? config.profile : null;
  const next = { ...config, profile: to };
  const changes = [];
  const notes = [];
  const tightened = [];
  if (config.profile !== to) changes.push(`profile: ${config.profile ?? '없음'} -> ${to}`);
  const sameAs = (k, v) => JSON.stringify(next[k]) === JSON.stringify(v);
  const wasDefault = (k) => (from ? sameAs(k, PROFILES[from][k]) : Object.values(PROFILES).some((p) => sameAs(k, p[k])));
  if (!('retroMode' in next) || wasDefault('retroMode')) {
    const v = PROFILES[to].retroMode;
    if (!sameAs('retroMode', v)) changes.push(`retroMode: ${'retroMode' in next ? JSON.stringify(next.retroMode) : '없음'} -> ${JSON.stringify(v)}`);
    next.retroMode = v;
  }
  if (to === 'personal' && next.retroMode !== 'auto') {
    changes.push(`retroMode: ${JSON.stringify(next.retroMode)} -> "auto"`);
    next.retroMode = 'auto';
  }
  if (to === 'company' && next.retroWriteAllow === true) {
    changes.push('retroWriteAllow: true -> false');
    next.retroWriteAllow = false;
    tightened.push('retroWriteAllow');
    notes.push('retroWriteAllow는 true에서 false로 껐고 settings.json의 retro-write-allow 훅 등록도 함께 뺍니다(company는 쓰기 허용을 두지 않음). 보호를 조이는 쪽이라 명령이 바꿉니다. 다시 켜려면 사용자에게 묻고 --config-set으로 합니다');
  }
  for (const k of PROTECTED_SWITCHES) {
    if (k in next && !tightened.includes(k) && !sameAs(k, PROFILES[to][k])) {
      notes.push(`${k}는 ${JSON.stringify(next[k])} 그대로 뒀습니다(${to}의 기본값은 ${JSON.stringify(PROFILES[to][k])}). 보호를 느슨하게 하는 변경과 사용자 커밋에 걸리는 장치는 명령이 바꾸지 않습니다. 바꾸려면 사용자에게 묻고 --config-set으로 합니다`);
    }
  }
  const retired = dropRetiredKeys(next, changes);
  return { next, changes, retired, notes, tightened };
}

function setProfileFile(file, to) {
  requireProfile(to);
  const { next, changes, retired, notes, tightened } = switchProfile(readJson(file), to);
  // settings.json을 먼저 열어 깨졌으면 config.json도 바꾸지 않는다(--config-set과 같음).
  const hook = tightened.includes('retroWriteAllow') ? syncWriteAllowHook(file, false) : null;
  if (changes.length) writeJson(file, next);
  if (hook?.note) notes.push(hook.note);
  return { changes, retired, notes, hook };
}

// ---- 설치, 업데이트, 제거 ----

const KIT_VERSION_RE = /^\d{4}\.\d+\.\d+(\.\d+)?$/;
const COMMAND_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DOCS_MERGED = ['SUBAGENT_GUIDE.md', 'SUBAGENT_SITUATIONS.md', 'RETRO.md', 'AUTO_RETRO.md', 'SUBAGENT_BRIEF_CHECKLIST.md', 'TESTING.md', 'DOC_WRITING.md'];
const MIGRATED_RULES_FILE = 'MIGRATED_USER_RULES.md';

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const normEol = (t) => t.replace(/\r\n/g, '\n');
const slash = (p) => p.split(path.sep).join('/');
const camel = (flag) => flag.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

function versionParts(v) {
  if (!KIT_VERSION_RE.test(v)) throw new Error(`VERSION 꼴이 아닙니다: ${v}`);
  const p = v.split('.').map(Number);
  return [p[0], p[1], p[2], p[3] ?? 1];
}

function compareVersions(a, b) {
  const x = versionParts(a);
  const y = versionParts(b);
  for (let i = 0; i < 4; i += 1) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

// 선택 훅. 고른 것만 파일을 놓고, commit-msg는 저장소마다 사용자가 core.hooksPath를 걸어야 해서 놓고 안내만 한다.
// brief-check는 목표 줄이 빠진 지시문을 기계로 막는 꼭 필요한 훅이라 선택이 아니라 늘 놓고 settings.json에도 건다. 옛 설치 명령의 --hooks brief-check는 받아서 무시한다.
const OPTIONAL_HOOKS = { 'commit-msg': 'git/commit-msg' };
const ALWAYS_INSTALLED_HOOKS = ['brief-check'];
const ALWAYS_HOOK_NOTE = 'brief-check 훅은 늘 설치되므로 --hooks에서 뺐습니다';

// --hooks 목록에서 늘 설치되는 훅 이름을 걸러 낸다. 옛 설치 명령이 깨지지 않게 하려고 오류 대신 note로 알린다.
function splitAlwaysHooks(listed) {
  const rest = listed.filter((n) => !ALWAYS_INSTALLED_HOOKS.includes(n));
  return { rest, notes: rest.length < listed.length ? [ALWAYS_HOOK_NOTE] : [] };
}
const EXECUTABLE_KEYS = new Set(['subagent-system/hooks/git/commit-msg']);

function listFiles(dir, rel = '') {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => {
    if (e.name.startsWith('.') || e.name === 'node_modules') return [];
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) return listFiles(dir, r);
    return e.isFile() ? [r] : [];
  }).sort();
}

function parseOptions(args) {
  const valueOpts = ['--kit', '--profile', '--rules', '--skills', '--hooks', '--command-name', '--roles', '--records'];
  const boolOpts = ['--dry-run', '--git-ask', '--no-git-ask', '--allow-older'];
  const o = { positional: [] };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (valueOpts.includes(a)) {
      if (args[i + 1] === undefined) throw new Error(`${a}의 값이 없습니다`);
      o[camel(a)] = args[i + 1];
      i += 1;
    } else if (boolOpts.includes(a)) o[camel(a)] = true;
    else if (a.startsWith('--')) throw new Error(`모르는 옵션: ${a}`);
    else o.positional.push(a);
  }
  return o;
}

const splitList = (v) => (v === undefined ? [] : String(v).split(',').map((x) => x.trim()).filter(Boolean));

function makeContext(opts) {
  const cfg = configDir();
  const kit = path.resolve(opts.kit ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const kitSub = path.join(kit, 'subagent-system');
  if (!fs.existsSync(path.join(kitSub, 'VERSION'))) throw new Error(`키트 폴더가 아닙니다(subagent-system/VERSION이 없음): ${kit}. 키트 폴더에서 돌리거나 --kit으로 알려 주세요`);
  if (path.resolve(kit) === cfg) throw new Error('설치본의 스크립트를 키트로 쓸 수 없습니다. 키트 폴더에서 돌리거나 --kit으로 키트 폴더를 알려 주세요');
  return { kit, kitSub, cfg, sub: path.join(cfg, 'subagent-system'), dry: Boolean(opts.dryRun), stampStr: stamp(), report: {} };
}

function writeFile(ctx, file, text) {
  if (ctx.dry) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

// git이 실행하는 훅 파일은 실행 권한이 있어야 한다.
function markExecutable(ctx, e) {
  if (e.exec && !ctx.dry && process.platform !== 'win32') fs.chmodSync(e.dest, 0o755);
}

function backupBeside(ctx, file, name) {
  const b = freePath(`${file}.bak-${name}-${ctx.stampStr}`);
  if (!ctx.dry) fs.copyFileSync(file, b);
  return b;
}

function readConfig(ctx) {
  const file = path.join(ctx.sub, 'config.json');
  const text = readText(file);
  if (text === null) return { file, exists: false, config: {} };
  const config = JSON.parse(text);
  if (!isObject(config)) throw new Error('config.json 최상위가 객체가 아닙니다');
  return { file, exists: true, config };
}

// CLAUDE_CONFIG_DIR을 쓰는 컴퓨터는 문서, 정의, 스킬 글의 ~/.claude와 $HOME/.claude를 그 폴더로 바꿔 놓는다. 스크립트는 바꾸지 않는다.
function adaptText(ctx, key, text) {
  if (!process.env.CLAUDE_CONFIG_DIR || key.endsWith('.js')) return text;
  const dir = slash(ctx.cfg);
  return text.split('$HOME/.claude').join(dir).split('~/.claude').join(dir);
}

function chosenNames(listed, available, what, prefix = '') {
  return listed.map((n) => {
    const name = available.find((a) => a === n || a === `${prefix}${n}`);
    if (!name) throw new Error(`키트에 없는 ${what}: ${n}`);
    return name;
  });
}

// 규칙이 주제별로 나뉘기 전 이름 recommended는 kit-rec-* 파일 전부로 푼다.
function chosenRules(listed, files) {
  const available = files.map((f) => f.replace(/\.md$/, ''));
  const expanded = listed.flatMap((n) => (n === 'recommended' && !available.includes('kit-recommended') ? available.filter((a) => a.startsWith('kit-rec-')) : [n]));
  return chosenNames([...new Set(expanded)], available, '규칙', 'kit-').map((n) => `${n}.md`);
}

// 설치해 둔 파일이 있는 선택 항목만 업데이트가 갱신한다. 고르지 않은 항목(unchosen)과 키트에 새로 생긴 항목(added)은 나눠 낸다.
// 새것은 config.json의 knownOptional(설치와 업데이트 때 본 키트의 선택 항목 목록)에 없던 것이다.
// 목록이 없는 옛 설치는 첫 업데이트에서 고르지 않은 것을 모두 「고르지 않음」으로 보고 새것으로 알리지 않는다(옛 설치 때 무엇이 새것이었는지 알 수 없어서).
function selectOptional(ctx, mode, opts, config) {
  const rulesAll = fs.readdirSync(path.join(ctx.kitSub, 'rules')).filter((f) => f.endsWith('.md')).sort();
  const skillsAll = fs.readdirSync(path.join(ctx.kitSub, 'skills'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  const command = config.commandName ?? 'retro';
  const rulesOptional = rulesAll.filter((f) => f !== 'kit-core.md');
  const skillsOptional = skillsAll.filter((n) => n !== 'retro');
  const hooksOptional = Object.keys(OPTIONAL_HOOKS);
  const notes = [];
  let rules;
  let skills;
  let hooks;
  if (mode === 'install') {
    rules = chosenRules(splitList(opts.rules), rulesOptional);
    skills = chosenNames(splitList(opts.skills), skillsOptional, '스킬');
    const listedHooks = splitAlwaysHooks(splitList(opts.hooks));
    notes.push(...listedHooks.notes);
    hooks = chosenNames(listedHooks.rest, hooksOptional, '훅');
  } else {
    const legacyRecommended = !rulesAll.includes('kit-recommended.md') && fs.existsSync(path.join(ctx.cfg, 'rules', 'kit-recommended.md'));
    rules = rulesOptional.filter((f) => fs.existsSync(path.join(ctx.cfg, 'rules', f)) || (legacyRecommended && f.startsWith('kit-rec-')));
    skills = skillsOptional.filter((n) => fs.existsSync(path.join(ctx.cfg, 'skills', n, 'SKILL.md')) && fs.existsSync(path.join(ctx.sub, '.kit-base', 'skills', n, 'SKILL.md')));
    hooks = hooksOptional.filter((n) => fs.existsSync(path.join(ctx.sub, 'hooks', ...OPTIONAL_HOOKS[n].split('/'))));
  }
  const known = mode === 'update' && isObject(config.knownOptional) ? config.knownOptional : null;
  const isNew = (kind, n) => known !== null && !(Array.isArray(known[kind]) && known[kind].includes(n));
  const unchosen = { rules: rulesOptional.filter((f) => !rules.includes(f)), skills: skillsOptional.filter((n) => !skills.includes(n)), hooks: hooksOptional.filter((n) => !hooks.includes(n)) };
  const added = {};
  const rest = {};
  for (const kind of Object.keys(unchosen)) {
    added[kind] = unchosen[kind].filter((n) => isNew(kind, n));
    rest[kind] = unchosen[kind].filter((n) => !isNew(kind, n));
  }
  return {
    rules: ['kit-core.md', ...rules],
    skills: ['retro', ...skills],
    hooks,
    command,
    notes,
    available: added,
    unchosen: rest,
    knownOptional: { rules: rulesOptional, skills: skillsOptional, hooks: hooksOptional },
  };
}

function buildEntries(ctx, sel, removedDefs) {
  const out = [];
  // render는 키트 원문을 설치본에 놓는 글로 바꾸는 변환이다. git에서 꺼낸 옛 키트 원문도 같은 변환을 거쳐야 설치본과 비교된다.
  const add = (key, kind, src, post = (text) => text) => {
    const render = (raw) => post(adaptText(ctx, key, raw));
    const srcKey = path.relative(ctx.kit, src).split(path.sep).join('/');
    out.push({ key, kind, exec: EXECUTABLE_KEYS.has(key), dest: path.join(ctx.cfg, ...key.split('/')), src: srcKey, render, text: render(fs.readFileSync(src, 'utf8')) });
  };
  for (const f of DOCS_MERGED) if (fs.existsSync(path.join(ctx.kitSub, 'docs', f))) add(`subagent-system/docs/${f}`, 'merge', path.join(ctx.kitSub, 'docs', f));
  if (fs.existsSync(path.join(ctx.kitSub, 'docs', 'ROUTING_TABLE.md'))) add('subagent-system/docs/ROUTING_TABLE.md', 'once', path.join(ctx.kitSub, 'docs', 'ROUTING_TABLE.md'));
  for (const f of listFiles(path.join(ctx.kitSub, 'scripts'))) add(`subagent-system/scripts/${f}`, 'code', path.join(ctx.kitSub, 'scripts', f));
  const chosenHookFiles = new Set(sel.hooks.map((n) => OPTIONAL_HOOKS[n]));
  const optionalHookFiles = new Set(Object.values(OPTIONAL_HOOKS));
  for (const f of listFiles(path.join(ctx.kitSub, 'hooks'))) {
    if (optionalHookFiles.has(f) && !chosenHookFiles.has(f)) continue;
    add(`subagent-system/hooks/${f}`, 'code', path.join(ctx.kitSub, 'hooks', f));
  }
  if (fs.existsSync(path.join(ctx.kitSub, 'rates.json'))) add('subagent-system/rates.json', 'rates', path.join(ctx.kitSub, 'rates.json'));
  for (const f of listFiles(path.join(ctx.kitSub, 'agents'))) {
    if (f.endsWith('.md') && !removedDefs.includes(f.replace(/\.md$/, ''))) add(`agents/${f}`, 'merge', path.join(ctx.kitSub, 'agents', f));
  }
  for (const f of sel.rules) add(`rules/${f}`, 'merge', path.join(ctx.kitSub, 'rules', f));
  for (const n of sel.skills) {
    for (const f of listFiles(path.join(ctx.kitSub, 'skills', n))) {
      const renamed = n === 'retro' && f === 'SKILL.md' ? (text) => text.replace(/^name: .*$/m, `name: ${sel.command}`) : undefined;
      add(`skills/${n === 'retro' ? sel.command : n}/${f}`, 'merge', path.join(ctx.kitSub, 'skills', n, f), renamed);
    }
  }
  return out;
}

function runGit(ctx, args) {
  const r = spawnSync('git', ['-C', ctx.kit, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  return r.error || r.status !== 0 ? null : r.stdout;
}

// .kit-base가 없는 옛 설치본의 기준본을 찾는다. 키트가 git 저장소이면 설치본 VERSION과 같은 VERSION을 가진 키트 커밋(VERSION을 바꾼 커밋 가운데 가장 새것)을 쓴다.
// git이 없거나 저장소가 아니거나 같은 VERSION의 커밋이 없으면 null이고, 호출한 쪽은 기록 해시 대조 뒤 2방향 병합으로 간다.
function findKitCommit(ctx) {
  if (ctx.kitCommit !== undefined) return ctx.kitCommit;
  ctx.kitCommit = null;
  if (!ctx.installedVersion) return null;
  const prefix = runGit(ctx, ['rev-parse', '--show-prefix']);
  if (prefix === null) return null;
  const versionPath = `${prefix.trim()}subagent-system/VERSION`;
  const log = runGit(ctx, ['log', '--format=%H', '-n', '300', '--', versionPath]);
  for (const hash of (log ?? '').split('\n').filter(Boolean)) {
    if (runGit(ctx, ['show', `${hash}:${versionPath}`])?.trim() === ctx.installedVersion) {
      ctx.kitCommit = { hash, prefix: prefix.trim() };
      break;
    }
  }
  return ctx.kitCommit;
}

function gitBaseText(ctx, e) {
  const c = findKitCommit(ctx);
  if (!c) return null;
  const raw = runGit(ctx, ['show', `${c.hash}:${c.prefix}${e.src}`]);
  return raw === null ? null : e.render(raw);
}

function planCode({ key, installed, base, next, recorded }) {
  if (normEol(installed) === normEol(next)) return { status: 'unchanged', text: installed, reason: 'same-as-next' };
  if (base !== null && normEol(installed) === normEol(base)) return { status: 'replaced', text: next, reason: 'base-equal' };
  if (base === null && typeof recorded?.[key] === 'string' && recorded[key] === legacyHashOf(key, installed)) return { status: 'replaced', text: next, reason: 'hash-equal' };
  return { status: 'overwritten-modified', text: next, reason: base === null ? 'no-base' : 'base-differs' };
}

// rates.json은 설치본 값을 지키고 키트에만 있는 모델 키를 더한다. 값이 다른 모델은 바꾸지 않고 알린다.
function planRates({ installed, next }) {
  let i;
  let k;
  try {
    i = JSON.parse(installed);
    k = JSON.parse(next);
  } catch {
    return { status: 'kept', reason: 'invalid-json' };
  }
  const added = [];
  const differs = [];
  for (const key of Object.keys(k)) {
    if (!(key in i)) {
      i[key] = k[key];
      added.push(key);
    } else if (!key.startsWith('_') && JSON.stringify(i[key]) !== JSON.stringify(k[key])) differs.push(key);
  }
  if (added.length && typeof k._checked === 'string' && !(typeof i._checked === 'string' && i._checked >= k._checked)) i._checked = k._checked;
  if (!added.length) return { status: 'kept', reason: differs.length ? 'values-differ' : 'same', differs };
  return { status: 'merged', text: `${JSON.stringify(i, null, 2)}\n`, reason: 'models-added', added, differs };
}

function syncEntry(ctx, e, recorded, forceBackup) {
  const baseFile = path.join(ctx.sub, '.kit-base', ...e.key.split('/'));
  const installed = readText(e.dest);
  let base = readText(baseFile);
  const out = { key: e.key };
  if (base === null && installed !== null && (e.kind === 'merge' || e.kind === 'code')) {
    base = gitBaseText(ctx, e);
    if (base !== null) out.baseFrom = `git:${findKitCommit(ctx).hash.slice(0, 7)}`;
  }
  let write = null;
  let backup = false;
  let writeBase = e.kind === 'merge' || e.kind === 'code';
  if (installed === null) {
    write = e.text;
    out.status = 'added';
  } else if (e.kind === 'once') {
    out.status = 'kept';
  } else if (e.kind === 'rates') {
    const p = planRates({ installed, next: e.text });
    out.status = p.status;
    out.reason = p.reason;
    if (p.added) out.added = p.added;
    if (p.differs?.length) out.differs = p.differs;
    if (p.status === 'merged') {
      write = p.text;
      backup = true;
    }
  } else {
    const p = e.kind === 'merge'
      ? planKitFileUpdate({ key: e.key, installed, base, next: e.text, recordedHashes: recorded })
      : planCode({ key: e.key, installed, base, next: e.text, recorded });
    out.status = p.status;
    out.reason = p.reason;
    if (p.status === 'unresolved-markers') writeBase = false;
    else if (p.status !== 'unchanged') {
      write = p.text;
      backup = ['merged', 'conflict', 'overwritten-modified'].includes(p.status);
      if (p.reason === 'hash-equal' && recorded[e.key] !== sha256(installed)) backup = true;
    }
    if (p.conflicts?.length) out.conflicts = p.conflicts.length;
  }
  if (forceBackup && installed !== null) backup = true;
  if (backup && installed !== null) out.backup = backupBeside(ctx, e.dest, 'update');
  if (write !== null && write !== installed) {
    writeFile(ctx, e.dest, write);
    markExecutable(ctx, e);
  }
  if (writeBase && base !== e.text) writeFile(ctx, baseFile, e.text);
  return out;
}

// 키트에서 빠진 스크립트와 훅 파일은 설치본이 손대지 않은 것만 지운다.
function dropOrphans(ctx, entries, recorded, report) {
  const keys = new Set(entries.map((e) => e.key));
  const baseRoot = path.join(ctx.sub, '.kit-base');
  const candidates = new Set([...listFiles(baseRoot), ...Object.keys(recorded ?? {}).filter((k) => /^subagent-system\/scripts\//.test(k))]);
  for (const key of candidates) {
    if (keys.has(key)) continue;
    const inKit = key.startsWith('subagent-system/') ? path.join(ctx.kit, key) : path.join(ctx.kitSub, key);
    if (fs.existsSync(inKit)) continue;
    const dest = path.join(ctx.cfg, ...key.split('/'));
    const installed = readText(dest);
    const base = readText(path.join(baseRoot, ...key.split('/')));
    if (installed !== null) {
      const same = base !== null ? normEol(installed) === normEol(base) : typeof recorded?.[key] === 'string' && recorded[key] === legacyHashOf(key, installed);
      if (!same) {
        report.orphansKept.push(key);
        continue;
      }
      if (!ctx.dry) fs.rmSync(dest);
      report.orphansRemoved.push(key);
    }
    if (!ctx.dry && base !== null) fs.rmSync(path.join(baseRoot, ...key.split('/')));
  }
}

// 끊긴 처음 설치를 다른 선택으로 다시 돌리면 앞 설치가 놓은 선택 항목이 남는다. 키트가 놓은 그대로(.kit-base와 같음)면 지우고, 고쳤거나 키트가 놓지 않은 같은 이름이면 두고 알린다.
// 까닭: 남은 규칙은 「안 깔림」 보고와 달리 세션마다 읽히고, 다음 update는 디스크에 있는 것을 설치된 것으로 센다(22회차).
function dropUnchosen(ctx, unchosen, report) {
  const keys = [
    ...unchosen.rules.map((f) => `rules/${f}`),
    ...unchosen.skills.flatMap((n) => listFiles(path.join(ctx.kitSub, 'skills', n)).map((f) => `skills/${n}/${f}`)),
    ...unchosen.hooks.map((n) => `subagent-system/hooks/${OPTIONAL_HOOKS[n]}`),
  ];
  const removed = [];
  const kept = [];
  for (const key of keys) {
    const dest = path.join(ctx.cfg, ...key.split('/'));
    const installed = readText(dest);
    if (installed === null) continue;
    const basePath = path.join(ctx.sub, '.kit-base', ...key.split('/'));
    const base = readText(basePath);
    if (base === null || normEol(installed) !== normEol(base)) {
      kept.push(key);
      continue;
    }
    if (!ctx.dry) {
      fs.rmSync(dest);
      fs.rmSync(basePath);
    }
    removed.push(key);
  }
  if (!ctx.dry) {
    for (const n of unchosen.skills) {
      const dir = path.join(ctx.cfg, 'skills', n);
      if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    }
  }
  if (removed.length) report.unchosenRemoved = removed;
  if (kept.length) {
    report.unchosenKept = kept;
    report.notes.push(`고르지 않았지만 이미 있는 파일 ${kept.length}개를 두었습니다(앞 설치 뒤 고쳤거나 키트가 놓지 않은 같은 이름). 규칙이면 세션마다 읽히고 update는 설치된 것으로 셉니다. 사용자에게 목록을 보이고 뺄지 물으세요`);
  }
}

// 옛 GUIDE의 사용자 구역에 든 표, 무조건 Opus 목록, 사용자 규칙을 새 자리로 옮긴다. GUIDE 교체는 이 뒤에 하므로 끊겨도 다시 돌리면 같은 값을 얻는다.
function migrateGuideZones(ctx) {
  const guide = readText(path.join(ctx.sub, 'docs', 'SUBAGENT_GUIDE.md'));
  if (guide === null) return null;
  const m = migrateLegacyZones(guide);
  if (!m.hasZones) return null;
  const res = { routingTable: 'kit-default', userRules: m.userRules.length, userRulesFile: null };
  const routing = path.join(ctx.sub, 'docs', 'ROUTING_TABLE.md');
  const custom = m.routingTableText && !(m.table.isKitExample && m.unconditionalOpus.isKitExample);
  if (custom) {
    if (fs.existsSync(routing)) res.routingTable = 'kept-existing';
    else {
      writeFile(ctx, routing, m.routingTableText);
      res.routingTable = 'created-from-zones';
    }
  }
  if (m.userRules.length) {
    const file = path.join(ctx.sub, 'docs', MIGRATED_RULES_FILE);
    const old = readText(file);
    const have = old === null ? [] : old.split(/\r?\n/).filter((l) => l.startsWith('- ')).map((l) => l.slice(2));
    const fresh = m.userRules.filter((r) => !have.includes(r));
    const head = '# 옛 GUIDE 「사용자 규칙」 구역에서 옮긴 줄\n\n정책이면 CLAUDE.md로, 방법이면 규칙 파일로 옮긴 뒤 이 파일에서 지웁니다. 업데이트는 이 파일을 건드리지 않습니다.\n\n';
    if (fresh.length) writeFile(ctx, file, (old ?? head).replace(/\n*$/, '\n') + fresh.map((r) => `- ${r}`).join('\n') + '\n');
    res.userRulesFile = file;
  }
  return res;
}

const PROPOSALS_HEAD = `# 일하는 체계 제안 목록

회고가 쌓은 제안과 사용자에게 물을 것을 한곳에 둡니다. \`- 묻기: <값>\` 줄이 있는 항목이 사용자에게 물을 것입니다.
묻기 줄이 없는 항목은 쌓아 두기만 하고, 채택이나 기각이 정해지면 \`- 결과: 채택\` 또는 \`- 결과: 기각\`을 적습니다.

## 제안

## 반대

사용자가 반대 의견을 듣고도 하자고 한 것을 적습니다. 항목은 \`### 제목\`, 반대 내용, 사용자의 결정 순서로 씁니다.
`;
const SPEED_TITLE = /^(속도 개선|측정 요청): /;

// 옛 records/retro-pending.md를 `## 제목` 덩어리로 나눈다. 코드 울타리 안의 `## `는 제목이 아니다.
function parseOldPending(text) {
  const items = [];
  let cur = null;
  let fence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) fence = !fence;
    const m = !fence && /^## (\S.*?)\s*$/.exec(line);
    if (m) {
      cur = { title: m[1], body: [] };
      items.push(cur);
    } else if (cur) cur.body.push(line);
  }
  for (const it of items) {
    while (it.body.length && it.body[0].trim() === '') it.body.shift();
    while (it.body.length && it.body[it.body.length - 1].trim() === '') it.body.pop();
  }
  return items;
}

// 업데이트가 옛 물을 것(records/retro-pending.md)의 항목을 PROPOSALS.md의 `## 제안` 아래 `### `로 옮긴다.
// 속도 개선과 측정 요청 항목은 묻는 일이 아니라 제목만 `###`로 바꾸고, 나머지는 `- 묻기: 정책` 줄을 달아 다음 회고가 사용자에게 묻게 한다. 이미 있는 제목은 다시 넣지 않는다.
// 원본은 옆 백업으로 옮겨 다음 업데이트가 다시 읽지 않게 한다. PROPOSALS.md를 먼저 쓰고 원본을 옮겨, 끊겨도 다시 돌리면 같은 결과다.
function migrateRetroPending(ctx) {
  const pending = path.join(ctx.sub, 'records', 'retro-pending.md');
  const old = readText(pending);
  if (old === null) return null;
  const items = parseOldPending(old);
  if (!items.length) return null;
  const file = path.join(ctx.cfg, 'docs', 'PROPOSALS.md');
  const existing = readText(file);
  const text = existing ?? PROPOSALS_HEAD;
  const have = new Set(text.split(/\r?\n/).filter((l) => l.startsWith('### ')).map((l) => l.slice(4).trim()));
  const blocks = [];
  let skipped = 0;
  for (const it of items) {
    if (have.has(it.title)) {
      skipped += 1;
      continue;
    }
    have.add(it.title);
    const askLine = SPEED_TITLE.test(it.title) || it.body.some((l) => /^\s*[-*]\s*묻기:/.test(l)) ? [] : ['- 묻기: 정책'];
    blocks.push([`### ${it.title}`, ...askLine, ...it.body].join('\n'));
  }
  if (blocks.length) {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    let all = text.split(/\r?\n/);
    let at = all.findIndex((l) => /^## 제안\s*$/.test(l));
    if (at < 0) {
      while (all.length && all[all.length - 1].trim() === '') all.pop();
      all = [...all, '', '## 제안'];
      at = all.length - 1;
    }
    let end = all.findIndex((l, i) => i > at && /^## /.test(l));
    if (end < 0) end = all.length;
    while (end > at + 1 && all[end - 1].trim() === '') end -= 1;
    const tail = all.slice(end);
    const firstTail = tail.findIndex((l) => l.trim() !== '');
    const merged = [...all.slice(0, end), '', ...blocks.join('\n\n').split('\n'), ...(firstTail < 0 ? [] : ['', ...tail.slice(firstTail)])];
    writeFile(ctx, file, `${merged.join(eol).replace(/(\r?\n)*$/, eol)}`);
  }
  const backup = freePath(`${pending}.bak-update-${ctx.stampStr}`);
  if (!ctx.dry) fs.renameSync(pending, backup);
  return { file, created: existing === null && blocks.length > 0, moved: blocks.length, skippedSameTitle: skipped, backup };
}

// commit-msg 훅은 쓸 저장소마다 사용자가 core.hooksPath를 걸어야 켜진다. 전역으로는 걸지 않고 방법만 알린다.
function commitMsgNotes(ctx, config, report) {
  if (config.commitCheck !== 'block') {
    report.notes.push(`commit-msg 훅을 놓았지만 commitCheck가 ${JSON.stringify(config.commitCheck)}이라 걸 방법은 알리지 않습니다. 막으려면 commitCheck를 "block"으로 바꿉니다`);
    return;
  }
  const hooksPath = slash(path.join(ctx.sub, 'hooks', 'git'));
  report.commitMsgHook = { hooksPath, command: `git -C <저장소 폴더> config --local core.hooksPath "${hooksPath}"` };
  report.notes.push('commit-msg 훅은 쓸 저장소마다 사용자가 commitMsgHook.command를 돌려야 켜집니다. 전역으로는 걸지 않았습니다. 이 설정을 걸면 그 저장소의 .git/hooks 훅과 이미 걸린 core.hooksPath(husky 등)는 돌지 않으니 걸기 전에 확인합니다');
}

function syncSettings(ctx, { profile, config, gitAsk, name, report, dropWriteAllow = false }) {
  const file = path.join(ctx.cfg, 'settings.json');
  const st = openSettings(file);
  const kitHooks = readJson(path.join(ctx.kitSub, 'settings-hook.json')).hooks;
  // brief-check와 ask-log는 늘 건다(측정과 막기 장치라서). 사용자가 지운 등록도 update가 다시 다는 점은 다른 키트 훅과 같다.
  // retro-write-allow는 쓰기 확인 창을 없애는 설정이라 retroWriteAllow가 true일 때만 건다.
  const wanted = JSON.parse(JSON.stringify(kitHooks));
  if (config.retroWriteAllow !== true && wanted.PermissionRequest) {
    wanted.PermissionRequest = wanted.PermissionRequest
      .map((g) => ({ ...g, hooks: (g.hooks || []).filter((x) => hookIdOf(x.command) !== 'retro-write-allow') }))
      .filter((g) => g.hooks.length > 0);
  }
  const events = ['SubagentStop', 'PermissionRequest', 'PreToolUse'].filter((e) => e === 'SubagentStop' || (wanted[e] && wanted[e].length));
  const hooksAdded = applyKitHooks(st.s, wanted, events);
  // 다른 profile로 다시 돌린 install이 retroWriteAllow를 조였으면(reconcileConfig) 앞 설치가 건 훅 등록도 뺀다. 값은 꺼졌는데 훅이 남으면 쓰기 허용이 소리 없이 남는다.
  const writeAllowDropped = dropWriteAllow ? dropKitHooks(st.s, ['PermissionRequest'], 'retro-write-allow') : 0;
  const legacyRemoved = dropKitHooks(st.s, ['SessionStart']);
  const hadPermissions = st.s.permissions !== undefined;
  const hadAsk = hadPermissions && st.s.permissions.ask !== undefined;
  const out = { hooksAdded, ...(writeAllowDropped ? { writeAllowHookRemoved: writeAllowDropped } : {}), legacySessionStartRemoved: legacyRemoved, gitAsk: { mode: gitAsk ? 'merge' : 'report-only', added: 0, missing: 0 } };
  const gitFile = path.join(ctx.kit, 'extras', 'git-permissions.json');
  let changed = hooksAdded.length > 0 || legacyRemoved > 0 || writeAllowDropped > 0;
  if (fs.existsSync(gitFile)) {
    const { pm, todo } = gitAskTodo(st.s, readJson(gitFile), config, profile);
    out.gitAsk.missing = todo.length;
    if (gitAsk && todo.length) {
      pm.ask.push(...todo);
      out.gitAsk.added = todo.length;
      changed = true;
    }
    if (profile === 'personal') out.gitAsk.keptCommitAsks = keptCommitAsksOf(pm);
    if (!out.gitAsk.added) {
      if (!hadAsk) delete pm.ask;
      if (!hadPermissions) delete st.s.permissions;
    }
  } else {
    out.gitAsk.mode = 'no-kit-file';
  }
  if (changed) {
    if (st.ex) out.backup = backupBeside(ctx, st.f, name);
    if (!ctx.dry) saveSettings(st);
  }
  report.settings = out;
}

// 기준값과 마다함(claudeMdLimitLines, claudeMdKeptLines)은 이번 실행이 정한 config로 읽고, 합과 판정은 회고와 같은 claudeMdTidy.js의 claudeMdVerdict가 한다.
function claudeMdReport(ctx, config) {
  const { limit, keptLines } = claudeMdSettingsOf(config);
  const a = analyzeClaudeMd({ configDir: ctx.cfg, limit, keptLines });
  return {
    exists: a.exists,
    kitZones: a.zones.map((z) => `${z.name}:${z.status}`),
    zoneEditLines: a.zoneEdits.length,
    loadedLines: a.loaded.total,
    limit: a.loaded.limit,
    overBy: a.loaded.overBy,
    keptLines: a.loaded.keptLines,
    tidyTarget: a.loaded.target,
    tidyReason: a.loaded.reason,
    backupPathIfEdited: a.backupPath,
  };
}

function runSync(mode, rawArgs) {
  const opts = parseOptions(rawArgs);
  if (opts.positional.length) throw new Error(`모르는 인자: ${opts.positional.join(' ')}`);
  if (mode === 'update') {
    for (const k of ['profile', 'rules', 'skills', 'hooks', 'commandName', 'roles']) {
      if (opts[k] !== undefined) throw new Error(`update는 --${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}를 받지 않습니다(profile은 set-profile)`);
    }
  }
  const ctx = makeContext(opts);
  const kitVersion = fs.readFileSync(path.join(ctx.kitSub, 'VERSION'), 'utf8').trim();
  versionParts(kitVersion);
  const versionFile = path.join(ctx.sub, 'VERSION');
  const installedVersion = readText(versionFile)?.trim() ?? null;
  if (mode === 'update') ctx.installedVersion = installedVersion;
  const { file: configFile, exists: configExists, config: oldConfig } = readConfig(ctx);

  if (mode === 'install' && installedVersion !== null) throw new Error(`이미 설치되어 있습니다(VERSION ${installedVersion}). 업데이트는 update를 쓰세요`);
  if (mode === 'update') {
    if (installedVersion === null) throw new Error('설치본 VERSION이 없습니다. 처음 설치가 끊긴 것이면 install을 다시 돌리세요');
    if (compareVersions(installedVersion, kitVersion) > 0 && !opts.allowOlder) throw new Error(`설치본(${installedVersion})이 키트(${kitVersion})보다 새롭습니다. 그래도 덮으려면 --allow-older`);
  }
  let profile;
  if (mode === 'install') {
    profile = opts.profile !== undefined ? requireProfile(opts.profile) : PROFILES[oldConfig.profile] ? oldConfig.profile : null;
    if (!profile) throw new Error('--profile personal 또는 --profile company가 필요합니다');
  } else {
    // profile이 없는 설치본(업데이트 전)은 회고 방식으로 짐작하지 않고, 아무것도 바꾸지 않은 채 사용자가 고르게 한 뒤 다시 돌리게 한다.
    // 까닭: 짐작한 profile 위에 set-profile이 겹치는 순서에서 권한 스위치가 승인 없이 켜지는 조합이 회차마다 나왔다.
    if (!PROFILES[oldConfig.profile]) {
      const set = 'kit-setup.js set-profile personal|company';
      console.log(JSON.stringify({
        mode, dryRun: ctx.dry, configDir: ctx.cfg, fromVersion: installedVersion, toVersion: kitVersion, needsProfile: true,
        notes: [`config.json에 profile이 없는 업데이트 전 설치본입니다. 파일을 하나도 바꾸지 않았습니다. 사용자에게 개인용인지 회사용인지 물어 ${set}를 돌린 뒤 update를 다시 돌리세요`],
      }, null, 2));
      process.exitCode = 2;
      return;
    }
    profile = oldConfig.profile;
  }
  const command = opts.commandName ?? oldConfig.commandName ?? 'retro';
  if (!COMMAND_NAME_RE.test(command)) throw new Error(`커맨드 이름은 영문 소문자, 숫자, 하이픈 64자 이하여야 합니다: ${command}`);

  const base = reconcileConfig({ ...oldConfig, ...(opts.commandName !== undefined && command !== 'retro' ? { commandName: command } : {}) }, profile, { freshInstall: mode === 'install', commitHookInstalled: fs.existsSync(path.join(ctx.sub, 'hooks', 'git', 'commit-msg')) });
  const roles = opts.roles !== undefined ? splitList(opts.roles) : null;
  if (roles) base.next.roles = roles;
  const newConfig = base.next;

  const sel = selectOptional(ctx, mode, opts, newConfig);
  const removedDefs = Array.isArray(newConfig.removedDefs) ? newConfig.removedDefs : [];
  const entries = buildEntries(ctx, sel, removedDefs);
  const recorded = isObject(newConfig.kitFileHashes) ? newConfig.kitFileHashes : null;
  newConfig.knownOptional = sel.knownOptional;
  const report = { mode, dryRun: ctx.dry, configDir: ctx.cfg, fromVersion: installedVersion, toVersion: kitVersion, profile, files: [], orphansRemoved: [], orphansKept: [], newOptional: sel.available, unchosenOptional: sel.unchosen, notes: [...sel.notes] };
  if (base.retired.length) report.notes.push(retiredNote(base.retired, profile));
  report.notes.push(...base.notes);

  const zones = migrateGuideZones(ctx);
  if (zones) report.legacyZones = zones;

  for (const e of entries) {
    const guideWithZones = zones && e.key === 'subagent-system/docs/SUBAGENT_GUIDE.md';
    report.files.push(syncEntry(ctx, e, recorded, Boolean(guideWithZones)));
  }
  dropOrphans(ctx, entries, recorded, report);
  if (mode === 'install') dropUnchosen(ctx, sel.unchosen, report);
  if (mode === 'update') {
    const moved = migrateRetroPending(ctx);
    if (moved) {
      report.retroPending = moved;
      report.notes.push(`옛 물을 것 ${moved.moved}건을 ${moved.file}의 제안 목록으로 옮겼습니다(같은 제목 ${moved.skippedSameTitle}건은 건너뜀). 원본은 ${moved.backup}에 남겼고, 사용자에게 물을 항목은 묻기 줄이 \`정책\`으로 달려 있으니 다음 회고가 한 번에 하나씩 묻습니다`);
    }
  }

  syncSettings(ctx, { profile, config: newConfig, gitAsk: opts.gitAsk ? true : opts.noGitAsk ? false : mode === 'install', name: mode, report, dropWriteAllow: base.tightened.includes('retroWriteAllow') });
  if (mode === 'install' && sel.hooks.includes('commit-msg')) commitMsgNotes(ctx, newConfig, report);

  const configChanged = !configExists || JSON.stringify(oldConfig) !== JSON.stringify(newConfig);
  report.config = { file: configFile, created: !configExists, changes: base.changes };
  if (configChanged) {
    if (configExists) report.config.backup = backupBeside(ctx, configFile, mode);
    writeFile(ctx, configFile, `${JSON.stringify(newConfig, null, 2)}\n`);
  }

  const all = report.files;
  report.counts = all.reduce((c, f) => ({ ...c, [f.status]: (c[f.status] ?? 0) + 1 }), {});
  report.conflictFiles = all.filter((f) => f.status === 'conflict').map((f) => f.key);
  report.unresolvedFiles = all.filter((f) => f.status === 'unresolved-markers').map((f) => f.key);
  const fromGit = all.filter((f) => f.baseFrom);
  if (fromGit.length) report.notes.push(`.kit-base가 없어 키트 git 기록의 VERSION ${installedVersion} 커밋(${fromGit[0].baseFrom.slice(4)})에서 ${fromGit.length}개 파일의 기준본을 가져와 3방향으로 병합했습니다`);
  const agentBacked = all.filter((f) => f.key.startsWith('agents/') && f.backup).map((f) => f.key);
  if (agentBacked.length) report.notes.push(`정의 ${agentBacked.length}개의 설치본 description이 키트 것으로 바뀌었습니다. 옆 백업을 보고 라우팅 표에 맞게 다시 맞추세요`);
  const codeOverwritten = all.filter((f) => f.status === 'overwritten-modified' && /^subagent-system\/(scripts|hooks)\//.test(f.key)).map((f) => f.key);
  if (codeOverwritten.length) report.notes.push(`스크립트와 훅은 병합하지 않고 키트 것으로 바꿉니다. 사용자가 고친 것으로 보이는 ${codeOverwritten.length}개(${codeOverwritten.join(', ')})가 바뀌었으니 옆 백업과 새 파일의 차이를 보고 다시 넣을 변경을 정하세요`);
  report.files = all.filter((f) => !['added', 'unchanged', 'replaced', 'kept'].includes(f.status) || f.backup);
  if (report.unresolvedFiles.length) report.notes.push('충돌 표시가 남은 파일은 건드리지 않았습니다. 표시를 풀고 update를 다시 돌리세요');
  if (zones?.userRulesFile) report.notes.push(`옛 사용자 규칙 ${zones.userRules}줄을 ${zones.userRulesFile}에 옮겼습니다. 정책이면 CLAUDE.md로, 방법이면 규칙 파일로 나눠 옮기세요`);

  writeFile(ctx, versionFile, `${kitVersion}\n`);
  report.claudeMd = claudeMdReport(ctx, newConfig);
  console.log(JSON.stringify(report, null, 2));
}

// 키트가 놓은 파일 가운데 설치본이 손대지 않은 것은 지우고, 손댄 것은 옆에 .bak-uninstall로 옮겨 남긴다.
function uninstall(rawArgs) {
  const opts = parseOptions(rawArgs);
  if (opts.positional.length) throw new Error(`모르는 인자: ${opts.positional.join(' ')}`);
  if (opts.records === undefined) throw new Error('--records keep|delete|<옮길 경로>가 필요합니다');
  const ctx = makeContext(opts);
  const { config } = readConfig(ctx);
  const rulesAll = fs.readdirSync(path.join(ctx.kitSub, 'rules')).filter((f) => f.endsWith('.md'));
  const skillsAll = fs.readdirSync(path.join(ctx.kitSub, 'skills'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  const sel = { rules: rulesAll, skills: skillsAll, hooks: Object.keys(OPTIONAL_HOOKS), command: config.commandName ?? 'retro' };
  const entries = buildEntries(ctx, sel, []);
  const baseRoot = path.join(ctx.sub, '.kit-base');
  const keys = new Map(entries.map((e) => [e.key, e]));
  for (const key of listFiles(baseRoot)) if (!keys.has(key)) keys.set(key, { key, kind: 'merge', dest: path.join(ctx.cfg, ...key.split('/')), text: null });
  const report = { mode: 'uninstall', dryRun: ctx.dry, configDir: ctx.cfg, removed: [], keptAsBackup: [], skippedUnknown: [], missing: 0, notes: [] };

  if (opts.records !== 'keep' && opts.records !== 'delete') {
    const to = path.resolve(opts.records);
    if (fs.existsSync(to)) throw new Error(`옮길 경로가 이미 있습니다: ${to}`);
  }
  const settingsFile = path.join(ctx.cfg, 'settings.json');
  const st = fs.existsSync(settingsFile) ? openSettings(settingsFile) : null;
  const dropped = st ? dropKitHooks(st.s, ['SubagentStop', 'SessionStart', 'PermissionRequest', 'PreToolUse']) : 0;
  report.hooksRemoved = dropped;
  if (dropped) {
    report.settingsBackup = backupBeside(ctx, st.f, 'uninstall');
    if (!ctx.dry) saveSettings(st);
  }
  if (st && Array.isArray(st.s.permissions?.ask)) report.notes.push('permissions.ask의 git 확인 항목은 설치 전부터 있었는지 알 수 없어 그대로 둡니다');

  // 승인 창 기록은 훅이 쌓은 사용자 쪽 기록이라 지우지 않고 남는다고 알린다(없으면 알리지 않는다).
  const askLog = path.join(ctx.cfg, 'permission-asks.jsonl');
  if (fs.existsSync(askLog)) report.notes.push(`승인 창 기록 ${askLog}은 지우지 않고 남깁니다. 필요 없으면 직접 지우세요`);
  // commit-msg 훅은 저장소마다 core.hooksPath로 걸었으므로 파일을 지워도 그 설정은 남아 저장소의 .git/hooks가 계속 돌지 않는다.
  report.notes.push('commit-msg 훅을 건 저장소가 있으면 git -C <저장소> config --local --unset core.hooksPath 로 풀어야 그 저장소의 .git/hooks가 다시 돕니다');

  const away = (file) => {
    const b = freePath(`${file}.bak-uninstall-${ctx.stampStr}`);
    if (!ctx.dry) fs.renameSync(file, b);
    report.keptAsBackup.push(b);
  };
  for (const [key, e] of keys) {
    if (e.kind === 'once') continue;
    const installed = readText(e.dest);
    if (installed === null) {
      report.missing += 1;
      continue;
    }
    const baseText = readText(path.join(baseRoot, ...key.split('/')));
    const ref = baseText ?? e.text;
    if (ref !== null && normEol(installed) === normEol(ref)) {
      if (!ctx.dry) fs.rmSync(e.dest);
      report.removed.push(key);
    } else if (baseText !== null || e.kind === 'rates') away(e.dest);
    else report.skippedUnknown.push(key);
  }
  const ratesFile = path.join(ctx.sub, 'rates.json');
  if (!keys.has('subagent-system/rates.json') && fs.existsSync(ratesFile)) away(ratesFile);
  const versionFile = path.join(ctx.sub, 'VERSION');
  if (fs.existsSync(versionFile)) {
    if (!ctx.dry) fs.rmSync(versionFile);
    report.removed.push('subagent-system/VERSION');
  }
  for (const f of ['config.json', `docs/${MIGRATED_RULES_FILE}`, 'docs/ROUTING_TABLE.md']) {
    const file = path.join(ctx.sub, ...f.split('/'));
    if (fs.existsSync(file)) away(file);
  }
  const records = path.join(ctx.sub, 'records');
  if (fs.existsSync(records)) {
    if (opts.records === 'delete') {
      if (!ctx.dry) fs.rmSync(records, { recursive: true, force: true });
      report.records = 'deleted';
    } else if (opts.records === 'keep') report.records = `kept: ${records}`;
    else {
      const to = path.resolve(opts.records);
      if (!ctx.dry) {
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.renameSync(records, to);
      }
      report.records = `moved: ${to}`;
    }
  }
  if (!ctx.dry) {
    fs.rmSync(baseRoot, { recursive: true, force: true });
    for (const d of listDirsDeepFirst(ctx.sub)) if (!fs.readdirSync(d).length) fs.rmdirSync(d);
    for (const n of sel.skills.map((s) => (s === 'retro' ? sel.command : s))) {
      const d = path.join(ctx.cfg, 'skills', n);
      if (fs.existsSync(d) && !fs.readdirSync(d).length) fs.rmdirSync(d);
    }
  }
  console.log(JSON.stringify(report, null, 2));
}

function listDirsDeepFirst(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) out.push(...listDirsDeepFirst(path.join(dir, e.name)));
  out.push(dir);
  return out;
}

function setProfileCommand(rawArgs) {
  const opts = parseOptions(rawArgs);
  if (opts.positional.length !== 1) throw new Error('사용법: set-profile personal|company');
  requireProfile(opts.positional[0]);
  const file = path.join(configDir(), 'subagent-system', 'config.json');
  if (!fs.existsSync(file)) {
    // 설치본 VERSION은 있는데 설정 파일만 없는 설치는 update가 profile을 먼저 요구하므로, 여기서 새로 만들어야 막다른 길이 되지 않는다.
    if (!fs.existsSync(path.join(path.dirname(file), 'VERSION'))) throw new Error(`설정 파일이 없습니다: ${file}`);
    writeJson(file, {});
  }
  const { changes, retired, notes: switchNotes, hook } = setProfileFile(file, opts.positional[0]);
  const notes = [...(retired.length ? [retiredNote(retired, opts.positional[0])] : []), ...switchNotes];
  // 개인용으로 가면 update 없이 set-profile만 돌려도 남은 commit 확인 목록이 나오게 한다. 까닭: 목록을 못 본 채 비었다고 읽으면 프로젝트별 허용이 전역 확인을 못 이기는데 묻지 않는다. 보기만 하고 settings.json은 쓰지 않는다.
  let settings;
  if (opts.positional[0] === 'personal') {
    try {
      settings = { gitAsk: { mode: 'report-only', keptCommitAsks: keptCommitAsksOf(openSettings(path.join(configDir(), 'settings.json')).s.permissions) } };
    } catch (e) {
      settings = { gitAsk: { mode: 'unreadable', error: e.message } };
      notes.push(`settings.json을 읽지 못해 남은 commit 확인 목록을 보이지 못했습니다(${e.message}). 고친 뒤 update --dry-run으로 settings.gitAsk.keptCommitAsks를 확인하세요`);
    }
  }
  console.log(JSON.stringify({ mode: 'set-profile', file, profile: opts.positional[0], changes, notes, ...(settings ? { settings } : {}), ...(hook ? { writeAllowHook: hook } : {}), note: 'settings.json은 retroWriteAllow를 껐을 때 retro-write-allow 훅 등록만 뺍니다. 보호를 느슨하게 하는 변경과 commitCheck는 바꾸지 않았습니다. git 확인 항목은 update --git-ask로 맞춥니다' }, null, 2));
}

// 설치 뒤 고른 규칙, 스킬, 선택 훅을 더한다. 이미 있는 파일은 건드리지 않고 skipped로 알린다. brief-check는 늘 설치되는 훅이라 받아서 무시하고 알린다.
function addOptional(rawArgs) {
  const opts = parseOptions(rawArgs);
  if (opts.positional.length) throw new Error(`모르는 인자: ${opts.positional.join(' ')}`);
  for (const k of ['profile', 'commandName', 'roles', 'records']) if (opts[k] !== undefined) throw new Error(`add는 --${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}를 받지 않습니다`);
  const ctx = makeContext(opts);
  if (readText(path.join(ctx.sub, 'VERSION')) === null) throw new Error('설치본 VERSION이 없습니다. 먼저 install을 돌리세요');
  const rulesAll = fs.readdirSync(path.join(ctx.kitSub, 'rules')).filter((f) => f.endsWith('.md') && f !== 'kit-core.md').sort();
  const skillsAll = fs.readdirSync(path.join(ctx.kitSub, 'skills'), { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== 'retro').map((e) => e.name).sort();
  const rules = chosenNames(splitList(opts.rules), rulesAll.map((f) => f.replace(/\.md$/, '')), '규칙', 'kit-').map((n) => `${n}.md`);
  const skills = chosenNames(splitList(opts.skills), skillsAll, '스킬');
  const listedHooks = splitAlwaysHooks(splitList(opts.hooks));
  const hooks = chosenNames(listedHooks.rest, Object.keys(OPTIONAL_HOOKS), '훅');
  if (!rules.length && !skills.length && !hooks.length && !listedHooks.notes.length) throw new Error('--rules, --skills, --hooks로 더할 이름을 주세요');
  const hookKeys = hooks.map((n) => `subagent-system/hooks/${OPTIONAL_HOOKS[n]}`);
  const entries = buildEntries(ctx, { rules, skills, hooks, command: 'retro' }, [])
    .filter((e) => e.key.startsWith('rules/') || e.key.startsWith('skills/') || hookKeys.includes(e.key));
  const added = [];
  const skipped = [];
  for (const e of entries) {
    if (fs.existsSync(e.dest)) {
      skipped.push(e.key);
      continue;
    }
    writeFile(ctx, e.dest, e.text);
    markExecutable(ctx, e);
    writeFile(ctx, path.join(ctx.sub, '.kit-base', ...e.key.split('/')), e.text);
    added.push(e.key);
  }
  const out = { mode: 'add', dryRun: ctx.dry, configDir: ctx.cfg, added, skipped };
  if (hooks.includes('commit-msg') || listedHooks.notes.length) out.notes = [...listedHooks.notes];
  if (hooks.includes('commit-msg')) {
    commitMsgNotes(ctx, readConfig(ctx).config, out);
  }
  console.log(JSON.stringify(out, null, 2));
}

const SUBCOMMANDS = {
  add: addOptional,
  install: (a) => runSync('install', a),
  update: (a) => runSync('update', a),
  uninstall,
  'set-profile': setProfileCommand,
};

// 플래그마다 필요한 인자 수(최소). 모자라면 사용법을 찍고 파일을 건드리지 않는다.
const COMMANDS = {
  '--add-answers': [1, (a) => addAnswers(a[0])],
  '--finish-answers': [1, (a) => finishAnswers(a[0], a[1])],
  '--keep-outside-line': [1, (a) => keepOutsideLine(a[0])],
  '--add-config-lines': [2, (a) => addConfigLines(a[0], a[1])],
  '--config-set': [3, (a) => configSet(a[0], a[1], a[2])],
  '--config-unset': [2, (a) => configUnset(a[0], a[1])],
  '--set-command-name': [2, (a) => setCommandName(a[0], a[1])],
  '--set-roles': [1, (a) => setRoles(a[0], a.slice(1))],
  '--checklist-synced': [2, (a) => checklistSynced(a[0], a[1])],
  '--add-hooks': [3, (a) => addHooks(a[0], a[1], a.slice(2))],
  '--remove-hooks': [2, (a) => removeHooks(a[0], a.slice(1))],
  '--merge-git-ask': [4, (a) => mergeGitAsk(a[0], a[1], a[2], a[3])],
  '--remove-agent-meter': [2, (a) => removeAgentMeter(a[0], a[1])],
  '--move-agent-meter': [1, (a) => moveAgentMeter(a[0])],
  '--backup-file': [2, (a) => backupFile(a[0], a[1])],
  '--check-json': [1, (a) => checkJson(a)],
};

function main() {
  const [flag, ...rest] = process.argv.slice(2);
  const sub = Object.hasOwn(SUBCOMMANDS, flag) ? SUBCOMMANDS[flag] : null;
  const cmd = sub ? [0, sub] : COMMANDS[flag];
  if (!cmd || rest.length < cmd[0]) {
    console.error(`사용법: node kit-setup.js <하위 명령 또는 플래그> <인자…>\n하위 명령: ${Object.keys(SUBCOMMANDS).join(' ')}\n플래그: ${Object.keys(COMMANDS).join(' ')}\n인자는 파일 머리말을 보세요.`);
    process.exit(1);
  }
  try {
    cmd[1](rest);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

main();
