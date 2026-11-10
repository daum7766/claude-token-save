/**
 * 일하는 방식 장치(훅, 훅 안의 판정, 커밋 훅, 스킬, 정의, 부품) 전체의 쓰임 셈. work-metrics.js devices가 부른다.
 * 무엇을: 장치 목록을 등록(settings.json, 깐 상태 기록의 커밋 훅)과 파일(설정 폴더, 키트 원본)에서 뽑고, 장치마다
 *   막음(기록), 막음(대화 기록), 헛막음 후보, 막힌 뒤 다른 입력으로 낸 수, 알림, 승인 창, 고친 횟수, 마지막 쓰인 날을 센다.
 * 왜: 장치는 지적마다 하나씩 늘어나는데, 쓰임과 헛막음을 장치 전체로 한 번에 보는 셈이 없어 걷을 후보를 손으로 모았다(11-10 대표 「걷을후보 정리해보자」).
 *   목록을 등록과 파일에서 뽑아 장치가 늘거나 줄어도 이 파일을 고치지 않게 한다.
 * 전제:
 *  - 판정 이름은 훅 원본에서 뽑는다: named(…, ['이름']) 글자, `접두 ${…}` 꼴의 접두(멈춤 검사, 지시문 점검), 이름을 사유 머리(「이름: 」)에서 따는 훅의 머리 글자.
 *    기록에만 있고 원본에 없는 이름은 「기록에만 있는 이름」으로 따로 찍는다(옛 이름, 걷은 판정).
 *  - 대화 기록의 막음은 PreToolUse 훅 오류 결과, Stop hook feedback, git commit이 커밋 훅 글로 실패한 Bash 결과다. 어느 장치의 글인지는
 *    그 장치 원본의 글자 조각이 사유에 몇 개 들었나로 가른다(같은 도구에 걸린 장치끼리만 견줌). 못 가른 막음은 「주인 못 가름」으로 센다.
 *  - 도구 막음의 헛막음 후보는 막힌 호출과 입력이 같은 호출을 그 뒤에 다시 내 막히지 않은 것이다. Stop 막음은 훅이 적은 hook-false-positive.tsv의 「통과」 줄이다.
 *  - 대화 기록은 21GB를 넘을 수 있어 막음 글이 든 파일만 rg로 골라 읽는다. rg가 없으면 기간 안 파일을 모두 읽는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';

const HANGUL = /[가-힣]/;
// 정의 이름. 기록은 이름을 40자에서 잘라 「opus-mediu」, 「sonnet」처럼 끝이 잘린 꼴도 있다.
const MODEL = /\b(?:haiku|sonnet|opus)(?:-[a-z]*)?/g;
// 판정 이름을 견줄 때 쓰는 열쇠. 바뀌는 낱말(「칸 이름」, ${값}, 정의 이름)을 줄이고 앞 14자만 쓴다. 기록은 이름을 40자에서 자르고 원본은 틀 글이라 끝이 다르다.
export const nameLabel = (s) => String(s ?? '').replace(/`/g, '').replace(/\$\{[^}]*\}/g, '…').replace(/「[^」]*」/g, '「…」').replace(MODEL, '…').replace(/\s+/g, ' ').trim();
export const nameKey = (s) => nameLabel(s).slice(0, 14);

// 주석 줄을 뺀 원본. 사유 글은 따옴표 글자에만 있으므로 주석이 조각과 머리 이름에 섞이지 않게 한다.
const codeLines = (source) => String(source ?? '').split('\n').filter((l) => !/^\s*(?:\/\/|\*|\/\*|#)/.test(l));

// 사유 글을 주인 장치에 짝짓는 글자 조각. 따옴표와 ${…}, 이스케이프를 넘지 않는 한글로 시작하는 10자 넘는 토막만 둔다.
// 따옴표 글자를 낱말 분석으로 짝짓지 않는 것은 정규식 글자(/[「"*]/ 같은) 안의 따옴표가 짝을 어긋나게 해서다.
export function fragmentsOf(source) {
  const set = new Set();
  for (const line of codeLines(source)) {
    for (const m of line.matchAll(/[가-힣][^`'"$\\{}\n]{9,}/g)) {
      const p = m[0].trim();
      if (p.length >= 10) set.add(p);
    }
  }
  return [...set];
}

// 훅 원본에서 판정 이름 셋과 이름 꼴을 뽑는다.
//   prefix: named의 이름이 `접두 ${…}` 꼴이면 그 접두(멈춤 검사, 지시문 점검)
//   heads: 이름을 사유 머리(split(':')[0])에서 따는 훅이면 「이름: 」으로 시작하는 글자의 머리
//   literals: named(…, ['이름']) 꼴로 박힌 이름
//   problems: 접두 꼴 훅이 problems.push로 쌓는 문제 글의 머리(이름 꼴과 같게 [.:(] 앞 40자)
export function verdictNames(source, { called = false } = {}) {
  const src = String(source ?? '');
  const prefix = (/named\([\s\S]{0,1500}?(?:=>\s*|\[\s*)`([가-힣][^`$\\]*?)\s*\$\{/.exec(src) || [])[1];
  const literals = new Set();
  for (const m of src.matchAll(/(?:\}|named\(\w+),\s*\[\s*[`']([^`'$\\\n]{2,24}?)(?:\\t[^`'\n]*)?[`']\s*\]\s*\)/g)) literals.add(m[1].trim());
  const heads = new Set();
  if (called || (/\.split\(':'\)\[0\]/.test(src) && /named\(/.test(src))) {
    for (const line of codeLines(src)) for (const m of line.matchAll(/[`'"]([가-힣][가-힣A-Za-z ]{1,15}): /g)) heads.add(m[1]);
  }
  const problems = new Set();
  if (prefix) {
    for (const m of src.matchAll(/(?:problems\.push\(|return \[)\s*[`']([^`'\n]{4,160})/g)) {
      const head = m[1].split(/[.:(]/)[0].trim().slice(0, 40);
      if (head.length >= 4 && HANGUL.test(head)) problems.add(head);
    }
  }
  return { prefix: prefix ? `${prefix.trim()} ` : '', literals: [...literals], heads: [...heads], problems: [...problems] };
}

const readText = (f) => {
  try {
    return fs.readFileSync(f, 'utf8');
  } catch {
    return '';
  }
};
const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
};
const expand = (p, configDir) => p.replace(/^\$HOME\/\.claude|^~\/\.claude/, configDir).replace(/^\$HOME|^~/, path.dirname(configDir));

// settings.json의 훅 등록을 장치로 묶는다. 이름표(# kit:<묶음>/<이름>)가 있으면 그 이름, 없으면 설정 폴더 안 스크립트 파일 이름.
// 설정 폴더 밖 스크립트(다른 도구가 단 훅)는 장치가 아니라 outside 수로만 센다.
export function settingsHooks(settings, configDir) {
  const byName = new Map();
  let outside = 0;
  for (const [event, groups] of Object.entries(settings?.hooks ?? {})) {
    for (const g of Array.isArray(groups) ? groups : []) {
      for (const h of Array.isArray(g?.hooks) ? g.hooks : []) {
        const cmd = typeof h?.command === 'string' ? h.command : '';
        const label = /\s#\s*kit:([a-z][a-z0-9-]*)\/([a-z][a-z0-9-]*)\s*$/.exec(cmd);
        const body = cmd.replace(/\s#.*$/, '');
        const scripts = [...body.matchAll(/"?((?:\$HOME|~)?[^"\s]*\.(?:js|cjs|mjs|py|sh))"?/g)].map((m) => m[1]).filter((s) => !/kit-hook\.cjs$/.test(s));
        const script = scripts.at(-1) ? expand(scripts.at(-1), configDir) : '';
        if (!label && !(script && (script.startsWith(configDir) || cmd.includes('.claude/')))) {
          outside++;
          continue;
        }
        const name = label ? label[2] : path.basename(script).replace(/\.[^.]+$/, '');
        const e = byName.get(name) ?? byName.set(name, { kind: '훅', name, bundle: label ? label[1] : '개인', file: script, events: [] }).get(name);
        e.events.push({ event, matcher: typeof g?.matcher === 'string' ? g.matcher : '' });
      }
    }
  }
  return { hooks: [...byName.values()], outside };
}

// 장치가 그 도구(또는 Stop 같은 이벤트)에 걸리나.
export function catches(device, tool) {
  return device.events.some(({ event, matcher }) => {
    if (tool === event) return true;
    if (!['PreToolUse', 'PostToolUse', 'PermissionRequest'].includes(event)) return false;
    if (!matcher || matcher === '*') return true;
    try {
      return new RegExp(`^(?:${matcher})$`).test(tool);
    } catch {
      return false;
    }
  });
}

const gitLines = (dir, args) => {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout.split('\n').filter(Boolean) : null;
};

// 장치 목록. 등록과 파일에서 뽑고, 서로 짝이 없는 것도 갈래를 달아 넣는다.
export function inventory({ configDir, kitDir, settings, lock }) {
  const { hooks, outside } = settingsHooks(settings, configDir);
  const devices = [...hooks];
  const registered = new Set(hooks.map((h) => path.resolve(h.file)));
  const anomalies = [];
  // 깐 상태 기록에 있는데 settings.json에 없는 훅
  for (const [bundle, entry] of Object.entries(lock?.installed ?? {})) {
    for (const [, p] of Object.entries(entry.parts ?? {})) {
      for (const h of p.hooks ?? []) if (!hooks.some((x) => x.name === h.name)) anomalies.push(`${bundle}/${h.name}: 깐 상태 기록에 있는데 settings.json에 등록 없음`);
      for (const g of p.gitHooks ?? []) devices.push({ kind: '커밋 훅', name: `${g.hook}/${g.name}`, bundle, file: path.join(configDir, g.file), events: [{ event: 'git', matcher: g.hook }] });
    }
  }
  const gitFiles = new Set(devices.filter((d) => d.kind === '커밋 훅').map((d) => path.resolve(d.file)));
  const hookDir = path.join(configDir, 'subagent-system', 'hooks');
  for (const hk of ['commit-msg', 'pre-commit']) {
    const dir = path.join(hookDir, 'git', `${hk}.d`);
    for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith('.cjs')) : []) {
      if (!gitFiles.has(path.resolve(dir, f))) devices.push({ kind: '커밋 훅', name: `${hk}/${f.replace(/^\d+-|\.cjs$/g, '')}`, bundle: '등록 없음', file: path.join(dir, f), events: [{ event: 'git', matcher: hk }], unregistered: true });
    }
  }
  // 설정 폴더의 훅 파일 가운데 등록이 없는 것: 다른 훅이 부르면 「불림」, 아니면 「등록 없음」. .cjs와 lib는 부품이다.
  const sources = new Map(devices.map((d) => [d, readText(d.file)]));
  const callers = (base) => devices.filter((d) => d.kind === '훅' && (sources.get(d) ?? '').includes(base));
  const loose = [
    ...[hookDir, path.join(configDir, 'hooks')].flatMap((dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => /\.(?:js|cjs|py)$/.test(n)).map((n) => path.join(dir, n)) : [])),
    ...(fs.existsSync(path.join(hookDir, 'lib')) ? fs.readdirSync(path.join(hookDir, 'lib')).filter((n) => n.endsWith('.cjs')).map((n) => path.join(hookDir, 'lib', n)) : []),
  ];
  for (const f of loose) {
    if (registered.has(path.resolve(f))) continue;
    const base = path.basename(f);
    const by = callers(base.replace(/\.[^.]+$/, ''));
    const personal = !f.startsWith(hookDir);
    if (/\.cjs$/.test(f) && !personal) {
      devices.push({ kind: '부품', name: base, bundle: '-', file: f, events: [], callers: by.map((d) => d.name) });
      continue;
    }
    const ev = by.flatMap((d) => d.events);
    devices.push({ kind: '훅', name: base.replace(/\.[^.]+$/, ''), bundle: personal ? '개인' : '-', file: f, events: ev, callers: by.map((d) => d.name), unregistered: !by.length });
  }
  // 키트 원본에만 있는 훅 파일(안 깐 묶음)
  if (kitDir) {
    const kh = path.join(kitDir, 'subagent-system', 'hooks');
    for (const n of fs.existsSync(kh) ? fs.readdirSync(kh).filter((x) => x.endsWith('.js')) : []) {
      if (!fs.existsSync(path.join(hookDir, n))) devices.push({ kind: '훅', name: n.replace(/\.js$/, ''), bundle: '안 깐 묶음', file: path.join(kh, n), events: [], notInstalled: true });
    }
  }
  // 스킬과 정의
  const tracked = new Set(gitLines(configDir, ['ls-files', 'skills', 'agents']) ?? []);
  const origin = (rel, kitRel) => (kitDir && fs.existsSync(path.join(kitDir, kitRel)) ? '키트' : [...tracked].some((t) => t.startsWith(rel)) ? '개인' : '바깥');
  const skillDir = path.join(configDir, 'skills');
  for (const n of fs.existsSync(skillDir) ? fs.readdirSync(skillDir).filter((x) => fs.existsSync(path.join(skillDir, x, 'SKILL.md'))) : []) {
    devices.push({ kind: '스킬', name: n, bundle: origin(`skills/${n}/`, `subagent-system/skills/${n}`), file: path.join(skillDir, n, 'SKILL.md'), events: [] });
  }
  const kitSkills = kitDir ? path.join(kitDir, 'subagent-system', 'skills') : '';
  if (kitSkills && fs.existsSync(kitSkills)) {
    for (const n of fs.readdirSync(kitSkills)) {
      if (fs.existsSync(path.join(kitSkills, n, 'SKILL.md')) && !fs.existsSync(path.join(skillDir, n, 'SKILL.md'))) devices.push({ kind: '스킬', name: n, bundle: '안 깐 묶음', file: path.join(kitSkills, n, 'SKILL.md'), events: [], notInstalled: true });
    }
  }
  const agentDir = path.join(configDir, 'agents');
  for (const n of fs.existsSync(agentDir) ? fs.readdirSync(agentDir).filter((x) => x.endsWith('.md')) : []) {
    devices.push({ kind: '정의', name: n.replace(/\.md$/, ''), bundle: origin(`agents/${n}`, `subagent-system/agents/${n}`), file: path.join(agentDir, n), events: [] });
  }
  // 훅마다 판정 이름과 글자 조각
  for (const d of devices) {
    if (d.kind !== '훅' && d.kind !== '커밋 훅') continue;
    const src = readText(d.file);
    // 다른 훅이 불러 사유 머리를 이름으로 쓰는 훅(answer-check가 부르는 decision-check)은 머리 글자를 판정 이름으로 본다.
    d.names = verdictNames(src, { called: !!d.callers?.length });
    d.fragments = fragmentsOf(src);
    // 막는 글을 다른 스크립트가 내는 커밋 훅(kit-drift가 부르는 kit-setup.js check-staged)은 그 스크립트의 「커밋」이 든 조각을 함께 쓴다.
    // 「커밋」으로 거르는 것은 큰 스크립트의 다른 글이 다른 커밋 훅의 글과 겹쳐 주인을 잘못 고르지 않게 하려는 것이다.
    if (d.kind === '커밋 훅') {
      for (const m of src.matchAll(/['"`/]([\w-]+\.c?js)['"`]/g)) {
        const f = path.join(configDir, 'subagent-system', 'scripts', m[1]);
        if (m[1] !== path.basename(d.file) && fs.existsSync(f)) d.fragments.push(...fragmentsOf(readText(f)).filter((x) => x.includes('커밋')));
      }
    }
  }
  return { devices, outside, anomalies };
}

// 기록의 판정 이름을 (장치, 판정 열쇠)로 짝짓는다. tool은 기록의 도구 열(Stop이면 이벤트 이름)이다. 못 지으면 null.
export function resolveName(devices, rawName, tool) {
  const name = String(rawName ?? '').replace(/\(실무자\)$/, '').trim();
  const hooks = devices.filter((d) => d.kind === '훅' && d.names);
  const pick = (list) => {
    if (list.length <= 1) return list[0] ?? null;
    return list.find((d) => catches(d, tool)) ?? list[0];
  };
  const exact = pick(hooks.filter((d) => d.name === name));
  if (exact) return { device: exact, key: null, label: null };
  const pre = pick(hooks.filter((d) => d.names.prefix && name.startsWith(d.names.prefix)));
  if (pre) {
    const rest = name.slice(pre.names.prefix.length);
    return { device: pre, key: nameKey(rest), label: nameLabel(rest) };
  }
  const lit = pick(hooks.filter((d) => d.names.literals.includes(name) || d.names.heads.includes(name)));
  if (lit) return { device: lit, key: nameKey(name), label: name };
  // 머리 꼴이 아닌 이름(사유 첫 문장을 그대로 이름으로 쓴 것)은 원본 조각으로 주인을 찾는다.
  const owner = ownerOf(hooks, name, tool);
  if (owner) return { device: owner, key: nameKey(name), label: nameLabel(name).slice(0, 40) };
  return null;
}

// 사유 글의 주인 장치. 같은 도구에 걸리는 장치 가운데 원본 조각이 가장 많이 든 것. 비기거나 하나도 없으면 null.
export function ownerOf(devices, reason, tool) {
  const text = String(reason ?? '').slice(0, 1500);
  let best = null;
  let bestN = 0;
  let tie = false;
  for (const d of devices) {
    if (!d.fragments || !d.fragments.length) continue;
    if (tool && !catches(d, tool)) continue;
    let n = 0;
    for (const f of d.fragments) if (text.includes(f)) n++;
    if (n > bestN) {
      best = d;
      bestN = n;
      tie = false;
    } else if (n === bestN && n > 0 && best && best.file !== d.file) tie = true;
  }
  return tie ? null : best;
}

// 사유 글의 주인과 판정. 한 사유에 여러 훅의 판정이 실린다(answer-check가 부르는 decision-check처럼).
// 머리 이름(「이름: 」)이나 접두를 가진 장치의 이름이 글에 있으면 그 장치들의 판정으로 받고, 없으면 원본 조각으로 주인 하나를 고른다.
export function attribute(candidates, reason, tool) {
  const found = [];
  for (const d of candidates) {
    if (tool && !catches(d, tool)) continue;
    if (!d.names?.heads?.length) continue;
    const v = verdictsIn(d, reason).filter((x) => x.key);
    if (v.length) found.push({ owner: d, verdicts: v });
  }
  if (found.length) {
    // 같은 파일을 쓰는 등록 둘(brief-check와 handoff-check)이 함께 맞으면 하나만 둔다.
    const seen = new Set();
    return found.filter((f) => !seen.has(f.owner.file) && seen.add(f.owner.file));
  }
  const owner = ownerOf(candidates, reason, tool);
  return [{ owner, verdicts: owner ? verdictsIn(owner, reason) : [] }];
}

// 사유 글 하나를 판정 열쇠 목록으로 가른다(한 사유에 여러 판정이 실린다).
export function verdictsIn(device, reason) {
  const text = String(reason ?? '');
  const { prefix, heads, literals, problems } = device.names ?? { heads: [], literals: [], problems: [] };
  if (heads.length) {
    const found = heads.filter((h) => new RegExp(`(?:^|[\\s.])${h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`).test(text));
    if (found.length) return found.map((h) => ({ key: nameKey(h), label: h }));
  }
  if (prefix) {
    const lines = text.split(/\n- /).slice(1).map((l) => l.split(/[.:(]/)[0].trim().slice(0, 40)).filter(Boolean);
    if (lines.length) return lines.map((l) => ({ key: nameKey(l), label: nameLabel(l) }));
    if (problems.length) return [];
  }
  if (literals.length === 1) return [{ key: nameKey(literals[0]), label: literals[0] }];
  return [{ key: null, label: null }];
}

const hashOf = (v) => crypto.createHash('sha1').update(JSON.stringify(v ?? null)).digest('hex').slice(0, 16);
const COMMIT = /\bgit\b[^|;&\n]*\bcommit\b/;

// 대화 기록 파일 하나에서 도구 호출, 결과, Stop 막음 글을 뽑는다.
export async function scanTranscript(file, since) {
  const uses = [];
  const results = new Map();
  const stops = [];
  const commits = new Set();
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    const hasUse = line.includes('"tool_use"');
    const hasRes = line.includes('"tool_result"');
    const hasStop = line.includes('Stop hook feedback');
    if (!hasUse && !hasRes && !hasStop) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = Date.parse(d.timestamp ?? '');
    if (!(ts >= since)) continue;
    const c = d.message?.content;
    if (d.type === 'assistant' && Array.isArray(c)) {
      for (const x of c) {
        if (x?.type !== 'tool_use' || !x.id) continue;
        const cmd = x.name === 'Bash' && typeof x.input?.command === 'string' ? x.input.command : '';
        const commit = COMMIT.test(cmd);
        if (commit) commits.add(x.id);
        uses.push({ id: x.id, ts, name: x.name, hash: hashOf(x.input), commit });
      }
    } else if (d.type === 'user') {
      if (typeof c === 'string' && c.startsWith('Stop hook feedback:')) stops.push({ id: d.uuid ?? `${file}:${ts}`, ts, text: c.slice('Stop hook feedback:'.length).trim() });
      else if (Array.isArray(c)) {
        for (const x of c) {
          if (x?.type !== 'tool_result' || !x.tool_use_id) continue;
          const t = typeof x.content === 'string' ? x.content : Array.isArray(x.content) ? x.content.filter((y) => y?.type === 'text').map((y) => y.text).join('\n') : '';
          // 커밋은 통과한 결과도 글을 둔다(알림만 하는 커밋 훅의 글을 세려고).
          results.set(x.tool_use_id, { err: x.is_error === true, text: x.is_error === true || commits.has(x.tool_use_id) ? t.slice(0, 4000) : '' });
        }
      }
    }
  }
  return { uses, results, stops };
}

const HOOK_ERROR = /^PreToolUse:([\w-]+) hook error:\s*/;

// 대화 기록에서 막음 사건을 뽑는다. 도구 막음은 그 뒤 같은 입력을 다시 냈는지(다시 내 통과), 같은 도구를 다른 입력으로 냈는지 함께 본다.
// 알림만 하는 커밋 훅이 글 머리에 다는 말(git 조각의 표준 에러). 이 말 뒤의 글은 막음이 아니라 알림으로 센다.
export const COMMIT_NOTE = 'kit git 훅(알림만';

export function blockEvents(devices, scans, seen = new Set()) {
  const events = [];
  const hooks = devices.filter((d) => d.kind === '훅');
  const commitHooks = devices.filter((d) => d.kind === '커밋 훅');
  for (const { uses, results, stops } of scans) {
    for (let i = 0; i < uses.length; i++) {
      const u = uses[i];
      if (seen.has(u.id)) continue;
      seen.add(u.id);
      const r = results.get(u.id);
      if (!r) continue;
      let found = [];
      let reason = '';
      const m = r.err ? HOOK_ERROR.exec(r.text) : null;
      if (m) {
        reason = r.text.slice(m[0].length);
        found = attribute(hooks, reason, u.name);
      } else if (u.commit) {
        const at = r.text.indexOf(COMMIT_NOTE);
        if (at >= 0) {
          const note = ownerOf(commitHooks, r.text.slice(at), null);
          if (note) events.push({ ts: u.ts, tool: 'git', owner: note, verdicts: [], outcome: '', note: true, head: '' });
        }
        if (!r.err) continue;
        reason = at >= 0 ? r.text.slice(0, at) : r.text;
        const owner = ownerOf(commitHooks, reason, null);
        if (!owner) continue;
        found = [{ owner, verdicts: [] }];
      } else continue;
      let outcome = '그 뒤 없음';
      for (let j = i + 1; j < uses.length; j++) {
        if (uses[j].name !== u.name) continue;
        if (uses[j].hash === u.hash) {
          const rr = results.get(uses[j].id);
          const blockedAgain = rr && rr.err && (HOOK_ERROR.test(rr.text) || (u.commit && found[0].owner && ownerOf([found[0].owner], rr.text, null)));
          if (blockedAgain) continue;
          outcome = '다시 내 통과';
        } else outcome = '다른 입력';
        break;
      }
      for (const f of found) events.push({ ts: u.ts, tool: u.name, owner: f.owner, verdicts: f.verdicts, outcome, head: reason.slice(0, 60) });
    }
    const stopHooks = hooks.filter((d) => catches(d, 'Stop'));
    for (const s of stops) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      for (const f of attribute(stopHooks, s.text, 'Stop')) events.push({ ts: s.ts, tool: 'Stop', owner: f.owner, verdicts: f.verdicts, outcome: '', head: s.text.slice(0, 60) });
    }
  }
  return events;
}

// 막음 글이 든 대화 기록 파일. rg가 있으면 막음 글이 든 파일만, 없으면 기간 안 모든 파일.
export function candidateFiles(root, since) {
  const r = spawnSync('rg', ['-l', '--no-messages', '--glob', '*.jsonl', '-e', 'hook error', '-e', 'Stop hook feedback', '-e', '"is_error":true', root], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const walk = (dir, out = []) => {
    for (const e of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (e.name.endsWith('.jsonl')) out.push(p);
    }
    return out;
  };
  const files = r.status === 0 || r.status === 1 ? r.stdout.split('\n').filter(Boolean) : walk(root);
  return files.filter((f) => {
    try {
      return fs.statSync(f).mtimeMs >= since;
    } catch {
      return false;
    }
  });
}

// 고침 기록(fixes.tsv)의 고친 곳이 이 장치를 가리키는 줄 수. 판정은 「파일#판정」 꼴의 판정 자리로 센다.
export function fixCounts(device, fixRows) {
  const base = path.basename(device.file);
  const needle = device.kind === '스킬' ? `skills/${device.name}/` : device.kind === '정의' ? `agents/${device.name}.md` : base;
  const per = new Map();
  let total = 0;
  for (const f of fixRows) {
    const where = f.where ?? '';
    if (!where.includes(needle)) continue;
    total++;
    const anchor = (where.split('#')[1] ?? '').trim();
    if (anchor) per.set(nameKey(anchor), (per.get(nameKey(anchor)) ?? 0) + 1);
  }
  return { total, per };
}

// 키트 원본(있으면)과 설정 폴더의 커밋 가운데 기간 안에 이 장치 파일을 고친 수.
export function commitCount(device, { configDir, kitDir, sinceIso }) {
  const file = path.resolve(device.file);
  const tries = [];
  if (kitDir && file.startsWith(path.resolve(kitDir) + path.sep)) tries.push([kitDir, path.relative(kitDir, file)]);
  else if (file.startsWith(path.resolve(configDir) + path.sep)) {
    const rel = path.relative(configDir, file);
    const kitRel = rel.startsWith('subagent-system/') ? rel : rel.startsWith('skills/') || rel.startsWith('agents/') ? path.join('subagent-system', rel) : null;
    // 키트 파일이면 키트 원본만 센다. 설정 폴더의 커밋은 원본을 내려받은 것이라 같은 고침을 두 번 센다.
    if (kitDir && kitRel && fs.existsSync(path.join(kitDir, kitRel))) tries.push([kitDir, kitRel]);
    else tries.push([configDir, rel]);
  }
  for (const [dir, rel] of tries) {
    const target = device.kind === '스킬' ? path.dirname(rel) : rel;
    const lines = gitLines(dir, ['log', `--since=${sinceIso}`, '--format=%h', '--', target]);
    if (lines && lines.length) return lines.length;
  }
  return 0;
}


export const readJsonFile = readJson;

// 기록 파일 줄(첫 칸이 시각)을 기간으로 거른다.
const tsvRows = (file, since) => readText(file).split('\n').map((l) => l.split('\t')).filter((c) => /^\d{4}-\d{2}-\d{2}/.test(c[0] ?? '') && Date.parse(c[0].length === 10 ? `${c[0]}T00:00:00` : c[0]) >= since);
const firstAt = (file) => (readText(file).split('\n').find((l) => /^\d{4}-\d{2}-\d{2}/.test(l)) ?? '').slice(0, 10) || null;

// 승인 창 기록과 사용 기록처럼 막지 않고 기록만 하는 훅이 남기는 파일. 훅 이름 → 기록 폴더 기준 파일(설정 폴더 기준이면 앞에 ../../).
// 왜: 이 훅들은 막음도 대화 글도 없어 쓰임을 기록 줄로만 셀 수 있다. 전제: 여기 없는 기록 훅은 「못 셈(기록 파일 모름)」으로 찍힌다.
export const RECORD_OF = { 'usage-autolog': 'subagent-usage.tsv', 'subagent-usage': 'subagent-cost.tsv', 'ask-log': '../../permission-asks.jsonl' };

// 되돌릴 수 없는 일을 막는 장치(안전장치 묶음, 그 묶음만 쓰는 부품, 승인 창 기록). 걷거나 느슨하게 하는 것은 사용자 몫이라 실마리에 표시만 한다(RETRO 「막는 장치 효과 보기」).
export const isGate = (d) => d.bundle === 'safety' || d.name === 'ask-log' || (d.kind === '부품' && Array.isArray(d.callers) && d.callers.length > 0 && d.callers.every((c) => ['rm-guard', 'git-discard-guard', 'supabase-sql-guard'].includes(c)));

// 장치마다 셈을 모은다. usage는 스킬과 정의의 쓰임(이름 → { calls, reads, last })이다.
export function tally({ devices, recordsDir, configDir, since, events, fixRows, usage = new Map(), commits = new Map() }) {
  const rows = new Map();
  const unmatched = new Map();
  const listed = new Set();
  const row = (d, key, label) => {
    const k = `${d.kind}\t${d.name}\t${key ?? ''}`;
    if (!rows.has(k)) rows.set(k, { device: d, key, label, gone: false, notes: 0, sessions: new Map(), blocksRec: 0, blocksTx: 0, fpStop: 0, resendPass: 0, otherInput: 0, noAfter: 0, runs: 0, chars: 0, asks: 0, records: null, slow: 0, fixes: 0, commits: 0, last: 0 });
    return rows.get(k);
  };
  const touch = (r, ts) => {
    if (ts > r.last) r.last = ts;
  };
  for (const d of devices) {
    row(d, null, null);
    if (!d.names || listed.has(d.file)) continue;
    listed.add(d.file);
    for (const n of [...d.names.heads, ...d.names.literals, ...d.names.problems]) row(d, nameKey(n), nameLabel(n));
  }
  // 판정 이름의 바뀌지 않는 토막(「…」과 … 사이 가장 긴 글)이 그 훅 원본에 없으면 옛 이름이나 걷은 판정이다.
  const srcOf = new Map();
  const mark = (r) => {
    if (r.key === null || !r.label) return r;
    if (!srcOf.has(r.device.file)) srcOf.set(r.device.file, readText(r.device.file));
    const seg = r.label.split(/「…」|…/).map((x) => x.trim()).sort((a, b) => b.length - a.length)[0] ?? '';
    if (seg && !srcOf.get(r.device.file).includes(seg.slice(0, 12))) r.gone = true;
    return r;
  };
  const resolve = (name, tool, ts) => {
    const r = resolveName(devices, name, tool);
    if (!r) {
      const u = unmatched.get(name) ?? unmatched.set(name, { n: 0, last: 0 }).get(name);
      u.n++;
      u.last = Math.max(u.last, ts);
      return null;
    }
    return mark(row(r.device, r.key, r.label));
  };
  const blocksFile = path.join(recordsDir, 'hook-blocks.tsv');
  for (const c of tsvRows(blocksFile, since)) {
    const ts = Date.parse(c[0]);
    const r = resolve(c[2], c[3] || 'Stop', ts);
    if (!r) continue;
    r.blocksRec++;
    r.sessions.set(c[1], (r.sessions.get(c[1]) ?? 0) + 1);
    touch(r, ts);
  }
  for (const c of tsvRows(path.join(recordsDir, 'hook-false-positive.tsv'), since)) {
    if (c[4] !== '통과' || (c[5] ?? '').includes(':')) continue;
    const r = resolveName(devices, c[2], 'Stop');
    if (r) row(r.device, r.key, r.label).fpStop++;
  }
  for (const e of events) {
    if (!e.owner) {
      const u = unmatched.get(`(대화) ${e.head}`) ?? unmatched.set(`(대화) ${e.head}`, { n: 0, last: 0 }).get(`(대화) ${e.head}`);
      u.n++;
      u.last = Math.max(u.last, e.ts);
      continue;
    }
    if (e.note) {
      const r = row(e.owner, null, null);
      r.notes++;
      touch(r, e.ts);
      continue;
    }
    const vs = e.verdicts.length ? e.verdicts : [{ key: null, label: null }];
    for (const v of vs) {
      const r = mark(row(e.owner, v.key, v.label));
      r.blocksTx++;
      if (e.outcome === '다시 내 통과') r.resendPass++;
      else if (e.outcome === '다른 입력') r.otherInput++;
      else if (e.outcome === '그 뒤 없음') r.noAfter++;
      touch(r, e.ts);
    }
  }
  const byName = (name) => devices.find((d) => d.kind === '훅' && d.name === name);
  for (const c of tsvRows(path.join(recordsDir, 'hook-output.tsv'), since)) {
    const d = byName(c[1]);
    if (!d) {
      const u = unmatched.get(`(글) ${c[1]}`) ?? unmatched.set(`(글) ${c[1]}`, { n: 0, last: 0 }).get(`(글) ${c[1]}`);
      u.n++;
      u.last = Math.max(u.last, Date.parse(c[0]));
      continue;
    }
    const r = row(d, null, null);
    r.runs++;
    r.chars += Number(c[2]) || 0;
    touch(r, Date.parse(c[0]));
  }
  for (const c of tsvRows(path.join(recordsDir, 'hook-time.tsv'), since)) {
    const d = byName(c[1]);
    if (d) row(d, null, null).slow++;
  }
  for (const line of readText(path.join(configDir, 'permission-asks.jsonl')).split('\n')) {
    let j;
    try {
      j = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = Date.parse(j.ts ?? '');
    if (!(ts >= since)) continue;
    const d = byName(String(j.hook ?? '').split(':')[0]);
    if (d) {
      const r = row(d, null, null);
      r.asks++;
      touch(r, ts);
    }
  }
  for (const [name, rel] of Object.entries(RECORD_OF)) {
    const d = byName(name);
    if (!d) continue;
    const file = path.join(recordsDir, rel);
    const r = row(d, null, null);
    if (file.endsWith('.jsonl')) {
      r.records = 0;
      for (const line of readText(file).split('\n')) {
        try {
          const ts = Date.parse(JSON.parse(line).ts ?? '');
          if (ts >= since) {
            r.records++;
            touch(r, ts);
          }
        } catch {
          // 깨진 줄은 세지 않는다.
        }
      }
    } else {
      const got = tsvRows(file, since);
      r.records = got.length;
      for (const c of got) touch(r, Date.parse(`${c[0].slice(0, 10)}T12:00:00`));
    }
  }
  for (const d of devices) {
    const f = fixCounts(d, fixRows);
    row(d, null, null).fixes = f.total;
    for (const [k, n] of f.per) if (rows.has(`${d.kind}\t${d.name}\t${k}`)) rows.get(`${d.kind}\t${d.name}\t${k}`).fixes = n;
    row(d, null, null).commits = commits.get(d) ?? 0;
    const u = usage.get(`${d.kind}\t${d.name}`);
    if (u) Object.assign(row(d, null, null), { calls: u.calls, reads: u.reads, last: Math.max(row(d, null, null).last, u.last) });
  }
  // 장치 줄(판정 열쇠 없음)에 판정 줄의 셈을 더한다. 판정 줄은 그대로 둔다.
  const out = [...rows.values()];
  for (const r of out.filter((x) => x.key !== null)) {
    const top = rows.get(`${r.device.kind}\t${r.device.name}\t`);
    for (const k of ['blocksRec', 'blocksTx', 'fpStop', 'resendPass', 'otherInput', 'noAfter']) top[k] += r[k];
    for (const [sid, n] of r.sessions) top.sessions.set(sid, (top.sessions.get(sid) ?? 0) + n);
    top.last = Math.max(top.last, r.last);
  }
  // 한 세션 최대(막음 기록): 큰 일 하나에 몰린 막음은 기간 합으로 판정하지 않으려고 함께 본다(RETRO 「막는 장치 효과 보기」).
  for (const r of out) r.sessionMax = Math.max(0, ...r.sessions.values());
  for (const r of out) r.hint = hintOf(r);
  return { rows: out, unmatched: [...unmatched].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.n - a.n), recordsFrom: { blocks: firstAt(blocksFile), output: firstAt(path.join(recordsDir, 'hook-output.tsv')) } };
}

// 판정을 돕는 실마리. 판정은 사람이 한다.
export function hintOf(r) {
  const d = r.device;
  if (d.notInstalled) return '안 깐 묶음';
  if (d.unregistered) return '등록 없음';
  if (isGate(d) && r.key === null) return '문지기(걷기와 느슨하게는 사용자 몫)';
  if (d.kind === '스킬' || d.kind === '정의') return (r.calls ?? 0) + (r.reads ?? 0) === 0 ? '쓰임 0' : '';
  if (d.kind === '부품') return '';
  const blocks = Math.max(r.blocksRec, r.blocksTx);
  const empty = r.fpStop + r.resendPass;
  const used = blocks + r.runs + r.asks + r.notes + (r.records ?? 0);
  if (r.key === null && used === 0) return d.kind === '커밋 훅' ? '대화 막음 0(통과는 기록 없음)' : '쓰임 0';
  if (r.gone) return '원본에 없음(옛 이름이나 걷은 판정)';
  if (r.key !== null && blocks === 0) return '막음 0';
  if (empty > blocks - empty && blocks > 0) return '좁힐 후보(헛막음이 잡은 수보다 많음)';
  return '';
}
