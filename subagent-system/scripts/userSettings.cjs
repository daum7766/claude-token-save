'use strict';

// 사용자 설정 값(호칭, 선택지 받는 꼴, 답할 언어, 사용 방식, 휴대폰 알림, 올릴 것 갈래)을 읽는 모듈이다. CJS 훅과 ESM 스크립트가 함께 쓰려고 .cjs로 두고, 파일 맨 위에서 비동기로 기다리지 않는다.
// 값마다 「설정 문서(<설정 폴더>/USER_SETTINGS.md의 `## 값`) → 설정 폴더 CLAUDE.md의 같은 꼴 줄 → config.json → 기본값」 차례로 읽고 읽은 자리를 함께 돌려준다.
// 기계가 읽는 것은 `## 값`의 `- 이름: 값` 줄과 `## 올릴 것`의 줄머리(첫 쌍점 앞)뿐이다. 나머지는 Claude가 읽는 글이다.
// 설정 문서가 없거나 못 읽어도 던지지 않고 다음 자리로 넘어간다. 훅이 이 모듈 때문에 꺼지지 않게 하려는 것이다.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SETTINGS_FILE = 'USER_SETTINGS.md';
const DEFAULT_CHOICE_FORM = '질문 창';
const CHOICE_FORMS = ['질문 창', '본문'];
const DEFAULT_LANG = 'ko';
const DEFAULT_CALL_NAME = '사용자';
// 올릴 것 갈래의 기본. 회고의 묻기 종류 앞 넷과 같다.
const DEFAULT_RAISE_KINDS = ['돈', '되돌리기 어려운 일', '정책', '목표로 못 가르는 트레이드오프'];
const PROFILE_LINES = { personal: '개인용', company: '회사용' };
const PHONE_NOTIFY = ['켬', '끔'];
const LABELS = { callName: '호칭', choiceForm: '선택지 받는 꼴', lang: '답할 언어', profileLine: '사용 방식', phoneNotify: '휴대폰 알림' };

const defaultConfigDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function readConfig(configDir = defaultConfigDir()) {
  const text = readText(path.join(configDir, 'subagent-system', 'config.json'));
  if (text === null) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '').trim();
const COLON = /[:：]/;

// `## 제목` 절의 줄들(다음 `## ` 앞까지). 절이 없으면 null.
function sectionLines(text, heading) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const from = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (from < 0) return null;
  const out = [];
  for (let i = from + 1; i < lines.length && !/^## /.test(lines[i]); i += 1) out.push(lines[i]);
  return out;
}

const bulletBody = (line) => {
  const m = /^\s*[-*]\s+(.*)$/.exec(line);
  return m ? m[1] : null;
};

// `## 값`의 `- 이름: 값` 줄을 읽는다. 쌍점이 없는 줄은 problems에 담는다.
function valueLinesOf(text, problems) {
  const out = new Map();
  for (const line of sectionLines(text, '값') ?? []) {
    const body = bulletBody(line);
    if (body === null || stripComments(body) === '') continue;
    const at = body.search(COLON);
    if (at < 0) {
      problems.push(`${SETTINGS_FILE}의 값 줄에 쌍점이 없습니다: ${stripComments(body)}`);
      continue;
    }
    const label = body.slice(0, at).trim();
    if (!out.has(label)) out.set(label, body.slice(at + 1));
  }
  return out;
}

// CLAUDE.md의 같은 꼴 줄(`- 호칭: 값`).
function claudeMdLinesOf(text) {
  const out = new Map();
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const body = bulletBody(line);
    if (body === null) continue;
    const at = body.search(COLON);
    if (at < 0) continue;
    const label = body.slice(0, at).trim();
    if (Object.values(LABELS).includes(label) && !out.has(label)) out.set(label, body.slice(at + 1));
  }
  return out;
}

const trimHonorific = (s) => (s.length > 1 && s.endsWith('님') ? s.slice(0, -1) : s);

// 값마다 읽은 글을 값으로 바꾸는 규칙. 값이 아니면 null이고 problem 문구를 돌려줄 수 있다.
const PARSERS = {
  callName: (raw) => ({ value: trimHonorific(raw) }),
  choiceForm: (raw) => (CHOICE_FORMS.includes(raw) ? { value: raw } : { problem: `선택지 받는 꼴은 ${CHOICE_FORMS.join(' 또는 ')}이어야 합니다: ${raw}` }),
  lang: (raw) => (/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/.test(raw) ? { value: raw } : { problem: `답할 언어 값이 언어 코드가 아닙니다: ${raw}` }),
  profileLine: (raw) => (Object.values(PROFILE_LINES).includes(raw) ? { value: raw } : { problem: `사용 방식은 개인용 또는 회사용이어야 합니다: ${raw}` }),
  phoneNotify: (raw) => (PHONE_NOTIFY.includes(raw) ? { value: raw } : { problem: `휴대폰 알림은 ${PHONE_NOTIFY.join(' 또는 ')}이어야 합니다: ${raw}` }),
};

function readUserSettings(configDir = defaultConfigDir()) {
  const problems = [];
  const config = readConfig(configDir);
  const settingsText = readText(path.join(configDir, SETTINGS_FILE));
  const settingsLines = settingsText === null ? new Map() : valueLinesOf(settingsText, problems);
  const claudeText = readText(path.join(configDir, 'CLAUDE.md'));
  const claudeLines = claudeText === null ? new Map() : claudeMdLinesOf(claudeText);

  const configValue = {
    callName: Array.isArray(config.decisionWords) && typeof config.decisionWords[0] === 'string' && config.decisionWords[0] ? config.decisionWords[0] : null,
    profileLine: PROFILE_LINES[config.profile] ?? null,
  };
  // 휴대폰 알림의 기본은 config의 사용 방식이 정한다(개인용 켬, 그 밖은 끔). 값 줄이 없는 옛 설치본과 사용 방식을 바꾼 뒤에도 따로 정하지 않았으면 따라간다.
  const defaults = { callName: DEFAULT_CALL_NAME, choiceForm: DEFAULT_CHOICE_FORM, lang: DEFAULT_LANG, profileLine: PROFILE_LINES.company, phoneNotify: config.profile === 'personal' ? '켬' : '끔' };

  const values = {};
  const sources = {};
  for (const [name, label] of Object.entries(LABELS)) {
    const candidates = [
      ['settings', settingsLines.get(label)],
      ['claude-md', claudeLines.get(label)],
      ['config', configValue[name] ?? undefined],
    ];
    values[name] = defaults[name];
    sources[name] = 'default';
    for (const [source, rawText] of candidates) {
      if (rawText === undefined) continue;
      const raw = stripComments(String(rawText));
      if (raw === '') continue;
      const parsed = source === 'config' ? { value: raw } : PARSERS[name](raw);
      if (parsed.problem) {
        problems.push(parsed.problem);
        continue;
      }
      values[name] = source === 'config' && name === 'callName' ? trimHonorific(parsed.value) : parsed.value;
      sources[name] = source;
      break;
    }
  }

  let raiseKinds = DEFAULT_RAISE_KINDS.slice();
  sources.raiseKinds = 'default';
  if (settingsText !== null) {
    const kinds = (sectionLines(settingsText, '올릴 것') ?? [])
      .map(bulletBody)
      .filter((b) => b !== null)
      .map((b) => (b.search(COLON) < 0 ? b : b.slice(0, b.search(COLON))).trim())
      .filter(Boolean);
    if (kinds.length) {
      raiseKinds = kinds;
      sources.raiseKinds = 'settings';
    }
  }

  return { values, raiseKinds, sources, problems };
}

const callName = (configDir) => readUserSettings(configDir).values.callName;

// config.decisionWords가 있으면 그것, 없으면 [호칭 낱말, 사용자]에서 겹침을 뺀 것.
function decisionWords(configDir = defaultConfigDir()) {
  const config = readConfig(configDir);
  if (Array.isArray(config.decisionWords) && config.decisionWords.length && config.decisionWords.every((w) => typeof w === 'string' && w)) return config.decisionWords.slice();
  return [...new Set([callName(configDir), DEFAULT_CALL_NAME])];
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 「<낱말>(이|가) 정한」을 찾는 정규식. 낱말이 없으면 아무것도 맞지 않는다.
function decidedByPattern(words) {
  const list = (words ?? []).filter((w) => typeof w === 'string' && w);
  if (!list.length) return /(?!)/;
  return new RegExp(`(?:${list.map(escapeRe).join('|')})(?:이|가)\\s*정한`);
}

const JOSA_PAIRS = { '이/가': ['이', '가'], '은/는': ['은', '는'], '을/를': ['을', '를'], '과/와': ['과', '와'] };

// 낱말 끝 글자에 받침이 있으면 앞 조사, 없으면 뒤 조사. 한글이 아닌 글자로 끝나면 뒤 조사.
function josa(word, pair) {
  const forms = JOSA_PAIRS[pair];
  if (!forms) throw new Error(`모르는 조사 쌍: ${pair}`);
  const code = String(word).charCodeAt(String(word).length - 1);
  const hangul = code >= 0xac00 && code <= 0xd7a3;
  return hangul && (code - 0xac00) % 28 !== 0 ? forms[0] : forms[1];
}

// 휴대폰 알림(PushNotification)을 쓰는 설정인가. 읽지 못하면 사용 방식의 기본을 따르고, 그것도 못 읽으면 끔이다.
const phoneNotifyOn = (configDir) => readUserSettings(configDir).values.phoneNotify === '켬';

const raiseKinds = (configDir) => readUserSettings(configDir).raiseKinds;

// 사용 방식이 정하는 「애매할 때」 문턱 줄. profile이 개인용이 아니면(없거나 모르는 값 포함) 회사용으로 본다(kitProfile.js profileOf, askFirstOf와 같은 규칙).
function ambiguityLine(config) {
  const askFirst = !(config && config.profile === 'personal');
  return `애매할 때: ${askFirst ? '되돌리는 비용이 거의 없는 것만 하고 나머지는 묻기' : '작으면 하고 알림'} (profile이 정함)`;
}

module.exports = { SETTINGS_FILE, DEFAULT_RAISE_KINDS, readConfig, readUserSettings, callName, phoneNotifyOn, decisionWords, decidedByPattern, josa, raiseKinds, ambiguityLine };
