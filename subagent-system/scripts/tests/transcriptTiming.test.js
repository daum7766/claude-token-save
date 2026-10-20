import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bashKey, analyzeTranscript, jsonlRows, fileHasLine, WAIT_CAP_SEC } from '../transcriptTiming.js';

const tempRoots = [];
after(() => {
  for (const r of tempRoots) fs.rmSync(r, { recursive: true, force: true });
});

const at = (sec) => new Date(Date.UTC(2026, 9, 10, 0, 0, sec)).toISOString();
const write = (rows) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-timing-'));
  tempRoots.push(root);
  const file = path.join(root, 'agent-x.jsonl');
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return file;
};
const useRow = (sec, id, name, input) => ({ type: 'assistant', timestamp: at(sec), uuid: `a-${id}`, message: { id: `m-${id}`, content: [{ type: 'tool_use', id, name, input }] } });
const resultRow = (sec, id) => ({ type: 'user', timestamp: at(sec), message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'x' }] } });
const askRow = (sec, id) => ({
  type: 'attachment',
  timestamp: at(sec),
  attachment: { type: 'hook_success', hookEvent: 'PreToolUse', hookName: 'PreToolUse:Bash', toolUseID: id, stdout: '{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "ask"}}\n' },
});
const start = { type: 'user', timestamp: at(0), message: { content: 'go' } };

describe('bashKey', () => {
  const cases = [
    ['cd /x && node scripts/a.js --foo', 'node a.js'],
    ['python3 /tmp/s/check.py arg', 'python3 check.py'],
    ['bash /private/tmp/q/run.sh', 'bash run.sh'],
    ['S=/private/tmp/x; node "$S/m.mjs"', 'node m.mjs'],
    ['npm run e2e -- --grep x', 'npm run e2e'],
    ['npm test', 'npm test'],
    ['npx vitest run src/a.test.js', 'npx vitest'],
    ['node -e "console.log(1)"', 'node -e'],
    ['until [ -f x ]; do sleep 5; done', 'until'],
  ];
  for (const [cmd, key] of cases) {
    it(`${cmd} 는 묶음 이름 ${key} 로 묶인다`, () => {
      assert.equal(bashKey(cmd), key);
    });
  }
});

describe('analyzeTranscript', () => {
  it('Bash 호출 하나가 상한을 넘으면 상한까지만 도구 시간이고 넘는 몫은 사용자 기다림이다', () => {
    const file = write([start, useRow(10, 't1', 'Bash', { command: 'sleep 1000' }), resultRow(1010, 't1'), { type: 'assistant', timestamp: at(1020), uuid: 'z', message: { id: 'mz', content: [{ type: 'text', text: 'done' }] } }]);
    const a = analyzeTranscript(file);
    assert.equal(a.tool, WAIT_CAP_SEC);
    assert.equal(a.userWait, 1000 - WAIT_CAP_SEC);
    assert.equal(a.calls[0].sec, WAIT_CAP_SEC);
    assert.equal(a.calls[0].wait, 1000 - WAIT_CAP_SEC);
    assert.equal(a.bash.get('sleep'), WAIT_CAP_SEC);
  });

  it('사용자 확인 창이 뜬 시각이 기록돼 있으면 그 시각부터 결과까지를 사용자 기다림으로 센다', () => {
    const file = write([start, useRow(10, 't1', 'Bash', { command: 'rm -r /x' }), askRow(11, 't1'), resultRow(400, 't1'), { type: 'assistant', timestamp: at(410), uuid: 'z', message: { id: 'mz', content: [{ type: 'text', text: 'done' }] } }]);
    const a = analyzeTranscript(file);
    assert.equal(a.tool, 1);
    assert.equal(a.userWait, 389);
    assert.equal(a.calls[0].sec, 1);
    assert.equal(a.calls[0].wait, 389);
  });

  it('상한 안에서 끝난 Bash는 기다림 없이 전부 도구 시간이다', () => {
    const file = write([start, useRow(10, 't1', 'Bash', { command: 'sleep 30' }), resultRow(40, 't1'), { type: 'assistant', timestamp: at(50), uuid: 'z', message: { id: 'mz', content: [{ type: 'text', text: 'done' }] } }]);
    const a = analyzeTranscript(file);
    assert.equal(a.tool, 30);
    assert.equal(a.userWait, 0);
    assert.equal(a.other, 0);
    assert.equal(a.model, 20);
  });

  it('Agent 호출은 상한을 넘어도 전부 도구 시간이다', () => {
    const file = write([start, useRow(10, 't1', 'Agent', { description: '긴 일', prompt: 'p' }), resultRow(2010, 't1'), { type: 'assistant', timestamp: at(2020), uuid: 'z', message: { id: 'mz', content: [{ type: 'text', text: 'done' }] } }]);
    const a = analyzeTranscript(file);
    assert.equal(a.tool, 2000);
    assert.equal(a.userWait, 0);
    assert.equal(a.calls[0].label, '긴 일');
  });

  it('calls에는 명령 전체가 잘리지 않고 시작과 끝 시각이 ms로 들어간다', () => {
    const cmd = `echo ${'a'.repeat(200)}`;
    const file = write([start, useRow(10, 't1', 'Bash', { command: cmd, description: '긴 명령' }), resultRow(40, 't1')]);
    const [c] = analyzeTranscript(file).calls;
    assert.equal(c.cmd, cmd);
    assert.equal(c.label, '긴 명령');
    assert.equal(c.at, Date.parse(at(10)));
    assert.equal(c.end, Date.parse(at(40)));
  });

  it('Bash가 아닌 호출의 cmd는 도구 이름과 파일 경로다', () => {
    const file = write([start, useRow(10, 't1', 'Read', { file_path: '/a/b.js' }), resultRow(12, 't1')]);
    assert.equal(analyzeTranscript(file).calls[0].cmd, 'Read /a/b.js');
  });

  it('bashSample은 같은 묶음에서 가장 오래 걸린 호출의 명령 전체를 돌려준다', () => {
    const file = write([
      start,
      useRow(10, 't1', 'Bash', { command: 'cd /x && node scripts/a.js --short' }),
      resultRow(12, 't1'),
      useRow(20, 't2', 'Bash', { command: 'cd /x && node scripts/a.js --long' }),
      resultRow(50, 't2'),
    ]);
    const a = analyzeTranscript(file);
    assert.equal(a.bashSample.get('node a.js'), 'cd /x && node scripts/a.js --long');
    assert.equal(a.bash.get('node a.js'), 32);
  });

  it('메시지가 없는 기록은 null이다', () => {
    assert.equal(analyzeTranscript(write([{ type: 'summary', timestamp: at(0) }])), null);
  });
});

describe('jsonlRows', () => {
  const rows = [
    { n: 1, text: '가나다라마바사' },
    { n: 2, text: 'x'.repeat(200) },
    { n: 3, text: 'short' },
    { n: 4, text: '한글과 😀 이모지' },
  ];
  const raw = (lines) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonl-rows-'));
    tempRoots.push(root);
    const file = path.join(root, 'a.jsonl');
    fs.writeFileSync(file, lines);
    return file;
  };
  const text = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

  it('줄 하나가 읽기 덩어리보다 길어도 모든 줄을 그대로 읽는다', () => {
    assert.deepEqual([...jsonlRows(raw(text), 16)], rows);
  });

  for (const chunk of [1, 2, 3, 5, 7, 31, 64, 1000]) {
    it(`덩어리 크기가 ${chunk}바이트여도 줄 경계와 여러 바이트 글자가 깨지지 않고 같은 결과다`, () => {
      assert.deepEqual([...jsonlRows(raw(text), chunk)], rows);
    });
  }

  it('깨진 줄과 빈 줄은 건너뛰고 끝 줄바꿈이 없는 마지막 줄과 CRLF 줄도 읽는다', () => {
    const file = raw('{"n":1}\r\n{broken\n\n{"n":2}\n{"n":3}');
    assert.deepEqual([...jsonlRows(file, 4)], [{ n: 1 }, { n: 2 }, { n: 3 }]);
  });
});

describe('fileHasLine', () => {
  it('덩어리 경계에 걸친 줄에서도 패턴을 찾고 없으면 false다', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'file-has-line-'));
    tempRoots.push(root);
    const file = path.join(root, 'a.jsonl');
    fs.writeFileSync(file, '{"a":"aaaaaaaaaa"}\n{"b":"[절차 3] 한글"}\n');
    assert.equal(fileHasLine(file, /\[절차 \d+\]/, 5), true);
    assert.equal(fileHasLine(file, /없는말/, 5), false);
  });
});
