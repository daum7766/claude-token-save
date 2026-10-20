import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  parseStepLabel,
  findProcedureRuns,
  RUN_GAP_SEC,
  EXCLUDED_KINDS,
  cellCandidates,
  procedureCandidates,
  pendingTargets,
  parseSpeedLog,
  speedLogLine,
  pickTarget,
  effects,
} from '../speedReviewHelpers.js';

const tempRoots = [];
after(() => {
  for (const r of tempRoots) fs.rmSync(r, { recursive: true, force: true });
});

const SESSION = '11111111-2222-3333-4444-555555555555';
const min = (m) => new Date(Date.UTC(2026, 9, 10, 0, 0, 0) + m * 60000).toISOString();
const MIN = 60000;
const base = Date.UTC(2026, 9, 10, 0, 0, 0);

// 임시 프로젝트 폴더에 메인 세션 기록과 서브에이전트 기록을 만든다.
function build({ main, agents = {}, cwd = '/p/proj' }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'speed-review-'));
  tempRoots.push(root);
  const proj = path.join(root, 'projects', '-p-proj');
  fs.mkdirSync(path.join(proj, SESSION, 'subagents'), { recursive: true });
  const w = (f, rows) => fs.writeFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  w(path.join(proj, `${SESSION}.jsonl`), [{ type: 'user', timestamp: min(-1), cwd, message: { content: 'hi' } }, ...main]);
  for (const [id, rows] of Object.entries(agents)) w(path.join(proj, SESSION, 'subagents', `agent-${id}.jsonl`), rows);
  return path.join(proj, `${SESSION}.jsonl`);
}

const use = (m, id, name, input) => ({ type: 'assistant', timestamp: min(m), uuid: `a-${id}`, message: { id: `m-${id}`, content: [{ type: 'tool_use', id, name, input }] } });
const result = (m, id, agentId) => ({
  type: 'user',
  timestamp: min(m),
  ...(agentId ? { toolUseResult: { isAsync: true, status: 'async_launched', agentId } } : {}),
  message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'x' }] },
});
const text = (m, t = 'ok') => ({ type: 'assistant', timestamp: min(m), uuid: `t-${m}`, message: { id: `mt-${m}`, content: [{ type: 'text', text: t }] } });
const userMsg = (m, t = 'next', extra = {}) => ({ type: 'user', timestamp: min(m), message: { content: t }, ...extra });
const agentCall = (m, id, label, agentId, resultMin = m) => [use(m, id, 'Agent', { description: label, prompt: 'p' }), result(resultMin, id, agentId)];
const bashCall = (m, id, label, endMin) => [use(m, id, 'Bash', { description: label, command: 'true' }), result(endMin, id)];
const agentFile = (segments) =>
  segments.flatMap(([a, b], i) => [userMsg(a, i === 0 ? 'go' : 'again'), text(b)]);

describe('parseStepLabel', () => {
  it('대괄호 머리의 절차 이름과 단계 번호를 읽는다', () => {
    assert.deepEqual(parseStepLabel('[검증 5] 브라우저 확인'), { name: '검증', step: 5 });
  });

  it('머리가 없는 설명은 단계 표시가 아니다', () => {
    assert.equal(parseStepLabel('브라우저 확인'), null);
    assert.equal(parseStepLabel(undefined), null);
  });

  it('절차 이름에 공백과 숫자가 들어 있어도 마지막 숫자를 단계로 읽는다', () => {
    assert.deepEqual(parseStepLabel('[검증 6단계 5] x'), { name: '검증 6단계', step: 5 });
  });
});

describe('findProcedureRuns', () => {
  it('표시 붙은 호출이 30분 간격이면 한 회차로 묶는다', () => {
    const f = build({ main: [...bashCall(0, 'b1', '[검증 1] a', 1), ...bashCall(31, 'b2', '[검증 2] b', 32)] });
    const runs = findProcedureRuns(f);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].name, '검증');
    assert.deepEqual(runs[0].steps.map((s) => s.step), [1, 2]);
  });

  it('표시 붙은 호출이 앞 호출이 끝난 뒤 61분 떨어지면 새 회차로 가른다', () => {
    assert.equal(RUN_GAP_SEC, 3600);
    const f = build({ main: [...bashCall(0, 'b1', '[검증 1] a', 1), ...bashCall(62, 'b2', '[검증 2] b', 63)] });
    assert.equal(findProcedureRuns(f).length, 2);
  });

  it('긴 단계가 백그라운드 서브에이전트로 도는 동안은 호출 시작 간격이 길어도 한 회차다', () => {
    const f = build({
      main: [...agentCall(0, 'g5', '[검증 5] 브라우저', 'ag5', 1), ...bashCall(100, 'b6', '[검증 6] 정리', 101)],
      agents: { ag5: agentFile([[0, 90]]) },
    });
    const runs = findProcedureRuns(f);
    assert.equal(runs.length, 1);
    assert.deepEqual(runs[0].steps.map((s) => s.step), [5, 6]);
  });

  it('서브에이전트가 이어서 받은 일의 활동 구간은 첫 일과 따로 세어 그 사이는 기다림에 넣지 않는다', () => {
    const f = build({
      main: agentCall(0, 'g1', '[검증 5] x', 'ag1', 1),
      agents: { ag1: agentFile([[0, 20], [90, 100]]) },
    });
    const [run] = findProcedureRuns(f);
    assert.equal(run.subagentSec, 30 * 60);
    assert.equal(run.end, base + 100 * MIN);
  });

  it('워크트리에서 시작한 세션도 본 프로젝트 경로로 돌려준다', () => {
    const f = build({ main: bashCall(0, 'b1', '[검증 1] a', 1), cwd: '/p/.claude/worktrees/x' });
    assert.equal(findProcedureRuns(f)[0].project, '/p');
  });

  it('도중 수정으로 앞 단계를 다시 돌려도 한 회차에 단계가 들어간 순서대로 남는다', () => {
    const f = build({
      main: [...bashCall(0, 'a', '[검증 1] a', 1), ...bashCall(2, 'b', '[검증 2] b', 3), ...bashCall(4, 'c', '[검증 5] c', 5), ...bashCall(6, 'd', '[검증 1] a', 7)],
    });
    const runs = findProcedureRuns(f);
    assert.equal(runs.length, 1);
    assert.deepEqual(runs[0].steps.map((s) => s.step), [1, 2, 5, 1]);
  });

  it('백그라운드 호출의 결과가 곧바로 와도 회차 끝은 서브에이전트 기록의 마지막 시각까지 늘고 그 구간을 서브에이전트 시간으로 센다', () => {
    const f = build({
      main: [...agentCall(0, 'g1', '[검증 5] x', 'ag1', 0.02), text(1), userMsg(25)],
      agents: { ag1: agentFile([[0, 20]]) },
    });
    const [run] = findProcedureRuns(f);
    assert.equal(run.end, base + 20 * MIN);
    assert.equal(run.subagentSec, 20 * 60);
    assert.equal(run.totalSec, 20 * 60);
  });

  it('표시가 하나도 없는 세션은 빈 배열이다', () => {
    const f = build({ main: [...bashCall(0, 'b1', '그냥 명령', 1), text(2)] });
    assert.deepEqual(findProcedureRuns(f), []);
  });

  it('메인 직접, 서브에이전트 기다림, 사용자 기다림을 더하면 전체와 같고 겹치는 구간은 서브에이전트 쪽으로만 센다', () => {
    const f = build({
      main: [
        ...agentCall(0, 'g1', '[검증 5] x', 'ag1', 0.02),
        text(1, '맡겼습니다'),
        userMsg(8, '계속'),
        ...bashCall(9, 'b2', '[검증 6] y', 12),
        text(13, '끝났습니다'),
        userMsg(18, '고마워'),
        ...bashCall(19, 'b3', '[검증 7] z', 20),
      ],
      agents: { ag1: agentFile([[0, 10]]) },
    });
    const [run] = findProcedureRuns(f);
    assert.equal(run.totalSec, 20 * 60);
    assert.equal(run.subagentSec, 10 * 60);
    // 1~8분은 서브에이전트가 도는 중이라 사용자 기다림에서 빠지고, 13~18분만 사용자 몫이다.
    assert.equal(run.userWaitSec, 5 * 60);
    assert.equal(run.mainSec, 5 * 60);
    assert.equal(run.mainSec + run.subagentSec + run.userWaitSec, run.totalSec);
  });

  it('sinceMs 이전에 시작한 표시 호출은 회차에 넣지 않는다', () => {
    const f = build({ main: [...bashCall(0, 'b1', '[검증 1] a', 1), ...bashCall(200, 'b2', '[검증 1] a', 201)] });
    const runs = findProcedureRuns(f, { sinceMs: base + 100 * MIN });
    assert.equal(runs.length, 1);
    assert.equal(runs[0].start, base + 200 * MIN);
  });
});

// 사용 기록 행(parseUsage의 행 꼴)을 만든다.
const urow = (line, def, kind, agentId, seconds) => ({ line, def, kind, agentId, seconds });
const cellOf = (def, kindName, agents) => ({ target: `칸:${def}/${kindName}`, kind: 'cell', def, kindName, agents, totalSec: agents.reduce((s, a) => s + a.sec, 0) });
const agentsOf = (ids, sec, firstLine = 1) => ids.map((id, i) => ({ id, sec, line: firstLine + i }));
const procOf = (project, name, runs) => ({ target: `절차:${project}/${name}`, kind: 'procedure', runs, totalSec: runs.reduce((s, r) => s + r.totalSec, 0) });
const runOf = (start, totalSec, agents = []) => ({ project: '/p', session: 's', name: '검증', start, end: start + totalSec * 1000, steps: [], agents, mainSec: totalSec, subagentSec: 0, userWaitSec: 0, totalSec });

describe('cellCandidates', () => {
  it('같은 agentId의 줄은 초를 더해 한 에이전트로 세고 줄 번호는 그 에이전트의 마지막 줄이다', () => {
    const cells = cellCandidates([urow(2, 'sonnet-low', '구현', 'a1', 100), urow(5, 'sonnet-low', '구현', 'a1', 50), urow(7, 'sonnet-low', '구현', 'a2', 30)]);
    assert.equal(cells.length, 1);
    assert.equal(cells[0].target, '칸:sonnet-low/구현');
    assert.deepEqual(cells[0].agents, [{ id: 'a1', sec: 150, line: 5 }, { id: 'a2', sec: 30, line: 7 }]);
    assert.equal(cells[0].totalSec, 180);
  });

  it('agentId 뒤에 꼬리가 붙은 줄과 꼬리 없는 줄은 같은 에이전트 한 건으로 센다', () => {
    const cells = cellCandidates([urow(1, 'sonnet-low', '구현', 'add4fa4fc4b15a337(이어서)', 100), urow(2, 'sonnet-low', '구현', 'add4fa4fc4b15a337', 50)]);
    assert.deepEqual(cells[0].agents, [{ id: 'add4fa4fc4b15a337', sec: 150, line: 2 }]);
  });

  it('회고 자체의 일 종류는 후보에서 뺀다', () => {
    const rows = EXCLUDED_KINDS.map((kind, i) => urow(i + 1, 'opus-medium', kind, `x${i}`, 60));
    assert.deepEqual(cellCandidates(rows), []);
  });

  it('초를 적지 않은 에이전트는 후보의 에이전트 수와 합계에 넣지 않는다', () => {
    const cells = cellCandidates([urow(1, 'sonnet-low', '구현', 'a1', null), urow(2, 'sonnet-low', '구현', 'a2', 40)]);
    assert.deepEqual(cells[0].agents.map((a) => a.id), ['a2']);
  });
});

describe('procedureCandidates', () => {
  it('프로젝트와 절차 이름이 같은 회차를 묶어 합계를 낸다', () => {
    const runs = [runOf(0, 100), runOf(1, 200), { ...runOf(2, 50), name: '배포' }];
    const c = procedureCandidates(runs);
    const verify = c.find((x) => x.target === '절차:/p/검증');
    assert.equal(verify.runs.length, 2);
    assert.equal(verify.totalSec, 300);
    assert.equal(c.length, 2);
  });

  it('프로젝트를 알 수 없는 회차는 후보에서 뺀다', () => {
    assert.deepEqual(procedureCandidates([{ ...runOf(0, 100), project: '' }]), []);
  });
});

describe('pendingTargets', () => {
  it('속도 개선과 측정 요청 제목의 대상을 모으고 일 종류의 공백과 제목 구분 슬래시를 구별한다', () => {
    const t = pendingTargets('## 속도 개선: 칸:sonnet-medium/목업 수정 / 바뀐 구간만 렌더\n- 왜: x\n\n## 측정 요청: 절차:/p/검증 / 5단계 초\n## 다른 제목: 칸:a/b / c\n');
    assert.deepEqual([...t].sort(), ['절차:/p/검증', '칸:sonnet-medium/목업 수정'].sort());
  });

  it('파일이 없거나 비어 있으면 빈 집합이다', () => {
    assert.equal(pendingTargets(null).size, 0);
    assert.equal(pendingTargets('').size, 0);
  });
});

describe('speedLog', () => {
  const entry = { at: '2026-10-10T00:00:00.000Z', type: '적용', target: '칸:a/b c', what: '속도 개선', beforeAvg: 900.5, beforeCount: 3, usageLines: 10, note: '요지' };

  it('한 줄로 쓴 항목을 다시 읽으면 같은 항목이고 머리줄은 건너뛴다', () => {
    const text = `시각\t종류\t대상\t무엇\t전 평균 초\t전 건수\t사용 기록 줄 수\t내용\n${speedLogLine(entry)}\n`;
    assert.deepEqual(parseSpeedLog(text), [entry]);
  });

  it('측정 항목의 빈 칸(-)은 null로 읽고 다시 쓰면 같은 줄이다', () => {
    const m = { at: entry.at, type: '측정', target: entry.target, what: '-', beforeAvg: null, beforeCount: null, usageLines: null, note: '대기 12' };
    assert.deepEqual(parseSpeedLog(speedLogLine(m)), [m]);
  });

  it('내용의 탭과 줄바꿈은 빈칸으로 바꿔 열이 밀리지 않는다', () => {
    const line = speedLogLine({ ...entry, note: 'a\tb\nc' });
    assert.equal(line.split('\n').length, 1);
    assert.equal(parseSpeedLog(line)[0].note, 'a b c');
  });

  it('파일이 없으면 빈 배열이다', () => {
    assert.deepEqual(parseSpeedLog(null), []);
  });
});

describe('pickTarget', () => {
  const A = cellOf('sonnet-medium', 'A', agentsOf(['a1', 'a2', 'a3'], 600));
  const B = cellOf('sonnet-medium', 'B', agentsOf(['b1'], 1500));
  const P = procOf('/p', '검증', [runOf(0, 700, ['a1', 'a2']), runOf(1, 700, ['x'])]);

  it('합계가 가장 큰 후보를 고르고 한 번뿐인 후보는 뺀다', () => {
    assert.equal(pickTarget({ cells: [A, B], procedures: [] }).target, A.target);
  });

  it('칸의 에이전트 절반 이상이 한 절차 회차에 들면 그 절차를 고른다', () => {
    assert.equal(pickTarget({ cells: [A, B], procedures: [P] }).target, P.target);
  });

  it('칸의 에이전트가 절반 미만만 절차에 들면 칸을 고른다', () => {
    const p = procOf('/p', '검증', [runOf(0, 700, ['a1']), runOf(1, 700, ['x'])]);
    assert.equal(pickTarget({ cells: [A], procedures: [p] }).target, A.target);
  });

  it('칸의 agentId가 앞 8자뿐이어도 절차 회차의 전체 agentId와 앞부분이 같으면 같은 에이전트로 센다', () => {
    const cell = cellOf('sonnet-medium', 'A', agentsOf(['abcdef12', 'bcdef123'], 600));
    const p = procOf('/p', '검증', [runOf(0, 100, ['abcdef1234567890a', 'bcdef12399999']), runOf(1, 100, ['x'])]);
    assert.equal(pickTarget({ cells: [cell], procedures: [p] }).target, p.target);
  });

  it('회고 자체의 일 종류만 있으면 null이다', () => {
    const cells = cellCandidates(EXCLUDED_KINDS.flatMap((kind, i) => [urow(2 * i + 1, 'opus-medium', kind, `x${i}`, 60), urow(2 * i + 2, 'opus-medium', kind, `y${i}`, 60)]));
    assert.equal(pickTarget({ cells, procedures: [] }), null);
  });

  it('물을 것에 답 없이 남은 대상은 고르지 않는다', () => {
    const pending = pendingTargets(`## 속도 개선: ${A.target} / 요지\n`);
    assert.equal(pickTarget({ cells: [A], procedures: [], pending }), null);
  });

  it('적용 뒤 기록이 없는 대상은 고르지 않고 뒤 기록이 생기면 다시 고른다', () => {
    const applied = { at: '2026-10-10T00:00:00.000Z', type: '적용', target: A.target, what: '속도 개선', beforeAvg: 600, beforeCount: 3, usageLines: 3, note: '' };
    assert.equal(pickTarget({ cells: [A], procedures: [], speedLog: [applied] }), null);
    const later = cellOf('sonnet-medium', 'A', [...agentsOf(['a1', 'a2', 'a3'], 600), { id: 'a4', sec: 100, line: 4 }]);
    assert.equal(pickTarget({ cells: [later], procedures: [], speedLog: [applied] }).target, A.target);
  });

  it('절차는 적용 시각 뒤에 시작한 회차가 생기면 다시 고른다', () => {
    const at = '2026-10-10T00:00:00.000Z';
    const applied = { at, type: '적용', target: P.target, what: '속도 개선', beforeAvg: 700, beforeCount: 2, usageLines: 0, note: '' };
    const t = Date.parse(at);
    const before = procOf('/p', '검증', [runOf(t - 2000, 700), runOf(t - 1000, 700)]);
    assert.equal(pickTarget({ cells: [], procedures: [before], speedLog: [applied] }), null);
    const after = procOf('/p', '검증', [runOf(t - 1000, 700), runOf(t + 1000, 700)]);
    assert.equal(pickTarget({ cells: [], procedures: [after], speedLog: [applied] }).target, P.target);
  });
});

describe('pickTarget 측정 먼저', () => {
  const big = cellOf('sonnet-medium', 'A', agentsOf(['a1', 'a2', 'a3'], 600));
  const small = cellOf('sonnet-medium', 'S', agentsOf(['s1', 's2'], 60));
  const entry = (at, type, what) => ({ at, type, target: small.target, what, beforeAvg: null, beforeCount: null, usageLines: 0, note: '' });
  const request = entry('2026-10-10T00:00:00.000Z', '적용', '측정 요청');
  const m1 = entry('2026-10-11T00:00:00.000Z', '측정', '-');
  const m2 = entry('2026-10-12T00:00:00.000Z', '측정', '-');

  it('측정 요청 적용 뒤 측정이 2건 쌓인 대상은 합계가 더 큰 대상이 있어도 먼저 고른다', () => {
    assert.equal(pickTarget({ cells: [big, small], procedures: [], speedLog: [request, m1, m2] }).target, small.target);
  });

  it('측정이 1건뿐이면 합계 1위를 고른다', () => {
    assert.equal(pickTarget({ cells: [big, small], procedures: [], speedLog: [request, m1] }).target, big.target);
  });

  it('측정 2건 뒤 속도 개선을 적용한 대상은 먼저 고르지 않는다', () => {
    const improved = entry('2026-10-13T00:00:00.000Z', '적용', '속도 개선');
    assert.equal(pickTarget({ cells: [big, small], procedures: [], speedLog: [request, m1, m2, improved] }).target, big.target);
  });
});

describe('effects', () => {
  const at = '2026-10-10T00:00:00.000Z';
  const applied = { at, type: '적용', target: '칸:sonnet-medium/A', what: '속도 개선', beforeAvg: 900, beforeCount: 3, usageLines: 10, note: '' };

  it('적용 줄에 남긴 줄 수보다 뒤 줄의 에이전트만 적용 뒤로 세어 평균을 낸다', () => {
    const cell = cellOf('sonnet-medium', 'A', [
      { id: 'old', sec: 5000, line: 10 },
      { id: 'n1', sec: 200, line: 11 },
      { id: 'n2', sec: 400, line: 12 },
    ]);
    assert.deepEqual(effects({ speedLog: [applied], cellsAll: [cell], proceduresAll: [] }), [
      { target: applied.target, appliedAt: at, what: '속도 개선', beforeAvg: 900, beforeCount: 3, afterAvg: 300, afterCount: 2 },
    ]);
  });

  it('적용 뒤 기록이 없으면 afterAvg가 null이다', () => {
    const cell = cellOf('sonnet-medium', 'A', [{ id: 'old', sec: 5000, line: 10 }]);
    const [e] = effects({ speedLog: [applied], cellsAll: [cell], proceduresAll: [] });
    assert.equal(e.afterAvg, null);
    assert.equal(e.afterCount, 0);
  });

  it('절차는 회차 시작 시각과 적용 시각으로 앞뒤를 가른다', () => {
    const t = Date.parse(at);
    const proc = procOf('/p', '검증', [runOf(t - 1000, 1000), runOf(t + 1000, 300), runOf(t + 5000, 500)]);
    const a = { ...applied, target: proc.target, beforeAvg: 1000, beforeCount: 1, usageLines: 0 };
    const [e] = effects({ speedLog: [a], cellsAll: [], proceduresAll: [proc] });
    assert.equal(e.afterAvg, 400);
    assert.equal(e.afterCount, 2);
  });

  it('측정 요청 적용과 측정 줄은 효과 목록에 넣지 않는다', () => {
    const rows = [{ ...applied, what: '측정 요청' }, { ...applied, type: '측정', what: '-' }];
    assert.deepEqual(effects({ speedLog: rows, cellsAll: [], proceduresAll: [] }), []);
  });
});

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(SCRIPTS, 'speed-review.js');
const USAGE_HEADER = '날짜\t프로젝트\t정의\t일 종류\t토큰\t도구\t초\t결과\t메모';
const LONG_CMD = `cd /work/proj && node -e "${'console.log(1);'.repeat(40)}" && rm -rf /nonexistent/gone-script.mjs`;

const jl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
const at = (sec) => new Date(Date.UTC(2026, 9, 10, 0, 0, sec)).toISOString();

// 설정 폴더와 기록 폴더를 임시 폴더로 바꿔 실제 기록을 읽거나 쓰지 않는다.
function cliSetup({ usage = null, transcripts = [], session = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'speed-cli-'));
  tempRoots.push(root);
  const claude = path.join(root, 'claude');
  const records = path.join(root, 'records');
  const proj = path.join(claude, 'projects', '-work-proj');
  fs.mkdirSync(path.join(proj, SESSION, 'subagents'), { recursive: true });
  fs.mkdirSync(records, { recursive: true });
  for (const id of transcripts) {
    fs.writeFileSync(
      path.join(proj, SESSION, 'subagents', `agent-${id}.jsonl`),
      jl([
        { type: 'user', timestamp: at(0), message: { content: 'go' } },
        { type: 'assistant', timestamp: at(10), uuid: `${id}-a1`, message: { id: `${id}-m1`, content: [{ type: 'tool_use', id: `${id}-t1`, name: 'Bash', input: { command: LONG_CMD } }] } },
        { type: 'user', timestamp: at(100), message: { content: [{ type: 'tool_result', tool_use_id: `${id}-t1`, content: 'x' }] } },
        { type: 'assistant', timestamp: at(110), uuid: `${id}-a2`, message: { id: `${id}-m2`, content: [{ type: 'text', text: 'done' }] } },
      ])
    );
  }
  fs.writeFileSync(path.join(proj, `${SESSION}.jsonl`), jl(session ?? [{ type: 'user', timestamp: at(0), cwd: '/work/proj', message: { content: 'hi' } }]));
  if (usage) {
    const rows = usage.map(([def, kind, sec, id]) => ['2026-10-09', '/work/proj', def, kind, '-', '-', String(sec), 'ok', `${id} 메모`].join('\t'));
    fs.writeFileSync(path.join(records, 'subagent-usage.tsv'), [USAGE_HEADER, ...rows].join('\n') + '\n');
  }
  return { root, records, out: path.join(root, 'material.md'), env: { ...process.env, CLAUDE_CONFIG_DIR: claude, SUBAGENT_RECORDS_DIR: records } };
}
const cli = (args, env) => spawnSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8' });
const CELL_A = [['sonnet-medium', '목업 수정', 600, 'a1'], ['sonnet-medium', '목업 수정', 600, 'a2'], ['sonnet-medium', '목업 수정', 600, 'a3']];

describe('speed-review.js --pick', () => {
  it('사용 기록 파일이 없으면 대상 없음만 찍고 종료 코드 0이다', () => {
    const { env, out } = cliSetup();
    const r = cli(['--pick', '--out', out], env);
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), '대상 없음');
  });

  it('칸을 고르면 첫 줄이 대상이고 자료 파일에 시간표와 긴 도구 호출 절이 있으며 긴 명령이 잘리지 않는다', () => {
    const { env, out } = cliSetup({ usage: CELL_A, transcripts: ['a1', 'a2', 'a3'] });
    const r = cli(['--pick', '--out', out], env);
    assert.equal(r.status, 0, r.stderr);
    const lines = r.stdout.split('\n');
    assert.match(lines[0], /^대상: 칸:sonnet-medium\/목업 수정 \(합계 30\.0분, 3회\)$/);
    assert.equal(lines[1], `자료: ${out}`);
    const doc = fs.readFileSync(out, 'utf8');
    assert.match(doc, /회차별 시간표/);
    assert.match(doc, /긴 도구 호출/);
    assert.ok(doc.includes(LONG_CMD));
    assert.match(doc, /gone-script\.mjs[^\n]*지워짐/);
  });

  it('대화 기록이 지워진 에이전트는 자료에 기록 없음 건수로만 나오고 합계에는 사용 기록 초로 든다', () => {
    const { env, out } = cliSetup({ usage: CELL_A, transcripts: ['a1', 'a2'] });
    const r = cli(['--pick', '--out', out], env);
    assert.match(r.stdout, /합계 30\.0분, 3회/);
    assert.match(fs.readFileSync(out, 'utf8'), /기록 없음 1건/);
  });

  it('사용 기록의 agentId가 대화 기록 파일 이름의 앞부분이어도 대화 기록을 찾는다', () => {
    const { env, out } = cliSetup({ usage: CELL_A.map(([d, k, s, id]) => [d, k, s, `${id}abcdef`]), transcripts: ['a1abcdef0123', 'a2abcdef0123', 'a3abcdef0123'] });
    cli(['--pick', '--out', out], env);
    assert.match(fs.readFileSync(out, 'utf8'), /기록 없음 0건/);
  });

  it('표시 붙은 회차가 둘이고 합계가 더 크면 절차를 고르고 단계별 시간을 자료에 쓴다', () => {
    const session = [
      { type: 'user', timestamp: min(-1), cwd: '/work/proj', message: { content: 'hi' } },
      ...bashCall(0, 'b1', '[검증 1] a', 20),
      ...bashCall(200, 'b2', '[검증 1] a', 220),
    ];
    const { env, out } = cliSetup({ usage: [['sonnet-low', '작은 일', 5, 'z1'], ['sonnet-low', '작은 일', 5, 'z2']], session });
    const r = cli(['--pick', '--out', out], env);
    assert.match(r.stdout.split('\n')[0], /^대상: 절차:\/work\/proj\/검증 /);
    assert.match(fs.readFileSync(out, 'utf8'), /단계별/);
  });
});

describe('speed-review.js --measure, --applied, --effects', () => {
  it('--measure를 두 번 부르면 속도 기록에 머리줄 하나와 측정 줄 둘이 쌓인다', () => {
    const { env, records } = cliSetup();
    assert.equal(cli(['--measure', '칸:a/b', '--items', '열기 3, 대기 12'], env).status, 0);
    assert.equal(cli(['--measure', '칸:a/b', '--items', '열기 4, 대기 10'], env).status, 0);
    const lines = fs.readFileSync(path.join(records, 'speed-log.tsv'), 'utf8').trim().split('\n');
    assert.equal(lines.length, 1 + 2);
    assert.equal(lines[1].split('\t')[1], '측정');
  });

  it('--applied 뒤 적용 뒤 기록이 없으면 --effects가 기다림으로 찍는다', () => {
    const { env, records } = cliSetup({ usage: CELL_A, transcripts: ['a1'] });
    const a = cli(['--applied', '칸:sonnet-medium/목업 수정', '--what', '속도 개선', '--note', '바뀐 구간만'], env);
    assert.equal(a.status, 0, a.stderr);
    const logged = fs.readFileSync(path.join(records, 'speed-log.tsv'), 'utf8').trim().split('\n')[1].split('\t');
    assert.equal(logged[1], '적용');
    assert.equal(logged[4], '600');
    assert.equal(logged[5], '3');
    const e = cli(['--effects'], env);
    assert.match(e.stdout, /칸:sonnet-medium\/목업 수정: 전 10\.0분\(3회\) → 기다림/);
  });

  it('적용한 속도 개선이 없으면 그렇게 찍는다', () => {
    const { env } = cliSetup();
    assert.match(cli(['--effects'], env).stdout, /적용한 속도 개선 없음/);
  });

  it('알 수 없는 인자는 사용법과 종료 코드 1이다', () => {
    const { env } = cliSetup();
    assert.equal(cli(['--nope'], env).status, 1);
  });
});
