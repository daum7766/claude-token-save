#!/usr/bin/env node
/**
 * 막는 훅(PreToolUse)을 켜거나 고치기 전에, 지난 대화 기록의 실제 도구 호출에 되돌려 돌려 보고
 * 무엇을 몇 번 막았을지 보인다. 막을 것만 막고 정상 호출을 막지 않는지(오탐) 켜기 전에 재려는 것이다.
 *
 * 쓰는 법:
 *   node hook-replay.js --hook <훅 파일> [--tool Agent,Bash] [--limit 300] [--project <폴더>] [--show 5]
 *     --hook     되돌려 볼 훅 파일(.js는 node, .py는 python3로 돌린다)
 *     --tool     되돌려 볼 도구 이름, 쉼표로 여럿(기본 Agent)
 *     --limit    가장 최근 호출 몇 개를 볼지(기본 300)
 *     --project  이 폴더에서 연 세션만 본다(기본 전부)
 *     --show     막은 것 가운데 보일 견본 수(기본 5)
 *     --base     바꾸기 전 훅 파일. 주면 새로 막는 것과 더는 막지 않는 것만 견준다(예: git show HEAD~1:<경로> > 사본)
 * 전제: 훅은 표준 입력으로 받은 호출 하나만 보고 판정하고 파일을 쓰지 않는다. 기록을 남기는 훅(ask-log 등)은 되돌려 보지 않는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PROJECTS_ROOT, projectRoot, splitLines } from './claudeProjectPaths.js';

function parseArgs(argv) {
  const o = { tool: 'Agent', limit: 300, show: 5 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '');
    if (['hook', 'tool', 'limit', 'project', 'show', 'base'].includes(k)) o[k] = argv[++i];
    else if (k === 'help' || k === 'h') o.help = true;
  }
  o.limit = Number(o.limit);
  o.show = Number(o.show);
  return o;
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}

// 대화 기록에서 도구 호출을 최근 것부터 모은다.
export function collectCalls(root, tools, limit, project) {
  const files = walk(root).map((f) => ({ f, t: fs.statSync(f).mtimeMs })).sort((a, b) => b.t - a.t);
  const calls = [];
  for (const { f } of files) {
    const found = [];
    for (const line of splitLines(fs.readFileSync(f, 'utf8'))) {
      if (!line.includes('"tool_use"')) continue;
      let d;
      try { d = JSON.parse(line); } catch { continue; }
      if (project && (!d.cwd || projectRoot(d.cwd) !== project)) continue;
      for (const c of d.message?.content ?? []) {
        if (c?.type === 'tool_use' && tools.includes(c.name)) found.push({ ts: d.timestamp ?? '', cwd: d.cwd ?? '', tool: c.name, input: c.input ?? {} });
      }
    }
    calls.push(...found);
    if (calls.length >= limit * 2) break;
  }
  return calls.sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, limit);
}

// 훅을 한 번 돌려 막았는지와 그 까닭 첫 줄을 돌려준다.
export function runHook(hook, call) {
  const cmd = hook.endsWith('.py') ? 'python3' : 'node';
  const stdin = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: call.tool, tool_input: call.input, cwd: call.cwd });
  const r = spawnSync(cmd, [hook], { input: stdin, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: call.cwd || process.cwd(), HOOK_REPLAY: '1' }, timeout: 20000 });
  let decision = null;
  let reason = '';
  try {
    const out = JSON.parse(r.stdout || 'null');
    decision = out?.hookSpecificOutput?.permissionDecision ?? (out?.decision === 'block' ? 'deny' : null);
    reason = out?.hookSpecificOutput?.permissionDecisionReason ?? out?.reason ?? '';
  } catch { /* 출력이 JSON이 아니면 종료 코드로 본다 */ }
  if (!decision && r.status === 2) { decision = 'deny'; reason = r.stderr || ''; }
  const first = reason.split('\n').map((l) => l.replace(/^[-\s]+/, '')).find((l) => l && !/^서브에이전트 지시문을 보내기 전에/.test(l)) ?? '';
  return { blocked: decision === 'deny' || decision === 'ask', decision, reason: first.slice(0, 120) };
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help || !o.hook) {
    console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(2, 15).map((l) => l.replace(/^ \*\s?/, '')).join('\n'));
    process.exit(o.help ? 0 : 1);
  }
  const hook = path.resolve(o.hook);
  const base = o.base && path.resolve(o.base);
  const calls = collectCalls(PROJECTS_ROOT, o.tool.split(','), o.limit, o.project && path.resolve(o.project));
  const hits = [];
  const freed = [];
  for (const c of calls) {
    const r = runHook(hook, c);
    const b = base ? runHook(base, c) : { blocked: false };
    if (r.blocked && !b.blocked) hits.push({ ...c, ...r });
    if (base && b.blocked && !r.blocked) freed.push({ ...c, ...b });
  }
  const what = base ? '바꾼 뒤 새로 막음' : '막음';
  console.log(`되돌려 본 호출 ${calls.length}개 가운데 ${what} ${hits.length}개 (${calls.length ? Math.round((hits.length / calls.length) * 100) : 0}%)${base ? `, 더는 막지 않음 ${freed.length}개` : ''}`);
  const byReason = new Map();
  for (const h of hits) byReason.set(h.reason, (byReason.get(h.reason) ?? 0) + 1);
  for (const [reason, n] of [...byReason].sort((a, b) => b[1] - a[1])) console.log(`  ${n}건  ${reason}`);
  const sample = (list, title) => {
    if (!list.length) return;
    console.log(`\n${title}`);
    for (const h of list.slice(0, o.show)) {
      const label = h.input.description ?? h.input.command ?? '';
      console.log(`- ${h.ts.slice(0, 16)} ${h.tool} 「${String(label).slice(0, 60)}」: ${h.reason.slice(0, 80)}`);
    }
  };
  sample(hits, '견본(막은 것이 정말 막을 것인지 하나씩 본다):');
  sample(freed, '더는 막지 않는 견본(놓치면 안 될 것이 풀리지 않았는지 본다):');
  console.log('\n알아 둘 것: 사용 기록이나 표처럼 지금 상태를 읽는 검사는 옛 호출도 지금 상태로 판정한다.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) main();
