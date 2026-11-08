import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { check, leftoverWork, oneShotIn } = require('../../hooks/stall-check.js');

// 하네스가 Stop 입력에 주는 칸(background_tasks, session_crons)을 그대로 흉내 낸다. 세션 id는 시험마다 달리 해 임시 상태 파일이 섞이지 않게 한다.
let n = 0;
const DONE = '끝냈습니다.\n\n**⑧ 다음**\n- AI: 할 일이 없습니다.\n- 대표님: 없습니다.';
const stop = (over = {}) => ({ hook_event_name: 'Stop', session_id: `stall-test-${process.pid}-${n++}`, last_assistant_message: DONE, background_tasks: [], session_crons: [], ...over });
const task = (id, type, extra = {}) => ({ id, type, status: 'running', description: `일 ${id}`, ...extra });
const checkin = (id, recurring = true) => ({ id, schedule: '7,22,37,52 * * * *', recurring, prompt: '<check-in> 뒤 작업 확인: …' });
const NOW = new Date(2026, 10, 6, 23, 30);

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
  it('사용자가 건 예약은 깨우는 예약으로 세지 않고, 도는 실무자가 없으면 깨우는 예약만 지우게 한다', () => {
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
    assert.match(check(input(['쉬는 일'], sid)).reason, /^결과 늦음: [^]*\[done\]\ndone의 결과/);
    assert.equal(check(input(['쉬는 일'], sid)), null);
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
    assert.match(check(input(sid1)).reason, /^결과 늦음/);
    fs.rmSync(path.join(os.tmpdir(), `stall-check-${sid1}.json`), { force: true });
    fs.writeFileSync(main, say('2026-11-06T09:59:45Z') + '\n');
    const sid2 = `stall-test-${process.pid}-am2`;
    assert.doesNotMatch(check(input(sid2))?.reason || '', /결과 늦음/);
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
    assert.doesNotMatch(check(input, new Date('2026-11-06T12:00:00Z'))?.reason || '', /결과 늦음/);
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
    assert.equal(leftoverWork('보고\n\n**⑧ 다음**\n- AI: 2단계를 마무리해 커밋합니다.\n- 대표님: 따로 하실 것은 없습니다. 범위를 줄이고 싶으시면 말씀해 주세요.'), true);
    assert.equal(leftoverWork('보고\n\n⑧ **다음**\n- 제가 할 일: 퀴즈 문서 정리를 시작합니다.'), true);
    assert.equal(leftoverWork('보고\n\n**⑧ 다음(이번 묶음 뒤)**\n1. AI: 커밋하고 4회차를 돌립니다.\n2. 대표님: 없습니다.'), true);
    assert.equal(leftoverWork('보고\n\n**⑧ 다음**\n- AI 몫: 3단계를 시작합니다.\n- 대표님 몫: 없습니다.'), true);
  });
  it('사용자 몫이 push나 배포 지시뿐이면 참이고, 다른 몫이 섞이면 거짓이다(2026-11-07 진행합니다 하고 멈춤)', () => {
    assert.equal(leftoverWork('보고\n\n⑧ 다음\n- AI: 혼자 하기를 공통 판단으로 옮기고 멀티 판 순서로 진행합니다.\n- 대표: push 지시(main에 광고 커밋 셋이 쌓여 있습니다).'), true);
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
