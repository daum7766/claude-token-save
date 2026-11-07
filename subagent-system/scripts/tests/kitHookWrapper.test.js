// 훅 감싸개(hooks/kit-hook.cjs)를 시험한다. 시험 이름의 W n은 설치 바닥 설계 9.4의 번호다.
// 감싸개는 `sh -c '... # kit:x/t'` 꼴로, 설정에 달리는 것과 같은 모양으로 돌린다.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WRAPPER = path.resolve(HERE, '..', '..', 'hooks', 'kit-hook.cjs');
const CHILD = (name) => path.join(HERE, 'fixtures', 'hooks', 'children', name);

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kithookw-'));
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

// 설정에 달리는 꼴(sh -c로 도는 한 줄 명령, 끝에 이름표 주석)로 감싸개를 돌린다.
function run(childArgs, { input = '', rec = tmp(), name = 't', extraEnv = {} } = {}) {
  const line = `node ${q(WRAPPER)} ${name} ${childArgs} # kit:x/${name}`;
  const r = spawnSync('sh', ['-c', line], { input, env: { ...process.env, SUBAGENT_RECORDS_DIR: rec, ...extraEnv } });
  return { ...r, rec, out: r.stdout, err: r.stderr.toString() };
}
const node = (script, ...args) => ['node', q(CHILD(script)), ...args.map(q)].join(' ');
const tsv = (rec) => (fs.existsSync(path.join(rec, 'hook-time.tsv')) ? fs.readFileSync(path.join(rec, 'hook-time.tsv'), 'utf8') : '');

describe('kit-hook.cjs 넘기기', () => {
  it('W1 표준 입력을 받은 자식의 표준 출력을 바이트 그대로 넘긴다', () => {
    const input = '{"a":1}';
    const r = run(node('echo-stdin.js'), { input });
    assert.equal(r.status, 0);
    assert.deepEqual(r.out, Buffer.from(input));
  });

  it('W1b 막는 훅처럼 종료 0과 표준 출력 JSON을 내면 그대로 나온다', () => {
    const r = run(node('block-json.js'));
    assert.equal(r.status, 0);
    assert.equal(r.out.toString(), '{"hookSpecificOutput":{"permissionDecision":"deny"}}');
  });

  it('W2 자식이 아무것도 안 내면 표준 출력은 0바이트다', () => {
    const r = run(node('silent.js'));
    assert.equal(r.out.length, 0);
    assert.equal(r.status, 0);
  });

  it('W3 자식의 표준 에러를 그대로 넘긴다', () => {
    const r = run(node('stderr-e.js'));
    assert.equal(r.err, 'e');
    assert.equal(r.out.length, 0);
  });

  it('W4 자식의 종료 코드 0과 2를 그대로 낸다', () => {
    assert.equal(run(node('exit-code.js', 0)).status, 0);
    assert.equal(run(node('exit-code.js', 2)).status, 2);
  });

  it('W5 자식이 SIGTERM으로 죽으면 143으로 끝난다(0이 아님)', () => {
    // 감싸개가 null 상태를 0으로 바꾸는 실수를 하면 0이 나와 이 시험이 실패한다.
    const r = run(node('signal-self.js', 'SIGTERM'));
    assert.notEqual(r.status, 0);
    assert.equal(r.status, 143);
    assert.equal(r.out.length, 0);
    // 다른 신호도 128 + 번호.
    assert.equal(run(node('signal-self.js', 'SIGKILL')).status, 137);
  });

  it('W6 없는 명령은 종료 1과 표준 에러의 까닭을 내고 표준 출력은 비어 있다', () => {
    const rec = tmp();
    const r = spawnSync('node', [WRAPPER, 't', 'no-such-cmd-demo'], { env: { ...process.env, SUBAGENT_RECORDS_DIR: rec } });
    assert.equal(r.status, 1);
    assert.equal(r.stdout.length, 0);
    assert.match(r.stderr.toString(), /no-such-cmd-demo/);
  });

  it('인자가 모자라면 종료 1과 사용법을 표준 에러로 낸다', () => {
    const r = spawnSync('node', [WRAPPER], { env: { ...process.env, SUBAGENT_RECORDS_DIR: tmp() } });
    assert.equal(r.status, 1);
    assert.equal(r.stdout.length, 0);
    assert.match(r.stderr.toString(), /사용법/);
  });
});

describe('kit-hook.cjs 기록', () => {
  it('W7 0.5초 넘게 걸리면 hook-time.tsv에 4열 줄 하나를 남긴다', () => {
    const rec = tmp();
    const r = run(node('sleep.js', 600), { rec });
    assert.equal(r.status, 0);
    const lines = tsv(rec).split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
    const cols = lines[0].split('\t');
    assert.equal(cols.length, 4);
    assert.match(cols[0], /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d{4}$/);
    assert.equal(cols[1], 't');
    assert.ok(Number(cols[2]) >= 500, cols[2]);
    assert.equal(cols[3], '끝남');
  });

  it('빠른 실행은 기록을 남기지 않는다', () => {
    const rec = tmp();
    run(node('silent.js'), { rec });
    assert.equal(tsv(rec), '');
  });

  it('W8 죽은 pid의 16초 전 표시만 끊김으로 적고 지우며 산 pid의 표시는 둔다', () => {
    const rec = tmp();
    const dir = path.join(rec, 'hook-running');
    fs.mkdirSync(dir, { recursive: true });
    // 이미 끝난 프로세스의 pid
    const dead = spawnSync('node', ['-e', 'process.stdout.write(String(process.pid))']).stdout.toString();
    const old = Math.floor(Date.now() / 1000) - 16;
    const deadMark = path.join(dir, `ghost.${dead}.${old}`);
    const liveMark = path.join(dir, `busy.${process.pid}.${old}`);
    fs.writeFileSync(deadMark, '');
    fs.writeFileSync(liveMark, '');
    const r = run(node('silent.js'), { rec });
    assert.equal(r.status, 0);
    assert.ok(!fs.existsSync(deadMark), '끊긴 표시는 지움');
    assert.ok(fs.existsSync(liveMark), '산 pid의 표시는 둠');
    const lines = tsv(rec).split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
    const cols = lines[0].split('\t');
    assert.equal(cols.length, 4);
    assert.equal(cols[1], 'ghost');
    assert.equal(cols[2], '');
    assert.equal(cols[3], '끊김(끝나지 못함)');
  });

  it('15초가 안 된 죽은 pid의 표시는 끊김으로 보지 않는다', () => {
    const rec = tmp();
    const dir = path.join(rec, 'hook-running');
    fs.mkdirSync(dir, { recursive: true });
    const dead = spawnSync('node', ['-e', 'process.stdout.write(String(process.pid))']).stdout.toString();
    const fresh = path.join(dir, `ghost.${dead}.${Math.floor(Date.now() / 1000) - 3}`);
    fs.writeFileSync(fresh, '');
    run(node('silent.js'), { rec });
    assert.ok(fs.existsSync(fresh));
    assert.equal(tsv(rec), '');
  });

  it('W9 보통 실행이 끝나면 자기 표시 파일이 없다', () => {
    const rec = tmp();
    run(node('silent.js'), { rec });
    const dir = path.join(rec, 'hook-running');
    assert.deepEqual(fs.existsSync(dir) ? fs.readdirSync(dir) : [], []);
  });

  it('실행 중에는 이름.pid.시작초 꼴의 표시 파일이 있다', async () => {
    const rec = tmp();
    const line = `node ${q(WRAPPER)} t ${node('sleep.js', 800)} # kit:x/t`;
    const child = spawn('sh', ['-c', line], { env: { ...process.env, SUBAGENT_RECORDS_DIR: rec }, stdio: 'ignore' });
    const done = new Promise((res) => child.on('close', res));
    await new Promise((r) => setTimeout(r, 400));
    const files = fs.readdirSync(path.join(rec, 'hook-running'));
    assert.equal(files.length, 1);
    assert.match(files[0], /^t\.\d+\.\d+$/);
    await done;
  });

  it('기록 자리를 쓸 수 없어도 자식은 돌고 종료 코드를 넘긴다', () => {
    const blocker = path.join(tmp(), 'file');
    fs.writeFileSync(blocker, 'x');
    const r = run(node('exit-code.js', 2), { rec: path.join(blocker, 'sub') });
    assert.equal(r.status, 2);
  });
});
