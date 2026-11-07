'use strict';

/**
 * git 훅 조각들이 함께 쓰는 도우미. 커밋 메시지 읽기, 설정 읽기, commitCheck 판정, 설정 폴더 찾기를 한곳에 둔다.
 * 왜: 조각(<훅>.d/*.cjs)마다 같은 코드를 베끼면 한쪽만 고쳐져 판정이 갈린다. 조각은 묶음마다 따로 깔리고 이 파일은 바닥이 늘 깐다.
 * 전제:
 *  - 이 파일은 <설정 폴더>/subagent-system/hooks/git/ 에 놓인다(configDirOf가 그 위치를 가정함).
 *  - 설정을 읽을 수 없으면 빈 객체이고, commitCheck는 그때 검사(block) 쪽이다. 키가 없을 때도 같다(지금 commit-msg와 같음).
 */

const fs = require('node:fs');
const path = require('node:path');

const EXEMPT = /^(Merge |fixup! |squash! |amend! )/;

// git이 메시지에서 지우는 주석 줄과, 커밋 편집기의 가위선 아래(diff)를 뺀다.
function bodyOf(raw) {
  const out = [];
  for (const line of String(raw).split(/\r?\n/)) {
    if (/^# -{10,} >8 -{10,}$/.test(line)) break;
    if (line.startsWith('#')) continue;
    out.push(line);
  }
  return out.join('\n').trim();
}

// 훅 폴더(<설정 폴더>/subagent-system/hooks/git)에서 설정 폴더를 구한다.
const configDirOf = (hookDir) => path.resolve(hookDir, '..', '..', '..');

function readConfig(configDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(configDir, 'subagent-system', 'config.json'), 'utf8'));
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// 'block' 또는 'off'. 'off'로 적혀 있을 때만 쉰다. 키가 없거나 설정을 못 읽었으면 사용 방식과 상관없이 검사한다.
// 까닭: 키가 빠진 설치는 깨진 경우뿐이다(회사용도 설치 때 off를 적는다). 기본값이 느슨한 쪽으로 바뀌면 검사가 신호 없이 꺼진다(APPLY_GUIDE 「키가 없으면 안전한 쪽」).
function commitCheckOf(config) {
  return config && typeof config === 'object' && config.commitCheck === 'off' ? 'off' : 'block';
}

// 결정어. userSettings.cjs가 config.decisionWords, 호칭, 사용자 차례로 정한다.
function decisionWords(configDir) {
  return require('../../scripts/userSettings.cjs').decisionWords(configDir);
}

const NO_MESSAGE_ARG = 'commit-msg: 메시지 파일 경로 인자가 없습니다';

module.exports = { EXEMPT, bodyOf, configDirOf, readConfig, commitCheckOf, decisionWords, NO_MESSAGE_ARG };
