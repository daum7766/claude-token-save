#!/usr/bin/env node
/**
 * 서브에이전트가 걸린 시간이 모델 생각, 도구 실행, 그 밖 중 어디에 드는지 일 종류별로 쪼갠다.
 * 사용: node "$HOME/.claude/subagent-system/scripts/agent-time-breakdown.js" --since <ISO 시각 또는 YYYY-MM-DD> [--top 3] [--kind "<일 종류>"]
 */
import fs from 'node:fs';
import path from 'node:path';
import { RECORDS_DIR, PROJECTS_ROOT, readJsonl, splitLines } from './claudeProjectPaths.js';
import { stripAnnex } from './subagentRetroHelpers.js';

const USAGE = '사용: node "$HOME/.claude/subagent-system/scripts/agent-time-breakdown.js" --since <ISO 시각 또는 YYYY-MM-DD> [--top 3] [--kind "<일 종류>"]';

function parseArgs(argv) {
  const o = { since: null, top: 3, kind: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--since') o.since = argv[++i];
    else if (argv[i] === '--top') o.top = Number(argv[++i]);
    else if (argv[i] === '--kind') o.kind = argv[++i];
    else return null;
  }
  if (!o.since && !o.kind) return null;
  if (!Number.isInteger(o.top) || o.top < 1) return null;
  let from = 0;
  if (o.since) {
    // 날짜만 쓰면 Date가 UTC 자정으로 읽으므로 지역 자정으로 맞춘다.
    from = new Date(/^\d{4}-\d{2}-\d{2}$/.test(o.since) ? `${o.since}T00:00:00` : o.since).getTime();
    if (Number.isNaN(from)) return null;
  }
  return { ...o, from };
}

const opts = parseArgs(process.argv.slice(2));
if (!opts) {
  console.error(USAGE);
  process.exit(1);
}

const ts = (s) => new Date(s).getTime() / 1000;
const localDay = (ms) => {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// 사용 기록에는 날짜만 있어 시각으로 거를 수 없다. 날짜 단위로 자른다.
const fromDay = opts.since ? localDay(opts.from) : '0000-00-00';
const USAGE_FILE = path.join(RECORDS_DIR, 'subagent-usage.tsv');
if (!fs.existsSync(USAGE_FILE)) {
  console.error(`사용 기록이 없습니다: ${USAGE_FILE}`);
  process.exit(1);
}
const usage = splitLines(fs.readFileSync(USAGE_FILE, 'utf8'))
  .map((l) => l.split('\t'))
  .filter((c) => c.length >= 9 && c[0] !== '회고' && c[0] !== '미룸' && /^\d{4}-/.test(c[0]) && c[0] >= fromDay)
  // 회고처럼 일 종류 끝의 괄호 부연은 떼고 묶는다.
  .filter((c) => !opts.kind || stripAnnex(c[3]) === stripAnnex(opts.kind))
  .map((c, i) => ({ def: c[2], kind: stripAnnex(c[3]), sec: c[6] !== '-' && c[6] !== '' && Number.isFinite(Number(c[6])) ? Number(c[6]) : null, agentId: (c[8] || '').split(/\s+/)[0] || `행${i}` }));

// agentId로 대화 기록을 찾기 위해 모든 프로젝트의 서브에이전트 폴더를 한 번 훑는다.
const index = new Map();
for (const proj of fs.existsSync(PROJECTS_ROOT) ? fs.readdirSync(PROJECTS_ROOT) : []) {
  const pdir = path.join(PROJECTS_ROOT, proj);
  let sessions;
  try { sessions = fs.readdirSync(pdir); } catch { continue; }
  for (const s of sessions) {
    const sub = path.join(pdir, s, 'subagents');
    let files;
    try { files = fs.readdirSync(sub); } catch { continue; }
    for (const f of files) {
      const m = f.match(/^agent-(.+)\.jsonl$/);
      if (m) index.set(m[1], path.join(sub, f));
    }
  }
}

const groups = new Map();
for (const u of usage) {
  const k = `${u.def}\t${u.kind}`;
  if (!groups.has(k)) groups.set(k, { def: u.def, kind: u.kind, rows: [] });
  groups.get(k).rows.push(u);
}
// 재지시한 에이전트는 줄마다 그 구간의 초가 적히므로 같은 agentId의 초를 더해 한 에이전트의 초로 쓴다.
// 일 종류를 지정하면 기록이 한 건뿐이어도 본다.
const minAgents = opts.kind ? 1 : 2;
for (const g of groups.values()) {
  const secs = new Map();
  for (const r of g.rows) {
    // 초를 적지 않은 줄(-)만 있는 에이전트는 평균에서 뺀다.
    secs.set(r.agentId, r.sec === null ? secs.get(r.agentId) ?? null : (secs.get(r.agentId) ?? 0) + r.sec);
  }
  g.agents = secs.size;
  const timed = [...secs.values()].filter((v) => v !== null);
  g.avg = timed.length ? timed.reduce((s, v) => s + v, 0) / timed.length : 0;
}
const picked = [...groups.values()]
  .filter((g) => g.agents >= minAgents)
  .sort((a, b) => b.avg - a.avg)
  .slice(0, opts.top);

const union = (iv) => {
  const s = [...iv].sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [a, b] of s) {
    if (out.length && a <= out.at(-1)[1]) out.at(-1)[1] = Math.max(out.at(-1)[1], b);
    else out.push([a, b]);
  }
  return out;
};
const measure = (u) => u.reduce((s, [a, b]) => s + (b - a), 0);
// 구간 [a,b] 가운데 union v와 겹치지 않는 길이.
const outside = (a, b, v) => {
  let cur = a;
  let r = 0;
  for (const [c, d] of v) {
    if (d <= cur || c >= b) continue;
    if (c > cur) r += c - cur;
    cur = Math.max(cur, d);
    if (cur >= b) break;
  }
  return cur < b ? r + b - cur : r;
};

const TESTRE = /(npm (run )?test|vitest|playwright|jest|pytest|node --test|npm run e2e|npx tsc|npm run build)/;
const TESTSEG = /(npx vitest[^;&|>]*|npm (?:run )?test[^;&|>]*|npx playwright[^;&|>]*|npm run e2e[^;&|>]*|node --test[^;&|>]*|pytest[^;&|>]*|npm run build[^;&|>]*|npx tsc[^;&|>]*)/g;
const norm = (c) => c.trim().replace(/\s+/g, ' ').slice(0, 80);
// 앞의 cd 구간을 떼고 첫 두 단어로 묶어 같은 종류의 명령을 한데 센다.
const bashKey = (cmd) => cmd.trim().replace(/^(cd [^;&|]+(&&|;)\s*)/, '').split(/\s+/).slice(0, 2).join(' ');

function analyze(file) {
  const rows = readJsonl(file).filter((d) => (d.type === 'user' || d.type === 'assistant') && d.timestamp && d.message);
  if (rows.length === 0) return null;
  const t0 = ts(rows[0].timestamp);
  const t1 = ts(rows.at(-1).timestamp);
  let lastUser = t0;
  const turns = new Map();
  const uses = new Map();
  for (const r of rows) {
    const t = ts(r.timestamp);
    const c = r.message.content;
    if (r.type === 'user') {
      lastUser = t;
      if (Array.isArray(c)) {
        for (const x of c) {
          if (x.type === 'tool_result' && uses.has(x.tool_use_id) && uses.get(x.tool_use_id).end === undefined) uses.get(x.tool_use_id).end = t;
        }
      }
    } else {
      const mid = r.message.id || r.uuid;
      if (!turns.has(mid)) turns.set(mid, [lastUser, t]);
      turns.get(mid)[1] = t;
      if (Array.isArray(c)) for (const x of c) if (x.type === 'tool_use') uses.set(x.id, { name: x.name, start: t, input: x.input || {} });
    }
  }
  const ev = [...uses.values()].filter((u) => u.end !== undefined);
  const TU = union(ev.map((u) => [u.start, u.end]));
  const perTurn = [...turns.values()].map(([a, b]) => outside(a, b, TU));
  const MU = union([...turns.values()]);
  const model = MU.reduce((s, [a, b]) => s + outside(a, b, TU), 0);
  const tool = measure(TU);

  // 겹친 도구 구간은 같은 시간대의 도구가 똑같이 나눠 가진다.
  const pts = [...new Set(ev.flatMap((u) => [u.start, u.end]))].sort((a, b) => a - b);
  const bash = new Map();
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, b] = [pts[i], pts[i + 1]];
    const act = ev.filter((u) => u.start <= a && u.end >= b);
    for (const u of act) if (u.name === 'Bash') bash.set(bashKey(u.input.command || ''), (bash.get(bashKey(u.input.command || '')) || 0) + (b - a) / act.length);
  }
  const tests = new Map();
  let testTime = 0;
  for (const u of ev) {
    const cmd = u.input.command || '';
    if (u.name === 'Bash' && TESTRE.test(cmd) && !cmd.includes('<<')) {
      for (const m of cmd.matchAll(TESTSEG)) tests.set(norm(m[0]), (tests.get(norm(m[0])) || 0) + 1);
      testTime += u.end - u.start;
    }
  }
  return { total: t1 - t0, model, tool, testTime, bash, tests, longTurns: perTurn.filter((x) => x > 60).length };
}

const pct = (a, b) => (b > 0 ? `${Math.round((100 * a) / b)}%` : '0%');
const min = (s) => (s / 60).toFixed(1);

console.log(`기준: ${opts.since ?? '전체'} 이후${opts.kind ? `, 일 종류 "${opts.kind}"` : ''}. 사용 기록 ${usage.length}줄, ${minAgents}건 이상 묶음 ${[...groups.values()].filter((g) => g.agents >= minAgents).length}개 중 평균 초가 긴 ${picked.length}개\n`);
if (picked.length === 0) console.log('조건에 맞는 묶음이 없습니다.');

for (const g of picked) {
  const ids = [...new Set(g.rows.map((r) => r.agentId))];
  const found = [];
  let missing = 0;
  for (const id of ids) {
    const file = index.get(id);
    const a = file ? analyze(file) : null;
    if (a) found.push({ id, ...a });
    else missing++;
  }
  console.log(`== ${g.def} / ${g.kind}`);
  console.log(`  건수 ${g.agents}, 평균 ${min(g.avg)}분, 대화 기록 분석 ${found.length}건, 기록 없음 ${missing}건`);
  if (found.length === 0) {
    console.log('');
    continue;
  }
  const sum = (k) => found.reduce((s, a) => s + a[k], 0);
  const total = sum('total');
  const model = sum('model');
  const tool = sum('tool');
  const testTime = sum('testTime');
  console.log(`  합 ${min(total)}분: 모델 ${min(model)}분 (${pct(model, total)}), 도구 ${min(tool)}분 (${pct(tool, total)}), 그 밖 ${min(total - model - tool)}분 (${pct(total - model - tool, total)})`);
  console.log(`  도구 중 테스트 실행 ${min(testTime)}분 (${pct(testTime, tool)})`);
  const bash = new Map();
  for (const a of found) for (const [k, v] of a.bash) bash.set(k, (bash.get(k) || 0) + v);
  const top = [...bash].sort((a, b) => b[1] - a[1]).slice(0, 3);
  console.log(`  시간이 큰 Bash 명령: ${top.map(([k, v]) => `"${k.slice(0, 40)}" ${min(v)}분`).join(', ') || '없음'}`);
  const rep = found
    .map((a) => ({ id: a.id, n: [...a.tests.values()].reduce((s, c) => s + Math.max(0, c - 1), 0), cmd: [...a.tests].sort((x, y) => y[1] - x[1])[0] }))
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 3);
  console.log(`  같은 테스트 명령을 되풀이한 횟수 상위: ${rep.map((r) => `${r.id.slice(0, 8)} ${r.n}회 ("${r.cmd[0].slice(0, 30)}" ${r.cmd[1]}번)`).join(', ') || '없음'}`);
  console.log(`  한 차례 모델 시간이 60초 넘는 차례: ${sum('longTurns')}번`);
  console.log('');
}

console.log('읽는 법');
console.log('  모델 비율이 크면 지시 범위나 effort를 줄여 생각 시간을 덜고, 도구 비율이 크면 위 Bash 명령 줄과 테스트 몫을 본다.');
console.log('  테스트 몫이 크고 되풀이가 많으면 전체 대신 바뀐 파일만 돌리게 하고, 그 밖 비율이 크면 메인 메시지나 기다림이 낀 것이다.');
console.log('  60초 넘는 차례가 많으면 한 번에 긴 글이나 파일을 쓰는 단계라 쪼갤 수 있는지 본다.');
