/**
 * 설치와 업데이트 때 사용자 CLAUDE.md를 새 구조로 정리하도록 돕는 판정 모듈. 파일을 쓰지 않고 판정 결과(JSON)만 낸다.
 * 고치는 일은 사용자가 고른 뒤 다른 단계가 한다. 정책과 방법 가르기는 휴리스틱이라 후보로만 낸다.
 *
 * 사용법:
 *   node scripts/claudeMdTidy.js [--config-dir <폴더>] [--model <모델 ID>] [--limit <줄 수>]
 *   --limit가 없으면 <폴더>/subagent-system/config.json의 claudeMdLimitLines(없으면 80)를 쓰고, 같은 파일의 claudeMdKeptLines(정리를 마다한 줄 수)로 loaded.target(정리를 묻는지)을 정한다.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 기준 줄 수와 여유 줄 수다. 설치, 업데이트, 회고(subagent-retro.js)가 모두 이 값과 아래 claudeMdVerdict 하나로 판정한다. 문서의 「80줄」, 「20줄」과 함께 바꾼다.
export const DEFAULT_LIMIT_LINES = 80;
export const KEPT_MARGIN_LINES = 20;
export const KIT_ZONE_NAMES = ['subagent-system', 'claude-setup-kit extras'];
const MAX_IMPORT_DEPTH = 5;

const MARKER = /^\s*<!--\s*(.+?)\s+(시작|끝)\s*-->\s*$/;
const ZONE_EDIT = /^\s*(?:[-*]\s*)?구역\s*:/;
const FENCE = /^\s*(```|~~~)/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*)$/;

function scan(text) {
  const out = [];
  let fence = false;
  let section = '';
  text.split(/\r?\n/).forEach((raw, i) => {
    const isFence = FENCE.test(raw);
    if (isFence) fence = !fence;
    const heading = !fence && !isFence ? raw.match(HEADING) : null;
    if (heading) section = heading[1].trim();
    out.push({ n: i + 1, raw, inFence: fence || isFence, isHeading: Boolean(heading), section });
  });
  return out;
}

export function findKitZones(text) {
  const lines = scan(text);
  const zones = [];
  const open = new Map();
  for (const { n, raw, inFence } of lines) {
    const m = inFence ? null : raw.match(MARKER);
    if (!m || !KIT_ZONE_NAMES.includes(m[1])) continue;
    const name = m[1];
    if (m[2] === '시작') {
      if (open.has(name)) zones.push({ name, start: open.get(name), end: null, status: 'unclosed' });
      open.set(name, n);
    } else if (open.has(name)) {
      zones.push({ name, start: open.get(name), end: n, status: 'paired' });
      open.delete(name);
    } else {
      zones.push({ name, start: null, end: n, status: 'orphan-end' });
    }
  }
  for (const [name, start] of open) zones.push({ name, start, end: null, status: 'unclosed' });
  for (const z of zones) z.lineCount = z.status === 'paired' ? z.end - z.start + 1 : 0;

  const zoneEdits = lines
    .filter((l) => !l.inFence && ZONE_EDIT.test(l.raw))
    .map((l) => ({
      line: l.n,
      text: l.raw.trim(),
      section: l.section,
      kind: l.raw.includes('대신') ? 'replace' : l.raw.includes('더한다') ? 'add' : 'other',
      inZone: inPairedZone(zones, l.n),
    }));
  return { zones: zones.sort((a, b) => (a.start ?? a.end) - (b.start ?? b.end)), zoneEdits };
}

function inPairedZone(zones, n) {
  return zones.some((z) => z.status === 'paired' && n >= z.start && n <= z.end);
}

const POLICY_CUES = [
  ['목표', /목표/],
  ['목적', /목적|막으려|이루려/],
  ['우선순위', /우선(한다|이다|순위)|그쪽이 우선/],
  ['묻기', /묻는다|묻고|묻지|물어|확인받|승인|허락/],
  ['정책', /정책|원칙/],
  ['금지', /금지|하지 않는다/],
];

const METHOD_CUES = [
  ['절차', /절차|단계|순서/],
  ['형식', /형식|서식|양식|템플릿|표로|목록으로|번호를 붙/],
  ['도구', /명령|도구|스크립트|훅|스킬|서브에이전트|워크트리|린트|빌드|테스트|\bnpm\b|\bgit\b|커밋|푸시|머지/],
  ['경로', /`[^`]+`|~\/|\.(md|js|json|sh|py)\b|경로|파일|폴더/],
  ['분량', /\d+\s*줄|한 줄|줄 이내/],
];

export function classifyLines(text) {
  const { zones } = findKitZones(text);
  const out = [];
  for (const l of scan(text)) {
    const t = l.raw.trim();
    if (!t || l.inFence || l.isHeading || MARKER.test(l.raw) || ZONE_EDIT.test(l.raw) || /^-{3,}$/.test(t)) continue;
    if (inPairedZone(zones, l.n)) continue;
    const policyHits = POLICY_CUES.filter(([, re]) => re.test(t)).map(([name]) => name);
    const methodHits = METHOD_CUES.filter(([, re]) => re.test(t)).map(([name]) => name);
    let candidate = 'unknown';
    if (policyHits.length > methodHits.length) candidate = 'policy';
    else if (methodHits.length > policyHits.length) candidate = 'method';
    else if (policyHits.length > 0) candidate = 'mixed';
    out.push({ line: l.n, text: t, section: l.section, candidate, policyHits, methodHits });
  }
  return out;
}

const OPUS_5_5 = 'claude-opus-5-5';

const REMOVABLE = [
  ['thinking-directive', /\bthink\s+(hard|harder|carefully|deeply|very\s+hard)\b|\bultrathink\b|\bthink\s+step[- ]by[- ]step\b|\bstep[- ]by[- ]step\b|단계별로 (차근차근 )?생각|깊이 생각해|신중(하게|히) 생각|차근차근 생각/i],
  ['reasoning-echo', /show (me )?your (reasoning|thinking|thought)|explain your (reasoning|thought)|chain[- ]of[- ]thought|(생각|추론|사고) 과정을?\s*(모두|전부|그대로|자세히)?\s*(적|써|보여|출력|설명)/i],
  ['vague-design', /make it (look )?(pretty|beautiful|modern|nice|clean)\b|예쁘게|멋지게|세련되게|이쁘게/i],
];

export function modelApplies(model) {
  if (!model) return null;
  return model.includes(OPUS_5_5);
}

export function findRemovableLines(text, model) {
  const applies = modelApplies(model);
  if (applies === false) return { applies, lines: [] };
  const { zones } = findKitZones(text);
  const lines = [];
  for (const l of scan(text)) {
    if (!l.raw.trim() || l.inFence || inPairedZone(zones, l.n)) continue;
    const hit = REMOVABLE.find(([, re]) => re.test(l.raw));
    if (hit) lines.push({ line: l.n, text: l.raw.trim(), category: hit[0] });
  }
  return { applies, lines };
}

function stripFrontmatter(text) {
  const m = text.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  return m ? { front: m[1], body: text.slice(m[0].length) } : { front: null, body: text };
}

export function hasPathsFrontmatter(text) {
  const { front } = stripFrontmatter(text);
  return front !== null && /^paths\s*:/m.test(front);
}

export function countLoadedLines(text) {
  const { body } = stripFrontmatter(text);
  return body.split(/\r?\n/).filter((l) => l.trim() !== '').length;
}

function importTargets(text) {
  const out = [];
  for (const { raw, inFence } of scan(stripFrontmatter(text).body)) {
    if (inFence) continue;
    for (const m of raw.replace(/`[^`]*`/g, '').matchAll(/(?:^|\s)@(\S+)/g)) out.push(m[1].replace(/[.,;:)]+$/, ''));
  }
  return out;
}

function listMarkdown(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return listMarkdown(p);
    return e.isFile() && e.name.endsWith('.md') ? [p] : [];
  }).sort();
}

function resolveImport(target, fromFile, home) {
  return target.startsWith('~/') ? path.join(home, target.slice(2)) : path.resolve(path.dirname(fromFile), target);
}

// 읽을 수 없거나 없는 `@` 대상은 불려 오지 않는 것으로 보고 센 줄에 넣지 않는다.
function collectLoaded(file, kind, home, seen, depth = 0) {
  if (seen.has(file) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return [];
  seen.add(file);
  const text = fs.readFileSync(file, 'utf8');
  const entries = [{ path: file, kind, lines: countLoadedLines(text) }];
  if (depth >= MAX_IMPORT_DEPTH) return entries;
  for (const target of importTargets(text)) {
    entries.push(...collectLoaded(resolveImport(target, file, home), 'import', home, seen, depth + 1));
  }
  return entries;
}

export function alwaysLoadedLines({ configDir, limit = DEFAULT_LIMIT_LINES, home = os.homedir() }) {
  const seen = new Set();
  const files = collectLoaded(path.join(configDir, 'CLAUDE.md'), 'claude-md', home, seen);
  const skipped = [];
  for (const rule of listMarkdown(path.join(configDir, 'rules'))) {
    if (hasPathsFrontmatter(fs.readFileSync(rule, 'utf8'))) {
      skipped.push(rule);
      continue;
    }
    files.push(...collectLoaded(rule, 'rule', home, seen));
  }
  const total = files.reduce((s, f) => s + f.lines, 0);
  return { limit, total, over: total > limit, overBy: Math.max(0, total - limit), files, pathScopedRules: skipped };
}

// config.json 객체에서 기준 줄 수와 정리 뒤 남긴 줄 수를 읽는다. 정수가 아니거나 범위 밖이면 없는 것으로 본다(기준은 기본값, 남긴 줄 수는 null).
export function claudeMdSettingsOf(o) {
  return {
    limit: Number.isInteger(o?.claudeMdLimitLines) && o.claudeMdLimitLines > 0 ? o.claudeMdLimitLines : DEFAULT_LIMIT_LINES,
    keptLines: Number.isInteger(o?.claudeMdKeptLines) && o.claudeMdKeptLines >= 0 ? o.claudeMdKeptLines : null,
  };
}

function readClaudeMdSettings(configDir) {
  try {
    return claudeMdSettingsOf(JSON.parse(fs.readFileSync(path.join(configDir, 'subagent-system', 'config.json'), 'utf8')));
  } catch {
    return claudeMdSettingsOf(null);
  }
}

// 정리를 묻는지 가르는 규칙이다. 기준을 넘고, 정리를 마다한 적이 없거나 그때 줄 수(keptLines)보다 여유 줄 넘게 늘었을 때만 묻는다. 까닭: 마다한 사용자에게 같은 질문이 되풀이되지 않게.
export function claudeMdTarget(total, limit, keptLines) {
  const target = total > limit && (keptLines === null || total > keptLines + KEPT_MARGIN_LINES);
  let reason = '';
  if (!target) reason = total <= limit ? `${limit}줄 이하` : `정리 뒤 남긴 ${keptLines}줄에서 ${KEPT_MARGIN_LINES}줄 이내`;
  return { target, reason };
}

// 늘 읽히는 줄의 합에 기준과 마다함 처리를 붙인 판정이다. limit와 keptLines를 안 주면 설정 폴더의 subagent-system/config.json에서 읽는다(회고는 자기 설정 파일 값을 넘긴다).
export function claudeMdVerdict({ configDir, limit, keptLines, home }) {
  const settings = limit === undefined || keptLines === undefined ? readClaudeMdSettings(configDir) : null;
  const lim = limit ?? settings.limit;
  const kept = keptLines === undefined ? settings.keptLines : keptLines;
  const loaded = alwaysLoadedLines({ configDir, limit: lim, home });
  return { ...loaded, keptLines: kept, ...claudeMdTarget(loaded.total, lim, kept) };
}

const pad = (n) => String(n).padStart(2, '0');
const stampOf = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

// 파일을 만들지 않고 경로만 낸다. 이름 꼴과 겹침 처리는 kit-setup.js의 --backup-file과 같다.
export function backupPathFor(file, { now = new Date(), exists = fs.existsSync } = {}) {
  const base = `${file}.bak-claude-md-${stampOf(now)}`;
  let out = base;
  for (let i = 1; exists(out); i += 1) out = `${base}-${i}`;
  return out;
}

export function analyzeClaudeMd({ configDir, model, limit, keptLines, now, home } = {}) {
  const dir = path.resolve(configDir ?? process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude'));
  const file = path.join(dir, 'CLAUDE.md');
  const exists = fs.existsSync(file);
  const loaded = claudeMdVerdict({ configDir: dir, limit, keptLines, home });
  if (!exists) {
    return { file, exists, zones: [], zoneEdits: [], lines: [], loaded, opus55: { applies: modelApplies(model), lines: [] }, backupPath: null };
  }
  const text = fs.readFileSync(file, 'utf8');
  const { zones, zoneEdits } = findKitZones(text);
  const lines = classifyLines(text);
  return {
    file,
    exists,
    zones,
    zoneEdits,
    lines,
    summary: {
      policyCandidates: lines.filter((l) => l.candidate === 'policy').length,
      methodCandidates: lines.filter((l) => l.candidate === 'method').length,
      mixed: lines.filter((l) => l.candidate === 'mixed').length,
      unknown: lines.filter((l) => l.candidate === 'unknown').length,
      confirmed: false,
    },
    loaded,
    opus55: findRemovableLines(text, model),
    backupPath: backupPathFor(file, { now }),
  };
}

const USAGE = 'node scripts/claudeMdTidy.js [--config-dir <폴더>] [--model <모델 ID>] [--limit <줄 수>]';

function main(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = { '--config-dir': 'configDir', '--model': 'model', '--limit': 'limit' }[argv[i]];
    const value = argv[i + 1];
    if (!key || value === undefined) {
      console.error(USAGE);
      return 1;
    }
    opts[key] = key === 'limit' ? Number(value) : value;
  }
  if (opts.limit !== undefined && !(Number.isInteger(opts.limit) && opts.limit > 0)) {
    console.error(USAGE);
    return 1;
  }
  console.log(JSON.stringify(analyzeClaudeMd(opts), null, 2));
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
