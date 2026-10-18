#!/usr/bin/env node
/**
 * 메인 세션이 쓴 비용을 프로젝트별로 세고 서브에이전트 비용과 견준다.
 * 사용: node "$HOME/.claude/subagent-system/scripts/main-session-cost.js" --since <ISO 시각 또는 YYYY-MM-DD>
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { RECORDS_DIR, listSessions, readJsonl, sessionCwd, projectRoot, splitLines, printTable } from './claudeProjectPaths.js';
import { loadRates, toCounts, cost, lastLinePerRequest } from './subagent-usage.js';

const USAGE = '사용: node "$HOME/.claude/subagent-system/scripts/main-session-cost.js" --since <ISO 시각 또는 YYYY-MM-DD>';
const argv = process.argv.slice(2);
if (argv.length !== 2 || argv[0] !== '--since') {
  console.error(USAGE);
  process.exit(1);
}
// 날짜만 쓰면 Date가 UTC 자정으로 읽으므로 지역 자정으로 맞춘다.
const from = new Date(/^\d{4}-\d{2}-\d{2}$/.test(argv[1]) ? `${argv[1]}T00:00:00` : argv[1]).getTime();
if (Number.isNaN(from)) {
  console.error(USAGE);
  process.exit(1);
}
const pad = (n) => String(n).padStart(2, '0');
const d0 = new Date(from);
const fromDay = `${d0.getFullYear()}-${pad(d0.getMonth() + 1)}-${pad(d0.getDate())}`;

const { rates, error } = loadRates();
if (error) {
  console.error(`요율표를 읽지 못했습니다: ${error}`);
  process.exit(1);
}

const text = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (typeof x === 'string' ? x : x.text ?? '')).join('') : '');
const after = (o) => o.timestamp && new Date(o.timestamp).getTime() >= from;

const proj = new Map();
const get = (p) => {
  if (!proj.has(p)) proj.set(p, { main: 0, mainUnknown: 0, sub: 0, subUnknown: 0 });
  return proj.get(p);
};
const sessionStats = [];

// listSessions는 세션 파일(UUID.jsonl)만 고르므로 서브에이전트 폴더의 기록은 저절로 빠진다.
for (const s of listSessions().filter((x) => x.mtime >= from)) {
  const lines = readJsonl(s.file).filter(after);
  // 한 응답이 여러 줄에 찍히므로 서브에이전트 비용과 같은 방식으로 요청마다 마지막 줄 하나만 센다.
  const byMsg = lastLinePerRequest(lines);
  const uses = new Map();
  const toolStat = new Map();
  for (const o of lines) {
    if (o.type === 'assistant' && Array.isArray(o.message?.content)) {
      for (const x of o.message.content) if (x.type === 'tool_use') uses.set(x.id, x.name);
    }
    if (o.type === 'user' && Array.isArray(o.message?.content)) {
      for (const x of o.message.content) {
        if (x.type !== 'tool_result' || !uses.has(x.tool_use_id)) continue;
        const name = uses.get(x.tool_use_id);
        const t = toolStat.get(name) ?? { calls: 0, chars: 0 };
        t.chars += text(x.content).length;
        toolStat.set(name, t);
      }
    }
  }
  if (byMsg.length === 0) continue;
  const calls = new Map();
  for (const n of uses.values()) calls.set(n, (calls.get(n) ?? 0) + 1);
  for (const [n, c] of calls) toolStat.set(n, { calls: c, chars: toolStat.get(n)?.chars ?? 0 });
  let total = 0;
  let unknown = 0;
  for (const o of byMsg) {
    const v = cost(toCounts(o), rates);
    if (v === null) unknown++;
    else total += v;
  }
  // 세션이 시작한 프로젝트로 모은다. 서브에이전트 기록이 쓰는 판정과 같다.
  const cwd = sessionCwd(s.file);
  const p = cwd ? projectRoot(cwd) : path.basename(s.dir);
  const g = get(p);
  g.main += total;
  g.mainUnknown += unknown;
  sessionStats.push({ id: s.id, project: p, cost: total, responses: byMsg.length, toolStat });
}

// 같은 agentId는 마지막 줄이 최종이다. 비용 기록에는 날짜만 있어 날짜 단위로 자른다.
const last = new Map();
const COST_FILE = path.join(RECORDS_DIR, 'subagent-cost.tsv');
for (const l of fs.existsSync(COST_FILE) ? splitLines(fs.readFileSync(COST_FILE, 'utf8')) : []) {
  const c = l.split('\t');
  if (c[0] === '날짜' || c.length < 15) continue;
  last.set(c[3], c);
}
for (const c of last.values()) {
  if (c[0] < fromDay) continue;
  const g = get(c[1]);
  const v = Number(c[14]);
  if (c[14].startsWith('?') || !Number.isFinite(v)) g.subUnknown++;
  else g.sub += v;
}

const $ = (v) => `$${v.toFixed(2)}`;
const home = os.homedir();
const short = (p) => (p === home || p.startsWith(home + path.sep) ? `~${p.slice(home.length)}` : p);
const pct = (a, b) => (a + b > 0 ? `${Math.round((100 * a) / (a + b))}%` : '-');
console.log(`기준: ${argv[1]} 이후 (서브에이전트 비용은 ${fromDay} 날짜부터)\n`);
const rows = [['프로젝트', '메인', '서브', '메인 몫', '메인 모름(응답)', '서브 모름(건)']];
const all = { main: 0, sub: 0, mainUnknown: 0, subUnknown: 0 };
for (const [p, g] of [...proj].sort((a, b) => b[1].main + b[1].sub - (a[1].main + a[1].sub))) {
  for (const k of Object.keys(all)) all[k] += g[k];
  rows.push([short(p), $(g.main), $(g.sub), pct(g.main, g.sub), g.mainUnknown, g.subUnknown]);
}
rows.push(['합계', $(all.main), $(all.sub), pct(all.main, all.sub), all.mainUnknown, all.subUnknown]);
printTable(rows, 1);

const top = sessionStats.sort((a, b) => b.cost - a.cost).slice(0, 5);
console.log('\n메인 비용 상위 5개 세션');
printTable([['세션', '프로젝트', '비용', '응답 수'], ...top.map((s) => [s.id.slice(0, 8), short(s.project), $(s.cost), s.responses])], 2);

console.log('\n상위 5개 세션에서 메인이 직접 부른 도구(호출 수, 결과 글자 수)');
for (const s of top) {
  const list = [...s.toolStat].sort((a, b) => b[1].chars - a[1].chars).map(([n, t]) => `${n} ${t.calls}회 ${t.chars.toLocaleString('en-US')}자`);
  console.log(`  ${s.id.slice(0, 8)}: ${list.join(', ') || '도구 호출 없음'}`);
}

console.log('\n읽는 법');
console.log('  메인 몫이 크면 서브에이전트에 맡기지 않고 메인이 직접 한 일이 많다는 뜻이다. 상위 세션의 도구 줄에서 Read, Grep, Edit, Write, Bash의 호출 수와 결과 글자가 크면 그 일을 맡길 수 있었는지 본다.');
console.log('  Agent 호출 수와 결과 글자가 큰 세션은 서브에이전트 보고가 길어 메인 문맥을 불리는 것이니 보고 분량을 줄일 수 있는지 본다.');
console.log('  모름 건수는 요율표에 없는 모델이라 비용에서 빠졌으니, 크면 rates.json에 모델을 넣는다.');
