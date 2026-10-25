import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// assert.partialDeepStrictEqual은 Node 22.13부터라, 설치 확인이 Node 18에서도 돌도록 같은 일을 하는 함수를 둔다.
// 객체는 expected에 있는 키만 견주고, 배열은 길이가 같고 칸마다 같은 규칙으로 견준다.
function partialEqual(actual, expected, at = '') {
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `${at || '값'}이 배열이 아닙니다`);
    assert.equal(actual.length, expected.length, `${at || '배열'} 길이`);
    expected.forEach((e, i) => partialEqual(actual[i], e, `${at}[${i}]`));
  } else if (expected !== null && typeof expected === 'object' && Object.getPrototypeOf(expected) === Object.prototype) {
    assert.ok(actual !== null && typeof actual === 'object', `${at || '값'}이 객체가 아닙니다`);
    for (const k of Object.keys(expected)) partialEqual(actual[k], expected[k], `${at}.${k}`);
  } else {
    assert.deepStrictEqual(actual, expected, at || undefined);
  }
}
import { docReviewTargets, extractSkillUses, configTextWithDocHashes, DOC_REVIEW_MAX } from '../subagentRetroHelpers.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadRates, cost as costOf, sumCost, unknownModels, lastLinePerRequest, toCounts, collectAgent, recostRows } from '../subagent-usage.js';
import { projectRoot, readJsonl, sessionCwd, retentionDays } from '../claudeProjectPaths.js';
import {
  guideTextOutsideZones,
  definitionTextForHash,
  kitFileHashesOf,
  diffKitHashes,
  configTextWithKitHashes,
  unknownModelSummary,
  parseUsage,
  extractSince,
  parseCost,
  parseCorrections,
  summarize,
  downCandidates,
  upCandidates,
  isTrivial,
  extractMessages,
  parseLabels,
  agentsFromCell,
  repeatedLabels,
  findLaterBoundary,
  parseRoutingTable,
  tableKindSet,
  pinnedCellSet,
  unknownKindGroups,
  unknownKindNames,
  retroDue as retroDueAt,
  periodLimitDays,
  upPiles,
  retroLine,
  retroStage,
  isStable,
  snoozeLine,
  periodSnoozeLossDate,
  retentionLossDate,
  claudeMdSummary,
  CLAUDE_MD_LIMIT_LINES,
  CLAUDE_MD_KEPT_MARGIN_LINES,
  checkRouting,
  descriptionKinds,
  descriptionOf,
  parseConfig,
  configTextWithoutKeptLines, configTextWithKeptLines, configTextWithMode,
  configTextWithFailures, configTextWithRemovedKinds, kindNameOf,
  RETRO_FAIL_LIMIT,
  lockState,
  LOCK_STALE_MS,
  countPending,
  dueHead,
  normalizeShape,
  isExcludedRepeat,
  extractRepeatItems,
  rankRepeats,
  REPEAT_MIN_COUNT,
  REPEAT_MIN_SESSIONS,
  REPEAT_TOP,
  floorMap,
  tableTrials,
  tableSnapshot,
  parseSnapshot,
  trialVerdict,
  downFailHistory,
  floorProposals,
  lowerDef,
  upperDef,
  resendsOf,
  DOWN_FAIL_LIMIT,
  isRetrial,
  mixedCells,
  retrialHistory,
  retrialPlan,
  undecidedRuns,
  undecidedKey,
  RETRIAL_START,
  COST_SIMILAR_RATIO,
} from '../subagentRetroHelpers.js';

const HEADER = ['날짜', '프로젝트', '정의', '일 종류', '토큰', '도구 호출', '걸린 초', '결과', '메모'].join('\t');
const row = (date, def, kind, seconds, result, memo, project = 'proj') => [date, project, def, kind, 1000, 3, seconds, result, memo].join('\t');
const boundaryRow = (isoAt, n, memo) => ['회고', '-', '회고', isoAt, n, '-', '-', '-', memo].join('\t');
const oldBoundaryRow = (memo) => ['회고', '-', '회고', '-', '-', '-', '-', '-', memo].join('\t');
const usageText = (...lines) => [HEADER, ...lines].join('\n') + '\n';
// 기간 기준이 실제 시계에 따라 결과를 바꾸지 않게 오늘을 고정한다.
const TODAY = new Date(2026, 9, 13, 12, 0, 0);
const retroDue = (parsed, opts = {}) => retroDueAt(parsed, { now: TODAY, ...opts });

describe('parseUsage 회고 경계', () => {
  it('회고 줄이 없으면 파일 전체가 대상이고 시각 제한이 없다', () => {
    const r = parseUsage(usageText(row('2026-10-09', 'sonnet-low', '번역', 30, 'ok', 'a1 메모'), row('2026-10-10', 'sonnet-low', '번역', 40, 'ok', 'a2')));
    assert.equal(r.boundary, null);
    assert.equal(r.all.length, 2);
    assert.equal(r.target.length, 2);
  });

  it('옛 경계 줄은 줄 수 열이 숫자가 아니고 그 줄 뒤만 대상이며 시각은 메모 첫머리 날짜의 로컬 0시다', () => {
    const text = usageText(
      row('2026-10-09', 'sonnet-low', '번역', 30, 'ok', 'a1'),
      oldBoundaryRow('2026-10-11 표 조정 세션에서 표를 다시 짬'),
      row('2026-10-11', 'sonnet-low', '번역', 40, 'ok', 'a2')
    );
    const r = parseUsage(text);
    assert.deepEqual(r.all.map((x) => x.agentId), ['a1', 'a2']);
    assert.deepEqual(r.target.map((x) => x.agentId), ['a2']);
    assert.deepEqual(r.boundary.at, new Date(2026, 9, 11));
    assert.equal(r.boundary.lineCount, null);
    assert.ok(r.boundary.memo.includes('표 조정'));
  });

  // 시각이 UTC ISO로 기록되므로, 로컬 날짜 경계와의 비교가 시간대와 상관없이 Date로 이뤄지는지 본다.
  it('옛 경계 날짜는 로컬 0시로 읽어, 그 날 아침의 UTC ISO 시각은 안에 넣고 전날 밤은 밖에 둔다', () => {
    const r = parseUsage(usageText(oldBoundaryRow('2026-10-11 메모')));
    const morning = new Date(2026, 9, 11, 7, 57, 19).toISOString();
    const lastNight = new Date(2026, 9, 10, 23, 59, 59).toISOString();
    assert.ok(new Date(morning).getTime() >= r.boundary.at.getTime());
    assert.ok(new Date(lastNight).getTime() < r.boundary.at.getTime());
  });

  it('새 경계 줄은 줄 수 N과 ISO 시각을 읽고 N번째 줄 뒤의 줄만 대상에 넣는다', () => {
    const text = usageText(
      row('2026-10-09', 'sonnet-low', '번역', 30, 'ok', 'a1'),
      row('2026-10-10', 'sonnet-low', '번역', 40, 'ok', 'a2'),
      boundaryRow('2026-10-10T20:00:00.000Z', '3', '시험으로 내림'),
      row('2026-10-10', 'sonnet-low', '번역', 50, 'ok', 'a3')
    );
    const r = parseUsage(text);
    assert.equal(r.boundary.lineCount, 3);
    assert.deepEqual(r.boundary.at, new Date('2026-10-10T20:00:00.000Z'));
    assert.deepEqual(r.target.map((x) => x.agentId), ['a3']);
  });

  it('새 경계에서 N 뒤지만 경계 줄 앞에 놓인 줄도 대상에 들어간다', () => {
    const text = usageText(
      row('2026-10-09', 'sonnet-low', '번역', 30, 'ok', 'a1'),
      row('2026-10-10', 'sonnet-low', '번역', 40, 'ok', 'late'),
      boundaryRow('2026-10-10T20:00:00.000Z', '2', '메모')
    );
    const r = parseUsage(text);
    assert.deepEqual(r.target.map((x) => x.agentId), ['late']);
  });

  it('프로젝트 열을 읽어 결과에 담고 메모는 맨 뒤 열이다', () => {
    const r = parseUsage(usageText(row('2026-10-10', 'sonnet-low', '번역', 30, 'ok', 'a1 메모 둘', 'proj')));
    partialEqual(r.all[0], { project: 'proj', def: 'sonnet-low', kind: '번역', seconds: 30, result: 'ok', memo: 'a1 메모 둘', agentId: 'a1' });
  });

  it('프로젝트 이름이 회고여도 경계가 아니고 정의 열(2번째)이 회고인 줄만 경계다', () => {
    const r = parseUsage(usageText(row('2026-10-10', 'sonnet-low', '번역', 30, 'ok', 'a1', '회고')));
    assert.equal(r.boundary, null);
    assert.equal(r.all.length, 1);
  });

  it('경계 줄은 사용 줄 목록에 들어가지 않는다', () => {
    const r = parseUsage(usageText(row('2026-10-09', 'sonnet-low', '번역', 30, 'ok', 'a1'), boundaryRow('2026-10-10T20:00:00.000Z', '2', '메모')));
    assert.deepEqual(r.all.map((x) => x.agentId), ['a1']);
    assert.equal(r.lineCount, 3);
  });

  it('일 종류 끝의 괄호 부연은 떼어 같은 칸으로 묶는다', () => {
    const r = parseUsage(usageText(row('2026-10-10', 'sonnet-high', '긴 보고서 문구 수정(문구 반영)', 30, 'ok', 'a1')));
    assert.equal(r.all[0].kind, '긴 보고서 문구 수정');
  });

  it('메모 첫 낱말이 agentId가 되고 숫자가 아닌 초는 null이다', () => {
    const r = parseUsage(usageText(row('2026-10-10', 'sonnet-high', '번역', '-', 'ok', 'abc123 나머지 설명')));
    assert.equal(r.all[0].agentId, 'abc123');
    assert.equal(r.all[0].seconds, null);
  });
});

const COST_HEADER = ['날짜', '프로젝트', '세션', 'agentId', '정의', '모델', 'effort', '설명', '입력', '캐시 쓰기', '캐시 읽기', '출력', '요청 수', '걸린 초', '어림 비용($)'].join('\t');
const costRow = (id, def, desc, requests, seconds, cost, date = '2026-10-11') =>
  [date, 'proj', 'sess', id, def, 'claude-sonnet-5-5', 'high', desc, 1, 2, 3, 4, requests, seconds, cost].join('\t');

describe('parseCost', () => {
  it('같은 agentId가 두 파일에 있으면 나중에 읽은 파일의 줄이 이긴다', () => {
    const f1 = [COST_HEADER, costRow('a1', 'sonnet-high', 'x', 10, 100, '1.0')].join('\n');
    const f2 = [COST_HEADER, costRow('a1', 'sonnet-high', 'x', 25, 250, '2.5')].join('\n');
    partialEqual(parseCost([f1, f2]).get('a1'), { requests: 25, seconds: 250, cost: 2.5 });
    partialEqual(parseCost([f2, f1]).get('a1'), { requests: 10, seconds: 100, cost: 1.0 });
  });

  it('한 파일 안에서 같은 agentId 줄이 여럿이면 마지막 줄만 쓴다', () => {
    const text = [COST_HEADER, costRow('a1', 'sonnet-high', 'x', 10, 100, '1.0'), costRow('a1', 'sonnet-high', 'x', 25, 250, '2.5')].join('\n');
    const m = parseCost([text]);
    assert.equal(m.size, 1);
    partialEqual(m.get('a1'), { requests: 25, seconds: 250, cost: 2.5 });
  });

  it('다시 계산한 줄은 요청 수가 같거나 줄어도 옛 ? 줄을 대신한다', () => {
    const text = [COST_HEADER, costRow('a1', 'sonnet-high', 'x', 7, 100, '?'), costRow('a1', 'sonnet-high', 'x', 6, 100, '0.3')].join('\n');
    partialEqual(parseCost([text]).get('a1'), { requests: 6, cost: 0.3 });
  });

  it('프로젝트 열이 있어 열이 15개 미만인 옛 형식 줄은 건너뛴다', () => {
    const oldRow = ['2026-10-11', 'sess', 'a1', 'sonnet-high', 'm', 'high', 'x', 1, 2, 3, 4, 10, 100, '1.0'].join('\t');
    assert.equal(parseCost([[COST_HEADER, oldRow].join('\n')]).size, 0);
  });

  it('정의, 설명, 날짜를 담고 알 수 없는 비용은 null이다', () => {
    const m = parseCost([[COST_HEADER, costRow('a2', 'opus-low', '설명 글', 3, 30, '?')].join('\n')]);
    partialEqual(m.get('a2'), { def: 'opus-low', description: '설명 글', date: '2026-10-11', cost: null });
  });
});

describe('summarize', () => {
  const costMap = parseCost([
    [COST_HEADER, costRow('a1', 'sonnet-high', 'one', 10, 100, '1.0'), costRow('a2', 'sonnet-high', 'two', 5, 50, '0.5'), costRow('zz', 'opus-high', '짝 없음', 7, 70, '3.0')].join('\n'),
  ]);

  it('같은 agentId 사용 줄 둘은 건수 2로 세고 비용, 초, 정정은 한 번만 붙인다', () => {
    const { target } = parseUsage(
      usageText(row('2026-10-11', 'sonnet-high', '구현', 1, '재지시', 'a1 첫 시도'), row('2026-10-11', 'sonnet-high', '구현', 2, 'ok', 'a1 재지시 뒤'))
    );
    const s = summarize(target, costMap, new Map([['a1', 1]]));
    const cell = s.rows.find((r) => r.def === 'sonnet-high' && r.kind === '구현');
    partialEqual(cell, { count: 2, ok: 1, redo: 1, up: 0, corrections: 1, paired: 1, costSum: 1.0, costAvg: 1.0, avgSeconds: 100 });
  });

  it('짝 없는 사용 줄은 비용 없음으로 세고 비용 평균에서 빠지며 초는 사용 줄 값으로 평균에 든다', () => {
    const { target } = parseUsage(
      usageText(row('2026-10-11', 'sonnet-high', '구현', 20, 'ok', 'a1 메모'), row('2026-10-11', 'sonnet-high', '구현', 99, 'ok', 'nomatch 메모'))
    );
    const s = summarize(target, costMap, new Map());
    assert.equal(s.noCost, 1);
    const cell = s.rows[0];
    partialEqual(cell, { count: 2, paired: 1, costSum: 1.0, costAvg: 1.0 });
    partialEqual(s.total, { count: 2, paired: 1 });
  });

  it('짝 없는 비용 줄은 사용 기록 전체에 없을 때만 비용만 있는 줄로 나온다', () => {
    const parsed = parseUsage(usageText(row('2026-10-11', 'sonnet-high', '구현', 20, 'ok', 'a1 메모'), row('2026-10-09', 'opus-high', '검토', 20, 'ok', 'zz 옛 줄')));
    const s = summarize(parsed.target.slice(0, 1), costMap, new Map(), { all: parsed.all });
    assert.deepEqual(s.costOnly.map((c) => c.agentId), ['a2']);
    const s2 = summarize(parsed.target.slice(0, 1), costMap, new Map(), { all: parsed.all.slice(0, 1) });
    assert.deepEqual(s2.costOnly.map((c) => c.agentId).sort(), ['a2', 'zz']);
  });

  it('일 종류 끝 괄호 부연이 달라도 한 칸으로 묶인다', () => {
    const { target } = parseUsage(
      usageText(row('2026-10-11', 'sonnet-high', '문구 수정(A안)', 20, 'ok', 'x1'), row('2026-10-11', 'sonnet-high', '문구 수정(B안)', 20, 'ok', 'x2'))
    );
    const s = summarize(target, new Map(), new Map());
    assert.equal(s.rows.length, 1);
    assert.equal(s.rows[0].count, 2);
  });

  it('비용이 없는 칸의 초 평균은 사용 줄의 초로 낸다', () => {
    const { target } = parseUsage(usageText(row('2026-10-11', 'haiku-low', '실행', 10, 'ok', 'q1'), row('2026-10-11', 'haiku-low', '실행', 30, 'ok', 'q2')));
    const s = summarize(target, new Map(), new Map());
    assert.equal(s.rows[0].avgSeconds, 20);
    assert.equal(s.rows[0].costAvg, null);
  });
});

describe('내려 보기와 올리기 후보', () => {
  const five = (result = 'ok') => Array.from({ length: 5 }, (_, i) => row('2026-10-0' + (i + 1), 'sonnet-medium', '구현', 10, result, `m${i}`));

  it('파일 전체 마지막 5건이 모두 ok이면 내려 보기 후보다', () => {
    const { all, target } = parseUsage(usageText(...five()));
    assert.deepEqual(downCandidates(all, new Map()), [{ def: 'sonnet-medium', kind: '구현' }]);
  });

  it('마지막 5건 중 1건에 정정이 있으면 내려 보기 후보가 아니다', () => {
    const { all, target } = parseUsage(usageText(...five()));
    assert.deepEqual(downCandidates(all, new Map([['m2', 1]])), []);
  });

  it('마지막 5건에 ok가 아닌 결과가 끼면 후보가 아니고 5건 미만도 아니다', () => {
    const lines = five();
    lines[4] = row('2026-10-05', 'sonnet-medium', '구현', 10, '재지시', 'm4');
    const p5 = parseUsage(usageText(...lines));
    assert.deepEqual(downCandidates(p5.all, new Map()), []);
    const p4 = parseUsage(usageText(...five().slice(0, 4)));
    assert.deepEqual(downCandidates(p4.all, new Map()), []);
  });

  it('경계 앞뒤에 걸친 5건도 센다', () => {
    const boundary = boundaryRow('2026-10-03T00:00:00.000Z', '4', '메모');
    const lines = five();
    const p = parseUsage(usageText(...lines.slice(0, 3), boundary, ...lines.slice(3)));
    assert.equal(p.target.length, 2);
    assert.deepEqual(downCandidates(p.all, new Map()), [{ def: 'sonnet-medium', kind: '구현' }]);
  });

  it('opus-xhigh 칸은 마지막 5건이 모두 ok여도 내려 보기 후보가 아니다', () => {
    const lines = Array.from({ length: 5 }, (_, i) => row('2026-10-0' + (i + 1), 'opus-xhigh', '구현', 10, 'ok', `x${i}`));
    const p = parseUsage(usageText(...lines));
    assert.deepEqual(downCandidates(p.all, new Map()), []);
  });

  it('fable-high 칸은 마지막 5건이 모두 ok여도 내려 보기 후보가 아니다', () => {
    const lines = Array.from({ length: 5 }, (_, i) => row('2026-10-0' + (i + 1), 'fable-high', '구현', 10, 'ok', `x${i}`));
    assert.deepEqual(downCandidates(parseUsage(usageText(...lines)).all, new Map()), []);
  });

  const fiveOf = (def, kind) => Array.from({ length: 5 }, (_, i) => row('2026-10-0' + (i + 1), def, kind, 10, 'ok', `${def}${i}`));
  const guideTable = ['| | low | medium | high | xhigh |', '|:---|:---|:---|:---|:---|', '| **Opus** | | | 최종 코드 리뷰 「(고정)」, 올라온 일 | |'].join('\n');

  it('표에서 「(고정)」이 붙은 칸은 마지막 5건이 모두 ok여도 후보가 아니다', () => {
    const p = parseUsage(usageText(...fiveOf('opus-high', '최종 코드 리뷰')));
    const pinned = pinnedCellSet(parseRoutingTable(guideTable).cells);
    assert.deepEqual(downCandidates(p.all, new Map(), pinned), []);
  });

  it('같은 opus-high여도 고정 표시가 없는 칸은 후보다', () => {
    const p = parseUsage(usageText(...fiveOf('opus-high', '올라온 일')));
    const pinned = pinnedCellSet(parseRoutingTable(guideTable).cells);
    assert.deepEqual(downCandidates(p.all, new Map(), pinned), [{ def: 'opus-high', kind: '올라온 일' }]);
  });

  it('같은 일 이름이 다른 정의 칸에 있으면 고정은 정의와 일 종류가 모두 맞는 칸에만 걸린다', () => {
    const p = parseUsage(usageText(...fiveOf('opus-medium', '최종 코드 리뷰')));
    const pinned = pinnedCellSet(parseRoutingTable(guideTable).cells);
    assert.deepEqual(downCandidates(p.all, new Map(), pinned), [{ def: 'opus-medium', kind: '최종 코드 리뷰' }]);
  });

  it('표를 못 읽어도 opus-high의 「무조건 Opus」 영역은 후보가 아니다', () => {
    const p = parseUsage(usageText(...fiveOf('opus-high', '무조건 Opus 영역 구현')));
    assert.deepEqual(downCandidates(p.all, new Map()), []);
  });

  it('haiku-low 칸은 내려갈 곳이 없어 후보가 아니다', () => {
    const p = parseUsage(usageText(...fiveOf('haiku-low', '시험 실행')));
    assert.deepEqual(downCandidates(p.all, new Map()), []);
  });

  it('sonnet-low 칸은 아래에 haiku-high가 있어 5건이 모두 ok이면 후보다', () => {
    const p = parseUsage(usageText(...fiveOf('sonnet-low', '문구 반영')));
    assert.deepEqual(downCandidates(p.all, new Map()), [{ def: 'sonnet-low', kind: '문구 반영' }]);
  });

  it('사다리 밖 정의(Explore)는 5건이 모두 ok여도 내려 보기 후보가 아니다', () => {
    const p = parseUsage(usageText(...fiveOf('Explore', '코드 찾기')));
    assert.equal(lowerDef('Explore'), null);
    assert.deepEqual(downCandidates(p.all, new Map()), []);
  });

  it('사다리 밖 정의는 올림이 쌓여도 올리기 후보와 올림 기준 묶음에 들지 않는다', () => {
    const p = parseUsage(usageText(row('2026-10-11', 'Explore', '코드 찾기', 10, '올림', 'u1'), row('2026-10-11', 'Explore', '코드 찾기', 10, '올림', 'u2')));
    assert.deepEqual(upCandidates(summarize(p.target, new Map(), new Map()).rows), { up: [], watch: [] });
    assert.deepEqual(upPiles(p.target), []);
  });

  const cellRows = (n, upN) => Array.from({ length: n }, (_, i) => row('2026-10-11', 'sonnet-medium', '구현', 10, i < upN ? '올림' : 'ok', `u${i}`));
  const upResult = (n, upN) => upCandidates(summarize(parseUsage(usageText(...cellRows(n, upN))).target, new Map(), new Map()).rows);

  it('올림 1건과 정정 1건인 2건 칸은 2건 중 2건이라 올리기 후보다', () => {
    const p = parseUsage(usageText(row('2026-10-11', 'sonnet-medium', '구현', 10, '올림', 'u1'), row('2026-10-11', 'sonnet-medium', '구현', 10, 'ok', 'u2')));
    assert.deepEqual(upCandidates(summarize(p.target, new Map(), new Map([['u2', 1]])).rows), { up: [{ def: 'sonnet-medium', kind: '구현', count: 2, total: 2, ratio: 1 }], watch: [] });
  });

  it('30건 중 2건(7%)은 올리기 후보가 아니고 지켜볼 칸이다', () => {
    const r = upResult(30, 2);
    assert.deepEqual(r.up, []);
    partialEqual(r.watch, [{ def: 'sonnet-medium', kind: '구현', count: 2, total: 30 }]);
  });

  it('10건 중 2건은 정확히 20%라 올리기 후보다', () => {
    const r = upResult(10, 2);
    partialEqual(r.up, [{ count: 2, total: 10, ratio: 0.2 }]);
    assert.deepEqual(r.watch, []);
  });

  it('1건 중 1건은 2건이 안 되어 후보도 지켜볼 칸도 아니다', () => {
    assert.deepEqual(upResult(1, 1), { up: [], watch: [] });
  });

  it('올림과 정정을 합쳐 1건이면 올리기 후보가 아니다', () => {
    const p = parseUsage(usageText(row('2026-10-11', 'sonnet-medium', '구현', 10, '올림', 'u1')));
    assert.deepEqual(upCandidates(summarize(p.target, new Map(), new Map()).rows), { up: [], watch: [] });
  });

  const kindRow = (result, id) => row('2026-10-11', 'sonnet-medium', '구현', 10, result, id);
  const okFive = () => ['u1', 'u2', 'u3', 'u4', 'u5'].map((id) => kindRow('ok', id));

  it('에이전트 한 명에 올림 줄과 정정이 함께 붙어도 1명으로 세어 ok 5건 칸은 올리기 후보도 지켜볼 칸도 아니다', () => {
    const p = parseUsage(usageText(...okFive(), kindRow('올림', 'u1')));
    const r = upCandidates(summarize(p.target, new Map(), new Map([['u1', 1]])).rows);
    assert.deepEqual(r, { up: [], watch: [] });
    assert.deepEqual(upPiles(p.target, new Map([['u1', 1]])), []);
  });

  it('같은 agentId가 재지시 줄과 마지막 줄을 가지면 분모에서 1명으로 센다', () => {
    const p = parseUsage(usageText(kindRow('재지시', 'u1'), kindRow('ok', 'u1'), kindRow('올림', 'u2'), kindRow('올림', 'u3')));
    const r = upCandidates(summarize(p.target, new Map(), new Map()).rows);
    assert.deepEqual(r.up, [{ def: 'sonnet-medium', kind: '구현', count: 2, total: 3, ratio: 2 / 3 }]);
    assert.deepEqual(upPiles(p.target), [{ def: 'sonnet-medium', kind: '구현', count: 2, total: 3 }]);
  });

  it('올림이 붙은 서로 다른 에이전트가 2명이면 올리기 후보다', () => {
    const p = parseUsage(usageText(...okFive(), kindRow('올림', 'u6'), kindRow('올림', 'u7')));
    partialEqual(upCandidates(summarize(p.target, new Map(), new Map()).rows).up, [{ count: 2, total: 7 }]);
  });

  it('올림 줄이 있는 에이전트와 정정이 붙은 다른 에이전트는 2명이라 올리기 후보이고, 정정이 여러 번이어도 1명이다', () => {
    const p = parseUsage(usageText(...okFive(), kindRow('올림', 'u6')));
    assert.deepEqual(upCandidates(summarize(p.target, new Map(), new Map([['u1', 3]])).rows).up, [{ def: 'sonnet-medium', kind: '구현', count: 2, total: 6, ratio: 2 / 6 }]);
  });
});

describe('isTrivial', () => {
  for (const t of ['a', 'Q1 a', '좋아요!', '진행해줘', '/compact', '3', 'E', 'ok', 'Q12 3', 'Yes', 'Go ahead', 'Thank you!', 'Sounds good', 'do it', 'LGTM']) {
    it(`${t}는 걸러진다`, () => {
      assert.equal(isTrivial(t), true);
    });
  }

  for (const t of ['아니', 'a 말고 b', 'b인 것 같은데 표시 이름이 애매해', '진행해줘 그리고 테스트도', '/compact 해줘', 'ab', 'go ahead and run the tests', 'yes but use b']) {
    it(`${t}는 걸러지지 않는다`, () => {
      assert.equal(isTrivial(t), false);
    });
  }
});

const ts = (m) => `2026-10-11T00:${String(m).padStart(2, '0')}:00.000Z`;
const human = (m, text) => ({ type: 'user', origin: { kind: 'human' }, timestamp: ts(m), message: { role: 'user', content: text } });
const assistant = (m, text) => ({ type: 'assistant', timestamp: ts(m), message: { role: 'assistant', content: [{ type: 'text', text }] } });
const agentUse = (id, input) => ({ type: 'assistant', timestamp: ts(0), message: { content: [{ type: 'tool_use', id, name: 'Agent', input }] } });
const asyncSpawn = (toolId, agentId) => ({
  type: 'user',
  timestamp: ts(0),
  message: { content: [{ type: 'tool_result', tool_use_id: toolId }] },
  toolUseResult: { isAsync: true, status: 'async_launched', agentId },
});
const teammateSpawn = (toolId, agentId, name, agentType) => ({
  type: 'user',
  timestamp: ts(0),
  message: { content: [{ type: 'tool_result', tool_use_id: toolId }] },
  toolUseResult: { status: 'teammate_spawned', agentId, agent_id: agentId, name, agent_type: agentType },
});
const taskDone = (m, taskId, status = 'completed') => ({
  type: 'user',
  timestamp: ts(m),
  origin: { kind: 'task-notification' },
  message: { content: `<task-notification>\n<task-id>${taskId}</task-id>\n<status>${status}</status>\n<summary>Agent finished</summary>\n</task-notification>` },
});
const idle = (m, name) => ({
  type: 'user',
  timestamp: ts(m),
  message: { content: `Another Claude session sent a message:\n<teammate-message teammate_id="${name}" color="orange">\n{"type":"idle_notification","from":"${name}"}\n</teammate-message>` },
});

describe('extractMessages', () => {
  const turnOnly = (m, text, extra = {}) => ({ type: 'user', turnOrigin: 'human', timestamp: ts(m), message: { role: 'user', content: text }, ...extra });

  it('origin 없이 turnOrigin만 human인 사람 메시지도 뽑고, 명령 출력과 도구 결과와 다른 turnOrigin은 뺀다', () => {
    const { messages, total } = extractMessages(
      [
        turnOnly(1, '꼴만 다른 지시입니다'),
        turnOnly(2, '<bash-stdout>out</bash-stdout>'),
        turnOnly(3, '<local-command-stdout>out</local-command-stdout>'),
        turnOnly(4, '도구 결과 줄입니다', { toolUseResult: { stdout: 'x' } }),
        turnOnly(5, '다른 출처입니다', { turnOrigin: 'task_notification' }),
        turnOnly(6, '시스템 출처 줄입니다', { origin: { kind: 'system' } }),
      ],
      null
    );
    assert.deepEqual(messages.map((m) => m.text), ['꼴만 다른 지시입니다']);
    assert.equal(total, 1);
  });

  it('사람 메시지만 뽑고 teammate 알림, 압축 요약, 명령 출력 줄은 뺀다', () => {
    const { messages, total } = extractMessages(
      [
        human(1, '첫 지시입니다'),
        { type: 'user', timestamp: ts(2), message: { content: 'Another Claude session sent a message: x' } },
        { type: 'user', isCompactSummary: true, timestamp: ts(3), message: { content: 'This session is being continued' } },
        { type: 'user', timestamp: ts(4), origin: { kind: 'system' }, message: { content: '<local-command-stdout>out</local-command-stdout>' } },
        human(5, '두번째 지시입니다'),
      ],
      null
    );
    assert.deepEqual(messages.map((m) => m.text), ['첫 지시입니다', '두번째 지시입니다']);
    assert.equal(total, 2);
  });

  it('붙여넣기로 시작하는 사람 메시지도 들어가고 text 조각 배열은 이어 붙인다', () => {
    const { messages } = extractMessages(
      [human(1, '\n\n<pasted_content id="1">\n피드백\n</pasted_content>\n'), { ...human(2, ''), message: { content: [{ type: 'text', text: '조각 하나' }, { type: 'text', text: ' 둘' }] } }],
      null
    );
    assert.equal(messages.length, 2);
    assert.equal(messages[0].text.startsWith('\n\n<pasted_content'), true);
    assert.equal(messages[1].text, '조각 하나 둘');
  });

  it('since 이전 메시지는 뺀다', () => {
    const { messages, total } = extractMessages([human(1, '옛 메시지입니다'), human(10, '새 메시지입니다')], new Date(ts(5)));
    assert.deepEqual(messages.map((m) => m.text), ['새 메시지입니다']);
    assert.equal(total, 1);
  });

  it('task-notification 완료와 teammate idle 알림은 둘 다 끝난 에이전트로 잡힌다', () => {
    const { messages } = extractMessages(
      [
        human(1, '시작합니다 지시'),
        agentUse('t1', { description: 'Review plan', subagent_type: 'opus-high' }),
        asyncSpawn('t1', 'agentA'),
        agentUse('t2', { description: '버튼 선택 표시', subagent_type: 'sonnet-high', name: 'worker-a' }),
        teammateSpawn('t2', 'aworker-a-01', 'worker-a', 'sonnet-high'),
        taskDone(3, 'agentA'),
        idle(4, 'worker-a'),
        human(6, '아니 그게 아니라'),
      ],
      null
    );
    assert.deepEqual(messages[1].agents, [
      { agentId: 'agentA', def: 'opus-high', description: 'Review plan' },
      { agentId: 'aworker-a-01', def: 'sonnet-high', description: '버튼 선택 표시' },
    ]);
  });

  it('async_launched 결과와 에이전트가 아닌 백그라운드 명령 알림은 끝난 에이전트로 잡지 않는다', () => {
    const { messages } = extractMessages(
      [human(1, '시작합니다 지시'), agentUse('t1', { description: 'd', subagent_type: 'opus-high' }), asyncSpawn('t1', 'agentA'), taskDone(3, 'bfft8dw5z'), human(6, '다음 지시 입니다')],
      null
    );
    assert.deepEqual(messages[1].agents, []);
  });

  it('앞 사람 메시지보다 먼저 끝난 에이전트는 잡히지 않고 걸러진 짧은 답도 앞 메시지로 센다', () => {
    const { messages, filtered } = extractMessages(
      [
        agentUse('t1', { description: 'd', subagent_type: 'opus-high' }),
        asyncSpawn('t1', 'agentA'),
        human(1, '첫 지시입니다'),
        taskDone(2, 'agentA'),
        human(3, 'a'),
        human(4, '아니 틀렸어'),
      ],
      null
    );
    assert.equal(filtered, 1);
    assert.deepEqual(messages.map((m) => m.text), ['첫 지시입니다', '아니 틀렸어']);
    assert.deepEqual(messages[0].agents, []);
    assert.deepEqual(messages[1].agents, []);
  });

  it('한 구간에 여럿 끝나면 최근 5개만 끝난 순서로 담는다', () => {
    const spawns = Array.from({ length: 7 }, (_, i) => [agentUse(`t${i}`, { description: `d${i}`, subagent_type: 'sonnet-low' }), asyncSpawn(`t${i}`, `ag${i}`)]).flat();
    const dones = Array.from({ length: 7 }, (_, i) => taskDone(i + 1, `ag${i}`));
    const { messages } = extractMessages([human(0, '시작합니다 지시'), ...spawns, ...dones, human(20, '결과 이상한데요')], null);
    assert.deepEqual(messages[1].agents.map((a) => a.agentId), ['ag2', 'ag3', 'ag4', 'ag5', 'ag6']);
  });

  it('동기 실행이 끝난 상태로 돌아온 Agent 결과는 끝난 에이전트로 잡는다', () => {
    const { messages } = extractMessages(
      [
        human(1, '시작합니다 지시'),
        agentUse('t1', { description: '동기 일', subagent_type: 'haiku-low' }),
        { type: 'user', timestamp: ts(2), message: { content: [{ type: 'tool_result', tool_use_id: 't1' }] }, toolUseResult: { status: 'completed', agentId: 'sync1' } },
        human(5, '그게 아닌데요'),
      ],
      null
    );
    assert.deepEqual(messages[1].agents, [{ agentId: 'sync1', def: 'haiku-low', description: '동기 일' }]);
  });

  it('앞 응답은 바로 앞 assistant 글의 마지막 200자다', () => {
    const long = 'x'.repeat(300) + '끝부분';
    const { messages } = extractMessages([human(1, '시작합니다 지시'), assistant(2, '옛 응답'), assistant(3, long), human(4, '아니 그게 아니라')], null);
    assert.equal(messages[1].prev.length, 200);
    assert.equal(messages[1].prev.endsWith('끝부분'), true);
  });

  it('같은 세션에서 앞 사람 메시지와 글이 같으면 다시 보낸 것으로 걸러진다', () => {
    const { messages, filtered, total } = extractMessages([human(1, '이거 고쳐 주세요'), human(2, '이거 고쳐 주세요'), human(3, '다른 지시입니다')], null);
    assert.deepEqual(messages.map((m) => m.text), ['이거 고쳐 주세요', '다른 지시입니다']);
    assert.equal(filtered, 1);
    assert.equal(total, 3);
  });

  const resent = (a, b, mid) => extractMessages([human(1, a), ...(mid ? [mid] : []), human(3, b)], null);

  it('앞 사람 메시지와 앞 15자가 같고 둘 다 15자 이상이면 오타를 고치거나 뒤를 덜어 다시 보내도 걸러진다', () => {
    const typo = resent(
      '이 일은 모두 high로 보내는 게 맞아요. low부터 high까지 정해 주세요',
      '이 일은 모두 high로 보내는 게 맞나요. low부터 high까지 정해 주세요',
    );
    assert.equal(typo.messages.length, 1);
    assert.equal(typo.filtered, 1);
    const cut = resent('작업이 끝나면 결과를 꼭 먼저 알려 주세요. 이번에는 바로 확인하겠습니다.', '작업이 끝나면 결과를 꼭 먼저 알려 주세요.');
    assert.equal(cut.messages.length, 1);
    assert.equal(cut.filtered, 1);
  });

  it('공백과 문장부호를 뺀 앞 15자가 다르면 걸러지지 않는다', () => {
    const { messages, filtered } = resent('작업이 끝나면 결과를 꼭 먼저 알려 주세요', '병합이 끝나면 결과를 꼭 먼저 알려 주세요');
    assert.equal(messages.length, 2);
    assert.equal(filtered, 0);
  });

  it('15자 미만이면 글 전체가 같을 때만 걸러진다', () => {
    const diff = resent('이거 고쳐 주세요', '이거 고쳐 주세요 빨리');
    assert.equal(diff.messages.length, 2);
    assert.equal(diff.filtered, 0);
  });

  it('사이에 다른 사람 메시지가 끼면 앞 15자가 같아도 걸러지지 않는다', () => {
    const text = '작업이 끝나면 결과를 꼭 먼저 알려 주세요.';
    const { messages, filtered } = resent(text, text, human(2, '다른 지시입니다'));
    assert.equal(messages.length, 3);
    assert.equal(filtered, 0);
  });
});

describe('parseLabels', () => {
  const messages = [
    { n: 1, agents: [{ agentId: 'ag1' }, { agentId: 'ag2' }] },
    { n: 2, agents: [{ agentId: 'only1' }] },
    { n: 3, agents: [] },
  ];

  it('탭, |, 공백 둘로 가른 줄을 모두 읽고 코드 울타리와 머리줄은 건너뛴다', () => {
    const text = ['```', '번호\t분류\t대상\t이름표', '1\t정정\tag1\t범위 밖 수정', '2 | 방향 전환 | - | -', '3  해당 없음  -  -', '```'].join('\n');
    const { labels, skipped } = parseLabels(text, messages);
    assert.deepEqual(skipped, []);
    assert.deepEqual(labels, [
      { n: 1, kind: '정정', target: 'ag1', label: '범위 밖 수정' },
      { n: 2, kind: '방향 전환', target: '-', label: '-' },
      { n: 3, kind: '해당 없음', target: '-', label: '-' },
    ]);
  });

  it('잘못된 분류 값, 없는 번호, 목록 밖 agentId는 건너뛰고 번호를 알린다', () => {
    const text = ['1\t오류\t-\t-', '9\t정정\tag1\tx', '1\t정정\tzzz\tx', '3\t정정\tag1\tx'].join('\n');
    const { labels, skipped } = parseLabels(text, messages);
    assert.deepEqual(labels, []);
    assert.deepEqual(skipped.map((s) => s.n), [1, 9, 1, 3]);
  });

  it('끝난 에이전트가 하나일 때 서브에이전트라고만 적으면 그 agentId로 채운다', () => {
    const { labels, skipped } = parseLabels('2\t정정\t서브에이전트\t지시 어김\n1\t정정\t서브에이전트\t지시 어김', messages);
    assert.deepEqual(labels, [{ n: 2, kind: '정정', target: 'only1', label: '지시 어김' }]);
    assert.deepEqual(skipped.map((s) => s.n), [1]);
  });

  it('메인 대상은 에이전트 목록이 비어 있어도 받아들인다', () => {
    const { labels } = parseLabels('3\t정정\t메인\t앞 응답 틀림', messages);
    assert.deepEqual(labels, [{ n: 3, kind: '정정', target: '메인', label: '앞 응답 틀림' }]);
  });
});

describe('parseLabels 표 모양 답', () => {
  const messages = [
    { n: 1, agents: [] },
    { n: 2, agents: [{ agentId: 'only1' }] },
    { n: 3, agents: [] },
  ];

  it('앞뒤에 |를 둔 표 모양 줄도 읽고 구분줄과 머리줄은 건너뛴다', () => {
    const text = ['| 번호 | 분류 | 대상 | 이름표 |', '|---|---|---|---|', '| 1 | 해당 없음 | - | - |', '| 2 | 정정 | 서브에이전트 | 색 틀림 |'].join('\n');
    const { labels, skipped, unlabeled } = parseLabels(text, messages);
    assert.deepEqual(skipped, []);
    assert.deepEqual(unlabeled, [3]);
    assert.deepEqual(labels, [
      { n: 1, kind: '해당 없음', target: '-', label: '-' },
      { n: 2, kind: '정정', target: 'only1', label: '색 틀림' },
    ]);
  });

  it('짝 지은 답도 건너뛴 줄도 없는 메시지는 분류 답이 없는 메시지로 돌려준다', () => {
    const { unlabeled } = parseLabels('1\t오류\t-\t-\n2\t해당 없음\t-\t-', messages);
    assert.deepEqual(unlabeled, [3]);
  });
});

describe('agentsFromCell', () => {
  it('끝난 에이전트 칸에서 agentId만 읽고 정의 이름의 쌍점에는 잘리지 않는다', () => {
    const cell = 'ag1:plugin-x:reviewer:리뷰 설명|ag2:sonnet-low:번역';
    assert.deepEqual(agentsFromCell(cell), [{ agentId: 'ag1' }, { agentId: 'ag2' }]);
    assert.deepEqual(agentsFromCell('-'), []);
  });
});

describe('parseCorrections와 repeatedLabels', () => {
  const header = ['날짜', '프로젝트', '세션', '시각', '대상', 'agentId', '정의', '일 종류', '이름표', '메시지'].join('\t');
  const line = (date, label, msg) => [date, 'proj', 's1', date + 'T00:00:00Z', '서브에이전트', 'ag1', 'sonnet-high', '구현', label, msg].join('\t');

  it('정정 기록 줄을 읽고 머리줄은 건너뛴다', () => {
    const rows = parseCorrections([header, line('2026-10-10', '범위 밖 수정', '아니')].join('\n') + '\n');
    assert.equal(rows.length, 1);
    partialEqual(rows[0], { date: '2026-10-10', session: 's1', agentId: 'ag1', label: '범위 밖 수정', message: '아니' });
  });

  it('정정 기록의 프로젝트 열을 읽고 10열 미만 줄은 건너뛴다', () => {
    const short = ['2026-10-10', 's1', 't', '메인', 'ag1', 'sonnet-high', '구현', '이름표'].join('\t');
    const rows = parseCorrections([header, line('2026-10-10', '범위 밖 수정', '아니'), short].join('\n'));
    assert.equal(rows.length, 1);
    partialEqual(rows[0], { project: 'proj', session: 's1', target: '서브에이전트', def: 'sonnet-high', kind: '구현' });
  });

  it('같은 이름표가 2건 이상일 때만 반복 지적으로 건수와 처음 마지막 날짜와 예 둘을 낸다', () => {
    const rows = parseCorrections(
      [header, line('2026-10-10', '범위 밖 수정', '첫'), line('2026-10-12', '범위 밖 수정', '둘'), line('2026-10-11', '범위 밖 수정', '셋'), line('2026-10-11', '주석 남김', '단독'), line('2026-10-11', '-', '이름표 없음')].join('\n')
    );
    assert.deepEqual(repeatedLabels(rows), [{ label: '범위 밖 수정', count: 3, first: '2026-10-10', last: '2026-10-12', examples: ['첫', '둘'] }]);
  });
});

describe('findLaterBoundary', () => {
  const boundary = (n, memo) => boundaryRow('2026-10-11T00:00:00.000Z', String(n), memo);
  const lines = [row('2026-10-01', 'sonnet-medium', '구현', 10, 'ok', 'a'), row('2026-10-02', 'sonnet-medium', '구현', 10, 'ok', 'b')];

  it('사용 줄 수 N번째 줄 뒤에 회고 줄이 없으면 null이다', () => {
    assert.equal(findLaterBoundary(usageText(...lines), 3), null);
  });

  it('N번째 줄 뒤에 다른 세션의 회고 줄이 있으면 그 줄 번호와 메모를 돌려준다', () => {
    const text = usageText(...lines, row('2026-10-03', 'sonnet-medium', '구현', 10, 'ok', 'c'), boundary(3, '다른 세션 메모'));
    assert.deepEqual(findLaterBoundary(text, 3), { line: 5, memo: '다른 세션 메모' });
  });

  it('N번째 줄까지에 있던 옛 회고 줄은 무시한다', () => {
    const text = usageText(boundary(0, '옛 메모'), ...lines);
    assert.equal(findLaterBoundary(text, 4), null);
  });
});

describe('parseRoutingTable', () => {
  const table = (...rows) => ['| | low | medium | high | xhigh |', '|:---|:---|:---|:---|:---|', ...rows].join('\n');

  it('괄호 안 쉼표로는 나누지 않고 괄호 부연은 이름에서 뺀다', () => {
    const r = parseRoutingTable(table('| **Sonnet** | 수정 | | 오래 걸리는 일(긴 구현 계획 실행, 많은 파일의 같은 변경), 큰 diff(20파일 넘음)의 검토 | |'));
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.cells.find((c) => c.effort === 'high').kinds, ['오래 걸리는 일', '큰 diff의 검토']);
  });

  it('시험 표시는 이름에서 빠지고 칸의 모델과 effort가 함께 돌아온다', () => {
    const r = parseRoutingTable(table('| **Opus** | 조사, 가공 「(시험: 다음 1건 `opus-low`)」 | 긴 측정 | | |'));
    const low = r.cells.find((c) => c.model === 'opus' && c.effort === 'low');
    assert.deepEqual(low.kinds, ['조사', '가공']);
    assert.deepEqual(r.cells.find((c) => c.effort === 'medium').kinds, ['긴 측정']);
  });

  it('시험 표시 말고 다른 「」 표시는 이름에 남는다', () => {
    const r = parseRoutingTable(table('| **Opus** | | | 원인 찾기, 아래 「무조건 Opus」 영역 구현 「(시험: 다음 1건 `opus-medium`)」 | |'));
    assert.deepEqual(r.cells.find((c) => c.effort === 'high').kinds, ['원인 찾기', '아래 「무조건 Opus」 영역 구현']);
  });

  it('「(고정)」이 붙은 칸도 일 이름은 표시를 뗀 이름이고 고정 칸으로 따로 돌아온다', () => {
    const r = parseRoutingTable(table('| **Opus** | | | 최종 코드 리뷰 「(고정)」, 원인 찾기(이슈 분석, 수정 포함) 「(고정)」, 올라온 일 | |'));
    const high = r.cells.find((c) => c.effort === 'high');
    assert.deepEqual(high.kinds, ['최종 코드 리뷰', '원인 찾기', '올라온 일']);
    assert.deepEqual(high.pinned, ['최종 코드 리뷰', '원인 찾기']);
    assert.deepEqual(unknownKindNames(parseUsage(usageText(row('2026-10-01', 'opus-high', '최종 코드 리뷰', 10, 'ok', 'm'))).all, tableKindSet(r.cells)), []);
  });

  it('시험 표시와 고정 표시가 한 칸에 같이 있어도 이름이 맞게 읽힌다', () => {
    const r = parseRoutingTable(table('| **Opus** | | | 최종 코드 리뷰 「(고정)」 「(시험: 다음 1건 `opus-medium`)」, 올라온 일 「(시험: 다음 1건 `opus-low`)」 「(고정)」 | |'));
    const high = r.cells.find((c) => c.effort === 'high');
    assert.deepEqual(high.kinds, ['최종 코드 리뷰', '올라온 일']);
    assert.deepEqual(high.pinned, ['최종 코드 리뷰', '올라온 일']);
  });

  it('낫표 없이 (고정)만 붙여도 이름에서 떼고 고정 칸으로 읽는다', () => {
    const r = parseRoutingTable(table('| **Opus** | | | 최종 코드 리뷰 (고정), 원인 찾기(이슈 분석, 수정 포함) (고정), 올라온 일, 「무조건 Opus」 영역 구현(고정) | |'));
    const high = r.cells.find((c) => c.effort === 'high');
    assert.deepEqual(high.kinds, ['최종 코드 리뷰', '원인 찾기', '올라온 일', '「무조건 Opus」 영역 구현']);
    assert.deepEqual(high.pinned, ['최종 코드 리뷰', '원인 찾기', '「무조건 Opus」 영역 구현']);
  });

  it('낫표가 있는 고정 표시와 없는 고정 표시가 같은 결과를 낸다', () => {
    const withMark = parseRoutingTable(table('| **Opus** | | | 최종 코드 리뷰 「(고정)」 | |'));
    const bare = parseRoutingTable(table('| **Opus** | | | 최종 코드 리뷰 (고정) | |'));
    assert.deepEqual(bare.cells, withMark.cells);
    assert.deepEqual([...pinnedCellSet(bare.cells)], ['opus-high\0최종 코드 리뷰']);
  });

  it('(고정)이 아닌 괄호 부연은 고정으로 읽지 않는다', () => {
    const r = parseRoutingTable(table('| **Opus** | | | 원인 찾기(고정 아님), 최종 코드 리뷰(고정 칸 검토) | |'));
    const high = r.cells.find((c) => c.effort === 'high');
    assert.deepEqual(high.kinds, ['원인 찾기', '최종 코드 리뷰']);
    assert.deepEqual(high.pinned, []);
  });

  it('낫표 없는 (시험: …)도 시험 표시로 읽어 이름에서 떼고 시험 정의를 짝짓는다', () => {
    const r = parseRoutingTable(table('| **Opus** | 조사 (시험: 다음 1건 `sonnet-high`), 가공 | | | |'));
    const low = r.cells.find((c) => c.model === 'opus' && c.effort === 'low');
    assert.deepEqual(low.kinds, ['조사', '가공']);
    assert.deepEqual(low.trials, [{ kind: '조사', def: 'sonnet-high' }]);
  });

  it('정의 이름이 없는 (시험: …) 괄호는 시험이 아니라 이름 뒤 부연으로만 본다', () => {
    const r = parseRoutingTable(table('| **Opus** | 조사(시험: 범위 확인용), 가공 | | | |'));
    const low = r.cells.find((c) => c.model === 'opus' && c.effort === 'low');
    assert.deepEqual(low.kinds, ['조사', '가공']);
    assert.deepEqual(low.trials, []);
  });

  it('표 위아래에 사용자 구역 표시 주석이 있어도 표와 일 이름이 같게 읽힌다', () => {
    const rows = ['| **Haiku** | 시험 실행 | 파일 탐색 | | |', '| **Opus** | | | 최종 코드 리뷰 「(고정)」 | |'];
    const marked = ['설명 문단', '', '<!-- 사용자 표 시작 -->', table(...rows), '<!-- 사용자 표 끝 -->', '', '<!-- 무조건 Opus 시작 -->', '- DB 스키마 변경', '<!-- 무조건 Opus 끝 -->'].join('\n');
    const r = parseRoutingTable(marked);
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.cells, parseRoutingTable(table(...rows)).cells);
    assert.deepEqual([...tableKindSet(r.cells)].sort(), ['시험 실행', '최종 코드 리뷰', '파일 탐색']);
  });

  it('빈 칸은 일 이름이 없는 칸으로 남는다', () => {
    const r = parseRoutingTable(table('| **Haiku** | 시험 실행 | | | |'));
    assert.equal(r.cells.length, 4);
    assert.deepEqual(r.cells.find((c) => c.effort === 'xhigh').kinds, []);
    assert.deepEqual([...tableKindSet(r.cells)], ['시험 실행']);
  });

  it('표가 없거나 줄의 칸 수가 다르면 까닭을 problems에 담는다', () => {
    assert.equal(parseRoutingTable('표 없음').problems.length, 1);
    const r = parseRoutingTable(table('| **Haiku** | 하나 | 둘 |'));
    assert.ok(r.problems.some((p) => p.includes('칸 수')));
    assert.ok(r.problems.some((p) => p.includes('모델 줄이 없습니다')));
  });

  it('실제 GUIDE의 표를 읽으면 문제가 없고 일 이름이 하나 이상 나온다', async () => {
    const fs = await import('node:fs');
    const { GUIDE_FILE } = await import('../claudeProjectPaths.js');
    const r = parseRoutingTable(fs.readFileSync(GUIDE_FILE, 'utf8'));
    assert.deepEqual(r.problems, []);
    assert.ok(tableKindSet(r.cells).size > 0);
  });
});

describe('표에 없는 일 종류', () => {
  const known = new Set(['구현']);
  const rows = parseUsage(
    usageText(
      row('2026-10-01', 'sonnet-medium', '구현', 10, 'ok', 'a1'),
      row('2026-10-02', 'sonnet-medium', '스크립트 작성', 10, 'ok', 'a2'),
      row('2026-10-03', 'sonnet-high', '스크립트 작성', 10, '올림', 'a3'),
      row('2026-10-05', 'opus-low', '번역', 10, 'ok', 'a4')
    )
  ).all;

  it('이름이 표와 같지 않은 기록만 일 이름별 건수와 마지막 날짜로 낸다', () => {
    assert.deepEqual(unknownKindNames(rows, known), [
      { kind: '스크립트 작성', count: 2, last: '2026-10-03' },
      { kind: '번역', count: 1, last: '2026-10-05' },
    ]);
  });

  it('묶음 집계는 정의별 건수와 결과와 정정을 일 이름 하나로 합친다', () => {
    const s = summarize(rows, new Map(), new Map([['a3', 1]]));
    const g = unknownKindGroups(s.rows, known);
    assert.equal(g.length, 2);
    partialEqual(g[0], { kind: '스크립트 작성', count: 2, ok: 1, up: 1, corrections: 1 });
    assert.deepEqual([...g[0].defs], [['sonnet-high', 1], ['sonnet-medium', 1]]);
  });
});

const snoozeRow = () => ['미룸', '-', '미룸', '2026-10-12T00:00:00.000Z', '-', '-', '-', '-', '-'].join('\t');
const dataRows = (n, from = 0) => Array.from({ length: n }, (_, i) => row('2026-10-10', 'sonnet-medium', '구현', 10, 'ok', `a${from + i}`));
const due = (...lines) => retroDue(parseUsage(usageText(...lines)));

const retroMarks = (k) => Array.from({ length: k }, () => boundaryRow('2026-10-11T00:00:00.000Z', '-', 'm'));
const dueAfterRetros = (k, ...lines) => due(...retroMarks(k), ...lines);

describe('retroDue 회고를 물을 때', () => {
  it('첫 회고 전에는 기준이 30건이라 29줄은 wait 1, 30줄은 ask다', () => {
    partialEqual(due(...dataRows(29)), { status: 'wait', remaining: 1, count: 29, usageCount: 29, stable: false, threshold: 30 });
    assert.equal(due(...dataRows(30)).status, 'ask');
  });

  it('회고를 한 번 했으면 기준이 50건이다', () => {
    partialEqual(dueAfterRetros(1, ...dataRows(49)), { status: 'wait', remaining: 1, threshold: 50 });
    assert.equal(dueAfterRetros(1, ...dataRows(50)).status, 'ask');
  });

  it('회고를 두 번 이상 했으면 기준이 100건이고 더 늘지 않는다', () => {
    partialEqual(dueAfterRetros(2, ...dataRows(99)), { status: 'wait', remaining: 1, threshold: 100 });
    assert.equal(dueAfterRetros(2, ...dataRows(100)).status, 'ask');
    partialEqual(dueAfterRetros(5, ...dataRows(99)), { status: 'wait', threshold: 100 });
  });

  it('미룸 뒤 30건 단계는 15줄, 50건 단계는 20줄, 100건 단계는 20줄이 더 쌓이면 ask다', () => {
    const afterSnooze = (k, base, n) => dueAfterRetros(k, ...dataRows(base), snoozeRow(), ...dataRows(n, base));
    partialEqual(afterSnooze(0, 30, 14), { status: 'wait', remaining: 1, snoozeLines: 15 });
    assert.equal(afterSnooze(0, 30, 15).status, 'ask');
    partialEqual(afterSnooze(1, 50, 19), { status: 'wait', remaining: 1, snoozeLines: 20 });
    assert.equal(afterSnooze(1, 50, 20).status, 'ask');
    partialEqual(afterSnooze(2, 100, 19), { status: 'wait', remaining: 1, snoozeLines: 20 });
    assert.equal(afterSnooze(2, 100, 20).status, 'ask');
  });

  it('미룸 줄과 회고 줄은 줄 수에 넣지 않는다', () => {
    partialEqual(due(...dataRows(30), snoozeRow()), { status: 'wait', remaining: 15, count: 30, usageCount: 30, threshold: 30 });
    assert.equal(parseUsage(usageText(...dataRows(3), snoozeRow(), boundaryRow('2026-10-11T00:00:00.000Z', '4', 'm'))).target.length, 0);
  });

  it('미룬 뒤 회고하면 미룸은 무시하고 새 회고 뒤 기록으로 센다', () => {
    const lines = [...dataRows(30), snoozeRow(), ...dataRows(5, 30), boundaryRow('2026-10-12T00:00:00.000Z', '37', 'm')];
    partialEqual(due(...lines, ...dataRows(30, 200)), { status: 'wait', remaining: 20, count: 30, usageCount: 30, threshold: 50 });
    assert.equal(due(...lines, ...dataRows(50, 200)).status, 'ask');
  });

  it('미룬 뒤 다시 미루면 마지막 미룸 표시를 기준으로 한다', () => {
    const lines = [...dataRows(30), snoozeRow(), ...dataRows(15, 30), snoozeRow(), ...dataRows(14, 100)];
    assert.equal(due(...lines).remaining, 1);
    assert.equal(due(...lines, ...dataRows(1, 300)).status, 'ask');
  });

  it('retroStage는 회고 수와 표 안정으로 기준과 설명을 돌려준다', () => {
    partialEqual(retroStage([]), { retros: 0, threshold: 30, snoozeLines: 15, label: '첫 회고 기준 30건' });
    partialEqual(retroStage([3]), { retros: 1, threshold: 50, snoozeLines: 20, label: '회고 1번 뒤 기준 50건' });
    partialEqual(retroStage([3, 1]), { retros: 2, threshold: 100, label: '회고 2번 뒤 기준 100건' });
    partialEqual(retroStage([0, 0]), { retros: 2, stable: true, threshold: 200, snoozeLines: 20, label: '표 안정(기준 200건)' });
  });

  it('미룸 줄은 일 종류 집계 대상에서 빠진다', () => {
    const p = parseUsage(usageText(row('2026-10-01', 'sonnet-medium', '번역', 10, 'ok', 'a1'), snoozeRow()));
    assert.equal(p.all.length, 1);
    assert.deepEqual(unknownKindNames(p.all, new Set()), [{ kind: '번역', count: 1, last: '2026-10-01' }]);
    assert.equal(summarize(p.target, new Map(), new Map()).rows.length, 1);
    assert.equal(downCandidates(p.all, new Map()).length, 0);
  });

  it('건수 기준을 미루지 않은 미룸(건수 false) 뒤에는 기록이 쌓이지 않아도 건수 기준이 그대로 걸려, 건수가 차면 ask다', () => {
    const noCount = snoozeLine(new Date('2026-10-12T00:00:00.000Z'), { countSnoozed: false });
    partialEqual(due(...dataRows(10), noCount), { status: 'wait', remaining: 20 });
    assert.equal(due(...dataRows(30), noCount).status, 'ask');
  });

  it('snoozeLine은 9열이고 parseUsage가 미룸 표시로 읽는다', () => {
    const line = snoozeLine(new Date('2026-10-13T00:00:00.000Z'));
    assert.equal(line.split('\t').length, 9);
    assert.equal(parseUsage(line + '\n').snooze.line, 1);
  });
});

const upRows = (n, { def = 'sonnet-low', kind = '작은 수정', result = '올림', from = 0 } = {}) =>
  Array.from({ length: n }, (_, i) => row('2026-10-10', def, kind, 10, result, `u${def}-${kind.replace(/\s/g, '_')}-${from + i}`));
const snoozeWith = (ups, countSnoozed = true) => snoozeLine(new Date('2026-10-12T00:00:00.000Z'), { countSnoozed, ups });
const pile = (def, kind, count, total = count) => ({ def, kind, count, total });
const okRows = (n, from = 0) => upRows(n, { result: 'ok', from });

describe('retroDue 같은 칸에 올림이 쌓였을 때', () => {
  it('회고 뒤 같은 칸의 올림이 1건이면 wait, 2건이면 기록이 1줄뿐이어도 ask이고 그 칸이 upCells에 담긴다', () => {
    partialEqual(due(...upRows(1)), { status: 'wait', remaining: 29, upCells: [] });
    const r = due(...upRows(2));
    partialEqual(r, { status: 'ask', remaining: 0, byCount: false, count: 2, upCells: [pile('sonnet-low', '작은 수정', 2)] });
  });

  it('칸 기록 10건에 올림 2건(20%)이면 ask, 11건에 2건이면 wait다. 분모는 그 칸의 모든 결과 줄이다', () => {
    partialEqual(due(...okRows(8), ...upRows(2, { from: 20 })), { status: 'ask', upCells: [pile('sonnet-low', '작은 수정', 2, 10)] });
    partialEqual(due(...okRows(9), ...upRows(2, { from: 20 })), { status: 'wait', piles: [], upCells: [] });
    assert.equal(due(...okRows(7), ...upRows(1, { result: '재지시', from: 10 }), ...upRows(2, { from: 20 })).status, 'ask');
    assert.equal(due(...okRows(8), ...upRows(1, { result: '재지시', from: 10 }), ...upRows(2, { from: 20 })).status, 'wait');
  });

  it('분모는 회고 표(summarize와 upCandidates)가 쓰는 마지막 회고 뒤 기록과 같은 범위라 회고 앞의 기록은 분모에 넣지 않는다', () => {
    const lines = [...okRows(30), boundaryRow('2026-10-11T00:00:00.000Z', '31', 'm'), ...okRows(8, 100), ...upRows(2, { from: 200 })];
    const parsed = parseUsage(usageText(...lines));
    assert.deepEqual(upPiles(parsed.target), [pile('sonnet-low', '작은 수정', 2, 10)]);
    const s = summarize(parsed.target, new Map(), new Map());
    assert.deepEqual(upCandidates(s.rows).up.map((c) => [c.def, c.kind]), upPiles(parsed.target).map((c) => [c.def, c.kind]));
  });

  it('올릴 칸이 없는 opus-xhigh와 fable-high는 올림이 두 명 쌓여도 기록 건수 기준 전에는 wait이고 올리기 후보와 올림이 쌓인 칸에 들지 않는다', () => {
    for (const def of ['opus-xhigh', 'fable-high']) {
      const lines = upRows(2, { def, kind: '원인 찾기' });
      partialEqual(due(...lines), { status: 'wait', remaining: 28, byCount: false, piles: [], upCells: [] }, def);
      const p = parseUsage(usageText(...lines));
      assert.deepEqual(upPiles(p.target), [], def);
      assert.deepEqual(upCandidates(summarize(p.target, new Map(), new Map()).rows), { up: [], watch: [] }, def);
    }
  });

  it('올릴 칸이 있는 opus-high는 같은 올림 두 명으로 ask다', () => {
    partialEqual(due(...upRows(2, { def: 'opus-high', kind: '원인 찾기' })), { status: 'ask', upCells: [pile('opus-high', '원인 찾기', 2)] });
  });

  it('올림 칸이 올리기 후보와 같은 조건으로 골라진다(올림만 세는 점은 다름)', () => {
    for (const [ok, up] of [[0, 2], [8, 2], [9, 2], [3, 3], [20, 3], [13, 3], [14, 3]]) {
      const parsed = parseUsage(usageText(...okRows(ok), ...upRows(up, { from: 50 })));
      const a = upCandidates(summarize(parsed.target, new Map(), new Map()).rows).up.length;
      assert.equal(upPiles(parsed.target).length, a, `ok ${ok}, 올림 ${up}`);
    }
  });

  it('올림이 2건인 칸이 여럿이면 모두 upCells에 담고 건수가 많은 칸이 앞이다', () => {
    const r = due(...upRows(2), ...upRows(3, { def: 'opus-low', kind: '조사' }));
    assert.deepEqual(r.upCells, [pile('opus-low', '조사', 3), pile('sonnet-low', '작은 수정', 2)]);
  });

  it('다른 칸에 올림이 1건씩이면 wait다(정의가 다르거나 일 종류가 달라도 같은 칸이 아니다)', () => {
    assert.equal(due(...upRows(1), ...upRows(1, { def: 'sonnet-medium' }), ...upRows(1, { kind: '번역' })).status, 'wait');
  });

  it('재지시는 몇 건이어도 세지 않아 wait다', () => {
    assert.equal(due(...upRows(5, { result: '재지시' })).status, 'wait');
    assert.equal(due(...upRows(1), ...upRows(5, { result: '재지시', from: 10 })).status, 'wait');
  });

  it('회고 앞의 올림은 세지 않고, 회고 뒤에 쌓인 올림만 센다', () => {
    const lines = [...upRows(3), boundaryRow('2026-10-11T00:00:00.000Z', '4', 'm')];
    assert.equal(due(...lines).status, 'wait');
    assert.equal(due(...lines, ...upRows(1, { from: 10 })).status, 'wait');
    assert.equal(due(...lines, ...upRows(2, { from: 10 })).status, 'ask');
  });

  it('일 종류 뒤 괄호 부연이 달라도 회고 표와 같은 칸으로 센다', () => {
    assert.equal(due(...upRows(1, { kind: '작은 수정(원인 확정)' }), ...upRows(1, { kind: '작은 수정', from: 5 })).status, 'ask');
    assert.deepEqual(upPiles(parseUsage(usageText(...upRows(1, { kind: '작은 수정(a)' }), ...upRows(1, { from: 5 }))).target), [pile('sonnet-low', '작은 수정', 2)]);
  });

  it('올림 기준과 건수 기준이 함께 걸리면 byCount도 true다', () => {
    partialEqual(due(...dataRows(30), ...upRows(2)), { status: 'ask', byCount: true, upCells: [pile('sonnet-low', '작은 수정', 2)] });
  });

  it('올림 칸이 걸려도 wait 남은 줄은 건수 기준대로 계산된다(올림이 없는 칸의 wait는 그대로)', () => {
    partialEqual(due(...dataRows(10), ...upRows(1)), { status: 'wait', remaining: 19, byCount: false });
  });

  it('기준 건수 상수를 올리기 후보와 같은 UP_MIN_COUNT에서 가져온다', async () => {
    const { UP_MIN_COUNT } = await import('../subagentRetroHelpers.js');
    assert.equal(UP_MIN_COUNT, 2);
    assert.equal(upPiles(parseUsage(usageText(...upRows(UP_MIN_COUNT - 1))).target).length, 0);
    assert.equal(upPiles(parseUsage(usageText(...upRows(UP_MIN_COUNT))).target).length, 1);
  });
});

describe('미룸 줄과 올림 기준', () => {
  it('미룬 뒤 그 칸의 올림이 그대로면 wait이고, 1건 늘면 ask다', () => {
    const base = [...upRows(2), snoozeWith([pile('sonnet-low', '작은 수정', 2)])];
    partialEqual(due(...base), { status: 'wait', upCells: [] });
    assert.equal(due(...base, ...upRows(1, { from: 10 })).status, 'ask');
    assert.deepEqual(due(...base, ...upRows(1, { from: 10 })).upCells, [pile('sonnet-low', '작은 수정', 3)]);
  });

  it('미룬 칸과 다른 칸이 2건에 이르면 묻고, 미룬 칸은 계속 미룬다', () => {
    const base = [...upRows(2), snoozeWith([pile('sonnet-low', '작은 수정', 2)])];
    const r = due(...base, ...upRows(2, { def: 'opus-low', kind: '조사', from: 10 }));
    assert.equal(r.status, 'ask');
    assert.deepEqual(r.upCells, [pile('opus-low', '조사', 2)]);
    assert.equal(r.piles.length, 2);
  });

  it('미룬 뒤 올림이 1건 늘어도 비율이 20%에 못 미치면 묻지 않고, 칸 기록이 더 늘어도 비율을 채우는 때 묻는다', () => {
    const base = [...okRows(8), ...upRows(2, { from: 20 }), snoozeWith([pile('sonnet-low', '작은 수정', 2)])];
    assert.equal(due(...base).status, 'wait');
    const diluted = [...base, ...okRows(12, 100), ...upRows(1, { from: 40 })];
    partialEqual(due(...diluted), { status: 'wait', upCells: [] });
    assert.equal(due(...diluted, ...upRows(3, { from: 60 })).status, 'ask');
    assert.deepEqual(due(...diluted, ...upRows(3, { from: 60 })).upCells, [pile('sonnet-low', '작은 수정', 6, 26)]);
  });

  it('미룬 칸이 아직 1건이었다면 올림이 2건에 이르는 때 묻는다', () => {
    const base = [...upRows(1), snoozeWith([])];
    assert.equal(due(...base).status, 'wait');
    assert.equal(due(...base, ...upRows(1, { from: 10 })).status, 'ask');
  });

  it('옛 형식 미룸 줄(칸 정보 없음)은 오류 없이 건수 기준 미룸으로만 동작한다', () => {
    partialEqual(due(...dataRows(30), snoozeRow()), { status: 'wait', remaining: 15 });
    partialEqual(due(...dataRows(30), snoozeRow(), ...dataRows(15, 30)), { status: 'ask', byCount: true });
    const snooze = parseUsage(usageText(snoozeRow())).snooze;
    assert.equal(snooze.count, true);
    assert.equal(snooze.ups.size, 0);
  });

  it('옛 형식 미룸 줄은 올림 기준을 미루지 않아 쌓인 칸이 있으면 바로 ask다', () => {
    assert.equal(due(...dataRows(30), ...upRows(2), snoozeRow()).status, 'ask');
  });

  it('메모 칸이 JSON이 아니거나 모양이 틀린 미룸 줄도 옛 형식처럼 읽는다', () => {
    for (const memo of ['-', '', '아무 글', '5', 'null', '{"올림":[null]}', '{"올림":"x"}']) {
      const line = ['미룸', '-', '미룸', '2026-10-12T00:00:00.000Z', '-', '-', '-', '-', memo].join('\t');
      const s = parseUsage(usageText(line)).snooze;
      assert.equal(s.count, true, memo);
      assert.equal(s.ups.size, 0, memo);
    }
  });

  it('건수 기준과 올림 기준이 함께 걸린 때 미룸 줄 하나로 둘 다 미룬다', () => {
    const lines = [...dataRows(30), ...upRows(2)];
    assert.equal(due(...lines).status, 'ask');
    const snoozed = [...lines, snoozeWith([pile('sonnet-low', '작은 수정', 2)])];
    partialEqual(due(...snoozed), { status: 'wait', remaining: 15 });
    assert.equal(due(...snoozed, ...dataRows(14, 100)).status, 'wait');
    assert.equal(due(...snoozed, ...dataRows(15, 100)).status, 'ask');
    partialEqual(due(...snoozed, ...upRows(1, { from: 10 })), { status: 'ask', byCount: false, upCells: [pile('sonnet-low', '작은 수정', 3)] });
  });

  it('올림만 걸려 미룬 줄(건수 기준 미룸 아님)은 건수 기준이 차면 미룬 줄 수와 상관없이 ask다', () => {
    const snoozed = [...dataRows(10), ...upRows(2), snoozeWith([pile('sonnet-low', '작은 수정', 2)], false)];
    assert.equal(due(...snoozed).status, 'wait');
    assert.equal(due(...snoozed, ...dataRows(18, 100)).status, 'ask');
  });

  it('snoozeLine은 평범한 미룸이면 옛 줄과 같은 9열이고, 칸 정보가 있으면 메모 칸에 JSON으로 담아 탭이 섞이지 않는다', () => {
    const at = new Date('2026-10-13T00:00:00.000Z');
    assert.equal(snoozeLine(at), ['미룸', '-', '미룸', '2026-10-13T00:00:00.000Z', '-', '-', '-', '-', '-'].join('\t'));
    const line = snoozeLine(at, { ups: [pile('sonnet-low', '탭\t있는 "일"', 2)] });
    assert.equal(line.split('\t').length, 9);
    const s = parseUsage(line + '\n').snooze;
    assert.equal(s.ups.get('sonnet-low\u0000탭\t있는 "일"'), 2);
    assert.equal(snoozeLine(at, { countSnoozed: false }).split('\t')[8].includes('"건수":false'), true);
  });
});

const RATES_JSON = {
  _source: 'https://example.invalid',
  _checked: '2026-10',
  'claude-sonnet-5-5': { input: 2, write5m: 2.5, write1h: 4, cacheRead: 0.1, output: 10 },
  'claude-haiku-5-5': {
    input: 0.1, write5m: 0.125, write1h: 0.2, cacheRead: 0.01, output: 0.5,
    longPrompt: { over: 100000, input: 0.5, write5m: 0.625, write1h: 1, cacheRead: 0.05, output: 2.5 },
  },
};

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-cost-test-'));
const ratesFile = (dir, content) => {
  const f = path.join(dir, 'rates.json');
  fs.writeFileSync(f, typeof content === 'string' ? content : JSON.stringify(content));
  return f;
};

const assistantLine = (model, usage, requestId, timestamp = '2026-10-11T01:00:00.000Z') =>
  JSON.stringify({ type: 'assistant', requestId, timestamp, message: { model, usage } });
const usage = (input, output, read = 0, write = 0) => ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: read, cache_creation_input_tokens: write });
const ZERO = usage(0, 0);

function writeTranscript(dir, agentId, lines) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `agent-${agentId}.jsonl`);
  fs.writeFileSync(file, lines.join('\n') + '\n');
  return file;
}

describe('rates.json 읽기', () => {
  it('_로 시작하는 키는 모델로 보지 않는다', () => {
    const { rates, error } = loadRates(ratesFile(tmpDir(), RATES_JSON));
    assert.equal(error, null);
    assert.deepEqual(Object.keys(rates), ['claude-sonnet-5-5', 'claude-haiku-5-5']);
  });

  it('파일이 없으면 예외 없이 rates가 null이고 모든 비용이 모름이다', () => {
    const { rates, error } = loadRates(path.join(tmpDir(), 'none.json'));
    assert.equal(rates, null);
    assert.ok(error);
    const counts = [{ model: 'claude-sonnet-5-5', input: 1, write5m: 0, write1h: 0, read: 0, output: 1 }];
    assert.equal(sumCost(counts, rates), null);
    assert.deepEqual(unknownModels(counts, rates), []);
  });

  it('JSON이 깨졌거나 객체가 아니면 예외 없이 rates가 null이다', () => {
    for (const bad of ['{ 깨짐', '[1,2]', 'null']) {
      const { rates, error } = loadRates(ratesFile(tmpDir(), bad));
      assert.equal(rates, null, bad);
      assert.ok(error, bad);
    }
  });

  it('요율 숫자가 빠진 모델은 표에 없는 모델로 본다', () => {
    const { rates } = loadRates(ratesFile(tmpDir(), { 'claude-x': { input: 1 }, 'claude-sonnet-5-5': RATES_JSON['claude-sonnet-5-5'] }));
    assert.deepEqual(Object.keys(rates), ['claude-sonnet-5-5']);
  });
});

describe('비용 계산', () => {
  const { rates } = loadRates(ratesFile(tmpDir(), RATES_JSON));
  const c = (model, input, output, read = 0) => ({ model, input, write5m: 0, write1h: 0, read, output });

  it('요율표 값으로 100만 토큰당 달러를 계산한다', () => {
    assert.equal(costOf(c('claude-sonnet-5-5', 1e6, 1e6), rates), 12);
  });

  it('프롬프트가 over를 넘는 요청은 longPrompt 요율로 계산한다', () => {
    assert.equal(costOf(c('claude-haiku-5-5', 0, 1e6, 100001), rates), (100001 * 0.05 + 1e6 * 2.5) / 1e6);
    assert.equal(costOf(c('claude-haiku-5-5', 0, 1e6, 100000), rates), (100000 * 0.01 + 1e6 * 0.5) / 1e6);
  });

  it('모델 ID에 문맥 창이나 날짜 꼬리가 붙어도 꼬리를 뗀 요율로 계산한다', () => {
    const base = costOf(c('claude-sonnet-5-5', 1e6, 1e6), rates);
    for (const tailed of ['claude-sonnet-5-5[1m]', 'claude-sonnet-5-5-20261001', 'claude-sonnet-5-5-20261001[1m]']) {
      assert.equal(costOf(c(tailed, 1e6, 1e6), rates), base, tailed);
    }
    assert.deepEqual(unknownModels([c('claude-sonnet-5-5[1m]', 1, 1)], rates), []);
  });

  it('요율표에 꼬리가 붙은 키가 있어도 쓰지 않고 꼬리를 뗀 이름의 요율만 쓴다', () => {
    const tailedKey = { ...rates, 'claude-sonnet-5-5[1m]': { input: 100, write5m: 0, write1h: 0, cacheRead: 0, output: 0 } };
    assert.equal(costOf(c('claude-sonnet-5-5[1m]', 1e6, 0), tailedKey), 2);
    const onlyTailed = { 'claude-sonnet-5-5[1m]': tailedKey['claude-sonnet-5-5[1m]'] };
    assert.equal(costOf(c('claude-sonnet-5-5[1m]', 1e6, 0), onlyTailed), null);
  });

  it('꼬리를 떼도 표에 없는 모델은 모름으로 남고, 꼬리가 다른 ID 둘도 요율표 키로 쓸 이름 하나로 나온다', () => {
    const list = [c('claude-new-9[1m]', 1, 1), c('claude-new-9-20261001', 1, 1), c('claude-new-9', 1, 1)];
    assert.equal(sumCost(list, rates), null);
    assert.deepEqual(unknownModels(list, rates), ['claude-new-9']);
  });

  it('공급자 접두사가 붙은 ID는 접두사를 그대로 두고 꼬리만 뗀 이름으로 나오며, 그 이름을 키로 넣으면 비용이 계산된다', () => {
    const list = [c('us.anthropic.claude-new-9-20261001[1m]', 1e6, 0)];
    const [name] = unknownModels(list, rates);
    assert.equal(name, 'us.anthropic.claude-new-9');
    const withKey = { ...rates, [name]: { input: 3, write5m: 0, write1h: 0, cacheRead: 0, output: 0 } };
    assert.equal(sumCost(list, withKey), 3);
    assert.deepEqual(unknownModels(list, withKey), []);
  });

  it('모델이 없는 요청은 예외 없이 모름이다', () => {
    assert.equal(costOf(c(undefined, 1, 1), rates), null);
  });

  it('모르는 모델이 요청 하나에라도 있으면 에이전트 비용은 모름이고 그 모델 이름이 나온다', () => {
    const list = [c('claude-sonnet-5-5', 10, 10), c('claude-new-9', 10, 10), c('claude-new-9', 5, 5)];
    assert.equal(sumCost(list, rates), null);
    assert.deepEqual(unknownModels(list, rates), ['claude-new-9']);
  });
});

describe('사용량 0 줄', () => {
  const { rates } = loadRates(ratesFile(tmpDir(), RATES_JSON));

  it('<synthetic> 사용량 0 줄이 섞여도 비용이 나오고 요청 수와 모델 판정에서 빠진다', () => {
    const dir = tmpDir();
    const file = writeTranscript(dir, 'a1', [
      assistantLine('claude-sonnet-5-5', usage(1000, 500), 'r1'),
      assistantLine('<synthetic>', ZERO, 'r2', '2026-10-11T01:00:05.000Z'),
    ]);
    const a = collectAgent(file, 'x', rates);
    assert.equal(a.requests, 1);
    assert.equal(a.model, 'claude-sonnet-5-5');
    assert.equal(a.cost, (1000 * 2 + 500 * 10) / 1e6);
    assert.deepEqual(a.unknown, []);
  });

  it('대화 기록의 모델 ID에 꼬리가 붙어도 비용이 나오고 요율표에 없는 모델로 세지 않는다', () => {
    const file = writeTranscript(tmpDir(), 'a2', [assistantLine('claude-sonnet-5-5[1m]', usage(1000, 500), 'r1')]);
    const a = collectAgent(file, 'x', rates);
    assert.equal(a.cost, (1000 * 2 + 500 * 10) / 1e6);
    assert.deepEqual(a.unknown, []);
  });

  it('사용량이 하나라도 있으면 모델이 표에 없을 때 모름으로 센다', () => {
    const lines = [{ type: 'assistant', requestId: 'r', message: { model: '<synthetic>', usage: usage(0, 1) } }];
    assert.equal(lastLinePerRequest(lines).length, 1);
    assert.deepEqual(unknownModels(lastLinePerRequest(lines).map(toCounts), rates), ['<synthetic>']);
  });

  it('줄이 모두 사용량 0이면 에이전트 줄을 만들지 않는다', () => {
    const file = writeTranscript(tmpDir(), 'a1', [assistantLine('<synthetic>', ZERO, 'r1')]);
    assert.equal(collectAgent(file, 'x', rates), null);
  });
});

describe('비용 모름 회고 집계', () => {
  const costLine = (id, model, cell, date = '2026-10-11') => [date, 'proj', 'sess', id, 'sonnet-high', model, 'high', 'd', 1, 2, 3, 4, 5, 60, cell].join('\t');
  const costMap = parseCost([[COST_HEADER, costLine('k1', 'claude-sonnet-5-5', '1.0'), costLine('k2', 'claude-sonnet-5-5', '3.0'), costLine('u1', 'claude-new-9', '?:claude-new-9'), costLine('u2', 'claude-new-9', '?:claude-new-9,claude-newer-1'), costLine('u3', 'claude-sonnet-5-5', '?')].join('\n')]);
  const usageRows = ['k1', 'k2', 'u1', 'u2', 'u3'].map((id) => row('2026-10-11', 'sonnet-high', '구현', 10, 'ok', `${id} 메모`));
  const { target } = parseUsage(usageText(...usageRows));

  it('비용을 모르는 건은 합계와 평균에서 빠지고 건수와 짝지은 수에는 들어가며 비용 모름 건수로 센다', () => {
    const s = summarize(target, costMap, new Map());
    partialEqual(s.rows[0], { count: 5, paired: 5, costKnown: 2, costUnknown: 3, costSum: 4.0, costAvg: 2.0 });
    partialEqual(s.total, { count: 5, costUnknown: 3, costSum: 4.0, costAvg: 2.0 });
  });

  it('비용이 전부 모름인 칸은 평균이 null이고 0달러로 세지 않는다', () => {
    const { target: t } = parseUsage(usageText(row('2026-10-11', 'sonnet-high', '구현', 10, 'ok', 'u1')));
    const s = summarize(t, costMap, new Map());
    partialEqual(s.rows[0], { count: 1, costKnown: 0, costUnknown: 1, costSum: 0, costAvg: null });
  });

  it('요율표에 없는 모델을 에이전트 수와 함께 세고 이름 없는 모름은 따로 센다', () => {
    assert.deepEqual(unknownModelSummary(costMap), {
      models: [{ model: 'claude-new-9', count: 2 }, { model: 'claude-newer-1', count: 1 }],
      unnamed: 1,
    });
  });

  it('옛 기록의 꼬리 붙은 이름과 꼬리 뗀 이름은 한 모델로 합쳐 세고, 한 에이전트에 둘이 함께 있어도 한 번만 센다', () => {
    const old = parseCost([[COST_HEADER, costLine('o1', 'claude-new-9', '?:claude-new-9[1m]'), costLine('o2', 'claude-new-9', '?:claude-new-9'), costLine('o3', 'claude-new-9', '?:claude-new-9[1m],claude-new-9-20261001')].join('\n')]);
    assert.deepEqual(unknownModelSummary(old), { models: [{ model: 'claude-new-9', count: 3 }], unnamed: 0 });
  });

  it('모르는 모델이 없으면 모델 목록이 비어 있다', () => {
    assert.deepEqual(unknownModelSummary(parseCost([[COST_HEADER, costLine('k1', 'claude-sonnet-5-5', '1.0')].join('\n')])), { models: [], unnamed: 0 });
  });

  it('표에 없는 일 종류 묶음도 비용 모름을 센다', () => {
    const s = summarize(target, costMap, new Map());
    const g = unknownKindGroups(s.rows, new Set());
    partialEqual(g[0], { count: 5, costKnown: 2, costUnknown: 3, costSum: 4.0 });
  });
});

describe('다시 계산', () => {
  const header = ['날짜', '프로젝트', '세션', 'agentId', '정의', '모델', 'effort', '설명', '입력', '캐시 쓰기', '캐시 읽기', '출력', '요청 수', '걸린 초', '어림 비용($)'].join('\t');
  const line = (id, requests, cell, session = 'sess1') => ['2026-10-11', 'proj', session, id, 'sonnet-high', 'claude-sonnet-5-5', 'high', 'd', 1, 2, 3, 4, requests, 5, cell].join('\t');
  const { rates } = loadRates(ratesFile(tmpDir(), RATES_JSON));

  it('? 줄은 세션 기록으로 채운 새 줄을 만들고, 기록이 없거나 아직 모르는 모델은 채우지 않는다', () => {
    const dir = tmpDir();
    const files = {
      fill: writeTranscript(dir, 'fill', [assistantLine('claude-sonnet-5-5', usage(1000, 500), 'r1'), assistantLine('<synthetic>', ZERO, 'r2')]),
      still: writeTranscript(dir, 'still', [assistantLine('claude-new-9', usage(10, 10), 'r1')]),
    };
    const text = [header, line('fill', 2, '?'), line('still', 1, '?'), line('gone', 1, '?'), line('ok', 1, '0.5')].join('\n');
    const r = recostRows(text, rates, (session, id) => files[id] ?? null);
    assert.equal(r.targets, 3);
    assert.equal(r.filled, 1);
    assert.deepEqual(r.missing, ['gone']);
    assert.deepEqual([...r.stillUnknown], [['claude-new-9', 1]]);
    assert.equal(r.lines.length, 2);
    const merged = parseCost([text, ...[r.lines.join('\n')].map((l) => header + '\n' + l)]);
    assert.equal(merged.get('fill').cost, (1000 * 2 + 500 * 10) / 1e6);
    assert.deepEqual(merged.get('still').unknownModels, ['claude-new-9']);
    assert.equal(merged.get('ok').cost, 0.5);
  });

  it('이미 이름까지 적힌 모름 줄은 다시 돌려도 같은 줄을 덧붙이지 않는다', () => {
    const dir = tmpDir();
    const file = writeTranscript(dir, 'still', [assistantLine('claude-new-9', usage(10, 10), 'r1')]);
    const text = [header, line('still', 1, '?:claude-new-9')].join('\n');
    assert.equal(recostRows(text, rates, () => file).lines.length, 0);
  });

  it('같은 agentId가 여러 줄이면 마지막 줄이 ?일 때만 대상이다', () => {
    const text = [header, line('a', 1, '?'), line('a', 2, '0.7')].join('\n');
    assert.equal(recostRows(text, rates, () => null).targets, 0);
  });
});

describe('projectRoot 경로 구분자', () => {
  it('POSIX 워크트리 경로는 `.claude/worktrees/<이름>` 꼬리를 뗀다', () => {
    assert.equal(projectRoot('/home/u/proj/.claude/worktrees/x'), '/home/u/proj');
    assert.equal(projectRoot('/home/u/proj/.claude/worktrees/x/src/app'), '/home/u/proj');
  });

  it('Windows 워크트리 경로(역슬래시)도 꼬리를 뗀다', () => {
    assert.equal(projectRoot('C:\\Users\\u\\proj\\.claude\\worktrees\\x'), 'C:\\Users\\u\\proj');
    assert.equal(projectRoot('C:\\Users\\u\\proj\\.claude\\worktrees\\x\\src\\app'), 'C:\\Users\\u\\proj');
  });

  it('슬래시와 역슬래시가 섞인 경로도 뗀다', () => {
    assert.equal(projectRoot('C:/Users/u/proj\\.claude\\worktrees/x'), 'C:/Users/u/proj');
  });

  it('워크트리가 아닌 경로는 그대로 둔다', () => {
    assert.equal(projectRoot('C:\\Users\\u\\proj'), 'C:\\Users\\u\\proj');
    assert.equal(projectRoot('/home/u/proj/.claude/other'), '/home/u/proj/.claude/other');
  });
});

describe('CRLF 파일 읽기', () => {
  const crlf = (...lines) => lines.join('\r\n') + '\r\n';

  it('사용 기록은 LF 파일과 같은 줄, 결과, 메모가 나온다(메모 끝에 \\r이 남지 않는다)', () => {
    const lines = [row('2026-10-09', 'sonnet-low', '번역', 30, 'ok', 'a1 메모'), boundaryRow('2026-10-10T00:00:00.000Z', '2', '경계 메모'), row('2026-10-11', 'sonnet-low', '번역', 40, '재지시', 'a2 끝 메모')];
    const lf = parseUsage(usageText(...lines));
    const cr = parseUsage(crlf(HEADER, ...lines));
    assert.deepEqual(cr, lf);
    assert.equal(cr.target[0].memo, 'a2 끝 메모');
    assert.equal(cr.boundary.memo, '경계 메모');
  });

  it('비용 기록은 마지막 열의 모름 모델 이름에 \\r이 붙지 않고 숫자도 같다', () => {
    const lines = [costRow('a1', 'sonnet-high', 'x', 10, 100, '1.5'), costRow('a2', 'sonnet-high', 'y', 3, 30, '?:claude-new-9,claude-newer-1')];
    assert.deepEqual(parseCost([crlf(COST_HEADER, ...lines)]), parseCost([[COST_HEADER, ...lines].join('\n')]));
    assert.deepEqual(parseCost([crlf(COST_HEADER, ...lines)]).get('a2').unknownModels, ['claude-new-9', 'claude-newer-1']);
  });

  it('정정 기록은 메시지 끝에 \\r이 붙지 않는다', () => {
    const header = ['날짜', '프로젝트', '세션', '시각', '대상', 'agentId', '정의', '일 종류', '이름표', '메시지'].join('\t');
    const line = ['2026-10-10', 'proj', 's1', 't', '서브에이전트', 'a1', 'sonnet-low', '번역', '범위 밖 수정', '아니'].join('\t');
    assert.equal(parseCorrections(crlf(header, line))[0].message, '아니');
  });

  it('다른 세션의 회고 경계 메모에도 \\r이 붙지 않는다', () => {
    const text = crlf(HEADER, row('2026-10-01', 'sonnet-medium', '구현', 10, 'ok', 'a'), boundaryRow('2026-10-11T00:00:00.000Z', '1', '다른 세션 메모'));
    assert.deepEqual(findLaterBoundary(text, 2), { line: 3, memo: '다른 세션 메모' });
  });

  it('모델 배정 표는 줄 끝이 CRLF여도 같은 칸이 나온다', () => {
    const lines = ['| | low | medium | high | xhigh |', '|:---|:---|:---|:---|:---|', '| **Haiku** | 시험 실행 | 탐색 | | |'];
    assert.deepEqual(parseRoutingTable(crlf(...lines)), parseRoutingTable(lines.join('\n')));
  });

  it('다시 계산은 CRLF 비용 기록의 이름까지 적힌 모름 줄에 같은 줄을 덧붙이지 않는다', () => {
    const header = ['날짜', '프로젝트', '세션', 'agentId', '정의', '모델', 'effort', '설명', '입력', '캐시 쓰기', '캐시 읽기', '출력', '요청 수', '걸린 초', '어림 비용($)'].join('\t');
    const line = ['2026-10-11', 'proj', 'sess1', 'still', 'sonnet-high', 'claude-sonnet-5-5', 'high', 'd', 1, 2, 3, 4, 1, 5, '?:claude-new-9'].join('\t');
    const file = writeTranscript(tmpDir(), 'still', [assistantLine('claude-new-9', usage(10, 10), 'r1')]);
    const { rates } = loadRates(ratesFile(tmpDir(), RATES_JSON));
    assert.equal(recostRows(crlf(header, line), rates, () => file).lines.length, 0);
  });

  it('세션 기록(jsonl)도 CRLF로 읽고 첫 cwd를 찾는다', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'a.jsonl');
    fs.writeFileSync(file, crlf(JSON.stringify({ type: 'user' }), JSON.stringify({ cwd: 'C:\\p', n: 1 }), JSON.stringify({ n: 2 })));
    assert.deepEqual(readJsonl(file).map((o) => o.n), [undefined, 1, 2]);
    assert.equal(sessionCwd(file), 'C:\\p');
  });
});

describe('extractSince', () => {
  const row = (d, def = 'sonnet-low') => [d, '/p', def, 'k', '-', '-', '1', 'ok', 'a1'].join('\t');
  const head = '날짜\t프로젝트\t정의\t일 종류\t-\t-\t초\t결과\t메모\n';

  it('회고 표시가 없으면 사용 기록에서 가장 이른 날짜의 로컬 0시를 시작으로 쓴다', () => {
    const r = extractSince(parseUsage(head + [row('2026-10-14'), row('2026-10-12'), '2026-10-01\t-\t미룸\t2026-10-01T00:00:00Z'].join('\n') + '\n'));
    assert.equal(r.source, 'firstUsage');
    assert.equal(r.at.getTime(), new Date(2026, 9, 12).getTime());
  });

  it('회고 표시가 있으면 표시 시각을 시작으로 쓴다', () => {
    const mark = ['회고', '-', '회고', '2026-10-13T03:00:00.000Z', '1', '-', '-', '-', 'm'].join('\t');
    const r = extractSince(parseUsage(head + row('2026-10-01') + '\n' + mark + '\n' + row('2026-10-14') + '\n'));
    assert.equal(r.source, 'boundary');
    assert.equal(r.at.toISOString(), '2026-10-13T03:00:00.000Z');
  });

  it('기록이 없으면 시작 시점 없이 전체를 뽑는다', () => {
    assert.deepEqual(extractSince(parseUsage('')), { at: null, source: 'none' });
  });
});

describe('retroDue 비용 기록 합산', () => {
  const costHeader = '날짜\t프로젝트\t세션\tagentId\t정의\t모델\teffort\t설명\t입력\t캐시 쓰기\t캐시 읽기\t출력\t요청 수\t걸린 초\t어림 비용($)';
  const costRow = (date, id) => [date, '/p', 's', id, 'sonnet-low', 'm', 'low', 'd', 1, 1, 1, 1, 1, 1, 0.1].join('\t');
  const costs = (n, { date = '2026-10-12', from = 0, prefix = 'c' } = {}) => Array.from({ length: n }, (_, i) => costRow(date, `${prefix}${from + i}`));
  const costMapOf = (...rows) => parseCost([[costHeader, ...rows].join('\n') + '\n']);
  const dueWith = (usage, cost) => retroDue(parseUsage(usageText(...usage)), { costMap: costMapOf(...cost) });

  it('사용 기록이 빠졌어도 비용 기록을 더해 30건이면 ask다', () => {
    assert.equal(dueWith(dataRows(10), costs(20)).status, 'ask');
    assert.equal(dueWith(dataRows(10), costs(19)).status, 'wait');
  });

  it('사용 기록과 비용 기록이 같은 서브에이전트를 가리키면 두 번 세지 않아 wait다', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `a${i}`);
    partialEqual(dueWith(dataRows(20), ids.map((id) => costRow('2026-10-10', id))), { status: 'wait', remaining: 10, count: 20, usageCount: 20, stable: false, threshold: 30 });
  });

  it('미룸 뒤 사용 기록에 없는 비용 기록만 15건이면 ask다', () => {
    const lines = [...dataRows(30), snoozeRow()];
    assert.equal(dueWith(lines, costs(14, { date: '2026-10-12', prefix: 'x' })).remaining, 1);
    assert.equal(dueWith(lines, costs(15, { date: '2026-10-12', prefix: 'x' })).status, 'ask');
  });

  it('회고 표시 날짜보다 앞선 날의 비용 기록은 세지 않는다', () => {
    // 경계 날짜는 로컬 날짜로 비교하므로 경계 시각도 로컬 0시로 만든다.
    const lines = [...dataRows(5), boundaryRow(new Date(2026, 9, 12).toISOString(), '5', 'm')];
    assert.equal(dueWith(lines, costs(100, { date: '2026-10-11' })).status, 'wait');
    assert.equal(dueWith(lines, costs(100, { date: '2026-10-12' })).status, 'ask');
  });

  it('비용 기록이 없으면 사용 기록 줄 수만으로 센다', () => {
    partialEqual(dueWith(dataRows(29), []), { status: 'wait', remaining: 1, count: 29, usageCount: 29, stable: false, threshold: 30 });
    assert.equal(retroDue(parseUsage(usageText(...dataRows(30)))).status, 'ask');
  });

  it('afork- 로 시작하는 포크는 맡긴 일이 아니라 세지 않는다', () => {
    assert.equal(dueWith([], costs(100, { prefix: 'afork-' })).status, 'wait');
  });
});

describe('checkRouting', () => {
  const table = (...rows) => ['| | low | medium | high | xhigh |', '|:---|:---|:---|:---|:---|', ...rows].join('\n');
  const guide = table(
    '| **Sonnet** | 번역, 요약 | 구현 | | |',
    '| **Opus** | 문서 작성 「(시험: 다음 1건 `sonnet-medium`)」, 구현 | 검토 | 원인 찾기 「(고정)」 | 다시 보내는 일 |'
  );
  const cells = parseRoutingTable(guide).cells;
  const desc = (...names) => `일반 성격 문장. ${names.join(', ')}. (\`~/.claude/subagent-system/docs/SUBAGENT_GUIDE.md\`)`;
  const okDescriptions = () =>
    new Map([
      ['sonnet-low', desc('번역', '요약')],
      ['sonnet-medium', desc('구현')],
      ['opus-low', desc('문서 작성', '구현')],
      ['opus-medium', desc('검토')],
      ['opus-high', desc('원인 찾기(이슈 분석)')],
      ['opus-xhigh', '다시 보낼 때만 쓰는 정의. 처음부터 부르지 않는다.'],
    ]);
  const usageOf = (...lines) => parseUsage(usageText(...lines)).all;
  const check = (usage, descriptions = okDescriptions()) => checkRouting({ cells, usage, descriptions });

  it('표 칸과 다른 정의로 보낸 기록을 일 종류와 정의별 건수와 마지막 날짜로 묶는다', () => {
    const r = check(usageOf(row('2026-10-01', 'opus-medium', '번역', 5, 'ok', 'a1'), row('2026-10-05', 'opus-medium', '번역', 5, 'ok', 'a2'), row('2026-10-03', 'opus-high', '번역', 5, 'ok', 'a3')));
    assert.deepEqual(r.mismatched, [
      { kind: '번역', def: 'opus-medium', expected: ['sonnet-low'], count: 2, last: '2026-10-05' },
      { kind: '번역', def: 'opus-high', expected: ['sonnet-low'], count: 1, last: '2026-10-03' },
    ]);
  });

  it('올림 줄과 시험 표시가 가리키는 정의와 opus-xhigh로 보낸 줄은 어긋남으로 세지 않는다', () => {
    const r = check(
      usageOf(
        row('2026-10-01', 'opus-low', '번역', 5, '올림', 'a1'),
        row('2026-10-01', 'sonnet-medium', '문서 작성', 5, 'ok', 'a2'),
        row('2026-10-01', 'opus-xhigh', '번역', 5, 'ok', 'a3')
      )
    );
    assert.deepEqual(r.mismatched, []);
  });

  it('시험 표시는 표시가 붙은 일에만 적용되고 같은 칸의 다른 일에는 적용되지 않는다', () => {
    const r = check(usageOf(row('2026-10-01', 'sonnet-medium', '구현', 5, 'ok', 'a1'), row('2026-10-01', 'sonnet-medium', '번역', 5, 'ok', 'a2')));
    assert.deepEqual(r.mismatched.map((g) => g.kind), ['번역']);
  });

  it('같은 일 이름이 표의 여러 칸에 있으면 그중 어느 칸 정의로 보내도 맞다', () => {
    const r = check(usageOf(row('2026-10-01', 'sonnet-medium', '구현', 5, 'ok', 'a1'), row('2026-10-01', 'opus-low', '구현', 5, 'ok', 'a2'), row('2026-10-01', 'opus-high', '구현', 5, 'ok', 'a3')));
    assert.deepEqual(r.mismatched.map((g) => g.def), ['opus-high']);
    assert.deepEqual(r.mismatched[0].expected.sort(), ['opus-low', 'sonnet-medium']);
  });

  it('표에 없는 일 종류는 이 검사 대상이 아니고 기록이 없으면(null) 건너뛴다', () => {
    assert.deepEqual(check(usageOf(row('2026-10-01', 'opus-high', '표에 없는 일', 5, 'ok', 'a1'))).mismatched, []);
    assert.deepEqual(check(null).mismatched, []);
  });

  it('description에 없는 칸 이름과 칸에 없는 description 이름을 각각 찾는다', () => {
    const d = okDescriptions();
    d.set('sonnet-low', desc('번역', '교정'));
    const r = check(null, d);
    assert.deepEqual(r.descriptionDiffs, [{ def: 'sonnet-low', missing: ['요약'], extra: ['교정'] }]);
  });

  it('description의 괄호 부연과 가이드 경로, 괄호 안 쉼표는 이름 비교에 영향을 주지 않는다', () => {
    assert.deepEqual(descriptionKinds(desc('원인 찾기(이슈 분석, 수정 포함)', '큰 diff의 검토')), { kinds: ['원인 찾기', '큰 diff의 검토'], split: true });
  });

  it('첫 문장 끝을 찾지 못하는 description은 나누지 않고 칸 이름이 문자열에 들어 있는지만 본다', () => {
    const d = okDescriptions();
    d.set('sonnet-low', '번역과 요약');
    d.set('sonnet-medium', '문장 하나뿐');
    const r = check(null, d);
    assert.deepEqual(descriptionKinds('번역과 요약'), { kinds: [], split: false });
    assert.deepEqual(r.descriptionDiffs, [{ def: 'sonnet-medium', missing: ['구현'], extra: [] }]);
    assert.deepEqual(r.loose, ['sonnet-low']);
  });

  it('fable-high로 보낸 줄은 정의 파일이 없어도 어긋남과 정의 파일 없음으로 세지 않는다', () => {
    const d = okDescriptions();
    assert.equal(d.has('fable-high'), false);
    const r = check(usageOf(row('2026-10-01', 'fable-high', '번역', 5, 'ok', 'a1'), row('2026-10-01', 'fable-high', '원인 찾기', 5, 'ok', 'a2')), d);
    assert.deepEqual(r.mismatched, []);
    assert.deepEqual(r.missingDefs, []);
    assert.deepEqual(r.descriptionDiffs, []);
  });

  it('removedDefs에 든 정의는 정의 파일이 없어도 정의 파일 없음으로 세지 않고, 든 이름만 뺀다', () => {
    const d = okDescriptions();
    d.delete('opus-medium');
    d.delete('sonnet-low');
    assert.deepEqual(checkRouting({ cells, usage: null, descriptions: d }).missingDefs.map((m) => m.def).sort(), ['opus-medium', 'sonnet-low']);
    assert.deepEqual(checkRouting({ cells, usage: null, descriptions: d, removedDefs: ['opus-medium'] }).missingDefs.map((m) => m.def), ['sonnet-low']);
  });

  it('removedDefs에 든 정의의 칸에 일이 있으면 removedConflicts에 정의와 일 이름이 담기고, 없는 정의 이름은 담기지 않는다', () => {
    const r = checkRouting({ cells, usage: null, descriptions: okDescriptions(), removedDefs: ['opus-medium', 'nothing-here'] });
    assert.deepEqual(r.removedConflicts.map((m) => m.def), ['opus-medium']);
    assert.ok(r.removedConflicts[0].kinds.length > 0);
    assert.deepEqual(checkRouting({ cells, usage: null, descriptions: okDescriptions() }).removedConflicts, []);
  });

  it('opus-xhigh의 description은 나열 비교를 하지 않는다', () => {
    const d = okDescriptions();
    d.set('opus-xhigh', '아무 문장. 전혀 다른 이름.');
    assert.deepEqual(check(null, d).descriptionDiffs, []);
  });

  it('칸에 일이 있는데 정의 파일이 없으면 그 칸을 돌려주고 일이 없는 칸은 보지 않는다', () => {
    const d = okDescriptions();
    d.set('opus-medium', null);
    d.delete('opus-high');
    const r = check(null, d);
    assert.deepEqual(r.missingDefs, [{ def: 'opus-medium', kinds: ['검토'] }, { def: 'opus-high', kinds: ['원인 찾기'] }]);
  });

  it('모두 맞으면 세 목록이 모두 비어 있다', () => {
    const r = check(usageOf(row('2026-10-01', 'sonnet-low', '번역', 5, 'ok', 'a1'), row('2026-10-01', 'opus-low', '구현', 5, 'ok', 'a2')));
    assert.deepEqual([r.mismatched, r.descriptionDiffs, r.missingDefs, r.loose], [[], [], [], []]);
  });
});

describe('descriptionOf', () => {
  it('한 줄 값과 따옴표와 접힌 여러 줄 값을 읽고 description이 없으면 빈 문자열이다', () => {
    assert.equal(descriptionOf('---\nname: a\ndescription: 한 줄. 이름.\nmodel: x\n---\n본문'), '한 줄. 이름.');
    assert.equal(descriptionOf('---\ndescription: "따옴표 값"\n---\n'), '따옴표 값');
    assert.equal(descriptionOf('---\ndescription: >\n  첫째 줄\n  둘째 줄\nmodel: x\n---\n'), '첫째 줄 둘째 줄');
    assert.equal(descriptionOf('---\nname: a\n---\n'), '');
    assert.equal(descriptionOf('머리 없음'), '');
  });
});

describe('parseRoutingTable 시험 표시', () => {
  it('시험 표시는 바로 앞 일 이름과 짝지어 trials로 돌아온다', () => {
    const r = parseRoutingTable(['| | low | medium | high | xhigh |', '|:---|:---|:---|:---|:---|', '| **Opus** | 조사 「(시험: 다음 1건 `opus-low`)」, 가공 | | | |'].join('\n'));
    assert.deepEqual(r.cells.find((c) => c.effort === 'low').trials, [{ kind: '조사', def: 'opus-low' }]);
  });
});

describe('표 안정 판정', () => {
  const retro = (n, changed) => ['회고', '-', '회고', '2026-10-1' + n + 'T00:00:00.000Z', '3', changed, '-', '-', 'm'].join('\t');
  const dueAfter = (...marks) => retroDue(parseUsage(usageText(...dataRows(2), ...marks, ...dataRows(150, 10))));

  it('바꾼 칸이 0인 회고가 두 번 이어지면 기준이 200건이다', () => {
    const r = dueAfter(retro(1, '0'), retro(2, '0'));
    partialEqual(r, { status: 'wait', remaining: 50, stable: true, threshold: 200 });
  });

  it('바꾼 칸이 0인 회고가 한 번이면 기준이 100건이다', () => {
    partialEqual(dueAfter(retro(1, '3'), retro(2, '0')), { status: 'ask', stable: false, threshold: 100 });
  });

  it('0, 0, 1이면 마지막 회고가 바꿨으므로 100건이다', () => {
    const r = dueAfter(retro(1, '0'), retro(2, '0'), retro(3, '1'));
    partialEqual(r, { stable: false, threshold: 100 });
  });

  it('1, 0, 0이면 마지막 두 번이 0이라 안정이다', () => {
    assert.equal(isStable(parseUsage(usageText(retro(1, '1'), retro(2, '0'), retro(3, '0'))).retroChanged), true);
  });

  it('바꾼 칸이 없는 옛 회고 표시가 끼면 안정으로 보지 않는다', () => {
    const r = dueAfter(retro(1, '0'), retro(2, '-'));
    partialEqual(r, { stable: false, threshold: 100 });
    assert.deepEqual(parseUsage(usageText(retro(1, '0'), retro(2, '-'))).retroChanged, [0, null]);
  });

  it('안정이어도 미룸 간격은 20줄이다', () => {
    const lines = [retro(1, '0'), retro(2, '0'), ...dataRows(200), snoozeRow(), ...dataRows(19, 200)];
    assert.equal(retroDue(parseUsage(usageText(...lines))).remaining, 1);
  });

  it('회고 표시 줄은 여섯째 열에 바꾼 칸 수를 담고 모르면 -를 담는다', () => {
    assert.equal(retroLine('2026-10-13T00:00:00.000Z', 7, 2, '메모'), ['회고', '-', '회고', '2026-10-13T00:00:00.000Z', 7, 2, '-', '-', '메모'].join('\t'));
    assert.equal(retroLine('2026-10-13T00:00:00.000Z', 7, null, '메모').split('\t')[5], '-');
    assert.equal(retroLine('x', 1, 0, 'm').split('\t').length, 9);
  });
});

describe('회고 방식 설정', () => {
  it('값이 auto일 때만 auto이고, 없거나 깨졌거나 모르는 값이면 ask이며 commandName은 기본 retro다', () => {
    assert.deepEqual(parseConfig('{"retroMode":"auto"}'), { retroMode: 'auto', commandName: 'retro', retroFailures: 0, removedDefs: [], removedKinds: [], claudeMdKeptLines: null, claudeMdLimitLines: 200, docReviewHashes: {}, autoApplyRules: true });
    assert.deepEqual(parseConfig('{"retroMode":"ask","commandName":"huigo","retroFailures":1}'), { retroMode: 'ask', commandName: 'huigo', retroFailures: 1, removedDefs: [], removedKinds: [], claudeMdKeptLines: null, claudeMdLimitLines: 200, docReviewHashes: {}, autoApplyRules: true });
    for (const text of [undefined, '', '{깨짐', 'null', '[]', '"auto"', '{"retroMode":"AUTO"}', '{}']) assert.equal(parseConfig(text).retroMode, 'ask', String(text));
  });

  it('autoApplyRules는 키가 없을 때만 true이고 값이 true가 아니면 false이며 파일이 없거나 깨졌어도 false다', () => {
    assert.equal(parseConfig('{}').autoApplyRules, true);
    assert.equal(parseConfig('{"autoApplyRules":true}').autoApplyRules, true);
    for (const bad of ['false', '"yes"', '0', 'null']) assert.equal(parseConfig(`{"autoApplyRules":${bad}}`).autoApplyRules, false, bad);
    for (const text of [undefined, '', '{깨짐', 'null', '[]']) assert.equal(parseConfig(text).autoApplyRules, false, String(text));
  });

  it('removedDefs는 문자열 배열만 읽고, 그 밖의 값이나 없는 키는 빈 배열이다', () => {
    assert.deepEqual(parseConfig('{"removedDefs":["haiku-high","opus-low"]}').removedDefs, ['haiku-high', 'opus-low']);
    assert.deepEqual(parseConfig('{"removedDefs":["a",5,null]}').removedDefs, ['a']);
    for (const bad of ['"x"', '5', 'null', '{}']) assert.deepEqual(parseConfig(`{"removedDefs":${bad}}`).removedDefs, [], bad);
    for (const text of [undefined, '', '{깨짐', '{}']) assert.deepEqual(parseConfig(text).removedDefs, [], String(text));
  });

  it('removedKinds는 문자열 배열만 읽고, 그 밖의 값이나 없는 키는 빈 배열이다', () => {
    assert.deepEqual(parseConfig('{"removedKinds":["번역","표 정리"]}').removedKinds, ['번역', '표 정리']);
    assert.deepEqual(parseConfig('{"removedKinds":["a",5,null]}').removedKinds, ['a']);
    for (const bad of ['"x"', '5', 'null', '{}']) assert.deepEqual(parseConfig(`{"removedKinds":${bad}}`).removedKinds, [], bad);
    for (const text of [undefined, '', '{깨짐', '{}']) assert.deepEqual(parseConfig(text).removedKinds, [], String(text));
  });

  it('removedKinds를 바꿔도 다른 키는 그대로이고, 빈 배열이면 키를 지우고, 깨진 파일은 null이며, 파일이 없으면 새로 쓴다', () => {
    const text = '{"retroMode":"auto","removedDefs":["haiku-high"],"removedKinds":["a"],"future":{"x":1}}';
    assert.deepEqual(JSON.parse(configTextWithRemovedKinds(text, ['a', 'b'])), { retroMode: 'auto', removedDefs: ['haiku-high'], future: { x: 1 }, removedKinds: ['a', 'b'] });
    assert.deepEqual(JSON.parse(configTextWithRemovedKinds(text, [])), { retroMode: 'auto', removedDefs: ['haiku-high'], future: { x: 1 } });
    assert.equal(configTextWithRemovedKinds('{깨짐', ['a']), null);
    assert.equal(configTextWithRemovedKinds('[1]', ['a']), null);
    assert.deepEqual(JSON.parse(configTextWithRemovedKinds('', ['a'])), { removedKinds: ['a'] });
  });

  it('kindNameOf는 고정 표시, 시험 표시, 최저선 표시, 괄호 부연을 떼고 표 칸의 이름과 같은 꼴로 만든다', () => {
    assert.equal(kindNameOf(' 수치 검증(다른 경로로 다시 계산) 「(고정)」 '), '수치 검증');
    assert.equal(kindNameOf('로그와   쿼리 결과 가공 「(시험: 다음 1건 `haiku-high`)」'), '로그와 쿼리 결과 가공');
    assert.equal(kindNameOf('번역 「(최저: `sonnet-low`)」'), '번역');
    assert.equal(kindNameOf('아래 「무조건 Opus」 영역 구현'), '아래 「무조건 Opus」 영역 구현');
    assert.equal(kindNameOf('()'), '');
  });

  it('모드와 연속 실패 횟수를 바꿔도 removedDefs와 모르는 키가 그대로 남는다', () => {
    const text = '{"retroMode":"ask","removedDefs":["haiku-high"],"future":{"a":1},"retroFailures":1}';
    assert.deepEqual(JSON.parse(configTextWithMode(text, 'auto')), { retroMode: 'auto', removedDefs: ['haiku-high'], future: { a: 1 } });
    assert.deepEqual(JSON.parse(configTextWithFailures(text, 2)), { retroMode: 'ask', removedDefs: ['haiku-high'], future: { a: 1 }, retroFailures: 2 });
    assert.deepEqual(JSON.parse(configTextWithFailures(text, 0)), { retroMode: 'ask', removedDefs: ['haiku-high'], future: { a: 1 } });
  });

  it('commandName이 경로나 공백이 섞인 이름이면 쓰지 않고 retro로 본다', () => {
    for (const bad of ['../x', 'a/b', 'a b', '', 'Retro', '.hidden', 5, null, 'x'.repeat(65)]) {
      assert.equal(parseConfig(JSON.stringify({ commandName: bad })).commandName, 'retro', String(bad));
    }
    assert.equal(parseConfig('{"commandName":"my-retro2"}').commandName, 'my-retro2');
  });

  it('모드를 바꿀 때 다른 키는 두고, 깨진 파일은 새로 쓰며, 끝에 줄바꿈이 있다', () => {
    const next = configTextWithMode('{"retroMode":"ask","commandName":"huigo","extra":1}', 'auto');
    assert.deepEqual(JSON.parse(next), { retroMode: 'auto', commandName: 'huigo', extra: 1 });
    assert.equal(next.endsWith('\n'), true);
    assert.deepEqual(JSON.parse(configTextWithMode('{깨짐', 'auto')), { retroMode: 'auto' });
    assert.deepEqual(JSON.parse(configTextWithMode('', 'ask')), { retroMode: 'ask' });
    assert.deepEqual(JSON.parse(configTextWithMode('[1]', 'ask')), { retroMode: 'ask' });
  });

  it('연속 실패 횟수는 자연수만 읽고, 모드를 바꾸면 사라지며, 횟수만 바꿀 때는 다른 키를 두고 0이면 키를 뺀다', () => {
    assert.equal(RETRO_FAIL_LIMIT, 2);
    for (const bad of ['"x"', '0', '-1', '1.5', 'null', '[]']) assert.equal(parseConfig(`{"retroFailures":${bad}}`).retroFailures, 0, bad);
    assert.equal(parseConfig('{"retroFailures":3}').retroFailures, 3);
    assert.deepEqual(JSON.parse(configTextWithMode('{"retroMode":"auto","retroFailures":1,"commandName":"h"}', 'auto')), { retroMode: 'auto', commandName: 'h' });
    assert.deepEqual(JSON.parse(configTextWithFailures('{"retroMode":"auto","commandName":"h"}', 1)), { retroMode: 'auto', commandName: 'h', retroFailures: 1 });
    assert.deepEqual(JSON.parse(configTextWithFailures('{"retroMode":"auto","retroFailures":1}', 0)), { retroMode: 'auto' });
  });
});

describe('회고 잠금과 물을 것 세기', () => {
  const NOW = 10 * LOCK_STALE_MS;

  it('잠금 시각이 없으면 none, 3시간 이내면 live, 3시간을 넘으면 stale이다', () => {
    assert.equal(lockState(null, NOW), 'none');
    assert.equal(lockState(undefined, NOW), 'none');
    assert.equal(lockState(NOW - 1000, NOW), 'live');
    assert.equal(lockState(NOW - LOCK_STALE_MS, NOW), 'live');
    assert.equal(lockState(NOW - LOCK_STALE_MS - 1, NOW), 'stale');
    assert.equal(LOCK_STALE_MS, 3 * 60 * 60 * 1000);
  });

  it('물을 것은 줄머리가 `## `이고 제목이 있는 줄만 센다', () => {
    assert.equal(countPending(undefined), 0);
    assert.equal(countPending(''), 0);
    assert.equal(countPending('# 제목\n\n## 하나\n내용 ## 둘\n### 셋\n##\n## \r\n## 넷\r\n'), 2);
  });
});

describe('dueHead', () => {
  const wait = { status: 'wait', remaining: 12 };
  const ask = { status: 'ask', remaining: 0 };

  it('auto 모드에서 ask가 될 때만 auto이고, 나머지는 기존 값 그대로다', () => {
    assert.equal(dueHead(ask, { mode: 'auto' }), 'auto');
    assert.equal(dueHead(ask, { mode: 'ask' }), 'ask');
    assert.equal(dueHead(ask), 'ask');
    assert.equal(dueHead(wait, { mode: 'auto' }), 'wait 12');
    assert.equal(dueHead(wait, { mode: 'ask' }), 'wait 12');
  });

  it('잠금이 살아 있으면 모드와 상관없이 wait이다', () => {
    assert.equal(dueHead(ask, { mode: 'auto', lockLive: true }), 'wait 0');
    assert.equal(dueHead(ask, { mode: 'ask', lockLive: true }), 'wait 0');
    assert.equal(dueHead(wait, { mode: 'auto', lockLive: true }), 'wait 12');
  });
});

describe('normalizeShape 같은 꼴 묶기', () => {
  it('숫자는 N으로 바뀌어 번호만 다른 문장이 같은 꼴이 된다', () => {
    assert.equal(normalizeShape('DOC-1234 문서 12건 3.5초'), normalizeShape('DOC-99 문서 7건 10.25초'));
    assert.equal(normalizeShape('DOC-1234 문서 12건'), 'doc-N 문서 N건');
  });

  it('절대 경로와 ~ 경로와 $HOME 경로는 <경로>가 되고 경로 속 숫자와 따옴표는 따로 잡히지 않는다', () => {
    assert.equal(normalizeShape('cat /Users/a/proj1/x.js'), 'cat <경로>');
    assert.equal(normalizeShape('cat ~/work/y.js'), 'cat <경로>');
    assert.equal(normalizeShape('cat $HOME/.claude/z.md'), 'cat <경로>');
    assert.equal(normalizeShape('cat C:\\Users\\a\\x.txt'), 'cat <경로>');
    assert.equal(normalizeShape('cat /a/b;rm /c|grep /d'), 'cat <경로>;rm <경로>|grep <경로>');
  });

  it('Windows 경로(슬래시 드라이브 경로, $env:, %VAR%)도 <경로>가 된다', () => {
    assert.equal(normalizeShape('cat C:/Users/a/proj1/x.js'), 'cat <경로>');
    assert.equal(normalizeShape('Get-Content $env:USERPROFILE\\work\\y.txt'), 'get-content <경로>');
    assert.equal(normalizeShape('Get-Content $env:USERPROFILE'), 'get-content <경로>');
    assert.equal(normalizeShape('type %USERPROFILE%\\work\\y.txt'), 'type <경로>');
    assert.equal(normalizeShape('type C:/a1/b;type %APPDATA%/c2'), 'type <경로>;type <경로>');
  });

  it('% 서식과 URL의 콜론 슬래시는 경로로 보지 않는다', () => {
    assert.equal(normalizeShape('date +%Y%m%d'), 'date +%y%m%d');
    assert.equal(normalizeShape('http://example.com/a'), 'http://example.com/a');
  });

  it('문장 가운데 슬래시(and/or, 및/또는, 날짜, URL)는 경로로 보지 않는다', () => {
    assert.equal(normalizeShape('and/or 및/또는'), 'and/or 및/또는');
    assert.equal(normalizeShape('2026/10/13'), 'N/N/N');
    assert.equal(normalizeShape('https://example.com/a/b'), 'https://example.com/a/b');
  });

  it('큰따옴표와 작은따옴표 안의 글은 <문자열>이 되고 영어 축약의 아포스트로피는 건드리지 않는다', () => {
    assert.equal(normalizeShape('run "a b 1" and \'c d\' now'), 'run <문자열> and <문자열> now');
    assert.equal(normalizeShape('don\'t stop, it\'s fine'), 'don\'t stop, it\'s fine');
    assert.equal(normalizeShape('echo "여러\n줄"'), 'echo <문자열>');
  });

  it('16진수 id와 UUID는 <id>가 되고 숫자만 긴 값이나 평범한 영단어는 id가 아니다', () => {
    assert.equal(normalizeShape('commit a1b2c3d4e5 on 123e4567-e89b-12d3-a456-426614174000'), 'commit <id> on <id>');
    assert.equal(normalizeShape('defaced 12345678'), 'defaced N');
  });

  it('연속 공백과 줄바꿈은 하나로 줄고 영문은 소문자가 된다', () => {
    assert.equal(normalizeShape('  Git   STATUS \n\t -S  '), 'git status -s');
  });

  it('같은 일을 다른 값으로 시킨 두 명령이 같은 꼴이 된다', () => {
    const a = normalizeShape('cd /p/a && npm test -- --grep "FooTest" 2>&1 | tail -30');
    const b = normalizeShape('cd /q/b && npm test -- --grep "BarTest" 2>&1 | tail -50');
    assert.equal(a, b);
  });
});

describe('isExcludedRepeat 반복에서 빼는 것', () => {
  it('키트 스크립트 호출은 다른 명령 뒤에 붙어 있어도 뺀다', () => {
    assert.equal(isExcludedRepeat('bash', 'node "$HOME/.claude/subagent-system/scripts/subagent-retro.js" --due'), true);
    assert.equal(isExcludedRepeat('bash', 'cd /p && node subagent-usage.js --recost'), true);
  });

  it('짧은 확인 명령은 cd가 앞에 붙어도 빼고, 다른 명령을 이은 것은 빼지 않는다', () => {
    for (const c of ['ls', 'ls -la /tmp', 'pwd', 'date', 'git status', 'git diff --stat', 'cd /p/a && git status', 'cd "/p a" ; ls']) assert.equal(isExcludedRepeat('bash', c), true, c);
    for (const c of ['git status | grep M', 'ls && rm -rf x', 'npm test', 'git commit -m "x"', 'node build.js']) assert.equal(isExcludedRepeat('bash', c), false, c);
  });

  it('10자 미만 메시지와 짧은 승인은 빼고 그 밖의 지시는 뺀다고 하지 않는다', () => {
    assert.equal(isExcludedRepeat('user', '테스트 돌려줘'), true);
    assert.equal(isExcludedRepeat('user', 'ㅇㅇ'), true);
    assert.equal(isExcludedRepeat('user', '그렇게 해'), true);
    assert.equal(isExcludedRepeat('user', '진행해줘 그리고 테스트도 돌려 주세요'), false);
    assert.equal(isExcludedRepeat('user', '이 문서 검토해 줘 초안 확인하고'), false);
  });

  it('Claude Code가 넣은 글(중단 알림, 명령 표시)은 사용자 지시가 아니라 뺀다', () => {
    assert.equal(isExcludedRepeat('user', '[Request interrupted by user for tool use]'), true);
    assert.equal(isExcludedRepeat('user', '<command-name>/retro</command-name> 이어서'), true);
  });

  it('Agent 지시문 줄은 짧아도 빼지 않는다', () => {
    assert.equal(isExcludedRepeat('agent', '리뷰'), false);
  });

  it('파일 하나를 읽기만 하는 명령(cat, head, tail, wc, sed -n)은 cd가 앞에 붙어도 뺀다', () => {
    for (const c of ['cat /p/a/x.md', 'cat src/x.js', 'head -n 20 /p/x.log', 'tail -50 /p/x.log', 'wc -l /p/x.js', "sed -n '1,40p' /p/x.js", 'cd /p/a && cat x.md']) assert.equal(isExcludedRepeat('bash', c), true, c);
  });

  it('파이프나 &&로 이은 묶음과 리다이렉션이 있는 명령은 파일을 읽는 명령이어도 빼지 않는다', () => {
    for (const c of ['cat /p/x.log | grep ERROR', 'head -5 /p/x | sort | uniq -c', 'cat /p/a.md && npm test', 'cd /p/a && cat x.md && npm test', 'cat > /p/x.txt', 'cat /p/x.txt > /p/y.txt', 'wc -l /p/x.js; rm /p/x.js', 'catalog build', 'sed -i s/a/b/ x.js']) assert.equal(isExcludedRepeat('bash', c), false, c);
  });
});

describe('extractRepeatItems', () => {
  const at = (day) => `2026-10-${String(day).padStart(2, '0')}T12:00:00.000Z`;
  const humanAt = (day, text) => ({ type: 'user', origin: { kind: 'human' }, timestamp: at(day), message: { content: text } });
  const toolUse = (day, id, name, input) => ({ type: 'assistant', timestamp: at(day), message: { content: [{ type: 'tool_use', id, name, input }] } });
  const toolResult = (id, content) => ({ type: 'user', timestamp: at(20), message: { content: [{ type: 'tool_result', tool_use_id: id, content }] } });

  it('사용자 메시지, Bash 명령, Agent 지시문 첫 줄을 각각 한 종류로 센다', () => {
    const items = extractRepeatItems([
      humanAt(10, '이 초안 검토해 줘 부탁해요'),
      toolUse(10, 'b', 'Bash', { command: 'npm test -- --watch=false' }),
      toolUse(10, 'a', 'Agent', { prompt: '첫 줄 지시\n둘째 줄', subagent_type: 'x' }),
    ], null);
    assert.deepEqual(items.map((i) => [i.kind, i.text]), [['user', '이 초안 검토해 줘 부탁해요'], ['bash', 'npm test -- --watch=false'], ['agent', '첫 줄 지시']]);
  });

  it('반복 찾기도 origin 없이 turnOrigin만 human인 사람 메시지를 세고 명령 출력은 세지 않는다', () => {
    const items = extractRepeatItems([
      { type: 'user', turnOrigin: 'human', timestamp: at(10), message: { content: '꼴만 다른 지시를 반복해서 합니다' } },
      { type: 'user', turnOrigin: 'human', timestamp: at(10), message: { content: '<bash-stdout>열 글자가 넘는 명령 출력입니다</bash-stdout>' } },
    ], null);
    assert.deepEqual(items.map((i) => [i.kind, i.text]), [['user', '꼴만 다른 지시를 반복해서 합니다']]);
  });

  it('Agent 지시문은 제목(#), 빈 줄, 구분선을 건너뛴 첫 내용 줄을 쓰고 내용이 없으면 세지 않는다', () => {
    const agentText = (prompt) => extractRepeatItems([toolUse(10, 'a', 'Agent', { prompt })], null).map((i) => i.text);
    assert.deepEqual(agentText('\n## 할 일\n\n---\n### 세부\n이 초안을 검토해 주세요\n둘째'), ['이 초안을 검토해 주세요']);
    assert.deepEqual(agentText('# 제목\n***\n=====\n   \n'), []);
    assert.deepEqual(agentText('## 할 일\n- 항목 하나'), ['- 항목 하나']);
  });

  it('같은 제목 아래 내용이 다른 Agent 지시문은 꼴이 달라 한 묶음이 되지 않는다', () => {
    const shapes = ['A 작업을 하세요', 'B 작업을 하세요'].map((body, i) => extractRepeatItems([toolUse(10, `a${i}`, 'Agent', { prompt: `## 할 일\n\n${body}` })], null)[0].shape);
    assert.notEqual(shapes[0], shapes[1]);
  });

  it('chars는 입력 글자 수에 같은 id의 도구 결과 글자 수(문자열과 text 블록 배열)를 더한 값이다', () => {
    const items = extractRepeatItems([
      toolUse(10, 'b', 'Bash', { command: 'npm test' }),
      toolResult('b', '12345'),
      toolResult('b', [{ type: 'text', text: 'abc' }, { type: 'image' }]),
      toolResult('other', 'xxxxxxxxxx'),
    ], null);
    assert.equal(items[0].chars, 'npm test'.length + 5 + 3);
  });

  it('since 앞의 메시지와 도구 호출은 세지 않고 경계와 같은 시각은 센다', () => {
    const since = new Date(at(10));
    const items = extractRepeatItems([
      humanAt(9, '옛날에 한 말입니다 아주 옛날'),
      toolUse(9, 'o', 'Bash', { command: 'npm run old' }),
      humanAt(10, '경계에 한 말입니다 딱 경계'),
      toolUse(11, 'n', 'Bash', { command: 'npm run new' }),
    ], since);
    assert.deepEqual(items.map((i) => i.text), ['경계에 한 말입니다 딱 경계', 'npm run new']);
  });

  it('사람이 친 것이 아닌 user 줄과 빼는 목록은 세지 않는다', () => {
    const items = extractRepeatItems([
      { type: 'user', origin: { kind: 'task-notification' }, timestamp: at(10), message: { content: '<task-notification>길게 쓴 알림입니다</task-notification>' } },
      humanAt(10, '응'),
      toolUse(10, 'k', 'Bash', { command: 'node subagent-retro.js --count' }),
      toolUse(10, 'g', 'Bash', { command: 'git status' }),
    ], null);
    assert.deepEqual(items, []);
  });
});

describe('rankRepeats 후보 기준', () => {
  const mk = (n, sessions, shape = 'npm test', kind = 'bash') =>
    Array.from({ length: n }, (_, i) => ({ kind, shape, text: shape, chars: 30, session: `s${i % sessions}`, project: `p${i % sessions}` }));

  it(`같은 꼴 ${REPEAT_MIN_COUNT}번에 세션 ${REPEAT_MIN_SESSIONS}개면 후보다`, () => {
    assert.equal(rankRepeats(mk(3, 2)).bash.length, 1);
  });

  it('3번이어도 세션이 1개면 후보가 아니다', () => {
    assert.equal(rankRepeats(mk(3, 1)).bash.length, 0);
  });

  it('세션이 2개여도 2번이면 후보가 아니다', () => {
    assert.equal(rankRepeats(mk(2, 2)).bash.length, 0);
  });

  it('종류가 다르면 같은 꼴이어도 따로 센다', () => {
    const r = rankRepeats([...mk(2, 2, 'x', 'bash'), ...mk(2, 2, 'x', 'user')]);
    assert.deepEqual([r.bash.length, r.user.length], [0, 0]);
  });

  it('횟수, 세션 수, 프로젝트 수, 어림 토큰(글자 수 합 / 3), 예시를 돌려준다', () => {
    const [row] = rankRepeats(mk(4, 2)).bash;
    assert.deepEqual(row, { shape: 'npm test', count: 4, sessions: 2, projects: 2, tokens: 40, example: 'npm test' });
  });

  it('횟수 많은 순으로 종류마다 top개까지만 돌려준다', () => {
    const items = [];
    for (let k = 0; k < REPEAT_TOP + 5; k++) items.push(...mk(3 + k, 2, `cmd${String(k).padStart(2, '0')}`));
    const list = rankRepeats(items).bash;
    assert.equal(list.length, REPEAT_TOP);
    assert.equal(list[0].count, 3 + REPEAT_TOP + 4);
    assert.ok(list.every((r, i) => i === 0 || list[i - 1].count >= r.count));
  });
});

const table3 = (...rows) => ['| | low | medium | high | xhigh |', '|:---|:---|:---|:---|:---|', ...rows].join('\n');
// 기록 끝(다섯째 열)은 그 표시 줄의 줄 번호로 채운다(@는 withCutoffs가 바꾼다). 실제 --mark도 추출 때의 줄 수를 적는다.
const snapRow = (n, cells, { trials = [], floors = [], changed = '0' } = {}) =>
  ['회고', '-', '회고', `2026-10-${String(10 + n).padStart(2, '0')}T00:00:00.000Z`, '@', changed, '-', JSON.stringify({ 칸: cells, 시험: trials, 최저: floors }), 'm'].join('\t');
// usageText의 머리줄이 1번 줄이라 i번째 줄은 i + 2번 줄이다.
const withCutoffs = (lines) => lines.map((l, i) => l.replace('\t@\t', `\t${i + 2}\t`));

describe('최저선 표시 읽기', () => {
  it('낫표가 있든 없든, 정의 이름에 백틱이 있든 없든 최저선을 일 이름과 짝지어 읽고 이름에서는 뺀다', () => {
    const { cells } = parseRoutingTable(table3('| **Sonnet** | 번역 「(최저: sonnet-low)」, 요약 (최저: `sonnet-medium`) | 구현 「(최저: `sonnet-medium`)」 | | |'));
    const low = cells.find((c) => c.model === 'sonnet' && c.effort === 'low');
    assert.deepEqual(low.kinds, ['번역', '요약']);
    assert.deepEqual(low.floors, [{ kind: '번역', def: 'sonnet-low' }, { kind: '요약', def: 'sonnet-medium' }]);
    assert.deepEqual([...floorMap(cells)], [['번역', 'sonnet-low'], ['요약', 'sonnet-medium'], ['구현', 'sonnet-medium']]);
  });

  it('최저선과 시험 표시와 고정 표시가 한 이름에 함께 있어도 모두 읽는다', () => {
    const { cells } = parseRoutingTable(table3('| **Opus** | 조사 「(최저: opus-low)」 「(시험: 다음 1건 `sonnet-high`)」 | 검토 「(고정)」 「(최저: opus-medium)」 | | |'));
    const low = cells.find((c) => c.effort === 'low');
    assert.deepEqual(low.kinds, ['조사']);
    assert.deepEqual(low.trials, [{ kind: '조사', def: 'sonnet-high' }]);
    assert.deepEqual(low.floors, [{ kind: '조사', def: 'opus-low' }]);
    const medium = cells.find((c) => c.effort === 'medium');
    assert.deepEqual(medium.pinned, ['검토']);
    assert.deepEqual(medium.floors, [{ kind: '검토', def: 'opus-medium' }]);
  });

  it('최저선이 붙은 칸도 정의 description의 일 이름과 같으면 --check의 description 비교에 걸리지 않는다', () => {
    const { cells } = parseRoutingTable(table3('| **Sonnet** | 번역 「(최저: sonnet-low)」 | | | |'));
    const r = checkRouting({ cells, usage: null, descriptions: new Map([['sonnet-low', '성격. 번역. (`g`)']]) });
    assert.deepEqual(r.descriptionDiffs, []);
  });

  it('사다리의 바로 아래와 바로 위는 low에서 모델을 건너뛴다', () => {
    assert.equal(lowerDef('sonnet-low'), 'haiku-high');
    assert.equal(lowerDef('opus-low'), 'sonnet-high');
    assert.equal(lowerDef('haiku-low'), null);
    assert.equal(upperDef('haiku-high'), 'sonnet-low');
    assert.equal(upperDef('sonnet-high'), 'opus-low');
    assert.equal(upperDef('opus-high'), 'opus-xhigh');
    assert.equal(upperDef('opus-xhigh'), null);
    assert.equal(upperDef('fable-high'), null);
    assert.equal(lowerDef('fable-high'), 'opus-xhigh');
  });
});

describe('최저선과 내려 보기 후보', () => {
  const fiveOf = (def, kind) => Array.from({ length: 5 }, (_, i) => row('2026-10-0' + (i + 1), def, kind, 10, 'ok', `${def}${i}`));

  it('바로 아래 칸이 최저선보다 아래이면 5건이 모두 ok여도 내려 보기 후보가 아니다', () => {
    const p = parseUsage(usageText(...fiveOf('sonnet-low', '번역')));
    assert.deepEqual(downCandidates(p.all, new Map(), new Set(), new Map([['번역', 'sonnet-low']])), []);
  });

  it('바로 아래 칸이 최저선과 같으면 최저선까지는 다시 내려 볼 수 있어 후보다', () => {
    const p = parseUsage(usageText(...fiveOf('sonnet-medium', '번역')));
    assert.deepEqual(downCandidates(p.all, new Map(), new Set(), new Map([['번역', 'sonnet-low']])), [{ def: 'sonnet-medium', kind: '번역' }]);
  });

  it('최저선은 다른 일 종류의 후보에 영향이 없다', () => {
    const p = parseUsage(usageText(...fiveOf('sonnet-low', '요약')));
    assert.deepEqual(downCandidates(p.all, new Map(), new Set(), new Map([['번역', 'sonnet-low']])), [{ def: 'sonnet-low', kind: '요약' }]);
  });
});

describe('표 모양 기록', () => {
  const guide = table3('| **Sonnet** | 번역 「(시험: 다음 1건 `haiku-high`)」 | 구현 「(최저: sonnet-medium)」 | | |');

  it('회고 표시 줄 여덟째 열에 표 모양을 담고 parseUsage가 회고마다 기록 끝과 표 모양을 읽는다', () => {
    const snap = tableSnapshot(parseRoutingTable(guide).cells);
    const line = retroLine('2026-10-13T00:00:00.000Z', 1, 0, '메모', snap);
    assert.equal(line.split('\t').length, 9);
    assert.equal(line.split('\t')[7], snap);
    const p = parseUsage(usageText(row('2026-10-12', 'sonnet-low', '번역', 3, 'ok', 'a1'), line));
    assert.equal(p.retros.length, 1);
    assert.equal(p.retros[0].cutoff, 1, '다섯째 열의 줄 수');
    assert.deepEqual([...p.retros[0].snapshot.cells], [['번역', 'sonnet-low'], ['구현', 'sonnet-medium']]);
    assert.deepEqual(p.retros[0].snapshot.trials, [{ kind: '번역', cellDef: 'sonnet-low', def: 'haiku-high' }]);
    assert.deepEqual([...p.retros[0].snapshot.floors], [['구현', 'sonnet-medium']]);
  });

  it('표 모양이 없거나 깨진 회고 표시는 snapshot이 null이다', () => {
    assert.equal(parseSnapshot('-'), null);
    assert.equal(parseSnapshot('{깨짐'), null);
    assert.equal(parseSnapshot(undefined), null);
    const p = parseUsage(usageText(boundaryRow('2026-10-11T00:00:00.000Z', '0', 'm'), oldBoundaryRow('2026-10-12 m')));
    assert.deepEqual(p.retros.map((r) => r.snapshot), [null, null]);
  });

  it('tableTrials는 시험 표시마다 원래 칸의 정의를 짝짓는다', () => {
    assert.deepEqual(tableTrials(parseRoutingTable(guide).cells), [{ kind: '번역', cellDef: 'sonnet-low', def: 'haiku-high' }]);
  });
});

describe('시험 판정', () => {
  const trial = { kind: '번역', cellDef: 'sonnet-low', def: 'haiku-high' };
  const rowsOf = (...lines) => parseUsage(usageText(...lines)).all;
  const base = [row('2026-10-12', 'sonnet-low', '번역', 3, 'ok', 'b1'), row('2026-10-12', 'sonnet-low', '번역', 3, 'ok', 'b2')];
  const cost = (pairs) => new Map(pairs.map(([id, c]) => [id, { cost: c, seconds: 1, date: '2026-10-12', def: '-', description: '' }]));
  const costs = cost([['b1', 0.04], ['b2', 0.02], ['t1', 0.01]]);

  it('그 정의와 일 종류 기록이 없으면 대기이고 판정이 없다', () => {
    partialEqual(trialVerdict(trial, rowsOf(...base), costs), { state: '대기', verdict: null, downFail: false });
  });

  it('ok이고 정정이 없으며 원래 칸 평균보다 비용이 낮으면 통과다', () => {
    const v = trialVerdict(trial, rowsOf(...base, row('2026-10-12', 'haiku-high', '번역', 3, 'ok', 't1')), costs);
    partialEqual(v, { state: '보냄', agentId: 't1', verdict: '통과', downFail: false, cost: 0.01 });
    assert.ok(Math.abs(v.baseline - 0.03) < 1e-9);
  });

  it('올림이면 실패이고 내림 실패로 센다', () => {
    partialEqual(trialVerdict(trial, rowsOf(...base, row('2026-10-12', 'haiku-high', '번역', 3, '올림', 't1')), costs), { verdict: '실패', downFail: true });
  });

  it('ok여도 그 에이전트에 정정이 있으면 실패이고 내림 실패로 센다', () => {
    partialEqual(trialVerdict(trial, rowsOf(...base, row('2026-10-12', 'haiku-high', '번역', 3, 'ok', 't1')), costs, new Map([['t1', 1]])), { verdict: '실패', downFail: true });
  });

  it('재지시가 섞이면 지시문 탓이라 판정 불가이고 내림 실패로 세지 않는다', () => {
    const v = trialVerdict(trial, rowsOf(...base, row('2026-10-12', 'haiku-high', '번역', 3, '재지시', 't1'), row('2026-10-12', 'haiku-high', '번역', 3, 'ok', 't1')), costs);
    partialEqual(v, { verdict: '판정 불가', downFail: false });
  });

  it('비용이 줄지 않았으면 실패지만 결과가 모자란 것이 아니라 내림 실패로 세지 않는다', () => {
    const v = trialVerdict(trial, rowsOf(...base, row('2026-10-12', 'haiku-high', '번역', 1, 'ok', 't1')), cost([['b1', 0.01], ['b2', 0.01], ['t1', 0.02]]));
    partialEqual(v, { verdict: '실패', downFail: false, reason: '비용이 줄지 않음' });
  });

  it('시험 비용이나 원래 칸 비용을 모르면 판정 불가다', () => {
    const lines = rowsOf(...base, row('2026-10-12', 'haiku-high', '번역', 3, 'ok', 't1'));
    partialEqual(trialVerdict(trial, lines, cost([['b1', 0.04]])), { verdict: '판정 불가', reason: '시험 1건의 비용 모름' });
    partialEqual(trialVerdict(trial, lines, cost([['t1', 0.01]])), { verdict: '판정 불가', reason: '원래 칸의 회고 구간 비용 없음' });
  });

  it('같은 시험을 두 번 보냈으면 첫 건으로 판정하고 보낸 건수를 돌려준다', () => {
    const v = trialVerdict(trial, rowsOf(...base, row('2026-10-12', 'haiku-high', '번역', 3, 'ok', 't1'), row('2026-10-12', 'haiku-high', '번역', 3, '올림', 't2')), costs);
    partialEqual(v, { agentId: 't1', sentAgents: 2, verdict: '통과' });
  });
});

describe('내림 실패 세기', () => {
  const at = (def, kind, result, id) => row('2026-10-12', def, kind, 3, result, id);
  const history = (...lines) => downFailHistory(parseUsage(usageText(...withCutoffs(lines))));
  const LOW = [['sonnet-low', '번역']];
  const LOWERED = [['haiku-high', '번역']];
  const TRIAL = { trials: [['번역', 'haiku-high']] };

  it('표 모양이 없는 옛 회고 표시만 있으면 아무것도 세지 않는다', () => {
    assert.equal(history(at('sonnet-low', '번역', 'ok', 'a1'), boundaryRow('2026-10-11T00:00:00.000Z', '1', 'm'), at('haiku-high', '번역', '올림', 'a2'), boundaryRow('2026-10-12T00:00:00.000Z', '2', 'm')).size, 0);
  });

  it('앞 표 모양에 걸린 시험이 그 구간에서 올림이면 1번이다', () => {
    const h = history(snapRow(0, LOW, TRIAL), at('haiku-high', '번역', '올림', 't1'), snapRow(1, LOW));
    partialEqual(h.get('번역'), { count: 1, failedDefs: ['haiku-high'], lowered: false });
  });

  it('시험이 재지시로 끝났으면 지시문 탓이라 세지 않는다', () => {
    const h = history(snapRow(0, LOW, TRIAL), at('haiku-high', '번역', '재지시', 't1'), snapRow(1, LOW, TRIAL));
    assert.equal(h.get('번역')?.count ?? 0, 0);
  });

  it('칸을 내린 뒤 다시 올리면 1번이고, 내리기만 한 칸은 지금 내린 칸으로 남는다', () => {
    const lowered = history(snapRow(0, LOW), snapRow(0, LOWERED));
    partialEqual(lowered.get('번역'), { count: 0, lowered: true });
    const back = history(snapRow(0, LOW), snapRow(0, LOWERED), snapRow(0, LOW));
    partialEqual(back.get('번역'), { count: 1, failedDefs: ['haiku-high'], lowered: false });
  });

  it('내린 적 없는 칸을 올린 것은 내림 실패가 아니다', () => {
    assert.equal(history(snapRow(0, LOW), snapRow(0, [['sonnet-medium', '번역']])).get('번역')?.count ?? 0, 0);
  });

  it('시험 실패와 내린 뒤 올림이 이어지면 2번이 된다', () => {
    const h = history(snapRow(0, LOW, TRIAL), at('haiku-high', '번역', '올림', 't1'), snapRow(1, LOW), snapRow(1, LOWERED), snapRow(1, LOW));
    assert.equal(h.get('번역').count, DOWN_FAIL_LIMIT);
  });

  it('최저선을 달거나 떼면 그 구간까지 센 횟수가 0으로 돌아간다', () => {
    const floored = history(snapRow(0, LOW), snapRow(0, LOWERED), snapRow(0, LOW), snapRow(0, LOWERED), snapRow(0, LOW, { floors: [['번역', 'sonnet-low']] }));
    assert.equal(floored.get('번역').count, 0);
    const removed = history(snapRow(0, LOW, { floors: [['번역', 'sonnet-low']] }), snapRow(0, LOW, TRIAL), at('haiku-high', '번역', '올림', 't1'), snapRow(1, LOW));
    assert.equal(removed.get('번역').count, 1);
    assert.equal(history(snapRow(0, LOW, { floors: [['번역', 'sonnet-low']] }), snapRow(0, LOW)).get('번역').count, 0);
  });

  it('표 모양이 없는 회고 표시가 끼면 그 앞뒤는 비교하지 않는다', () => {
    const h = history(snapRow(0, LOW), boundaryRow('2026-10-11T00:00:00.000Z', '0', 'm'), snapRow(0, LOW), snapRow(0, LOWERED), snapRow(0, LOW));
    assert.equal(h.get('번역').count, 1);
    assert.equal(history(snapRow(0, LOWERED), boundaryRow('2026-10-11T00:00:00.000Z', '0', 'm'), snapRow(0, LOW)).get('번역')?.count ?? 0, 0);
  });
});

describe('최저선 제안', () => {
  const failedTrial = { kind: '번역', cellDef: 'sonnet-low', def: 'haiku-high', downFail: true };
  const h = (count, failedDefs, lowered = false) => new Map([['번역', { kind: '번역', count, failedDefs, lowered }]]);
  const cellOf = new Map([['번역', 'sonnet-low']]);

  it('앞서 1번에 이번 시험 실패를 더해 2번이면 실패한 정의의 바로 위 칸을 최저선으로 제안한다', () => {
    const r = floorProposals({ history: h(1, ['haiku-high']), trialVerdicts: [failedTrial], cellOf });
    partialEqual(r.proposals, [{ kind: '번역', cellDef: 'sonnet-low', count: 2, before: 1, floor: 'sonnet-low' }]);
  });

  it('지금 내린 칸이 올리기 후보가 되면 이번 내림 실패로 세어 제안한다', () => {
    const r = floorProposals({ history: h(1, ['haiku-high'], true), upCands: [{ def: 'haiku-high', kind: '번역' }], cellOf: new Map([['번역', 'haiku-high']]) });
    partialEqual(r.proposals, [{ kind: '번역', count: 2, floor: 'sonnet-low' }]);
  });

  it('실패한 정의가 여럿이면 가장 높은 것의 바로 위 칸이다', () => {
    const r = floorProposals({ history: h(1, ['sonnet-low']), trialVerdicts: [failedTrial], cellOf });
    assert.equal(r.proposals[0].floor, 'sonnet-medium');
  });

  it('opus-xhigh나 fable-high에서 실패가 쌓여도 fable-high를 최저선으로 제안하지 않는다', () => {
    for (const failed of ['opus-xhigh', 'fable-high']) {
      const r = floorProposals({ history: h(1, [failed]), trialVerdicts: [{ ...failedTrial, def: failed }], cellOf });
      assert.deepEqual(r.proposals, [], failed);
      const up = floorProposals({ history: h(1, [failed]), upCands: [{ def: failed, kind: '번역' }], cellOf: new Map([['번역', failed]]) });
      assert.deepEqual(up.proposals, [], failed);
    }
    const raised = floorProposals({ history: new Map([['번역', { kind: '번역', count: 1, failedDefs: ['fable-high'], floorSince: 0 }]]), trialVerdicts: [{ ...failedTrial, def: 'fable-high' }], floors: new Map([['번역', 'opus-high']]), cellOf, all: Array.from({ length: 4 }, (_, i) => ({ line: i + 1, kind: '번역', def: 'opus-high', result: 'ok' })) });
    assert.deepEqual(raised.raise, []);
    assert.ok(raised.aboveFloor.length > 0);
  });

  it('이번 회고에 새 내림 실패가 없거나 합이 2번이 안 되면 제안하지 않는다', () => {
    assert.deepEqual(floorProposals({ history: h(2, ['haiku-high', 'haiku-high']), cellOf }).proposals, []);
    assert.deepEqual(floorProposals({ history: h(0, []), trialVerdicts: [failedTrial], cellOf }).proposals, []);
    assert.deepEqual(floorProposals({ history: h(1, ['haiku-high']), trialVerdicts: [{ ...failedTrial, downFail: false }], cellOf }).proposals, []);
    assert.deepEqual(floorProposals({ history: h(1, ['haiku-high']), upCands: [{ def: 'haiku-high', kind: '번역' }], cellOf }).proposals, []);
  });

  it('최저선이 이미 있으면 올리자고 제안하지 않고 최저선 위의 내림 실패 수만 돌려준다', () => {
    const floors = new Map([['번역', 'sonnet-low']]);
    const r = floorProposals({ history: h(1, ['sonnet-low']), trialVerdicts: [{ ...failedTrial, def: 'sonnet-low', cellDef: 'sonnet-medium' }], floors, cellOf: new Map([['번역', 'sonnet-medium']]) });
    assert.deepEqual(r.proposals, []);
    partialEqual(r.aboveFloor, [{ kind: '번역', count: 2, current: 'sonnet-low' }]);
    assert.deepEqual(floorProposals({ history: new Map(), floors, cellOf }).aboveFloor, []);
  });
});

describe('판정 전 시험 표시와 표 안정', () => {
  const retro = (n, changed) => ['회고', '-', '회고', '2026-10-1' + n + 'T00:00:00.000Z', '3', changed, '-', '-', 'm'].join('\t');
  const lines = [...dataRows(2), retro(1, '0'), retro(2, '0'), ...dataRows(150, 10)];

  it('바꾼 칸 0인 회고가 두 번 이어져도 표에 시험 표시가 있으면 안정이 아니고 기준이 100건이다', () => {
    const r = retroDue(parseUsage(usageText(...lines)), { trialsPending: true });
    partialEqual(r, { status: 'ask', stable: false, threshold: 100 });
    assert.ok(r.label.includes('판정 전 시험 표시가 있어 표 안정으로 보지 않음'), r.label);
  });

  it('시험 표시가 없으면 그대로 안정이고 단계 설명에 예외 문구가 없다', () => {
    const r = retroDue(parseUsage(usageText(...lines)), { trialsPending: false });
    partialEqual(r, { stable: true, threshold: 200, label: '표 안정(기준 200건)' });
    assert.equal(isStable([0, 0], { trialsPending: true }), false);
    partialEqual(retroStage([0, 1], { trialsPending: true }), { stable: false, held: false, label: '회고 2번 뒤 기준 100건' });
  });
});

describe('시험 판정에서 비용이 비슷할 때', () => {
  const trial = { kind: '번역', cellDef: 'sonnet-low', def: 'haiku-high' };
  const rowsOf = (...lines) => parseUsage(usageText(...lines)).all;
  const base = [row('2026-10-12', 'sonnet-low', '번역', 10, 'ok', 'b1'), row('2026-10-12', 'sonnet-low', '번역', 20, 'ok', 'b2')];
  const costs = new Map([['b1', 0.04], ['b2', 0.02], ['t1', 0.03 * (1 - COST_SIMILAR_RATIO / 2)]].map(([id, c]) => [id, { cost: c, seconds: 1, date: '2026-10-12', def: '-', description: '' }]));

  it('비용이 원래 칸 평균의 10% 안이고 걸린 시간이 평균보다 짧으면 통과(비용 비슷, 더 빠름)이다', () => {
    const v = trialVerdict(trial, rowsOf(...base, row('2026-10-12', 'haiku-high', '번역', 5, 'ok', 't1')), costs);
    partialEqual(v, { verdict: '통과', reason: '비용 비슷, 더 빠름', downFail: false, seconds: 5, baselineSeconds: 15 });
  });

  it('비용이 비슷하고 걸린 시간이 평균보다 짧지 않으면 실패(비용 비슷, 빠르지 않음)이고 내림 실패로 세지 않는다', () => {
    const v = trialVerdict(trial, rowsOf(...base, row('2026-10-12', 'haiku-high', '번역', 15, 'ok', 't1')), costs);
    partialEqual(v, { verdict: '실패', reason: '비용 비슷, 빠르지 않음', downFail: false });
  });

  it('비용이 비슷한데 시험 1건이나 원래 칸의 걸린 시간을 모르면 판정 불가다', () => {
    partialEqual(trialVerdict(trial, rowsOf(...base, row('2026-10-12', 'haiku-high', '번역', '-', 'ok', 't1')), costs), { verdict: '판정 불가', reason: '비용 비슷, 시험 1건의 걸린 시간 모름' });
    const untimed = [row('2026-10-12', 'sonnet-low', '번역', '-', 'ok', 'b1'), row('2026-10-12', 'sonnet-low', '번역', '-', 'ok', 'b2')];
    partialEqual(trialVerdict(trial, rowsOf(...untimed, row('2026-10-12', 'haiku-high', '번역', 5, 'ok', 't1')), costs), { verdict: '판정 불가', reason: '비용 비슷, 원래 칸의 회고 구간 시간 없음' });
  });

  it('비용이 평균보다 10% 넘게 낮으면 시간과 상관없이 통과다', () => {
    const cheap = new Map([...costs, ['t1', { cost: 0.01, seconds: 1, date: '2026-10-12', def: '-', description: '' }]]);
    partialEqual(trialVerdict(trial, rowsOf(...base, row('2026-10-12', 'haiku-high', '번역', 99, 'ok', 't1')), cheap), { verdict: '통과' });
  });
});

describe('섞인 칸 찾기', () => {
  const at = (def, result, id, kind = '버그 원인 찾기') => row('2026-10-12', def, kind, 3, result, id);
  const cellOf = new Map([['버그 원인 찾기', 'sonnet-medium']]);
  const rowsOf = (...lines) => parseUsage(usageText(...lines)).all;

  it('실패(올림이나 정정) 2건 이상이면서 성공(ok, 정정 없음) 3건 이상인 일 종류를 agentId와 함께 돌려준다', () => {
    const rows = rowsOf(at('sonnet-medium', '올림', 'f1'), at('sonnet-medium', 'ok', 'f2'), at('sonnet-medium', 'ok', 'o1'), at('sonnet-medium', 'ok', 'o2'), at('sonnet-medium', 'ok', 'o3'));
    const r = mixedCells(rows, new Map([['f2', 1]]), cellOf);
    assert.equal(r.length, 1);
    assert.deepEqual(r[0].fails.map((a) => a.agentId), ['f1', 'f2']);
    assert.deepEqual(r[0].oks.map((a) => a.agentId), ['o1', 'o2', 'o3']);
    assert.equal(r[0].cellDef, 'sonnet-medium');
  });

  it('실패가 1건이거나 성공이 2건이면 섞인 칸이 아니다', () => {
    assert.deepEqual(mixedCells(rowsOf(at('sonnet-medium', '올림', 'f1'), at('sonnet-medium', 'ok', 'o1'), at('sonnet-medium', 'ok', 'o2'), at('sonnet-medium', 'ok', 'o3')), new Map(), cellOf), []);
    assert.deepEqual(mixedCells(rowsOf(at('sonnet-medium', '올림', 'f1'), at('sonnet-medium', '올림', 'f2'), at('sonnet-medium', 'ok', 'o1'), at('sonnet-medium', 'ok', 'o2')), new Map(), cellOf), []);
  });

  it('재지시가 섞인 에이전트는 어느 쪽에도 넣지 않고, 표의 칸보다 위 정의의 성공은 올림 뒤 다시 보낸 건일 수 있어 성공에서 뺀다', () => {
    const rows = rowsOf(at('sonnet-medium', '올림', 'f1'), at('sonnet-medium', '올림', 'f2'), at('sonnet-medium', '재지시', 'r1'), at('sonnet-medium', 'ok', 'r1'), at('opus-low', 'ok', 'u1'), at('opus-low', 'ok', 'u2'), at('sonnet-medium', 'ok', 'o1'), at('sonnet-medium', 'ok', 'o2'));
    assert.deepEqual(mixedCells(rows, new Map(), cellOf), []);
    assert.equal(mixedCells(rows, new Map(), new Map()).length, 1, '표의 칸을 모르면 위 정의 성공도 센다');
  });
});

describe('쪼갠 칸과 최저선', () => {
  it('대괄호로 기준을 붙인 두 칸은 다른 일 종류로 읽히고, 최저선은 붙은 쪽에만 있다', () => {
    const { cells } = parseRoutingTable(table3('| **Sonnet** | | 버그 원인 찾기[재현 있음] | 버그 원인 찾기[재현 없음] 「(최저: sonnet-high)」 | |'));
    assert.deepEqual([...tableKindSet(cells)], ['버그 원인 찾기[재현 있음]', '버그 원인 찾기[재현 없음]']);
    assert.deepEqual([...floorMap(cells)], [['버그 원인 찾기[재현 없음]', 'sonnet-high']]);
    const five = (def, kind) => Array.from({ length: 5 }, (_, i) => row('2026-10-12', def, kind, 3, 'ok', `${kind.length}${def}${i}`));
    const p = parseUsage(usageText(...five('sonnet-medium', '버그 원인 찾기[재현 있음]'), ...five('sonnet-high', '버그 원인 찾기[재현 없음]')));
    assert.deepEqual(downCandidates(p.all, new Map(), new Set(), floorMap(cells)), [{ def: 'sonnet-medium', kind: '버그 원인 찾기[재현 있음]' }]);
  });

  it('소괄호로 기준을 붙이면 부연으로 지워져 두 칸이 옛 이름 하나로 합쳐진다', () => {
    const { cells } = parseRoutingTable(table3('| **Sonnet** | | 버그 원인 찾기(재현 있음) | 버그 원인 찾기(재현 없음) | |'));
    assert.deepEqual([...tableKindSet(cells)], ['버그 원인 찾기']);
    assert.equal(parseUsage(usageText(row('2026-10-12', 'sonnet-medium', '버그 원인 찾기(재현 있음)', 3, 'ok', 'a1'))).all[0].kind, '버그 원인 찾기');
  });

  it('쪼갠 칸은 옛 칸의 내림 실패를 이어받지 않고 최저선을 물려받은 쪽은 그 회고부터 다시 시험 간격을 센다', () => {
    const OLD = [['sonnet-high', '버그 원인 찾기']];
    const SPLIT = [['sonnet-medium', '버그 원인 찾기[재현 있음]'], ['sonnet-high', '버그 원인 찾기[재현 없음]']];
    const parsed = parseUsage(usageText(...withCutoffs([snapRow(0, OLD), snapRow(0, [['sonnet-medium', '버그 원인 찾기']]), snapRow(0, OLD, { floors: [['버그 원인 찾기', 'sonnet-high']] }), snapRow(0, SPLIT, { floors: [['버그 원인 찾기[재현 없음]', 'sonnet-high']] })])));
    const h = downFailHistory(parsed);
    assert.equal(h.get('버그 원인 찾기[재현 없음]').count, 0);
    assert.equal(h.get('버그 원인 찾기[재현 있음]'), undefined);
    const states = retrialHistory(parsed);
    partialEqual(states.get('버그 원인 찾기[재현 없음]'), { interval: RETRIAL_START, anchor: 3 });
    assert.equal(states.has('버그 원인 찾기'), false, '옛 이름은 표에서 사라져 상태도 없다');
  });
});

describe('최저선 올리기 후보', () => {
  const failedTrial = { kind: '번역', cellDef: 'sonnet-medium', def: 'sonnet-low', downFail: true };
  const floors = new Map([['번역', 'sonnet-low']]);
  const cellOf = new Map([['번역', 'sonnet-medium']]);
  const rowsOf = (n) => parseUsage(usageText(...Array.from({ length: n }, (_, i) => row('2026-10-12', 'sonnet-medium', '번역', 3, 'ok', `x${i}`)))).all;

  it('최저선 위 내림 실패가 2번 이상이면서 최저선을 단 뒤 그 일 기록의 20% 이상이면 올리기 후보이고 실패한 정의의 바로 위 칸을 제안한다', () => {
    const r = floorProposals({ history: new Map([['번역', { count: 1, failedDefs: ['sonnet-low'], floorSince: 0 }]]), trialVerdicts: [failedTrial], floors, cellOf, all: rowsOf(10) });
    partialEqual(r.raise, [{ kind: '번역', count: 2, total: 10, current: 'sonnet-low', floor: 'sonnet-medium' }]);
  });

  it('2번이어도 그 일 기록의 20%가 안 되면 올리기 후보가 아니고 최저선 위 실패 수만 남는다', () => {
    const r = floorProposals({ history: new Map([['번역', { count: 1, failedDefs: ['sonnet-low'], floorSince: 0 }]]), trialVerdicts: [failedTrial], floors, cellOf, all: rowsOf(11) });
    assert.deepEqual(r.raise, []);
    partialEqual(r.aboveFloor, [{ count: 2, total: 11 }]);
  });

  it('분모는 최저선을 단 뒤의 기록이고, 이번 회고에 새 실패가 없으면 후보가 아니다', () => {
    const all = rowsOf(30);
    const since = all[20].line;
    const r = floorProposals({ history: new Map([['번역', { count: 1, failedDefs: ['sonnet-low'], floorSince: since }]]), trialVerdicts: [failedTrial], floors, cellOf, all });
    partialEqual(r.raise, [{ total: 9 }]);
    assert.deepEqual(floorProposals({ history: new Map([['번역', { count: 3, failedDefs: ['sonnet-low'], floorSince: 0 }]]), floors, cellOf, all: rowsOf(5) }).raise, []);
  });

  it('최저선 아래로 보낸 다시 시험의 실패는 최저선 위 내림 실패로 세지 않는다', () => {
    const r = floorProposals({ history: new Map([['번역', { count: 1, failedDefs: ['sonnet-low'], floorSince: 0 }]]), trialVerdicts: [{ ...failedTrial, def: 'haiku-high' }], floors, cellOf, all: rowsOf(3) });
    assert.deepEqual(r.raise, []);
    assert.equal(isRetrial('번역', 'haiku-high', floors), true);
    assert.equal(isRetrial('번역', 'sonnet-low', floors), false);
  });
});

describe('최저선 다시 시험', () => {
  const FLOOR = { floors: [['번역', 'sonnet-low']] };
  const RETRY = { floors: [['번역', 'sonnet-low']], trials: [['번역', 'haiku-high']] };
  const CELL = [['sonnet-medium', '번역']];
  const at = (def, result, id, kind = '번역', secs = 3) => row('2026-10-12', def, kind, secs, result, id);
  const parsedOf = (...lines) => parseUsage(usageText(...withCutoffs(lines)));
  const floors = new Map([['번역', 'sonnet-low']]);
  const cellOf = new Map([['번역', 'sonnet-medium']]);
  const planOf = (parsed, extra = {}) => retrialPlan({ states: retrialHistory(parsed, extra.costMap, extra.corrections), retroCount: parsed.retros.length, floors, cellOf, all: parsed.all, ...extra });

  it('최저선을 단 회고 뒤 회고 2번째에 바로 아래 정의로 다시 시험을 제안하고 그 전에는 남은 회고 수를 돌려준다', () => {
    const one = planOf(parsedOf(snapRow(0, CELL, FLOOR)));
    assert.equal(one.proposal, null);
    partialEqual(one.waits, [{ kind: '번역', remaining: 1, interval: 2 }]);
    const two = planOf(parsedOf(snapRow(0, CELL, FLOOR), snapRow(1, CELL, FLOOR)));
    partialEqual(two.proposal, { kind: '번역', floor: 'sonnet-low', def: 'haiku-high', remaining: 0, modelChange: null });
  });

  it('다시 시험이 실패할 때마다 간격이 2번, 4번, 8번으로 늘고 내림 실패로는 세지 않는다', () => {
    const lines = [snapRow(0, CELL, FLOOR), snapRow(1, CELL, RETRY), at('haiku-high', '올림', 't1'), snapRow(2, CELL, FLOOR)];
    let parsed = parsedOf(...lines);
    partialEqual(retrialHistory(parsed).get('번역'), { interval: 4, anchor: 2, last: { verdict: '실패', def: 'haiku-high' } });
    partialEqual(planOf(parsed).waits[0], { remaining: 3, interval: 4 });
    const more = [...lines, snapRow(3, CELL, FLOOR), snapRow(4, CELL, FLOOR), snapRow(5, CELL, RETRY), at('haiku-high', '올림', 't2'), snapRow(6, CELL, FLOOR)];
    const waiting = [{ kind: '번역', cellDef: 'sonnet-medium', def: 'haiku-high', state: '대기', verdict: null }];
    partialEqual(planOf(parsedOf(...more.slice(0, -3))), { proposal: null, waits: [{ remaining: 1 }] });
    assert.equal(planOf(parsedOf(...more.slice(0, -2))).proposal?.kind, '번역', '실패한 회고 뒤 회고 4번째에 다시 제안한다');
    assert.equal(planOf(parsedOf(...more.slice(0, -2)), { verdicts: waiting }).proposal, null, '다시 시험이 걸린 동안은 새로 제안하지 않는다');
    parsed = parsedOf(...more);
    partialEqual(retrialHistory(parsed).get('번역'), { interval: 8, anchor: 6 });
    assert.equal(downFailHistory(parsed).get('번역')?.count ?? 0, 0);
  });

  it('지금 걸린 다시 시험이 통과하면 최저선을 한 칸 내리자고 하고 간격을 처음으로 돌린다', () => {
    const parsed = parsedOf(snapRow(0, CELL, FLOOR), snapRow(1, CELL, RETRY), at('haiku-high', '올림', 't1'), snapRow(2, CELL, FLOOR));
    const verdicts = [{ kind: '번역', cellDef: 'sonnet-medium', def: 'haiku-high', state: '보냄', verdict: '통과', agentId: 'p1' }];
    const plan = planOf(parsed, { verdicts });
    assert.deepEqual(plan.lowerFloor, [{ kind: '번역', cellDef: 'sonnet-medium', floor: 'sonnet-low', to: 'haiku-high', agentId: 'p1' }]);
    partialEqual(plan.waits[0], { interval: RETRIAL_START, remaining: RETRIAL_START });
    assert.equal(plan.proposal, null);
  });

  it('회고 한 번에 한 칸만 제안하고 그 일의 기록이 많은 칸을 먼저 고른다', () => {
    const both = { floors: [['번역', 'sonnet-low'], ['요약', 'sonnet-low']] };
    const cells = [['sonnet-medium', '번역'], ['sonnet-medium', '요약']];
    const parsed = parsedOf(at('sonnet-medium', 'ok', 'a1', '요약'), at('sonnet-medium', 'ok', 'a2', '요약'), at('sonnet-medium', 'ok', 'a3', '번역'), snapRow(0, cells, both), snapRow(1, cells, both));
    const plan = retrialPlan({ states: retrialHistory(parsed), retroCount: 2, floors: new Map(both.floors), cellOf: new Map([['번역', 'sonnet-medium'], ['요약', 'sonnet-medium']]), all: parsed.all });
    assert.equal(plan.proposal.kind, '요약');
    assert.deepEqual(plan.deferred.map((d) => d.kind), ['번역']);
  });

  it('최저선 아래 정의의 마지막 실패 때 모델과 지금 모델이 다르면 간격과 상관없이 제안하고 때가 된 칸보다 먼저 고른다', () => {
    const parsed = parsedOf(at('haiku-high', '올림', 'old'), snapRow(0, CELL, FLOOR));
    const cost = (model, date) => ({ cost: 0.01, seconds: 1, date, def: 'haiku-high', model, description: '' });
    const costMap = new Map([['old', cost('claude-haiku-5-1', '2026-10-01')], ['new', cost('claude-haiku-5-5', '2026-10-12')]]);
    const plan = planOf(parsed, { costMap });
    partialEqual(plan.proposal, { kind: '번역', remaining: 1, modelChange: { from: 'claude-haiku-5-1', to: 'claude-haiku-5-5' } });
    const same = new Map([['old', cost('claude-haiku-5-5', '2026-10-01')], ['new', cost('claude-haiku-5-5', '2026-10-12')]]);
    assert.equal(planOf(parsed, { costMap: same }).proposal, null, '모델이 같으면 간격을 기다린다');
  });

  it('모델 ID 꼬리([1m], 날짜)만 다르고 같은 모델이면 모델이 바뀐 것으로 보지 않고, 바뀌면 원래 ID로 보여 준다', () => {
    const parsed = parsedOf(at('haiku-high', '올림', 'old'), snapRow(0, CELL, FLOOR));
    const cost = (model, date) => ({ cost: 0.01, seconds: 1, date, def: 'haiku-high', model, description: '' });
    const tail = new Map([['old', cost('claude-haiku-5-5[1m]', '2026-10-01')], ['new', cost('claude-haiku-5-5', '2026-10-12')]]);
    assert.equal(planOf(parsed, { costMap: tail }).proposal, null);
    const dated = new Map([['old', cost('claude-haiku-5-5-20261001', '2026-10-01')], ['new', cost('claude-haiku-5-5', '2026-10-12')]]);
    assert.equal(planOf(parsed, { costMap: dated }).proposal, null);
    const changed = new Map([['old', cost('claude-haiku-5-1[1m]', '2026-10-01')], ['new', cost('claude-haiku-5-5', '2026-10-12')]]);
    partialEqual(planOf(parsed, { costMap: changed }).proposal, { modelChange: { from: 'claude-haiku-5-1[1m]', to: 'claude-haiku-5-5' } });
  });

  it('같은 다시 시험이 두 번 이어 판정 불가이면 실패로 보지 않고 간격만 다음 단계로 넘긴다', () => {
    const parsed = parsedOf(snapRow(0, CELL, FLOOR), snapRow(1, CELL, RETRY), at('haiku-high', '재지시', 'u1'), snapRow(2, CELL, RETRY), at('haiku-high', '재지시', 'u2'), snapRow(3, CELL, FLOOR));
    partialEqual(retrialHistory(parsed).get('번역'), { interval: 4, anchor: 3, last: { verdict: '판정 불가 2번' } });
    const once = parsedOf(snapRow(0, CELL, FLOOR), snapRow(1, CELL, RETRY), at('haiku-high', '재지시', 'u1'), snapRow(2, CELL, RETRY));
    const verdicts = [{ kind: '번역', cellDef: 'sonnet-medium', def: 'haiku-high', state: '보냄', verdict: '판정 불가' }];
    partialEqual(planOf(once, { verdicts }).waits[0], { interval: 4, remaining: 4, last: { verdict: '판정 불가 2번' } });
  });

  it('표 모양이 없는 옛 회고 표시만 있으면 상태가 없고, 지금 표의 최저선은 이번 회고부터 간격 2번으로 센다', () => {
    const parsed = parseUsage(usageText(boundaryRow('2026-10-11T00:00:00.000Z', '0', 'm'), oldBoundaryRow('2026-10-12 m')));
    assert.equal(retrialHistory(parsed).size, 0);
    assert.equal(undecidedRuns(parsed).size, 0);
    partialEqual(planOf(parsed).waits[0], { interval: RETRIAL_START, remaining: RETRIAL_START });
  });
});

describe('판정 불가가 이어진 시험 표시', () => {
  const LOW = [['sonnet-low', '번역']];
  const TRIAL = { trials: [['번역', 'haiku-high']] };
  const at = (result, id) => row('2026-10-12', 'haiku-high', '번역', 3, result, id);
  const runsOf = (...lines) => undecidedRuns(parseUsage(usageText(...withCutoffs(lines))));
  const key = undecidedKey({ kind: '번역', def: 'haiku-high' });

  it('판정 불가로 끝나고 표시가 남은 시험은 1번으로 세고, 대기는 횟수를 바꾸지 않는다', () => {
    assert.equal(runsOf(snapRow(0, LOW, TRIAL), at('재지시', 'u1'), snapRow(1, LOW, TRIAL)).get(key), 1);
    assert.equal(runsOf(snapRow(0, LOW, TRIAL), at('재지시', 'u1'), snapRow(1, LOW, TRIAL), snapRow(2, LOW, TRIAL)).get(key), 1);
    assert.equal(runsOf(snapRow(0, LOW, TRIAL), at('재지시', 'u1'), snapRow(1, LOW, TRIAL), at('재지시', 'u2'), snapRow(2, LOW, TRIAL)).get(key), 2);
  });

  it('표시를 지웠거나 판정이 나왔거나 표 모양이 없는 회고 표시가 끼면 0부터 센다', () => {
    assert.equal(runsOf(snapRow(0, LOW, TRIAL), at('재지시', 'u1'), snapRow(1, LOW)).has(key), false);
    assert.equal(runsOf(snapRow(0, LOW, TRIAL), at('올림', 'u1'), snapRow(1, LOW, TRIAL)).has(key), false);
    assert.equal(runsOf(snapRow(0, LOW, TRIAL), at('재지시', 'u1'), boundaryRow('2026-10-11T00:00:00.000Z', '0', 'm'), snapRow(1, LOW, TRIAL)).has(key), false);
  });

  it('판정 불가로 지운 시험은 내림 실패로 세지 않는다', () => {
    const h = downFailHistory(parseUsage(usageText(...withCutoffs([snapRow(0, LOW, TRIAL), at('재지시', 'u1'), snapRow(1, LOW, TRIAL), at('재지시', 'u2'), snapRow(2, LOW)]))));
    assert.equal(h.get('번역')?.count ?? 0, 0);
  });
});

describe('GUIDE의 사용자 규칙 구역', () => {
  const table = ['| | low | medium | high | xhigh |', '|:---|:---|:---|:---|:---|', '| **Sonnet** | 번역 | 구현 | | |'].join('\n');
  const section = '<!-- 사용자 규칙 시작 -->\n- 회고가 고친 공통 문장 | low | medium | high | xhigh |\n<!-- 사용자 규칙 끝 -->';
  const wrapped = (...parts) => ['# 가이드', '<!-- 사용자 표 시작 -->', table, '<!-- 사용자 표 끝 -->', ...parts].join('\n');

  it('표시 구역이 있어도 없어도 표를 같은 결과로 읽는다', () => {
    const without = parseRoutingTable(wrapped());
    assert.deepEqual(without.problems, []);
    assert.deepEqual(parseRoutingTable(wrapped(section)), without);
    assert.deepEqual(parseRoutingTable(wrapped(section.replace('<!-- 사용자 규칙 끝 -->', ''))), without);
  });
});

describe('resendsOf 올림 뒤 다시 보낸 기록', () => {
  const d = '2026-10-11';
  const resends = (lines, def = 'sonnet-low', kind = '번역', corrections = new Map()) => {
    const p = parseUsage(usageText(...lines));
    return resendsOf(p.target, p.all, def, kind, corrections);
  };

  it('올림 뒤에 같은 일 종류의 더 높은 정의 ok 줄이 있으면 그 정의와 건수를 돌려준다', () => {
    const r = resends([
      row(d, 'sonnet-low', '번역', 10, '올림', 'u1'),
      row(d, 'sonnet-medium', '번역', 10, 'ok', 'r1'),
      row(d, 'sonnet-low', '번역', 10, '올림', 'u2'),
      row(d, 'sonnet-medium', '번역', 10, 'ok', 'r2'),
    ]);
    assert.deepEqual(r, [{ def: 'sonnet-medium', count: 2 }]);
  });

  it('올림 줄 하나에 짝은 하나라 ok 줄이 더 있어도 올림 수보다 많이 세지 않는다', () => {
    const r = resends([row(d, 'sonnet-low', '번역', 10, '올림', 'u1'), row(d, 'sonnet-medium', '번역', 10, 'ok', 'r1'), row(d, 'opus-medium', '번역', 10, 'ok', 'r2')]);
    assert.deepEqual(r, [{ def: 'sonnet-medium', count: 1 }]);
  });

  it('올림 앞의 줄, 같은 정의나 낮은 정의의 줄, 다른 일 종류, ok가 아닌 줄, 같은 에이전트의 줄은 짝이 아니다', () => {
    const r = resends([
      row(d, 'opus-medium', '번역', 10, 'ok', 'before'),
      row(d, 'sonnet-low', '번역', 10, '올림', 'u1'),
      row(d, 'sonnet-low', '번역', 10, 'ok', 'same'),
      row(d, 'haiku-high', '번역', 10, 'ok', 'lower'),
      row(d, 'opus-medium', '교정', 10, 'ok', 'other'),
      row(d, 'opus-medium', '번역', 10, '재지시', 'redo'),
      row(d, 'opus-medium', '번역', 10, 'ok', 'u1'),
    ]);
    assert.deepEqual(r, []);
  });

  it('정정이 붙은 에이전트도 올림으로 보고, 정정이 붙은 ok 줄은 다시 보낸 것으로 세지 않는다', () => {
    const lines = [row(d, 'sonnet-low', '번역', 10, 'ok', 'c1'), row(d, 'opus-medium', '번역', 10, 'ok', 'bad'), row(d, 'sonnet-medium', '번역', 10, 'ok', 'good')];
    assert.deepEqual(resends(lines, 'sonnet-low', '번역', new Map([['c1', 1], ['bad', 1]])), [{ def: 'sonnet-medium', count: 1 }]);
  });

  it('사다리 밖 정의로 보낸 ok 줄은 짝이 아니다', () => {
    assert.deepEqual(resends([row(d, 'sonnet-low', '번역', 10, '올림', 'u1'), row(d, 'Explore', '번역', 10, 'ok', 'r1')]), []);
  });
});

describe('retroDue 대화 기록 보존 기간 기준', () => {
  const at = (y, m, d) => new Date(y, m - 1, d, 12).toISOString();
  const rowOn = (date, n = 0) => row(date, 'sonnet-medium', '구현', 10, 'ok', `p${n}`);
  const mark = (y, m, d, n) => boundaryRow(at(y, m, d), n, 'm');
  // 줄 번호는 머리글이 1이라 데이터 줄 k개 뒤의 회고 줄까지 센 값이 n이다.
  const afterRetro = (retroDate, newRows = 1, opts = {}) => retroDue(parseUsage(usageText(rowOn('2026-08-01'), mark(...retroDate, 2), ...Array.from({ length: newRows }, (_, i) => rowOn('2026-10-12', i)))), opts);

  it('마지막 회고 뒤 보존 기간 - 5일이 지나면 건수가 모자라도 ask이고 지난 일 수를 돌려준다', () => {
    const r = afterRetro([2026, 9, 17]);
    partialEqual(r, { status: 'ask', byCount: false, byPeriod: true, periodElapsed: 26, retentionDays: 30, periodLimit: 25 });
  });

  it('건수 기준을 미뤄 둔 뒤 기간 기준만 미룬 줄이 와도 건수 기준은 첫 건수 미룸 줄 뒤 기록 수로 센다', () => {
    const rows = (n, tag) => Array.from({ length: n }, (_, i) => rowOn('2026-10-12', `${tag}${i}`));
    const snoozeAt = (extra) => snoozeLine(new Date(2026, 9, 12, 12), extra);
    const text = (...parts) => usageText(...parts);
    const early = [...rows(35, 'a'), snoozeAt({ countSnoozed: true })];
    const periodOnly = [...early, ...rows(5, 'b'), snoozeAt({ countSnoozed: false, periodSnoozed: true })];
    partialEqual(retroDue(parseUsage(text(...early, ...rows(5, 'b'))), { now: new Date(2026, 9, 13, 12) }), { byCount: false, status: 'wait', remaining: 10 });
    partialEqual(retroDue(parseUsage(text(...periodOnly)), { now: new Date(2026, 9, 13, 12) }), { byCount: false, status: 'wait', remaining: 10 });
    partialEqual(retroDue(parseUsage(text(...periodOnly, ...rows(10, 'c'))), { now: new Date(2026, 9, 13, 12) }), { byCount: true, status: 'ask' });
  });

  it('보존 기간 - 5일이 되기 하루 전이면 wait이고 그날이 되면 ask다', () => {
    partialEqual(afterRetro([2026, 9, 19]), { status: 'wait', byPeriod: false, periodElapsed: 24, periodDueDate: '2026-10-14' });
    partialEqual(afterRetro([2026, 9, 18]), { status: 'ask', periodElapsed: 25, periodDueDate: '2026-10-13' });
  });

  it('회고가 한 번도 없으면 사용 기록 첫 줄 날짜를 기준으로 센다', () => {
    const old = retroDue(parseUsage(usageText(rowOn('2026-09-10', 0), rowOn('2026-10-12', 1))));
    partialEqual(old, { status: 'ask', byPeriod: true, periodElapsed: 33, periodAnchor: '2026-09-10' });
    assert.equal(retroDue(parseUsage(usageText(rowOn('2026-09-25', 0)))).status, 'wait');
  });

  it('사용 기록이 비어 있으면 기간 기준이 걸리지 않고 기준 날짜도 없다', () => {
    partialEqual(retroDue(parseUsage(usageText())), { status: 'wait', byPeriod: false, periodAnchor: null });
  });

  it('마지막 회고 뒤 새 기록 줄이 없으면 기간이 지나도 걸리지 않는다', () => {
    const r = afterRetro([2026, 8, 1], 0);
    partialEqual(r, { status: 'wait', byPeriod: false, periodElapsed: 73 });
  });

  it('보존 기간이 5일 이하이면 (보존 기간 - 1)일을 기준으로 한다', () => {
    assert.equal(periodLimitDays(5), 4);
    assert.equal(periodLimitDays(1), 0);
    assert.equal(periodLimitDays(6), 1);
    assert.equal(periodLimitDays(30), 25);
    partialEqual(afterRetro([2026, 10, 9], 1, { retentionDays: 5 }), { status: 'ask', periodLimit: 4, byPeriod: true });
    assert.equal(afterRetro([2026, 10, 10], 1, { retentionDays: 5 }).status, 'wait');
  });

  it('보존 기간이 길면 기준도 늘어 같은 간격에서 wait이다', () => {
    assert.equal(afterRetro([2026, 9, 1], 1, { retentionDays: 60 }).status, 'wait');
    assert.equal(afterRetro([2026, 8, 1], 1, { retentionDays: 60 }).status, 'ask');
  });

  const periodMemo = JSON.stringify({ 건수: false, 기간: true, 올림: [] });
  const countMemo = JSON.stringify({ 건수: true, 올림: [] });
  const snoozeAt = (iso, memo = '-') => ['미룸', '-', '미룸', iso, '-', '-', '-', '-', memo].join('\t');
  const withSnoozes = (...snoozes) => retroDue(parseUsage(usageText(rowOn('2026-08-01'), mark(2026, 9, 1, 2), rowOn('2026-10-01', 1), ...snoozes, rowOn('2026-10-12', 2))));

  it('기간 기준을 미룬 미룸 줄은 그 날짜부터 기간을 다시 센다', () => {
    assert.equal(withSnoozes(snoozeAt(at(2026, 10, 12), periodMemo)).status, 'wait');
    partialEqual(withSnoozes(snoozeAt(at(2026, 9, 17), periodMemo)), { status: 'ask', byPeriod: true, periodAnchor: '2026-09-17' });
  });

  it('기간 기준을 미룬 뒤 새 기록이 하나도 없으면 기간이 지나도 다시 ask가 나오지 않는다', () => {
    const text = (...tail) => usageText(rowOn('2026-09-01', 0), rowOn('2026-09-01', 1), rowOn('2026-09-01', 2), snoozeAt(at(2026, 9, 26), periodMemo), ...tail);
    partialEqual(retroDue(parseUsage(text()), { now: new Date(2026, 9, 21, 12) }), { status: 'wait', byPeriod: false, periodElapsed: 25, periodAnchor: '2026-09-26' });
  });

  it('기간 기준을 미룬 뒤 새 기록이 하나라도 생기면 기간이 지났을 때 ask다', () => {
    const text = usageText(rowOn('2026-09-01', 0), rowOn('2026-09-01', 1), rowOn('2026-09-01', 2), snoozeAt(at(2026, 9, 26), periodMemo), rowOn('2026-10-05', 3));
    partialEqual(retroDue(parseUsage(text), { now: new Date(2026, 9, 21, 12) }), { status: 'ask', byPeriod: true });
  });

  it('건수 기준만 미룬 미룸 줄은 기간 셈의 기준 날짜를 옮기지 않는다', () => {
    partialEqual(withSnoozes(snoozeAt(at(2026, 10, 12), countMemo)), { status: 'ask', byPeriod: true, periodAnchor: '2026-09-01' });
  });

  it('기간 키가 없는 옛 미룸 줄은 기간 셈을 옮기지 않는다', () => {
    partialEqual(withSnoozes(snoozeAt(at(2026, 10, 12))), { byPeriod: true, periodAnchor: '2026-09-01' });
  });

  it('기간 미룸 뒤에 건수 미룸이 와도 기간 셈은 마지막 기간 미룸 줄에서 시작한다', () => {
    const r = withSnoozes(snoozeAt(at(2026, 9, 20), periodMemo), snoozeAt(at(2026, 10, 12), countMemo));
    partialEqual(r, { periodAnchor: '2026-09-20', periodDueDate: '2026-10-15' });
  });

  it('기간 미룸이 여러 번이면 가장 마지막 기간 미룸 줄 날짜를 쓴다', () => {
    const r = withSnoozes(snoozeAt(at(2026, 9, 10), periodMemo), snoozeAt(at(2026, 9, 25), periodMemo));
    partialEqual(r, { periodAnchor: '2026-09-25' });
  });

  it('snoozeLine은 기간 기준을 미뤘을 때만 메모에 기간: true를 남기고 parseUsage가 읽는다', () => {
    const memoOf = (opts) => snoozeLine(new Date('2026-10-13T00:00:00.000Z'), opts).split('\t')[8];
    assert.equal(memoOf({}), '-');
    assert.equal(JSON.parse(memoOf({ periodSnoozed: true })).기간, true);
    assert.equal('기간' in JSON.parse(memoOf({ countSnoozed: false })), false);
    assert.equal(parseUsage(snoozeLine(new Date(), { periodSnoozed: true }) + '\n').periodSnooze.line, 1);
    assert.equal(parseUsage(snoozeLine(new Date()) + '\n').periodSnooze, null);
  });

  it('periodSnoozeLossDate는 오늘 + 기간 간격 - 보존 기간인 날을 돌려준다', () => {
    assert.equal(periodSnoozeLossDate({ periodLimit: 25, retentionDays: 30 }, TODAY), '2026-10-08');
    assert.equal(periodSnoozeLossDate({ periodLimit: 4, retentionDays: 5 }, TODAY), '2026-10-12');
  });

  it('retentionLossDate는 오늘에서 보존 기간만큼 전 날을 돌려준다', () => {
    assert.equal(retentionLossDate({ retentionDays: 30 }, TODAY), '2026-09-13');
    assert.equal(retentionLossDate({ retentionDays: 5 }, TODAY), '2026-10-08');
  });

  it('마지막 회고보다 앞선 미룸 줄은 기준 날짜로 쓰지 않는다', () => {
    const snooze = snoozeAt(at(2026, 10, 12), periodMemo);
    const r = retroDue(parseUsage(usageText(rowOn('2026-08-01'), snooze, mark(2026, 9, 1, 3), rowOn('2026-10-01', 1))));
    partialEqual(r, { status: 'ask', byPeriod: true, periodAnchor: '2026-09-01' });
  });
});

describe('미룸 줄의 비용 기록 건수(비용: N)', () => {
  const costHeader = '날짜\t프로젝트\t세션\tagentId\t정의\t모델\teffort\t설명\t입력\t캐시 쓰기\t캐시 읽기\t출력\t요청 수\t걸린 초\t어림 비용($)';
  const costRow = (date, id) => [date, '/p', 's', id, 'sonnet-low', 'm', 'low', 'd', 1, 1, 1, 1, 1, 1, 0.1].join('\t');
  const costMapOf = (date, n) => parseCost([[costHeader, ...Array.from({ length: n }, (_, i) => costRow(date, `c${i}`))].join('\n') + '\n']);
  const rowOn = (date, n) => row(date, 'sonnet-medium', '구현', 10, 'ok', `p${n}`);
  const noonOf = (y, m, d) => new Date(y, m - 1, d, 12);
  const periodMemo = JSON.stringify({ 건수: false, 기간: true, 올림: [] });
  const legacyPeriodSnooze = ['미룸', '-', '미룸', noonOf(2026, 9, 14).toISOString(), '-', '-', '-', '-', periodMemo].join('\t');
  const periodSnooze = (costOnly) => snoozeLine(noonOf(2026, 9, 14), { countSnoozed: false, periodSnoozed: true, costOnly });
  const periodDue = (snooze, costDate, costs) => retroDue(parseUsage(usageText(rowOn('2026-09-01', 0), rowOn('2026-09-01', 1), snooze)), { costMap: costMapOf(costDate, costs) });

  it('기간 미룸과 같은 날의 비용 기록이 미룰 때 이미 있던 것이면 새 기록이 아니라 기간 기준이 wait이다', () => {
    partialEqual(periodDue(periodSnooze(1), '2026-09-14', 1), { status: 'wait', byPeriod: false, periodElapsed: 29 });
    partialEqual(periodDue(periodSnooze(0), '2026-09-14', 0), { status: 'wait', remaining: 28 });
  });

  it('미룬 날 비용 기록이 미룰 때보다 늘었으면 늘어난 몫이 새 기록이라 기간 기준이 ask다', () => {
    partialEqual(periodDue(periodSnooze(1), '2026-09-14', 2), { status: 'ask', byPeriod: true });
  });

  it('비용 건수가 없는 옛 기간 미룸 줄은 미룬 날 비용 기록을 모두 새 기록으로 센다', () => {
    partialEqual(periodDue(legacyPeriodSnooze, '2026-09-14', 1), { status: 'ask', byPeriod: true });
  });

  it('건수 기준 미룸 뒤에도 미룰 때 있던 비용 기록은 세지 않고 늘어난 몫만 센다', () => {
    const lines = [...dataRows(30), snoozeLine(noonOf(2026, 10, 12), { costOnly: 3 })];
    const at = (n) => retroDue(parseUsage(usageText(...lines)), { costMap: costMapOf('2026-10-12', n) });
    partialEqual(at(3), { status: 'wait', remaining: 15 });
    partialEqual(at(17), { status: 'wait', remaining: 1 });
    assert.equal(at(18).status, 'ask');
  });

  it('snoozeLine은 비용: N을 메모에 남기고 parseUsage가 읽으며, 없거나 잘못된 값은 0으로 읽고 비용이 0이면 옛 줄과 같다', () => {
    const at = new Date('2026-10-13T00:00:00.000Z');
    assert.equal(parseUsage(snoozeLine(at, { costOnly: 2 }) + '\n').snooze.cost, 2);
    assert.equal(JSON.parse(snoozeLine(at, { costOnly: 2 }).split('\t')[8]).비용, 2);
    assert.equal(snoozeLine(at, { costOnly: 0 }), snoozeLine(at));
    assert.equal(parseUsage(snoozeLine(at) + '\n').snooze.cost, 0);
    for (const bad of ['"x"', '-1', '1.5', 'null']) {
      const line = ['미룸', '-', '미룸', at.toISOString(), '-', '-', '-', '-', `{"건수":true,"비용":${bad}}`].join('\t');
      assert.equal(parseUsage(line + '\n').snooze.cost, 0, bad);
    }
  });
});

describe('claudeMdSummary CLAUDE.md 정리 제안 대상', () => {
  const lines = (n, extra = []) => [...extra, ...Array.from({ length: n - extra.length }, (_, i) => `규칙 ${i}`)].join('\n') + '\n';

  it('파일이 없으면(null) exists가 false다', () => {
    assert.deepEqual(claudeMdSummary(null), { exists: false });
  });

  it(`${CLAUDE_MD_LIMIT_LINES}줄 이하는 대상이 아니고 ${CLAUDE_MD_LIMIT_LINES + 1}줄부터 대상이다`, () => {
    partialEqual(claudeMdSummary(lines(CLAUDE_MD_LIMIT_LINES)), { exists: true, total: 200, target: false, reason: '200줄 이하' });
    partialEqual(claudeMdSummary(lines(CLAUDE_MD_LIMIT_LINES + 1)), { total: 201, target: true, reason: '' });
  });

  it('그대로 두기로 한 줄 수보다 20줄까지 늘어난 것은 대상이 아니고 21줄 늘면 대상이다', () => {
    const kept = 230;
    partialEqual(claudeMdSummary(lines(kept + CLAUDE_MD_KEPT_MARGIN_LINES), kept), { target: false, reason: '정리 뒤 남긴 230줄에서 20줄 이내' });
    partialEqual(claudeMdSummary(lines(kept + CLAUDE_MD_KEPT_MARGIN_LINES + 1), kept), { target: true });
  });

  it('그대로 두기로 한 줄 수가 있어도 200줄 이하이면 200줄 이하가 까닭이다', () => {
    partialEqual(claudeMdSummary(lines(150), 100), { target: false, reason: '200줄 이하' });
  });

  it('키트 두 구역의 줄 수는 표시 줄을 넣어 따로 세고, 끝 표시가 없는 시작 표시는 세지 않는다', () => {
    const text = lines(220, ['<!-- subagent-system 시작 -->', 'a', 'b', '<!-- subagent-system 끝 -->', '<!-- claude-setup-kit extras 시작 -->', 'c', '<!-- claude-setup-kit extras 끝 -->']);
    partialEqual(claudeMdSummary(text), { total: 220, kit: 7 });
    assert.equal(claudeMdSummary(lines(10, ['<!-- subagent-system 시작 -->', 'a'])).kit, 0);
    assert.equal(claudeMdSummary(lines(10)).kit, 0);
  });

  it('parseConfig는 claudeMdKeptLines를 0 이상의 정수만 읽고 아니면 null이다', () => {
    assert.equal(parseConfig('{"claudeMdKeptLines":230}').claudeMdKeptLines, 230);
    for (const bad of ['"230"', '-1', '1.5', 'null', '[]']) assert.equal(parseConfig(`{"claudeMdKeptLines":${bad}}`).claudeMdKeptLines, null, bad);
    assert.equal(parseConfig('{}').claudeMdKeptLines, null);
  });

  it('회고 방식을 바꿔 설정 파일을 다시 써도 claudeMdKeptLines는 남는다', () => {
    const text = configTextWithMode('{"retroMode":"ask","claudeMdKeptLines":230}', 'auto');
    assert.equal(JSON.parse(text).claudeMdKeptLines, 230);
    assert.equal(JSON.parse(configTextWithFailures('{"claudeMdKeptLines":230,"retroFailures":1}', 0)).claudeMdKeptLines, 230);
  });

  it('claudeMdKeptLines만 뺀 설정 글을 만들고 다른 키는 남기며 깨진 글이면 null이다', () => {
    assert.deepEqual(JSON.parse(configTextWithoutKeptLines('{"retroMode":"auto","removedDefs":["a"],"claudeMdKeptLines":230}')), { retroMode: 'auto', removedDefs: ['a'] });
    assert.equal(configTextWithoutKeptLines('{'), null);
    assert.equal(configTextWithoutKeptLines(''), null);
  });

  it('claudeMdKeptLines만 바꾼 설정 글을 만들고 다른 키는 남기며 깨진 글이면 null이다', () => {
    assert.deepEqual(JSON.parse(configTextWithKeptLines('{"retroMode":"auto","claudeMdKeptLines":210}', 230)), { retroMode: 'auto', claudeMdKeptLines: 230 });
    assert.deepEqual(JSON.parse(configTextWithKeptLines('{"retroMode":"auto"}', 230)), { retroMode: 'auto', claudeMdKeptLines: 230 });
    assert.equal(configTextWithKeptLines('{', 230), null);
    assert.equal(configTextWithKeptLines('', 230), null);
  });
});

describe('retentionDays 설정 읽기', () => {
  const withSettings = (files) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retention-'));
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
    return dir;
  };

  it('설정이 없으면 30이다', () => {
    assert.equal(retentionDays(withSettings({})), 30);
  });

  it('settings.json의 값을 읽는다', () => {
    assert.equal(retentionDays(withSettings({ 'settings.json': '{"cleanupPeriodDays": 14}' })), 14);
  });

  it('settings.local.json만 유효하면 그 값을 읽는다', () => {
    assert.equal(retentionDays(withSettings({ 'settings.local.json': '{"cleanupPeriodDays": 45}' })), 45);
  });

  it('settings.local.json 60과 settings.json 20이 둘 다 유효하면 작은 값 20을 쓴다', () => {
    assert.equal(retentionDays(withSettings({ 'settings.json': '{"cleanupPeriodDays": 20}', 'settings.local.json': '{"cleanupPeriodDays": 60}' })), 20);
  });

  it('settings.local.json 10과 settings.json 20이 둘 다 유효하면 작은 값 10을 쓴다', () => {
    assert.equal(retentionDays(withSettings({ 'settings.json': '{"cleanupPeriodDays": 20}', 'settings.local.json': '{"cleanupPeriodDays": 10}' })), 10);
  });

  it('정수가 아니거나 1보다 작거나 파일이 깨졌으면 그 파일은 없는 것으로 보고 다른 파일의 값이나 30을 쓴다', () => {
    for (const bad of ['{"cleanupPeriodDays": 0}', '{"cleanupPeriodDays": -3}', '{"cleanupPeriodDays": 7.5}', '{"cleanupPeriodDays": "20"}', '{깨짐']) {
      assert.equal(retentionDays(withSettings({ 'settings.json': bad })), 30, bad);
      assert.equal(retentionDays(withSettings({ 'settings.json': '{"cleanupPeriodDays": 14}', 'settings.local.json': bad })), 14, bad);
    }
  });
});

describe('키트 파일 해시 순수 함수', () => {
  const guide = ['앞', '<!-- 사용자 표 시작 -->', '표', '<!-- 사용자 표 끝 -->', '중간', '<!-- 무조건 Opus 시작 -->', '목록', '<!-- 무조건 Opus 끝 -->', '<!-- 사용자 규칙 시작 -->', '<!-- 사용자 규칙 끝 -->', '뒤'].join('\n');

  it('guideTextOutsideZones는 세 구역의 표시 줄은 남기고 안쪽만 뺀다', () => {
    assert.equal(guideTextOutsideZones(guide), ['앞', '<!-- 사용자 표 시작 -->', '<!-- 사용자 표 끝 -->', '중간', '<!-- 무조건 Opus 시작 -->', '<!-- 무조건 Opus 끝 -->', '<!-- 사용자 규칙 시작 -->', '<!-- 사용자 규칙 끝 -->', '뒤'].join('\n'));
  });

  it('끝 표시가 없는 구역은 빼지 않고, CRLF 파일도 같은 결과다', () => {
    const open = '앞\n<!-- 사용자 표 시작 -->\n표\n뒤';
    assert.equal(guideTextOutsideZones(open), open);
    assert.equal(guideTextOutsideZones(guide.replace(/\n/g, '\r\n')), guideTextOutsideZones(guide));
  });

  it('definitionTextForHash는 frontmatter의 description과 글쓰기 줄만 빼고 본문의 description: 줄은 둔다', () => {
    const def = ['---', 'name: a', 'description: 첫 문장. 일. (가이드)', 'model: sonnet', '---', '본문', 'description: 본문에 있는 줄', '- 글은 필요한 말만 쓴다. 줄표를 쓰지 않는다.'].join('\n');
    assert.equal(definitionTextForHash(def), ['---', 'name: a', 'model: sonnet', '---', '본문', 'description: 본문에 있는 줄'].join('\n') + '\n');
  });

  it('definitionTextForHash는 글쓰기 줄을 빼고 남는 끝의 공백과 빈 줄 차이를 없앤다', () => {
    const base = ['---', 'name: a', '---', '본문'].join('\n');
    const line = '- 글은 필요한 말만 쓴다. 줄표를 쓰지 않는다.';
    const hashes = [`${base}\n`, base, `${base}\n\n`, `${base}\n${line}\n`, `${base}\n\n${line}\n`, `${base}\n\n${line}\n\n`, `${base}  \n${line}`].map(definitionTextForHash);
    assert.equal(new Set(hashes).size, 1, JSON.stringify(hashes));
    assert.notEqual(definitionTextForHash(`${base} 수정\n`), hashes[0]);
  });

  it('kitFileHashesOf는 sha256 16진 값만 남기고 객체가 아니면 null이다', () => {
    const h = 'a'.repeat(64);
    assert.deepEqual(kitFileHashesOf({ kitFileHashes: { x: h, y: 'zz', z: 5 } }), { x: h });
    for (const bad of [undefined, null, [], 'x', 5]) assert.equal(kitFileHashesOf({ kitFileHashes: bad }), null, String(bad));
    assert.equal(kitFileHashesOf(null), null);
  });

  it('diffKitHashes는 기록에 있는 파일만 견주고 다른 것, 없는 것, 같은 것을 센다', () => {
    const r = diffKitHashes({ a: '1', b: '2', c: '3' }, new Map([['a', '1'], ['b', 'x'], ['new', '9']]));
    assert.deepEqual(r, { changed: ['b'], missing: ['c'], removed: [], same: 1 });
  });

  it('diffKitHashes는 removedDefs에 든 이름의 정의 파일이 없으면 missing이 아니라 removed로 센다', () => {
    const recorded = { 'agents/opus-low.md': '1', 'agents/haiku-high.md': '2', 'agents/sonnet-low.md': '3', 'subagent-system/docs/RETRO.md': '4' };
    const r = diffKitHashes(recorded, new Map([['agents/sonnet-low.md', '3']]), ['opus-low', 'haiku-high', 'RETRO']);
    assert.deepEqual(r, { changed: [], missing: ['subagent-system/docs/RETRO.md'], removed: ['agents/opus-low.md', 'agents/haiku-high.md'], same: 1 });
  });

  it('configTextWithKitHashes는 다른 키를 두고 kitFileHashes만 바꾸며 설정 파일이 없거나 깨졌으면 null이다', () => {
    const next = JSON.parse(configTextWithKitHashes('{"roles":[],"kitFileHashes":{"old":"1"}}', { a: 'b' }));
    assert.deepEqual(next, { roles: [], kitFileHashes: { a: 'b' } });
    for (const bad of ['', '{', '[]']) assert.equal(configTextWithKitHashes(bad, {}), null, bad);
  });
});

describe('설정의 claudeMdLimitLines와 docReviewHashes', () => {
  const H = 'a'.repeat(64);

  it('기준 줄 수는 양의 정수일 때만 받고 아니면 기본 200줄이다', () => {
    assert.equal(parseConfig('{"claudeMdLimitLines":300}').claudeMdLimitLines, 300);
    for (const bad of ['0', '-5', '1.5', '"300"', 'null']) assert.equal(parseConfig(`{"claudeMdLimitLines":${bad}}`).claudeMdLimitLines, 200);
    assert.equal(parseConfig(null).claudeMdLimitLines, 200);
  });

  it('검토 해시는 sha256 16진 문자열인 항목만 받는다', () => {
    assert.deepEqual(parseConfig(JSON.stringify({ docReviewHashes: { '/a': H, '/b': 'zz', '/c': 3 } })).docReviewHashes, { '/a': H });
    assert.deepEqual(parseConfig('{"docReviewHashes":[1]}').docReviewHashes, {});
  });

  it('claudeMdSummary는 넘겨준 기준 줄 수로 정리 제안 대상을 가른다', () => {
    const text = Array.from({ length: 250 }, (_, i) => `규칙 ${i}`).join('\n') + '\n';
    assert.equal(claudeMdSummary(text, null, 300).target, false);
    assert.equal(claudeMdSummary(text, null, 300).reason, '300줄 이하');
    assert.equal(claudeMdSummary(text, null, 200).target, true);
  });

  it('configTextWithDocHashes는 다른 키와 이전 해시를 남기고 해시를 더하며, 깨진 설정에는 null이다', () => {
    const next = JSON.parse(configTextWithDocHashes(JSON.stringify({ retroMode: 'auto', docReviewHashes: { '/a': H } }), { '/b': 'b'.repeat(64) }));
    assert.deepEqual(next, { retroMode: 'auto', docReviewHashes: { '/a': H, '/b': 'b'.repeat(64) } });
    assert.equal(configTextWithDocHashes('{깨짐', { '/b': H }), null);
  });
});

describe('docReviewTargets', () => {
  const doc = (file, hash, uses = 0) => ({ file, hash, uses });

  it('지난 검토 뒤 해시가 같은 문서는 대상이 아니고 처음과 수정됨을 가른다', () => {
    const r = docReviewTargets([doc('/same', 'h1'), doc('/edited', 'h2'), doc('/new', 'h3')], { '/same': 'h1', '/edited': 'old' });
    assert.deepEqual(r.targets.map((d) => [d.file, d.state]).sort(), [['/edited', '수정됨'], ['/new', '처음']]);
    assert.equal(r.unchanged, 1);
  });

  it('한 번에 DOC_REVIEW_MAX개까지만 많이 쓴 것부터 고르고 나머지는 미룬다', () => {
    const docs = Array.from({ length: DOC_REVIEW_MAX + 2 }, (_, i) => doc(`/d${i}`, 'h', i));
    const r = docReviewTargets(docs, {});
    assert.equal(r.targets.length, DOC_REVIEW_MAX);
    assert.equal(r.targets[0].file, `/d${DOC_REVIEW_MAX + 1}`);
    assert.equal(r.deferred.length, 2);
  });
});

describe('extractSkillUses', () => {
  const skillCall = (ts, skill) => ({ type: 'assistant', timestamp: ts, message: { content: [{ type: 'tool_use', id: 't', name: 'Skill', input: { skill } }] } });

  it('Skill 도구 호출과 사용자가 친 슬래시 명령에서 스킬 이름을 모으고 앞의 슬래시는 뗀다', () => {
    const lines = [
      skillCall('2026-10-12T01:00:00Z', 'my-skill'),
      skillCall('2026-10-12T01:00:01Z', '/other'),
      { type: 'user', timestamp: '2026-10-12T01:00:02Z', message: { content: '<command-message>x</command-message>\n<command-name>/slashy</command-name>' } },
      { type: 'assistant', timestamp: '2026-10-12T01:00:03Z', message: { content: [{ type: 'tool_use', id: 'u', name: 'Bash', input: { command: 'ls' } }] } },
    ];
    assert.deepEqual(extractSkillUses(lines, null), ['my-skill', 'other', 'slashy']);
  });

  it('since보다 앞의 호출은 세지 않는다', () => {
    const lines = [skillCall('2026-10-10T00:00:00Z', 'old'), skillCall('2026-10-12T00:00:00Z', 'new')];
    assert.deepEqual(extractSkillUses(lines, new Date('2026-10-11T00:00:00Z')), ['new']);
  });
});

import { agentIdOf, memoMarks, parseFixes, fixLineFromArgs, judgeFixes, fixItemLine, similarTags, FIX_HEADER, mergedLabelRows } from '../subagentRetroHelpers.js';

describe('agentId 꼬리 떼기', () => {
  it('괄호 꼬리만 떼고 이름이 붙은 agentId는 그대로 둔다', () => {
    assert.equal(agentIdOf('add4fa4fc4b15a337(이어서)'), 'add4fa4fc4b15a337');
    assert.equal(agentIdOf('acab-qr-1d6679cb720078db'), 'acab-qr-1d6679cb720078db');
    assert.equal(agentIdOf('acab-qr-1d6679cb720078db(이어서)'), 'acab-qr-1d6679cb720078db');
    assert.equal(agentIdOf(null), null);
  });
});

describe('사용 기록 메모의 모자람과 개선 표시', () => {
  it('모자람은 태그를 쉼표로 여럿 받고 개선은 태그 하나를 받으며 태그 앞뒤 공백은 지운다', () => {
    assert.deepEqual(memoMarks('a1 모자람(a, b): x'), [{ kind: '모자람', tags: ['a', 'b'] }]);
    assert.deepEqual(memoMarks('a1 개선(c): y'), [{ kind: '개선', tags: ['c'] }]);
  });

  it('옛 꼴 모자람 콜론은 태그 없는 모자람으로 읽는다', () => {
    assert.deepEqual(memoMarks('a1 모자람: z'), [{ kind: '모자람', tags: [] }]);
  });

  it('닫는 괄호 바로 뒤에 콜론과 공백이 없으면 표시가 아니고, 말 중간의 개선 단어는 표시가 아니다', () => {
    assert.deepEqual(memoMarks('a1 랜딩 성능 개선(이미지) 지연'), []);
    assert.deepEqual(memoMarks('a1 모자람(a)x: y'), []);
    assert.deepEqual(memoMarks('a1 이름개선(a): y'), []);
  });
});

describe('고침 기록 파싱과 줄 만들기', () => {
  const row = () => ['2026-10-25T00:00:00.000Z', '/p', '프로젝트', '정정', '태그', 'CLAUDE.md#절', '문장', '10', '메모'].join('\t');

  it('머리줄과 열이 모자라거나 집합 밖인 줄은 건너뛰고 아홉 열을 읽는다', () => {
    const text = [FIX_HEADER, row(), '깨진 줄', ['2026-10-25T00:00:00.000Z', '/p', '프로젝트', '정정', '태그', 'x', '없는방식', '10', 'm'].join('\t')].join('\n');
    const fixes = parseFixes(text);
    assert.equal(fixes.length, 1);
    assert.deepEqual(fixes[0], { at: '2026-10-25T00:00:00.000Z', project: '/p', scope: '프로젝트', signal: '정정', label: '태그', where: 'CLAUDE.md#절', how: '문장', anchor: 10, memo: '메모' });
  });

  const args = ['--fix', '--project', '/home/u/proj/.claude/worktrees/w1', '--signal', '정정', '--label', '태그', '--where', 'docs/A.md#절', '--how', '문장', '--memo', '메모'];
  const NOW = new Date('2026-10-25T01:02:03.000Z');

  it('시각, 범위, 기준점을 채우고 프로젝트의 워크트리 꼬리를 뗀다', () => {
    const { line } = fixLineFromArgs(args, { now: NOW, lineCount: 42, claudeDir: '/home/u/.claude' });
    assert.deepEqual(line.split('\t'), ['2026-10-25T01:02:03.000Z', '/home/u/proj', '프로젝트', '정정', '태그', 'docs/A.md#절', '문장', '42', '메모']);
  });

  it('설치본 아래 경로는 틸드 꼴의 전역이고, 프로젝트 안 절대경로는 워크트리 꼬리를 뗀 상대경로다', () => {
    const swap = (where) => args.map((a) => (a === 'docs/A.md#절' ? where : a));
    const g = fixLineFromArgs(swap('/home/u/.claude/subagent-system/docs/SUBAGENT_GUIDE.md#기록'), { now: NOW, claudeDir: '/home/u/.claude' }).line.split('\t');
    assert.deepEqual([g[2], g[5]], ['전역', '~/.claude/subagent-system/docs/SUBAGENT_GUIDE.md#기록']);
    assert.equal(fixLineFromArgs(swap('~/.claude/CLAUDE.md#a'), { now: NOW }).line.split('\t')[2], '전역');
    const p = fixLineFromArgs(swap('/home/u/proj/.claude/worktrees/w1/docs/A.md#절'), { now: NOW, claudeDir: '/home/u/.claude' }).line.split('\t');
    assert.deepEqual([p[2], p[5]], ['프로젝트', 'docs/A.md#절']);
  });

  it('필수 인자가 빠지거나 값이 집합 밖이거나 이름표에 쉼표와 괄호가 있으면 오류다', () => {
    const without = (key) => args.filter((a, i) => a !== `--${key}` && args[i - 1] !== `--${key}`);
    for (const key of ['project', 'signal', 'label', 'where', 'how', 'memo']) assert.ok(fixLineFromArgs(without(key), { now: NOW }).error.includes(`--${key}`), key);
    const swap = (from, to) => args.map((a) => (a === from ? to : a));
    assert.ok(fixLineFromArgs(swap('정정', '불만'), { now: NOW }).error);
    assert.ok(fixLineFromArgs(swap('문장', '고침'), { now: NOW }).error);
    assert.ok(fixLineFromArgs(swap('태그', 'a,b'), { now: NOW }).error);
    assert.ok(fixLineFromArgs(swap('/home/u/proj/.claude/worktrees/w1', 'proj'), { now: NOW }).error);
  });

  it('방식 무관을 받고 읽는다', () => {
    const { line } = fixLineFromArgs(args.map((a) => (a === '문장' ? '무관' : a)), { now: NOW });
    assert.equal(parseFixes(line)[0].how, '무관');
  });
});

describe('judgeFixes 판정', () => {
  const T0 = '2026-10-20T00:00:00.000Z';
  const fix = (over = {}) => ({ at: T0, project: '/p', scope: '프로젝트', signal: '정정', label: '태그', where: 'A.md#절', how: '문장', anchor: 5, memo: '', ...over });
  let n = 0;
  const use = (memo, over = {}) => ({ line: ++n, date: '2026-10-21', project: '/p', def: 'sonnet-low', kind: '일', result: 'ok', memo, agentId: memo.split(/\s+/)[0], ...over });
  const cor = (session, time, over = {}) => ({ date: '2026-10-21', project: '/p', session, time, label: '태그', ...over });
  const run = (o) => judgeFixes({ lineCount: 1000, ...o });
  const classes = (r) => r.items.map((i) => `${i.cls} ${i.tag}`);

  it('쌓임은 고침이 없는 태그에 서로 다른 에이전트 둘이 모자람을 달아야 하고 같은 에이전트의 두 줄은 아니다', () => {
    const same = run({ usage: [use('a1 모자람(태그): x', { line: 1 }), use('a1 모자람(태그): y', { line: 2 })] });
    assert.deepEqual(classes(same), []);
    const two = run({ usage: [use('a1 모자람(태그): x', { line: 1 }), use('b2 모자람(태그): y', { line: 2 })] });
    assert.deepEqual(classes(two), ['쌓임 태그']);
    assert.equal(two.items[0].next, '문장 또는 체크리스트');
  });

  it('태그의 공백은 지우고 견주며 옛 꼴 모자람은 판정에 들지 않는다', () => {
    const r = run({ usage: [use('a1 모자람(지시 문장): x', { line: 1 }), use('b2 모자람(지시문장): y', { line: 2 }), use('c3 모자람: z', { line: 3 }), use('d4 모자람: z', { line: 4 })] });
    assert.deepEqual(classes(r), ['쌓임 지시 문장']);
  });

  it('개선은 한 건이면 되고 다음 방식은 문장 또는 체크리스트다', () => {
    const r = run({ usage: [use('a1 개선(태그): x', { line: 1 })] });
    assert.deepEqual(classes(r), ['개선 태그']);
    assert.equal(r.items[0].next, '문장 또는 체크리스트');
  });

  it('재발은 고친 뒤 사용 기록의 서로 다른 에이전트 둘이어야 하고 기준점 앞의 줄은 세지 않는다', () => {
    const fixes = [fix({ anchor: 3 })];
    const before = run({ fixes, usage: [use('a1 모자람(태그): x', { line: 2 }), use('b2 모자람(태그): y', { line: 3 }), use('c3 모자람(태그): z', { line: 4 })] });
    assert.deepEqual(classes(before), []);
    const after = run({ fixes, usage: [use('a1 모자람(태그): x', { line: 4 }), use('b2 모자람(태그): y', { line: 5 })] });
    assert.deepEqual(classes(after), ['재발 태그']);
    assert.equal(after.items[0].next, '스크립트 또는 훅');
  });

  it('재발의 다음 방식은 마지막 방식이 스크립트나 훅이면 바깥 자료 조사다', () => {
    const usage = [use('a1 모자람(태그): x', { line: 6 }), use('b2 모자람(태그): y', { line: 7 })];
    for (const how of ['스크립트', '훅']) assert.equal(run({ fixes: [fix({ how })], usage }).items[0].next, '바깥 자료 조사', how);
  });

  it('메모 첫 낱말의 이어서 꼬리는 떼고 견주며 근거에는 꼬리 없는 agentId가 보인다', () => {
    const tail = run({ usage: [use('a1 모자람(태그): x', { line: 1 }), use('a1(이어서) 모자람(태그): y', { line: 2 })] });
    assert.deepEqual(classes(tail), []);
    const two = run({ usage: [use('a1 모자람(태그): x', { line: 1 }), use('b2(이어서) 모자람(태그): y', { line: 2 })] });
    assert.deepEqual(two.items[0].parts, [{ name: '모자람', who: 'agentId', n: 2, ids: ['a1', 'b2'] }]);
  });

  it('이름이 붙은 서로 다른 agentId는 앞 16진수가 같아도 서로 다른 에이전트로 센다', () => {
    const r = run({ usage: [use('acab-qr-1d66 모자람(태그): x', { line: 1 }), use('acab-wide-4fb2 모자람(태그): y', { line: 2 })] });
    assert.deepEqual(classes(r), ['쌓임 태그']);
    assert.deepEqual(r.items[0].parts[0].ids, ['acab-qr-1d66', 'acab-wide-4fb2']);
  });

  it('재발은 정정 기록이면 고친 시각 뒤 서로 다른 세션 둘이어야 한다', () => {
    const one = run({ fixes: [fix()], corrections: [cor('s1', '2026-10-21T00:00:00Z'), cor('s1', '2026-10-22T00:00:00Z')] });
    assert.deepEqual(classes(one), []);
    const old = run({ fixes: [fix()], corrections: [cor('s1', '2026-10-19T00:00:00Z'), cor('s2', '2026-10-19T01:00:00Z')] });
    assert.deepEqual(classes(old), []);
    const two = run({ fixes: [fix()], corrections: [cor('s1', '2026-10-21T00:00:00Z'), cor('s2', '2026-10-22T00:00:00Z')] });
    assert.deepEqual(classes(two), ['재발 태그']);
  });

  it('물음, 유지, 되돌림으로 닫은 뒤에는 그 기록 뒤의 줄로 다시 판정한다', () => {
    for (const how of ['물음', '유지', '되돌림']) {
      const usage = [use('a1 모자람(태그): x', { line: 6 }), use('b2 모자람(태그): y', { line: 7 }), use('c3 모자람(태그): x', { line: 12 }), use('d4 모자람(태그): y', { line: 13 })];
      const fixes = [fix({ how, anchor: 10 })];
      assert.deepEqual(classes(run({ fixes, usage: usage.slice(0, 2) })), [], how);
      assert.deepEqual(classes(run({ fixes, usage })), ['쌓임 태그'], how);
    }
  });

  it('프로젝트를 주지 않아도 마지막 고침의 범위가 프로젝트이면 그 프로젝트의 사용 기록과 정정 기록만 센다', () => {
    const usage = [use('a1 모자람(태그): x', { line: 6 }), use('b2 모자람(태그): y', { line: 7, project: '/q' })];
    const corrections = [cor('s1', '2026-10-21T00:00:00Z'), cor('s2', '2026-10-22T00:00:00Z', { project: '/q' })];
    assert.deepEqual(classes(run({ fixes: [fix()], usage, corrections })), []);
    assert.deepEqual(classes(run({ fixes: [fix({ scope: '전역' })], usage, corrections })), ['재발 태그']);
  });

  it('무관 기록은 이름표 판정에서 없는 기록처럼 건너뛴다', () => {
    const fixes = [fix({ anchor: 3 }), fix({ how: '무관', anchor: 10, at: '2026-10-22T00:00:00.000Z' })];
    const r = run({ fixes, usage: [use('a1 모자람(태그): x', { line: 6 }), use('b2 모자람(태그): y', { line: 7 })] });
    assert.deepEqual(classes(r), ['재발 태그']);
    assert.equal(r.table[0].fixes, 1);
    assert.equal(r.table[0].last.how, '문장');
  });

  it('고침 기록도 처리할 것도 없는 이름표는 효과 표에서 뺀다', () => {
    const r = run({ fixes: [fix({ label: '닫힘', how: '물음' })], usage: [use('a1 모자람(지켜봄): x', { line: 1 })] });
    assert.deepEqual(r.table.map((t) => t.tag), ['닫힘']);
    assert.equal(r.tags.length, 2);
  });

  it('처리할 것 줄은 모자람과 정정을 나눠 건수와 근거를 적는다', () => {
    const r = run({ fixes: [fix()], usage: [use('a1 모자람(태그): x', { line: 6 }), use('b2 모자람(태그): y', { line: 7 })], corrections: [cor('s1', '2026-10-21T00:00:00Z'), cor('s2', '2026-10-22T00:00:00Z')] });
    assert.equal(fixItemLine(r.items[0]), `- 재발 태그: 모자람 2건(agentId a1, b2), 정정 2건(세션 s1, s2), 마지막 고침 ${T0} 문장 A.md#절, 다음 방식 스크립트 또는 훅`);
    const only = run({ fixes: [fix()], corrections: [cor('s1', '2026-10-21T00:00:00Z'), cor('s2', '2026-10-22T00:00:00Z')] });
    assert.match(fixItemLine(only.items[0]), /^- 재발 태그: 정정 2건\(세션 s1, s2\), 마지막 고침/);
  });

  it('프로젝트를 주면 그 프로젝트의 줄과 범위가 전역인 고침만 센다', () => {
    const fixes = [fix({ project: '/q', label: '남의것' }), fix({ project: '/q', scope: '전역', label: '공통' })];
    const usage = [use('a1 개선(남의것): x', { project: '/q' }), use('a1 개선(내것): x')];
    const r = run({ fixes, usage, project: '/p' });
    assert.deepEqual(r.table.map((t) => t.tag).sort(), ['공통', '내것']);
  });

  it('기준점이 사용 기록 줄 수보다 큰 고침은 경고 건수에 든다', () => {
    assert.equal(judgeFixes({ fixes: [fix({ anchor: 50 }), fix({ anchor: 3 })], lineCount: 10 }).warn, 1);
  });

  describe('나빠짐 의심', () => {
    const bad = (i, over = {}) => use(`a${i} 모자람(다른): x`, { result: 'ok', ...over });
    const series = (count, badEvery, start) => Array.from({ length: count }, (_, i) => (badEvery && i % badEvery === 0 ? bad(start + i, { line: start + i }) : use(`z${start + i} ok`, { line: start + i })));
    const worse = (r) => classes(r).filter((c) => c.startsWith('나빠짐'));
    const f = (over = {}) => fix({ label: '고침', anchor: 50, ...over });

    it('뒤 비율이 앞 비율의 1.5배를 넘으면 걸리고 정확히 1.5배면 걸리지 않는다', () => {
      const lines = (preBad, postBad) => [...series(50, 0, 1).map((r, i) => (i < preBad ? bad(i, { line: r.line }) : r)), ...series(50, 0, 51).map((r, i) => (i < postBad ? bad(i + 100, { line: r.line }) : r))];
      assert.deepEqual(worse(run({ fixes: [f()], usage: lines(10, 16) })), ['나빠짐 의심 고침']);
      assert.deepEqual(worse(run({ fixes: [f()], usage: lines(10, 15) })), []);
    });

    it('뒤 줄이 30줄 미만이면 판정하지 않고 30줄이면 판정한다', () => {
      const lines = (post) => [...series(50, 0, 1).map((r, i) => (i < 1 ? bad(i, { line: r.line }) : r)), ...series(post, 1, 51)];
      assert.deepEqual(worse(run({ fixes: [f()], usage: lines(29) })), []);
      assert.deepEqual(worse(run({ fixes: [f()], usage: lines(30) })), ['나빠짐 의심 고침']);
    });

    it('뒤가 50줄 미만이면 앞도 같은 줄 수만 견준다', () => {
      const usage = [...series(40, 0, 1).map((r, i) => (i < 5 || i >= 37 ? bad(i, { line: r.line }) : r)), ...series(30, 0, 41).map((r, i) => (i < 6 ? bad(i + 100, { line: r.line }) : r))];
      assert.deepEqual(worse(run({ fixes: [f({ anchor: 40 })], usage })), ['나빠짐 의심 고침']);
    });

    it('같은 고친 곳에 되돌림이나 유지 기록이 뒤따르면 닫히고 다음 방식은 되돌리기 검토다', () => {
      const usage = [...series(50, 0, 1), ...series(40, 1, 51)];
      const r = run({ fixes: [f()], usage });
      assert.equal(r.items.find((i) => i.cls === '나빠짐 의심').next, '되돌리기 검토');
      for (const how of ['되돌림', '유지', '무관']) assert.deepEqual(worse(run({ fixes: [f(), f({ how, anchor: 100 })], usage })), [], how);
    });

    it('뒤쪽 나쁜 줄이 3건 미만이면 비율이 몇 배로 늘어도 걸리지 않는다', () => {
      const lines = (postBad) => [...series(50, 0, 1), ...series(30, 0, 51).map((r, i) => (i < postBad ? bad(i + 100, { line: r.line }) : r))];
      assert.deepEqual(worse(run({ fixes: [f()], usage: lines(2) })), []);
      assert.deepEqual(worse(run({ fixes: [f()], usage: lines(3) })), ['나빠짐 의심 고침']);
    });

    it('뒤 비율이 앞 비율보다 0.1 이상 늘어야 걸리고 0.1 미만이면 걸리지 않는다', () => {
      const lines = (preBad, postBad) => [...series(50, 0, 1).map((r, i) => (i < preBad ? bad(i, { line: r.line }) : r)), ...series(50, 0, 51).map((r, i) => (i < postBad ? bad(i + 100, { line: r.line }) : r))];
      assert.deepEqual(worse(run({ fixes: [f()], usage: lines(1, 4) })), [], '4/50 - 1/50 = 0.06');
      assert.deepEqual(worse(run({ fixes: [f()], usage: lines(2, 8) })), ['나빠짐 의심 고침'], '8/50 - 2/50 = 0.12');
      assert.deepEqual(worse(run({ fixes: [f()], usage: lines(0, 5) })), ['나빠짐 의심 고침'], '5/50 - 0 = 0.1');
    });
  });

  it('효과 표는 뒤 줄이 30줄 미만이면 판정 기다림, 이상이면 유지다', () => {
    const rows = (count) => Array.from({ length: count }, (_, i) => use(`z${i} ok`, { line: 6 + i }));
    assert.equal(run({ fixes: [fix()], usage: rows(29) }).table[0].cls, '판정 기다림');
    assert.equal(run({ fixes: [fix()], usage: rows(30) }).table[0].cls, '유지');
  });
});

describe('비슷한 태그 찾기', () => {
  it('공백을 뺀 문자열이 서로를 포함하거나 편집 거리가 2 이하이면 비슷하다', () => {
    assert.deepEqual(similarTags('지시문 목표', ['지시문 목표줄', '전혀 다른 이름']), ['지시문 목표줄']);
    assert.deepEqual(similarTags('abcdef', ['abcxyf', 'abcxyz']), ['abcxyf']);
  });

  it('공백을 뺀 값이 같으면 같은 태그라 비슷한 태그로 치지 않는다', () => {
    assert.deepEqual(similarTags('지시문 목표', ['지시문목표']), []);
  });
});

describe('정정 이름표 목록에 합치기', () => {
  it('고침 기록 이름표와 사용 기록 태그를 정정 이름표와 공백을 뺀 기준으로 한 이름에 합친다', () => {
    const rows = mergedLabelRows([{ label: '지시 문장', date: 'd', message: 'm' }], [{ at: '2026-10-01T00:00:00Z', label: '지시문장' }], [{ memo: 'a1 모자람(지시  문장): x' }]);
    assert.equal(new Set(rows.map((r) => r.label)).size, 1);
    assert.equal(rows.length, 3);
  });
});
