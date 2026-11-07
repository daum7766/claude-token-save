#!/usr/bin/env node

/**
 * kit-setup.js
 *
 * 키트 설치, 업데이트, 제거를 맡는 명령 모음. 키트 폴더(이 파일이 든 subagent-system/scripts의 두 단계 위)에서 돌린다.
 * 같은 폴더의 kitMerge.js(3방향 병합), claudeMdTidy.js(CLAUDE.md 판정), kitProfile.js(개인용과 회사용 판정), kitDrift.js(설치 값 자리와 원본 대조, description 만들기), kitBundles.js(묶음 정의와 파일 목록), kitHooks.js(훅 등록 맞추기), kitInstalled.cjs(깐 상태 기록), userSettings.cjs(설정 문서)를 불러온다.
 * 설정 폴더는 CLAUDE_CONFIG_DIR이 있으면 그것, 없으면 ~/.claude다. 회고 스크립트는 설치본 scripts의 한 단계 위 config.json을 읽으므로 둘은 같은 파일이다.
 * update에서 설치본에 .kit-base가 없는 파일은, 키트가 git 저장소이고 설치본 VERSION과 같은 VERSION의 커밋이 있으면 그 커밋의 원문을 기준본으로 3방향 병합한다. 없으면 기록 해시 대조 뒤 2방향이다.
 * 백업은 한 가지다. 고치는 파일 옆에 <파일>.bak-<이름>-<날짜-시각>으로 복사한다(claudeMdTidy가 찍는 CLAUDE.md 백업 경로와 같은 꼴).
 * 오류가 나면 메시지를 오류 출력에 찍고 종료 코드 1로 끝난다. 설정 파일은 쓰기 전에 모두 읽고 검사한다.
 * update는 config.json에 profile이 없으면(업데이트 전 설치본) 아무것도 바꾸지 않고 JSON(needsProfile)을 찍은 뒤 종료 코드 2로 끝난다. 사용자가 고른 profile을 set-profile로 쓴 다음 update를 다시 돌린다.
 *
 * 하위 명령(결과는 JSON으로 찍는다)
 *   install --profile personal|company --bundles 이름,…|all|none --options 묶음.항목,…|default|none [--command-name 이름] [--roles 직군,…] [--kit 폴더] [--dry-run] [--no-git-ask]   바닥과 고른 묶음을 깔고 깐 상태 기록(bundles.lock.json)을 씀. 옛 --rules, --skills, --hooks는 받지 않고 새 꼴을 알림
 *   add --bundles 이름,… [--options 묶음.항목,…] [--kit 폴더] [--dry-run] [--git-ask]   고르지 않았던 묶음을 더함. 이미 있는 파일은 건너뛰고 뺄 때 보관한 설치 값(kept-values.json)을 되살림
 *   remove --bundles 이름,… [--options 묶음.항목,…] [--dry-run]   묶음이나 고른 항목의 파일과 훅 등록을 뺌. 설치 값은 kept-values.json에 보관, 사용자 훅이 부르는 키트 파일은 지우지 않음
 *   update [--kit 폴더] [--dry-run] [--git-ask] [--allow-older]   profile이 없으면 멈춤(종료 코드 2). 깐 상태 기록이 없는 옛 설치는 추정해 만듦(lock.estimated). migrate는 같은 명령의 다른 이름
 *   uninstall --records keep|delete|<옮길 경로> [--kit 폴더] [--dry-run]   키트 훅 등록과 로컬 조각 훅 등록을 빼고 파일을 지움(로컬 조각 파일은 둠)
 *   set-profile personal|company                                 바꾸는 것은 profile, retroMode(이전 profile의 기본값 그대로일 때만), 설정 문서의 사용 방식 줄뿐이고, 옛 판정 키가 있으면 지움. 권한과 보호 스위치(retroWriteAllow, commitCheck)는 조이는 쪽만 하고 느슨한 쪽은 notes로 알림
 *   diff [--kit 폴더] [--json]                                   설치본, 기준본(.kit-base), 원본 HEAD를 파일마다 대 같음, 키트가 앞섬, 설치본만 고침, 둘 다 고침, 키트에만 있음, 설치본에만 있음으로 찍음. 묶음과 조각 이름, 훅 등록 차이, 로컬 조각 수를 함께 보임. 아무것도 쓰지 않음
 *   sync [--kit 폴더] [--dry-run]                                config.json에 kitSourcePath가 있을 때만. 원본 HEAD를 변환해 키트가 놓는 파일만 덮고 .kit-base를 새로 씀. 깐 상태 기록의 키트 조각과 훅 등록도 맞춤
 *   descriptions [--kit 폴더] [--dry-run]                        정의 description의 일 이름 나열을 라우팅 표에서 다시 만듦
 *   check-staged                                                 pre-commit 조각이 부르는 검사. 설치 저장소에서 올린 키트 파일이 원본 HEAD와 다르고 설치 값 자리 밖이면 종료 코드 1. KIT_DRIFT_SKIP=1이면 건너뜀
 *   bundles [--json]                                             찾은 묶음과 조각, 고를 항목, 기댐, 깔렸는지, 설치 안내(install.md) 경로를 보임
 *   settings [--json]                                            사용자 설정 문서(USER_SETTINGS.md)의 값과 어디서 읽었는지를 보임
 *   settings-init [--name 호칭] [--choice 창|본문] [--lang ko] [--dry-run]   설정 문서를 만들거나 값을 고침. 호칭은 decisionWords와 personalMarkers에도 더함
 *   name-candidates                                              호칭 후보(git 사용자 이름, OS 사용자 이름, 기본 후보)
 *   hook-off|hook-on <묶음>/<이름>                               훅 하나를 settings에서 빼거나 다시 걺(config의 disabledHooks)
 *   hooks --compare <settings 가> <settings 나>                  두 settings의 훅 등록을 정규화해 견줌
 *   source-of <설치 경로>                                        그 경로가 키트 조각인지 로컬 조각인지 알림
 *   where                                                        기록 폴더 경로
 *   claude-md-done                                               CLAUDE.md 정리를 마친 뒤 늘 읽히는 줄 수를 claudeMdKeptLines에 남기거나 지움
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
 *   --add-hooks <settings.json>                                  깐 상태 기록의 훅 정의대로 이 키트의 훅 등록을 맞춤(더하기)
 *   --remove-hooks <settings.json>                               이 키트의 훅 등록(이름표 # kit:)을 뺌
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
import { createRequire } from 'node:module';
import { planKitFileUpdate, migrateLegacyZones, legacyHashOf } from './kitMerge.js';
import { analyzeClaudeMd, claudeMdSettingsOf, claudeMdVerdict } from './claudeMdTidy.js';
import { PROFILES, PROFILE_KEY_OWNER, RETIRED_POLICY_KEYS, profileOf } from './kitProfile.js';
import { loadDefinitions, entriesFor, selectableBundles, optionIds, expandFiles } from './kitBundles.js';
import { syncHooks, labelOf, compareHooks, scriptPathsOf, normalizeCommand } from './kitHooks.js';
import { RECORDS_DIR } from './claudeProjectPaths.js';

const require = createRequire(import.meta.url);
const lockApi = require('./kitInstalled.cjs');
const userSettingsApi = require('./userSettings.cjs');
import { STATUS, DEF_KEY_RE, CHECKLIST_KEY, SKIP_ENV, zoneOf, classifyFile, markersIn, maskZones, overlayZones, descriptionBlock, withDescriptionBlock, descriptionLineFor, tableKindsByDef, currentDescription, blockMessage } from './kitDrift.js';

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
  if ('hooks' in s && (!s.hooks || typeof s.hooks !== 'object' || Array.isArray(s.hooks))) throw new Error('settings.json의 hooks가 객체가 아닙니다');
  return { f, ex, s };
}

function saveSettings({ f, ex, s }) {
  // 훅을 모두 뺀 뒤 남은 빈 hooks 객체는 지운다.
  if (s.hooks && typeof s.hooks === 'object' && !Array.isArray(s.hooks) && !Object.keys(s.hooks).length) delete s.hooks;
  const t = `${f}.tmp-${process.pid}`;
  fs.writeFileSync(t, JSON.stringify(s, null, 2) + '\n');
  if (ex) fs.chmodSync(t, fs.statSync(f).mode & 0o7777);
  fs.renameSync(t, f);
}

function readStdin() {
  return fs.readFileSync(0, 'utf8');
}

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

// ---- 훅 등록 맞추기 입력(정의와 깐 상태 기록) ----

const defaultKitRoot = () => path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const hasKitDefs = (kit, cfg) => kit !== cfg && fs.existsSync(path.join(kit, 'bundles', 'base', 'bundle.json'));
const hooksConfigDir = (cfg) => (process.env.CLAUDE_CONFIG_DIR ? cfg : undefined);

function readConfigAt(cfg) {
  const text = readText(path.join(cfg, 'subagent-system', 'config.json'));
  if (text === null) return {};
  const parsed = JSON.parse(text);
  return isObject(parsed) ? parsed : {};
}

// 훅 맞추기에 쓸 정의와 깐 상태 기록이다. 기록이 있으면 키트 폴더 없이도 돈다(키트 조각의 훅은 기록의 사본을 쓴다).
// 기록이 없는 옛 설치는 키트 폴더가 있을 때만 깐 것을 추정해 기록을 짠다(저장하지 않음). 키트도 기록도 없으면 null이다.
function hookInputs(cfg, config, kitRoot) {
  const kit = kitRoot ?? defaultKitRoot();
  const has = hasKitDefs(kit, cfg);
  const defs = loadDefinitions({ kitRoot: has ? kit : path.join(cfg, '.no-kit'), configDir: cfg, kitSources: config.kitSources, partSource: config.partSource });
  let lock = lockApi.readLock(cfg);
  let estimated = false;
  if (!lock) {
    if (!has) return null;
    const selection = estimateSelection(cfg, defs, config);
    lock = lockApi.mergeLock(null, { command: 'install', kitParts: kitPartsFor(defs, selection, null), localParts: localPartsFor(defs, selection) });
    estimated = true;
  }
  return { defs, lock, estimated };
}

const labelsOf = (changes) => ({
  added: changes.added.map((x) => `${x.label} (${x.event})`),
  removed: changes.removed.map((x) => `${x.label ?? '이름표 없는 옛 등록'} (${x.event})`),
  replaced: changes.replaced.map((x) => ({ label: x.label, event: x.event, old: x.old, new: x.new })),
  kept: changes.kept,
  unknownKept: changes.unknownKept,
  warnings: changes.warnings,
});

// retroWriteAllow를 켜거나 끄면 settings.json의 훅 등록을 바로 맞춘다(syncHooks 한 번). 켜는 것은 사용자가 답한 뒤 이 명령으로만 하는 일이라 등록도 같은 자리에서 끝낸다.
// 까닭: 값은 켜졌는데 훅이 없으면 회고 쓰기마다 확인 창이 뜨고, 값을 껐는데 훅이 남으면 꺼진 줄 알고 있는 사이 등록만 남는다.
// nextConfig는 바꾼 뒤의 config 객체다(when 조건이 이 값을 본다). 설정 폴더의 config.json이 아닌 파일(시험용 사본)이면 settings.json을 건드리지 않는다.
const WRITE_ALLOW_LABEL = 'routing/retro-write-allow';
function syncWriteAllowHook(file, nextConfig) {
  const cfg = configDir();
  if (comparablePath(file) !== comparablePath(path.join(cfg, 'subagent-system', 'config.json'))) return null;
  const st = openSettings(path.join(cfg, 'settings.json'));
  const enabled = nextConfig.retroWriteAllow === true;
  const inputs = hookInputs(cfg, nextConfig);
  if (!inputs) {
    if (enabled) return { hook: 'not-registered', note: '깐 상태 기록도 키트 폴더도 없어 retro-write-allow 훅을 걸지 못했습니다. 키트 폴더에서 update를 돌리면 걸립니다' };
    const n = dropWriteAllowRegistrations(st.s);
    if (!n) return { hook: 'already-absent' };
    const backup = freePath(`${st.f}.bak-write-allow-${stamp()}`);
    if (st.ex) fs.copyFileSync(st.f, backup);
    saveSettings(st);
    return { hook: 'removed', backup: st.ex ? backup : null };
  }
  const r = syncHooks(st.s, { defs: inputs.defs, lock: inputs.lock, config: nextConfig, configDir: hooksConfigDir(cfg) });
  const isW = (x) => x.label === WRITE_ALLOW_LABEL;
  const has = JSON.stringify(r.settings.hooks ?? {}).includes(`kit:${WRITE_ALLOW_LABEL}`);
  let result;
  if (enabled) result = !has ? 'not-registered' : r.changes.added.some(isW) || r.changes.replaced.some(isW) ? 'registered' : 'already-registered';
  else result = r.changes.removed.some(isW) ? 'removed' : 'already-absent';
  const out = { hook: result };
  if (result === 'not-registered') out.note = '라우팅 묶음이 깔려 있지 않아 retro-write-allow 훅을 걸지 않았습니다';
  if (r.changes.changed) {
    const backup = freePath(`${st.f}.bak-write-allow-${stamp()}`);
    if (st.ex) fs.copyFileSync(st.f, backup);
    st.s = r.settings;
    saveSettings(st);
    out.backup = st.ex ? backup : null;
  }
  return out;
}

// 훅 정의를 읽을 수 없을 때 retro-write-allow 등록만 명령 글자로 찾아 뺀다(쓰기 허용을 조이는 쪽이라 빼는 길은 늘 열어 둔다).
function dropWriteAllowRegistrations(s) {
  let n = 0;
  const hooks = isObject(s.hooks) ? s.hooks : null;
  const groups = hooks && Array.isArray(hooks.PermissionRequest) ? hooks.PermissionRequest : null;
  if (!groups) return 0;
  for (const g of groups) {
    if (!(g && Array.isArray(g.hooks))) continue;
    const kept = g.hooks.filter((x) => !/retro-write-allow\.js/.test(String(x && x.command || '')));
    n += g.hooks.length - kept.length;
    g.hooks = kept;
  }
  hooks.PermissionRequest = groups.filter((g) => !(g && Array.isArray(g.hooks) && g.hooks.length === 0));
  if (!hooks.PermissionRequest.length) delete hooks.PermissionRequest;
  if (!Object.keys(hooks).length) delete s.hooks;
  return n;
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
  const hook = key === 'retroWriteAllow' ? syncWriteAllowHook(file, { ...o, retroWriteAllow: v }) : null;
  o[key] = v;
  writeJson(file, o);
  if (hook) console.log(JSON.stringify({ key, value: v, ...hook }, null, 2));
}

function configUnset(file, key) {
  const o = readJson(file);
  const hook = key === 'retroWriteAllow' ? syncWriteAllowHook(file, { ...o, retroWriteAllow: false }) : null;
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

// 낱개 플래그. settings 파일의 키트 훅 등록을 깐 상태 기록에 맞추거나(--add-hooks) 모두 뺀다(--remove-hooks). 둘 다 syncHooks 하나를 부른다.
function addHooks(file) {
  const cfg = configDir();
  const config = readConfigAt(cfg);
  const inputs = hookInputs(cfg, config);
  if (!inputs) throw new Error('깐 상태 기록도 키트 폴더도 없어 훅 정의를 모릅니다');
  const st = openSettings(file);
  const r = syncHooks(st.s, { defs: inputs.defs, lock: inputs.lock, config, configDir: hooksConfigDir(cfg) });
  for (const x of r.changes.added) console.log(`더함: ${x.label} (${x.event})`);
  for (const x of r.changes.replaced) console.log(`갈아 끼움: ${x.label} (${x.event})`);
  for (const x of r.changes.removed) console.log(`뺌: ${x.label ?? '옛 등록'} (${x.event})`);
  if (!r.changes.changed) console.log('이미 맞음');
  else {
    st.s = r.settings;
    saveSettings(st);
  }
}

function removeHooks(file) {
  const cfg = configDir();
  const config = readConfigAt(cfg);
  const defs = loadDefinitions({ kitRoot: hasKitDefs(defaultKitRoot(), cfg) ? defaultKitRoot() : path.join(cfg, '.no-kit'), configDir: cfg, kitSources: config.kitSources, partSource: config.partSource });
  const st = openSettings(file, { mustExist: true });
  const r = syncHooks(st.s, { defs, lock: { lockVersion: 1, installed: {} }, config });
  if (r.changes.changed) {
    st.s = r.settings;
    saveSettings(st);
  }
  console.log(`뺀 명령: ${r.changes.removed.length}개`);
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
const OBSOLETE_CONFIG_KEYS = ['goalMethodDeclined', 'checklistDeclined', 'knownOptional'];

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
// 업데이트로 키가 없을 때는 안전한 쪽으로 채운다: retroWriteAllow는 false, commitCheck는 block이다(commit-msg 훅은 바닥이 늘 깔고, 키가 없을 때 훅이 이미 검사하므로 지금 동작을 지킴).
// 켜는 것은 업데이트 절차(APPLY_GUIDE 6단계)가 사용자에게 묻고 --config-set으로 한다.
// tightened에 든 키는 값을 조였다는 뜻이고, retroWriteAllow가 들면 호출한 쪽이 settings.json의 훅 등록을 뺀다.
function reconcileConfig(config, profile, { freshInstall = false } = {}) {
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
    if (k === 'commitCheck') return 'block';
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
  // settings.json을 먼저 열어 깨졌으면 config.json도 바꾸지 않는다(--config-set과 같음). 쓰기 허용을 껐을 때만 훅 등록을 맞춘다.
  const hook = tightened.includes('retroWriteAllow') ? syncWriteAllowHook(file, next) : null;
  if (changes.length) writeJson(file, next);
  if (hook?.note) notes.push(hook.note);
  return { changes, retired, notes, hook };
}

// ---- 설치, 업데이트, 제거 ----

const KIT_VERSION_RE = /^\d{4}\.\d+\.\d+(\.\d+)?$/;
const COMMAND_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
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
  const valueOpts = ['--kit', '--profile', '--bundles', '--options', '--command-name', '--roles', '--records', '--name', '--choice', '--lang'];
  const boolOpts = ['--dry-run', '--git-ask', '--no-git-ask', '--allow-older', '--json', '--compare'];
  const o = { positional: [] };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (['--rules', '--skills', '--hooks'].includes(a)) throw new Error(OLD_FLAGS_GONE);
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

// 키트 원본을 읽는 길이다. 설치와 업데이트는 작업 폴더(fs)를 읽고, diff와 sync와 커밋 검사는 커밋된 HEAD(git)를 읽는다.
// 까닭: 다른 세션이 커밋하지 않은 고침이 설치본에 흘러들지 않게 한다. 경로는 모두 키트 폴더 기준이고 listFiles와 같은 규칙(점 파일과 node_modules 제외, 정렬)으로 돌려준다.
const hiddenPath = (rel) => rel.split('/').some((n) => n.startsWith('.') || n === 'node_modules');

function fsSource(kit) {
  return {
    list: (dir) => listFiles(path.join(kit, dir)),
    listDirs: (dir) => (fs.existsSync(path.join(kit, dir)) ? fs.readdirSync(path.join(kit, dir), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() : []),
    exists: (rel) => fs.existsSync(path.join(kit, rel)),
    read: (rel) => fs.readFileSync(path.join(kit, rel), 'utf8'),
  };
}

function gitOut(kit, args) {
  const r = spawnSync('git', ['-C', kit, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  return r.error || r.status !== 0 ? null : r.stdout;
}

function headSource(kit) {
  const head = gitOut(kit, ['rev-parse', '--verify', 'HEAD']);
  if (head === null) throw new Error(`원본이 git 저장소가 아니거나 커밋이 없습니다: ${kit}`);
  const names = (gitOut(kit, ['ls-tree', '-r', '--name-only', '-z', 'HEAD', '.']) ?? '').split('\0').filter(Boolean);
  const set = new Set(names);
  const under = (dir) => names.filter((n) => n.startsWith(`${dir}/`)).map((n) => n.slice(dir.length + 1)).filter((r) => !hiddenPath(r));
  return {
    head: head.trim(),
    list: (dir) => under(dir).sort(),
    listDirs: (dir) => [...new Set(under(dir).filter((r) => r.includes('/')).map((r) => r.split('/')[0]))].sort(),
    exists: (rel) => set.has(rel),
    read: (rel) => {
      const r = spawnSync('git', ['-C', kit, 'show', `HEAD:./${rel}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
      if (r.error || r.status !== 0) throw new Error(`원본 HEAD에서 읽지 못했습니다: ${rel}`);
      return r.stdout;
    },
  };
}

// diff, sync, 커밋 검사가 쓰는 문맥이다. 원본 폴더는 --kit, 없으면 설치본 config의 kitSourcePath다.
function makeHeadContext(opts, { requireSourcePath = false } = {}) {
  const cfg = configDir();
  const sub = path.join(cfg, 'subagent-system');
  let config = {};
  const text = readText(path.join(sub, 'config.json'));
  if (text !== null) config = JSON.parse(text);
  if (!isObject(config)) throw new Error('config.json 최상위가 객체가 아닙니다');
  const hasPath = typeof config.kitSourcePath === 'string' && config.kitSourcePath.trim() !== '';
  if (requireSourcePath && !hasPath) throw new Error('config.json에 kitSourcePath가 없어 거절합니다. 원본 폴더가 있는 설치에서만 sync를 돌립니다');
  const kitRaw = opts.kit ?? (hasPath ? config.kitSourcePath : null);
  if (!kitRaw) throw new Error('원본 폴더를 모릅니다. --kit으로 알리거나 config.json에 kitSourcePath를 적으세요');
  const kit = path.resolve(kitRaw);
  if (kit === cfg) throw new Error('설치본을 원본으로 쓸 수 없습니다');
  const src = headSource(kit);
  if (!src.exists('subagent-system/VERSION')) throw new Error(`키트 폴더가 아닙니다(subagent-system/VERSION이 HEAD에 없음): ${kit}`);
  return { cfg, kit, kitSub: path.join(kit, 'subagent-system'), sub, dry: Boolean(opts.dryRun), stampStr: stamp(), report: {}, src, config, installedVersion: readText(path.join(sub, 'VERSION'))?.trim() ?? null };
}

function makeContext(opts) {
  const cfg = configDir();
  const kit = path.resolve(opts.kit ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const kitSub = path.join(kit, 'subagent-system');
  if (!fs.existsSync(path.join(kitSub, 'VERSION'))) throw new Error(`키트 폴더가 아닙니다(subagent-system/VERSION이 없음): ${kit}. 키트 폴더에서 돌리거나 --kit으로 알려 주세요`);
  if (path.resolve(kit) === cfg) throw new Error('설치본의 스크립트를 키트로 쓸 수 없습니다. 키트 폴더에서 돌리거나 --kit으로 키트 폴더를 알려 주세요');
  return { kit, kitSub, cfg, sub: path.join(cfg, 'subagent-system'), dry: Boolean(opts.dryRun), stampStr: stamp(), report: {}, src: fsSource(kit) };
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

// 내용은 같은데 실행 권한만 빠진 훅 파일이다. 내용만 견주면 놓쳐, git이 훅을 조용히 건너뛴다(설치본 검수 9회차 5번).
function lacksExec(e) {
  if (!e.exec || process.platform === 'win32') return false;
  try {
    return (fs.statSync(e.dest).mode & 0o111) === 0;
  } catch {
    return false;
  }
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

// CLAUDE_CONFIG_DIR을 쓰는 컴퓨터는 문서, 정의, 스킬 글의 ~/.claude와 $HOME/.claude를 그 폴더로 바꿔 놓는다. 스크립트와 확장자 없는 git 훅 파일은 바꾸지 않는다.
function adaptText(ctx, key, text) {
  if (!process.env.CLAUDE_CONFIG_DIR || /\.(js|cjs|mjs|py)$/.test(key) || /(^|\/)hooks\/git\/[a-z-]+$/.test(key)) return text;
  const dir = slash(ctx.cfg);
  return text.split('$HOME/.claude').join(dir).split('~/.claude').join(dir);
}

// ---- 묶음 정의, 고르기, 깐 상태 기록 ----

// 깐 상태 기록이 없는 옛 설치에서도 늘 깔려 있던 묶음이다. 이 묶음의 고를 항목과 나머지 묶음은 파일이 있을 때만 깐 것으로 본다(설계 10절).
const ASSUMED_BUNDLES = ['routing', 'company', 'feedback'];
const OLD_FLAGS_GONE = '--rules, --skills, --hooks는 없어졌습니다. 묶음은 --bundles <이름,…|all|none>, 고를 항목은 --options <묶음.항목,…|default|none>으로 고릅니다';

// 키트와 추가 원본과 설치본 로컬 자리의 정의를 읽는다. 정의 오류가 있으면 아무것도 쓰기 전에 멈춘다.
function loadBundleDefs(ctx, config) {
  const defs = loadDefinitions({ kitRoot: ctx.kit, configDir: ctx.cfg, kitSources: config.kitSources, partSource: config.partSource, source: ctx.src });
  const errors = defs.problems.filter((p) => p.level === 'error');
  if (errors.length) throw new Error(`묶음 정의에 오류가 있습니다:\n${errors.map((p) => `  ${p.msg}`).join('\n')}`);
  ctx.definitionWarnings = defs.problems.filter((p) => p.level === 'warn').map((p) => p.msg);
  return defs;
}

// 설치 명령이 받은 --bundles와 --options를 고른 묶음과 고를 항목으로 바꾼다. 둘 다 받아야 하고, 없으면 거절한다(고르지 않은 채 설치를 맡은 쪽이 전부 깔지 않게).
function parseSelection(defs, opts, { requireBoth = true, base = { bundles: [], options: [] } } = {}) {
  const missing = ['bundles', 'options'].filter((k) => opts[k] === undefined);
  if (requireBoth && missing.length) {
    throw new Error(`묶음을 고르지 않았습니다: ${missing.map((k) => `--${k}`).join(', ')}. 사용자에게 묶음 고르기 질문으로 물어 받은 답만 넣고, 고르지 않았으면 --bundles none --options none을 줍니다.`);
  }
  const selectable = selectableBundles(defs);
  const rawB = opts.bundles === undefined ? null : String(opts.bundles).trim();
  let bundles;
  if (rawB === null) bundles = [];
  else if (rawB === 'all') bundles = selectable;
  else if (rawB === 'none') bundles = [];
  else {
    bundles = [...new Set(splitList(rawB))].filter((n) => n !== 'base').map((n) => {
      if (!selectable.includes(n)) throw new Error(`키트에 없거나 고를 수 없는 묶음: ${n}`);
      return n;
    });
  }
  const rawO = opts.options === undefined ? null : String(opts.options).trim();
  let options;
  if (rawO === null) options = optionIds(defs, { bundles, onlyDefault: true });
  else if (rawO === 'none') options = [];
  else if (rawO === 'default') options = optionIds(defs, { bundles, onlyDefault: true });
  else {
    const known = new Set(optionIds(defs));
    options = [...new Set(splitList(rawO))].map((id) => {
      if (!known.has(id)) throw new Error(`키트에 없는 고를 항목: ${id}`);
      if (!bundles.includes(id.split('.')[0]) && !base.bundles.includes(id.split('.')[0])) throw new Error(`고르지 않은 묶음의 항목입니다: ${id}`);
      return id;
    });
  }
  return { bundles, options };
}

// 깐 상태 기록에서 고른 묶음과 항목을 읽는다. 정의가 사라진 묶음이나 항목은 빼고 이름을 missing에 모은다.
function selectionFromLock(defs, lock) {
  const missing = [];
  const bundles = [];
  const options = [];
  for (const [name, entry] of Object.entries(lock.installed)) {
    if (name === 'base') continue;
    if (!defs.bundles.has(name)) {
      missing.push(name);
      continue;
    }
    bundles.push(name);
    for (const id of Array.isArray(entry?.options) ? entry.options : []) {
      if (defs.bundles.get(name).options.some((o) => `${name}.${o.id}` === id)) options.push(id);
      else missing.push(id);
    }
  }
  return { bundles, options, missing };
}

// 깐 상태 기록이 없는 옛 설치가 무엇을 깔았는지 파일로 추정한다(설계 10절). 늘 깔렸던 묶음(ASSUMED_BUNDLES)은 깐 것으로, 나머지는 그 묶음 파일이 하나라도 있으면 깐 것으로 본다.
// 고를 항목은 그 항목 파일이 있을 때만 켠다. 규칙이 주제별로 나뉘기 전 kit-recommended.md가 있으면 회사 규칙의 항목을 모두 켠다.
function estimateSelection(cfg, defs, config) {
  const exists = (key) => fs.existsSync(path.join(cfg, ...key.split('/')));
  const command = typeof config?.commandName === 'string' ? config.commandName : 'retro';
  const keysOf = (bundles, options) => new Set(entriesFor(defs, { bundles, options }, { commandName: command }).filter((e) => e.kind !== 'local' && e.bundle !== 'base').map((e) => e.key));
  const legacyRecommended = exists('rules/kit-recommended.md');
  const bundles = [];
  const options = [];
  for (const name of selectableBundles(defs)) {
    const b = defs.bundles.get(name);
    if (b.origin !== 'kit') continue;
    const plain = keysOf([name], []);
    const all = keysOf([name], optionIds(defs, { bundles: [name] }));
    const present = [...all].some(exists) || (name === 'work-git' && exists('subagent-system/hooks/git/commit-msg'));
    if (!ASSUMED_BUNDLES.includes(name) && !present) continue;
    bundles.push(name);
    for (const o of b.options) {
      const id = `${name}.${o.id}`;
      const only = [...keysOf([name], [id])].filter((k) => !plain.has(k));
      if (only.some(exists) || (legacyRecommended && name === 'company')) options.push(id);
    }
  }
  // 옛 설치는 git-work 스킬과 commit-msg 훅을 따로 골랐다. 새 work-git 묶음은 둘을 함께 깔므로, 한쪽만 있던 설치는 알린다.
  const notes = [];
  const skill = exists('skills/git-work/SKILL.md');
  const hook = exists('subagent-system/hooks/git/commit-msg');
  if (bundles.includes('work-git') && skill !== hook) {
    notes.push(`옛 설치가 ${skill ? 'git-work 스킬만' : 'commit-msg 훅만'} 골랐지만 work-git 묶음은 스킬과 commit-msg의 왜/전제 검사를 함께 깝니다. 한쪽이 필요 없으면 remove --bundles work-git으로 묶음째 빼세요`);
  }
  if (!hook && bundles.some((n) => ['work-git', 'feedback'].includes(n))) {
    notes.push('옛 설치가 commit-msg 훅을 고르지 않았습니다. 이제 git 훅 이어 부르기가 바닥에 깔리고 work-git, feedback 묶음의 커밋 검사 조각이 함께 놓입니다. 저장소의 core.hooksPath를 이 설정 폴더의 subagent-system/hooks/git으로 건 저장소에서만 검사가 돌며, 끄려면 사용자에게 묻고 --config-set으로 commitCheck를 \"off\"로 바꿉니다');
  }
  return { bundles, options, notes };
}

// 깐 상태 기록에 적을 키트 조각(훅과 git 조각 정의 사본 포함)과 로컬 조각.
function kitPartsFor(defs, selection, commit) {
  const out = {};
  for (const name of ['base', ...selection.bundles.filter((n) => n !== 'base')]) {
    const parts = defs.parts.filter((p) => p.bundle === name && p.origin === 'kit');
    if (!parts.length) continue;
    out[name] = {
      options: selection.options.filter((o) => o.startsWith(`${name}.`)),
      parts: Object.fromEntries(parts.map((p) => [p.part, { origin: 'kit', ...(commit ? { commit } : {}), hooks: p.hooks, gitHooks: p.gitHooks }])),
    };
  }
  return out;
}

// 로컬 조각 기록. oldLock이 있으면(기록을 갱신하는 명령) 키트 정의가 없는 로컬 묶음 가운데 기록에 없는 것은 더하지 않는다.
// 왜: remove로 뺀 로컬 묶음이 다음 update에 되살아나면 안 된다(설계 1.5 「로컬 항목을 지우는 것은 remove와 uninstall뿐」). 처음 기록을 만드는 install과 옛 설치 추정은 oldLock을 null로 부른다.
function localPartsFor(defs, selection, oldLock = null) {
  const have = new Set(['base', ...selection.bundles]);
  const out = {};
  for (const p of defs.parts.filter((x) => x.origin === 'local')) {
    const b = defs.bundles.get(p.bundle);
    if (b?.origin === 'kit' && !have.has(p.bundle)) continue;
    if (oldLock && b?.origin !== 'kit' && !(p.bundle in (oldLock.installed ?? {}))) continue;
    (out[p.bundle] ??= { parts: {} }).parts[p.part] = {};
  }
  return out;
}

function kitCommitOf(ctx) {
  if (ctx.src?.head) return ctx.src.head.slice(0, 7);
  const out = gitOut(ctx.kit, ['rev-parse', '--short', 'HEAD']);
  return out === null ? null : out.trim() || null;
}

// 깔 파일 목록. 키트 파일은 원문을 읽어 설치본에 놓는 글로 바꾸고(render), 로컬 조각 파일은 text가 null인 local 갈래로 낸다.
function buildEntries(ctx, defs, selection, removedDefs, command) {
  const partOf = (r) => defs.parts.find((p) => p.bundle === r.bundle && p.part === r.part);
  return entriesFor(defs, selection, { removedDefs, commandName: command }).map((r) => {
    const dest = path.join(ctx.cfg, ...r.key.split('/'));
    if (r.kind === 'local') return { key: r.key, kind: 'local', exec: false, dest, src: null, bundle: r.bundle, part: r.part, render: (t) => t, text: null };
    const post = r.src === 'subagent-system/skills/retro/SKILL.md' ? (text) => text.replace(/^name: .*$/m, `name: ${command}`) : (text) => text;
    const render = (raw) => post(adaptText(ctx, r.key, raw));
    return { key: r.key, kind: r.kind, exec: r.exec, dest, src: r.src, bundle: r.bundle, part: r.part, render, text: render(partOf(r).source.read(r.src)) };
  });
}

const kitOnly = (entries) => entries.filter((e) => e.kind !== 'local');

// 새 명령이 부르는 스크립트(감싸개 포함)가 설치본에 있거나 이번 실행이 놓는지 본다. 없으면 설정을 쓰기 전에 멈춘다.
// 까닭: 설정이 먼저 바뀌면 그 사이 도는 세션이 없는 파일을 부르는 훅을 만난다.
function missingHookScripts(ctx, changes, willExist) {
  const miss = new Set();
  const rows = [...changes.added.map((x) => x.command), ...changes.replaced.map((x) => x.new)];
  for (const cmd of rows) {
    const paths = scriptPathsOf(normalizeCommand(cmd, { configDir: ctx.cfg }));
    if (/kit-hook\.cjs/.test(cmd)) paths.push('~/.claude/subagent-system/hooks/kit-hook.cjs');
    for (const p of paths) {
      let abs = null;
      if (p.startsWith('~/.claude/')) abs = path.join(ctx.cfg, ...p.slice('~/.claude/'.length).split('/'));
      else if (p.startsWith('~/')) abs = path.join(os.homedir(), ...p.slice(2).split('/'));
      else if (path.isAbsolute(p)) abs = p;
      if (!abs) continue;
      if (fs.existsSync(abs) || willExist.has(slash(path.relative(ctx.cfg, abs)))) continue;
      miss.add(p);
    }
  }
  return [...miss];
}

// 이번 명령이 settings.json에 더하거나 갈아 끼울 훅 등록 계획이다. 파일은 쓰지 않는다.
function planHooks(ctx, { defs, lock, config, entries }) {
  const st = openSettings(path.join(ctx.cfg, 'settings.json'));
  const r = syncHooks(st.s, { defs, lock, config, configDir: hooksConfigDir(ctx.cfg) });
  const missing = missingHookScripts(ctx, r.changes, new Set(entries.map((e) => e.key)));
  if (missing.length) throw new Error(`새 명령의 스크립트 없음: ${missing.join(', ')}. 원본에 이 파일이 없거나 이번 설치가 놓지 않습니다. 아무것도 바꾸지 않았습니다`);
  return { st, next: r.settings, changes: r.changes, changed: r.changes.changed };
}

// git 확인 목록(permissions.ask)을 더한다. git 관리 묶음을 깐 때만 한다.
function planGitAsk(ctx, plan, { profile, config, gitAsk, workGit }) {
  const out = { mode: gitAsk ? 'merge' : 'report-only', added: 0, missing: 0 };
  if (!workGit) return { ...out, mode: 'no-git-bundle' };
  if (!ctx.src.exists('extras/git-permissions.json')) return { ...out, mode: 'no-kit-file' };
  const s = plan.next;
  const hadPermissions = s.permissions !== undefined;
  const hadAsk = hadPermissions && s.permissions.ask !== undefined;
  const { pm, todo } = gitAskTodo(s, JSON.parse(ctx.src.read('extras/git-permissions.json')), config, profile);
  out.missing = todo.length;
  if (gitAsk && todo.length) {
    pm.ask.push(...todo);
    out.added = todo.length;
    plan.changed = true;
  }
  if (profile === 'personal') out.keptCommitAsks = keptCommitAsksOf(pm);
  if (!out.added) {
    if (!hadAsk) delete pm.ask;
    if (!hadPermissions) delete s.permissions;
  }
  return out;
}

// settings.json은 명령의 마지막에 쓴다. 바뀐 것이 있으면 옆 백업을 남긴다.
function commitSettings(ctx, plan, name) {
  if (!plan.changed) return null;
  let backup = null;
  if (plan.st.ex) backup = backupBeside(ctx, plan.st.f, name);
  if (!ctx.dry) {
    plan.st.s = plan.next;
    saveSettings(plan.st);
  }
  return backup;
}

// 설정 문서의 「사용 방식」 줄을 profile에 맞춘다. 설정 문서가 없으면 만들지 않는다(settings-init이 만든다).
const PROFILE_LINE = { personal: '개인용', company: '회사용' };
function syncProfileLine(cfg, profile, dry) {
  const file = path.join(cfg, 'USER_SETTINGS.md');
  const text = readText(file);
  if (text === null) return false;
  const lines = text.split('\n');
  let inValues = false;
  let changed = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^## /.test(lines[i])) inValues = lines[i].trim() === '## 값';
    if (!inValues) continue;
    const m = /^(\s*[-*]\s+사용 방식\s*[:：]).*$/.exec(lines[i]);
    if (m) {
      const next = `${m[1]} ${PROFILE_LINE[profile]} <!-- kit-setup이 씀, 바꿀 때는 kit-setup.js set-profile -->`;
      if (lines[i] !== next) {
        lines[i] = next;
        changed = true;
      }
      break;
    }
  }
  if (changed && !dry) fs.writeFileSync(file, lines.join('\n'));
  return changed;
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

// 정의의 description 줄을 라우팅 표에서 다시 만든다. 설치 값 자리라 키트 글과 병합하지 않고, 표에 일이 없거나 승급 전용이면 설치본 줄을 둔다.
// 업데이트와 descriptions 하위 명령이 같은 규칙을 쓴다. firstText는 첫 문장을 가져올 정의 글(키트의 것)이다.
function tableByDef(ctx, fallbackText) {
  if (ctx.tableKinds) return ctx.tableKinds;
  const text = readText(path.join(ctx.sub, 'docs', 'ROUTING_TABLE.md')) ?? fallbackText ?? '';
  ctx.tableKinds = tableKindsByDef(text).byDef;
  return ctx.tableKinds;
}

function defDescriptionLine(ctx, key, installedText, firstText) {
  const def = path.basename(key, '.md');
  const current = installedText === null ? currentDescription(firstText) : currentDescription(installedText);
  const line = descriptionLineFor({ def, byDef: tableByDef(ctx), current, firstSource: currentDescription(firstText) });
  return line;
}

function syncEntry(ctx, e, recorded, forceBackup) {
  const baseFile = path.join(ctx.sub, '.kit-base', ...e.key.split('/'));
  const installed = readText(e.dest);
  let base = readText(baseFile);
  const isDef = ctx.mode === 'update' && DEF_KEY_RE.test(e.key);
  const out = { key: e.key };
  if (base === null && installed !== null && (e.kind === 'merge' || e.kind === 'code')) {
    base = gitBaseText(ctx, e);
    if (base !== null) out.baseFrom = `git:${findKitCommit(ctx).hash.slice(0, 7)}`;
  }
  // 정의는 description 줄을 기준본(없으면 새 키트)의 줄로 맞춘 설치본으로 병합해 그 줄이 충돌을 만들지 않게 하고, 병합 뒤에 표에서 만든 줄(없으면 설치본 줄)을 얹는다.
  const descLine = isDef ? defDescriptionLine(ctx, e.key, installed, e.text) : null;
  const finalBlock = isDef ? (descLine ?? (installed !== null ? descriptionBlock(installed) : null) ?? descriptionBlock(e.text)) : null;
  const installedPlan = isDef && installed !== null ? withDescriptionBlock(installed, base !== null ? descriptionBlock(base) : descriptionBlock(e.text)) : installed;
  const finalize = (text) => (isDef ? withDescriptionBlock(text, finalBlock) : text);
  if (isDef && installed !== null && descLine !== null && finalBlock !== descriptionBlock(installed)) out.description = 'rebuilt';
  let write = null;
  let backup = false;
  let writeBase = e.kind === 'merge' || e.kind === 'code';
  if (installed === null) {
    write = finalize(e.text);
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
      ? planKitFileUpdate({ key: e.key, installed: installedPlan, base, next: e.text, recordedHashes: recorded })
      : planCode({ key: e.key, installed, base, next: e.text, recorded });
    out.status = p.status;
    out.reason = p.reason;
    if (p.status === 'unresolved-markers') writeBase = false;
    else if (p.status !== 'unchanged') {
      write = finalize(p.text);
      backup = ['merged', 'conflict', 'overwritten-modified'].includes(p.status);
      if (p.reason === 'hash-equal' && recorded[e.key] !== sha256(installed)) backup = true;
    } else if (isDef && finalize(installedPlan) !== installed) {
      write = finalize(installedPlan);
      out.status = 'description-rebuilt';
    }
    if (p.conflicts?.length) out.conflicts = p.conflicts.length;
  }
  if (forceBackup && installed !== null) backup = true;
  if (backup && installed !== null) out.backup = backupBeside(ctx, e.dest, 'update');
  if (write !== null && write !== installed) {
    writeFile(ctx, e.dest, write);
    markExecutable(ctx, e);
  } else if (lacksExec(e)) {
    markExecutable(ctx, e);
    out.execRestored = true;
  }
  if (writeBase && base !== e.text) writeFile(ctx, baseFile, e.text);
  return out;
}

// 기준본(.kit-base)에는 있는데 키트가 더는 놓지 않는 파일이다. 키트에서 지웠거나 이름을 바꾼 것이다. 고르지 않은 선택 항목은 키트에 원문이 남아 있어 들지 않는다.
// ctx.src로 원문을 찾아 update(작업 폴더)와 diff, sync(원본 HEAD)가 같은 판정을 쓴다.
function kitRemovedKeys(ctx, entries, extra = []) {
  const keys = new Set(entries.map((e) => e.key));
  const baseRoot = path.join(ctx.sub, '.kit-base');
  const out = [];
  for (const key of new Set([...listFiles(baseRoot), ...extra])) {
    if (keys.has(key)) continue;
    if (ctx.src.exists(key.startsWith('subagent-system/') ? key : `subagent-system/${key}`)) continue;
    out.push(key);
  }
  return out;
}

// 키트 git 기록에서 선택 항목(규칙, 스킬)의 이름 바꿈을 찾아 옛 키 → 지금 키로 잇는다. 고른 규칙의 이름이 바뀌면 옛 이름만 지우고 새 이름은 깔지 않아
// 고른 항목이 소리 없이 사라졌다(설치본 검수 8회차 4번). git이 없거나 기록을 못 읽으면 빈 표다.
function kitRenames(ctx) {
  const out = runGit(ctx, ['log', '-M', '--diff-filter=R', '--name-status', '--format=', 'HEAD', '--', 'subagent-system/rules', 'subagent-system/skills']);
  const map = new Map();
  if (out === null) return map;
  const strip = (p) => p.replace(/^subagent-system\//, '');
  // 기록은 새것부터 나온다. 옛 이름을 처음 본 것(가장 새 바꿈)만 쓰고, 이어진 바꿈은 끝 이름까지 따라간다.
  for (const line of out.split('\n')) {
    const [st, from, to] = line.split('\t');
    if (!st || !st.startsWith('R') || !from || !to) continue;
    if (!map.has(strip(from))) map.set(strip(from), strip(to));
  }
  for (const [k, v] of map) {
    let end = v;
    for (let i = 0; i < 10 && map.has(end); i++) end = map.get(end);
    map.set(k, end);
  }
  return map;
}

// 공개판처럼 묶음 일부만 내보낸 키트가 남기라고 한 파일 키 집합. 뺀 묶음이라고 적힌 묶음이 이 키트에 정말 있으면 전체 키트에 잘못 들어온 파일이라 보지 않는다(빈 집합).
function omittedKeep(ctx) {
  if (!ctx.src.exists('bundles/omitted.json')) return new Set();
  let data;
  try {
    data = JSON.parse(ctx.src.read('bundles/omitted.json'));
  } catch {
    return new Set();
  }
  const names = Array.isArray(data?.omitted) ? data.omitted : [];
  if (names.some((n) => typeof n === 'string' && ctx.src.exists(`bundles/${n}/bundle.json`))) return new Set();
  return new Set(Array.isArray(data?.keep) ? data.keep.filter((k) => typeof k === 'string') : []);
}

// 키트에서 빠진 파일은 설치본이 손대지 않은 것만 지운다. 설치 값 자리(정의 description 등)만 고친 것은 손대지 않은 것으로 본다.
function dropOrphans(ctx, entries, recorded, report) {
  const baseRoot = path.join(ctx.sub, '.kit-base');
  // 옛 해시 기록(--record-kit-hashes)은 설치본 스크립트 폴더 전체를 적어 설치본에서 더한 스크립트도 들어간다. 기준본(.kit-base)이 있는 설치는 그것으로만 가린다. 기록까지 보면 설치본 전용 스크립트를 키트에서 빠진 것으로 보고 지운다(2026-11-03 설치본 전용 검사 훅이 기대는 스크립트가 지워짐).
  const legacy = !fs.existsSync(baseRoot);
  const candidates = kitRemovedKeys(ctx, entries, legacy ? Object.keys(recorded ?? {}).filter((k) => /^subagent-system\/scripts\//.test(k)) : []);
  const renames = candidates.some((k) => /^(?:rules|skills)\//.test(k)) ? kitRenames(ctx) : new Map();
  report.renamed ??= [];
  // 묶음 일부만 내보낸 키트(공개판)로 갱신하면 빠진 묶음의 파일은 지우지 않고 남겨 알린다(공개판 갱신 때 빠진 기능 b, 2026-11-07). 쓰던 기능을 갱신 한 번에 잃지 않게 하려는 것이다.
  // 남기는 것은 omitted.json의 keep에 든 키(내보내기가 뺀 묶음 조각의 파일을 펼쳐 적음)뿐이다. 남은 묶음이 지우거나 이름 바꾼 파일은 영영 남지 않고 지워진다.
  const keep = omittedKeep(ctx);
  for (const key of candidates) {
    const dest = path.join(ctx.cfg, ...key.split('/'));
    const installed = readText(dest);
    const base = readText(path.join(baseRoot, ...key.split('/')));
    // 고른 선택 항목이 키트에서 이름만 바뀌었으면 새 이름을 깔아 고른 것을 잇는다.
    const to = installed !== null ? renames.get(key) : undefined;
    if (to && ctx.src.exists(`subagent-system/${to}`) && !fs.existsSync(path.join(ctx.cfg, ...to.split('/')))) {
      const text = adaptText(ctx, to, ctx.src.read(`subagent-system/${to}`));
      writeFile(ctx, path.join(ctx.cfg, ...to.split('/')), text);
      writeFile(ctx, path.join(baseRoot, ...to.split('/')), text);
      report.renamed.push({ from: key, to });
    }
    if (installed !== null) {
      const same = base !== null ? normEol(maskZones(key, installed)) === normEol(maskZones(key, base)) : typeof recorded?.[key] === 'string' && recorded[key] === legacyHashOf(key, installed);
      if (!same) {
        report.orphansKept.push(key);
        continue;
      }
      if (keep.has(key)) {
        (report.orphansLeft ??= []).push(key);
        continue;
      }
      if (!ctx.dry) fs.rmSync(dest);
      report.orphansRemoved.push(key);
    }
    if (!ctx.dry && base !== null) fs.rmSync(path.join(baseRoot, ...key.split('/')));
  }
  if (report.orphansLeft?.length && Array.isArray(report.notes)) {
    const left = report.orphansLeft;
    const shown = left.length > 30 ? `${left.slice(0, 30).join(', ')} 외 ${left.length - 30}개` : left.join(', ');
    report.notes.push(`이 키트에 없는 묶음의 파일 ${left.length}개를 지우지 않고 남겼습니다(orphansLeft): ${shown}. 더는 갱신되지 않는 옛 판입니다. 쓰지 않으면 설정 폴더(${slash(ctx.cfg)})에서 그 파일을 지우면 됩니다. 사용자에게 이 목록을 보여 줍니다.`);
  }
}

// 끊긴 처음 설치를 다른 선택으로 다시 돌리면 앞 설치가 놓은 선택 항목이 남는다. 키트가 놓은 그대로(.kit-base와 같음)면 지우고, 고쳤거나 키트가 놓지 않은 같은 이름이면 두고 알린다.
// 까닭: 남은 규칙은 「안 깔림」 보고와 달리 세션마다 읽히고, 다음 update는 디스크에 있는 것을 설치된 것으로 센다(22회차).
function dropUnchosen(ctx, defs, entries, command, report) {
  const have = new Set(entries.map((e) => e.key));
  const everything = entriesFor(defs, { bundles: selectableBundles(defs), options: optionIds(defs) }, { commandName: command });
  const keys = everything.filter((r) => (r.kind === 'merge' || r.kind === 'code') && !have.has(r.key) && !r.key.startsWith('agents/')).map((r) => r.key);
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
    for (const d of new Set(removed.filter((k) => k.startsWith('skills/')).map((k) => path.join(ctx.cfg, ...k.split('/').slice(0, 2))))) {
      if (fs.existsSync(d) && fs.readdirSync(d).length === 0) fs.rmdirSync(d);
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
function commitMsgNotes(ctx, config, report, keys) {
  // 검사 조각이 하나도 안 깔리는 설치(공개판 새로 깔기 등)에는 훅을 걸 까닭이 없어 안내하지 않는다.
  if (!keys.some((k) => /^subagent-system\/hooks\/git\/commit-msg\.d\/[^/]+\.c?js$/.test(k))) return;
  if (config.commitCheck !== 'block') {
    report.notes.push(`commit-msg 훅을 놓았지만 commitCheck가 ${JSON.stringify(config.commitCheck)}이라 걸 방법은 알리지 않습니다. 막으려면 commitCheck를 "block"으로 바꿉니다`);
    return;
  }
  const hooksPath = slash(path.join(ctx.sub, 'hooks', 'git'));
  report.commitMsgHook = { hooksPath, command: `git -C <저장소 폴더> config --local core.hooksPath "${hooksPath}"` };
  report.notes.push('commit-msg 훅은 쓸 저장소마다 사용자가 commitMsgHook.command를 돌려야 켜집니다. 전역으로는 걸지 않았습니다. 이 설정을 걸면 그 저장소의 .git/hooks 훅과 이미 걸린 core.hooksPath(husky 등)는 돌지 않으니 걸기 전에 확인합니다');
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

const kebab = (k) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

// 설치와 업데이트. 깔 파일은 고른 묶음(install은 --bundles와 --options, update는 깐 상태 기록 또는 추정)에서 나온다.
// 쓰는 차례: 새 파일 → 깐 상태 기록 → config.json → settings.json → VERSION. settings.json은 도는 세션에 바로 반영되므로 마지막에 쓴다.
function runSync(mode, rawArgs) {
  const opts = parseOptions(rawArgs);
  if (opts.positional.length) throw new Error(`모르는 인자: ${opts.positional.join(' ')}`);
  if (mode === 'update') {
    for (const k of ['profile', 'bundles', 'options', 'commandName', 'roles']) {
      if (opts[k] !== undefined) throw new Error(`update는 --${kebab(k)}를 받지 않습니다(profile은 set-profile, 묶음은 add와 remove)`);
    }
  }
  const ctx = makeContext(opts);
  ctx.mode = mode;
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

  const base = reconcileConfig({ ...oldConfig, ...(opts.commandName !== undefined && command !== 'retro' ? { commandName: command } : {}) }, profile, { freshInstall: mode === 'install' });
  const roles = opts.roles !== undefined ? splitList(opts.roles) : null;
  if (roles) base.next.roles = roles;
  const newConfig = base.next;

  const defs = loadBundleDefs(ctx, newConfig);
  const removedDefs = Array.isArray(newConfig.removedDefs) ? newConfig.removedDefs : [];
  const report = { mode, dryRun: ctx.dry, configDir: ctx.cfg, fromVersion: installedVersion, toVersion: kitVersion, profile, files: [], orphansRemoved: [], orphansKept: [], notes: [] };
  if (ctx.definitionWarnings.length) report.definitionWarnings = ctx.definitionWarnings;

  // 깔 묶음: install은 받은 답, update는 깐 상태 기록, 기록이 없는 옛 설치는 파일로 추정한다.
  const oldLock = lockApi.readLock(ctx.cfg);
  let selection;
  let estimated = false;
  if (mode === 'install') selection = parseSelection(defs, opts);
  else if (oldLock) {
    const s = selectionFromLock(defs, oldLock);
    selection = { bundles: s.bundles, options: s.options };
    if (s.missing.length) report.notes.push(`깐 상태 기록의 ${s.missing.join(', ')}는 정의를 찾지 못해 갱신에서 뺐습니다`);
  } else {
    selection = estimateSelection(ctx.cfg, defs, newConfig);
    estimated = true;
    report.notes.push(...selection.notes);
    report.notes.push(`깐 상태 기록(bundles.lock.json)이 없는 옛 설치라 깐 묶음을 파일로 추정해 기록을 만들었습니다: ${['base', ...selection.bundles].join(', ')}${selection.options.length ? ` (고른 항목 ${selection.options.join(', ')})` : ''}`);
  }
  report.bundles = ['base', ...selection.bundles];
  report.options = selection.options;
  // 깐 묶음이 주인인 키만 채운다: 이번에 새로 채워진 키 가운데 주인 묶음이 안 깔린 것은 되돌린다.
  for (const [k, owner] of Object.entries(PROFILE_KEY_OWNER)) {
    if (k in oldConfig || owner === 'base' || selection.bundles.includes(owner)) continue;
    delete newConfig[k];
    base.changes = base.changes.filter((c) => !c.startsWith(`${k}:`));
  }
  const selectable = selectableBundles(defs);
  const known = mode === 'update' && isObject(newConfig.knownBundles) ? newConfig.knownBundles : null;
  const knownList = (k) => (known && Array.isArray(known[k]) ? known[k] : []);
  report.newBundles = known ? selectable.filter((n) => !selection.bundles.includes(n) && !knownList('bundles').includes(n)).map((n) => ({ name: n, title: defs.bundles.get(n).title })) : [];
  report.newOptions = known ? optionIds(defs, { bundles: selection.bundles }).filter((id) => !selection.options.includes(id) && !knownList('options').includes(id)) : [];
  report.unchosenBundles = selectable.filter((n) => !selection.bundles.includes(n) && !report.newBundles.some((x) => x.name === n));
  report.unchosenOptions = optionIds(defs, { bundles: selection.bundles }).filter((id) => !selection.options.includes(id) && !report.newOptions.includes(id));
  newConfig.knownBundles = { bundles: selectable, options: optionIds(defs) };

  const entries = buildEntries(ctx, defs, selection, removedDefs, command);
  const kitEntries = kitOnly(entries);
  const recorded = isObject(newConfig.kitFileHashes) ? newConfig.kitFileHashes : null;
  if (base.retired.length) report.notes.push(retiredNote(base.retired, profile));
  report.notes.push(...base.notes);

  // 깐 상태 기록과 훅 등록 계획. 새 명령이 부르는 스크립트가 없으면 여기서 멈춘다(아무것도 쓰기 전).
  const lockCommand = mode === 'update' && !estimated ? 'update' : 'install';
  const lock2 = lockApi.mergeLock(estimated ? null : oldLock, { command: lockCommand, kitParts: kitPartsFor(defs, selection, kitCommitOf(ctx)), localParts: localPartsFor(defs, selection, estimated || mode === 'install' ? null : oldLock) });
  const plan = planHooks(ctx, { defs, lock: lock2, config: newConfig, entries });
  const gitAsk = planGitAsk(ctx, plan, { profile, config: newConfig, gitAsk: opts.gitAsk ? true : opts.noGitAsk ? false : mode === 'install', workGit: selection.bundles.includes('work-git') });

  const zones = migrateGuideZones(ctx);
  if (zones) report.legacyZones = zones;

  // 갱신 전에 커밋 검사가 있었는지(조각이 있었거나 옛 한 덩어리 commit-msg). 있던 검사가 이번 갱신으로 꺼질 때만 한 번 알리려는 것이다(공개판을 새로 깐 설치는 갱신마다 알리지 않는다).
  const commitPieces = () => {
    try {
      return fs.readdirSync(path.join(ctx.sub, 'hooks', 'git', 'commit-msg.d')).some((f) => /\.c?js$/.test(f));
    } catch {
      return false;
    }
  };
  const hadCommitCheck = mode === 'update' && (commitPieces() || (() => {
    const t = readText(path.join(ctx.sub, 'hooks', 'git', 'commit-msg'));
    return t !== null && !t.includes('git-dispatch');
  })());

  for (const e of kitEntries) {
    const guideWithZones = zones && e.key === 'subagent-system/docs/SUBAGENT_GUIDE.md';
    report.files.push(syncEntry(ctx, e, recorded, Boolean(guideWithZones)));
  }
  dropOrphans(ctx, kitEntries, recorded, report);
  if (mode === 'install') dropUnchosen(ctx, defs, kitEntries, command, report);
  // 공개판처럼 묶음 일부만 있는 키트로 갱신하면, commit-msg 이어 부르기는 깔려 있고 commitCheck도 검사로 남는데 검사 조각이 하나도 없어 소리 없이 꺼질 수 있다. 있던 검사가 이 갱신으로 꺼질 때만 알린다(다음 갱신에는 이미 조각이 없던 상태라 되풀이되지 않는다).
  if (hadCommitCheck && ctx.src.exists('bundles/omitted.json') && fs.existsSync(path.join(ctx.sub, 'hooks', 'git', 'commit-msg'))) {
    if (!commitPieces() && readConfig(ctx).config.commitCheck !== 'off') report.notes.push('이 갱신으로 커밋 메시지 검사가 꺼졌습니다. 검사 조각이 이 키트에 없어 commit-msg 훅이 아무것도 검사하지 않습니다. 검사를 쓰려면 그 조각이 든 키트로 갱신하고, 쓰지 않으면 사용자에게 묻고 --config-set으로 commitCheck를 "off"로 바꿉니다');
  }
  if (mode === 'update') {
    const moved = migrateRetroPending(ctx);
    if (moved) {
      report.retroPending = moved;
      report.notes.push(`옛 물을 것 ${moved.moved}건을 ${moved.file}의 제안 목록으로 옮겼습니다(같은 제목 ${moved.skippedSameTitle}건은 건너뜀). 원본은 ${moved.backup}에 남겼고, 사용자에게 물을 항목은 묻기 줄이 \`정책\`으로 달려 있으니 다음 회고가 한 번에 하나씩 묻습니다`);
    }
  }

  if (!ctx.dry) lockApi.writeLock(ctx.cfg, lock2);
  report.lock = { file: lockApi.lockPath(ctx.cfg), estimated, bundles: Object.keys(lock2.installed) };

  const configChanged = !configExists || JSON.stringify(oldConfig) !== JSON.stringify(newConfig);
  report.config = { file: configFile, created: !configExists, changes: base.changes };
  if (configChanged) {
    if (configExists) report.config.backup = backupBeside(ctx, configFile, mode);
    writeFile(ctx, configFile, `${JSON.stringify(newConfig, null, 2)}\n`);
  }
  if (syncProfileLine(ctx.cfg, profile, ctx.dry)) report.userSettingsProfileLine = 'updated';

  const settingsBackup = commitSettings(ctx, plan, mode);
  report.settings = { hooks: labelsOf(plan.changes), gitAsk, ...(settingsBackup ? { backup: settingsBackup } : {}) };
  if (mode === 'install') commitMsgNotes(ctx, newConfig, report, kitEntries.map((e) => e.key));

  const all = report.files;
  report.counts = all.reduce((c, f) => ({ ...c, [f.status]: (c[f.status] ?? 0) + 1 }), {});
  report.conflictFiles = all.filter((f) => f.status === 'conflict').map((f) => f.key);
  report.unresolvedFiles = all.filter((f) => f.status === 'unresolved-markers').map((f) => f.key);
  const fromGit = all.filter((f) => f.baseFrom);
  if (fromGit.length) report.notes.push(`.kit-base가 없어 키트 git 기록의 VERSION ${installedVersion} 커밋(${fromGit[0].baseFrom.slice(4)})에서 ${fromGit.length}개 파일의 기준본을 가져와 3방향으로 병합했습니다`);
  const rebuilt = all.filter((f) => f.description === 'rebuilt').map((f) => f.key);
  if (rebuilt.length) report.notes.push(`정의 ${rebuilt.length}개의 description을 라우팅 표에서 다시 만들었습니다(${rebuilt.join(', ')})`);
  const codeOverwritten = all.filter((f) => f.status === 'overwritten-modified' && /^(subagent-system\/(scripts|hooks)|hooks)\//.test(f.key)).map((f) => f.key);
  if (codeOverwritten.length) report.notes.push(`스크립트와 훅은 병합하지 않고 키트 것으로 바꿉니다. 사용자가 고친 것으로 보이는 ${codeOverwritten.length}개(${codeOverwritten.join(', ')})가 바뀌었으니 옆 백업과 새 파일의 차이를 보고 다시 넣을 변경을 정하세요`);
  report.files = all.filter((f) => !['added', 'unchanged', 'replaced', 'kept'].includes(f.status) || f.backup || f.description === 'rebuilt');
  if (report.unresolvedFiles.length) report.notes.push('충돌 표시가 남은 파일은 건드리지 않았습니다. 표시를 풀고 update를 다시 돌리세요');
  if (zones?.userRulesFile) report.notes.push(`옛 사용자 규칙 ${zones.userRules}줄을 ${zones.userRulesFile}에 옮겼습니다. 정책이면 CLAUDE.md로, 방법이면 규칙 파일로 나눠 옮기세요`);
  const localFiles = entries.filter((e) => e.kind === 'local').length;
  if (localFiles) report.localPartFiles = localFiles;

  writeFile(ctx, versionFile, `${kitVersion}\n`);
  report.claudeMd = claudeMdReport(ctx, newConfig);
  console.log(JSON.stringify(report, null, 2));
}

// 키트가 놓은 파일 가운데 설치본이 손대지 않은 것은 지우고, 손댄 것은 옆에 .bak-uninstall로 옮겨 남긴다.
// 로컬 조각 파일은 설치본이 정본이라 지우지 않는다. 훅 등록은 이름표 달린 것과 옛 꼴 키트 훅을 모두 뺀다(로컬 조각 장치 등록도 뺀다).
function uninstall(rawArgs) {
  const opts = parseOptions(rawArgs);
  if (opts.positional.length) throw new Error(`모르는 인자: ${opts.positional.join(' ')}`);
  if (opts.records === undefined) throw new Error('--records keep|delete|<옮길 경로>가 필요합니다');
  const ctx = makeContext(opts);
  const { config } = readConfig(ctx);
  const defs = loadBundleDefs(ctx, config);
  const command = config.commandName ?? 'retro';
  const everything = buildEntries(ctx, defs, { bundles: selectableBundles(defs), options: optionIds(defs) }, [], command);
  const entries = kitOnly(everything);
  const localFiles = everything.filter((e) => e.kind === 'local').map((e) => e.key);
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
  const hookResult = st ? syncHooks(st.s, { defs, lock: { lockVersion: 1, installed: {} }, config, configDir: hooksConfigDir(ctx.cfg) }) : null;
  const dropped = hookResult ? hookResult.changes.removed : [];
  report.hooksRemoved = dropped.length;
  const localLabels = new Set(defs.parts.filter((p) => p.origin === 'local').flatMap((p) => p.hooks.map((h) => `${p.bundle}/${h.name}`)));
  const localDropped = [...new Set(dropped.filter((x) => x.label && localLabels.has(x.label)).map((x) => x.label))];
  if (localDropped.length) {
    report.localHooksRemoved = localDropped;
    report.notes.push(`로컬 조각 장치 등록도 뺌: ${localDropped.join(', ')}. 장치 파일은 남기고, 다시 걸려면 kit-setup.js install로 깔 때 local-bundles 정의에서 다시 맞춰집니다`);
  }
  if (dropped.length) {
    report.settingsBackup = backupBeside(ctx, st.f, 'uninstall');
    if (!ctx.dry) {
      st.s = hookResult.settings;
      saveSettings(st);
    }
  }
  if (localFiles.length) report.localPartFilesKept = localFiles;
  if (st && Array.isArray(st.s.permissions?.ask)) report.notes.push('permissions.ask의 git 확인 항목은 설치 전부터 있었는지 알 수 없어 그대로 둡니다');

  // 승인 창 기록은 훅이 쌓은 사용자 쪽 기록이라 지우지 않고 남는다고 알린다(없으면 알리지 않는다).
  const askLog = path.join(ctx.cfg, 'permission-asks.jsonl');
  if (fs.existsSync(askLog)) report.notes.push(`승인 창 기록 ${askLog}은 지우지 않고 남깁니다. 필요 없으면 직접 지우세요`);
  // git 훅은 저장소마다 core.hooksPath로 걸었으므로 파일을 지워도 그 설정은 남아 저장소의 .git/hooks가 계속 돌지 않는다.
  report.notes.push('git 훅을 건 저장소가 있으면 git -C <저장소> config --local --unset core.hooksPath 로 풀어야 그 저장소의 .git/hooks가 다시 돕니다');

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
  for (const f of ['config.json', `docs/${MIGRATED_RULES_FILE}`, 'docs/ROUTING_TABLE.md', 'kept-values.json']) {
    const file = path.join(ctx.sub, ...f.split('/'));
    if (fs.existsSync(file)) away(file);
  }
  const lockFile = lockApi.lockPath(ctx.cfg);
  if (fs.existsSync(lockFile)) {
    if (!ctx.dry) fs.rmSync(lockFile);
    report.removed.push('subagent-system/bundles.lock.json');
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
    for (const d of new Set(entries.filter((e) => e.key.startsWith('skills/')).map((e) => path.join(ctx.cfg, ...e.key.split('/').slice(0, 2))))) {
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
  if (syncProfileLine(configDir(), opts.positional[0], false)) notes.push('설정 문서(USER_SETTINGS.md)의 사용 방식 줄도 맞췄습니다');
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

// 설치본의 install 값 보관 자리다. 묶음을 뺄 때 설치 값 자리(정의 description 줄, 체크리스트 「이 설치에서 더한 줄」, rates.json)를 여기 두고, 다시 넣을 때 되살린다.
const keptValuesFile = (ctx) => path.join(ctx.sub, 'kept-values.json');
function readKeptValues(ctx) {
  const text = readText(keptValuesFile(ctx));
  if (text === null) return {};
  try {
    const parsed = JSON.parse(text);
    return isObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
function writeKeptValues(ctx, kept) {
  if (ctx.dry) return;
  const file = keptValuesFile(ctx);
  if (!Object.keys(kept).length) {
    if (fs.existsSync(file)) fs.rmSync(file);
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(kept, null, 2)}\n`);
}

// 깐 상태 기록을 읽고, 없으면(옛 설치) 파일로 추정한 기록을 메모리에 짠다.
function lockOrEstimate(ctx, defs, config) {
  const lock = lockApi.readLock(ctx.cfg);
  if (lock) return { lock, estimated: false };
  const selection = estimateSelection(ctx.cfg, defs, config);
  return { lock: lockApi.mergeLock(null, { command: 'install', kitParts: kitPartsFor(defs, selection, null), localParts: localPartsFor(defs, selection) }), estimated: true };
}

function addRemoveContext(rawArgs, mode) {
  const opts = parseOptions(rawArgs);
  if (opts.positional.length) throw new Error(`모르는 인자: ${opts.positional.join(' ')}`);
  for (const k of ['profile', 'commandName', 'roles', 'records']) if (opts[k] !== undefined) throw new Error(`${mode}는 --${kebab(k)}를 받지 않습니다`);
  if (opts.bundles === undefined) throw new Error(`--bundles로 ${mode === 'add' ? '더할' : '뺄'} 묶음을 주세요`);
  const ctx = makeContext(opts);
  ctx.mode = mode;
  if (readText(path.join(ctx.sub, 'VERSION')) === null) throw new Error('설치본 VERSION이 없습니다. 먼저 install을 돌리세요');
  const { config } = readConfig(ctx);
  const defs = loadBundleDefs(ctx, config);
  const { lock, estimated } = lockOrEstimate(ctx, defs, config);
  return { opts, ctx, config, defs, lock, estimated };
}

// 설치 뒤 묶음을 더한다. 이미 있는 파일은 건드리지 않고 skipped로 알린다. 뺄 때 보관한 설치 값이 있으면 키트 원문 위에 되살린다.
function addCommand(rawArgs) {
  const { opts, ctx, config, defs, lock, estimated } = addRemoveContext(rawArgs, 'add');
  const cur = selectionFromLock(defs, lock);
  const want = parseSelection(defs, opts, { requireBoth: false, base: { bundles: cur.bundles } });
  const optionBundles = want.options.map((id) => id.split('.')[0]);
  const targets = [...new Set([...want.bundles, ...optionBundles])];
  if (!targets.length) throw new Error('더할 묶음이나 고를 항목이 없습니다');
  const selection = { bundles: [...new Set([...cur.bundles, ...want.bundles])], options: [...new Set([...cur.options, ...want.options])] };
  const command = config.commandName ?? 'retro';
  const removedDefs = Array.isArray(config.removedDefs) ? config.removedDefs : [];
  const entries = buildEntries(ctx, defs, selection, removedDefs, command);
  const mine = kitOnly(entries).filter((e) => targets.includes(e.bundle));

  const lock2 = lockApi.mergeLock(lock, { command: 'add', bundles: targets, kitParts: kitPartsFor(defs, selection, kitCommitOf(ctx)), localParts: localPartsFor(defs, selection, estimated ? null : lock) });
  const profile = profileOf(config);
  // 새로 더하는 묶음이 주인인 설정 키가 없으면 안전한 쪽(retroWriteAllow는 끔)으로 채운다. 켜는 것은 사용자가 답한 뒤 --config-set으로 한다.
  const configNext = { ...config };
  const filled = [];
  for (const [k, owner] of Object.entries(PROFILE_KEY_OWNER)) {
    if (k in configNext || !want.bundles.includes(owner)) continue;
    configNext[k] = k === 'retroWriteAllow' ? false : PROFILES[profile][k];
    filled.push(`${k}: 없음 -> ${JSON.stringify(configNext[k])}`);
  }
  const plan = planHooks(ctx, { defs, lock: lock2, config: configNext, entries });
  const gitAsk = planGitAsk(ctx, plan, { profile, config: configNext, gitAsk: Boolean(opts.gitAsk), workGit: want.bundles.includes('work-git') });

  const kept = readKeptValues(ctx);
  const added = [];
  const skipped = [];
  const restored = [];
  for (const e of mine) {
    if (fs.existsSync(e.dest)) {
      skipped.push(e.key);
      continue;
    }
    let text = e.text;
    const k = kept[e.key];
    if (k) {
      if (e.kind === 'rates') {
        const p = planRates({ installed: k.whole, next: e.text });
        text = p.status === 'merged' ? p.text : k.whole;
      } else text = overlayZones(e.key, e.text, k.whole);
      restored.push(e.key);
      delete kept[e.key];
    }
    writeFile(ctx, e.dest, text);
    markExecutable(ctx, e);
    if (e.kind === 'merge' || e.kind === 'code') writeFile(ctx, path.join(ctx.sub, '.kit-base', ...e.key.split('/')), e.text);
    added.push(e.key);
  }
  if (restored.length) writeKeptValues(ctx, kept);
  if (!ctx.dry) lockApi.writeLock(ctx.cfg, lock2);
  if (filled.length && !ctx.dry) writeJson(path.join(ctx.sub, 'config.json'), configNext);
  const settingsBackup = commitSettings(ctx, plan, 'add');
  const out = {
    mode: 'add', dryRun: ctx.dry, configDir: ctx.cfg, bundles: targets, added, skipped, restoredValues: restored, ...(filled.length ? { configFilled: filled } : {}),
    lock: { file: lockApi.lockPath(ctx.cfg), estimated }, settings: { hooks: labelsOf(plan.changes), gitAsk, ...(settingsBackup ? { backup: settingsBackup } : {}) }, notes: [],
  };
  if (estimated) out.notes.push('깐 상태 기록이 없는 옛 설치라 깐 묶음을 파일로 추정해 기록을 만들었습니다');
  if (added.some((k) => k.startsWith('subagent-system/hooks/git/'))) commitMsgNotes(ctx, config, out, added);
  console.log(JSON.stringify(out, null, 2));
}

const ZONE_KEYS = (key) => key === CHECKLIST_KEY || DEF_KEY_RE.test(key);

// 묶음을 뺀다(설계 5.3). 키트 조각 파일은 키트가 놓은 그대로면 지우고 고쳤으면 옆 백업으로 옮긴다. 설치 값 자리는 보관한다. 로컬 조각 파일, 설정 키, 기록은 남긴다.
function removeCommand(rawArgs) {
  const { opts, ctx, config, defs, lock, estimated } = addRemoveContext(rawArgs, 'remove');
  const names = [...new Set(splitList(opts.bundles))];
  if (names.includes('base')) throw new Error('바닥(base)은 remove로 뺄 수 없습니다. 모두 빼려면 uninstall을 쓰세요');
  for (const n of names) if (!lock.installed[n]) throw new Error(`깔려 있지 않은 묶음: ${n}`);
  const cur = selectionFromLock(defs, lock);
  const command = config.commandName ?? 'retro';
  const removedDefs = Array.isArray(config.removedDefs) ? config.removedDefs : [];
  const now = buildEntries(ctx, defs, { bundles: cur.bundles, options: cur.options }, removedDefs, command);
  const targets = kitOnly(now).filter((e) => names.includes(e.bundle));
  const localKept = now.filter((e) => e.kind === 'local' && names.includes(e.bundle)).map((e) => e.key);
  const nextSel = { bundles: cur.bundles.filter((n) => !names.includes(n)), options: cur.options.filter((o) => !names.includes(o.split('.')[0])) };
  const rest = buildEntries(ctx, defs, nextSel, removedDefs, command);

  const lock2 = lockApi.mergeLock(lock, { command: 'remove', bundles: names });
  const plan = planHooks(ctx, { defs, lock: lock2, config, entries: rest });
  // 사용자 훅(이름표 없는 명령)이 지울 파일을 부르면 그 파일은 지우지 않는다.
  const userCommands = Object.values(plan.next.hooks ?? {}).flatMap((groups) => (Array.isArray(groups) ? groups : []))
    .flatMap((g) => (Array.isArray(g?.hooks) ? g.hooks : [])).map((h) => String(h?.command ?? '')).filter((c) => c && !labelOf(c));

  const kept = readKeptValues(ctx);
  const baseRoot = path.join(ctx.sub, '.kit-base');
  const report = { mode: 'remove', dryRun: ctx.dry, configDir: ctx.cfg, bundles: names, removed: [], backedUp: [], keptValues: [], keptForUserHooks: [], notes: [] };
  if (estimated) report.notes.push('깐 상태 기록이 없는 옛 설치라 깐 묶음을 파일로 추정해 기록을 만들었습니다');
  // 쓰는 차례: settings.json의 훅 등록, 깐 상태 기록, 파일 지우기. 거꾸로 하면 그 사이에 도는 세션이 지워진 스크립트를 부른다(설계 1.5).
  const settingsBackup = commitSettings(ctx, plan, 'remove');
  report.settings = { hooks: labelsOf(plan.changes), ...(settingsBackup ? { backup: settingsBackup } : {}) };
  if (!ctx.dry) lockApi.writeLock(ctx.cfg, lock2);
  for (const e of targets) {
    if (e.kind === 'once') {
      report.notes.push(`${e.key}는 설치 값이라 지우지 않았습니다`);
      continue;
    }
    const installed = readText(e.dest);
    if (installed === null) continue;
    const useHook = userCommands.find((c) => slash(c).includes(e.key));
    if (useHook) {
      report.keptForUserHooks.push({ key: e.key, command: useHook });
      continue;
    }
    const baseText = readText(path.join(baseRoot, ...e.key.split('/')));
    const ref = baseText ?? e.text;
    let saved = false;
    if (e.kind === 'rates' && normEol(installed) !== normEol(e.text)) {
      kept[e.key] = { whole: installed, savedAt: new Date().toISOString() };
      saved = true;
    } else if (ZONE_KEYS(e.key) && zoneOf(e.key, installed) !== zoneOf(e.key, e.text)) {
      kept[e.key] = { zones: zoneOf(e.key, installed), whole: installed, savedAt: new Date().toISOString() };
      saved = true;
    }
    if (saved) report.keptValues.push(e.key);
    const untouched = e.kind === 'rates' ? saved || normEol(installed) === normEol(ref) : normEol(maskZones(e.key, installed)) === normEol(maskZones(e.key, ref));
    if (untouched) {
      if (!ctx.dry) fs.rmSync(e.dest);
      report.removed.push(e.key);
    } else {
      const b = freePath(`${e.dest}.bak-remove-${ctx.stampStr}`);
      if (!ctx.dry) fs.renameSync(e.dest, b);
      report.backedUp.push(b);
    }
    if (!ctx.dry) fs.rmSync(path.join(baseRoot, ...e.key.split('/')), { force: true });
  }
  if (!ctx.dry) {
    for (const d of new Set(targets.filter((e) => e.key.startsWith('skills/')).map((e) => path.join(ctx.cfg, ...e.key.split('/').slice(0, 2))))) {
      if (fs.existsSync(d) && !fs.readdirSync(d).length) fs.rmdirSync(d);
    }
  }
  if (report.keptValues.length) writeKeptValues(ctx, kept);

  if (report.keptForUserHooks.length) report.notes.push(`사용자 훅이 부르는 키트 파일 ${report.keptForUserHooks.length}개는 지우지 않았습니다: ${report.keptForUserHooks.map((x) => x.key).join(', ')}. 훅을 먼저 고치거나 빼고 다시 remove를 돌리세요`);
  if (localKept.length) {
    report.localPartFilesKept = localKept;
    report.notes.push(`로컬 조각 파일은 남김(${localKept.length}개)`);
  }
  const configKeys = names.flatMap((n) => defs.bundles.get(n)?.configKeys ?? []).filter((k) => k in config);
  const records = names.flatMap((n) => defs.bundles.get(n)?.records ?? []);
  if (configKeys.length) report.configKeysKept = configKeys;
  if (records.length) report.recordsKept = records;
  const dependents = [];
  for (const [n, entry] of Object.entries(lock2.installed)) {
    const bundleUses = defs.bundles.get(n)?.uses ?? [];
    const partUses = Object.keys(entry.parts ?? {}).flatMap((part) => defs.parts.find((p) => p.bundle === n && p.part === part)?.uses ?? []);
    for (const u of [...bundleUses, ...partUses]) if (names.includes(u.bundle)) dependents.push({ bundle: n, uses: u.bundle, link: u.link, without: u.without });
  }
  if (dependents.length) report.dependents = dependents;
  console.log(JSON.stringify(report, null, 2));
}

// ---- 원본과 설치본의 차이 보기, 맞추기, 정의 description, 커밋 때 검사 ----

// 키트가 놓는 파일 목록이다. 원본 HEAD를 설치 때와 같은 변환을 거쳐 읽고, 깐 묶음은 깐 상태 기록(없으면 파일로 추정)에서 읽는다. 로컬 조각 파일은 목록에 넣지 않고 ctx.localEntries에 둔다.
function headEntries(ctx) {
  const defs = loadBundleDefs(ctx, ctx.config);
  const lock = lockApi.readLock(ctx.cfg);
  const sel = lock ? selectionFromLock(defs, lock) : estimateSelection(ctx.cfg, defs, ctx.config);
  const selection = { bundles: sel.bundles, options: sel.options };
  const removedDefs = Array.isArray(ctx.config.removedDefs) ? ctx.config.removedDefs : [];
  const all = buildEntries(ctx, defs, selection, removedDefs, ctx.config.commandName ?? 'retro');
  ctx.defs = defs;
  ctx.selection = selection;
  ctx.lock = lock;
  ctx.localEntries = all.filter((e) => e.kind === 'local');
  return kitOnly(all);
}

const SKIP_EXTRA = (rel) => /\.bak(-|$)/.test(rel) || rel.split('/').includes('__pycache__');
const INSTALL_VALUE_FILES = ['subagent-system/config.json', 'docs/PROPOSALS.md', 'subagent-system/docs/MIGRATED_USER_RULES.md', 'subagent-system/records'];

// 키트가 놓지 않았는데 설치본에 있는 파일이다. 키트 밖에서 만든 일반 장치(hooks, 스크립트, 정의, 규칙)를 찾으려는 것이고, 스킬은 폴더 이름만 센다.
function installedExtras(ctx, entries, removed = [], localKeys = []) {
  const have = new Set([...entries.map((e) => e.key), ...removed, ...localKeys]);
  const out = [];
  const scan = (dir, { recursive = true, skip = [] } = {}) => {
    const abs = path.join(ctx.cfg, dir);
    if (!fs.existsSync(abs)) return;
    const files = recursive ? listFiles(abs) : fs.readdirSync(abs, { withFileTypes: true }).filter((x) => x.isFile() && !x.name.startsWith('.')).map((x) => x.name).sort();
    for (const f of files) {
      const key = `${dir}/${f}`;
      if (have.has(key) || skip.includes(f) || SKIP_EXTRA(key)) continue;
      out.push(key);
    }
  };
  scan('hooks');
  scan('subagent-system/scripts');
  scan('subagent-system/hooks');
  scan('subagent-system/docs', { skip: ['ROUTING_TABLE.md', 'MIGRATED_USER_RULES.md'] });
  scan('agents', { recursive: false });
  scan('rules', { recursive: false });
  const skillsDir = path.join(ctx.cfg, 'skills');
  if (fs.existsSync(skillsDir)) {
    const kitSkills = new Set(entries.filter((e) => e.key.startsWith('skills/')).map((e) => e.key.split('/')[1]));
    for (const e of fs.readdirSync(skillsDir, { withFileTypes: true })) if (e.isDirectory() && !e.name.startsWith('.') && !kitSkills.has(e.name)) out.push(`skills/${e.name}/`);
  }
  return out;
}

// 깐 상태 기록과 settings.json의 훅 등록 차이. 기록이 없거나 settings.json을 못 읽으면 null이다.
function hookRegistrationDiff(ctx) {
  if (!ctx.lock) return null;
  try {
    const st = openSettings(path.join(ctx.cfg, 'settings.json'));
    const r = syncHooks(st.s, { defs: ctx.defs, lock: ctx.lock, config: ctx.config, configDir: hooksConfigDir(ctx.cfg) });
    const l = labelsOf(r.changes);
    return { added: l.added, removed: l.removed, replaced: l.replaced, unknownKept: l.unknownKept };
  } catch {
    return null;
  }
}

// 설정 문서의 「사용 방식」 줄이 config의 profile과 다른지 본다(원본은 config).
function profileLineMismatch(ctx) {
  const r = userSettingsApi.readUserSettings(ctx.cfg);
  if (r.sources.profileLine !== 'settings' || !PROFILES[ctx.config.profile]) return null;
  return r.values.profileLine === PROFILE_LINE[ctx.config.profile] ? null : { document: r.values.profileLine, config: PROFILE_LINE[ctx.config.profile] };
}

function diffCommand(rawArgs) {
  const opts = parseOptions(rawArgs);
  if (opts.positional.length) throw new Error(`모르는 인자: ${opts.positional.join(' ')}`);
  const ctx = makeHeadContext(opts);
  const entries = headEntries(ctx);
  const markers = ctx.config.personalMarkers;
  const files = [];
  const installValues = [];
  for (const e of entries) {
    if (e.kind === 'once' || e.kind === 'rates') {
      if (fs.existsSync(e.dest)) installValues.push(e.key);
      continue;
    }
    const installed = readText(e.dest);
    let base = readText(path.join(ctx.sub, '.kit-base', ...e.key.split('/')));
    if (base === null && installed !== null) base = gitBaseText(ctx, e);
    const c = classifyFile({ key: e.key, installed, base, kit: e.text });
    const row = { key: e.key, part: `${e.bundle}.${e.part}`, status: c.status };
    if (c.noBase) row.noBase = true;
    if (c.status === STATUS.installedOnly || c.status === STATUS.both) {
      row.changedLines = c.changed.length;
      row.markers = markersIn(c.changed, markers);
    }
    files.push(row);
  }
  for (const f of INSTALL_VALUE_FILES) if (fs.existsSync(path.join(ctx.cfg, ...f.split('/')))) installValues.push(f);
  // 키트에서 지운 파일은 「설치본에만 있음」과 갈라 보인다. 섞으면 sync로 치울 것을 설치본 장치로 읽는다(설치본 검수 6회차 5번).
  const removed = kitRemovedKeys(ctx, entries).filter((k) => fs.existsSync(path.join(ctx.cfg, ...k.split('/'))));
  const localKeys = ctx.localEntries.map((e) => e.key);
  const extras = installedExtras(ctx, entries, removed, localKeys);
  const counts = Object.fromEntries(Object.values(STATUS).map((v) => [v, 0]));
  for (const f of files) counts[f.status] += 1;
  counts[STATUS.installedExtra] = extras.length;
  counts['kit-removed'] = removed.length;
  const execMissing = entries.filter(lacksExec).map((e) => e.key);
  counts['exec-missing'] = execMissing.length;
  const renames = removed.some((k) => /^(?:rules|skills)\//.test(k)) ? kitRenames(ctx) : new Map();
  const kitRenamed = removed.filter((k) => renames.has(k)).map((k) => ({ from: k, to: renames.get(k) }));
  const hookDiff = hookRegistrationDiff(ctx);
  const profileLine = profileLineMismatch(ctx);
  const result = {
    configDir: ctx.cfg, kit: ctx.kit, kitHead: ctx.src.head, counts, files: files.filter((f) => f.status !== STATUS.same), kitRemoved: removed, kitRenamed, execMissing, installedExtra: extras, installValues,
    localParts: { files: localKeys.length, keys: localKeys },
    ...(hookDiff ? { hookRegistrations: hookDiff } : {}),
    ...(profileLine ? { profileLine } : {}),
  };
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const label = {
    [STATUS.same]: '같음',
    [STATUS.kitAhead]: '키트가 앞섬(sync로 받음)',
    [STATUS.installedZone]: '설치본만 고침(설치 값 자리 안)',
    [STATUS.installedOnly]: '설치본만 고침(설치 값 자리 밖, 키트로 올릴 후보)',
    [STATUS.both]: '둘 다 고침',
    [STATUS.kitOnly]: '키트에만 있음',
  };
  const out = [`설치본 ${ctx.cfg}`, `원본 ${ctx.kit} (HEAD ${ctx.src.head.slice(0, 7)})`, ''];
  for (const st of Object.keys(label)) {
    const rows = files.filter((f) => f.status === st);
    out.push(`${label[st]}: ${rows.length}`);
    if (st !== STATUS.same) {
      for (const r of rows) out.push(`  ${r.key}${r.markers?.length ? `  [개인 표지: ${r.markers.join(', ')}]` : ''}${r.noBase ? '  (기준본 없음)' : ''}`);
    }
  }
  out.push(`키트에서 지움(sync가 치움, 설치본에서 고쳤으면 남김): ${removed.length}`, ...removed.map((k) => `  ${k}${renames.has(k) ? `  (키트에서 ${renames.get(k)}로 이름 바뀜, sync가 새 이름을 깜)` : ''}`));
  out.push(`실행 권한 빠짐(sync가 되살림): ${execMissing.length}`, ...execMissing.map((k) => `  ${k}`));
  out.push(`설치본에만 있음: ${extras.length}`, ...extras.map((k) => `  ${k}`));
  out.push(`설치 값(따로 둠): ${installValues.length}`, ...installValues.map((k) => `  ${k}`));
  out.push(`로컬 조각(비교하지 않음): ${localKeys.length}`, ...localKeys.map((k) => `  ${k}`));
  if (hookDiff) {
    out.push(`훅 등록 차이(update나 sync가 맞춤): 더함 ${hookDiff.added.length}, 뺌 ${hookDiff.removed.length}, 갈아 끼움 ${hookDiff.replaced.length}`, ...hookDiff.added.map((x) => `  더함 ${x}`), ...hookDiff.removed.map((x) => `  뺌 ${x}`), ...hookDiff.replaced.map((x) => `  갈아 끼움 ${x.label} (${x.event})`));
    if (hookDiff.unknownKept.length) out.push(`  정의를 못 읽어 둠: ${hookDiff.unknownKept.join(', ')}`);
  }
  if (profileLine) out.push(`사용 방식 줄이 config와 다름: 설정 문서 ${profileLine.document}, config ${profileLine.config}`);
  console.log(out.join('\n'));
}

// 설치본이 그 폴더 자체를 저장소로 쓰고 이 파일이 깨끗하게 추적되는 중이면 true다. 이때는 덮어써도 git이 옛 글을 지켜 주므로 백업을 따로 두지 않는다.
function gitKeepsFile(cfg, file) {
  const top = gitOut(cfg, ['rev-parse', '--show-toplevel']);
  if (top === null) return false;
  try {
    if (fs.realpathSync(top.trim()) !== fs.realpathSync(cfg)) return false;
  } catch {
    return false;
  }
  const rel = slash(path.relative(cfg, file));
  if (gitOut(cfg, ['ls-files', '--error-unmatch', '--', rel]) === null) return false;
  return (gitOut(cfg, ['status', '--porcelain', '--', rel]) ?? 'x').trim() === '';
}

// 원본 HEAD를 변환해 키트가 놓는 파일만 설치본에 덮고 .kit-base를 새로 쓴다. 설치 값 자리(체크리스트 절, 정의 description)는 설치본 것을 지킨다.
// config, retroMode, VERSION, 라우팅 표, rates.json, 선택 항목 고르기는 건드리지 않는다. 로컬 조각 파일은 쓰지 않는다. 깐 상태 기록의 훅 사본과 settings.json의 훅 등록은 원본 HEAD의 정의에 맞춘다.
function syncCommand(rawArgs) {
  const opts = parseOptions(rawArgs);
  if (opts.positional.length) throw new Error(`모르는 인자: ${opts.positional.join(' ')}`);
  const ctx = makeHeadContext(opts, { requireSourcePath: true });
  const all = headEntries(ctx);
  const entries = all.filter((e) => e.kind === 'merge' || e.kind === 'code');
  const report = { mode: 'sync', dryRun: ctx.dry, configDir: ctx.cfg, kit: ctx.kit, kitHead: ctx.src.head, files: [], counts: {}, execRestored: [], orphansRemoved: [], orphansKept: [] };
  let lock2 = null;
  let plan = null;
  if (ctx.lock) {
    lock2 = lockApi.mergeLock(ctx.lock, { command: 'sync', kitParts: kitPartsFor(ctx.defs, ctx.selection, ctx.src.head.slice(0, 7)), localParts: localPartsFor(ctx.defs, ctx.selection, ctx.lock) });
    plan = planHooks(ctx, { defs: ctx.defs, lock: lock2, config: ctx.config, entries: all });
  }
  for (const e of entries) {
    const installed = readText(e.dest);
    const baseFile = path.join(ctx.sub, '.kit-base', ...e.key.split('/'));
    const base = readText(baseFile);
    const target = overlayZones(e.key, e.text, installed);
    const row = { key: e.key };
    if (installed === null) {
      row.status = 'added';
    } else if (normEol(installed) === normEol(target)) {
      row.status = 'unchanged';
    } else {
      row.status = 'overwritten';
      const untouched = base !== null && normEol(maskZones(e.key, installed)) === normEol(maskZones(e.key, base));
      if (!untouched && !gitKeepsFile(ctx.cfg, e.dest)) row.backup = backupBeside(ctx, e.dest, 'sync');
    }
    if (row.status !== 'unchanged') {
      writeFile(ctx, e.dest, target);
      markExecutable(ctx, e);
    } else if (lacksExec(e)) {
      markExecutable(ctx, e);
      report.execRestored.push(e.key);
    }
    if (base !== e.text) writeFile(ctx, baseFile, e.text);
    report.counts[row.status] = (report.counts[row.status] ?? 0) + 1;
    if (row.status !== 'unchanged') report.files.push(row);
  }
  // 키트에서 지운 파일도 치운다. 덮어쓰기만 하면 지운 규칙과 스크립트가 설치본에 남아 계속 읽히고 돈다(설치본 검수 6회차 5번).
  dropOrphans(ctx, all, null, report);
  if (lock2) {
    if (!ctx.dry) lockApi.writeLock(ctx.cfg, lock2);
    const backup = commitSettings(ctx, plan, 'sync');
    report.settings = { hooks: labelsOf(plan.changes), ...(backup ? { backup } : {}) };
  }
  console.log(JSON.stringify(report, null, 2));
}

// 라우팅 표에서 정의 description을 다시 만든다. 회고가 표를 고친 뒤 부르고, update는 같은 규칙을 병합 뒤에 적용한다.
// 첫 문장은 --kit이 있으면 그 원본 HEAD의 정의에서, 없으면 설치본 정의의 것을 쓴다.
function descriptionsCommand(rawArgs) {
  const opts = parseOptions(rawArgs);
  if (opts.positional.length) throw new Error(`모르는 인자: ${opts.positional.join(' ')}`);
  const ctx = { cfg: configDir(), sub: path.join(configDir(), 'subagent-system') };
  const tableFile = path.join(ctx.sub, 'docs', 'ROUTING_TABLE.md');
  const tableText = readText(tableFile);
  if (tableText === null) throw new Error(`라우팅 표가 없습니다: ${tableFile}`);
  const { byDef, problems } = tableKindsByDef(tableText);
  if (problems.length) throw new Error(`라우팅 표를 읽지 못했습니다: ${problems.join('; ')}`);
  ctx.tableKinds = byDef;
  const kitSrc = opts.kit ? headSource(path.resolve(opts.kit)) : null;
  const report = { mode: 'descriptions', dryRun: Boolean(opts.dryRun), updated: [], unchanged: [], skipped: [] };
  for (const def of byDef.keys()) {
    const key = `agents/${def}.md`;
    const dest = path.join(ctx.cfg, ...key.split('/'));
    const installed = readText(dest);
    if (installed === null) {
      report.skipped.push({ def, reason: '정의 파일이 없음' });
      continue;
    }
    const kitText = kitSrc && kitSrc.exists(`subagent-system/${key}`) ? adaptText(ctx, key, kitSrc.read(`subagent-system/${key}`)) : installed;
    const line = defDescriptionLine(ctx, key, installed, kitText);
    if (line === null) {
      report.unchanged.push(def);
      continue;
    }
    if (!opts.dryRun) fs.writeFileSync(dest, withDescriptionBlock(installed, line));
    report.updated.push(def);
  }
  console.log(JSON.stringify(report, null, 2));
}

// 커밋 때 검사. ~/.claude 저장소의 pre-commit 훅이 부른다. 올린(staged) 파일 가운데 키트가 놓은 파일이 원본 HEAD(변환 뒤)와 다르고 설치 값 자리 밖이면 막는다.
// 까닭: 고정 파일을 설치본에서만 고치면 원본과 벌어져 공통 개선이 키트로 올라가지 않는다. config에 kitSourcePath가 있을 때만 켜지고, 이 설치 저장소가 아닌 저장소의 커밋은 보지 않는다.
function checkStagedCommand(rawArgs) {
  parseOptions(rawArgs);
  if (process.env[SKIP_ENV] === '1') {
    console.error(`${SKIP_ENV}=1이라 키트 고정 파일 검사를 건너뜁니다`);
    return;
  }
  const cfg = configDir();
  const top = gitOut(process.cwd(), ['rev-parse', '--show-toplevel']);
  try {
    if (top === null || fs.realpathSync(top.trim()) !== fs.realpathSync(cfg)) return;
  } catch {
    return;
  }
  const text = readText(path.join(cfg, 'subagent-system', 'config.json'));
  let config;
  try {
    config = text === null ? {} : JSON.parse(text);
  } catch {
    return;
  }
  if (!isObject(config) || typeof config.kitSourcePath !== 'string' || config.kitSourcePath.trim() === '') return;
  let ctx;
  try {
    ctx = makeHeadContext({});
  } catch (e) {
    console.error(`키트 고정 파일 검사를 건너뜁니다(원본을 읽지 못함): ${e.message}`);
    return;
  }
  let kitEntries;
  try {
    kitEntries = headEntries(ctx);
  } catch (e) {
    console.error(`키트 고정 파일 검사를 건너뜁니다(원본 정의를 읽지 못함): ${e.message}`);
    return;
  }
  const kitByKey = new Map(kitEntries.filter((e) => e.kind === 'merge' || e.kind === 'code').map((e) => [e.key, e]));
  // 이름 바꿈을 지움과 더함으로 풀어 읽는다(--no-renames). 바꾼 옛 이름도 지움으로 잡으려는 것이다(설치본 검수 7회차 5번).
  const rows = (gitOut(cfg, ['diff', '--cached', '--name-status', '--no-renames', '-z']) ?? '').split('\0').filter(Boolean);
  const staged = [];
  const blocked = [];
  for (let i = 0; i + 1 < rows.length; i += 2) {
    const [st, key] = [rows[i], rows[i + 1]];
    // 키트가 놓는 파일을 지우거나 파일이 아닌 것(링크 등)으로 바꾸는 커밋도 원본과 어긋난다(6회차 6번, 7회차 5번). 정의를 빼는 것은 config.json removedDefs에 적으면 키트 목록에서 빠져 통과하고, 고르지 않은 선택 항목도 목록에 없다.
    if (st === 'D' || st === 'T') { if (kitByKey.has(key)) blocked.push(`${key} (${st === 'D' ? '지움' : '형식 바꿈'})`); }
    else staged.push(key);
  }
  for (const key of staged) {
    const e = kitByKey.get(key);
    if (!e) continue;
    // 실행 권한을 뺀 커밋은 내용이 같아도 git 훅을 멈추게 한다(설치본 검수 9회차 5번).
    if (e.exec && !(gitOut(cfg, ['ls-files', '-s', '--', key]) ?? '').startsWith('100755')) {
      blocked.push(`${key} (실행 권한 빠짐)`);
      continue;
    }
    const r = spawnSync('git', ['-C', cfg, 'show', `:${key}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    if (r.error || r.status !== 0) continue;
    const staged = normEol(maskZones(key, r.stdout));
    if (staged === normEol(maskZones(key, e.text))) continue;
    // 키트가 앞선 파일에서 설치 값 자리만 고친 커밋은 원본과의 차이를 새로 만들지 않아 통과한다(설치본 검수 8회차 5번). 막을 때 키트가 앞섰으면 sync를 먼저 하라고 알린다.
    const h = spawnSync('git', ['-C', cfg, 'show', `HEAD:${key}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    const headMasked = !h.error && h.status === 0 ? normEol(maskZones(key, h.stdout)) : null;
    if (headMasked === staged) continue;
    blocked.push(headMasked !== null && headMasked !== normEol(maskZones(key, e.text)) ? `${key} (키트가 앞섬: 먼저 kit-setup.js sync)` : key);
  }
  if (blocked.length) {
    console.error(blockMessage(blocked));
    process.exitCode = 1;
  }
}

// ---- 묶음 목록, 사용자 설정, 훅 끄기와 켜기, 훅 견주기, 출처 찾기 ----

function looseDefs(opts) {
  const cfg = configDir();
  const config = readConfigAt(cfg);
  // 이 스크립트가 설치본에서 돌면 키트 정의가 옆에 없다. 관리자 표시(kitSourcePath)가 있으면 그 원본의 정의를 읽는다(회고가 source-of를 바로 쓰게).
  const sourcePath = typeof config.kitSourcePath === 'string' && config.kitSourcePath.trim() !== '' ? config.kitSourcePath : null;
  const kit = path.resolve(opts.kit ?? (sourcePath && !hasKitDefs(defaultKitRoot(), cfg) ? sourcePath : defaultKitRoot()));
  const has = hasKitDefs(kit, cfg);
  return { cfg, config, kit: has ? kit : null, defs: loadDefinitions({ kitRoot: has ? kit : path.join(cfg, '.no-kit'), configDir: cfg, kitSources: config.kitSources, partSource: config.partSource }) };
}

// 찾은 묶음과 조각, 깔렸는지, 고를 항목, 기댐, 설치 안내 글의 경로를 찍는다. 설치 질문의 묶음 목록이 이것을 읽는다.
function bundlesCommand(rawArgs) {
  const opts = parseOptions(rawArgs);
  if (opts.positional.length) throw new Error(`모르는 인자: ${opts.positional.join(' ')}`);
  const { cfg, kit, defs } = looseDefs(opts);
  const lock = lockApi.readLock(cfg);
  const docOf = (name) => {
    const f = kit ? path.join(kit, 'bundles', name, 'install.md') : null;
    return f && fs.existsSync(f) ? f : null;
  };
  const rows = [...defs.bundles.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)).map((b) => {
    const entry = lock?.installed?.[b.name];
    const parts = defs.parts.filter((p) => p.bundle === b.name);
    return {
      name: b.name,
      title: b.title,
      summary: b.summary,
      origin: b.origin,
      selectable: b.selectable,
      installed: b.name === 'base' ? true : lock ? Boolean(entry) : null,
      options: b.options.map((o) => ({ id: `${b.name}.${o.id}`, title: o.title, default: o.default, installed: lock ? (entry?.options ?? []).includes(`${b.name}.${o.id}`) : null })),
      parts: parts.map((p) => ({ part: p.part, origin: p.origin, installed: lock ? Boolean(entry?.parts?.[p.part]) || b.name === 'base' : null, files: expandFiles(p).length })),
      uses: [...b.uses, ...parts.flatMap((p) => p.uses)].map((u) => ({ bundle: u.bundle, link: u.link, without: u.without, omitted: (defs.omitted ?? []).includes(u.bundle) })),
      installDoc: docOf(b.name),
      localInstallDocs: parts.filter((p) => p.origin === 'local').map((p) => path.join(cfg, 'subagent-system', 'local-bundles', b.name, `${p.part}.install.md`)).filter((f) => fs.existsSync(f)),
    };
  });
  const lockOnly = lock ? Object.keys(lock.installed).filter((n) => !defs.bundles.has(n)) : [];
  const result = { configDir: cfg, kit, hasLock: Boolean(lock), bundles: rows, lockOnly, problems: defs.problems };
  if (opts.json) return console.log(JSON.stringify(result, null, 2));
  const out = [`설정 폴더 ${cfg}`, `키트 ${kit ?? '(없음)'}`, `깐 상태 기록 ${lock ? '있음' : '없음(옛 설치이거나 아직 설치 전)'}`, ''];
  for (const r of rows) {
    out.push(`${r.name}${r.origin === 'local' ? ' (로컬)' : ''}: ${r.title} - ${r.summary}  [${r.installed === null ? '모름' : r.installed ? '깔림' : '안 깔림'}]`);
    for (const o of r.options) out.push(`  항목 ${o.id}: ${o.title}${o.default ? ' (기본)' : ''}${o.installed ? ' [고름]' : ''}`);
    for (const u of r.uses) out.push(`  기댐 ${u.bundle}${u.omitted ? '(이 키트에 없음)' : ''} #${u.link}: ${u.without}`);
    if (r.installDoc) out.push(`  안내 ${r.installDoc}`);
  }
  if (lockOnly.length) out.push('', `정의를 못 찾은 깐 묶음: ${lockOnly.join(', ')}`);
  console.log(out.join('\n'));
}

function settingsCommand(rawArgs) {
  const opts = parseOptions(rawArgs);
  if (opts.positional.length) throw new Error(`모르는 인자: ${opts.positional.join(' ')}`);
  const cfg = configDir();
  const r = userSettingsApi.readUserSettings(cfg);
  const config = readConfigAt(cfg);
  const result = { configDir: cfg, values: r.values, sources: r.sources, raiseKinds: r.raiseKinds, ambiguity: userSettingsApi.ambiguityLine(config), decisionWords: userSettingsApi.decisionWords(cfg), problems: r.problems };
  if (opts.json) return console.log(JSON.stringify(result, null, 2));
  const label = { callName: '호칭', choiceForm: '선택지 받는 꼴', lang: '답할 언어', profileLine: '사용 방식' };
  const source = { settings: '설정 문서', 'claude-md': 'CLAUDE.md', config: 'config', default: '기본값' };
  console.log([
    ...Object.keys(label).map((k) => `${label[k]}: ${r.values[k]}  (${source[r.sources[k]]})`),
    `올릴 것: ${r.raiseKinds.join(', ')}  (${source[r.sources.raiseKinds]})`,
    result.ambiguity,
    ...r.problems.map((p) => `못 읽음: ${p}`),
  ].join('\n'));
}

const trimHonorific = (s) => (s.length > 1 && s.endsWith('님') ? s.slice(0, -1) : s);

// 설정 문서의 `## 값` 줄 하나를 정한다. 줄이 없으면 값 절 끝에 더한다.
function setValueLine(text, label, value, comment = '') {
  const lines = text.split('\n');
  const from = lines.findIndex((l) => l.trim() === '## 값');
  if (from < 0) throw new Error('설정 문서에 `## 값` 절이 없습니다');
  let to = lines.findIndex((l, i) => i > from && /^## /.test(l));
  if (to < 0) to = lines.length;
  const next = `- ${label}: ${value}${comment ? ` ${comment}` : ''}`.trimEnd();
  for (let i = from + 1; i < to; i += 1) {
    if (new RegExp(`^\\s*[-*]\\s+${label}\\s*[:：]`).test(lines[i])) {
      lines[i] = next;
      return lines.join('\n');
    }
  }
  let at = to;
  while (at > from + 1 && lines[at - 1].trim() === '') at -= 1;
  lines.splice(at, 0, next);
  return lines.join('\n');
}

// 사용자 설정 문서를 견본에서 만들고(이미 있으면 값 줄만 고침), 호칭을 정했으면 결정어와 개인 표지에 함께 더한다.
function settingsInitCommand(rawArgs) {
  const opts = parseOptions(rawArgs);
  if (opts.positional.length) throw new Error(`모르는 인자: ${opts.positional.join(' ')}`);
  const cfg = configDir();
  const file = path.join(cfg, 'USER_SETTINGS.md');
  const choiceMap = { 창: '질문 창', '질문 창': '질문 창', 본문: '본문' };
  if (opts.choice !== undefined && !choiceMap[opts.choice]) throw new Error('--choice는 창 또는 본문이어야 합니다');
  if (opts.lang !== undefined && !/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/.test(opts.lang)) throw new Error('--lang은 언어 코드여야 합니다(예: ko)');
  let text = readText(file);
  const created = text === null;
  if (created) {
    const kit = path.resolve(opts.kit ?? defaultKitRoot());
    const tmpl = path.join(kit, 'bundles', 'base', 'user-settings.template.md');
    text = readText(tmpl);
    if (text === null) throw new Error(`설정 문서 견본을 찾지 못했습니다: ${tmpl}. 키트 폴더에서 돌리거나 --kit으로 알려 주세요`);
  }
  const config = readConfigAt(cfg);
  if (opts.name !== undefined) text = setValueLine(text, '호칭', opts.name.trim());
  if (opts.choice !== undefined) text = setValueLine(text, '선택지 받는 꼴', choiceMap[opts.choice]);
  text = setValueLine(text, '답할 언어', opts.lang ?? (created ? 'ko' : userSettingsApi.readUserSettings(cfg).values.lang));
  if (PROFILES[config.profile]) text = setValueLine(text, '사용 방식', PROFILE_LINE[config.profile], '<!-- kit-setup이 씀, 바꿀 때는 kit-setup.js set-profile -->');
  if (!opts.dryRun) fs.writeFileSync(file, text);
  const result = { mode: 'settings-init', file, created, dryRun: Boolean(opts.dryRun), notes: [] };
  const word = opts.name !== undefined ? trimHonorific(opts.name.trim()) : '';
  if (word) {
    const next = { ...config };
    next.decisionWords = [...new Set([word, ...(Array.isArray(config.decisionWords) && config.decisionWords.length ? config.decisionWords : ['사용자'])])];
    next.personalMarkers = [...new Set([...(Array.isArray(config.personalMarkers) ? config.personalMarkers : []), word])];
    result.config = { decisionWords: next.decisionWords, personalMarkers: next.personalMarkers };
    if (!opts.dryRun) {
      fs.mkdirSync(path.join(cfg, 'subagent-system'), { recursive: true });
      writeJson(path.join(cfg, 'subagent-system', 'config.json'), next);
    }
  }
  const gitignore = readText(path.join(cfg, '.gitignore'));
  if (gitignore !== null && fs.existsSync(path.join(cfg, '.git')) && !gitignore.split(/\r?\n/).some((l) => l.trim() === '!/USER_SETTINGS.md')) {
    result.notes.push('설정 폴더가 git 저장소이고 .gitignore에 !/USER_SETTINGS.md가 없어 이력이 남지 않을 수 있습니다. 필요하면 직접 더하세요');
  }
  console.log(JSON.stringify(result, null, 2));
}

function nameCandidatesCommand(rawArgs) {
  const opts = parseOptions(rawArgs);
  if (opts.positional.length) throw new Error(`모르는 인자: ${opts.positional.join(' ')}`);
  const list = [];
  const add = (value, source) => {
    if (value && !list.some((x) => x.value === value)) list.push({ value, source });
  };
  const git = spawnSync('git', ['config', '--global', 'user.name'], { encoding: 'utf8' });
  const gitName = git.status === 0 ? git.stdout.trim() : '';
  if (gitName) add(`${gitName}님`, 'git user.name');
  let osName = '';
  try {
    osName = os.userInfo().username;
  } catch {
    osName = process.env.USER || process.env.USERNAME || '';
  }
  if (osName) add(`${osName}님`, 'OS 사용자 이름');
  add('대표님', '기본 후보');
  add('팀장님', '기본 후보');
  list.push({ value: '', source: '비워 두기(호칭 없이 존댓말)' });
  console.log(JSON.stringify({ candidates: list }, null, 2));
}

// 묶음은 두고 훅 하나만 끄거나 켠다. 끈 목록은 config의 disabledHooks에 두어 갱신이 되살리지 않게 한다.
function hookToggleCommand(on, rawArgs) {
  const opts = parseOptions(rawArgs);
  const id = opts.positional[0];
  if (opts.positional.length !== 1 || !/^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/.test(id ?? '')) throw new Error(`사용법: ${on ? 'hook-on' : 'hook-off'} <묶음>/<이름>`);
  const cfg = configDir();
  const file = path.join(cfg, 'subagent-system', 'config.json');
  const config = readConfigAt(cfg);
  const inputs = hookInputs(cfg, config);
  if (!inputs) throw new Error('깐 상태 기록도 키트 폴더도 없어 훅 정의를 모릅니다');
  const known = new Set([
    ...Object.entries(inputs.lock.installed).flatMap(([b, e]) => Object.values(e?.parts ?? {}).flatMap((p) => (p?.hooks ?? []).map((h) => `${b}/${h.name}`))),
    ...inputs.defs.parts.filter((p) => p.origin === 'local').flatMap((p) => p.hooks.map((h) => `${p.bundle}/${h.name}`)),
  ]);
  if (!known.has(id)) throw new Error(`모르는 훅: ${id}. 알려진 훅: ${[...known].sort().join(', ')}`);
  const list = Array.isArray(config.disabledHooks) ? config.disabledHooks : [];
  const nextList = on ? list.filter((x) => x !== id) : [...new Set([...list, id])];
  const next = { ...config, disabledHooks: nextList };
  if (!nextList.length) delete next.disabledHooks;
  const st = openSettings(path.join(cfg, 'settings.json'));
  const r = syncHooks(st.s, { defs: inputs.defs, lock: inputs.lock, config: next, configDir: hooksConfigDir(cfg) });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeJson(file, next);
  let backup = null;
  if (r.changes.changed) {
    backup = freePath(`${st.f}.bak-hook-${on ? 'on' : 'off'}-${stamp()}`);
    if (st.ex) fs.copyFileSync(st.f, backup);
    st.s = r.settings;
    saveSettings(st);
  }
  console.log(JSON.stringify({ mode: on ? 'hook-on' : 'hook-off', hook: id, disabledHooks: nextList, settings: labelsOf(r.changes), backup: st.ex ? backup : null }, null, 2));
}

// 두 settings.json의 훅 등록을 감싸개와 경로 글자를 벗기고 견준다. 차이가 있으면 종료 코드 1이다.
function hooksCommand(rawArgs) {
  const opts = parseOptions(rawArgs);
  if (!opts.compare || opts.positional.length !== 2) throw new Error('사용법: hooks --compare <settings 가> <settings 나>');
  const [a, b] = opts.positional.map((f) => openSettings(f, { mustExist: true }).s);
  const r = compareHooks(a, b, { configDir: process.env.CLAUDE_CONFIG_DIR ? configDir() : undefined });
  console.log(JSON.stringify({ same: !r.onlyA.length && !r.onlyB.length && !r.changed.length, ...r }, null, 2));
  if (r.onlyA.length || r.onlyB.length || r.changed.length) process.exitCode = 1;
}

// 설치된 파일 하나의 조각, 갈래, 원본 파일 경로를 찍는다.
function sourceOfCommand(rawArgs) {
  const opts = parseOptions(rawArgs);
  if (opts.positional.length !== 1) throw new Error('사용법: source-of <설치 경로>');
  const { cfg, config, defs } = looseDefs(opts);
  const arg = opts.positional[0];
  const key = slash(path.isAbsolute(arg) ? path.relative(cfg, arg) : arg).replace(/^\.\//, '');
  const all = entriesFor(defs, { bundles: selectableBundles(defs), options: optionIds(defs) }, { commandName: config.commandName ?? 'retro' });
  const hit = all.find((e) => e.key === key);
  if (!hit) {
    console.log(JSON.stringify({ path: key, found: false }, null, 2));
    process.exitCode = 1;
    return;
  }
  const part = defs.parts.find((p) => p.bundle === hit.bundle && p.part === hit.part);
  if (hit.kind === 'local') {
    console.log(JSON.stringify({ path: key, found: true, bundle: hit.bundle, part: hit.part, origin: 'local', source: null, note: '원본에 내지 않음(로컬 조각은 설치본이 정본)' }, null, 2));
    return;
  }
  console.log(JSON.stringify({ path: key, found: true, bundle: hit.bundle, part: hit.part, origin: 'kit', kind: hit.kind, source: path.join(part.source.root, ...hit.src.split('/')) }, null, 2));
}

function whereCommand(rawArgs) {
  const opts = parseOptions(rawArgs);
  if (opts.positional.length) throw new Error(`모르는 인자: ${opts.positional.join(' ')}`);
  console.log(RECORDS_DIR);
}

// CLAUDE.md 정리 제안을 묻고 마친 뒤 돌린다. 늘 읽히는 줄의 합이 기준을 넘으면 config의 claudeMdKeptLines에 줄 수를 적고, 이하이거나 CLAUDE.md가 없으면 그 키를 지운다.
function claudeMdDoneCommand(rawArgs) {
  const opts = parseOptions(rawArgs);
  if (opts.positional.length) throw new Error(`모르는 인자: ${opts.positional.join(' ')}`);
  const cfg = configDir();
  const file = path.join(cfg, 'subagent-system', 'config.json');
  const exists = fs.existsSync(path.join(cfg, 'CLAUDE.md'));
  if (!fs.existsSync(file)) throw new Error(`설정 파일이 없어 claudeMdKeptLines를 쓰지 못했습니다: ${file}`);
  let config;
  try {
    config = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new Error(`설정 파일이 깨져 claudeMdKeptLines를 쓰지 못했습니다: ${file}`);
  }
  const { limit } = claudeMdSettingsOf(config);
  const sum = claudeMdVerdict({ configDir: cfg, limit, keptLines: null });
  const over = exists && sum.over;
  if (over) {
    config.claudeMdKeptLines = sum.total;
    writeJson(file, config);
    return console.log(`늘 읽히는 줄 합 ${sum.total}줄: claudeMdKeptLines에 ${sum.total}줄을 적었습니다`);
  }
  const had = 'claudeMdKeptLines' in config;
  if (had) {
    delete config.claudeMdKeptLines;
    writeJson(file, config);
  }
  const head = exists ? `늘 읽히는 줄 합 ${sum.total}줄: ${limit}줄 이하라` : 'CLAUDE.md 없음:';
  console.log(`${head} claudeMdKeptLines를 ${had ? '지웠습니다' : '지울 것이 없어 그대로 뒀습니다'}`);
}

const SUBCOMMANDS = {
  bundles: bundlesCommand,
  install: (a) => runSync('install', a),
  add: addCommand,
  remove: removeCommand,
  update: (a) => runSync('update', a),
  migrate: (a) => runSync('update', a),
  uninstall,
  'set-profile': setProfileCommand,
  diff: diffCommand,
  sync: syncCommand,
  descriptions: descriptionsCommand,
  'check-staged': checkStagedCommand,
  settings: settingsCommand,
  'settings-init': settingsInitCommand,
  'name-candidates': nameCandidatesCommand,
  'hook-off': (a) => hookToggleCommand(false, a),
  'hook-on': (a) => hookToggleCommand(true, a),
  hooks: hooksCommand,
  'source-of': sourceOfCommand,
  where: whereCommand,
  'claude-md-done': claudeMdDoneCommand,
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
  '--add-hooks': [1, (a) => addHooks(a[0])],
  '--remove-hooks': [1, (a) => removeHooks(a[0])],
  '--merge-git-ask': [4, (a) => mergeGitAsk(a[0], a[1], a[2], a[3])],
  '--remove-agent-meter': [2, (a) => removeAgentMeter(a[0], a[1])],
  '--move-agent-meter': [1, (a) => moveAgentMeter(a[0])],
  '--backup-file': [2, (a) => backupFile(a[0], a[1])],
  '--check-json': [1, (a) => checkJson(a)],
};

const usageText = () => `사용법: node kit-setup.js <하위 명령 또는 플래그> <인자…>\n하위 명령: ${Object.keys(SUBCOMMANDS).join(' ')}\n플래그: ${Object.keys(COMMANDS).join(' ')}\n인자는 파일 머리말을 보세요.`;

function main() {
  const [flag, ...rest] = process.argv.slice(2);
  // --help는 사용법을 찍고 정상 종료한다. 바닥만 놓인 폴더에서 이 파일이 뜨는지를 종료 코드로 가리려는 것이다.
  if (flag === '--help' || flag === '-h') {
    console.log(usageText());
    return;
  }
  const sub = Object.hasOwn(SUBCOMMANDS, flag) ? SUBCOMMANDS[flag] : null;
  const cmd = sub ? [0, sub] : COMMANDS[flag];
  if (!cmd || rest.length < cmd[0]) {
    console.error(usageText());
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
