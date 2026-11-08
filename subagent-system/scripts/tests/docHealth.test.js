import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { totalGate, sections, undecidedState, pathTokens } from '../docHealth.js';

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const METRICS = path.join(SCRIPTS, 'work-metrics.js');
const RETRO = path.join(SCRIPTS, 'subagent-retro.js');
const SESSION = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const roots = [];
after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (cwd, args, env = {}) => spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...GIT_ENV, ...env } });

// 임시 저장소에 파일을 쓰고 커밋한다. old가 true면 커밋 시각을 오래전으로 둔다.
function makeEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-health-'));
  roots.push(root);
  const repo = path.join(root, 'repo');
  const claude = path.join(root, 'claude');
  const records = path.join(root, 'records');
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(path.join(claude, 'projects', '-p'), { recursive: true });
  git(repo, ['init', '-q', '-b', 'main']);
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), text);
  };
  const commit = (old = false) => {
    git(repo, ['add', '-A']);
    const date = old ? '2020-01-01T00:00:00' : undefined;
    git(repo, ['commit', '-q', '-m', 'x'], date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {});
  };
  const health = (extra = []) => {
    const r = spawnSync('node', [METRICS, 'health', '--repo', repo, '--json', ...extra], { encoding: 'utf8', env: { ...process.env, HOME: root, CLAUDE_CONFIG_DIR: claude, SUBAGENT_RECORDS_DIR: records } });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  return { root, repo, claude, records, write, commit, health };
}
const finishedPaths = (j) => j.repos[0].finished.map((w) => w.path);
const stalledPaths = (j) => j.repos[0].stalled.map((w) => w.path);

describe('다 쓴 기록 후보', () => {
  it('열린 칸이 없고 정본이 가리키지 않는 진행 기록은 후보에 오르고 증거 네 가지가 함께 나온다', () => {
    const e = makeEnv();
    e.write('docs/plan/work/a-progress.md', '# 진행\n- [x] 끝\n');
    e.commit();
    const j = e.health();
    assert.deepEqual(finishedPaths(j), ['docs/plan/work/a-progress.md']);
    const w = j.repos[0].finished[0];
    assert.equal(w.refs, 0);
    assert.equal(w.openBoxes, 0);
    assert.equal(w.session.state, '표지 없음');
    assert.equal(w.branch.state, '브랜치 없음');
  });

  it('정본 문서가 그 경로를 가리키는 줄이 있으면 후보에서 빠지고 가리키는 줄 수가 나온다', () => {
    const e = makeEnv();
    e.write('docs/plan/work/a-progress.md', '# 진행\n- [x] 끝\n');
    e.write('docs/guide.md', '자세한 것은 `docs/plan/work/a-progress.md`에 있다.\n');
    e.commit();
    const j = e.health();
    assert.deepEqual(finishedPaths(j), []);
    assert.equal(j.repos[0].workItems[0].refs, 1);
  });

  it('열린 칸이 남은 진행 기록은 후보가 아니다', () => {
    const e = makeEnv();
    e.write('docs/plan/work/a-progress.md', '# 진행\n- [ ] 할 일\n');
    e.commit();
    assert.deepEqual(finishedPaths(e.health()), []);
  });

  it('머리에 끝나면 지운다고 적힌 파일은 작업 기록 폴더 밖에 있어도 작업 기록으로 센다', () => {
    const e = makeEnv();
    e.write('notes/tmp.md', '# 메모\n이 파일은 끝나면 지운다.\n');
    e.commit();
    assert.deepEqual(finishedPaths(e.health()), ['notes/tmp.md']);
  });

  it('본문 깊은 곳에 끝나면 지운다는 말이 있어도 머리에 없으면 작업 기록으로 세지 않는다', () => {
    const e = makeEnv();
    e.write('docs/rule.md', '# 규칙\n1\n2\n3\n4\n5\n6\n7\nplan은 끝나면 지운다.\n');
    e.commit();
    assert.deepEqual(e.health().repos[0].workItems, []);
  });

  it('세션 표지의 대화 기록이 며칠 안에 바뀌었으면 쓰는 중이라 후보가 아니고 오래 안 바뀌었으면 후보다', () => {
    const e = makeEnv();
    e.write('docs/plan/work/a-progress.md', `# 진행\n세션: ${SESSION}\n- [x] 끝\n`);
    e.commit();
    const jsonl = path.join(e.claude, 'projects', '-p', `${SESSION}.jsonl`);
    fs.writeFileSync(jsonl, '{}\n');
    const busy = e.health();
    assert.equal(busy.repos[0].workItems[0].session.state, '쓰는 중');
    assert.deepEqual(finishedPaths(busy), []);
    const old = new Date('2020-01-01');
    fs.utimesSync(jsonl, old, old);
    assert.deepEqual(finishedPaths(e.health()), ['docs/plan/work/a-progress.md']);
  });

  it('이름에 이어진 브랜치가 머지되지 않았으면 후보가 아니고 머지됐으면 후보다', () => {
    const e = makeEnv();
    e.write('docs/plan/work/feat-progress.md', '# 진행\n- [x] 끝\n');
    e.commit();
    git(e.repo, ['checkout', '-q', '-b', 'wt/feat']);
    e.write('x.txt', 'x');
    e.commit();
    git(e.repo, ['checkout', '-q', 'main']);
    const open = e.health();
    assert.equal(open.repos[0].workItems[0].branch.state, '머지 안 됨');
    assert.deepEqual(finishedPaths(open), []);
    git(e.repo, ['merge', '-q', 'wt/feat']);
    assert.deepEqual(finishedPaths(e.health()), ['docs/plan/work/feat-progress.md']);
  });

  it('결정 문서의 아직 안 정한 것 절에 줄이 남아 있으면 열린 칸이 없어도 후보가 아니다', () => {
    const e = makeEnv();
    e.write('docs/plan/work/a-progress.md', '# 진행\n결정 문서 `docs/plan/decision.md`\n- [x] 끝\n');
    e.write('docs/plan/decision.md', '# 결정\n## 아직 안 정한 것\n- 이름\n');
    e.commit();
    const j = e.health();
    assert.deepEqual(finishedPaths(j), []);
    assert.match(j.repos[0].workItems[0].undecided, /1줄 남음/);
  });

  it('git 밖 임시 작업 폴더의 하위 폴더는 정본이 가리키지 않으면 후보에 오른다', () => {
    const e = makeEnv();
    e.write('.gitignore', '_temp/\n');
    e.write('docs/readme.md', '문서\n');
    e.commit();
    fs.mkdirSync(path.join(e.repo, 'docs', '_temp', 'old-job'), { recursive: true });
    fs.writeFileSync(path.join(e.repo, 'docs', '_temp', 'old-job', 'a.md'), 'x');
    const j = e.health();
    assert.deepEqual(finishedPaths(j), ['docs/_temp/old-job/']);
  });

  it('결정 문서와 기획서는 아무리 오래돼도 다 쓴 기록 후보나 멈춘 기록에 오르지 않는다', () => {
    const e = makeEnv();
    e.write('docs/plan/decision.md', '<!-- decision-doc -->\n# 결정\n- [ ] 남은 것\n');
    e.commit(true);
    const j = e.health();
    assert.deepEqual(finishedPaths(j), []);
    assert.deepEqual(stalledPaths(j), []);
  });
});

describe('멈춘 진행 기록', () => {
  it('열린 칸이 있고 기준일 넘게 안 바뀐 진행 기록은 잡힌다', () => {
    const e = makeEnv();
    e.write('docs/plan/work/a-progress.md', '# 진행\n- [ ] 할 일\n');
    e.commit(true);
    assert.deepEqual(stalledPaths(e.health()), ['docs/plan/work/a-progress.md']);
  });

  it('기다림 줄이 있으면 오래돼도 멈춘 기록으로 잡지 않는다', () => {
    const e = makeEnv();
    e.write('docs/plan/work/a-progress.md', '# 진행\n- [ ] 할 일\n기다림: 사용자 답\n');
    e.commit(true);
    assert.deepEqual(stalledPaths(e.health()), []);
  });

  it('방금 바뀐 진행 기록은 열린 칸이 있어도 멈춘 기록이 아니다', () => {
    const e = makeEnv();
    e.write('docs/plan/work/a-progress.md', '# 진행\n- [ ] 할 일\n');
    e.commit();
    assert.deepEqual(stalledPaths(e.health()), []);
  });
});

describe('부푼 문서', () => {
  it('결정 문서 표시가 있고 인용 부호가 기준을 넘으면 잡히고 작은 결정 문서는 잡히지 않는다', () => {
    const e = makeEnv();
    e.write('docs/plan/big.md', `<!-- decision-doc -->\n# 결정\n${'「말」\n'.repeat(60)}`);
    e.write('docs/plan/small.md', '<!-- decision-doc -->\n# 결정\n「말」\n');
    e.commit();
    assert.deepEqual(e.health().repos[0].bloated.map((b) => b.path), ['docs/plan/big.md']);
  });

  it('근거 절이 문서의 큰 몫이고 천 자 넘는 표 행이 있으면 둘 다 이유로 찍힌다', () => {
    const e = makeEnv();
    const row = `| ${'가'.repeat(1100)} |\n`;
    e.write('CLAUDE.md', `# 규칙\n${'본문\n'.repeat(200)}## 근거\n${'근거 문장입니다.\n'.repeat(300)}${row}`);
    e.commit();
    const b = e.health().repos[0].bloated[0];
    assert.equal(b.path, 'CLAUDE.md');
    assert.ok(b.why.some((w) => w.startsWith('근거 절')), b.why.join());
    assert.ok(b.why.some((w) => w.includes('표 행')), b.why.join());
  });
});

describe('쌓인 백업', () => {
  it('이름의 숫자만 다른 백업이 둘 넘으면 가장 새것을 남기고 나머지를 후보로 내고, 하나뿐이면 내지 않는다', () => {
    // 백업을 만드는 곳이 지우는 때를 두지 않아 회고와 갱신마다 쌓였다.
    const e = makeEnv();
    e.write('docs/a.md', 'a\n');
    e.commit();
    const old = path.join(e.repo, 'sys-backup-retro-20260101-000000');
    const neu = path.join(e.repo, 'sys-backup-retro-20260102-000000');
    fs.mkdirSync(old); fs.mkdirSync(neu);
    fs.utimesSync(old, new Date('2026-01-01'), new Date('2026-01-01'));
    fs.writeFileSync(path.join(e.repo, 'one.json.bak-sync-20260101'), '{}');
    const [g, ...rest] = e.health().repos[0].backups;
    assert.equal(rest.length, 0);
    assert.equal(g.keep, 'sys-backup-retro-20260102-000000');
    assert.deepEqual(g.older, ['sys-backup-retro-20260101-000000']);
  });
});

describe('끊긴 경로', () => {
  it('정본 문서가 가리키는 파일이 없으면 잡히고 있는 파일이나 docs/를 뗀 경로는 잡히지 않는다', () => {
    const e = makeEnv();
    e.write('docs/a.md', '있음 `docs/b.md`, 줄임 `sub/c.md`, 없음 `docs/nope.md`\n');
    e.write('docs/b.md', 'b\n');
    e.write('docs/sub/c.md', 'c\n');
    e.commit();
    assert.deepEqual(e.health().repos[0].broken.map((b) => b.ref), ['docs/nope.md']);
  });

  it('기준 폴더를 알 수 없는 경로(파일 이름만, 저장소 맨 위에 없는 폴더로 시작)는 끊긴 경로로 세지 않는다', () => {
    // 스킬 폴더 기준의 scripts/x.js나 이름만 적은 x.md는 어디서 찾을지 몰라 맞는지 가를 수 없다. 세면 오탐이 끊김의 대부분을 차지했다.
    const e = makeEnv();
    e.write('docs/a.md', '이름만 `nope.md`, 모르는 기준 `scripts/nope.js`, 맨 위 폴더 `docs/gone.md`\n');
    e.commit();
    assert.deepEqual(e.health().repos[0].broken.map((b) => b.ref), ['docs/gone.md']);
  });

  it('작업 기록이 가리키는 없는 경로는 끊긴 경로로 세지 않는다', () => {
    const e = makeEnv();
    e.write('docs/plan/work/a-progress.md', '`docs/nope.md`\n');
    e.commit();
    assert.deepEqual(e.health().repos[0].broken, []);
  });

  it('정본이 git이 무시하는 폴더 안 경로를 가리키면 그 줄이 잡힌다', () => {
    const e = makeEnv();
    e.write('.gitignore', '_temp/\n');
    e.write('docs/a.md', '표는 `docs/_temp/audit/result.md`에 있다.\n');
    e.commit();
    const out = e.health().repos[0].outside;
    assert.equal(out.length, 1);
    assert.equal(out[0].ref, 'docs/_temp/audit/result.md');
  });

  it('git이 보는 파일만 가리키는 정본은 git 밖을 가리키는 줄에 잡히지 않는다', () => {
    const e = makeEnv();
    e.write('.gitignore', '_temp/\n');
    e.write('docs/a.md', '`docs/b.md`\n');
    e.write('docs/b.md', 'b\n');
    e.commit();
    assert.deepEqual(e.health().repos[0].outside, []);
  });
});

describe('재기만 하는 지표', () => {
  it('앞 회고 값보다 늘었으면 늘어난 지표로 잡히고 처음 보는 지표는 기록만 한다', () => {
    const e = makeEnv();
    e.write('docs/a.md', '1\n2\n3\n');
    e.commit();
    const first = e.health();
    assert.equal(first.rose.length, 0);
    assert.ok(first.seeded.length >= 1);
    const file = path.join(e.records, 'health-history.tsv');
    const key = first.seeded.find((s) => s.key.startsWith('문서 줄 수')).key;
    fs.writeFileSync(file, `시각\t종류\t키\t값\t메모\n2026-01-01T00:00:00Z\t지표\t${key}\t1\t\n`);
    const second = e.health();
    assert.deepEqual(second.rose.map((r) => [r.before, r.value]), [[1, 3]]);
  });

  it('줄어든 지표는 늘어난 지표에 잡히지 않는다', () => {
    const e = makeEnv();
    e.write('docs/a.md', '1\n');
    e.commit();
    const key = e.health().seeded.find((s) => s.key.startsWith('문서 줄 수')).key;
    fs.writeFileSync(path.join(e.records, 'health-history.tsv'), `시각\t종류\t키\t값\t메모\n2026-01-01T00:00:00Z\t지표\t${key}\t99\t\n`);
    assert.deepEqual(e.health().rose, []);
  });
});

describe('메모리 점검', () => {
  const setupMemory = () => {
    const e = makeEnv();
    e.write('docs/rule.md', '규칙\n');
    e.commit();
    const mem = path.join(e.root, 'memory');
    fs.mkdirSync(mem);
    const put = (f, t) => fs.writeFileSync(path.join(mem, f), t);
    return { e, mem, put };
  };
  const run = (e, mem) => e.health(['--memory', mem]).memories[0];

  it('메모리 파일의 끊긴 경로와 규칙 자리 표시 없는 파일과 목록 어긋남과 유효 기한 지남이 각각 잡힌다', () => {
    const { e, mem, put } = setupMemory();
    put('MEMORY.md', '- [좋음](good.md) 설명 (규칙은 docs/rule.md)\n- [없는 파일](gone.md) 설명\n');
    put('good.md', '본문 `docs/rule.md`\n');
    put('bad.md', '본문 `docs/missing.md`\n유효: 2020-01-01\n');
    const m = run(e, mem);
    assert.deepEqual(m.broken.map((b) => b.ref), ['docs/missing.md']);
    assert.deepEqual(m.noRuleMark, ['bad.md']);
    assert.deepEqual(m.orphanIndex, ['gone.md']);
    assert.deepEqual(m.unlisted, ['bad.md']);
    assert.deepEqual(m.expired.map((x) => x.file), ['bad.md']);
    assert.ok(m.index.lines >= 2 && m.index.bytes > 0);
  });

  it('문서 자리 없음 표시가 있는 파일은 규칙 자리 표시 없음에 잡히지 않는다', () => {
    const { e, mem, put } = setupMemory();
    put('MEMORY.md', '- [사실](fact.md) 설명\n');
    put('fact.md', '문서 자리 없음: 사실만 둠\n');
    assert.deepEqual(run(e, mem).noRuleMark, []);
  });

  it('가리키는 규칙 파일의 마지막 커밋이 메모리 수정 시각보다 새것이면 어긋남 의심으로 잡힌다', () => {
    const { e, mem, put } = setupMemory();
    put('MEMORY.md', '- [좋음](good.md) 설명\n');
    put('good.md', '경위\n(규칙은 `docs/rule.md`)\n');
    const old = new Date('2020-01-01');
    fs.utimesSync(path.join(mem, 'good.md'), old, old);
    const m = run(e, mem);
    assert.equal(m.mismatch.length, 1);
    assert.equal(m.mismatch[0].file, 'good.md');
    fs.utimesSync(path.join(mem, 'good.md'), new Date(), new Date());
    assert.deepEqual(run(e, mem).mismatch, []);
  });

  it('앞 회고 경계 뒤에 커밋된 규칙만 어긋남 의심으로 잡는다', () => {
    // 앞 회고가 이미 읽고 판정한 어긋남을 회고마다 다시 내지 않으려는 것이다.
    const { e, mem, put } = setupMemory();
    put('MEMORY.md', '- [좋음](good.md) 설명\n');
    put('good.md', '경위\n(규칙은 `docs/rule.md`)\n');
    const old = new Date('2020-01-01');
    fs.utimesSync(path.join(mem, 'good.md'), old, old);
    fs.mkdirSync(e.records, { recursive: true });
    fs.writeFileSync(path.join(e.records, 'health-history.tsv'), `시각\t종류\t키\t값\t메모\n${new Date(Date.now() + 60000).toISOString()}\t합계\t-\t5\t\n`);
    assert.deepEqual(run(e, mem).mismatch, []);
  });
});

describe('합계 한 줄', () => {
  it('텍스트 출력 끝에 항목별 수와 합계가 한 줄로 나온다', () => {
    const e = makeEnv();
    e.write('docs/plan/work/a-progress.md', '# 진행\n- [x] 끝\n');
    e.commit();
    const r = spawnSync('node', [METRICS, 'health', '--repo', e.repo], { encoding: 'utf8', env: { ...process.env, HOME: e.root, CLAUDE_CONFIG_DIR: e.claude, SUBAGENT_RECORDS_DIR: e.records } });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout.trim().split('\n').at(-1), /^합계 1건: 다 쓴 기록 후보 1,/);
  });
});

describe('문서 속 낱말 읽기', () => {
  it('백틱 안 경로와 줄 번호 꼬리를 읽고 주소와 선택지 낱말은 경로로 읽지 않는다', () => {
    assert.deepEqual(pathTokens('`docs/a.md#절` 과 https://x.com/a/b 와 있음/없음'), ['docs/a.md']);
  });

  it('아직 안 정한 것 절은 없음 한 줄이면 빈 것으로 읽는다', () => {
    assert.equal(undecidedState('# 결정\n## 아직 안 정한 것\n없음\n').empty, true);
    assert.equal(undecidedState('# 결정\n## 아직 안 정한 것\n- a\n').empty, false);
    assert.equal(undecidedState('# 결정\n').found, false);
    assert.equal(sections('# a\n## b\nx\n').length, 2);
  });
});

describe('회고 합계 문턱', () => {
  const prior = (...v) => v.map((value, i) => ({ at: String(i), value }));

  it('앞 기록이 둘 안 되면 합계가 늘어도 통과한다', () => {
    assert.equal(totalGate(50, prior(10), '').ok, true);
    assert.equal(totalGate(50, [], '').ok, true);
  });

  it('앞 두 값보다 줄지 않았는데 공통 뿌리 문장이 없으면 거절한다', () => {
    const g = totalGate(10, prior(8, 10), '');
    assert.equal(g.ok, false);
    assert.match(g.reason, /--root/);
  });

  it('줄지 않았어도 공통 뿌리 문장이 있으면 통과하고 앞 값 하나라도 넘게 줄었으면 문장 없이 통과한다', () => {
    assert.equal(totalGate(10, prior(8, 10), '같은 뿌리').ok, true);
    assert.equal(totalGate(7, prior(8, 10), '').ok, true);
  });

  describe('subagent-retro.js --mark --health 실행', () => {
    const setup = () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-health-mark-'));
      roots.push(dir);
      fs.writeFileSync(path.join(dir, 'subagent-usage.tsv'), '2026-10-12\t/p\tsonnet-low\t번역\t1\t2\t3\tok\ta0 줄\n');
      fs.writeFileSync(path.join(dir, 'msgs.tsv'), '# 사용 줄\t1\n# 추출 시각\t2026-10-13T00:00:00.000Z\n');
      const env = { ...process.env, SUBAGENT_RECORDS_DIR: dir, SUBAGENT_GUIDE_FILE: path.join(dir, 'no-guide.md'), SUBAGENT_CONFIG_FILE: path.join(dir, 'no-config.json'), CLAUDE_CONFIG_DIR: path.join(dir, 'claude') };
      // 회고마다 사용 기록에 줄이 늘고 메시지 파일의 사용 줄 수가 그 뒤를 따라야 앞 회고의 경계 줄과 겹치지 않는다.
      let n = 1;
      const mark = (extra) => {
        const usage = path.join(dir, 'subagent-usage.tsv');
        const have = fs.readFileSync(usage, 'utf8').split('\n').filter(Boolean).length;
        fs.appendFileSync(usage, `2026-10-12\t/p\tsonnet-low\t번역\t1\t2\t3\tok\tb${n++} 줄\n`);
        fs.writeFileSync(path.join(dir, 'msgs.tsv'), `# 사용 줄\t${have + 1}\n# 추출 시각\t2026-10-13T00:00:00.000Z\n`);
        return spawnSync(process.execPath, [RETRO, '--mark', '메모', '--messages', path.join(dir, 'msgs.tsv'), '--changed', '1', ...extra], { env, encoding: 'utf8' });
      };
      const hist = () => fs.readFileSync(path.join(dir, 'health-history.tsv'), 'utf8').trim().split('\n').slice(1).map((l) => l.split('\t'));
      return { dir, mark, hist };
    };

    it('앞 두 회고보다 합계가 줄지 않으면 종료 코드 1로 거절하고 사용 기록에 쓰지 않으며 공통 뿌리 문장을 주면 통과한다', () => {
      const s = setup();
      assert.equal(s.mark(['--health', '10']).status, 0);
      assert.equal(s.mark(['--health', '10']).status, 0);
      const refused = s.mark(['--health', '10']);
      assert.equal(refused.status, 1);
      assert.match(refused.stderr, /--root/);
      // 거절된 회고는 경계 줄을 쓰지 않는다(시험이 덧붙인 일반 줄만 늘어난다).
      assert.equal(fs.readFileSync(path.join(s.dir, 'subagent-usage.tsv'), 'utf8').split('\n').filter((l) => l.startsWith('회고')).length, 2);
      const ok = s.mark(['--health', '10', '--root', '같은 뿌리']);
      assert.equal(ok.status, 0, ok.stderr);
      assert.deepEqual(s.hist().map((c) => [c[1], c[3], c[4]]).at(-1), ['합계', '10', '같은 뿌리']);
    });

    it('합계가 앞 값보다 줄면 공통 뿌리 문장 없이 통과하고 --health를 안 주면 기록을 만들지 않는다', () => {
      const s = setup();
      s.mark(['--health', '10']);
      s.mark(['--health', '12']);
      assert.equal(s.mark(['--health', '9']).status, 0);
      const t = setup();
      assert.equal(t.mark([]).status, 0);
      assert.equal(fs.existsSync(path.join(t.dir, 'health-history.tsv')), false);
    });

    it('--health가 숫자가 아니면 거절한다', () => {
      assert.equal(setup().mark(['--health', 'x']).status, 1);
    });
  });
});
