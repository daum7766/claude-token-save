/**
 * 문서 상태 점검(work-metrics.js health)의 계산부. 아무것도 지우거나 쓰지 않고 후보와 증거를 모은다.
 * 까닭: 다 쓴 작업 기록, 멈춘 진행 기록, 부푼 문서, 끊긴 경로, 손볼 메모리를 사용자가 짚기 전에 기계가 찾게 하려는 것이다.
 * 전제: 후보일 뿐 판정은 사람이 한다. 나이는 작업 기록에만 증거로 찍는다(결정 문서와 기획서는 오래돼도 정본이다).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const THRESHOLD = { bytes: 24000, evidenceRatio: 0.3, quotes: 50, longRow: 1000, longRowCount: 1 };

const SKIP_DIR = /(?:^|\/)(?:node_modules|\.git|vendor|plugins|\.kit-base|worktrees|[^/]*-backup-[^/]*)\//;
const RECORD_DIR = /(?:^|\/)(?:archive|records|_temp|fixtures)\//;
const WORK_DIR = /(?:^|\/)plan\/work\//;
const CHANGELOG = /(?:^|\/)(?:CHANGES|CHANGELOG)[^/]*\.md$/i;
const TEXT_EXT = /\.(?:md|js|cjs|mjs|json|tsv|sh|ts|tsx|yml|yaml|toml|css|html)$/;

const git = (repo, args) => spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const gitOut = (repo, args) => git(repo, args).stdout ?? '';
const read = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } };
const lines = (text) => text.split(/\r?\n/);
const head = (text, n = 20) => lines(text).slice(0, n).join('\n');

export function repoTop(dir) {
  const r = git(dir, ['rev-parse', '--show-toplevel']);
  return r.status === 0 ? r.stdout.trim() : null;
}

// 제목 줄(#)로 나눈 절 목록. 절 하나는 제목 아래부터 같거나 높은 단계의 다음 제목 앞까지다.
export function sections(text) {
  const out = [];
  let cur = null;
  for (const line of lines(text)) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      if (cur) out.push(cur);
      cur = { level: m[1].length, title: m[2].trim(), body: [] };
    } else if (cur) cur.body.push(line);
  }
  if (cur) out.push(cur);
  // 하위 절의 글자도 윗절에 든다.
  return out.map((s, i) => {
    let body = [...s.body];
    for (let j = i + 1; j < out.length && out[j].level > s.level; j++) body = body.concat(['#'.repeat(out[j].level) + ' ' + out[j].title], out[j].body);
    return { ...s, text: body.join('\n') };
  });
}

// 「아직 안 정한 것」 절의 상태. 목록이나 표 줄이 하나라도 있으면 남은 것으로 본다.
export function undecidedState(text) {
  const sec = sections(text).find((s) => /아직\s*안\s*정한\s*것/.test(s.title));
  if (!sec) return { found: false, empty: null, lines: 0 };
  const real = lines(sec.text).map((l) => l.trim()).filter((l) => l && !/^[-*]?\s*(?:없음|없다)\.?$/.test(l) && !/^<!--.*-->$/.test(l) && !/^\|[\s:|-]+\|$/.test(l));
  return { found: true, empty: real.length === 0, lines: real.length };
}

// 문서 속 경로 낱말. 백틱 안은 통째로, 그 밖은 `/`로 이은 낱말만 본다.
const TOKEN = /(?:~\/|\.{1,2}\/|\/)?[A-Za-z0-9_.@가-힣-]+(?:\/[A-Za-z0-9_.@가-힣-]+)+\/?/g;
export function pathTokens(line) {
  const out = new Set();
  for (const m of line.matchAll(/`([^`\n]+)`/g)) {
    const t = cleanToken(m[1]);
    if (t) out.add(t);
  }
  const bare = line.replace(/`[^`\n]*`/g, ' ').replace(/https?:\/\/\S+/g, ' ');
  for (const m of bare.matchAll(TOKEN)) {
    const t = cleanToken(m[0]);
    if (t) out.add(t);
  }
  return [...out];
}
function cleanToken(raw) {
  let t = raw.trim().replace(/[#:]\d*[\w-]*$/, (s) => (/^[#:]/.test(s) ? '' : s)).replace(/[.,;)\]]+$/, '');
  t = t.replace(/#.*$/, '');
  if (!t || /[\s*<>{}$|"'=()[\]\\]/.test(t) || /^https?:|^[a-z]+:\/\//i.test(t) || t.includes('...') || t.includes('…')) return null;
  if (!/\//.test(t) && !(/^[\w.-]+$/.test(t) && TEXT_EXT.test(t) && /\.(?:md|json|tsv)$/.test(t))) return null;
  if (/^\d+\/\d+/.test(t) || /^[.]+$/.test(t)) return null;
  // 단위나 선택지처럼 보이는 낱말(a/b, 있음/없음)은 확장자가 없는 한 두 마디짜리 짧은 낱말을 뺀다.
  if (!TEXT_EXT.test(t) && !t.endsWith('/') && t.split('/').length === 2 && !/^(?:~|\.|docs|src|scripts|rules|hooks|skills|agents|tests?)/.test(t)) return null;
  return t;
}

function listFiles(repo) {
  const all = gitOut(repo, ['ls-files', '-co', '--exclude-standard', '-z']).split('\0').filter(Boolean);
  return all.filter((f) => !SKIP_DIR.test(f));
}

const isWorkName = (rel, text) => WORK_DIR.test(rel) || /progress/i.test(path.basename(rel)) || /끝나면\s*(?:지운다|지움)/.test(head(text, 6));

function ageOf(repo, rel, now) {
  const t = Number(gitOut(repo, ['log', '-1', '--format=%ct', '--', rel]).trim());
  if (t) return { at: t * 1000, source: '마지막 커밋' };
  try { return { at: fs.statSync(path.join(repo, rel)).mtimeMs, source: '수정 시각' }; } catch { return { at: now, source: '없음' }; }
}
const ageDays = (at, now) => Math.floor((now - at) / 86400000);

function newestMtime(dir) {
  let best = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { try { best = Math.max(best, fs.statSync(p).mtimeMs); } catch { /* 사라진 파일 */ } }
    }
  };
  try { walk(dir); } catch { /* 폴더 없음 */ }
  return best;
}

function sessionMarker(text, projectsRoot, days, now) {
  const m = /세션:\s*`?([0-9a-f]{8}-[0-9a-f-]{27})/i.exec(head(text, 30));
  if (!m) return { state: '표지 없음' };
  let file = null;
  try {
    for (const p of fs.readdirSync(projectsRoot)) {
      const f = path.join(projectsRoot, p, `${m[1]}.jsonl`);
      if (fs.existsSync(f)) { file = f; break; }
    }
  } catch { /* 프로젝트 폴더 없음 */ }
  if (!file) return { state: '세션 기록 없음', id: m[1] };
  const ago = (now - fs.statSync(file).mtimeMs) / 86400000;
  return { state: ago <= days ? '쓰는 중' : '쓰지 않음', id: m[1], daysAgo: Math.floor(ago) };
}

function branchState(repo, name) {
  const br = `wt/${name}`;
  if (!gitOut(repo, ['branch', '--list', br]).trim()) return { branch: br, state: '브랜치 없음' };
  const merged = git(repo, ['merge-base', '--is-ancestor', br, 'HEAD']).status === 0;
  return { branch: br, state: merged ? '머지됨' : '머지 안 됨' };
}

function resolveDocRef(repo, fromRel, token, bases) {
  const home = os.homedir();
  const t = token.startsWith('~/') ? path.join(home, token.slice(2)) : token;
  if (path.isAbsolute(t)) return fs.existsSync(t) ? t : null;
  for (const b of bases ?? [path.join(repo, path.dirname(fromRel)), repo, path.join(repo, 'docs')]) {
    const p = path.join(b, t);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// 후보의 경로를 정본이 가리키는 줄 수. 저장소 기준 경로, docs/를 뗀 경로, ~ 경로, 절대 경로를 모두 같은 경로로 본다.
function countRefs(repo, rel, canon) {
  const forms = new Set([rel, rel.replace(/^docs\//, ''), path.join(repo, rel), path.join(repo, rel).replace(os.homedir(), '~')]);
  const trim = (s) => s.replace(/\/$/, '');
  const needles = [...forms].map(trim).filter((s) => s.split('/').length >= 2 || s === rel);
  let n = 0;
  const where = [];
  for (const c of canon) {
    if (c.rel === rel) continue;
    for (const l of c.lines) {
      if (needles.some((f) => l.includes(f))) { n++; if (where.length < 3) where.push(c.rel); }
    }
  }
  return { count: n, where: [...new Set(where)] };
}

function gitIgnored(repo, rels0) {
  // 저장소 밖이나 위로 나가는 경로가 하나라도 있으면 git이 전체를 거절하므로 거른다.
  const rels = rels0.map((r) => path.posix.normalize(r)).filter((r) => r && !r.startsWith('../') && !r.startsWith('/') && r !== '.');
  if (!rels.length) return new Set();
  const r = spawnSync('git', ['-C', repo, 'check-ignore', '--no-index', '--stdin'], { input: rels.join('\n') + '\n', encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return new Set((r.stdout ?? '').split('\n').filter(Boolean));
}

function historyRows(file) {
  return lines(read(file)).map((l) => l.split('\t')).filter((c) => c.length >= 4 && c[0] !== '시각');
}

export function healthHistoryFile(recordsDir) {
  return path.join(recordsDir, 'health-history.tsv');
}
export const HISTORY_HEADER = ['시각', '종류', '키', '값', '메모'].join('\t');

// 같은 꼴 이름으로 쌓인 백업(이름의 숫자만 다른 .bak-, backup- 파일과 폴더). 가장 새것 하나만 남길 후보로 낸다.
// 왜: 백업을 만드는 곳(회고, 설치 갱신)이 지우는 때를 두지 않아 회고 백업 폴더와 .bak 파일이 회고와 갱신마다 쌓였다.
// 전제: git이 보지 않는 백업도 있어 git 목록이 아니라 폴더를 4단계까지 훑는다. 의존 폴더, .git, 워크트리, 대화 기록 폴더는 뺀다.
const BACKUP_NAME = /(?:\.bak[-.]|(?:^|[-_.])backups?[-_.]|\.backup\.)/i;
const BACKUP_SKIP = new Set(['node_modules', '.git', 'worktrees', 'projects', 'backups']);
export function stackedBackups(root, depth = 4) {
  const found = [];
  const walk = (dir, d) => {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const full = path.join(dir, e.name);
      if (BACKUP_NAME.test(e.name)) { found.push(full); continue; }
      if (e.isDirectory() && d < depth && !BACKUP_SKIP.has(e.name)) walk(full, d + 1);
    }
  };
  walk(root, 1);
  const groups = new Map();
  for (const f of found) {
    const key = path.join(path.dirname(f), path.basename(f).replace(/\d+/g, '#'));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  const out = [];
  for (const [pattern, files] of groups) {
    if (files.length < 2) continue;
    const sorted = files.map((f) => ({ f, t: fs.statSync(f).mtimeMs })).sort((a, b) => b.t - a.t);
    out.push({ pattern: path.relative(root, pattern), keep: path.relative(root, sorted[0].f), older: sorted.slice(1).map((x) => path.relative(root, x.f)) });
  }
  return out;
}

export function analyzeRepo(repo, { days = 3, now = Date.now(), projectsRoot = '', extraMetrics = {} } = {}) {
  const files = listFiles(repo).filter((f) => f.endsWith('.md'));
  const texts = new Map(files.map((f) => [f, read(path.join(repo, f))]));
  const work = [];
  const canonical = [];
  for (const f of files) {
    const text = texts.get(f);
    if (RECORD_DIR.test(f) && !WORK_DIR.test(f)) continue;
    if (isWorkName(f, text)) work.push(f);
    else if (!CHANGELOG.test(f)) canonical.push({ rel: f, lines: lines(text), text });
  }

  // 다 쓴 기록 후보와 멈춘 진행 기록
  const finished = [];
  const stalled = [];
  const workItems = [];
  const decisionDocs = (text, f) => {
    for (const t of pathTokens(text)) {
      if (!/\.md$/.test(t)) continue;
      const p = resolveDocRef(repo, f, t);
      if (!p || !p.startsWith(repo)) continue;
      const rel = path.relative(repo, p);
      if (rel === f) continue;
      const st = undecidedState(texts.get(rel) ?? read(p));
      if (st.found) return { rel, ...st };
    }
    return null;
  };
  for (const f of work) {
    const text = texts.get(f);
    const open = (text.match(/^\s*[-*]\s*\[ \]/gm) ?? []).length;
    const refs = countRefs(repo, f, canonical);
    const marker = sessionMarker(text, projectsRoot, days, now);
    const dec = open === 0 ? decisionDocs(text, f) : null;
    const name = path.basename(f, '.md').replace(/-progress$/, '');
    const br = branchState(repo, name);
    const age = ageOf(repo, f, now);
    const waiting = /기다림:/.test(text);
    const item = { kind: '작업 기록', path: f, refs: refs.count, refFiles: refs.where, session: marker, openBoxes: open, undecided: dec ? (dec.empty ? `${dec.rel} 비었음` : `${dec.rel} ${dec.lines}줄 남음`) : open === 0 ? '결정 문서 절 못 찾음' : '-', blockedByUndecided: !!dec && !dec.empty, branch: br, ageDays: ageDays(age.at, now), ageSource: age.source, waiting };
    workItems.push(item);
    const ok = item.refs === 0 && marker.state !== '쓰는 중' && open === 0 && !item.blockedByUndecided && br.state !== '머지 안 됨';
    if (ok) finished.push(item);
    if (open > 0 && item.ageDays > days && !waiting) stalled.push(item);
  }
  // git 밖 작업 폴더의 하위 폴더
  const tempRoot = path.join(repo, 'docs', '_temp');
  try {
    for (const e of fs.readdirSync(tempRoot, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const rel = `docs/_temp/${e.name}`;
      const refs = countRefs(repo, rel, canonical);
      const br = branchState(repo, e.name);
      const at = newestMtime(path.join(tempRoot, e.name));
      const item = { kind: '임시 작업 폴더', path: `${rel}/`, refs: refs.count, refFiles: refs.where, session: { state: '표지 없음' }, openBoxes: null, undecided: '-', blockedByUndecided: false, branch: br, ageDays: ageDays(at, now), ageSource: '폴더 안 최근 수정', waiting: false };
      workItems.push(item);
      if (item.refs === 0 && br.state !== '머지 안 됨') finished.push(item);
    }
  } catch { /* 임시 작업 폴더 없음 */ }

  // 부푼 문서
  const bloated = [];
  const bloatTargets = files.filter((f) => !work.includes(f) && !/(?:^|\/)worktrees\//.test(f) && (/<!--\s*decision-doc\s*-->/.test(texts.get(f)) || /decision|결정/i.test(path.basename(f)) || path.basename(f) === 'CLAUDE.md' || /(?:^|\/)rules\/[^/]+\.md$/.test(f)));
  for (const f of bloatTargets) {
    const text = texts.get(f);
    const bytes = Buffer.byteLength(text);
    const ev = sections(text).filter((s) => /근거/.test(s.title) && !sections(text).some((p) => p !== s && p.level < s.level && /근거/.test(p.title) && p.text.includes(s.text)));
    const evChars = ev.reduce((a, s) => a + s.text.length, 0);
    const quotes = (text.match(/「[^」\n]*」/g) ?? []).length;
    const longRows = lines(text).filter((l) => /^\s*\|/.test(l) && l.length > THRESHOLD.longRow).length;
    const ratio = text.length ? evChars / text.length : 0;
    const why = [];
    if (bytes > THRESHOLD.bytes) why.push(`${bytes}바이트`);
    if (bytes > 2000 && ratio > THRESHOLD.evidenceRatio) why.push(`근거 절 ${(ratio * 100).toFixed(0)}%`);
    if (quotes > THRESHOLD.quotes) why.push(`「」 ${quotes}개`);
    if (longRows >= THRESHOLD.longRowCount) why.push(`${THRESHOLD.longRow}자 넘는 표 행 ${longRows}개`);
    if (why.length) bloated.push({ path: f, bytes, evidenceRatio: Number(ratio.toFixed(2)), quotes, longRows, why });
  }

  // 끊긴 경로와 정본이 git 밖을 가리키는 줄
  const broken = [];
  const outside = [];
  const byName = new Set(files.map((f) => path.basename(f)));
  // 경로 끝 마디를 이어 붙인 모든 꼴(docs/a/b.md면 b.md, a/b.md, docs/a/b.md). 문서가 docs/ 같은 윗 폴더를 떼고 적은 경로도 같은 경로로 본다.
  const suffixes = new Set();
  const dirSuffixes = new Set();
  for (const f of listFiles(repo)) {
    const segs = f.split('/');
    for (let i = 0; i < segs.length; i++) suffixes.add(segs.slice(i).join('/'));
    for (let n = 1; n < segs.length; n++) for (let i = 0; i + n <= segs.length - 1; i++) dirSuffixes.add(segs.slice(i, i + n).join('/'));
  }
  const topDirs = new Set(listFiles(repo).filter((f) => f.includes('/')).map((f) => f.split('/')[0]));
  const rooted = (t) => t.startsWith('~/') || (t.startsWith('/') && t.startsWith(repo + '/')) || (!t.startsWith('/') && t.includes('/') && topDirs.has(t.replace(/^\.\//, '').split('/')[0]));
  const pending = [];
  for (const c of canonical) {
    let inFence = false;
    c.lines.forEach((l, i) => {
      if (/^\s*```/.test(l)) { inFence = !inFence; return; }
      if (inFence) return;
      for (const t of pathTokens(l)) {
        const bare = !t.includes('/');
        const hit = bare ? byName.has(t) || suffixes.has(t) || fs.existsSync(path.join(repo, path.dirname(c.rel), t)) : suffixes.has(t.replace(/^\.\//, '').replace(/\/$/, '')) || dirSuffixes.has(t.replace(/\/$/, '')) || !!resolveDocRef(repo, c.rel, t, [path.join(repo, path.dirname(c.rel)), repo, path.join(repo, 'docs'), path.join(repo, 'docs', path.dirname(path.relative('docs', c.rel)))]);
        const backticked = l.includes(`\`${t}`);
        // 확장자가 있는 백틱 경로 가운데 기준이 분명한 것(~/, 저장소 안 절대 경로, 저장소 맨 위 폴더로 시작하는 경로)만 끊김으로 본다.
        // 파일 이름만 적은 것과 기준 폴더를 모르는 상대 경로(스킬 폴더 기준의 scripts/ 등)는 맞는지 가를 수 없어 세지 않는다. 첫 실측에서 끊김의 2/3가 이 꼴의 오탐이었다.
        if (!hit && backticked && /\.[A-Za-z]{1,5}$/.test(t) && rooted(t)) broken.push({ doc: c.rel, line: i + 1, ref: t });
        if (!t.endsWith('/') && t.includes('/')) {
          const abs = t.startsWith('~/') ? path.join(os.homedir(), t.slice(2)) : t;
          const rels = path.isAbsolute(abs) ? (abs.startsWith(repo + '/') ? [path.relative(repo, abs)] : []) : [t, `docs/${t}`];
          for (const r of rels) pending.push({ doc: c.rel, line: i + 1, ref: t, rel: r });
        }
      }
    });
  }
  const ign = gitIgnored(repo, [...new Set(pending.map((p) => p.rel))]);
  for (const p of pending) {
    if (ign.has(p.rel) && !outside.some((o) => o.doc === p.doc && o.line === p.line && o.ref === p.ref)) outside.push({ doc: p.doc, line: p.line, ref: p.ref });
  }

  // 재기만 하는 지표
  const lineTotal = [...texts.values()].reduce((a, t) => a + (t ? t.replace(/\n$/, '').split('\n').length : 0), 0);
  const metrics = { [`문서 줄 수 ${repo}`]: lineTotal, ...Object.fromEntries(Object.entries(extraMetrics).map(([k, v]) => [`${k} ${repo}`, v])) };

  const backups = stackedBackups(repo);
  return { repo, workItems, finished, stalled, bloated, broken, outside, backups, metrics };
}

export function compareMetrics(metrics, historyFile) {
  const rows = historyRows(historyFile).filter((c) => c[1] === '지표');
  const rose = [];
  const fresh = [];
  for (const [key, value] of Object.entries(metrics)) {
    const prev = rows.filter((c) => c[2] === key).at(-1);
    if (!prev) { fresh.push({ key, value }); continue; }
    const before = Number(prev[3]);
    if (Number.isFinite(before) && value > before) rose.push({ key, before, value, since: prev[0] });
  }
  return { rose, fresh };
}

export function appendHistory(historyFile, rows) {
  if (!rows.length) return;
  fs.mkdirSync(path.dirname(historyFile), { recursive: true });
  const exists = fs.existsSync(historyFile) && read(historyFile).trim() !== '';
  fs.appendFileSync(historyFile, (exists ? '' : HISTORY_HEADER + '\n') + rows.map((r) => r.join('\t')).join('\n') + '\n');
}

// 회고 합계 기록(종류 「합계」)의 값 목록, 오래된 것부터.
export function totalsHistory(historyFile) {
  return historyRows(historyFile).filter((c) => c[1] === '합계').map((c) => ({ at: c[0], value: Number(c[3]), memo: c[4] ?? '' })).filter((r) => Number.isFinite(r.value));
}

// 합계가 앞 두 회고 값보다 줄지 않았으면 공통 뿌리 문장 없이는 넘기지 않는다. 앞 기록이 둘 안 되면 통과한다.
export function totalGate(total, prior, root) {
  if (prior.length < 2) return { ok: true, reason: '앞 기록이 둘 안 되어 문턱을 적용하지 않음' };
  const [p2, p1] = prior.slice(-2);
  if (total < p1.value || total < p2.value) return { ok: true, reason: `앞 두 회고(${p2.value}, ${p1.value}) 가운데 하나보다 줆` };
  if (root && root.trim()) return { ok: true, reason: '줄지 않았으나 공통 뿌리 문장이 있음' };
  return { ok: false, reason: `탐지 합계 ${total}가 앞 두 회고(${p2.value}, ${p1.value})보다 줄지 않았습니다. 낱건을 고치지 말고 공통 뿌리를 찾아 --root "<공통 뿌리 문장>"을 함께 주세요.` };
}

// 메모리 폴더 점검.
// since: 앞 회고 경계 시각(ms). 그 뒤에 커밋된 규칙만 어긋남 의심으로 낸다. 앞 회고가 이미 읽고 판정한 것을 회고마다 다시 읽지 않게 하려는 것이다.
export function analyzeMemory(dir, { repos = [], now = Date.now(), since = 0 } = {}) {
  const home = os.homedir();
  const out = { dir, broken: [], noRuleMark: [], index: null, orphanIndex: [], unlisted: [], expired: [], mismatch: [] };
  let names = [];
  try { names = fs.readdirSync(dir).filter((f) => f.endsWith('.md')); } catch { return out; }
  const indexText = read(path.join(dir, 'MEMORY.md'));
  if (indexText) out.index = { lines: lines(indexText).filter((l) => l.trim()).length, bytes: Buffer.byteLength(indexText) };
  const listed = new Set([...indexText.matchAll(/\]\(([^)\s]+\.md)\)/g)].map((m) => m[1]));
  for (const f of listed) if (!fs.existsSync(path.join(dir, f))) out.orphanIndex.push(f);
  const bases = [path.join(home, '.claude', 'docs'), path.join(home, '.claude'), ...repos, ...repos.map((r) => path.join(r, 'docs'))];
  const today = new Date(now).toISOString().slice(0, 10);
  const entryOf = (f) => lines(indexText).find((l) => l.includes(`(${f})`)) ?? '';
  for (const f of names) {
    if (f === 'MEMORY.md') continue;
    if (!listed.has(f)) out.unlisted.push(f);
    const full = path.join(dir, f);
    const text = read(full);
    const mtime = fs.statSync(full).mtimeMs;
    for (const [i, l] of lines(text).entries()) {
      for (const m of l.matchAll(/`([^`\n]+)`/g)) {
        const t = cleanToken(m[1]);
        if (!t || !/\.[A-Za-z]{1,5}$/.test(t) || !t.includes('/')) continue;
        const hit = t.startsWith('~/') || path.isAbsolute(t) ? fs.existsSync(t.startsWith('~/') ? path.join(home, t.slice(2)) : t) : bases.some((b) => fs.existsSync(path.join(b, t)));
        if (!hit) out.broken.push({ file: f, line: i + 1, ref: t });
      }
    }
    const ruleLine = lines(text + '\n' + entryOf(f)).filter((l) => /규칙은/.test(l));
    if (!ruleLine.length && !/문서 자리 없음/.test(text + entryOf(f))) out.noRuleMark.push(f);
    const exp = /유효:\s*(\d{4}-\d{2}-\d{2})/.exec(head(text, 12));
    if (exp && exp[1] < today) out.expired.push({ file: f, until: exp[1] });
    const seenRule = new Set();
    for (const l of ruleLine) {
      for (const t of pathTokens(l.slice(l.indexOf('규칙은')))) {
        if (!/\.md$/.test(t)) continue;
        const p = t.startsWith('~/') ? path.join(home, t.slice(2)) : path.isAbsolute(t) ? t : bases.map((b) => path.join(b, t)).find((x) => fs.existsSync(x));
        if (!p || !fs.existsSync(p)) continue;
        if (seenRule.has(p)) continue;
        seenRule.add(p);
        const ct = Number(gitOut(path.dirname(p), ['log', '-1', '--format=%ct', '--', p]).trim()) * 1000;
        if (ct && ct > mtime && ct > since) out.mismatch.push({ file: f, rule: p, ruleCommit: new Date(ct).toISOString().slice(0, 10), memoryModified: new Date(mtime).toISOString().slice(0, 10) });
      }
    }
  }
  return out;
}

export function countsOf(result) {
  const sum = (f) => result.repos.reduce((a, r) => a + f(r), 0);
  const mem = (f) => result.memories.reduce((a, m) => a + f(m), 0);
  const counts = {
    '다 쓴 기록 후보': sum((r) => r.finished.length),
    '멈춘 진행 기록': sum((r) => r.stalled.length),
    '부푼 문서': sum((r) => r.bloated.length),
    '끊긴 경로': sum((r) => r.broken.length),
    '정본이 git 밖을 가리킴': sum((r) => r.outside.length),
    '쌓인 백업': sum((r) => (r.backups ?? []).reduce((n, g) => n + g.older.length, 0)),
    '재기만 하는 지표': result.rose.length,
    '메모리 끊긴 경로': mem((m) => m.broken.length),
    '메모리 규칙 자리 표시 없음': mem((m) => m.noRuleMark.length),
    '메모리 목록 어긋남': mem((m) => m.orphanIndex.length + m.unlisted.length),
    '메모리 유효 기한 지남': mem((m) => m.expired.length),
    '메모리 규칙 어긋남 의심': mem((m) => m.mismatch.length),
  };
  return { counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
}

export function formatHealth(result, { days }) {
  const out = [];
  const { counts, total } = countsOf(result);
  for (const r of result.repos) {
    out.push(`\n== ${r.repo}`);
    out.push(`다 쓴 기록 후보 ${r.finished.length}개 (작업 기록 ${r.workItems.length}개 가운데. 조건: 정본이 가리키는 줄 0, 쓰는 중 아님, 열린 칸 0과 미정 절 비음, 이어진 브랜치가 머지 안 된 것 아님)`);
    for (const w of r.finished) out.push(`  - ${w.path}: 정본이 가리키는 줄 ${w.refs}, 세션 ${w.session.state}, 열린 칸 ${w.openBoxes ?? '-'}, 미정 절 ${w.undecided}, ${w.branch.branch} ${w.branch.state}, 나이 ${w.ageDays}일(${w.ageSource})`);
    out.push(`멈춘 진행 기록 ${r.stalled.length}개 (열린 칸이 있고 ${days}일 넘게 안 바뀜, 「기다림:」 줄 있으면 뺌)`);
    for (const w of r.stalled) out.push(`  - ${w.path}: 열린 칸 ${w.openBoxes}, ${w.ageDays}일 전(${w.ageSource}), 세션 ${w.session.state}`);
    out.push(`부푼 문서 ${r.bloated.length}개`);
    for (const b of r.bloated) out.push(`  - ${b.path}: ${b.why.join(', ')} (바이트 ${b.bytes}, 근거 절 ${(b.evidenceRatio * 100).toFixed(0)}%, 「」 ${b.quotes}, 긴 표 행 ${b.longRows})`);
    const bk = r.backups ?? [];
    out.push(`쌓인 백업 ${bk.reduce((n, g) => n + g.older.length, 0)}개 (같은 꼴 이름에서 가장 새것 하나만 남길 후보)`);
    for (const g of bk) out.push(`  - ${g.pattern}: ${g.older.length + 1}개, 남길 것 ${g.keep}`);
    out.push(`끊긴 경로 ${r.broken.length}개`);
    for (const b of r.broken.slice(0, 15)) out.push(`  - ${b.doc}:${b.line} \`${b.ref}\``);
    if (r.broken.length > 15) out.push(`  ... 외 ${r.broken.length - 15}개 (--json으로 전부)`);
    out.push(`정본이 git 밖을 가리키는 줄 ${r.outside.length}개`);
    for (const b of r.outside.slice(0, 15)) out.push(`  - ${b.doc}:${b.line} \`${b.ref}\``);
    if (r.outside.length > 15) out.push(`  ... 외 ${r.outside.length - 15}개 (--json으로 전부)`);
  }
  out.push('\n== 재기만 하는 지표');
  out.push(`앞 기록보다 늘어난 지표 ${result.rose.length}개`);
  for (const x of result.rose) out.push(`  - ${x.key}: ${x.before} -> ${x.value} (${x.since} 기록 대비)`);
  if (result.seeded.length) out.push(`  처음 보는 지표 ${result.seeded.length}개는 이번 값을 기록해 다음부터 견줍니다.`);
  for (const m of result.memories) {
    out.push(`\n== 메모리 ${m.dir}`);
    if (m.index) out.push(`목록 파일: ${m.index.lines}줄, ${m.index.bytes}바이트`);
    out.push(`끊긴 경로 ${m.broken.length}개`);
    for (const b of m.broken.slice(0, 15)) out.push(`  - ${b.file}:${b.line} \`${b.ref}\``);
    out.push(`「규칙은 <경로>」도 「문서 자리 없음」도 없는 파일 ${m.noRuleMark.length}개${m.noRuleMark.length ? ': ' + m.noRuleMark.slice(0, 10).join(', ') : ''}`);
    out.push(`목록 어긋남: 목록에만 있음 ${m.orphanIndex.length}${m.orphanIndex.length ? '(' + m.orphanIndex.join(', ') + ')' : ''}, 파일만 있음 ${m.unlisted.length}${m.unlisted.length ? '(' + m.unlisted.join(', ') + ')' : ''}`);
    out.push(`유효 기한 지남 ${m.expired.length}개${m.expired.map((e) => ` ${e.file}(${e.until})`).join('')}`);
    out.push(`가리키는 규칙이 더 새것(어긋남 의심, 판정은 사람) ${m.mismatch.length}개`);
    for (const x of m.mismatch.slice(0, 15)) out.push(`  - ${x.file}: 규칙 ${x.rule} 커밋 ${x.ruleCommit}, 메모리 수정 ${x.memoryModified}`);
  }
  out.push(`\n합계 ${total}건: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  return out.join('\n');
}
