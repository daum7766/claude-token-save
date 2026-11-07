// 키트 스크립트 린트(tools/kit-lint.cjs)를 시험하고, 지금 키트 스크립트에 오류가 없는지 본다.
// 키트 원본에서만 돈다(tools/는 설치하지 않는다). 린트가 쓰는 Node 내부 acorn을 못 찾으면 건너뛴다.
// 새 규칙은 경고만 내므로 경고는 시험을 실패시키지 않고 요약만 찍는다. 문법 오류는 실패다.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KIT = path.resolve(HERE, '..', '..', '..');
const LINT = path.join(KIT, 'tools', 'kit-lint.cjs');
const SKIP = fs.existsSync(LINT) ? false : '설치본 배치라 tools/가 없음(키트 원본에서만 시험)';

const lint = (...targets) => {
  const r = spawnSync(process.execPath, ['--expose-internals', LINT, '--json', ...targets], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { status: r.status, stderr: r.stderr, out: r.status === 3 ? null : JSON.parse(r.stdout) };
};
const NO_PARSER = SKIP || (spawnSync(process.execPath, ['--expose-internals', '-e', "require('internal/deps/acorn/acorn/dist/acorn')"]).status === 0 ? false : 'Node 내부 acorn을 못 찾음');

// 파일 몇 개를 임시 폴더에 만들어 린트한다. 임시 폴더에 package.json을 두면 .js를 ESM으로 읽는다.
function sample(files, { esm = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-lint-'));
  if (esm) fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return lint(dir);
}
const rulesOf = (r) => r.out.hits.map((h) => `${h.rule}:${h.message.split(': ')[1] ?? h.message}`).sort();

describe('kit-lint 규칙', { skip: NO_PARSER }, () => {
  it('문법 오류는 error이고 종료 코드 1이다', () => {
    const r = sample({ 'a.cjs': 'const x = ;\n' });
    assert.equal(r.status, 1);
    assert.equal(r.out.errors, 1);
    assert.equal(r.out.hits[0].rule, 'syntax');
  });

  it('정의 안 된 이름은 경고하고, typeof 검사와 CJS 기본 이름과 내장 이름은 경고하지 않는다', () => {
    const r = sample({ 'a.cjs': "const fs = require('node:fs');\nmodule.exports = { f() { return missingName + (typeof maybe) + JSON.stringify(process.argv) + fs.x + __dirname; } };\n" });
    assert.deepEqual(rulesOf(r), ['no-undef:missingName']);
    assert.equal(r.status, 0, '경고는 종료 코드를 바꾸지 않는다');
  });

  it('ESM 파일에서 require나 __dirname을 쓰면 정의 안 된 이름이다', () => {
    const r = sample({ 'a.js': "export const x = require('z') + __dirname;\n" }, { esm: true });
    assert.deepEqual(rulesOf(r), ['no-undef:__dirname', 'no-undef:require']);
  });

  it('안 쓰는 변수, 함수, 가져온 이름은 경고하고 밑줄로 시작하는 이름과 내보낸 이름은 건너뛴다', () => {
    const r = sample({
      'a.js': "import { used, nope } from './b.js';\nconst unusedConst = 1;\nconst _skipped = 2;\nlet assignedOnly; assignedOnly = 3;\nfunction unusedFn() {}\nexport const exported = used;\nexport function exportedFn() {}\n",
      'b.js': 'export const used = 1;\nexport const nope = 2;\n',
    }, { esm: true });
    assert.deepEqual(rulesOf(r), ['no-unused-vars:assignedOnly', 'no-unused-vars:nope', 'no-unused-vars:unusedConst', 'no-unused-vars:unusedFn']);
  });

  it('const { 뺄키, ...나머지 }의 뺄키는 안 쓰는 변수로 세지 않는다', () => {
    const r = sample({ 'a.cjs': 'const { dropped, keep, ...rest } = require("./x");\nmodule.exports = { keep, rest };\n' });
    assert.deepEqual(rulesOf(r), []);
  });

  it('가져온 상대 경로 ESM에 그 이름이 없으면 경고한다', () => {
    const r = sample({ 'a.js': "import { there, gone } from './b.js';\nexport const x = [there, gone];\n", 'b.js': 'export const there = 1;\n' }, { esm: true });
    assert.deepEqual(rulesOf(r), ['import-missing-export:gone']);
  });

  it('스코프 규칙: 블록 안 let, 함수 선언 끌어올리기, 클래스 필드, 구조 분해 기본값, catch, 라벨을 정의된 것으로 읽는다', () => {
    const code = [
      "'use strict';",
      'function a() { return b(); }',
      'function b() { return 1; }',
      'class K { static s = 1; #p = 2; m(x = a()) { return x + this.#p + K.s; } }',
      'try { a(); } catch (e) { console.error(e); }',
      'const { v = b(), w: [first] = [] } = {};',
      'outer: for (const i of [1]) { for (;;) { if (i) break outer; } }',
      'for (var j = 0; j < 1; j += 1) {}',
      'module.exports = { K, v, first, j };',
    ].join('\n');
    assert.deepEqual(rulesOf(sample({ 'a.cjs': code })), []);
  });

  it('// kit-lint-ignore 규칙: 까닭 주석이 있으면 가리고 가린 수를 센다', () => {
    const r = sample({ 'a.cjs': "// kit-lint-ignore no-unused-vars: 시험용 오탐 표시\nconst keptOnPurpose = 1;\nconst reported = 2;\n" });
    assert.deepEqual(rulesOf(r), ['no-unused-vars:reported']);
    assert.equal(r.out.ignored, 1);
    assert.equal(r.out.ignoredByRule['no-unused-vars'], 1);
  });
});

describe('키트 스크립트 린트 결과', { skip: NO_PARSER }, () => {
  it('subagent-system과 tools 전체에 문법 오류가 없고, 경고와 오탐 표시 수를 보인다', (t) => {
    const r = lint();
    assert.equal(r.out.errors, 0, r.out.hits.filter((h) => h.severity === 'error').map((h) => `${h.file}:${h.line} ${h.message}`).join('\n'));
    assert.ok(r.out.files > 40, `대상 파일이 너무 적다(${r.out.files})`);
    const warns = r.out.hits.filter((h) => h.severity === 'warn');
    t.diagnostic(`린트 ${r.out.files}개 파일: 경고 ${warns.length}, 오탐 표시로 가린 것 ${r.out.ignored}`);
    for (const h of warns.slice(0, 30)) t.diagnostic(`${path.relative(KIT, h.file)}:${h.line} ${h.rule} ${h.message}`);
  });
});
