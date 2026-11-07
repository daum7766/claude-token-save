import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// 원본과 설치본이 벌어지지 않게 하는 도구(diff, sync, descriptions, 커밋 때 검사)의 시험이다.
// 임시 설정 폴더(CLAUDE_CONFIG_DIR)에 설치해 돌리므로 문서 글의 ~/.claude는 설치 때 그 폴더로 바뀐다. 원본 글에도 같은 변환이 입혀져야 거짓 차이가 나지 않는다(첫 시험).
const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KIT_SETUP = path.join(SCRIPTS, 'kit-setup.js');
const KIT_ROOT = path.join(SCRIPTS, '..');
const HAS_GIT = spawnSync('git', ['--version']).status === 0;
const SKIP = !HAS_GIT ? 'git이 없음' : !fs.existsSync(path.join(KIT_ROOT, 'rules')) ? '설치본 배치라 키트 원본 파일이 없음' : false;

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kit-drift-'));
const put = (dir, rel, text) => {
  const f = path.join(dir, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
};
const get = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const gitEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') && k !== 'CLAUDE_CONFIG_DIR' && !k.startsWith('SUBAGENT_') && k !== 'KIT_DRIFT_SKIP'));
const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, env: gitEnv(), encoding: 'utf8' });
  return r;
};
const gitOk = (cwd, ...args) => {
  const r = git(cwd, ...args);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
};
const commitAll = (dir, msg) => {
  gitOk(dir, 'add', '-A');
  gitOk(dir, 'commit', '-q', '-m', msg);
};
const kitRun = (cfg, args, env = {}) => spawnSync(process.execPath, [KIT_SETUP, ...args], { env: { ...gitEnv(), CLAUDE_CONFIG_DIR: cfg, ...env }, encoding: 'utf8' });
const ok = (r) => {
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};

const TABLE = `# 라우팅 표

| | low | medium | high | xhigh |
|:---|:---|:---|:---|:---|
| **Haiku** | 시험 실행 | | | |
| **Sonnet** | | 구현 | | |
| **Opus** | | | 설계 검토 「(고정)」, 원인 찾기(이슈 분석) | high로도 안 풀린 일 |
`;
const DEF = (name, desc) => `---\nname: ${name}\ndescription: ${desc}\nmodel: opus\n---\n\n본문\n`;
const GUIDE_PATH = '`~/.claude/subagent-system/docs/SUBAGENT_GUIDE.md`';

// 묶음 정의: 바닥(스크립트와 git 훅), 라우팅(문서, 정의, 스킬), 회사용(규칙, 고를 권장 규칙은 rules/kit-rec-*). 파일 목록은 패턴이라 시험이 키트에 파일을 더하고 빼도 정의가 맞는다.
const bundleDef = (name, order, extra = {}) => ({ name, title: `${name} 시험 묶음`, summary: `${name} 요약`, order, selectable: name !== 'base', alwaysRules: [], options: [], configKeys: [], uses: [], records: [], ...extra });
function writeDefinitions(kit) {
  const defs = {
    base: {
      bundle: bundleDef('base', 0, { configKeys: ['profile', 'commitCheck', 'knownBundles', 'kitFileHashes', 'decisionWords', 'personalMarkers', 'kitSourcePath'] }),
      core: {
        files: ['subagent-system/scripts/*', 'subagent-system/hooks/ask-log.js', 'subagent-system/hooks/kit-hook.cjs', 'subagent-system/hooks/package.json', 'subagent-system/hooks/git/**'],
        exec: ['subagent-system/hooks/git/commit-msg', 'subagent-system/hooks/git/pre-commit'],
        kitOnly: ['subagent-system/VERSION'],
        hooks: [{ name: 'ask-log', event: 'PermissionRequest', matcher: '*', command: 'node "$HOME/.claude/subagent-system/hooks/ask-log.js"', timeout: 10 }],
        gitHooks: [{ hook: 'pre-commit', name: 'kit-drift', order: 10, file: 'subagent-system/hooks/git/pre-commit.d/10-kit-drift.cjs' }],
      },
    },
    routing: {
      bundle: bundleDef('routing', 20, { configKeys: ['retroMode', 'retroWriteAllow', 'roles', 'removedDefs', 'commandName'] }),
      core: {
        files: ['agents/*.md', 'subagent-system/docs/*.md', 'skills/retro/**', 'subagent-system/rates.json'],
        kinds: { 'subagent-system/docs/ROUTING_TABLE.md': 'once', 'subagent-system/rates.json': 'rates' },
        rename: { 'skills/retro/': 'commandName' },
      },
    },
    company: {
      bundle: bundleDef('company', 10, { alwaysRules: ['rules/kit-core.md'], options: [{ id: 'rec', title: '권장 규칙', files: ['rules/kit-rec-*.md'], default: false }] }),
      core: { files: ['rules/kit-core.md', 'rules/kit-rec-*.md'] },
    },
  };
  for (const [bundle, def] of Object.entries(defs)) {
    put(kit, `bundles/${bundle}/bundle.json`, JSON.stringify(def.bundle, null, 2));
    put(kit, `bundles/${bundle}/core.part.json`, JSON.stringify({ bundle, part: 'core', origin: 'kit', ...def.core }, null, 2));
  }
}

// 작은 키트 원본(git 저장소)을 만들어 임시 설정 폴더에 설치한다. 스크립트는 실제 키트 것을 그대로 복사한다.
function setup({ kitSourcePath = true } = {}) {
  const kit = tmp();
  const cfg = tmp();
  const files = {
    'subagent-system/VERSION': '2026.11.1\n',
    'subagent-system/docs/SUBAGENT_GUIDE.md': '# 가이드\n\n줄1\n줄2\n경로 ~/.claude/x\n',
    'subagent-system/docs/RETRO.md': '# 회고\n\n내용\n',
    'subagent-system/docs/SUBAGENT_SITUATIONS.md': '# 상황별\n\n줄\n',
    'subagent-system/docs/AUTO_RETRO.md': '# 판정\n',
    'subagent-system/docs/SUBAGENT_BRIEF_CHECKLIST.md': '# 체크리스트\n\n| 지킬 것 | 이유 |\n|:---|:---|\n| 목표 줄 | 방향 |\n',
    'subagent-system/docs/TESTING.md': '# 시험\n',
    'subagent-system/docs/DOC_WRITING.md': '# 문서\n',
    'subagent-system/docs/ROUTING_TABLE.md': '# 라우팅 표\n\n<!-- 키트 원본의 예시 -->\n\n| | low | medium | high | xhigh |\n|:---|:---|:---|:---|:---|\n| **Opus** | | | 설계 검토 | |\n',
    'subagent-system/agents/opus-high.md': DEF('opus-high', `놓쳐도 신호가 없는 일. 설계 검토. (${GUIDE_PATH})`),
    'subagent-system/agents/opus-xhigh.md': DEF('opus-xhigh', `올려 보낸 일만 받는다. (${GUIDE_PATH})`),
    'subagent-system/rules/kit-core.md': '- 핵심 규칙\n',
    'subagent-system/skills/retro/SKILL.md': '---\nname: retro\n---\n회고\n',
    'subagent-system/rates.json': '{ "_checked": "2026-10" }\n',
    'subagent-system/hooks/package.json': '{"type": "module"}\n',
  };
  for (const [k, v] of Object.entries(files)) put(kit, k, v);
  for (const f of ['ask-log.js', 'kit-hook.cjs']) put(kit, `subagent-system/hooks/${f}`, fs.readFileSync(path.join(KIT_ROOT, 'hooks', f), 'utf8'));
  for (const f of fs.readdirSync(SCRIPTS)) if (/\.(c?js|json)$/.test(f)) put(kit, `subagent-system/scripts/${f}`, fs.readFileSync(path.join(SCRIPTS, f), 'utf8'));
  // git 훅은 이어 부르는 sh 둘과 조각 전체를 실제 키트 것 그대로 복사한다(pre-commit이 git-dispatch.cjs와 조각을 부르므로 한 벌이 모두 있어야 돈다).
  fs.cpSync(path.join(KIT_ROOT, 'hooks', 'git'), path.join(kit, 'subagent-system/hooks/git'), { recursive: true });
  for (const f of ['commit-msg', 'pre-commit']) fs.chmodSync(path.join(kit, 'subagent-system/hooks/git', f), 0o755);
  writeDefinitions(kit);
  gitOk(kit, 'init', '-q');
  commitAll(kit, 'init');
  ok(kitRun(cfg, ['install', '--kit', kit, '--profile', 'personal', '--bundles', 'routing,company', '--options', 'none']));
  const cfgFile = path.join(cfg, 'subagent-system/config.json');
  const config = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  if (kitSourcePath) config.kitSourcePath = kit;
  config.personalMarkers = ['Demo-Proj'];
  fs.writeFileSync(cfgFile, `${JSON.stringify(config, null, 2)}\n`);
  return { kit, cfg };
}
const diff = (cfg) => ok(kitRun(cfg, ['diff', '--json']));
const statusOf = (d, key) => d.files.find((f) => f.key === key)?.status ?? 'same';
const GUIDE = 'subagent-system/docs/SUBAGENT_GUIDE.md';
const CHECKLIST = 'subagent-system/docs/SUBAGENT_BRIEF_CHECKLIST.md';

describe('kit-setup.js diff', { skip: SKIP }, () => {
  it('막 설치한 설치본은 임시 설정 폴더에서도 모두 같음이고(경로 치환을 원본 글에도 입힘) 설치 값 파일을 따로 보인다', () => {
    const { cfg } = setup();
    assert.match(get(cfg, GUIDE), new RegExp(`경로 ${cfg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/x`));
    const d = diff(cfg);
    assert.equal(d.counts.same > 8, true);
    for (const k of ['kit-ahead', 'installed-zone', 'installed-only', 'both', 'kit-only']) assert.equal(d.counts[k], 0, k);
    assert.deepEqual(d.files, []);
    assert.ok(d.installValues.includes('subagent-system/docs/ROUTING_TABLE.md'));
    assert.ok(d.installValues.includes('subagent-system/rates.json'));
  });

  it('칸을 가른다: 키트가 앞섬, 설치본만 고침(밖, 개인 표지), 둘 다 고침, 키트에만 있음, 설치본에만 있음', () => {
    const { kit, cfg } = setup();
    put(kit, 'subagent-system/docs/RETRO.md', '# 회고\n\n새 내용\n');
    put(kit, 'subagent-system/scripts/newTool.js', 'export const n = 1;\n');
    put(kit, GUIDE, '# 가이드\n\n줄1 키트\n줄2\n경로 ~/.claude/x\n');
    commitAll(kit, 'kit moves');
    put(cfg, 'subagent-system/docs/SUBAGENT_SITUATIONS.md', '# 상황별\n\n줄\nDemo-Proj 사례 줄\n');
    put(cfg, GUIDE, `# 가이드\n\n줄1\n줄2 설치\n경로 ${cfg}/x\n`);
    put(cfg, 'hooks/mine.js', '// 일반 장치\n');
    const d = diff(cfg);
    assert.equal(statusOf(d, 'subagent-system/docs/RETRO.md'), 'kit-ahead');
    assert.equal(statusOf(d, 'subagent-system/docs/SUBAGENT_SITUATIONS.md'), 'installed-only');
    assert.deepEqual(d.files.find((f) => f.key.endsWith('SUBAGENT_SITUATIONS.md')).markers, ['Demo-Proj']);
    assert.equal(statusOf(d, GUIDE), 'both');
    assert.equal(statusOf(d, 'subagent-system/scripts/newTool.js'), 'kit-only');
    assert.deepEqual(d.installedExtra, ['hooks/mine.js']);
    const text = kitRun(cfg, ['diff']).stdout;
    assert.match(text, /설치본만 고침\(설치 값 자리 밖, 키트로 올릴 후보\): 1/);
    assert.match(text, /\[개인 표지: Demo-Proj\]/);
  });

  it('설치 값 자리(체크리스트의 이 설치에서 더한 줄 절, 정의 description)만 다르면 설치본만 고침(설치 값 자리 안)이다', () => {
    const { cfg } = setup();
    fs.appendFileSync(path.join(cfg, CHECKLIST), '\n## 이 설치에서 더한 줄\n\n### 절\n\n| 이 설치 줄 | 이유 |\n');
    put(cfg, 'agents/opus-high.md', DEF('opus-high', `놓쳐도 신호가 없는 일. 내 일 이름. (${GUIDE_PATH})`));
    const d = diff(cfg);
    assert.equal(statusOf(d, CHECKLIST), 'installed-zone');
    assert.equal(statusOf(d, 'agents/opus-high.md'), 'installed-zone');
    assert.equal(d.counts['installed-only'], 0);
  });

  it('정의 description의 첫 문장은 키트 몫이라 키트가 고치면 키트가 앞섬, 설치본이 고치면 올릴 후보이고, 승급 전용 정의는 줄 전체가 키트 몫이다', async () => {
    const K = await import('../kitDrift.js');
    const base = DEF('opus-high', `놓쳐도 신호가 없는 일. 설계 검토. (${GUIDE_PATH})`);
    const inst = DEF('opus-high', `놓쳐도 신호가 없는 일. 내 일. (${GUIDE_PATH})`);
    const kitNew = DEF('opus-high', `새 첫 문장. 설계 검토. (${GUIDE_PATH})`);
    assert.equal(K.classifyFile({ key: 'agents/opus-high.md', installed: inst, base, kit: kitNew }).status, 'kit-ahead');
    assert.match(K.overlayZones('agents/opus-high.md', kitNew, inst), /description: 새 첫 문장\. 내 일\./);
    assert.equal(K.classifyFile({ key: 'agents/opus-high.md', installed: DEF('opus-high', `내가 고친 첫 문장. 내 일. (${GUIDE_PATH})`), base, kit: base }).status, 'installed-only');
    const x = DEF('opus-xhigh', `다시 보낼 때만 쓰는 정의. 그 밖에는 안 부른다. (${GUIDE_PATH})`);
    assert.equal(K.classifyFile({ key: 'agents/opus-xhigh.md', installed: x.replace('다시 보낼', '보낼'), base: x, kit: x }).status, 'installed-only');
  });

  it('커밋하지 않은 원본 고침은 보지 않는다(HEAD를 읽음)', () => {
    const { kit, cfg } = setup();
    put(kit, 'subagent-system/docs/RETRO.md', '# 회고\n\n커밋 안 한 고침\n');
    assert.deepEqual(diff(cfg).files, []);
  });

  it('아무것도 쓰지 않는다', () => {
    const { cfg } = setup();
    put(cfg, 'subagent-system/docs/RETRO.md', '# 회고\n\n고침\n');
    const before = get(cfg, 'subagent-system/docs/RETRO.md');
    const baseBefore = get(cfg, 'subagent-system/.kit-base/subagent-system/docs/RETRO.md');
    kitRun(cfg, ['diff']);
    assert.equal(get(cfg, 'subagent-system/docs/RETRO.md'), before);
    assert.equal(get(cfg, 'subagent-system/.kit-base/subagent-system/docs/RETRO.md'), baseBefore);
  });
});

describe('kit-setup.js sync', { skip: SKIP }, () => {
  it('kitSourcePath가 없으면 거절하고 아무것도 바꾸지 않는다', () => {
    const { cfg } = setup({ kitSourcePath: false });
    const r = kitRun(cfg, ['sync']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /kitSourcePath/);
  });

  it('원본 HEAD로 키트 파일을 덮고 기준본을 새로 쓰며 설치 값 자리와 config, VERSION은 지킨다', () => {
    const { kit, cfg } = setup();
    put(kit, 'subagent-system/docs/RETRO.md', '# 회고\n\n새 내용 ~/.claude/y\n');
    put(kit, CHECKLIST, '# 체크리스트\n\n| 지킬 것 | 이유 |\n|:---|:---|\n| 목표 줄 | 방향 |\n| 키트 새 줄 | 이유 |\n');
    put(kit, 'subagent-system/agents/opus-high.md', DEF('opus-high', `키트 새 첫 문장. 설계 검토. (${GUIDE_PATH})`));
    commitAll(kit, 'kit moves');
    fs.appendFileSync(path.join(cfg, CHECKLIST), '\n## 이 설치에서 더한 줄\n\n| 이 설치 줄 | 이유 |\n');
    put(cfg, 'agents/opus-high.md', DEF('opus-high', `놓쳐도 신호가 없는 일. 내 일 이름. (${GUIDE_PATH})`));
    put(cfg, 'subagent-system/docs/SUBAGENT_SITUATIONS.md', '# 상황별\n\n개인 고침\n');
    const configBefore = get(cfg, 'subagent-system/config.json');
    const r = ok(kitRun(cfg, ['sync']));
    assert.equal(get(cfg, 'subagent-system/docs/RETRO.md'), `# 회고\n\n새 내용 ${cfg}/y\n`);
    assert.equal(get(cfg, 'subagent-system/docs/SUBAGENT_SITUATIONS.md'), '# 상황별\n\n줄\n');
    const checklist = get(cfg, CHECKLIST);
    assert.match(checklist, /키트 새 줄/);
    assert.match(checklist, /## 이 설치에서 더한 줄[\s\S]*이 설치 줄/);
    const def = get(cfg, 'agents/opus-high.md');
    // 첫 문장은 키트 것, 일 이름 나열은 설치본 것(설치본 검수 4회차 6번)
    assert.match(def, /description: 키트 새 첫 문장\. 내 일 이름\./);
    assert.equal(get(cfg, 'subagent-system/.kit-base/subagent-system/docs/RETRO.md'), `# 회고\n\n새 내용 ${cfg}/y\n`);
    assert.equal(get(cfg, 'subagent-system/config.json'), configBefore);
    assert.equal(get(cfg, 'subagent-system/VERSION'), '2026.11.1\n');
    assert.ok(r.counts.overwritten >= 3);
    const after = diff(cfg);
    assert.equal(after.counts['installed-only'] + after.counts.both + after.counts['kit-ahead'], 0);
    assert.equal(after.counts['installed-zone'], 2);
  });

  it('설치본이 git 저장소이고 파일이 깨끗하면 백업하지 않고, 아니면 고치기 전 파일을 옆에 백업한다', () => {
    const { kit, cfg } = setup();
    put(kit, 'subagent-system/docs/RETRO.md', '# 회고\n\n새 내용\n');
    commitAll(kit, 'kit moves');
    put(cfg, 'subagent-system/docs/SUBAGENT_SITUATIONS.md', '# 상황별\n\n고침 A\n');
    const r = ok(kitRun(cfg, ['sync']));
    const baks = (dir) => fs.readdirSync(dir).filter((n) => n.includes('.bak-sync-'));
    assert.equal(baks(path.join(cfg, 'subagent-system/docs')).length, 1, '고친 파일은 백업');
    assert.equal(r.files.find((f) => f.key.endsWith('RETRO.md')).backup, undefined, '기준본과 같던 파일은 백업 없음');

    const { kit: kit2, cfg: cfg2 } = setup();
    gitOk(cfg2, 'init', '-q');
    commitAll(cfg2, 'installed');
    put(kit2, 'subagent-system/docs/SUBAGENT_SITUATIONS.md', '# 상황별\n\n키트 줄\n');
    commitAll(kit2, 'kit moves');
    put(cfg2, 'subagent-system/docs/SUBAGENT_SITUATIONS.md', '# 상황별\n\n고침 B\n');
    commitAll(cfg2, 'installed edit');
    ok(kitRun(cfg2, ['sync']));
    assert.equal(baks(path.join(cfg2, 'subagent-system/docs')).length, 0, '깨끗한 git 추적 파일은 백업 없음');
    assert.equal(get(cfg2, 'subagent-system/docs/SUBAGENT_SITUATIONS.md'), '# 상황별\n\n키트 줄\n');
  });

  it('--dry-run은 아무것도 쓰지 않는다', () => {
    const { kit, cfg } = setup();
    put(kit, 'subagent-system/docs/RETRO.md', '# 회고\n\n새 내용\n');
    commitAll(kit, 'kit moves');
    const r = ok(kitRun(cfg, ['sync', '--dry-run']));
    assert.equal(r.dryRun, true);
    assert.equal(r.counts.overwritten, 1);
    assert.equal(get(cfg, 'subagent-system/docs/RETRO.md'), '# 회고\n\n내용\n');
    assert.equal(get(cfg, 'subagent-system/.kit-base/subagent-system/docs/RETRO.md'), '# 회고\n\n내용\n');
  });
});

describe('키트에서 지운 파일(diff, sync, check-staged)', { skip: SKIP }, () => {
  // 설치본 검수 6회차 5, 6번: 키트에서 지운 파일을 diff가 「설치본에만 있음」으로 보이고 sync가 남겼으며, 커밋 검사는 지운 파일을 보지 않았다.
  const gone = (kit) => {
    fs.rmSync(path.join(kit, 'subagent-system/docs/SUBAGENT_SITUATIONS.md'));
    fs.rmSync(path.join(kit, 'subagent-system/agents/opus-high.md'));
    commitAll(kit, 'remove');
  };

  it('diff는 키트에서 지운 파일을 따로 보이고 설치본에만 있음에 넣지 않는다', () => {
    const { kit, cfg } = setup();
    gone(kit);
    const d = diff(cfg);
    assert.deepEqual([...d.kitRemoved].sort(), ['agents/opus-high.md', 'subagent-system/docs/SUBAGENT_SITUATIONS.md']);
    assert.equal(d.counts['kit-removed'], 2);
    assert.ok(!d.installedExtra.includes('subagent-system/docs/SUBAGENT_SITUATIONS.md'));
    assert.match(kitRun(cfg, ['diff']).stdout, /키트에서 지움[^\n]*: 2/);
  });

  it('sync는 손대지 않은 것(설치 값 자리만 고친 것 포함)을 지우고 기준본에서 빼며, 고친 것은 남기고 계속 알린다', () => {
    const { kit, cfg } = setup();
    gone(kit);
    put(cfg, 'agents/opus-high.md', DEF('opus-high', `놓쳐도 신호가 없는 일. 내 일 이름. (${GUIDE_PATH})`));
    put(cfg, 'subagent-system/docs/SUBAGENT_SITUATIONS.md', '# 상황별\n\n개인 고침\n');
    const r = ok(kitRun(cfg, ['sync']));
    assert.deepEqual(r.orphansRemoved, ['agents/opus-high.md']);
    assert.deepEqual(r.orphansKept, ['subagent-system/docs/SUBAGENT_SITUATIONS.md']);
    assert.ok(!fs.existsSync(path.join(cfg, 'agents/opus-high.md')));
    assert.ok(fs.existsSync(path.join(cfg, 'subagent-system/docs/SUBAGENT_SITUATIONS.md')));
    assert.ok(!fs.existsSync(path.join(cfg, 'subagent-system/.kit-base/agents/opus-high.md')));
    const after = diff(cfg);
    // 고쳐서 남긴 것은 update와 같이 기준본에 두어, 지울지 설치본 것으로 둘지 사람이 정할 때까지 diff가 계속 알린다.
    assert.deepEqual(after.kitRemoved, ['subagent-system/docs/SUBAGENT_SITUATIONS.md']);
  });

  it('sync --dry-run은 지우지 않는다', () => {
    const { kit, cfg } = setup();
    gone(kit);
    const r = ok(kitRun(cfg, ['sync', '--dry-run']));
    assert.equal(r.orphansRemoved.length, 2);
    assert.ok(fs.existsSync(path.join(cfg, 'agents/opus-high.md')));
  });

  it('check-staged는 키트가 놓는 파일을 지우거나 이름을 바꾸는 커밋을 막고, removedDefs에 적은 정의를 빼는 것은 통과시킨다', () => {
    const { cfg } = setup();
    gitOk(cfg, 'init', '-q');
    gitOk(cfg, 'config', 'core.hooksPath', path.join(cfg, 'subagent-system/hooks/git'));
    commitAll(cfg, 'installed');
    const commit = () => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'x'], { cwd: cfg, env: { ...gitEnv(), CLAUDE_CONFIG_DIR: cfg }, encoding: 'utf8' });
    fs.rmSync(path.join(cfg, 'subagent-system/docs/RETRO.md'));
    gitOk(cfg, 'add', '-A');
    const r = commit();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /subagent-system\/docs\/RETRO\.md \(지움\)/);
    gitOk(cfg, 'reset', '-q', 'HEAD', '--', 'subagent-system/docs/RETRO.md');
    git(cfg, 'checkout', '--', 'subagent-system/docs/RETRO.md');
    // 이름 바꿈의 옛 이름도 지움으로 막는다(7회차 5번)
    gitOk(cfg, 'mv', 'rules/kit-core.md', 'rules/kit-core-old.md');
    const rn = commit();
    assert.equal(rn.status, 1);
    assert.match(rn.stderr, /rules\/kit-core\.md \(지움\)/);
    gitOk(cfg, 'mv', 'rules/kit-core-old.md', 'rules/kit-core.md');
    fs.rmSync(path.join(cfg, 'agents/opus-xhigh.md'));
    const cfgFile = path.join(cfg, 'subagent-system/config.json');
    const config = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
    config.removedDefs = ['opus-xhigh'];
    fs.writeFileSync(cfgFile, `${JSON.stringify(config, null, 2)}\n`);
    gitOk(cfg, 'add', '-A');
    const r2 = commit();
    assert.equal(r2.status, 0, r2.stderr);
  });
});

describe('파일 생애 변화 표(키트 쪽 더함, 고침, 지움, 이름 바꿈 × diff, sync / 설치본 쪽 커밋)', { skip: SKIP }, () => {
  // 설치본 검수 6~8회차에 지움, 이름 바꿈, 형식 바꿈, 키트가 앞선 파일의 설치 값 고침이 한 회차에 하나씩 나왔다. 변화마다 한 칸씩 한 시험에서 함께 본다.
  it('키트 쪽 변화: 더함은 깔고, 고침은 덮고, 지움은 치우고, 고른 규칙의 이름 바꿈은 새 이름으로 잇는다', () => {
    const { kit, cfg } = setup();
    put(kit, 'subagent-system/rules/kit-rec-a.md', '- 권장 규칙 a\n');
    commitAll(kit, 'optional rule');
    ok(kitRun(cfg, ['add', '--bundles', 'company', '--options', 'company.rec', '--kit', kit]));
    assert.ok(fs.existsSync(path.join(cfg, 'rules/kit-rec-a.md')));
    put(kit, 'subagent-system/docs/NEW_DOC.md', '# 새 문서\n');
    put(kit, 'subagent-system/docs/RETRO.md', '# 회고\n\n키트 고침\n');
    fs.rmSync(path.join(kit, 'subagent-system/docs/SUBAGENT_SITUATIONS.md'));
    gitOk(kit, 'add', '-A');
    gitOk(kit, 'commit', '-q', '-m', 'add modify delete');
    gitOk(kit, 'mv', 'subagent-system/rules/kit-rec-a.md', 'subagent-system/rules/kit-rec-b.md');
    gitOk(kit, 'commit', '-q', '-m', 'rename');
    const d = diff(cfg);
    assert.deepEqual(d.kitRenamed, [{ from: 'rules/kit-rec-a.md', to: 'rules/kit-rec-b.md' }]);
    assert.ok(d.kitRemoved.includes('subagent-system/docs/SUBAGENT_SITUATIONS.md'));
    assert.equal(statusOf(d, 'subagent-system/docs/RETRO.md'), 'kit-ahead');
    const r = ok(kitRun(cfg, ['sync']));
    // 묶음 정의가 새 이름을 이미 가리키므로 새 이름은 보통 설치 경로로 깔리고, 이름 바꿈 잇기(renamed)는 정의 밖에서 이름이 바뀐 경우에만 쓰인다.
    assert.deepEqual(r.renamed, []);
    assert.equal(get(cfg, 'rules/kit-rec-b.md'), '- 권장 규칙 a\n');
    assert.ok(!fs.existsSync(path.join(cfg, 'rules/kit-rec-a.md')));
    assert.ok(!fs.existsSync(path.join(cfg, 'subagent-system/docs/SUBAGENT_SITUATIONS.md')));
    assert.match(get(cfg, 'subagent-system/docs/RETRO.md'), /키트 고침/);
    const after = diff(cfg);
    assert.equal(after.counts['kit-removed'] + after.counts['kit-ahead'] + after.counts['kit-only'], 0, JSON.stringify(after.counts));
    assert.equal(statusOf(after, 'rules/kit-rec-b.md'), 'same');
  });

  it('설치본 쪽 커밋: 키트 몫 고침, 지움, 이름 바꿈은 막고, 설치 값 자리만 고친 것은 키트가 앞선 파일이어도 통과하며, 키트가 앞선 파일을 막을 때는 sync를 먼저 하라고 알린다', () => {
    const { kit, cfg } = setup();
    gitOk(cfg, 'init', '-q');
    gitOk(cfg, 'config', 'core.hooksPath', path.join(cfg, 'subagent-system/hooks/git'));
    commitAll(cfg, 'installed');
    const commit = () => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'x'], { cwd: cfg, env: { ...gitEnv(), CLAUDE_CONFIG_DIR: cfg }, encoding: 'utf8' });
    // 키트가 정의 본문을 앞서 고친 상태
    put(kit, 'subagent-system/agents/opus-high.md', DEF('opus-high', `놓쳐도 신호가 없는 일. 설계 검토. (${GUIDE_PATH})`).replace('본문', '키트 새 본문'));
    commitAll(kit, 'kit ahead');
    // 설치 값 자리(일 이름)만 고침 → 통과
    put(cfg, 'agents/opus-high.md', DEF('opus-high', `놓쳐도 신호가 없는 일. 내 일 이름. (${GUIDE_PATH})`));
    gitOk(cfg, 'add', '-A');
    const z = commit();
    assert.equal(z.status, 0, z.stderr);
    // 키트 몫(본문)을 고침 → 막고 sync 먼저
    put(cfg, 'agents/opus-high.md', DEF('opus-high', `놓쳐도 신호가 없는 일. 내 일 이름. (${GUIDE_PATH})`).replace('본문', '설치본 본문'));
    gitOk(cfg, 'add', '-A');
    const b = commit();
    assert.equal(b.status, 1);
    assert.match(b.stderr, /agents\/opus-high\.md \(키트가 앞섬: 먼저 kit-setup\.js sync\)/);
  });

  it('권한 변화: 내용은 같고 git 훅의 실행 권한만 빠지면 diff가 알리고 sync와 update가 되살리며, 권한을 뺀 커밋은 막는다', { skip: process.platform === 'win32' }, () => {
    const { kit, cfg } = setup();
    const hook = path.join(cfg, 'subagent-system/hooks/git/pre-commit');
    const key = 'subagent-system/hooks/git/pre-commit';
    fs.chmodSync(hook, 0o644);
    assert.deepEqual(diff(cfg).execMissing, [key]);
    const r = ok(kitRun(cfg, ['sync']));
    assert.deepEqual(r.execRestored, [key]);
    assert.ok(fs.statSync(hook).mode & 0o100);
    assert.deepEqual(diff(cfg).execMissing, []);
    fs.chmodSync(hook, 0o644);
    ok(kitRun(cfg, ['update', '--kit', kit]));
    assert.ok(fs.statSync(hook).mode & 0o100, 'update도 되살림');
    // 설치본 쪽 커밋: 권한만 뺀 커밋을 막는다
    gitOk(cfg, 'init', '-q');
    gitOk(cfg, 'config', 'core.hooksPath', path.join(cfg, 'subagent-system/hooks/git'));
    commitAll(cfg, 'installed');
    gitOk(cfg, 'update-index', '--chmod=-x', key);
    const c = spawnSync(process.execPath, [KIT_SETUP, 'check-staged'], { cwd: cfg, env: { ...gitEnv(), CLAUDE_CONFIG_DIR: cfg }, encoding: 'utf8' });
    assert.equal(c.status, 1);
    assert.match(c.stderr, /pre-commit \(실행 권한 빠짐\)/);
  });
});

describe('kit-setup.js descriptions와 update의 description', { skip: SKIP }, () => {
  const table = (cfg, text) => put(cfg, 'subagent-system/docs/ROUTING_TABLE.md', text);

  it('표의 일 이름으로 description을 만들고 첫 문장과 가이드 경로, 기존 괄호 부연은 지키며 승급 전용 정의는 건너뛴다', () => {
    const { cfg } = setup();
    put(cfg, 'agents/opus-high.md', DEF('opus-high', `놓쳐도 신호가 없는 일. 원인 찾기(이슈 분석), 옛 일. (${GUIDE_PATH})`));
    table(cfg, TABLE);
    const r = ok(kitRun(cfg, ['descriptions']));
    assert.deepEqual(r.updated, ['opus-high']);
    assert.match(get(cfg, 'agents/opus-high.md'), /^description: 놓쳐도 신호가 없는 일\. 설계 검토, 원인 찾기\(이슈 분석\)\. \(`.*SUBAGENT_GUIDE\.md`\)$/m);
    assert.match(get(cfg, 'agents/opus-xhigh.md'), /올려 보낸 일만 받는다/);
    assert.deepEqual(ok(kitRun(cfg, ['descriptions'])).updated, [], '다시 돌려도 그대로');
  });

  it('YAML을 깨는 글자(: )가 든 일 이름은 큰따옴표로 감싸고 설명 줄만 바꾼다', () => {
    const { cfg } = setup();
    table(cfg, TABLE.replace('설계 검토', '검토: 설계'));
    const before = get(cfg, 'agents/opus-high.md');
    const r = ok(kitRun(cfg, ['descriptions', '--dry-run']));
    assert.deepEqual(r.updated, ['opus-high']);
    assert.equal(get(cfg, 'agents/opus-high.md'), before, 'dry-run은 쓰지 않음');
    ok(kitRun(cfg, ['descriptions']));
    const line = get(cfg, 'agents/opus-high.md').split('\n').find((l) => l.startsWith('description:'));
    assert.match(line, /^description: ".*검토: 설계.*"$/);
    assert.match(get(cfg, 'agents/opus-high.md'), /\nmodel: opus\n---\n\n본문\n$/);
  });

  it('update는 표에서 description을 다시 만들어 키트 description과 병합 충돌이 나지 않고 알린다', () => {
    const { kit, cfg } = setup();
    table(cfg, TABLE);
    put(cfg, 'agents/opus-high.md', DEF('opus-high', `놓쳐도 신호가 없는 일. 내 일 이름. (${GUIDE_PATH})`));
    put(kit, 'subagent-system/agents/opus-high.md', `${DEF('opus-high', `키트 새 첫 문장. 설계 검토. (${GUIDE_PATH})`)}키트 추가 줄\n`);
    put(kit, 'subagent-system/VERSION', '2026.11.2\n');
    commitAll(kit, 'kit moves');
    const r = ok(kitRun(cfg, ['update', '--kit', kit]));
    assert.deepEqual(r.conflictFiles, []);
    const def = get(cfg, 'agents/opus-high.md');
    assert.match(def, /^description: 키트 새 첫 문장\. 설계 검토, 원인 찾기\. /m);
    assert.match(def, /키트 추가 줄/);
    assert.match(r.notes.join('\n'), /description을 라우팅 표에서 다시 만들었습니다/);
    assert.equal(fs.readdirSync(path.join(cfg, 'agents')).filter((n) => n.includes('.bak-')).length, 0);
  });
});

describe('커밋 때 검사(pre-commit과 kit-setup.js check-staged)', { skip: SKIP }, () => {
  const hooks = (cfg) => path.join(cfg, 'subagent-system/hooks/git');
  const commit = (cfg, env = {}) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'x'], { cwd: cfg, env: { ...gitEnv(), CLAUDE_CONFIG_DIR: cfg, ...env }, encoding: 'utf8' });
  const armed = (opts) => {
    const s = setup(opts);
    gitOk(s.cfg, 'init', '-q');
    gitOk(s.cfg, 'config', 'core.hooksPath', hooks(s.cfg));
    commitAll(s.cfg, 'installed'); // 훅이 걸린 첫 커밋도 키트가 놓은 그대로라 통과해야 한다
    return s;
  };

  it('설치한 그대로의 커밋은 통과한다', () => {
    const { cfg } = armed();
    put(cfg, 'notes.md', '메모\n');
    gitOk(cfg, 'add', '-A');
    assert.equal(commit(cfg).status, 0);
  });

  it('키트가 놓은 파일을 원본과 다르게 올리면 막고 막음 글과 건너뛸 환경 변수를 알린다', () => {
    const { cfg } = armed();
    put(cfg, 'subagent-system/docs/RETRO.md', '# 회고\n\n이 설치에서만 고침\n');
    gitOk(cfg, 'add', '-A');
    const r = commit(cfg);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /subagent-system\/docs\/RETRO\.md/);
    assert.match(r.stderr, /원본\(kitSourcePath\)에 같은 고침을 커밋한 뒤 kit-setup\.js sync/);
    assert.match(r.stderr, /설치 값 자리/);
    assert.match(r.stderr, /KIT_DRIFT_SKIP=1/);
    assert.equal(commit(cfg, { KIT_DRIFT_SKIP: '1' }).status, 0, '환경 변수로 한 번 건너뜀');
  });

  it('원본에 같은 고침을 커밋하면 통과하고, 설치 값 자리(체크리스트 절, 정의 description)만 고친 것도 통과한다', () => {
    const { kit, cfg } = armed();
    put(cfg, 'subagent-system/docs/RETRO.md', '# 회고\n\n공통 고침\n');
    gitOk(cfg, 'add', '-A');
    assert.equal(commit(cfg).status, 1);
    put(kit, 'subagent-system/docs/RETRO.md', '# 회고\n\n공통 고침\n');
    commitAll(kit, 'same fix');
    assert.equal(commit(cfg).status, 0);
    fs.appendFileSync(path.join(cfg, CHECKLIST), '\n## 이 설치에서 더한 줄\n\n| 이 설치 줄 | 이유 |\n');
    put(cfg, 'agents/opus-high.md', DEF('opus-high', `놓쳐도 신호가 없는 일. 내 일 이름. (${GUIDE_PATH})`));
    gitOk(cfg, 'add', '-A');
    assert.equal(commit(cfg).status, 0);
  });

  it('U3-15 kitSourcePath가 있으면 고정 파일을 원본과 다르게 올린 커밋이 막히고, 없으면 성공하며, 로컬 조각 파일만 바꾼 커밋은 막히지 않는다', () => {
    const withPath = armed();
    put(withPath.cfg, 'subagent-system/local-bundles/demo-local/bundle.json', JSON.stringify(bundleDef('demo-local', 90)));
    put(withPath.cfg, 'subagent-system/local-bundles/demo-local/guard.part.json', '{"bundle":"demo-local","part":"guard","files":["hooks/demo-guard.py"],"hooks":[]}\n');
    put(withPath.cfg, 'hooks/demo-guard.py', 'print(1)\n');
    gitOk(withPath.cfg, 'add', '-A');
    assert.equal(commit(withPath.cfg).status, 0, '로컬 조각 파일만 바꾼 커밋');
    put(withPath.cfg, 'subagent-system/docs/RETRO.md', '# 회고\n\n이 설치에서만 고침\n');
    gitOk(withPath.cfg, 'add', '-A');
    const blocked = commit(withPath.cfg);
    assert.equal(blocked.status, 1);
    assert.match(blocked.stderr, /subagent-system\/docs\/RETRO\.md/);

    const noPath = armed({ kitSourcePath: false });
    put(noPath.cfg, 'subagent-system/docs/RETRO.md', '# 회고\n\n이 설치에서만 고침\n');
    gitOk(noPath.cfg, 'add', '-A');
    assert.equal(commit(noPath.cfg).status, 0);
  });

  it('kitSourcePath가 없는 설치와 설치본이 아닌 저장소의 커밋은 검사하지 않는다', () => {
    const { cfg } = armed({ kitSourcePath: false });
    put(cfg, 'subagent-system/docs/RETRO.md', '# 회고\n\n고침\n');
    gitOk(cfg, 'add', '-A');
    assert.equal(commit(cfg).status, 0);

    const armed2 = armed();
    const other = tmp();
    gitOk(other, 'init', '-q');
    gitOk(other, 'config', 'core.hooksPath', hooks(armed2.cfg));
    put(other, 'subagent-system/docs/RETRO.md', '다른 저장소\n');
    gitOk(other, 'add', '-A');
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'o'], { cwd: other, env: { ...gitEnv(), CLAUDE_CONFIG_DIR: armed2.cfg }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  });
});
