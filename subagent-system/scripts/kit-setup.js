#!/usr/bin/env node

/**
 * kit-setup.js
 *
 * 설치, 업데이트, 제거 때 APPLY_GUIDE가 설정 파일과 설치본을 고치려고 부르는 명령 모음.
 * 설치본 스크립트가 아직 없거나 옛 버전일 때도 쓰도록 키트 폴더의 이 파일로 돌린다(다른 스크립트를 불러오지 않는다).
 * 오류가 나면 메시지를 오류 출력에 찍고 종료 코드 1로 끝나며, 설정 파일은 쓰기 전에 모두 읽고 검사하므로 그때는 바뀌지 않는다.
 *
 * 실행: node kit-setup.js <플래그> <인자…>
 *   --check-update-interrupted                                   가장 새 백업의 VERSION과 설치본 VERSION의 수정 시각으로 업데이트가 끊겼는지 찍음
 *   --backup-install                                             설치본의 설정, 문서, 스크립트, 정의, 스킬을 subagent-system-backup-<날짜-시각>/에 복사
 *   --add-answers <config.json>                                  표준 입력의 JSON 객체를 installAnswers에 합침
 *   --finish-answers <config.json> [keep]                        installAnswers의 keptOutsideLines를 outsideLinesKept로 옮기고 installAnswers(keep이면 keptOutsideLines만)를 지움
 *   --keep-outside-line <config.json>                            표준 입력의 {"line", "kit"} 쌍을 outsideLinesKept에 더하거나 바꿈(kit이 없으면 지움)
 *   --add-config-lines <config.json> <키>                        표준 입력의 줄을 키의 배열에 중복 없이 더함
 *   --config-set <config.json> <키> <JSON 값>                    키의 값을 정함
 *   --config-unset <파일> <키>                                   키를 지움
 *   --set-command-name <config.json> <이름>                      commandName을 정함
 *   --set-roles <config.json> [직군…]                            roles를 정함
 *   --checklist-synced <config.json> <VERSION 파일>              checklistSyncedVersion을 그 파일의 값으로 정함
 *   --add-hooks <settings.json> <settings-hook.json> <이벤트…>   키트 훅을 settings.json에 더함
 *   --remove-hooks <settings.json> <이벤트…>                     이 키트의 훅 명령만 뺌
 *   --merge-git-ask <settings.json> <git-permissions.json> <config.json> check|merge   permissions.ask에 키트 항목을 더함
 *   --remove-agent-meter <settings.json> <agent-meter 폴더>      env에서 agent-meter 경로와 keep-alive 키를 뺌
 *   --move-agent-meter <agent-meter 폴더>                        폴더를 같은 위치의 agent-meter-backup-<날짜-시각>으로 옮김
 *   --backup-file <파일> <이름>                                  <파일>.bak-<이름>-<날짜-시각>으로 복사
 *   --check-json <파일…>                                         JSON으로 읽히는지 봄
 *   --copy-guide-zones <설치본 GUIDE> <복사본 GUIDE>              GUIDE의 사용자 구역 세 곳을 설치본에서 복사본으로 옮김
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

function checkUpdateInterrupted() {
  const h = configDir();
  const b = fs.readdirSync(h).filter((n) => /^subagent-system-backup-\d{8}-\d{6}$/.test(n)).sort().pop();
  const m = (f) => fs.statSync(f).mtimeMs;
  try {
    const i = path.join(h, 'subagent-system/VERSION');
    const o = path.join(h, b, 'subagent-system/VERSION');
    const t = b.match(/(\d{4})(\d{2})(\d{2})-/);
    const a = Math.floor((Date.now() - new Date(t[1], t[2] - 1, t[3])) / 864e5);
    console.log(m(i) < m(o) ? `끊김: 설치본 VERSION이 백업보다 이르다, 가장 새 백업은 ${a}일 전` : '끊기지 않음: 설치본 VERSION이 백업보다 늦다');
  } catch {
    console.log('끊기지 않음: 백업이나 VERSION이 없다');
  }
}

const KIT_DEFS = ['haiku-low', 'haiku-medium', 'haiku-high', 'sonnet-low', 'sonnet-medium', 'sonnet-high', 'opus-low', 'opus-medium', 'opus-high', 'opus-xhigh'];

function backupInstall() {
  const h = configDir();
  let c = 'retro';
  try {
    const v = readJson(path.join(h, 'subagent-system/config.json')).commandName;
    if (typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(v)) c = v;
  } catch {
    // 설정 파일이 없거나 깨졌으면 기본 이름이다.
  }
  const b = path.join(h, `subagent-system-backup-${stamp()}`);
  const targets = ['settings.json', 'CLAUDE.md', 'subagent-system/docs', 'subagent-system/scripts', 'subagent-system/rates.json', 'subagent-system/config.json', 'subagent-system/VERSION', `commands/${c}.md`, `skills/${c}`, ...KIT_DEFS.map((x) => `agents/${x}.md`)];
  let k = 0;
  for (const r of targets) {
    const s = path.join(h, r);
    if (!fs.existsSync(s)) continue;
    fs.mkdirSync(path.dirname(path.join(b, r)), { recursive: true });
    fs.cpSync(s, path.join(b, r), { recursive: true, dereference: true });
    k += 1;
    console.log(`백업: ${r}`);
  }
  console.log(k ? `백업 위치: ${b}` : '백업할 것 없음');
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

function configSet(file, key, value) {
  const o = readJson(file);
  o[key] = JSON.parse(value);
  writeJson(file, o);
}

function configUnset(file, key) {
  const o = readJson(file);
  delete o[key];
  writeJson(file, o);
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
const ADDABLE_HOOKS = ['SubagentStop'];
const KIT_HOOKS = {
  SubagentStop: (c) => c.includes('subagent-usage.js'),
  SessionStart: (c) => c.includes('subagent-retro.js') && c.includes('--session-start'),
};

function addHooks(file, kitFile, events) {
  const st = openSettings(file);
  const { s } = st;
  const kit = readJson(kitFile).hooks;
  const d = process.env.CLAUDE_CONFIG_DIR ? path.resolve(process.env.CLAUDE_CONFIG_DIR).split(path.sep).join('/') : '';
  const home = '$HOME/.claude';
  if (s.hooks === undefined) s.hooks = {};
  if (!isObject(s.hooks)) throw new Error('hooks가 객체가 아닙니다');
  let n = 0;
  for (const e of events) {
    if (!kit[e] || !ADDABLE_HOOKS.includes(e)) throw new Error(`모르는 이벤트: ${e}`);
    if (s.hooks[e] === undefined) s.hooks[e] = [];
    const a = s.hooks[e];
    if (!Array.isArray(a)) throw new Error(`hooks.${e}가 배열이 아닙니다`);
    if (a.some((g) => g && Array.isArray(g.hooks) && g.hooks.some((x) => KIT_HOOKS[e](String(x && x.command || ''))))) {
      console.log(`이미 있음: ${e}`);
      continue;
    }
    const add = JSON.parse(JSON.stringify(kit[e]));
    if (d) for (const g of add) for (const x of g.hooks) x.command = x.command.split(home).join(d);
    a.push(...add);
    n += 1;
    console.log(`더함: ${e}`);
  }
  if (n) saveSettings(st);
}

function removeHooks(file, events) {
  for (const e of events) if (!KIT_HOOKS[e]) throw new Error(`모르는 이벤트: ${e}`);
  const st = openSettings(file, { mustExist: true });
  const { s } = st;
  let n = 0;
  const H = isObject(s.hooks) ? s.hooks : null;
  for (const e of Object.keys(KIT_HOOKS).filter((x) => events.includes(x))) {
    const a = H && H[e];
    if (!Array.isArray(a)) continue;
    const hit = new Set();
    for (const g of a) {
      if (!(g && Array.isArray(g.hooks))) continue;
      const kept = g.hooks.filter((x) => !KIT_HOOKS[e](String(x && x.command || '')));
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
  if (n) saveSettings(st);
  console.log(`뺀 명령: ${n}개`);
}

function mergeGitAsk(file, kitFile, configFile, mode) {
  const st = openSettings(file);
  const { s } = st;
  const kit = readJson(kitFile).permissions.ask;
  let cf = {};
  try {
    cf = readJson(configFile);
  } catch {
    // 설정 파일이 없거나 깨졌으면 넣지 않기로 한 항목이 없는 것으로 본다.
  }
  const declined = Array.isArray(cf.gitAskDeclined) ? cf.gitAskDeclined : [];
  if (s.permissions === undefined) s.permissions = {};
  const pm = s.permissions;
  if (!isObject(pm)) throw new Error('permissions가 객체가 아닙니다');
  if (pm.ask === undefined) pm.ask = [];
  if (!Array.isArray(pm.ask)) throw new Error('permissions.ask가 배열이 아닙니다');
  const allow = Array.isArray(pm.allow) ? pm.allow : [];
  const todo = kit.filter((x) => !pm.ask.includes(x) && !declined.includes(x));
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

const GUIDE_ZONES = ['사용자 표', '무조건 Opus', '사용자 규칙'];

function copyGuideZones(srcFile, dstFile) {
  const a = fs.readFileSync(srcFile, 'utf8');
  let o = fs.readFileSync(dstFile, 'utf8');
  const eol = o.includes('\r\n') ? '\r\n' : '\n';
  for (const z of GUIDE_ZONES) {
    const S = `<!-- ${z} 시작 -->`;
    const E = `<!-- ${z} 끝 -->`;
    const at = (t, who) => {
      const i = t.indexOf(S);
      const j = t.indexOf(E);
      if (i < 0 || j < i || t.indexOf(S, i + 1) >= 0 || t.indexOf(E, j + 1) >= 0) throw new Error(`${who}의 ${z} 표시가 한 쌍이 아닙니다`);
      return [i + S.length, j];
    };
    const [ai, aj] = at(a, '설치본');
    const [bi, bj] = at(o, '복사본');
    o = o.slice(0, bi) + a.slice(ai, aj).replace(/\r?\n/g, eol) + o.slice(bj);
    console.log(`옮김: ${z}`);
  }
  fs.writeFileSync(dstFile, o);
}

// 플래그마다 필요한 인자 수(최소). 모자라면 사용법을 찍고 파일을 건드리지 않는다.
const COMMANDS = {
  '--check-update-interrupted': [0, checkUpdateInterrupted],
  '--backup-install': [0, backupInstall],
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
  '--copy-guide-zones': [2, (a) => copyGuideZones(a[0], a[1])],
};

function main() {
  const [flag, ...rest] = process.argv.slice(2);
  const cmd = COMMANDS[flag];
  if (!cmd || rest.length < cmd[0]) {
    console.error(`사용법: node kit-setup.js <플래그> <인자…>\n플래그: ${Object.keys(COMMANDS).join(' ')}\n인자는 파일 머리말을 보세요.`);
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
