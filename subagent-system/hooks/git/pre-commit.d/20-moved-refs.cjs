'use strict';

/**
 * 옮기거나 지운 파일의 옛 경로 검사(routing 묶음의 git 조각). 스테이징된 변경이 지우거나 이름을 바꾼 파일의 옛 경로를 아직 가리키는
 * 문서, 설정, 스크립트(이 저장소와 사용 기록에 나오는 다른 프로젝트 저장소)와 그 프로젝트 메모리가 있으면 커밋을 막는다.
 * 왜: 설정 폴더 안만 찾아 고치고 커밋하면, 그 경로를 쓰는 프로젝트 저장소 문서와 메모리가 끊겨도 회고 때에야 드러났다(한 번에 문서 26곳과 메모리 12곳).
 * 전제:
 *  - 옛 경로는 `git diff --cached --name-status -M`의 삭제(D)와 이름 바꿈(R)에서 뽑는다. 지우거나 옮긴 게 없으면 바로 통과한다.
 *  - 가리키는 꼴은 저장소 기준 상대 경로(이 저장소 안에서만), 홈 기준 `~/…` 경로, 절대 경로다. 파일 이름만으로는 찾지 않는다(같은 이름이 흔해 오탐이 난다).
 *  - 이 저장소는 스테이징된 내용(`git grep --cached`)으로, 다른 저장소는 작업 트리의 추적 파일로 본다. 다른 저장소의 docs/_temp, node_modules, .claude/worktrees는 뺀다.
 *  - 다른 저장소는 사용 기록(subagent-usage.tsv)의 프로젝트 열에서 뽑는다. 기록이 없으면 이 저장소와 그 메모리만 본다.
 *  - 메모리는 <설정 폴더>/projects/<저장소 경로의 영숫자 아닌 글자를 -로 바꾼 이름>/memory/*.md 이다.
 *  - 정말 끊겨도 되면 KIT_ALLOW_MOVED_REFS=1을 붙여 커밋한다(목록은 찍고 통과).
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const TEXT_SPECS = ['*.md', '*.json', '*.js', '*.cjs', '*.mjs', '*.sh'];
const OTHER_EXCLUDES = [':(exclude)docs/_temp', ':(exclude)node_modules', ':(exclude).claude/worktrees', ':(exclude,glob)**/node_modules/**'];
// 기록물(변경 내역, 작업 기록, 사용 기록)은 그때의 경로를 이력으로 적어 둔 곳이라 고칠 대상이 아니다. 세면 옮길 때마다 헛걸린다(설정 저장소 실측 32곳).
const RECORD_EXCLUDES = [':(exclude,glob)**/CHANGES*.md', ':(exclude)docs/plan/work', ':(exclude,glob)**/records/**', ':(exclude)docs/PROPOSALS.md'];
const PATH_CHAR = /[A-Za-z0-9_-]/;

const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });

// 스테이징된 변경에서 지운 파일과 이름을 바꾼 파일의 옛 경로.
function stagedOlds(repoTop) {
  const r = git(repoTop, ['diff', '--cached', '--name-status', '-M', '-z']);
  if (r.status !== 0) return [];
  const parts = r.stdout.split('\0');
  const olds = [];
  for (let i = 0; i < parts.length; i++) {
    const status = parts[i];
    if (!status) continue;
    if (status[0] === 'R' || status[0] === 'C') {
      if (status[0] === 'R') olds.push(parts[i + 1]);
      i += 2;
    } else {
      if (status[0] === 'D') olds.push(parts[i + 1]);
      i += 1;
    }
  }
  return olds.filter(Boolean);
}

const realOf = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};

// 옛 경로를 가리키는 꼴. own이 true면(이 저장소 안) 상대 경로도 본다.
function formsOf(old, repoTop, home) {
  const top = realOf(repoTop);
  const forms = [{ text: path.join(top, old), own: false }, { text: path.join(path.resolve(repoTop), old), own: false }];
  const homeReal = realOf(home);
  if (top === homeReal || top.startsWith(homeReal + path.sep)) forms.push({ text: `~/${path.relative(homeReal, top)}/${old}`, own: false });
  forms.push({ text: old, own: true });
  const seen = new Set();
  return forms.filter((f) => !seen.has(f.text) && seen.add(f.text));
}

// 줄에 꼴이 경계에 맞게 들어 있는지. 앞뒤가 경로 글자면 다른 경로의 일부라 뺀다(`docs/a.md.bak`, `other/docs/a.md`).
function lineHas(line, form) {
  let from = 0;
  for (;;) {
    const at = line.indexOf(form.text, from);
    if (at < 0) return false;
    const before = at === 0 ? '' : line[at - 1];
    const after = line[at + form.text.length] ?? '';
    const afterNext = line[at + form.text.length + 1] ?? '';
    const beforeOk = !PATH_CHAR.test(before) && (!form.own || (before !== '/' && before !== '.'));
    const afterOk = !PATH_CHAR.test(after) && !(after === '.' && PATH_CHAR.test(afterNext)) && after !== '/';
    if (beforeOk && afterOk) return true;
    from = at + 1;
  }
}

// git grep 한 번. treeish가 있으면 그 시점의 트리, cached면 인덱스, 아니면 작업 트리. 결과는 {file, line, text} 목록.
function grepRepo(repo, texts, { treeish = null, cached = false, excludes = [] } = {}) {
  if (texts.length === 0) return [];
  const args = ['grep', '-n', '-F', '-I', '--null'];
  if (cached) args.push('--cached');
  for (const t of texts) args.push('-e', t);
  if (treeish) args.push(treeish);
  args.push('--', ...TEXT_SPECS, ...excludes);
  const r = git(repo, args);
  if (r.status !== 0 && r.status !== 1) return [];
  const hits = [];
  for (const row of r.stdout.split('\n')) {
    if (!row) continue;
    const nul = row.indexOf('\0');
    if (nul < 0) continue;
    let file = row.slice(0, nul);
    if (treeish && file.startsWith(`${treeish}:`)) file = file.slice(treeish.length + 1);
    const rest = row.slice(nul + 1);
    const nul2 = rest.indexOf('\0');
    if (nul2 < 0) continue;
    hits.push({ file, line: Number(rest.slice(0, nul2)), text: rest.slice(nul2 + 1) });
  }
  return hits;
}

function memoryDirOf(configDir, repo) {
  return path.join(configDir, 'projects', realOf(repo).replace(/[^A-Za-z0-9]/g, '-'), 'memory');
}

function grepMemoryAll(dir, perOld) {
  let names;
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.md'));
  } catch {
    return [];
  }
  const hits = [];
  for (const n of names) {
    let text;
    try {
      text = fs.readFileSync(path.join(dir, n), 'utf8');
    } catch {
      continue;
    }
    text.split('\n').forEach((l, i) => {
      for (const { old, forms } of perOld) if (forms.some((f) => !f.own && lineHas(l, f))) hits.push({ old, file: path.join(dir, n), line: i + 1 });
    });
  }
  return hits;
}

// 사용 기록의 프로젝트 열에서 (워크트리 꼬리를 뗀) 저장소 폴더를 뽑는다.
function projectsFromUsage(recordsDir) {
  let text;
  try {
    text = fs.readFileSync(path.join(recordsDir, 'subagent-usage.tsv'), 'utf8');
  } catch {
    return [];
  }
  const out = new Set();
  for (const row of text.split(/\r?\n/)) {
    const col = row.split('\t')[1];
    if (!col || !path.isAbsolute(col)) continue;
    out.add(col.replace(/[\\/]\.claude[\\/]worktrees[\\/][^\\/]+([\\/].*)?$/, ''));
  }
  return [...out].filter((p) => fs.existsSync(path.join(p, '.git')));
}

/**
 * 판정. olds는 옛 경로 목록.
 * @returns {{old:string, where:string, line:number}[]} 가리키는 곳 목록(없으면 빈 배열)
 */
function judge({ olds, repoTop, configDir, home = os.homedir(), recordsDir, ownTreeish = null, repos }) {
  const found = [];
  const seen = new Set();
  const add = (old, file, line) => {
    const key = `${old}\0${file}\0${line}`;
    if (!seen.has(key)) {
      seen.add(key);
      found.push({ old, where: file, line });
    }
  };
  const ownReal = realOf(repoTop);
  const others = (repos ?? [...projectsFromUsage(recordsDir), configDir]).filter((p) => p && fs.existsSync(path.join(p, '.git')) && realOf(p) !== ownReal);
  const uniqueOthers = [...new Map(others.map((p) => [realOf(p), p])).values()];
  // 옛 경로마다 grep을 따로 돌리면 경로 수만큼 느려지므로 저장소마다 한 번에 찾고 줄마다 어느 옛 경로인지 가린다.
  const perOld = olds.map((old) => ({ old, forms: formsOf(old, repoTop, home) }));
  const allTexts = (outerOnly) => perOld.flatMap(({ forms }) => forms.filter((f) => !outerOnly || !f.own).map((f) => f.text));
  for (const h of grepRepo(repoTop, allTexts(false), ownTreeish ? { treeish: ownTreeish, excludes: RECORD_EXCLUDES } : { cached: true, excludes: RECORD_EXCLUDES })) {
    for (const { old, forms } of perOld) if (forms.some((f) => lineHas(h.text, f))) add(old, h.file, h.line);
  }
  for (const repo of [repoTop, ...uniqueOthers]) {
    if (repo !== repoTop) {
      for (const h of grepRepo(repo, allTexts(true), { excludes: [...OTHER_EXCLUDES, ...RECORD_EXCLUDES] })) {
        for (const { old, forms } of perOld) if (forms.some((f) => !f.own && lineHas(h.text, f))) add(old, path.join(repo, h.file), h.line);
      }
    }
    if (configDir) {
      for (const h of grepMemoryAll(memoryDirOf(configDir, repo), perOld)) add(h.old, h.file, h.line);
    }
  }
  return found;
}

function run(ctx) {
  if (!ctx.repoTop) return null;
  const olds = stagedOlds(ctx.repoTop);
  if (olds.length === 0) return null;
  const recordsDir = ctx.recordsDir ?? process.env.SUBAGENT_RECORDS_DIR ?? path.join(ctx.configDir, 'subagent-system', 'records');
  const found = judge({ olds, repoTop: ctx.repoTop, configDir: ctx.configDir, home: ctx.home ?? os.homedir(), recordsDir });
  if (found.length === 0) return null;
  const list = found.map((f) => `  ${f.old} → ${f.where}:${f.line}`).join('\n');
  if (process.env.KIT_ALLOW_MOVED_REFS === '1') {
    process.stderr.write(`kit git 훅: 옮기거나 지운 파일의 옛 경로를 아직 가리키는 곳이 있지만 KIT_ALLOW_MOVED_REFS=1이라 통과합니다.\n${list}\n`);
    return null;
  }
  return `kit git 훅: 옮기거나 지운 파일의 옛 경로를 아직 가리키는 곳이 있어 커밋을 막았습니다.\n${list}\n새 자리로 고치거나 그 저장소 주인 세션에 알린 뒤 다시 시도합니다. 정말 끊겨도 되면 KIT_ALLOW_MOVED_REFS=1을 붙여 커밋합니다.`;
}

module.exports = { name: 'moved-refs', run, judge, stagedOlds, formsOf, lineHas, grepRepo, grepMemoryAll, memoryDirOf, projectsFromUsage };
