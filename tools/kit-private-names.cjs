'use strict';

/**
 * 공개 키트 파일에 비공개 장치 이름이 새는지 보는 검사(키트 관리자용, 사용자 설치에는 깔리지 않는다).
 *
 * 왜: 설치본에만 있는 장치(로컬 조각)의 이름이 공개 저장소 파일에 적히면 비공개 장치가 드러난다. 사람이 읽어 거르면 빠지므로 기계가 본다.
 * 이름 목록 자체를 공개 저장소에 적으면 같은 문제라, 목록은 설치본 쪽에서 읽는다(이 파일은 이름을 하나도 담지 않는다).
 * 전제:
 *  - 설치본 설정 폴더(CLAUDE_CONFIG_DIR, 없으면 ~/.claude)에서 읽는다.
 *    1) subagent-system/local-bundles/<묶음>/*.part.json의 files 항목(글롭 제외)의 파일 이름에서 확장자를 뗀 것과 hooks[].name. 로컬 조각 정의가 늘면 목록이 저절로 따라 늘어난다.
 *    2) subagent-system/config.json의 privateNames(문자열 배열). 파일 이름과 다른 이름(환경 변수 등)을 키트 관리자가 직접 적는다.
 *  - 목록이 비어 있으면 검사할 것이 없으니 건너뛴다(로컬 조각을 아직 정의하지 않은 설치).
 *  - 이름 앞에 영문자나 숫자가 붙은 것은 다른 낱말의 일부로 보고 세지 않는다. 뒤에 붙은 것은 센다(이름_접미사 꼴의 변수까지 잡으려는 것이다).
 *  - 파일 이름에서 뽑은 이름 가운데 6글자 미만은 낱말과 겹칠 위험이 커서 건너뛴다(privateNames에 직접 적은 이름은 길이와 상관없이 쓴다).
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const MIN_LENGTH = 6;

const configDirOf = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

// 설치본에서 비공개 이름 목록을 읽는다. { names: string[], sources: string[] }
function privateNamesFrom(configDir = configDirOf()) {
  const names = new Set();
  const explicit = new Set();
  const sources = [];
  const sub = path.join(configDir, 'subagent-system');

  const config = readJson(path.join(sub, 'config.json'));
  if (Array.isArray(config?.privateNames)) {
    for (const n of config.privateNames) if (typeof n === 'string' && n.trim()) explicit.add(n.trim());
    sources.push('config.json privateNames');
  }

  const localDir = path.join(sub, 'local-bundles');
  let bundles = [];
  try {
    bundles = fs.readdirSync(localDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch {
    bundles = [];
  }
  for (const b of bundles) {
    let files = [];
    try {
      files = fs.readdirSync(path.join(localDir, b.name)).filter((f) => f.endsWith('.part.json'));
    } catch {
      files = [];
    }
    for (const f of files) {
      const part = readJson(path.join(localDir, b.name, f));
      if (!part) continue;
      for (const key of Array.isArray(part.files) ? part.files : []) {
        if (typeof key !== 'string' || /[*?[\]{}]/.test(key)) continue;
        names.add(path.basename(key).replace(/\.[^.]+$/, ''));
      }
      for (const h of Array.isArray(part.hooks) ? part.hooks : []) if (typeof h?.name === 'string') names.add(h.name);
    }
    if (files.length) sources.push(`local-bundles/${b.name}`);
  }

  // 파일 이름에서 뽑은 이름은 낱말과 겹칠 위험이 있어 짧은 것을 뺀다. 관리자가 직접 적은 이름은 그대로 쓴다.
  const usable = new Set([...names].filter((n) => n.length >= MIN_LENGTH));
  for (const n of explicit) usable.add(n);
  return { names: [...usable].sort(), sources };
}

// 저장소에 추적되는 파일과 아직 add 안 한 새 파일(git이 없으면 폴더 훑기). 읽을 수 없는 파일과 바이너리는 뺀다.
// walk가 참이면 git을 보지 않고 폴더를 직접 훑는다. 내보낸 트리가 어떤 저장소의 무시 폴더 안에 있으면 git 목록이 비어 0곳으로 통과하기 때문이다.
function trackedFiles(root, { walk: forceWalk = false } = {}) {
  const r = forceWalk ? { status: 1 } : spawnSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status === 0) return r.stdout.split('\0').filter(Boolean);
  const out = [];
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      const r2 = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r2);
      else out.push(r2);
    }
  };
  walk(root, '');
  return out;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 이름을 한 식으로 묶는다. 이름 안의 하이픈과 밑줄은 다른 글자로 본다(모양이 비슷한 공개 이름과 비공개 이름이 서로 다른 장치일 수 있어서).
function matcherFor(names) {
  const alts = names.map((n) => escapeRe(n));
  return alts.length ? new RegExp(`(?<![A-Za-z0-9])(?:${alts.join('|')})`, 'g') : null;
}

// 추적되는 파일에서 이름이 든 줄을 찾는다. 반환: [{ file, line, name }]
function scanTree(root, names, opts = {}) {
  const re = matcherFor(names);
  if (!re) return { hits: [], scanned: 0 };
  const hits = [];
  const files = trackedFiles(root, opts);
  for (const rel of files) {
    let text;
    try {
      const buf = fs.readFileSync(path.join(root, ...rel.split('/')));
      if (buf.includes(0)) continue;
      text = buf.toString('utf8');
    } catch {
      continue;
    }
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      re.lastIndex = 0;
      for (let m = re.exec(lines[i]); m; m = re.exec(lines[i])) hits.push({ file: rel, line: i + 1, name: m[0] });
    }
  }
  return { hits, scanned: files.length };
}

const scanTracked = (root, names, opts) => scanTree(root, names, opts).hits;

// 커밋 메시지 글에서 이름이 든 줄을 찾는다. 공개판으로 내보낼 메시지와 공개 저장소로 갈 커밋의 메시지는 파일과 같이 공개된다. 반환: [{ where, line, name }]
function scanText(text, names, where) {
  const re = matcherFor(names);
  if (!re) return [];
  const hits = [];
  text.split('\n').forEach((l, i) => {
    re.lastIndex = 0;
    for (let m = re.exec(l); m; m = re.exec(l)) hits.push({ where, line: i + 1, name: m[0] });
  });
  return hits;
}

// git 범위(예: public/main..HEAD)의 커밋 메시지를 모두 본다.
function scanCommitMessages(root, names, range) {
  const r = spawnSync('git', ['-C', root, 'log', '--format=%h%x1f%B%x1e', range], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git log ${range} 실패: ${r.stderr.trim()}`);
  return r.stdout.split('\x1e').map((c) => c.replace(/^\n/, '')).filter(Boolean).flatMap((c) => {
    const [hash, body = ''] = c.split('\x1f');
    return scanText(body, names, `커밋 ${hash}`);
  });
}

module.exports = { privateNamesFrom, scanTracked, scanTree, scanText, scanCommitMessages, trackedFiles, configDirOf, MIN_LENGTH };

if (require.main === module) {
  // 쓰는 법: kit-private-names.cjs [폴더] [--range <git 범위>] [--message-file <파일>] [--walk]
  // --walk는 git 목록 대신 폴더를 직접 훑고 본 파일 수를 찍는다(내보낸 트리 검사용).
  // --range와 --message-file은 공개로 나갈 커밋 메시지도 본다(키트를 공개판으로 내보낼 때). 비공개 저장소로만 가는 메시지는 보지 않아도 된다.
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const i = argv.indexOf(name);
    if (i < 0) return undefined;
    const v = argv[i + 1];
    argv.splice(i, 2);
    return v;
  };
  const range = flag('--range');
  const messageFile = flag('--message-file');
  const walkIdx = argv.indexOf('--walk');
  const walk = walkIdx >= 0;
  if (walk) argv.splice(walkIdx, 1);
  const root = path.resolve(argv[0] ?? path.join(__dirname, '..'));
  const { names, sources } = privateNamesFrom();
  if (!names.length) {
    process.stdout.write('비공개 이름 목록이 없어 검사할 것이 없습니다(로컬 조각 정의나 config.json privateNames가 없음)\n');
    process.exit(0);
  }
  const { hits, scanned } = scanTree(root, names, { walk });
  for (const h of hits) process.stdout.write(`${h.file}:${h.line} ${h.name}\n`);
  process.stdout.write(`비공개 이름 ${names.length}개(${sources.join(', ')}): 공개 파일에서 ${hits.length}곳\n`);
  if (walk) process.stdout.write(`본 파일 ${scanned}개\n`);
  const msgHits = [];
  if (range) msgHits.push(...scanCommitMessages(root, names, range));
  if (messageFile) msgHits.push(...scanText(fs.readFileSync(messageFile, 'utf8'), names, path.basename(messageFile)));
  if (range || messageFile) {
    for (const h of msgHits) process.stdout.write(`${h.where}:${h.line} ${h.name}\n`);
    process.stdout.write(`커밋 메시지에서 ${msgHits.length}곳\n`);
  }
  process.exit(hits.length || msgHits.length ? 1 : 0);
}
