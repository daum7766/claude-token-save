import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mergeKitFile,
  planKitFileUpdate,
  legacyHashOf,
  migrateLegacyZones,
  MARK_INSTALLED,
  MARK_SEPARATOR,
  MARK_NEXT,
} from '../kitMerge.js';
import { parseRoutingTable } from '../subagentRetroHelpers.js';

const text = (...lines) => lines.join('\n') + '\n';
const sha = (s) => createHash('sha256').update(s).digest('hex');

describe('mergeKitFile', () => {
  const base = text('a', 'b', 'c', 'd', 'e', 'f');

  it('사용자가 고친 줄과 키트가 고친 줄이 떨어져 있으면 둘 다 남고 충돌이 없다', () => {
    const r = mergeKitFile({ installed: text('a', 'B(사용자)', 'c', 'd', 'e', 'f'), base, next: text('a', 'b', 'c', 'd', 'e', 'F(키트)') });
    assert.equal(r.text, text('a', 'B(사용자)', 'c', 'd', 'e', 'F(키트)'));
    assert.deepEqual(r.conflicts, []);
  });

  it('같은 줄을 둘 다 똑같이 고쳤으면 충돌이 아니다', () => {
    const r = mergeKitFile({ installed: text('a', 'X', 'c', 'd', 'e', 'f'), base, next: text('a', 'X', 'c', 'd', 'e', 'f') });
    assert.equal(r.text, text('a', 'X', 'c', 'd', 'e', 'f'));
    assert.deepEqual(r.conflicts, []);
  });

  it('같은 줄을 다르게 고쳤으면 충돌 표시를 남기고 양쪽 줄과 기준 줄을 conflicts에 담는다', () => {
    const r = mergeKitFile({ installed: text('a', 'B1', 'c', 'd', 'e', 'f'), base, next: text('a', 'B2', 'c', 'd', 'e', 'f') });
    assert.equal(r.text, text('a', MARK_INSTALLED, 'B1', MARK_SEPARATOR, 'B2', MARK_NEXT, 'c', 'd', 'e', 'f'));
    assert.deepEqual(r.conflicts, [{ line: 2, installed: ['B1'], base: ['b'], next: ['B2'] }]);
  });

  it('사용자가 지운 줄은 키트가 다른 곳만 고쳐도 되살아나지 않는다', () => {
    const r = mergeKitFile({ installed: text('a', 'c', 'd', 'e', 'f'), base, next: text('a', 'b', 'c', 'd', 'e', 'F') });
    assert.equal(r.text, text('a', 'c', 'd', 'e', 'F'));
    assert.deepEqual(r.conflicts, []);
  });

  it('사용자가 지운 줄을 키트가 고쳤으면 충돌이다', () => {
    const r = mergeKitFile({ installed: text('a', 'c', 'd', 'e', 'f'), base, next: text('a', 'b2', 'c', 'd', 'e', 'f') });
    assert.equal(r.conflicts.length, 1);
    assert.deepEqual(r.conflicts[0].installed, []);
    assert.deepEqual(r.conflicts[0].next, ['b2']);
  });

  it('키트가 지운 줄을 사용자가 건드리지 않았으면 지워진다', () => {
    const r = mergeKitFile({ installed: base, base, next: text('a', 'b', 'd', 'e', 'f') });
    assert.equal(r.text, text('a', 'b', 'd', 'e', 'f'));
  });

  it('사용자와 키트가 서로 다른 자리에 줄을 더하면 둘 다 남는다', () => {
    const r = mergeKitFile({ installed: text('a', 'b', 'c', 'U', 'd', 'e', 'f'), base, next: text('K', 'a', 'b', 'c', 'd', 'e', 'f') });
    assert.equal(r.text, text('K', 'a', 'b', 'c', 'U', 'd', 'e', 'f'));
    assert.deepEqual(r.conflicts, []);
  });

  it('바로 이웃한 줄을 서로 다르게 고치면 충돌로 남긴다', () => {
    const r = mergeKitFile({ installed: text('a', 'B1', 'c', 'd', 'e', 'f'), base, next: text('a', 'b', 'C2', 'd', 'e', 'f') });
    assert.equal(r.conflicts.length, 1);
  });

  it('고친 곳이 여럿이면 충돌마다 결과 text의 표시 줄 번호를 line에 담는다', () => {
    const wide = text('1', '2', '3', '4', '5', '6', '7');
    const r = mergeKitFile({ installed: text('1', 'U2', '3', '4', '5', 'U6', '7'), base: wide, next: text('1', 'K2', '3', '4', '5', 'K6', '7') });
    const lines = r.text.split('\n');
    assert.equal(r.conflicts.length, 2);
    for (const c of r.conflicts) assert.equal(lines[c.line - 1], MARK_INSTALLED);
  });

  it('세 입력이 같으면 그대로 돌려준다', () => {
    assert.deepEqual(mergeKitFile({ installed: base, base, next: base }), { text: base, conflicts: [] });
  });

  it('설치본이 CRLF이면 결과도 CRLF로 낸다', () => {
    const r = mergeKitFile({ installed: 'a\r\nB\r\nc\r\n', base: 'a\nb\nc\n', next: 'a\nb\nc\nd\n' });
    assert.equal(r.text, 'a\r\nB\r\nc\r\nd\r\n');
  });

  it('설치본에서 끝 줄바꿈을 지우지 않았으면 새 키트의 끝 줄바꿈을 따른다', () => {
    assert.equal(mergeKitFile({ installed: 'a\nb', base: 'a\nb', next: 'a\nb\n' }).text, 'a\nb\n');
    assert.equal(mergeKitFile({ installed: 'a\nb', base: 'a\nb\n', next: 'a\nb\n' }).text, 'a\nb');
  });

  it('빈 설치본이나 빈 새 키트도 다룬다', () => {
    assert.equal(mergeKitFile({ installed: '', base: '', next: 'a\n' }).text, 'a\n');
    assert.equal(mergeKitFile({ installed: 'a\n', base: 'a\n', next: '' }).text, '');
  });

  it('기준본이 없으면 설치본과 새 키트가 다른 덩어리는 모두 충돌이고 같은 줄은 그대로 둔다', () => {
    const r = mergeKitFile({ installed: text('a', 'U', 'c', 'e'), base: null, next: text('a', 'K', 'c', 'd', 'e') });
    assert.equal(r.text, text('a', MARK_INSTALLED, 'U', MARK_SEPARATOR, 'K', MARK_NEXT, 'c', MARK_INSTALLED, MARK_SEPARATOR, 'd', MARK_NEXT, 'e'));
    assert.deepEqual(r.conflicts.map((c) => c.base), [null, null]);
  });

  it('기준본이 없어도 두 파일이 같으면 충돌이 없다', () => {
    assert.deepEqual(mergeKitFile({ installed: base, base: null, next: base }), { text: base, conflicts: [] });
  });

  it('줄이 수천 개인 파일도 곳곳을 고친 병합이 제때 끝난다', () => {
    const big = Array.from({ length: 3000 }, (_, i) => `줄 ${i}`);
    const withEdit = (lines, at, v) => lines.map((l, i) => (at.includes(i) ? v : l));
    const t0 = Date.now();
    const r = mergeKitFile({ installed: text(...withEdit(big, [100, 1500, 2900], '사용자')), base: text(...big), next: text(...withEdit(big, [700, 2200], '키트')) });
    assert.deepEqual(r.conflicts, []);
    assert.equal(r.text.split('\n').filter((l) => l === '사용자' || l === '키트').length, 5);
    assert.ok(Date.now() - t0 < 5000);
  });
});

describe('planKitFileUpdate', () => {
  const key = 'subagent-system/docs/RETRO.md';
  const base = text('a', 'b', 'c');
  const next = text('a', 'b', 'c', 'd');

  it('설치본이 새 키트와 같으면 바꿀 것이 없다', () => {
    assert.equal(planKitFileUpdate({ key, installed: next, base: null, next, recordedHashes: null }).status, 'unchanged');
  });

  it('기준본이 있고 설치본이 기준본과 같으면 새 키트로 교체한다', () => {
    const r = planKitFileUpdate({ key, installed: base, base, next, recordedHashes: null });
    assert.deepEqual([r.status, r.reason, r.text], ['replaced', 'base-equal', next]);
  });

  it('기준본이 있고 사용자가 고쳤으면 병합한다', () => {
    const r = planKitFileUpdate({ key, installed: text('A', 'b', 'c'), base, next, recordedHashes: null });
    assert.deepEqual([r.status, r.text], ['merged', text('A', 'b', 'c', 'd')]);
  });

  it('기준본이 있고 새 키트가 기준본과 같으면 설치본을 그대로 둔다', () => {
    const r = planKitFileUpdate({ key, installed: text('A', 'b', 'c'), base, next: base, recordedHashes: null });
    assert.deepEqual([r.status, r.text], ['unchanged', text('A', 'b', 'c')]);
  });

  it('기준본이 없고 설치본이 기록된 해시와 같으면 사용자가 안 고친 것이라 새 키트로 교체한다', () => {
    const r = planKitFileUpdate({ key, installed: base, base: null, next, recordedHashes: { [key]: sha(base) } });
    assert.deepEqual([r.status, r.reason, r.text], ['replaced', 'hash-equal', next]);
  });

  it('기준본도 기록도 없으면 고쳤는지 알 수 없어 교체하지 않고 충돌 표시로 돌려준다', () => {
    for (const recordedHashes of [null, {}, { 'other/file': sha('x') }]) {
      const r = planKitFileUpdate({ key, installed: text('a', 'x'), base: null, next, recordedHashes });
      assert.deepEqual([r.status, r.reason], ['conflict', 'no-base-no-hash']);
    }
  });

  it('GUIDE는 사용자 구역 안만 달라도 해시가 같아 새 키트로 교체한다', () => {
    const guideKey = 'subagent-system/docs/SUBAGENT_GUIDE.md';
    const original = text('머리', '<!-- 사용자 표 시작 -->', '| 예시 |', '<!-- 사용자 표 끝 -->', '꼬리');
    const edited = text('머리', '<!-- 사용자 표 시작 -->', '| 내 표 |', '<!-- 사용자 표 끝 -->', '꼬리');
    const r = planKitFileUpdate({ key: guideKey, installed: edited, base: null, next: text('머리 2', '꼬리'), recordedHashes: { [guideKey]: legacyHashOf(guideKey, original) } });
    assert.deepEqual([r.status, r.reason], ['replaced', 'hash-equal']);
  });

  it('GUIDE의 기준본에 옛 사용자 구역이 있어도 구역을 뺀 설치본과 같은 꼴로 맞춰 병합해 구역 때문에 충돌하지 않는다', () => {
    const guideKey = 'subagent-system/docs/SUBAGENT_GUIDE.md';
    const base = text('머리', '앞', '<!-- 사용자 표 시작 -->', '| 예시 |', '<!-- 사용자 표 끝 -->', '꼬리', '끝');
    const installed = text('머리', '내 앞', '<!-- 사용자 표 시작 -->', '| 내 표 |', '<!-- 사용자 표 끝 -->', '꼬리', '끝');
    const r = planKitFileUpdate({ key: guideKey, installed, base, next: text('머리', '앞', '꼬리', '새 끝'), recordedHashes: null });
    assert.deepEqual([r.status, r.reason], ['merged', 'base-merge']);
    assert.equal(r.text, text('머리', '내 앞', '꼬리', '새 끝'));
  });

  it('GUIDE를 구역 밖에서도 고쳤으면 구역을 뺀 설치본과 새 키트만 견주어 충돌 표시를 만든다', () => {
    const guideKey = 'subagent-system/docs/SUBAGENT_GUIDE.md';
    const original = text('머리', '<!-- 사용자 표 시작 -->', '| 예시 |', '<!-- 사용자 표 끝 -->', '꼬리');
    const edited = text('머리(고침)', '<!-- 사용자 표 시작 -->', '| 내 표 |', '<!-- 사용자 표 끝 -->', '꼬리');
    const r = planKitFileUpdate({ key: guideKey, installed: edited, base: null, next: text('머리', '꼬리'), recordedHashes: { [guideKey]: legacyHashOf(guideKey, original) } });
    assert.equal(r.status, 'conflict');
    assert.ok(!r.text.includes('내 표'));
    assert.ok(!r.text.includes('사용자 표 시작'));
  });

  it('정의 파일은 description과 글쓰기 줄만 달라도 새 키트로 교체한다', () => {
    const defKey = 'agents/opus-high.md';
    const original = text('---', 'description: 키트 설명', '---', '본문', '글은 필요한 말만 쓴다');
    const edited = text('---', 'description: 내 설명', '---', '본문');
    const r = planKitFileUpdate({ key: defKey, installed: edited, base: null, next: text('---', 'description: 새 설명', '---', '새 본문'), recordedHashes: { [defKey]: legacyHashOf(defKey, original) } });
    assert.deepEqual([r.status, r.reason], ['replaced', 'hash-equal']);
  });

  it('이전 충돌 표시가 남은 설치본은 건드리지 않는다', () => {
    const installed = text('a', MARK_INSTALLED, 'x', MARK_SEPARATOR, 'y', MARK_NEXT);
    const r = planKitFileUpdate({ key, installed, base, next, recordedHashes: null });
    assert.deepEqual([r.status, r.text], ['unresolved-markers', installed]);
  });

  it('교체한 파일도 설치본이 CRLF이면 CRLF로 낸다', () => {
    const r = planKitFileUpdate({ key, installed: 'a\r\nb\r\nc\r\n', base: 'a\nb\nc\n', next });
    assert.equal(r.text, 'a\r\nb\r\nc\r\nd\r\n');
  });
});

describe('migrateLegacyZones', () => {
  const TABLE = ['| | low | medium | high | xhigh |', '|:---|:---|:---|:---|:---|', '| **Haiku** | 시험 실행 | 파일 탐색 | | |', '| **Sonnet** | 작은 수정 | 구현 | 긴 일 | |', '| **Opus** | | 조사 | 종합 검토 | |'];
  const guide = (extra = {}) =>
    text(
      '# 가이드',
      '<!-- 사용자 표 시작 -->',
      ...(extra.tableComment ? ['<!-- 키트 원본의 예시(백엔드)입니다. 설치할 때 고른 직군 표로 바뀝니다 -->'] : []),
      ...TABLE,
      '<!-- 사용자 표 끝 -->',
      '본문',
      '<!-- 무조건 Opus 시작 -->',
      '- 결제와 환불',
      '- 인증, 권한',
      '  이어지는 줄',
      '<!-- 무조건 Opus 끝 -->',
      '<!-- 사용자 규칙 시작 -->',
      '- RETRO.md: 「A」 대신 「B」.',
      '- 지시문 체크리스트: 규칙 하나',
      '<!-- 사용자 규칙 끝 -->',
    );

  it('사용자 표, 무조건 Opus 항목, 사용자 규칙 줄을 각각 뽑는다', () => {
    const r = migrateLegacyZones(guide());
    assert.equal(r.hasZones, true);
    assert.equal(r.table.text, TABLE.join('\n'));
    assert.deepEqual(r.unconditionalOpus.items, ['결제와 환불', '인증, 권한 이어지는 줄']);
    assert.deepEqual(r.userRules, ['RETRO.md: 「A」 대신 「B」.', '지시문 체크리스트: 규칙 하나']);
    assert.equal(r.table.isKitExample, false);
  });

  it('ROUTING_TABLE.md 글에 표와 무조건 Opus 절이 들고 스크립트의 표 읽기가 그대로 읽는다', () => {
    const r = migrateLegacyZones(guide());
    assert.ok(r.routingTableText.includes('## 무조건 Opus'));
    assert.ok(r.routingTableText.includes('- 결제와 환불'));
    const parsed = parseRoutingTable(r.routingTableText);
    assert.deepEqual(parsed.problems, []);
    assert.ok(parsed.cells.some((c) => c.model === 'opus' && c.kinds.includes('조사')));
  });

  it('옛 구역 이전은 키트 원본 예시 표시가 든 구역을 예시로 알리고 그 표시 줄은 옮기지 않는다', () => {
    const r = migrateLegacyZones(guide({ tableComment: true }));
    assert.equal(r.table.isKitExample, true);
    assert.ok(!r.routingTableText.includes('키트 원본의 예시'));
  });

  it('옛 구역이 없는 GUIDE는 옮길 것이 없다', () => {
    const r = migrateLegacyZones(text('# 가이드', '| | low | medium | high | xhigh |', '본문'));
    assert.equal(r.hasZones, false);
    assert.deepEqual([r.table.found, r.unconditionalOpus.items, r.userRules, r.routingTableText], [false, [], [], '']);
  });

  it('끝 표시가 없는 시작 표시는 구역으로 세지 않는다', () => {
    const r = migrateLegacyZones(text('<!-- 사용자 표 시작 -->', ...TABLE));
    assert.equal(r.hasZones, false);
  });
});
