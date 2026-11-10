import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

// 훅이 상태 파일을 os.tmpdir()에 쓴다. 시험용 임시 폴더로 돌려 시스템 임시 폴더에 쌓이지 않게 한다
const STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'stall-state-'));
process.env.TMPDIR = STATE_DIR;
after(() => fs.rmSync(STATE_DIR, { recursive: true, force: true }));

const require = createRequire(import.meta.url);
const { workScanCount, check, bgLeft, leftoverWork, oneShotIn, delivered, decisionItems, decisionCount, taskNotes, openBoxes, stopNotes, progressDirs, shellWorkFiles } = require('../../hooks/stall-check.js');

// 막음 기록이 실제 설정 폴더의 hook-blocks.tsv에 시험 줄을 남기지 않게 기록 폴더를 임시 폴더로 돌린다.
const RECORDS = fs.mkdtempSync(path.join(os.tmpdir(), 'stall-records-'));
process.env.SUBAGENT_RECORDS_DIR = RECORDS;
const recordRows = (file) => { try { return fs.readFileSync(path.join(RECORDS, file), 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t')); } catch { return []; } };

// 하네스가 Stop 입력에 주는 칸(background_tasks, session_crons)을 그대로 흉내 낸다. 세션 id는 시험마다 달리 해 임시 상태 파일이 섞이지 않게 한다.
let n = 0;
const DONE = '끝냈습니다.\n\n**⑧ 다음**\n- AI: 할 일이 없습니다.\n- 대표님: 없습니다.';
const stop = (over = {}) => ({ hook_event_name: 'Stop', session_id: `stall-test-${process.pid}-${n++}`, last_assistant_message: DONE, background_tasks: [], session_crons: [], ...over });
const task = (id, type, extra = {}) => ({ id, type, status: 'running', description: `일 ${id}`, ...extra });
const checkin = (id, recurring = true) => ({ id, schedule: '7,22,37,52 * * * *', recurring, prompt: '<check-in> 뒤 작업 확인: …' });
const NOW = new Date(2026, 10, 6, 23, 30);
// 뒤 작업을 기다리는 서브에이전트의 기록에 끝나지 않은 뒤 셸 하나를 남긴다(훅은 기록에 남은 뒤 작업이 있어야 기다림으로 센다).
// main은 메인 대화 기록 경로, 없으면 빈 기록을 만든다. 돌려주는 값은 메인 대화 기록 경로.
const pend = (main, id, at = '2026-11-01T00:00:00Z') => {
  if (!fs.existsSync(main)) fs.writeFileSync(main, '');
  const sub = path.join(main.replace(/\.jsonl$/, ''), 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  fs.appendFileSync(path.join(sub, `agent-${id}.jsonl`), JSON.stringify({ type: 'user', timestamp: at, message: { content: [{ type: 'tool_result', content: 'Command running in background with ID: bshell1.' }] }, toolUseResult: { backgroundTaskId: 'bshell1' } }) + '\n');
  return main;
};

describe('stall-check 실무자 기다림과 예약', () => {
  it('도는 실무자가 있고 깨우는 예약이 없으면 막는다. 이름 붙인 실무자면 15분마다, 이름 없는 실무자만이면 60분 뒤 한 번 걸게 한다', () => {
    const tm = check(stop({ background_tasks: [task('t1', 'teammate')] }), NOW);
    assert.match(tm.reason, /실무자 기다림: 뒤에서 도는 실무자 1명\(일 t1\)/);
    assert.match(tm.reason, /7,22,37,52 \* \* \* \*/);
    const sub = check(stop({ background_tasks: [task('a1', 'subagent')] }), NOW);
    assert.match(sub.reason, /cron "30 0 7 11 \*", recurring false/);
    assert.match(sub.reason, /<check-in> 뒤 작업 확인/);
  });
  it('깨우는 예약이 있거나, 뒤 명령과 Monitor만 돌거나, 끝난 실무자는 막지 않는다', () => {
    assert.equal(check(stop({ background_tasks: [task('t1', 'teammate')], session_crons: [checkin('c1')] })), null);
    assert.equal(check(stop({ background_tasks: [task('b1', 'shell', { command: 'npm test' }), task('m1', 'monitor')] })), null);
    assert.equal(check(stop({ background_tasks: [task('t1', 'teammate', { status: 'idle' }), task('a1', 'subagent', { status: 'completed' })] })), null);
  });
  it('사용자가 건 반복 예약은 깨우는 예약으로 세지 않고, 도는 실무자가 없으면 깨우는 예약만 지우게 한다', () => {
    const user = { id: 'u1', schedule: '*/5 * * * *', recurring: true, prompt: '/babysit-prs' };
    assert.match(check(stop({ background_tasks: [task('t1', 'teammate')], session_crons: [user] })).reason, /실무자 기다림/);
    assert.equal(check(stop({ session_crons: [user] })), null);
    assert.match(check(stop({ session_crons: [user, checkin('c9')] })).reason, /예약 정리: .*id c9/);
  });
  it('입력에 뒤 작업 칸이 없는 판에서는 앞 두 검사를 건너뛴다', () => {
    const input = stop();
    delete input.background_tasks;
    delete input.session_crons;
    assert.equal(check(input), null);
  });
  it('한 번 막은 뒤에는 같은 실무자 묶음으로 다시 막지 않고, 새 실무자가 생기면 다시 막는다', () => {
    const sid = `stall-test-${process.pid}-again`;
    const one = { session_id: sid, background_tasks: [task('t1', 'teammate')] };
    assert.match(check(stop(one)).reason, /실무자 기다림/);
    assert.equal(check(stop({ ...one, stop_hook_active: true })), null);
    assert.match(check(stop({ ...one, stop_hook_active: true, background_tasks: [task('t1', 'teammate'), task('t2', 'teammate')] })).reason, /2명/);
    fs.rmSync(path.join(os.tmpdir(), `stall-check-${sid}.json`), { force: true });
  });
  it('쉬는 이름 붙인 실무자는 세지 않고, 끝 메시지가 아직 안 닿았으면 한 번 알린다. 같은 설명이 둘이면 가장 늦게 생긴 기록을 본다', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stall-tm-'));
    const sub = path.join(root, 'sess', 'subagents');
    fs.mkdirSync(sub, { recursive: true });
    const put = (id, desc, stop, born) => {
      fs.writeFileSync(path.join(sub, `agent-${id}.meta.json`), JSON.stringify({ name: id, description: desc }));
      const rows = [{ type: 'user', timestamp: born, message: { content: '일' } }, { type: 'assistant', timestamp: '2026-11-06T10:00:00Z', message: { stop_reason: stop, content: [{ type: 'text', text: `${id}의 결과` }] } }];
      fs.writeFileSync(path.join(sub, `agent-${id}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    };
    put('done', '쉬는 일', 'end_turn', '2026-11-06T09:00:00Z');
    put('busy', '하는 일', 'tool_use', '2026-11-06T09:00:00Z');
    put('old', '다시 띄운 일', 'end_turn', '2026-11-06T08:00:00Z');
    put('new', '다시 띄운 일', 'tool_use', '2026-11-06T09:30:00Z');
    const main = path.join(root, 'sess.jsonl');
    const input = (descs, sid) => stop({ session_id: sid, transcript_path: main, background_tasks: descs.map((d, i) => ({ id: `t${i}`, type: 'teammate', status: 'running', description: d })) });
    fs.writeFileSync(main, '');
    const sid = `stall-test-${process.pid}-late`;
    const at = new Date('2026-11-06T10:20:00Z');
    assert.match(check(input(['쉬는 일'], sid), at).reason, /^결과 늦음: [^]*\[done\]\ndone의 결과/);
    assert.equal(check(input(['쉬는 일'], sid), at), null);
    // 끝난 지 1시간이 넘었으면 전문 대신 이름, 끝난 시각, 첫 줄만 묶어 보이고 사용자에게 다시 알리지 않게 한다.
    const sidOld = `stall-test-${process.pid}-stale`;
    const old = check(input(['쉬는 일'], sidOld), new Date('2026-11-06T13:00:00Z')).reason;
    assert.match(old, /^오래된 결과: 끝난 지 1시간 넘은 실무자 1명/);
    assert.match(old, /- \[done\] \d+시 \d+분 끝남: done의 결과 \(전문: /);
    assert.doesNotMatch(old, /결과 늦음/);
    fs.rmSync(path.join(os.tmpdir(), `stall-check-${sidOld}.json`), { force: true });
    fs.rmSync(path.join(os.tmpdir(), `stall-check-${sid}.json`), { force: true });
    const msg = { type: 'user', timestamp: '2026-11-06T10:00:03Z', message: { content: '<teammate-message teammate_id="done">{}' } };
    fs.writeFileSync(main, JSON.stringify(msg) + '\n');
    assert.equal(check(input(['쉬는 일'])), null);
    assert.match(check(input(['쉬는 일', '하는 일'])).reason, /^실무자 기다림: 뒤에서 도는 실무자 1명\(하는 일\)/);
    assert.match(check(input(['다시 띄운 일'])).reason, /1명\(다시 띄운 일\)/);
    fs.rmSync(root, { recursive: true, force: true });
  });
  it('실무자가 끝맺기 1분 안에 직접 보낸 보고가 닿았으면 결과 늦음을 띄우지 않고, 그보다 앞선 중간 보고만 있으면 띄운다', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stall-am-'));
    const sub = path.join(root, 'sess', 'subagents');
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, 'agent-rep.meta.json'), JSON.stringify({ name: 'rep', description: '보고하는 일' }));
    const rows = [{ type: 'user', timestamp: '2026-11-06T09:00:00Z', message: { content: '일' } }, { type: 'assistant', timestamp: '2026-11-06T10:00:00Z', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'rep의 결과' }] } }];
    fs.writeFileSync(path.join(sub, 'agent-rep.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const main = path.join(root, 'sess.jsonl');
    const input = (sid) => stop({ session_id: sid, transcript_path: main, background_tasks: [{ id: 't0', type: 'teammate', status: 'running', description: '보고하는 일' }] });
    const say = (at) => JSON.stringify({ type: 'user', timestamp: at, message: { content: '<agent-message from="rep">결과</agent-message>' } });
    fs.writeFileSync(main, say('2026-11-06T09:50:00Z') + '\n');
    const sid1 = `stall-test-${process.pid}-am1`;
    assert.match(check(input(sid1), new Date('2026-11-06T10:20:00Z')).reason, /^결과 늦음/);
    fs.rmSync(path.join(os.tmpdir(), `stall-check-${sid1}.json`), { force: true });
    fs.writeFileSync(main, say('2026-11-06T09:59:45Z') + '\n');
    const sid2 = `stall-test-${process.pid}-am2`;
    assert.doesNotMatch(check(input(sid2), new Date('2026-11-06T10:20:00Z'))?.reason || '', /결과 늦음/);
    fs.rmSync(path.join(os.tmpdir(), `stall-check-${sid2}.json`), { force: true });
    fs.rmSync(root, { recursive: true, force: true });
  });
  it('끝맺은 지 5분이 안 된 실무자는 마지막 답을 싣지 않고 기다리는 실무자로 두고, 5분이 지나도 끝 알림이 없으면 싣는다', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stall-grace-'));
    const sub = path.join(root, 'sess', 'subagents');
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, 'agent-g.meta.json'), JSON.stringify({ name: 'g', description: '막 끝난 일' }));
    const rows = [{ type: 'user', timestamp: '2026-11-06T09:00:00Z', message: { content: '일' } }, { type: 'assistant', timestamp: '2026-11-06T10:00:00Z', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'g의 결과' }] } }];
    fs.writeFileSync(path.join(sub, 'agent-g.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const main = path.join(root, 'sess.jsonl');
    fs.writeFileSync(main, '');
    const input = (sid) => stop({ session_id: sid, transcript_path: main, background_tasks: [{ id: 't0', type: 'teammate', status: 'running', description: '막 끝난 일' }] });
    const sid1 = `stall-test-${process.pid}-g1`;
    const soon = check(input(sid1), new Date('2026-11-06T10:01:00Z'));
    assert.doesNotMatch(soon.reason, /결과 늦음/);
    assert.match(soon.reason, /^실무자 기다림/);
    fs.rmSync(path.join(os.tmpdir(), `stall-check-${sid1}.json`), { force: true });
    const sid2 = `stall-test-${process.pid}-g2`;
    assert.match(check(input(sid2), new Date('2026-11-06T10:06:00Z')).reason, /^결과 늦음/);
    fs.rmSync(path.join(os.tmpdir(), `stall-check-${sid2}.json`), { force: true });
    fs.rmSync(root, { recursive: true, force: true });
  });
  it('끝 알림이 대화 기록 끝부분 밖에 있어도 기록 전체에서 찾아 닿은 것으로 본다', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stall-full-'));
    const main = path.join(root, 'sess.jsonl');
    const hit = JSON.stringify({ type: 'user', timestamp: '2026-11-06T10:00:01Z', message: { content: '<teammate-message teammate_id="far">끝</teammate-message>' } });
    const filler = JSON.stringify({ type: 'user', timestamp: '2026-11-06T10:05:00Z', message: { content: 'x'.repeat(1000) } });
    fs.writeFileSync(main, [hit, ...Array(3000).fill(filler)].join('\n') + '\n');
    const ended = Date.parse('2026-11-06T10:00:00Z');
    assert.equal(delivered(main, 'far', ended, []), true);
    assert.equal(delivered(main, 'none', ended, []), false);
    fs.rmSync(root, { recursive: true, force: true });
  });
  it('끝 알림이 닿은 것을 한 번 보면 기억해, 대화 기록 끝에서 그 줄이 밀려나도 결과 늦음을 띄우지 않는다', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stall-seen-'));
    const sub = path.join(root, 'sess', 'subagents');
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, 'agent-s.meta.json'), JSON.stringify({ name: 's', description: '받은 일' }));
    const rows = [{ type: 'user', timestamp: '2026-11-06T09:00:00Z', message: { content: '일' } }, { type: 'assistant', timestamp: '2026-11-06T10:00:00Z', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 's의 결과' }] } }];
    fs.writeFileSync(path.join(sub, 'agent-s.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const main = path.join(root, 'sess.jsonl');
    fs.writeFileSync(main, JSON.stringify({ type: 'user', timestamp: '2026-11-06T10:00:02Z', message: { content: '<teammate-message teammate_id="s">끝</teammate-message>' } }) + '\n');
    const sid = `stall-test-${process.pid}-seen`;
    const input = stop({ session_id: sid, transcript_path: main, background_tasks: [{ id: 't0', type: 'teammate', status: 'running', description: '받은 일' }] });
    assert.doesNotMatch(check(input, new Date('2026-11-06T10:10:00Z'))?.reason || '', /결과 늦음/);
    fs.writeFileSync(main, '');
    assert.doesNotMatch(check(input, new Date('2026-11-06T12:00:00Z'))?.reason || '', /결과 늦음|오래된 결과/);
    fs.rmSync(path.join(os.tmpdir(), `stall-check-${sid}.json`), { force: true });
    fs.rmSync(root, { recursive: true, force: true });
  });
  it('기록이 20분 넘게 그대로인 실무자는 멈춘 듯으로 한 번 알리고, 기록이 다시 자라다 멈추면 또 알린다', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stall-stuck-'));
    const sub = path.join(root, 'sess', 'subagents');
    fs.mkdirSync(sub, { recursive: true });
    const file = path.join(sub, 'agent-a1.jsonl');
    fs.writeFileSync(path.join(sub, 'agent-a1.meta.json'), JSON.stringify({ description: '구현: 방' }));
    fs.writeFileSync(file, JSON.stringify({ type: 'assistant', message: { stop_reason: 'tool_use', content: [] } }) + '\n');
    const at = (min) => { const t = new Date(Date.now() - min * 60000); fs.utimesSync(file, t, t); };
    const sid = `stall-test-${process.pid}-stuck`;
    const input = () => stop({ session_id: sid, transcript_path: path.join(root, 'sess.jsonl'), background_tasks: [task('a1', 'subagent', { description: '구현: 방' })], session_crons: [checkin('c1')] });
    at(5);
    assert.equal(check(input()), null);
    at(45);
    assert.match(check(input()).reason, /^멈춘 듯: 구현: 방\(id a1, 45분째/);
    assert.equal(check(input()), null);
    at(30);
    assert.match(check(input()).reason, /^멈춘 듯/);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(path.join(os.tmpdir(), `stall-check-${sid}.json`), { force: true });
  });
  it('막지 않은 새 줄기에서는 앞 줄기의 막은 기록을 지운다', () => {
    const sid = `stall-test-${process.pid}-chain`;
    const tm = [task('t1', 'teammate')];
    assert.ok(check(stop({ session_id: sid, background_tasks: tm })));
    assert.equal(check(stop({ session_id: sid, background_tasks: [] })), null);
    assert.match(check(stop({ session_id: sid, stop_hook_active: true, background_tasks: tm })).reason, /실무자 기다림/);
    fs.rmSync(path.join(os.tmpdir(), `stall-check-${sid}.json`), { force: true });
  });
  it('한 번 울리는 예약 시각은 지금부터 60분 뒤다', () => {
    assert.equal(oneShotIn(60, new Date(2026, 10, 6, 23, 30)), '30 0 7 11 *');
  });
});

describe('stall-check 이어 하기', () => {
  it('AI 할 일이 남았고 사용자 몫이 없으면 참이다(머리 꼴 여럿)', () => {
    assert.equal(leftoverWork('보고\n\n## 다음\n- **AI:** 5단계 2번(설치 바닥)을 시작합니다.\n- **대표님:** 지금 하실 일은 없습니다.'), true);
    // 목록 꼴로 쓴 기다림 줄도 기다릴 까닭으로 본다(11-08).
    assert.equal(leftoverWork('보고\n\n**다음**\n- AI: 세 번째 회고에서 재고 보고합니다.\n- 대표님: 지금 하실 일은 없습니다.\n- 기다림: 대표님 지시'), false);
    assert.equal(leftoverWork('보고\n\n**다음**\n- AI: 세 번째 회고에서 재고 보고합니다.\n- 대표님: 지금 하실 일은 없습니다.\n- **기다림:** 회고 세 번'), false);
    assert.equal(leftoverWork('보고\n\n**⑧ 다음**\n- AI: 2단계를 마무리해 커밋합니다.\n- 대표님: 따로 하실 것은 없습니다. 범위를 줄이고 싶으시면 말씀해 주세요.'), true);
    assert.equal(leftoverWork('보고\n\n⑧ **다음**\n- 제가 할 일: 안내 문서 정리를 시작합니다.'), true);
    assert.equal(leftoverWork('보고\n\n**⑧ 다음(이번 묶음 뒤)**\n1. AI: 커밋하고 4회차를 돌립니다.\n2. 대표님: 없습니다.'), true);
    assert.equal(leftoverWork('보고\n\n**⑧ 다음**\n- AI 몫: 3단계를 시작합니다.\n- 대표님 몫: 없습니다.'), true);
  });
  it('사용자 몫이 push나 배포 지시뿐이면 참이고, 다른 몫이 섞이면 거짓이다(2026-11-07 진행합니다 하고 멈춤)', () => {
    assert.equal(leftoverWork('보고\n\n⑧ 다음\n- AI: 혼자 쓰기를 공통 판단으로 옮기고 여럿 쓰기 순서로 진행합니다.\n- 대표: push 지시(main에 알림 커밋 셋이 쌓여 있습니다).'), true);
    assert.equal(leftoverWork('보고\n\n⑧ 다음\n- AI: 결과 화면을 이어 고칩니다.\n- 대표: 배포할지 정해 주세요.'), true);
    assert.equal(leftoverWork('보고\n\n⑧ 다음\n- AI: 결과 화면을 이어 고칩니다.\n- 대표: push 지시. 카드 폭을 골라 주세요.'), false);
    assert.equal(leftoverWork('보고\n\n⑧ 다음\n- AI: 11-08에 운영 오류 기록을 견줍니다.\n- 대표: push 지시.\n- 기다림: push 지시'), false);
    assert.equal(leftoverWork('보고\n\n⑧ 다음\n- AI: 배포 뒤 첫 주간 분석에서 녹화 보는 법을 더하겠습니다.\n- 대표: 배포 승인에 답해 주시면 됩니다.'), false);
  });
  it('사용자 몫이 아래 목록에 있거나, 조건이 걸렸거나, 끝냈다고 했거나, 기다림 줄, 정할 것, 한도가 있으면 거짓이다(리뷰 11~14번)', () => {
    assert.equal(leftoverWork('보고\n\n**⑧ 다음**\n- AI: 안을 만듭니다.\n- 대표님이 하실 일\n  - a와 b 가운데 하나를 골라 주세요.'), false);
    assert.equal(leftoverWork('보고\n\n**⑧ 다음**\n- AI: 안을 만듭니다.\n- 대표님 몫: 1번에 a나 b로 답해 주세요.'), false);
    for (const ai of ['고르시면 그 안으로 고칩니다.', '결과를 받는 대로 합칩니다.', '끝나는 대로 확인합니다.', '답을 받으면 커밋합니다.', '이번 묶음은 모두 끝냈습니다.', '더 할 일은 없고 대기합니다.']) {
      assert.equal(leftoverWork(`보고\n\n**⑧ 다음**\n- AI: ${ai}\n- 대표님: 없습니다.`), false, ai);
    }
    assert.equal(leftoverWork('보고\n\n**⑧ 다음**\n- AI: 커밋합니다.\n- 대표님: 없습니다.\n\n기다림: 시험 결과'), false);
    assert.equal(leftoverWork('**② 정할 것**\n1. 공개 범위\n\n**⑧ 다음**\n- AI: 커밋합니다.\n- 대표님: 없습니다.'), false);
    assert.equal(leftoverWork('다음 묶음으로 넘어가겠습니다.'), false);
    assert.equal(leftoverWork("보고\n\n**⑧ 다음**\n- 저장소: 정리합니다.\n- 대표님: 없습니다."), false);
    assert.equal(leftoverWork('보고\n\n**⑧ 다음**\n- AI: 안을 만듭니다.\n- 대표님: 지금은 없습니다. 다만 1번은 골라 주세요.'), false);
    assert.equal(leftoverWork('보고\n\n**⑧ 다음**\n- AI: 안을 만듭니다.\n- 대표님:\n  - 지금은 없습니다.\n  - 1번을 골라 주세요.'), false);
  });
  it('끝냈다는 말이 있어도 이어서 할 일이 있거나, 제 일의 순서만 걸렸거나, ②⑦이 머리 줄이 아니면 참이다(리뷰 2회차 4, 5번)', () => {
    for (const ai of ['1단계를 끝냈고 2단계를 시작합니다.', '검토를 마쳤으니 고침을 시작합니다.', '막힌 곳은 없고 다음 묶음을 시작합니다.', '커밋이 되면 바로 5단계 설계를 짭니다.']) {
      assert.equal(leftoverWork(`보고\n\n**⑧ 다음**\n- AI: ${ai}\n- 대표님: 없습니다.`), true, ai);
    }
    assert.equal(leftoverWork('보고\n② 단계는 끝났습니다.\n\n**⑧ 다음**\n- AI: 커밋합니다.\n- 대표님: 없습니다.'), true);
    assert.equal(leftoverWork('**⑦ 선택지**\na. 안\n\n**⑧ 다음**\n- AI: 커밋합니다.\n- 대표님: 없습니다.'), false);
  });
  it('도는 일이 없고 논의 중이 아닐 때만 막고, 한 줄기에 답이 바뀔 때마다 세 번까지 막는다', () => {
    const text = (i) => `보고 ${i}\n\n**⑧ 다음**\n- AI: 커밋하고 다음 묶음을 띄웁니다.\n- 대표님: 없습니다.`;
    assert.match(check(stop({ last_assistant_message: text(0) })).reason, /^이어 하기/);
    assert.equal(check(stop({ last_assistant_message: text(0), background_tasks: [task('b1', 'shell', { command: 'npm test' })] })), null);
    assert.match(check(stop({ last_assistant_message: text(0), background_tasks: [task('b1', 'shell', { command: 'npm run dev -- --port 5180' })] })).reason, /^이어 하기/);
    const sid = `stall-test-${process.pid}-carry`;
    const base = { session_id: sid };
    assert.ok(check(stop({ ...base, last_assistant_message: text(1) })));
    assert.equal(check(stop({ ...base, stop_hook_active: true, last_assistant_message: text(1) })), null);
    assert.ok(check(stop({ ...base, stop_hook_active: true, last_assistant_message: text(2) })));
    assert.ok(check(stop({ ...base, stop_hook_active: true, last_assistant_message: text(3) })));
    assert.equal(check(stop({ ...base, stop_hook_active: true, last_assistant_message: text(4) })), null);
    fs.rmSync(path.join(os.tmpdir(), `stall-check-${sid}.json`), { force: true });
  });
  it('뒤 작업 칸이 없는 판에서는 이어 하기도 건너뛰고, 막은 뒤 점검 줄만 쓰고 멈추면 앞 답의 할 일로 한 번 더 막는다', () => {
    const text = '보고\n\n**⑧ 다음**\n- AI: 커밋하고 다음 묶음을 띄웁니다.\n- 대표님: 없습니다.';
    const old = stop({ last_assistant_message: text });
    delete old.background_tasks;
    assert.equal(check(old), null);
    const sid = `stall-test-${process.pid}-again2`;
    assert.ok(check(stop({ session_id: sid, last_assistant_message: text })));
    assert.match(check(stop({ session_id: sid, stop_hook_active: true, last_assistant_message: '점검 뒤 고친 것: 45개입니다.' })).reason, /^이어 하기/);
    fs.rmSync(path.join(os.tmpdir(), `stall-check-${sid}.json`), { force: true });
  });
  it('설치본의 논의 잠금 훅(config turnLockHook)이 이 차례를 잠갔다고 답하면 이어 하기를 하지 않는다', () => {
    const sid = `stall-test-${process.pid}-locked`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stall-lock-'));
    fs.mkdirSync(path.join(dir, 'subagent-system'));
    const mod = path.join(dir, 'lock.js');
    fs.writeFileSync(mod, `module.exports = { isTurnLocked: (sid) => sid === ${JSON.stringify(sid)} };`);
    fs.writeFileSync(path.join(dir, 'subagent-system', 'config.json'), JSON.stringify({ turnLockHook: mod }));
    const text = '보고\n\n**⑧ 다음**\n- AI: 커밋합니다.\n- 대표님: 없습니다.';
    const prev = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = dir;
    try {
      assert.equal(check(stop({ session_id: sid, last_assistant_message: text })), null);
      assert.match(check(stop({ session_id: `${sid}-open`, last_assistant_message: text })).reason, /^이어 하기/);
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = prev;
      fs.rmSync(dir, { recursive: true, force: true });
      for (const s2 of [sid, `${sid}-open`]) fs.rmSync(path.join(os.tmpdir(), `stall-check-${s2}.json`), { force: true });
    }
  });
  it('피드백 없음: config에 turnLockHook이 없거나 가리키는 모듈이 없으면 오류 없이 이어 하기 판정만 한다', () => {
    const text = '보고\n\n**⑧ 다음**\n- AI: 커밋합니다.\n- 대표님: 없습니다.';
    const prev = process.env.CLAUDE_CONFIG_DIR;
    const sids = [];
    const dirs = [];
    try {
      for (const cfg of [{}, { turnLockHook: path.join(os.tmpdir(), 'no-such-lock-module.js') }, null]) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stall-nolock-'));
        dirs.push(dir);
        fs.mkdirSync(path.join(dir, 'subagent-system'));
        if (cfg) fs.writeFileSync(path.join(dir, 'subagent-system', 'config.json'), JSON.stringify(cfg));
        process.env.CLAUDE_CONFIG_DIR = dir;
        const sid = `stall-test-${process.pid}-nolock${sids.length}`;
        sids.push(sid);
        assert.match(check(stop({ session_id: sid, last_assistant_message: text })).reason, /^이어 하기/);
      }
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = prev;
      for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
      for (const s2 of sids) fs.rmSync(path.join(os.tmpdir(), `stall-check-${s2}.json`), { force: true });
    }
  });

});

describe('stall-check 결정 알림과 결정 대기 중 이어 하기', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stall-decision-'));
  const transcript = (name, entries) => {
    const f = path.join(tmp, `${name}.jsonl`);
    fs.writeFileSync(f, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
    return f;
  };
  const userSay = (text) => ({ type: 'user', promptSource: 'typed', message: { role: 'user', content: text } });
  const pushCall = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'PushNotification', input: { message: '결정 1건' } }] } };
  const DECIDE = '보고\n\n**② 정할 것**\n1. 공개 범위: 전체와 일부 가운데\n\n**⑦ 선택지**\na. 전체\nb. 일부\n\n**⑧ 다음**\n- AI(답 뒤): 고른 안으로 고칩니다.\n- 대표: a나 b를 골라 주세요.\n- 기다림: 대표 선택';

  it('정할 것은 목록 줄마다, 선택지는 칸 하나로 세고, 없음 칸과 본문의 동그라미 번호는 세지 않는다', () => {
    assert.deepEqual(decisionItems(DECIDE), ['공개 범위: 전체와 일부 가운데', 'a. 전체\nb. 일부']);
    assert.deepEqual(decisionItems('**② 정할 것**\n없음\n\n**⑧ 다음**\n- AI: 커밋합니다.'), []);
    assert.deepEqual(decisionItems('보고\n② 단계는 끝났습니다.\n\n**⑧ 다음**\n- AI: 커밋합니다.'), []);
    assert.equal(decisionCount(DECIDE), 1);
  });
  it('실제 보고 꼴(번호 없는 머리 줄, ## 머리 줄, 결정할 것, 머리 줄에 붙여 쓴 내용)을 잡고, 문장과 없음 변형과 다른 칸은 세지 않는다(리뷰 1, 3, 8번)', () => {
    assert.deepEqual(decisionItems('보고\n\n**정할 것**\n1. 공개 범위\n\n**알아 둘 것**\n- 시험 하나 느림\n\n**다음**\n- AI: 고칩니다.'), ['공개 범위']);
    assert.deepEqual(decisionItems('## 결정할 것\n- 공개 범위\n\n## 다음\n- AI: x'), ['공개 범위']);
    assert.deepEqual(decisionItems('**② 정할 것**: 공개 범위를 골라 주세요.\n\n**⑧ 다음**\n- AI: x'), ['공개 범위를 골라 주세요.']);
    assert.deepEqual(decisionItems('② 정할 것이 없어 바로 진행합니다.\n- 시험 3개 통과\n\n**⑧ 다음**\n- AI: 커밋합니다.'), []);
    for (const none of ['해당 없음', '없음(이번에는)', '정할 것 없음', '- 없습니다.', '지금은 없습니다.', '(없음)']) {
      assert.deepEqual(decisionItems(`**정할 것**\n${none}\n\n**다음**\n- AI: x`), [], none);
    }
  });
  it('한 번에 하나씩 묻는 굵은 질문 줄과 「선택지 N:」 머리 줄을 잡고, 보기와 설명 줄은 결정 수에 넣지 않는다(재검토 1~3번)', () => {
    const q = '## 결정할 것\n**Q1/1. 운영 DB에 적용할까요?**\n- a) 지금\n- b) 내일\n- 지금 상황: 개발 DB 통과\n\n## 다음\n- AI: x';
    assert.equal(decisionItems(q).length, 3);
    assert.equal(decisionCount(q), 1);
    assert.deepEqual(decisionItems('**선택지 1: 키트를 어디까지 공개할까요?**\na. 전부\n\n**다음**\n- AI: x'), ['키트를 어디까지 공개할까요?\na. 전부']);
    assert.equal(decisionCount('**정할 것**\n1. 공개 범위\n2. 이름\n- 추천: a\n\n**다음**\n- AI: x'), 2);
  });
  it('새 결정이 있는데 이번 차례에 알림을 안 보냈으면 한 번 막고, 같은 결정으로는 다시 막지 않는다', () => {
    const sid = `stall-test-${process.pid}-push`;
    const f = transcript('nopush', [userSay('정해야 할 것 있어?')]);
    assert.match(check({ ...stop(), session_id: sid, transcript_path: f, last_assistant_message: DECIDE }).reason, /결정 알림: .*「결정 1건/);
    assert.equal(check({ ...stop(), session_id: sid, transcript_path: f, last_assistant_message: DECIDE, stop_hook_active: true }), null);
    assert.equal(check({ ...stop(), session_id: sid, transcript_path: f, last_assistant_message: DECIDE }), null);
  });
  it('열린 결정을 괄호 덧말이나 꼬리만 바꿔 다시 적으면 새 결정으로 보지 않고, 다른 결정은 새로 본다(바퀴 13 막음 1)', () => {
    const sid = `stall-test-${process.pid}-rekey`;
    const f = transcript('rekey', [userSay('정해야 할 것 있어?')]);
    const one = (x) => `보고\n\n**② 정할 것**\n1. ${x}\n\n**⑧ 다음**\n- AI(답 뒤): 고칩니다.\n- 대표: 골라 주세요.\n- 기다림: 대표 선택`;
    assert.match(check({ ...stop(), session_id: sid, transcript_path: f, last_assistant_message: one('투표 화면 새 시안대로 구현할지(시안 판정 통과)') }).reason, /결정 알림/);
    assert.equal(check({ ...stop(), session_id: sid, transcript_path: f, last_assistant_message: one('투표 화면 새 시안대로 구현할지(대표 확인 뒤, 기다림)') }), null);
    assert.equal(check({ ...stop(), session_id: sid, transcript_path: f, last_assistant_message: one('**투표 화면 새 시안대로 구현할지**') }), null);
    assert.match(check({ ...stop(), session_id: sid, transcript_path: f, last_assistant_message: one('목록 다음 페이지 정책') }).reason, /결정 알림/);
  });
  it('이번 차례에 알림을 보냈으면 막지 않고, 앞 차례에 보낸 것은 이번 차례로 세지 않는다', () => {
    const sent = transcript('push', [userSay('진행해'), pushCall]);
    assert.equal(check({ ...stop(), transcript_path: sent, last_assistant_message: DECIDE }), null);
    const old = transcript('oldpush', [userSay('진행해'), pushCall, userSay('다른 일 해줘')]);
    assert.match(check({ ...stop(), transcript_path: old, last_assistant_message: DECIDE }).reason, /결정 알림/);
    const wake = { type: 'user', promptSource: 'system', isMeta: true, message: { role: 'user', content: '<check-in> 뒤 작업 확인' } };
    assert.match(check({ ...stop(), transcript_path: transcript('wake', [userSay('진행해'), pushCall, wake]), last_assistant_message: DECIDE }).reason, /결정 알림/);
  });
  it('정할 것이 있어도 답과 별개 줄이 남았으면 이어 하게 하고, 답 뒤 줄만이면 멈춘다', () => {
    const free = DECIDE.replace('- AI(답 뒤): 고른 안으로 고칩니다.', '- AI(답과 별개): 시험을 마저 고칩니다.\n- AI(답 뒤): 고른 안으로 고칩니다.');
    assert.equal(leftoverWork(free), true);
    assert.equal(leftoverWork(DECIDE), false);
    assert.equal(leftoverWork(DECIDE.replace('- AI(답 뒤): 고른 안으로 고칩니다.', '- AI(답과 별개): 할 일이 없습니다.')), false);
    assert.equal(leftoverWork(DECIDE.replace('- AI(답 뒤): 고른 안으로 고칩니다.', '- AI(답과 별개): 실무자 결과를 기다립니다.')), false);
    const f = transcript('free', [userSay('진행해'), pushCall]);
    assert.match(check({ ...stop(), transcript_path: f, last_assistant_message: free }).reason, /이어 하기/);
  });
  it('정할 것을 올렸는데 AI 줄에 표지가 없으면 한 번 나눠 적게 한다', () => {
    const sid = `stall-test-${process.pid}-label`;
    const f = transcript('label', [userSay('진행해'), pushCall]);
    const bare = DECIDE.replace('- AI(답 뒤): 고른 안으로 고칩니다.', '- AI: 고른 안으로 고칩니다.');
    assert.match(check({ ...stop(), session_id: sid, transcript_path: f, last_assistant_message: bare }).reason, /결정 대기 표시/);
    assert.equal(check({ ...stop(), session_id: sid, transcript_path: f, last_assistant_message: `${bare}\n덧붙임`, stop_hook_active: true }), null);
  });
});

describe('stall-check 실무자 상태와 예약을 한 번 판정한다', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stall-settle-'));
  const sids = [];
  const sidOf = (name) => { const s = `stall-test-${process.pid}-${name}`; sids.push(s); return s; };
  const transcript = (name, entries) => {
    const f = path.join(tmp, `${name}.jsonl`);
    fs.writeFileSync(f, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
    return f;
  };
  // 하네스가 차례를 끝낸 서브에이전트가 뒤 작업을 기다릴 때 대화 기록에 남기는 알림(queue-operation)을 흉내 낸다.
  const note = (id, summary, at) => ({ type: 'queue-operation', operation: 'enqueue', timestamp: at, content: `<task-notification>\n<task-id>${id}</task-id>\n<status>completed</status>\n<summary>${summary}</summary>\n</task-notification>` });
  const waitNote = (id, desc, at) => note(id, `Agent "${desc}" is waiting on its own background work`, at);
  const doneNote = (id, desc, at) => note(id, `Agent "${desc}" finished`, at);
  const NOW = new Date('2026-11-08T06:20:00Z');
  const wakeOne = { id: 'c1', schedule: '13 16 8 11 *', recurring: false, prompt: '<check-in> 뒤 작업 확인: …' };

  it('뒤 작업을 기다리는 서브에이전트(status waiting)도 돌고 있는 것과 같이 기다리는 대상이라, 깨우는 예약을 지우라고 하지 않는다', () => {
    const w = task('a1', 'subagent', { status: 'waiting' });
    const main = pend(path.join(tmp, 'status-wait.jsonl'), 'a1');
    assert.equal(check(stop({ transcript_path: main, background_tasks: [w], session_crons: [wakeOne] }), NOW), null);
    assert.match(check(stop({ transcript_path: main, background_tasks: [w] }), NOW).reason, /^실무자 기다림: 뒤에서 도는 실무자 1명\(일 a1\)/);
    assert.match(check(stop({ session_crons: [wakeOne], background_tasks: [task('a1', 'subagent', { status: 'completed' })] }), NOW).reason, /^예약 정리/);
  });
  it('돎, 기다림, 돎으로 번갈아 와도 같은 예약에 대해 지우라고도 새로 걸라고도 하지 않는다', () => {
    const sid = sidOf('flip');
    const f = pend(transcript('flip', [waitNote('a1', '일 a1', '2026-11-08T06:10:17Z')]), 'a1');
    const at = (status, tasks) => check(stop({ session_id: sid, transcript_path: f, background_tasks: [task('a1', 'subagent', { status })], session_crons: [wakeOne], ...tasks }), NOW);
    assert.equal(at('running'), null);
    assert.equal(at('completed'), null);
    assert.equal(at('running'), null);
    assert.equal(at('waiting'), null);
  });
  it('입력이 끝남으로 와도 대화 기록의 마지막 알림이 뒤 작업 기다림이면 기다리는 대상으로 보고, 끝 알림이 오면 예약을 지우게 한다', () => {
    const sid = sidOf('note');
    const waiting = pend(transcript('note-wait', [waitNote('a1', '일 a1', '2026-11-08T06:10:17Z')]), 'a1');
    const done = transcript('note-done', [waitNote('a1', '일 a1', '2026-11-08T06:10:17Z'), doneNote('a1', '일 a1', '2026-11-08T06:16:58Z')]);
    const tasks = [task('a1', 'subagent', { status: 'completed' })];
    assert.equal(check(stop({ session_id: sid, transcript_path: waiting, background_tasks: tasks, session_crons: [wakeOne] }), NOW), null);
    assert.match(check(stop({ session_id: sidOf('note2'), transcript_path: waiting, background_tasks: tasks }), NOW).reason, /^실무자 기다림: .*\(일 a1\)/);
    assert.match(check(stop({ session_id: sid, transcript_path: done, background_tasks: tasks, session_crons: [wakeOne] }), NOW).reason, /^예약 정리/);
  });
  it('입력에서 빠진 서브에이전트도 알림으로 기다리는 중임을 알고, 알림이 기록 끝에서 밀려나도 기억한다', () => {
    const sid = sidOf('memo');
    const f = pend(transcript('memo', [waitNote('a9', '빠진 일', '2026-11-08T06:10:00Z')]), 'a9');
    assert.equal(check(stop({ session_id: sid, transcript_path: f, session_crons: [wakeOne] }), NOW), null);
    fs.writeFileSync(f, '');
    assert.equal(check(stop({ session_id: sid, transcript_path: f, session_crons: [wakeOne] }), NOW), null);
    assert.match(check(stop({ session_id: sid, transcript_path: f }), NOW).reason, /^실무자 기다림: .*\(빠진 일\)/);
  });
  it('마지막 알림이 기다림이어도 실무자 기록에 남은 뒤 작업이 끝났거나 만료됐으면 기다리지 않고 예약을 지우게 한다(11-09 57af3589 헛막음)', () => {
    // 실제 꼴: 실무자가 셸 하나와 Monitor 둘을 띄우고 차례를 끝냈다. 셸과 Monitor 하나는 끝 알림이 왔고, 5분짜리 Monitor는 끝 알림 없이 만료됐다.
    // Monitor event 알림(status 없음)은 감시가 이어지는 것이라 끝으로 세지 않는다. 도구 결과에 인용된 끝 알림 글도 세지 않는다.
    const main = transcript('expired', [waitNote('af6b', '구현과 문서: 정할 것 패널 걷기', '2026-11-09T15:16:21Z')]);
    const sub = path.join(main.replace(/\.jsonl$/, ''), 'subagents');
    fs.mkdirSync(sub, { recursive: true });
    const notice = (id, status) => `<task-notification>\n<task-id>${id}</task-id>\n${status ? `<status>${status}</status>\n` : ''}<summary>…</summary>\n</task-notification>`;
    const rows = [
      { type: 'user', timestamp: '2026-11-09T15:10:00Z', message: { content: [{ type: 'tool_result', content: 'Command running in background with ID: bsh.' }] }, toolUseResult: { backgroundTaskId: 'bsh' } },
      { type: 'user', timestamp: '2026-11-09T15:12:11Z', message: { content: [{ type: 'tool_result', content: 'Monitor started (task bm1, expires in 10m …)' }] }, toolUseResult: { taskId: 'bm1', timeoutMs: 600000, persistent: false } },
      { type: 'user', timestamp: '2026-11-09T15:12:33Z', message: { content: [{ type: 'tool_result', content: 'Monitor started (task bm2, expires in 5m …)' }] }, toolUseResult: { taskId: 'bm2', timeoutMs: 300000, persistent: false } },
      { type: 'user', timestamp: '2026-11-09T15:13:00Z', message: { content: [{ type: 'tool_result', content: notice('bm2', 'completed') }] } },
      { type: 'user', timestamp: '2026-11-09T15:13:30Z', message: { content: `[SYSTEM NOTIFICATION]\n\n${notice('bm2', '')}` } },
      { type: 'user', timestamp: '2026-11-09T15:14:08Z', message: { content: `[SYSTEM NOTIFICATION]\n\n${notice('bsh', 'completed')}` } },
      { type: 'attachment', timestamp: '2026-11-09T15:14:09Z', attachment: { type: 'queued_command', prompt: notice('bm1', 'completed') } },
      { type: 'assistant', timestamp: '2026-11-09T15:16:18Z', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: '보고는 앞에 올린 그대로입니다.' }] } },
    ];
    fs.writeFileSync(path.join(sub, 'agent-af6b.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    fs.writeFileSync(path.join(sub, 'agent-af6b.meta.json'), JSON.stringify({ description: '구현과 문서: 정할 것 패널 걷기', finished: true }));
    const at = (iso) => new Date(iso);
    assert.deepEqual(bgLeft(path.join(sub, 'agent-af6b.jsonl'), at('2026-11-09T15:16:22Z').getTime()), ['bm2']);
    assert.deepEqual(bgLeft(path.join(sub, 'agent-af6b.jsonl'), at('2026-11-09T15:17:34Z').getTime()), []);
    // 만료 전에는 기다리고, 만료 뒤에는 막지 않고 남은 깨우기 예약을 지우게 한다. 같은 세션 기억(waits)도 지워 다음 멈춤에서 되살아나지 않는다.
    const sid = sidOf('expired');
    assert.match(check(stop({ session_id: sid, transcript_path: main }), at('2026-11-09T15:16:30Z')).reason, /^실무자 기다림: .*\(구현과 문서: 정할 것 패널 걷기\)/);
    assert.equal(check(stop({ session_id: sid, transcript_path: main }), at('2026-11-09T17:30:17Z')), null);
    assert.match(check(stop({ session_id: sid, transcript_path: main, session_crons: [wakeOne] }), at('2026-11-09T17:31:00Z')).reason, /^예약 정리/);
    fs.writeFileSync(main, '');
    assert.equal(check(stop({ session_id: sid, transcript_path: main }), at('2026-11-09T17:32:00Z')), null);
  });
  it('실무자 기록이 없거나 대화 기록 경로가 없어 뒤 작업을 가를 수 없으면 기다리지 않는다', () => {
    const main = transcript('norec', [waitNote('nr1', '기록 없는 일', '2026-11-08T06:10:00Z')]);
    assert.equal(check(stop({ session_id: sidOf('norec'), transcript_path: main }), NOW), null);
    assert.equal(check(stop({ background_tasks: [task('nr2', 'subagent', { status: 'waiting' })] }), NOW), null);
  });
  it('기다림이 4시간 넘게 소식이 없으면 잃은 것으로 보고 세지 않고, 도구 결과에 인용된 알림 글은 알림으로 세지 않는다', () => {
    const old = transcript('old', [waitNote('a2', '오래된 일', '2026-11-08T01:00:00Z')]);
    assert.match(check(stop({ session_id: sidOf('old'), transcript_path: old, session_crons: [wakeOne] }), NOW).reason, /^예약 정리/);
    const quoted = transcript('quoted', [{ type: 'user', timestamp: '2026-11-08T06:10:00Z', message: { content: [{ type: 'tool_result', content: '{"content":"<task-notification><task-id>a3</task-id><summary>Agent \\"x\\" is waiting on its own background work</summary>"}' }] } }]);
    assert.deepEqual(taskNotes(fs.readFileSync(quoted, 'utf8').split('\n')), []);
    assert.equal(check(stop({ session_id: sidOf('quoted'), transcript_path: quoted }), NOW), null);
  });
  it('뒤 작업을 기다리는 서브에이전트는 기록이 안 자라도 멈춘 듯으로 알리지 않고, 기다리는 동안 이어 하기로 막지도 않는다', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stall-wstuck-'));
    const sub = path.join(root, 'sess', 'subagents');
    fs.mkdirSync(sub, { recursive: true });
    const file = path.join(sub, 'agent-w.jsonl');
    fs.writeFileSync(path.join(sub, 'agent-w.meta.json'), JSON.stringify({ description: '시험 도는 일' }));
    fs.writeFileSync(file, JSON.stringify({ type: 'assistant', message: { stop_reason: 'tool_use', content: [] } }) + '\n');
    pend(path.join(root, 'sess.jsonl'), 'w');
    const t = new Date(NOW.getTime() - 30 * 60000);
    fs.utimesSync(file, t, t);
    const main = path.join(root, 'sess.jsonl');
    fs.writeFileSync(main, '');
    const w = task('w', 'subagent', { status: 'waiting', description: '시험 도는 일' });
    const out = check(stop({ session_id: sidOf('wstuck'), transcript_path: main, background_tasks: [w], session_crons: [wakeOne], last_assistant_message: '**⑧ 다음**\n- AI: 시험을 이어 돌립니다.\n- 대표: 없음' }), NOW);
    assert.equal(out, null);
    fs.rmSync(root, { recursive: true, force: true });
  });
  it('AI가 다른 까닭으로 건 <check-in> 예약은 지우라고 하지 않는다(바퀴 13 막음 2)', () => {
    const mine = { id: 'm1', schedule: '33 20 9 11 *', recurring: false, prompt: '<check-in> 하루 보고가 나왔는지 확인한다' };
    assert.equal(check(stop({ session_crons: [mine] }), NOW), null);
    assert.match(check(stop({ session_crons: [mine, wakeOne] }), NOW).reason, /예약 정리: .*id c1\)/);
  });
  it('이름 없는 한 번짜리 예약이 이미 걸려 있으면 새 예약을 요구하지 않고 그 예약을 지우라고도 하지 않는다', () => {
    const other = { id: 'o1', schedule: '47 15 8 11 *', recurring: false, prompt: '키트 목적 달성 반복: 결과를 확인하고 이어 간다.' };
    assert.equal(check(stop({ background_tasks: [task('a1', 'subagent')], session_crons: [other] }), NOW), null);
    assert.equal(check(stop({ session_crons: [other] }), NOW), null);
    assert.match(check(stop({ session_crons: [other, wakeOne] }), NOW).reason, /예약 정리: .*id c1\)/);
  });
});

describe('stall-check 열린 칸 대조', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stall-open-'));
  const work = path.join(root, 'proj', 'docs', 'plan', 'work');
  fs.mkdirSync(work, { recursive: true });
  const progress = path.join(work, 'job-progress.md');
  const BOXES = '# 진행\n- [x] 끝난 일\n- [ ] 설치본에 반영\n- [ ] 대표 화면에 보이기(대표 지시 뒤)\n  - [ ] 시험 돌리기\n';
  const edit = (file, name = 'Edit') => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name, input: { file_path: file } }] } });
  const log = (name, entries) => {
    const f = path.join(root, `${name}.jsonl`);
    fs.writeFileSync(f, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
    return f;
  };
  // 「남은 일 N건」 줄은 남은 일 수 판정(아래 따로 시험)을 넘기려고 넣는다. 이 묶음은 열린 칸 대조만 본다.
  const report = (ai, extra = '') => `**① 한 일**\n끝냈습니다.\n\n**⑧ 다음**\n- 남은 일 2건\n- AI: ${ai}\n- 대표: 확인${extra}`;
  const NONE = report('없음');
  let k = 0;
  const run = (over = {}, { file = progress, text = BOXES, tool = 'Edit' } = {}) => {
    fs.writeFileSync(progress, text);
    const sid = over.session_id || `stall-test-${process.pid}-open${k++}`;
    return check({ ...stop(), session_id: sid, transcript_path: log(`t${k}`, [edit(file, tool)]), last_assistant_message: NONE, ...over });
  };

  it('이번 세션이 고친 진행 기록에 AI 몫 열린 칸이 있는데 「다음」 AI 줄이 없음이면 한 번 막는다. 사용자 몫 칸은 세지 않는다', () => {
    const out = run();
    assert.match(out.reason, /^열린 칸 대조: .*남은 일\(열린 칸 - \[ \]와 「남은 물음」\)이 2개 있는데/);
    assert.match(out.reason, /「설치본에 반영」\(job-progress\.md\)/);
    assert.doesNotMatch(out.reason, /화면에 보이기/);
    assert.equal(openBoxes([progress]).length, 2);
  });
  it('같은 열린 칸 묶음으로는 세션에 두 번 막지 않고, 칸이 달라지면 다시 묻는다', () => {
    const sid = `stall-test-${process.pid}-openonce`;
    assert.match(run({ session_id: sid }).reason, /^열린 칸 대조/);
    assert.equal(run({ session_id: sid }), null);
    assert.match(run({ session_id: sid }, { text: `${BOXES}- [ ] 새 칸\n` }).reason, /이 3개 있는데/);
  });
  it('칸이 모두 닫혔거나, AI 줄에 할 일이 있거나, 기다림 줄이나 「다음」 칸이 없거나, 이번 세션이 고치지 않은 기록이면 막지 않는다', () => {
    assert.equal(run({}, { text: '- [x] 끝\n- [ ] 대표 확인\n' }), null);
    assert.doesNotMatch(run({ last_assistant_message: report('남은 칸을 이어 합니다.') })?.reason || '', /열린 칸 대조/);
    assert.equal(run({ last_assistant_message: `${NONE}\n- 기다림: 설치본에 반영과 시험 돌리기가 끝나는 것` }), null);
    assert.equal(run({ last_assistant_message: '끝냈습니다. 더 할 일은 없습니다.' }), null);
    assert.equal(run({}, { file: path.join(root, 'other.md') }), null);
    assert.equal(run({}, { tool: 'Read' }), null);
    assert.equal(run({ last_assistant_message: report('없음').replace('- 대표: 확인', '- 대표: a나 b를 골라 주세요.') }), null);
  });
  it('Edit, Write가 아니라 셸 명령(python 쓰기, sed -i, 리다이렉트)으로 고친 진행 기록도 이번 세션이 고친 것으로 본다', () => {
    const file = progress;
    const cmd = (c, cwd = path.join(root, 'proj')) => ({ type: 'assistant', cwd, message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: c } }] } });
    const via = (c, cwd) => { fs.writeFileSync(file, BOXES); return check({ ...stop(), session_id: `stall-test-${process.pid}-sh${k++}`, transcript_path: log(`sh${k}`, [cmd(c, cwd)]), last_assistant_message: NONE }); };
    assert.match(via(`python3 - <<'EOF'\np='${file}'\ns=open(p).read()\nopen(p,'w').write(s)\nEOF`).reason, /^열린 칸 대조/);
    assert.match(via(`cd ${work} && python3 - <<'EOF'\np='job-progress.md'\nopen(p,'w').write('x')\nEOF`).reason, /^열린 칸 대조/);
    assert.match(via(`sed -i '' 's/a/b/' docs/plan/work/job-progress.md`).reason, /^열린 칸 대조/);
    assert.match(via(`echo x >> docs/plan/work/job-progress.md`).reason, /^열린 칸 대조/);
    assert.equal(via(`grep -n 사과 ${file} 2>/dev/null`), null);
    assert.equal(via(`python3 -c "print(open('${file}').read())"`), null);
  });
  it('끝 2MB 앞에서 고친 진행 기록도 놓치지 않고, 한 Stop에 대화 기록은 한 번만 훑으며, 이미 훑은 곳은 다시 읽지 않는다', () => {
    fs.writeFileSync(progress, BOXES);
    const sid = `stall-test-${process.pid}-scan${k++}`;
    const filler = JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'x'.repeat(1000) }] } });
    const f = path.join(root, `big${k}.jsonl`);
    // 진행 기록 고침을 맨 앞에 두고 그 뒤에 3MB 넘는 줄을 쌓는다(끝 2MB만 읽던 때는 이 고침이 빠졌다)
    fs.writeFileSync(f, [JSON.stringify(edit(progress)), ...Array(3200).fill(filler)].join('\n') + '\n');
    assert.ok(fs.statSync(f).size > 3_000_000);
    const before = workScanCount();
    const first = check({ ...stop(), session_id: sid, transcript_path: f, last_assistant_message: NONE });
    assert.match(first.reason, /^열린 칸 대조: .*「설치본에 반영」/);
    assert.equal(workScanCount() - before, 1);
    const state = JSON.parse(fs.readFileSync(path.join(STATE_DIR, `stall-check-${sid}.json`), 'utf8'));
    assert.deepEqual(state.workScan, { path: f, offset: fs.statSync(f).size });
    // 읽은 곳 뒤로 새로 덧붙은 고침만 새로 읽는다
    const other = path.join(work, 'second-progress.md');
    fs.writeFileSync(other, '# 둘째\n- [ ] 둘째 칸\n');
    fs.appendFileSync(f, JSON.stringify(edit(other)) + '\n');
    const at = workScanCount();
    check({ ...stop(), session_id: sid, transcript_path: f, last_assistant_message: NONE });
    assert.equal(workScanCount() - at, 1);
    const state2 = JSON.parse(fs.readFileSync(path.join(STATE_DIR, `stall-check-${sid}.json`), 'utf8'));
    assert.deepEqual(state2.workFiles, [progress, other]);
    // 덧붙은 것이 없으면 다시 읽지 않는다
    const idle = workScanCount();
    check({ ...stop(), session_id: sid, transcript_path: f, last_assistant_message: NONE });
    assert.equal(workScanCount() - idle, 0);
  });
  it('줄바꿈 없이 덜 쓰인 마지막 줄은 읽은 곳에 넣지 않고 다음에 온전해지면 읽는다. 파일이 줄었으면 처음부터 다시 읽는다', () => {
    fs.writeFileSync(progress, BOXES);
    const sid = `stall-test-${process.pid}-scan${k++}`;
    const f = path.join(root, `part${k}.jsonl`);
    const line = JSON.stringify(edit(progress));
    fs.writeFileSync(f, line.slice(0, 40));
    check({ ...stop(), session_id: sid, transcript_path: f, last_assistant_message: NONE });
    const st = () => JSON.parse(fs.readFileSync(path.join(STATE_DIR, `stall-check-${sid}.json`), 'utf8'));
    assert.equal(st().workScan.offset, 0);
    assert.deepEqual(st().workFiles, []);
    fs.writeFileSync(f, line);
    assert.match(check({ ...stop(), session_id: sid, transcript_path: f, last_assistant_message: NONE }).reason, /^열린 칸 대조/);
    assert.equal(st().workScan.offset, line.length);
    fs.writeFileSync(f, '\n');
    check({ ...stop(), session_id: sid, transcript_path: f, last_assistant_message: NONE });
    assert.equal(st().workScan.offset, 1);
  });
  it('30분보다 오래전에 고친 진행 기록의 열린 칸은 보지 않고, 30분 안에 고친 기록만 본다. 고친 때를 모르는 기록은 거르지 않는다', () => {
    const second = path.join(work, 'fresh-progress.md');
    fs.writeFileSync(progress, BOXES);
    fs.writeFileSync(second, '# 새\n- [ ] 새 기록의 칸\n');
    const stopAt = Date.parse('2026-11-08T12:00:00.000Z');
    const editAt = (file, minutesBefore) => ({ ...edit(file), timestamp: new Date(stopAt - minutesBefore * 60000).toISOString() });
    const via = (name, entries, now = stopAt) => check({ ...stop(), session_id: `stall-test-${process.pid}-fresh${k++}`, transcript_path: log(`${name}${k}`, entries), last_assistant_message: NONE }, new Date(now));
    assert.equal(via('stale', [editAt(progress, 31)]), null, '31분 전에 고친 기록은 낡은 칸이다');
    assert.match(via('live', [editAt(progress, 29)]).reason, /「설치본에 반영」\(job-progress\.md\)/);
    const mixed = via('mixed', [editAt(progress, 90), editAt(second, 5)]);
    assert.match(mixed.reason, /이 1개 있는데\(「새 기록의 칸」\(fresh-progress\.md\)\)/);
    assert.doesNotMatch(mixed.reason, /설치본에 반영/);
    assert.equal(via('stale-then', [editAt(progress, 90), editAt(progress, 20)]).reason.includes('job-progress.md'), true, '오래전에 고쳤어도 최근에 또 고쳤으면 본다');
    assert.match(via('untimed', [edit(progress)]).reason, /^열린 칸 대조/);
  });
  it('낡아서 거른 칸만 있던 Stop도 한 번 읽은 것으로 적어, 그 칸이 그대로인 채 나중에 막지 않는다. 칸이 달라지면 다시 묻는다', () => {
    fs.writeFileSync(progress, BOXES);
    const stopAt = Date.parse('2026-11-08T12:00:00.000Z');
    const editAt = (minutesBefore) => ({ ...edit(progress), timestamp: new Date(stopAt - minutesBefore * 60000).toISOString() });
    const sid = `stall-test-${process.pid}-fresh${k++}`;
    const go = (entries, now) => check({ ...stop(), session_id: sid, transcript_path: log(`seen${k++}`, entries), last_assistant_message: NONE }, new Date(now));
    assert.equal(go([editAt(300)], stopAt), null, '낡은 기록이라 막지 않는다');
    assert.equal(go([editAt(300), editAt(5)], stopAt + 1000), null, '같은 칸이 이제 새로 고친 기록에 있어도 앞 Stop에서 이미 읽었다');
    fs.writeFileSync(progress, `${BOXES}- [ ] 새 칸\n`);
    assert.match(go([editAt(300), editAt(5)], stopAt + 2000).reason, /이 3개 있는데/);
  });
  it('도는 일이 있는 동안과 한 번 막은 뒤에는 대조하지 않는다', () => {
    assert.equal(run({ background_tasks: [task('b1', 'shell', { command: 'npm test' })] }), null);
    assert.equal(run({ stop_hook_active: true }), null);
  });
});

// 사용자가 「더 없어?」라고 되물은 실제 정정 7건의 바로 앞 답을 꼴만 줄여 둔 표본이다(이름과 문장은 일반화했다).
// 3건은 진행 기록에 남은 일이 있었고(막아야 함), 4건은 남은 일이 진행 기록 밖(답 본문, 앞선 대화, 답 안의 「확인 못 한 것」)에만 있어 못 막는다.
// 못 막는 4건이 그대로 통과함을 시험으로 두어, 잡는 수가 늘거나 줄면 이 시험이 알린다.
describe('stall-check 열린 칸 대조: 「더 없어?」 정정 7건 되돌려 보기', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stall-seven-'));
  const work = path.join(root, 'docs', 'plan', 'work');
  fs.mkdirSync(work, { recursive: true });
  const KIT = [
    '# 진행',
    '- [x] 끝난 묶음',
    '- [ ] 묶음 가(판정과 재기): 재발을 세는 쪽과 기준선 맞추기',
    '- [ ] 묶음 나(남은 일 대조 넓히기): 실제 기록 되돌려 보기를 시험 자료로',
    '- [ ] 공개 저장소 push: 모두 정리된 뒤 대표 지시 때',
    '- [ ] 11-10: 점검 목록 줄이기 효과를 앞 사흘과 견줌',
    '',
  ].join('\n');
  let q = 0;
  const run = (text, { progress = KIT, touch = true } = {}) => {
    const file = path.join(work, `case-${q}-progress.md`);
    fs.writeFileSync(file, progress);
    const tlog = path.join(root, `t${q}.jsonl`);
    const entries = touch ? [{ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Edit', input: { file_path: file } }] } }] : [];
    fs.writeFileSync(tlog, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
    return check({ ...stop(), session_id: `stall-test-${process.pid}-seven${q++}`, transcript_path: tlog, last_assistant_message: text });
  };
  const blocked = (out) => /^열린 칸 대조/.test(out?.reason || '');

  // 앞의 세 건이 막히는 것: 키트 진행 기록에 남은 일이 둘 있는데 답의 「다음」 칸에는 없다.
  const CAUGHT = [
    ['정정 4번 꼴: 「다음」 AI 줄이 없음이고 「기다림: 대표님의 다음 지시」로 끝난 답', '이번 묶음에서 남은 AI 할 일은 없습니다.\n\n**다음**\n- AI: 없음\n- 대표님: 없음\n\n기다림: 대표님의 다음 지시'],
    ['정정 5번 꼴: AI 줄에 날짜가 정해진 다른 일만 적고 「기다림: 11-10」으로 끝난 긴 보고', `소개 문서를 한 판으로 고쳤습니다. ${'공개판은 내보낼 때 자동으로 뽑힙니다. '.repeat(8)}\n\n**이번에 한 것**\n- 공개용 사본을 지웠습니다.\n\n**다음**\n- AI: 11-10에 점검 목록 줄이기의 효과를 앞 사흘과 견줍니다.\n- 대표님: 없음\n\n기다림: 11-10`],
    ['정정 6번 꼴: 「다음」 칸이 없고 「쉬는 중」이라 쓴 뒤 「기다림」과 고를 거리만 적은 짧은 답', '다른 세션은 할 일 없이 쉬는 중입니다. 제가 그쪽에 기다리는 것이 없어 할 일이 생기지 않습니다.\n\n기다림: 대표님이 다음 일을 고르시는 것\n- a) 오류 고치기\n- b) 움직임 빠르게\n- c) 발표모드'],
  ];
  // 뒤의 네 건이 못 막히는 것: 남은 일이 진행 기록에 없다.
  const MISSED = [
    ['정정 1번 꼴: 본문에 「다음에 묶어 고칩니다」라 쓴 작은 점들이 「다음」 칸에는 없다', '비용은 어림의 1.8배였습니다.\n- 이름 찾기 고침을 머지했습니다.\n  - 남은 작은 점 셋은 다음에 묶어 고칩니다.\n    - 대소문자만 다른 이름은 한쪽만 셉니다.\n\n다음은 제가 이어 합니다.\n- 14시 계산이 끝나면 넓은 평가를 냅니다.\n\n지금 대표님이 하실 일은 없습니다.', { progress: '# 기록\n- [x] 끝\n' }],
    ['정정 2번 꼴: AI 줄에 세 건을 적었으나 앞선 대화에서 미룬 다른 건이 빠짐', '모자란 점 4건을 처리했습니다.\n\n**다음**\n- AI:\n  1. 재현 나머지가 끝나면 비용을 정리합니다.\n  2. 07시대에 경고가 다시 울리지 않는지 봅니다.\n- 대표님: 하실 일은 없습니다.\n- 기다림: 재현 배치', { progress: '# 기록\n- [x] 끝\n' }],
    ['정정 3번 꼴: 점검 뒤 고친 것만 쓴 조각 답', '점검 뒤 고친 것:\n- 문서 증감: 두 커밋을 합쳐 문서 2곳에서 3줄이 늘었습니다.\n- 파일 위치: 고친 문서는 저장소 안에 있습니다.', { progress: '# 기록\n- [x] 끝\n' }],
    ['정정 7번 꼴: 진행 기록을 고치지 않은 일의 보고가 「확인 못 한 것」을 적고 AI 줄은 「이어서 할 일은 없습니다」', '첫 판은 완성됐고 시험도 끝냈습니다.\n\n**아직 확인 못 한 것**\n- 문서로만 확인했고 직접 돌려 보지 않은 것이 둘 있습니다.\n\n다음\n- AI: 이어서 할 일은 없습니다.\n- 대표: 할 일 없습니다.', { touch: false }],
  ];

  it('진행 기록에 남은 일이 있던 3건은 막고, 답의 「다음」 칸에 적었으면 같은 꼴도 막지 않는다', () => {
    for (const [name, text] of CAUGHT) assert.equal(blocked(run(text)), true, name);
    const covered = '묶음 가의 재발 세기와 기준선 맞추기, 묶음 나의 남은 일 대조 넓히기를 이어 합니다.';
    for (const [name, text] of CAUGHT) assert.equal(blocked(run(`${text}\n- AI: ${covered}`)), false, `${name}(적은 뒤)`);
  });
  it('남은 일이 진행 기록 밖에만 있던 4건은 막지 못한다(한계를 시험으로 남김). 합쳐 7건 가운데 3건을 막는다', () => {
    for (const [name, text, opt] of MISSED) assert.equal(blocked(run(text, opt)), false, name);
    const all = [...CAUGHT, ...MISSED].map(([, text, opt]) => blocked(run(text, opt)));
    assert.equal(all.filter(Boolean).length, 3);
    assert.equal(all.length, 7);
  });
  it('칸 주인은 줄 머리만 본다. 뒤쪽 글이 대표나 기다림을 인용해도 AI 몫이고, 머리에 있으면 사용자 몫이다', () => {
    const f = path.join(work, 'owner.md');
    fs.writeFileSync(f, [
      '- [ ] 공개 점검(대표 물음 「푸시하면 전부 공개 아닌가」): 파일 일반화',
      '- [ ] 판정 후보(「기다림」을 인용한 멈춤 검사 꼴): 두 상태를 한 번만 판정',
      '- [ ] 공개 저장소 push: 대표 지시 때',
      '- [ ] 대표 확인: 화면',
      '- [ ] 11-10: 효과 견주기',
      '- [ ] 내일부터 지켜보기',
      '',
    ].join('\n'));
    assert.deepEqual(openBoxes([f]).map((x) => x.line.split(':')[0]), ['공개 점검(대표 물음 「푸시하면 전부 공개 아닌가」)', '판정 후보(「기다림」을 인용한 멈춤 검사 꼴)']);
  });
  it('「남은 물음」, 「남은 일」 절의 AI 몫 항목도 남은 일로 센다. 풀림, 없음, 대표 몫은 세지 않는다', () => {
    const f = path.join(work, 'ask.md');
    fs.writeFileSync(f, ['# 논의', '## 남은 물음', '- (풀림) 알림 도착 확인됨', '- 대표: a, b, c 가운데 고르기', '- 묶음을 받을 수 있는지 시험', '', '## 근거', '- 이 줄은 남은 일이 아니다', '## 남은 일', '없음', ''].join('\n'));
    assert.deepEqual(openBoxes([f]).map((x) => x.line), ['묶음을 받을 수 있는지 시험']);
  });
});

describe('stall-check TaskStop으로 멈춘 실무자는 기다림 기억에서 지운다', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stall-taskstop-'));
  const note = (id, summary, at) => ({ type: 'queue-operation', operation: 'enqueue', timestamp: at, content: `<task-notification>\n<task-id>${id}</task-id>\n<status>completed</status>\n<summary>${summary}</summary>\n</task-notification>` });
  // 11-08 07:28Z 실제 꼴: TaskStop 결과는 user 줄의 tool_result이고 toolUseResult.task_id에 id가 있다.
  const stopped = (id, at) => ({ type: 'user', timestamp: at, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_x', content: `{"message":"Successfully stopped task: ${id} (구현과 문서: 바퀴 2 묶음 가)","task_id":"${id}"}` }] }, toolUseResult: { message: `Successfully stopped task: ${id} (구현과 문서)`, task_id: id, task_type: 'local_agent' } });
  const file = (name, rows) => { const f = path.join(tmp, `${name}.jsonl`); fs.writeFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + '\n'); return pend(f, 'a0beb944516e445be'); };
  const wait = note('a0beb944516e445be', 'Agent "구현과 문서: 바퀴 2 묶음 가" is waiting on its own background work', '2026-11-08T06:53:00Z');
  const wakeOne = { id: 'c1', schedule: '13 16 8 11 *', recurring: false, prompt: '<check-in> 뒤 작업 확인: …' };
  const NOW = new Date('2026-11-08T07:30:00Z');
  const done = [task('a0beb944516e445be', 'subagent', { status: 'completed' })];

  it('TaskStop 성공 결과의 task_id를 읽는다. 도구 결과에 인용된 글과 실패 결과는 세지 않는다', () => {
    const lines = [stopped('a0beb944516e445be', '2026-11-08T07:28:13Z'), { type: 'user', timestamp: 'x', message: { content: 'Successfully stopped task: zzz' } }].map((r) => JSON.stringify(r));
    assert.deepEqual(stopNotes(lines).map((x) => x.id), ['a0beb944516e445be']);
  });
  it('기다림 알림 뒤에 TaskStop 성공이 있으면 기다리는 대상에서 빼고, 깨우는 예약이 남았으면 지우게 한다. 멈추지 않았으면 그대로 기다린다', () => {
    const before = file('wait-only', [wait]);
    assert.match(check(stop({ session_id: `stall-test-${process.pid}-ts0`, transcript_path: before, background_tasks: done }), NOW).reason, /^실무자 기다림: .*a0beb944516e445be/);
    const after = file('wait-stop', [wait, stopped('a0beb944516e445be', '2026-11-08T07:28:13Z')]);
    assert.equal(check(stop({ session_id: `stall-test-${process.pid}-ts1`, transcript_path: after, background_tasks: done }), NOW), null);
    assert.match(check(stop({ session_id: `stall-test-${process.pid}-ts2`, transcript_path: after, background_tasks: done, session_crons: [wakeOne] }), NOW).reason, /^예약 정리/);
  });
  it('멈춘 뒤에 다시 기다림 알림이 오면 다시 기다리고, 알림 기록이 기록 끝에서 밀려난 뒤에 멈춰도 기억에서 지운다', () => {
    const again = file('stop-wait', [stopped('a0beb944516e445be', '2026-11-08T07:10:00Z'), note('a0beb944516e445be', 'Agent "구현과 문서" is waiting on its own background work', '2026-11-08T07:20:00Z')]);
    assert.match(check(stop({ session_id: `stall-test-${process.pid}-ts3`, transcript_path: again, background_tasks: done }), NOW).reason, /^실무자 기다림/);
    const sid = `stall-test-${process.pid}-ts4`;
    assert.match(check(stop({ session_id: sid, transcript_path: file('mem1', [wait]), background_tasks: done }), NOW).reason, /^실무자 기다림/);
    assert.equal(check(stop({ session_id: sid, transcript_path: file('mem2', [stopped('a0beb944516e445be', '2026-11-08T07:28:13Z')]), background_tasks: done }), NOW), null);
  });
});

describe('stall-check 진행 기록 폴더는 설정으로 더한다', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stall-dirs-'));
  const withConfig = (cfg, fn) => {
    const dir = fs.mkdtempSync(path.join(root, 'cfg-'));
    fs.mkdirSync(path.join(dir, 'subagent-system'));
    if (cfg) fs.writeFileSync(path.join(dir, 'subagent-system', 'config.json'), typeof cfg === 'string' ? cfg : JSON.stringify(cfg));
    const prev = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = dir;
    try { return fn(); } finally { if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = prev; }
  };
  const proj = path.join(root, 'proj');
  const nested = path.join(proj, 'docs', '_temp', 'overhaul');
  fs.mkdirSync(nested, { recursive: true });
  const progress = path.join(nested, 'progress.md');
  const edit = (f) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Edit', input: { file_path: f } }] } });
  let k = 0;
  const run = () => {
    fs.writeFileSync(progress, '- [ ] 사과 화면 남은 일\n');
    const t = path.join(root, `t${k}.jsonl`);
    fs.writeFileSync(t, JSON.stringify(edit(progress)) + '\n');
    return check({ ...stop(), session_id: `stall-test-${process.pid}-dirs${k++}`, transcript_path: t, last_assistant_message: '**⑧ 다음**\n- AI: 없음\n- 대표: 없음' });
  };

  it('설정이 없으면 기본 폴더(docs/plan/work)만 본다. 설정이 깨졌거나 모양이 틀려도 기본값은 남고 오류가 없다', () => {
    assert.deepEqual(withConfig(null, progressDirs), ['docs/plan/work']);
    assert.deepEqual(withConfig('{깨짐', progressDirs), ['docs/plan/work']);
    assert.deepEqual(withConfig({ progressDirs: 'docs/_temp' }, progressDirs), ['docs/plan/work']);
    assert.equal(withConfig(null, run), null);
  });
  it('progressDirs에 적은 폴더(하위 폴더 포함)에서 이번 세션이 고친 기록도 열린 칸 대조에 든다. 위로 벗어나는 경로와 빈 값은 무시한다', () => {
    const cfg = { progressDirs: ['./docs/_temp/', '', '../x', 7, 'docs/_temp'] };
    assert.deepEqual(withConfig(cfg, progressDirs), ['docs/plan/work', 'docs/_temp']);
    assert.match(withConfig(cfg, run).reason, /^열린 칸 대조: .*「사과 화면 남은 일」\(progress\.md\)/);
  });
  it('셸 명령으로 고친 설정 폴더 안 기록도 이번 세션이 고친 것으로 본다', () => {
    const dirs = ['docs/plan/work', 'docs/_temp'];
    assert.deepEqual(shellWorkFiles(`echo x >> docs/_temp/overhaul/progress.md`, proj, dirs), [progress]);
    assert.deepEqual(shellWorkFiles(`sed -i '' s/a/b/ ${progress}`, proj, dirs), [progress]);
    assert.deepEqual(shellWorkFiles(`echo x >> docs/_temp/overhaul/progress.md`, proj, ['docs/plan/work']), []);
  });
});

describe('stall-check 열린 칸 대조: 남이 하고 있다는 상태 칸', () => {
  it('줄 머리에 「도는 중」, 「진행 중」이 든 칸은 AI가 이어 할 일이 아니라서 세지 않는다', () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stall-running-')), 'p.md');
    fs.writeFileSync(f, '- [ ] 따라가기 점검 다섯 도는 중(S1, S2)\n- [ ] 고침 둘 진행 중: opus-high\n- [ ] 설치본에 반영\n');
    assert.deepEqual(openBoxes([f]).map((x) => x.line), ['설치본에 반영']);
  });
});

describe('stall-check 열린 칸 대조: 워크트리 경로', () => {
  const repo = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stall-wt-'));
    fs.mkdirSync(path.join(dir, 'docs', 'plan', 'work'), { recursive: true });
    return dir;
  };
  const wtFile = (dir) => path.join(dir, '.claude', 'worktrees', 'w1', 'docs', 'plan', 'work', 'p.md');
  it('워크트리를 지운 뒤에는 본 폴더의 같은 파일을 열어 열린 칸을 센다', () => {
    const dir = repo();
    fs.writeFileSync(path.join(dir, 'docs', 'plan', 'work', 'p.md'), '- [ ] 설치본에 반영\n- [x] 끝난 칸\n');
    assert.deepEqual(openBoxes([wtFile(dir)]).map((x) => x.line), ['설치본에 반영']);
  });
  it('워크트리가 아직 있으면 그 파일을 열고(머지 전 고침), 본 폴더 경로와 둘 다 적혀 있어도 한 번만 센다', () => {
    const dir = repo();
    fs.writeFileSync(path.join(dir, 'docs', 'plan', 'work', 'p.md'), '- [ ] 본 폴더 옛 칸\n');
    fs.mkdirSync(path.dirname(wtFile(dir)), { recursive: true });
    fs.writeFileSync(wtFile(dir), '- [ ] 워크트리에서 더한 칸\n');
    assert.deepEqual(openBoxes([wtFile(dir)]).map((x) => x.line), ['워크트리에서 더한 칸']);
    assert.equal(openBoxes([wtFile(dir), path.join(dir, 'docs', 'plan', 'work', 'p.md')]).length, 1);
  });
  it('워크트리 경로가 아닌 없는 파일은 건너뛴다', () => {
    assert.deepEqual(openBoxes([path.join(repo(), 'docs', 'plan', 'work', 'none.md')]), []);
  });
});

// 끝 보고의 남은 일(결정 「끝 보고의 남은 일」, 11-09): 진행 기록의 닫히지 않은 AI 몫 줄 수를 「다음」 칸에 「남은 일 N건」으로 밝히게 한다.
// 아래 두 꼴은 대표가 「이거만 하면 끝이야?」, 「찾았던 결함도 다 해결된 거지?」를 되물은 11-08 실제 답 둘을 꼴만 줄인 것이다.
describe('stall-check 남은 일 수', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stall-left-'));
  const work = path.join(root, 'docs', 'plan', 'work');
  fs.mkdirSync(work, { recursive: true });
  const edit = (file) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Edit', input: { file_path: file } }] } });
  let q = 0;
  const run = (text, body, over = {}, file = path.join(work, `left-${q}.md`)) => {
    fs.writeFileSync(file, body);
    const t = path.join(root, `t${q}.jsonl`);
    fs.writeFileSync(t, JSON.stringify(edit(file)) + '\n');
    return check({ ...stop(), session_id: `stall-test-${process.pid}-left${q++}`, transcript_path: t, last_assistant_message: text, ...over });
  };
  // 사례 1 꼴: 진행 기록에 판정 둘과 도구 만들기가 남았는데 답은 「하루치 기록이 쌓이면 판정」 하나만 보였다.
  const KIT = '# 진행\n- [x] 바퀴 12 판정\n- [ ] 바퀴 13 판정(하루치 기록이 쌓인 뒤)\n- [ ] 따르는 비율을 세는 도구 만들기\n- [ ] 바꾼 장치의 하루 막음 수를 전과 견주기\n- [ ] 공개 저장소 push: 대표 지시 때\n';
  const ONE = '정리를 마쳤습니다.\n\n**다음**\n- AI: 오늘 하루치 기록이 쌓이면 열세 번째 판정을 맡깁니다.\n- 대표님: 패널에서 그림이 보이는지 봐 주세요.\n\n기다림: 오늘 하루치 기록';
  // 사례 2 꼴: 진행 기록 「남은 것」 절에 묶음과 옮길 일이 남았는데 답은 실무자 둘 기다림만 보였다. 그때 실무자 둘이 돌고 있었다.
  const MINI = '# 화면 고치기\n## 한 것\n- 홈 합침\n## 남은 것\n- 묶음 3, 4, 2, 5, 1\n- 앞 작업에서 넘긴 작은 고칠 거리를 할 일 목록에 옮긴다\n- 대표 확인: 목업\n';
  const WAIT = '홈을 합쳤고 화면 고침을 실무자 둘에게 맡겼습니다.\n\n**다음**\n- AI: 두 실무자가 끝나면 판정하고 합칩니다.\n- 대표: 없습니다.\n- 기다림: 본 화면 실무자, 결과 화면 실무자';
  const counted = (out) => (out?.reason || '').includes('남은 일 수:');
  const busy = { background_tasks: [task('w1', 'subagent'), task('w2', 'subagent')], session_crons: [checkin('c1')] };

  it('사례 1 꼴: 「다음」 칸에 「남은 일 N건」이 없으면 닫히지 않은 AI 몫 줄 수와 진행 기록별 목록을 실어 한 번 막는다. 사용자 몫 줄은 세지 않는다', () => {
    const out = run(ONE, KIT);
    assert.match(out.reason, /남은 일 수: 이번 세션에서 고친 진행 기록에 닫히지 않은 AI 몫 줄이 3건 있다\(left-\d+\.md 3건\(「바퀴 13 판정\(하루치 기록이 쌓인 뒤\)」, 「따르는 비율을 세는 도구 만들기」, 「바꾼 장치의 하루 막음 수를 전과 견주기」\)\)/);
    assert.match(out.reason, /「남은 일 3건」 한 줄과 묶음/);
    assert.doesNotMatch(out.reason, /push/);
    assert.ok(out.blockNames.includes('멈춤 검사 남은 일 수'));
  });
  it('사례 2 꼴: 「남은 것」 절 항목도 세고, 실무자가 도는 동안의 끝 보고도 본다(열린 칸 대조는 도는 동안 쉬지만 이 판정은 쉬지 않는다)', () => {
    const out = run(WAIT, MINI, busy);
    assert.match(out.reason, /^남은 일 수: .*줄이 2건 있다\(left-\d+\.md 2건\(「묶음 3, 4, 2, 5, 1」, 「앞 작업에서 넘긴 작은 고칠 거리를 할 일 목록에 옮긴다」\)\)/);
    assert.deepEqual(out.blockNames, ['멈춤 검사 남은 일 수']);
  });
  it('「남은 일 N건」(N개, N가지, 남은 것 N건도) 줄이 있으면 막지 않는다. 수가 센 것과 달라도 줄만 본다', () => {
    for (const line of ['남은 일 3건', '남은 일: 0건이 아니라 남은 일 5개', '남은 것 2가지']) assert.equal(counted(run(`${ONE}\n- ${line}`, KIT)), false, line);
    assert.equal(run(`${WAIT}\n- 남은 일 2건: 묶음 3, 4, 2, 5, 1과 할 일 옮기기`, MINI, busy), null);
  });
  it('「다음」 칸이 없는 답, 사용자에게 답을 청하는 답, 정할 것이 든 답, 한 번 막은 뒤, 닫히지 않은 AI 몫 줄이 없을 때는 막지 않는다(열린 칸 대조는 따로 본다)', () => {
    assert.equal(counted(run(`정리를 마쳤습니다. ${'고친 것을 설명합니다. '.repeat(10)}`, KIT)), false);
    assert.equal(run(ONE.replace('패널에서 그림이 보이는지 봐 주세요.', 'a나 b를 골라 주세요.'), KIT), null);
    assert.equal(counted(run(`${ONE}\n\n**정할 것**\n1. 범위를 줄일지 (정책)\n   - a. 줄인다\n   - b. 그대로`, KIT)), false);
    assert.equal(run(ONE, KIT, { stop_hook_active: true }), null);
    assert.equal(run(ONE, '# 진행\n- [x] 끝\n- [ ] 대표 확인: 화면\n'), null);
  });
  it('같은 남은 줄 묶음으로는 세션에 한 번만 막고, 줄이 바뀌면 다시 묻는다. 30분보다 오래전에 고친 진행 기록은 보지 않는다', () => {
    const sid = `stall-test-${process.pid}-leftonce`;
    const file = path.join(work, 'once.md');
    assert.match(run(ONE, KIT, { session_id: sid }, file).reason, /남은 일 수/);
    assert.equal(run(ONE, KIT, { session_id: sid }, file), null);
    assert.match(run(ONE, `${KIT}- [ ] 새 줄\n`, { session_id: sid }, file).reason, /줄이 4건 있다/);
    const at = Date.parse('2026-11-08T12:00:00.000Z');
    fs.writeFileSync(file, KIT);
    const t = path.join(root, 'stale.jsonl');
    fs.writeFileSync(t, JSON.stringify({ ...edit(file), timestamp: new Date(at - 31 * 60000).toISOString() }) + '\n');
    assert.equal(check({ ...stop(), transcript_path: t, last_assistant_message: ONE }, new Date(at)), null);
  });
  it('막은 뒤 답과 남은 줄이 그대로 다시 나오면 헛막음 후보로 남기고, 줄을 닫았으면 남기지 않는다', () => {
    const before = recordRows('hook-false-positive.tsv').length;
    const file = path.join(work, 'fp.md');
    const a = `stall-test-${process.pid}-leftfp-a`;
    assert.match(run(WAIT, MINI, { ...busy, session_id: a }, file).reason, /^남은 일 수/);
    assert.equal(run(WAIT, MINI, { ...busy, session_id: a, stop_hook_active: true }, file), null);
    const rows = recordRows('hook-false-positive.tsv').slice(before);
    assert.deepEqual(rows.map((r) => r[2]), ['멈춤 검사 남은 일 수']);
    const b = `stall-test-${process.pid}-leftfp-b`;
    assert.match(run(WAIT, MINI, { ...busy, session_id: b }, file).reason, /^남은 일 수/);
    assert.equal(run(WAIT, MINI.replace('- 묶음 3, 4, 2, 5, 1\n', ''), { ...busy, session_id: b, stop_hook_active: true }, file), null);
    assert.equal(recordRows('hook-false-positive.tsv').slice(before).length, 1);
  });
});

describe('stall-check 막음 기록', () => {
  const sidOf = (name) => `stall-test-${process.pid}-rec-${name}`;
  const NEXT = '끝냈습니다.\n\n**⑧ 다음**\n- AI: 커밋합니다.\n- 대표: 없습니다.';
  it('막는 출력에 「멈춤 검사 <판정 이름>」을 붙여 감싸개가 hook-blocks.tsv에 적게 하고, 훅은 그 파일을 직접 쓰지 않는다', () => {
    const before = recordRows('hook-blocks.tsv').length;
    const sid = sidOf('block');
    const one = check(stop({ session_id: sid, last_assistant_message: NEXT }));
    const two = check(stop({ session_id: `${sid}-w`, background_tasks: [task('a1', 'subagent')] }));
    assert.match(one.reason, /^이어 하기/);
    assert.match(two.reason, /^실무자 기다림/);
    assert.deepEqual(one.blockNames, ['멈춤 검사 이어 하기']);
    assert.deepEqual(two.blockNames, ['멈춤 검사 실무자 기다림']);
    assert.equal(JSON.stringify(one).includes('blockNames'), false);
    assert.equal(recordRows('hook-blocks.tsv').length, before);
  });
  it('막지 않으면 줄을 남기지 않는다', () => {
    const before = recordRows('hook-blocks.tsv').length;
    assert.equal(check(stop({ session_id: sidOf('none') })), null);
    assert.equal(recordRows('hook-blocks.tsv').length, before);
  });
  it('이어 하기로 막은 뒤 같은 답이 그대로 다시 나오면 hook-false-positive.tsv에 「통과」 줄을 남기고, 답이 바뀌었거나 막기가 답과 상관없으면 남기지 않는다', () => {
    const before = recordRows('hook-false-positive.tsv').length;
    const sid = sidOf('fp');
    assert.match(check(stop({ session_id: sid, last_assistant_message: NEXT })).reason, /^이어 하기/);
    assert.equal(check(stop({ session_id: sid, last_assistant_message: NEXT, stop_hook_active: true })), null);
    const rows = recordRows('hook-false-positive.tsv').slice(before);
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0][2], rows[0][3], rows[0][4]], ['멈춤 검사 이어 하기', '오탐 후보', '통과']);
    const sid2 = sidOf('fp2');
    check(stop({ session_id: sid2, last_assistant_message: NEXT }));
    check(stop({ session_id: sid2, last_assistant_message: '점검 뒤 고친 것: 다 했습니다.', stop_hook_active: true }));
    const sid3 = sidOf('fp3');
    check(stop({ session_id: sid3, background_tasks: [task('a1', 'subagent')] }));
    check(stop({ session_id: sid3, background_tasks: [task('a1', 'subagent')], stop_hook_active: true }));
    assert.equal(recordRows('hook-false-positive.tsv').slice(before).length, 1);
  });
  it('열린 칸 대조는 막은 뒤 답과 남은 일 목록이 그대로일 때만 헛막음 후보로 센다', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stall-recopen-'));
    const work = path.join(dir, 'docs', 'plan', 'work');
    fs.mkdirSync(work, { recursive: true });
    const progress = path.join(work, 'p.md');
    const t = path.join(dir, 't.jsonl');
    fs.writeFileSync(t, JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Edit', input: { file_path: progress } }] } }) + '\n');
    const text = '끝냈습니다.\n\n**⑧ 다음**\n- 남은 일 1건\n- AI: 없음\n- 대표: 확인';
    const run = (sid, again, body) => { fs.writeFileSync(progress, body); return check({ ...stop(), session_id: sid, transcript_path: t, last_assistant_message: text, stop_hook_active: again }); };
    const before = recordRows('hook-false-positive.tsv').length;
    const a = sidOf('open-same');
    const first = run(a, false, '- [ ] 설치본에 반영\n');
    assert.match(first.reason, /^열린 칸 대조/);
    assert.deepEqual(first.blockNames, ['멈춤 검사 열린 칸 대조']);
    assert.equal(run(a, true, '- [ ] 설치본에 반영\n'), null);
    assert.equal(recordRows('hook-false-positive.tsv').slice(before).length, 1);
    const b = sidOf('open-fixed');
    assert.match(run(b, false, '- [ ] 설치본에 반영\n').reason, /^열린 칸 대조/);
    assert.equal(run(b, true, '- [x] 설치본에 반영\n'), null);
    assert.equal(recordRows('hook-false-positive.tsv').slice(before).length, 1);
  });
});
