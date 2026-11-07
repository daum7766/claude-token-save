// 공개 키트 파일에 비공개 장치 이름이 새로 들어가지 않는지 본다(tools/kit-private-names.cjs).
// 이름 목록은 설치본(CLAUDE_CONFIG_DIR, 없으면 ~/.claude)의 로컬 조각 정의와 config.json privateNames에서 읽는다. 이 파일에는 이름을 적지 않는다.
// 키트 원본에서만 돈다. 목록이 비어 있으면 건너뛴다.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const KIT = path.resolve(HERE, '..', '..', '..');
const TOOL = path.join(KIT, 'tools', 'kit-private-names.cjs');
const SKIP = fs.existsSync(TOOL) ? false : '설치본 배치라 tools/가 없음(키트 원본에서만 시험)';
const tool = SKIP ? null : require(TOOL);

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `kit-names-${name}-`));
const put = (root, rel, text) => {
  const f = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, typeof text === 'string' ? text : JSON.stringify(text));
};

// 지어낸 로컬 조각 정의(장치 이름은 시험용 가짜)를 가진 설정 폴더
function fakeConfig() {
  const cfg = tmp('cfg');
  put(cfg, 'subagent-system/local-bundles/demo/guard.part.json', {
    bundle: 'demo', part: 'guard', origin: 'local',
    files: ['hooks/demo-secret-guard.py', 'docs/DEMO_SECRET_NOTES.md', 'hooks/tests/**', 'hooks/tiny.js'],
    hooks: [{ name: 'demo-secret-check', event: 'Stop', command: 'x' }],
  });
  put(cfg, 'subagent-system/config.json', { privateNames: ['DEMO_ENV_NAME', 'abc'] });
  return cfg;
}

describe('비공개 이름 목록 읽기', { skip: SKIP }, () => {
  it('로컬 조각의 파일 이름과 훅 이름, privateNames를 모으고 글롭과 짧은 파일 이름은 뺀다', () => {
    const { names, sources } = tool.privateNamesFrom(fakeConfig());
    assert.deepEqual(names, ['DEMO_ENV_NAME', 'DEMO_SECRET_NOTES', 'abc', 'demo-secret-check', 'demo-secret-guard']);
    assert.ok(sources.length >= 2);
  });

  it('설정 폴더에 정의도 privateNames도 없으면 빈 목록이다', () => {
    assert.deepEqual(tool.privateNamesFrom(tmp('empty')).names, []);
  });
});

describe('공개 파일 검사', { skip: SKIP }, () => {
  const repo = () => {
    const root = tmp('repo');
    put(root, 'a.js', "const x = 'demo-secret-guard';\n");
    put(root, 'docs/b.md', '문장 안의 DEMO_ENV_NAME_X가 있다\n둘째 줄\n');
    put(root, 'c.txt', 'adeno-secret-guard는 다른 낱말의 일부라, demo_secret_guard는 다른 글자라 세지 않는다\n');
    put(root, 'clean.md', '이름이 없다\n');
    fs.writeFileSync(path.join(root, 'bin.dat'), Buffer.from([0, 1, 2, 100, 101, 109, 111]));
    return root;
  };

  it('이름과 이름 뒤에 접미사가 붙은 꼴을 잡고, 낱말 중간과 하이픈을 밑줄로 바꾼 꼴과 바이너리는 세지 않는다', () => {
    const { names } = tool.privateNamesFrom(fakeConfig());
    const hits = tool.scanTracked(repo(), names).map((h) => `${h.file}:${h.line}`);
    assert.deepEqual(hits.sort(), ['a.js:1', 'docs/b.md:1']);
  });

  it('이름 목록이 비면 아무것도 찾지 않는다', () => {
    assert.deepEqual(tool.scanTracked(repo(), []), []);
  });

  it('명령줄: 새어 나간 곳이 있으면 종료 코드 1, 없으면 0, 목록이 없으면 0과 안내', () => {
    const run = (root, cfg) => spawnSync(process.execPath, [TOOL, root], { env: { ...process.env, CLAUDE_CONFIG_DIR: cfg }, encoding: 'utf8' });
    assert.equal(run(repo(), fakeConfig()).status, 1);
    const clean = tmp('clean');
    put(clean, 'ok.md', '깨끗하다\n');
    assert.equal(run(clean, fakeConfig()).status, 0);
    const none = run(repo(), tmp('none-cfg'));
    assert.equal(none.status, 0);
    assert.match(none.stdout, /검사할 것이 없습니다/);
  });
});

describe('이 키트 저장소의 공개 파일', { skip: SKIP }, () => {
  const { names, sources } = SKIP ? { names: [], sources: [] } : tool.privateNamesFrom();
  it('설치본이 알려 준 비공개 이름이 추적되는 파일에 없다', { skip: names.length ? false : '비공개 이름 목록이 없음(설치본에 로컬 조각 정의나 config.json privateNames가 없음)' }, (t) => {
    const hits = tool.scanTracked(KIT, names);
    t.diagnostic(`비공개 이름 ${names.length}개(${sources.join(', ')}) 대조`);
    assert.deepEqual(hits.map((h) => `${h.file}:${h.line}`), [], '공개 키트 파일에 비공개 장치 이름이 있다. 파일 이름은 위 목록이고, 일반 이름으로 바꾸거나 지운다');
  });
});

describe('공개로 나갈 커밋 메시지 검사', { skip: SKIP }, () => {
  it('메시지 글에서 이름이 든 줄을 찾고, 명령줄 --message-file은 찾으면 종료 코드 1이다', () => {
    const { names } = tool.privateNamesFrom(fakeConfig());
    assert.deepEqual(tool.scanText('제목\n본문의 demo-secret-check 줄\n', names, 'm').map((h) => h.line), [2]);
    const msg = path.join(tmp('msg'), 'msg.txt');
    fs.writeFileSync(msg, '깨끗한 메시지\n');
    const clean = tmp('clean2');
    put(clean, 'ok.md', '깨끗하다\n');
    const run = (file) => spawnSync(process.execPath, [TOOL, clean, '--message-file', file], { env: { ...process.env, CLAUDE_CONFIG_DIR: fakeConfig() }, encoding: 'utf8' });
    assert.equal(run(msg).status, 0);
    fs.writeFileSync(msg, '바뀐 것: DEMO_ENV_NAME을 고침\n');
    const bad = run(msg);
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /커밋 메시지에서 1곳/);
  });
});
