#!/usr/bin/env node
/**
 * Stop 훅. 메인이 멈추려 할 때 할 일이 남았는데 멈추는 꼴 셋을 막는다.
 *
 * 무엇을:
 *  - 실무자 기다림: 뒤에서 도는 실무자가 있는데 깨우는 예약(<check-in>으로 시작하는 CronCreate 예약)이 없으면, 예약을 건 뒤 멈추게 한다.
 *    이름 붙인 실무자(teammate)가 있으면 15분마다, 이름 없는 실무자만 있으면 60분 뒤 한 번 울리는 예약을 걸게 한다.
 *  - 예약 정리: 도는 실무자가 없는데 깨우는 예약이 남았으면 지우게 한다. 사용자가 건 예약(/loop 등)은 건드리지 않는다.
 *  - 결과 늦음과 멈춘 듯: 끝난 이름 붙인 실무자의 끝 메시지가 안 닿았으면 그 마지막 답을 실어 알리고, 기록이 20분 넘게 그대로인 실무자는 거두게 한다.
 *  - 이어 하기: 답 끝 「다음」에 AI 할 일이 남았고 사용자 몫이 없고 도는 일도 없으면, 멈추지 말고 이어 하게 한다.
 *    사용자 몫이 push나 배포 지시뿐이면 AI 할 일을 막지 않는 따로 기다림이라 몫이 없는 것으로 본다.
 * 왜: 2026-10-29~11-06 대화 기록에서 사용자 입력 없이 이어 했어야 할 시간이 약 830분이었다. 이름 붙인 실무자의 끝 메시지가 8시간 늦게 닿았고
 *   멈춘 실무자를 「도는 중」으로 믿고 기다렸으며(11-05, 약 490분), 「AI: 5단계 2번을 시작합니다, 대표: 없음」으로 보고하고 멈췄다(11-06, 226분).
 *   예약은 메인이 쉬는 동안에만 울려 알림이 늦어도 메인을 깨운다. 이름 없는 실무자는 끝 알림이 늦은 적이 없어(885건) 멈춘 경우만 잡는 한 번짜리로 둔다.
 *   깨울 때마다 메인 문맥 전체를 다시 읽어서다. 뒤 명령(shell)은 지연이 1~9분이라 예약으로 앞당길 수 없어 세지 않는다.
 * 전제:
 *  - 하네스가 Stop 입력에 background_tasks(id, type: shell, subagent, teammate, monitor, workflow, status, description)와
 *    session_crons(id, schedule, recurring, prompt)를 준다(Claude Code 2.1.319에서 확인). 이 칸이 없는 판에서는 세 검사를 모두 건너뛴다.
 *    쉬는 teammate도 status running으로 남아, 그 실무자 기록(설명마다 가장 늦게 생긴 것)의 마지막 답이 끝맺음이면 쉬는 것으로 본다.
 *    쉬는데 메인 기록에 그 실무자 메시지가 끝맺은 뒤로 없으면 「결과 늦음」으로 한 번 알린다.
 *  - 「다음」 칸의 꼴은 보고 모양(kit-rec-report ⑧)을 따른다: `다음` 머리 줄 아래 AI 줄과 사용자 줄. 꼴이 다르면 이어 하기는 건너뛴다.
 *    조건이 걸린 할 일(「답을 받으면」, 「고르시면」, 「받는 대로」)과 `기다림:` 줄을 쓴 답, ②정할 것이나 ⑦선택지가 든 답은 기다릴 까닭이 있는 것으로 본다.
 *  - 사용자가 물은 차례(논의 중)에는 이어 하기를 하지 않는다. 설치본이 논의 잠금 훅을 두면 config.json `turnLockHook`에 그 모듈 경로를 적고,
 *    그 모듈의 isTurnLocked(세션, 기록 경로)가 차례 상태를 지금 기록에 맞춰 답한다(두 훅이 함께 돌아 앞 차례 상태를 읽지 않게). 키가 없으면 잠금은 없는 것으로 본다.
 *  - 한 번 막은 뒤(stop_hook_active)에도 실무자 기다림과 예약 정리는 같은 상태로 한 번만 더 본다. 이어 하기는 답이 바뀌었을 때만, 한 줄기에 세 번까지 막는다.
 *    막은 기록은 임시 폴더 stall-check-<세션>.json에 둔다. 오류가 나면 아무것도 막지 않는다.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHECK_IN = '<check-in>';
const AGENT_TYPES = /^(?:subagent|teammate|workflow|in_process_teammate|local_agent|remote_agent)$/;
const LIVE = /^(?:running|pending)$/;
const STUCK_MIN = 20;
const LATE_GRACE_MS = 5 * 60000;
const LONG_LIVED = /\b(?:dev|serve|preview|watch|start)\b|tail\s+-[fF]|--watch/;

// 남을 기다리는 조건(사용자 답, 실무자 결과)과 제 일의 순서(「커밋이 되면」)를 가른다. 뒤쪽은 같은 문장이 바로 하는 끝맺음이면 할 일로 본다(리뷰 2회차 4번).
const WAITS_ON = /(시면|오면|받으면|[을를] 받아|풀리면|쌓이면|정해지면|는 대로|기다|진행 중|돌고 있|도는 중|건이면)/;
const WAITS_SELF = /(끝나면|되면)/;
const NOW_VERB = /(시작합니다|띄웁니다|이어 갑니다|짭니다|만듭니다|고칩니다)\s*\.?\s*$/;
const NOTHING = /할 (?:일|것)(?:은|이)? ?(?:따로 )?없|하실 (?:일|것)(?:은|이)? ?(?:따로 )?없|^(?:지금은? |더 )?없(?:습니다|음|어요)|(?:모두|다) (?:끝냈|마쳤)습니다|대기합니다/;
const ASKS = /(골라|정해|답해|알려|말씀해|승인해|확인해) ?주세요|여쭙/;
const PARALLEL = /push|푸시|배포/i;
// 날짜를 정한 할 일과 배포 뒤에 할 일은 지금 이어 할 일이 아니다.
const LATER = /^(?:(?:\d{1,2}-\d{1,2}|\d{1,2}월 ?\d{1,2}일|내일|모레|다음 주)(?:에|부터|쯤)|(?:배포|push|푸시)\S{0,3} ?(?:뒤|후|되면))/i;

// 「다음」 머리 줄을 찾고, 그 아래에서 AI 줄과 사용자 줄의 내용(같은 줄 뒤와 들여쓴 아래 줄)을 꺼낸다.
const HEAD = /(?:^|\n)[ \t]*(?:#{1,4}[ \t]+)?(?:\*\*)?(?:⑧[ \t]*)?(?:\*\*)?다음(?:\([^)\n]*\))?(?:\*\*)?[ \t]*[:：]?[ \t]*(?:\*\*)?[ \t]*(?=\n)/g;
function nextItems(text) {
  const heads = [...text.matchAll(HEAD)];
  if (!heads.length) return null;
  const lines = text.slice(heads[heads.length - 1].index).split('\n').slice(1);
  const items = [];
  for (const line of lines) {
    const top = line.match(/^(?:[-*]|\d+\.)[ \t]+(?:\*\*)?([^:：*\n]{1,24}?)(?:\([^)\n]*\))?(?:\*\*)?[ \t]*(?:[:：](?:\*\*)?[ \t]*(.*))?$/);
    if (top) { items.push({ who: top[1].trim(), body: (top[2] || '').trim() }); continue; }
    if (/^\s+\S/.test(line) && items.length) { items[items.length - 1].body += `${items[items.length - 1].body ? '\n' : ''}${line.trim()}`; continue; }
    if (line.trim() === '' && items.length) continue;
    if (items.length) break;
  }
  return items;
}
const firstSentence = (s) => s.replace(/^[-*\d.\s]+/, '').split(/(?<=[.!?])\s/)[0];

function leftoverWork(text) {
  if (!text || /(^|\n)\s*기다림:/.test(text) || /hit your .*limit|사용 한도/.test(text)) return false;
  if (/(^|\n)\s*(?:#{1,4}\s*)?(?:\*\*)?(?:②\s*(?:\*\*)?\s*정할 것|⑦\s*(?:\*\*)?\s*선택지)/.test(text)) return false;
  const items = nextItems(text);
  if (!items) return false;
  const ai = items.find((x) => /^(?:AI(?:가 할 일| 몫)?|저|제가 할 일|제 몫)$/.test(x.who));
  const user = items.find((x) => /^(?:대표|사용자)/.test(x.who));
  if (!ai || !ai.body) return false;
  const a = firstSentence(ai.body);
  if (NOTHING.test(a) || WAITS_ON.test(a) || LATER.test(ai.body.trim()) || (WAITS_SELF.test(a) && !NOW_VERB.test(a))) return false;
  if (!user) return true;
  // push와 배포 지시는 AI 할 일과 따로 기다리는 몫이라 사용자 몫에서 뺀다(2026-11-07 「진행합니다」 뒤 대표 줄에 push 지시만 있어 두 번 멈춤).
  const parts = user.body.split(/(?<=[.!?])\s+|\n/).filter((x) => x.trim() && !PARALLEL.test(x));
  if (user.body && !parts.length) return true;
  // 사용자에게 묻는 문장은 몫 전체에서 찾되, 「~시면 말씀해 주세요」 같은 조건부 안내는 묻는 것으로 보지 않는다.
  const asks = parts.some((x) => ASKS.test(x) && !/시면/.test(x));
  return !!user.body && NOTHING.test(firstSentence(parts.join(' '))) && !asks;
}

const stateFile = (sid) => path.join(os.tmpdir(), `stall-check-${String(sid || 'none').replace(/[^\w-]/g, '')}.json`);
function readState(sid) { try { return JSON.parse(fs.readFileSync(stateFile(sid), 'utf8')); } catch { return {}; } }
function writeState(sid, s) { try { fs.writeFileSync(stateFile(sid), JSON.stringify(s)); } catch { /* 반복 막기 상한만 빠진다 */ } }

// 설치본의 논의 잠금 훅이 이 차례를 잠갔나. 훅 이름과 상태 파일 꼴은 설치본 몫이라 config.json `turnLockHook`이 가리키는 모듈에 묻는다.
function lockedTurn(input) {
  if (!input.session_id) return false;
  const cfgDir = process.env.CLAUDE_CONFIG_DIR || path.join(process.env.HOME || '', '.claude');
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(cfgDir, 'subagent-system', 'config.json'), 'utf8'));
    if (!cfg.turnLockHook) return false;
    const mod = require(cfg.turnLockHook.replace(/^~(?=\/)/, process.env.HOME || ''));
    return typeof mod.isTurnLocked === 'function' && mod.isTurnLocked(input.session_id, input.transcript_path) === true;
  } catch { return false; }
}

function lastAssistantText(transcriptPath) {
  try {
    const lines = tailLines(transcriptPath);
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"assistant"')) continue;
      let o;
      try { o = JSON.parse(lines[i]); } catch { continue; }
      if (o.type !== 'assistant' || o.isSidechain || !Array.isArray(o.message?.content)) continue;
      const t = o.message.content.filter((x) => x.type === 'text').map((x) => x.text).join('\n');
      if (t.trim()) return t;
    }
  } catch { /* 없음 */ }
  return '';
}

// 이름 붙인 실무자(teammate)는 일을 마치고 쉬어도 목록에 status running으로 남는다(2026-11-06 실제 입력). 그 실무자 기록의
// 마지막 답이 끝맺음(end_turn)이면 쉬는 것으로 본다. 기록은 <대화 기록>/subagents/agent-*.jsonl, 곁의 meta.json의 description으로 짝짓는다.
function lastEntry(file) {
  try {
    const size = fs.statSync(file).size;
    const len = Math.min(size, 65536);
    const buf = Buffer.alloc(len);
    const fd = fs.openSync(file, 'r');
    try { fs.readSync(fd, buf, 0, len, size - len); } finally { fs.closeSync(fd); }
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      try { const o = JSON.parse(lines[i]); if (o.type === 'assistant' || o.type === 'user') return o; } catch { /* 잘린 줄 */ }
    }
  } catch { /* 못 읽음 */ }
  return null;
}
const firstStamp = (file) => {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(4096);
    try { fs.readSync(fd, buf, 0, 4096, 0); } finally { fs.closeSync(fd); }
    return Date.parse(JSON.parse(buf.toString('utf8').split('\n')[0]).timestamp) || 0;
  } catch { return 0; }
};
// 설명마다 가장 늦게 생긴 실무자 기록 하나만 본다(거두고 같은 설명으로 다시 띄우는 일이 잦아서, 리뷰 2회차).
// 돌려주는 값: 설명 → {name, file, ended(끝맺은 시각 ms, 일하는 중이면 0), moved(기록이 마지막으로 바뀐 시각 ms)}.
function agentRecords(transcriptPath) {
  const out = new Map();
  if (!transcriptPath) return out;
  const dir = path.join(transcriptPath.replace(/\.jsonl$/, ''), 'subagents');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.meta.json')); } catch { return out; }
  for (const f of files) {
    let meta;
    try { meta = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
    if (!meta.description) continue;
    const file = path.join(dir, f.replace(/\.meta\.json$/, '.jsonl'));
    let born = firstStamp(file);
    if (!born) { try { born = fs.statSync(file).birthtimeMs; } catch { born = 0; } }
    const key = meta.description.trim();
    const had = out.get(key);
    if (had && had.born > born) continue;
    // 생긴 시각으로 가를 수 없으면 일하는 중으로 본다. 틀려도 예약이 하나 더 걸릴 뿐이다.
    if (had && had.born === born) { out.set(key, { ...had, ended: 0 }); continue; }
    const last = lastEntry(file);
    const ended = last?.type === 'assistant' && /^(?:end_turn|stop_sequence)$/.test(String(last.message?.stop_reason || '')) ? (Date.parse(last.timestamp) || 1) : 0;
    let moved = 0;
    try { moved = fs.statSync(file).mtimeMs; } catch { /* 없음 */ }
    out.set(key, { name: meta.name || '', file, born, ended, moved });
  }
  return out;
}
// 메인 기록 끝에 그 실무자의 메시지가 끝맺은 시각 뒤로 닿았나. 끝 메시지가 몇 시간 늦게 닿은 일이 있어서다(11-05 checklist-judge2, 8시간).
// 실무자가 끝맺기 직전에 직접 보낸 보고(agent-message)도 닿은 것으로 센다. 세지 않으면 이미 받은 보고를 또 실어 같은 보고가 두세 번 온다(11-07).
// 끝맺기 1분보다 앞선 보고는 중간 보고일 수 있어 세지 않는다(11-07 실측: 마지막 보고는 끝맺기 2~15초 전).
const SENT_BEFORE_END_MS = 60_000;
function delivered(transcriptPath, name, ended, tail) {
  const marks = [[`teammate_id=\\"${name}\\"`, 5000], [`agent-message from=\\"${name}\\"`, SENT_BEFORE_END_MS]];
  for (const line of tail) {
    const hit = marks.find(([mark]) => line.includes(mark));
    if (!hit) continue;
    try { if (Date.parse(JSON.parse(line).timestamp) >= ended - hit[1]) return true; } catch { /* 잘린 줄 */ }
  }
  return false;
}
// 실무자 기록의 마지막 답 글. 끝 메시지가 늦을 때 막는 글에 실어 메인이 바로 받게 한다.
function lastText(file, max = 4000) {
  const lines = tailLines(file, 400_000);
  for (let i = lines.length - 1; i >= 0; i--) {
    let o;
    try { o = JSON.parse(lines[i]); } catch { continue; }
    if (o.type !== 'assistant' || !Array.isArray(o.message?.content)) continue;
    const t = o.message.content.filter((x) => x.type === 'text').map((x) => x.text).join('\n').trim();
    if (t) return t.length > max ? `${t.slice(0, max)}\n…(뒤는 ${file} 끝에 있다)` : t;
  }
  return '';
}
function tailLines(transcriptPath, bytes = 2_000_000) {
  try {
    const size = fs.statSync(transcriptPath).size;
    const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len);
    const fd = fs.openSync(transcriptPath, 'r');
    try { fs.readSync(fd, buf, 0, len, size - len); } finally { fs.closeSync(fd); }
    return buf.toString('utf8').split('\n');
  } catch { return []; }
}

function oneShotIn(minutes, now = new Date()) {
  const t = new Date(now.getTime() + minutes * 60000);
  return `${t.getMinutes()} ${t.getHours()} ${t.getDate()} ${t.getMonth() + 1} *`;
}

function check(input, now = new Date()) {
  const sid = input.session_id;
  const again = input.stop_hook_active === true;
  // 한 줄기(사용자 말이나 알림 하나에서 멈출 때까지) 안의 막은 기록은 줄기가 바뀌면 지운다. 앞 줄기 기록이 검사를 끄지 않게(리뷰 2회차 2번).
  // 결과를 이미 알린 실무자(got)만 줄기를 넘어 남긴다.
  const prev = readState(sid);
  const st = again ? prev : { got: (prev.got || []).slice(-50), stuck: (prev.stuck || []).slice(-50) };
  const parts = [];
  const tasks = Array.isArray(input.background_tasks) ? input.background_tasks : null;
  const crons = Array.isArray(input.session_crons) ? input.session_crons : [];
  const live = (tasks || []).filter((t) => LIVE.test(String(t.status)));
  const tms = live.filter((t) => /teammate/.test(String(t.type)));
  const recs = live.some((t) => AGENT_TYPES.test(String(t.type))) ? agentRecords(input.transcript_path) : new Map();
  let tail = null;
  const idle = new Set();
  const late = [];
  for (const t of tms) {
    const d = String(t.description || '').trim();
    const rec = recs.get(d);
    if (!rec || !rec.ended || tms.filter((x) => String(x.description || '').trim() === d).length > 1) continue;
    const tag = `${rec.name}:${rec.ended}`;
    let seen = (st.got || []).includes(tag);
    // 닿은 것을 본 때 기억한다. 기억하지 않으면 대화가 길어져 그 줄이 읽는 끝부분에서 밀려난 뒤 같은 보고를 또 싣는다(11-07)
    if (!seen && delivered(input.transcript_path, rec.name, rec.ended, (tail ??= tailLines(input.transcript_path)))) {
      seen = true;
      (st.got ||= []).push(tag);
    }
    // 끝맺은 지 얼마 안 됐으면 끝 알림이 곧 닿으니 마지막 답을 싣지 않고 기다리는 실무자로 둔다. 실으면 뒤이어 끝 알림이 또 닿아 같은 보고가 두 번 온다(11-07).
    if (!seen && now.getTime() - rec.ended < LATE_GRACE_MS) continue;
    idle.add(t);
    if (!seen) {
      late.push(rec);
      (st.got ||= []).push(tag);
    }
  }
  if (late.length) {
    parts.push(`결과 늦음: 이름 붙인 실무자가 일을 마쳤는데 끝 메시지가 아직 메인에 닿지 않았다. 아래 마지막 답을 결과로 받아 이어 한다.\n${late.map((r) => `[${r.name}]\n${lastText(r.file)}`).join('\n\n')}\n`);
  }
  const agents = live.filter((t) => AGENT_TYPES.test(String(t.type)) && !idle.has(t));
  // 멈춘 듯: 하네스는 멈춘 실무자도 running으로 넘긴다(11-05 s2-56b를 8시간 기다림). 기록이 STUCK_MIN분 넘게 자라지 않으면 알린다.
  // 같은 멈춤(같은 기록 시각)은 한 번만 알린다. 오래 걸리는 명령을 돌리는 중이라 두기로 했으면 다시 조르지 않게.
  const stuck = agents.map((t) => ({ t, rec: recs.get(String(t.description || '').trim()) }))
    .filter(({ rec }) => rec && !rec.ended && rec.moved && now.getTime() - rec.moved >= STUCK_MIN * 60000)
    .filter(({ t, rec }) => !(st.stuck || []).includes(`${t.id}:${rec.moved}`));
  if (stuck.length) {
    for (const { t, rec } of stuck) (st.stuck ||= []).push(`${t.id}:${rec.moved}`);
    parts.push(`멈춘 듯: ${stuck.map(({ t, rec }) => `${String(t.description || t.id).slice(0, 30)}(id ${t.id}, ${Math.floor((now.getTime() - rec.moved) / 60000)}분째 기록이 그대로)`).join(', ')}. 오래 걸리는 명령을 기다리는 중이 아니면 TaskStop으로 거두고, 끝난 기준과 남은 일을 넘겨 다시 띄운다.`);
  }
  const checkins = crons.filter((c) => String(c.prompt || '').startsWith(CHECK_IN));
  const key = agents.map((t) => t.id).sort().join(',');
  if (tasks && agents.length && !checkins.length && !(again && st.wait === key)) {
    const teammates = agents.some((t) => /teammate/.test(String(t.type)));
    const names = agents.map((t) => String(t.description || t.id).slice(0, 30)).slice(0, 4).join(', ');
    const when = teammates ? 'cron "7,22,37,52 * * * *"(이름 붙인 실무자가 있어 15분마다)' : `cron "${oneShotIn(60, now)}", recurring false(이름 없는 실무자만 있어 60분 뒤 한 번)`;
    parts.push(`실무자 기다림: 뒤에서 도는 실무자 ${agents.length}명(${names})을 기다리며 멈추려 한다. 끝 알림이 늦거나 안 올 수 있어 CronCreate(안 보이면 ToolSearch로 불러온다)로 깨우는 예약을 건 뒤 멈춘다. ${when}, prompt "${CHECK_IN} 뒤 작업 확인: 기다리던 실무자의 결과가 와 있으면 받아 이어 하고, 아니면 그대로 멈춘다. 멈출 때 멈춤 검사가 멈춘 실무자와 늦게 닿은 결과를 알려 준다."`);
    st.wait = key;
  }
  if (tasks && !agents.length && checkins.length && !(again && st.stale)) {
    parts.push(`예약 정리: 기다리는 실무자가 없는데 깨우는 예약이 남아 있다. CronDelete로 지운다(id ${checkins.map((c) => c.id).join(', ')}).`);
    st.stale = true;
  }
  // 이어 하기는 도는 일을 알 수 있는 판에서만 본다. 칸이 없는 옛 판에서는 실무자를 기다리는 중에도 막게 되어서다(리뷰 2회차 6번).
  const inflight = live.filter((t) => !idle.has(t) && !(t.type === 'shell' && LONG_LIVED.test(String(t.command || ''))));
  if (tasks && !inflight.length && !late.length) {
    const text = typeof input.last_assistant_message === 'string' && input.last_assistant_message ? input.last_assistant_message : lastAssistantText(input.transcript_path);
    const n = st.carry || 0;
    // 이어 하기로 막은 뒤 메인이 점검 줄만 쓰고 다시 멈추면(「다음」 칸이 없음) 앞 답의 할 일로 한 번 더 막는다(리뷰 17번 다).
    const pending = again && st.carryText && text !== st.carryText && !nextItems(text || '') ? st.carryText : text;
    if (n < 3 && !(again && st.carryText === text) && leftoverWork(pending) && !lockedTurn(input)) {
      parts.push('이어 하기: 답 끝 「다음」에 AI 할 일이 남았고 사용자 몫이 없다. 다른 점검 줄을 쓴 뒤에도 멈추지 말고, 그 일을 지금 도구를 불러 이어 한다. 되돌릴 수 없는 일(운영 반영, 배포, push)이거나 사용자 몫이면 하지 않는다. 사용자 답이나 한도처럼 기다릴 것이 있으면 「기다림: <무엇>」 한 줄을 쓴다.');
      st.carry = n + 1;
      st.carryText = text;
    }
  }
  writeState(sid, st);
  if (!parts.length) return null;
  return { decision: 'block', reason: parts.join(' ') };
}

module.exports = { check, leftoverWork, nextItems, oneShotIn };

if (require.main === module) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => (raw += c));
  process.stdin.on('end', () => {
    let out = null;
    try { out = check(JSON.parse(raw)); } catch { out = null; }
    if (out) process.stdout.write(JSON.stringify(out));
    process.exit(0);
  });
}
