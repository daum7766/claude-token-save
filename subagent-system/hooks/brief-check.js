#!/usr/bin/env node
// 무엇: PreToolUse(matcher Agent) 훅. 서브에이전트 지시문에 아래가 빠졌으면 deny하고 빠진 것을 알린다.
//   1) `목표:` 줄  2) 결정 문서 경로 또는 「결정 문서: 없음(까닭)」
//   3) 라우팅 표의 칸보다 높은 정의로 보내면서 prompt나 description에 `높임: <까닭>`이나 `올림: <앞 정의와 실패 까닭>`이 없는 경우
// 왜: 목표와 결정 문서가 빠진 지시문은 재지시와 되돌림을 만들어서, 체크리스트 글 대신 보내기 직전에 기계로 막는다.
//   `높임:`은 회고가 표 칸과 다른 배정을 분류하는 근거라 처음 보낼 때 남겨야 한다.
//   `올림:`은 실패해 한 단계 올려 다시 보내는 지시(Fable 단계 포함)의 표시다. 올림은 표 칸이 아니라 앞 실패가 정의를 정하므로
//   이 줄이 있으면 3)을 건너뛴다. 처음 보냄의 높임과 올림이 기록에서 섞이지 않게 줄 이름을 나눈다.
//   4) 표 칸에 시험 표시(「(시험: 2건 이상 `<정의>`)」)가 있는데 이 회고 구간에 시험 정의로 보낸 건이 2건 아래이고
//      시험 정의가 아닌 정의로 보내면서 `시험 건너뜀:`, `높임:`, `올림:` 줄이 없는 경우
//   5) sonnet, opus 정의로 보내는데 description에 표의 일 이름이 없고 `표에 없는 일: <이름>`도 없는 경우(까닭은 check 안 주석)
//   6) sonnet, opus 정의에게 워크트리 만들기나 커밋을 시키는 경우(까닭은 check 안 주석)
//   8) 다른 화면, 회차, 산출물에서 옮겨 온 말투(교훈, 「~와 같은 창」 등)가 있는데 `옮겨 온 것:` 줄이 없는 경우(까닭은 carryProblem 주석)
//   9) 목업대로 옮기는 구현을 맡기는데 목업 폴더 README나 지시문에 사용자 확인 줄이 없는 경우(까닭은 unconfirmedMockup 주석)
//   4)의 왜: 2026-10-31 회고에서 시험 표시 칸 둘(새 규칙 대조 문서 점검 opus-low, 긴 구현 계획 실행 sonnet-low)이
//      약 20건을 원래 칸이나 더 높은 정의로 받아 시험이 한 건도 쌓이지 않았다. 규칙 문장(SUBAGENT_SITUATIONS
//      「내려 보기 시험과 「(고정)」」)만으로는 지켜지지 않아 보내기 직전에 막는다.
// 전제: 정의가 haiku 계열이거나 prompt가 600자 아래인 짧은 조회는 검사하지 않고, 경계는 재지시 기록으로 고친다.
//   라우팅 표는 이 훅 옆 설치본 docs/ROUTING_TABLE.md의 `| **Haiku** | ...` 꼴 표를 읽는다. 표를 못 읽거나
//   일 종류가 표의 어느 줄과도 안 맞으면 3)만 건너뛴다(훅 오류로 모든 Agent 호출이 막히지 않게).
//   1), 2)와 「지킬 결정」 검사는 회사 규칙 묶음(company)이 깔렸을 때만 돈다. 깐 상태 기록이 없거나 깨졌으면 깔린 것으로 본다.
//   왜: 라우팅만 깔린 설치에는 회사 규칙의 목표 줄, 결정 문서 줄 꼴이 없어 그 꼴을 요구하면 쓰는 사람 몫이 아닌 규칙으로 막는다.
//   일 종류는 description에서 표의 일 이름을 찾아 가린다(가장 긴 이름).
//   4)의 건수는 기록 폴더(SUBAGENT_RECORDS_DIR, 없으면 이 훅 옆 records)의 subagent-usage.tsv에서 마지막 `회고` 줄 뒤
//   (정의, 일 종류)가 맞는 줄을 agentId로 세고, 파일을 못 읽으면 4)만 건너뛴다.
//   훅 안의 오류는 모두 통과로 처리한다.
'use strict';
const fs = require('fs');
const path = require('path');
// 막음 기록은 감싸개(kit-hook.cjs)가 한 곳에서 적는다. 여기서는 막는 출력에 판정 이름을 붙이고 끝에서 알리기만 한다. 감싸개 밖(시험, 수동 실행)에서는 아무것도 적히지 않는다.
const { named, reportBlocks } = (() => { try { return require('./kit-hook.cjs'); } catch { return { named: (o) => o, reportBlocks: () => {} }; } })();

const MIN_PROMPT_CHARS = 600;
const MODEL_RANK = { haiku: 0, sonnet: 1, opus: 2 };
const EFFORT_RANK = { low: 0, medium: 1, high: 2, xhigh: 3 };

function defaultRoutingFiles() {
  return [path.join(__dirname, '..', 'docs', 'ROUTING_TABLE.md')];
}

function routingFiles() {
  const env = process.env.BRIEF_CHECK_ROUTING_FILES;
  return env ? env.split(path.delimiter).filter(Boolean) : defaultRoutingFiles();
}

function splitTopLevel(cell) {
  const items = [];
  let depth = 0;
  let cur = '';
  for (const ch of cell) {
    if ('([「'.includes(ch)) depth++;
    else if (')]」'.includes(ch)) depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      items.push(cur);
      cur = '';
    } else cur += ch;
  }
  items.push(cur);
  return items;
}

// 표 칸 이름의 꼴은 subagentRetroHelpers.js의 kindNameOf와 같다. 시험, 최저, 고정 표시와 괄호 부연만 떼고
// `[기준]`과 그 밖의 「」는 이름에 남겨, 쪼갠 두 칸(`일[기준]` 둘)이 한 이름으로 합쳐지지 않게 한다.
const TRIAL_MARK = /「\(시험:[^)]*\)」|\(시험:[^)]*`[^`)]+`[^)]*\)/g;
const FLOOR_MARK = /「\(최저:\s*`?([a-z]+-[a-z]+)`?\s*\)」|\(최저:\s*`?([a-z]+-[a-z]+)`?\s*\)/g;
const PIN_MARK = /「\(고정\)」|\(고정\)/g;

function cleanName(item) {
  return item
    .replace(TRIAL_MARK, '')
    .replace(FLOOR_MARK, '')
    .replace(PIN_MARK, '')
    .replace(/\([^()]*(\([^()]*\)[^()]*)*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseRoutingTable(markdown) {
  const rows = [];
  let efforts = ['low', 'medium', 'high', 'xhigh'];
  for (const line of markdown.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    const header = cells.slice(1).map((c) => c.toLowerCase());
    if (cells[0] === '' && header.length >= 3 && header.every((h) => h in EFFORT_RANK)) {
      efforts = header;
      continue;
    }
    const m = /^\*\*(Haiku|Sonnet|Opus)\*\*$/.exec(cells[0] || '');
    if (!m) continue;
    const model = m[1].toLowerCase();
    cells.slice(1).forEach((cell, i) => {
      if (!efforts[i] || !cell) return;
      for (const item of splitTopLevel(cell)) {
        const name = cleanName(item);
        const trial = /시험:[^`)]*`([a-z]+-[a-z]+)`/.exec(item);
        if (name) rows.push({ name, model, effort: efforts[i], ...(trial ? { trial: trial[1] } : {}) });
      }
    });
  }
  return rows;
}

function loadRouting() {
  const rows = [];
  for (const f of routingFiles()) {
    try {
      rows.push(...parseRoutingTable(fs.readFileSync(f, 'utf8')));
    } catch { /* 표를 못 읽으면 그 파일은 건너뛴다 */ }
  }
  return rows;
}

function parseDefinition(subagentType) {
  const m = /^(haiku|sonnet|opus)-(low|medium|high|xhigh)$/.exec(subagentType || '');
  return m ? { model: m[1], effort: m[2] } : null;
}

function isHigher(a, b) {
  if (MODEL_RANK[a.model] !== MODEL_RANK[b.model]) return MODEL_RANK[a.model] > MODEL_RANK[b.model];
  return EFFORT_RANK[a.effort] > EFFORT_RANK[b.effort];
}

function hasGoalLine(prompt) {
  return /^[ \t>*#\-]*(\*\*)?목표(\*\*)?[ \t]*[:：]/m.test(prompt);
}

function hasDecisionDoc(prompt) {
  if (/결정\s*문서\s*[:：]?\s*없음\s*[(（][^)）]*[가-힣A-Za-z0-9][^)）]*[)）]/.test(prompt)) return true;
  return /결정\s*문서[^\n]*\.md\b/.test(prompt) || /결정\s*문서[^\n]*\n[^\n]*\.md\b/.test(prompt);
}

// 작업 문서(머리 `<!-- work-doc -->`)가 결정 문서인 지시는 `묶음: <경로>` 줄이 있어야 하고 그 묶음 파일이 낡지 않아야 한다.
// 왜: 실무자가 「먼저 읽을 것」 문서 열 개 남짓(합 약 23만 자)을 건너뛰어 걸리는 규칙과 정한 결정을 놓쳤다(2026-11-10). 묶음 파일은 작업 문서와 규칙 원문을 엮은 한 장이라 줄이 빠지거나 원본이 바뀌어 낡으면 같은 일이 되풀이된다.
// 전제: 낡았는지는 work-bundle.js --verify와 같은 비교(그 스크립트를 부른다). 스크립트가 없거나 부르지 못하면 막지 않는다(검사가 일을 멈추지 않게). BUNDLE_LINE는 rule-check.js의 `묶음:` 줄 꼴과 같다.
const BUNDLE_LINE = /^[ \t]*묶음[ \t]*[:：][ \t]*(.+?)[ \t]*$/m;
// 표시는 문서 머리(다섯 줄 안)에서만 본다. 회사 규칙 문서처럼 표시를 예로 보이는 문서를 작업 문서로 읽지 않게(되돌려 보니 11-07 호출 12건이 이 문서 때문에 새로 막혔다).
const WORK_DOC_MARK = /^\s*<!--\s*work-doc\s*-->\s*$/m;
const homePath = (p) => String(p).replace(/^~(?=\/)/, process.env.HOME || require('os').homedir());
function workDocPaths(prompt) {
  const lines = String(prompt).split('\n');
  const out = new Set();
  lines.forEach((line, i) => {
    if (!/결정\s*문서/.test(line)) return;
    for (const m of `${line}\n${lines[i + 1] || ''}`.matchAll(/(?:~\/|\/)[^\s`'"()」,]+\.md\b/g)) out.add(homePath(m[0]));
  });
  return [...out].filter((f) => { try { return WORK_DOC_MARK.test(fs.readFileSync(f, 'utf8').split('\n').slice(0, 5).join('\n')); } catch { return false; } });
}
function bundleProblem(prompt) {
  const docs = workDocPaths(prompt);
  if (!docs.length) return '';
  const script = path.join(__dirname, '..', 'scripts', 'work-bundle.js');
  if (!fs.existsSync(script)) return '';
  const line = BUNDLE_LINE.exec(String(prompt));
  const fix = (doc) => `\`node ~/.claude/subagent-system/scripts/work-bundle.js --work ${doc}\`로 묶음을 다시 엮고 그 출력 경로를 \`묶음: <경로>\` 줄로 적어라.`;
  if (!line) return `결정 문서 ${docs[0]}는 작업 문서(\`<!-- work-doc -->\`)인데 지시문에 \`묶음: <경로>\` 줄이 없다. 작업 문서만 가리키면 걸리는 규칙과 작업 순서를 실무자가 따로 찾다 놓친다. ${fix(docs[0])}`;
  const bundle = path.resolve(homePath(line[1].replace(/[`'"]/g, '')));
  let meta;
  try { meta = JSON.parse(/^<!-- work-bundle (\{.*\}) -->/.exec(fs.readFileSync(bundle, 'utf8'))[1]); } catch { return `\`묶음:\` 줄의 ${line[1]}가 work-bundle.js가 엮은 묶음 파일이 아니거나 없다. ${fix(docs[0])}`; }
  const bundled = path.resolve(meta.root || '', meta.work || '');
  // 같은 파일이 심볼릭 링크 경로(/var와 /private/var 따위)로 달리 적혀도 같은 문서로 본다: 묶음 머리의 뿌리는 git이 돌려준 실제 경로다.
  const real = (f) => { try { return fs.realpathSync(f); } catch { return path.resolve(f); } };
  if (!docs.some((d) => real(d) === real(bundled))) return `\`묶음:\` 줄의 묶음은 ${bundled}의 것인데 결정 문서는 ${docs[0]}다. ${fix(docs[0])}`;
  let res;
  try {
    const r = require('child_process').spawnSync(process.execPath, [script, '--verify', bundle], { encoding: 'utf8', timeout: 20000 });
    res = JSON.parse(r.stdout);
  } catch { return ''; }
  if (res.errors && res.errors.length) return `묶음 ${bundle}를 다시 엮어 견주지 못했다(${String(res.errors[0]).slice(0, 120)}). 작업 문서의 끊긴 자리를 고친 뒤 ${fix(bundled)}`;
  if (res.stale && res.stale.length) return `묶음 ${bundle}가 낡았다(바뀐 원본: ${res.stale.slice(0, 4).join(', ')}). ${fix(bundled)}`;
  return '';
}

// 큰 결정 문서(머리 `<!-- decision-doc -->`)를 `결정 문서:`로 가리키는 지시: 절 없이 통째로 가리키고 `묶음:` 줄이 없으면 막고, 절을 달았으면 알리기만 한다.
// 왜: 작업 문서 흐름의 첫 고리(작업 문서로 나누기)를 하지 않아도 아무것도 잡지 않았다. 한 프로젝트의 지시 445건(11-05 뒤)의 295건이 79,528자 개편 문서를 가리켰고(절을 단 233건, 통째 62건) 묶음 줄은 0건이었다(2026-11-10 검토).
//   통째로 넘기면 실무자가 필요 없는 행을 읽다 걸리는 규칙과 정한 결정을 놓친다. 절을 단 지시는 이미 좁혀 가리킨 것이라 막지 않고 알린다.
// 전제: 출구는 `묶음: 없음(까닭)`(작은 일). 작업 문서를 함께 가리킨 지시는 위 작업 문서 검사가 맡는다. 표시는 문서 머리 다섯 줄 안에서만 본다. 회사 규칙 묶음이 있을 때만 돈다.
//   절 표시는 그 문서 경로가 적힌 줄에 `「…」`, `§`, `#절`이 있는 꼴이다. 상대 경로는 읽지 않는다(지시문 검사는 작업 폴더를 모른다).
const DECISION_MARK = /^\s*<!--\s*decision-doc\s*-->\s*$/m;
const NO_BUNDLE_LINE = /^[ \t]*묶음[ \t]*[:：][ \t]*없음[ \t]*[(（][^)）\n]*[가-힣A-Za-z0-9][^)）\n]*[)）]/m;
function bigDocRefs(prompt) {
  const lines = String(prompt).split('\n');
  const out = new Map();
  lines.forEach((line, i) => {
    if (!/결정\s*문서/.test(line)) return;
    for (const m of `${line}\n${lines[i + 1] || ''}`.matchAll(/(?:~\/|\/)[^\s`'"()」,]+\.md\b/g)) {
      const own = line.includes(m[0]) ? line : lines[i + 1] || '';
      const rest = own.slice(own.indexOf(m[0]) + m[0].length);
      const sectioned = /「[^」\n]+」|§|#[^\s#]/.test(rest);
      const file = homePath(m[0]);
      out.set(file, (out.get(file) || false) || sectioned);
    }
  });
  const big = [];
  for (const [file, sectioned] of out) {
    let head = '';
    try { head = fs.readFileSync(file, 'utf8').split('\n').slice(0, 5).join('\n'); } catch { continue; }
    if (DECISION_MARK.test(head) && !WORK_DOC_MARK.test(head)) big.push({ file, sectioned });
  }
  return big;
}
function bigDocFinding(prompt) {
  if (workDocPaths(prompt).length || NO_BUNDLE_LINE.test(String(prompt))) return null;
  const line = BUNDLE_LINE.exec(String(prompt));
  if (line && !/^없음/.test(line[1].trim())) return null; // 까닭 없는 「묶음: 없음」은 출구가 아니다
  const big = bigDocRefs(prompt);
  if (!big.length) return null;
  const script = path.join(__dirname, '..', 'scripts', 'work-bundle.js');
  if (!fs.existsSync(script)) return null;
  const bare = big.find((b) => !b.sectioned);
  const make = '작업 문서(`<!-- work-doc -->` 머리, `공통:` 줄에 큰 문서에서 빌릴 결정 이름, 꼴은 COMPANY_RULES.md 「작업 문서」)를 만들고 `node ~/.claude/subagent-system/scripts/work-bundle.js --work <작업 문서>`로 엮어 그 출력 경로를 `묶음: <경로>` 줄로 적어라';
  if (bare) return { block: `결정 문서 ${bare.file}는 큰 결정 문서(\`<!-- decision-doc -->\`)인데 절 없이 통째로 가리켰고 지시문에 \`묶음: <경로>\` 줄이 없다. 통째로 넘기면 실무자가 필요 없는 행을 읽다 이 일에 걸리는 규칙과 정한 결정을 놓친다. 이 일의 ${make}. 작은 일이거나 읽기만 하는 점검이면 \`묶음: 없음(까닭)\`.` };
  return { notice: `결정 문서 ${big[0].file}는 큰 결정 문서이고 지시문에 \`묶음: <경로>\` 줄이 없다(절을 달아 좁혀 가리켰으니 막지는 않는다). 걸리는 규칙과 작업 순서까지 한 장으로 넘기려면 ${make}.` };
}

function findRoutedCell(description, routing) {
  let best = null;
  for (const row of routing) {
    if (description.includes(row.name) && (!best || row.name.length > best.length)) best = { length: row.name.length, name: row.name };
  }
  if (!best) return null;
  return routing.filter((r) => r.name === best.name);
}

// 결정어(사용자를 부르는 낱말)가 든 「~(이|가) 정한」을 지킬 결정 표시로 받는 정규식. 낱말은 사용자 설정(userSettings.cjs)이 주고,
// 그 모듈이 없는 옛 배치에서는 지금까지 받던 두 낱말로 돈다.
function decidedByPattern() {
  try {
    const settings = require('../scripts/userSettings.cjs');
    return settings.decidedByPattern(settings.decisionWords());
  } catch {
    return /(?:대표|사용자)(?:이|가)\s*정한/;
  }
}

// 묶음으로 나눈 판정이나 적용 일은 공통 지시에 지킬 결정과 기준끼리 부딪힐 때의 순서가 있어야 한다.
// 지시문이 가리키는 brief 파일(절대 경로 .md)까지 읽어 본다.
function batchBriefText(prompt) {
  let text = prompt;
  for (const m of prompt.matchAll(/(\/[^\s`'"()]+brief[^\s`'"()]*\.md)/g)) {
    try { text += '\n' + fs.readFileSync(m[1], 'utf8'); } catch { /* 없는 파일은 넘김 */ }
  }
  return text;
}

// 묶음 표시는 번호가 묶음의 이름표로 서 있는 꼴만 본다: 이름표 뒤에 구분 기호, 줄 끝, 목적격이나 주제 조사가 오는 꼴(「묶음 2. 제목」, 「(묶음 2)」, 「맡은 묶음(묶음 1, …)」, 「묶음 01을 채워」),
// 제목(description)에서 번호 바로 뒤에 글자가 붙지 않은 꼴(「묶음 2 점검 지적 반영」), packet-N. 번호에 단위나 차례가 붙은 꼴(「묶음 6개」, 「묶음 13건」, 「묶음 2차」, 「묶음 3 이상」)은 셈 말이라 보지 않는다.
// 왜: 「효과 표 묶음 6개」 같은 셈 말을 묶음 번호로 읽어, 나눈 묶음 일이 아닌 지시를 막았다(10일 서로 다른 막음 7건 가운데 5건, 2026-11-08 바퀴 6 판정). 단위 낱말을 늘어놓지 않고 번호가 선 자리로 가른다.
// 전제: 문장 속에서 번호 뒤에 다른 말이 이어지는 언급(「묶음 1이고」, 「묶음 1 나가기 결정」)은 표시로 보지 않는다. 지난 10일 이런 언급이 든 지시 4건은 모두 지킬 결정을 이미 적은 지시였다.
const BUNDLE_LABEL = /(?:^|[\s(（「\[])묶음\s*(?:\d+|번호)(?=\s*[.:)）,」\]]|\s*$|[을를은는](?:\s|$))/m;
const BUNDLE_TITLE = /묶음\s*(?:\d+|번호)(?![\d가-힣A-Za-z])/;
function isBatchJudging(prompt, description) {
  const t = prompt + '\n' + description;
  const marked = /packet-\d/.test(t) || BUNDLE_LABEL.test(t) || BUNDLE_TITLE.test(description);
  return marked && /(판정|적용|검수|점검)/.test(t);
}

// 목표 줄, 결정 문서, 묶음 판정은 일을 맡기는 지시에 요구한다. 파일을 못 고치는 조회용 기본 정의(Explore, web-fetch, claude-code-guide)는 물음이나 읽을 곳을 보내는 것이라 이 꼴이 맞지 않는다.
// 왜: 600자 넘는 조회 물음 2건(web-fetch, claude-code-guide)이 목표 줄과 결정 문서 없음으로 막혔다. 막은 3건 가운데 진짜가 0건이었다(10일, 2026-11-08).
const LOOKUP_AGENTS = new Set(['Explore', 'web-fetch', 'claude-code-guide']);
const isDelegation = (type) => !LOOKUP_AGENTS.has(type);

const TRIAL_TARGET = 2;

function usageFile() {
  const dir = process.env.SUBAGENT_RECORDS_DIR || path.join(__dirname, '..', 'records');
  return path.join(dir, 'subagent-usage.tsv');
}

// 마지막 `회고` 줄의 경계 시각(넷째 칸). 없거나 읽지 못하면 빈 글자다.
function retroSince() {
  let text;
  try { text = fs.readFileSync(usageFile(), 'utf8'); } catch { return ''; }
  let at = '';
  for (const l of text.split('\n')) if (l.startsWith('회고\t')) at = l.split('\t')[3] || '';
  return /^\d{4}-\d\d-\d\dT/.test(at) ? at : '';
}

// 마지막 `회고` 줄 뒤 (정의, 일 종류) 줄을 agentId(메모 첫 낱말)로 센다. 못 읽으면 null.
function trialSentCount(def, name) {
  let text;
  try { text = fs.readFileSync(usageFile(), 'utf8'); } catch { return null; }
  const lines = text.split('\n');
  let start = 0;
  lines.forEach((l, i) => { if (l.startsWith('회고\t')) start = i + 1; });
  const ids = new Set();
  for (let i = start; i < lines.length; i++) {
    const c = lines[i].split('\t');
    if (c[2] !== def || c[3] !== name) continue;
    const id = /^a(?:[0-9A-Za-z]+-)*[0-9a-f]{8,}/.exec(c[8] || '');
    ids.add(id ? id[0] : `line${i}`);
  }
  return ids.size;
}

// 사용 기록은 에이전트가 끝나야 적히므로, 이 세션에서 띄웠지만 아직 안 끝난 시험 정의도 센다.
// 그러지 않으면 한꺼번에 띄우거나 앞 시험이 도는 동안 다음 것을 보낼 때 시험 건수가 0으로 보여 계속 막는다.
// since(마지막 회고 경계 시각)가 있으면 그 뒤에 띄운 것만 센다. 경계 앞에 띄운 시험은 앞 회고가 이미 판정했다.
//   왜: 한 세션이 회고를 넘어 이어지면 경계 앞 시험 4건이 그대로 세어져, 회고 뒤 같은 칸 17건이 시험 없이 원래 칸으로 갔다(2026-11-08).
function launchedInSession(transcriptPath, def, name, since = '') {
  if (!transcriptPath) return 0;
  let text;
  try { text = fs.readFileSync(transcriptPath, 'utf8'); } catch { return 0; }
  let n = 0;
  for (const line of text.split('\n')) {
    if (!line.includes('"tool_use"') || !line.includes(def)) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    if (since && d.timestamp && d.timestamp < since) continue;
    for (const c of d.message?.content ?? []) {
      if (c?.type === 'tool_use' && (c.name === 'Agent' || c.name === 'Task') && c.input?.subagent_type === def && String(c.input?.description || '').includes(name)) n++;
    }
  }
  return n;
}

// 회사 규칙 묶음이 깔렸는지. 기록이 없거나 못 읽으면 깔린 것으로 본다(옛 설치 동작을 지킨다).
function companyInstalled() {
  try {
    return require('../scripts/kitInstalled.cjs').hasBundle('company');
  } catch {
    return true;
  }
}

// 8)의 왜: 한 화면의 판정이 고른 배치가 규칙 문서에 없는데도 「교훈」으로 다른 화면군 지시와 사용자 보고에 규칙처럼 실렸고,
//   「~와 같은 창」이라고만 쓴 지시에 그 화면에만 맞는 문구가 그대로 옮겨졌다(2026-11-08). 지시문 체크리스트의 「가리키고 출처를 단다」
//   줄을 두고도 되풀이됐고, 판정 파일 경로가 출처처럼 붙어 있어 출처가 있는지만 보는 검사로는 걸러지지 않는다.
//   그래서 옮김 말투가 있으면 항목마다 규칙 문서 줄인지 그 화면의 선택인지를 밝히는 `옮겨 온 것:` 줄을 요구한다.
// 전제: 말투는 지난 실제 지시 2000건(가리키는 scratchpad 지시 파일 포함)에 되돌려 오탐 꼴을 걷어 낸 식이다. 「」 안의 말은 인용이라,
//   `보고`로 시작하는 줄은 보고 꼴 요구라, 「~인지」로 끝나는 줄은 같은지 보라는 확인 항목이라, 같은 줄에 경로:줄이나 §번호가 있는 줄은 출처를 단 줄이라 뺀다.
//   scratchpad 파일은 같은 줄 앞에 「지시」가 있을 때만 지시 전문으로 읽는다(앞 실무자 보고 파일은 자료라서). 선언 줄은 경로:줄, §번호, 「절」, 「그 화면의 선택」, `없음(까닭)` 가운데 하나가 있어야 받는다
//   (경로만 붙은 줄은 판정 파일 경로도 통과해서다). 선언이 맞는지는 보지 않고, 선언을 쓰는 순간에 대 보게 하는 것까지가 몫이다.
const CARRY = /(?:교훈|배운 것)(?:[:：]|(?:을|를)?[^.\n]{0,20}(?:쓴다|적용한다|따른다|넣는다))|(?:판정|화면|선례|게임)(?:에서|의)[^.\n]{0,30}(?:이|그|다른) ?화면(?:군)?에도|(?:와|과) 같은 (?:창|틀|문구|모양|자리|배치)(?! ?크기)|처럼 (?:그린다|맞춘다|한다|둔다|붙인다|만든다)/;
const CARRY_DECL = /^[ \t>*#\-]*(?:\*\*)?옮겨 온 것(?:\*\*)?[ \t]*[:：]/m;
const CARRY_SOURCE = /\.[A-Za-z]{1,5}:\d+|§\s*\d|「[^」]+」|그 화면의 선택|없음\s*[(（][^)）]*[가-힣A-Za-z][^)）]*[)）]/;

// 지시문이 가리키는 scratchpad의 .md(지시 전문을 파일로 넘긴 꼴)를 읽는다. 저장소 안 문서는 자료라 읽지 않는다.
function scratchBriefText(prompt) {
  let text = '';
  let n = 0;
  for (const m of prompt.matchAll(/(\/[^\s`'"()」]+\.md)\b/g)) {
    if (!/\/scratchpad\//.test(m[1]) || /brief[^/]*\.md$/.test(m[1]) || n >= 5) continue;
    const before = prompt.slice(Math.max(0, m.index - 120), m.index);
    if (!/지시/.test(before.slice(before.lastIndexOf('\n') + 1))) continue;
    try { text += '\n' + fs.readFileSync(m[1], 'utf8').slice(0, 60000); n++; } catch { /* 없는 파일은 넘김 */ }
  }
  return text;
}

function carryProblem(text) {
  if (CARRY_DECL.test(text)) {
    const at = text.search(CARRY_DECL);
    const rest = text.slice(at);
    const end = rest.search(/\n[ \t]*\n/);
    if (CARRY_SOURCE.test(end >= 0 ? rest.slice(0, end) : rest)) return '';
  }
  const hit = text.split('\n').map((raw) => raw.replace(/「[^」]*」/g, '')).find((line) =>
    CARRY.test(line) && !/^[ \t>*#\-]*보고/.test(line) && !/인지(?:[.,\s]|$)/.test(line) && !/\.[A-Za-z]{1,5}:\d+|§\s*\d/.test(line));
  if (!hit) return '';
  return '다른 화면, 회차, 산출물에서 옮긴 줄이 있다(걸린 말 「' + CARRY.exec(hit)[0] + '」): ' + hit.trim().slice(0, 120) +
    '\n  `옮겨 온 것:` 줄에 항목마다 규칙 문서 줄(경로:줄)을 붙이거나 「그 화면의 선택(참고)」으로 적고, 같게 할 것과 이 화면에 맞게 바꿀 것(문구, 값)을 나눠라. 규칙 문서에 없는데 규칙으로 쓰려면 규칙 문서를 먼저 고친다. 옮긴 것이 없으면 `옮겨 온 것: 없음(까닭)`.';
}

// 9) 목업대로 옮기는 구현을 맡기는데 사용자가 그 목업을 보고 확인한 표시가 없는 경우.
// 왜: 한 화면 목업만 확인받고 같은 묶음의 다른 화면 목업까지 「목업 그대로 이식」으로 실무자 셋에게 맡겨, 사용자가 「목업 나한테 안 보여주지 않았어?」라고 짚었다.
//   다른 화면 그림은 앞서 한 번 보냈지만 결정 자료를 다시 줄 때 빠져 확인 말이 없었다. 보낸 기록은 있으니 보냈는지로는 못 가르고,
//   사용자가 답한 화면을 적게 해야 빠진 화면이 드러난다. 다른 세션에서 확인받은 목업도 있어 대화 기록 대신 목업 폴더 README의 남는 줄로 본다.
// 전제: 목업 폴더는 이름이 mockup으로 시작하는 폴더다(UI_WORK 「판정」). 폴더가 지시에 없으면(아티팩트 등) 지시문의 같은 꼴 줄을 받는다.
//   줄이 맞는지는 보지 않고, 줄을 쓰는 순간에 사용자가 답한 화면을 대 보게 하는 것까지가 몫이다. 리뷰, 판정, 점검처럼 옮긴 결과를 보는 지시는 보지 않는다.
const TRANSPLANT = /목업\s*(?:을|를)?\s*(?:그대로|대로)\s*(?:이식|옮기|옮겨|옮긴다|고친다|고쳐|구현|만든다)|목업\s*(?:그대로\s*)?(?:이식|옮기기)/;
const NOT_TRANSPLANT_JOB = /리뷰|점검|판정|검수|조사|측정|원인|대조/;
function confirmWords() {
  try { return require('../scripts/userSettings.cjs').decisionWords(); } catch { return ['대표', '사용자']; }
}
function confirmLine(words) {
  const alt = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp(`^[ \\t>*#\\-|]*(?:\\*\\*)?(?:${alt})\\s*확인(?:\\*\\*)?[ \\t]*[:：|][ \\t]*\\S`, 'm');
}
function mockupDirs(text) {
  const home = process.env.HOME || require('os').homedir();
  const dirs = new Set();
  for (const m of text.matchAll(/(?:~\/|\/)[^\s`'"()」,]+/g)) {
    const parts = m[0].replace(/^~\//, home + '/').split('/');
    const at = parts.findIndex((p, i) => i > 0 && /^mockups?/i.test(p));
    if (at > 0) dirs.add(parts.slice(0, at + 1).join('/'));
  }
  return [...dirs];
}
function unconfirmedMockup(text, description) {
  if (NOT_TRANSPLANT_JOB.test(description) || doesNotFix(text)) return '';
  const plain = text.replace(/「[^」]*」/g, '');
  if (!TRANSPLANT.test(plain) && !TRANSPLANT.test(description)) return '';
  const words = confirmWords();
  const line = confirmLine(words);
  const dirs = mockupDirs(text);
  const who = words[0] || '사용자';
  let ga = '가';
  try { ga = require('../scripts/userSettings.cjs').josa(who, '이/가'); } catch { /* 옛 배치 */ }
  const form = '`' + who + ' 확인: <날짜> <본 화면들> 「<' + who + ga + ' 답한 말>」`';
  if (!dirs.length) {
    if (line.test(text)) return '';
    return `목업대로 옮기는 일인데 ${who}${ga} 그 목업을 보고 확인한 표시가 없다. 보낸 그림에 ${who}${ga} 답한 화면만 확인이다. 확인받은 화면을 지시문에 ${form} 줄로 적고, 아직 안 보인 화면은 먼저 보여 확인받거나 이번 지시에서 뺀다. 확인이 필요 없으면 \`${who} 확인: 없음(까닭)\`.`;
  }
  const missing = dirs.filter((d) => { try { return !line.test(fs.readFileSync(path.join(d, 'README.md'), 'utf8')); } catch { return true; } });
  if (!missing.length) return '';
  return `목업대로 옮기는 일인데 목업 폴더 README.md에 ${who} 확인 줄이 없다: ${missing.join(', ')}. 보낸 그림에 ${who}${ga} 답한 화면만 확인이다. 확인받은 화면을 그 README에 ${form} 줄로 적고(다른 세션도 읽는다), 아직 안 보인 화면은 먼저 보여 확인받거나 이번 지시에서 뺀다. 확인이 필요 없으면 \`${who} 확인: 없음(까닭)\`.`;
}
function check(toolInput, routing, ctx = {}) {
  // 본문을 공통 지시 파일(brief)에 두고 가리키기만 한 짧은 지시문도 그 파일까지 합쳐 본다.
  const prompt = batchBriefText(String(toolInput.prompt || ''));
  const description = String(toolInput.description || '');
  const type = String(toolInput.subagent_type || '');
  if (/^haiku/.test(type) || toolInput.model === 'haiku') return [];
  const carryText = prompt + scratchBriefText(String(toolInput.prompt || ''));
  const carry = carryText.length >= MIN_PROMPT_CHARS ? carryProblem(carryText) : '';
  if (prompt.length < MIN_PROMPT_CHARS) return carry ? [carry] : [];
  const company = (ctx.company ?? companyInstalled()) && isDelegation(type);

  const problems = carry ? [carry] : [];
  if (company && !hasGoalLine(prompt)) {
    problems.push('`목표:` 줄이 없다. 이번 일이 무엇이 어떻게 되면 끝인지 한 문장으로 `목표: ...` 줄에 적어라(프로젝트에 적힌 목표가 있으면 함께).');
  }
  if (company && !hasDecisionDoc(prompt)) {
    problems.push('결정 문서 경로가 없다. 대화에서 정한 내용을 정리한 결정 문서의 절대 경로(코드 작업이면 결정을 적은 정본 문서 경로와 절 이름)를 `결정 문서: <경로>`로 적고, 정할 것이 없으면 `결정 문서: 없음(까닭)`으로 적어라.');
  }

  if (company) {
    const bundle = bundleProblem(prompt);
    if (bundle) problems.push(bundle);
    const big = bigDocFinding(prompt);
    if (big && big.block) problems.push(big.block);
  }

  if (company && isBatchJudging(prompt, description)) {
    const text = prompt;
    if (!(/지킬 결정/.test(text) || decidedByPattern().test(text)) || !/부딪/.test(text)) {
      problems.push('묶음으로 나눈 판정이나 적용 일인데 공통 지시에 지킬 결정(사용자가 정해 빼면 안 되는 기능과 선택지, 걷는 시점이 따로 정해진 것)과 기준끼리 부딪힐 때의 순서가 없다. `지킬 결정:` 줄과 `부딪힐 때:` 줄을 적거나, 없으면 `지킬 결정: 없음(까닭)`, `부딪힐 때: 없음(까닭)`으로 적어라.');
    }
  }

  if (company) {
    const mock = unconfirmedMockup(carryText, description);
    if (mock) problems.push(mock);
  }
  const def = parseDefinition(type);
  // 5)의 왜: description에 표의 일 이름이 없으면 사용 기록 훅이 일 종류를 못 적고(그 기록은 칸 판정에서 빠짐) 3), 4)가 소리 없이 건너뛰어진다.
  //   GUIDE 문장만으로는 지켜지지 않았다(2026-11-01~02 회고 구간 Agent 134건 가운데 132건이 「N회차 …」 꼴이라 표 칸을 못 찾고, 시험 표시 칸 리뷰 지적 수정에 21건이 시험 없이 감).
  if (def && routing && routing.length && !findRoutedCell(description, routing) && !/표에 없는 일\s*[:：]/.test(description)) {
    // 후보: 보낸 정의(model-effort)가 맡는 표 칸의 일 이름. AI가 표를 다시 찾아 맞추는 기계 일을 없애려고 막음 글에 싣는다(지시문 막음 34건 중 12건이 이 막음).
    const cellNames = [...new Set(routing.filter((r) => r.model === def.model && r.effort === def.effort).map((r) => r.name))];
    problems.push(
      'description에 라우팅 표의 일 이름이 없다. `<표의 일 이름>: <요지>` 꼴로 적어라(예: `리뷰 지적 수정: 9회차 막음 고침`). ' +
        (cellNames.length ? `${type}가 맡는 칸의 일 이름: ${cellNames.join(', ')}. 이 가운데 맞는 것을 골라라. ` : '') +
        '표에 맞는 일이 없으면 description에 `표에 없는 일: <이름>`을 적어라(이름은 `subagent-retro.js --kinds`로 이미 쓴 이름부터 본다).'
    );
  }
  if (def && routing && routing.length && !/(높임|올림)\s*[:：]/.test(prompt + '\n' + description)) {
    const cells = findRoutedCell(description, routing);
    if (cells) {
      const ceiling = cells.reduce((a, b) => (isHigher(b, a) ? b : a));
      if (isHigher(def, ceiling)) {
        problems.push(
          `「${cells[0].name}」은 라우팅 표에서 ${ceiling.model}-${ceiling.effort} 칸인데 ${type}로 보냈다. ` +
            '처음 보내는데 일이 커서 높인 것이면 prompt나 description에 `높임: <까닭>`을 적고, 앞 서브에이전트가 실패해 올려 다시 보내는 것이면 `올림: <앞 정의와 실패 까닭>`을 적고, 표를 놓친 것이면 표의 정의로 바꿔라.'
        );
      }
    }
  }
  if (def && routing && routing.length && !/(높임|올림|시험 건너뜀)\s*[:：]/.test(prompt + '\n' + description)) {
    const cells = findRoutedCell(description, routing);
    const trialRow = cells && cells.find((r) => r.trial);
    if (trialRow && type !== trialRow.trial) {
      const logged = trialSentCount(trialRow.trial, trialRow.name);
      const sent = logged === null ? null : Math.max(logged, launchedInSession(ctx.transcriptPath, trialRow.trial, trialRow.name, retroSince()));
      if (sent !== null && sent < TRIAL_TARGET) {
        problems.push(
          `「${trialRow.name}」 칸에 시험 표시(\`${trialRow.trial}\`)가 있고 이 회고 구간에 시험 정의로 보낸 건이 ${sent}건이다. ` +
            `${TRIAL_TARGET}건이 찰 때까지 ${trialRow.trial}로 보내라(여럿을 한꺼번에 띄우면 남은 건만큼만). 이 일이 시험에 맞지 않으면 prompt나 description에 \`시험 건너뜀: <까닭>\`을 적어라.`
        );
      }
    }
  }
  // 6)의 왜: sonnet, opus 정의는 git 상태를 바꾸는 명령과 `git worktree`를 막는데(SUBAGENT_GUIDE 「git」), 지시문이 워크트리 만들기나 커밋을 시켜
  //   실무자가 막혀 보고만 하는 일이 2026-11-07~08에 세 번 났다(정의커밋금지충돌). 워크트리는 메인이 만들어 경로를 주고 커밋은 메인이 한다.
  // 7)의 왜: 끝난 기준에 전체 시험 명령만 주면 실무자가 고칠 때마다 전체를 돌린다(SUBAGENT_BRIEF_CHECKLIST 「확인 칸」 줄을 두고도 2026-10-29, 11-08 두 번, 한 번에 10분짜리를 여러 번).
  if (def && fullTestOnly(prompt, description)) {
    problems.push('지시문이 전체 시험 명령만 준다. 작업 중에는 고친 파일의 시험만 돌리고 전체 시험은 끝에 한 번 돌리라고 적어라(중간 확인 명령이 있으면 함께).');
  }
  if (def && gitStateAsk(prompt)) {
    problems.push('지시문이 실무자에게 워크트리 만들기나 커밋(`git worktree add`, `git commit`, `git add`, 「커밋한다」)을 시킨다. 정의가 그 명령을 막으니 워크트리는 메인이 먼저 만들어 경로를 주고, 커밋은 메인이 한다고 적어라.');
  }
  return problems;
}

// 실무자에게 git 상태를 바꾸게 시키는 말. 「커밋은 메인이 한다」, 「커밋하지 않는다」, 「~로 만들지 말고」, 금지 명령을 늘어놓은 문장(GUIDE 「git」이 이름으로 열거하라고 함)은 잡지 않는다.
// 문장은 한글이나 닫는 괄호 뒤의 마침표로만 끊는다(파일 이름의 「.md 」에서 끊으면 부정어와 명령이 갈린다). 「」 안의 말은 만들 훅이 찍을 문구 같은 인용이라 뺀다(2026-11-08 오탐 두 건).
function gitStateAsk(prompt) {
  // 지시문 어디엔가 「커밋은 메인이 한다」가 있으면 커밋 말은 낱문장 판정 없이 넘긴다(새 말투마다 부정어 정규식을 고치지 않게). 워크트리 만들기는 그래도 본다.
  const mainCommits = /(?:커밋|저장)은 메인|메인이 (?:커밋|저장)/.test(String(prompt));
  return String(prompt).split(/\n|(?<=[가-힣)」\]`])[.。](?:\s|$)/).some((raw) => {
    const line = raw.replace(/「[^」]*」/g, '');
    if (/(?:쓰지 않|하지 않|않는다|않고|말고|말 것|마라|금지|막는|막혀|막힌|메인이)/.test(line)) return false;
    if (/git\s+(?:-C\s+\S+\s+)?worktree\s+add\b/.test(line)) return true;
    if (mainCommits) return false;
    return /git\s+(?:-C\s+\S+\s+)?(?:commit|add)\b/.test(line) || /커밋(?:한다|해라|하라|하고|해 둔다|해 주세요)/.test(line);
  });
}

// 전체 시험을 돌리게 하는 말(전체 시험, tests/*.test.js, npm test, pytest 맨몸)이 있는데 「끝에 한 번」이나 중간 확인을 따로 적지 않았다.
// 시험을 돌리는 것이 일인 지시(실행, 검증, 리뷰, 검수, 점검)와 고치지 않는 지시는 보지 않는다. 고치는 일의 끝난 기준에 전체 시험이 걸릴 때만 본다.
// 고치지 않는 지시는 일 종류 낱말을 늘리지 않고 지시문이 밝힌 모양으로 가른다: 문장이 「파일을 고치지 않는다」로 시작하거나 판정, 결과 파일만 쓰게 했으면 고치기를 맡기지 않은 것이다.
// 「너는 문서를 고치지 않는다」, 「앞 회차 파일은 고치지 않는다」처럼 앞에 말이 붙어 범위를 줄이는 문장은 고치기를 맡긴 지시 안의 제한이라 보지 않는다.
// 왜: 일 종류가 문서 내용 검토인 지시(「파일을 고치지 않는다(판정 파일만 쓴다)」)가 제약의 전체 시험 말과 「판정 대상에 넣는다」의 「넣는다」에 걸려, 10일 5번 가운데 3번이 헛막음이었다(2026-11-08 판정).
//   처음 식은 어디서든 「파일을 고치지 않는다」를 받아, 공통 지시 파일의 「앞 회차 파일은 고치지 않는다」 같은 제한 문장이 고치는 일 12건의 전체 시험 검사를 꺼 버렸다.
const READ_ONLY_SAY = /(?:^|\n|[.。]\s)\s*(?:[-*]\s*)?(?:파일|문서|코드|저장소)[을를은는]?\s*(?:모두\s*)?(?:고치지|수정하지)\s*(?:않|말)|(?:판정|결과|검토|보고)\s*(?:파일|문서)(?:만\s*(?:쓴다|쓰|적|남긴)|\s*(?:말고|외에는)[^.\n]{0,20}(?:고치지|수정하지)\s*않)/;
const doesNotFix = (prompt) => READ_ONLY_SAY.test(String(prompt));
function fullTestOnly(prompt, description = '') {
  const p = String(prompt);
  if (/실행|검증|리뷰|검수|점검|측정|조사|원인|찾기/.test(String(description))) return false;
  if (!/끝난 기준/.test(p) || !/(?:고친다|고쳐|구현|만든다|넣는다|옮긴다|더한다)/.test(p)) return false;
  if (doesNotFix(p)) return false;
  if (!/전체 시험|전체 테스트|tests\/\*\.test\.[cm]?js|npm (?:run )?test\b|\bpytest\b(?!\s+\S*(?:::|\.py))/.test(p)) return false;
  return !/(?:끝에|마지막에|마치고|끝날 때)\s*(?:한\s*번|한번|1회)|중간 확인|고친 (?:파일|곳)의 시험|해당 시험만|그 시험만/.test(p);
}

// 다른 세션에 일을 넘기는 메시지. 실무자 지시문과 같이 목표가 없으면 받은 쪽이 할 일만 알고 왜를 몰라 판단이 갈린다(2026-11-08 넘김 문서에 목표 줄이 없어 대표가 짚음).
// 받는 쪽이 실무자(agentId는 16자 넘는 16진수)면 보지 않는다. 메시지나 메시지가 가리키는 .md 파일(「넘김」 절이 있으면 그 절)에 목표 줄이 있어야 한다.
const HANDOFF_WORDS = /넘김|넘깁니다|넘겨받|넘겨 드|이어 받|이어받|맡깁니다|모읍니다/;
// 받는 쪽이 이 세션이 Agent로 띄우며 name을 붙인 실무자면 세션 넘김이 아니다(실무자 지시문은 Agent 호출 때 이미 목표 줄을 검사했다).
// 왜: 「맡깁니다」, 「넘김」이 든 실무자 이어 말 4건(turn-play-fix 등)이 모두 막혔고, 세션에 넘긴 3건은 막힌 적이 없다(10일 SendMessage 437건, 2026-11-08). 낱말로 가르지 않고 받는 쪽이 누구인지로 가른다.
// 대화 기록은 크게 자라므로 조각으로 읽으며 Agent 호출 줄에서만 찾고, 넘김 낱말이 든 목표 없는 메시지에서만 부른다.
function launchedWorkerNamed(transcriptPath, to) {
  if (!transcriptPath || !to) return false;
  const needle = Buffer.from(`"name":${JSON.stringify(to)}`);
  let fd;
  try {
    fd = fs.openSync(transcriptPath, 'r');
    const size = fs.fstatSync(fd).size;
    const CHUNK = 16 * 1024 * 1024;
    const KEEP = 4096;
    const buf = Buffer.alloc(CHUNK + KEEP);
    let carry = 0;
    for (let pos = 0; pos < size; pos += CHUNK) {
      const n = fs.readSync(fd, buf, carry, CHUNK, pos);
      const view = buf.subarray(0, carry + n);
      for (let at = view.indexOf(needle); at >= 0; at = view.indexOf(needle, at + 1)) {
        const before = view.subarray(Math.max(0, at - 2000), at).toString('utf8');
        const head = before.slice(before.lastIndexOf('\n') + 1);
        if (/"name":"(?:Agent|Task)","input":\{[^\n]*$/.test(head)) return true;
      }
      carry = Math.min(KEEP, view.length);
      view.copy(buf, 0, view.length - carry);
    }
  } catch { /* 읽지 못하면 실무자인지 모른다: 지금처럼 검사한다 */ } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* 이미 닫힘 */ } }
  return false;
}

function handoffProblems(toolInput, ctx = {}) {
  const to = String(toolInput.to || '');
  const msg = typeof toolInput.message === 'string' ? toolInput.message : '';
  if (!msg || /^a?[0-9a-f]{16,}$/.test(to) || !HANDOFF_WORDS.test(msg)) return [];
  if (hasGoalLine(msg)) return [];
  if (launchedWorkerNamed(ctx.transcriptPath, to.replace(/\s*\[.*\]$/, ''))) return [];
  const home = process.env.HOME || require('os').homedir();
  const files = [...msg.matchAll(/(~\/[^\s`'"」)]+\.md|\/[^\s`'"」)]+\.md)/g)].map((m) => m[1].replace(/^~\//, home + '/'));
  for (const f of files) {
    let text;
    try { text = require('fs').readFileSync(f, 'utf8'); } catch { continue; }
    const at = text.search(/^#{1,4} .*넘김/m);
    if (at >= 0) {
      const rest = text.slice(at);
      const body = rest.indexOf('\n') + 1;
      const next = body > 0 ? rest.slice(body).search(/^#{1,2} /m) : -1;
      text = next >= 0 ? rest.slice(0, body + next) : rest;
    }
    if (hasGoalLine(text)) return [];
  }
  return ['다른 세션에 일을 넘기는 메시지인데 메시지에도, 가리키는 넘김 문서(「넘김」 절)에도 `목표:` 줄이 없다. 실무자 지시문처럼 목표(누구에게 무엇이 좋아지면 끝인지), 결정 문서, 끝난 기준과 할 일마다의 까닭을 넘김 문서에 적고 다시 보내라.'];
}

// 뒤에서 돌릴 실무자에 이름(name)을 붙이면 끝 메시지가 늦게 닿아 메인이 멈춰 기다리고 깨우는 예약이 막힌다(SUBAGENT_GUIDE 「부르는 법」).
// 왜: 이름 붙인 뒤 실무자 86번이 끝 메시지를 늦게 보내 「결과 늦음」 31번과 깨우는 예약 막음 26번을 낳았다(11-09~10, 한 세션). 규칙 문장만으로는 되풀이됐다.
// 전제: 팀원 띄우기(team_name이 있는 호출)는 이름이 팀 안에서 부르는 주소라 막지 않는다. 앞에서 돌리는(run_in_background가 참이 아닌) 호출도 막지 않는다.
function namedBackground(toolInput) {
  // 실제 기록의 run_in_background는 문자열 "true"로 남아 있어(11-08 뒤 Agent 184건 모두) 불린과 문자열을 함께 받는다.
  if (!toolInput || ![true, 'true'].includes(toolInput.run_in_background) || !toolInput.name || toolInput.team_name) return [];
  return [`뒤에서 돌리는 실무자(run_in_background: true)에 이름(name: ${JSON.stringify(String(toolInput.name))})을 붙였다. name을 빼고 다시 띄우고, 이어 보낼 말은 결과 글의 agentId로 SendMessage한다(SUBAGENT_GUIDE 「부르는 법」). 까닭: 이름 붙인 실무자의 끝 메시지는 메인이 쉬는 동안 늦게 닿아 메인이 멈춰 기다리고, 깨우는 예약도 막힌다.`];
}

// 막지는 않고 알리기만 하는 것(절을 단 큰 결정 문서 지시에 묶음 줄이 없음). check()와 같은 거르기를 쓴다.
function notices(toolInput, ctx = {}) {
  const prompt = batchBriefText(String(toolInput.prompt || ''));
  const type = String(toolInput.subagent_type || '');
  if (/^haiku/.test(type) || toolInput.model === 'haiku' || prompt.length < MIN_PROMPT_CHARS) return [];
  if (!((ctx.company ?? companyInstalled()) && isDelegation(type))) return [];
  const big = bigDocFinding(prompt);
  return big && big.notice ? [big.notice] : [];
}

function main(raw) {
  let input;
  try { input = JSON.parse(raw); } catch { return null; }
  if (input.tool_name === 'SendMessage') {
    const hp = handoffProblems(input.tool_input || {}, { transcriptPath: input.transcript_path });
    if (!hp.length) return null;
    return named({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: '세션 넘김 메시지를 보내기 전에 고쳐라.\n- ' + hp.join('\n- ') } }, ['세션 넘김 메시지']);
  }
  if (input.tool_name && input.tool_name !== 'Agent' && input.tool_name !== 'Task') return null;
  const toolInput = input.tool_input || {};
  let routing = [];
  try { routing = loadRouting(); } catch { routing = []; }
  const problems = [...namedBackground(toolInput), ...check(toolInput, routing, { transcriptPath: input.transcript_path })];
  if (!problems.length) {
    let notes = [];
    try { notes = notices(toolInput); } catch { notes = []; }
    return notes.length ? { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: `지시문 점검 알림: ${notes.join(' ')}` } } : null;
  }
  return named({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason:
        '서브에이전트 지시문을 보내기 전에 고쳐라.\n- ' + problems.join('\n- ') +
        '\n왜: 목표와 결정 문서가 빠진 지시문은 재지시와 되돌림을 만든다. ' +
        '전제: 600자 아래 지시와 haiku 정의는 검사하지 않는다(옮겨 온 것 검사는 지시라고 가리킨 scratchpad 파일까지 합쳐 잰다). 묶음 판정 검사는 지시문과 그 안의 brief 경로 파일을 읽는다. 시험 표시 검사는 사용 기록의 마지막 회고 뒤 건수를 센다.',
    },
  }, problems.map((p) => `지시문 점검 ${p.split(/[.:(]/)[0].trim().slice(0, 40)}`));
}

if (require.main === module) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => (raw += c));
  process.stdin.on('end', () => {
    let out = null;
    try { out = main(raw); } catch { out = null; }
    if (out) { reportBlocks(out); process.stdout.write(JSON.stringify(out)); }
    process.exit(0);
  });
}

module.exports = { batchBriefText, BUNDLE_LINE, bigDocFinding, notices, namedBackground, gitStateAsk, handoffProblems, launchedWorkerNamed, fullTestOnly, launchedInSession, isBatchJudging, check, main, parseRoutingTable, hasGoalLine, hasDecisionDoc, trialSentCount };
