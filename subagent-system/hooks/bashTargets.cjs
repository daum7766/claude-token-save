'use strict';

/**
 * 셸 명령이 고치는 대상 풀이. 명령 하나(Bash 도구 입력)를 받아 쓰거나 지우거나 옮기는 대상 경로 목록을 돌려준다.
 * - 경로가 있으면 경로를, 대상 없는 바꿈(바꾸는 git, 설치, 배포)은 '*', 대상을 모르는 바꿈(xargs로 넘긴 지우기)은 '?'를 넣는다.
 * - 셸 글(리다이렉트, mv, cp, tee, sed -i, perl -pi 등)과 해석기에 넘긴 코드(python3 -c, node -e, heredoc 본문의 open(p,'w'), writeFileSync)를 함께 본다.
 * - 같은 명령 안의 cd, 변수 대입, for 반복 변수, 하위 셸 괄호를 따라가 상대 경로를 그 폴더 아래로 본다.
 * 왜: 파일 고침의 대부분이 Edit가 아니라 셸(sed -i, python heredoc)로 일어나, 고칠 파일을 보고 판정하는 훅(되고침 신호)이 셸 명령의 대상을 알아야 한다.
 * 전제: 셸을 실제로 풀지 않는 어림이다. 못 푼 명령 치환은 '§', 따옴표 글은 'Q'로 남는다. 상대 경로는 첫 cd가 없으면 상대인 채로 돌려주고 부르는 쪽이 작업 폴더로 푼다.
 */

const path = require('node:path');

// 실행 스킬의 진행 장부(.superpowers/, docs/superpowers/)는 _temp처럼 git이 보지 않는 프로세스 산출물이다. git이 보지 않는 자리 전체로 넓히지 않는 것은 .env 같은 설정 파일이 들기 때문이다.
const SCRATCH = /^(?:\/private)?\/tmp\/|^\/var\/folders\/|\/scratchpad(?:\/|$)|^\$TMPDIR\b|^\$\{TMPDIR|\/subagent-system\/records\/|(?:^|\/)_temp(?:\/|$)|(?:^|\/)(?:\.superpowers|docs\/superpowers)(?:\/|$)/;  // 폴더 자체를 만드는 mkdir -p docs/_temp도 같은 자리
const MEMORY = /\.claude\/projects\/[^/\s'"]+\/memory\//;
const FREE = (p) => p === '/dev/null' || SCRATCH.test(p) || MEMORY.test(p);

// 명령을 &&, ||, ;, 줄바꿈으로 나누되 따옴표 안과 heredoc 본문은 나누지 않는다. 스크립트 본문 한쪽 줄에 경로를 두고
// 다른 줄에서 쓰는 꼴(p='docs/plan/..' 다음 줄 open(p,'w'))을 한 조각으로 봐야 놓치지 않는다.
// 조각마다 { text: 앞뒤 공백 뺀 조각, shell: 따옴표 안과 heredoc 본문을 지운 셸 글, code: 해석기에 넘긴 코드(-c, -e, heredoc 본문) }.
// 큰따옴표 글의 끝. 안의 $( ) 명령 치환 속 따옴표는 따로 짝지어 건너뛴다("$(node -e "...")" 꼴).
function endOfDouble(cmd, i) {
  let j = i + 1;
  while (j < cmd.length) {
    if (cmd[j] === '\\') { j += 2; continue; }
    if (cmd.startsWith('$(', j)) { j = endOfSubst(cmd, j + 2); continue; }
    if (cmd[j] === '"') return j;
    j++;
  }
  return cmd.length;
}
function endOfSubst(cmd, k) {
  let depth = 1;
  while (k < cmd.length) {
    const c = cmd[k];
    if (c === '\\') { k += 2; continue; }
    if (c === "'") { const e = cmd.indexOf("'", k + 1); k = e < 0 ? cmd.length : e + 1; continue; }
    if (c === '"') { k = endOfDouble(cmd, k) + 1; continue; }
    if (c === '(') depth++;
    if (c === ')' && --depth === 0) return k + 1;
    k++;
  }
  return cmd.length;
}
function segments(cmd) {
  const out = [];
  let cur = { text: '', shell: '', code: [], sub: [], here: null };
  const push = () => { if (cur.text.trim()) out.push({ text: cur.text.trim(), shell: cur.shell.trim(), code: cur.code, sub: cur.sub, here: cur.here }); cur = { text: '', shell: '', code: [], sub: [], here: null }; };
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (c === '\\' && i + 1 < cmd.length) { cur.text += c + cmd[i + 1]; cur.shell += cmd[i + 1] === '\n' ? ' ' : 'E'; i++; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1;
      if (c === '"') j = endOfDouble(cmd, i);
      else while (j < cmd.length && cmd[j] !== "'") j++;
      const inner = cmd.slice(i + 1, j);
      cur.text += cmd.slice(i, j + 1);
      // 따옴표 글은 셸 글에서 지우되, 리다이렉트나 cp 대상일 수 있어 공백 없는 자리표로 남긴다.
      // 빈 따옴표('')는 아무것도 남기지 않는다(sed -i '' 꼴). 임시 폴더를 묻는 명령 치환은 임시 자리로 본다.
      // 큰따옴표 안 $(…)도 따옴표 밖처럼 한 토막으로 본다(「$S/before/$(dirname $f)」).
      const inq = c === '"' ? inner.replace(/\$\((?!\()[^()]*\)/g, (m) => (/^\$\(\s*mktemp\b/.test(m) ? '/tmp/mktemp' : /^\$\(\s*pwd\s*\)$/.test(m) ? '$PWD' : '§')) : inner;
      const plain = /^[^\s<>|;&()]+$/.test(inq);
      const before = cur.shell;
      // 공백 든 경로(「…/scratchpad/개인 메모.md」, 「$S/a b」)는 공백만 _로 바꿔 경로로 남긴다. Q로 지우면 입력 폴더(저장소) 아래로 보여 임시 자리 쓰기를 막았다.
      const spacedPath = /^(?:[/~]|\$\{?\w+\}?\/)/.test(inq) && !/[<>|;&()`\n]/.test(inq);
      cur.shell += inner === '' ? '' : plain ? inq : spacedPath ? inq.replace(/\s/g, '_') : /tmpdir\(\)|\$\{?TMPDIR|mktemp/.test(inner) ? '/tmp/Q' : 'Q';
      if (/\b(?:python3?|node|perl|ruby)\b[^|;&]*\s-[ce]\s*$/.test(before)) cur.code.push(inner);
      // bash -c '…' 안의 명령은 셸 글로 다시 판정한다.
      if (/\b(?:bash|sh|zsh)\s+-c\s*$/.test(before)) cur.sub.push(inner);
      i = j;
      continue;
    }
    const h = /^<<-?\s*(['"]?)([\w.-]+)\1[^\n]*\n/.exec(cmd.slice(i));
    if (h) {
      const rest = cmd.slice(i + h[0].length);
      const end = new RegExp(`(^|\\n)\\s*${h[2].replace(/[.-]/g, '\\$&')}\\s*(\\n|$)`).exec(rest);
      const body = end ? rest.slice(0, end.index) : rest;
      const used = end ? end.index + end[0].length : rest.length;
      cur.text += h[0] + body;
      // 같은 줄에서 heredoc 뒤에 이어진 셸 글(> 대상 등)은 셸 글에 남긴다.
      cur.shell += ` ${h[0].slice(h[0].indexOf(h[2]) + h[2].length + (h[1] ? 1 : 0)).trim()} `;
      if (/\b(?:python3?|node|perl|ruby|bash|sh|zsh)\b/.test(cur.shell)) cur.code.push(body);
      cur.here = body;
      i += h[0].length + used - 1;
      if (end && end[2] === '\n') { push(); }
      continue;
    }
    // 따옴표 밖 $(…)는 한 토막으로 본다. 낱말로 쪼개면 「$S/o/$(dirname $f)」의 「$f)」가 대상이 됐다. $(pwd)는 지금 폴더, $(mktemp …)는 임시 자리다.
    if (cmd.startsWith('$(', i) && !cmd.startsWith('$((', i)) {
      const e = endOfSubst(cmd, i + 2);
      const inner = cmd.slice(i + 2, e - 1).trim();
      cur.text += cmd.slice(i, e);
      cur.shell += inner === 'pwd' ? '$PWD' : /^mktemp\b/.test(inner) ? '/tmp/mktemp' : '§';
      i = e - 1;
      continue;
    }
    const two = cmd.slice(i, i + 2);
    if (two === '&&' || two === '||') { push(); i++; continue; }
    if (c === ';' || c === '\n') { push(); continue; }
    cur.text += c;
    cur.shell += c;
  }
  push();
  return out;
}

// 셸 글에서 리다이렉트 대상. 2>&1, >&2 같은 fd 복제와 =>, ->, 숫자는 뺀다.
function redirectTargets(shell) {
  const out = [];
  for (const m of shell.matchAll(/(?<![>&\d=\-<])\d*>{1,2}(?!&)\s*([^\s;|&<>()]+)|&>{1,2}\s*([^\s;|&<>()]+)/g)) {
    m[1] = m[1] || m[2];
    if (/^[\d.]+$/.test(m[1]) || m[1] === '/dev/null') continue;
    out.push(m[1]);
  }
  return out;
}

// 하위 셸 괄호에 붙은 낱말(「(npm」, 「$?)」)은 괄호를 떼어 명령 낱말로 읽는다.
const words = (shell) => shell.split(/\s+/).map((w) => w.replace(/^\(+/, '').replace(/\)+$/, (m) => (w.includes('(') ? m : ''))).filter(Boolean);
// 인자: 옵션과 리다이렉트 토막(2>/dev/null, >out)은 뺀다(리다이렉트는 redirectTargets가 따로 본다).
// 맨 「*」 인자는 지금 폴더의 파일들이라 ./*로 바꾼다. 대상 없는 바꿈 표지 '*'와 겹쳐 임시 폴더의 rm -f *를 막았다.
const args = (ws) => ws.filter((w) => !w.startsWith('-') && !/^\d*>{1,2}/.test(w) && !/^\d*<{1,3}/.test(w)).map((w) => (w === '*' ? './*' : w));
// 셸 글로 본 바꿈. 대상 경로가 있으면 경로 목록을, 대상이 없는 바꿈(git, 설치, 배포)은 ['*'], 대상을 모르는 바꿈(xargs rm)은 ['?']를 돌려준다.
const GIT_READ = /^(?:status|log|show|diff|grep|blame|ls-files|ls-tree|ls-remote|show-ref|for-each-ref|rev-parse|rev-list|merge-base|cat-file|describe|shortlog|reflog|remote(?!\s+(?:add|remove|rm|rename|set-url|set-head|set-branches|prune))|fetch|check-ignore|check-attr|count-objects|var|worktree\s+list|stash\s+(?:list|show)|help|version)\b/;
function gitWrites(r) {
  while (r.length && (/^(?:-C|-c|--git-dir|--work-tree)$/.test(r[0]) || /^--(?:no-pager|git-dir=|work-tree=|no-optional-locks|paginate)/.test(r[0]) || r[0] === '-P')) r = r.slice(/^(?:-C|-c|--git-dir|--work-tree)$/.test(r[0]) ? 2 : 1);
  const sub = r.join(' ');
  if (!sub || GIT_READ.test(sub) || /^(?:--version|--help|--exec-path|-v)\b/.test(sub)) return false;
  if (/^branch\b/.test(sub)) return /\s-(?:[dDmMcC]|-delete|-move|-copy|-set-upstream-to|u)\b/.test(` ${r.slice(1).join(' ')}`) || args(r.slice(1)).length > 0 && !/\s-(?:a|r|v|vv|l|-list|-contains|-merged|-no-merged|-show-current)\b/.test(` ${r.slice(1).join(' ')}`);
  if (/^tag\b/.test(sub)) return args(r.slice(1)).length > 0 && !/\s-(?:l|-list|n\d*|-contains|-points-at)\b/.test(` ${r.slice(1).join(' ')}`);
  if (/^config\b/.test(sub)) return /\s--(?:unset|add|replace-all|rename-section|remove-section)\b/.test(` ${sub}`) || args(r.slice(1)).length >= 2;
  if (/^stash\b/.test(sub)) return true;
  return true;
}
const LINT = /\b(?:eslint|prettier|biome|stylelint|ruff|black|isort|gofmt|rubocop|lint|format)\b/;
// 한 파이프 단계의 바꿈 대상. 명령 낱말은 단계 첫머리(앞의 VAR=값, sudo, time, command, env는 건너뜀)만 본다.
function stageTargets(ws) {
  let k = 0;
  while (k < ws.length && (/^\w+=/.test(ws[k]) || /^(?:time|command|env|nohup|exec|do|then|else|\{|\(|!)$/.test(ws[k]))) k++;
  // timeout 300, nice -n 5, sudo -u x 같은 접두와 npx, bunx, pnpm dlx, npm exec 실행기는 건너뛰고 안의 명령을 본다.
  for (let again = true; again && k < ws.length;) {
    again = false;
    if (ws[k] === 'timeout' || ws[k] === 'nice') { const t = ws[k] === 'timeout'; k++; while (k < ws.length && /^-/.test(ws[k])) k += /^-[nsk]$/.test(ws[k]) ? 2 : 1; if (t) k++; again = true; }
    else if (ws[k] === 'sudo') { k++; while (k < ws.length && /^-/.test(ws[k])) k += /^-[ugCD]$/.test(ws[k]) ? 2 : 1; again = true; }
    else if (/^(?:npx|bunx)$/.test(ws[k])) { k++; while (k < ws.length && /^-/.test(ws[k])) k++; again = true; }
    else if ((ws[k] === 'pnpm' && ws[k + 1] === 'dlx') || (ws[k] === 'npm' && ws[k + 1] === 'exec')) { k += 2; if (ws[k] === '--') k++; again = true; }
    else if (/^\w+=/.test(ws[k]) || /^(?:time|command|env|nohup|exec|do|then|else|\{|\(|!)$/.test(ws[k])) { k++; again = true; }
  }
  let w = (ws[k] || '').replace(/^\/(?:usr\/(?:local\/)?|opt\/homebrew\/)?s?bin\//, '');
  if (!w) return [];
  let rest = ws.slice(k + 1);
  if (w === 'xargs') {
    // xargs 뒤 바꾸는 명령은 대상이 입력에서 오므로 모른다.
    while (rest.length && rest[0].startsWith('-')) rest = rest.slice(rest[0].length === 2 && /^-[InLPd]$/.test(rest[0]) ? 2 : 1);
    if (/^(?:rm|mv|cp|sed|perl|chmod|touch|mkdir|unlink|truncate|ln|rimraf)$/.test(rest[0] || '')) {
      if (/^(?:sed|perl)$/.test(rest[0]) && !rest.some((x) => /^-[a-zA-Z]*i/.test(x))) return [];
      return ['?'];
    }
    return [];
  }
  if (w === 'find') {
    if (!rest.some((x) => x === '-delete' || (x === '-exec' && /^(?:rm|mv|sed)$/.test(rest[rest.indexOf(x) + 1] || '')))) return [];
    // 지우는 find는 시작 경로가 대상이다(임시 폴더 정리를 막지 않게).
    const start = rest.find((x) => !x.startsWith('-'));
    return [start && start !== 'Q' ? start : '?'];
  }
  if (w === 'curl' || w === 'wget') {
    const i = rest.findIndex((x) => (w === 'curl' ? /^(?:-o|--output)$/ : /^(?:-O|--output-document)$/).test(x));
    if (i >= 0) return [rest[i + 1] || '?'];
    return (w === 'wget' || rest.some((x) => /^(?:-O|--remote-name)$/.test(x))) ? ['?'] : [];
  }
  if (w === 'unzip' || w === 'tar') {
    if (w === 'tar' && !rest.some((x) => /^-?[a-zA-Z]*x/.test(x))) return [];
    const i = rest.findIndex((x) => x === (w === 'unzip' ? '-d' : '-C'));
    return [i >= 0 ? rest[i + 1] || '?' : '?'];
  }
  if (w === 'brew' && /^(?:install|uninstall|upgrade|reinstall|remove|tap|link|unlink)$/.test(rest[0] || '')) return ['*'];
  if (/^python3?$/.test(w) && rest[0] === '-m' && /^pip3?$/.test(rest[1] || '') && /^(?:install|uninstall)$/.test(rest[2] || '')) return ['*'];
  // git archive는 저장소를 읽어 내보내기만 한다. -o, --output이 있으면 그 경로가 대상이다.
  if (w === 'git') {
    let r = rest;
    while (r.length && /^-/.test(r[0])) r = r.slice(/^(?:-C|-c|--git-dir|--work-tree)$/.test(r[0]) ? 2 : 1);
    if (r[0] === 'archive') { const i = r.findIndex((x) => x === '-o' || x === '--output'); const eq = r.find((x) => x.startsWith('--output=')); return i >= 0 ? [r[i + 1] || '?'] : eq ? [eq.slice(9)] : []; }
    if (!gitWrites(rest)) return [];
    // 바꾸는 git은 그 저장소 자리가 대상이다: -C 폴더, clone과 init은 만들 폴더, 그 밖은 지금 폴더(.). 임시 사본 저장소의 commit을 막지 않게.
    // push와 원격을 바꾸는 명령은 자리와 무관하게 바꿈이다.
    if (/^(?:push|remote|submodule|worktree)$/.test(r[0] || '') || rest.some((x) => /^--(?:git-dir|work-tree)/.test(x))) return ['*'];
    const ci = rest.indexOf('-C');
    if (r[0] === 'clone') { const a = args(r.slice(1)).filter((x, i, l) => !/^(?:-[bo]|--branch|--depth|--origin|--reference)$/.test(r[r.indexOf(x) - 1] || '')); return [a.length >= 2 ? a[a.length - 1] : (a[0] || '?').replace(/\.git$/, '').replace(/.*[/:]/, '')]; }
    if (r[0] === 'init') { const a = args(r.slice(1)); return [ci >= 0 ? rest[ci + 1] : a[0] || '.']; }
    return [ci >= 0 ? rest[ci + 1] || '?' : '.'];
  }
  if (w === 'mv') return args(rest);
  if (['cp', 'rsync', 'ln', 'install'].includes(w)) { const a = args(rest); return a.length ? [a[a.length - 1]] : []; }
  if (['rm', 'mkdir', 'touch', 'rmdir', 'unlink', 'truncate', 'chmod', 'rimraf'].includes(w)) return args(rest).filter((x) => !/^(?:[+=][rwxXst]+|[0-7]{3,4}|[ugoa]+[+=-][rwxXst]+)$/.test(x));
  if (w === 'tee') return args(rest);
  // 찾아 바꾸는 식은 파일이 아니다. -e가 없으면 첫 인자가 식이다(빈 따옴표 '' 는 셸 글에 남지 않는다).
  if ((w === 'sed' || w === 'perl') && rest.some((x) => /^-[a-zA-Z]*i/.test(x))) {
    // 식 자리(-e 뒤, -e가 없으면 첫 인자)만 빼고 나머지는 변수($f)나 공백 든 따옴표 경로(Q)여도 대상이다.
    let a = rest.filter((x, i) => !x.startsWith('-') && !/^\d*[<>]/.test(x) && rest[i - 1] !== '-e' && rest[i - 1] !== '-f').map((x) => (x === '*' ? './*' : x));
    if (!rest.includes('-e') && !rest.includes('-f')) a = a.slice(1);
    return a.filter((x) => !/^[sy]([^\w\s]).*\1.*\1\w*$/.test(x));
  }
  // 패키지 설치와 빌드는 그 폴더(node_modules, 빌드 결과)를 바꾼다. -g는 전역, publish는 바깥이라 자리와 무관하다. 임시 폴더의 npm i를 막지 않게.
  if (/^(?:npm|pnpm|yarn|bun)$/.test(w) && (/^(?:install|i|add|remove|uninstall|ci|publish|update|upgrade|build|init)$/.test(rest[0] || '') || (rest[0] === 'run' && /^build/.test(rest[1] || '')))) {
    if (rest[0] === 'publish' || rest.some((x) => /^(?:-g|--global)$/.test(x))) return ['*'];
    const pi = rest.findIndex((x) => x === '--prefix' || x === '-C' || x === '--dir' || x === '--cwd');
    return [pi >= 0 ? rest[pi + 1] || '?' : '.'];
  }
  // 그림과 영상 도구는 출력 인자가 대상이다. ffmpeg와 magick은 마지막 인자, sips는 --out이 없으면 원본을 고친다.
  if (/^(?:cwebp|gif2webp|img2webp|pngquant|gifsicle|svgo|avifenc|oxipng)$/.test(w)) { const i = rest.findIndex((x) => /^(?:-o|--output|--out)$/.test(x)); return i >= 0 ? [rest[i + 1] || '?'] : (/^(?:pngquant|oxipng|svgo)$/.test(w) && rest.includes('--ext') ? [] : /^(?:oxipng|svgo)$/.test(w) ? args(rest) : []); }
  if (w === 'sips') { const i = rest.findIndex((x) => x === '--out' || x === '-o'); const a = args(rest); return i >= 0 ? [rest[i + 1] || '?'] : rest.some((x) => /^(?:-[sZzrfcp]|--(?:resample|rotate|flip|setProperty|crop|pad))/.test(x)) && a.length ? [a[a.length - 1]] : []; }
  // 마지막 낱말이 '-'(표준 출력)나 옵션 값이면 파일을 쓰지 않는다(ffmpeg … -f framemd5 -).
  if (/^(?:ffmpeg|magick|convert)$/.test(w)) { const r2 = rest.filter((x) => !/^\d*[<>]/.test(x)); const last = r2[r2.length - 1]; return !last || last === '-' || last.startsWith('-') || /^pipe:/.test(last) || /^-/.test(r2[r2.length - 2] || '') && w === 'ffmpeg' && !/\.\w{2,5}$/.test(last) ? [] : [last.replace(/^\.\/\*$/, '*')]; }
  if (w === 'crontab' && !rest.includes('-l')) return ['*'];
  if (w === 'docker' || w === 'docker-compose') {
    const sub = rest.filter((x, i) => !x.startsWith('-') && !/^(?:-f|--file|-p|--project-name|--env-file|-c|--context)$/.test(rest[i - 1] || ''));
    const verb = (w === 'docker-compose' || sub[0] === 'compose') ? sub[w === 'docker-compose' ? 0 : 1] : sub[0];
    if (/^(?:up|down|stop|start|restart|rm|kill|run|create|pull|build|cp|rmi)$/.test(verb || '') && !/^(?:ls|inspect)$/.test(sub[(w === 'docker-compose' || sub[0] === 'compose') ? 2 : 1] || '')) return ['*'];
    return [];
  }
  // 도는 프로세스를 끄는 것도 바꿈이다.
  if (/^(?:kill|pkill|killall)$/.test(w) && !rest.includes('-0')) return ['*'];
  if (/^(?:pip3?|uv)$/.test(w) && /^(?:install|add|remove|sync)$/.test(rest[0] === 'pip' ? rest[1] || '' : rest[0] || '')) return ['*'];
  if (w === 'gh' && /^(?:pr|release|repo|issue|api)$/.test(rest[0] || '') && /^(?:merge|create|edit|close|delete|comment|-X|--method)$/.test(rest[1] || '')) return ['*'];
  if (w === 'wrangler' && /^(?:deploy|publish|pages|r2|kv|d1|secret|versions)$/.test(rest[0] || '') && !/\b(?:list|get|info|tail|dev)\b/.test(rest.slice(1).join(' '))) return ['*'];
  if (w === 'supabase' && /^(?:db|migration|functions|secrets)$/.test(rest[0] || '') && /^(?:push|reset|up|deploy|new|set|unset)$/.test(rest[1] || '')) return ['*'];
  // --write는 늘 바꿈이다. --fix는 린트와 꼴 맞춤 도구일 때만 바꿈으로 본다(subagent-retro.js --fix는 기록 쓰기다).
  // subagent-retro.js --docs-done은 config.json에 점검 표시를 쓴다.
  if (rest.includes('--write') || rest.includes('--docs-done') || (rest.includes('--fix') && LINT.test(ws.slice(k).join(' ')))) return ['*'];
  return [];
}
function shellTargets(shell) {
  const t = [];
  for (const stage of shell.split(/(?<!\|)\|(?!\|)/)) t.push(...stageTargets(words(stage)));
  return t.concat(redirectTargets(shell));
}

// 해석기 코드 안의 쓰기 대상. 쓰는 호출의 첫 인자가 글자면 그 글자, 이름이면 그 이름에 넣은 줄의 글자들을 본다. 못 찾으면 '?'.
// 인자는 괄호 짝을 맞춰 읽는다. 첫 ')'에서 자르면 require('os').tmpdir()+'/x'가 잘려 '?'가 됐다.
const WRITE_CALL = /(writeFileSync|appendFileSync|writeFile|appendFile|createWriteStream|mkdirSync|renameSync|unlinkSync|rmSync|copyFileSync|cpSync)\(|\b(open)\(|\.(?:write_text|write_bytes|mkdir|unlink|rename|touch)\(()|((?:shutil\.(?:copy\w*|move|rmtree)|os\.(?:remove|rename|replace|makedirs|unlink|rmdir)))\(/g;
function callArgs(code, i) {
  const out = []; let depth = 0, cur = '', q = null;
  for (; i < code.length; i++) {
    const c = code[i];
    if (q) { cur += c; if (c === '\\') { cur += code[++i] || ''; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; cur += c; continue; }
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) { if (depth === 0) break; depth--; }
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const literals = (s) => [...s.matchAll(/(['"`])([^'"`\n]*?)\1/g)].map((m) => m[2]).filter((x) => /[/.]/.test(x) && !/\s/.test(x));
// 코드 안의 경로 식을 글자로 푼다: 글자, 이름(같은 코드의 대입), 이름+'글자', f'{이름}/글자', 이름/'글자'(Path), os.path.join, sys.argv[n](명령 인자),
// 임시 폴더 함수. 풀지 못하면 빈 목록(변수로 이은 임시 자리 쓰기를 막음).
function resolveExpr(expr, code, argv, depth = 0) {
  let e = String(expr || '').trim();
  if (/^\(.*\)$/s.test(e)) e = e.slice(1, -1).trim();
  if (!e || depth > 3) return [];
  if (/tmpdir\(\)|gettempdir\(\)|TMPDIR/.test(e)) return ['/tmp/x'];
  let m;
  if ((m = /^(['"`])([^'"`]*)\1$/.exec(e))) return [m[2]];
  if ((m = /^(?:os\.path\.expanduser|(?:pathlib\.)?Path|path\.resolve|os\.path\.abspath)\(\s*(.+?)\s*\)$/.exec(e))) return resolveExpr(m[1], code, argv, depth + 1);
  if ((m = /^sys\.argv\[(\d+)\]$/.exec(e))) return argv[+m[1]] ? [argv[+m[1]]] : [];
  if ((m = /^process\.argv\[(\d+)\]$/.exec(e))) return argv[+m[1] - 1] ? [argv[+m[1] - 1]] : [];
  if ((m = /^f(['"])(.*)\1$/.exec(e))) {
    const name = /^\{([\w.]+)\}/.exec(m[2]);
    if (!name) return /^[^{]*$/.test(m[2]) ? [m[2]] : [];
    return resolveExpr(name[1], code, argv, depth + 1).map((x) => x + m[2].slice(name[0].length));
  }
  if ((m = /^(?:os\.path\.join|path\.join)\(\s*([^,]+?)\s*,\s*(.+)\)$/.exec(e))) {
    const tail = literals(m[2]).join('/');
    return resolveExpr(m[1], code, argv, depth + 1).map((x) => `${x}/${tail}`);
  }
  if ((m = /^((?:pathlib\.)?Path\([^()]*\)|[\w.]+(?:\[\d+\])?(?:\(\))?)\s*(\+|\/)\s*(.+)$/.exec(e))) {
    // 접두가 풀리고 꼬리를 못 풀면(B+p, out+i+'.txt') 접두 폴더 아래 모르는 이름(§)으로 본다. 통째로 '?'로 두면 지금 폴더 아래로 보여 두 쪽으로 틀렸다.
    const tail = resolveExpr(m[3], code, argv, depth + 1);
    const t2 = tail.length ? tail : ['§'];
    return resolveExpr(m[1], code, argv, depth + 1).flatMap((x) => t2.map((y) => (m[2] === '/' ? `${x}/${y}` : x + y)));
  }
  if ((m = /^(['"`])([^'"`]*)\1\s*\+\s*(.+)$/.exec(e))) {
    const tail = resolveExpr(m[3], code, argv, depth + 1);
    return (tail.length ? tail : ['§']).map((y) => m[2] + y);
  }
  if (/^[\w.]+$/.test(e)) {
    const esc = e.replace(/\./g, '\\.');
    const as = [...code.matchAll(new RegExp(`(?:^|[\\s;(])(?:const |let |var )?${esc}\\s*=\\s*([^\\n;]+)`, 'g'))];
    return as.flatMap((x) => { const r = resolveExpr(x[1], code, argv, depth + 1); return r.length ? r : (/^\s*(['"`])[^'"`]*\1\s*$/.test(x[1]) ? literals(x[1]) : []); });
  }
  return [];
}
function codeTargets(code, argv = []) {
  const t = [];
  for (const m of code.matchAll(WRITE_CALL)) {
    const ca = m[3] === undefined ? callArgs(code, m.index + m[0].length) : [];
    // 키워드 인자(exist_ok=True)와 옵션 객체({recursive:true})는 위치 인자에서 뺀다.
    const pos = ca.filter((x) => x && !/^\w+\s*=(?!=)/.test(x) && !/^\{/.test(x));
    let arg = '';
    if (m[2]) { if (!ca.slice(1).some((x) => /^(?:mode\s*=\s*)?(?:[rbf]?['"])[wax+]/.test(x))) continue; arg = ca[0] || ''; }
    // copyFileSync, cpSync, shutil.copy(src, dst), os.rename은 마지막 위치 인자(받는 쪽), 나머지는 첫 인자가 대상이다.
    else if (m[1]) arg = (/^(?:copyFileSync|cpSync)$/.test(m[1]) ? pos[pos.length - 1] : ca[0]) || '';
    else if (m[4]) arg = pos.length ? pos[pos.length - 1] : '';
    if (m[3] !== undefined) { const back = /(Path\([^)]*\)|\([^()]*\)|[\w.]{1,80})$/.exec(code.slice(Math.max(0, m.index - 200), m.index)); arg = back ? back[1] : ''; }
    // 함수 인자로 받은 경로면 코드 안의 경로꼴 글자를 모두 대상으로 본다(def rep(p, ..): open(p,'w') 꼴).
    // 같은 이름이 코드 다른 곳에서 대입돼도 인자가 먼저다.
    const name = (arg.match(/^(?:pathlib\.)?Path\(\s*([\w.]+)\s*\)$/) || [])[1] || (arg.match(/^[\w.]+$/) || [])[0];
    // 인자 선언 뒤(쓰기 호출 앞)에 같은 이름을 다시 대입했으면 대입이 먼저다(.map((f) => …) 뒤 const f = '…/scratchpad/x' 꼴).
    const nm = name && name.replace(/\./g, '\\.');
    const before = code.slice(0, m.index);
    const lastIdx = (re) => { let k = -1; for (const x of before.matchAll(re)) k = x.index; return k; };
    const isParam = name && lastIdx(new RegExp(`(?:def|function)\\s*\\w*\\s*\\([^)]*\\b${nm}\\b|\\(\\s*[^)]*\\b${nm}\\b[^)]*\\)\\s*=>`, 'g')) > lastIdx(new RegExp(`(?:^|[\\s;(])(?:const |let |var )?${nm}\\s*=(?!=)`, 'g'));
    let lits = isParam ? literals(code).filter((x) => /\/|\.(?:md|js|cjs|mjs|ts|tsx|json|py|sql|sh|css|html|txt|tsv|yml|yaml)$/.test(x)) : resolveExpr(arg, code, argv);
    // 글자 하나뿐인 인자만 글자를 대상으로 본다. 풀지 못한 식의 조각('/out.sql')은 대상이 아니라 모름이다.
    if (!lits.length && /^\s*(['"`])[^'"`]*\1\s*$/.test(arg)) lits = literals(arg);
    if (lits.length) t.push(...lits.map((x) => x.replace(/^~/, '/HOME')));
    else t.push('?');
  }
  return t;
}

// 하위 셸을 닫는 짝 없는 「)」의 수와 자리. 따옴표 안과 짝 있는 괄호($(…), $((…)))는 건너뛴다. 맨 앞 「(」는 연 괄호라 from부터 센다.
function subshellCloses(sh, from = 0) {
  let depth = 0, q = '';
  const at = [];
  for (let i = from; i < sh.length; i++) {
    const c = sh[i];
    if (q) { if (c === q) q = ''; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === '(') depth++;
    else if (c === ')') { if (depth) depth--; else at.push(i); }
  }
  return { n: at.length, at };
}
const absAt = (cwd) => (x) => (x === '*' || /^(?:[/~]|\$\{?TMPDIR\b)/.test(x) || !cwd ? x : `${cwd}/${x}`);

// 명령이 고치는 대상 목록(셸 글과 해석기 코드 모두).
// 셸 변수(S=/tmp/..; > $S/a)는 같은 명령 안에서 넣은 값으로 바꾸고, cd 뒤 상대 경로는 그 폴더 아래로 본다.
function bashTargets(cmd, cwd0 = '') {
  const t = [];
  const vars = {};
  const scripts = {};
  const cwdStack = [];
  let cwd = cwd0;
  for (const s of segments(cmd)) {
    // $PWD는 지금 폴더, $_는 앞 명령의 마지막 인자다(mkdir -p /tmp/w && cd $_ 꼴).
    if (cwd) vars.PWD = cwd;
    let shell = s.shell.replace(/\$\{?(\w+)\}?/g, (m, v) => (v in vars ? vars[v] : m));
    { const ws = words(shell); if (ws.length > 1) vars._ = ws[ws.length - 1]; }
    // 반복문 변수는 목록 가운데 바꿔도 되는 자리 밖 항목을, 없으면 첫 항목을 넣는다(for f in $W/*.png; do mv $f …).
    { const fm = /^\(*\s*for\s+(\w+)\s+in\s+(.+?)\s*$/.exec(shell); if (fm) { const items = words(fm[2]).filter((x) => x !== 'do'); const ab = (x) => (/^[/~]/.test(x) || !cwd ? x : `${cwd}/${x}`); vars[fm[1]] = items.find((x) => !FREE(ab(x))) || items[0] || ''; } }
    // 하위 셸 괄호에서 옮긴 폴더는 「)」 뒤에 되돌린다.
    const opens = (/^\(+/.exec(shell) || [''])[0].length;
    for (let k = 0; k < opens; k++) cwdStack.push(cwd);
    // T=$(mktemp -d) 꼴은 임시 자리다.
    for (const m of shell.matchAll(/(?:^|\s)(\w+)=([^\s;|&]+)/g)) vars[m[1]] = /^"?\$\(mktemp\b/.test(m[2]) ? '/tmp/mktemp' : m[2];
    // 하위 셸을 닫는 「)」 뒤에 붙은 리다이렉트와 파이프((cd X && git show …) > out, (…) | crontab -)는 되돌린 폴더 기준이다. 토막 끝의 「)」만 세면 「) > f」 「) 2>&1 |」에서
    // 폴더를 되돌리지 않아 뒤 명령을 옮긴 폴더로 봤다. 하위 셸 안일 때만 나눈다(case 꼴 「a)」를 닫는 괄호로 보지 않게).
    // 닫는 괄호가 여럿이면(「ls) > a) > b」) 괄호 사이 리다이렉트마다 한 겹씩 되돌린 폴더로 본다.
    const { n: closes, at } = subshellCloses(shell, opens);
    const tails = [];
    if (closes && cwdStack.length) { at.forEach((k, j) => tails.push(shell.slice(k + 1, at[j + 1] ?? shell.length))); shell = shell.slice(0, at[0] + 1); }
    const unwind = () => { for (let k = 0; k < closes && cwdStack.length; k++) { cwd = cwdStack.pop(); t.push(...shellTargets(tails[k] || '').map(absAt(cwd))); } };
    const cd = /^\(*\s*cd\s+([^\s)]+)/.exec(shell);
    // 풀지 못한 $(…)로 옮긴 폴더(cd $(git rev-parse --show-toplevel))는 모르는 곳이라 저장소로 본다.
    if (cd) { cwd = /§/.test(cd[1]) ? '§' : /^[/~$]/.test(cd[1]) || !cwd ? cd[1] : `${cwd}/${cd[1]}`; unwind(); continue; }
    // 풀지 못한 대상('?', $변수, 반복문 변수)도 그 조각의 폴더 아래로 본다. 폴더가 임시 자리면 막지 않는다.
    const abs = (x) => (x === '*' || /^(?:[/~]|\$\{?TMPDIR\b)/.test(x) || !cwd ? x : `${cwd}/${x}`);
    t.push(...shellTargets(shell).map(abs));
    // 해석기에 넘긴 명령 인자(python3 - "$S/out.json" <<EOF 꼴의 sys.argv).
    const iv = /\b(?:python3?|node)\s+(.*)$/.exec(shell);
    const argv = iv ? iv[1].split(/\s+/).filter((x) => x && !/^-[a-zA-Z]/.test(x) && !x.startsWith('<<') && x !== 'Q') : [];
    // python -c는 sys.argv[0]이 '-c'라 뒤 인자가 한 칸씩 밀린다.
    if (iv && /^python/.test(iv[0]) && /(?:^|\s)-c\b/.test(iv[1])) argv.unshift('-c');
    // 큰따옴표로 넘긴 코드 안의 $변수는 셸이 먼저 푼다(node -e "..'$SP/a'.." 꼴).
    const sv = (x) => x.replace(/\$\{?(\w+)\}?/g, (m, v) => (v in vars ? vars[v] : m));
    for (const c of s.code) t.push(...codeTargets(c, argv).map(sv).map(abs));
    for (const sub of s.sub || []) t.push(...bashTargets(sub, cwd).map(abs));
    // 같은 명령에서 heredoc으로 쓴 스크립트(cat > F <<EOF, tee F <<EOF)를 뒤에서 실행하면(python3 F, node F, bash F) 그 본문을 코드로 본다.
    const ws = words(shell);
    if (s.here != null && /^(?:cat|tee)$/.test(ws[0] || '')) { const f = ws[0] === 'cat' ? redirectTargets(shell)[0] : args(ws.slice(1))[0]; if (f) scripts[abs(f)] = s.here; }
    // 해석기를 경로로 불러도(.venv/bin/python, /usr/bin/python3.11) 이름으로 가른다.
    const ri = ws.findIndex((x) => /^(?:python(?:3(?:\.\d+)?)?|node|bash|sh|zsh)$/.test(x.replace(/^.*\//, '')));
    if (ri >= 0) {
      const ra = ws.slice(ri + 1).filter((x) => !/^-/.test(x));
      const body = ra.length ? scripts[abs(ra[0])] : undefined;
      if (body != null) t.push(...(/^(?:bash|sh|zsh)$/.test(ws[ri].replace(/^.*\//, '')) ? bashTargets(body, cwd) : codeTargets(body, ra).map(sv)).map(abs));
    }
    unwind();
  }
  // 「cd ../../..」로 올라간 경로는 줄여서 판정한다. 줄이지 않으면 임시 자리 아래 글자가 남아 저장소 커밋을 임시 자리로 봤다.
  return t.map((x) => (/^\//.test(x) && /(?:^|\/)\.\.(?:\/|$)/.test(x) ? path.posix.normalize(x) : x));
}
// target(경로)이 참인 대상을 고치나. '*'와 '?'(대상 모름)는 경로 판정 없이 고침으로 본다(any가 참일 때만).
function bashWrites(cmd, target, any = false, cwd = '') {
  return bashTargets(cmd, cwd).some((x) => ((x === '*' || x === '?') ? any : target(x)));
}

module.exports = { bashTargets, bashWrites, segments, redirectTargets, FREE };
