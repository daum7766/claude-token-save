import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KIT_SETUP = path.join(SCRIPTS, 'kit-setup.js');
// 훅 정의(settings-hook.json)는 키트 폴더에만 있어 설치본 scripts로는 훅을 걸 수 없다. 걸리는 것을 보는 시험은 설치본에서 건너뛴다.
const SKIP_NO_HOOK_DEF = fs.existsSync(path.join(SCRIPTS, '..', 'settings-hook.json')) ? false : '설치본 배치라 settings-hook.json이 없음(키트 원본에서만 시험)';
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kit-setup-'));
const write = (dir, name, value) => {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
  return file;
};
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
// 설치본에는 키트 폴더의 입력 파일이 없으므로 시험이 같은 꼴의 최소 입력을 직접 만든다.
const FIXTURES = tmpDir();
const KIT_HOOK = write(FIXTURES, 'settings-hook.json', {
  hooks: { SubagentStop: [{ hooks: [{ type: 'command', command: 'node "$HOME/.claude/subagent-system/scripts/subagent-usage.js" --hook', timeout: 30 }] }] },
});
const GIT_PERMISSIONS = write(FIXTURES, 'git-permissions.json', {
  permissions: { ask: ['Bash(git checkout:*)', 'Bash(git commit:*)', 'Bash(git push:*)', 'Bash(git reset:*)', 'Bash(git * push *)'] },
});
// 사용자 환경에 SUBAGENT_* 경로 재정의가 있어도 시험이 그 값을 물려받지 않게 지운다.
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'CLAUDE_CONFIG_DIR' && !k.startsWith('SUBAGENT_')));
const run = (args, { stdin, env } = {}) => {
  const clean = cleanEnv();
  return spawnSync(process.execPath, [KIT_SETUP, ...args], { input: stdin, env: { ...clean, ...env }, encoding: 'utf8' });
};
const names = (dir) => fs.readdirSync(dir).sort();

describe('kit-setup.js config.json 쓰기', () => {
  it('--add-answers는 installAnswers에 합치고 배열은 더하며 같은 line의 객체는 새 것으로 바꾼다', () => {
    const dir = tmpDir();
    const file = write(dir, 'config.json', { roles: ['백엔드'], installAnswers: { q4Rules: true, lines: [{ line: 'a', v: 1 }, 's'] } });
    const r = run(['--add-answers', file], { stdin: JSON.stringify({ q4Rules: false, lines: [{ line: 'a', v: 2 }, { line: 'b' }, 's', 't'], extra: 5 }) });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(read(file), { roles: ['백엔드'], installAnswers: { q4Rules: false, lines: [{ line: 'a', v: 2 }, 's', { line: 'b' }, 't'], extra: 5 } });
  });

  it('--finish-answers는 keptOutsideLines를 outsideLinesKept로 옮기고 installAnswers를 지우며, keep이면 keptOutsideLines만 지운다', () => {
    const body = { installAnswers: { keptOutsideLines: [{ line: 'a', kit: 'k2' }], q: 1 }, outsideLinesKept: [{ line: 'a', kit: 'k1' }, { line: 'z', kit: 'kz' }] };
    const all = write(tmpDir(), 'config.json', body);
    assert.equal(run(['--finish-answers', all]).status, 0);
    assert.deepEqual(read(all), { outsideLinesKept: [{ line: 'z', kit: 'kz' }, { line: 'a', kit: 'k2' }] });
    const keep = write(tmpDir(), 'config.json', body);
    assert.equal(run(['--finish-answers', keep, 'keep']).status, 0);
    assert.deepEqual(read(keep).installAnswers, { q: 1 });
  });

  it('--keep-outside-line은 같은 line의 쌍을 바꾸고 kit이 없으면 지우며 비면 키를 없앤다', () => {
    const file = write(tmpDir(), 'config.json', { outsideLinesKept: [{ line: 'a', kit: 'k1' }] });
    run(['--keep-outside-line', file], { stdin: '{"line":"a","kit":"new"}' });
    assert.deepEqual(read(file).outsideLinesKept, [{ line: 'a', kit: 'new' }]);
    run(['--keep-outside-line', file], { stdin: '{"line":"b","kit":"kb"}' });
    assert.equal(read(file).outsideLinesKept.length, 2);
    run(['--keep-outside-line', file], { stdin: '{"line":"a"}' });
    run(['--keep-outside-line', file], { stdin: '{"line":"b"}' });
    assert.equal('outsideLinesKept' in read(file), false);
  });

  it('--config-set은 JSON 값을 키에 쓰고 --config-unset은 그 키만 지운다', () => {
    const file = write(tmpDir(), 'config.json', { a: 1 });
    run(['--config-set', file, 'statusLineCleanup', '"c"']);
    run(['--config-set', file, 'agentMeterDeclined', 'true']);
    assert.deepEqual(read(file), { a: 1, statusLineCleanup: 'c', agentMeterDeclined: true });
    run(['--config-unset', file, 'statusLineCleanup']);
    assert.deepEqual(read(file), { a: 1, agentMeterDeclined: true });
  });

  it('--set-command-name, --set-roles, --checklist-synced는 각 키만 바꾼다', () => {
    const dir = tmpDir();
    const file = write(dir, 'config.json', { retroMode: 'ask' });
    run(['--set-command-name', file, 'sub-retro']);
    run(['--set-roles', file, '백엔드', 'QA와 테스트']);
    run(['--checklist-synced', file, write(dir, 'VERSION', '2026.10.25.2\n')]);
    assert.deepEqual(read(file), { retroMode: 'ask', commandName: 'sub-retro', roles: ['백엔드', 'QA와 테스트'], checklistSyncedVersion: '2026.10.25.2' });
    run(['--set-roles', file]);
    assert.deepEqual(read(file).roles, []);
  });

  it('깨진 config.json이면 종료 코드 1이고 파일을 바꾸지 않는다', () => {
    const file = write(tmpDir(), 'config.json', '{');
    const r = run(['--config-set', file, 'a', '1']);
    assert.equal(r.status, 1);
    assert.equal(fs.readFileSync(file, 'utf8'), '{');
  });

  it('플래그를 모르거나 인자가 모자라면 사용법을 찍고 종료 코드 1이다', () => {
    assert.equal(run(['--nope']).status, 1);
    const r = run(['--config-set', 'x']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /사용법/);
  });
});

describe('kit-setup.js settings.json 고치기', () => {
  const mine = { hooks: { SubagentStop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }], Stop: [{ hooks: [{ type: 'command', command: 'x' }] }] }, model: 'opus' };

  it('--add-hooks는 키트 훅을 더하고 다른 키와 훅은 그대로 두며 다시 돌리면 이미 있음을 찍는다', () => {
    const file = write(tmpDir(), 'settings.json', mine);
    const first = run(['--add-hooks', file, KIT_HOOK, 'SubagentStop']);
    assert.match(first.stdout, /더함: SubagentStop/);
    const after = read(file);
    assert.equal(after.model, 'opus');
    assert.deepEqual(after.hooks.Stop, mine.hooks.Stop);
    assert.equal(after.hooks.SubagentStop.length, 2);
    assert.match(JSON.stringify(after.hooks.SubagentStop[1]), /subagent-usage\.js/);
    assert.match(run(['--add-hooks', file, KIT_HOOK, 'SubagentStop']).stdout, /이미 있음: SubagentStop/);
    assert.equal(read(file).hooks.SubagentStop.length, 2);
  });

  it('--add-hooks는 CLAUDE_CONFIG_DIR이 있으면 훅 명령의 $HOME/.claude를 그 폴더로 바꿔 넣는다', () => {
    const dir = tmpDir();
    const file = write(dir, 'settings.json', {});
    run(['--add-hooks', file, KIT_HOOK, 'SubagentStop'], { env: { CLAUDE_CONFIG_DIR: path.join(dir, 'cc') } });
    const command = read(file).hooks.SubagentStop[0].hooks[0].command;
    assert.ok(command.includes(path.join(dir, 'cc').split(path.sep).join('/')), command);
    assert.equal(command.includes('$HOME/.claude'), false);
  });

  it('--add-hooks는 모르는 이벤트나 hooks가 객체가 아닌 파일이면 종료 코드 1이고 파일을 바꾸지 않는다', () => {
    const file = write(tmpDir(), 'settings.json', '{"hooks":[]}');
    assert.equal(run(['--add-hooks', file, KIT_HOOK, 'SubagentStop']).status, 1);
    assert.equal(fs.readFileSync(file, 'utf8'), '{"hooks":[]}');
    assert.equal(run(['--add-hooks', write(tmpDir(), 's.json', {}), KIT_HOOK, 'Stop']).status, 1);
  });

  it('--add-hooks는 심볼릭 링크면 가리키는 실제 파일에 쓰고 파일 권한을 지킨다', () => {
    const dir = tmpDir();
    const real = write(dir, 'real.json', mine);
    fs.chmodSync(real, 0o600);
    const link = path.join(dir, 'settings.json');
    fs.symlinkSync(real, link);
    run(['--add-hooks', link, KIT_HOOK, 'SubagentStop']);
    assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
    assert.equal(read(real).hooks.SubagentStop.length, 2);
    if (process.platform !== 'win32') assert.equal(fs.statSync(real).mode & 0o777, 0o600);
  });

  it('--remove-hooks는 이 키트의 훅 명령만 빼고 사용자의 다른 명령과 같은 묶음의 명령은 남기며 빈 묶음과 빈 이벤트는 지운다', () => {
    const file = write(tmpDir(), 'settings.json', {
      hooks: {
        SubagentStop: [{ hooks: [{ type: 'command', command: 'node "$HOME/.claude/subagent-system/scripts/subagent-usage.js" --hook' }] }, { hooks: [{ type: 'command', command: 'echo mine' }] }],
        SessionStart: [{ hooks: [{ type: 'command', command: 'node "$HOME/.claude/subagent-system/scripts/subagent-retro.js" --session-start' }, { type: 'command', command: 'keep' }] }],
      },
    });
    const r = run(['--remove-hooks', file, 'SubagentStop', 'SessionStart']);
    assert.match(r.stdout, /뺀 명령: 2개/);
    assert.deepEqual(read(file).hooks, { SubagentStop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }], SessionStart: [{ hooks: [{ type: 'command', command: 'keep' }] }] });
    const only = write(tmpDir(), 's.json', { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node "$HOME/.claude/subagent-system/scripts/subagent-retro.js" --session-start' }] }] }, model: 'm' });
    run(['--remove-hooks', only, 'SessionStart']);
    assert.deepEqual(read(only), { model: 'm' });
  });

  it('--remove-hooks는 키트 폴더 밖의 같은 파일 이름 훅과 이름만 닮은 훅은 남긴다', () => {
    const mine = [
      { type: 'command', command: 'node /home/me/hooks/usage-autolog.js' },
      { type: 'command', command: 'node /home/me/my-subagent-system-notes/usage-autolog.js' },
      { type: 'command', command: 'node "C:\\Users\\me\\.claude\\other\\retro-write-allow.js"' },
    ];
    const kit = [
      { type: 'command', command: 'node "$HOME/.claude/subagent-system/hooks/usage-autolog.js"' },
      { type: 'command', command: 'node "C:\\Users\\me\\.claude\\subagent-system\\hooks\\retro-write-allow.js"' },
    ];
    const file = write(tmpDir(), 'settings.json', { hooks: { SubagentStop: [{ hooks: [mine[0], mine[1], kit[0]] }], PermissionRequest: [{ hooks: [mine[2], kit[1]] }] } });
    const r = run(['--remove-hooks', file, 'SubagentStop', 'PermissionRequest']);
    assert.match(r.stdout, /뺀 명령: 2개/);
    assert.deepEqual(read(file).hooks, { SubagentStop: [{ hooks: [mine[0], mine[1]] }], PermissionRequest: [{ hooks: [mine[2]] }] });
  });

  it('--remove-hooks는 지정하지 않은 이벤트의 키트 훅은 건드리지 않고 settings.json이 없으면 종료 코드 1이다', () => {
    const file = write(tmpDir(), 'settings.json', { hooks: { SubagentStop: [{ hooks: [{ type: 'command', command: 'node subagent-usage.js' }] }] } });
    assert.match(run(['--remove-hooks', file, 'SessionStart']).stdout, /뺀 명령: 0개/);
    assert.equal(read(file).hooks.SubagentStop.length, 1);
    assert.equal(run(['--remove-hooks', path.join(tmpDir(), 'none.json'), 'SessionStart']).status, 1);
  });

  it('--merge-git-ask check는 아무것도 쓰지 않고 더할 개수와 allow에도 있는 항목을 찍고, merge는 거절한 항목을 빼고 끝에 더한다', () => {
    const kit = read(GIT_PERMISSIONS).permissions.ask;
    const dir = tmpDir();
    const settings = write(dir, 'settings.json', { permissions: { ask: [kit[0]], allow: [kit[1]] } });
    const config = write(dir, 'config.json', { gitAskDeclined: [kit[2]] });
    const before = fs.readFileSync(settings, 'utf8');
    const check = run(['--merge-git-ask', settings, GIT_PERMISSIONS, config, 'check']);
    assert.match(check.stdout, new RegExp(`allow에도 있음: ${kit[1].replace(/[().*+?^${}|[\]\\]/g, '\\$&')}`));
    assert.match(check.stdout, new RegExp(`더할 항목: ${kit.length - 2}개`));
    assert.equal(fs.readFileSync(settings, 'utf8'), before);
    assert.match(run(['--merge-git-ask', settings, GIT_PERMISSIONS, config, 'merge']).stdout, new RegExp(`더함: ${kit.length - 2}개`));
    const ask = read(settings).permissions.ask;
    assert.deepEqual(ask, [kit[0], ...kit.filter((x, i) => i !== 0 && i !== 2)]);
    assert.match(run(['--merge-git-ask', settings, GIT_PERMISSIONS, config, 'merge']).stdout, /더할 항목 없음/);
  });

  it('--remove-agent-meter는 env에서 agent-meter 경로와 keep-alive 키만 빼고 백업을 남기며 비면 env를 지운다', () => {
    const dir = tmpDir();
    const meter = path.join(dir, 'mods', 'agent-meter');
    const file = write(dir, 'settings.json', { env: { CLAUDE_CODE_PLUGIN_DIRS: ['/x/a', meter, '/y'].join(path.delimiter), AGENT_METER_KEEPALIVE: 'false', K: 'v' }, z: 1 });
    const r = run(['--remove-agent-meter', file, meter]);
    assert.match(r.stdout, /뺀 경로: 1개/);
    assert.match(r.stdout, /예전 keep-alive 값: 끔 \("false"\)/);
    assert.deepEqual(read(file), { env: { CLAUDE_CODE_PLUGIN_DIRS: ['/x/a', '/y'].join(path.delimiter), K: 'v' }, z: 1 });
    assert.equal(names(dir).filter((n) => n.startsWith('settings.json.bak-agent-meter-')).length, 1);

    const only = write(tmpDir(), 'settings.json', { env: { CLAUDE_CODE_PLUGIN_DIRS: meter } });
    run(['--remove-agent-meter', only, meter]);
    assert.deepEqual(read(only), {});
  });

  it('--remove-agent-meter는 뺄 것이 없으면 그렇게 찍고 파일과 백업을 만들지 않는다', () => {
    const dir = tmpDir();
    const file = write(dir, 'settings.json', { env: { Q: '1' } });
    assert.match(run(['--remove-agent-meter', file, path.join(dir, 'm')]).stdout, /뺄 것 없음/);
    assert.deepEqual(names(dir), ['settings.json']);
  });
});

describe('kit-setup.js 파일과 폴더 옮기기', () => {
  it('--move-agent-meter는 mods 폴더의 위 폴더에 백업 이름으로 옮기고 같은 이름이 있으면 -1을 붙이며, 폴더가 없으면 그렇게 찍는다', () => {
    const dir = tmpDir();
    const meter = path.join(dir, 'mods', 'agent-meter');
    write(dir, 'mods/agent-meter/a.txt', 'x');
    assert.match(run(['--move-agent-meter', meter]).stdout, /옮김: /);
    const moved = names(dir).filter((n) => n.startsWith('agent-meter-backup-'));
    assert.equal(moved.length, 1);
    assert.match(moved[0], /^agent-meter-backup-\d{8}-\d{6}$/);
    assert.equal(fs.existsSync(meter), false);
    write(dir, 'mods/agent-meter/b.txt', 'y');
    run(['--move-agent-meter', meter]);
    assert.equal(names(dir).filter((n) => n.startsWith('agent-meter-backup-')).length, 2);
    assert.match(run(['--move-agent-meter', meter]).stdout, /옮길 폴더 없음/);
  });

  it('--backup-file은 <파일>.bak-<이름>-<날짜-시각>으로 복사하고 경로를 찍으며 같은 이름이 있으면 -1을 붙인다', () => {
    const dir = tmpDir();
    const file = write(dir, 'settings.json', '{"a":1}');
    const first = run(['--backup-file', file, 'remove']).stdout.trim();
    const second = run(['--backup-file', file, 'remove']).stdout.trim();
    assert.match(path.basename(first), /^settings\.json\.bak-remove-\d{8}-\d{6}$/);
    assert.notEqual(first, second);
    assert.equal(fs.readFileSync(first, 'utf8'), '{"a":1}');
    assert.equal(run(['--backup-file', path.join(dir, 'none'), 'remove']).status, 1);
  });

  it('--check-json은 읽히면 조용히 끝나고 하나라도 깨졌으면 그 파일 이름과 함께 종료 코드 1이다', () => {
    const dir = tmpDir();
    const good = write(dir, 'a.json', '{}');
    const bad = write(dir, 'b.json', '{');
    assert.equal(run(['--check-json', good]).status, 0);
    const r = run(['--check-json', good, bad]);
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes(bad));
  });
});

// 설치, 업데이트, 제거 시험용 작은 키트. 파일 내용은 시험이 직접 고쳐 가며 쓴다.
const GIT_BOTH = {
  permissions: { ask: ['Bash(git checkout:*)', 'Bash(git commit:*)', 'Bash(git push:*)', 'Bash(git * push *)'] },
  personal: { permissions: { ask: ['Bash(git checkout:*)'] } },
};
const HOOKS_BOTH = {
  hooks: {
    SubagentStop: [{ hooks: [
      { type: 'command', command: 'node "$HOME/.claude/subagent-system/scripts/subagent-usage.js" --hook', timeout: 30 },
      { type: 'command', command: 'node "$HOME/.claude/subagent-system/hooks/usage-autolog.js"', timeout: 30 },
    ] }],
    PermissionRequest: [{ matcher: 'Write|Edit', hooks: [{ type: 'command', command: 'node "$HOME/.claude/subagent-system/hooks/retro-write-allow.js"', timeout: 10 }] },
      { matcher: '*', hooks: [{ type: 'command', command: 'node "$HOME/.claude/subagent-system/hooks/ask-log.js"', timeout: 10 }] }],
  },
};
const askLogCmds = (cfg) => (read(path.join(cfg, 'settings.json')).hooks?.PermissionRequest ?? []).flatMap((g) => g.hooks.map((x) => x.command)).filter((c) => c.includes('ask-log.js'));
const GUIDE_V1 = '# 가이드\n\n줄1\n줄2\n줄3\n줄4\n줄5\n줄6\n줄7\n줄8\n끝\n';

function makeKit(over = {}) {
  const kit = tmpDir();
  const files = {
    'subagent-system/VERSION': '2026.10.30\n',
    'subagent-system/docs/SUBAGENT_GUIDE.md': GUIDE_V1,
    'subagent-system/docs/RETRO.md': '# 회고\n\n내용\n',
    'subagent-system/docs/SUBAGENT_SITUATIONS.md': '# 상황별\n',
    'subagent-system/docs/AUTO_RETRO.md': '# 판정\n',
    'subagent-system/docs/SUBAGENT_BRIEF_CHECKLIST.md': '# 체크\n\n- 목표 줄\n',
    'subagent-system/docs/TESTING.md': '# 시험\n',
    'subagent-system/docs/DOC_WRITING.md': '# 문서\n',
    'subagent-system/docs/ROUTING_TABLE.md': '# 라우팅 표\n\n<!-- 키트 원본의 예시(백엔드)입니다 -->\n\n| | low |\n|:---|:---|\n| **Haiku** | 예시 |\n',
    'subagent-system/agents/haiku-low.md': '---\nname: haiku-low\n---\n본문\n',
    'subagent-system/agents/opus-high.md': '---\nname: opus-high\n---\n본문\n',
    'subagent-system/rules/kit-core.md': '- 핵심 규칙 ~/.claude/x\n',
    'subagent-system/rules/kit-recommended.md': '- 권장 규칙\n',
    'subagent-system/rules/kit-db.md': '- DB 규칙\n',
    'subagent-system/skills/retro/SKILL.md': '---\nname: retro\n---\n$HOME/.claude/subagent-system/scripts/subagent-retro.js\n',
    'subagent-system/skills/git-work/SKILL.md': '---\nname: git-work\n---\n본문\n',
    'subagent-system/skills/ab-test/SKILL.md': '---\nname: ab-test\n---\n본문\n',
    'subagent-system/scripts/tool.js': 'export const v = 1;\n',
    'subagent-system/scripts/package.json': '{"type": "module"}\n',
    'subagent-system/hooks/usage-autolog.js': '// hook\n',
    'subagent-system/rates.json': { _checked: '2026-10', 'm-a': { input: 1 } },
    'subagent-system/settings-hook.json': HOOKS_BOTH,
    'extras/git-permissions.json': GIT_BOTH,
    ...over,
  };
  for (const [name, value] of Object.entries(files)) if (value !== null) write(kit, name, value);
  return kit;
}
const kitSet = (kit, name, value) => write(kit, name, value);
const jsonOut = (r) => {
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};
const install = (kit, cfg, ...extra) => jsonOut(run(['install', '--kit', kit, ...extra], { env: { CLAUDE_CONFIG_DIR: cfg } }));
const update = (kit, cfg, ...extra) => jsonOut(run(['update', '--kit', kit, ...extra], { env: { CLAUDE_CONFIG_DIR: cfg } }));
const HAS_GIT = spawnSync('git', ['--version']).status === 0;
const git = (cwd, ...args) => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
};
const commitAll = (kit, message) => {
  git(kit, 'add', '-A');
  git(kit, 'commit', '-q', '-m', message);
};
const cfgRead = (cfg, rel) => fs.readFileSync(path.join(cfg, rel), 'utf8');
const exists = (cfg, rel) => fs.existsSync(path.join(cfg, rel));
const baks = (dir, prefix) => fs.readdirSync(dir).filter((n) => n.startsWith(prefix));
const CONFIG = (cfg) => read(path.join(cfg, 'subagent-system/config.json'));
// 키트가 남기는 knownOptional(선택 항목 목록)을 뺀 설정이다. 설정 키 모양을 통째로 견줄 때 쓴다.
const CONFIG_KEYS = (cfg) => { const { knownOptional, ...rest } = CONFIG(cfg); return rest; };
// profile이 없는 업데이트 전 설치본을 만든다. 설정은 주어진 키만 남긴다.
const legacyInstalled = (config) => {
  const kit = makeKit();
  const cfg = tmpDir();
  install(kit, cfg, '--profile', 'personal');
  write(cfg, 'subagent-system/config.json', config);
  return { kit, cfg, file: path.join(cfg, 'subagent-system', 'config.json') };
};

describe('kit-setup.js install', () => {
  it('개인용 처음 설치는 파일과 .kit-base를 놓고 profile 기본값을 모두 적으며 git 확인은 personal 목록만 더한다', () => {
    const kit = makeKit();
    const cfg = tmpDir();
    write(cfg, 'settings.json', { model: 'x', permissions: { ask: ['Bash(rm:*)'] } });
    const r = install(kit, cfg, '--profile', 'personal');
    assert.equal(r.settings.gitAsk.added, 1);
    assert.deepEqual(read(path.join(cfg, 'settings.json')).permissions.ask, ['Bash(rm:*)', 'Bash(git checkout:*)']);
    for (const rel of ['subagent-system/docs/SUBAGENT_GUIDE.md', 'subagent-system/docs/SUBAGENT_SITUATIONS.md', 'subagent-system/docs/AUTO_RETRO.md', 'subagent-system/docs/TESTING.md', 'subagent-system/docs/DOC_WRITING.md', 'subagent-system/docs/ROUTING_TABLE.md', 'agents/opus-high.md', 'rules/kit-core.md', 'skills/retro/SKILL.md', 'subagent-system/scripts/tool.js', 'subagent-system/hooks/usage-autolog.js', 'subagent-system/rates.json', 'subagent-system/VERSION']) {
      assert.equal(exists(cfg, rel), true, rel);
    }
    assert.equal(cfgRead(cfg, 'subagent-system/.kit-base/agents/opus-high.md'), cfgRead(cfg, 'agents/opus-high.md'));
    assert.equal(exists(cfg, 'subagent-system/.kit-base/subagent-system/docs/ROUTING_TABLE.md'), false);
    assert.deepEqual(CONFIG_KEYS(cfg), {
      profile: 'personal', retroMode: 'auto', retroWriteAllow: true, commitCheck: 'block',
    });
    assert.equal(cfgRead(cfg, 'subagent-system/VERSION'), '2026.10.30\n');
  });

  it('회사용 처음 설치는 retroMode ask와 승인 쪽 기본값을 적고 commit, push 확인까지 더한다', () => {
    const cfg = tmpDir();
    install(makeKit(), cfg, '--profile', 'company');
    assert.deepEqual(CONFIG_KEYS(cfg), {
      profile: 'company', retroMode: 'ask', retroWriteAllow: false, commitCheck: 'off',
    });
    assert.deepEqual(read(path.join(cfg, 'settings.json')).permissions.ask, GIT_BOTH.permissions.ask);
  });

  it('회사용은 config의 gitAskDeclined 항목을 더하지 않고 개인용은 그 키를 지운다', () => {
    const company = tmpDir();
    write(company, 'subagent-system/config.json', { gitAskDeclined: ['Bash(git push:*)'] });
    install(makeKit(), company, '--profile', 'company');
    assert.equal(read(path.join(company, 'settings.json')).permissions.ask.includes('Bash(git push:*)'), false);
    const personal = tmpDir();
    write(personal, 'subagent-system/config.json', { gitAskDeclined: ['Bash(git push:*)'], goalMethodDeclined: true });
    install(makeKit(), personal, '--profile', 'personal');
    assert.equal('gitAskDeclined' in CONFIG(personal), false);
    assert.equal('goalMethodDeclined' in CONFIG(personal), false);
  });

  it('SubagentStop 훅 둘을 한 묶음으로, 개인용만 PermissionRequest 훅을 settings.json에 더한다', () => {
    const personal = tmpDir();
    install(makeKit(), personal, '--profile', 'personal');
    const hooks = read(path.join(personal, 'settings.json')).hooks;
    assert.equal(hooks.SubagentStop[0].hooks.length, 2);
    assert.match(JSON.stringify(hooks.PermissionRequest), /retro-write-allow\.js/);
    const company = tmpDir();
    install(makeKit(), company, '--profile', 'company');
    const companyRequest = read(path.join(company, 'settings.json')).hooks.PermissionRequest;
    assert.doesNotMatch(JSON.stringify(companyRequest), /retro-write-allow\.js/);
  });

  it('ask-log 훅은 개인용과 회사용 모두 matcher *로 PermissionRequest에 걸리고 update가 두 번 넣지 않으며 uninstall이 지운다', () => {
    const kit = makeKit();
    for (const profile of ['personal', 'company']) {
      const cfg = tmpDir();
      install(kit, cfg, '--profile', profile);
      const groups = read(path.join(cfg, 'settings.json')).hooks.PermissionRequest;
      assert.equal(groups.find((g) => g.hooks.some((x) => x.command.includes('ask-log.js'))).matcher, '*');
      assert.equal(askLogCmds(cfg).length, 1);
      update(kit, cfg);
      assert.equal(askLogCmds(cfg).length, 1);
      const s = read(path.join(cfg, 'settings.json'));
      s.hooks.PermissionRequest = s.hooks.PermissionRequest.filter((g) => !g.hooks.some((x) => x.command.includes('ask-log.js')));
      write(cfg, 'settings.json', s);
      update(kit, cfg);
      assert.equal(askLogCmds(cfg).length, 1, '지운 등록은 update가 다시 단다');
      jsonOut(run(['uninstall', '--kit', kit, '--records', 'delete'], { env: { CLAUDE_CONFIG_DIR: cfg } }));
      assert.equal(askLogCmds(cfg).length, 0);
    }
  });

  it('사용자가 다른 경로에 둔 같은 이름의 ask-log 훅은 키트 것으로 보지 않아 지우지 않는다', () => {
    const cfg = tmpDir();
    const mine = { type: 'command', command: 'node "/home/me/other/ask-log.js"' };
    write(cfg, 'settings.json', { hooks: { PermissionRequest: [{ matcher: '*', hooks: [mine] }] } });
    const kit = makeKit();
    install(kit, cfg, '--profile', 'company');
    assert.equal(askLogCmds(cfg).length, 2);
    jsonOut(run(['uninstall', '--kit', kit, '--records', 'delete'], { env: { CLAUDE_CONFIG_DIR: cfg } }));
    assert.deepEqual(askLogCmds(cfg), [mine.command]);
  });

  it('kit-core는 늘 놓고 --rules, --skills로 고른 것만 더하며 키트에 없는 이름은 오류다', () => {
    const cfg = tmpDir();
    const r = install(makeKit(), cfg, '--profile', 'personal', '--rules', 'recommended', '--skills', 'git-work');
    assert.deepEqual(names(path.join(cfg, 'rules')), ['kit-core.md', 'kit-recommended.md']);
    assert.equal(exists(cfg, 'skills/git-work/SKILL.md'), true);
    assert.deepEqual(r.unchosenOptional.rules, ['kit-db.md']);
    assert.deepEqual(r.newOptional.rules, []);
    const bad = run(['install', '--kit', makeKit(), '--profile', 'personal', '--rules', 'nope'], { env: { CLAUDE_CONFIG_DIR: tmpDir() } });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /키트에 없는 규칙: nope/);
  });

  it('끊긴 설치를 다른 선택으로 다시 돌리면 키트가 놓은 그대로인 선택 항목은 지우고 고친 것은 두고 알린다', () => {
    const kit = makeKit();
    const cfg = tmpDir();
    install(kit, cfg, '--profile', 'personal', '--rules', 'recommended,db', '--skills', 'git-work');
    fs.rmSync(path.join(cfg, 'subagent-system/VERSION'));
    fs.appendFileSync(path.join(cfg, 'rules/kit-db.md'), '- 내가 더한 줄\n');
    const r = install(kit, cfg, '--profile', 'company');
    assert.deepEqual(names(path.join(cfg, 'rules')), ['kit-core.md', 'kit-db.md']);
    assert.equal(exists(cfg, 'skills/git-work'), false);
    assert.deepEqual(r.unchosenRemoved, ['rules/kit-recommended.md', 'skills/git-work/SKILL.md']);
    assert.deepEqual(r.unchosenKept, ['rules/kit-db.md']);
    assert.ok(r.notes.some((n) => /뺄지 물으세요/.test(n)));
  });

  it('주제별로 나뉜 키트에서 옛 이름 recommended는 kit-rec-* 파일 전부로 풀리고 같이 적은 이름과 겹쳐도 한 번만 놓는다', () => {
    const split = { 'subagent-system/rules/kit-recommended.md': null, 'subagent-system/rules/kit-rec-a.md': '- a\n', 'subagent-system/rules/kit-rec-b.md': '- b\n' };
    const cfg = tmpDir();
    const r = install(makeKit(split), cfg, '--profile', 'personal', '--rules', 'recommended,rec-a');
    assert.deepEqual(names(path.join(cfg, 'rules')), ['kit-core.md', 'kit-rec-a.md', 'kit-rec-b.md']);
    assert.deepEqual(r.unchosenOptional.rules, ['kit-db.md']);
  });

  it('옛 kit-recommended.md를 깔아 둔 설치본은 업데이트에서 kit-rec-* 파일 전부를 받고 옛 파일은 지워진다', () => {
    const kit = makeKit();
    const cfg = tmpDir();
    install(kit, cfg, '--profile', 'personal', '--rules', 'recommended');
    fs.rmSync(path.join(kit, 'subagent-system/rules/kit-recommended.md'));
    kitSet(kit, 'subagent-system/rules/kit-rec-a.md', '- a\n');
    kitSet(kit, 'subagent-system/rules/kit-rec-b.md', '- b\n');
    const r = update(kit, cfg);
    assert.deepEqual(names(path.join(cfg, 'rules')), ['kit-core.md', 'kit-rec-a.md', 'kit-rec-b.md']);
    assert.deepEqual(r.orphansRemoved, ['rules/kit-recommended.md']);
  });

  it('add는 고른 규칙과 스킬 파일을 .kit-base와 함께 새로 놓고 --dry-run이면 아무것도 쓰지 않는다', () => {
    const kit = makeKit();
    const cfg = tmpDir();
    install(kit, cfg, '--profile', 'personal');
    const env = { CLAUDE_CONFIG_DIR: cfg };
    const dry = jsonOut(run(['add', '--kit', kit, '--rules', 'db', '--skills', 'git-work', '--dry-run'], { env }));
    assert.deepEqual(dry.added, ['rules/kit-db.md', 'skills/git-work/SKILL.md']);
    assert.equal(exists(cfg, 'rules/kit-db.md'), false);
    const r = jsonOut(run(['add', '--kit', kit, '--rules', 'db', '--skills', 'git-work'], { env }));
    assert.deepEqual(r.added, ['rules/kit-db.md', 'skills/git-work/SKILL.md']);
    assert.equal(cfgRead(cfg, 'rules/kit-db.md'), '- DB 규칙\n');
    assert.equal(cfgRead(cfg, 'subagent-system/.kit-base/skills/git-work/SKILL.md'), cfgRead(cfg, 'skills/git-work/SKILL.md'));
  });

  it('add는 이미 있는 파일을 건너뛰고 고친 내용을 지킨다', () => {
    const kit = makeKit();
    const cfg = tmpDir();
    install(kit, cfg, '--profile', 'personal', '--rules', 'db');
    write(cfg, 'rules/kit-db.md', '- 내가 고친 규칙\n');
    const r = jsonOut(run(['add', '--kit', kit, '--rules', 'db,recommended'], { env: { CLAUDE_CONFIG_DIR: cfg } }));
    assert.deepEqual(r.skipped, ['rules/kit-db.md']);
    assert.deepEqual(r.added, ['rules/kit-recommended.md']);
    assert.equal(cfgRead(cfg, 'rules/kit-db.md'), '- 내가 고친 규칙\n');
  });

  it('--command-name을 주면 retro 스킬이 그 이름 폴더에 놓이고 name 줄이 바뀐다', () => {
    const cfg = tmpDir();
    install(makeKit(), cfg, '--profile', 'personal', '--command-name', 'sub-retro');
    assert.match(cfgRead(cfg, 'skills/sub-retro/SKILL.md'), /^---\nname: sub-retro\n---/);
    assert.equal(exists(cfg, 'skills/retro'), false);
    assert.equal(CONFIG(cfg).commandName, 'sub-retro');
  });

  it('CLAUDE_CONFIG_DIR이 있으면 문서와 스킬의 ~/.claude와 $HOME/.claude를 그 폴더로 바꿔 놓고 .kit-base에도 같은 글을 둔다', () => {
    const cfg = tmpDir();
    install(makeKit(), cfg, '--profile', 'personal');
    const dir = cfg.split(path.sep).join('/');
    assert.equal(cfgRead(cfg, 'rules/kit-core.md'), `- 핵심 규칙 ${dir}/x\n`);
    assert.match(cfgRead(cfg, 'skills/retro/SKILL.md'), new RegExp(`^${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/subagent-system/scripts`, 'm'));
    assert.equal(cfgRead(cfg, 'subagent-system/.kit-base/rules/kit-core.md'), cfgRead(cfg, 'rules/kit-core.md'));
  });

  it('이미 설치된 곳에 install을 하면 오류이고, --profile이 없거나 틀려도 오류이며 아무것도 쓰지 않는다', () => {
    const cfg = tmpDir();
    const kit = makeKit();
    install(kit, cfg, '--profile', 'personal');
    const again = run(['install', '--kit', kit, '--profile', 'personal'], { env: { CLAUDE_CONFIG_DIR: cfg } });
    assert.equal(again.status, 1);
    assert.match(again.stderr, /이미 설치/);
    const empty = tmpDir();
    assert.equal(run(['install', '--kit', kit], { env: { CLAUDE_CONFIG_DIR: empty } }).status, 1);
    assert.equal(run(['install', '--kit', kit, '--profile', 'x'], { env: { CLAUDE_CONFIG_DIR: empty } }).status, 1);
    assert.deepEqual(names(empty), []);
  });

  it('--dry-run은 아무 파일도 만들지 않는다', () => {
    const cfg = tmpDir();
    const r = install(makeKit(), cfg, '--profile', 'personal', '--dry-run');
    assert.equal(r.dryRun, true);
    assert.deepEqual(names(cfg), []);
  });

  it('처음 설치가 VERSION을 놓기 전에 끊겼으면 install을 다시 돌려 이어 할 수 있고 update는 거절한다', () => {
    const cfg = tmpDir();
    const kit = makeKit();
    install(kit, cfg, '--profile', 'personal');
    fs.rmSync(path.join(cfg, 'subagent-system/VERSION'));
    assert.equal(run(['update', '--kit', kit], { env: { CLAUDE_CONFIG_DIR: cfg } }).status, 1);
    const r = install(kit, cfg, '--profile', 'personal');
    assert.equal(r.counts.unchanged > 0, true);
    assert.equal(exists(cfg, 'subagent-system/VERSION'), true);
  });

  const REAL_KIT = path.resolve(SCRIPTS, '..', '..');
  const SKIP_NOT_KIT = fs.existsSync(path.join(REAL_KIT, 'subagent-system', 'rules')) ? false : '설치본 배치라 두 단계 위가 키트 폴더가 아님(키트 원본에서만 시험)';
  it('같은 설정 폴더로 설치한 회고 스크립트가 install이 쓴 config.json을 같은 경로에서 읽는다', { skip: SKIP_NOT_KIT }, () => {
    const cfg = tmpDir();
    const r = jsonOut(run(['install', '--kit', REAL_KIT, '--profile', 'personal', '--no-git-ask'], { env: { CLAUDE_CONFIG_DIR: cfg } }));
    assert.equal(r.config.file, path.join(cfg, 'subagent-system/config.json'));
    const env = { ...cleanEnv(), CLAUDE_CONFIG_DIR: cfg };
    const status = spawnSync(process.execPath, [path.join(cfg, 'subagent-system/scripts/subagent-retro.js'), '--status'], { env, encoding: 'utf8' });
    assert.match(status.stdout, /회고 방식: 자동\(auto\)/);
    const company = tmpDir();
    jsonOut(run(['install', '--kit', REAL_KIT, '--profile', 'company', '--no-git-ask'], { env: { CLAUDE_CONFIG_DIR: company } }));
    const ask = spawnSync(process.execPath, [path.join(company, 'subagent-system/scripts/subagent-retro.js'), '--status'], { env: { ...env, CLAUDE_CONFIG_DIR: company }, encoding: 'utf8' });
    assert.match(ask.stdout, /회고 방식: 묻기\(ask\)/);
  });
});

describe('kit-setup.js update', () => {
  const installed = (extra = []) => {
    const kit = makeKit();
    const cfg = tmpDir();
    install(kit, cfg, '--profile', 'personal', ...extra);
    return { kit, cfg };
  };

  it('사용자가 안 고친 파일은 새 키트로 바꾸고 .kit-base도 새 키트로 맞추며 백업은 만들지 않는다', () => {
    const { kit, cfg } = installed();
    kitSet(kit, 'subagent-system/docs/RETRO.md', '# 회고\n\n새 내용\n');
    kitSet(kit, 'subagent-system/VERSION', '2026.10.31\n');
    const r = update(kit, cfg);
    assert.equal(cfgRead(cfg, 'subagent-system/docs/RETRO.md'), '# 회고\n\n새 내용\n');
    assert.equal(cfgRead(cfg, 'subagent-system/.kit-base/subagent-system/docs/RETRO.md'), '# 회고\n\n새 내용\n');
    assert.equal(cfgRead(cfg, 'subagent-system/VERSION'), '2026.10.31\n');
    assert.equal(r.fromVersion, '2026.10.30');
    assert.deepEqual(baks(path.join(cfg, 'subagent-system/docs'), 'RETRO.md.bak'), []);
  });

  it('같은 키트로 update를 두 번 돌리면 두 번째는 바꾸는 파일과 새 백업이 없다', () => {
    const { kit, cfg } = installed();
    kitSet(kit, 'subagent-system/docs/RETRO.md', '# 회고\n\n새 내용\n');
    kitSet(kit, 'subagent-system/VERSION', '2026.10.31\n');
    update(kit, cfg);
    const snapshot = () => {
      const all = {};
      const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, e.name);
          if (e.isDirectory()) walk(p);
          else all[path.relative(cfg, p)] = fs.readFileSync(p, 'utf8');
        }
      };
      walk(cfg);
      return all;
    };
    const before = snapshot();
    const again = update(kit, cfg);
    assert.deepEqual(again.files, []);
    assert.deepEqual(snapshot(), before);
  });

  it('사용자 고침과 키트 고침이 다른 자리면 둘 다 살려 병합하고 고치기 전 파일을 옆에 백업한다', () => {
    const { kit, cfg } = installed();
    const mine = GUIDE_V1.replace('줄2', '내 줄2');
    fs.writeFileSync(path.join(cfg, 'subagent-system/docs/SUBAGENT_GUIDE.md'), mine);
    kitSet(kit, 'subagent-system/docs/SUBAGENT_GUIDE.md', GUIDE_V1.replace('줄8', '키트 줄8'));
    const r = update(kit, cfg);
    assert.equal(cfgRead(cfg, 'subagent-system/docs/SUBAGENT_GUIDE.md'), GUIDE_V1.replace('줄2', '내 줄2').replace('줄8', '키트 줄8'));
    assert.deepEqual(r.files.map((f) => [f.key, f.status]), [['subagent-system/docs/SUBAGENT_GUIDE.md', 'merged']]);
    const [bak] = baks(path.join(cfg, 'subagent-system/docs'), 'SUBAGENT_GUIDE.md.bak-update-');
    assert.equal(fs.readFileSync(path.join(cfg, 'subagent-system/docs', bak), 'utf8'), mine);
  });

  it('같은 자리를 다르게 고쳤으면 충돌 표시를 남기고 .kit-base는 새 키트로 두며, 표시를 풀기 전 다시 돌리면 그 파일은 건드리지 않는다', () => {
    const { kit, cfg } = installed();
    const file = path.join(cfg, 'subagent-system/docs/SUBAGENT_GUIDE.md');
    fs.writeFileSync(file, GUIDE_V1.replace('줄5', '내 줄5'));
    const v2 = GUIDE_V1.replace('줄5', '키트 줄5');
    kitSet(kit, 'subagent-system/docs/SUBAGENT_GUIDE.md', v2);
    const r = update(kit, cfg);
    assert.deepEqual(r.conflictFiles, ['subagent-system/docs/SUBAGENT_GUIDE.md']);
    assert.match(fs.readFileSync(file, 'utf8'), /<<<<<<< 설치본\n내 줄5\n=======\n키트 줄5\n>>>>>>> 새 키트/);
    assert.equal(cfgRead(cfg, 'subagent-system/.kit-base/subagent-system/docs/SUBAGENT_GUIDE.md'), v2);
    const before = fs.readFileSync(file, 'utf8');
    const again = update(kit, cfg);
    assert.deepEqual(again.unresolvedFiles, ['subagent-system/docs/SUBAGENT_GUIDE.md']);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  });

  it('충돌을 푼 뒤의 업데이트는 새 키트를 기준으로 병합해 이미 거절한 키트 줄을 다시 묻지 않는다', () => {
    const { kit, cfg } = installed();
    const file = path.join(cfg, 'subagent-system/docs/SUBAGENT_GUIDE.md');
    fs.writeFileSync(file, GUIDE_V1.replace('줄5', '내 줄5'));
    kitSet(kit, 'subagent-system/docs/SUBAGENT_GUIDE.md', GUIDE_V1.replace('줄5', '키트 줄5'));
    update(kit, cfg);
    fs.writeFileSync(file, GUIDE_V1.replace('줄5', '내 줄5'));
    kitSet(kit, 'subagent-system/docs/SUBAGENT_GUIDE.md', GUIDE_V1.replace('줄5', '키트 줄5').replace('줄8', '키트 줄8'));
    const r = update(kit, cfg);
    assert.deepEqual(r.conflictFiles, []);
    assert.equal(fs.readFileSync(file, 'utf8'), GUIDE_V1.replace('줄5', '내 줄5').replace('줄8', '키트 줄8'));
  });

  it('손댄 스크립트는 새 키트로 덮되 옆에 백업을 남기고, 손대지 않은 스크립트는 백업 없이 바꾼다', () => {
    const { kit, cfg } = installed();
    fs.writeFileSync(path.join(cfg, 'subagent-system/scripts/tool.js'), 'export const v = 99;\n');
    kitSet(kit, 'subagent-system/scripts/tool.js', 'export const v = 2;\n');
    kitSet(kit, 'subagent-system/hooks/usage-autolog.js', '// hook 2\n');
    const r = update(kit, cfg);
    assert.equal(cfgRead(cfg, 'subagent-system/scripts/tool.js'), 'export const v = 2;\n');
    assert.equal(baks(path.join(cfg, 'subagent-system/scripts'), 'tool.js.bak-update-').length, 1);
    assert.equal(cfgRead(cfg, 'subagent-system/hooks/usage-autolog.js'), '// hook 2\n');
    assert.deepEqual(baks(path.join(cfg, 'subagent-system/hooks'), 'usage-autolog.js.bak'), []);
    assert.equal(r.files.find((f) => f.key.endsWith('tool.js')).status, 'overwritten-modified');
    const note = r.notes.filter((n) => n.startsWith('스크립트와 훅은 병합하지 않고'));
    assert.equal(note.length, 1);
    assert.match(note[0], /tool\.js/);
    assert.doesNotMatch(note[0], /usage-autolog/);
  });

  it('키트에서 빠진 스크립트는 손대지 않았으면 지우고 손댔으면 남겨 알린다', () => {
    const { kit, cfg } = installed();
    kitSet(kit, 'subagent-system/scripts/old.js', 'a\n');
    kitSet(kit, 'subagent-system/scripts/old2.js', 'b\n');
    update(kit, cfg);
    fs.writeFileSync(path.join(cfg, 'subagent-system/scripts/old2.js'), 'mine\n');
    fs.rmSync(path.join(kit, 'subagent-system/scripts/old.js'));
    fs.rmSync(path.join(kit, 'subagent-system/scripts/old2.js'));
    const r = update(kit, cfg);
    assert.deepEqual(r.orphansRemoved, ['subagent-system/scripts/old.js']);
    assert.deepEqual(r.orphansKept, ['subagent-system/scripts/old2.js']);
    assert.equal(exists(cfg, 'subagent-system/scripts/old.js'), false);
    assert.equal(exists(cfg, 'subagent-system/scripts/old2.js'), true);
  });

  it('ROUTING_TABLE.md와 고르지 않은 규칙 및 스킬은 건드리지 않고, 새로 생긴 선택 항목은 알리기만 한다', () => {
    const { kit, cfg } = installed();
    fs.writeFileSync(path.join(cfg, 'subagent-system/docs/ROUTING_TABLE.md'), '내 표\n');
    kitSet(kit, 'subagent-system/docs/ROUTING_TABLE.md', '키트 새 표\n');
    kitSet(kit, 'subagent-system/rules/kit-new.md', '- 새\n');
    const r = update(kit, cfg);
    assert.equal(cfgRead(cfg, 'subagent-system/docs/ROUTING_TABLE.md'), '내 표\n');
    assert.equal(exists(cfg, 'rules/kit-recommended.md'), false);
    assert.deepEqual(r.newOptional.rules, ['kit-new.md']);
    assert.deepEqual(r.unchosenOptional.rules, ['kit-db.md', 'kit-recommended.md']);
    assert.ok(cfgRead(cfg, 'subagent-system/config.json').includes('kit-new.md'), 'knownOptional에 새 항목이 남는다');
    const again = update(kit, cfg);
    assert.deepEqual(again.newOptional.rules, []);
    assert.deepEqual(again.unchosenOptional.rules, ['kit-db.md', 'kit-new.md', 'kit-recommended.md']);
  });

  it('knownOptional이 없는 옛 설치는 첫 업데이트에서 고르지 않은 항목을 모두 고르지 않음으로 보고 새것으로 알리지 않으며 목록을 남긴다', () => {
    const { kit, cfg } = installed();
    const file = path.join(cfg, 'subagent-system/config.json');
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete c.knownOptional;
    fs.writeFileSync(file, JSON.stringify(c));
    kitSet(kit, 'subagent-system/rules/kit-new.md', '- 새\n');
    const r = update(kit, cfg);
    assert.deepEqual(r.newOptional, { rules: [], skills: [], hooks: [] });
    assert.deepEqual(r.unchosenOptional.rules, ['kit-db.md', 'kit-new.md', 'kit-recommended.md']);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).knownOptional.rules, ['kit-db.md', 'kit-new.md', 'kit-recommended.md']);
  });

  it('install은 키트의 선택 항목 목록을 config.json의 knownOptional에 남기고 새것은 없다고 낸다', () => {
    const cfg = tmpDir();
    const r = install(makeKit(), cfg, '--profile', 'personal');
    assert.deepEqual(r.newOptional, { rules: [], skills: [], hooks: [] });
    assert.deepEqual(JSON.parse(cfgRead(cfg, 'subagent-system/config.json')).knownOptional.rules, ['kit-db.md', 'kit-recommended.md']);
  });

  it('rates.json은 설치본 값을 지키고 키트에만 있는 모델 키만 더하며 값이 다른 모델은 알리기만 한다', () => {
    const { kit, cfg } = installed();
    fs.writeFileSync(path.join(cfg, 'subagent-system/rates.json'), JSON.stringify({ _checked: '2026-09', 'm-a': { input: 5 } }));
    kitSet(kit, 'subagent-system/rates.json', { _checked: '2026-10', 'm-a': { input: 1 }, 'm-b': { input: 2 } });
    const r = update(kit, cfg);
    const rates = read(path.join(cfg, 'subagent-system/rates.json'));
    assert.deepEqual(rates, { _checked: '2026-10', 'm-a': { input: 5 }, 'm-b': { input: 2 } });
    assert.deepEqual(r.files.find((f) => f.key.endsWith('rates.json')).differs, ['m-a']);
  });

  it('권한은 줄이지 않는다: 사용자의 permissions.ask와 개인용의 commit 확인 없음이 그대로이고, --git-ask를 줘도 없는 항목만 더한다', () => {
    const { kit, cfg } = installed();
    const file = path.join(cfg, 'settings.json');
    const mine = ['Bash(rm:*)', 'Bash(git commit:*)', 'Bash(git checkout:*)'];
    write(cfg, 'settings.json', { ...read(file), permissions: { ask: mine, allow: ['Bash(ls)'] } });
    const r = update(kit, cfg);
    assert.deepEqual(read(file).permissions, { ask: mine, allow: ['Bash(ls)'] });
    assert.deepEqual(r.settings.gitAsk.keptCommitAsks, ['Bash(git commit:*)']);
    update(kit, cfg, '--git-ask');
    assert.deepEqual(read(file).permissions.ask, mine);
  });

  it('회사용 update는 git 확인을 자동으로 더하지 않고 알리기만 하며, --git-ask를 줄 때만 더한다', () => {
    const kit = makeKit();
    const cfg = tmpDir();
    install(kit, cfg, '--profile', 'company', '--no-git-ask');
    const file = path.join(cfg, 'settings.json');
    const r = update(kit, cfg);
    assert.equal(r.settings.gitAsk.missing, 4);
    assert.equal(read(file).permissions, undefined);
    update(kit, cfg, '--git-ask');
    assert.deepEqual(read(file).permissions.ask, GIT_BOTH.permissions.ask);
  });

  it('옛 SessionStart 훅 명령은 지우고 같은 묶음의 사용자 명령은 남기며, 빠진 SubagentStop 훅을 더한다', () => {
    const { kit, cfg } = installed();
    const file = path.join(cfg, 'settings.json');
    const s = read(file);
    s.hooks.SessionStart = [{ hooks: [{ type: 'command', command: 'node "$HOME/.claude/subagent-system/scripts/subagent-retro.js" --session-start' }, { type: 'command', command: 'keep' }] }];
    s.hooks.SubagentStop = [{ hooks: [{ type: 'command', command: 'node "$HOME/.claude/subagent-system/scripts/subagent-usage.js" --hook' }] }];
    write(cfg, 'settings.json', s);
    const r = update(kit, cfg);
    assert.equal(r.settings.legacySessionStartRemoved, 1);
    const after = read(file).hooks;
    assert.deepEqual(after.SessionStart, [{ hooks: [{ type: 'command', command: 'keep' }] }]);
    assert.equal(JSON.stringify(after.SubagentStop).includes('usage-autolog.js'), true);
    assert.equal(after.SubagentStop[0].hooks.length, 1);
  });

  const walk = (root, rel = '') => fs.readdirSync(path.join(root, rel)).flatMap((n) => {
    const r = rel ? path.join(rel, n) : n;
    return fs.statSync(path.join(root, r)).isDirectory() ? [r, ...walk(root, r)] : [r];
  });
  const snapshot = (cfg) => walk(cfg).sort().map((f) => {
    const p = path.join(cfg, f);
    return fs.statSync(p).isFile() ? `${f}:${sha256(fs.readFileSync(p, 'utf8'))}` : f;
  });
  const sha256 = (t) => createHash('sha256').update(t).digest('hex');

  it('profile이 없는 옛 설치본은 retroMode가 무엇이든 update가 아무것도 바꾸지 않고 needsProfile과 종료 코드 2로 멈추며, --dry-run도 같다', () => {
    for (const retroMode of ['ask', 'auto']) {
      const { kit, cfg } = legacyInstalled({ retroMode, roles: ['백엔드'], goalMethodDeclined: true, gitAskDeclined: ['x'] });
      const before = snapshot(cfg);
      for (const extra of [[], ['--dry-run']]) {
        const r = run(['update', '--kit', kit, ...extra], { env: { CLAUDE_CONFIG_DIR: cfg } });
        assert.equal(r.status, 2, r.stderr);
        const out = JSON.parse(r.stdout);
        assert.equal(out.needsProfile, true);
        assert.match(out.notes[0], /set-profile personal\|company/);
        assert.equal(out.files, undefined);
        assert.deepEqual(snapshot(cfg), before, `${retroMode} ${extra.join(' ')}: 멈춘 update가 파일을 바꿨다`);
      }
    }
  });

  it('profile이 없던 옛 설치본은 set-profile 뒤 update가 돌아 빠진 키만 채우고 쓰지 않는 declined 키를 지우며 retroWriteAllow를 켜지 않는다', () => {
    for (const [to, mode, writeAllow] of [['company', 'ask', false], ['personal', 'auto', false]]) {
      const { kit, cfg } = legacyInstalled({ retroMode: 'ask', roles: ['백엔드'], goalMethodDeclined: true, checklistDeclined: ['a'], gitAskDeclined: ['x'] });
      const sp = jsonOut(run(['set-profile', to], { env: { CLAUDE_CONFIG_DIR: cfg } }));
      assert.equal(sp.changes[0], `profile: 없음 -> ${to}`);
      assert.equal('retroWriteAllow' in CONFIG(cfg), false, 'set-profile이 retroWriteAllow를 만들었다');
      assert.equal('commitCheck' in CONFIG(cfg), false, 'set-profile이 commitCheck를 만들었다');
      const r = update(kit, cfg);
      assert.equal(r.config.changes.includes('retroWriteAllow: 없음 -> false'), true, '빠진 권한 스위치는 update가 안전한 쪽(false)으로 채운다');
      assert.equal(r.config.changes.some((c) => c.startsWith('profile:')), false);
      const expected = { retroMode: mode, roles: ['백엔드'], profile: to, retroWriteAllow: writeAllow, commitCheck: to === 'personal' ? 'block' : 'off' };
      if (to === 'company') expected.gitAskDeclined = ['x'];
      assert.deepEqual(CONFIG_KEYS(cfg), expected);
      assert.equal(baks(path.join(cfg, 'subagent-system'), 'config.json.bak-update-').length, 1);
    }
  });

  it('profile이 없던 설치가 set-profile을 고르면 retroMode는 고른 profile을 따르고(옛 auto가 회사용으로 남지 않음), 회사용 기본값과 같은 값은 따로 정한 값으로 보지 않는다', () => {
    const { cfg } = legacyInstalled({ retroMode: 'auto', commitCheck: 'warn' });
    jsonOut(run(['set-profile', 'company'], { env: { CLAUDE_CONFIG_DIR: cfg } }));
    assert.deepEqual(CONFIG_KEYS(cfg), { retroMode: 'ask', commitCheck: 'warn', profile: 'company' });
  });

  it('설치본 VERSION은 있는데 config.json만 없으면 update는 멈추고 set-profile이 설정을 새로 만들어 막다른 길이 되지 않는다', () => {
    const { kit, cfg, file } = legacyInstalled({});
    fs.rmSync(file);
    assert.equal(run(['update', '--kit', kit], { env: { CLAUDE_CONFIG_DIR: cfg } }).status, 2);
    assert.equal(run(['set-profile', 'x'], { env: { CLAUDE_CONFIG_DIR: cfg } }).status, 1);
    assert.equal(fs.existsSync(file), false);
    jsonOut(run(['set-profile', 'personal'], { env: { CLAUDE_CONFIG_DIR: cfg } }));
    update(kit, cfg);
    assert.equal(CONFIG(cfg).profile, 'personal');
    const bare = tmpDir();
    assert.equal(run(['set-profile', 'personal'], { env: { CLAUDE_CONFIG_DIR: bare } }).status, 1);
    assert.equal(fs.existsSync(path.join(bare, 'subagent-system')), false);
  });

  it('옛 설치의 판정 키 넷(autoApplyRules, autoCreate, actThreshold, methodCommit)은 update가 config에서 지우고 notes로 알리며, 따로 남는 키는 지킨다', () => {
    const { kit, cfg } = installed();
    write(cfg, 'subagent-system/config.json', { ...CONFIG(cfg), autoApplyRules: false, autoCreate: false, actThreshold: 'low-cost-only', methodCommit: 'report', commitCheck: 'warn' });
    const r = update(kit, cfg);
    assert.deepEqual(r.config.changes.filter((c) => c.endsWith('지움(profile이 정함)')).map((c) => c.split(':')[0]), ['autoApplyRules', 'autoCreate', 'actThreshold', 'methodCommit']);
    assert.equal(r.notes.filter((n) => n.includes('옛 설정 키 autoApplyRules, autoCreate, actThreshold, methodCommit')).length, 1);
    assert.deepEqual(CONFIG_KEYS(cfg), { profile: 'personal', retroMode: 'auto', retroWriteAllow: true, commitCheck: 'warn' });
    const again = update(kit, cfg);
    assert.equal(again.notes.some((n) => n.includes('옛 설정 키')), false);
  });

  it('판정 키가 없는 설치는 notes에 옛 키 알림이 없다', () => {
    const { kit, cfg } = installed();
    assert.equal(update(kit, cfg).notes.some((n) => n.includes('옛 설정 키')), false);
  });

  it('개인용인데 retroMode가 auto가 아니면 auto로 고쳐 두 키가 어긋나지 않게 한다', () => {
    const { kit, cfg } = installed();
    write(cfg, 'subagent-system/config.json', { ...CONFIG(cfg), retroMode: 'ask' });
    update(kit, cfg);
    assert.equal(CONFIG(cfg).retroMode, 'auto');
  });

  it('옛 GUIDE 사용자 구역의 표와 무조건 Opus 목록은 ROUTING_TABLE.md로, 사용자 규칙은 MIGRATED 파일로 옮기고 GUIDE를 백업한다', () => {
    const { kit, cfg } = installed();
    fs.rmSync(path.join(cfg, 'subagent-system/.kit-base'), { recursive: true });
    fs.rmSync(path.join(cfg, 'subagent-system/docs/ROUTING_TABLE.md'));
    const legacy = `${GUIDE_V1}<!-- 사용자 표 시작 -->\n| | low |\n|:---|:---|\n| **Haiku** | 내 일 |\n<!-- 사용자 표 끝 -->\n<!-- 무조건 Opus 시작 -->\n- 결제\n<!-- 무조건 Opus 끝 -->\n<!-- 사용자 규칙 시작 -->\n- 내 규칙 하나\n- 내 규칙 둘\n<!-- 사용자 규칙 끝 -->\n`;
    fs.writeFileSync(path.join(cfg, 'subagent-system/docs/SUBAGENT_GUIDE.md'), legacy);
    const hash = createHash('sha256').update(GUIDE_V1).digest('hex');
    write(cfg, 'subagent-system/config.json', { ...CONFIG(cfg), kitFileHashes: { 'subagent-system/docs/SUBAGENT_GUIDE.md': hash } });
    const r = update(kit, cfg);
    assert.equal(r.legacyZones.routingTable, 'created-from-zones');
    assert.match(cfgRead(cfg, 'subagent-system/docs/ROUTING_TABLE.md'), /내 일[\s\S]*## 무조건 Opus[\s\S]*- 결제/);
    const migrated = cfgRead(cfg, 'subagent-system/docs/MIGRATED_USER_RULES.md');
    assert.match(migrated, /- 내 규칙 하나\n- 내 규칙 둘\n$/);
    assert.equal(cfgRead(cfg, 'subagent-system/docs/SUBAGENT_GUIDE.md'), GUIDE_V1);
    const [bak] = baks(path.join(cfg, 'subagent-system/docs'), 'SUBAGENT_GUIDE.md.bak-update-');
    assert.equal(fs.readFileSync(path.join(cfg, 'subagent-system/docs', bak), 'utf8'), legacy);
    update(kit, cfg);
    assert.equal(cfgRead(cfg, 'subagent-system/docs/MIGRATED_USER_RULES.md'), migrated);
  });

  it('.kit-base가 없는 옛 설치본에서 기록 해시와 같은 파일은 교체하고 다른 파일은 충돌 표시로 남긴다', () => {
    const { kit, cfg } = installed();
    fs.rmSync(path.join(cfg, 'subagent-system/.kit-base'), { recursive: true });
    const retro = path.join(cfg, 'subagent-system/docs/RETRO.md');
    const checklist = path.join(cfg, 'subagent-system/docs/SUBAGENT_BRIEF_CHECKLIST.md');
    fs.writeFileSync(checklist, '# 체크\n\n- 내 줄\n');
    kitSet(kit, 'subagent-system/docs/RETRO.md', '# 회고\n\n새 내용\n');
    kitSet(kit, 'subagent-system/docs/SUBAGENT_BRIEF_CHECKLIST.md', '# 체크\n\n- 키트 줄\n');
    write(cfg, 'subagent-system/config.json', { ...CONFIG(cfg), kitFileHashes: { 'subagent-system/docs/RETRO.md': createHash('sha256').update(fs.readFileSync(retro)).digest('hex') } });
    const r = update(kit, cfg);
    assert.equal(fs.readFileSync(retro, 'utf8'), '# 회고\n\n새 내용\n');
    assert.deepEqual(r.conflictFiles, ['subagent-system/docs/SUBAGENT_BRIEF_CHECKLIST.md']);
    assert.match(fs.readFileSync(checklist, 'utf8'), /내 줄[\s\S]*키트 줄/);
  });

  it('.kit-base가 없는 옛 설치본의 정의는 description만 달라도 기록 해시와 같으면 교체하되 고치기 전 파일을 백업하고 알린다', () => {
    const { kit, cfg } = installed();
    fs.rmSync(path.join(cfg, 'subagent-system/.kit-base'), { recursive: true });
    const def = path.join(cfg, 'agents/opus-high.md');
    const text = '---\nname: opus-high\ndescription: 내 일 이름\n---\n본문\n';
    fs.writeFileSync(def, text);
    const keyHash = createHash('sha256').update('---\nname: opus-high\n---\n본문\n').digest('hex');
    write(cfg, 'subagent-system/config.json', { ...CONFIG(cfg), kitFileHashes: { 'agents/opus-high.md': keyHash } });
    kitSet(kit, 'subagent-system/agents/opus-high.md', '---\nname: opus-high\ndescription: 키트 설명\n---\n본문\n');
    const r = update(kit, cfg);
    assert.match(fs.readFileSync(def, 'utf8'), /키트 설명/);
    const [bak] = baks(path.join(cfg, 'agents'), 'opus-high.md.bak-update-');
    assert.equal(fs.readFileSync(path.join(cfg, 'agents', bak), 'utf8'), text);
    assert.match(r.notes.join('\n'), /description/);
  });

  describe('.kit-base가 없는 옛 설치본의 기준본을 키트 git 기록에서 찾기', { skip: !HAS_GIT && 'git이 없음' }, () => {
    const GUIDE = 'subagent-system/docs/SUBAGENT_GUIDE.md';
    const CHECKLIST = 'subagent-system/docs/SUBAGENT_BRIEF_CHECKLIST.md';
    // 옛 키트를 커밋해 설치한 뒤 .kit-base를 지우고, 사용자가 GUIDE 한 줄을 고친 상태에서 새 키트 커밋을 만든다.
    const oldInstall = () => {
      const kit = makeKit();
      git(kit, 'init', '-q');
      commitAll(kit, 'old');
      const cfg = tmpDir();
      install(kit, cfg, '--profile', 'personal');
      fs.rmSync(path.join(cfg, 'subagent-system/.kit-base'), { recursive: true });
      fs.writeFileSync(path.join(cfg, GUIDE), GUIDE_V1.replace('줄2', '내 줄2'));
      kitSet(kit, 'subagent-system/VERSION', '2026.10.31\n');
      kitSet(kit, GUIDE, GUIDE_V1.replace('줄8', '키트 줄8'));
      kitSet(kit, CHECKLIST, '# 체크\n\n- 키트 줄\n');
      commitAll(kit, 'new');
      return { kit, cfg };
    };

    it('설치본 VERSION과 같은 VERSION의 키트 커밋 원문을 기준본으로 삼아 사용자가 고친 줄과 키트가 고친 줄을 둘 다 살리고 안 고친 파일은 교체한다', () => {
      const { kit, cfg } = oldInstall();
      const r = update(kit, cfg);
      assert.deepEqual(r.conflictFiles, []);
      assert.equal(cfgRead(cfg, GUIDE), GUIDE_V1.replace('줄2', '내 줄2').replace('줄8', '키트 줄8'));
      assert.equal(cfgRead(cfg, CHECKLIST), '# 체크\n\n- 키트 줄\n');
      const guide = r.files.find((f) => f.key === GUIDE);
      assert.deepEqual([guide.status, guide.reason], ['merged', 'base-merge']);
      assert.match(guide.baseFrom, /^git:[0-9a-f]{7}$/);
      assert.equal(r.files.some((f) => f.key === CHECKLIST), false);
      assert.match(r.notes.join('\n'), /기준본을 가져와/);
    });

    it('같은 VERSION의 커밋이 키트 기록에 없으면 기준본 없이 2방향으로 병합해 다른 줄을 충돌 표시로 남긴다', () => {
      const { kit, cfg } = oldInstall();
      write(cfg, 'subagent-system/VERSION', '2026.10.29\n');
      const r = update(kit, cfg);
      assert.deepEqual(r.conflictFiles, [GUIDE, CHECKLIST]);
      assert.equal(r.files.some((f) => f.baseFrom), false);
    });

    it('.kit-base가 있는 파일은 git 기록을 보지 않고 그 기준본을 쓴다', () => {
      const { kit, cfg } = oldInstall();
      write(cfg, CHECKLIST, '# 체크\n\n- 내 줄\n');
      write(cfg, 'subagent-system/.kit-base/' + CHECKLIST, '# 체크\n\n- 내 줄\n');
      const r = update(kit, cfg);
      assert.deepEqual(r.conflictFiles, []);
      assert.equal(cfgRead(cfg, CHECKLIST), '# 체크\n\n- 키트 줄\n');
      assert.equal(r.files.find((f) => f.key === GUIDE).baseFrom !== undefined, true);
    });
  });

  it('설치본이 키트보다 새로우면 거절하고 --allow-older를 주면 진행하며, 설치되지 않은 곳이면 오류다', () => {
    const { kit, cfg } = installed();
    write(cfg, 'subagent-system/VERSION', '2026.11.1\n');
    assert.equal(run(['update', '--kit', kit], { env: { CLAUDE_CONFIG_DIR: cfg } }).status, 1);
    assert.equal(run(['update', '--kit', kit, '--allow-older'], { env: { CLAUDE_CONFIG_DIR: cfg } }).status, 0);
    assert.equal(run(['update', '--kit', kit], { env: { CLAUDE_CONFIG_DIR: tmpDir() } }).status, 1);
  });

  it('update는 profile, rules, skills 같은 설치 옵션을 받지 않는다', () => {
    const { kit, cfg } = installed();
    const r = run(['update', '--kit', kit, '--profile', 'company'], { env: { CLAUDE_CONFIG_DIR: cfg } });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /set-profile/);
  });

  it('--dry-run은 병합 결과를 보여 주되 파일을 바꾸지 않는다', () => {
    const { kit, cfg } = installed();
    kitSet(kit, 'subagent-system/docs/RETRO.md', '# 회고\n\n새 내용\n');
    const r = update(kit, cfg, '--dry-run');
    assert.equal(r.counts.replaced, 1);
    assert.equal(cfgRead(cfg, 'subagent-system/docs/RETRO.md'), '# 회고\n\n내용\n');
  });

  it('CLAUDE.md의 키트 구역과 늘 읽히는 줄 수를 알리되 CLAUDE.md는 고치지 않는다', () => {
    const { kit, cfg } = installed();
    const text = '<!-- subagent-system 시작 -->\n- 옛 줄\n<!-- subagent-system 끝 -->\n- 내 정책\n';
    write(cfg, 'CLAUDE.md', text);
    const r = update(kit, cfg);
    assert.deepEqual(r.claudeMd.kitZones, ['subagent-system:paired']);
    assert.equal(r.claudeMd.limit, 80);
    assert.match(r.claudeMd.backupPathIfEdited, /CLAUDE\.md\.bak-claude-md-\d{8}-\d{6}$/);
    assert.equal(cfgRead(cfg, 'CLAUDE.md'), text);
  });
});

describe('kit-setup.js update의 CLAUDE.md 정리 판정은 회고와 같다', () => {
  const setup = (claudeLines, ruleLines, config = {}) => {
    const kit = makeKit();
    const cfg = tmpDir();
    install(kit, cfg, '--profile', 'personal'); // 키트 시험용 규칙 1줄이 함께 깔려 CLAUDE.md 53 + 29 + 1 = 83이다
    const nl = (n) => Array.from({ length: n }, (_, i) => `줄 ${i}`).join('\n') + '\n';
    write(cfg, 'CLAUDE.md', nl(claudeLines));
    write(cfg, 'rules/mine.md', nl(ruleLines));
    write(cfg, 'subagent-system/config.json', { ...CONFIG(cfg), ...config });
    return { kit, cfg };
  };

  it('CLAUDE.md는 짧아도 늘 읽히는 줄의 합(rules 포함)이 기준을 넘으면 정리 대상이다', () => {
    const { kit, cfg } = setup(53, 29);
    const r = update(kit, cfg).claudeMd;
    assert.deepEqual([r.loadedLines, r.limit, r.overBy, r.tidyTarget, r.tidyReason], [83, 80, 3, true, '']);
  });

  it('config.json의 claudeMdLimitLines를 기준으로 쓴다', () => {
    const { kit, cfg } = setup(53, 29, { claudeMdLimitLines: 120 });
    const r = update(kit, cfg).claudeMd;
    assert.deepEqual([r.limit, r.overBy, r.tidyTarget, r.tidyReason], [120, 0, false, '120줄 이하']);
  });

  it('정리를 마다해 claudeMdKeptLines가 남았으면 여유 20줄 이내에서 업데이트가 같은 정리를 되묻지 않는다', () => {
    const { kit, cfg } = setup(53, 29, { claudeMdKeptLines: 83 });
    const r = update(kit, cfg).claudeMd;
    assert.deepEqual([r.keptLines, r.overBy, r.tidyTarget, r.tidyReason], [83, 3, false, '정리 뒤 남긴 83줄에서 20줄 이내']);
    const grown = setup(53, 50, { claudeMdKeptLines: 83 });
    assert.equal(update(grown.kit, grown.cfg).claudeMd.tidyTarget, true);
  });
});

describe('kit-setup.js update의 물을 것 옮기기와 retroWriteAllow', () => {
  const OLD_PENDING = [
    '## 쪼개기: 구현',
    '- 왜: 실패 3건',
    '',
    '## 속도 개선: 절차:proj/배포',
    '- 요지: 대기 줄이기',
    '',
    '## 측정 요청: 칸:sonnet-low/구현',
    '- 요지: 3건 더 측정',
    '',
    '```',
    '## 코드 울타리 안의 줄',
    '```',
    '',
  ].join('\n');
  const withOldPending = (text = OLD_PENDING) => {
    const kit = makeKit();
    const cfg = tmpDir();
    install(kit, cfg, '--profile', 'personal');
    write(cfg, 'subagent-system/records/retro-pending.md', text);
    return { kit, cfg };
  };
  const PROPOSALS = (cfg) => cfgRead(cfg, 'docs/PROPOSALS.md');

  it('옛 retro-pending.md의 항목은 PROPOSALS.md가 없으면 머리와 함께 만들어 ### 항목으로 옮기고 원본은 옆 백업으로 남긴다', () => {
    const { kit, cfg } = withOldPending();
    const r = update(kit, cfg);
    const text = PROPOSALS(cfg);
    assert.match(text, /^# 일하는 체계 제안 목록/);
    assert.ok(text.indexOf('## 제안') < text.indexOf('### 쪼개기: 구현') && text.indexOf('### 측정 요청: 칸:sonnet-low/구현') < text.indexOf('## 반대'));
    assert.match(text, /### 쪼개기: 구현\n- 묻기: 정책\n- 왜: 실패 3건/);
    assert.match(text, /### 속도 개선: 절차:proj\/배포\n- 요지: 대기 줄이기/);
    assert.match(text, /### 측정 요청: 칸:sonnet-low\/구현\n- 요지: 3건 더 측정/);
    assert.equal((text.match(/묻기:/g) ?? []).length, 2);
    assert.equal(r.retroPending.moved, 3);
    assert.equal(exists(cfg, 'subagent-system/records/retro-pending.md'), false);
    assert.equal(fs.readFileSync(r.retroPending.backup, 'utf8'), OLD_PENDING);
    assert.match(path.basename(r.retroPending.backup), /^retro-pending\.md\.bak-update-/);
  });

  it('옮긴 항목은 회고 스크립트의 물을 것 셈에 들어가고 속도 개선과 측정 요청은 물을 것이 아니라 대상 목록에 들어간다', async () => {
    const { kit, cfg } = withOldPending();
    update(kit, cfg);
    const helpers = await import(path.join(SCRIPTS, 'subagentRetroHelpers.js'));
    const speed = await import(path.join(SCRIPTS, 'speedReviewHelpers.js'));
    assert.equal(helpers.countPending(PROPOSALS(cfg), { onlyAsk: true }), 1);
    assert.equal(helpers.countPending(PROPOSALS(cfg)), 3);
    assert.deepEqual([...speed.pendingTargets(PROPOSALS(cfg))].sort(), ['절차:proj/배포', '칸:sonnet-low/구현']);
  });

  it('이미 있는 PROPOSALS.md는 ## 제안 끝에 더하고 ## 반대와 같은 제목의 기존 항목은 그대로 둔다', () => {
    const { kit, cfg } = withOldPending();
    const mine = '# 내 제안\n\n## 제안\n\n### 쪼개기: 구현\n- 묻기: 돈\n\n### 다른 것\n- 왜: x\n\n## 반대\n\n### 반대 하나\n';
    write(cfg, 'docs/PROPOSALS.md', mine);
    const r = update(kit, cfg);
    const text = PROPOSALS(cfg);
    assert.equal(r.retroPending.skippedSameTitle, 1);
    assert.equal(r.retroPending.moved, 2);
    assert.equal((text.match(/### 쪼개기: 구현/g) ?? []).length, 1);
    assert.match(text, /### 쪼개기: 구현\n- 묻기: 돈/);
    assert.ok(text.indexOf('### 다른 것') < text.indexOf('### 속도 개선') && text.indexOf('### 측정 요청') < text.indexOf('## 반대'));
    assert.ok(text.endsWith('## 반대\n\n### 반대 하나\n'));
  });

  it('PROPOSALS.md에 ## 제안이 없으면 끝에 만들어 더하고, 한 번 옮긴 뒤 다시 update해도 더 옮기지 않는다', () => {
    const { kit, cfg } = withOldPending();
    write(cfg, 'docs/PROPOSALS.md', '# 메모\n');
    update(kit, cfg);
    assert.match(PROPOSALS(cfg), /^# 메모\n\n## 제안\n\n### 쪼개기: 구현/);
    const before = PROPOSALS(cfg);
    const again = update(kit, cfg);
    assert.equal(again.retroPending, undefined);
    assert.equal(PROPOSALS(cfg), before);
  });

  it('업데이트로 retroWriteAllow 키가 새로 생기면 개인용도 false로 채우고 PermissionRequest 훅을 걸지 않는다', () => {
    const kit = makeKit();
    const cfg = tmpDir();
    install(kit, cfg, '--profile', 'personal');
    const c = CONFIG(cfg);
    delete c.retroWriteAllow;
    write(cfg, 'subagent-system/config.json', c);
    const s = read(path.join(cfg, 'settings.json'));
    delete s.hooks.PermissionRequest;
    write(cfg, 'settings.json', s);
    update(kit, cfg);
    assert.equal(CONFIG(cfg).retroWriteAllow, false);
    assert.doesNotMatch(JSON.stringify(read(path.join(cfg, 'settings.json')).hooks.PermissionRequest ?? []), /retro-write-allow\.js/);
  });

  it('옛 설치가 set-profile personal 뒤 update로 채운 retroWriteAllow false는 켜지지 않은 채 남고, 켜는 길은 --config-set이며 그때 훅 등록도 함께 맞춰진다', { skip: SKIP_NO_HOOK_DEF }, () => {
    const { kit, cfg, file } = legacyInstalled({ retroMode: 'auto' });
    const s = read(path.join(cfg, 'settings.json'));
    delete s.hooks.PermissionRequest;
    write(cfg, 'settings.json', s);
    jsonOut(run(['set-profile', 'personal'], { env: { CLAUDE_CONFIG_DIR: cfg } }));
    update(kit, cfg);
    assert.equal(CONFIG(cfg).retroWriteAllow, false);
    assert.doesNotMatch(JSON.stringify(read(path.join(cfg, 'settings.json')).hooks.PermissionRequest ?? []), /retro-write-allow\.js/);
    jsonOut(run(['set-profile', 'personal'], { env: { CLAUDE_CONFIG_DIR: cfg } }));
    assert.equal(CONFIG(cfg).retroWriteAllow, false);
    const on = run(['--config-set', file, 'retroWriteAllow', 'true'], { env: { CLAUDE_CONFIG_DIR: cfg } });
    assert.equal(on.status, 0, on.stderr);
    assert.equal(CONFIG(cfg).retroWriteAllow, true);
    assert.equal(JSON.parse(on.stdout).hook, 'registered');
    assert.match(JSON.stringify(read(path.join(cfg, 'settings.json')).hooks.PermissionRequest ?? []), /retro-write-allow\.js/, '켠 직후 훅이 걸려 있다');
    assert.equal(JSON.parse(run(['--config-set', file, 'retroWriteAllow', 'true'], { env: { CLAUDE_CONFIG_DIR: cfg } }).stdout).hook, 'already-registered');
    update(kit, cfg);
    assert.equal(JSON.stringify(read(path.join(cfg, 'settings.json')).hooks.PermissionRequest).split('retro-write-allow.js').length, 2, '훅이 한 번만 걸려 있다');
    const off = run(['--config-set', file, 'retroWriteAllow', 'false'], { env: { CLAUDE_CONFIG_DIR: cfg } });
    assert.equal(JSON.parse(off.stdout).hook, 'removed');
    assert.doesNotMatch(JSON.stringify(read(path.join(cfg, 'settings.json')).hooks.PermissionRequest ?? []), /retro-write-allow\.js/);
    assert.match(JSON.stringify(read(path.join(cfg, 'settings.json')).hooks.PermissionRequest ?? []), /ask-log\.js/, '다른 키트 훅은 남는다');
    run(['--config-set', file, 'retroWriteAllow', 'true'], { env: { CLAUDE_CONFIG_DIR: cfg } });
    assert.equal(JSON.parse(run(['--config-unset', file, 'retroWriteAllow'], { env: { CLAUDE_CONFIG_DIR: cfg } }).stdout).hook, 'removed');
    assert.equal('retroWriteAllow' in CONFIG(cfg), false);
    assert.doesNotMatch(JSON.stringify(read(path.join(cfg, 'settings.json')).hooks.PermissionRequest ?? []), /retro-write-allow\.js/);
  });

  it('retroWriteAllow를 사용자가 true로 정해 둔 개인용 설치는 업데이트가 그대로 두고, set-profile은 개인용으로 갈 때 이 키를 켜지 않고(notes로 알림) 회사용으로 갈 때는 끄고 훅 등록도 뺀다', () => {
    const kit = makeKit();
    const cfg = tmpDir();
    install(kit, cfg, '--profile', 'personal');
    assert.equal(CONFIG(cfg).retroWriteAllow, true);
    update(kit, cfg);
    assert.equal(CONFIG(cfg).retroWriteAllow, true);
    const company = tmpDir();
    install(kit, company, '--profile', 'company');
    const r = jsonOut(run(['set-profile', 'personal'], { env: { CLAUDE_CONFIG_DIR: company } }));
    assert.equal(CONFIG(company).retroWriteAllow, false);
    assert.equal(r.changes.some((c) => c.startsWith('retroWriteAllow')), false);
    assert.deepEqual(r.notes.map((n) => n.split('는')[0]), ['retroWriteAllow', 'commitCheck'], '새 기본값과 다른 권한 스위치는 바꾸지 않고 알린다');
    assert.match(JSON.stringify(read(path.join(cfg, 'settings.json')).hooks.PermissionRequest ?? []), /retro-write-allow\.js/, '회사용으로 가기 전에는 훅이 걸려 있다');
    const back = jsonOut(run(['set-profile', 'company'], { env: { CLAUDE_CONFIG_DIR: cfg } }));
    assert.equal(CONFIG(cfg).retroWriteAllow, false, '회사용으로 가면 조이는 쪽이라 쓰기 허용을 끈다');
    assert.equal(back.changes.includes('retroWriteAllow: true -> false'), true);
    assert.equal(back.notes.some((n) => /^retroWriteAllow는 true에서 false로 껐고.*--config-set/.test(n)), true);
    assert.equal(back.notes.some((n) => /^commitCheck는 "block" 그대로.*--config-set/.test(n)), true, '사용자 커밋에 걸리는 commitCheck는 바꾸지 않고 알린다');
    assert.doesNotMatch(JSON.stringify(read(path.join(cfg, 'settings.json')).hooks.PermissionRequest ?? []), /retro-write-allow\.js/, '훅 등록도 함께 빠진다');
    assert.match(JSON.stringify(read(path.join(cfg, 'settings.json')).hooks.PermissionRequest ?? []), /ask-log\.js/, '다른 키트 훅은 남는다');
  });
});

describe('kit-setup.js set-profile와 config 키', () => {
  const profileCfg = (profile) => {
    const cfg = tmpDir();
    install(makeKit(), cfg, '--profile', profile);
    return cfg;
  };
  const setProfile = (cfg, to) => jsonOut(run(['set-profile', to], { env: { CLAUDE_CONFIG_DIR: cfg } }));

  it('set-profile은 profile, 기본값 그대로인 retroMode, 회사용으로 갈 때의 retroWriteAllow만 바꾸고, 느슨한 쪽이거나 사용자 커밋에 걸리는 보호 스위치는 값이 달라도 두고 notes로 알린다', () => {
    const cfg = profileCfg('personal');
    const r = setProfile(cfg, 'company');
    assert.deepEqual(CONFIG_KEYS(cfg), {
      profile: 'company', retroMode: 'ask', retroWriteAllow: false, commitCheck: 'block',
    });
    assert.deepEqual(r.changes, ['profile: personal -> company', 'retroMode: "auto" -> "ask"', 'retroWriteAllow: true -> false']);
    assert.equal(r.notes.length, 2);
    write(cfg, 'subagent-system/config.json', { ...CONFIG(cfg), commitCheck: 'warn' });
    const back = setProfile(cfg, 'personal');
    assert.equal(CONFIG(cfg).retroMode, 'auto');
    assert.equal(CONFIG(cfg).commitCheck, 'warn');
    assert.equal(back.notes.length, 2, '개인용으로 가도 꺼진 retroWriteAllow를 켜지 않고 commitCheck와 함께 알린다');
    assert.equal(CONFIG(cfg).retroWriteAllow, false);
    assert.match(back.notes[0], /^retroWriteAllow는 false 그대로/);
    assert.match(back.notes[1], /^commitCheck는 "warn" 그대로/);
  });

  it('개인용으로 가는 set-profile은 update 없이도 전역에 남은 commit 확인 목록을 settings.gitAsk.keptCommitAsks로 보이고 settings.json은 쓰지 않는다', () => {
    const cfg = profileCfg('company');
    const file = path.join(cfg, 'settings.json');
    write(cfg, 'settings.json', { permissions: { ask: ['Bash(rm:*)', 'Bash(git commit:*)', 'Bash(git push:*)', 'Bash(git checkout:*)'] } });
    const before = fs.readFileSync(file, 'utf8');
    const r = setProfile(cfg, 'personal');
    assert.deepEqual(r.settings, { gitAsk: { mode: 'report-only', keptCommitAsks: ['Bash(git commit:*)', 'Bash(git push:*)'] } });
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    assert.equal('settings' in setProfile(cfg, 'company'), false, '회사용으로 갈 때는 목록을 내지 않는다');
  });

  it('settings.json이 없거나 읽히지 않는 개인용 set-profile은 빈 목록 또는 notes로 알린다', () => {
    const cfg = profileCfg('company');
    fs.rmSync(path.join(cfg, 'settings.json'));
    assert.deepEqual(setProfile(cfg, 'personal').settings.gitAsk.keptCommitAsks, []);
    fs.writeFileSync(path.join(cfg, 'settings.json'), '{');
    const r = setProfile(cfg, 'company');
    const bad = setProfile(cfg, 'personal');
    assert.equal(bad.settings.gitAsk.mode, 'unreadable');
    assert.ok(bad.notes.some((n) => /settings\.json을 읽지 못해/.test(n)));
    assert.equal(r.profile, 'company');
  });

  it('set-profile은 옛 판정 키를 지우고 notes로 알리며, --config-set은 그 키를 거절한다', () => {
    const cfg = profileCfg('personal');
    const file = path.join(cfg, 'subagent-system', 'config.json');
    write(cfg, 'subagent-system/config.json', { ...CONFIG(cfg), autoApplyRules: false, methodCommit: 'report' });
    const r = setProfile(cfg, 'personal');
    assert.equal(r.notes.length, 1);
    assert.match(r.notes[0], /autoApplyRules, methodCommit/);
    assert.equal('autoApplyRules' in CONFIG(cfg) || 'methodCommit' in CONFIG(cfg), false);
    const bad = run(['--config-set', file, 'autoCreate', 'true'], { env: { CLAUDE_CONFIG_DIR: cfg } });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /profile이 정하는 판정/);
    assert.equal('autoCreate' in CONFIG(cfg), false);
  });

  it('set-profile은 settings.json에서 retro-write-allow 훅 등록 외에는 바꾸지 않고, 쓰기 허용이 꺼져 있으면 아무것도 바꾸지 않는다', () => {
    const cfg = profileCfg('company');
    const settings = path.join(cfg, 'settings.json');
    const before = fs.readFileSync(settings, 'utf8');
    setProfile(cfg, 'personal');
    setProfile(cfg, 'company');
    assert.equal(fs.readFileSync(settings, 'utf8'), before);
    const on = profileCfg('personal');
    const withHook = read(path.join(on, 'settings.json'));
    setProfile(on, 'company');
    const after = read(path.join(on, 'settings.json'));
    const strip = (o) => JSON.stringify({ ...o, hooks: { ...o.hooks, PermissionRequest: (o.hooks.PermissionRequest ?? []).map((g) => ({ ...g, hooks: g.hooks.filter((x) => !/retro-write-allow\.js/.test(x.command)) })).filter((g) => g.hooks.length) } });
    assert.equal(strip(after), strip(withHook), '훅 등록 하나 말고는 같다');
  });

  it('회사용이 회고를 auto로 바꿔 둔 상태에서 개인용으로 가도 retroMode는 auto이고, 개인용에서 회사용으로 가면 ask가 된다', () => {
    const cfg = profileCfg('company');
    write(cfg, 'subagent-system/config.json', { ...CONFIG(cfg), retroMode: 'auto' });
    setProfile(cfg, 'personal');
    assert.equal(CONFIG(cfg).retroMode, 'auto');
    setProfile(cfg, 'company');
    assert.equal(CONFIG(cfg).retroMode, 'ask');
  });

  it('--config-set profile은 set-profile과 같고, 개인용에서 retroMode를 auto 아닌 값으로 정하는 것은 거절한다', () => {
    const cfg = profileCfg('personal');
    const file = path.join(cfg, 'subagent-system/config.json');
    const bad = run(['--config-set', file, 'retroMode', '"ask"']);
    assert.equal(bad.status, 1);
    assert.equal(CONFIG(cfg).retroMode, 'auto');
    assert.equal(run(['--config-set', file, 'profile', '"company"']).status, 0);
    assert.equal(CONFIG(cfg).retroMode, 'ask');
    assert.equal(run(['--config-set', file, 'retroMode', '"auto"']).status, 0);
    assert.equal(run(['--config-set', file, 'profile', '"x"']).status, 1);
  });

  it('--merge-git-ask는 config의 profile이 개인용이면 personal 목록을, 회사용이면 전체 목록을 더한다', () => {
    const dir = tmpDir();
    const kit = write(dir, 'git.json', GIT_BOTH);
    const personal = write(dir, 'p.json', { permissions: { ask: [] } });
    run(['--merge-git-ask', personal, kit, write(dir, 'cp.json', { profile: 'personal' }), 'merge']);
    assert.deepEqual(read(personal).permissions.ask, GIT_BOTH.personal.permissions.ask);
    const company = write(dir, 'c.json', {});
    run(['--merge-git-ask', company, kit, write(dir, 'cc.json', { profile: 'company' }), 'merge']);
    assert.deepEqual(read(company).permissions.ask, GIT_BOTH.permissions.ask);
  });
});

describe('kit-setup.js uninstall', () => {
  const setupInstalled = () => {
    const kit = makeKit();
    const cfg = tmpDir();
    install(kit, cfg, '--profile', 'personal', '--rules', 'recommended', '--skills', 'git-work');
    write(cfg, 'subagent-system/records/subagent-usage.tsv', 'a\tb\n');
    write(cfg, 'agents/mine.md', '내 정의');
    write(cfg, 'rules/mine.md', '내 규칙');
    return { kit, cfg };
  };
  const unin = (kit, cfg, ...extra) => jsonOut(run(['uninstall', '--kit', kit, ...extra], { env: { CLAUDE_CONFIG_DIR: cfg } }));

  it('--records 없이 부르면 오류이고 아무것도 지우지 않는다', () => {
    const { kit, cfg } = setupInstalled();
    const r = run(['uninstall', '--kit', kit], { env: { CLAUDE_CONFIG_DIR: cfg } });
    assert.equal(r.status, 1);
    assert.equal(exists(cfg, 'subagent-system/VERSION'), true);
  });

  it('설정 폴더에 승인 창 기록이 있으면 지우지 않고 notes에 남는다고 알리며, 없으면 알리지 않는다', () => {
    const { kit, cfg } = setupInstalled();
    assert.equal(unin(kit, cfg, '--records', 'keep', '--dry-run').notes.some((n) => n.includes('permission-asks.jsonl')), false);
    write(cfg, 'permission-asks.jsonl', '{}\n');
    const r = unin(kit, cfg, '--records', 'keep');
    assert.equal(r.notes.some((n) => n.includes('permission-asks.jsonl')), true);
    assert.equal(exists(cfg, 'permission-asks.jsonl'), true);
  });

  it('손대지 않은 키트 파일은 지우고 고친 파일은 .bak-uninstall로 남기며 사용자 파일, 훅 밖 설정은 그대로 둔다', () => {
    const { kit, cfg } = setupInstalled();
    fs.writeFileSync(path.join(cfg, 'agents/opus-high.md'), '내가 고침');
    const settings = read(path.join(cfg, 'settings.json'));
    settings.hooks.Stop = [{ hooks: [{ type: 'command', command: 'x' }] }];
    write(cfg, 'settings.json', settings);
    const r = unin(kit, cfg, '--records', 'keep');
    assert.equal(r.hooksRemoved, 4);
    assert.deepEqual(read(path.join(cfg, 'settings.json')).hooks, { Stop: [{ hooks: [{ type: 'command', command: 'x' }] }] });
    assert.equal(exists(cfg, 'agents/haiku-low.md'), false);
    assert.equal(exists(cfg, 'agents/mine.md'), true);
    assert.equal(exists(cfg, 'rules/mine.md'), true);
    assert.equal(exists(cfg, 'rules/kit-core.md'), false);
    assert.equal(exists(cfg, 'skills/retro'), false);
    assert.equal(exists(cfg, 'skills/git-work'), false);
    assert.equal(baks(path.join(cfg, 'agents'), 'opus-high.md.bak-uninstall-').length, 1);
    assert.equal(exists(cfg, 'subagent-system/scripts'), false);
    assert.equal(exists(cfg, 'subagent-system/.kit-base'), false);
    assert.equal(exists(cfg, 'subagent-system/VERSION'), false);
    assert.equal(exists(cfg, 'subagent-system/records/subagent-usage.tsv'), true);
    assert.equal(baks(path.join(cfg, 'subagent-system'), 'config.json.bak-uninstall-').length, 1);
    assert.equal(baks(path.join(cfg, 'subagent-system/docs'), 'ROUTING_TABLE.md.bak-uninstall-').length, 1);
  });

  it('키트 값 그대로인 rates.json은 지우고 사용자가 고친 rates.json은 옆 .bak-uninstall로 남긴다', () => {
    const same = setupInstalled();
    const r1 = unin(same.kit, same.cfg, '--records', 'keep');
    assert.equal(exists(same.cfg, 'subagent-system/rates.json'), false);
    assert.equal(r1.removed.includes('subagent-system/rates.json'), true);
    assert.equal(r1.skippedUnknown.includes('subagent-system/rates.json'), false);
    const edited = setupInstalled();
    fs.writeFileSync(path.join(edited.cfg, 'subagent-system/rates.json'), JSON.stringify({ _checked: '2026-10', 'm-a': { input: 99 } }));
    const r2 = unin(edited.kit, edited.cfg, '--records', 'keep');
    assert.equal(exists(edited.cfg, 'subagent-system/rates.json'), false);
    const kept = baks(path.join(edited.cfg, 'subagent-system'), 'rates.json.bak-uninstall-');
    assert.equal(kept.length, 1);
    assert.deepEqual(read(path.join(edited.cfg, 'subagent-system', kept[0])), { _checked: '2026-10', 'm-a': { input: 99 } });
    assert.equal(r2.keptAsBackup.some((b) => b.includes('rates.json.bak-uninstall-')), true);
  });

  it('uninstall은 키트 폴더 밖의 같은 파일 이름 훅을 지우지 않는다', () => {
    const { kit, cfg } = setupInstalled();
    const s = read(path.join(cfg, 'settings.json'));
    s.hooks.SubagentStop.push({ hooks: [{ type: 'command', command: 'node /home/me/usage-autolog.js' }] });
    write(cfg, 'settings.json', s);
    const r = unin(kit, cfg, '--records', 'keep');
    assert.equal(r.hooksRemoved, 4);
    assert.deepEqual(read(path.join(cfg, 'settings.json')).hooks, { SubagentStop: [{ hooks: [{ type: 'command', command: 'node /home/me/usage-autolog.js' }] }] });
  });

  it('--records delete는 기록을 지우고 경로를 주면 거기로 옮기며, 이미 있는 경로면 오류로 멈춘다', () => {
    const del = setupInstalled();
    unin(del.kit, del.cfg, '--records', 'delete');
    assert.equal(exists(del.cfg, 'subagent-system/records'), false);
    const mv = setupInstalled();
    const to = path.join(tmpDir(), 'kept-records');
    const r = unin(mv.kit, mv.cfg, '--records', to);
    assert.equal(fs.readFileSync(path.join(to, 'subagent-usage.tsv'), 'utf8'), 'a\tb\n');
    assert.match(r.records, /^moved: /);
    const clash = setupInstalled();
    const bad = run(['uninstall', '--kit', clash.kit, '--records', to], { env: { CLAUDE_CONFIG_DIR: clash.cfg } });
    assert.equal(bad.status, 1);
    assert.equal(exists(clash.cfg, 'subagent-system/VERSION'), true);
  });

  it('남의 같은 이름 스킬(.kit-base 없음)은 내용이 달라도 지우거나 옮기지 않고 알린다', () => {
    const { kit, cfg } = setupInstalled();
    write(cfg, 'skills/ab-test/SKILL.md', '남의 스킬');
    const r = unin(kit, cfg, '--records', 'keep');
    assert.equal(cfgRead(cfg, 'skills/ab-test/SKILL.md'), '남의 스킬');
    assert.deepEqual(r.skippedUnknown, ['skills/ab-test/SKILL.md']);
  });

  it('--dry-run은 아무것도 지우지 않는다', () => {
    const { kit, cfg } = setupInstalled();
    const r = unin(kit, cfg, '--records', 'delete', '--dry-run');
    assert.equal(r.removed.length > 0, true);
    assert.equal(exists(cfg, 'subagent-system/VERSION'), true);
    assert.equal(exists(cfg, 'subagent-system/records'), true);
  });

  it('install 뒤 uninstall하면 설치 전과 같은 파일 목록(사용자 백업 제외)으로 돌아온다', () => {
    const kit = makeKit();
    const cfg = tmpDir();
    write(cfg, 'settings.json', { model: 'x' });
    install(kit, cfg, '--profile', 'personal');
    unin(kit, cfg, '--records', 'keep');
    const rest = [];
    const walk = (d, rel = '') => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name), `${rel}${e.name}/`) : rest.push(`${rel}${e.name}`)));
    walk(cfg);
    assert.deepEqual(rest.filter((f) => !f.includes('.bak-')), ['settings.json']);
    assert.deepEqual(read(path.join(cfg, 'settings.json')), { model: 'x', permissions: { ask: ['Bash(git checkout:*)'] } });
  });
});

describe('kit-setup.js 개인용 회고 쓰기 허용 훅', () => {
  const HOOK_PATH = path.join(SCRIPTS, '..', 'hooks', 'retro-write-allow.js');
  const sandbox = ({ allow = true, lock = true, lockAgeMs = 0 } = {}) => {
    const cfg = fs.realpathSync(tmpDir());
    write(cfg, 'subagent-system/config.json', { retroWriteAllow: allow });
    if (lock) {
      const lockFile = write(cfg, 'subagent-system/records/retro.lock', '{}');
      const t = (Date.now() - lockAgeMs) / 1000;
      fs.utimesSync(lockFile, t, t);
    }
    return cfg;
  };
  const ask = (cfg, input) => {
    const r = spawnSync(process.execPath, [HOOK_PATH], { input: JSON.stringify(input), env: { ...cleanEnv(), CLAUDE_CONFIG_DIR: cfg }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim() === '' ? null : JSON.parse(r.stdout).hookSpecificOutput.decision.behavior;
  };
  const edit = (cfg, rel, extra = {}) => ({ agent_id: 'a1', tool_name: 'Edit', tool_input: { file_path: path.join(cfg, rel) }, ...extra });

  it('회고 잠금이 잡힌 동안 서브에이전트가 설정 폴더 아래 방법 파일을 쓰려 하면 허용한다', () => {
    const cfg = sandbox();
    assert.equal(ask(cfg, edit(cfg, 'rules/kit-code.md')), 'allow');
    assert.equal(ask(cfg, edit(cfg, 'subagent-system/docs/SUBAGENT_GUIDE.md', { tool_name: 'Write' })), 'allow');
    assert.equal(ask(cfg, edit(cfg, 'skills/new/SKILL.md', { tool_name: 'Write', tool_input: { file_path: path.join(cfg, 'skills/new/SKILL.md'), content: '---\nname: new\ndescription: d\n---\n본문\n' } })), 'allow');
  });

  it('메인 세션 요청, 설정 폴더 밖, 정책 문서와 권한 설정, ..로 빠져나가는 경로는 판정하지 않고 넘긴다', () => {
    const cfg = sandbox();
    assert.equal(ask(cfg, { tool_name: 'Edit', tool_input: { file_path: path.join(cfg, 'rules/kit-a.md') } }), null);
    assert.equal(ask(cfg, edit(cfg, '../outside.md')), null);
    assert.equal(ask(cfg, { agent_id: 'a1', tool_name: 'Edit', tool_input: { file_path: '/etc/hosts' } }), null);
    for (const rel of ['CLAUDE.md', 'settings.json', 'settings.local.json', 'docs/plan/x.md', '.git/config']) assert.equal(ask(cfg, edit(cfg, rel)), null, rel);
    assert.equal(ask(cfg, edit(cfg, 'rules/kit-a.md', { tool_name: 'Bash' })), null);
  });

  it('플러그인 폴더는 넘기고, 정의와 스킬은 권한, 훅 키를 쓰는 내용일 때만 넘긴다', () => {
    const cfg = sandbox();
    assert.equal(ask(cfg, edit(cfg, 'plugins/x/hooks/hooks.json')), null);
    for (const [rel, ti] of [
      ['agents/a.md', { content: '---\nname: a\npermissionMode: bypassPermissions\n---\n' }],
      ['agents/a.md', { new_string: 'hooks:\n  PreToolUse: []' }],
      ['skills/s/SKILL.md', { content: '---\nallowed-tools: Bash\n---\n' }],
      ['skills/s/SKILL.md', { edits: [{ old_string: 'x', new_string: '  hooks: {}' }] }],
      ['subagent-system/agents/a.md', { new_string: 'permissionMode: acceptEdits' }],
    ]) assert.equal(ask(cfg, { agent_id: 'a1', tool_name: 'Edit', tool_input: { file_path: path.join(cfg, rel), ...ti } }), null, rel);
    write(cfg, 'agents/a.md', '---\nname: a\ndescription: 옛 설명\nmodel: sonnet\n---\n본문\n');
    assert.equal(ask(cfg, { agent_id: 'a1', tool_name: 'Edit', tool_input: { file_path: path.join(cfg, 'agents/a.md'), old_string: '옛 설명', new_string: '훅 이야기를 하는 설명' } }), 'allow');
    assert.equal(ask(cfg, { agent_id: 'a1', tool_name: 'Edit', tool_input: { file_path: path.join(cfg, 'agents/a.md'), old_string: 'model: sonnet', new_string: 'model: sonnet\nmcpServers:\n  x:\n    command: sh' } }), null);
    assert.equal(ask(cfg, { agent_id: 'a1', tool_name: 'Edit', tool_input: { file_path: path.join(cfg, 'agents/a.md'), old_string: '없는 글', new_string: 'x' } }), null);
    assert.equal(ask(cfg, { agent_id: 'a1', tool_name: 'Write', tool_input: { file_path: path.join(cfg, 'skills/s/run.sh'), content: 'echo' } }), null);
    assert.equal(ask(cfg, { agent_id: 'a1', tool_name: 'Edit', tool_input: { file_path: path.join(cfg, 'rules/kit-a.md'), new_string: 'hooks: 규칙 문장' } }), 'allow');
  });

  // 까닭: YAML은 들여쓴 맵, ? 키, 따옴표 키, 병합 키, 탭도 키로 읽어 키 이름만 세면 권한 키가 빠져나갔다(20회차).
  it('머리 줄이 정해 둔 모양(0열 이름: 값, 블록 값 내용, 키처럼 보이지 않는 이어지는 줄)이 아니면 넘긴다', () => {
    const cfg = sandbox();
    const w = (rel, content) => ask(cfg, { agent_id: 'a1', tool_name: 'Write', tool_input: { file_path: path.join(cfg, rel), content } });
    for (const head of [
      '  name: a\n  permissionMode: bypassPermissions',
      'name: a\n? hooks\n: {}',
      'name: a\n\tpermissionMode: x',
      'name: a\n  permissionMode: x',
      'name: a\n"hooks": {}',
      'name: a\n<<: {hooks: 1}',
      'name: a\n- hooks',
    ]) {
      assert.equal(w('agents/x.md', `---\n${head}\n---\n본문\n`), null, head);
      assert.equal(w('skills/s/SKILL.md', `---\n${head}\n---\n본문\n`), null, head);
    }
    assert.equal(w('agents/x.md', '---\nname: a\ndescription: >\n  설명: 이렇게\nmodel: opus\n---\n본문\n'), 'allow');
    assert.equal(w('agents/x.md', '---\nname: a\ndescription: 긴 설명\n  이어지는 줄\n---\n본문\n'), 'allow');
  });

  // 까닭: 머리를 못 읽으면 키가 없다고 보고 열던 구멍이다(19회차). BOM이나 앞 공백, 닫는 구분선 없음은 머리를 읽지 못하는 쪽이라 넘긴다.
  it('BOM이나 앞 공백으로 시작하거나 닫는 구분선이 없는 머리도 읽어 권한, 훅 키가 있으면 넘기고, 머리가 없는 문서와 BOM 뒤 열 키만 있는 머리는 허용한다', () => {
    const cfg = sandbox();
    const w = (rel, content) => ask(cfg, { agent_id: 'a1', tool_name: 'Write', tool_input: { file_path: path.join(cfg, rel), content } });
    for (const content of [
      '\uFEFF---\nname: a\npermissionMode: bypassPermissions\n---\n',
      '\n  ---\nname: a\nhooks:\n  PreToolUse: []\n---\n',
      '---\nname: a\npermissionMode: bypassPermissions\n본문\n',
      '\uFEFF---\nname: a\n본문\n',
    ]) assert.equal(w('agents/a.md', content), null, JSON.stringify(content));
    write(cfg, 'skills/s/SKILL.md', '\uFEFF---\nname: s\nallowed-tools: Bash\n---\n본문\n');
    assert.equal(ask(cfg, { agent_id: 'a1', tool_name: 'Edit', tool_input: { file_path: path.join(cfg, 'skills/s/SKILL.md'), old_string: '본문', new_string: '새 본문' } }), null);
    assert.equal(w('agents/b.md', '\uFEFF---\nname: b\ndescription: d\n---\n본문\n'), 'allow');
    assert.equal(w('skills/s/NOTES.md', '머리 없는 문서\n'), 'allow');
  });

  it('허용 자리(subagent-system, rules, docs, agents, skills) 밖은 모두 넘기고, 정의와 스킬은 지금 파일에 권한이나 훅 키가 있으면 값만 바꾸는 Edit도 넘긴다', () => {
    const cfg = sandbox();
    for (const rel of ['subagent-system/scripts/subagent-usage.js', 'subagent-system/scripts/subagentRetroHelpers.js', 'commands/x.md', 'mods/x/register.tsx', 'plugins/x/hooks/hooks.json', 'hooks-notes.md', 'output-styles/a.md', 'projects/p/memory/a.md']) assert.equal(ask(cfg, edit(cfg, rel)), null, rel);
    write(cfg, 'skills/retro/SKILL.md', '---\nname: retro\nallowed-tools: Bash(node:*)\n---\n본문\n');
    assert.equal(ask(cfg, { agent_id: 'a1', tool_name: 'Edit', tool_input: { file_path: path.join(cfg, 'skills/retro/SKILL.md'), old_string: 'Bash(node:*)', new_string: 'Bash(*)' } }), null);
    write(cfg, 'agents/b.md', '---\nname: b\n---\n본문\n');
    assert.equal(ask(cfg, { agent_id: 'a1', tool_name: 'Edit', tool_input: { file_path: path.join(cfg, 'agents/b.md'), old_string: '본문', new_string: '새 본문' } }), 'allow');
  });

  it('보호 파일은 대소문자를 바꿔 쓴 경로도 넘긴다', () => {
    const cfg = sandbox();
    for (const rel of ['claude.md', 'Claude.MD', 'Settings.json', 'SETTINGS.LOCAL.JSON', 'Docs/Plan/x.md', 'DOCS/plan/x.md', '.GIT/config', 'docs/./plan/x.md', './CLAUDE.md']) assert.equal(ask(cfg, edit(cfg, rel)), null, rel);
  });

  it('사용자 훅 폴더, 키트 훅 폴더(이 훅 자신 포함), 키트 설정 파일 쓰기는 넘기고 같은 폴더의 다른 파일은 허용한다', () => {
    const cfg = sandbox();
    for (const rel of ['hooks/guard.py', 'hooks/git/commit-msg', 'Hooks/guard.py', 'subagent-system/hooks/retro-write-allow.js', 'subagent-system/hooks/usage-autolog.js', 'subagent-system/Config.json']) assert.equal(ask(cfg, edit(cfg, rel)), null, rel);
    for (const rel of ['subagent-system/docs/ROUTING_TABLE.md', 'subagent-system/rates.json', 'rules/kit-hooks.md', 'rules/writing-style.md', 'docs/code/A.md']) assert.equal(ask(cfg, edit(cfg, rel)), 'allow', rel);
  });

  it('허용 폴더 안 파일이 보호 파일을 가리키는 심볼릭 링크면 넘긴다', { skip: process.platform === 'win32' }, () => {
    const cfg = sandbox();
    write(cfg, 'CLAUDE.md', 'x');
    fs.mkdirSync(path.join(cfg, 'rules'), { recursive: true });
    fs.symlinkSync(path.join(cfg, 'CLAUDE.md'), path.join(cfg, 'rules', 'link.md'));
    assert.equal(ask(cfg, edit(cfg, 'rules/link.md')), null);
  });

  it('retroWriteAllow가 참이 아니거나 회고 잠금이 없거나 3시간을 넘었으면 넘긴다', () => {
    assert.equal(ask(sandbox({ allow: false }), edit(sandbox({ allow: false }), 'rules/kit-a.md')), null);
    const noLock = sandbox({ lock: false });
    assert.equal(ask(noLock, edit(noLock, 'rules/kit-a.md')), null);
    const old = sandbox({ lockAgeMs: 4 * 3600 * 1000 });
    assert.equal(ask(old, edit(old, 'rules/kit-a.md')), null);
  });

  describe('config.json의 kitSourcePath(키트 원본 작업 트리)', () => {
    const kitTree = () => {
      const kit = fs.realpathSync(tmpDir());
      write(kit, 'subagent-system/VERSION', '1\n');
      return kit;
    };
    const withKit = (kitSourcePath, opts) => {
      const cfg = sandbox(opts);
      write(cfg, 'subagent-system/config.json', { retroWriteAllow: opts?.allow ?? true, kitSourcePath });
      return cfg;
    };

    it('그 아래 방법 파일 쓰기도 허용하고, 보호 목록은 키트 뿌리 기준으로 그대로 넘긴다', () => {
      const kit = kitTree();
      const cfg = withKit(kit);
      for (const rel of ['subagent-system/docs/RETRO.md', 'subagent-system/VERSION', 'subagent-system/CHANGES.md', 'subagent-system/rates.json', 'README.md']) assert.equal(ask(cfg, edit(kit, rel)), 'allow', rel);
      for (const rel of ['subagent-system/scripts/tests/a.test.js', 'subagent-system/scripts/kit-setup.js', 'subagent-system/settings-hook.json', 'subagent-system/APPLY_GUIDE.md']) assert.equal(ask(cfg, edit(kit, rel)), null, rel);
      for (const rel of ['CLAUDE.md', 'claude.md', '.git/config', 'subagent-system/hooks/retro-write-allow.js', 'subagent-system/config.json', 'docs/plan/x.md', '.claude/settings.local.json', '.claude/settings.json', '.claude/worktrees/w1/CLAUDE.md', '.claude/worktrees/w1/subagent-system/hooks/brief-check.js']) assert.equal(ask(cfg, edit(kit, rel)), null, rel);
      assert.equal(ask(cfg, edit(kit, '../outside.md')), null);
      assert.equal(ask(cfg, edit(cfg, 'rules/kit-a.md')), 'allow');
      assert.equal(ask(cfg, edit(cfg, 'CLAUDE.md')), null);
    });

    it('키가 없거나, 상대 경로이거나, 키트 폴더(subagent-system/VERSION)가 아니면 키트 쪽은 넘긴다', () => {
      const kit = kitTree();
      assert.equal(ask(sandbox(), edit(kit, 'subagent-system/docs/RETRO.md')), null);
      assert.equal(ask(withKit('relative/kit'), edit(kit, 'subagent-system/docs/RETRO.md')), null);
      const notKit = fs.realpathSync(tmpDir());
      assert.equal(ask(withKit(notKit), edit(notKit, 'a.md')), null);
    });

    it('retroWriteAllow가 거짓이거나 회고 잠금이 없으면 키트 쪽도 넘긴다', () => {
      const kit = kitTree();
      assert.equal(ask(withKit(kit, { allow: false }), edit(kit, 'subagent-system/docs/RETRO.md')), null);
      assert.equal(ask(withKit(kit, { lock: false }), edit(kit, 'subagent-system/docs/RETRO.md')), null);
    });

    it('키트 아래 파일이 보호 파일을 가리키는 심볼릭 링크면 넘긴다', { skip: process.platform === 'win32' }, () => {
      const kit = kitTree();
      write(kit, 'CLAUDE.md', 'x');
      fs.symlinkSync(path.join(kit, 'CLAUDE.md'), path.join(kit, 'subagent-system', 'link.md'));
      assert.equal(ask(withKit(kit), edit(kit, 'subagent-system/link.md')), null);
    });
  });

  it('깨진 입력이어도 종료 코드 0이고 아무것도 찍지 않는다', () => {
    const r = spawnSync(process.execPath, [HOOK_PATH], { input: 'x', encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  });
});

describe('kit-setup.js 훅(선택 commit-msg, 늘 설치 brief-check)', () => {
  const BRIEF_SETTING = 'node "$HOME/.claude/subagent-system/hooks/brief-check.js"';
  const briefCommand = (cfg) => `node "${cfg.split(path.sep).join('/')}/subagent-system/hooks/brief-check.js"`;
  const hookKit = (extra = {}) => makeKit({
    'subagent-system/hooks/brief-check.js': '// brief-check\n',
    'subagent-system/hooks/git/commit-msg': '#!/usr/bin/env node\n// commit-msg\n',
    'subagent-system/settings-hook.json': { hooks: { ...HOOKS_BOTH.hooks, PreToolUse: [{ matcher: 'Agent', hooks: [{ type: 'command', command: BRIEF_SETTING, timeout: 10 }] }] } },
    ...extra,
  });
  const settingsOf = (cfg) => read(path.join(cfg, 'settings.json'));
  const briefCommands = (cfg) => (settingsOf(cfg).hooks?.PreToolUse ?? []).flatMap((g) => g.hooks.map((x) => x.command));

  it('--hooks 없이 설치하면 brief-check는 파일과 PreToolUse 등록을 늘 놓고 commit-msg는 놓지 않으며 고를 수 있다고 알린다', () => {
    const cfg = tmpDir();
    const r = install(hookKit(), cfg, '--profile', 'company');
    assert.equal(cfgRead(cfg, 'subagent-system/hooks/brief-check.js'), '// brief-check\n');
    assert.deepEqual(briefCommands(cfg), [briefCommand(cfg)]);
    assert.equal(exists(cfg, 'subagent-system/hooks/git/commit-msg'), false);
    assert.deepEqual(r.unchosenOptional.hooks, ['commit-msg']);
    assert.equal(r.commitMsgHook, undefined);
  });

  it('--hooks에 옛 이름 brief-check를 주면 받아서 무시하고 늘 설치됨을 알린다', () => {
    const cfg = tmpDir();
    const r = install(hookKit(), cfg, '--profile', 'personal', '--hooks', 'brief-check');
    assert.ok(r.notes.some((n) => n.includes('늘 설치')));
    assert.deepEqual(briefCommands(cfg), [briefCommand(cfg)]);
    assert.equal(exists(cfg, 'subagent-system/hooks/git/commit-msg'), false);
  });

  it('--hooks로 commit-msg를 고르면 파일을 놓고 실행 권한을 주며 brief-check도 함께 걸린다', { skip: process.platform === 'win32' }, () => {
    const cfg = tmpDir();
    install(hookKit(), cfg, '--profile', 'personal', '--hooks', 'commit-msg');
    assert.equal(cfgRead(cfg, 'subagent-system/hooks/brief-check.js'), '// brief-check\n');
    assert.equal(cfgRead(cfg, 'subagent-system/.kit-base/subagent-system/hooks/git/commit-msg'), cfgRead(cfg, 'subagent-system/hooks/git/commit-msg'));
    assert.ok(fs.statSync(path.join(cfg, 'subagent-system/hooks/git/commit-msg')).mode & 0o111);
    assert.deepEqual(briefCommands(cfg), [briefCommand(cfg)]);
    assert.equal(settingsOf(cfg).hooks.PreToolUse[0].matcher, 'Agent');
  });

  it('commitCheck가 block이면 저장소마다 core.hooksPath를 거는 명령을 알리기만 하고 전역 설정은 걸지 않는다', () => {
    const cfg = tmpDir();
    const r = install(hookKit(), cfg, '--profile', 'personal', '--hooks', 'commit-msg');
    assert.equal(r.commitMsgHook.hooksPath, path.join(cfg, 'subagent-system/hooks/git').split(path.sep).join('/'));
    assert.match(r.commitMsgHook.command, /^git -C <저장소 폴더> config --local core\.hooksPath "/);
    assert.doesNotMatch(r.commitMsgHook.command, /--global/);
    assert.ok(r.notes.some((n) => n.includes('전역으로는 걸지 않았습니다')));
  });

  it('commitCheck가 block이 아니면 commit-msg를 놓아도 거는 명령을 알리지 않는다', () => {
    const cfg = tmpDir();
    const r = install(hookKit(), cfg, '--profile', 'company', '--hooks', 'commit-msg');
    assert.equal(r.commitMsgHook, undefined);
    assert.ok(r.notes.some((n) => n.includes('commitCheck가 "off"')));
  });

  it('키트에 없는 훅 이름을 고르면 아무것도 쓰지 않고 멈춘다', () => {
    const cfg = tmpDir();
    const r = run(['install', '--kit', hookKit(), '--profile', 'personal', '--hooks', 'no-such-hook'], { env: { CLAUDE_CONFIG_DIR: cfg } });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /키트에 없는 훅: no-such-hook/);
    assert.deepEqual(names(cfg), []);
  });

  it('--dry-run은 늘 설치되는 훅도 고른 훅도 놓거나 걸지 않는다', () => {
    const cfg = tmpDir();
    install(hookKit(), cfg, '--profile', 'personal', '--hooks', 'commit-msg', '--dry-run');
    assert.deepEqual(names(cfg), []);
  });

  it('update는 brief-check를 갱신하고 고르지 않은 commit-msg는 놓지 않으며 --hooks는 받지 않는다', () => {
    const kit = hookKit();
    const cfg = tmpDir();
    install(kit, cfg, '--profile', 'personal');
    kitSet(kit, 'subagent-system/hooks/brief-check.js', '// brief-check v2\n');
    kitSet(kit, 'subagent-system/VERSION', '2026.10.31\n');
    const r = update(kit, cfg);
    assert.equal(cfgRead(cfg, 'subagent-system/hooks/brief-check.js'), '// brief-check v2\n');
    assert.equal(exists(cfg, 'subagent-system/hooks/git/commit-msg'), false);
    assert.deepEqual(r.unchosenOptional.hooks, ['commit-msg']);
    assert.deepEqual(r.newOptional.hooks, []);
    assert.deepEqual(briefCommands(cfg), [briefCommand(cfg)]);
    assert.equal(run(['update', '--kit', kit, '--hooks', 'commit-msg'], { env: { CLAUDE_CONFIG_DIR: cfg } }).status, 1);
  });

  it('brief-check가 없던 옛 설치본을 update하면 파일을 놓고 PreToolUse를 건다', () => {
    const kit = hookKit();
    const cfg = tmpDir();
    install(kit, cfg, '--profile', 'personal');
    fs.rmSync(path.join(cfg, 'subagent-system/hooks/brief-check.js'));
    fs.rmSync(path.join(cfg, 'subagent-system/.kit-base/subagent-system/hooks/brief-check.js'));
    const s = settingsOf(cfg);
    delete s.hooks.PreToolUse;
    write(cfg, 'settings.json', s);
    kitSet(kit, 'subagent-system/VERSION', '2026.10.31\n');
    update(kit, cfg);
    assert.equal(cfgRead(cfg, 'subagent-system/hooks/brief-check.js'), '// brief-check\n');
    assert.deepEqual(briefCommands(cfg), [briefCommand(cfg)]);
  });

  it('add --hooks는 commit-msg 파일을 놓고, 옛 이름 brief-check는 무시하며 알린다', () => {
    const kit = hookKit();
    const cfg = tmpDir();
    install(kit, cfg, '--profile', 'personal');
    const env = { CLAUDE_CONFIG_DIR: cfg };
    const first = jsonOut(run(['add', '--kit', kit, '--hooks', 'brief-check,commit-msg'], { env }));
    assert.deepEqual(first.added, ['subagent-system/hooks/git/commit-msg']);
    assert.ok(first.commitMsgHook.command.includes('core.hooksPath'));
    assert.ok(first.notes.some((n) => n.includes('늘 설치')));
    const second = jsonOut(run(['add', '--kit', kit, '--hooks', 'brief-check'], { env }));
    assert.deepEqual(second.added, []);
    assert.deepEqual(briefCommands(cfg), [briefCommand(cfg)]);
  });

  it('uninstall은 손대지 않은 훅 파일과 키트의 PreToolUse 훅만 지우고 사용자의 같은 이벤트 훅은 남긴다', () => {
    const kit = hookKit();
    const cfg = tmpDir();
    install(kit, cfg, '--profile', 'personal', '--hooks', 'commit-msg');
    const s = settingsOf(cfg);
    s.hooks.PreToolUse.push({ matcher: 'Bash', hooks: [{ type: 'command', command: 'node /mine/guard.js' }] });
    write(cfg, 'settings.json', s);
    jsonOut(run(['uninstall', '--kit', kit, '--records', 'delete'], { env: { CLAUDE_CONFIG_DIR: cfg } }));
    assert.equal(exists(cfg, 'subagent-system/hooks'), false);
    assert.deepEqual(briefCommands(cfg), ['node /mine/guard.js']);
  });
});

describe('키트 원본 규칙 파일', () => {
  const RULES = path.resolve(SCRIPTS, '..', 'rules');
  const skip = fs.existsSync(RULES) ? false : '설치본 배치라 키트 원본 rules 폴더가 없음';
  const pathsOf = (name) => fs.readFileSync(path.join(RULES, name), 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1].match(/^paths:/m);

  it('경로 규칙(kit-code, kit-db, kit-tests, kit-docs)에는 paths가 있고 늘 읽히는 kit-core와 kit-rec-*에는 없다', { skip }, () => {
    for (const name of ['kit-code.md', 'kit-db.md', 'kit-tests.md', 'kit-docs.md']) assert.ok(pathsOf(name), name);
    const always = fs.readdirSync(RULES).filter((f) => f === 'kit-core.md' || f.startsWith('kit-rec-'));
    assert.ok(always.length > 1);
    for (const name of always) assert.equal(pathsOf(name) ?? null, null, name);
  });
});

