'use strict';

/**
 * 셸 명령이 쓰는 파일 경로를 절대 경로 목록으로 돌려주는 도우미. 두 훅이 같은 해석을 쓰려고 한 곳에 둔다.
 *   - 멈춤 검사(hooks/stall-check.js)의 열린 칸 대조: 이번 세션이 고친 진행 기록을 모은다.
 *   - 결정 대조(설치본 hooks/decision-check.js): 이번 세션이 결정 문서나 진행 기록을 고쳤나 본다.
 * 풀어 주는 꼴: `cd <폴더> && …`의 cd 뒤 상대경로, `>`와 `>>` 리다이렉트, `python3 - <<EOF` 안의 `p='…'` 뒤 `open(p,'w')`나 `open('…','w')`,
 *   `sed -i`, `tee`, `cp`와 `mv`의 받는 쪽, `~`와 `$HOME`. 해석 자체는 bashTargets.cjs(되고침 신호 훅과 같은 풀이)가 하고, 이 파일은 그 결과를 절대 경로로 바꾼다.
 * 왜: 같은 일(셸 명령에서 고친 파일 경로 얻기)을 두 훅이 따로 해석해서 한쪽만 고치면 다른 쪽이 남았다. 열린 칸 대조는 `cd ~/.claude && cat >> docs/plan/work/x.md`를
 *   대화 기록의 작업 폴더 기준으로 풀어 없는 경로를 적었고(10일 125번 가운데 19번), 결정 대조는 같은 꼴을 못 알아봐 기록한 뒤에도 헛막았다(9번).
 * 전제: 셸을 실제로 풀지 않는 어림이다. 대상을 모르는 바꿈('*', '?', '§'가 든 것, 따옴표 글 'Q')은 경로가 아니라 버린다. 존재 여부는 보지 않는다(부르는 쪽이 정한다).
 *   해석기(bashTargets.cjs)를 못 불러오면 null을, 불렀으면 빈 목록이라도 배열을 돌려준다.
 */

const path = require('node:path');
const os = require('node:os');
// bashTargets.cjs는 피드백 묶음의 파일이라 라우팅만 깐 설치에는 없을 수 있다. 없으면 null을 돌려 부르는 쪽이 옛 해석으로 돌아가게 한다.
let bashTargets = null;
try { ({ bashTargets } = require('../bashTargets.cjs')); } catch { bashTargets = null; }

const homeOf = (home) => home || process.env.HOME || os.homedir();

function shellWrittenFiles(cmd, cwd = '', home = '') {
  const h = homeOf(home);
  if (!bashTargets) return null;
  if (typeof cmd !== 'string' || !cmd) return [];
  let targets;
  try { targets = bashTargets(cmd.replace(/\$\{HOME\}|\$HOME\b/g, h), cwd || ''); } catch { return []; }
  const out = new Set();
  for (let t of targets) {
    if (typeof t !== 'string' || !t || t === '*' || t === '?' || t === 'Q' || t.includes('§') || /(?:^|\/)[?*](?:\/|$)/.test(t) || /(?:^|\/)Q(?:\/|$)/.test(t)) continue;
    if (t === '/HOME' || t.startsWith('/HOME/')) t = h + t.slice(5);
    else if (t === '~' || t.startsWith('~/')) t = h + t.slice(1);
    if (!path.isAbsolute(t)) { if (!cwd) continue; t = path.join(cwd, t); }
    out.add(path.normalize(t));
  }
  return [...out];
}

module.exports = { shellWrittenFiles };
