#!/usr/bin/env node
'use strict';

/**
 * 장치(판정 스크립트, 막는 훅)를 고치기 전과 뒤로 「받는 쪽 최종 결과」를 한 번에 견준다.
 *
 * 쓰는 법:
 *   node tools/kit-replay-diff.cjs [--base <git 판>] [--new work|<git 판>] [--days 10] [--only judge,stall,brief,decision,answer,light] [--show 5] [--keep] [--decision-base <파일>] [--decision-new <파일>]
 *     --base  고치기 전 판(git 판 이름, 기본 main). 예: c5d3c3b^, a9c05a4
 *     --new   고친 뒤 판. work(기본)는 이 폴더의 작업 트리(커밋 전 고침 포함), git 판 이름도 됨
 *     --days  대화 기록을 되돌려 볼 최근 일수(기본 10)
 *     --only  일부만 돌림. judge(효과 표와 회고 판정), stall(멈춤 검사), brief(지시문 점검), decision(설치본 결정 대조가 문서 고침으로 보는 도구 호출),
 *             answer(답 점검의 Stop과 도구 호출 막음, 안에서 부르는 결정 대조의 막음 판정 포함), light(한국어 점검, 회차 점검, 세션 넘김 점검)
 *     --decision-base, --decision-new  설치본 전용 결정 대조(hooks/decision-check.js)는 git 판이 없어, 견줄 파일을 따로 준다(기본은 설치본 그대로)
 *     --show  바뀐 항목 견본을 몇 개까지 보일지(기본 5)
 *     --keep  임시 폴더를 지우지 않고 경로를 찍음(임시 폴더 자리는 환경 변수 KIT_REPLAY_TMP, 기본은 시스템 임시 폴더)
 *   출력은 두 판의 차이만 줄로 낸다. 차이가 없으면 「차이 없음」과 돌린 수를 찍는다.
 *
 * 무엇을 견주나(받는 쪽 최종 결과):
 *   판정 쪽  fix-log.js judge(처리할 것, 효과 표 묶음), subagent-retro.js --due와 --status, work-metrics.js waste와 health
 *   훅 쪽   대화 기록의 Stop(답 끝)을 멈춤 검사, 답 점검, 한국어 점검에, Agent 호출을 지시문 점검과 회차 점검에, SendMessage를 세션 넘김 점검에,
 *           도구 호출을 답 점검(논의 중, 물음 확인, 결정 대조)과 설치본 결정 대조에 되돌려 막음 판정을 견준다
 *   끝에 「안 본 막는 훅」을 찍는다. 모집단은 설치본 settings.json에서 감싸개(kit-hook.cjs)를 거치는 모든 훅이다. 이 도구가 되돌리지 않는 훅과 까닭을 밝혀, 「차이 없음」이 안 본 훅까지 덮는 것으로 읽히지 않게 한다.
 * 왜: 고친 함수의 출력만 재면 그 출력을 받아 쓰는 쪽(효과 표 묶음, 열린 칸 대조가 여는 파일)의 최종 결과가 어떻게 달라지는지 모른다.
 *   바퀴 4와 5에서 두 번 그렇게 놓쳤다(2026-11-08 키트 목적 판정).
 * 전제:
 *   - 설치본(CLAUDE_CONFIG_DIR 또는 ~/.claude)을 임시 폴더로 복사하고, 그 위에 견줄 판의 scripts와 hooks를 덮어 두 판을 같은 기록과 같은 설정으로 돌린다.
 *     기록 폴더는 복사본이라 설치본 기록은 바뀌지 않는다. 기록을 쓰는 명령(--fix, --log, --record, --claim)은 돌리지 않는다.
 *   - Stop 입력은 대화 기록에서 되살린다: stop_hook_active는 막힌 Stop 뒤 이어 쓴 첫 Stop(기록의 「Stop hook feedback」 줄 뒤)만 참으로 넣고, 진행 기록을 고친 도구 호출은 그 Stop 앞 2MB 안의 것만 넘긴다.
 *     실무자 칸(background_tasks)과 예약(session_crons)도 그 Stop 앞 대화 기록에서 되살린다. 띄운 실무자와 셸(Agent, Bash 뒤 실행, Monitor)은 도구 결과의 id로,
 *     끝은 그 id의 작업 알림(status)과 TaskStop으로, 예약은 CronCreate와 CronDelete(한 번짜리는 울릴 시각)로 센다. 뒤 작업을 기다린다는 알림(is waiting on its own background work)은
 *     칸에 넣지 않고 대화 기록 조각에 알림만 남긴다(멈춤 검사가 그 알림과 실무자 기록으로 가른다). 실무자 기록(subagents/agent-<id>.jsonl)은 그 Stop 시각까지의 줄만 남긴 사본을 조각 곁에 둔다.
 *     되살리지 못한 것은 그 수를 출력의 「실무자 칸 되살림」 줄에 찍는다: 띄운 결과에서 id를 못 읽은 작업(칸에 없음), 실무자 기록이 없는 실무자(칸에는 두되 기록 사본 없음), 끝맺지 않고 기록이 4시간 넘게 그대로인 실무자(세션이 끊겨 사라진 것으로 보고 칸에서 뺌), 끝 알림 없이 6시간 넘긴 셸(칸에서 뺌).
 *     열린 칸은 지금 있는 파일을 읽으므로 지금 없는 워크트리 파일은 못 읽은 채로 돈다(머지 뒤 끝맺는 답과 같다).
 *   - 지시문 점검의 Agent 호출은 세션 기록 경로 없이 돌린다(시험 표시 검사의 같은 세션 건수만 빠진다). SendMessage는 그 세션의 대화 기록 경로를 넘긴다(받는 쪽이 띄운 실무자인지 가리려고). 두 판에 똑같이 적용된다.
 *   - 자식 프로세스의 환경은 이 도구가 모두 정한다. 물려받은 SUBAGENT_*, KIT_*, CLAUDE_* 같은 통로 변수는 지우고(지운 이름을 처음에 찍는다), 기록 사본 경로를 명시해 넘긴다. 셸에 기록 폴더 변수가 있어도 같은 차이가 나와야 해서다.
 *   - 기록 사본에 고침 기록(fixes.tsv)이 0줄이거나 대화 기록 파일이 0개이거나, 두 판의 출력이 모두 비면 「차이 없음」을 찍지 않고 오류로 멈춘다(비어 있어서 같게 보이는 거짓 통과를 막으려는 것).
 *   - 기록을 쓰는 서브에이전트(sidechain) 호출은 본 대화 기록에서만 가져온다.
 *   - 실무자 칸은 하네스 입력을 본뜬 것이다(Claude Code 2.1.319 기준: 이름 붙인 실무자는 teammate, 이름 없는 실무자는 subagent, 쉬는 teammate도 running). 하네스 입력 꼴이 바뀌면 어긋날 수 있다.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { spawnSync } = require('node:child_process');

const KIT = path.resolve(__dirname, '..');
const HOME = process.env.HOME || os.homedir();
const INSTALLED = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude');
const TAIL_BYTES = 2 * 1024 * 1024;
const MAX_CMD = 20000;

// ---------------------------------------------------------------- 자식 프로세스 환경(도구가 모두 정한다)
// 허용 목록 밖의 물려받은 변수는 모두 지운다. SUBAGENT_RECORDS_DIR, SUBAGENT_CONFIG_FILE, KIT_HOOK_* 같은 설정 통로는 기록 사본이 아닌 곳을 읽게 하기 때문이다.
const ENV_KEEP = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'TZ', 'TERM', 'SystemRoot', 'USERPROFILE'];
const CHANNEL_ENV = /^(?:SUBAGENT_|KIT_|ANSWER_CHECK|ASK_LOG|BRIEF_CHECK|CHURN_|FIX_LOG|DOC_OVERLAP|WORK_METRICS|CLAUDE_|STALL_|XDG_)/;

// dir은 견줄 판을 깐 설치본 사본. extra로 TMPDIR 같은 것을 더한다.
function baseEnv(parent = process.env) {
  const env = {};
  for (const [k, v] of Object.entries(parent)) if (ENV_KEEP.includes(k) || k.startsWith('LC_')) env[k] = v;
  return env;
}

function cleanEnv(dir, extra = {}, parent = process.env) {
  const env = baseEnv(parent);
  const sys = path.join(dir, 'subagent-system');
  const rec = path.join(sys, 'records');
  return {
    ...env,
    CLAUDE_CONFIG_DIR: dir,
    TMPDIR: path.join(dir, 'tmp-state'),
    SUBAGENT_RECORDS_DIR: rec,
    ANSWER_CHECK_RECORDS: rec,
    SUBAGENT_CONFIG_FILE: path.join(sys, 'config.json'),
    SUBAGENT_PROPOSALS_FILE: path.join(dir, 'docs', 'PROPOSALS.md'),
    ASK_LOG_FILE: path.join(dir, 'permission-asks.jsonl'),
    ...extra,
  };
}

// 물려받았지만 자식에게 넘기지 않은 설정 통로 이름(출력 머리에 밝힌다).
const droppedChannels = (parent = process.env) => Object.keys(parent).filter((k) => CHANNEL_ENV.test(k) && !ENV_KEEP.includes(k) && k !== 'KIT_REPLAY_TMP').sort();

// ---------------------------------------------------------------- 훅 모집단(설치본 settings.json에서 감싸개를 거치는 훅)
function wrappedHooks(configDir = INSTALLED) {
  let settings;
  try { settings = JSON.parse(fs.readFileSync(path.join(configDir, 'settings.json'), 'utf8')); } catch { return null; }
  const out = [];
  for (const [event, arr] of Object.entries(settings.hooks || {})) {
    for (const m of Array.isArray(arr) ? arr : []) {
      for (const h of Array.isArray(m.hooks) ? m.hooks : []) {
        const mm = /kit-hook\.cjs"?\s+([\w-]+)(?:\s|$)/.exec(String(h.command || ''));
        if (mm) out.push({ name: mm[1], event, matcher: m.matcher || '' });
      }
    }
  }
  return out;
}

// 이 도구가 되돌려 보는 막는 훅은 어느 갈래(--only 이름)가 돌려 주나.
const SEEN_BY = { 'stall-check': 'stall', 'brief-check': 'brief', 'answer-check': 'answer', 'korean-check': 'light', 'round-check': 'light', 'handoff-check': 'light' };
// 되돌려 보지 않는 훅과 까닭. blocks가 거짓이면 막는 출력을 내지 않는 훅이다.
const UNSEEN_WHY = {
  'churn-check': { blocks: true, why: '막는 판정이 지금 git 커밋 기록(최근 72시간)을 읽어, 과거 사건을 지금 기록으로 돌리면 다른 판정이 된다' },
  'memory-check': { blocks: true, why: '쓰려는 내용 전문과 그때 메모리 폴더 상태가 필요한데 되살리는 대화 기록 줄에서 내용을 뺐다' },
  'rm-guard': { blocks: true, why: '되돌릴 수 없는 일을 막는 훅이라 막는 판정을 바꾸지 않기로 했고(대표 몫), 지우려던 경로가 그때 있었는지 알아야 해서 되돌릴 수 없다' },
  'git-discard-guard': { blocks: true, why: '되돌릴 수 없는 일을 막는 훅이라 막는 판정을 바꾸지 않기로 했고(대표 몫), 그때 작업 트리의 미커밋 변경이 필요해 되돌릴 수 없다' },
  'supabase-sql-guard': { blocks: true, why: '되돌릴 수 없는 일을 막는 훅이라 막는 판정을 바꾸지 않기로 했고(대표 몫), 승인 창을 묻는 ask라 막음 기록에도 들지 않는다' },
  'rule-check': { blocks: true, why: '실무자 끝 기록(agent_transcript_path)과 묶음 파일이 필요한데 이 도구가 되살리는 대화 기록은 메인 줄기뿐이다. 지난 실무자 기록에서 센 막음 수는 커밋 점검: 줄에 따로 적는다' },
  'ask-log': { blocks: false, why: '승인 창을 기록만 한다(막지 않음)' },
  'retro-write-allow': { blocks: false, why: '허용 판정만 낸다(막지 않음)' },
  'subagent-usage': { blocks: false, why: '실무자 사용 기록만 쓴다(막지 않음)' },
  'usage-autolog': { blocks: false, why: '실무자 사용 기록만 쓴다(막지 않음)' },
};

function unseenLines(want, hooks = wrappedHooks()) {
  if (!hooks) return ['== 안 본 막는 훅 ==', '설치본 settings.json을 읽지 못해 모집단을 모른다(모든 훅이 안 본 것)'];
  const names = [...new Set(hooks.map((h) => h.name))];
  const seen = names.filter((n) => SEEN_BY[n] && want[SEEN_BY[n]]);
  const skipped = names.filter((n) => SEEN_BY[n] && !want[SEEN_BY[n]]);
  const other = names.filter((n) => !SEEN_BY[n]);
  const out = ['== 안 본 막는 훅 =='];
  out.push(`감싸개를 거치는 훅 ${names.length}개 가운데 되돌려 본 것 ${seen.length}개: ${seen.join(', ') || '없음'}`);
  const unseen = [
    ...skipped.map((n) => `${n}: 이 도구는 되돌릴 수 있지만 이번 실행에서 안 돌림(--only에 ${SEEN_BY[n]}이 없음)`),
    ...other.filter((n) => !(UNSEEN_WHY[n] && !UNSEEN_WHY[n].blocks)).map((n) => `${n}: ${UNSEEN_WHY[n] ? UNSEEN_WHY[n].why : '이 도구가 모르는 훅이다(SEEN_BY나 UNSEEN_WHY에 더해 까닭을 적는다)'}`),
  ];
  out.push(unseen.length ? '안 본 훅(까닭):' : '안 본 훅: 없음');
  for (const l of unseen) out.push(`  ${l}`);
  const quiet = other.filter((n) => UNSEEN_WHY[n] && !UNSEEN_WHY[n].blocks);
  if (quiet.length) out.push(`막지 않는 훅(되돌릴 막음이 없음): ${quiet.join(', ')}`);
  return out;
}

// ---------------------------------------------------------------- 자식 일꾼(같은 파일을 --child로 돌린다)
function childMain(kind, dir, eventsFile, outFile) {
  const events = JSON.parse(fs.readFileSync(eventsFile, 'utf8'));
  const sys = path.join(dir, 'subagent-system');
  const out = [];
  if (kind === 'stall') {
    process.env.TMPDIR = path.join(dir, 'tmp-state');
    fs.mkdirSync(process.env.TMPDIR, { recursive: true });
    const mod = require(path.join(sys, 'hooks', 'stall-check.js'));
    const blocksFile = path.join(sys, 'records', 'hook-blocks.tsv');
    const size = () => { try { return fs.statSync(blocksFile).size; } catch { return 0; } };
    const readFrom = (from) => { try { return fs.readFileSync(blocksFile).subarray(from).toString('utf8').split('\n').filter(Boolean).map((l) => l.split('\t')[2]); } catch { return []; } };
    for (const ev of events) {
      const before = size();
      let res = null;
      try {
        res = mod.check({ hook_event_name: 'Stop', session_id: `replay-${ev.sid}`, transcript_path: ev.tp || undefined, last_assistant_message: ev.text, background_tasks: ev.tasks || [], session_crons: ev.crons || [], stop_hook_active: !!ev.active }, new Date(ev.ts));
      } catch (e) { res = { error: String(e && e.message || e) }; }
      let names = [];
      if (res && Array.isArray(res.blockNames)) names = res.blockNames.map((n) => String(n).split('\t')[0]);
      else if (res && res.decision === 'block') names = readFrom(before);
      out.push(res && res.error ? { id: ev.id, error: res.error } : { id: ev.id, names, why: res && res.reason ? String(res.reason).replace(/\s+/g, ' ').slice(0, 260) : '' });
    }
  } else if (kind === 'brief') {
    const mod = require(path.join(sys, 'hooks', 'brief-check.js'));
    for (const ev of events) {
      let res = null;
      try { res = mod.main(JSON.stringify({ tool_name: 'Agent', hook_event_name: 'PreToolUse', session_id: `replay-${ev.sid}`, tool_input: ev.input })); } catch (e) { res = { error: String(e && e.message || e) }; }
      if (res && res.error) { out.push({ id: ev.id, error: res.error }); continue; }
      const reason = res && res.hookSpecificOutput ? String(res.hookSpecificOutput.permissionDecisionReason || '') : '';
      const problems = reason.startsWith('서브에이전트 지시문을') ? reason.split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2, 40)) : [];
      // 막지 않고 알리기만 하는 출력(additionalContext)은 막음으로 세지 않는다. 알림은 따로 적어 두 판이 갈리면 바뀐 호출로 보인다.
      const notice = res && res.hookSpecificOutput && res.hookSpecificOutput.additionalContext ? String(res.hookSpecificOutput.additionalContext).slice(0, 40) : '';
      out.push({ id: ev.id, blocked: !!res && !notice, problems, notice });
    }
  } else if (kind === 'answer') {
    // 답 점검(UserPromptSubmit은 막지 않아 돌리지 않음): 세션마다 걸러 둔 대화 기록(ev.src)을 사건 시각(ev.off)까지만 사본 기록에 덧붙여 가며 Stop과 도구 호출에 되돌린다.
    // 차례 상태(.turn, .lock, .deny)는 이 판의 임시 폴더에만 쌓이고, 안에서 부르는 결정 대조도 같은 입력으로 돈다(설치본 hooks/decision-check.js, --decision-new로 바꿈).
    process.env.TMPDIR = path.join(dir, 'tmp-state');
    fs.mkdirSync(process.env.TMPDIR, { recursive: true });
    const mod = require(path.join(sys, 'hooks', 'answer-check.js'));
    const rtDir = path.join(dir, 'replay-tp');
    fs.mkdirSync(rtDir, { recursive: true });
    const feeds = new Map();
    for (const ev of events) {
      const rt = path.join(rtDir, `${ev.sid}.jsonl`);
      let st = feeds.get(ev.src);
      if (!st) { st = { fd: fs.openSync(ev.src, 'r'), off: 0 }; feeds.set(ev.src, st); fs.writeFileSync(rt, ''); }
      if (ev.off > st.off) {
        const buf = Buffer.alloc(ev.off - st.off);
        fs.readSync(st.fd, buf, 0, buf.length, st.off);
        fs.appendFileSync(rt, buf);
        st.off = ev.off;
      }
      const input = ev.stop
        ? { hook_event_name: 'Stop', session_id: `replay-${ev.sid}`, transcript_path: rt, cwd: ev.cwd, last_assistant_message: ev.text, stop_hook_active: !!ev.active }
        : { hook_event_name: 'PreToolUse', session_id: `replay-${ev.sid}`, transcript_path: rt, cwd: ev.cwd, tool_name: ev.tool, tool_input: ev.input, tool_use_id: ev.toolUseId };
      let res = null;
      try { res = mod.main(JSON.stringify(input)); } catch (e) { res = { error: String((e && e.message) || e) }; }
      let names = [];
      if (res && Array.isArray(res.blockNames)) names = res.blockNames.map((n) => String(n).split('\t')[0]);
      const why = res && (res.reason || res.hookSpecificOutput?.permissionDecisionReason);
      // 판정 이름을 붙이기 전의 판(감싸개 이전 커밋)은 사유의 머리말로 이름을 짐작한다. 여러 검사가 한 사유에 이어 붙은 Stop은 알려진 머리말을 모두 찾는다.
      if (!names.length && res && (res.decision === 'block' || res.hookSpecificOutput?.permissionDecision === 'deny')) {
        const heads = [...String(why || '').matchAll(/(보내기 전 점검|올릴 것 칸|보인 어색함|한꺼번에 정하기|결정 대조|미룬 일 기록|논의 중|물음 확인)(?=[:(])/g)].map((m) => m[1]);
        names = heads.length ? heads : [String(why || '').split(':')[0].slice(0, 20) || '(이름 없는 막음)'];
      }
      out.push(res && res.error ? { id: ev.id, error: res.error } : { id: ev.id, names, why: why ? String(why).replace(/\s+/g, ' ').slice(0, 260) : '' });
    }
    for (const st of feeds.values()) fs.closeSync(st.fd);
  } else if (kind === 'light') {
    // 한국어 점검(Stop), 회차 점검(Agent), 세션 넘김 점검(SendMessage). 셋 모두 입력만으로 판정하는 훅이다(회차 점검의 장부는 사본 기록의 지금 것).
    const hooks = {
      korean: require(path.join(sys, 'hooks', 'korean-check.js')),
      round: require(path.join(sys, 'hooks', 'round-check.js')),
      handoff: require(path.join(sys, 'hooks', 'brief-check.js')),
    };
    const blocked = (res) => !!res && (res.decision === 'block' || res.hookSpecificOutput?.permissionDecision === 'deny');
    for (const ev of events) {
      let res = null;
      try { res = hooks[ev.hook].main(JSON.stringify(ev.input)); } catch (e) { res = { error: String((e && e.message) || e) }; }
      if (res && res.error) { out.push({ id: ev.id, error: res.error }); continue; }
      const why = res && (res.reason || res.hookSpecificOutput?.permissionDecisionReason);
      out.push({ id: ev.id, names: blocked(res) ? [ev.hook] : [], why: why ? String(why).replace(/\s+/g, ' ').slice(0, 260) : '' });
    }
  } else if (kind === 'decision') {
    const mod = require(path.join(dir, 'hooks', 'decision-check.js'));
    const cache = new Map();
    const targetsOf = (cwd) => {
      if (!cache.has(cwd)) { let t = []; try { t = mod.decisionFiles(cwd); } catch { t = []; } cache.set(cwd, t); }
      return cache.get(cwd);
    };
    for (const ev of events) {
      let t = false;
      try { t = !!mod.touches({ name: ev.name, input: ev.input, cwd: ev.cwd }, targetsOf(ev.cwd)); } catch { t = false; }
      out.push({ id: ev.id, touches: t });
    }
  }
  fs.writeFileSync(outFile, JSON.stringify(out));
}


// ---------------------------------------------------------------- 인자
function parseArgs(argv) {
  const o = { base: 'main', new: 'work', days: 10, only: null, show: 5, keep: false, decisionBase: null, decisionNew: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '');
    if (['base', 'new', 'days', 'only', 'show'].includes(k)) o[k] = argv[++i];
    else if (k === 'decision-base') o.decisionBase = path.resolve(argv[++i]);
    else if (k === 'decision-new') o.decisionNew = path.resolve(argv[++i]);
    else if (k === 'keep') o.keep = true;
    else if (k === 'help' || k === 'h') o.help = true;
  }
  o.days = Number(o.days);
  o.show = Number(o.show);
  o.only = o.only ? new Set(String(o.only).split(',')) : null;
  return o;
}

// ---------------------------------------------------------------- 임시 폴더 만들기
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: baseEnv(), ...opts });

// 견줄 판의 scripts와 hooks를 임시 폴더에 꺼낸다. work는 작업 트리(커밋 전 고침 포함), 그 밖은 git 판.
function extractVersion(ref, dest) {
  fs.mkdirSync(dest, { recursive: true });
  if (ref === 'work') {
    for (const sub of ['scripts', 'hooks']) {
      fs.cpSync(path.join(KIT, 'subagent-system', sub), path.join(dest, 'subagent-system', sub), {
        recursive: true,
        filter: (p) => !p.includes(`${path.sep}tests`) && !p.includes('node_modules'),
      });
    }
    return;
  }
  const a = sh('git', ['-C', KIT, 'archive', ref, 'subagent-system/scripts', 'subagent-system/hooks'], { encoding: 'buffer' });
  if (a.status !== 0) throw new Error(`git archive ${ref} 실패: ${String(a.stderr)}`);
  const t = spawnSync('tar', ['-x', '--exclude', 'subagent-system/scripts/tests', '-C', dest], { input: a.stdout, env: baseEnv() });
  if (t.status !== 0) throw new Error(`tar 풀기 실패: ${String(t.stderr)}`);
}

// 설치본을 복사한 위에 견줄 판의 scripts와 hooks를 덮어, 그 판을 깐 설치본처럼 돌릴 폴더를 만든다.
function buildSandbox(label, ref, tmp, decisionFile = null) {
  const dir = path.join(tmp, label);
  const src = path.join(tmp, `src-${label}`);
  extractVersion(ref, src);
  fs.mkdirSync(path.join(dir, 'subagent-system'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'tmp-state'), { recursive: true });
  // 설정 폴더 바로 아래는 읽기만 하는 것들이라 이어 붙이고, 기록이 있는 subagent-system과 hooks만 복사한다.
  for (const e of fs.readdirSync(INSTALLED, { withFileTypes: true })) {
    if (e.name === 'subagent-system' || e.name === 'hooks') continue;
    try { fs.symlinkSync(path.join(INSTALLED, e.name), path.join(dir, e.name)); } catch { /* 건너뜀 */ }
  }
  fs.cpSync(path.join(INSTALLED, 'hooks'), path.join(dir, 'hooks'), { recursive: true });
  for (const e of fs.readdirSync(path.join(INSTALLED, 'subagent-system'), { withFileTypes: true })) {
    const from = path.join(INSTALLED, 'subagent-system', e.name);
    const to = path.join(dir, 'subagent-system', e.name);
    if (e.name === 'node_modules') { try { fs.symlinkSync(from, to); } catch { /* 건너뜀 */ } continue; }
    fs.cpSync(from, to, { recursive: true, filter: (p) => !p.includes(`${path.sep}hook-running`) && !p.endsWith(`${path.sep}tests`) });
  }
  for (const sub of ['scripts', 'hooks']) fs.cpSync(path.join(src, 'subagent-system', sub), path.join(dir, 'subagent-system', sub), { recursive: true });
  // 설치본 결정 대조는 touches를 내보내지 않는다. 사본 끝에 한 줄을 더해 불러 쓴다(원본은 그대로).
  // 결정 대조는 설치본 전용이라 git 판이 없다. 견줄 파일을 주면 이 판의 사본을 그 파일로 바꾼다.
  const dc = path.join(dir, 'hooks', 'decision-check.js');
  if (decisionFile) fs.copyFileSync(decisionFile, dc);
  if (fs.existsSync(dc)) fs.appendFileSync(dc, '\nmodule.exports.touches = touches;\n');
  return dir;
}

// ---------------------------------------------------------------- 판정 쪽
const JUDGE_CMDS = [
  { key: 'judge', script: 'fix-log.js', args: ['judge'], label: 'fix-log.js judge' },
  { key: 'due', script: 'subagent-retro.js', args: ['--due'], label: 'subagent-retro.js --due' },
  { key: 'status', script: 'subagent-retro.js', args: ['--status'], label: 'subagent-retro.js --status' },
  { key: 'waste', script: 'work-metrics.js', args: ['waste'], label: 'work-metrics.js waste' },
  { key: 'health', script: 'work-metrics.js', args: ['health'], label: 'work-metrics.js health' },
];

// 출력에 든 임시 폴더 경로는 설치본 경로로 되돌려, 경로만 다른 줄이 차이로 잡히지 않게 한다.
function runCmd(dir, c) {
  const r = sh(process.execPath, [path.join(dir, 'subagent-system', 'scripts', c.script), ...c.args], { env: cleanEnv(dir), timeout: 15 * 60 * 1000 });
  const norm = (t) => String(t || '').split(fs.realpathSync(dir)).join('<설치본>').split(dir).join('<설치본>');
  return { out: norm(r.stdout), err: norm(r.stderr), status: r.status };
}

// fix-log judge 출력을 처리할 것 줄, 효과 표 행, 태그 줄로 가른다.
function parseJudge(text) {
  const lines = text.split('\n');
  const items = [];
  const rows = [];
  const tags = [];
  let part = 'items';
  let header = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (i === 0) continue; // 처리할 것 건수
    if (l === '효과 표') { part = 'table'; continue; }
    if (l === '태그 목록') { part = 'tags'; continue; }
    if (!l.trim()) continue;
    if (part === 'items') items.push(l.trim());
    else if (part === 'tags') tags.push(l.trim());
    else {
      const cells = l.trim().split(/\s{2,}/);
      if (!header) { header = cells; continue; }
      rows.push(cells);
    }
  }
  return { items, rows, tags };
}

const countDiff = (a, b) => {
  const A = new Map();
  for (const x of a) A.set(x, (A.get(x) || 0) + 1);
  const added = [];
  for (const x of b) {
    if (A.get(x)) A.set(x, A.get(x) - 1);
    else added.push(x);
  }
  const removed = [];
  for (const [x, n] of A) for (let i = 0; i < n; i++) removed.push(x);
  return { added, removed };
};

function judgeLines(base, neu, show) {
  const out = [];
  for (const c of JUDGE_CMDS) {
    const a = base[c.key];
    const b = neu[c.key];
    if (a.status !== 0 || b.status !== 0) out.push(`${c.label}: 실행 실패(전 ${a.status}, 후 ${b.status}) ${String(a.err || b.err).split('\n')[0]}`);
    if (c.key === 'judge') {
      const pa = parseJudge(a.out);
      const pb = parseJudge(b.out);
      const it = countDiff(pa.items, pb.items);
      const keyOf = (r) => r[0];
      const mapA = new Map(pa.rows.map((r) => [keyOf(r), r]));
      const mapB = new Map(pb.rows.map((r) => [keyOf(r), r]));
      const gone = [...mapA.keys()].filter((k) => !mapB.has(k));
      const born = [...mapB.keys()].filter((k) => !mapA.has(k));
      const changed = [...mapA.keys()].filter((k) => mapB.has(k) && mapA.get(k).join('|') !== mapB.get(k).join('|'));
      const tg = countDiff(pa.tags, pb.tags);
      out.push(`fix-log.js judge: 항목 +${it.added.length} -${it.removed.length}, 효과 표 묶음 바뀐 것 ${changed.length + gone.length + born.length}(내용만 바뀜 ${changed.length}, 사라짐 ${gone.length}, 새로 생김 ${born.length}), 태그 목록 +${tg.added.length} -${tg.removed.length}`);
      for (const x of it.added.slice(0, show)) out.push(`  항목 +  ${x.slice(0, 200)}`);
      for (const x of it.removed.slice(0, show)) out.push(`  항목 -  ${x.slice(0, 200)}`);
      for (const k of changed.slice(0, show)) out.push(`  묶음 바뀜  ${k}\n    전: ${mapA.get(k).slice(1).join(' | ')}\n    후: ${mapB.get(k).slice(1).join(' | ')}`);
      for (const k of gone.slice(0, show)) out.push(`  묶음 사라짐  ${k}: ${mapA.get(k).slice(1).join(' | ')}`);
      for (const k of born.slice(0, show)) out.push(`  묶음 새로 생김  ${k}: ${mapB.get(k).slice(1).join(' | ')}`);
      continue;
    }
    const d = countDiff(a.out.split('\n'), b.out.split('\n'));
    out.push(`${c.label}: ${d.added.length || d.removed.length ? `바뀐 줄 +${d.added.length} -${d.removed.length}` : `차이 없음(출력 ${a.out.split('\n').length}줄)`}`);
    for (const x of d.removed.slice(0, show)) out.push(`  -  ${x.slice(0, 220)}`);
    for (const x of d.added.slice(0, show)) out.push(`  +  ${x.slice(0, 220)}`);
  }
  return out;
}

// ---------------------------------------------------------------- 실무자 칸과 예약 되살리기(멈춤 검사의 background_tasks, session_crons)
// 하네스는 Stop 입력에 지금 도는 뒤 작업과 살아 있는 예약을 준다. 대화 기록에서 그 Stop 앞까지의 띄움, 끝, 예약 걸기와 지우기를 읽어 같은 칸을 만든다.
const BG_TOOLS = new Set(['Agent', 'Task', 'Bash', 'Monitor', 'CronCreate', 'CronDelete', 'TaskStop', 'SendMessage']);
const BG_HINT = /backgroundTaskId|"taskId"|async_launched|teammate_spawned|<task-notification>|Successfully stopped task|humanSchedule|Cancelled job|"name":"(?:Agent|Task|Monitor|CronCreate|CronDelete|TaskStop|SendMessage)"|"run_in_background"|teammate_id=\\"|agent-message from=\\"/;
const WAIT_NOTE = /is waiting on its own background work/;
const SHELL_MAX_MS = 6 * 3600000;
const RESUME_GRACE_MS = 5000;
const LOST_MS = 4 * 3600000; // 끝맺지 않은 채 기록이 이만큼 그대로면 세션이 끊긴 것으로 보고 칸에서 뺀다(멈춤 검사가 기다림을 잃은 것으로 보는 시간과 같다)
const BG_TAIL_BYTES = 32 * 1024 * 1024; // 멈춤 검사가 뒤 작업을 찾으려고 읽는 실무자 기록 끝 창(hooks/stall-check.js BG_TAIL)
const AGENT_TAIL_BYTES = 256 * 1024; // 도는 실무자는 마지막 줄과 시각만 쓰여 짧게 자른다(멈춤 검사가 끝 64KB만 읽음)

const noteBodies = (o) => [typeof o.content === 'string' ? o.content : '', typeof o.message?.content === 'string' ? o.message.content : '', typeof o.attachment?.prompt === 'string' ? o.attachment.prompt : ''];
// 알림 글에서 id, 끝 상태, 기다림 여부를 읽는다. 줄 머리가 알림인 글만 센다(도구 결과에 인용된 글은 알림이 아니다).
function parseNotes(o) {
  const out = [];
  for (const c of noteBodies(o)) {
    if (!c.trimStart().startsWith('<task-notification>')) continue;
    for (const m of c.matchAll(/<task-notification>([\s\S]*?)(?:<\/task-notification>|$)/g)) {
      const id = (m[1].match(/<task-id>([^<]+)<\/task-id>/) || [])[1];
      const status = (m[1].match(/<status>([^<]*)<\/status>/) || [])[1];
      const sum = (m[1].match(/<summary>([\s\S]*?)<\/summary>/) || [])[1];
      if (id) out.push({ id: id.trim(), status, summary: sum || '', waiting: WAIT_NOTE.test(sum || '') });
    }
  }
  return out;
}

class BgTracker {
  constructor() {
    this.uses = new Map(); // tool_use id → {name, input, at}
    this.tasks = new Map(); // task id → {id, type, description, command, name, at, exp, state, waitAt}
    this.ended = new Map(); // 끝난 실무자(다시 메시지를 받으면 도는 것으로 돌아옴)
    this.names = new Map(); // 이름 → task id
    this.crons = new Map();
    this.stat = { unresolved: 0, launched: 0 };
    this.staleShells = new Set();
  }

  feed(o) {
    const at = Date.parse(o.timestamp) || 0;
    if (o.type === 'assistant') {
      for (const c of Array.isArray(o.message?.content) ? o.message.content : []) {
        if (c?.type === 'tool_use' && BG_TOOLS.has(c.name)) {
          const i = c.input || {};
          this.uses.set(c.id, { name: c.name, input: { description: i.description, name: i.name, run_in_background: i.run_in_background, command: typeof i.command === 'string' ? i.command.slice(0, 2000) : undefined, cron: i.cron, prompt: typeof i.prompt === 'string' ? i.prompt.slice(0, 300) : undefined, to: i.to }, at });
        }
      }
      return;
    }
    if (o.type !== 'user' && o.type !== 'queue-operation' && o.type !== 'attachment') return;
    for (const n of parseNotes(o)) this.note(n, at);
    if (o.type !== 'user') return;
    const blocks = Array.isArray(o.message?.content) ? o.message.content : [];
    for (const b of blocks) {
      if (b?.type !== 'tool_result') continue;
      const use = this.uses.get(b.tool_use_id);
      if (use) this.result(use, o.toolUseResult, b, at);
    }
  }

  note(n, at) {
    const t = this.tasks.get(n.id);
    if (n.waiting) { if (t) { t.state = 'waiting'; t.waitAt = at; } return; }
    if (n.status === undefined) return; // Monitor 사건 알림은 status가 없고 감시가 이어진다
    if (t) { this.tasks.delete(n.id); if (/^(?:subagent|teammate)$/.test(t.type)) this.ended.set(n.id, t); }
  }

  add(t) { this.stat.launched++; this.tasks.set(t.id, { state: 'running', ...t }); this.ended.delete(t.id); if (t.name) this.names.set(t.name, t.id); }

  result(use, r, block, at) {
    const err = typeof r === 'string' || block?.is_error;
    const i = use.input;
    if (use.name === 'Agent' || use.name === 'Task') {
      if (r && typeof r === 'object' && r.agentId && (r.status === 'async_launched' || r.status === 'teammate_spawned')) {
        this.add({ id: String(r.agentId), type: r.status === 'teammate_spawned' || i.name ? 'teammate' : 'subagent', description: String(r.description || i.description || ''), name: i.name || '', at: use.at });
      } else if (i.run_in_background === true || i.run_in_background === 'true') { if (!err) this.stat.unresolved++; }
    } else if (use.name === 'Bash') {
      if (r && typeof r === 'object' && r.backgroundTaskId) this.add({ id: String(r.backgroundTaskId), type: 'shell', description: String(i.description || i.command || '').slice(0, 200), command: String(i.command || ''), at: use.at });
      else if ((i.run_in_background === true || i.run_in_background === 'true') && !err) this.stat.unresolved++;
    } else if (use.name === 'Monitor') {
      if (r && typeof r === 'object' && r.taskId && r.timeoutMs !== undefined) this.add({ id: String(r.taskId), type: 'monitor', description: String(i.description || ''), at: use.at, exp: r.persistent ? 0 : use.at + Number(r.timeoutMs || 0) });
      else if (!err) this.stat.unresolved++;
    } else if (use.name === 'CronCreate') {
      if (r && typeof r === 'object' && r.id) this.crons.set(String(r.id), { id: String(r.id), schedule: String(i.cron || r.humanSchedule || ''), recurring: r.recurring !== false, prompt: String(i.prompt || ''), fireAt: r.recurring === false ? Number(r.nextFireAt || 0) : 0 });
    } else if (use.name === 'CronDelete') {
      if (r && typeof r === 'object' && r.id) this.crons.delete(String(r.id));
    } else if (use.name === 'TaskStop') {
      const id = r && typeof r === 'object' ? r.task_id : null;
      if (id) { const t = this.tasks.get(String(id)); this.tasks.delete(String(id)); if (t && /^(?:subagent|teammate)$/.test(t.type)) this.ended.set(String(id), t); }
    } else if (use.name === 'SendMessage') {
      const to = String(i.to || '');
      const id = this.names.get(to) || to;
      const t = this.tasks.get(id);
      if (!err) {
        if (t && t.state === 'waiting') { t.state = 'running'; t.waitAt = 0; }
        else if (!t && this.ended.has(id)) { const e = this.ended.get(id); this.tasks.set(id, { ...e, state: 'running', waitAt: 0 }); this.ended.delete(id); }
      }
    }
  }

  // 알림만 오고 기다림 상태인 실무자(waiting)의 id와 기다림 알림 시각. 기록 사본을 만들 때 쓴다.
  agentIds() { return [...this.tasks.values()].filter((t) => /^(?:subagent|teammate)$/.test(t.type)); }

  // ts(ms) 때의 칸. resumed(id, waitAt)이 참이면 기다림 알림 뒤 다시 일한 실무자라 도는 것으로 센다.
  // 뒤 작업을 기다리는 실무자와 만료된 Monitor, 끝 알림 없이 오래된 셸은 칸에서 뺀다. 빼는 것 가운데 끝 알림 없는 셸은 stat에 센다.
  snapshot(ts, resumed = () => false) {
    const tasks = [];
    for (const t of this.tasks.values()) {
      if (t.state === 'waiting') { if (!resumed(t.id, t.waitAt)) continue; }
      if (t.exp && t.exp <= ts) continue;
      if (t.type === 'shell' && ts - t.at > SHELL_MAX_MS) { this.staleShells.add(t.id); continue; }
      const row = { id: t.id, type: t.type, status: 'running', description: t.description };
      if (t.command) row.command = t.command;
      tasks.push(row);
    }
    const crons = [];
    for (const c of this.crons.values()) {
      if (!c.recurring && c.fireAt && c.fireAt <= ts) continue;
      crons.push({ id: c.id, schedule: c.schedule, recurring: c.recurring, prompt: c.prompt });
    }
    return { tasks, crons };
  }
}

// 작업 알림 줄을 멈춤 검사가 읽는 꼴로 줄인다(결과 글은 빼고 id, 끝 상태, 요약만). 알림이 아닌 줄은 null.
function noteStub(o) {
  const ns = parseNotes(o);
  if (!ns.length) return null;
  const body = ns.map((n) => `<task-notification>\n<task-id>${n.id}</task-id>\n${n.status !== undefined ? `<status>${n.status}</status>\n` : ''}<summary>${n.summary}</summary>\n</task-notification>`).join('\n');
  const head = { type: o.type, timestamp: o.timestamp, isSidechain: false };
  if (typeof o.content === 'string') return { ...head, content: body };
  if (typeof o.attachment?.prompt === 'string') return { ...head, attachment: { ...o.attachment, prompt: body } };
  return { ...head, message: { role: 'user', content: body } };
}
// TaskStop 성공 줄(멈춘 실무자를 기다림 기억에서 지우는 근거)과 이름 붙인 실무자의 끝 메시지가 닿은 줄(늦은 결과 판정)도 같은 꼴로 남긴다.
function stopStub(o) {
  const r = o.toolUseResult;
  if (o.type !== 'user' || !r || typeof r !== 'object' || !r.task_id || !/Successfully stopped/.test(String(r.message || ''))) return null;
  return { type: 'user', timestamp: o.timestamp, isSidechain: false, toolUseResult: { task_id: r.task_id }, message: { role: 'user', content: [{ type: 'tool_result', content: `Successfully stopped task: ${r.task_id}` }] } };
}
function deliveredStub(line, o) {
  const names = new Set();
  for (const m of line.matchAll(/teammate_id=\\"([^\\"]+)\\"/g)) names.add(m[1]);
  for (const m of line.matchAll(/agent-message from=\\"([^\\"]+)\\"/g)) names.add(m[1]);
  if (!names.size) return null;
  return { type: 'user', timestamp: o.timestamp, isSidechain: false, message: { role: 'user', content: [...names].map((n) => `teammate_id="${n}" agent-message from="${n}"`).join('\n') } };
}

// 실무자 기록 폴더의 meta.json을 읽어 설명 → 기록 id 목록으로 묶는다.
function metaIndex(dir) {
  const out = new Map();
  let names = [];
  try { names = fs.readdirSync(dir).filter((f) => f.endsWith('.meta.json')); } catch { return out; }
  for (const f of names) {
    let d;
    try { d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).description; } catch { continue; }
    if (!d) continue;
    const k = String(d).trim();
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(f.replace(/^agent-/, '').replace(/\.meta\.json$/, ''));
  }
  return out;
}

// 실무자 기록 한 개를 ts(ms)까지의 줄만 남긴 사본으로 만든다. tailBytes보다 긴 기록은 끝 창만 읽는다(앞 줄 하나는 생긴 시각을 위해 붙인다).
// 돌려주는 값: {file(사본 경로), lastAt(마지막 줄 시각 ms), endTurn(마지막 줄이 끝맺음 답인지)} 또는 null(기록을 못 읽거나 이 시각엔 아직 없음).
function cutAgentFile(src, ts, tailBytes, storeDir, cache) {
  let fd;
  try { fd = fs.openSync(src, 'r'); } catch { return null; }
  try {
    const st = fs.fstatSync(fd);
    const size = st.size;
    // 이 시각 전에 이미 다 쓴 기록은 어느 Stop에서나 같으니 한 번만 자른다.
    const wholeKey = st.mtimeMs <= ts ? `${src}|${tailBytes}|${size}` : null;
    if (wholeKey && cache.has(wholeKey)) return cache.get(wholeKey);
    const len = Math.min(size, tailBytes);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    const starts = [];
    let at = 0;
    if (size > len) { const nl = buf.indexOf(10); at = nl === -1 ? len : nl + 1; }
    while (at < len) {
      starts.push(at);
      const nl = buf.indexOf(10, at);
      if (nl === -1) break;
      at = nl + 1;
    }
    if (!starts.length) return null;
    const stampAt = (k) => { const e = buf.indexOf(10, starts[k]); try { return Date.parse(JSON.parse(buf.toString('utf8', starts[k], e === -1 ? len : e)).timestamp) || 0; } catch { return 0; } };
    // 시각 순이라 ts 이하인 마지막 줄을 이분 탐색으로 찾는다(시각을 못 읽는 줄은 앞 줄로 본다).
    let lo = 0;
    let hi = starts.length - 1;
    let last = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      let k = mid;
      let t = stampAt(k);
      while (!t && k > lo) { k--; t = stampAt(k); }
      if (t && t <= ts) { last = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (last < 0) return null; // 이 시각엔 아직 기록이 없다
    const endByte = (() => { const e = buf.indexOf(10, starts[last]); return e === -1 ? len : e + 1; })();
    const key = `${path.basename(src)}@${size - len + endByte}`;
    if (cache.has(key)) return cache.get(key);
    let lastAt = 0;
    let endTurn = false;
    for (let k = last; k >= 0 && !lastAt; k--) {
      lastAt = stampAt(k);
      if (lastAt) { const e = buf.indexOf(10, starts[k]); try { const o = JSON.parse(buf.toString('utf8', starts[k], e === -1 ? len : e)); endTurn = o.type === 'assistant' && /^(?:end_turn|stop_sequence)$/.test(String(o.message?.stop_reason || '')); } catch { /* 잘린 줄 */ } }
    }
    let head = '';
    if (size > len) {
      const h = Buffer.alloc(8192);
      const n = fs.readSync(fd, h, 0, 8192, 0);
      const first = h.toString('utf8', 0, n).split('\n')[0];
      try { JSON.parse(first); head = `${first}\n`; } catch { head = ''; }
    }
    const out = path.join(storeDir, `${key.replace(/[^\w.@-]/g, '_')}.jsonl`);
    fs.writeFileSync(out, Buffer.concat([Buffer.from(head), buf.subarray(starts[0], endByte)]));
    if (lastAt) { const d = new Date(lastAt); fs.utimesSync(out, d, d); }
    const res = { file: out, lastAt, endTurn };
    cache.set(key, res);
    if (wholeKey) cache.set(wholeKey, res);
    return res;
  } finally { fs.closeSync(fd); }
}

// ---------------------------------------------------------------- 대화 기록에서 사건 모으기
function progressMarkers() {
  const marks = new Set(['docs/plan/work']);
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(INSTALLED, 'subagent-system', 'config.json'), 'utf8'));
    for (const d of Array.isArray(cfg.progressDirs) ? cfg.progressDirs : []) if (typeof d === 'string') marks.add(d.replace(/\/+$/, ''));
  } catch { /* 기본만 */ }
  return [...marks];
}

async function collectEvents(days, tmp, want) {
  const root = path.join(INSTALLED, 'projects');
  const since = Date.now() - days * 86400000;
  const marks = progressMarkers();
  const stops = [];
  const agents = [];
  const tools = [];
  const handoffs = [];
  const bgStat = { stops: 0, withTasks: 0, withAgents: 0, withCrons: 0, unresolved: 0, staleShell: 0, noRecord: new Set(), lost: new Set(), launched: 0 };
  const agentStore = path.join(tmp, 'agent-cuts');
  fs.mkdirSync(agentStore, { recursive: true });
  const cutCache = new Map();
  let nSlice = 0;
  const dirs = [];
  try { for (const d of fs.readdirSync(root)) { const p = path.join(root, d); if (fs.statSync(p).isDirectory()) dirs.push(p); } } catch { /* 없음 */ }
  const files = [];
  for (const d of dirs) {
    for (const f of fs.readdirSync(d)) {
      if (!f.endsWith('.jsonl')) continue;
      const p = path.join(d, f);
      try { if (fs.statSync(p).mtimeMs >= since) files.push(p); } catch { /* 건너뜀 */ }
    }
  }
  const sliceDir = path.join(tmp, 'slices');
  fs.mkdirSync(sliceDir, { recursive: true });
  for (const file of files) {
    const sid = path.basename(file, '.jsonl').slice(0, 8);
    let off = 0;
    let prog = []; // {off, line}
    let notes = []; // {off, line}: 작업 알림, TaskStop 성공, 실무자 끝 메시지가 닿은 줄(멈춤 검사가 읽는 꼴로 줄임)
    const tracker = want.stall ? new BgTracker() : null;
    const subDir = path.join(file.replace(/\.jsonl$/, ''), 'subagents');
    let metaIdx = null;
    let feedback = false; // 막힌 Stop 뒤 모델이 이어 쓴 첫 Stop은 stop_hook_active가 참이다(답 점검 쪽과 같은 읽기).
    let lastSliceKey = '';
    let lastSlicePath = null;
    const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of rl) {
      const here = off;
      off += Buffer.byteLength(line) + 1;
      if (want.stall && line.includes('"type":"user"')) {
        if (line.includes('Stop hook feedback')) feedback = true;
        else if (line.includes('"promptSource"')) feedback = false;
      }
      if (tracker && BG_HINT.test(line)) {
        let bo;
        try { bo = JSON.parse(line); } catch { bo = null; }
        if (bo && !bo.isSidechain) {
          tracker.feed(bo);
          const stub = noteStub(bo) || stopStub(bo) || deliveredStub(line, bo);
          if (stub) notes.push({ off: here, line: JSON.stringify(stub) });
        }
      }
      if (!line.includes('"assistant"')) continue;
      const hasTool = line.includes('"tool_use"');
      if (hasTool && want.stall && marks.some((m) => line.includes(m))) {
        let o;
        try { o = JSON.parse(line); } catch { continue; }
        if (o.type === 'assistant' && !o.isSidechain) prog.push({ off: here, line });
      }
      if (hasTool && (want.brief || want.decision || want.light)) {
        let o;
        try { o = JSON.parse(line); } catch { continue; }
        if (o.type !== 'assistant' || o.isSidechain || !(Date.parse(o.timestamp) >= since)) continue;
        for (const c of o.message?.content || []) {
          if (c?.type !== 'tool_use') continue;
          if ((want.brief || want.light) && (c.name === 'Agent' || c.name === 'Task')) agents.push({ id: `${sid}@${o.timestamp}#${agents.length}`, sid, input: c.input || {}, cwd: o.cwd || '' });
          if (want.light && c.name === 'SendMessage') handoffs.push({ id: `${sid}@${o.timestamp}#${handoffs.length}`, sid, input: c.input || {}, tp: file });
          if (want.decision) {
            const i = c.input || {};
            if (c.name === 'Bash' && typeof i.command === 'string') tools.push({ id: `${sid}@${o.timestamp}#${tools.length}`, name: 'Bash', input: { command: i.command.slice(0, MAX_CMD) }, cwd: o.cwd || '' });
            else if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(c.name)) tools.push({ id: `${sid}@${o.timestamp}#${tools.length}`, name: c.name, input: { file_path: i.file_path, notebook_path: i.notebook_path }, cwd: o.cwd || '' });
          }
        }
        continue;
      }
      if ((want.stall || want.light) && line.includes('"end_turn"')) {
        let o;
        try { o = JSON.parse(line); } catch { continue; }
        if (o.type !== 'assistant' || o.isSidechain || o.message?.stop_reason !== 'end_turn' || !(Date.parse(o.timestamp) >= since)) continue;
        const text = (o.message.content || []).filter((c) => c?.type === 'text').map((c) => c.text).join('\n');
        if (!text.trim()) continue;
        prog = prog.filter((p) => p.off >= here - TAIL_BYTES);
        notes = notes.filter((p) => p.off >= here - TAIL_BYTES);
        let tp = null;
        let tasks;
        let crons;
        const cuts = [];
        if (tracker) {
          // 이 Stop 때 도는 뒤 작업과 살아 있는 예약. 실무자 기록은 이 Stop 시각까지의 줄만 남긴 사본으로 조각 곁에 둔다.
          const at = Date.parse(o.timestamp);
          // 이름 붙인 실무자의 기록은 id가 아니라 meta.json의 description으로 짝지어지므로(멈춤 검사 agentRecords), 같은 설명의 기록을 모두 자른다.
          metaIdx ||= metaIndex(subDir);
          const cutOf = (id, bytes) => {
            const got = cutAgentFile(path.join(subDir, `agent-${id}.jsonl`), at, bytes, agentStore, cutCache);
            return got ? { id, ...got } : null;
          };
          const seen = new Set();
          const take = (id, bytes) => {
            if (seen.has(id)) return true;
            const c = cutOf(id, bytes);
            if (c) { cuts.push(c); seen.add(id); }
            return !!c;
          };
          const snap = tracker.snapshot(at, (id, waitAt) => {
            const c = cutOf(id, BG_TAIL_BYTES);
            if (c && !seen.has(id)) { cuts.push(c); seen.add(id); }
            return !!c && c.lastAt > waitAt + RESUME_GRACE_MS;
          });
          const cutBy = new Map(cuts.map((c) => [c.id, c]));
          const lost = new Set();
          for (const t of tracker.agentIds()) {
            const own = take(t.id, t.state === 'waiting' ? BG_TAIL_BYTES : AGENT_TAIL_BYTES);
            const ids = [t.id, ...(metaIdx.get(String(t.description || '').trim()) || [])];
            for (const id of ids.slice(1)) take(id, AGENT_TAIL_BYTES);
            for (const c of cuts) if (!cutBy.has(c.id)) cutBy.set(c.id, c);
            const found = ids.map((id) => cutBy.get(id)).filter(Boolean);
            if (!own && !found.length && !fs.existsSync(path.join(subDir, `agent-${t.id}.jsonl`)) && !ids.slice(1).length) bgStat.noRecord.add(`${sid}:${t.id}`);
            // 끝맺지 않은 채 4시간 넘게 그대로인 기록은 세션이 끊겨 사라진 실무자다(하네스는 그 세션에서 도는 것만 칸에 준다).
            if (t.state !== 'waiting' && found.length && found.every((c) => !c.endTurn && at - c.lastAt > LOST_MS)) lost.add(t.id);
          }
          for (const id of lost) bgStat.lost.add(`${sid}:${id}`);
          tasks = snap.tasks.filter((t) => !lost.has(t.id));
          crons = snap.crons;
          bgStat.stops++;
          if (tasks.length) bgStat.withTasks++;
          if (tasks.some((t) => t.type === 'subagent' || t.type === 'teammate')) bgStat.withAgents++;
          if (crons.length) bgStat.withCrons++;
        }
        const lines = [...prog, ...notes].sort((a, b) => a.off - b.off);
        if (lines.length || cuts.length) {
          const key = `${lines.length}:${lines[0]?.off}:${lines[lines.length - 1]?.off}:${cuts.map((c) => c.file).sort().join('|')}`;
          if (key === lastSliceKey) tp = lastSlicePath;
          else {
            tp = path.join(sliceDir, `s${nSlice++}.jsonl`);
            fs.writeFileSync(tp, lines.length ? `${lines.map((p) => p.line).join('\n')}\n` : '');
            if (cuts.length) {
              const dest = path.join(tp.replace(/\.jsonl$/, ''), 'subagents');
              fs.mkdirSync(dest, { recursive: true });
              for (const c of cuts) {
                fs.symlinkSync(c.file, path.join(dest, `agent-${c.id}.jsonl`));
                try { fs.copyFileSync(path.join(subDir, `agent-${c.id}.meta.json`), path.join(dest, `agent-${c.id}.meta.json`)); } catch { /* 설명 없는 기록은 짝지을 수 없다 */ }
              }
            }
            lastSliceKey = key;
            lastSlicePath = tp;
          }
        }
        stops.push({ id: `${sid}@${o.timestamp}`, sid, ts: o.timestamp, text, tp, tasks, crons, active: feedback });
        feedback = false;
      }
    }
    if (tracker) {
      bgStat.unresolved += tracker.stat.unresolved;
      bgStat.launched += tracker.stat.launched;
      bgStat.staleShell += tracker.staleShells.size;
    }
  }
  // 세션별로 시각 순을 지킨다(멈춤 검사의 상태는 세션마다 이어진다).
  stops.sort((a, b) => (a.sid === b.sid ? a.ts.localeCompare(b.ts) : a.sid.localeCompare(b.sid)));
  const answers = want.answer ? await collectAnswerEvents(files, since, sliceDir) : [];
  return { stops, agents, tools, handoffs, answers, files: files.length, bg: want.stall ? bgStat : null };
}

// ---------------------------------------------------------------- 답 점검용 사건: 세션마다 걸러 둔 대화 기록과 사건 시각(걸러 둔 파일의 바이트 자리)
// 답 점검의 차례 상태는 대화 기록을 읽어 서므로, 사건마다 그 시각까지의 기록이 있어야 한다. 걸러 둔 기록은 판정이 읽는 줄(사용자 말, 알림, 도중 말, 도구 호출, 답 글)만 남기고 큰 글을 줄인다.
// 사건을 줄 뒤에 둔다: 하네스는 도구 호출이나 답 줄을 기록에 쓴 뒤에 훅을 부른다.
const TEXT_MAX = 20000;
const BRIEF_MAX = 60000;
const slimText = (t, n = TEXT_MAX) => (typeof t === 'string' && t.length > n ? t.slice(0, n) : t);
function slimInput(name, input) {
  const i = input || {};
  if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(name)) return { file_path: i.file_path, notebook_path: i.notebook_path };
  if (name === 'Bash') return { command: slimText(i.command, MAX_CMD), run_in_background: i.run_in_background };
  if (name === 'Agent' || name === 'Task') return { description: i.description, subagent_type: i.subagent_type, prompt: slimText(i.prompt, BRIEF_MAX), run_in_background: i.run_in_background };
  if (name === 'SendMessage') return { to: i.to, message: slimText(i.message) };
  return JSON.stringify(i).length > TEXT_MAX ? {} : i;
}
function slimLine(o) {
  const head = { type: o.type, uuid: o.uuid, parentUuid: o.parentUuid, timestamp: o.timestamp, cwd: o.cwd, isMeta: o.isMeta, promptSource: o.promptSource, turnOrigin: o.turnOrigin };
  const c = o.message && o.message.content;
  if (o.type === 'assistant') {
    const blocks = (Array.isArray(c) ? c : []).filter((b) => b && b.type !== 'thinking').map((b) => (b.type === 'text' ? { type: 'text', text: slimText(b.text) } : b.type === 'tool_use' ? { type: 'tool_use', id: b.id, name: b.name, input: slimInput(b.name, b.input) } : { type: b.type }));
    return { ...head, message: { role: 'assistant', content: blocks, stop_reason: o.message && o.message.stop_reason } };
  }
  const content = typeof c === 'string' ? slimText(c) : Array.isArray(c) ? c.map((b) => (b && b.type === 'text' ? { type: 'text', text: slimText(b.text) } : b && b.type === 'tool_result' ? b : { type: b && b.type })) : c;
  return { ...head, message: { role: 'user', content } };
}

async function collectAnswerEvents(files, since, sliceDir) {
  const dir = path.join(path.dirname(sliceDir), 'answer-src');
  fs.mkdirSync(dir, { recursive: true });
  const hooks = wrappedHooks() || [];
  const entry = hooks.find((h) => h.name === 'answer-check' && h.event === 'PreToolUse');
  const matcher = new RegExp(`^(?:${(entry && entry.matcher) || 'Agent|AskUserQuestion|Edit|Write|MultiEdit|NotebookEdit|Bash|SendMessage|Monitor|mcp__supabase__apply_migration|mcp__supabase__deploy_edge_function|mcp__supabase__merge_branch|mcp__supabase__reset_branch|mcp__supabase__delete_branch|mcp__supabase__create_branch'})$`);
  const events = [];
  for (const file of files) {
    const sid = path.basename(file, '.jsonl');
    const src = path.join(dir, `${sid}.jsonl`);
    const chunks = [];
    let off = 0;
    let feedback = false; // 막힌 Stop 뒤 모델이 이어 쓴 첫 Stop은 stop_hook_active가 참이다.
    const add = (obj) => {
      const t = `${JSON.stringify(obj)}\n`;
      chunks.push(t);
      off += Buffer.byteLength(t);
      if (chunks.length >= 500) { fs.appendFileSync(src, chunks.join('')); chunks.length = 0; }
    };
    const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of rl) {
      const user = line.includes('"type":"user"');
      const asst = line.includes('"type":"assistant"');
      const absorbed = line.includes('absorbed_mid_turn');
      if (!user && !asst && !absorbed) continue;
      if (user && line.length > 6000 && line.includes('"type":"tool_result"')) continue; // 큰 도구 결과. 이 줄이 없으면 「끝난 일」로 읽혀 판정이 같다.
      const ts = (line.match(/"timestamp":"([^"]+)"/) || [])[1];
      const at = Date.parse(ts);
      if (at < since - 86400000) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      if (o.isSidechain) continue;
      if (o.type === 'queue-operation') {
        if (o.reason === 'absorbed_mid_turn') add({ type: 'queue-operation', operation: o.operation, reason: o.reason, content: slimText(o.content), commandUuid: o.commandUuid, timestamp: o.timestamp });
        continue;
      }
      if (o.type === 'user') {
        const c = o.message && o.message.content;
        const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((x) => x && x.type === 'text').map((x) => x.text).join(' ') : '';
        if (/^\s*Stop hook feedback/.test(text)) feedback = true;
        else if (!Array.isArray(c) || !c.some((x) => x && x.type === 'tool_result')) feedback = false;
        add(slimLine(o));
        continue;
      }
      if (o.type !== 'assistant') continue;
      add(slimLine(o));
      if (!(at >= since)) continue;
      const blocks = Array.isArray(o.message && o.message.content) ? o.message.content : [];
      for (const b of blocks) {
        if (b && b.type === 'tool_use' && matcher.test(b.name)) events.push({ id: `${sid}@${o.timestamp}#${events.length}`, sid, src, off, cwd: o.cwd || '', tool: b.name, input: slimInput(b.name, b.input), toolUseId: b.id });
      }
      if (o.message && o.message.stop_reason === 'end_turn') {
        const text = blocks.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n');
        if (text.trim()) { events.push({ id: `${sid}@${o.timestamp}#${events.length}`, sid, src, off, cwd: o.cwd || '', stop: true, text, active: feedback }); feedback = false; }
      }
    }
    if (chunks.length) fs.appendFileSync(src, chunks.join(''));
    if (!fs.existsSync(src)) fs.writeFileSync(src, '');
  }
  return events;
}

function runChild(kind, dir, events, tmp, label) {
  const ef = path.join(tmp, `events-${kind}-${label}.json`);
  const of = path.join(tmp, `out-${kind}-${label}.json`);
  fs.writeFileSync(ef, JSON.stringify(events));
  const r = spawnSync(process.execPath, [__filename, '--child', kind, dir, ef, of], { encoding: 'utf8', env: cleanEnv(dir), maxBuffer: 64 * 1024 * 1024, timeout: 30 * 60 * 1000 });
  if (r.status !== 0) throw new Error(`${kind} 되돌려 보기 실패(${label}): ${String(r.stderr).split('\n').slice(0, 4).join(' / ')}`);
  return JSON.parse(fs.readFileSync(of, 'utf8'));
}

// 사건마다 막은 판정 이름을 두 판으로 견준다. label은 훅 이름, noun은 사건 이름(Stop, 도구 호출).
function namesLines(label, noun, events, A, B, show, textOf = (ev) => ev.text || '') {
  const by = (res) => new Map(res.map((r) => [r.id, r]));
  const a = by(A);
  const b = by(B);
  const sumA = new Map();
  const sumB = new Map();
  const diffs = [];
  let errA = 0;
  let errB = 0;
  for (const ev of events) {
    const x = a.get(ev.id);
    const y = b.get(ev.id);
    if (x?.error) errA++;
    if (y?.error) errB++;
    const na = x?.names || [];
    const nb = y?.names || [];
    for (const n of na) sumA.set(n, (sumA.get(n) || 0) + 1);
    for (const n of nb) sumB.set(n, (sumB.get(n) || 0) + 1);
    if (JSON.stringify(na) !== JSON.stringify(nb)) diffs.push({ ev, na, nb });
  }
  const tot = (m) => [...m.values()].reduce((s, n) => s + n, 0);
  const names = [...new Set([...sumA.keys(), ...sumB.keys()])].sort();
  const out = [`${label}: ${noun} ${events.length}개, 막음 전 ${tot(sumA)} 후 ${tot(sumB)}, 바뀐 ${noun} ${diffs.length}${errA || errB ? `, 오류 전 ${errA} 후 ${errB}` : ''}`];
  const per = names.filter((n) => (sumA.get(n) || 0) !== (sumB.get(n) || 0)).map((n) => `${n} ${sumA.get(n) || 0}→${sumB.get(n) || 0}`);
  if (per.length) out.push(`  판정별 바뀐 수: ${per.join(', ')}`);
  const same = names.filter((n) => (sumA.get(n) || 0) === (sumB.get(n) || 0)).map((n) => `${n} ${sumA.get(n) || 0}`);
  if (same.length) out.push(`  판정별 같은 수: ${same.join(', ')}`);
  for (const d of diffs.slice(0, show)) {
    out.push(`  바뀐 ${noun} ${d.ev.id}: 전 [${d.na.join(', ')}] 후 [${d.nb.join(', ')}] ${String(textOf(d.ev)).slice(0, 40).replace(/\n/g, ' ')}…`);
    const why = (r) => (r && r.why ? r.why.replace(/^[^:]*:\s*/, '').slice(0, 150) : '');
    if (why(a.get(d.ev.id))) out.push(`    전 이유: ${why(a.get(d.ev.id))}`);
    if (why(b.get(d.ev.id))) out.push(`    후 이유: ${why(b.get(d.ev.id))}`);
  }
  return out;
}

// 되살린 실무자 칸과 예약, 못 되살린 것의 수.
function bgLine(b) {
  if (!b) return '';
  const lost = [`띄운 결과에서 id를 못 읽은 작업 ${b.unresolved}`, `실무자 기록이 없는 실무자 ${b.noRecord.size}`, `끝맺지 않고 4시간 넘게 그대로라 끊긴 것으로 보고 뺀 실무자 ${b.lost.size}`, `끝 알림 없이 6시간 넘긴 셸 ${b.staleShell}`];
  return `  실무자 칸 되살림: Stop ${b.stops}개 가운데 실무자나 셸이 든 Stop ${b.withTasks}(실무자가 든 Stop ${b.withAgents}), 예약이 든 Stop ${b.withCrons}, 띄운 작업 ${b.launched}개. 못 되살린 것: ${lost.join(', ')}`;
}

const stallLines = (events, A, B, show) => namesLines('멈춤 검사', 'Stop', events, A, B, show);

function briefLines(events, A, B, show) {
  const a = new Map(A.map((r) => [r.id, r]));
  const b = new Map(B.map((r) => [r.id, r]));
  let na = 0;
  let nb = 0;
  let nta = 0;
  let ntb = 0;
  let err = 0;
  const diffs = [];
  for (const ev of events) {
    const x = a.get(ev.id);
    const y = b.get(ev.id);
    if (x?.error || y?.error) err++;
    if (x?.blocked) na++;
    if (y?.blocked) nb++;
    if (x?.notice) nta++;
    if (y?.notice) ntb++;
    if (JSON.stringify([x?.blocked, x?.problems, x?.notice]) !== JSON.stringify([y?.blocked, y?.problems, y?.notice])) diffs.push({ ev, x, y });
  }
  const out = [`지시문 점검: Agent 호출 ${events.length}번, 막음 전 ${na} 후 ${nb}${nta || ntb ? `, 알림 전 ${nta} 후 ${ntb}` : ''}, 바뀐 호출 ${diffs.length}${err ? `, 오류 ${err}` : ''}`];
  for (const d of diffs.slice(0, show)) out.push(`  바뀐 호출 ${d.ev.id} 「${String(d.ev.input.description || '').slice(0, 40)}」: 전 ${d.x?.blocked ? `막음[${(d.x.problems || []).join(' / ')}]` : d.x?.notice ? '알림' : '통과'} 후 ${d.y?.blocked ? `막음[${(d.y.problems || []).join(' / ')}]` : d.y?.notice ? '알림' : '통과'}`);
  return out;
}

function decisionLines(events, A, B, show) {
  const a = new Map(A.map((r) => [r.id, r.touches]));
  const b = new Map(B.map((r) => [r.id, r.touches]));
  let ta = 0;
  let tb = 0;
  const diffs = [];
  for (const ev of events) {
    if (a.get(ev.id)) ta++;
    if (b.get(ev.id)) tb++;
    if (a.get(ev.id) !== b.get(ev.id)) diffs.push(ev);
  }
  const out = [`설치본 결정 대조: 도구 호출 ${events.length}번, 문서 고침으로 본 수 전 ${ta} 후 ${tb}, 바뀐 호출 ${diffs.length}(새로 참 ${diffs.filter((e) => b.get(e.id)).length}, 거짓으로 ${diffs.filter((e) => a.get(e.id)).length})`];
  for (const e of diffs.slice(0, show)) out.push(`  바뀐 호출 ${e.id} ${e.name} ${a.get(e.id) ? '참→거짓' : '거짓→참'}: ${String(e.input.command || e.input.file_path || '').slice(0, 120).replace(/\n/g, ' ')}`);
  return out;
}

// ---------------------------------------------------------------- 본문
// 머리줄(첫 줄이 「시각」으로 시작)은 세지 않는다. 머리줄만 있는 기록을 비었다고 봐야 해서다.
const lineCount = (file) => { try { return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('시각')).length; } catch { return 0; } };

// 읽은 기록이 비었으면 두 판이 같은 빈 기록을 읽어 「차이 없음」이 나온다. 그 길을 막는다.
function assertRecords(want, dir, filesFound) {
  const rec = path.join(dir, 'subagent-system', 'records');
  const fixes = lineCount(path.join(rec, 'fixes.tsv'));
  if (want.judge && fixes === 0) throw new Error(`기록 사본의 fixes.tsv가 0줄이라 판정 쪽을 견줄 수 없다(${rec}). 설치본에 고침 기록이 없으면 판정 쪽은 --only로 뺀다.`);
  if (filesFound !== null && filesFound === 0) throw new Error('최근 기간의 대화 기록이 0개라 막는 훅 쪽을 견줄 수 없다(--days를 늘리거나 기록 폴더를 확인한다).');
  return { fixes, blocks: lineCount(path.join(rec, 'hook-blocks.tsv')) };
}

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  if (opt.help) {
    const head = fs.readFileSync(__filename, 'utf8').split('*/')[0];
    console.log(head.split('\n').slice(3).map((l) => l.replace(/^ \* ?/, '')).join('\n'));
    return;
  }
  const on = (k) => !opt.only || opt.only.has(k);
  const want = { judge: on('judge'), stall: on('stall'), brief: on('brief'), decision: on('decision'), answer: on('answer'), light: on('light') };
  const tmp = fs.mkdtempSync(path.join(process.env.KIT_REPLAY_TMP || os.tmpdir(), 'kit-replay-'));
  const lines = [`전 ${opt.base} / 후 ${opt.new} / 최근 ${opt.days}일 / 기록 ${INSTALLED}`];
  const dropped = droppedChannels();
  if (dropped.length) lines.push(`물려받은 설정 통로 ${dropped.length}개는 자식에게 넘기지 않음: ${dropped.join(', ')}`);
  let failed = false;
  const need = (what, n) => { if (!n) throw new Error(`${what}가 0이라 「차이 없음」을 낼 수 없다(되돌릴 사건이 없다).`); };
  try {
    const dirA = buildSandbox('base', opt.base, tmp, opt.decisionBase);
    const dirB = buildSandbox('new', opt.new, tmp, opt.decisionNew);
    // 다른 세션이 기록에 줄을 덧붙이는 동안 두 복사본이 어긋나지 않게, 둘째 복사본의 기록은 첫째 것을 다시 복사해 같게 만든다.
    fs.cpSync(path.join(dirA, 'subagent-system', 'records'), path.join(dirB, 'subagent-system', 'records'), { recursive: true, force: true });
    const wantHooks = want.stall || want.brief || want.decision || want.answer || want.light;
    const ev = wantHooks ? await collectEvents(opt.days, tmp, want) : null;
    const rec = assertRecords(want, dirA, ev ? ev.files : null);
    lines.push(`기록 사본: fixes.tsv ${rec.fixes}줄, hook-blocks.tsv ${rec.blocks}줄${ev ? `, 대화 기록 ${ev.files}개 파일` : ''}`);
    if (want.judge) {
      lines.push('', '== 판정 쪽 ==');
      const res = (dir) => Object.fromEntries(JUDGE_CMDS.map((c) => [c.key, runCmd(dir, c)]));
      const ra = res(dirA);
      const rb = res(dirB);
      for (const c of JUDGE_CMDS) {
        if (!ra[c.key].out.trim() && !rb[c.key].out.trim()) throw new Error(`${c.label}: 두 판 출력이 모두 비었다(전 ${ra[c.key].status}, 후 ${rb[c.key].status}) ${String(ra[c.key].err || rb[c.key].err).split('\n')[0]}`);
        if (ra[c.key].status !== 0 || rb[c.key].status !== 0) failed = true;
      }
      lines.push(...judgeLines(ra, rb, opt.show));
    }
    if (wantHooks) {
      lines.push('', '== 막는 훅 쪽 ==');
      const pair = (kind, events) => [runChild(kind, dirA, events, tmp, 'base'), runChild(kind, dirB, events, tmp, 'new')];
      if (want.stall) { need('멈춤 검사의 Stop', ev.stops.length); lines.push(...stallLines(ev.stops, ...pair('stall', ev.stops), opt.show), bgLine(ev.bg)); }
      if (want.brief) { need('지시문 점검의 Agent 호출', ev.agents.length); lines.push(...briefLines(ev.agents, ...pair('brief', ev.agents), opt.show)); }
      if (want.decision) { need('결정 대조의 도구 호출', ev.tools.length); lines.push(...decisionLines(ev.tools, ...pair('decision', ev.tools), opt.show)); }
      if (want.answer) {
        need('답 점검의 사건', ev.answers.length);
        const [A, B] = pair('answer', ev.answers);
        const stopsN = ev.answers.filter((e) => e.stop).length;
        lines.push(...namesLines(`답 점검(Stop ${stopsN}, 도구 호출 ${ev.answers.length - stopsN}, 결정 대조 포함)`, '사건', ev.answers, A, B, opt.show, (e) => (e.stop ? e.text : `${e.tool} ${e.input.command || e.input.file_path || e.input.description || ''}`)));
      }
      if (want.light) {
        const light = [
          ...ev.stops.map((e) => ({ id: `k:${e.id}`, hook: 'korean', text: e.text, input: { hook_event_name: 'Stop', session_id: `replay-${e.sid}`, last_assistant_message: e.text, stop_hook_active: false } })),
          ...ev.agents.map((e) => ({ id: `r:${e.id}`, hook: 'round', text: String(e.input.description || ''), input: { tool_name: 'Agent', session_id: `replay-${e.sid}`, cwd: e.cwd, tool_input: e.input } })),
          ...ev.handoffs.map((e) => ({ id: `h:${e.id}`, hook: 'handoff', text: String(e.input.message || '').slice(0, 60), input: { tool_name: 'SendMessage', session_id: `replay-${e.sid}`, transcript_path: e.tp, tool_input: e.input } })),
        ];
        need('한국어, 회차, 세션 넘김 점검의 사건', light.length);
        lines.push(...namesLines('한국어, 회차, 세션 넘김 점검', '사건', light, ...pair('light', light), opt.show));
      }
      lines.push(`(대화 기록 ${ev.files}개 파일에서 되살림)`);
    }
    lines.push('', ...unseenLines(want));
    console.log(lines.join('\n'));
    if (opt.keep) console.log(`임시 폴더: ${tmp}`);
    if (failed) process.exitCode = 1;
  } finally {
    if (!opt.keep) {
      // 지우기는 키트의 휴지통 스크립트를 쓴다(rm을 쓰지 않는다).
      const trash = path.join(INSTALLED, 'subagent-system', 'scripts', 'trash.js');
      if (fs.existsSync(trash)) spawnSync(process.execPath, [trash, tmp], { stdio: 'ignore', env: baseEnv() });
    }
  }
}

if (require.main === module) {
  if (process.argv[2] === '--child') childMain(process.argv[3], process.argv[4], process.argv[5], process.argv[6]);
  else main().catch((e) => { console.error((e && e.message) || e); process.exitCode = 1; });
}

module.exports = { cleanEnv, droppedChannels, wrappedHooks, unseenLines, assertRecords, namesLines, slimLine, BgTracker, parseNotes, noteStub, cutAgentFile, bgLine, SEEN_BY, UNSEEN_WHY };
