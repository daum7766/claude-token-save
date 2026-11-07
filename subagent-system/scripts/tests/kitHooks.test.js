// 훅 등록 맞추기(kitHooks.js)를 시험한다. 시험 이름의 U2-n은 설치 바닥 설계 9.4의 번호다.
// 훅 정의는 진짜 키트 정의(base, routing)와 지어낸 로컬 묶음 demo-local(fixtures/hooks/local-bundles)을 쓴다.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDefinitions } from '../kitBundles.js';
import { NOT_KIT_SOURCE } from './fixtures/installedLayout.js';
import { syncHooks, compareHooks, buildCommand, normalizeCommand, scriptPathsOf, labelOf } from '../kitHooks.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KIT = path.resolve(HERE, '..', '..', '..');
const FIX = path.join(HERE, 'fixtures', 'hooks');
const HOME = os.homedir();

const clone = (v) => JSON.parse(JSON.stringify(v));
const oldSettings = () => JSON.parse(fs.readFileSync(path.join(FIX, 'settings-old.json'), 'utf8').replaceAll('__HOME__', HOME));

// 설정 폴더 하나: 지어낸 로컬 묶음 정의를 local-bundles에 둔다.
function makeCfg() {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'kithooks-'));
  fs.cpSync(path.join(FIX, 'local-bundles'), path.join(cfg, 'subagent-system', 'local-bundles'), { recursive: true });
  return cfg;
}
const localPartFile = (cfg, part) => path.join(cfg, 'subagent-system', 'local-bundles', 'demo-local', `${part}.part.json`);

// 깐 상태 기록: 바닥과 라우팅(키트 조각, 훅 사본), demo-local(로컬 조각 둘)
function lockFor(defs, extra = {}) {
  const kit = (bundle) => Object.fromEntries(defs.parts.filter((p) => p.bundle === bundle && p.origin === 'kit').map((p) => [p.part, { origin: 'kit', commit: 'x', hooks: clone(p.hooks), gitHooks: [] }]));
  return {
    lockVersion: 1,
    installed: {
      base: { options: [], parts: kit('base') },
      routing: { options: [], parts: kit('routing') },
      'demo-local': { options: [], parts: { guard: { origin: 'local' }, check: { origin: 'local' } } },
      ...extra,
    },
  };
}
const setup = () => {
  const cfg = makeCfg();
  const defs = loadDefinitions({ kitRoot: KIT, configDir: cfg });
  assert.deepEqual(defs.problems.filter((p) => p.level === 'error'), []);
  return { cfg, defs, lock: lockFor(defs) };
};
const PERSONAL = { profile: 'personal', retroWriteAllow: true };
const sync = (settings, ctx, over = {}) => syncHooks(settings, { defs: ctx.defs, lock: ctx.lock, config: PERSONAL, home: HOME, ...over });

const handlers = (settings) => Object.entries(settings.hooks ?? {}).flatMap(([event, groups]) => groups.flatMap((g) => g.hooks.map((h) => ({ event, matcher: g.matcher, ...h }))));
const labelled = (settings) => handlers(settings).filter((h) => labelOf(h.command));
const unlabelled = (settings) => handlers(settings).filter((h) => !labelOf(h.command)).map((h) => h.command);
const ids = (settings) => labelled(settings).map((h) => `${labelOf(h.command).id}|${h.event}`).sort();
const EXPECTED = [
  'base/ask-log|PermissionRequest',
  'demo-local/demo-check|PreToolUse', 'demo-local/demo-check|Stop', 'demo-local/demo-check|UserPromptSubmit',
  'demo-local/demo-guard|PreToolUse', 'demo-local/demo-guard-b|PreToolUse',
  'routing/brief-check|PreToolUse', 'routing/retro-write-allow|PermissionRequest', 'routing/stall-check|Stop', 'routing/subagent-usage|SubagentStop', 'routing/usage-autolog|SubagentStop',
].sort();
const emptyChanges = (c) => ['added', 'removed', 'replaced', 'unknownKept', 'warnings'].every((k) => c[k].length === 0);

// 훅 정의(bundles/)는 키트 원본에만 있어 설치본에서는 건너뛴다.
describe('syncHooks', { skip: NOT_KIT_SOURCE }, () => {
  it('U2-1 옛 꼴 등록을 정의마다 이름표 등록 하나로 바꾸고 사용자 훅은 글자 그대로 둔다', () => {
    const ctx = setup();
    const input = oldSettings();
    const userBefore = unlabelled(input).filter((c) => !/timed\.zsh/.test(c) || /user-guard/.test(c));
    const { settings, changes } = sync(input, ctx);
    assert.deepEqual(ids(settings), EXPECTED);
    assert.equal(changes.replaced.length, 11, '옛 꼴 열한 개가 모두 갈아 끼움');
    assert.equal(changes.added.length, 0);
    // 이름표 없는 명령은 사용자 훅 넷(sample 둘, user-guard, user2)뿐이고 글자가 바이트로 같다.
    const userAfter = unlabelled(settings);
    assert.equal(userAfter.length, 4);
    assert.deepEqual([...userAfter].sort(), [...userBefore].sort());
    assert.ok(userAfter.every((c) => !/timed\.zsh/.test(c) || /user-guard/.test(c)));
    // 사용자 훅이 든 묶음의 matcher와 timeout도 그대로.
    assert.deepEqual(settings.permissions, input.permissions);
    assert.equal(settings.hooks.PostToolUse[0].hooks[0].timeout, 5);
    // 입력은 바뀌지 않는다.
    assert.deepEqual(input, oldSettings());
    // 명령 꼴
    const brief = labelled(settings).find((h) => labelOf(h.command).name === 'brief-check');
    assert.equal(brief.command, 'node "$HOME/.claude/subagent-system/hooks/kit-hook.cjs" brief-check node "$HOME/.claude/subagent-system/hooks/brief-check.js" # kit:routing/brief-check');
    assert.equal(brief.matcher, 'Agent');
    assert.equal(brief.timeout, 10);
  });

  it('U2-2 결과에 다시 돌리면 바뀌는 것이 없다', () => {
    const ctx = setup();
    const first = sync(oldSettings(), ctx).settings;
    const again = sync(first, ctx);
    assert.ok(emptyChanges(again.changes), JSON.stringify(again.changes));
    assert.equal(again.changes.changed, false);
    assert.deepEqual(again.settings, first);
  });

  it('U2-3 retroWriteAllow가 true, false, 키 없음(개인용), 키 없음(회사용)이면 허용 훅 등록이 있음, 없음, 있음, 없음', () => {
    const ctx = setup();
    const has = (config) => ids(sync({}, ctx, { config }).settings).includes('routing/retro-write-allow|PermissionRequest');
    assert.equal(has({ profile: 'personal', retroWriteAllow: true }), true);
    assert.equal(has({ profile: 'personal', retroWriteAllow: false }), false);
    assert.equal(has({ profile: 'personal' }), true);
    assert.equal(has({ profile: 'company' }), false);
    assert.equal(has({}), false, 'profile도 없으면 회사용');
    // true에서 false로 바뀌면 달려 있던 등록이 빠진다.
    const on = sync({}, ctx).settings;
    const off = sync(on, ctx, { config: { profile: 'personal', retroWriteAllow: false } });
    assert.deepEqual(off.changes.removed.map((r) => r.label), ['routing/retro-write-allow']);
  });

  it('U2-4 기록에 없는 묶음의 옛 꼴 등록은 빠진다', () => {
    const ctx = setup();
    delete ctx.lock.installed.routing;
    const { settings, changes } = sync(oldSettings(), ctx);
    assert.ok(!ids(settings).some((i) => i.startsWith('routing/')));
    assert.ok(changes.removed.some((r) => r.label === 'routing/retro-write-allow'));
    assert.ok(!JSON.stringify(settings).includes('retro-write-allow'));
    // 이름표 등록도 기록에 묶음이 없으면 빠진다.
    const full = setup();
    const withRouting = sync({}, full).settings;
    delete full.lock.installed.routing;
    const dropped = sync(withRouting, full);
    assert.ok(!ids(dropped.settings).some((i) => i.startsWith('routing/')));
  });

  it('U2-5 이름표 없이 감싸개만 품은 사용자 훅은 키트 등록으로 보지 않는다', () => {
    const ctx = setup();
    const { settings } = sync(oldSettings(), ctx);
    const user2 = '`node "$HOME/.claude/subagent-system/hooks/kit-hook.cjs" user2 python3 ~/.claude/hooks/user2.py`'.slice(1, -1);
    assert.ok(unlabelled(settings).includes(user2));
    assert.equal(scriptPathsOf(user2).join(), '~/.claude/hooks/user2.py');
  });

  it('U2-6 로컬 조각의 정의 파일이 없어지면 그 등록은 그대로 두고 unknownKept에 이름을 낸다', () => {
    const ctx = setup();
    const first = sync(oldSettings(), ctx).settings;
    fs.rmSync(localPartFile(ctx.cfg, 'check'));
    const defs = loadDefinitions({ kitRoot: KIT, configDir: ctx.cfg });
    const again = syncHooks(first, { defs, lock: ctx.lock, config: PERSONAL, home: HOME });
    assert.deepEqual(again.settings, first, '등록이 하나도 안 바뀜');
    assert.deepEqual([...new Set(again.changes.unknownKept)], ['demo-local/demo-check']);
    assert.equal(again.changes.unknownKept.length, 3);
    assert.ok(again.changes.removed.length === 0);
  });

  it('U2-7 키트 정의만 바뀌어도 로컬 묶음 등록은 그대로다', () => {
    const ctx = setup();
    const first = sync(oldSettings(), ctx).settings;
    const lock = clone(ctx.lock);
    lock.installed.routing.parts.core.hooks = lock.installed.routing.parts.core.hooks.filter((h) => h.name !== 'usage-autolog');
    const again = sync(first, ctx, { lock });
    assert.deepEqual(again.changes.removed.map((r) => r.label), ['routing/usage-autolog']);
    assert.deepEqual(ids(again.settings).filter((i) => i.startsWith('demo-local/')), EXPECTED.filter((i) => i.startsWith('demo-local/')));
  });

  it('U2-8 정의의 matcher가 바뀌면 그 등록 하나만 새 그룹으로 갈아 끼우고 나머지는 그대로다', () => {
    const ctx = setup();
    const first = sync(oldSettings(), ctx).settings;
    const file = localPartFile(ctx.cfg, 'check');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('"Edit|Write|Bash"', '"Edit|Write|Bash|Agent"'));
    const defs = loadDefinitions({ kitRoot: KIT, configDir: ctx.cfg });
    const run = (s) => syncHooks(s, { defs, lock: ctx.lock, config: PERSONAL, home: HOME });
    const second = run(first);
    assert.equal(second.changes.replaced.length, 1);
    assert.equal(second.changes.replaced[0].label, 'demo-local/demo-check');
    assert.equal(second.changes.added.length + second.changes.removed.length, 0);
    const pre = second.settings.hooks.PreToolUse;
    assert.equal(pre.at(-1).matcher, 'Edit|Write|Bash|Agent');
    const others = (s) => ({ ...s.hooks, PreToolUse: s.hooks.PreToolUse.filter((g) => !g.hooks.some((h) => h.command.includes('# kit:demo-local/demo-check'))) });
    assert.deepEqual(others(second.settings), others(first));
    assert.equal(second.settings.permissions.allow[0], 'Bash(ls:*)');
    assert.ok(emptyChanges(run(second.settings).changes), '다시 돌리면 바뀜 0');
  });

  it('U2-9 timeout이 바뀌면 같은 꼴로 하나만 바뀐다', () => {
    const ctx = setup();
    const first = sync(oldSettings(), ctx).settings;
    const file = localPartFile(ctx.cfg, 'guard');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('"command": "python3 \\"$HOME/.claude/hooks/demo-guard.py\\"", "timeout": 10', '"command": "python3 \\"$HOME/.claude/hooks/demo-guard.py\\"", "timeout": 20'));
    const defs = loadDefinitions({ kitRoot: KIT, configDir: ctx.cfg });
    const second = syncHooks(first, { defs, lock: ctx.lock, config: PERSONAL, home: HOME });
    assert.equal(second.changes.replaced.length, 1);
    assert.equal(second.changes.replaced[0].label, 'demo-local/demo-guard');
    const guard = labelled(second.settings).find((h) => h.command.endsWith('# kit:demo-local/demo-guard'));
    assert.equal(guard.timeout, 20);
    assert.ok(emptyChanges(syncHooks(second.settings, { defs, lock: ctx.lock, config: PERSONAL, home: HOME }).changes));
  });

  it('U2-10 CLAUDE_CONFIG_DIR가 다르면 모든 키트 명령이 그 폴더를 가리키고 한 번 더 돌려도 그대로다', () => {
    const ctx = setup();
    const dir = '/tmp/kithooks-x';
    const { settings } = sync(oldSettings(), ctx, { configDir: dir });
    assert.deepEqual(ids(settings), EXPECTED);
    for (const h of labelled(settings)) {
      assert.ok(h.command.includes(`${dir}/`), h.command);
      assert.ok(!h.command.includes('$HOME/.claude'), h.command);
    }
    assert.ok(emptyChanges(sync(settings, ctx, { configDir: dir }).changes));
    // 설정 폴더가 달라도 옛 꼴(홈 기준 경로)을 알아본다.
    assert.equal(normalizeCommand(`node ${dir}/hooks/a.js`, { configDir: dir }), 'node ~/.claude/hooks/a.js');
  });

  it('U2-11 옛 꼴 한 그룹의 키트 명령 둘은 그룹 둘로 갈라지고 사용자 명령은 남은 그룹에 둔다', () => {
    const ctx = setup();
    const input = oldSettings();
    const { settings } = sync(input, ctx);
    const bash = settings.hooks.PreToolUse.filter((g) => g.matcher === 'Bash');
    const names = bash.map((g) => g.hooks.map((h) => labelOf(h.command)?.name ?? 'user'));
    assert.deepEqual(names.filter((n) => n.length === 1 && n[0] === 'user').length, 1, '사용자 명령만 남은 옛 그룹');
    assert.ok(names.some((n) => n.join() === 'demo-guard') && names.some((n) => n.join() === 'demo-guard-b'));
    assert.ok(bash.every((g) => g.hooks.length === 1));
    const brief = settings.hooks.PreToolUse.filter((g) => g.hooks.some((h) => h.command.includes('# kit:routing/brief-check')));
    assert.deepEqual(brief.map((g) => g.matcher), ['Agent']);
    assert.ok(!settings.hooks.PreToolUse.some((g) => g.matcher === 'Agent|Edit|Write|Bash'), '옛 matcher 그룹은 비어 사라짐');
  });

  it('U2-12 같은 이름표와 이벤트의 등록이 둘이면 하나만 남긴다', () => {
    const ctx = setup();
    const first = sync(oldSettings(), ctx).settings;
    const dup = clone(first);
    dup.hooks.Stop.push(clone(dup.hooks.Stop[0]));
    dup.hooks.PermissionRequest.push({ matcher: '*', hooks: [{ ...clone(first.hooks.PermissionRequest.find((g) => g.matcher === '*').hooks[0]), timeout: 99 }] });
    const { settings, changes } = sync(dup, ctx);
    assert.deepEqual(ids(settings), EXPECTED);
    assert.equal(changes.removed.length, 2);
    assert.deepEqual(settings, first, '결과가 정의대로 한 벌인 처음 결과와 같음');
  });

  it('U2-13 끈 훅은 등록하지 않고 두 번째 돌림에는 바뀌는 것이 없다', () => {
    const ctx = setup();
    const config = { ...PERSONAL, disabledHooks: ['demo-local/demo-guard'] };
    const first = sync(oldSettings(), ctx, { config });
    assert.ok(!ids(first.settings).includes('demo-local/demo-guard|PreToolUse'));
    assert.ok(ids(first.settings).includes('demo-local/demo-guard-b|PreToolUse'));
    assert.ok(first.changes.removed.some((r) => r.label === 'demo-local/demo-guard'), '옛 꼴 등록은 빠짐');
    assert.ok(emptyChanges(sync(first.settings, ctx, { config }).changes));
    // 끈 것을 다시 켜면 등록된다.
    assert.ok(ids(sync(first.settings, ctx).settings).includes('demo-local/demo-guard|PreToolUse'));
  });

  it('U2-14 모르는 이벤트 이름은 경고하고 등록은 한다', () => {
    const ctx = setup();
    const file = localPartFile(ctx.cfg, 'guard');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('"event": "PreToolUse", "matcher": "Bash", "command": "python3 \\"$HOME/.claude/hooks/demo-guard.py\\""', '"event": "FooBar", "command": "python3 \\"$HOME/.claude/hooks/demo-guard.py\\""'));
    const defs = loadDefinitions({ kitRoot: KIT, configDir: ctx.cfg });
    const { settings, changes } = syncHooks({}, { defs, lock: ctx.lock, config: PERSONAL, home: HOME });
    assert.equal(changes.warnings.length, 1);
    assert.match(changes.warnings[0], /FooBar/);
    assert.ok(ids(settings).includes('demo-local/demo-guard|FooBar'));
  });

  it('깐 상태 기록이 없으면 아무것도 건드리지 않는다', () => {
    const ctx = setup();
    const input = oldSettings();
    const r = syncHooks(input, { defs: ctx.defs, lock: null, config: PERSONAL, home: HOME });
    assert.deepEqual(r.settings, input);
    assert.equal(r.changes.warnings.length, 1);
  });

  it('옛 세션 시작 훅(회고 스크립트의 --session-start)은 뺀다', () => {
    const ctx = setup();
    const input = { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `node ${HOME}/.claude/subagent-system/scripts/subagent-retro.js --session-start`, timeout: 10 }] }] } };
    const { settings, changes } = sync(input, ctx);
    assert.equal(settings.hooks.SessionStart, undefined);
    assert.equal(changes.removed.length, 1);
  });
});

describe('compareHooks', { skip: NOT_KIT_SOURCE }, () => {
  it('U2-15 이름표 꼴과 옛 꼴의 같은 내용은 차이 0이고 matcher 하나를 바꾸면 그것 하나만 나온다', () => {
    const ctx = setup();
    const old = oldSettings();
    const labelledForm = sync(old, ctx).settings;
    // 옛 꼴 쪽에서 brief-check의 matcher는 Agent|Edit|Write|Bash라 키트 견본 Agent와 다르다. 같은 내용으로 맞춰 견준다.
    old.hooks.PreToolUse.find((g) => g.matcher === 'Agent|Edit|Write|Bash').matcher = 'Agent';
    const same = compareHooks(old, labelledForm, { home: HOME });
    assert.deepEqual(same, { onlyA: [], onlyB: [], changed: [] });

    const tweaked = clone(labelledForm);
    tweaked.hooks.Stop.find((g) => g.hooks.some((h) => h.command.includes('demo-check'))).matcher = 'x';
    const diff = compareHooks(old, tweaked, { home: HOME });
    assert.equal(diff.changed.length, 1);
    assert.equal(diff.onlyA.length + diff.onlyB.length, 0);
    assert.equal(diff.changed[0].a.event, 'Stop');

    // 같은 훅이 두 번 걸리면 잡는다.
    const twice = clone(labelledForm);
    twice.hooks.Stop.push(clone(twice.hooks.Stop[0]));
    const dup = compareHooks(labelledForm, twice, { home: HOME });
    assert.equal(dup.onlyB.length, 1);
  });
});

describe('작은 함수', () => {
  it('buildCommand는 감싸개와 이름표를 붙이고 timed가 false면 이름표만 붙인다', () => {
    const def = { name: 'x-hook', event: 'Stop', command: 'node "$HOME/.claude/hooks/x.js" --a', timeout: 10 };
    assert.equal(buildCommand(def, { bundle: 'demo' }), 'node "$HOME/.claude/subagent-system/hooks/kit-hook.cjs" x-hook node "$HOME/.claude/hooks/x.js" --a # kit:demo/x-hook');
    assert.equal(buildCommand({ ...def, timed: false }, { bundle: 'demo' }), 'node "$HOME/.claude/hooks/x.js" --a # kit:demo/x-hook');
    assert.equal(buildCommand(def, { bundle: 'demo', configDir: '/c/d' }), 'node "/c/d/subagent-system/hooks/kit-hook.cjs" x-hook node "/c/d/hooks/x.js" --a # kit:demo/x-hook');
    assert.deepEqual(labelOf(buildCommand(def, { bundle: 'demo' })), { bundle: 'demo', name: 'x-hook', id: 'demo/x-hook' });
    assert.equal(labelOf('node x.js'), null);
  });

  it('normalizeCommand와 scriptPathsOf는 경로 글자를 한 꼴로 맞추고 감싸개 경로를 뺀다', () => {
    const n = (c) => normalizeCommand(c, { home: '/Users/t' });
    assert.equal(n('node ${HOME}/.claude/a.js'), 'node ~/.claude/a.js');
    assert.equal(n('node $HOME/.claude/a.js'), 'node ~/.claude/a.js');
    assert.equal(n('node /Users/t/.claude/a.js'), 'node ~/.claude/a.js');
    assert.equal(n('node ~/.claude/a.js'), 'node ~/.claude/a.js');
    assert.equal(n('python3 C:\\x\\a.py'), 'python3 C:/x/a.py');
    assert.deepEqual(scriptPathsOf('zsh "~/.claude/hooks/timed.zsh" n node "~/.claude/hooks/a.js" --x'), ['~/.claude/hooks/a.js']);
    assert.deepEqual(scriptPathsOf('node "~/.claude/subagent-system/hooks/kit-hook.cjs" n python3 ~/.claude/hooks/b.py # kit:x/n'), ['~/.claude/hooks/b.py']);
  });
});
