// 묶음 정의(kitBundles.js), 깐 상태 기록(kitInstalled.cjs), 바닥이 라우팅을 부르지 않음(kitShared.js)을 시험한다.
// 시험 이름의 U1-n은 설치 바닥 설계 9.4의 번호다. 장치 이름은 지어낸 것(demo-local)만 쓴다.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NEW_FILES, loadDefinitions, expandFiles, entriesFor, linksCovered, selectableBundles, optionIds, srcOf } from '../kitBundles.js';
import * as shared from '../kitShared.js';
import { NOT_KIT_SOURCE, missingFiles, missingBundles, partialKit } from './fixtures/installedLayout.js';

const require = createRequire(import.meta.url);
const lockApi = require('../kitInstalled.cjs');

// 묶음 전체를 견주는 시험은 일부만 내보낸 공개판 원본에서는 건너뛴다.
const WHOLE_KIT = partialKit();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KIT = path.resolve(HERE, '..', '..', '..');
const FIXTURE = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'entries-caa02fe.json'), 'utf8'));

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `kitbundles-${name}-`));
const put = (root, rel, text = 'x\n') => {
  const f = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
};
const putJson = (root, rel, obj) => put(root, rel, `${JSON.stringify(obj, null, 2)}\n`);

// 키트 원본 사본(정의와 설치 대상 파일만). 정의를 바꿔 보는 시험이 진짜 원본을 건드리지 않게 한다.
function copyKit() {
  const root = tmp('kit');
  for (const d of ['subagent-system', 'bundles', 'extras'].filter((x) => fs.existsSync(path.join(KIT, x)))) {
    fs.cpSync(path.join(KIT, d), path.join(root, d), { recursive: true, filter: (s) => !s.split(path.sep).includes('node_modules') });
  }
  return root;
}

const errorsOf = (defs) => defs.problems.filter((p) => p.level === 'error');
const warnsOf = (defs) => defs.problems.filter((p) => p.level === 'warn');
const KINDS_OF = (list) => list.map((e) => `${e.key} ${e.kind}${e.exec ? ' exec' : ''}`).sort();

let real;
before(() => {
  real = loadDefinitions({ kitRoot: KIT });
});

// 정의(bundles/)는 키트 원본에만 있어 설치본에서는 건너뛴다.
describe('U1 묶음 정의', { skip: NOT_KIT_SOURCE }, () => {
  it('U1-1 원본의 설치 대상 파일이 모두 조각 하나에만 들고 error가 없다', { skip: WHOLE_KIT }, () => {
    assert.deepEqual(errorsOf(real), []);
    // loadDefinitions와 따로, 원본 폴더를 직접 훑어 세어 본다.
    const scanned = new Set();
    const walk = (dir) => {
      for (const e of fs.readdirSync(path.join(KIT, dir), { withFileTypes: true })) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(rel);
        else scanned.add(rel.replace(/^subagent-system\/(agents|rules|skills)\//, '$1/'));
      }
    };
    for (const d of ['docs', 'scripts', 'hooks', 'agents', 'rules', 'skills']) walk(`subagent-system/${d}`);
    walk('extras');
    scanned.add('subagent-system/rates.json');
    scanned.add('subagent-system/VERSION');
    const holders = new Map();
    for (const p of real.parts) for (const k of new Set([...expandFiles(p), ...p.kitOnly])) holders.set(k, [...(holders.get(k) ?? []), p.id]);
    const bad = [...scanned].filter((k) => (holders.get(k) ?? []).length !== 1);
    assert.deepEqual(bad, [], '조각이 없거나 둘 이상인 파일');
    assert.equal(real.bundles.size, fs.readdirSync(path.join(KIT, 'bundles')).filter((d) => fs.existsSync(path.join(KIT, 'bundles', d, 'bundle.json'))).length);
    assert.equal(real.bundles.get('base').selectable, false);
  });

  it('U1-2 두 조각이 같은 파일을 가지면 겹침 error 하나', () => {
    const root = copyKit();
    putJson(root, 'bundles/routing/dup.part.json', { bundle: 'routing', part: 'dup', files: ['subagent-system/rates.json'] });
    const errs = errorsOf(loadDefinitions({ kitRoot: root }));
    assert.equal(errs.length, 1, errs.map((e) => e.msg).join('\n'));
    assert.match(errs[0].msg, /겹침.*rates\.json/);
  });

  it('U1-3 어느 조각에도 없는 설치 대상 파일은 배정 없음 error 하나', () => {
    const root = copyKit();
    put(root, 'subagent-system/docs/UNASSIGNED.md');
    const errs = errorsOf(loadDefinitions({ kitRoot: root }));
    assert.equal(errs.length, 1, errs.map((e) => e.msg).join('\n'));
    assert.match(errs[0].msg, /배정 없음.*UNASSIGNED\.md/);
  });

  it('U1-4 NEW_FILES의 없는 파일은 warn, 그 밖의 정의 파일이 없으면 error', () => {
    const missing = NEW_FILES.filter((f) => !fs.existsSync(path.join(KIT, ...srcOf(f).split('/'))));
    const warns = warnsOf(real);
    assert.equal(errorsOf(real).length, 0);
    assert.equal(warns.length, missing.length, warns.map((w) => w.msg).join('\n'));
    for (const f of missing) assert.ok(warns.some((w) => w.msg.endsWith(f)), `${f}의 warn이 없음`);
    assert.ok(warns.every((w) => w.msg.includes('NEW_FILES')));
    assert.ok(NEW_FILES.every((f) => typeof f === 'string' && !f.startsWith('/')));

    const root = copyKit();
    fs.rmSync(path.join(root, 'subagent-system', 'hooks', 'ask-log.js'));
    const errs = errorsOf(loadDefinitions({ kitRoot: root }));
    assert.equal(errs.length, 1, errs.map((e) => e.msg).join('\n'));
    assert.match(errs[0].msg, /ask-log\.js/);
  });

  it('U1-5 전부 고른 목록과 아무것도 안 고른 목록에 옛 설치 목록(caa02fe)의 파일이 같은 종류로 모두 든다(옮겨 간 파일 하나만 더함)', { skip: WHOLE_KIT }, () => {
    // 새로 생긴 파일은 견주지 않는다. 옛 목록의 파일이 빠지거나 종류가 바뀌는 것만 잡는다(새 파일마다 목록을 고치지 않게).
    // 시험 도구 폴더 아래 파일은 시험이 늘 때마다 바뀌므로 비교에서 뺀다.
    const lost = (list, expected) => {
      const have = new Set(KINDS_OF(list));
      return KINDS_OF(expected.filter((e) => !e.key.startsWith('subagent-system/scripts/tests/fixtures/'))).filter((k) => !have.has(k));
    };

    const all = entriesFor(real, { bundles: selectableBundles(real), options: optionIds(real) });
    assert.deepEqual(lost(all, FIXTURE.all), []);

    // 지금 설치가 「아무것도 안 고름」일 때 늘 깔리던 것: 회사 규칙, 라우팅, 피드백, 시험, 문서 쓰기 묶음과 고를 항목 없음.
    // 달라진 점 하나: commit-msg 훅 파일은 옛 설치에서 고르는 훅이었고 이제 바닥이 늘 깐다.
    const none = entriesFor(real, { bundles: ['company', 'routing', 'feedback', 'work-tests', 'work-docs'], options: [] });
    const expectedNone = [...FIXTURE.none, { key: 'subagent-system/hooks/git/commit-msg', kind: 'code', exec: true }];
    assert.deepEqual(lost(none, expectedNone), []);
  });

  it('U1-5 바닥만 고르면 바닥 파일만 나오고, 고를 항목과 일 이름 바꿈과 빼기 목록이 반영된다', { skip: WHOLE_KIT }, () => {
    const baseOnly = entriesFor(real, { bundles: [], options: [] });
    assert.ok(baseOnly.length > 20 && baseOnly.every((e) => e.bundle === 'base'));
    assert.ok(baseOnly.some((e) => e.key === 'subagent-system/scripts/kit-setup.js'));

    const company = entriesFor(real, { bundles: ['company'], options: ['company.rec-report'] }).map((e) => e.key);
    assert.ok(company.includes('rules/kit-core.md') && company.includes('rules/kit-rec-report.md'));
    assert.ok(!company.includes('rules/kit-rec-align.md'));

    const renamed = entriesFor(real, { bundles: ['routing'], options: [] }, { commandName: 'myretro', removedDefs: ['opus-low'] });
    const skill = renamed.find((e) => e.key === 'skills/myretro/SKILL.md');
    assert.equal(skill.src, 'subagent-system/skills/retro/SKILL.md');
    assert.ok(!renamed.some((e) => e.key.startsWith('skills/retro/')));
    assert.ok(!renamed.some((e) => e.key === 'agents/opus-low.md') && renamed.some((e) => e.key === 'agents/opus-high.md'));

    assert.throws(() => entriesFor(real, { bundles: ['nope'], options: [] }), /모르는 묶음/);
    assert.throws(() => entriesFor(real, { bundles: ['company'], options: ['company.nope'] }), /모르는 고를 항목/);
  });

  it('U1-6 백업 파일과 점 파일은 조각 파일에서 늘 빠진다', () => {
    const root = copyKit();
    put(root, 'subagent-system/hooks/tests/a.test.js');
    put(root, 'subagent-system/hooks/tests/a.test.js.bak-1');
    put(root, 'subagent-system/hooks/tests/old.bak');
    put(root, 'subagent-system/hooks/tests/.DS_Store');
    putJson(root, 'bundles/base/hooktests.part.json', { bundle: 'base', part: 'hooktests', files: ['subagent-system/hooks/tests/**'] });
    const defs = loadDefinitions({ kitRoot: root });
    assert.deepEqual(errorsOf(defs), []);
    const part = defs.parts.find((p) => p.id === 'base.hooktests');
    assert.deepEqual(expandFiles(part), ['subagent-system/hooks/tests/a.test.js']);
  });

  it('U1-7 설치본 local-bundles의 정의는 로컬 조각이 되고 파일은 kind local로 나온다', () => {
    const cfg = tmp('cfg');
    putJson(cfg, 'subagent-system/local-bundles/demo-local/bundle.json', { name: 'demo-local', title: '데모', summary: '시험용 로컬 묶음', order: 90, selectable: true });
    putJson(cfg, 'subagent-system/local-bundles/demo-local/guard.part.json', {
      bundle: 'demo-local',
      part: 'guard',
      files: ['hooks/demo-guard.js', 'hooks/tests/**'],
      hooks: [{ name: 'demo-guard', event: 'PreToolUse', matcher: 'Bash', command: 'node "$HOME/.claude/hooks/demo-guard.js"', timeout: 10 }],
      uses: [{ bundle: 'routing', link: 12, without: '데모 장치의 한 기능이 쉰다' }],
    });
    put(cfg, 'hooks/demo-guard.js');
    put(cfg, 'hooks/tests/demo-guard.test.js');
    put(cfg, 'hooks/tests/demo-guard.test.js.bak-1');
    const defs = loadDefinitions({ kitRoot: KIT, configDir: cfg });
    assert.deepEqual(errorsOf(defs), []);
    const part = defs.parts.find((p) => p.id === 'demo-local.guard');
    assert.equal(part.origin, 'local');
    assert.ok(linksCovered(defs).has(12));
    const entries = entriesFor(defs, { bundles: ['demo-local'], options: [] }).filter((e) => e.bundle === 'demo-local');
    assert.deepEqual(entries.map((e) => [e.key, e.kind, e.src, e.exec]), [
      ['hooks/demo-guard.js', 'local', null, false],
      ['hooks/tests/demo-guard.test.js', 'local', null, false],
    ]);
    // 로컬 조각을 고르지 않으면 그 파일은 목록에 나오지 않는다.
    assert.ok(!entriesFor(defs, { bundles: ['routing'], options: [] }).some((e) => e.bundle === 'demo-local'));
  });

  it('U1-7 로컬 조각이 키트 전용 항목을 쓰거나 키트 자리에서 local이라 하면 error', () => {
    const cfg = tmp('cfg');
    putJson(cfg, 'subagent-system/local-bundles/demo-local/bundle.json', { name: 'demo-local', title: '데모', summary: '시험용', order: 90 });
    putJson(cfg, 'subagent-system/local-bundles/demo-local/bad.part.json', { bundle: 'demo-local', part: 'bad', files: ['hooks/x.js'], exec: ['hooks/x.js'] });
    assert.ok(errorsOf(loadDefinitions({ kitRoot: KIT, configDir: cfg })).some((e) => /로컬 조각은 kinds, exec/.test(e.msg)));

    const root = copyKit();
    putJson(root, 'bundles/base/sneak.part.json', { bundle: 'base', part: 'sneak', origin: 'local', files: [] });
    assert.ok(errorsOf(loadDefinitions({ kitRoot: root })).some((e) => /origin\(local\)/.test(e.msg)));
  });

  it('U1-8 같은 조각 정의가 두 원본에 있으면 error, partSource로 고르면 error 0', { skip: missingBundles('work-review') }, () => {
    const extra = tmp('extra');
    fs.copyFileSync(path.join(KIT, 'bundles', 'work-review', 'core.part.json'), (fs.mkdirSync(path.join(extra, 'bundles', 'work-review'), { recursive: true }), path.join(extra, 'bundles', 'work-review', 'core.part.json')));
    const two = loadDefinitions({ kitRoot: KIT, kitSources: { extra } });
    assert.ok(errorsOf(two).some((e) => /work-review\.core.*둘 이상/.test(e.msg)));

    const kitPick = loadDefinitions({ kitRoot: KIT, kitSources: { extra }, partSource: { 'work-review.core': 'kit' } });
    assert.deepEqual(errorsOf(kitPick), []);
    assert.equal(kitPick.parts.find((p) => p.id === 'work-review.core').sourceName, 'kit');

    const extraPick = loadDefinitions({ kitRoot: KIT, kitSources: { extra }, partSource: { 'work-review.core': 'extra' } });
    const chosen = extraPick.parts.find((p) => p.id === 'work-review.core');
    assert.equal(chosen.sourceName, 'extra');
    assert.equal(chosen.root, extra);
    assert.ok(!errorsOf(extraPick).some((e) => /둘 이상/.test(e.msg)));

    const wrong = loadDefinitions({ kitRoot: KIT, kitSources: { extra }, partSource: { 'work-review.core': 'nowhere' } });
    assert.ok(errorsOf(wrong).some((e) => /nowhere/.test(e.msg)));
  });

  it('U1-9 걸침 번호 1~12가 키트 uses와 바닥이 푼 번호와 로컬 몫 번호로 빠짐없이 나뉜다', { skip: WHOLE_KIT }, () => {
    const kitLinks = linksCovered(real);
    // 바닥이 푼 번호: 1(바닥이 묶음을 이름으로 앎)은 훅과 파일 목록이 조각 정의에, 설치 안내가 묶음 install.md에 있어 uses로 적지 않는다.
    // 10(회고가 공개와 비공개를 안 가름)은 걸침이 아니라 위험이라 source-of 명령이 막는다.
    const SOLVED_BY_BASE = [1, 10];
    // 피드백 단위(F2)가 푼 번호: 9의 피드백 몫(kit-feedback이 FEEDBACK 절을 직접 가리킴)과 11(올리는 최소 문장이 FEEDBACK에 있음). 9의 남은 갈래 몫은 로컬 몫에 둔다.
    const SOLVED_BY_FEEDBACK = [9, 11];
    // 회사 규칙 단위(C1)가 푼 번호: 6(kit-core 「애매할 때」가 바닥 명령 kit-setup.js settings를 읽음)
    const SOLVED_BY_COMPANY = [6];
    // 로컬 몫 번호: 설치본에만 있는 장치에 걸리는 번호라 그 로컬 정의의 uses에 적는다. 번호만 두고 장치 이름은 두지 않는다. 실제 정의가 덮는지는 설치본을 대상으로 따로 본다.
    const LOCAL_SHARE = [8];
    const covered = new Set([...kitLinks, ...SOLVED_BY_BASE, ...SOLVED_BY_FEEDBACK, ...SOLVED_BY_COMPANY, ...LOCAL_SHARE]);
    assert.deepEqual([...covered].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    for (const n of [...SOLVED_BY_BASE, ...SOLVED_BY_FEEDBACK, ...SOLVED_BY_COMPANY, ...LOCAL_SHARE]) assert.ok(!kitLinks.has(n), `${n}번은 키트 uses에도 있음`);
  });

  it('C1 kit-core 「애매할 때」가 kit-setup.js settings를 가리키고 그 명령이 바닥만으로 사용 방식별 글자를 찍는다(걸침 6)', { skip: missingBundles('company') }, () => {
    const core = fs.readFileSync(path.join(KIT, 'subagent-system', 'rules', 'kit-core.md'), 'utf8');
    const line = core.split('\n').find((l) => l.includes('애매할 때의 문턱'));
    assert.ok(line, 'kit-core에 애매할 때 줄');
    assert.match(line, /kit-setup\.js settings/);
    assert.ok(!/subagent-retro\.js/.test(line) && !/--status/.test(line));
    const install = fs.readFileSync(path.join(KIT, 'bundles', 'routing', 'install.md'), 'utf8');
    assert.ok(!/`--status`의 「애매할 때」/.test(install));
    const run = (config) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c1-'));
      if (config !== null) { fs.mkdirSync(path.join(dir, 'subagent-system')); fs.writeFileSync(path.join(dir, 'subagent-system', 'config.json'), JSON.stringify(config)); }
      const r = spawnSync(process.execPath, [path.join(KIT, 'subagent-system', 'scripts', 'kit-setup.js'), 'settings'], { env: { ...process.env, CLAUDE_CONFIG_DIR: dir }, encoding: 'utf8' });
      fs.rmSync(dir, { recursive: true, force: true });
      return r.stdout;
    };
    assert.match(run({ profile: 'personal' }), /애매할 때: 작으면 하고 알림/);
    assert.match(run({ profile: 'company' }), /애매할 때: 되돌리는 비용이 거의 없는 것만 하고 나머지는 묻기/);
    assert.match(run(null), /애매할 때: 되돌리는 비용이 거의 없는 것만 하고 나머지는 묻기/);
  });

  it('F2 kit-feedback이 가리키는 FEEDBACK 절과 올리는 최소 문장이 feedback만 깔아도 있다(걸침 9 피드백 몫, 11)', { skip: missingBundles('feedback') }, () => {
    const rule = fs.readFileSync(path.join(KIT, 'subagent-system', 'rules', 'kit-feedback.md'), 'utf8');
    const fb = fs.readFileSync(path.join(KIT, 'subagent-system', 'docs', 'FEEDBACK.md'), 'utf8');
    for (const sec of ['그 자리에서 고치기', '검토를 끊는 때', '규칙을 적을 자리', '바꿀 방식이 없을 때 올리기']) {
      assert.ok(rule.includes(`「${sec}」`), `kit-feedback이 「${sec}」를 가리킴`);
      assert.ok(fb.includes(`## ${sec}`), `FEEDBACK에 ## ${sec}`);
    }
    // GUIDE 「문제가 생기면 올리기」는 라우팅이 깔려 있으면 꼴로만 가리킨다.
    for (const [name, text] of [['kit-feedback', rule], ['FEEDBACK', fb]]) {
      for (const m of text.matchAll(/[^.]*문제가 생기면 올리기[^.]*/g)) assert.match(m[0], /라우팅이 깔려 있으면/, `${name}의 GUIDE 가리킴`);
    }
    // 바닥과 feedback만 깔았을 때 놓이는 파일에 가리키는 문서가 있다.
    const keys = entriesFor(real, { bundles: ['feedback'], options: [] }).map((e) => e.key);
    for (const doc of rule.match(/subagent-system\/docs\/[A-Z_]+\.md|~\/\.claude\/subagent-system\/docs\/[A-Z_]+\.md/g) ?? []) {
      assert.ok(keys.includes(doc.replace('~/.claude/', '')), `${doc}가 feedback 설치에 없음`);
    }
    assert.ok(keys.includes('subagent-system/docs/FEEDBACK.md'));
  });

  it('U1-9 정의 검사: 설정 키 주인 둘, 모르는 묶음을 가리키는 uses, 조각에 없는 늘 깔 규칙은 error', () => {
    const root = copyKit();
    const bundleFile = path.join(root, 'bundles', 'base', 'bundle.json');
    const b = JSON.parse(fs.readFileSync(bundleFile, 'utf8'));
    b.configKeys = ['retroMode'];
    b.uses = [{ bundle: 'ghost', link: 3, without: '없다' }];
    b.alwaysRules = ['rules/kit-nope.md'];
    fs.writeFileSync(bundleFile, JSON.stringify(b));
    const msgs = errorsOf(loadDefinitions({ kitRoot: root })).map((e) => e.msg).join('\n');
    assert.match(msgs, /retroMode의 주인이 둘/);
    assert.match(msgs, /ghost/);
    assert.match(msgs, /alwaysRules rules\/kit-nope\.md/);
  });

  it('공개판: bundles/omitted.json에 적은 묶음을 가리키는 uses는 오류가 아니고 돌려준 omitted에 든다', () => {
    const root = copyKit();
    const bundleFile = path.join(root, 'bundles', 'base', 'bundle.json');
    const b = JSON.parse(fs.readFileSync(bundleFile, 'utf8'));
    b.uses = [{ bundle: 'ghost', link: 3, without: '없다' }];
    fs.writeFileSync(bundleFile, JSON.stringify(b));
    putJson(root, 'bundles/omitted.json', { omitted: ['ghost'] });
    const defs = loadDefinitions({ kitRoot: root });
    assert.doesNotMatch(errorsOf(defs).map((e) => e.msg).join('\n'), /ghost/);
    assert.deepEqual(defs.omitted, ['ghost']);
  });
});

describe('U1 깐 상태 기록', () => {
  const kitPart = (commit, extra = {}) => ({ origin: 'kit', commit, hooks: [], gitHooks: [], ...extra });
  const oldLock = () => ({
    lockVersion: 1,
    installed: {
      base: { options: [], parts: { core: kitPart('aaa1111') } },
      routing: { options: [], parts: { core: kitPart('aaa1111', { hooks: [{ name: 'brief-check' }] }) } },
      feedback: { options: [], parts: { core: kitPart('aaa1111'), checks: { origin: 'local' } } },
      safety: { options: [], parts: { guards: { origin: 'local' } } },
    },
  });
  const next = (commit) => ({
    base: { parts: { core: kitPart(commit) } },
    routing: { parts: { core: kitPart(commit, { hooks: [{ name: 'brief-check' }, { name: 'new-hook' }] }) } },
    feedback: { parts: { core: kitPart(commit) } },
  });

  it('U1-10 어떤 명령이 지나도 로컬 조각과 로컬 묶음 항목은 그대로다', () => {
    const before = oldLock();
    const keepLocal = (lock, step) => {
      assert.deepEqual(lock.installed.feedback.parts.checks, { origin: 'local' }, `${step} 뒤 feedback.checks`);
      assert.deepEqual(lock.installed.safety, before.installed.safety, `${step} 뒤 safety`);
    };
    let lock = lockApi.mergeLock(before, { command: 'update', kitParts: next('bbb2222') });
    keepLocal(lock, 'update');
    assert.equal(lock.installed.routing.parts.core.commit, 'bbb2222');
    assert.equal(lock.installed.routing.parts.core.hooks.length, 2);
    lock = lockApi.mergeLock(lock, { command: 'sync', kitParts: next('ccc3333') });
    keepLocal(lock, 'sync');
    assert.equal(lock.installed.feedback.parts.core.commit, 'ccc3333');
    lock = lockApi.mergeLock(lock, { command: 'add', bundles: ['work-git'], kitParts: { 'work-git': { options: [], parts: { core: kitPart('ccc3333') } }, routing: { parts: { core: kitPart('zzz') } } } });
    keepLocal(lock, 'add');
    assert.ok('work-git' in lock.installed);
    assert.equal(lock.installed.routing.parts.core.commit, 'ccc3333', 'add는 bundles 밖 묶음을 건드리지 않음');
    lock = lockApi.mergeLock(lock, { command: 'set-profile', kitParts: next('ddd4444') });
    keepLocal(lock, 'set-profile');
    lock = lockApi.mergeLock(lock, { command: 'hook-off' });
    keepLocal(lock, 'hook-off');
    // 새 묶음은 update가 알리기만 하고 기록에 더하지 않는다. install은 키트 조각을 새로 짜되 로컬 조각은 남긴다.
    const stillSame = lockApi.mergeLock(lock, { command: 'update', kitParts: { 'work-docs': { parts: { core: kitPart('eee5555') } } } });
    assert.ok(!('work-docs' in stillSame.installed));
    const reinstall = lockApi.mergeLock(lock, { command: 'install', kitParts: { base: { parts: { core: kitPart('fff6666') } } } });
    assert.deepEqual(Object.keys(reinstall.installed).sort(), ['base', 'feedback', 'safety']);
    assert.deepEqual(reinstall.installed.feedback.parts, { checks: { origin: 'local' } });
    // 새로 찾은 로컬 조각은 더하고, 이미 있는 로컬 조각은 건드리지 않는다.
    const found = lockApi.mergeLock(lock, { command: 'add', bundles: [], localParts: { feedback: { parts: { checks: { origin: 'local', changed: true }, extra: { origin: 'local' } } } } });
    assert.deepEqual(found.installed.feedback.parts.checks, { origin: 'local' });
    assert.deepEqual(found.installed.feedback.parts.extra, { origin: 'local' });
    // 넘겨 준 기록은 바뀌지 않는다.
    assert.deepEqual(before, oldLock());
    assert.throws(() => lockApi.mergeLock(before, { command: 'bogus' }), /모르는 명령/);
  });

  it('U1-11 remove는 이름으로 고른 묶음만 지우고 uninstall은 모두 지운다', () => {
    const removed = lockApi.mergeLock(oldLock(), { command: 'remove', bundles: ['safety'] });
    assert.deepEqual(Object.keys(removed.installed).sort(), ['base', 'feedback', 'routing']);
    assert.deepEqual(removed.installed.feedback.parts.checks, { origin: 'local' });
    const gone = lockApi.mergeLock(removed, { command: 'uninstall' });
    assert.deepEqual(gone.installed, {});
    assert.equal(gone.lockVersion, 1);
    assert.throws(() => lockApi.mergeLock(oldLock(), { command: 'remove', bundles: ['base'] }), /base/);
    // 키트 조각이 있는 묶음을 remove하면 거기 든 로컬 조각도 함께 지운다(이름으로 고른 묶음이라서).
    assert.ok(!('feedback' in lockApi.mergeLock(oldLock(), { command: 'remove', bundles: ['feedback'] }).installed));
  });

  it('U1-12 hasBundle은 기록이 없거나 깨졌으면 true, 기록에 없으면 false', () => {
    const cfg = tmp('lock');
    assert.equal(lockApi.readLock(cfg), null);
    assert.equal(lockApi.installedBundles(cfg), null);
    assert.equal(lockApi.hasBundle('routing', cfg), true, '기록 없음');

    put(cfg, 'subagent-system/bundles.lock.json', '{ 깨진');
    assert.equal(lockApi.readLock(cfg), null);
    assert.equal(lockApi.hasBundle('routing', cfg), true, '깨진 JSON');
    put(cfg, 'subagent-system/bundles.lock.json', '{"installed": []}');
    assert.equal(lockApi.hasBundle('routing', cfg), true, '꼴이 틀린 기록');

    const noRouting = oldLock();
    delete noRouting.installed.routing;
    lockApi.writeLock(cfg, noRouting);
    assert.equal(lockApi.hasBundle('routing', cfg), false, 'routing 없는 기록');
    assert.equal(lockApi.hasBundle('feedback', cfg), true);
    assert.equal(lockApi.hasBundle('base', cfg), true);
    assert.deepEqual([...lockApi.installedBundles(cfg)].sort(), ['base', 'feedback', 'safety']);
    assert.deepEqual(fs.readdirSync(path.join(cfg, 'subagent-system')), ['bundles.lock.json'], '임시 파일이 남지 않음');
  });
});

describe('U1 바닥 떼기', () => {
  it('U1-13 바닥 조각 파일만 있는 폴더에서 kit-setup.js가 뜬다', { skip: NOT_KIT_SOURCE }, () => {
    const base = real.parts.filter((p) => p.bundle === 'base');
    const root = tmp('basefiles');
    for (const p of base) {
      for (const key of expandFiles(p)) {
        const src = path.join(KIT, ...srcOf(key).split('/'));
        fs.mkdirSync(path.dirname(path.join(root, ...key.split('/'))), { recursive: true });
        fs.copyFileSync(src, path.join(root, ...key.split('/')));
      }
    }
    assert.ok(fs.existsSync(path.join(root, 'subagent-system', 'scripts', 'kit-setup.js')));
    assert.ok(!fs.existsSync(path.join(root, 'subagent-system', 'scripts', 'subagentRetroHelpers.js')), '라우팅 파일이 섞이지 않음');
    const r = spawnSync(process.execPath, [path.join(root, 'subagent-system', 'scripts', 'kit-setup.js'), '--help'], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /사용법/);
  });

  it('U1-14 옮긴 정의 읽기 함수를 옛 이름으로도 불러온다', { skip: missingFiles('subagent-system/scripts/subagentRetroHelpers.js') }, async () => {
    const old = await import('../subagentRetroHelpers.js');
    for (const name of ['descriptionOf', 'kindNameOf', 'parseRoutingTable', 'splitOutsideParens', 'cellKinds', 'ESCALATION_ONLY_DEFS']) {
      assert.ok(old[name] !== undefined, `${name}이 옛 자리에서 안 보임`);
      assert.equal(old[name], shared[name], `${name}이 kitShared와 같은 것이 아님`);
    }
    assert.ok(shared.ESCALATION_ONLY_DEFS instanceof Set);
    assert.equal(shared.descriptionOf('---\ndescription: 가나다\n---\n'), '가나다');
    const { cells, problems } = shared.parseRoutingTable('| 모델 | low | medium | high | xhigh |\n|:--|:--|:--|:--|:--|\n| sonnet | 일 하나 | 일 둘, 일 셋(부연) | | |\n');
    assert.deepEqual(problems, []);
    assert.deepEqual(cells.find((c) => c.effort === 'medium').kinds, ['일 둘', '일 셋']);
    assert.equal(shared.kindNameOf('일 이름(부연)'), '일 이름');
    assert.deepEqual(shared.splitOutsideParens('가(나,다),라'), ['가(나,다)', '라']);
  });
});
