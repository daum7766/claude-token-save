import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOOK = path.join(SUB, 'hooks', 'brief-check.js');
const { parseRoutingTable } = createRequire(import.meta.url)(HOOK);

const TABLE = [
  '| | low | medium | high | xhigh |',
  '|:---|:---|:---|:---|:---|',
  '| **Haiku** | 파일 탐색과 검색 | 번역 키 반영 | | |',
  '| **Sonnet** | 분석과 가공「(시험: 다음 1건 `haiku-high`)」, 코드 정리 검토(/simplify, 찾기만) | 문서 작성, 구현과 문서 | 리뷰 지적 수정 | |',
  '| **Opus** | 데이터 가공 | 영향 범위 조사(바뀌는 코드와 컴포넌트를 쓰는 곳 전수) 「(고정)」 | 최종 코드 리뷰 「(고정)」 | 다시 보내는 일 |',
].join('\n');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brief-check-'));
const tableFile = path.join(dir, 'ROUTING_TABLE.md');
fs.writeFileSync(tableFile, `# 라우팅 표\n\n${TABLE}\n`);

function run(toolInput, { routing = tableFile, toolName = 'Agent', hook = HOOK, records = path.join(dir, 'no-records') } = {}) {
  const env = { ...process.env, SUBAGENT_RECORDS_DIR: records };
  if (routing === null) delete env.BRIEF_CHECK_ROUTING_FILES;
  else env.BRIEF_CHECK_ROUTING_FILES = routing;
  const r = spawnSync(process.execPath, [hook], { input: JSON.stringify({ tool_name: toolName, tool_input: toolInput }), encoding: 'utf8', env });
  return { status: r.status, out: r.stdout ? JSON.parse(r.stdout) : null };
}

const FILLER = '세부 지시: 아래 파일들을 읽고 요구대로 고친다. '.repeat(40);
const GOAL = '목표: 훅이 입력표대로 막고 통과시키는 것.\n';
const DOC = '결정 문서: /work/docs/decision.md\n';
const brief = (head) => head + FILLER;
const medium = { subagent_type: 'sonnet-medium', description: '문서 작성' };

function reason(r) {
  assert.equal(r.out.hookSpecificOutput.permissionDecision, 'deny');
  return r.out.hookSpecificOutput.permissionDecisionReason;
}

describe('지시문 검사 훅 brief-check', () => {
  it('목표 줄이 없는 600자 넘는 지시는 deny하고 목표 줄이 빠졌다고 알린다', () => {
    assert.match(reason(run({ ...medium, prompt: brief(DOC) })), /`목표:` 줄이 없다/);
  });

  it('목표 줄과 결정 문서 경로가 있으면 통과한다', () => {
    assert.equal(run({ ...medium, prompt: brief(GOAL + DOC) }).out, null);
  });

  it('결정 문서: 없음(까닭)이 있으면 통과한다', () => {
    assert.equal(run({ ...medium, prompt: brief(GOAL + '결정 문서: 없음(이번 일은 대화에서 정한 것이 없다)\n') }).out, null);
  });

  it('결정 문서 경로도 없음 표시도 없으면 deny한다', () => {
    assert.match(reason(run({ ...medium, prompt: brief(GOAL) })), /결정 문서 경로가 없다/);
  });

  it('까닭이 빈 「결정 문서: 없음()」은 deny한다', () => {
    assert.match(reason(run({ ...medium, prompt: brief(GOAL + '결정 문서: 없음()\n') })), /결정 문서 경로가 없다/);
  });

  it('목표와 결정 문서가 모두 빠지면 둘 다 알린다', () => {
    const msg = reason(run({ ...medium, prompt: brief('') }));
    assert.match(msg, /`목표:` 줄/);
    assert.match(msg, /결정 문서 경로/);
  });

  it('deny 메시지에 왜와 전제가 들어 있다', () => {
    const msg = reason(run({ ...medium, prompt: brief('') }));
    assert.match(msg, /왜:/);
    assert.match(msg, /전제:/);
  });

  it('haiku 정의는 목표 줄이 없어도 통과한다', () => {
    assert.equal(run({ subagent_type: 'haiku-low', description: '파일 탐색과 검색', prompt: brief('') }).out, null);
  });

  it('prompt가 599자면 통과하고 600자면 검사한다', () => {
    assert.equal(run({ ...medium, prompt: 'a'.repeat(599) }).out, null);
    assert.match(reason(run({ ...medium, prompt: 'a'.repeat(600) })), /`목표:` 줄/);
  });

  it('표 칸보다 높은 정의로 보내면서 높임이 없으면 deny한다', () => {
    assert.match(reason(run({ subagent_type: 'opus-high', description: '문서 작성', prompt: brief(GOAL + DOC) })), /높임:/);
  });

  it('prompt나 description에 높임 까닭이 있으면 통과한다', () => {
    assert.equal(run({ subagent_type: 'opus-high', description: '문서 작성', prompt: brief(GOAL + DOC + '높임: 판단이 갈려 놓치면 신호가 없다\n') }).out, null);
    assert.equal(run({ subagent_type: 'opus-high', description: '문서 작성 높임: 범위가 넓다', prompt: brief(GOAL + DOC) }).out, null);
  });

  it('올림 줄이 있으면 표 칸보다 높은 정의여도 통과하고, 거절 문구가 올림 길도 알린다', () => {
    const up = { subagent_type: 'sonnet-medium', description: '분석과 가공' };
    assert.match(reason(run({ ...up, prompt: brief(GOAL + DOC) })), /올림:/);
    assert.equal(run({ ...up, prompt: brief(GOAL + DOC + '올림: sonnet-low에서 파일을 빠뜨려 올림\n') }).out, null);
    assert.equal(run({ subagent_type: 'opus-xhigh', description: '문서 작성', prompt: brief(GOAL + DOC + '올림: opus-high 실패, Fable 단계\n') }).out, null);
  });

  it('올림 줄이 있어도 목표와 결정 문서 검사는 그대로 한다', () => {
    const msg = reason(run({ subagent_type: 'opus-xhigh', description: '문서 작성', prompt: brief('올림: 앞 실패\n') }));
    assert.match(msg, /`목표:` 줄/);
    assert.match(msg, /결정 문서 경로/);
  });

  it('표 칸과 같거나 낮은 정의는 높임이 없어도 통과한다', () => {
    assert.equal(run({ ...medium, prompt: brief(GOAL + DOC) }).out, null);
    assert.equal(run({ subagent_type: 'sonnet-low', description: '리뷰 지적 수정', prompt: brief(GOAL + DOC) }).out, null);
  });

  it('괄호 안 쉼표가 있는 일 이름도 표 칸으로 찾는다', () => {
    assert.match(reason(run({ subagent_type: 'sonnet-high', description: '코드 정리 검토', prompt: brief(GOAL + DOC) })), /sonnet-low 칸/);
  });

  it('쪼갠 두 칸(일[기준] 둘)은 다른 일로 읽어 쉬운 쪽을 표보다 높게 보내면 deny한다', () => {
    const split = [
      '| | low | medium | high | xhigh |',
      '|:---|:---|:---|:---|:---|',
      '| **Sonnet** | | 버그 원인 찾기[재현 있음] | | |',
      '| **Opus** | | | 버그 원인 찾기[재현 없음] 「(고정)」, 「무조건 Opus」 영역 판단 | |',
    ].join('\n');
    const names = parseRoutingTable(split).map((x) => x.name);
    assert.deepEqual(names, ['버그 원인 찾기[재현 있음]', '버그 원인 찾기[재현 없음]', '「무조건 Opus」 영역 판단']);
    const file = path.join(dir, 'ROUTING_SPLIT.md');
    fs.writeFileSync(file, split);
    const input = { subagent_type: 'opus-high', description: '버그 원인 찾기[재현 있음]', prompt: brief(GOAL + DOC) };
    assert.match(reason(run(input, { routing: file })), /sonnet-medium 칸/);
    assert.equal(run({ ...input, description: '버그 원인 찾기[재현 없음]' }, { routing: file }).out, null);
  });

  it('표에서 일 종류를 못 찾거나 정의 이름이 표 형식이 아니면 정의 비교를 건너뛴다', () => {
    assert.equal(run({ subagent_type: 'opus-xhigh', description: '표에 없는 일', prompt: brief(GOAL + DOC) }).out, null);
    assert.equal(run({ subagent_type: 'general-purpose', description: '문서 작성', prompt: brief(GOAL + DOC) }).out, null);
  });

  it('표 파일을 읽지 못하면 정의 비교만 건너뛰고 목표 검사는 그대로 한다', () => {
    const missing = path.join(dir, 'none.md');
    assert.equal(run({ subagent_type: 'opus-high', description: '문서 작성', prompt: brief(GOAL + DOC) }, { routing: missing }).out, null);
    assert.match(reason(run({ subagent_type: 'opus-high', description: '문서 작성', prompt: brief(DOC) }, { routing: missing })), /`목표:` 줄/);
  });

  it('Agent가 아닌 도구 입력과 깨진 입력은 막지 않고 통과한다', () => {
    assert.equal(run({ prompt: brief('') }, { toolName: 'Bash' }).out, null);
    const r = spawnSync(process.execPath, [HOOK], { input: 'not json', encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  });

  it('환경 변수가 없으면 훅 옆 설치본 docs/ROUTING_TABLE.md의 표로 정의 비교를 한다', () => {
    const installed = fs.mkdtempSync(path.join(os.tmpdir(), 'brief-check-installed-'));
    fs.mkdirSync(path.join(installed, 'hooks'));
    fs.mkdirSync(path.join(installed, 'docs'));
    fs.copyFileSync(HOOK, path.join(installed, 'hooks', 'brief-check.js'));
    fs.copyFileSync(path.join(SUB, 'hooks', 'package.json'), path.join(installed, 'hooks', 'package.json'));
    fs.writeFileSync(path.join(installed, 'docs', 'ROUTING_TABLE.md'), TABLE);
    const copy = path.join(installed, 'hooks', 'brief-check.js');
    const input = { subagent_type: 'opus-high', description: '문서 작성', prompt: brief(GOAL + DOC) };
    assert.match(reason(run(input, { routing: null, hook: copy })), /높임:/);
  });

  describe('시험 표시 칸', () => {
    const rec = fs.mkdtempSync(path.join(os.tmpdir(), 'brief-check-rec-'));
    const usage = (lines) => fs.writeFileSync(path.join(rec, 'subagent-usage.tsv'), lines.join('\n') + '\n');
    const row = (def, kind, memo) => ['2026-10-31', '/p', def, kind, '1', '1', '1', 'ok', memo].join('\t');
    const low = { subagent_type: 'sonnet-low', description: '분석과 가공', prompt: brief(GOAL + DOC) };

    it('표에서 시험 정의를 읽는다', () => {
      assert.equal(parseRoutingTable(TABLE).find((x) => x.name === '분석과 가공').trial, 'haiku-high');
    });

    it('회고 뒤 시험 정의로 보낸 건이 2건 아래인데 칸 정의로 보내면 deny한다', () => {
      usage(['회고\t-\t회고', row('haiku-high', '분석과 가공', 'a1111111111 첫 시험')]);
      assert.match(reason(run(low, { records: rec })), /시험 건너뜀:/);
    });

    it('같은 agentId 두 줄은 1건으로 세고, 회고 앞 줄은 세지 않는다', () => {
      usage([row('haiku-high', '분석과 가공', 'a2222222222'), '회고\t-\t회고', row('haiku-high', '분석과 가공', 'a1111111111 표에서 찾음'), row('haiku-high', '분석과 가공', 'a1111111111 요지')]);
      assert.match(reason(run(low, { records: rec })), /1건이다/);
    });

    it('시험 정의로 2건 보냈으면 칸 정의로 보내도 통과한다', () => {
      usage(['회고\t-\t회고', row('haiku-high', '분석과 가공', 'a1111111111'), row('haiku-high', '분석과 가공', 'a3333333333')]);
      assert.equal(run(low, { records: rec }).out, null);
    });

    it('시험 건너뜀이나 높임 줄이 있으면 통과한다', () => {
      usage(['회고\t-\t회고']);
      assert.equal(run({ ...low, prompt: brief(GOAL + DOC + '시험 건너뜀: 판단이 갈리는 묶음\n') }, { records: rec }).out, null);
      assert.equal(run({ ...low, description: '분석과 가공 높임: 범위가 넓다', subagent_type: 'sonnet-medium' }, { records: rec }).out, null);
    });

    it('사용 기록을 못 읽으면 시험 검사만 건너뛴다', () => {
      assert.equal(run(low).out, null);
    });
  });

  // 설치본의 표는 사용자 것이라 키트 원본에서만 본다.
  it('키트의 라우팅 표에서 표 행을 뽑는다', { skip: fs.existsSync(path.join(SUB, 'rules')) ? false : '설치본 배치' }, () => {
    const rows = parseRoutingTable(fs.readFileSync(path.join(SUB, 'docs', 'ROUTING_TABLE.md'), 'utf8'));
    assert.ok(rows.find((x) => x.name === '최종 코드 리뷰' && x.model === 'opus' && x.effort === 'high'));
    assert.ok(rows.find((x) => x.name === '코드 정리 검토' && x.model === 'sonnet' && x.effort === 'medium'));
  });
});
