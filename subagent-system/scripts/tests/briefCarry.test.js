// 지시문 검사 훅 brief-check의 「옮겨 온 것」 검사(8)) 시험.
// 왜: 다른 화면의 판정 결론이나 다른 화면의 문구가 규칙처럼 지시에 실려 나가는 것을 보내기 직전에 막는지 본다.
// 전제: 훅은 지시문과 지시문이 가리키는 scratchpad 아래 .md만 읽는다. 저장소 문서는 자료라 읽지 않는다.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOOK = path.join(SUB, 'hooks', 'brief-check.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'carry-check-'));
const tableFile = path.join(dir, 'ROUTING_TABLE.md');
fs.writeFileSync(tableFile, '# 라우팅 표\n\n| | low | medium | high | xhigh |\n|:---|:---|:---|:---|:---|\n| **Sonnet** | | 문서 작성 | | |\n');
const scratch = path.join(dir, 'scratchpad');
fs.mkdirSync(scratch);
const repoDocs = path.join(dir, 'repo', 'docs');
fs.mkdirSync(repoDocs, { recursive: true });

function run(toolInput) {
  const env = { ...process.env, SUBAGENT_RECORDS_DIR: path.join(dir, 'no-records'), CLAUDE_CONFIG_DIR: path.join(dir, 'no-config'), BRIEF_CHECK_ROUTING_FILES: tableFile };
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name: 'Agent', tool_input: toolInput }), encoding: 'utf8', env });
  return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason : null;
}

const HEAD = '목표: 다음 화면군 목업을 다시 그린다.\n결정 문서: /work/docs/decision.md\n';
const FILLER = '\n세부 지시: 아래 파일들을 읽고 요구대로 그린다. '.repeat(30);
const LESSON = '앞 화면 판정에서 나온 교훈을 이 화면군에도 쓴다: 아래 단추 끝선을 옆 단추 끝선과 맞춘다.\n';
const send = (body, extra = {}) => run({ subagent_type: 'sonnet-medium', description: '문서 작성: 목업', prompt: HEAD + body + FILLER, ...extra });

describe('brief-check 옮겨 온 것 검사', () => {
  it('교훈을 옮기는 줄이 있고 선언이 없으면 막고 걸린 줄을 알린다', () => {
    const msg = send(LESSON);
    assert.match(msg, /옮긴 줄이 있다\(걸린 말 「[^」]+」\): 앞 화면 판정에서 나온 교훈/);
    assert.match(msg, /`옮겨 온 것:`/);
  });

  it('선언 줄에 규칙 문서 경로:줄이 있으면 통과한다', () => {
    assert.equal(send(LESSON + '옮겨 온 것: 늘리지 않기는 docs/UI_REVIEW.md:176, 끝선 맞춤은 그 화면의 선택(참고)\n'), null);
  });

  it('선언 줄에 판정 파일 경로만 있으면 받지 않는다', () => {
    assert.match(send(LESSON + '옮겨 온 것: /tmp/judge2.md\n'), /옮긴 줄이 있다/);
  });

  it('선언 아래 목록에 출처가 있어도 받는다', () => {
    assert.equal(send(LESSON + '옮겨 온 것:\n- 강조 하나: docs/UI_REVIEW.md:21\n'), null);
  });

  it('옮긴 것이 없다는 선언은 까닭이 있어야 받는다', () => {
    assert.equal(send('다른 화면과 같은 틀로 그린다.\n옮겨 온 것: 없음(같은 틀은 결정 문서가 정한 견본)\n'), null);
    assert.match(send('다른 화면과 같은 틀로 그린다.\n옮겨 온 것: 없음()\n'), /옮긴 줄이 있다/);
  });

  it('「~와 같은 창」은 막고, 같게 할 것과 바꿀 것을 나눈 선언은 받는다', () => {
    assert.match(send('확인 창은 설정과 같은 창 하나로 둔다.\n'), /설정과 같은 창/);
    assert.equal(send('확인 창은 설정과 같은 창 하나로 둔다.\n옮겨 온 것: 창 틀과 단추는 같게, 둘째 줄 문구는 「그 화면의 선택」이라 이 화면 말로 바꾼다\n'), null);
  });

  it('「」 안의 인용과 보고 꼴 요구 줄은 보지 않는다', () => {
    assert.equal(send('대표가 「이 교훈은 그 화면 한정 같다」고 했다.\n'), null);
    assert.equal(send('보고: 다른 서비스로 넓힐 때 넣을 것(이 견본에서 배운 것)\n'), null);
  });

  it('옮김 말투가 없으면 통과한다', () => {
    assert.equal(send('지시 파일대로 그린다.\n'), null);
  });

  it('짧은 지시가 가리키는 scratchpad 지시 파일까지 읽는다', () => {
    const f = path.join(scratch, 'mock-v3.md');
    fs.writeFileSync(f, HEAD + LESSON + FILLER);
    const msg = run({ subagent_type: 'sonnet-medium', description: '문서 작성: 목업', prompt: `목표: 목업을 다시 그린다.\n지시 전문: ${f}\n` });
    assert.match(msg, /옮긴 줄이 있다/);
  });

  it('지시라고 소개하지 않은 scratchpad 파일(앞 실무자 보고)은 자료라 읽지 않는다', () => {
    const f = path.join(scratch, 'prev-report.md');
    fs.writeFileSync(f, LESSON + FILLER);
    assert.equal(run({ subagent_type: 'sonnet-medium', description: '문서 작성: 목업', prompt: HEAD + `앞 회차 보고: ${f}\n` + FILLER }), null);
  });

  it('같은지 보라는 확인 항목과 같은 줄에 경로:줄을 단 줄은 보지 않는다', () => {
    assert.equal(send('나가기 단추가 들어가기 화면과 같은 자리, 모양, 이름인지 본다.\n'), null);
    assert.equal(send('`bone()` 도우미(build_cat.py:269)와 같은 모양이라 그대로 가져다 쓴다.\n'), null);
    assert.equal(send('터치 흉내와 같은 창 크기에서도 잰다.\n'), null);
  });

  it('교훈을 말하기만 하는 줄은 보지 않고, 옮겨 쓰라는 줄만 본다', () => {
    assert.equal(send('판정 결과를 교훈으로 묶을 때 출처를 가르지 않았다.\n'), null);
    assert.match(send('앞 일에서 배운 것: 카드 높이를 늘리지 않는다.\n'), /걸린 말 「배운 것:」/);
  });

  it('저장소 문서는 자료라 읽지 않는다', { skip: dir.includes('/scratchpad/') && '임시 폴더가 scratchpad 아래라 가를 수 없다' }, () => {
    const f = path.join(repoDocs, 'rules.md');
    fs.writeFileSync(f, LESSON + FILLER);
    assert.equal(run({ subagent_type: 'sonnet-medium', description: '문서 작성: 목업', prompt: HEAD + `읽을 것: ${f}\n` + FILLER }), null);
  });

  it('haiku 정의는 보지 않는다', () => {
    assert.equal(run({ subagent_type: 'haiku-low', description: '파일 탐색과 검색', prompt: HEAD + LESSON + FILLER }), null);
  });
});
