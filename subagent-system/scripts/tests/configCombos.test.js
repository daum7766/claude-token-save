import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const SUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RETRO = path.join(SUB, 'scripts', 'subagent-retro.js');
const HOOK = path.join(SUB, 'hooks', 'git', 'commit-msg');
const HAS_GIT = spawnSync('git', ['--version']).status === 0;
// commit-msg 훅은 설치 때 고르는 선택 훅이라 고르지 않은 설치본에는 파일이 없다. 없으면 커밋 검사 훅 단언은 건너뛴다.
const HAS_HOOK = fs.existsSync(HOOK);
for (const k of Object.keys(process.env)) if (k.startsWith('SUBAGENT_')) delete process.env[k];

// 설정 조합을 한 표로 훑는 시험이다. 기대값은 APPLY_GUIDE 「개인용과 회사용」 표와 RETRO 「누가 회고하고 언제 하나」에서 가져온다.
// 무엇을 묻는지(물을 것 세기, 바로 고치기, 애매할 때 문턱)는 profile 하나가, 회고를 언제 누가 돌리는지(--due 첫 줄, --snooze)는 retroMode가 정한다.
const DEFAULTS = {
  personal: { retroWriteAllow: true, commitCheck: 'block' },
  company: { retroWriteAllow: false, commitCheck: 'off' },
};
// 옛 설치가 남긴 판정 키다. 읽지 않으므로 profile과 반대 값을 넣어도 결과가 같아야 한다.
const RETIRED = {
  personal: { autoApplyRules: false, autoCreate: false, actThreshold: 'low-cost-only', methodCommit: 'report' },
  company: { autoApplyRules: true, autoCreate: true, actThreshold: 'ambiguous-rule', methodCommit: 'commit-message' },
};
const PROPOSALS = ['## 제안', '', '### 요율 더하기', '- 얻는 것: x', '### 정책 바꾸기', '- 묻기: 정책', '### 문지기 풀기', '- 묻기: 문지기 풀기', ''].join('\n');
const USAGE = Array.from({ length: 30 }, (_, i) => `2026-10-12\t/p\tsonnet-low\t번역\t1\t2\t3\tok\ta${i} 줄`).join('\n') + '\n';

const PERSONAL = { pending: 2, scope: '사용자에게 묻는 여섯 종만', applyRules: '켬 (profile이 정함)', threshold: '작으면 하고 알림 (profile이 정함)', slashAsk: '받지 않음' };
const COMPANY = { pending: 3, scope: '제안 목록 전부', applyRules: '끔 (profile이 정함)', threshold: '되돌리는 비용이 거의 없는 것만 하고 나머지는 묻기 (profile이 정함)', slashAsk: '받음' };
// 행: 설정 조합과 그 조합에서 문서가 말하는 값. 빠진 키와 옛 판정 키가 남은 행도 기대값은 같다.
// commitCheck만 예외라 hookBlocks는 키가 없으면 true(APPLY_GUIDE: commit-msg 훅은 키가 없으면 검사함)다.
const ROWS = [];
for (const [profile, kind] of [['personal', PERSONAL], ['company', COMPANY]]) {
  for (const retroMode of ['auto', 'ask']) {
    const common = { profile, retroMode, ...kind, due: retroMode, snooze: retroMode === 'ask' ? '받음' : '받지 않음' };
    const blocks = profile === 'personal';
    ROWS.push({ ...common, missing: null, hookBlocks: blocks });
    ROWS.push({ ...common, missing: 'commitCheck', hookBlocks: true });
    ROWS.push({ ...common, missing: null, withRetired: true, hookBlocks: blocks });
  }
}
// profile이 없는 업데이트 전 설치본은 retroMode가 무엇이든 회사용으로 본다(회고 방식 retroMode는 그 값대로 돈다). 판정 키는 retroMode뿐인 설정이다.
for (const retroMode of ['auto', 'ask']) {
  ROWS.push({ profile: 'profile 없음', config: 'noProfile', retroMode, missing: null, ...COMPANY, due: retroMode, snooze: retroMode === 'ask' ? '받음' : '받지 않음', hookBlocks: true });
}
// 설정 파일이 없거나 깨졌으면 회사용 묻기로 보고, 규칙은 고치지 않으며, 훅은 검사한다.
ROWS.push({ profile: '파일 없음', config: 'absent', retroMode: 'ask', missing: null, ...COMPANY, due: 'ask', snooze: '받음', hookBlocks: true });
ROWS.push({ profile: '깨진 파일', config: 'broken', retroMode: 'ask', missing: null, ...COMPANY, due: 'ask', snooze: '받음', hookBlocks: true });

const configOf = (row) => {
  if (row.config === 'absent') return null;
  if (row.config === 'broken') return '{깨짐';
  if (row.config === 'noProfile') return JSON.stringify({ retroMode: row.retroMode }, null, 2);
  const o = { profile: row.profile, retroMode: row.retroMode, ...DEFAULTS[row.profile], ...(row.withRetired ? RETIRED[row.profile] : {}) };
  if (row.missing) delete o[row.missing];
  return JSON.stringify(o, null, 2);
};

// 한 행의 설정으로 스크립트와 훅을 돌려 문서가 말하는 값에 해당하는 것만 모은다. repo가 true면 설정 폴더를 git 저장소로 만든다.
function observe(row, { repo = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'config-combo-'));
  const claude = path.join(root, 'claude');
  fs.mkdirSync(claude);
  if (repo) assert.equal(spawnSync('git', ['init', '-q'], { cwd: claude }).status, 0);
  const files = { dir: path.join(root, 'records'), config: path.join(root, 'config.json'), proposals: path.join(root, 'PROPOSALS.md') };
  const usage = path.join(files.dir, 'subagent-usage.tsv');
  fs.mkdirSync(files.dir);
  fs.writeFileSync(usage, USAGE);
  fs.writeFileSync(files.proposals, PROPOSALS);
  const writeConfig = () => {
    const text = configOf(row);
    if (text === null) fs.rmSync(files.config, { force: true });
    else fs.writeFileSync(files.config, text);
  };
  const run = (args) => {
    writeConfig();
    return spawnSync(process.execPath, [RETRO, ...args], {
      env: { ...process.env, SUBAGENT_RECORDS_DIR: files.dir, SUBAGENT_CONFIG_FILE: files.config, SUBAGENT_PROPOSALS_FILE: files.proposals, SUBAGENT_TODAY: '2026-10-13', CLAUDE_CONFIG_DIR: claude },
      encoding: 'utf8',
    }).stdout;
  };
  const decide = (out, yes, no) => (no.test(out) ? '받지 않음' : yes.test(out) ? '받음' : `알 수 없음: ${out.trim()}`);

  const due = run(['--due']).trim().split('\n');
  const status = run(['--status']);
  const pick = (re) => status.match(re)?.[1] ?? null;
  const usageBefore = fs.readFileSync(usage, 'utf8');
  const snoozeOut = run(['--snooze']);
  const snoozed = fs.readFileSync(usage, 'utf8') !== usageBefore;
  // 사용 기록이 바뀌었는지와 안내 문구가 서로 맞아야 받은 것으로 본다.
  const snooze = snoozed ? (/미룸 표시 줄을 덧붙였습니다/.test(snoozeOut) ? '받음' : '알 수 없음') : /묻기\(ask\)일 때만/.test(snoozeOut) ? '받지 않음' : '알 수 없음';

  // 훅은 설치본 모양(subagent-system/hooks/git, subagent-system/config.json)으로 놓아 돌린다.
  const sub = path.join(root, 'subagent-system');
  fs.mkdirSync(sub, { recursive: true });
  const text = configOf(row);
  if (text !== null) fs.writeFileSync(path.join(sub, 'config.json'), text);
  let hook = null;
  if (HAS_HOOK) {
    fs.mkdirSync(path.join(sub, 'hooks', 'git'), { recursive: true });
    fs.copyFileSync(HOOK, path.join(sub, 'hooks', 'git', 'commit-msg'));
    const msg = path.join(root, 'MSG');
    fs.writeFileSync(msg, '왜와 전제가 없는 제목\n');
    hook = spawnSync(process.execPath, [path.join(sub, 'hooks', 'git', 'commit-msg'), msg], { encoding: 'utf8' });
  }

  return {
    due: due[0],
    dueAsks: /물을 것 (\d+)건/.exec(due.at(-1))?.[1] ?? '0',
    mode: pick(/^회고 방식: (\S+)/m),
    pendingScope: pick(/^물을 것\((.*)\): \d+건$/m),
    pending: pick(/^물을 것\(.*\): (\d+)건$/m),
    applyRules: pick(/^바로 고치기: (.+)$/m),
    threshold: pick(/^애매할 때: (.+)$/m),
    snooze,
    slashAsk: decide(run(['--slash', 'ask']), /(이미 ask입니다|auto에서 ask로 바꿨습니다)/, /받지 않습니다/),
    slashAuto: decide(run(['--slash', 'auto']), /(이미 auto입니다|ask에서 auto로 바꿨습니다)/, /받지 않습니다/),
    hookBlocks: hook ? hook.status === 1 : undefined,
  };
}

const expectedOf = (row) => ({
  due: row.due,
  dueAsks: String(row.pending),
  mode: row.retroMode === 'auto' ? '자동(auto)' : '묻기(ask)',
  pendingScope: row.scope,
  pending: String(row.pending),
  applyRules: row.applyRules,
  threshold: row.threshold,
  snooze: row.snooze,
  slashAsk: row.slashAsk,
  slashAuto: '받음',
  hookBlocks: HAS_HOOK ? row.hookBlocks : undefined,
});
const label = (row) => `${row.profile} / retroMode ${row.retroMode} / 없는 키 ${row.missing ?? '없음'}${row.withRetired ? ' / 옛 판정 키 남음' : ''}`;

describe('설정 조합별 스크립트 판정', () => {
  it('profile, retroMode, 빠진 키, 남은 옛 판정 키의 모든 조합에서 물을 것 세기, --snooze와 --slash 받기, --status의 바로 고치기와 애매할 때 줄, 커밋 검사 훅이 문서가 말하는 값과 같다', () => {
    const diffs = [];
    for (const row of ROWS) {
      const got = observe(row);
      const want = expectedOf(row);
      for (const key of Object.keys(want)) if (got[key] !== want[key]) diffs.push(`${label(row)}: ${key} 기대 ${JSON.stringify(want[key])}, 실제 ${JSON.stringify(got[key])}`);
    }
    assert.deepEqual(diffs, []);
  });

  it('설정 폴더가 git 저장소인지는 스크립트 판정과 커밋 검사 훅에 영향을 주지 않는다', { skip: !HAS_GIT }, () => {
    const diffs = [];
    // 스크립트는 설정 폴더의 git 상태를 읽지 않으므로 빠진 키 변형은 빼고 profile, retroMode, 설정 파일 상태만 훑는다.
    for (const row of ROWS.filter((r) => r.missing === null)) {
      const plain = observe(row);
      const repo = observe(row, { repo: true });
      for (const key of Object.keys(plain)) if (plain[key] !== repo[key]) diffs.push(`${label(row)}: ${key} 저장소 아님 ${JSON.stringify(plain[key])}, 저장소 ${JSON.stringify(repo[key])}`);
    }
    assert.deepEqual(diffs, []);
  });
});

// 순서가 있는 경로: 위 표는 설정 값 하나하나의 조합만 보므로, 명령을 차례로 돌려야 나타나는 조합을 따로 본다.
// 키트 원본에서만 돈다(설치본에는 키트 폴더가 없다).
const KIT = path.resolve(SUB, '..');
const SKIP_NOT_KIT = fs.existsSync(path.join(SUB, 'rules')) ? false : '설치본 배치(키트 원본에서만 시험)';
const KIT_SETUP = path.join(SUB, 'scripts', 'kit-setup.js');
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'CLAUDE_CONFIG_DIR' && k !== 'NODE_TEST_CONTEXT' && !k.startsWith('SUBAGENT_') && k !== 'ASK_LOG_FILE'));
const setup = (cfg, args) => spawnSync(process.execPath, [KIT_SETUP, ...args], { env: { ...cleanEnv(), CLAUDE_CONFIG_DIR: cfg }, encoding: 'utf8' });
const setupJson = (cfg, args) => {
  const r = setup(cfg, args);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};
const tmpCfg = () => fs.mkdtempSync(path.join(os.tmpdir(), 'config-seq-'));
const readConfig = (cfg) => JSON.parse(fs.readFileSync(path.join(cfg, 'subagent-system', 'config.json'), 'utf8'));
const writeConfig = (cfg, o) => fs.writeFileSync(path.join(cfg, 'subagent-system', 'config.json'), JSON.stringify(o, null, 2));
const settingsOf = (cfg) => JSON.parse(fs.readFileSync(path.join(cfg, 'settings.json'), 'utf8'));
const hasWriteAllowHook = (cfg) => /retro-write-allow\.js/.test(JSON.stringify(settingsOf(cfg).hooks?.PermissionRequest ?? []));

describe('순서가 있는 설정 경로', { skip: SKIP_NOT_KIT }, () => {
  it('profile이 없는 옛 설치는 update가 멈추고, set-profile personal 뒤 update가 돌아도 retroWriteAllow는 켜지지 않고 훅도 걸리지 않으며, 켜는 길은 --config-set이고 그때 훅도 걸린다', () => {
    const cfg = tmpCfg();
    setupJson(cfg, ['install', '--kit', KIT, '--profile', 'personal', '--no-git-ask']);
    const old = readConfig(cfg);
    delete old.profile;
    delete old.retroWriteAllow;
    old.retroMode = 'ask';
    writeConfig(cfg, old);
    const s = settingsOf(cfg);
    delete s.hooks.PermissionRequest;
    fs.writeFileSync(path.join(cfg, 'settings.json'), JSON.stringify(s));

    const stopped = setup(cfg, ['update', '--kit', KIT]);
    assert.equal(stopped.status, 2, stopped.stderr);
    assert.equal(JSON.parse(stopped.stdout).needsProfile, true);
    assert.equal('profile' in readConfig(cfg), false, '멈춘 update가 profile을 채웠다');

    setupJson(cfg, ['set-profile', 'personal']);
    assert.equal('retroWriteAllow' in readConfig(cfg), false, 'set-profile이 retroWriteAllow를 만들었다');
    const done = setupJson(cfg, ['update', '--kit', KIT]);
    assert.equal(done.config.changes.includes('retroWriteAllow: 없음 -> false'), true);
    assert.deepEqual([readConfig(cfg).profile, readConfig(cfg).retroMode, readConfig(cfg).retroWriteAllow], ['personal', 'auto', false]);
    assert.equal(hasWriteAllowHook(cfg), false);

    setupJson(cfg, ['set-profile', 'personal']);
    assert.equal(readConfig(cfg).retroWriteAllow, false, '한 번 더 돌린 set-profile이 켰다');
    assert.equal(setup(cfg, ['--config-set', path.join(cfg, 'subagent-system', 'config.json'), 'retroWriteAllow', 'true']).status, 0);
    assert.equal(hasWriteAllowHook(cfg), true, '--config-set이 훅 등록도 맞춘다');
    setupJson(cfg, ['update', '--kit', KIT]);
    assert.equal(hasWriteAllowHook(cfg), true);
  });

  it('retroWriteAllow 값만 true이고 훅이 걸리기 전에는 서브에이전트 쓰기 요청을 승인 창으로 적고, update로 훅이 걸린 뒤에는 적지 않는다', () => {
    const cfg = tmpCfg();
    setupJson(cfg, ['install', '--kit', KIT, '--profile', 'company', '--no-git-ask']);
    // 손으로 config.json만 고쳐 값은 true인데 훅은 아직 안 걸린 상태를 만든다(--config-set은 훅도 함께 건다).
    writeConfig(cfg, { ...readConfig(cfg), retroWriteAllow: true });
    const records = path.join(cfg, 'subagent-system', 'records');
    fs.mkdirSync(records, { recursive: true });
    fs.writeFileSync(path.join(records, 'retro.lock'), '{}');
    const log = path.join(tmpCfg(), 'asks.jsonl');
    const ask = (name) => {
      const input = JSON.stringify({ session_id: 's', agent_id: 'a', tool_name: 'Write', tool_input: { file_path: path.join(cfg, 'docs', name) } });
      const r = spawnSync(process.execPath, [path.join(cfg, 'subagent-system', 'hooks', 'ask-log.js')], { input, env: { ...cleanEnv(), CLAUDE_CONFIG_DIR: cfg, ASK_LOG_FILE: log, SUBAGENT_RECORDS_DIR: records }, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).length : 0;
    };
    assert.equal(hasWriteAllowHook(cfg), false);
    assert.equal(ask('a.md'), 1, '훅 등록 전에는 창이 뜨므로 적는다');
    setupJson(cfg, ['update', '--kit', KIT]);
    assert.equal(hasWriteAllowHook(cfg), true);
    assert.equal(ask('b.md'), 1, '훅 등록 뒤에는 창이 뜨지 않아 적지 않는다');
  });

  it('commit-msg 훅을 고르지 않고 설치한 설치본에서 커밋 검사 시험을 건너뛰어도 그 시험 파일이 통과한다', () => {
    const cfg = tmpCfg();
    setupJson(cfg, ['install', '--kit', KIT, '--profile', 'company', '--no-git-ask']);
    const scripts = path.join(cfg, 'subagent-system', 'scripts');
    assert.equal(fs.existsSync(path.join(cfg, 'subagent-system', 'hooks', 'git', 'commit-msg')), false);
    const r = spawnSync(process.execPath, ['--test', '--test-name-pattern=모든 조합|commit-msg', 'tests/commitMsgHook.test.js', 'tests/configCombos.test.js'], { cwd: scripts, env: { ...cleanEnv(), SUBAGENT_RECORDS_DIR: tmpCfg() }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout.slice(-1500) + r.stderr);
    assert.match(r.stdout, /ℹ fail 0/);
    assert.match(r.stdout, /﹣ 커밋 메시지 근거 검사 훅 commit-msg .*설치본에 commit-msg 훅이 없음/, 'commit-msg 시험을 건너뛰지 않았다');
    assert.match(r.stdout, /✔ 설정 조합별 스크립트 판정/);
  });

  it('자동 회고가 두 번 이어 실패해 개인용이 묻기가 되면 회고는 ask, 물을 것은 여섯 종만이고, 회사용이 auto로 돌면 회고는 auto, 물을 것은 전부다', () => {
    const outcome = (config, extra = []) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'config-split-'));
      const files = { dir: path.join(root, 'records'), config: path.join(root, 'config.json'), proposals: path.join(root, 'PROPOSALS.md') };
      fs.mkdirSync(files.dir);
      fs.writeFileSync(path.join(files.dir, 'subagent-usage.tsv'), USAGE);
      fs.writeFileSync(files.proposals, PROPOSALS);
      fs.writeFileSync(files.config, JSON.stringify(config));
      const run = (args) => spawnSync(process.execPath, [RETRO, ...args], {
        env: { ...cleanEnv(), SUBAGENT_RECORDS_DIR: files.dir, SUBAGENT_CONFIG_FILE: files.config, SUBAGENT_PROPOSALS_FILE: files.proposals, SUBAGENT_TODAY: '2026-10-13' },
        encoding: 'utf8',
      }).stdout;
      for (const args of extra) run(args);
      const due = run(['--due']).trim().split('\n');
      return { retroMode: JSON.parse(fs.readFileSync(files.config, 'utf8')).retroMode, due: due[0], asks: /물을 것 (\d+)건/.exec(due.at(-1))?.[1] ?? '0' };
    };
    const failedTwice = [['--claim'], ['--release', '--failed'], ['--claim'], ['--release', '--failed']];
    assert.deepEqual(outcome({ profile: 'personal', retroMode: 'auto', ...DEFAULTS.personal }, failedTwice), { retroMode: 'ask', due: 'ask', asks: '2' });
    assert.deepEqual(outcome({ profile: 'company', retroMode: 'auto', ...DEFAULTS.company }), { retroMode: 'auto', due: 'auto', asks: '3' });
  });
});

// 명령 순서가 만드는 조합 표: (처음 profile, 선택 훅 commit-msg 설치 여부, set-profile 대상, --config-unset으로 지운 키)마다
// install -> set-profile -> --config-unset 뒤와 update 뒤에 보호 장치의 실제 효과가 원칙과 APPLY_GUIDE 「개인용과 회사용」 표와 같은지 본다.
// 원칙: 권한과 보호 스위치(retroWriteAllow, commitCheck와 이 둘이 거는 훅)는 키트의 어떤 명령도 느슨한 쪽으로 바꾸지 않고(조이는 쪽, 곧 회사용으로 갈 때 retroWriteAllow를 끄고 훅을 빼는 것은 명령이 함), 키가 없으면 안전한 쪽(retroMode ask, retroWriteAllow 허용 안 함, commitCheck 검사)으로 본다.
// 까닭: 조합마다 따로 막으면 조합 막음이 회차마다 새로 나왔다(11회차 막음 3, 4). 실제 효과는 훅 실행 결과(쓰기 허용 판정, 커밋이 막히는지), settings.json의 훅 등록, --status 첫 줄로 잰다.
const DEF = {
  personal: { retroMode: 'auto', retroWriteAllow: true, commitCheck: 'block' },
  company: { retroMode: 'ask', retroWriteAllow: false, commitCheck: 'off' },
};
const SWITCHES = ['retroWriteAllow', 'commitCheck'];
const KEYS = ['retroMode', 'retroWriteAllow', 'commitCheck'];
const OTHER = { personal: 'company', company: 'personal' };
const SEQ_ROWS = [];
for (const from of ['personal', 'company']) {
  for (const commitHook of [false, true]) {
    for (const to of [null, OTHER[from]]) {
      for (const unset of [null, ...KEYS]) SEQ_ROWS.push({ from, commitHook, to, unset });
    }
  }
}
const rowLabel = (r) => `${r.from}${r.commitHook ? '+commit-msg' : ''} / set-profile ${r.to ?? '안 함'} / 지운 키 ${r.unset ?? '없음'}`;

// 명령을 차례로 돌린 뒤 설정 값이 어떠해야 하는지 원칙에서 낸다. 없는 키는 undefined다.
function expectedConfig(row, { afterUpdate }) {
  const profile = row.to ?? row.from;
  const cfg = { ...DEF[row.from] };
  if (row.to) {
    cfg.retroMode = DEF[row.to].retroMode;
    // 조이는 쪽은 명령이 한다: 회사용으로 가면 쓰기 허용을 끈다. 느슨한 쪽(commitCheck, 개인용으로 갈 때의 retroWriteAllow)은 그대로 둔다.
    if (row.to === 'company' && cfg.retroWriteAllow === true) cfg.retroWriteAllow = false;
  }
  if (row.unset) delete cfg[row.unset];
  if (afterUpdate) {
    cfg.retroMode ??= DEF[profile].retroMode;
    cfg.retroWriteAllow ??= false;
    cfg.commitCheck ??= row.commitHook ? 'block' : DEF[profile].commitCheck;
  }
  return { profile, ...cfg };
}

const requireCjs = createRequire(import.meta.url);

describe('명령 순서 조합 표', { skip: SKIP_NOT_KIT }, () => {
  it('처음 profile, 선택 훅, set-profile 대상, 지운 키의 모든 조합에서 보호 장치의 실제 효과가 원칙과 표를 따른다', { timeout: 300000 }, () => {
    const { shouldAllow } = requireCjs(path.join(SUB, 'hooks', 'retro-write-allow.js'));
    const bases = {};
    for (const from of ['personal', 'company']) {
      for (const commitHook of [false, true]) {
        const cfg = tmpCfg();
        setupJson(cfg, ['install', '--kit', KIT, '--profile', from, '--no-git-ask', ...(commitHook ? ['--hooks', 'commit-msg'] : [])]);
        bases[`${from}/${commitHook}`] = cfg;
      }
    }
    const repo = tmpCfg();
    if (HAS_GIT) assert.equal(spawnSync('git', ['init', '-q'], { cwd: repo }).status, 0);
    const diffs = [];
    const note = (row, stage, what, want, got) => {
      if (JSON.stringify(want) !== JSON.stringify(got)) diffs.push(`${rowLabel(row)} / ${stage}: ${what} 기대 ${JSON.stringify(want)}, 실제 ${JSON.stringify(got)}`);
    };

    // 한 시점의 실제 효과를 모아 원칙이 말하는 값과 견준다.
    const observeAndCompare = (row, cfg, stage, afterUpdate) => {
      const want = expectedConfig(row, { afterUpdate });
      const got = readConfig(cfg);
      for (const k of ['profile', ...KEYS]) note(row, stage, `config.${k}`, want[k], got[k]);

      // 쓰기 허용: 회고 잠금이 잡힌 동안 서브에이전트의 방법 파일 쓰기를 훅이 허용하는지, 훅이 settings.json에 걸려 있는지. 확인 창이 안 뜨려면 둘 다 필요하다.
      const records = path.join(cfg, 'subagent-system', 'records');
      fs.mkdirSync(records, { recursive: true });
      fs.writeFileSync(path.join(records, 'retro.lock'), '{}');
      const input = { agent_id: 'a', tool_name: 'Write', tool_input: { file_path: path.join(cfg, 'docs', 'x.md') } };
      const allowed = shouldAllow(input, { CLAUDE_CONFIG_DIR: cfg });
      const registered = hasWriteAllowHook(cfg);
      note(row, stage, '쓰기 허용 훅 판정', want.retroWriteAllow === true, allowed);
      note(row, stage, 'settings.json의 retro-write-allow 훅 등록', want.retroWriteAllow === true, registered);

      // 회고 방식: --status 첫 줄. 키가 없으면 묻기로 읽힌다.
      const status = spawnSync(process.execPath, [path.join(cfg, 'subagent-system', 'scripts', 'subagent-retro.js'), '--status'], { env: { ...cleanEnv(), CLAUDE_CONFIG_DIR: cfg }, encoding: 'utf8' }).stdout;
      note(row, stage, '--status 회고 방식 줄', want.retroMode === 'auto' ? '자동(auto)' : '묻기(ask)', status.match(/^회고 방식: (\S+)/m)?.[1]);
      note(row, stage, '--status 바로 고치기 줄(profile이 정함)', want.profile === 'personal' ? '켬' : '끔', status.match(/^바로 고치기: (\S+)/m)?.[1]);

      // 커밋 검사: commit-msg 훅이 깔려 있을 때, 왜와 전제가 없는 커밋이 막히는지. commitCheck가 off일 때만 통과한다.
      if (row.commitHook && HAS_GIT) {
        const hooksPath = path.join(cfg, 'subagent-system', 'hooks', 'git');
        const commit = spawnSync('git', ['-c', `core.hooksPath=${hooksPath}`, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '--allow-empty', '-q', '-m', '왜와 전제가 없는 제목'], { cwd: repo, encoding: 'utf8' });
        note(row, stage, '왜와 전제가 없는 커밋이 막힘', want.commitCheck !== 'off', commit.status !== 0);
      }
    };

    for (const row of SEQ_ROWS) {
      const cfg = tmpCfg();
      fs.cpSync(bases[`${row.from}/${row.commitHook}`], cfg, { recursive: true });
      const setConfig = (args) => setup(cfg, args);
      const file = path.join(cfg, 'subagent-system', 'config.json');
      const start = readConfig(cfg);
      if (row.to) {
        const r = setupJson(cfg, ['set-profile', row.to]);
        // 권한과 보호 스위치가 새 profile의 기본값과 다르면 바꾸지 않고 notes로 알린다. 같으면 알릴 것이 없다.
        const wantNotes = SWITCHES.filter((k) => JSON.stringify(start[k]) !== JSON.stringify(DEF[row.to][k]));
        note(row, 'set-profile', 'notes가 알리는 스위치', wantNotes, r.notes.map((n) => n.split('는 ')[0]));
        note(row, 'set-profile', 'changes에 든 스위치', row.to === 'company' && start.retroWriteAllow === true ? ['retroWriteAllow: true -> false'] : [], r.changes.filter((c) => SWITCHES.some((k) => c.startsWith(`${k}:`))));
      }
      if (row.unset) assert.equal(setConfig(['--config-unset', file, row.unset]).status, 0);
      observeAndCompare(row, cfg, '명령 뒤', false);

      setupJson(cfg, ['update', '--kit', KIT]);
      observeAndCompare(row, cfg, 'update 뒤', true);
    }
    assert.deepEqual(diffs, []);
  });

  it('--config-set으로 retroWriteAllow를 켜거나 끄면 훅 등록이 바로 맞춰지고 다른 키트 훅은 남는다', () => {
    for (const from of ['personal', 'company']) {
      const cfg = tmpCfg();
      setupJson(cfg, ['install', '--kit', KIT, '--profile', from, '--no-git-ask']);
      const file = path.join(cfg, 'subagent-system', 'config.json');
      const on = JSON.parse(setup(cfg, ['--config-set', file, 'retroWriteAllow', 'true']).stdout);
      assert.equal(hasWriteAllowHook(cfg), true, `${from}: 켠 직후`);
      assert.equal(['registered', 'already-registered'].includes(on.hook), true);
      const off = JSON.parse(setup(cfg, ['--config-set', file, 'retroWriteAllow', 'false']).stdout);
      assert.equal(off.hook, 'removed');
      assert.equal(hasWriteAllowHook(cfg), false, `${from}: 끈 직후`);
      assert.match(JSON.stringify(settingsOf(cfg).hooks.PermissionRequest), /ask-log\.js/);
      assert.match(JSON.stringify(settingsOf(cfg).hooks.PreToolUse), /brief-check\.js/);
    }
  });
});

// 끊긴 처음 설치(VERSION이 없음)를 다른 profile로 다시 돌리는 네 조합: (처음 profile, 다시 고른 profile).
// 같은 원칙이다. 조이는 쪽(회사용으로 갈 때 쓰기 허용 끄기와 훅 등록 빼기, retroMode ask)은 install이 하고 notes로 알리며, 느슨한 쪽(개인용으로 갈 때)은 두고 알린다.
// 까닭: 12회차에 personal로 깐 뒤 VERSION을 지우고 company로 다시 돌리면 회사용에 쓰기 허용과 자동 회고가 소리 없이 남았다.
describe('끊긴 처음 설치를 다른 profile로 다시 돌린 조합', { skip: SKIP_NOT_KIT }, () => {
  const COMBOS = [
    { first: 'personal', again: 'personal', want: { retroMode: 'auto', retroWriteAllow: true, commitCheck: 'block' }, hook: true, noted: [] },
    { first: 'personal', again: 'company', want: { retroMode: 'ask', retroWriteAllow: false, commitCheck: 'block' }, hook: false, noted: ['retroWriteAllow', 'commitCheck'] },
    { first: 'company', again: 'personal', want: { retroMode: 'auto', retroWriteAllow: false, commitCheck: 'off' }, hook: false, noted: ['retroWriteAllow', 'commitCheck'] },
    { first: 'company', again: 'company', want: { retroMode: 'ask', retroWriteAllow: false, commitCheck: 'off' }, hook: false, noted: [] },
  ];
  for (const c of COMBOS) {
    it(`${c.first}로 깐 뒤 VERSION이 없는 채로 ${c.again}로 다시 install하면 설정, 쓰기 허용 훅 등록, --status 회고 방식이 원칙대로다`, () => {
      const cfg = tmpCfg();
      setupJson(cfg, ['install', '--kit', KIT, '--profile', c.first, '--no-git-ask']);
      fs.rmSync(path.join(cfg, 'subagent-system', 'VERSION'));
      const r = setupJson(cfg, ['install', '--kit', KIT, '--profile', c.again, '--no-git-ask']);
      const got = readConfig(cfg);
      assert.deepEqual([got.profile, got.retroMode, got.retroWriteAllow, got.commitCheck], [c.again, c.want.retroMode, c.want.retroWriteAllow, c.want.commitCheck]);
      assert.equal(hasWriteAllowHook(cfg), c.hook, 'retro-write-allow 훅 등록');
      assert.deepEqual(r.notes.filter((n) => /^(retroWriteAllow|commitCheck)는 /.test(n)).map((n) => n.split('는 ')[0]), c.noted, '바뀐 것과 두고 간 것을 notes로 알린다');
      const { shouldAllow } = requireCjs(path.join(SUB, 'hooks', 'retro-write-allow.js'));
      const records = path.join(cfg, 'subagent-system', 'records');
      fs.mkdirSync(records, { recursive: true });
      fs.writeFileSync(path.join(records, 'retro.lock'), '{}');
      const input = { agent_id: 'a', tool_name: 'Write', tool_input: { file_path: path.join(cfg, 'docs', 'x.md') } };
      assert.equal(shouldAllow(input, { CLAUDE_CONFIG_DIR: cfg }), c.want.retroWriteAllow, '쓰기 허용 훅 판정');
      const status = spawnSync(process.execPath, [path.join(cfg, 'subagent-system', 'scripts', 'subagent-retro.js'), '--status'], { env: { ...cleanEnv(), CLAUDE_CONFIG_DIR: cfg }, encoding: 'utf8' }).stdout;
      assert.equal(status.match(/^회고 방식: (\S+)/m)?.[1], c.want.retroMode === 'auto' ? '자동(auto)' : '묻기(ask)');
    });
  }
});
