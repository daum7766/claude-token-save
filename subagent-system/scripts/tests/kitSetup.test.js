import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KIT_SETUP = path.join(SCRIPTS, 'kit-setup.js');
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
const run = (args, { stdin, env } = {}) => {
  const clean = { ...process.env };
  delete clean.CLAUDE_CONFIG_DIR;
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

  it('--add-config-lines는 줄을 다듬어 중복 없이 더하고 따옴표와 달러 기호를 그대로 둔다', () => {
    const file = write(tmpDir(), 'config.json', { checklistDeclined: ['a'] });
    run(['--add-config-lines', file, 'checklistDeclined'], { stdin: 'a\r\n  c  \n\n$x `y` "z"\n' });
    assert.deepEqual(read(file).checklistDeclined, ['a', 'c', '$x `y` "z"']);
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
        SubagentStop: [{ hooks: [{ type: 'command', command: 'node /h/subagent-usage.js --hook' }] }, { hooks: [{ type: 'command', command: 'echo mine' }] }],
        SessionStart: [{ hooks: [{ type: 'command', command: 'node a/subagent-retro.js --session-start' }, { type: 'command', command: 'keep' }] }],
      },
    });
    const r = run(['--remove-hooks', file, 'SubagentStop', 'SessionStart']);
    assert.match(r.stdout, /뺀 명령: 2개/);
    assert.deepEqual(read(file).hooks, { SubagentStop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }], SessionStart: [{ hooks: [{ type: 'command', command: 'keep' }] }] });
    const only = write(tmpDir(), 's.json', { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node subagent-retro.js --session-start' }] }] }, model: 'm' });
    run(['--remove-hooks', only, 'SessionStart']);
    assert.deepEqual(read(only), { model: 'm' });
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

describe('kit-setup.js GUIDE 사용자 구역 옮기기', () => {
  const guide = (table, opus, rules) => `머리\n<!-- 사용자 표 시작 -->${table}<!-- 사용자 표 끝 -->\n중간\n<!-- 무조건 Opus 시작 -->${opus}<!-- 무조건 Opus 끝 -->\n<!-- 사용자 규칙 시작 -->${rules}<!-- 사용자 규칙 끝 -->\n끝\n`;

  it('--copy-guide-zones는 세 구역의 안쪽만 설치본에서 복사본으로 옮기고 복사본의 줄바꿈 꼴을 지킨다', () => {
    const dir = tmpDir();
    const src = write(dir, 'src.md', guide('\n내 표\n', '\n내 Opus\n', '\n내 규칙\n'));
    const dst = path.join(dir, 'dst.md');
    fs.writeFileSync(dst, guide('\n키트 표\n', '\n키트 Opus\n', '\n키트 규칙\n').replace(/\n/g, '\r\n'));
    const r = run(['--copy-guide-zones', src, dst]);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.stdout.trim().split('\n'), ['옮김: 사용자 표', '옮김: 무조건 Opus', '옮김: 사용자 규칙']);
    assert.equal(fs.readFileSync(dst, 'utf8'), guide('\n내 표\n', '\n내 Opus\n', '\n내 규칙\n').replace(/\n/g, '\r\n'));
  });

  it('--copy-guide-zones는 표시가 한 쌍이 아니면 종료 코드 1이고 복사본을 바꾸지 않는다', () => {
    const dir = tmpDir();
    const src = write(dir, 'src.md', guide('a', 'b', 'c'));
    const broken = guide('x', 'y', 'z').replace('<!-- 무조건 Opus 끝 -->', '');
    const dst = write(dir, 'dst.md', broken);
    const r = run(['--copy-guide-zones', src, dst]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /복사본의 무조건 Opus 표시가 한 쌍이 아닙니다/);
    assert.equal(fs.readFileSync(dst, 'utf8'), broken);
  });
});

describe('kit-setup.js 설치본 백업과 끊긴 업데이트 확인', () => {
  const setup = (commandName) => {
    const root = tmpDir();
    const h = path.join(root, 'cc');
    write(h, 'settings.json', {});
    write(h, 'CLAUDE.md', 'x');
    write(h, 'subagent-system/docs/a.md', 'a');
    write(h, 'subagent-system/scripts/s.js', 's');
    write(h, 'subagent-system/VERSION', '1');
    write(h, 'subagent-system/config.json', commandName ? { commandName } : {});
    write(h, 'agents/haiku-low.md', 'h');
    write(h, 'agents/mine.md', 'm');
    write(h, `commands/${commandName ?? 'retro'}.md`, 'c');
    write(h, `skills/${commandName ?? 'retro'}/SKILL.md`, 'k');
    return { h, env: { CLAUDE_CONFIG_DIR: h } };
  };
  const backupDir = (h) => path.join(h, names(h).find((n) => n.startsWith('subagent-system-backup-')));

  it('--backup-install은 키트가 바꾸는 파일과 폴더만 CLAUDE_CONFIG_DIR 아래 백업 폴더에 복사하고 위치를 찍는다', () => {
    const { h, env } = setup();
    const r = run(['--backup-install'], { env });
    assert.equal(r.status, 0, r.stderr);
    const b = backupDir(h);
    assert.match(r.stdout, new RegExp(`백업 위치: ${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.equal(fs.existsSync(path.join(b, 'agents', 'haiku-low.md')), true);
    assert.equal(fs.existsSync(path.join(b, 'agents', 'mine.md')), false);
    for (const rel of ['settings.json', 'CLAUDE.md', 'subagent-system/docs/a.md', 'subagent-system/scripts/s.js', 'subagent-system/VERSION', 'subagent-system/config.json', 'commands/retro.md', 'skills/retro/SKILL.md']) {
      assert.equal(fs.existsSync(path.join(b, rel)), true, rel);
    }
  });

  it('--backup-install은 config.json의 commandName이 올바른 이름이면 그 이름의 커맨드와 스킬을 백업한다', () => {
    const { h, env } = setup('sub-retro');
    run(['--backup-install'], { env });
    const b = backupDir(h);
    assert.equal(fs.existsSync(path.join(b, 'commands', 'sub-retro.md')), true);
    assert.equal(fs.existsSync(path.join(b, 'skills', 'sub-retro', 'SKILL.md')), true);
  });

  it('--backup-install은 복사할 것이 하나도 없으면 폴더를 만들지 않고 백업할 것 없음을 찍는다', () => {
    const root = tmpDir();
    fs.mkdirSync(path.join(root, 'cc'));
    const r = run(['--backup-install'], { env: { CLAUDE_CONFIG_DIR: path.join(root, 'cc') } });
    assert.match(r.stdout, /백업할 것 없음/);
    assert.deepEqual(names(path.join(root, 'cc')), []);
  });

  it('--check-update-interrupted는 설치본 VERSION이 가장 새 백업의 VERSION보다 이르면 끊김, 늦으면 끊기지 않음이다', () => {
    const { h, env } = setup();
    const b = path.join(h, 'subagent-system-backup-20261020-100000');
    write(b, 'subagent-system/VERSION', '1');
    const version = path.join(h, 'subagent-system', 'VERSION');
    const now = Date.now() / 1000;
    fs.utimesSync(path.join(b, 'subagent-system/VERSION'), now + 100, now + 100);
    assert.match(run(['--check-update-interrupted'], { env }).stdout, /^끊김: 설치본 VERSION이 백업보다 이르다, 가장 새 백업은 \d+일 전/);
    fs.utimesSync(version, now + 200, now + 200);
    assert.match(run(['--check-update-interrupted'], { env }).stdout, /^끊기지 않음: 설치본 VERSION이 백업보다 늦다/);
  });

  it('--check-update-interrupted는 백업이 없으면 끊기지 않음이다', () => {
    const { env } = setup();
    assert.match(run(['--check-update-interrupted'], { env }).stdout, /^끊기지 않음: 백업이나 VERSION이 없다/);
  });
});
