import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseRoutingTable, checkRouting, descriptionOf, ASK_KINDS, countPending } from '../subagentRetroHelpers.js';
import { ROUTING_TABLE_TITLE, ROUTING_UNCONDITIONAL_HEADING } from '../kitMerge.js';

const file = fs.readFileSync(new URL('../../docs/ROUTING_TABLE.md', import.meta.url), 'utf8');
// 설치본에서는 표와 정의가 사용자 것이라 키트 원본 계약을 보지 않는다. 키트 원본에만 rules/가 subagent-system 아래에 있다.
const SKIP_NOT_KIT = fs.existsSync(new URL('../../rules', import.meta.url)) ? false : '설치본 배치(키트 원본에서만 시험)';
const kitFile = (rel) => fs.readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

describe('키트 원본 ROUTING_TABLE.md', { skip: SKIP_NOT_KIT }, () => {
  it('스크립트의 표 읽기가 문제 없이 읽고 체계 칸의 일을 모두 담는다', () => {
    const { cells, problems } = parseRoutingTable(file);
    assert.deepEqual(problems, []);
    const kinds = cells.flatMap((c) => c.kinds);
    for (const k of ['회고 정정 분류', '자동 회고', '무조건 Opus 영역 판단', '무조건 Opus 영역 구현']) assert.ok(kinds.includes(k), k);
  });

  it('옛 구역 이전이 내는 글과 같은 제목, 무조건 Opus 절을 쓴다', () => {
    const lines = file.split('\n');
    assert.equal(lines[0], ROUTING_TABLE_TITLE);
    assert.ok(lines.includes(ROUTING_UNCONDITIONAL_HEADING));
  });

  it('표와 무조건 Opus 목록이 키트 원본의 예시임을 표시한다', () => {
    const marks = file.split('\n').filter((l) => l.startsWith('<!--') && l.includes('키트 원본의 예시'));
    assert.equal(marks.length, 2);
  });

  it('무조건 Opus 절에 프로젝트별 항목을 둘 자리가 있다', () => {
    assert.match(file, /^### 프로젝트별 항목$/m);
  });
});

describe('키트 원본 정의와 표의 일 이름', { skip: SKIP_NOT_KIT }, () => {
  it('키트 원본 정의 description의 일 이름 나열이 키트 원본 표 칸과 --check에서 어긋나지 않는다', () => {
    const { cells } = parseRoutingTable(file);
    const descriptions = new Map();
    for (const c of cells.filter((x) => x.kinds.length)) {
      const def = `${c.model}-${c.effort}`;
      const rel = `agents/${def}.md`;
      descriptions.set(def, fs.existsSync(new URL(`../../${rel}`, import.meta.url)) ? descriptionOf(kitFile(rel)) : null);
    }
    const r = checkRouting({ cells, usage: null, descriptions });
    assert.deepEqual(r.missingDefs, []);
    assert.deepEqual(r.descriptionDiffs, []);
  });
});

describe('키트 원본 RETRO.md 「사용자에게 묻는 것」', { skip: SKIP_NOT_KIT }, () => {
  it('RETRO 「사용자에게 묻는 것」 표의 여섯 값이 --due가 세는 묻기 값과 같다', () => {
    const section = kitFile('docs/RETRO.md').split(/^## /m).find((x) => x.startsWith('사용자에게 묻는 것'));
    const values = [...section.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]);
    assert.equal(values.length, 6);
    assert.deepEqual([...values].sort(), [...ASK_KINDS].sort());
    for (const v of values) assert.equal(countPending(`## 제안\n\n### 항목\n- 묻기: ${v}\n`, { onlyAsk: true }), 1, v);
  });
});
