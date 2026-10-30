#!/usr/bin/env node
// 무엇: PreToolUse(matcher Agent) 훅. 서브에이전트 지시문에 아래가 빠졌으면 deny하고 빠진 것을 알린다.
//   1) `목표:` 줄  2) 결정 문서 경로 또는 「결정 문서: 없음(까닭)」
//   3) 라우팅 표의 칸보다 높은 정의로 보내면서 prompt나 description에 `높임: <까닭>`이나 `올림: <앞 정의와 실패 까닭>`이 없는 경우
// 왜: 목표와 결정 문서가 빠진 지시문은 재지시와 되돌림을 만들어서, 체크리스트 글 대신 보내기 직전에 기계로 막는다.
//   `높임:`은 회고가 표 칸과 다른 배정을 분류하는 근거라 처음 보낼 때 남겨야 한다.
//   `올림:`은 실패해 한 단계 올려 다시 보내는 지시(Fable 단계 포함)의 표시다. 올림은 표 칸이 아니라 앞 실패가 정의를 정하므로
//   이 줄이 있으면 3)을 건너뛴다. 처음 보냄의 높임과 올림이 기록에서 섞이지 않게 줄 이름을 나눈다.
// 전제: 정의가 haiku 계열이거나 prompt가 600자 아래인 짧은 조회는 검사하지 않고, 경계는 재지시 기록으로 고친다.
//   라우팅 표는 이 훅 옆 설치본 docs/ROUTING_TABLE.md의 `| **Haiku** | ...` 꼴 표를 읽는다. 표를 못 읽거나
//   일 종류가 표의 어느 줄과도 안 맞으면 3)만 건너뛴다(훅 오류로 모든 Agent 호출이 막히지 않게).
//   일 종류는 description에서 표의 일 이름을 찾아 가린다(가장 긴 이름).
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
        if (name) rows.push({ name, model, effort: efforts[i] });
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

function check(toolInput, routing) {
  const prompt = String(toolInput.prompt || '');
  const description = String(toolInput.description || '');
  const type = String(toolInput.subagent_type || '');
  if (/^haiku/.test(type) || toolInput.model === 'haiku') return [];
  if (prompt.length < MIN_PROMPT_CHARS) return [];

  const problems = [];
  if (!hasGoalLine(prompt)) {
    problems.push('`목표:` 줄이 없다. 이번 일이 무엇이 어떻게 되면 끝인지 한 문장으로 `목표: ...` 줄에 적어라(프로젝트에 적힌 목표가 있으면 함께).');
  }
  if (!hasDecisionDoc(prompt)) {
    problems.push('결정 문서 경로가 없다. 대화에서 정한 내용을 정리한 결정 문서의 절대 경로를 `결정 문서: <경로>`로 적고, 정할 것이 없으면 `결정 문서: 없음(까닭)`으로 적어라.');
  }

  const def = parseDefinition(type);
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
  return problems;
}

function main(raw) {
  let input;
  try { input = JSON.parse(raw); } catch { return null; }
  if (input.tool_name && input.tool_name !== 'Agent' && input.tool_name !== 'Task') return null;
  const toolInput = input.tool_input || {};
  let routing = [];
  try { routing = loadRouting(); } catch { routing = []; }
  const problems = check(toolInput, routing);
  if (!problems.length) return null;
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason:
        '서브에이전트 지시문을 보내기 전에 고쳐라.\n- ' + problems.join('\n- ') +
        '\n왜: 목표와 결정 문서가 빠진 지시문은 재지시와 되돌림을 만든다. ' +
        '전제: 600자 아래 지시와 haiku 정의는 검사하지 않는다.',
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

module.exports = { check, main, parseRoutingTable, hasGoalLine, hasDecisionDoc };
