import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectCalls, runHook } from '../hook-replay.js';

describe('막는 훅 되돌려 보기 hook-replay', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-replay-'));
  const root = path.join(dir, 'projects', 'p');
  fs.mkdirSync(root, { recursive: true });
  const call = (ts, name, input, cwd = '/work/a') => JSON.stringify({ type: 'assistant', timestamp: ts, cwd, message: { content: [{ type: 'tool_use', id: ts, name, input }] } });
  fs.writeFileSync(path.join(root, 's.jsonl'), [
    call('2026-10-01T00:00:01Z', 'Agent', { description: '막을 일 X' }),
    call('2026-10-01T00:00:02Z', 'Agent', { description: '보통 일' }),
    call('2026-10-01T00:00:03Z', 'Bash', { command: 'ls' }),
    call('2026-10-01T00:00:04Z', 'Agent', { description: '다른 폴더 X' }, '/work/b'),
  ].join('\n') + '\n');
  const hook = path.join(dir, 'deny-x.js');
  fs.writeFileSync(hook, "let r='';process.stdin.on('data',c=>r+=c).on('end',()=>{const i=JSON.parse(r);if(String(i.tool_input.description||'').includes('X'))process.stdout.write(JSON.stringify({hookSpecificOutput:{permissionDecision:'deny',permissionDecisionReason:'- X는 막는다'}}));});");

  it('고른 도구의 호출만 최근 것부터 모으고, 폴더를 주면 그 폴더 세션만 본다', () => {
    const all = collectCalls(path.join(dir, 'projects'), ['Agent'], 10);
    assert.deepEqual(all.map((c) => c.input.description), ['다른 폴더 X', '보통 일', '막을 일 X']);
    assert.equal(collectCalls(path.join(dir, 'projects'), ['Agent'], 10, '/work/a').length, 2);
    assert.equal(collectCalls(path.join(dir, 'projects'), ['Agent'], 1).length, 1);
  });

  it('훅이 막은 호출과 까닭 첫 줄을 돌려주고, 통과는 막지 않은 것으로 본다', () => {
    const [x, plain] = collectCalls(path.join(dir, 'projects'), ['Agent'], 10, '/work/a').sort((a, b) => a.ts.localeCompare(b.ts));
    assert.deepEqual(runHook(hook, x), { blocked: true, decision: 'deny', reason: 'X는 막는다' });
    assert.equal(runHook(hook, plain).blocked, false);
  });
});
