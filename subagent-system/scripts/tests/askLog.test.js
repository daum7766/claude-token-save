// 무엇: hooks/ask-log.js(PermissionRequest 기록 훅)의 기록 꼴, 중복 막기, 오류 때 통과, 출력 없음을 본다.
// 왜: 이 훅이 승인 결정에 끼어들거나 오류로 승인 흐름을 막으면 모든 도구 호출이 영향을 받아서, 항상 조용히 0으로 끝나는지 시험으로 지킨다.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOOK = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'), 'hooks', 'ask-log.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ask-log-'));
const fire = (input, env = {}, raw = null) => {
  const e = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ASK_LOG_FILE' && k !== 'CLAUDE_CONFIG_DIR'));
  const r = spawnSync(process.execPath, [HOOK], { input: raw ?? JSON.stringify(input), env: { ...e, ...env }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
};
const rows = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const ask = (command, extra = {}) => ({ session_id: 's1', agent_id: 'a1', agent_type: 'sonnet-low', cwd: '/w', tool_name: 'Bash', tool_input: { command }, ...extra });

describe('ask-log 훅', () => {
  it('승인 창 한 건을 정해진 꼴의 한 줄로 적고 아무것도 출력하지 않는다', () => {
    const file = path.join(tmp(), 'asks.jsonl');
    fire(ask('ls /tmp'), { ASK_LOG_FILE: file });
    const [r, ...more] = rows(file);
    assert.equal(more.length, 0);
    assert.deepEqual(Object.keys(r), ['ts', 'session', 'agent_id', 'agent_type', 'cwd', 'tool', 'hook', 'reason', 'input']);
    assert.match(r.ts, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    assert.deepEqual({ session: r.session, agent_id: r.agent_id, agent_type: r.agent_type, cwd: r.cwd, tool: r.tool, hook: r.hook, input: r.input }, { session: 's1', agent_id: 'a1', agent_type: 'sonnet-low', cwd: '/w', tool: 'Bash', hook: 'claude-code', input: 'ls /tmp' });
  });

  it('명령이 없으면 조회어, 그것도 없으면 입력 JSON을 적고 4000자에서 자른다', () => {
    const file = path.join(tmp(), 'asks.jsonl');
    fire({ tool_name: 'WebSearch', tool_input: { query: '검색어' } }, { ASK_LOG_FILE: file });
    fire({ tool_name: 'Edit', tool_input: { file_path: '/a' } }, { ASK_LOG_FILE: file });
    fire(ask('x'.repeat(5000)), { ASK_LOG_FILE: file });
    const r = rows(file);
    assert.equal(r[0].input, '검색어');
    assert.equal(r[1].input, '{"file_path":"/a"}');
    assert.equal(r[2].input.length, 4000);
  });

  it('같은 입력이 10초 안에 이미 있으면 적지 않고 다른 입력이나 10초 뒤는 적는다', () => {
    const file = path.join(tmp(), 'asks.jsonl');
    fire(ask('rm -rf x'), { ASK_LOG_FILE: file });
    fire(ask('rm -rf x'), { ASK_LOG_FILE: file });
    assert.equal(rows(file).length, 1);
    fire(ask('rm -rf y'), { ASK_LOG_FILE: file });
    assert.equal(rows(file).length, 2);
    const old = rows(file).map((r) => ({ ...r, ts: new Date(Date.now() - 60000).toISOString() }));
    fs.writeFileSync(file, `${old.map((r) => JSON.stringify(r)).join('\n')}\n`);
    fire(ask('rm -rf x'), { ASK_LOG_FILE: file });
    assert.equal(rows(file).length, 3);
  });

  it('사용자의 검사 훅이 hook 이름을 달아 먼저 적은 같은 입력도 두 번 적지 않는다', () => {
    const file = path.join(tmp(), 'asks.jsonl');
    fs.writeFileSync(file, `${JSON.stringify({ ts: new Date().toISOString(), hook: 'rm-guard', input: 'rm a' })}\n깨진 줄\n`);
    fire(ask('rm a'), { ASK_LOG_FILE: file });
    assert.equal(fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length, 2);
  });

  it('ASK_LOG_FILE이 없으면 설정 폴더의 permission-asks.jsonl에 적는다', () => {
    const cfg = tmp();
    fire(ask('ls'), { CLAUDE_CONFIG_DIR: cfg });
    assert.equal(rows(path.join(cfg, 'permission-asks.jsonl')).length, 1);
  });

  // 회고 잠금이 잡히고 retroWriteAllow가 켜진 설정 폴더를 만든다. hooked가 true면 settings.json의 PermissionRequest에 쓰기 허용 훅이 걸려 있다.
  const retroSetup = ({ hooked }) => {
    const cfg = tmp();
    const records = path.join(cfg, 'subagent-system', 'records');
    fs.mkdirSync(records, { recursive: true });
    fs.writeFileSync(path.join(cfg, 'subagent-system', 'config.json'), JSON.stringify({ retroWriteAllow: true }));
    fs.writeFileSync(path.join(records, 'retro.lock'), '{}');
    if (hooked) {
      const command = `node "${path.join(cfg, 'subagent-system', 'hooks', 'retro-write-allow.js')}"`;
      fs.writeFileSync(path.join(cfg, 'settings.json'), JSON.stringify({ hooks: { PermissionRequest: [{ matcher: 'Write|Edit', hooks: [{ type: 'command', command }] }] } }));
    }
    const file = path.join(tmp(), 'asks.jsonl');
    return { cfg, records, file, env: { ASK_LOG_FILE: file, CLAUDE_CONFIG_DIR: cfg, SUBAGENT_RECORDS_DIR: records } };
  };
  const write = (target, extra = {}) => ({ session_id: 's1', agent_id: 'a1', tool_name: 'Write', tool_input: { file_path: target }, ...extra });

  it('회고 쓰기 허용 훅이 걸려 있어 허용하는 요청은 승인 창으로 적지 않고 허용하지 않는 요청은 적는다', () => {
    const { cfg, records, file, env } = retroSetup({ hooked: true });
    fire(write(path.join(cfg, 'docs', 'x.md')), env);
    assert.equal(rows(file).length, 0, '허용된 회고 쓰기는 적지 않는다');
    fire(write(path.join(cfg, 'CLAUDE.md')), env);
    fire(write(path.join(cfg, 'docs', 'y.md'), { agent_id: '' }), env);
    assert.deepEqual(rows(file).map((r) => path.basename(JSON.parse(r.input).file_path)), ['CLAUDE.md', 'y.md']);
    fs.rmSync(path.join(records, 'retro.lock'));
    fire(write(path.join(cfg, 'docs', 'z.md')), env);
    assert.equal(rows(file).length, 3, '회고 잠금이 없으면 허용되지 않아 적는다');
  });

  it('retroWriteAllow를 켰어도 쓰기 허용 훅이 settings.json에 걸리기 전이면 창이 뜨므로 적는다', () => {
    const { cfg, file, env } = retroSetup({ hooked: false });
    fire(write(path.join(cfg, 'docs', 'x.md')), env);
    assert.equal(rows(file).length, 1, 'settings.json이 없을 때');
    fs.writeFileSync(path.join(cfg, 'settings.json'), JSON.stringify({ hooks: { PermissionRequest: [{ matcher: '*', hooks: [{ type: 'command', command: `node "${path.join(cfg, 'subagent-system', 'hooks', 'ask-log.js')}"` }] }] } }));
    fire(write(path.join(cfg, 'docs', 'y.md')), env);
    assert.equal(rows(file).length, 2, '다른 훅만 걸려 있을 때');
    fs.writeFileSync(path.join(cfg, 'settings.json'), '{깨짐');
    fire(write(path.join(cfg, 'docs', 'z.md')), env);
    assert.equal(rows(file).length, 3, 'settings.json이 깨졌을 때');
  });

  it('깨진 입력, 빈 입력, 쓸 수 없는 기록 경로여도 출력 없이 0으로 끝난다', () => {
    const dir = tmp();
    const file = path.join(dir, 'asks.jsonl');
    fire(null, { ASK_LOG_FILE: file }, '이건 JSON이 아님');
    fire(null, { ASK_LOG_FILE: file }, '');
    assert.equal(fs.existsSync(file), false);
    const blocker = path.join(dir, 'file');
    fs.writeFileSync(blocker, 'x');
    fire(ask('ls'), { ASK_LOG_FILE: path.join(blocker, 'sub', 'asks.jsonl') });
  });
});
