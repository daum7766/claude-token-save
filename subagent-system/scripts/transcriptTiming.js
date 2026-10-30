/**
 * 대화 기록(jsonl) 하나에서 시간이 모델, 도구, 사용자 기다림 가운데 어디에 들었는지 잰다.
 * speed-review.js가 쓴다.
 */
import fs from 'node:fs';

// 포그라운드 Bash의 최대 시간은 600초다. 여유 60초를 더한 값을 넘는 도구 호출은 도구가 아니라 사용자를 기다린 시간이 섞인 것으로 본다.
export const WAIT_CAP_SEC = 660;

// 문자열 하나의 길이 상한(약 512MB) 때문에 파일 전체를 한 번에 읽지 못하는 대화 기록이 있어, 덩어리로 읽어 줄 단위로 넘긴다.
export const CHUNK_BYTES = 64 * 1024 * 1024;

// 파일을 줄 단위 Buffer로 넘긴다. 줄바꿈 바이트(0x0A)에서만 자르므로 여러 바이트 글자가 덩어리 경계에서 깨지지 않는다.
function* fileLines(file, chunkBytes) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.allocUnsafe(chunkBytes);
    let pieces = [];
    let pos = 0;
    for (;;) {
      const n = fs.readSync(fd, buf, 0, chunkBytes, pos);
      if (n === 0) break;
      pos += n;
      const chunk = buf.subarray(0, n);
      let from = 0;
      for (;;) {
        const nl = chunk.indexOf(10, from);
        if (nl < 0) break;
        pieces.push(chunk.subarray(from, nl));
        const line = Buffer.concat(pieces);
        pieces = [];
        yield line;
        from = nl + 1;
      }
      // buf는 다음 읽기에서 덮이므로 남은 조각은 복사해 둔다.
      if (from < n) pieces.push(Buffer.from(chunk.subarray(from)));
    }
    if (pieces.length) yield Buffer.concat(pieces);
  } finally {
    fs.closeSync(fd);
  }
}

// 깨진 줄과 빈 줄은 건너뛴다.
export function* jsonlRows(file, chunkBytes = CHUNK_BYTES) {
  for (const line of fileLines(file, chunkBytes)) {
    try {
      const d = JSON.parse(line.toString('utf8'));
      if (d && typeof d === 'object') yield d;
    } catch {
      // 깨진 줄
    }
  }
}

// 줄 하나라도 패턴에 맞는지. JSON으로 읽지 않으므로 큰 파일을 거를 때 싸다.
export function fileHasLine(file, pattern, chunkBytes = CHUNK_BYTES) {
  for (const line of fileLines(file, chunkBytes)) if (pattern.test(line.toString('utf8'))) return true;
  return false;
}

// 시간 계산과 절차 찾기에 쓰는 필드만 남긴다. 도구 결과 본문과 긴 입력을 들고 있으면 GB 단위 기록이 메모리에 안 들어간다.
export function slimRow(d) {
  const c = d.message?.content;
  const content = Array.isArray(c)
    ? c.flatMap((x) => {
        if (x?.type === 'tool_use') return [{ type: 'tool_use', id: x.id, name: x.name, input: { command: x.input?.command, description: x.input?.description, file_path: x.input?.file_path } }];
        if (x?.type === 'tool_result') return [{ type: 'tool_result', tool_use_id: x.tool_use_id }];
        return [];
      })
    : '';
  const agentId = d.toolUseResult?.agentId;
  return {
    type: d.type,
    timestamp: d.timestamp,
    uuid: d.uuid,
    isMeta: d.isMeta,
    origin: d.origin?.kind ? { kind: d.origin.kind } : undefined,
    toolUseResult: typeof agentId === 'string' ? { agentId } : undefined,
    message: { id: d.message?.id, content },
  };
}

// user와 assistant 메시지 줄만 slimRow로 줄여 모은다.
export function readMessageRows(file) {
  const rows = [];
  for (const d of jsonlRows(file)) if (d.timestamp && (d.type === 'user' || d.type === 'assistant') && d.message) rows.push(slimRow(d));
  return rows;
}

const ts = (s) => new Date(s).getTime() / 1000;

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

const RUNNERS = new Set(['node', 'python', 'python3', 'deno', 'tsx', 'bash', 'sh', 'zsh']);
const PKG_RUNNERS = new Set(['npm', 'pnpm', 'yarn', 'npx']);
const unquote = (w) => w.replace(/^["']|["']$/g, '');

// 같은 종류의 명령을 한데 세는 이름. 임시 스크립트는 폴더가 매번 달라 파일 이름만 쓴다.
export function bashKey(cmd) {
  let s = cmd.trim();
  // 앞의 `cd … &&`, `cd …;`, `NAME=값;`, `NAME=값 ` 구간을 모두 뗀다.
  for (;;) {
    const next = s.replace(/^(cd\s+[^;&|]+(&&|;)\s*|[A-Za-z_][A-Za-z0-9_]*=[^\s;]*(;\s*|\s+))/, '');
    if (next === s) break;
    s = next;
  }
  const w = s.split(/\s+/).filter(Boolean);
  if (w.length === 0) return '';
  const [first, second] = w;
  if (RUNNERS.has(first) && second) {
    if (second.startsWith('-')) return `${first} ${second}`;
    return `${first} ${unquote(second).split('/').pop()}`;
  }
  if (PKG_RUNNERS.has(first) && second) {
    if (second === 'run' && w[2]) return `${first} run ${w[2]}`;
    return `${first} ${second}`;
  }
  return first;
}

// 도구 호출 하나의 기다림 신호. PreToolUse 훅이 사용자 확인(ask)을 띄운 시각이 있으면 그 시각부터 결과까지가 기다림이다.
export function analyzeTranscript(file) {
  const asks = new Map();
  const rows = [];
  for (const d of jsonlRows(file)) {
    if (!d.timestamp) continue;
    const a = d.attachment;
    if (d.type === 'attachment' && a?.hookEvent === 'PreToolUse' && a.toolUseID && /"permissionDecision":\s*"ask"/.test(a.stdout || '')) {
      if (!asks.has(a.toolUseID)) asks.set(a.toolUseID, ts(d.timestamp));
    } else if ((d.type === 'user' || d.type === 'assistant') && d.message) {
      rows.push(slimRow(d));
    }
  }
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
      if (Array.isArray(c)) for (const x of c) if (x.type === 'tool_use') uses.set(x.id, { id: x.id, name: x.name, start: t, input: x.input || {} });
    }
  }
  const ev = [...uses.values()].filter((u) => u.end !== undefined);
  for (const u of ev) {
    let toolEnd = u.end;
    const askAt = asks.get(u.id);
    if (askAt !== undefined && askAt >= u.start && askAt <= u.end) toolEnd = askAt;
    // 확인 창 표시가 안 남은 경우에도 상한을 넘는 몫은 기다림으로 본다. Agent는 오래 걸리는 것이 정상이라 상한을 두지 않는다.
    if (u.name !== 'Agent') toolEnd = Math.min(toolEnd, u.start + WAIT_CAP_SEC);
    u.toolEnd = toolEnd;
  }
  const TU = union(ev.map((u) => [u.start, u.toolEnd]));
  const WU = union(ev.filter((u) => u.end > u.toolEnd).map((u) => [u.toolEnd, u.end]));
  const BU = union([...TU, ...WU]);
  const perTurn = [...turns.values()].map(([a, b]) => outside(a, b, BU));
  const MU = union([...turns.values()]);
  const model = MU.reduce((s, [a, b]) => s + outside(a, b, BU), 0);
  const tool = measure(TU);
  const userWait = WU.reduce((s, [a, b]) => s + outside(a, b, TU), 0);
  const total = t1 - t0;

  // 겹친 도구 구간은 같은 시간대의 도구가 똑같이 나눠 가진다.
  const pts = [...new Set(ev.flatMap((u) => [u.start, u.toolEnd]))].sort((a, b) => a - b);
  const bash = new Map();
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, b] = [pts[i], pts[i + 1]];
    const act = ev.filter((u) => u.start <= a && u.toolEnd >= b);
    for (const u of act) {
      if (u.name !== 'Bash') continue;
      const k = bashKey(u.input.command || '');
      bash.set(k, (bash.get(k) || 0) + (b - a) / act.length);
    }
  }
  // 키마다 가장 오래 걸린 호출의 명령 전체를 쓴다.
  const bashSample = new Map();
  const bestSec = new Map();
  for (const u of ev) {
    if (u.name !== 'Bash') continue;
    const k = bashKey(u.input.command || '');
    const sec = u.toolEnd - u.start;
    if (!bestSec.has(k) || sec > bestSec.get(k)) {
      bestSec.set(k, sec);
      bashSample.set(k, u.input.command || '');
    }
  }
  const tests = new Map();
  let testTime = 0;
  for (const u of ev) {
    const cmd = u.input.command || '';
    if (u.name === 'Bash' && TESTRE.test(cmd) && !cmd.includes('<<')) {
      for (const m of cmd.matchAll(TESTSEG)) tests.set(norm(m[0]), (tests.get(norm(m[0])) || 0) + 1);
      testTime += u.toolEnd - u.start;
    }
  }
  const calls = ev.map((u) => ({
    name: u.name,
    label: u.input.description || '',
    at: Math.round(u.start * 1000),
    end: Math.round(u.end * 1000),
    sec: u.toolEnd - u.start,
    wait: u.end - u.toolEnd,
    cmd: u.name === 'Bash' ? u.input.command || '' : `${u.name} ${u.input.file_path || u.input.description || ''}`.trim(),
  }));
  return { total, model, tool, other: Math.max(0, total - model - tool - userWait), userWait, testTime, bash, bashSample, tests, longTurns: perTurn.filter((x) => x > 60).length, calls };
}
