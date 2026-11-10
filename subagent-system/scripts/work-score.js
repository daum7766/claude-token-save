/**
 * 일하는 방식의 한 구간을 같은 숫자로 재는 셈(work-metrics.js의 `score`와 `exp`가 쓴다).
 * 대화 기록(설정 폴더의 projects 아래 *.jsonl)에서 사람 말, 훅 되돌림, 재지시, 대표 지적, 메인 토큰을 센다.
 * 왜: 일하는 방식을 바꿀 때마다 전후를 같은 숫자로 재야 남길지 되돌릴지 가를 수 있다. 숫자 정의가 바뀌면 전후를 견줄 수 없으니 이 파일 한 곳에 둔다.
 * 전제:
 *  - 사람 말은 메인 대화의 user 기록 가운데 origin.kind가 human인 것이다(origin이 없는 옛 꼴은 감싸개 글이 아닌 글). 다른 세션 메시지와 작업 알림은 뺀다.
 *  - Stop 막음은 user 문자열 「Stop hook feedback:」로, PreToolUse 막음은 tool_result 「PreToolUse:<도구> hook error:」로 남는다.
 *    한 Stop 막음에 갈래가 여럿 붙으면 갈래마다 한 번씩 세고, 「되돌림 수」는 막음 사건 수다(갈래 합은 따로 낸다).
 *  - 같은 uuid가 여러 파일에 있으면 한 번만 센다.
 *  - 대표 지적은 낱말 거르기 어림이라 실제 지적과 다를 수 있다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CLAUDE_DIR, PROJECTS_ROOT, CONFIG_FILE, RECORDS_DIR, projectRoot, sessionCwd, splitLines } from './claudeProjectPaths.js';
import { lastLinePerRequest } from './subagent-usage.js';

// Stop 막음 갈래: [이름, 본문 안 머리말]
const STOP_LABELS = [
  ['보내기 전 점검', '보내기 전 점검'],
  ['올릴 것 칸', '올릴 것 칸'],
  ['보인 어색함', '보인 어색함'],
  ['확인 안 한 단정', '확인 안 한 단정'],
  ['한꺼번에 정하기', '한꺼번에 정하기'],
  ['결정 대조', '결정 대조'],
  ['검토 중', '검토 중'],
  ['미룬 일 기록', '미룬 일 기록'],
  ['결정 알림', '결정 알림'],
  ['결과 늦음', '결과 늦음'],
  ['오래된 결과', '오래된 결과'],
  ['멈춘 듯', '멈춘 듯'],
  ['실무자 기다림', '실무자 기다림'],
  ['예약 정리', '예약 정리'],
  ['이어 하기', '이어 하기'],
  ['결정 대기 표시', '결정 대기 표시'],
  ['열린 칸 대조', '열린 칸 대조'],
  ['남은 일 수', '남은 일 수'],
  ['패널 확인(걷음)', '패널 확인'],
  ['패널 답(걷음)', '패널 답'],
  ['정할 것 패널(걷음)', '정할 것 패널'],
  ['한국어로 다시', '한국어로 다시 써라'],
];
// PreToolUse 막음 갈래: [이름, 본문 머리 정규식]
const PRE_LABELS = [
  ['지시문 고쳐라', /^서브에이전트 지시문을 보내기 전에 고쳐라/],
  ['세션 넘김 고쳐라', /^세션 넘김 메시지를 보내기 전에 고쳐라/],
  ['회차 일 고쳐라', /^회차 일을 보내기 전에 고쳐라/],
  ['논의 중', /^논의 중:/],
  ['물음 확인', /^물음 확인:/],
  ['결정 대조(Pre)', /^결정 대조:/],
  ['선택지 점검(Pre)', /^보내기 전 점검:/],
  ['되고침 신호', /^되고침 신호:/],
  ['휴지통 지우기', /^(휴지통으로 옮기는 설정|삭제 대상을 미리 알 수 없습니다)/],
  ['판정 통과 없는 그림', /^판정 통과 기록이 없는 그림/],
  ['메모리 고쳐라', /^메모리(를 쓰기 전에| 파일)/],
];

// 감싸개로 시작하는 글은 사람 말이 아니다(origin이 없는 옛 기록용).
const WRAP = /^(<command-|<local-command|<task-notification|<artifact-content|Another Claude session|\[Request interrupted|Stop hook feedback|<system-reminder|Caveat:)/;
// 대표 지적 꼴(어림): 아니, 왜, 안 했, 빠졌 같은 낱말.
export const CRITIQUE = /아니|왜|안 ?했|빠졌|빠뜨|틀렸|잘못|안 ?됐|안 ?돼|놓쳤/;
// 메인이 실무자에게 다시 보낸 말 가운데 고치라는 꼴.
export const RESEND = /(고쳐|다시 (만들|그려|찍|돌려|해)|빠졌|빠뜨|어긋|규칙(을|에| 위반)|틀렸|잘못|맞춰|따르지|안 따|놓쳤|지적)/;

function textOf(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c) && !c.some((x) => x.type === 'tool_result')) return c.filter((x) => x.type === 'text').map((x) => x.text).join('');
  return null;
}

// 결과 늦음, 오래된 결과 막음은 실무자 끝 글을 붙여 오므로 그 몫을 걷어 따온 글 속 머리말을 세지 않는다.
function stripQuoted(body) {
  return body.replace(/\n\[[^\]\n]+\]\n[\s\S]*?(?=\n\n\[[^\]\n]+\]\n| (멈춘 듯|실무자 기다림|예약 정리|이어 하기|결정 대기 표시|열린 칸 대조|남은 일 수): |$)/g, '\n')
    .replace(/(패널 답: [^\n]*\n)(- [^\n]*\n?)+/g, '$1');
}

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// 일 종류 풀이: 설정 config.json의 scoreKinds({ "<일 종류>": "<정규식>" })가 있으면 그것으로, 없으면 사용 기록의 일 종류 이름을 낱말로 쪼개 설명과 겹치는 정도로 고른다.
export function kindMatcher({ config = readJsonSafe(CONFIG_FILE), usageFile = path.join(RECORDS_DIR, 'subagent-usage.tsv') } = {}) {
  const custom = config && typeof config.scoreKinds === 'object' && config.scoreKinds ? Object.entries(config.scoreKinds).flatMap(([k, re]) => {
    try {
      return [[k, new RegExp(re, 'i')]];
    } catch {
      return [];
    }
  }) : [];
  let names = [];
  if (!custom.length && fs.existsSync(usageFile)) {
    const counts = new Map();
    for (const l of splitLines(fs.readFileSync(usageFile, 'utf8'))) {
      const k = l.split('\t')[3];
      if (k && !/^\[/.test(k)) counts.set(k, (counts.get(k) || 0) + 1);
    }
    // 한두 번 쓴 일 이름은 잡음이라 5번 넘게 쓴 이름만 쓴다.
    names = [...counts].filter(([, n]) => n >= 5).map(([k]) => k).map((k) => [k, k.split(/[\s·]+|와|과/).filter((w) => w.length >= 2)]);
  }
  return (desc) => {
    if (!desc) return null;
    for (const [k, re] of custom) if (re.test(desc)) return k;
    let best = null;
    let bestScore = 0;
    for (const [k, words] of names) {
      const s = words.reduce((a, w) => a + (desc.includes(w) ? w.length : 0), 0);
      if (s > bestScore) { best = k; bestScore = s; }
    }
    return best;
  };
}

// 일하는 방식 자체를 고치는 폴더(설정 폴더와 키트 원본)에서 한 일은 따로 묶는다.
export function methodDirs(config = readJsonSafe(CONFIG_FILE)) {
  const dirs = [CLAUDE_DIR];
  if (typeof config?.kitSourcePath === 'string' && config.kitSourcePath.trim()) dirs.push(config.kitSourcePath.trim());
  return dirs;
}

function walk(dir, sinceMs, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, sinceMs, out);
    else if (e.name.endsWith('.jsonl')) {
      try {
        if (fs.statSync(p).mtimeMs >= sinceMs) out.push(p);
      } catch { /* 사라짐 */ }
    }
  }
  return out;
}

const bump = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };

/**
 * since, until은 밀리초. project를 주면 그 프로젝트(워크트리 포함)의 기록만 센다.
 * 돌려주는 값은 숫자만 든 객체다(찍는 꼴은 formatScore).
 */
export function score({ since, until = Number.POSITIVE_INFINITY, project = null, root = PROJECTS_ROOT, config = readJsonSafe(CONFIG_FILE), kindOf = kindMatcher({ config }) } = {}) {
  const wantProject = project ? projectRoot(project) : null;
  const mdirs = methodDirs(config);
  const projectKind = (cwd) => (cwd && mdirs.some((d) => cwd === d || cwd.startsWith(`${d}/`)) ? '일하는 방식' : null);
  const seen = new Set();
  const res = {
    since, until, human: 0, humanByKind: {}, critique: 0, mainEvents: 0, subEvents: 0, byLabel: {}, byKind: {},
    resendSent: 0, resend: 0, mainTokens: 0, mainRequests: 0,
  };
  const tokenSeen = new Set();
  for (const f of walk(root, since)) {
    const sub = f.includes(`${path.sep}subagents${path.sep}`);
    if (wantProject) {
      const cwd = sessionCwd(f);
      if (!cwd || projectRoot(cwd) !== wantProject) continue;
    }
    let subKind = null;
    if (sub) {
      const meta = readJsonSafe(f.replace(/\.jsonl$/, '.meta.json'));
      subKind = kindOf(meta?.description) || kindOf(meta?.agentType);
    }
    let lastAgentKind = null;
    let cwd = null;
    const toolInfo = {};
    const assistants = [];
    const label = (who, name, kind) => {
      (res.byLabel[name] ??= { main: 0, sub: 0 })[who]++;
      bump((res.byKind[kind] ??= {}), name);
    };
    for (const line of splitLines(fs.readFileSync(f, 'utf8'))) {
      if (!line) continue;
      let j;
      try { j = JSON.parse(line); } catch { continue; }
      if (j.cwd) cwd = j.cwd;
      const t = Date.parse(j.timestamp || 0);
      const inWindow = t >= since && t < until;
      if (j.type === 'assistant' && Array.isArray(j.message?.content)) {
        for (const x of j.message.content) {
          if (x.type !== 'tool_use') continue;
          const d = x.name === 'Agent' ? (x.input?.description || '') : '';
          toolInfo[x.id] = { kind: kindOf(d) };
          if (x.name === 'Agent' && kindOf(d)) lastAgentKind = kindOf(d);
          if (!sub && inWindow && x.name === 'SendMessage' && !seen.has(`t:${x.id}`)) {
            seen.add(`t:${x.id}`);
            const to = String(x.input?.to || '');
            const m = String(x.input?.message || x.input?.content || x.input?.text || '');
            if (/^[a-z]/.test(to) && !/session/i.test(to) && !/^(Another|<)/.test(m)) {
              res.resendSent++;
              if (RESEND.test(m)) res.resend++;
            }
          }
        }
        if (!sub && inWindow) assistants.push(j);
      }
      if (j.type !== 'user' || !inWindow) continue;
      const key = `${sub ? 's' : 'm'}:${j.uuid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const ctxKind = (sub ? subKind : null) || projectKind(cwd) || lastAgentKind || '대화와 기타';
      const c = j.message?.content;
      const txt = j.isMeta ? null : textOf(c);
      if (!sub && txt != null && (j.origin?.kind === 'human' || (!j.origin && !WRAP.test(txt)))) {
        res.human++;
        bump(res.humanByKind, ctxKind);
        if (CRITIQUE.test(txt)) res.critique++;
      }
      const who = sub ? 'sub' : 'main';
      if (typeof c === 'string' && c.startsWith('Stop hook feedback:')) {
        res[`${who}Events`]++;
        const body = stripQuoted(c.slice('Stop hook feedback:'.length));
        let hit = false;
        for (const [name, head] of STOP_LABELS) {
          if (new RegExp(`(^|[\\s.])${head}(:| |\\.)`).test(body)) { label(who, name, ctxKind); hit = true; }
        }
        if (!hit) label(who, '(Stop 갈래 모름)', ctxKind);
      }
      if (Array.isArray(c)) {
        for (const x of c) {
          if (x.type !== 'tool_result') continue;
          const s = typeof x.content === 'string' ? x.content : Array.isArray(x.content) ? x.content.map((y) => y.text || '').join('') : '';
          const m = s.match(/^PreToolUse:(\w+) hook error: ?(?:\[command hook \d+\]: )?/);
          if (!m) continue;
          res[`${who}Events`]++;
          const body = s.slice(m[0].length);
          const kind = (sub ? subKind : null) || projectKind(cwd) || toolInfo[x.tool_use_id]?.kind || lastAgentKind || '대화와 기타';
          const L = PRE_LABELS.find(([, re]) => re.test(body));
          label(who, L ? L[0] : `(Pre 갈래 모름: ${m[1]})`, kind);
        }
      }
    }
    // 메인 토큰: 요청마다 마지막 줄의 입력, 캐시 쓰기, 캐시 읽기, 출력 합. 같은 요청이 다른 파일에 또 있어도 한 번만 센다.
    for (const o of lastLinePerRequest(assistants)) {
      const k = o.requestId || o.message.id || o.uuid;
      if (tokenSeen.has(k)) continue;
      tokenSeen.add(k);
      const u = o.message.usage;
      res.mainTokens += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.output_tokens ?? 0);
      res.mainRequests++;
    }
  }
  const per = (n) => (res.human ? n / res.human : null);
  res.labelSumMain = Object.values(res.byLabel).reduce((a, v) => a + v.main, 0);
  res.labelSumSub = Object.values(res.byLabel).reduce((a, v) => a + v.sub, 0);
  res.mainPerHuman = per(res.mainEvents);
  res.critiquePerHuman = per(res.critique);
  res.resendPerHuman = per(res.resend);
  res.tokensPerHuman = per(res.mainTokens);
  return res;
}

const fix2 = (v) => (v === null ? '-' : v.toFixed(2));
const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : '지금');

export function formatScore(r) {
  const out = [];
  const p = (s = '') => out.push(s);
  p(`기간: ${iso(r.since)} ~ ${Number.isFinite(r.until) ? iso(r.until) : '지금'}`);
  p(`사람 말(메인 대화): ${r.human}${r.human < 20 ? '  (20 아래라 표본이 작음)' : ''}`);
  p(`메인 되돌림: ${r.mainEvents}건, 사람 말당 ${fix2(r.mainPerHuman)}  (갈래 합 ${r.labelSumMain})`);
  p(`실무자 되돌림: ${r.subEvents}건  (갈래 합 ${r.labelSumSub})`);
  p(`재지시: ${r.resend}건 (메인이 실무자에게 보낸 말 ${r.resendSent}건 가운데 고치라는 꼴), 사람 말당 ${fix2(r.resendPerHuman)}`);
  p(`대표 지적: ${r.critique}건, 사람 말당 ${fix2(r.critiquePerHuman)}  (낱말 거르기 어림이라 실제와 다를 수 있음)`);
  p(`메인 토큰: ${r.mainTokens} (요청 ${r.mainRequests}건), 사람 말당 ${r.tokensPerHuman === null ? '-' : Math.round(r.tokensPerHuman)}`);
  p();
  p('## 갈래별(메인 | 실무자 | 메인 말당)');
  for (const [k, v] of Object.entries(r.byLabel).sort((a, b) => b[1].main + b[1].sub - (a[1].main + a[1].sub))) {
    p(`${String(v.main).padStart(4)} | ${String(v.sub).padStart(3)} | ${fix2(r.human ? v.main / r.human : null)}  ${k}`);
  }
  p();
  p('## 일 종류별(사람 말, 되돌림 갈래 합)');
  const kinds = new Set([...Object.keys(r.humanByKind), ...Object.keys(r.byKind)]);
  const sumOf = (k) => Object.values(r.byKind[k] || {}).reduce((a, b) => a + b, 0);
  for (const k of [...kinds].sort((a, b) => sumOf(b) - sumOf(a))) {
    const top = Object.entries(r.byKind[k] || {}).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([l, n]) => `${l} ${n}`).join(', ');
    p(`- ${k}: 사람 말 ${r.humanByKind[k] || 0}, 되돌림 ${sumOf(k)}${top ? ` (${top})` : ''}`);
  }
  return out.join('\n');
}
