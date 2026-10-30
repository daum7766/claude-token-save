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
  pendingTargets,
  parseSpeedLog,
  speedLogLine,
  pickTarget,
  effects,
  qualityVerdict,
} from '../speedReviewHelpers.js';

const tempRoots = [];
after(() => {
  for (const r of tempRoots) fs.rmSync(r, { recursive: true, force: true });
});

const SESSION = '11111111-2222-3333-4444-555555555555';
const min = (m) => new Date(Date.UTC(2026, 9, 10, 0, 0, 0) + m * 60000).toISOString();

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
  it('머리가 없는 설명은 단계 표시가 아니다', () => {
    assert.equal(parseStepLabel('브라우저 확인'), null);
    assert.equal(parseStepLabel(undefined), null);
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
});

// 사용 기록 행(parseUsage의 행 꼴)을 만든다.
const urow = (line, def, kind, agentId, seconds) => ({ line, def, kind, agentId, seconds });
const cellOf = (def, kindName, agents) => ({ target: `칸:${def}/${kindName}`, kind: 'cell', def, kindName, agents, totalSec: agents.reduce((s, a) => s + a.sec, 0) });
const agentsOf = (ids, sec, firstLine = 1) => ids.map((id, i) => ({ id, sec, line: firstLine + i }));
const procOf = (project, name, runs) => ({ target: `절차:${project}/${name}`, kind: 'procedure', runs, totalSec: runs.reduce((s, r) => s + r.totalSec, 0) });
const runOf = (start, totalSec, agents = []) => ({ project: '/p', session: 's', name: '검증', start, end: start + totalSec * 1000, steps: [], agents, mainSec: totalSec, subagentSec: 0, userWaitSec: 0, totalSec });

describe('cellCandidates', () => {
  it('agentId 뒤에 꼬리가 붙은 줄과 꼬리 없는 줄은 같은 에이전트 한 건으로 센다', () => {
    const cells = cellCandidates([urow(1, 'sonnet-low', '구현', 'add4fa4fc4b15a337(이어서)', 100), urow(2, 'sonnet-low', '구현', 'add4fa4fc4b15a337', 50)]);
    assert.deepEqual(cells[0].agents, [{ id: 'add4fa4fc4b15a337', sec: 150, line: 2 }]);
  });

  it('이름이 붙은 서로 다른 agentId는 앞 16진수가 같아도 서로 다른 에이전트 둘로 센다', () => {
    const cells = cellCandidates([urow(1, 'sonnet-low', '구현', 'acab-qr-1d6679cb720078db', 100), urow(2, 'sonnet-low', '구현', 'acab-wide-mock-4fb2a6f9d81863d8', 50)]);
    assert.deepEqual(cells[0].agents.map((a) => a.id), ['acab-qr-1d6679cb720078db', 'acab-wide-mock-4fb2a6f9d81863d8']);
  });

  it('회고 자체의 일 종류는 후보에서 뺀다', () => {
    const rows = EXCLUDED_KINDS.map((kind, i) => urow(i + 1, 'opus-medium', kind, `x${i}`, 60));
    assert.deepEqual(cellCandidates(rows), []);
  });
});

describe('pendingTargets', () => {
  it('속도 개선과 측정 요청 제목의 대상을 모으고 일 종류의 공백과 제목 구분 슬래시를 구별한다', () => {
    const t = pendingTargets('## 제안\n### 속도 개선: 칸:sonnet-medium/목업 수정 / 바뀐 구간만 렌더\n- 왜: x\n\n### 측정 요청: 절차:/p/검증 / 5단계 초\n### 다른 제목: 칸:a/b / c\n');
    assert.deepEqual([...t].sort(), ['절차:/p/검증', '칸:sonnet-medium/목업 수정'].sort());
  });
});

describe('speedLog', () => {
  const entry = { at: '2026-10-10T00:00:00.000Z', type: '적용', target: '칸:a/b c', what: '속도 개선', beforeAvg: 900.5, beforeCount: 3, usageLines: 10, note: '요지', beforeBad: 1 };

  it('한 줄로 쓴 항목을 다시 읽으면 같은 항목이고 머리줄은 건너뛴다', () => {
    const text = `시각\t종류\t대상\t무엇\t전 평균 초\t전 건수\t사용 기록 줄 수\t내용\t전 문제 건수\n${speedLogLine(entry)}\n`;
    assert.deepEqual(parseSpeedLog(text), [entry]);
  });

  it('내용의 탭과 줄바꿈은 빈칸으로 바꿔 열이 밀리지 않는다', () => {
    const line = speedLogLine({ ...entry, note: 'a\tb\nc' });
    assert.equal(line.split('\n').length, 1);
    assert.equal(parseSpeedLog(line)[0].note, 'a b c');
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

  it('물을 것에 답 없이 남은 대상은 고르지 않는다', () => {
    const pending = pendingTargets(`### 속도 개선: ${A.target} / 요지\n`);
    assert.equal(pickTarget({ cells: [A], procedures: [], pending }), null);
  });

  it('적용 뒤 기록이 없는 대상은 고르지 않고 뒤 기록이 생기면 다시 고른다', () => {
    const applied = { at: '2026-10-10T00:00:00.000Z', type: '적용', target: A.target, what: '속도 개선', beforeAvg: 600, beforeCount: 3, usageLines: 3, note: '' };
    assert.equal(pickTarget({ cells: [A], procedures: [], speedLog: [applied] }), null);
    const later = cellOf('sonnet-medium', 'A', [...agentsOf(['a1', 'a2', 'a3'], 600), { id: 'a4', sec: 100, line: 4 }]);
    assert.equal(pickTarget({ cells: [later], procedures: [], speedLog: [applied] }).target, A.target);
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
      { target: applied.target, appliedAt: at, what: '속도 개선', note: '', beforeAvg: 900, beforeCount: 3, afterAvg: 300, afterCount: 2, quality: null },
    ]);
  });
});

describe('qualityVerdict', () => {
  const q = (o) => qualityVerdict({ beforeBad: 0, beforeCount: 5, afterBad: 0, afterCount: 4, ...o });

  it('적용 전 문제 건수 기록이 없으면 판정 불가다', () => {
    assert.equal(q({ beforeBad: null }), '판정 불가');
    assert.equal(q({ beforeBad: undefined }), '판정 불가');
  });

  it('적용 전 건수가 0이면 비율을 낼 수 없어 판정 불가다', () => {
    assert.equal(q({ beforeCount: 0, beforeBad: 0 }), '판정 불가');
  });

  it('적용 뒤 건수가 모자라면 문제가 많아도 기다림이다', () => {
    assert.equal(q({ afterCount: 2, afterBad: 2 }), '기다림');
  });

  it('적용 뒤 문제가 2건 이상이고 비율이 적용 전보다 20%p 넘게 늘면 떨어짐이다', () => {
    assert.equal(q({ beforeBad: 0, afterCount: 4, afterBad: 2 }), '떨어짐');
  });

  it('문제가 1건뿐이면 비율이 늘어도 유지다', () => {
    assert.equal(q({ beforeBad: 0, afterCount: 3, afterBad: 1 }), '유지');
  });

  it('적용 전에도 문제 비율이 비슷하게 높았으면 유지다', () => {
    assert.equal(q({ beforeBad: 2, beforeCount: 5, afterCount: 5, afterBad: 2 }), '유지');
  });
});

describe('effects 품질', () => {
  const at = '2026-10-10T00:00:00.000Z';
  const applied = { at, type: '적용', target: '칸:sonnet-medium/A', what: '속도 개선', beforeAvg: 900, beforeCount: 3, usageLines: 10, note: '캐시 사용. 되돌리기: 옛 절을 되살림', beforeBad: 0 };
  const bad = new Set(['n1', 'n2']);

  it('적용 뒤 문제 건수를 세면 시간이 줄었어도 문제가 늘었을 때 품질 떨어짐이다', () => {
    const cell = cellOf('sonnet-medium', 'A', agentsOf(['n1', 'n2', 'n3'], 100, 11));
    const [e] = effects({ speedLog: [applied], cellsAll: [cell], proceduresAll: [], isBad: (id) => bad.has(id) });
    assert.equal(e.afterAvg, 100);
    assert.deepEqual(e.quality, { beforeBad: 0, beforeCount: 3, afterBad: 2, afterCount: 3, verdict: '떨어짐' });
    assert.equal(e.note, applied.note);
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
    const rows = usage.map(([def, kind, sec, id, result = 'ok']) => ['2026-10-09', '/work/proj', def, kind, '-', '-', String(sec), result, `${id} 메모`].join('\t'));
    fs.writeFileSync(path.join(records, 'subagent-usage.tsv'), [USAGE_HEADER, ...rows].join('\n') + '\n');
  }
  return { root, records, out: path.join(root, 'material.md'), env: { ...process.env, CLAUDE_CONFIG_DIR: claude, SUBAGENT_RECORDS_DIR: records } };
}
const cli = (args, env) => spawnSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8' });
const CELL_A = [['sonnet-medium', '목업 수정', 600, 'a1'], ['sonnet-medium', '목업 수정', 600, 'a2'], ['sonnet-medium', '목업 수정', 600, 'a3']];

describe('speed-review.js --pick', () => {
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

  it('사용 기록의 agentId가 대화 기록 파일 이름의 앞부분이어도 대화 기록을 찾는다', () => {
    const { env, out } = cliSetup({ usage: CELL_A.map(([d, k, s, id]) => [d, k, s, `${id}abcdef`]), transcripts: ['a1abcdef0123', 'a2abcdef0123', 'a3abcdef0123'] });
    cli(['--pick', '--out', out], env);
    assert.match(fs.readFileSync(out, 'utf8'), /기록 없음 0건/);
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

  it('--applied는 적용 전 기록에서 올림이 붙은 건수를 전 문제 건수 열에 남긴다', () => {
    const { env, records } = cliSetup({ usage: [...CELL_A.slice(0, 2), ['sonnet-medium', '목업 수정', 600, 'a3', '올림']], transcripts: ['a1'] });
    const a = cli(['--applied', '칸:sonnet-medium/목업 수정', '--what', '속도 개선', '--note', '바뀐 구간만. 되돌리기: 옛 절 복원'], env);
    assert.equal(a.status, 0, a.stderr);
    assert.equal(a.stderr, '');
    const logged = fs.readFileSync(path.join(records, 'speed-log.tsv'), 'utf8').trim().split('\n')[1].split('\t');
    assert.equal(logged[8], '1');
  });

  it('--applied에 되돌릴 방법이 없는 속도 개선 내용을 주면 경고하고 기록은 남긴다', () => {
    const { env, records } = cliSetup({ usage: CELL_A, transcripts: ['a1'] });
    const a = cli(['--applied', '칸:sonnet-medium/목업 수정', '--what', '속도 개선', '--note', '바뀐 구간만'], env);
    assert.equal(a.status, 0);
    assert.match(a.stderr, /되돌릴 방법/);
    assert.ok(fs.existsSync(path.join(records, 'speed-log.tsv')));
  });

  it('--effects는 시간이 줄었어도 적용 뒤 올림이 늘었으면 품질 떨어짐과 적용 내용을 찍는다', () => {
    const { env, records } = cliSetup({ usage: CELL_A, transcripts: ['a1'] });
    cli(['--applied', '칸:sonnet-medium/목업 수정', '--what', '속도 개선', '--note', '바뀐 구간만. 되돌리기: 옛 절 복원'], env);
    const usage = path.join(records, 'subagent-usage.tsv');
    const row = (id, result) => ['2026-10-10', '/work/proj', 'sonnet-medium', '목업 수정', '-', '-', '100', result, `${id} 메모`].join('\t');
    fs.appendFileSync(usage, [row('b1', '올림'), row('b2', '올림'), row('b3', 'ok')].join('\n') + '\n');
    const out = cli(['--effects'], env).stdout;
    assert.match(out, /칸:sonnet-medium\/목업 수정.*품질 떨어짐.*문제 전 0\/3건 → 뒤 2\/3건/);
    assert.match(out, /적용 내용: 바뀐 구간만/);
  });

  it('--effects는 정정 기록이 붙은 에이전트도 문제로 센다', () => {
    const { env, records } = cliSetup({ usage: CELL_A, transcripts: ['a1'] });
    cli(['--applied', '칸:sonnet-medium/목업 수정', '--what', '속도 개선', '--note', '요지. 되돌리기: x'], env);
    const row = (id) => ['2026-10-10', '/work/proj', 'sonnet-medium', '목업 수정', '-', '-', '100', 'ok', `${id} 메모`].join('\t');
    fs.appendFileSync(path.join(records, 'subagent-usage.tsv'), ['c1', 'c2', 'c3'].map(row).join('\n') + '\n');
    const corr = (id) => ['2026-10-10', '/work/proj', 's', 't', id, id, 'sonnet-medium', '목업 수정', '틀림', '메시지'].join('\t');
    fs.writeFileSync(path.join(records, 'subagent-corrections.tsv'), [corr('c1'), corr('c2')].join('\n') + '\n');
    assert.match(cli(['--effects'], env).stdout, /품질 떨어짐: 문제 전 0\/3건 → 뒤 2\/3건/);
  });

  it('알 수 없는 인자는 사용법과 종료 코드 1이다', () => {
    const { env } = cliSetup();
    assert.equal(cli(['--nope'], env).status, 1);
  });
});
