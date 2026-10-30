#!/usr/bin/env node
/**
 * PermissionRequest 훅. 자동 회고가 도는 동안 서브에이전트가 설정 폴더(~/.claude) 아래, 그리고 config.json의 kitSourcePath(키트 원본 작업 트리) 아래 일하는 방식 파일을 쓰려 할 때 확인 창 없이 허용한다.
 *
 * 무엇을: Write, Edit, MultiEdit, NotebookEdit 요청이 아래를 모두 만족하면 허용 판정을 내고, 하나라도 아니면 아무것도 찍지 않고 넘겨 평소 확인 절차에 맡긴다.
 * 왜: `.claude/`는 보호 경로라 permissions.allow, 정의의 permissionMode, PreToolUse 허용이 모두 안 먹고, PermissionRequest 훅의 허용만 통한다(실측). 개인용 자동 회고가 매번 멈추지 않게 하려는 것이다.
 * 전제:
 *  - 서브에이전트의 요청이다(훅 입력에 agent_id가 있음). 메인 세션의 요청은 넘긴다.
 *  - config.json의 retroWriteAllow가 true다(개인용 기본값, 회사용은 false). 설정을 읽지 못하면 넘긴다.
 *  - 회고 잠금(records/retro.lock)이 3시간 안에 잡혀 있다. 훅 입력에는 회고 서브에이전트라는 표시가 없어 잠금이 잡힌 동안으로 좁힌다.
 *  - 대상 경로가 설정 폴더나 kitSourcePath 아래의 허용 자리(회고가 고치는 자리)이고, 아래 보호 목록은 아니다.
 *    허용 자리: 설정 폴더는 subagent-system/docs/, subagent-system/rates.json, rules/, docs/, agents/, skills/. 키트 뿌리는 subagent-system/의 docs, agents, skills, rules, rates.json, CHANGES.md, VERSION과 README.md.
 *    스크립트, 훅, 훅 등록 원본(settings-hook.json)은 훅이 확인 창 없이 돌리거나 업데이트가 settings.json에 옮기므로 어느 쪽에서도 열지 않는다.
 *    막을 자리를 나열하면 새 자리(commands/, mods/ 등)가 생길 때마다 구멍이 나서, 열 자리를 나열한다. 보호 목록은 두 뿌리 모두 그 뿌리 기준 경로로 견준다. 정책 문서, 권한 설정, 문지기 훅, 이 훅과 키트 설정을 서브에이전트가 승인 없이 바꾸면 이 허용이 보호할 것을 스스로 풀 수 있기 때문이다.
 *    CLAUDE.md, settings*.json, docs/plan/, .git/, hooks/(개인 문지기 훅), subagent-system/hooks/(이 훅 자신 포함), subagent-system/config.json
 *    agents/와 skills/ 아래 파일은 쓰기 전과 뒤의 머리 키가 모두 열 키(name, description, model, effort, argument-hint, disable-model-invocation)일 때만 허용한다. 머리 구분선(---)으로 시작하는데(BOM과 앞 공백은 건너뜀) 머리를 읽지 못하는 파일(닫는 구분선 없음)은 넘긴다. 구분선으로 시작하지 않는 문서는 머리가 없는 것이라 연다. 노트북 쓰기는 넘긴다.
 *    이 키는 확인 창을 건너뛰거나 훅을 돌리게 해 문지기를 승인 없이 풀 수 있기 때문이다.
 *    키트 뿌리 쪽은 .claude/(그 저장소의 권한 설정과 그 아래 작업 트리)도 보호한다. 프로젝트 권한 파일이 거기 있어서다.
 *    kitSourcePath는 회고가 같은 고침을 키트 원본에도 반영하는 관리자가 일부러 적는 값이고 키트 원본은 git이 지켜서 허용한다. 절대 경로이고 그 아래 subagent-system/VERSION이 있는 키트 폴더일 때만 쓴다(엉뚱한 폴더가 적혀도 넓게 열리지 않게).
 *  - 경로는 대소문자를 가리지 않고 견주고(macOS와 Windows는 `Claude.md`도 같은 파일이다) 심볼릭 링크는 따라간 실제 경로로 견준다.
 *  - 설정 폴더는 CLAUDE_CONFIG_DIR이 있으면 그것, 없으면 ~/.claude다. 어떤 실패도 넘김으로 끝낸다(종료 코드 0).
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const WRITE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
const LOCK_LIVE_MS = 3 * 60 * 60 * 1000;
const PROTECTED_FILES = ['claude.md', 'subagent-system/config.json', 'subagent-system/docs/migrated_user_rules.md'];
// MIGRATED_USER_RULES.md는 옛 사용자 CLAUDE.md에서 옮긴 정책 줄이 섞여 있어 정책 문서처럼 지킨다.
const PROTECTED_TOP_PATTERN = /^settings[^/]*\.json$/;
const PROTECTED_DIRS = ['docs/plan', '.git', 'hooks', 'subagent-system/hooks'];
// 회고가 고치는 자리만 연다. 스크립트, 훅, 훅 등록 원본(settings-hook.json)은 어느 쪽에서도 열지 않는다.
const ALLOWED_DIRS = ['subagent-system/docs', 'subagent-system/rates.json', 'rules', 'docs', 'agents', 'skills'];
const CFG_PROTECTED_DIRS = [];
const KIT_ALLOWED = ['subagent-system/docs', 'subagent-system/rates.json', 'subagent-system/agents', 'subagent-system/skills', 'subagent-system/rules', 'subagent-system/changes.md', 'subagent-system/version', 'readme.md'];
const KEY_GUARDED_DIRS = ['agents', 'skills'];
// 정의와 스킬 머리에 둘 수 있는 키. 그 밖의 키(permissionMode, hooks, allowed-tools, mcpServers 등)는 권한, 훅, 실행을 바꿀 수 있어 확인 창으로 넘긴다.
// 막을 키를 나열하면 새 키마다 구멍이 나서 열 키를 나열한다.
const ALLOWED_FRONT_KEYS = new Set(['name', 'description', 'model', 'effort', 'argument-hint', 'disable-model-invocation']);

// 머리(맨 앞 --- 사이)의 키 목록을 준다. 머리가 없으면 [], 머리 구분선으로 시작하는데 우리가 읽지 못하면 null이다(호출하는 쪽이 열지 않는다).
// 까닭: BOM(U+FEFF)이나 앞 공백이 있거나 닫는 구분선이 없는 파일을 「머리 없음」으로 읽고 열면, Claude Code가 그 머리를 읽을 때 권한이나 훅 키가 승인 없이 들어올 수 있다.
// 구분선으로 시작하지 않는 내용은 머리가 될 수 없고, 스킬 폴더의 일반 문서(.md)는 머리 없이 쓰므로 막지 않는다.
function frontKeys(text) {
  const body = (text || '').replace(/^[\uFEFF\s]+/, '');
  if (!body.startsWith('---')) return [];
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---/.exec(body);
  if (!m) return null;
  return shapedKeys(m[1].split(/\r?\n/));
}

// 머리 줄이 정해 둔 모양일 때만 키 목록을 주고, 아니면 null이다. YAML은 들여쓴 맵, `?` 키, 따옴표 키, 병합 키(`<<`), 탭 들여쓰기도 키로 읽어서
// 키 이름만 세면 이런 꼴로 권한 키가 빠져나간다. 그래서 0열의 `이름: 값` 줄, 그 바로 앞 키가 블록 값(`|`, `>`)일 때의 들여쓴 내용 줄,
// 키처럼 보이지 않는 들여쓴 이어지는 줄, 빈 줄과 주석만 받는다.
function shapedKeys(lines) {
  const keys = [];
  let block = false;
  for (const line of lines) {
    if (/^\s*(#.*)?$/.test(line)) continue;
    if (/^\t/.test(line) || /^\s+\t/.test(line)) return null;
    const top = /^([A-Za-z][A-Za-z0-9_-]*):(?:\s(.*))?$/.exec(line);
    if (top) {
      keys.push(top[1]);
      block = /^[|>][-+0-9]*\s*(#.*)?$/.test((top[2] || '').trim());
      continue;
    }
    if (!/^ +\S/.test(line) || keys.length === 0) return null;
    if (block) continue;
    if (/^ +(\?|-|["'{\[&*!<])/.test(line) || /^ +[^\s#][^#]*?:(\s|$)/.test(line)) return null;
  }
  return keys;
}

// 쓰기 뒤 파일 내용을 만든다. Write는 content, Edit와 MultiEdit는 지금 파일에 바꿈을 적용한다. 만들 수 없으면 null.
function resultText(current, toolInput) {
  const t = toolInput || {};
  if (typeof t.content === 'string') return t.content;
  const edits = Array.isArray(t.edits) ? t.edits : [t];
  let out = current;
  for (const e of edits) {
    if (!e || typeof e.old_string !== 'string' || typeof e.new_string !== 'string') return null;
    if (!out.includes(e.old_string)) return null;
    out = e.replace_all ? out.split(e.old_string).join(e.new_string) : out.replace(e.old_string, () => e.new_string);
  }
  return out;
}

const onlyAllowedKeys = (text) => {
  const keys = frontKeys(text);
  return keys !== null && keys.every((k) => ALLOWED_FRONT_KEYS.has(k));
};

const KIT_PROTECTED_DIRS = ['.claude'];

const configDir = (env = process.env) => path.resolve(env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'));

function recordsDir(cfg, env = process.env) {
  return env.SUBAGENT_RECORDS_DIR || path.join(cfg, 'subagent-system', 'records');
}

const realpath = fs.realpathSync.native || fs.realpathSync;

// 있는 파일은 심볼릭 링크까지 따라간 실제 경로, 아직 없는 파일은 있는 가장 가까운 윗 폴더의 실제 경로에 나머지를 붙인다.
function realTarget(file) {
  try {
    return realpath(file);
  } catch {
    // 새 파일이면 윗 폴더로 올라가며 찾는다.
  }
  let dir = path.dirname(file);
  const tail = [path.basename(file)];
  for (;;) {
    try {
      return path.join(realpath(dir), ...tail.reverse());
    } catch {
      const up = path.dirname(dir);
      if (up === dir) return file;
      tail.push(path.basename(dir));
      dir = up;
    }
  }
}

function targetOf(input) {
  const p = input.tool_input && (input.tool_input.file_path || input.tool_input.notebook_path);
  return typeof p === 'string' && path.isAbsolute(p) ? p : null;
}

function insideProtected(rel, extraDirs = []) {
  if (PROTECTED_FILES.includes(rel) || PROTECTED_TOP_PATTERN.test(rel)) return true;
  return [...PROTECTED_DIRS, ...extraDirs].some((d) => rel === d || rel.startsWith(`${d}/`));
}

// config.json의 kitSourcePath가 키트 폴더(subagent-system/VERSION이 있음)를 가리킬 때만 그 실제 경로를 준다. 아니면 null.
function kitRoot(config) {
  const p = config && config.kitSourcePath;
  if (typeof p !== 'string' || !path.isAbsolute(p)) return null;
  try {
    const root = realpath(p);
    return fs.statSync(path.join(root, 'subagent-system', 'VERSION')).isFile() ? root : null;
  } catch {
    return null;
  }
}

function shouldAllow(input, env = process.env, now = Date.now()) {
  if (!input || !input.agent_id || !WRITE_TOOLS.includes(input.tool_name)) return false;
  const target = targetOf(input);
  if (!target) return false;
  const cfg = configDir(env);
  let config;
  try {
    config = JSON.parse(fs.readFileSync(path.join(cfg, 'subagent-system', 'config.json'), 'utf8'));
  } catch {
    return false;
  }
  if (!config || config.retroWriteAllow !== true) return false;
  try {
    if (now - fs.statSync(path.join(recordsDir(cfg, env), 'retro.lock')).mtimeMs > LOCK_LIVE_MS) return false;
  } catch {
    return false;
  }
  const real = realTarget(path.resolve(target));
  const kit = kitRoot(config);
  for (const root of [realpath(cfg), kit]) {
    if (!root) continue;
    const rel = path.relative(root, real).split(path.sep).join('/');
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;
    const low = rel.toLowerCase();
    const open = root === kit ? KIT_ALLOWED : ALLOWED_DIRS;
    if (!open.some((d) => low === d || low.startsWith(d.endsWith('-') ? d : `${d}/`))) return false;
    if (input.tool_name === 'NotebookEdit') return false;
    if (insideProtected(low, root === kit ? KIT_PROTECTED_DIRS : CFG_PROTECTED_DIRS)) return false;
    if (KEY_GUARDED_DIRS.some((d) => low.startsWith(`${d}/`) || low.startsWith(`subagent-system/${d}/`))) {
      // 스킬 폴더의 스크립트와 템플릿은 스킬이 돌리므로 문서(.md)만 연다.
      if (!low.endsWith('.md')) return false;
      let current = '';
      try {
        current = fs.readFileSync(real, 'utf8');
      } catch {
        // 새 파일이면 지금 내용이 없다.
      }
      const after = resultText(current, input.tool_input);
      if (after === null || !onlyAllowedKeys(current) || !onlyAllowedKeys(after)) return false;
    }
    return true;
  }
  return false;
}

function main() {
  try {
    const input = JSON.parse(fs.readFileSync(0, 'utf8'));
    if (shouldAllow(input)) {
      process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } })}\n`);
    }
  } catch (err) {
    process.stderr.write(`retro-write-allow: ${err.message}\n`);
  }
}

module.exports = { shouldAllow, frontKeys };

if (require.main === module) main();
