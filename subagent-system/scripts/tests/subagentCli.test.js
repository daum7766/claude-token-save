import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { usageLineFromArgs, parseUsage } from '../subagentRetroHelpers.js';
import { localDate } from '../claudeProjectPaths.js';

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RETRO = path.join(SCRIPTS, 'subagent-retro.js');
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-cli-'));
const NOW = new Date(2026, 9, 13, 12, 0, 0);
// 사용자 환경의 SUBAGENT_* 경로 재정의(표, 정의 폴더, 가이드 등)가 시험에 섞이지 않게 먼저 지운다.
for (const k of Object.keys(process.env)) if (k.startsWith('SUBAGENT_')) delete process.env[k];
// 설치본의 설정 파일이 auto여도 아래 시험이 ask 기준으로 도는 것을 막고, 설치본을 읽지 않게 한다.
process.env.SUBAGENT_CONFIG_FILE = path.join(tmpDir(), 'no-config.json');
// 보존 기간은 실제 ~/.claude 설정이 아니라 빈 폴더에서 읽고, 오늘은 고정해 기간 기준이 시계에 따라 달라지지 않게 한다.
process.env.CLAUDE_CONFIG_DIR = path.join(tmpDir(), 'claude');
process.env.SUBAGENT_TODAY = '2026-10-13';

const base = ['--log', '--project', '/home/u/proj', '--def', 'sonnet-medium', '--kind', '구현 계획이 정해진 기능 구현', '--result', 'ok', '--memo', 'a1b2c3 메모'];
const without = (...keys) => {
  const out = [];
  for (let i = 0; i < base.length; i += 1) {
    if (keys.includes(base[i].replace(/^--/, ''))) i += 1;
    else out.push(base[i]);
  }
  return out;
};

describe('usageLineFromArgs', () => {
  it('열 9개를 지금 형식의 순서로 탭으로 잇고 생략한 날짜는 오늘 로컬 날짜, 생략한 숫자는 -이다', () => {
    const { line } = usageLineFromArgs(base, NOW);
    assert.equal(line, ['2026-10-13', '/home/u/proj', 'sonnet-medium', '구현 계획이 정해진 기능 구현', '-', '-', '-', 'ok', 'a1b2c3 메모'].join('\t'));
  });

  it('값 안의 탭과 줄바꿈은 공백으로 바뀌어 열 9개와 한 줄이 유지된다', () => {
    const { line } = usageLineFromArgs([...without('memo', 'kind'), '--kind', '일\t종류', '--memo', 'a1 첫째\r\n둘째\t셋째\n'], NOW);
    assert.equal(line.split('\t').length, 9);
    assert.equal(line.includes('\n'), false);
    assert.equal(line.includes('\r'), false);
    const cols = line.split('\t');
    assert.equal(cols[3], '일 종류');
    assert.equal(cols[8], 'a1 첫째  둘째 셋째');
  });

  it('%, 따옴표, 역슬래시, 한글은 그대로 남는다', () => {
    const memo = `a1 100%s "큰" '작은' C:\\x\\y %d 한글`;
    const { line } = usageLineFromArgs([...without('memo'), '--memo', memo], NOW);
    assert.equal(line.split('\t')[8], memo);
  });

  it('워크트리에서 시작한 프로젝트 경로는 꼬리를 떼고, Windows 경로는 역슬래시를 그대로 둔다', () => {
    assert.equal(usageLineFromArgs([...without('project'), '--project', '/home/u/proj/.claude/worktrees/w1'], NOW).line.split('\t')[1], '/home/u/proj');
    assert.equal(usageLineFromArgs([...without('project'), '--project', 'C:\\Users\\u\\proj\\.claude\\worktrees\\w1'], NOW).line.split('\t')[1], 'C:\\Users\\u\\proj');
  });

  it('필수 값이 빠지면 오류이고 줄을 만들지 않는다', () => {
    for (const key of ['project', 'def', 'kind', 'result', 'memo']) {
      const r = usageLineFromArgs(without(key), NOW);
      assert.equal(r.line, undefined, key);
      assert.ok(r.error.includes(`--${key}`), r.error);
    }
  });

  it('결과가 ok, 재지시, 올림이 아니면 오류이고 셋은 모두 받는다', () => {
    assert.ok(usageLineFromArgs([...without('result'), '--result', 'OK'], NOW).error.includes('--result'));
    assert.ok(usageLineFromArgs([...without('result'), '--result', '성공'], NOW).error);
    for (const result of ['ok', '재지시', '올림']) assert.equal(usageLineFromArgs([...without('result'), '--result', result], NOW).line.split('\t')[7], result);
  });

  it('프로젝트가 절대 경로가 아니거나 날짜와 숫자 꼴이 틀리면 오류다', () => {
    assert.ok(usageLineFromArgs([...without('project'), '--project', '~/proj'], NOW).error.includes('절대 경로'));
    assert.ok(usageLineFromArgs([...without('project'), '--project', 'proj'], NOW).error.includes('절대 경로'));
    assert.ok(usageLineFromArgs([...base, '--date', '2026-1-3'], NOW).error.includes('--date'));
    assert.ok(usageLineFromArgs([...base, '--secs', '12s'], NOW).error.includes('--secs'));
    assert.equal(usageLineFromArgs([...base, '--tokens', '-'], NOW).line.split('\t')[4], '-');
  });

  it('--log가 쓴 줄을 회고 스크립트가 같은 열로 읽는다', () => {
    const { line } = usageLineFromArgs([...without('result'), '--result', '재지시', '--secs', '76'], NOW);
    const r = parseUsage(line + '\n').all[0];
    assert.deepEqual(
      { date: r.date, project: r.project, def: r.def, kind: r.kind, seconds: r.seconds, result: r.result, agentId: r.agentId },
      { date: '2026-10-13', project: '/home/u/proj', def: 'sonnet-medium', kind: '구현 계획이 정해진 기능 구현', seconds: 76, result: '재지시', agentId: 'a1b2c3' }
    );
  });
});

describe('subagent-retro.js --log 실행', () => {
  const run = (args, recordsDir) => spawnSync(process.execPath, [RETRO, ...args], { env: { ...process.env, SUBAGENT_RECORDS_DIR: recordsDir }, encoding: 'utf8' });

  it('기록 폴더가 없으면 만들고 머리줄 없이 UTF-8로 한 줄을 덧붙인다', () => {
    const dir = path.join(tmpDir(), 'nested', 'records');
    const r = run(base, dir);
    assert.equal(r.status, 0, r.stderr);
    const bytes = fs.readFileSync(path.join(dir, 'subagent-usage.tsv'));
    assert.equal(bytes.toString('utf8').split('\n').length, 2);
    assert.equal(bytes.toString('utf8').startsWith('날짜'), false);
    assert.ok(bytes.includes(Buffer.from('구현 계획이 정해진 기능 구현', 'utf8')));
    assert.equal(bytes.at(-1), 0x0a);
    assert.equal(bytes.includes(0x0d), false);
  });

  it('이미 있는 줄을 다시 쓰지 않고 뒤에 덧붙인다', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'subagent-usage.tsv');
    const old = '2026-10-12\t/p\tsonnet-low\t번역\t1\t2\t3\tok\ta0 옛 줄\n';
    fs.writeFileSync(file, old);
    assert.equal(run(base, dir).status, 0);
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(text.startsWith(old));
    assert.equal(text.split('\n').filter(Boolean).length, 2);
  });

  it('fable-high를 정의 이름으로 받는다', () => {
    const dir = tmpDir();
    const r = run([...without('def'), '--def', 'fable-high'], dir);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.readFileSync(path.join(dir, 'subagent-usage.tsv'), 'utf8').split('\t')[2], 'fable-high');
  });

  it('실패하면 종료 코드 1이고 기록 폴더에 아무것도 만들지 않는다', () => {
    const dir = path.join(tmpDir(), 'records');
    const r = run(without('result'), dir);
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes('--result'));
    assert.equal(fs.existsSync(dir), false);
  });
});

describe('subagent-retro.js --due와 --snooze 실행', () => {
  const run = (args, dir) => spawnSync(process.execPath, [RETRO, ...args], { env: { ...process.env, SUBAGENT_RECORDS_DIR: dir }, encoding: 'utf8' });
  const lines = (n) => Array.from({ length: n }, (_, i) => `2026-10-12\t/p\tsonnet-low\t번역\t1\t2\t3\tok\ta${i} 줄`).join('\n') + '\n';

  it('첫 회고 전 30줄이면 ask, --snooze 뒤에는 wait 15, 15줄 더 쌓이면 ask다', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'subagent-usage.tsv');
    fs.writeFileSync(file, lines(30));
    assert.equal(run(['--due'], dir).stdout.split('\n')[0], 'ask');
    const snooze = run(['--snooze'], dir);
    assert.equal(snooze.status, 0);
    assert.ok(snooze.stdout.includes('15줄'), snooze.stdout);
    assert.equal(run(['--due'], dir).stdout.split('\n')[0], 'wait 15');
    fs.appendFileSync(file, lines(14));
    assert.equal(run(['--due'], dir).stdout.split('\n')[0], 'wait 1');
    fs.appendFileSync(file, lines(1));
    assert.equal(run(['--due'], dir).stdout.split('\n')[0], 'ask');
    assert.equal(fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.startsWith('미룸\t')).length, 1);
  });
});

describe('subagent-retro.js --due와 --snooze 올림 기준', () => {
  const run = (args, dir) => spawnSync(process.execPath, [RETRO, ...args], { env: { ...process.env, SUBAGENT_RECORDS_DIR: dir }, encoding: 'utf8' });
  const rows = (n, { def = 'sonnet-low', kind = '번역', result = 'ok', from = 0 } = {}) =>
    Array.from({ length: n }, (_, i) => `2026-10-12\t/p\t${def}\t${kind}\t1\t2\t3\t${result}\t${def}${kind}${result}${from + i} 줄`).join('\n') + (n ? '\n' : '');
  const up = (n, opts = {}) => rows(n, { ...opts, result: '올림' });
  const setup = (...parts) => {
    const dir = tmpDir();
    const file = path.join(dir, 'subagent-usage.tsv');
    fs.writeFileSync(file, parts.join(''));
    return { dir, file };
  };
  const due = (dir) => run(['--due'], dir).stdout.split('\n');

  it('올림이 쌓인 칸이 여럿이면 모두 둘째 줄에 보이고, 건수 기준도 걸리면 기존 단계 설명이 이어진다', () => {
    const { dir } = setup(rows(30, { kind: '구현' }), up(2), up(3, { def: 'opus-low', kind: '조사' }));
    const out = due(dir);
    assert.equal(out[0], 'ask');
    assert.equal(out[1], '올림 에이전트 3명: opus-low / 조사, 올림 에이전트 2명: sonnet-low / 번역');
    assert.ok(out[2].includes('첫 회고 기준 30건'), out[2]);
  });

  it('올림만 걸리고 건수 기준은 wait여도 첫 줄은 ask이고, 건수 기준만 걸리면 둘째 줄에 올림이 없다', () => {
    const onlyUp = setup(rows(5), up(2));
    assert.equal(due(onlyUp.dir)[0], 'ask');
    const onlyCount = setup(rows(30));
    const out = due(onlyCount.dir);
    assert.equal(out[0], 'ask');
    assert.ok(out[1].startsWith('(사용 기록 30줄'), out[1]);
    assert.equal(out.some((l) => l.includes('올림')), false);
  });

  it('올리기 후보 줄에 올림 뒤 다시 보낸 정의와 건수가 찍히고, 다시 보낸 기록이 없으면 그렇다고 찍힌다', () => {
    const resent = [rows(1, { def: 'opus-medium', result: 'ok', from: 50 }).trim()];
    const withResend = setup(up(2), resent.join('\n') + '\n');
    assert.match(run(['--report'], withResend.dir).stdout, /올리기 후보\([^\n]*\n  sonnet-low \/ 번역  2\/2명 \(100%\)  다시 보낸 기록 opus-medium 1건\n/);
    const none = setup(up(2));
    assert.match(run(['--report'], none.dir).stdout, /\n  sonnet-low \/ 번역  2\/2명 \(100%\)  다시 보낸 기록 없음\n/);
  });

  it('기본 보고의 회고 기준 줄 다음에 올림이 쌓인 칸이 한 줄로 나오고, 없으면 그 줄이 없다', () => {
    const { dir } = setup(up(2), up(1, { kind: '교정' }));
    const lines = run(['--report'], dir).stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('회고 기준:'));
    assert.ok(i >= 0);
    assert.match(lines[i + 1], /^올림이 쌓인 칸\(.*\): sonnet-low \/ 번역 2\/2명$/);
    const none = setup(up(1));
    assert.equal(run(['--report'], none.dir).stdout.includes('쌓인 칸('), false);
  });
});

describe('subagent-retro.js --mark --changed 실행', () => {
  // 키트 문서의 표를 읽으면 표 모양이 여덟째 열에 들어가 시험이 키트 표에 묶이므로 없는 GUIDE를 준다.
  const run = (args, dir) => spawnSync(process.execPath, [RETRO, ...args], { env: { ...process.env, SUBAGENT_RECORDS_DIR: dir, SUBAGENT_GUIDE_FILE: path.join(dir, 'no-guide.md') }, encoding: 'utf8' });
  const lines = (n, from = 0) => Array.from({ length: n }, (_, i) => `2026-10-12\t/p\tsonnet-low\t번역\t1\t2\t3\tok\ta${from + i} 줄`).join('\n') + '\n';
  const msgs = (dir, usageLines) => {
    const f = path.join(dir, 'msgs.tsv');
    fs.writeFileSync(f, `# 사용 줄\t${usageLines}\n# 추출 시각\t2026-10-13T00:00:00.000Z\n`);
    return f;
  };
  const markOnce = (dir, usageLines, changed) => run(['--mark', '메모', '--messages', msgs(dir, usageLines), ...(changed === null ? [] : ['--changed', String(changed)])], dir);

  it('--changed 값을 회고 표시 줄 여섯째 열에 적고 9열을 지킨다', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'subagent-usage.tsv');
    fs.writeFileSync(file, lines(3));
    const r = markOnce(dir, 3, 2);
    assert.equal(r.status, 0, r.stderr);
    const cols = fs.readFileSync(file, 'utf8').trim().split('\n').at(-1).split('\t');
    assert.deepEqual(cols, ['회고', '-', '회고', '2026-10-13T00:00:00.000Z', '3', '2', '-', '-', '메모']);
  });

  it('--changed가 숫자가 아니면 기록에 쓰지 않고 실패한다', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'subagent-usage.tsv');
    fs.writeFileSync(file, lines(3));
    assert.equal(run(['--mark', '메모', '--messages', msgs(dir, 3), '--changed', 'x'], dir).status, 1);
    assert.equal(fs.readFileSync(file, 'utf8'), lines(3));
  });
});

describe('CLAUDE_CONFIG_DIR', () => {
  const projectsRoot = (env) =>
    spawnSync(process.execPath, ['--input-type=module', '-e', `import { PROJECTS_ROOT } from ${JSON.stringify(path.join(SCRIPTS, 'claudeProjectPaths.js'))}; console.log(PROJECTS_ROOT);`], {
      env: { ...process.env, CLAUDE_CONFIG_DIR: '', ...env },
      encoding: 'utf8',
    }).stdout.trim();

  it('값이 있으면 그 폴더 아래 projects를 읽는다', () => {
    const dir = tmpDir();
    assert.equal(projectsRoot({ CLAUDE_CONFIG_DIR: dir }), path.join(dir, 'projects'));
  });
});

describe('subagent-retro.js 회고 출력의 CLAUDE.md 정리 줄', () => {
  const setup = ({ claudeMd = null, kept = null, rules = null, config = null } = {}) => {
    const root = tmpDir();
    const dir = path.join(root, 'records');
    const claude = path.join(root, 'claude');
    fs.mkdirSync(dir);
    fs.mkdirSync(claude);
    fs.writeFileSync(path.join(dir, 'subagent-usage.tsv'), '2026-10-12\t/p\tsonnet-low\t번역\t1\t2\t3\tok\ta1 줄\n');
    if (claudeMd !== null) fs.writeFileSync(path.join(claude, 'CLAUDE.md'), claudeMd);
    const config_ = path.join(root, 'config.json');
    if (kept !== null || config !== null) fs.writeFileSync(config_, JSON.stringify({ ...(kept !== null ? { claudeMdKeptLines: kept } : {}), ...(config ?? {}) }));
    if (rules !== null) {
      fs.mkdirSync(path.join(claude, 'rules'));
      for (const [name, text] of Object.entries(rules)) fs.writeFileSync(path.join(claude, 'rules', name), text);
    }
    return { dir, claude, config: config_, file: path.join(claude, 'CLAUDE.md') };
  };
  const lines = (n, kit = []) => [...kit, ...Array.from({ length: n - kit.length }, (_, i) => `규칙 ${i}`)].join('\n') + '\n';
  const claudeLine = (e) => {
    const r = spawnSync(process.execPath, [RETRO, '--report'], { env: { ...process.env, SUBAGENT_RECORDS_DIR: e.dir, CLAUDE_CONFIG_DIR: e.claude, SUBAGENT_CONFIG_FILE: e.config }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.split('\n').find((l) => l.startsWith('CLAUDE.md 정리:'));
  };

  it('80줄 이하이면 정리 제안 대상 아님과 까닭, 전체와 키트 구역 줄 수를 찍는다', () => {
    const kit = ['<!-- subagent-system 시작 -->', 'x', '<!-- subagent-system 끝 -->'];
    const e = setup({ claudeMd: lines(80, kit) });
    const line = claudeLine(e);
    assert.match(line, /정리 제안 대상 아님\(80줄 이하\)/);
    assert.match(line, /늘 읽히는 줄 합 80줄\(CLAUDE\.md 80줄, 키트 구역 3줄\)/);
    assert.ok(line.includes(e.file));
  });

  it('80줄 이하이고 claudeMdKeptLines가 있으면 그 키만 지우고 다른 키는 남기며 줄 끝에 알린다', () => {
    const e = setup({ claudeMd: lines(60) });
    fs.writeFileSync(e.config, JSON.stringify({ retroMode: 'auto', removedDefs: ['x'], claudeMdKeptLines: 100 }));
    const line = claudeLine(e);
    assert.match(line, /정리 제안 대상 아님\(80줄 이하\)/);
    assert.match(line, /늘 읽히는 줄 합 60줄\(CLAUDE\.md 60줄, 키트 구역 0줄\)/);
    assert.match(line, /100줄 기록을 지웠습니다/);
    assert.deepEqual(JSON.parse(fs.readFileSync(e.config, 'utf8')), { retroMode: 'auto', removedDefs: ['x'] });
  });

  // 까닭: 설치와 업데이트는 늘 읽히는 줄의 합으로 세는데 회고만 CLAUDE.md 한 파일로 세어 판정이 갈렸다(19회차 막음 1).
  it('CLAUDE.md는 80줄 이하여도 paths 없는 rules를 더해 81줄이면 정리 제안 대상이고, paths가 있는 rules는 더하지 않는다', () => {
    const e = setup({ claudeMd: lines(54), rules: { 'kit-a.md': lines(29), 'scoped.md': `---\npaths: ["src/**"]\n---\n${lines(40)}` } });
    const line = claudeLine(e);
    assert.match(line, /^CLAUDE\.md 정리: 정리 제안 대상  늘 읽히는 줄 합 83줄\(CLAUDE\.md 54줄/);
    const under = setup({ claudeMd: lines(54), rules: { 'kit-a.md': lines(26) } });
    assert.match(claudeLine(under), /정리 제안 대상 아님\(80줄 이하\)  늘 읽히는 줄 합 80줄/);
  });

  it('config.json의 claudeMdLimitLines를 합의 기준으로 쓴다', () => {
    const rules = { 'kit-a.md': lines(29) };
    assert.match(claudeLine(setup({ claudeMd: lines(54), rules, config: { claudeMdLimitLines: 120 } })), /정리 제안 대상 아님\(120줄 이하\)  늘 읽히는 줄 합 83줄/);
    assert.match(claudeLine(setup({ claudeMd: lines(54), rules, config: { claudeMdLimitLines: 82 } })), /정리 제안 대상  늘 읽히는 줄 합 83줄/);
  });

  it('정리를 마다해 남긴 줄 수에서 20줄 이내면 합이 기준을 넘어도 대상이 아니고 21줄 늘면 대상이다', () => {
    const rules = { 'kit-a.md': lines(29) };
    assert.match(claudeLine(setup({ claudeMd: lines(54), rules, kept: 83 })), /정리 제안 대상 아님\(정리 뒤 남긴 83줄에서 20줄 이내\)/);
    assert.match(claudeLine(setup({ claudeMd: lines(54), rules, kept: 62 })), /정리 제안 대상  늘 읽히는 줄 합 83줄/);
    assert.match(claudeLine(setup({ claudeMd: lines(54), rules, kept: 63 })), /정리 제안 대상 아님\(정리 뒤 남긴 63줄에서 20줄 이내\)/);
  });
});

describe('subagent-retro.js --claude-md-done 실행', () => {
  const setup = ({ claudeMd = null, config = null, rules = null }) => {
    const root = tmpDir();
    const claude = path.join(root, 'claude');
    fs.mkdirSync(claude);
    if (claudeMd !== null) fs.writeFileSync(path.join(claude, 'CLAUDE.md'), claudeMd);
    if (rules !== null) {
      fs.mkdirSync(path.join(claude, 'rules'));
      for (const [name, text] of Object.entries(rules)) fs.writeFileSync(path.join(claude, 'rules', name), text);
    }
    const file = path.join(root, 'config.json');
    if (config !== null) fs.writeFileSync(file, config);
    return { root, claude, file };
  };
  const lines = (n) => Array.from({ length: n }, (_, i) => `규칙 ${i}`).join('\n') + '\n';
  const done = (e) => spawnSync(process.execPath, [RETRO, '--claude-md-done'], { env: { ...process.env, SUBAGENT_RECORDS_DIR: path.join(e.root, 'records'), CLAUDE_CONFIG_DIR: e.claude, SUBAGENT_CONFIG_FILE: e.file }, encoding: 'utf8' });

  it('CLAUDE.md가 80줄을 넘으면 그 줄 수를 claudeMdKeptLines에 적고 다른 키는 남긴다', () => {
    const e = setup({ claudeMd: lines(100), config: JSON.stringify({ retroMode: 'auto', removedDefs: ['x'], claudeMdKeptLines: 90 }) });
    const r = done(e);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /claudeMdKeptLines에 100줄을 적었습니다/);
    assert.deepEqual(JSON.parse(fs.readFileSync(e.file, 'utf8')), { retroMode: 'auto', removedDefs: ['x'], claudeMdKeptLines: 100 });
  });

  it('CLAUDE.md가 80줄 이하이면 claudeMdKeptLines만 지우고 다른 키는 남긴다', () => {
    const e = setup({ claudeMd: lines(60), config: JSON.stringify({ retroMode: 'auto', claudeMdKeptLines: 100 }) });
    const r = done(e);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /claudeMdKeptLines를 지웠습니다/);
    assert.deepEqual(JSON.parse(fs.readFileSync(e.file, 'utf8')), { retroMode: 'auto' });
  });

  it('CLAUDE.md는 80줄 이하여도 늘 읽히는 줄의 합이 기준을 넘으면 그 합을 claudeMdKeptLines에 적고, 합이 기준 이하가 되면 지운다', () => {
    const over = setup({ claudeMd: lines(54), rules: { 'kit-a.md': lines(29) }, config: JSON.stringify({ retroMode: 'auto' }) });
    const r = done(over);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /늘 읽히는 줄 합 83줄: claudeMdKeptLines에 83줄을 적었습니다/);
    assert.deepEqual(JSON.parse(fs.readFileSync(over.file, 'utf8')), { retroMode: 'auto', claudeMdKeptLines: 83 });
    const under = setup({ claudeMd: lines(54), rules: { 'kit-a.md': lines(26) }, config: JSON.stringify({ claudeMdKeptLines: 83 }) });
    assert.match(done(under).stdout, /늘 읽히는 줄 합 80줄: 80줄 이하라 claudeMdKeptLines를 지웠습니다/);
    assert.deepEqual(JSON.parse(fs.readFileSync(under.file, 'utf8')), {});
  });

  it('claudeMdLimitLines를 올려 둔 설정은 같은 합이라도 기준 이하로 보고 남긴 줄 수를 쓰지 않는다', () => {
    const e = setup({ claudeMd: lines(54), rules: { 'kit-a.md': lines(29) }, config: JSON.stringify({ claudeMdLimitLines: 120 }) });
    const r = done(e);
    assert.match(r.stdout, /늘 읽히는 줄 합 83줄: 120줄 이하라 claudeMdKeptLines를 지울 것이 없어 그대로 뒀습니다/);
    assert.deepEqual(JSON.parse(fs.readFileSync(e.file, 'utf8')), { claudeMdLimitLines: 120 });
  });

  it('설정 파일이 없으면 종료 코드 1이고 파일을 만들지 않는다', () => {
    const e = setup({ claudeMd: lines(100) });
    const r = done(e);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /설정 파일이 없어/);
    assert.equal(fs.existsSync(e.file), false);
  });

  it('설정 파일이 깨졌으면 종료 코드 1이고 파일 내용을 바꾸지 않는다', () => {
    const e = setup({ claudeMd: lines(100), config: '{' });
    const r = done(e);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /설정 파일이 깨져/);
    assert.equal(fs.readFileSync(e.file, 'utf8'), '{');
  });
});

describe('subagent-retro.js --check 실행', () => {
  const GUIDE = ['| | low | medium | high | xhigh |', '|:---|:---|:---|:---|:---|', '| **Sonnet** | 번역 | 구현 | | |'].join('\n');
  const agent = (description) => `---\nname: x\ndescription: ${description}\n---\n본문\n`;
  const setup = ({ usage, agents }) => {
    const root = tmpDir();
    fs.writeFileSync(path.join(root, 'routing.md'), GUIDE);
    fs.mkdirSync(path.join(root, 'agents'));
    for (const [def, text] of Object.entries(agents)) fs.writeFileSync(path.join(root, 'agents', `${def}.md`), text);
    fs.mkdirSync(path.join(root, 'records'));
    if (usage) fs.writeFileSync(path.join(root, 'records', 'subagent-usage.tsv'), usage);
    return root;
  };
  const run = (root, args = ['--check'], config = process.env.SUBAGENT_CONFIG_FILE) =>
    spawnSync(process.execPath, [RETRO, ...args], {
      env: { ...process.env, SUBAGENT_RECORDS_DIR: path.join(root, 'records'), SUBAGENT_ROUTING_FILE: path.join(root, 'routing.md'), SUBAGENT_AGENTS_DIR: path.join(root, 'agents'), SUBAGENT_CONFIG_FILE: config },
      encoding: 'utf8',
    });
  const good = { 'sonnet-low': agent('성격. 번역. (`g`)'), 'sonnet-medium': agent('성격. 구현. (`g`)') };
  const line = (def, kind, result = 'ok') => ['2026-10-12', '/p', def, kind, 1, 2, 3, result, 'a1 메모'].join('\t') + '\n';

  it('문제가 없으면 문제 없음을 찍고 종료 코드 0이다', () => {
    const r = run(setup({ usage: line('sonnet-low', '번역'), agents: good }));
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /문제 없음/);
  });

  it('config.json의 removedDefs에 든 정의의 칸에 일이 있으면 정의 파일 없음이 아니라 별도 문제로 찍고 종료 코드 1이다', () => {
    const root = setup({ usage: null, agents: { 'sonnet-low': good['sonnet-low'] } });
    assert.equal(run(root).status, 1);
    const config = path.join(root, 'config.json');
    fs.writeFileSync(config, JSON.stringify({ removedDefs: ['sonnet-medium'] }));
    const r = run(root, ['--check'], config);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /sonnet-medium: removedDefs에 있는데 표의 그 칸에 일이 있습니다[^\n]*칸의 일: 구현/);
    assert.doesNotMatch(r.stdout, /sonnet-medium\.md/);
    assert.match(r.stdout, /문제 1건/);
  });

  it('removedDefs에 든 정의가 표의 칸에 일이 없으면 --check는 문제로 세지 않는다', () => {
    const root = setup({ usage: null, agents: good });
    const config = path.join(root, 'config.json');
    fs.writeFileSync(config, JSON.stringify({ removedDefs: ['haiku-high'] }));
    const r = run(root, ['--check'], config);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /문제 없음/);
  });

  it('다른 정의로 보낸 기록이 있으면 일 종류와 정의와 건수와 마지막 날짜를 찍고 종료 코드 1이다', () => {
    const r = run(setup({ usage: line('opus-medium', '번역') + line('opus-medium', '번역'), agents: good }));
    assert.equal(r.status, 1);
    assert.match(r.stdout, /번역  opus-medium 2건  표의 칸 sonnet-low  마지막 2026-10-12/);
    assert.match(r.stdout, /문제 1건/);
  });
});

describe('subagent-retro.js 회고 방식과 잠금 실행', () => {
  const setup = () => {
    const root = tmpDir();
    const dir = path.join(root, 'records');
    fs.mkdirSync(dir);
    return { root, dir, config: path.join(root, 'config.json'), lock: path.join(dir, 'retro.lock'), proposals: path.join(root, 'PROPOSALS.md'), usage: path.join(dir, 'subagent-usage.tsv') };
  };
  const run = (args, e) => spawnSync(process.execPath, [RETRO, ...args], { env: { ...process.env, SUBAGENT_RECORDS_DIR: e.dir, SUBAGENT_CONFIG_FILE: e.config, SUBAGENT_PROPOSALS_FILE: e.proposals }, encoding: 'utf8' });
  const lines = (n) => Array.from({ length: n }, (_, i) => `2026-10-12\t/p\tsonnet-low\t번역\t1\t2\t3\tok\ta${i} 줄`).join('\n') + '\n';
  const first = (e) => run(['--due'], e).stdout.split('\n')[0];
  const ago = (file, ms) => {
    const t = new Date(Date.now() - ms);
    fs.utimesSync(file, t, t);
  };
  const HOUR = 3600 * 1000;

  it('--retro-mode auto는 회사용(ask)에서 값을 저장하고 바뀐 값을 찍으며, 개인용(auto)이 된 뒤에는 인자 없이 읽어도 바꾸지 않고 알리기만 한다', () => {
    const e = setup();
    fs.writeFileSync(e.config, JSON.stringify({ profile: 'company', retroMode: 'ask' }));
    assert.equal(run(['--retro-mode', 'auto'], e).stdout.trim(), 'auto');
    assert.deepEqual(JSON.parse(fs.readFileSync(e.config, 'utf8')), { profile: 'company', retroMode: 'auto' });
    fs.writeFileSync(e.config, JSON.stringify({ profile: 'personal', retroMode: 'auto' }));
    for (const args of [['--retro-mode'], ['--retro-mode', 'ask']]) {
      const r = run(args, e);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /개인용이라/);
      assert.match(r.stdout, /set-profile company/);
    }
    assert.deepEqual(JSON.parse(fs.readFileSync(e.config, 'utf8')), { profile: 'personal', retroMode: 'auto' });
  });

  it('회사용(profile company)이 retroMode auto로 돌고 있어도 --retro-mode ask를 받아 저장한다', () => {
    const e = setup();
    fs.writeFileSync(e.config, JSON.stringify({ retroMode: 'auto', profile: 'company' }));
    const r = run(['--retro-mode', 'ask'], e);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), 'ask');
    assert.deepEqual(JSON.parse(fs.readFileSync(e.config, 'utf8')), { retroMode: 'ask', profile: 'company' });
  });

  it('--retro-mode를 바꿔도 commandName 같은 다른 키는 그대로 남는다', () => {
    const e = setup();
    fs.writeFileSync(e.config, JSON.stringify({ retroMode: 'ask', commandName: 'huigo' }));
    run(['--retro-mode', 'auto'], e);
    assert.deepEqual(JSON.parse(fs.readFileSync(e.config, 'utf8')), { retroMode: 'auto', commandName: 'huigo' });
  });

  it('auto와 ask 밖의 값은 종료 코드 1이고 설정 파일을 바꾸지 않는다', () => {
    const e = setup();
    fs.writeFileSync(e.config, '{"retroMode":"ask"}');
    for (const bad of ['on', 'AUTO', '']) {
      const r = run(['--retro-mode', bad], e);
      assert.equal(r.status, 1, bad);
      assert.match(r.stderr, /ask 또는 auto/);
    }
    assert.equal(fs.readFileSync(e.config, 'utf8'), '{"retroMode":"ask"}');
  });

  it('회고할 때가 됐고 모드가 auto이면 --due 첫 줄이 auto이고 둘째 줄부터 형식은 ask일 때와 같다', () => {
    const e = setup();
    fs.writeFileSync(e.usage, lines(30));
    const asked = run(['--due'], e).stdout;
    assert.equal(asked.split('\n')[0], 'ask');
    run(['--retro-mode', 'auto'], e);
    const auto = run(['--due'], e).stdout;
    assert.equal(auto.split('\n')[0], 'auto');
    assert.equal(auto.split('\n').slice(1).join('\n'), asked.split('\n').slice(1).join('\n'));
  });

  it('auto여도 기준에 못 미치면 wait이고, 올림이 쌓인 칸이 있으면 auto이며 둘째 줄에 칸이 나온다', () => {
    const e = setup();
    run(['--retro-mode', 'auto'], e);
    fs.writeFileSync(e.usage, lines(5));
    assert.equal(first(e), 'wait 25');
    fs.appendFileSync(e.usage, ['a', 'b'].map((m) => `2026-10-12\t/p\tsonnet-low\t번역\t1\t2\t3\t올림\t${m} 줄`).join('\n') + '\n');
    const out = run(['--due'], e).stdout.split('\n');
    assert.equal(out[0], 'auto');
    assert.match(out[1], /올림 에이전트 2명: sonnet-low \/ 번역/);
  });

  it('--claim은 처음에 ok이고 잠금 파일을 만들며, 이미 있으면 busy이고 잠금은 그대로다', () => {
    const e = setup();
    assert.equal(run(['--claim'], e).stdout.trim(), 'ok');
    assert.equal(fs.existsSync(e.lock), true);
    const before = fs.readFileSync(e.lock, 'utf8');
    assert.equal(run(['--claim'], e).stdout.trim(), 'busy');
    assert.equal(fs.readFileSync(e.lock, 'utf8'), before);
  });

  it('3시간이 안 된 잠금은 busy이고, 3시간이 넘은 잠금은 버려진 것으로 보고 다시 잡아 ok이다', () => {
    const e = setup();
    run(['--claim'], e);
    ago(e.lock, 3 * HOUR - 60 * 1000);
    assert.equal(run(['--claim'], e).stdout.trim(), 'busy');
    ago(e.lock, 3 * HOUR + 60 * 1000);
    assert.equal(run(['--claim'], e).stdout.trim(), 'ok');
    assert.ok(Date.now() - fs.statSync(e.lock).mtimeMs < HOUR, '새로 잡은 잠금은 오래된 시각이 아니어야 한다');
    assert.equal(run(['--claim'], e).stdout.trim(), 'busy');
  });

  it('잠금이 살아 있으면 --due는 ask가 될 때여도 wait이고 마지막 줄에 회고 진행 중이 보이며, 3시간이 넘으면 다시 auto다', () => {
    const e = setup();
    fs.writeFileSync(e.usage, lines(30));
    run(['--retro-mode', 'auto'], e);
    run(['--claim'], e);
    const out = run(['--due'], e).stdout.trim().split('\n');
    assert.match(out[0], /^wait /);
    assert.match(out.at(-1), /회고 진행 중/);
    ago(e.lock, 4 * HOUR);
    const stale = run(['--due'], e).stdout.trim().split('\n');
    assert.equal(stale[0], 'auto');
    assert.doesNotMatch(stale.at(-1), /회고 진행 중/);
  });

  it('--release는 잠금만 풀고 있었는지를 released 또는 none으로 찍으며, 푼 뒤에는 다시 --claim이 ok다', () => {
    const e = setup();
    fs.writeFileSync(e.usage, lines(3));
    run(['--claim'], e);
    assert.equal(run(['--release'], e).stdout.trim(), 'released');
    assert.equal(fs.existsSync(e.lock), false);
    assert.equal(fs.readFileSync(e.usage, 'utf8'), lines(3));
    assert.equal(run(['--release'], e).stdout.trim(), 'none');
    assert.equal(run(['--claim'], e).stdout.trim(), 'ok');
  });

  describe('자동 회고 연속 실패', () => {
    const cfg = (e) => JSON.parse(fs.readFileSync(e.config, 'utf8'));
    const markMsgs = (e, n) => {
      const msgs = path.join(e.root, 'msgs.tsv');
      fs.writeFileSync(msgs, `# 사용 줄\t${n}\n# 추출 시각\t2026-10-13T00:00:00.000Z\n`);
      return msgs;
    };

    it('첫 번째 실패 뒤에는 auto를 유지하고 횟수 1을 config.json에 남기며 --status가 횟수를 보인다', () => {
      const e = setup();
      run(['--retro-mode', 'auto'], e);
      run(['--claim'], e);
      const r = run(['--release', '--failed'], e);
      assert.equal(r.stdout.split('\n')[0], 'released');
      assert.match(r.stdout, /연속 실패 1회/);
      assert.deepEqual(cfg(e), { retroMode: 'auto', retroFailures: 1 });
      assert.equal(fs.existsSync(e.lock), false);
      assert.match(run(['--status'], e).stdout, /자동 회고 연속 실패: 1회/);
    });

    it('두 번 이어 실패하면 ask로 돌아가고 그 사실과 다시 켜는 법을 찍으며, 다른 키는 그대로이고 횟수 키는 남지 않는다', () => {
      const e = setup();
      fs.writeFileSync(e.config, JSON.stringify({ retroMode: 'auto', commandName: 'huigo' }));
      run(['--release', '--failed'], e);
      const r = run(['--release', '--failed'], e);
      assert.match(r.stdout, /두 번 이어 실패해 묻기 방식으로 돌아갔습니다/);
      assert.match(r.stdout, /\/huigo auto/);
      assert.deepEqual(cfg(e), { retroMode: 'ask', commandName: 'huigo' });
      assert.equal(run(['--retro-mode'], e).stdout.trim(), 'ask');
      assert.doesNotMatch(run(['--status'], e).stdout, /연속 실패/);
    });

    it('--mark가 성공하면 횟수가 0으로 돌아가 다음 실패가 다시 1회부터다', () => {
      const e = setup();
      fs.writeFileSync(e.usage, lines(3));
      run(['--retro-mode', 'auto'], e);
      run(['--release', '--failed'], e);
      assert.equal(cfg(e).retroFailures, 1);
      const r = run(['--mark', '메모', '--messages', markMsgs(e, 3), '--changed', '0'], e);
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(cfg(e), { retroMode: 'auto' });
      assert.match(run(['--release', '--failed'], e).stdout, /연속 실패 1회/);
    });

    it('두 번 이어 실패해 묻기로 돌아간 뒤 안내대로 --slash auto를 치면 다시 auto가 되고 실패 횟수 키가 남지 않는다', () => {
      const e = setup();
      fs.writeFileSync(e.config, JSON.stringify({ retroMode: 'auto', commandName: 'huigo' }));
      run(['--release', '--failed'], e);
      run(['--release', '--failed'], e);
      assert.match(run(['--slash', 'auto'], e).stdout, /ask에서 auto로 바꿨습니다/);
      assert.deepEqual(cfg(e), { retroMode: 'auto', commandName: 'huigo' });
    });

    it('묻기로 돌아간 뒤 --retro-mode auto로 다시 켜면 횟수가 0으로 돌아간다', () => {
      const e = setup();
      fs.writeFileSync(e.config, JSON.stringify({ retroMode: 'ask', retroFailures: 1 }));
      run(['--retro-mode', 'auto'], e);
      assert.deepEqual(cfg(e), { retroMode: 'auto' });
    });
  });

  it('--mark는 회고 표시 줄을 남길 때 잠금을 풀고, 표시를 못 남기고 실패하면 잠금을 그대로 둔다', () => {
    const e = setup();
    fs.writeFileSync(e.usage, lines(3));
    const msgs = path.join(e.root, 'msgs.tsv');
    fs.writeFileSync(msgs, '# 사용 줄\t3\n# 추출 시각\t2026-10-13T00:00:00.000Z\n');
    run(['--claim'], e);
    assert.equal(run(['--mark', '메모', '--messages', msgs, '--changed', 'x'], e).status, 1);
    assert.equal(fs.existsSync(e.lock), true);
    const r = run(['--mark', '메모', '--messages', msgs, '--changed', '1'], e);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /잠금을 풀었습니다/);
    assert.equal(fs.existsSync(e.lock), false);
  });

  const PROPOSALS = [
    '# 제안', '', '## 제안', '',
    '### 요율 더하기', '- 얻는 것: x', '- 잃는 것: y',
    '### 정책 바꾸기', '- 묻기: 정책', '본문에 ### 가 들어 있어도 줄머리가 아니면 세지 않는다',
    '### 문지기 풀기', '  - 묻기: 문지기 풀기',
    '', '## 반대', '', '### 지난 반대', '- 묻기: 돈', '',
  ].join('\n');

  it('제안 목록의 `## 제안` 절 항목을 회사용(ask)은 전부 세고 --due 마지막 줄에 보이며, 파일이 없거나 항목이 없으면 보이지 않는다', () => {
    const e = setup();
    const last = () => run(['--due'], e).stdout.trim().split('\n').at(-1);
    assert.doesNotMatch(last(), /물을 것/);
    fs.writeFileSync(e.proposals, PROPOSALS);
    assert.match(last(), /물을 것 3건/);
    fs.writeFileSync(e.proposals, '## 제안\n\n## 반대\n### 지난 반대\n');
    assert.doesNotMatch(last(), /물을 것/);
  });

  it('개인용은 묻기 줄이 있는 항목만 세고, 회사용은 전부 세며, 옛 판정 키가 config에 남아 있어도 읽지 않는다', () => {
    const e = setup();
    const last = () => run(['--due'], e).stdout.trim().split('\n').at(-1);
    fs.writeFileSync(e.proposals, PROPOSALS);
    fs.writeFileSync(e.config, JSON.stringify({ retroMode: 'auto', profile: 'personal' }));
    assert.match(last(), /물을 것 2건/);
    fs.writeFileSync(e.config, JSON.stringify({ retroMode: 'auto', profile: 'personal', autoApplyRules: false, autoCreate: false }));
    assert.match(last(), /물을 것 2건/);
    fs.writeFileSync(e.config, JSON.stringify({ retroMode: 'ask', profile: 'company', autoApplyRules: true }));
    assert.match(last(), /물을 것 3건/);
  });

  it('잠금이 잡힌 동안 --due는 물을 것을 붙이지 않고, 잠금이 없으면 붙인다', () => {
    const e = setup();
    fs.writeFileSync(e.proposals, PROPOSALS);
    const last = () => run(['--due'], e).stdout.trim().split('\n').at(-1);
    assert.match(last(), /물을 것 3건/);
    run(['--claim'], e);
    assert.match(last(), /회고 진행 중/);
    assert.doesNotMatch(last(), /물을 것/);
    run(['--release'], e);
    assert.match(last(), /물을 것 3건/);
  });

  it('--status는 아무것도 쓰지 않고 방식, 시점, 잠금, 물을 것을 찍는다', () => {
    const e = setup();
    fs.writeFileSync(e.usage, lines(30));
    fs.writeFileSync(e.config, JSON.stringify({ profile: 'personal', retroMode: 'auto' }));
    fs.writeFileSync(e.proposals, PROPOSALS);
    const configBefore = fs.readFileSync(e.config, 'utf8');
    const out = run(['--status'], e).stdout;
    assert.match(out, /회고 방식: 자동\(auto\)/);
    assert.match(out, /회고 시점: 회고할 때입니다\(auto/);
    assert.match(out, /회고 잠금: 없음/);
    assert.match(out, /물을 것\(사용자에게 묻는 여섯 종만\): 2건/);
    assert.equal(fs.existsSync(e.lock), false);
    assert.equal(fs.readFileSync(e.config, 'utf8'), configBefore);
    run(['--claim'], e);
    assert.match(run(['--status'], e).stdout, /회고 잠금: 진행 중/);
  });

  it('--status는 바로 고치기와 애매할 때의 문턱을 profile에서 낸 값으로 찍고, 설정 파일이 없으면 회사용 쪽으로 보며, 옛 판정 키는 읽지 않는다', () => {
    const e = setup();
    const lines = () => {
      const out = run(['--status'], e).stdout;
      return { fix: out.match(/^바로 고치기: (.*)$/m)[1], threshold: out.match(/^애매할 때: (.*)$/m)[1] };
    };
    assert.deepEqual(lines(), { fix: '끔 (profile이 정함)', threshold: '되돌리는 비용이 거의 없는 것만 하고 나머지는 묻기 (profile이 정함)' });
    fs.writeFileSync(e.config, JSON.stringify({ profile: 'personal' }));
    assert.deepEqual(lines(), { fix: '켬 (profile이 정함)', threshold: '작으면 하고 알림 (profile이 정함)' });
    fs.writeFileSync(e.config, JSON.stringify({ profile: 'personal', autoApplyRules: false, actThreshold: 'low-cost-only' }));
    assert.deepEqual(lines(), { fix: '켬 (profile이 정함)', threshold: '작으면 하고 알림 (profile이 정함)' });
    fs.writeFileSync(e.config, '{깨짐');
    assert.deepEqual(lines(), { fix: '끔 (profile이 정함)', threshold: '되돌리는 비용이 거의 없는 것만 하고 나머지는 묻기 (profile이 정함)' });
  });

  it('제안 목록 경로는 설정 폴더(CLAUDE_CONFIG_DIR) 아래 docs/PROPOSALS.md이다', () => {
    const e = setup();
    const claude = path.join(e.root, 'claude');
    fs.mkdirSync(path.join(claude, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(claude, 'docs', 'PROPOSALS.md'), '## 제안\n### a\n### b\n');
    const env = { ...process.env, SUBAGENT_RECORDS_DIR: e.dir, SUBAGENT_CONFIG_FILE: e.config, CLAUDE_CONFIG_DIR: claude };
    delete env.SUBAGENT_PROPOSALS_FILE;
    assert.match(spawnSync(process.execPath, [RETRO, '--due'], { env, encoding: 'utf8' }).stdout, /물을 것 2건/);
  });

  it('회고 방식이 auto이면 --snooze는 미룰 질문이 없다고 알리고 종료 코드 0이며 사용 기록을 건드리지 않는다', () => {
    const e = setup();
    fs.writeFileSync(e.config, '{"retroMode":"auto"}');
    fs.writeFileSync(e.usage, lines(30));
    const r = run(['--snooze'], e);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /묻기\(ask\)일 때만/);
    assert.equal(fs.readFileSync(e.usage, 'utf8'), lines(30));
  });

  it('--slash는 인자가 없으면 상태, auto와 ask는 바꾼 뒤 상태, now는 상태와 요청 줄, 그 밖은 사용법을 찍고 모두 종료 코드 0이다', () => {
    const e = setup();
    fs.writeFileSync(e.config, JSON.stringify({ retroMode: 'ask', profile: 'company' }));
    fs.writeFileSync(e.usage, lines(3));
    const plain = run(['--slash', ''], e);
    assert.equal(plain.status, 0);
    assert.match(plain.stdout, /회고 방식: 묻기\(ask\)/);
    const auto = run(['--slash', 'auto'], e);
    assert.equal(auto.status, 0);
    assert.match(auto.stdout, /ask에서 auto로 바꿨습니다/);
    assert.match(auto.stdout, /회고 방식: 자동\(auto\)/);
    assert.match(run(['--slash', 'auto'], e).stdout, /이미 auto입니다/);
    assert.match(run(['--slash', ' ask '], e).stdout, /auto에서 ask로 바꿨습니다/);
    const now = run(['--slash', 'now'], e);
    assert.match(now.stdout, /요청: 지금 회고\(now\), 회고 방식 ask/);
    for (const bad of ['뭐', '--due', 'auto now']) {
      const r = run(['--slash', bad], e);
      assert.equal(r.status, 0, bad);
      assert.match(r.stdout, /사용법/);
    }
    assert.equal(run(['--retro-mode'], e).stdout.trim(), 'ask');
  });

  it('개인용(profile personal)에서 --slash ask는 설정을 바꾸지 않고 set-profile company만 알리며, auto는 그대로 받는다', () => {
    const e = setup();
    fs.writeFileSync(e.config, JSON.stringify({ retroMode: 'auto', profile: 'personal' }));
    const r = run(['--slash', 'ask'], e);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /set-profile company/);
    assert.deepEqual(JSON.parse(fs.readFileSync(e.config, 'utf8')), { retroMode: 'auto', profile: 'personal' });
    fs.writeFileSync(e.config, JSON.stringify({ retroMode: 'ask', profile: 'personal' }));
    assert.match(run(['--slash', 'auto'], e).stdout, /ask에서 auto로 바꿨습니다/);
  });

  it('사용 기록이 없으면 --slash now는 상태와 함께 회고하지 않는다고 알리고 요청 줄을 찍지 않는다', () => {
    const e = setup();
    const r = run(['--slash', 'now'], e);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /회고 방식: 묻기\(ask\)/);
    assert.match(r.stdout, /사용 기록이 없어 회고하지 않습니다/);
    assert.doesNotMatch(r.stdout, /요청: 지금 회고/);
    fs.writeFileSync(e.config, JSON.stringify({ retroMode: 'ask', commandName: 'huigo' }));
    assert.match(run(['--slash', 'now'], e).stdout, /\/huigo now/);
  });
});

describe('subagent-retro.js --repeats 실행', () => {
  // 로컬 시각으로 만든다. UTC 고정 시각이면 UTC보다 빠른 시간대에서 로컬 날짜가 하루 밀려 --since 경계가 어긋난다.
  const at = (day, hour = 12) => new Date(2026, 9, day, hour).toISOString();
  const human = (day, text) => ({ type: 'user', origin: { kind: 'human' }, timestamp: at(day), message: { content: text } });
  const bash = (day, id, command) => ({ type: 'assistant', timestamp: at(day), message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } });
  const agent = (day, id, prompt) => ({ type: 'assistant', timestamp: at(day), message: { content: [{ type: 'tool_use', id, name: 'Agent', input: { prompt } }] } });
  const result = (id, text) => ({ type: 'user', timestamp: at(20), message: { content: [{ type: 'tool_result', tool_use_id: id, content: text }] } });
  const uuid = (n) => `${String(n).repeat(8)}-1111-1111-1111-${String(n).repeat(12)}`;

  // CLAUDE_CONFIG_DIR을 가짜 projects 폴더로 돌려 실제 대화 기록을 읽지 않게 한다.
  const setup = (sessions, usage = null) => {
    const root = tmpDir();
    fs.mkdirSync(path.join(root, 'records'));
    if (usage) fs.writeFileSync(path.join(root, 'records', 'subagent-usage.tsv'), usage);
    sessions.forEach(({ project, lines }, i) => {
      const dir = path.join(root, 'cfg', 'projects', `-p${project}`);
      fs.mkdirSync(dir, { recursive: true });
      const head = { type: 'user', cwd: `/p/${project}`, origin: { kind: 'system' }, timestamp: at(1), message: { content: 'x' } };
      fs.writeFileSync(path.join(dir, `${uuid(i + 1)}.jsonl`), [head, ...lines].map((l) => JSON.stringify(l)).join('\n') + '\n');
    });
    return root;
  };
  const run = (root, args = [], config = process.env.SUBAGENT_CONFIG_FILE) =>
    spawnSync(process.execPath, [RETRO, '--repeats', ...args], {
      env: { ...process.env, CLAUDE_CONFIG_DIR: path.join(root, 'cfg'), SUBAGENT_RECORDS_DIR: path.join(root, 'records'), SUBAGENT_CONFIG_FILE: config },
      encoding: 'utf8',
    });
  const usage = (...extra) => ['2026-10-05\t/p/a\tsonnet-medium\t구현\t1\t1\t1\tok\ta1 m', ...extra].join('\n') + '\n';
  const TEST = (name) => `cd /p/x && npm test -- --grep "${name}" 2>&1 | tail -30`;
  const REVIEW = (n) => `이 문서 검토해 줘 DOC-${n} 초안 확인하고`;

  it('세 종류가 각각 집계되고 어림 토큰과 세션 수와 프로젝트 수가 찍힌다', () => {
    const root = setup([
      { project: 'a', lines: [human(10, REVIEW(1)), bash(10, 'b1', TEST('A')), result('b1', 'x'.repeat(300)), agent(10, 'g1', '## 할 일\n\n---\n코드 리뷰를 해 주세요 1\n본문'), human(11, REVIEW(2)), bash(11, 'b2', TEST('B'))] },
      { project: 'b', lines: [human(12, REVIEW(3)), bash(12, 'b3', TEST('C')), agent(12, 'g2', '## 할 일\n\n코드 리뷰를 해 주세요 2'), agent(12, 'g3', '## 할 일\n\n---\n코드 리뷰를 해 주세요 3')] },
    ], usage());
    const r = run(root, ['--since', '2026-10-05']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /대화 2개, 사용자 메시지 3개, Bash 명령 3개, Agent 지시문 3개/);
    assert.match(r.stdout, /사용자 지시[^\n]*\n[^\n]*횟수[^\n]*어림 토큰[^\n]*\n3 +2 +2 +\d+ +이 문서 검토해 줘 doc-N 초안 확인하고/);
    assert.match(r.stdout, /Bash 명령[^\n]*\n[^\n]*\n3 +2 +2 +\d+ +cd <경로> && npm test -- --grep <문자열>/);
    assert.match(r.stdout, /Agent 지시문[^\n]*\n[^\n]*\n3 +2 +2 +\d+ +코드 리뷰를 해 주세요 N/);
  });

  const writeConfig = (root, o) => {
    const file = path.join(root, 'config.json');
    fs.writeFileSync(file, JSON.stringify(o));
    return file;
  };
  const lines = (day) => [human(day, REVIEW(day)), bash(day, `b${day}`, TEST(`T${day}`))];

  it('마지막 실행에서 30일이 안 지났으면 대화 기록을 읽지 않고 다음 날짜를 알리며 설정 파일을 바꾸지 않는다', () => {
    const root = setup([{ project: 'a', lines: lines(10) }]);
    const config = writeConfig(root, { retroMode: 'ask', repeatsRunDate: '2026-09-14' });
    const r = run(root, [], config);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /2026-09-14[^\n]*2026-10-14/);
    assert.doesNotMatch(r.stdout, /반복 찾기\(어림/);
    assert.equal(fs.readFileSync(config, 'utf8'), JSON.stringify({ retroMode: 'ask', repeatsRunDate: '2026-09-14' }));
  });

  it('마지막 실행에서 정확히 30일이 지났으면 돌고 repeatsRunDate만 오늘로 바꾼다', () => {
    const root = setup([{ project: 'a', lines: lines(10) }]);
    const config = writeConfig(root, { retroMode: 'ask', removedDefs: ['x'], repeatsRunDate: '2026-09-13' });
    const r = run(root, [], config);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /반복 찾기\(어림/);
    assert.deepEqual(JSON.parse(fs.readFileSync(config, 'utf8')), { retroMode: 'ask', removedDefs: ['x'], repeatsRunDate: '2026-10-13' });
  });

  it('--since를 주면 30일이 안 지났어도 돌고 repeatsRunDate를 바꾸지 않는다', () => {
    const root = setup([{ project: 'a', lines: lines(10) }]);
    const config = writeConfig(root, { repeatsRunDate: '2026-10-12' });
    const r = run(root, ['--since', '2026-10-05'], config);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /반복 찾기\(어림/);
    assert.deepEqual(JSON.parse(fs.readFileSync(config, 'utf8')), { repeatsRunDate: '2026-10-12' });
  });
});

describe('subagent-retro.js 시험 표시, 표 모양, 최저선 제안 실행', () => {
  const table = (cell) => ['| | low | medium | high | xhigh |', '|:---|:---|:---|:---|:---|', `| **Sonnet** | ${cell} | 구현 | | |`].join('\n');
  const TRIAL = '번역 「(시험: 다음 1건 `haiku-high`)」';
  const setup = (guide, usage = '') => {
    const root = tmpDir();
    fs.writeFileSync(path.join(root, 'routing.md'), guide);
    fs.mkdirSync(path.join(root, 'records'));
    fs.writeFileSync(path.join(root, 'records', 'subagent-usage.tsv'), usage);
    return root;
  };
  const run = (args, root) =>
    spawnSync(process.execPath, [RETRO, ...args], {
      env: { ...process.env, SUBAGENT_RECORDS_DIR: path.join(root, 'records'), SUBAGENT_ROUTING_FILE: path.join(root, 'routing.md'), SUBAGENT_CONFIG_FILE: path.join(root, 'config.json') },
      encoding: 'utf8',
    });
  const line = (def, kind, result, id) => ['2026-10-12', '/p', def, kind, 1, 2, 3, result, `${id} 메모`].join('\t') + '\n';
  const usageFile = (root) => path.join(root, 'records', 'subagent-usage.tsv');
  const mark = (root, changed = '0') => {
    const lines = fs.readFileSync(usageFile(root), 'utf8').split('\n').filter(Boolean).length;
    const msgs = path.join(root, 'msgs.tsv');
    fs.writeFileSync(msgs, `# 사용 줄\t${lines}\n# 추출 시각\t2026-10-13T00:00:00.000Z\n`);
    return run(['--mark', '메모', '--messages', msgs, '--changed', changed], root);
  };

  it('--mark는 표의 칸, 시험 표시, 최저선을 회고 표시 줄 여덟째 열에 남기고 그 사실을 찍는다', () => {
    const root = setup(table(`${TRIAL}, 요약 「(최저: sonnet-low)」`), line('sonnet-low', '번역', 'ok', 'a1'));
    const r = mark(root);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /표 모양을 같은 줄에 남겼습니다\(시험 표시 1개, 최저선 1개\)/);
    const cols = fs.readFileSync(usageFile(root), 'utf8').trim().split('\n').at(-1).split('\t');
    assert.equal(cols.length, 9);
    assert.deepEqual(JSON.parse(cols[7]), { 칸: [['sonnet-low', '번역'], ['sonnet-low', '요약'], ['sonnet-medium', '구현']], 시험: [['번역', 'haiku-high']], 최저: [['요약', 'sonnet-low']] });
  });

  it('--status는 시험 표시마다 마지막 회고 뒤 그 정의 기록이 없으면 대기, 있으면 보냄을 찍는다', () => {
    const root = setup(table(TRIAL), line('sonnet-low', '번역', 'ok', 'a1'));
    assert.match(run(['--status'], root).stdout, /시험 표시: sonnet-low \/ 번역 → haiku-high 대기\(이 구간 안 0건\)/);
    fs.appendFileSync(usageFile(root), line('haiku-high', '번역', 'ok', 't1'));
    assert.match(run(['--status'], root).stdout, /시험 표시: sonnet-low \/ 번역 → haiku-high 보냄\(이 구간 안 1건\)/);
    fs.appendFileSync(usageFile(root), line('haiku-high', '번역', 'ok', 't2'));
    assert.match(run(['--status'], root).stdout, /haiku-high 보냄\(이 구간 안 2건\)/);
    mark(root);
    assert.match(run(['--status'], root).stdout, /haiku-high 대기/, '회고 뒤에는 다시 대기');
  });

  it('회고 출력은 시험 판정, 내림 실패, 최저선 제안을 찍는다', () => {
    const lowered = table('번역').replace('| **Sonnet** | 번역 |', '| **Haiku** | | | 번역 | |\n| **Sonnet** | |');
    const root = setup(table('번역'), line('sonnet-low', '번역', 'ok', 'a1'));
    mark(root, '0');
    fs.writeFileSync(path.join(root, 'routing.md'), lowered);
    mark(root, '1');
    fs.appendFileSync(usageFile(root), line('haiku-high', '번역', '올림', 'a2'));
    fs.writeFileSync(path.join(root, 'routing.md'), table('번역'));
    mark(root, '1');
    fs.writeFileSync(path.join(root, 'routing.md'), table(TRIAL));
    mark(root, '0');
    fs.appendFileSync(usageFile(root), line('haiku-high', '번역', '올림', 't1'));
    const r = run(['--report'], root);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /시험 표시[^\n]*\n {2}sonnet-low \/ 번역 → haiku-high {2}보냄\(t1\) {2}판정: 실패\(올림 또는 정정\)/);
    assert.match(r.stdout, /내림 실패[^\n]*\n {2}번역 {2}1번\(실패한 정의 haiku-high\)/);
    assert.match(r.stdout, /최저선 제안[^\n]*\n {2}sonnet-low \/ 번역 {2}내림 실패 2번\(앞서 1번, 이번 haiku-high 시험 실패\) {2}최저선을 sonnet-low 정의로 두자고 제안/);
  });
});

describe('subagent-retro.js 섞인 칸, 최저선 다시 시험, 판정 불가 실행', () => {
  const HEAD = ['| | low | medium | high | xhigh |', '|:---|:---|:---|:---|:---|'];
  const guideOf = (row) => [...HEAD, row].join('\n');
  const setup = (guide, usage = '') => {
    const root = tmpDir();
    fs.writeFileSync(path.join(root, 'routing.md'), guide);
    fs.mkdirSync(path.join(root, 'records'));
    fs.writeFileSync(path.join(root, 'records', 'subagent-usage.tsv'), usage);
    return root;
  };
  const run = (args, root) =>
    spawnSync(process.execPath, [RETRO, ...args], {
      env: { ...process.env, CLAUDE_CONFIG_DIR: path.join(root, 'claude'), SUBAGENT_RECORDS_DIR: path.join(root, 'records'), SUBAGENT_ROUTING_FILE: path.join(root, 'routing.md'), SUBAGENT_CONFIG_FILE: path.join(root, 'config.json') },
      encoding: 'utf8',
    });
  const line = (def, kind, result, id, secs = 3) => ['2026-10-12', '/p', def, kind, 1, 2, secs, result, `${id} 메모`].join('\t') + '\n';
  const costLine = (id, def, cost, session = 'sess-1', model = 'claude-x') => ['2026-10-12', '/p', session, id, def, model, 'low', '설명', 1, 0, 0, 1, 1, 3, cost].join('\t') + '\n';
  const usageFile = (root) => path.join(root, 'records', 'subagent-usage.tsv');
  const mark = (root) => {
    const lines = fs.readFileSync(usageFile(root), 'utf8').split('\n').filter(Boolean).length;
    const msgs = path.join(root, 'msgs.tsv');
    fs.writeFileSync(msgs, `# 사용 줄\t${lines}\n# 추출 시각\t2026-10-13T00:00:00.000Z\n`);
    const r = run(['--mark', '메모', '--messages', msgs, '--changed', '0'], root);
    assert.equal(r.status, 0, r.stderr);
  };

  it('섞인 칸을 실패와 성공의 agentId, 대화 기록 위치와 함께 찍는다', () => {
    const usage = [line('sonnet-low', '번역', '올림', 'f1'), line('sonnet-low', '번역', '올림', 'f2'), line('sonnet-low', '번역', 'ok', 'o1'), line('sonnet-low', '번역', 'ok', 'o2'), line('sonnet-low', '번역', 'ok', 'o3')].join('');
    const root = setup(guideOf('| **Sonnet** | 번역 | | | |'), usage);
    fs.writeFileSync(path.join(root, 'records', 'subagent-cost.tsv'), costLine('f1', 'sonnet-low', '0.01'));
    const transcript = path.join(root, 'claude', 'projects', '-p', 'sess-1', 'subagents', 'agent-f1.jsonl');
    fs.mkdirSync(path.dirname(transcript), { recursive: true });
    fs.writeFileSync(transcript, '{}\n');
    const out = run(['--report'], root).stdout;
    assert.match(out, /섞인 칸[^\n]*\n {2}sonnet-low \/ 번역 {2}실패 2건, 성공 3건\n/);
    assert.ok(out.includes(`    실패 f1(sonnet-low)  ${transcript}`), out);
    assert.ok(out.includes('    실패 f2(sonnet-low)  비용 기록에 세션이 없어 대화 기록 위치 모름'));
    assert.ok(out.includes('    성공 o1(sonnet-low)'));
  });

  it('최저선을 단 뒤 회고 2번째에 다시 시험을 제안하고, 시험을 걸면 --status에 보이며, 통과하면 최저선 내리기를 제안한다', () => {
    const floored = '| **Sonnet** | | 번역 「(최저: sonnet-low)」 | | |';
    const root = setup(guideOf(floored), line('sonnet-medium', '번역', 'ok', 'a1'));
    mark(root);
    let out = run(['--report'], root).stdout;
    assert.match(out, /최저선 다시 시험[^\n]*\n {2}제안: 없음\n[^\n]*sonnet-medium \/ 번역[^\n]*sonnet-low[^\n]*회고 1번\(간격 2번\)/);
    mark(root);
    out = run(['--report'], root).stdout;
    assert.match(out, /제안: sonnet-medium \/ 번역[^\n]*sonnet-low[^\n]*haiku-high[^\n]*2건/);
    fs.writeFileSync(path.join(root, 'routing.md'), guideOf('| **Sonnet** | | 번역 「(최저: sonnet-low)」 「(시험: 다음 1건 `haiku-high`)」 | | |'));
    assert.match(run(['--status'], root).stdout, /sonnet-medium \/ 번역 → haiku-high 대기/);
    assert.doesNotMatch(run(['--status'], setup(guideOf(floored), line('sonnet-medium', '번역', 'ok', 'a1'))).stdout, /최저선 다시 시험/);
    fs.appendFileSync(usageFile(root), line('sonnet-medium', '번역', 'ok', 'b1') + line('haiku-high', '번역', 'ok', 't1') + line('haiku-high', '번역', 'ok', 't2'));
    fs.writeFileSync(path.join(root, 'records', 'subagent-cost.tsv'), costLine('b1', 'sonnet-medium', '0.04') + costLine('t1', 'haiku-high', '0.01') + costLine('t2', 'haiku-high', '0.02'));
    out = run(['--report'], root).stdout;
    assert.match(out, /haiku-high {2}보냄\(t1\) {2}판정: 통과[^\n]*\(최저선 다시 시험\)/);
    assert.match(out, /최저선 내리기 제안[^\n]*\n[^\n]*sonnet-medium \/ 번역[^\n]*통과\(t1\)[^\n]*sonnet-low[^\n]*haiku-high[^\n]*2번/);
    assert.match(out, /내림 실패[^\n]*\n {2}없음/);
  });

  it('시험이 비용으로 실패했으면 내려 보기 후보가 같은 모델 한 칸 아래 effort를 가리킨다', () => {
    const root = setup(guideOf('| **Sonnet** | 번역 「(시험: 다음 1건 `haiku-high`)」 | | | |'), line('sonnet-low', '번역', 'ok', 's0'));
    mark(root);
    fs.appendFileSync(usageFile(root), ['s1', 's2', 's3', 's4', 's5'].map((id) => line('sonnet-low', '번역', 'ok', id)).join('') + line('haiku-high', '번역', 'ok', 't1') + line('haiku-high', '번역', 'ok', 't2'));
    fs.writeFileSync(path.join(root, 'records', 'subagent-cost.tsv'), ['s1', 's2', 's3', 's4', 's5'].map((id) => costLine(id, 'sonnet-low', '0.01')).join('') + costLine('t1', 'haiku-high', '0.05') + costLine('t2', 'haiku-high', '0.06'));
    const out = run(['--report'], root).stdout;
    assert.match(out, /판정: 실패\(비용이 줄지 않음\)[^\n]*시험 중앙값/);
    assert.match(out, /내려 보기 후보[^\n]*\n {2}sonnet-low \/ 번역 → haiku-medium/);
  });

  it('같은 시험이 두 번 이어 판정 불가이면 시험 표시를 지운다고 찍는다', () => {
    const root = setup(guideOf('| **Sonnet** | 번역 「(시험: 다음 1건 `haiku-high`)」 | | | |'), line('sonnet-low', '번역', 'ok', 'a1'));
    mark(root);
    fs.appendFileSync(usageFile(root), line('haiku-high', '번역', '재지시', 'u1'));
    assert.doesNotMatch(run(['--report'], root).stdout, /판정 불가 2번/);
    mark(root);
    fs.appendFileSync(usageFile(root), line('haiku-high', '번역', '재지시', 'u2'));
    const out = run(['--report'], root).stdout;
    assert.match(out, /판정 불가 2번이라 시험 표시를 지움: sonnet-low \/ 번역 → haiku-high/);
  });
});

describe('subagent-retro.js 대화 기록 보존 기간 실행', () => {
  const setup = (usageLines, settings = null) => {
    const root = tmpDir();
    const dir = path.join(root, 'records');
    const claude = path.join(root, 'claude');
    fs.mkdirSync(dir);
    fs.mkdirSync(claude);
    fs.writeFileSync(path.join(dir, 'subagent-usage.tsv'), usageLines.join('\n') + '\n');
    if (settings !== null) fs.writeFileSync(path.join(claude, 'settings.json'), settings);
    return { dir, claude };
  };
  const run = (args, e) => spawnSync(process.execPath, [RETRO, ...args], { env: { ...process.env, SUBAGENT_RECORDS_DIR: e.dir, CLAUDE_CONFIG_DIR: e.claude }, encoding: 'utf8' });
  const data = (date, id) => `${date}\t/p\tsonnet-low\t번역\t1\t2\t3\tok\t${id} 줄`;
  const retroMark = (iso) => ['회고', '-', '회고', iso, '2', '-', '-', '-', 'm'].join('\t');

  it('마지막 회고 뒤 26일이 지나면 건수가 모자라도 --due가 ask이고 마지막 줄에 사유가 붙는다', () => {
    const e = setup([data('2026-08-01', 'a0'), retroMark(new Date(2026, 8, 17, 12).toISOString()), data('2026-10-12', 'a1')]);
    const out = run(['--due'], e).stdout.trim().split('\n');
    assert.equal(out[0], 'ask');
    assert.match(out.at(-1), /2026-09-17부터 26일이 지나/);
  });

  it('지난 날수가 보존 기간보다 하루 적으면 --due 마지막 줄이 가까워졌다고 하고 지워졌을 수 있다는 말은 붙지 않는다', () => {
    const e = setup([data('2026-08-01', 'a0'), retroMark(new Date(2026, 8, 14, 12).toISOString()), data('2026-10-12', 'a1')]);
    const last = run(['--due'], e).stdout.trim().split('\n').at(-1);
    assert.match(last, /29일이 지나[^\n]*가까워졌/);
    assert.doesNotMatch(last, /지워졌을 수/);
  });

  it('지난 날수가 보존 기간과 같으면 --due 마지막 줄이 닿았다고 하고 지워졌을 수 있다는 경고가 붙는다', () => {
    const exact = run(['--due'], setup([data('2026-08-01', 'a0'), retroMark(new Date(2026, 8, 13, 12).toISOString()), data('2026-10-12', 'a1')])).stdout.trim().split('\n').at(-1);
    assert.match(exact, /30일이 지나[^\n]*닿았/);
    assert.match(exact, /2026-09-13 이전[^\n]*지워졌을 수/);
    assert.doesNotMatch(exact, /넘었습니다|가까워졌습니다/);
  });

  it('지난 날수가 보존 기간과 같으면 --status의 기간 기준 줄에도 지워졌을 수 있다는 경고가 붙는다', () => {
    const exact = run(['--status'], setup([data('2026-08-01', 'a0'), retroMark(new Date(2026, 8, 13, 12).toISOString()), data('2026-10-12', 'a1')])).stdout;
    assert.match(exact, /기간 기준:[^\n]*2026-10-08에 묻습니다\(지금 30일 지남\)/);
    assert.match(exact, /2026-09-13 이전[^\n]*지워졌을 수/);
  });

  it('기간 기준만으로 ask일 때 --snooze하면 미룸 줄이 건수 기준을 미루지 않은 것으로 남고, 건수가 차면 다시 ask다', () => {
    const e = setup([data('2026-08-01', 'a0'), retroMark(new Date(2026, 8, 17, 12).toISOString()), data('2026-10-12', 'a1')]);
    assert.equal(run(['--due'], e).stdout.split('\n')[0], 'ask');
    const snooze = run(['--snooze'], e);
    assert.equal(snooze.status, 0, snooze.stderr);
    assert.doesNotMatch(snooze.stdout, /더 쌓일 때까지/);
    assert.match(snooze.stdout, /25일을 다시 셉니다[^\n]*지워질 수 있습니다/);
    const memo = fs.readFileSync(path.join(e.dir, 'subagent-usage.tsv'), 'utf8').trim().split('\n').at(-1).split('\t')[8];
    assert.equal(JSON.parse(memo).건수, false);
    assert.equal(JSON.parse(memo).기간, true);
    assert.equal(run(['--due'], e).stdout.split('\n')[0], 'wait 49');
    fs.appendFileSync(path.join(e.dir, 'subagent-usage.tsv'), Array.from({ length: 49 }, (_, i) => data('2026-10-13', `b${i}`)).join('\n') + '\n');
    assert.equal(run(['--due'], e).stdout.split('\n')[0], 'ask');
  });
});

describe('subagent-retro.js 사용자가 뺀 일 이름(removedKinds) 실행', () => {
  const GUIDE = ['| | low | medium | high | xhigh |', '|:---|:---|:---|:---|:---|', '| **Sonnet** | 번역 | 구현 | | |'].join('\n');
  const setup = ({ usage = '', config = null } = {}) => {
    const root = tmpDir();
    fs.writeFileSync(path.join(root, 'routing.md'), GUIDE);
    fs.mkdirSync(path.join(root, 'records'));
    fs.writeFileSync(path.join(root, 'records', 'subagent-usage.tsv'), usage);
    if (config !== null) fs.writeFileSync(path.join(root, 'config.json'), config);
    return root;
  };
  const run = (root, args) =>
    spawnSync(process.execPath, [RETRO, ...args], {
      env: { ...process.env, SUBAGENT_RECORDS_DIR: path.join(root, 'records'), SUBAGENT_ROUTING_FILE: path.join(root, 'routing.md'), SUBAGENT_CONFIG_FILE: path.join(root, 'config.json') },
      encoding: 'utf8',
    });
  const configOf = (root) => path.join(root, 'config.json');
  const readConfig = (root) => JSON.parse(fs.readFileSync(configOf(root), 'utf8'));
  const line = (kind, id, date = '2026-10-12') => [date, '/p', 'sonnet-medium', kind, 1, 2, 3, 'ok', `${id} 메모`].join('\t') + '\n';
  const mark = (root) => {
    const lines = fs.readFileSync(path.join(root, 'records', 'subagent-usage.tsv'), 'utf8').split('\n').filter(Boolean).length;
    const msgs = path.join(root, 'msgs.tsv');
    fs.writeFileSync(msgs, `# 사용 줄\t${lines}\n# 추출 시각\t2026-10-13T00:00:00.000Z\n`);
    return run(root, ['--mark', '메모', '--messages', msgs, '--changed', '0']);
  };

  it('--remove-kind는 이름을 removedKinds에 더하고 다른 키는 그대로이며, 같은 이름을 다시 더해도 파일이 그대로다', () => {
    const root = setup({ config: JSON.stringify({ retroMode: 'auto', removedDefs: ['x'], future: { a: 1 } }) });
    const r = run(root, ['--remove-kind', '표 정리']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /removedKinds에 더했습니다: 표 정리/);
    assert.deepEqual(readConfig(root), { retroMode: 'auto', removedDefs: ['x'], future: { a: 1 }, removedKinds: ['표 정리'] });

    run(root, ['--remove-kind', '요약']);
    assert.deepEqual(readConfig(root).removedKinds, ['표 정리', '요약']);
    const before = fs.readFileSync(configOf(root), 'utf8');
    const again = run(root, ['--remove-kind', '표 정리']);
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, /이미 removedKinds에 있어 그대로 뒀습니다/);
    assert.equal(fs.readFileSync(configOf(root), 'utf8'), before);
  });

  it('체계가 쓰는 여덟 가지 일(회고 정정 분류, 자동 회고, 작업 기록 병목 분석, 문서 내용 검토, 무조건 Opus 영역 판단, 계획이 정한 무조건 Opus 영역 단계 구현, 무조건 Opus 영역 구현, high로도 안 풀려 다시 보내는 일)은 표시와 부연을 붙여도 --remove-kind가 거절하고 설정 파일을 바꾸지 않는다', () => {
    const root = setup({ config: JSON.stringify({ retroMode: 'ask' }) });
    const before = fs.readFileSync(configOf(root), 'utf8');
    for (const name of ['회고 정정 분류', '회고 정정 분류 「(고정)」', '자동 회고(회고 서브에이전트)', '작업 기록 병목 분석', '작업 기록 병목 분석 「(고정)」', '문서 내용 검토', '문서 내용 검토 「(고정)」', '무조건 Opus 영역 판단(결론, 설계) 「(고정)」', '계획이 정한 무조건 Opus 영역 단계 구현', '무조건 Opus 영역 구현 「(고정)」', 'high로도 안 풀려 다시 보내는 일']) {
      const r = run(root, ['--remove-kind', name]);
      assert.equal(r.status, 1, name);
      assert.match(r.stderr, /체계가 쓰는 여덟 가지 일이라 표에서 빼지 않습니다/);
      assert.equal(fs.readFileSync(configOf(root), 'utf8'), before, name);
    }
    assert.equal(run(root, ['--remove-kind', '번역']).status, 0);
  });

  it('--restore-kind는 이름을 빼고 다른 키는 남기며, 마지막 이름을 빼면 키를 지우고, 없는 이름은 파일을 그대로 둔다', () => {
    const root = setup({ config: JSON.stringify({ retroMode: 'ask', removedKinds: ['표 정리', '요약'] }) });
    const r = run(root, ['--restore-kind', '표 정리']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /removedKinds에서 뺐습니다: 표 정리/);
    assert.deepEqual(readConfig(root), { retroMode: 'ask', removedKinds: ['요약'] });

    const before = fs.readFileSync(configOf(root), 'utf8');
    assert.match(run(root, ['--restore-kind', '표 정리']).stdout, /removedKinds에 없어 그대로 뒀습니다/);
    assert.equal(fs.readFileSync(configOf(root), 'utf8'), before);

    run(root, ['--restore-kind', '요약']);
    assert.deepEqual(readConfig(root), { retroMode: 'ask' });
  });

  it('회고 출력의 「표에 없는 일 종류」와 --kinds는 removedKinds에 든 이름에만 표시를 붙이고, 회고를 두 번 거쳐도 붙는다', () => {
    const root = setup({ config: JSON.stringify({ removedKinds: ['표 정리'] }) });
    const unknownBlock = () => run(root, ['--report']).stdout.split('표에 없는 일 종류')[1].split('\n요율표')[0];
    for (let retro = 0; retro < 3; retro++) {
      fs.appendFileSync(path.join(root, 'records', 'subagent-usage.tsv'), line('표 정리', `a${retro}`, `2026-10-1${retro}`) + line('요약', `b${retro}`, `2026-10-1${retro}`));
      const block = unknownBlock();
      assert.match(block, /표 정리  \(사용자가 뺐거나 회고가 쪼갠 옛 이름\)  1건/, `회고 ${retro}번 뒤 회고 출력`);
      assert.match(block, /요약  1건/);
      assert.doesNotMatch(block, /요약  \(사용자가 뺐거나 회고가 쪼갠 옛 이름\)/);
      const out = run(root, ['--kinds']).stdout;
      assert.match(out, new RegExp(`표 정리  \\(사용자가 뺐거나 회고가 쪼갠 옛 이름\\)\\t${retro + 1}건`), `회고 ${retro}번 뒤 --kinds`);
      assert.match(out, new RegExp(`요약\\t${retro + 1}건`));
      assert.match(out, /새 이름을 짓지 않고 이 이름을 그대로 적습니다/);
      assert.equal(mark(root).status, 0);
    }
  });

  it('표에 <이름>[기준] 꼴 칸이 있는 removedKinds 이름은 회고가 쪼갠 옛 이름으로 따로 찍고, 사용자가 뺀 이름과 섞이지 않는다', () => {
    const root = setup({ usage: line('번역', 'a1') + line('표 정리', 'b1'), config: JSON.stringify({ removedKinds: ['번역', '표 정리'] }) });
    fs.writeFileSync(path.join(root, 'routing.md'), ['| | low | medium | high | xhigh |', '|:---|:---|:---|:---|:---|', '| **Sonnet** | 번역[원문 있음], 번역[원문 없음] | 구현 | | |'].join('\n'));
    const block = run(root, ['--report']).stdout.split('표에 없는 일 종류')[1].split('\n요율표')[0];
    assert.match(block, /번역  \(회고가 쪼갠 옛 이름\)  1건/);
    assert.match(block, /표 정리  \(사용자가 뺐거나 회고가 쪼갠 옛 이름\)  1건/);
    assert.match(block, /\(회고가 쪼갠 옛 이름\): 표에 `<이름>\[기준\]` 꼴 칸이 있어/);
    const kinds = run(root, ['--kinds']).stdout;
    assert.match(kinds, /번역  \(회고가 쪼갠 옛 이름\)\t1건/);
    assert.match(kinds, /표 정리  \(사용자가 뺐거나 회고가 쪼갠 옛 이름\)\t1건/);

    const onlySplit = setup({ usage: line('번역', 'a1'), config: JSON.stringify({ removedKinds: ['번역'] }) });
    fs.writeFileSync(path.join(onlySplit, 'routing.md'), fs.readFileSync(path.join(root, 'routing.md')));
    const out = run(onlySplit, ['--kinds']).stdout;
    assert.match(out, /\(회고가 쪼갠 옛 이름\): /);
    assert.doesNotMatch(out, /사용자가 뺀 일이거나/);
  });
});

describe('subagent-retro.js 대화 기록 폴더가 없는 컴퓨터', () => {
  const setup = () => {
    const root = tmpDir();
    fs.mkdirSync(path.join(root, 'records'));
    fs.mkdirSync(path.join(root, 'cfg'));
    fs.writeFileSync(path.join(root, 'records', 'subagent-usage.tsv'), '2026-10-05\t/p/a\tsonnet-medium\t구현\t1\t1\t1\tok\ta1 m\n');
    return root;
  };
  const env = (root) => ({ ...process.env, CLAUDE_CONFIG_DIR: path.join(root, 'cfg'), SUBAGENT_RECORDS_DIR: path.join(root, 'records'), SUBAGENT_GUIDE_FILE: path.join(root, 'no-guide.md') });

  it('--extract는 폴더가 없다고 알리고 메시지 0개인 파일을 쓰고 종료 코드 0이다', () => {
    const root = setup();
    const out = path.join(root, 'msgs.tsv');
    const r = spawnSync(process.execPath, [RETRO, '--extract', out], { env: env(root), encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /대화 기록 폴더가 없습니다: .*projects/);
    assert.match(r.stdout, /사용자 메시지 0개를 .*에 썼습니다/);
    const rows = fs.readFileSync(out, 'utf8').split('\n').filter(Boolean);
    assert.equal(rows[0], '# 사용 줄\t1');
    assert.ok(rows.at(-1).startsWith('번호\t'), '머리줄까지만 있다');
  });

  it('subagent-usage.js는 세션을 못 찾는다고 알리고 종료 코드 1이며 오류 추적을 찍지 않는다', () => {
    const root = setup();
    const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'subagent-usage.js')], { env: env(root), encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /조건에 맞는 세션이 없습니다/);
    assert.doesNotMatch(r.stderr, /ENOENT/);
  });
});

describe('subagent-retro.js 키트 파일 해시(kitFileHashes)', () => {
  const GUIDE = [
    '# 가이드',
    '<!-- 사용자 표 시작 -->',
    '| | low | medium | high | xhigh |',
    '|:---|:---|:---|:---|:---|',
    '| **Sonnet** | 번역 | 구현 | | |',
    '<!-- 사용자 표 끝 -->',
    '공통 문장',
    '<!-- 무조건 Opus 시작 -->',
    '- 결제',
    '<!-- 무조건 Opus 끝 -->',
    '<!-- 사용자 규칙 시작 -->',
    '<!-- 사용자 규칙 끝 -->',
    '끝 문장',
  ].join('\n');
  const DEF = ['---', 'name: sonnet-medium', 'description: 첫 문장. 구현, 번역. (`~/.claude/subagent-system/docs/SUBAGENT_GUIDE.md`)', 'model: sonnet', '---', '', '본문 줄'].join('\n');
  const setup = () => {
    const root = tmpDir();
    for (const d of ['claude/subagent-system/docs', 'claude/agents', 'claude/skills/retro']) fs.mkdirSync(path.join(root, d), { recursive: true });
    fs.writeFileSync(path.join(root, 'claude/subagent-system/docs/SUBAGENT_GUIDE.md'), GUIDE);
    fs.writeFileSync(path.join(root, 'claude/subagent-system/docs/RETRO.md'), '회고 문서');
    fs.writeFileSync(path.join(root, 'claude/subagent-system/docs/SUBAGENT_BRIEF_CHECKLIST.md'), '체크리스트');
    fs.writeFileSync(path.join(root, 'claude/agents/sonnet-medium.md'), DEF);
    fs.writeFileSync(path.join(root, 'claude/agents/my-own.md'), '사용자 정의');
    fs.writeFileSync(path.join(root, 'claude/skills/retro/SKILL.md'), '스킬');
    fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ retroMode: 'auto', roles: ['백엔드'], future: { a: 1 } }));
    return root;
  };
  const file = (root, rel) => path.join(root, 'claude', rel);
  const run = (root, args) =>
    spawnSync(process.execPath, [RETRO, ...args], {
      env: {
        ...process.env,
        CLAUDE_CONFIG_DIR: path.join(root, 'claude'),
        SUBAGENT_RECORDS_DIR: path.join(root, 'records'),
        SUBAGENT_GUIDE_FILE: file(root, 'subagent-system/docs/SUBAGENT_GUIDE.md'),
        SUBAGENT_AGENTS_DIR: file(root, 'agents'),
        SUBAGENT_CONFIG_FILE: path.join(root, 'config.json'),
      },
      encoding: 'utf8',
    });
  const readConfig = (root) => JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
  const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');

  it('--record-kit-hashes는 통째로 바뀌는 파일만 기록하고 다른 키는 그대로 둔다', () => {
    const root = setup();
    const r = run(root, ['--record-kit-hashes']);
    assert.equal(r.status, 0, r.stderr);
    const c = readConfig(root);
    assert.deepEqual({ ...c, kitFileHashes: undefined }, { retroMode: 'auto', roles: ['백엔드'], future: { a: 1 }, kitFileHashes: undefined });
    const keys = Object.keys(c.kitFileHashes);
    assert.ok(keys.includes('subagent-system/scripts/subagent-retro.js'));
    assert.ok(keys.includes('subagent-system/scripts/tests/subagentCli.test.js'));
    assert.ok(keys.includes('subagent-system/scripts/package.json'));
    for (const k of ['subagent-system/docs/RETRO.md', 'subagent-system/docs/SUBAGENT_GUIDE.md', 'agents/sonnet-medium.md', 'skills/retro/SKILL.md']) assert.ok(keys.includes(k), k);
    assert.ok(!keys.some((k) => /BRIEF_CHECKLIST|rates\.json|VERSION|my-own/.test(k)), keys.join(', '));
    assert.equal(c.kitFileHashes['subagent-system/scripts/subagent-retro.js'], sha(fs.readFileSync(RETRO)));
    assert.equal(c.kitFileHashes['subagent-system/docs/RETRO.md'], sha('회고 문서'));
    assert.match(r.stdout, new RegExp(`파일 ${keys.length}개`));
  });

  it('GUIDE의 세 구역 안과 정의의 description과 글쓰기 줄을 바꿔도 기록과 같고, 구역 밖과 본문을 고치면 다르다', () => {
    const root = setup();
    run(root, ['--record-kit-hashes']);
    const guide = file(root, 'subagent-system/docs/SUBAGENT_GUIDE.md');
    fs.writeFileSync(guide, GUIDE.replace('| **Sonnet** | 번역 | 구현 | | |', '| **Sonnet** | 번역, 요약 | 구현 | | |').replace('- 결제', '- 결제\n- 정산').replace('<!-- 사용자 규칙 시작 -->', '<!-- 사용자 규칙 시작 -->\n- RETRO.md: 가 대신 나'));
    fs.writeFileSync(file(root, 'agents/sonnet-medium.md'), DEF.replace('구현, 번역.', '구현, 번역, 요약.') + '\n- 글은 필요한 말만 쓴다. 줄표를 쓰지 않는다.');
    const same = run(root, ['--check-kit-hashes']);
    assert.equal(same.status, 0, same.stderr);
    assert.match(same.stdout, /기록과 다른 파일 0개/);
    assert.match(same.stdout, /기록에 있는데 설치본에 없는 파일 0개/);

    fs.writeFileSync(guide, GUIDE.replace('공통 문장', '손으로 고친 문장'));
    fs.writeFileSync(file(root, 'agents/sonnet-medium.md'), DEF.replace('본문 줄', '본문 줄 수정'));
    const diff = run(root, ['--check-kit-hashes']).stdout;
    assert.match(diff, /기록과 다른 파일 2개/);
    assert.match(diff, /다름 {2}subagent-system\/docs\/SUBAGENT_GUIDE\.md/);
    assert.match(diff, /다름 {2}agents\/sonnet-medium\.md/);
    assert.doesNotMatch(diff, /다름 {2}subagent-system\/docs\/RETRO/);
  });

  it('--check-kit-hashes는 고친 스킬과 지운 파일을 가리고, 아무것도 쓰지 않는다', () => {
    const root = setup();
    run(root, ['--record-kit-hashes']);
    fs.writeFileSync(file(root, 'skills/retro/SKILL.md'), '스킬 수정');
    fs.rmSync(file(root, 'subagent-system/docs/RETRO.md'));
    const before = fs.readFileSync(path.join(root, 'config.json'), 'utf8');
    const out = run(root, ['--check-kit-hashes']).stdout;
    assert.match(out, /다름 {2}skills\/retro\/SKILL\.md/);
    assert.match(out, /기록에 있는데 설치본에 없는 파일 1개\n {2}없음 {2}subagent-system\/docs\/RETRO\.md/);
    assert.equal(fs.readFileSync(path.join(root, 'config.json'), 'utf8'), before);
  });
});

describe('subagent-retro.js 회고가 지운 정의(removedDefs) 실행', () => {
  const setup = (config) => {
    const root = tmpDir();
    if (config !== null) fs.writeFileSync(path.join(root, 'config.json'), config);
    return root;
  };
  const run = (root, args) => spawnSync(process.execPath, [RETRO, ...args], { env: { ...process.env, SUBAGENT_CONFIG_FILE: path.join(root, 'config.json') }, encoding: 'utf8' });
  const readConfig = (root) => JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));

  it('--remove-def는 이름을 removedDefs 끝에 더하고 다른 키는 그대로이며, 같은 이름을 다시 더해도 하나만 남는다', () => {
    const root = setup(JSON.stringify({ retroMode: 'auto', removedDefs: ['a'], future: { x: 1 } }));
    assert.equal(run(root, ['--remove-def', 'sonnet-low']).status, 0);
    assert.equal(run(root, ['--remove-def', 'sonnet-low']).status, 0);
    assert.deepEqual(readConfig(root), { retroMode: 'auto', removedDefs: ['a', 'sonnet-low'], future: { x: 1 } });
  });
});

describe('subagent-retro.js --shortfalls 실행', () => {
  const row = (kind, memo) => ['2026-10-12', '/p', 'sonnet-low', kind, '1', '1', '1', 'ok', memo].join('\t');
  const retroRow = (memo) => ['2026-10-13', '/p', '회고', '경계', '-', '-', '-', 'ok', memo].join('\t');
  const run = (lines) => {
    const root = tmpDir();
    fs.mkdirSync(path.join(root, 'records'));
    if (lines) fs.writeFileSync(path.join(root, 'records', 'subagent-usage.tsv'), lines.join('\n') + '\n');
    return spawnSync(process.execPath, [RETRO, '--shortfalls'], { env: { ...process.env, SUBAGENT_RECORDS_DIR: path.join(root, 'records') }, encoding: 'utf8' });
  };

  it('마지막 회고 줄의 메모와 그 뒤의 모자람 줄만 찍고 이전 모자람은 찍지 않는다', () => {
    const r = run([row('일', 'a 모자람:옛'), retroRow('지난 메모'), row('일', 'b 모자람:새'), row('일', 'c 없음')]);
    assert.equal(r.status, 0, r.stderr);
    const out = r.stdout.trim().split('\n');
    assert.equal(out[0], '지난 회고 메모: 지난 메모');
    assert.equal(out.length, 2);
    assert.match(out[1], /b 모자람:새/);
  });

  it('회고 줄이 없으면 기록 처음부터 모자람 줄을 찍고 지난 회고 메모는 비어 있다', () => {
    const r = run([row('일', 'a 모자람:하나'), row('일', 'b 모자람:둘')]);
    const out = r.stdout.trim().split('\n');
    assert.equal(out[0], '지난 회고 메모: ');
    assert.equal(out.length, 3);
  });
});

describe('subagent-retro.js --check-fable 실행', () => {
  const costRow = (agentId, model) => ['2026-10-25', '/p', 's1', agentId, 'opus-xhigh', model, 'high', '설명', '1', '1', '1', '1', '1', '1', '0.1'].join('\t');
  const setup = ({ model, project = {}, user = {}, local = {} } = {}) => {
    const root = tmpDir();
    const cwd = path.join(root, 'proj');
    fs.mkdirSync(path.join(cwd, '.claude'), { recursive: true });
    fs.mkdirSync(path.join(root, 'claude'));
    fs.mkdirSync(path.join(root, 'records'));
    if (model !== undefined) fs.writeFileSync(path.join(root, 'records', 'subagent-cost.tsv'), costRow('a1b2c3', model) + '\n');
    fs.writeFileSync(path.join(cwd, '.claude', 'settings.json'), JSON.stringify(project));
    fs.writeFileSync(path.join(cwd, '.claude', 'settings.local.json'), JSON.stringify(local));
    fs.writeFileSync(path.join(root, 'claude', 'settings.json'), JSON.stringify(user));
    return { root, cwd };
  };
  const run = ({ root, cwd }, env = {}) => {
    const clean = { ...process.env };
    delete clean.ANTHROPIC_DEFAULT_FABLE_MODEL;
    return spawnSync(process.execPath, [RETRO, '--check-fable', 'a1b2c3'], {
      cwd,
      env: { ...clean, CLAUDE_CONFIG_DIR: path.join(root, 'claude'), SUBAGENT_RECORDS_DIR: path.join(root, 'records'), ...env },
      encoding: 'utf8',
    });
  };
  const verdict = (r) => /^판정: (.*)$/m.exec(r.stdout)?.[1];
  const def = (r) => /^사용 기록 --def: (.*)$/m.exec(r.stdout)?.[1];

  it('모델 열에 claude-fable-5-1이 들어 있으면 공급자 꼴 ID여도 Fable 5.1이고 fable-high로 적는다', () => {
    for (const model of ['claude-fable-5-1', 'us.anthropic.claude-fable-5-1-v1:0', 'claude-fable-5-1-20261001']) {
      const r = run(setup({ model }));
      assert.equal(verdict(r), 'Fable 5.1', model);
      assert.equal(def(r), 'fable-high');
      assert.doesNotMatch(r.stdout, /사용자에게 알릴 말/);
    }
  });

  it('claude-fable-5만 들어 있으면 Fable 5로 돈 것을 알리고 fable-high로 적는다', () => {
    const r = run(setup({ model: 'claude-fable-5' }));
    assert.equal(verdict(r), 'Fable 5');
    assert.equal(def(r), 'fable-high');
    assert.match(r.stdout, /Fable 5\.1이 아니라 Fable 5로 돌았다/);
  });

  it('다른 모델이면 opus-xhigh로 적고 메모에 agentId 뒤 실제 모델을 남기라고 한다', () => {
    const r = run(setup({ model: 'claude-opus-5-5' }));
    assert.equal(verdict(r), 'Fable 아님');
    assert.equal(def(r), 'opus-xhigh');
    assert.match(r.stdout, /^사용 기록 --memo: a1b2c3 claude-opus-5-5$/m);
  });

  it('ID에 claude-가 없고 설정에서 대응도 못 찾으면 Fable 아님이라 단정하지 않고 확인하지 못했다고 한다', () => {
    const r = run(setup({ model: 'arn:aws:bedrock:us-east-1:1:inference-profile/x' }));
    assert.equal(verdict(r), 'Fable 확인 못함');
    assert.equal(def(r), 'opus-xhigh');
    assert.match(r.stdout, /확인하지 못했다/);
  });

  it('modelOverrides가 Fable 모델 ID 키를 모델 열의 값에 대응시키면 키로 5.1과 5를 가른다', () => {
    const arn = 'arn:aws:bedrock:us-east-1:1:inference-profile/x';
    assert.equal(verdict(run(setup({ model: arn, user: { modelOverrides: { 'claude-fable-5-1': arn } } }))), 'Fable 5.1');
    const five = run(setup({ model: arn, user: { modelOverrides: { 'claude-fable-5': arn } } }));
    assert.equal(verdict(five), 'Fable 5');
    assert.equal(def(five), 'fable-high');
  });
});

describe('subagent-retro.js --docs와 --docs-done', () => {
  const SESSION = '11111111-2222-3333-4444-555555555555';
  const lines = (n) => Array.from({ length: n }, (_, i) => `규칙 ${i}`).join('\n') + '\n';

  // 사용 기록의 프로젝트는 CLAUDE.md가 있는 임시 폴더이고, 같은 구간의 대화가 내 스킬, 플러그인 스킬, 파일 없는 이름을 부른다.
  const setup = ({ claudeMdLines = 250, config = {} } = {}) => {
    const root = tmpDir();
    const claude = path.join(root, 'claude');
    const records = path.join(root, 'records');
    const project = path.join(root, 'proj');
    const skill = path.join(claude, 'skills', 'mine', 'SKILL.md');
    fs.mkdirSync(path.dirname(skill), { recursive: true });
    fs.mkdirSync(path.join(claude, 'projects', '-proj'), { recursive: true });
    fs.mkdirSync(records);
    fs.mkdirSync(project);
    fs.writeFileSync(skill, '# mine\n');
    fs.writeFileSync(path.join(project, 'CLAUDE.md'), lines(claudeMdLines));
    fs.writeFileSync(path.join(records, 'subagent-usage.tsv'), `2026-10-12\t${project}\tsonnet-low\t번역\t1\t2\t3\tok\ta1 줄\n`);
    const call = (skill, ts) => JSON.stringify({ type: 'assistant', timestamp: ts, cwd: project, message: { content: [{ type: 'tool_use', id: skill, name: 'Skill', input: { skill } }] } });
    fs.writeFileSync(
      path.join(claude, 'projects', '-proj', `${SESSION}.jsonl`),
      [call('mine', '2026-10-12T10:00:00Z'), call('mine', '2026-10-12T10:01:00Z'), call('plug:thing', '2026-10-12T10:02:00Z'), call('ghost', '2026-10-12T10:03:00Z')].join('\n') + '\n'
    );
    const configFile = path.join(root, 'config.json');
    fs.writeFileSync(configFile, JSON.stringify(config));
    return { claude, records, project, skill, claudeMd: path.join(project, 'CLAUDE.md'), configFile };
  };
  const run = (e, args) => spawnSync(process.execPath, [RETRO, ...args], { env: { ...process.env, CLAUDE_CONFIG_DIR: e.claude, SUBAGENT_RECORDS_DIR: e.records, SUBAGENT_CONFIG_FILE: e.configFile }, encoding: 'utf8' });

  it('처음에는 쓴 스킬 파일과 프로젝트 CLAUDE.md를 줄 수와 함께 대상으로 찍고 플러그인 스킬과 파일 없는 이름은 뺀다', () => {
    const e = setup();
    const r = run(e, ['--docs']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /CLAUDE\.md 기준 줄 수: 80줄/);
    assert.match(r.stdout, /검토 대상 2개/);
    assert.ok(r.stdout.includes(`스킬  ${e.skill}  mine  쓴 횟수 2번  처음 검토`));
    assert.ok(r.stdout.includes(`프로젝트 CLAUDE.md  ${e.claudeMd}  250줄, 기준 초과  처음 검토`));
    assert.match(r.stdout, /플러그인 스킬 1개\(plug:thing\)/);
    assert.match(r.stdout, /스킬 파일을 찾지 못한 이름 1개\(ghost\)/);
  });

  it('claudeMdLimitLines를 크게 두면 같은 CLAUDE.md가 기준 이하로 찍힌다', () => {
    const e = setup({ config: { claudeMdLimitLines: 300 } });
    const r = run(e, ['--docs']);
    assert.match(r.stdout, /CLAUDE\.md 기준 줄 수: 300줄/);
    assert.match(r.stdout, /250줄, 기준 이하/);
  });

  it('--docs-done으로 해시를 남기면 바뀌기 전까지 대상이 아니고 고치면 수정됨으로 다시 나온다', () => {
    const e = setup();
    const done = run(e, ['--docs-done', e.skill, e.claudeMd]);
    assert.equal(done.status, 0, done.stderr);
    const saved = JSON.parse(fs.readFileSync(e.configFile, 'utf8')).docReviewHashes;
    assert.deepEqual(Object.keys(saved).sort(), [e.skill, e.claudeMd].sort());
    const again = run(e, ['--docs']);
    assert.match(again.stdout, /검토 대상 0개/);
    assert.match(again.stdout, /지난 검토 뒤 바뀌지 않음 2개/);
    fs.appendFileSync(e.skill, '한 줄 더\n');
    const edited = run(e, ['--docs']);
    assert.match(edited.stdout, /검토 대상 1개/);
    assert.ok(edited.stdout.includes(`${e.skill}  mine  쓴 횟수 2번  지난 검토 뒤 수정됨`));
  });

  it('--docs-done은 다른 설정 키를 남기고, 파일이 없으면 아무것도 쓰지 않고 종료 코드 1이다', () => {
    const e = setup({ config: { retroMode: 'auto' } });
    const bad = run(e, ['--docs-done', e.skill, path.join(e.project, '없는파일.md')]);
    assert.equal(bad.status, 1);
    assert.deepEqual(JSON.parse(fs.readFileSync(e.configFile, 'utf8')), { retroMode: 'auto' });
    assert.equal(run(e, ['--docs-done']).status, 1);
    assert.equal(run(e, ['--docs-done', e.skill]).status, 0);
    assert.equal(JSON.parse(fs.readFileSync(e.configFile, 'utf8')).retroMode, 'auto');
  });
});

describe('subagent-retro.js 고침 기록 --fix와 --fixes', () => {
  const HEAD = ['시각', '프로젝트', '범위', '신호', '이름표', '고친 곳', '방식', '기준점', '메모'].join('\t');
  const setup = () => {
    const root = tmpDir();
    const dir = path.join(root, 'records');
    fs.mkdirSync(dir);
    return { dir, config: path.join(root, 'config.json'), usage: path.join(dir, 'subagent-usage.tsv'), fixes: path.join(dir, 'fixes.tsv'), corrections: path.join(dir, 'subagent-corrections.tsv') };
  };
  const run = (args, e) => spawnSync(process.execPath, [RETRO, ...args], { env: { ...process.env, SUBAGENT_RECORDS_DIR: e.dir, SUBAGENT_CONFIG_FILE: e.config, SUBAGENT_GUIDE_FILE: path.join(e.dir, 'no-guide.md') }, encoding: 'utf8' });
  const use = (memo, project = '/p') => ['2026-10-12', project, 'sonnet-low', '번역', '1', '2', '3', 'ok', memo].join('\t');
  const fixRow = (over = {}) => {
    const v = { at: '2026-10-20T00:00:00.000Z', project: '/p', scope: '프로젝트', signal: '정정', label: '태그', where: 'A.md#절', how: '문장', anchor: '0', memo: 'm', ...over };
    return [v.at, v.project, v.scope, v.signal, v.label, v.where, v.how, v.anchor, v.memo].join('\t');
  };
  const fixArgs = ['--fix', '--project', '/p/.claude/worktrees/w', '--signal', '정정', '--label', '태그', '--where', 'docs/A.md#절', '--how', '문장', '--memo', '메모'];

  describe('--fix', () => {
    it('머리줄과 아홉 열 한 줄을 쓰고 범위, 시각, 기준점을 채우며 출력은 두 줄이다', () => {
      const e = setup();
      fs.writeFileSync(e.usage, [use('a1 x'), use('a2 y'), use('a3 z')].join('\n') + '\n');
      const r = run(fixArgs, e);
      assert.equal(r.status, 0, r.stderr);
      const out = r.stdout.trim().split('\n');
      assert.equal(out.length, 2);
      assert.equal(out[0], `고침 기록에 한 줄 덧붙였습니다(${e.fixes})`);
      const lines = fs.readFileSync(e.fixes, 'utf8').trim().split('\n');
      assert.equal(lines[0], HEAD);
      assert.equal(out[1], lines[1]);
      const c = lines[1].split('\t');
      assert.equal(c.length, 9);
      assert.ok(!Number.isNaN(Date.parse(c[0])));
      assert.deepEqual(c.slice(1), ['/p', '프로젝트', '정정', '태그', 'docs/A.md#절', '문장', '3', '메모']);
    });

    it('두 번째 호출은 머리줄을 다시 쓰지 않고 줄만 덧붙인다', () => {
      const e = setup();
      run(fixArgs, e);
      run(fixArgs, e);
      assert.equal(fs.readFileSync(e.fixes, 'utf8').trim().split('\n').filter((l) => l === HEAD).length, 1);
      assert.equal(fs.readFileSync(e.fixes, 'utf8').trim().split('\n').length, 3);
    });

    it('필수 인자가 빠지거나 값이 집합 밖이면 종료 코드 1이고 파일을 만들지 않는다', () => {
      const e = setup();
      const without = (key) => fixArgs.filter((a, i) => a !== `--${key}` && fixArgs[i - 1] !== `--${key}`);
      for (const key of ['project', 'signal', 'label', 'where', 'how', 'memo']) assert.equal(run(without(key), e).status, 1, key);
      assert.equal(run(fixArgs.map((a) => (a === '문장' ? '고침' : a)), e).status, 1);
      assert.equal(run(fixArgs.map((a) => (a === '정정' ? '불만' : a)), e).status, 1);
      assert.equal(fs.existsSync(e.fixes), false);
    });
  });

  describe('--fixes', () => {
    it('첫 줄이 처리할 것 건수이고 이어 처리할 것 줄, 효과 표, 태그 목록을 찍는다', () => {
      const e = setup();
      fs.writeFileSync(e.fixes, [HEAD, fixRow({ anchor: '0' })].join('\n') + '\n');
      fs.writeFileSync(e.usage, [use('a1 모자람(태그): x'), use('b2 모자람(태그): y')].join('\n') + '\n');
      const r = run(['--fixes'], e);
      assert.equal(r.status, 0, r.stderr);
      const out = r.stdout.split('\n');
      assert.equal(out[0], '1');
      assert.match(out[1], /^- 재발 태그: 모자람 2건\(agentId a1, b2\)[^\n]*A\.md#절[^\n]*스크립트 또는 훅$/);
      assert.ok(r.stdout.includes('효과 표'));
      assert.match(r.stdout, /이름표\s+고침\s+마지막 고침/);
      assert.match(r.stdout, /태그\s+1\s+2026-10-20 문장\s+2\s+2\s+재발/);
      assert.match(r.stdout, /태그 목록\n- 태그: 3건, 마지막 2026-10-20/);
      assert.ok(!r.stdout.includes('경고'));
    });
  });

  describe('--due', () => {
    const lines = (n) => Array.from({ length: n }, (_, i) => use(`a${i} 줄`)).join('\n') + '\n';

    it('처리할 것이 있으면 마지막 줄에 그 자리에서 고칠 것 건수가 붙고 첫 줄 판정은 그대로다', () => {
      const e = setup();
      fs.writeFileSync(e.usage, lines(3) + [use('a1 개선(태그): x')].join('\n') + '\n');
      const r = run(['--due', '--project', '/p'], e);
      const out = r.stdout.trim().split('\n');
      assert.match(out[0], /^wait \d+$/);
      assert.match(out.at(-1), /그 자리에서 고칠 것 1건$/);
    });

    it('처리할 것이 없으면 기존 출력과 같다', () => {
      const e = setup();
      fs.writeFileSync(e.usage, lines(3));
      const withProject = run(['--due', '--project', '/p'], e).stdout;
      assert.equal(withProject, run(['--due'], e).stdout);
      assert.ok(!withProject.includes('그 자리에서 고칠 것'));
    });
  });

  describe('--log의 새 태그 알림', () => {
    const logArgs = (memo) => ['--log', '--project', '/p', '--def', 'sonnet-low', '--kind', '번역', '--result', 'ok', '--memo', memo];

    it('처음 보는 태그는 비슷한 기존 태그와 함께 끝 줄로 알리고 이미 있는 태그는 알리지 않는다', () => {
      const e = setup();
      fs.writeFileSync(e.fixes, [HEAD, fixRow({ label: '지시문 목표줄' })].join('\n') + '\n');
      const first = run(logArgs('a1 모자람(지시문 목표, 완전새것): x'), e);
      const out = first.stdout.trim().split('\n');
      assert.equal(out[2], '새 태그 지시문 목표(비슷한 기존 태그 지시문 목표줄)');
      assert.equal(out[3], '새 태그 완전새것');
      const again = run(logArgs('a2 모자람(지시문목표): y'), e);
      assert.equal(again.stdout.trim().split('\n').length, 2);
    });
  });

  describe('--log의 표에 없는 일 종류 경고', () => {
    const GUIDE = ['| | low | medium | high | xhigh |', '|:---|:---|:---|:---|:---|', '| **Sonnet** | 리뷰 지적 수정 | 구현 | | |'].join('\n');
    const setup = () => {
      const root = tmpDir();
      const dir = path.join(root, 'records');
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(root, 'routing.md'), GUIDE);
      return { root, dir, usage: path.join(dir, 'subagent-usage.tsv') };
    };
    const logKind = (e, kind, extraEnv = {}) => spawnSync(process.execPath, [RETRO, '--log', '--project', '/p', '--def', 'sonnet-low', '--kind', kind, '--result', 'ok', '--memo', 'a1 줄'], { env: { ...process.env, SUBAGENT_RECORDS_DIR: e.dir, SUBAGENT_ROUTING_FILE: path.join(e.root, 'routing.md'), SUBAGENT_CONFIG_FILE: path.join(e.root, 'config.json'), ...extraEnv }, encoding: 'utf8' });
    const warnOf = (r) => r.stdout.split('\n').filter((l) => l.startsWith('표에 없는 일 종류'));

    it('표 이름 그대로 적으면 경고하지 않는다', () => {
      const e = setup();
      assert.deepEqual(warnOf(logKind(e, '구현')), []);
      assert.deepEqual(warnOf(logKind(e, '리뷰 지적 수정')), []);
    });

    it('띄어쓰기만 다르면 그 표 이름을 가까운 표 이름으로 보인다', () => {
      const e = setup();
      assert.deepEqual(warnOf(logKind(e, '리뷰지적수정')), ['표에 없는 일 종류 리뷰지적수정(가까운 표 이름 리뷰 지적 수정)']);
    });

    it('경고가 나도 사용 기록 한 줄은 남는다', () => {
      const e = setup();
      logKind(e, '리뷰지적수정');
      const rows = fs.readFileSync(e.usage, 'utf8').trim().split('\n');
      assert.equal(rows.length, 1);
      assert.equal(rows[0].split('\t')[3], '리뷰지적수정');
    });
  });
});

describe('subagent-retro.js 사용법과 모르는 인자', () => {
  const setup = () => {
    const root = tmpDir();
    return { root, records: path.join(root, 'records'), config: path.join(root, 'config.json'), claude: path.join(root, 'claude') };
  };
  const run = (args, e) => spawnSync(process.execPath, [RETRO, ...args], { env: { ...process.env, SUBAGENT_RECORDS_DIR: e.records, SUBAGENT_CONFIG_FILE: e.config, CLAUDE_CONFIG_DIR: e.claude }, encoding: 'utf8' });
  const row = '2026-10-12\t/p\tsonnet-low\t번역\t1\t2\t3\tok\ta1 줄\n';

  it('인자가 없으면 사용법만 찍고 종료 코드 0이며, 설정 파일 내용과 기록 폴더를 바꾸지 않는다', () => {
    const e = setup();
    fs.mkdirSync(e.claude);
    fs.writeFileSync(path.join(e.claude, 'CLAUDE.md'), '규칙\n');
    const before = '{"retroMode":"ask","claudeMdKeptLines":300}';
    fs.writeFileSync(e.config, before);
    const r = run([], e);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^실행:/);
    assert.match(r.stdout, /--report/);
    assert.doesNotMatch(r.stdout, /회고 기준: \d+건|CLAUDE\.md 정리:/);
    assert.equal(fs.readFileSync(e.config, 'utf8'), before);
    assert.equal(fs.existsSync(e.records), false);
  });

  it('--help와 -h는 사용법을 찍고 종료 코드 0이다', () => {
    const e = setup();
    for (const flag of ['--help', '-h']) {
      const r = run([flag], e);
      assert.equal(r.status, 0, flag);
      assert.match(r.stdout, /--report/, flag);
    }
  });

  it('모르는 --인자는 그 이름과 사용법을 오류 출력에 찍고 종료 코드 1이며 아무것도 쓰지 않는다', () => {
    const e = setup();
    for (const args of [['--bogus'], ['--count'], ['--due', '--nope']]) {
      const r = run(args, e);
      assert.equal(r.status, 1, args.join(' '));
      assert.match(r.stderr, /알 수 없는 인자입니다: --(bogus|count|nope)/);
      assert.match(r.stderr, /--report/);
      assert.equal(r.stdout, '');
    }
    assert.equal(fs.existsSync(e.records), false);
    assert.equal(fs.existsSync(e.config), false);
  });

  it('--report는 기록이 있으면 표를 찍고, 기록이 없으면 종료 코드 1로 없다고 알린다', () => {
    const e = setup();
    const none = run(['--report'], e);
    assert.equal(none.status, 1);
    assert.match(none.stderr, /사용 기록이 없습니다/);
    fs.mkdirSync(e.records);
    fs.writeFileSync(path.join(e.records, 'subagent-usage.tsv'), row);
    const r = run(['--report'], e);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /회고 경계 없음: 전체 1줄/);
  });

  it('--log --help는 인자와 메모 쓰는 법을 찍고 기록을 쓰지 않으며, 필수 인자 오류는 그 도움말을 가리킨다', () => {
    const e = setup();
    const help = run(['--log', '--help'], e);
    assert.equal(help.status, 0, help.stderr);
    for (const part of ['--tokens', '--date', '절대 경로', '모자람(<태그>)', '개선(<태그>)', '큰따옴표']) assert.ok(help.stdout.includes(part), part);
    assert.equal(fs.existsSync(e.records), false);
    const bad = run(['--log', '--def', 'sonnet-low'], e);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /--log --help/);
  });

  it('--check-fable --help는 언제 돌리는지와 판정별 뜻을 찍고, 판정 출력에는 그 판정의 뜻과 할 일이 한 줄 붙는다', () => {
    const e = setup();
    const help = run(['--check-fable', '--help'], e);
    assert.equal(help.status, 0, help.stderr);
    for (const part of ['언제 돌리나', 'fallbackModel', 'Fable 아님:', '줄 없음:', 'fable-high 사용 기록은 적지 않는다']) assert.ok(help.stdout.includes(part), part);
    fs.mkdirSync(e.records);
    fs.writeFileSync(path.join(e.records, 'subagent-cost.tsv'), ['2026-10-25', '/p', 's1', 'a1b2c3', 'opus-xhigh', 'claude-opus-5-5', 'high', '설명', '1', '1', '1', '1', '1', '1', '0.1'].join('\t') + '\n');
    const r = run(['--check-fable', 'a1b2c3'], e);
    assert.match(r.stdout, /^뜻과 할 일: 적어도 끝부분은 Fable이 아니었습니다/m);
  });
});
