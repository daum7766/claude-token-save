// 무엇: 셸 명령이 쓰는 파일 경로를 절대 경로로 얻는 도우미(hooks/lib/shellWrites.cjs)의 풀이를 꼴마다 본다.
// 왜: 멈춤 검사의 열린 칸 대조와 결정 대조가 이 해석 하나를 함께 쓴다. `cd <폴더> && cat >> docs/plan/work/x.md` 꼴을 대화 기록의 작업 폴더 기준으로 풀어 없는 경로를 적었고(10일 125번 가운데 19번),
//   결정 대조는 같은 꼴을 못 알아봐 기록한 뒤에도 헛막았다. 한쪽만 고치면 다른 쪽이 남아서 해석을 한 곳에 모았다.
// 전제: 피드백 묶음의 bashTargets.cjs가 있어야 돈다(없으면 도우미는 null을 돌려주고 부르는 쪽이 옛 해석으로 돌아간다).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { missingFiles } from './fixtures/installedLayout.js';

const require = createRequire(import.meta.url);
const { shellWrittenFiles } = require('../../hooks/lib/shellWrites.cjs');
const HOME = '/home/u';
const CWD = '/proj/app';
const files = (cmd, cwd = CWD) => shellWrittenFiles(cmd, cwd, HOME);
const SKIP = { skip: missingFiles('subagent-system/hooks/bashTargets.cjs') };

describe('shellWrittenFiles: 셸 명령이 쓰는 파일', SKIP, () => {
  it('cd 뒤 상대경로는 작업 폴더가 아니라 cd 대상 기준으로 푼다(11-08 08:16:25Z 꼴)', () => {
    assert.deepEqual(files("cd ~/.claude && cat >> docs/plan/work/p.md <<'EOF'\nx\nEOF"), [`${HOME}/.claude/docs/plan/work/p.md`]);
    assert.deepEqual(files('cd /elsewhere && echo x >> docs/plan/work/p.md'), ['/elsewhere/docs/plan/work/p.md']);
    assert.deepEqual(files('cd ~/.claude/docs/plan/work && echo x > p.md'), [`${HOME}/.claude/docs/plan/work/p.md`]);
    assert.deepEqual(files('cd $HOME/.claude && echo x >> docs/plan/p.md'), [`${HOME}/.claude/docs/plan/p.md`]);
  });

  it('cd가 없으면 작업 폴더 기준이고 절대 경로와 ~ 경로는 그대로 얻는다', () => {
    assert.deepEqual(files('echo x >> docs/plan/work/p.md'), [`${CWD}/docs/plan/work/p.md`]);
    assert.deepEqual(files('echo x >> ~/.claude/docs/plan/p.md'), [`${HOME}/.claude/docs/plan/p.md`]);
    assert.deepEqual(files('echo x >> $HOME/a/p.md'), [`${HOME}/a/p.md`]);
    assert.deepEqual(files('echo x > /abs/p.md'), ['/abs/p.md']);
  });

  it('python3 heredoc 안의 p=… 뒤 open(p, "w")와 open("…", "w")를 cd 대상 기준으로 얻는다', () => {
    assert.deepEqual(files("cd ~/.claude && python3 - <<'EOF'\np='docs/plan/work/x.md'\ns=open(p).read()\nopen(p,'w').write(s+'a')\nEOF"), [`${HOME}/.claude/docs/plan/work/x.md`]);
    assert.deepEqual(files("cd /r && python3 - <<'EOF'\nopen('docs/plan/y.md','a').write('b')\nEOF"), ['/r/docs/plan/y.md']);
    assert.deepEqual(files("cd ~/.claude/docs/plan/work && python3 - <<'EOF'\nf='k.md'\nopen(f,'w').write('1')\nEOF"), [`${HOME}/.claude/docs/plan/work/k.md`]);
    assert.deepEqual(files("python3 - <<'EOF'\nimport os\nopen(os.path.expanduser('~/.claude/docs/plan/z.md'),'a').write('x')\nEOF"), [`${HOME}/.claude/docs/plan/z.md`]);
  });

  it('sed -i, tee, 리다이렉트, cp와 mv의 받는 쪽을 얻는다', () => {
    assert.deepEqual(files("cd ~/.claude && sed -i '' 's/a/b/' docs/plan/q.md"), [`${HOME}/.claude/docs/plan/q.md`]);
    assert.deepEqual(files('echo hi | tee -a docs/plan/work/t.md'), [`${CWD}/docs/plan/work/t.md`]);
    assert.deepEqual(files('cd /r && cp a.md docs/plan/b.md'), ['/r/docs/plan/b.md']);
    assert.deepEqual(files('cd /r && mv a.md docs/plan/c.md'), ['/r/a.md', '/r/docs/plan/c.md']);
  });

  it('읽기만 하는 명령과 /dev/null 리다이렉트, 대상을 모르는 바꿈은 경로로 얻지 않는다', () => {
    assert.deepEqual(files('cat docs/plan/work/t.md | head'), []);
    assert.deepEqual(files("cd ~/.claude && grep -n x docs/plan/work/t.md 2>/dev/null"), []);
    assert.deepEqual(files('echo x > /dev/null'), []);
    assert.deepEqual(files('git status'), []);
    assert.deepEqual(files('ls | xargs rm'), []);
    assert.deepEqual(files(''), []);
  });

  it('세션 워크트리 안 파일은 워크트리 경로 그대로 얻는다(저장소 경로로 합치는 일은 부르는 쪽 몫)', () => {
    assert.deepEqual(files("cd /r/.claude/worktrees/w && python3 - <<'EOF'\nopen('docs/plan/D.md','w')\nEOF"), ['/r/.claude/worktrees/w/docs/plan/D.md']);
  });

  it('값이 빈 입력이어도 배열을 돌려준다', () => {
    assert.deepEqual(shellWrittenFiles(undefined, CWD, HOME), []);
    assert.deepEqual(shellWrittenFiles('echo x > rel.md', '', HOME), []);
  });
});
