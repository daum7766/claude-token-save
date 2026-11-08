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

function isBatchJudging(prompt, description) {
  const t = prompt + '\n' + description;
  return /(묶음\s*(\d|번호)|packet-\d)/.test(t) && /(판정|적용|검수|점검)/.test(t);
}

const TRIAL_TARGET = 2;

function usageFile() {
  const dir = process.env.SUBAGENT_RECORDS_DIR || path.join(__dirname, '..', 'records');
  return path.join(dir, 'subagent-usage.tsv');
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
function launchedInSession(transcriptPath, def, name) {
  if (!transcriptPath) return 0;
  let text;
  try { text = fs.readFileSync(transcriptPath, 'utf8'); } catch { return 0; }
  let n = 0;
  for (const line of text.split('\n')) {
    if (!line.includes('"tool_use"') || !line.includes(def)) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
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

function check(toolInput, routing, ctx = {}) {
  // 본문을 공통 지시 파일(brief)에 두고 가리키기만 한 짧은 지시문도 그 파일까지 합쳐 본다.
  const prompt = batchBriefText(String(toolInput.prompt || ''));
  const description = String(toolInput.description || '');
  const type = String(toolInput.subagent_type || '');
  if (/^haiku/.test(type) || toolInput.model === 'haiku') return [];
  if (prompt.length < MIN_PROMPT_CHARS) return [];
  const company = ctx.company ?? companyInstalled();

  const problems = [];
  if (company && !hasGoalLine(prompt)) {
    problems.push('`목표:` 줄이 없다. 이번 일이 무엇이 어떻게 되면 끝인지 한 문장으로 `목표: ...` 줄에 적어라(프로젝트에 적힌 목표가 있으면 함께).');
  }
  if (company && !hasDecisionDoc(prompt)) {
    problems.push('결정 문서 경로가 없다. 대화에서 정한 내용을 정리한 결정 문서의 절대 경로(코드 작업이면 결정을 적은 정본 문서 경로와 절 이름)를 `결정 문서: <경로>`로 적고, 정할 것이 없으면 `결정 문서: 없음(까닭)`으로 적어라.');
  }

  if (company && isBatchJudging(prompt, description)) {
    const text = prompt;
    if (!(/지킬 결정/.test(text) || decidedByPattern().test(text)) || !/부딪/.test(text)) {
      problems.push('묶음으로 나눈 판정이나 적용 일인데 공통 지시에 지킬 결정(사용자가 정해 빼면 안 되는 기능과 선택지, 걷는 시점이 따로 정해진 것)과 기준끼리 부딪힐 때의 순서가 없다. `지킬 결정:` 줄과 `부딪힐 때:` 줄을 적거나, 없으면 `지킬 결정: 없음(까닭)`, `부딪힐 때: 없음(까닭)`으로 적어라.');
    }
  }

  const def = parseDefinition(type);
  // 5)의 왜: description에 표의 일 이름이 없으면 사용 기록 훅이 일 종류를 못 적고(그 기록은 칸 판정에서 빠짐) 3), 4)가 소리 없이 건너뛰어진다.
  //   GUIDE 문장만으로는 지켜지지 않았다(2026-11-01~02 회고 구간 Agent 134건 가운데 132건이 「N회차 …」 꼴이라 표 칸을 못 찾고, 시험 표시 칸 리뷰 지적 수정에 21건이 시험 없이 감).
  if (def && routing && routing.length && !findRoutedCell(description, routing) && !/표에 없는 일\s*[:：]/.test(description)) {
    problems.push(
      'description에 라우팅 표의 일 이름이 없다. `<표의 일 이름>: <요지>` 꼴로 적어라(예: `리뷰 지적 수정: 9회차 막음 고침`). ' +
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
      const sent = logged === null ? null : Math.max(logged, launchedInSession(ctx.transcriptPath, trialRow.trial, trialRow.name));
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
function fullTestOnly(prompt, description = '') {
  const p = String(prompt);
  if (/실행|검증|리뷰|검수|점검|측정|조사|원인|찾기/.test(String(description))) return false;
  if (!/끝난 기준/.test(p) || !/(?:고친다|고쳐|구현|만든다|넣는다|옮긴다|더한다)/.test(p)) return false;
  if (!/전체 시험|전체 테스트|tests\/\*\.test\.[cm]?js|npm (?:run )?test\b|\bpytest\b(?!\s+\S*(?:::|\.py))/.test(p)) return false;
  return !/(?:끝에|마지막에|마치고|끝날 때)\s*(?:한\s*번|한번|1회)|중간 확인|고친 (?:파일|곳)의 시험|해당 시험만|그 시험만/.test(p);
}

// 다른 세션에 일을 넘기는 메시지. 실무자 지시문과 같이 목표가 없으면 받은 쪽이 할 일만 알고 왜를 몰라 판단이 갈린다(2026-11-08 넘김 문서에 목표 줄이 없어 대표가 짚음).
// 받는 쪽이 실무자(agentId는 16자 넘는 16진수)면 보지 않는다. 메시지나 메시지가 가리키는 .md 파일(「넘김」 절이 있으면 그 절)에 목표 줄이 있어야 한다.
const HANDOFF_WORDS = /넘김|넘깁니다|넘겨받|넘겨 드|이어 받|이어받|맡깁니다|모읍니다/;
function handoffProblems(toolInput) {
  const to = String(toolInput.to || '');
  const msg = typeof toolInput.message === 'string' ? toolInput.message : '';
  if (!msg || /^a?[0-9a-f]{16,}$/.test(to) || !HANDOFF_WORDS.test(msg)) return [];
  if (hasGoalLine(msg)) return [];
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

function main(raw) {
  let input;
  try { input = JSON.parse(raw); } catch { return null; }
  if (input.tool_name === 'SendMessage') {
    const hp = handoffProblems(input.tool_input || {});
    if (!hp.length) return null;
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: '세션 넘김 메시지를 보내기 전에 고쳐라.\n- ' + hp.join('\n- ') } };
  }
  if (input.tool_name && input.tool_name !== 'Agent' && input.tool_name !== 'Task') return null;
  const toolInput = input.tool_input || {};
  let routing = [];
  try { routing = loadRouting(); } catch { routing = []; }
  const problems = check(toolInput, routing, { transcriptPath: input.transcript_path });
  if (!problems.length) return null;
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason:
        '서브에이전트 지시문을 보내기 전에 고쳐라.\n- ' + problems.join('\n- ') +
        '\n왜: 목표와 결정 문서가 빠진 지시문은 재지시와 되돌림을 만든다. ' +
        '전제: 600자 아래 지시와 haiku 정의는 검사하지 않는다. 묶음 판정 검사는 지시문과 그 안의 brief 경로 파일을 읽는다. 시험 표시 검사는 사용 기록의 마지막 회고 뒤 건수를 센다.',
    },
  };
}

if (require.main === module) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => (raw += c));
  process.stdin.on('end', () => {
    let out = null;
    try { out = main(raw); } catch { out = null; }
    if (out) process.stdout.write(JSON.stringify(out));
    process.exit(0);
  });
}

module.exports = { gitStateAsk, handoffProblems, fullTestOnly, launchedInSession, isBatchJudging, check, main, parseRoutingTable, hasGoalLine, hasDecisionDoc, trialSentCount };
