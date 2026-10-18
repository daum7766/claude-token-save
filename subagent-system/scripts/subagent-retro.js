#!/usr/bin/env node

/**
 * subagent-retro.js
 *
 * 서브에이전트 회고 준비. 사용 기록과 비용 기록을 짝지어 표와 칸 조정 후보를 내고,
 * 지난 회고 뒤의 사용자 메시지를 뽑아 정정 분류를 받아 정정 기록에 덧붙인다.
 *
 * 실행:
 *   node scripts/subagent-retro.js                                    표와 칸 조정 후보(기록은 쓰지 않음. CLAUDE.md가 200줄 이하이면 config.json의 claudeMdKeptLines만 지움)
 *   node scripts/subagent-retro.js --where                            기록 폴더의 절대 경로만 찍음(어느 폴더에서 실행해도 같음)
 *   node scripts/subagent-retro.js --count                            지난 회고 뒤 사용 기록 줄 수만 찍음
 *   node scripts/subagent-retro.js --due                              회고를 물을 때인지 `ask`, `auto`(자동 회고 방식), `wait <남은 줄 수>`로 찍음(사용 기록 줄 수에 비용 기록에만 있는 서브에이전트를 더해 셈. 회고를 거듭할수록 기준이 30건, 50건, 100건으로 오르고 표가 안정되면 200건. 기록 건수와 상관없이 마지막 회고 뒤 같은 칸이 올리기 후보 조건(올림이 붙은 에이전트 2명 이상, 칸 에이전트의 20% 이상)이면 ask이고 그 칸은 둘째 줄에 찍음)
 *   node scripts/subagent-retro.js --snooze                           사용자가 회고를 미뤘다는 표시 줄을 사용 기록에 덧붙임(그 뒤 기준의 절반만큼, 최대 20줄 쌓일 때까지 --due가 wait. 올림이 쌓인 칸은 올림이 붙은 에이전트가 1명 더 생겨 조건을 다시 채울 때까지 묻지 않음. 그때 걸린 기준만 미루고, 기간 기준이 걸렸을 때만 기간 셈을 오늘부터 다시 함)
 *   node scripts/subagent-retro.js --retro-mode [auto|ask]            회고 방식(config.json)을 찍거나 바꿈. 인자가 없으면 지금 값만 찍고, 설정 파일이 없거나 깨졌으면 ask
 *   node scripts/subagent-retro.js --claude-md-done                   CLAUDE.md 정리 제안을 묻고 마친 뒤 돌림. 전체 줄 수가 200줄을 넘으면 config.json의 claudeMdKeptLines에 그 줄 수를 적고, 이하이거나 CLAUDE.md가 없으면 그 키를 지움(다른 키는 그대로). 설정 파일이 없거나 깨졌으면 만들지 않고 종료 코드 1
 *   node scripts/subagent-retro.js --claim                            자동 회고를 시작해도 되는지 잠금으로 가림. 잡으면 ok, 다른 회고가 진행 중이면 busy(3시간 넘은 잠금은 버려진 것으로 보고 다시 잡음)
 *   node scripts/subagent-retro.js --release [--failed]               잠금만 풂. --failed를 붙이면 자동 회고가 실패한 것으로 세어 config.json의 retroFailures를 1 올리고, 이어 두 번 실패하면 회고 방식을 ask로 돌림. --mark도 회고 표시를 남기면 잠금을 풀고 횟수를 0으로 돌림
 *   node scripts/subagent-retro.js --status                           회고 방식, 회고 시점, 잠금, 물을 것 개수, 표의 시험 표시마다 대기(마지막 회고 뒤 그 정의와 일 종류 기록 없음)와 보냄, 최저선 아래로 보낸 다시 시험이 있으면 그 상태, 0이 아니면 자동 회고 연속 실패 횟수를 읽기만 하고 찍음
 *   node scripts/subagent-retro.js --slash "<인자>"                   슬래시 커맨드 인자(상태 보기, auto, ask, now, 그 밖은 사용법)와 같은 동작. 스킬은 인자가 auto, ask, now 중 하나와 정확히 같을 때만 부름. 항상 종료 코드 0
 *   node scripts/subagent-retro.js --kinds                            기록 전체에서 표에 없는 일 이름, 건수, 마지막 날짜만 찍음(새 일 이름을 짓기 전에 봄). config.json의 removedKinds에 든 이름에는 (사용자가 뺐거나 회고가 쪼갠 옛 이름)을, 표에 <이름>[기준] 꼴 칸이 있으면 (회고가 쪼갠 옛 이름)을 붙임
 *   node scripts/subagent-retro.js --remove-kind "<일 이름>"           사용자가 표에서 뺀 일 이름을 config.json의 removedKinds(배열)에 더함. 회고가 그 이름을 표에 다시 넣지 않고 묻게 함. 다른 키는 그대로, 설정 파일이 깨졌거나 체계가 쓰는 여섯 가지 일(회고 정정 분류, 자동 회고, 무조건 Opus 영역 판단, 계획이 정한 무조건 Opus 영역 단계 구현, 무조건 Opus 영역 구현, high로도 안 풀려 다시 보내는 일)이면 쓰지 않고 종료 코드 1
 *   node scripts/subagent-retro.js --restore-kind "<일 이름>"          사용자가 다시 넣으라고 한 일 이름을 removedKinds에서 뺌(비면 키를 지움). 다른 키는 그대로
 *   node scripts/subagent-retro.js --record-kit-hashes                키트가 통째로 바꾸는 설치본 파일(스크립트 폴더 전체, RETRO.md, GUIDE의 사용자 구역 밖, 정의의 description과 글쓰기 줄 밖, /retro 스킬)의 sha256을 config.json의 kitFileHashes에 적음(전체를 새로 씀). 설정 파일이 없거나 깨졌으면 쓰지 않고 종료 코드 1
 *   node scripts/subagent-retro.js --check-kit-hashes [--kit <키트 폴더>]  설치본 파일을 kitFileHashes와 견줘 기록과 다른 파일(손으로 고쳤을 수 있음)과 없어진 파일을 찍음. removedDefs에 든 정의가 없는 것은 회고가 지운 것이라 따로 찍음. --kit을 주면 다른 파일 가운데 그 키트 폴더(subagent-system이 든 폴더)의 새 키트와 같은 파일에 표시를 붙임(업데이트가 이미 놓은 파일. 스킬은 $HOME/.claude를 절대 경로로 풀어 쓴 꼴도 같게 봄). 기록이 없으면 그렇다고 찍음. 아무것도 쓰지 않고 항상 종료 코드 0
 *   node scripts/subagent-retro.js --check                           표와 실제 배정이 어긋난 곳을 찍음(다른 정의로 보낸 기록, 정의 description과 표 칸의 차이, 정의 파일 없는 칸, removedDefs에 든 정의인데 표 칸에 일이 있는 칸). 문제가 있으면 종료 코드 1
 *   node scripts/subagent-retro.js --repeats [--since YYYY-MM-DD]    지난 회고 추출 시각 뒤(--since면 그 날 0시 뒤)의 대화에서 같은 꼴로 되풀이된 사용자 지시, Bash 명령, Agent 지시문을 종류별 상위 20개 찍음(아무것도 쓰지 않음. 후보는 같은 꼴 3번 이상, 세션 2개 이상. 기록이 없어도 종료 코드 0이고 --since 형식이 틀릴 때만 1)
 *   node scripts/subagent-retro.js --extract <파일>                   위에 더해 사용자 메시지를 <파일>에 씀
 *   node scripts/subagent-retro.js --messages <파일> --labels <파일>   정정을 반영해 다시 찍고 정정 기록에 덧붙임
 *   node scripts/subagent-retro.js --mark "<메모>" --messages <파일> --changed <N>   회고 경계 줄을 사용 기록에 덧붙임(N은 회고에서 실제로 바꾼 칸 수. 거절한 후보는 세지 않음). 그때의 표 모양(칸, 시험 표시, 최저선)도 같은 줄에 남겨 다음 회고들이 내림 실패를 셈
 *   node scripts/subagent-retro.js --log --project "<세션을 시작한 폴더의 절대 경로>" --def <정의> --kind "<일 종류>" --result ok|재지시|올림 --memo "<메모>"
 *                                     [--tokens N] [--tools N] [--secs N] [--date YYYY-MM-DD]   사용 기록 한 줄(9열)을 덧붙임
 *
 * 기록은 프로젝트와 상관없이 records/ 한 곳에 모이고 줄마다 프로젝트 열이 있다.
 * 여러 세션이 같은 기록 파일에 쓰므로 모든 쓰기는 한 줄씩 덧붙이기만 한다.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { locateTranscript } from './subagent-usage.js';
import { CLAUDE_DIR, RECORDS_DIR, GUIDE_FILE, AGENTS_DIR, CONFIG_FILE, PROJECTS_ROOT, listSessions, readJsonl, sessionCwd, projectRoot, localDate, retentionDays, printTable, appendWithHeader, splitLines } from './claudeProjectPaths.js';
import { parseUsage, parseCost, parseCorrections, summarize, downCandidates, upCandidates, resendsOf, lastLineByAgent, extractMessages, extractSince, parseLabels, agentsFromCell, repeatedLabels, findLaterBoundary, parseRoutingTable, tableKindSet, pinnedCellSet, unknownKindGroups, unknownKindNames, unknownModelSummary, checkRouting, descriptionOf, usageLineFromArgs, retroDue, periodSnoozeLossDate, retentionLossDate, retroLine, retroStage, floorMap, tableTrials, tableSnapshot, trialVerdict, downFailHistory, floorProposals, DOWN_FAIL_LIMIT, isRetrial, mixedCells, retrialHistory, retrialPlan, undecidedRuns, undecidedKey, MIXED_MIN_FAILS, MIXED_MIN_OKS, RETRIAL_START, COST_SIMILAR_RATIO, UNDECIDED_LIMIT, snoozeLine, unloggedCostSince, upPiles, parseConfig, claudeMdSummary, CLAUDE_MD_LIMIT_LINES, configTextWithMode, configTextWithFailures, configTextWithoutKeptLines, configTextWithKeptLines, configTextWithRemovedKinds, configTextWithKitHashes, kitFileHashesOf, diffKitHashes, guideTextOutsideZones, definitionTextForHash, sha256, KIT_DEF_NAMES, kindNameOf, RETRO_FAIL_LIMIT, RETRO_MODES, lockState, countPending, dueHead, LOCK_STALE_MS, STABLE_RETROS, UP_MIN_COUNT, UP_MIN_RATIO, extractRepeatItems, rankRepeats, REPEAT_KINDS, REPEAT_MIN_COUNT, REPEAT_MIN_SESSIONS, REPEAT_TOP } from './subagentRetroHelpers.js';

const USAGE_FILE = path.join(RECORDS_DIR, 'subagent-usage.tsv');
const COST_FILE = path.join(RECORDS_DIR, 'subagent-cost.tsv');
const CORRECTIONS_FILE = path.join(RECORDS_DIR, 'subagent-corrections.tsv');
const LOCK_FILE = path.join(RECORDS_DIR, 'retro.lock');
const PENDING_FILE = path.join(RECORDS_DIR, 'retro-pending.md');
const CORRECTIONS_HEADER = ['날짜', '프로젝트', '세션', '시각', '대상', 'agentId', '정의', '일 종류', '이름표', '메시지'].join('\t');
const MESSAGES_HEADER = ['번호', '세션', '프로젝트', '시각', '끝난 에이전트', '앞 응답', '메시지'].join('\t');
const MAX_SKIPPED_RATIO = 0.2;

function parseArgs(argv) {
  const opts = { extract: null, messages: null, labels: null, mark: null, changed: null, since: null, count: false, where: false, kinds: false, check: false, repeats: false };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (key === 'count') opts.count = true;
    else if (key === 'where') opts.where = true;
    else if (key === 'kinds') opts.kinds = true;
    else if (key === 'check') opts.check = true;
    else if (key === 'repeats') opts.repeats = true;
    else if (key in opts) opts[key] = argv[++i] ?? '';
  }
  return opts;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const flat = (s) => String(s).replace(/[\t\r\n]/g, ' ');
const readIfExists = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');

function readUsage() {
  if (!fs.existsSync(USAGE_FILE)) fail(`사용 기록이 없습니다: ${USAGE_FILE}`);
  return parseUsage(fs.readFileSync(USAGE_FILE, 'utf8'));
}

function readCost() {
  return parseCost([readIfExists(COST_FILE)]);
}

// 표를 못 읽으면 빈 표로 비교해 모든 일 종류가 표 밖으로 잡히는 일이 없게 known을 null로 두고 까닭을 돌려준다.
function readTable() {
  if (!fs.existsSync(GUIDE_FILE)) return { known: null, pinned: new Set(), floors: new Map(), trials: [], cells: null, problems: [`GUIDE 파일이 없습니다: ${GUIDE_FILE}`] };
  const { cells, problems } = parseRoutingTable(fs.readFileSync(GUIDE_FILE, 'utf8'));
  if (problems.length) return { known: null, pinned: new Set(), floors: new Map(), trials: [], cells: null, problems };
  return { known: tableKindSet(cells), pinned: pinnedCellSet(cells), floors: floorMap(cells), trials: tableTrials(cells), cells, problems };
}

const money = (v) => (v === null || v === undefined ? '모름' : `$${v.toFixed(3)}`);

// 판정 한 줄. 대기는 아직 보내지 않은 것이라 판정이 없다.
function trialText(v) {
  const head = `${v.cellDef ?? '?'} / ${kindLabel(v.kind)} → ${v.def}  ${v.state}${v.agentId ? `(${v.agentId})` : ''}`;
  const twice = v.sentAgents > 1 ? `, 같은 시험을 ${v.sentAgents}건 보냄(첫 건으로 판정)` : '';
  if (v.state === '대기') return `${head}  판정: 아직 보내지 않음`;
  const cost = v.cost !== undefined ? `, 시험 ${money(v.cost)}, 원래 칸 평균 ${money(v.baseline)}` : '';
  const secs = v.seconds !== undefined ? `, 시험 ${v.seconds ?? '모름'}초, 원래 칸 평균 ${v.baselineSeconds === null ? '모름' : `${Math.round(v.baselineSeconds)}초`}` : '';
  return `${head}  판정: ${v.verdict}${v.reason ? `(${v.reason})` : ''}${cost}${secs}${twice}`;
}

const trialName = (v) => `${v.cellDef ?? '?'} / ${kindLabel(v.kind)} → ${v.def}`;
const retroCountOf = (parsed) => (parsed.retros ?? []).length;

// 대화 기록을 찾으려면 비용 기록의 세션 열이 있어야 한다. 사용 기록에만 있는 에이전트는 위치를 모른다.
function transcriptOf(costMap, agentId) {
  if (!agentId) return 'agentId 없음';
  const session = costMap.get(agentId)?.session;
  if (!session) return '비용 기록에 세션이 없어 대화 기록 위치 모름';
  return locateTranscript(session, agentId) ?? `대화 기록을 찾지 못함(세션 ${session})`;
}

const kindLabel = (k) => k || '(빈 일 종류)';
// config.json의 removedKinds에 든 이름에 붙이는 표시다. 회고도 --kinds도 같은 말로 알린다.
const REMOVED_MARK = '(사용자가 뺐거나 회고가 쪼갠 옛 이름)';
const SPLIT_MARK = '(회고가 쪼갠 옛 이름)';
// 섞인 칸 쪼개기는 옛 이름을 removedKinds에 남기고 `<옛 이름>[<기준>]` 꼴의 새 칸 둘을 넣는다. 사용자가 뺀 이름과 같은 배열에 남아 구별되지 않으므로 표에 그 꼴 칸이 있는지로 가린다.
const isSplitOld = (name, known) => Boolean(known) && [...known].some((k) => k.startsWith(`${name}[`));
const removedMark = (name, known) => (isSplitOld(name, known) ? SPLIT_MARK : REMOVED_MARK);
// 체계가 표에서 이 일이 든 칸의 정의를 찾아 서브에이전트를 보내므로(회고, 자동 회고, 무조건 Opus 영역의 판단과 구현, 올리기), 표에서 빠지면 보낼 정의를 못 찾는다.
const RETRO_OWN_KINDS = ['회고 정정 분류', '자동 회고', '무조건 Opus 영역 판단', '계획이 정한 무조건 Opus 영역 단계 구현', '무조건 Opus 영역 구현', 'high로도 안 풀려 다시 보내는 일'];

// removedKinds에 든 이름의 표시를 풀어 쓴다. 표시마다 한 번만 찍는다.
function printRemovedNotes(kinds, known, indent, forKinds = false) {
  const split = kinds.filter((k) => isSplitOld(k, known));
  if (kinds.length > split.length) {
    const rule = forKinds ? '그 일을 맡겼으면 새 이름을 짓지 않고 이 이름을 그대로 적습니다. 회고가 이 이름을 표에 넣지 않고 사용자에게 묻습니다.' : '표에 넣지 않고 사용자에게 묻습니다(RETRO.md 4번).';
    console.log(`${indent}${REMOVED_MARK}: 사용자가 표에서 뺀 일이거나 회고가 쪼갠 옛 이름입니다. ${rule}`);
  }
  if (split.length) console.log(`${indent}${SPLIT_MARK}: 표에 \`<이름>[기준]\` 꼴 칸이 있어 회고가 쪼갠 이름입니다. 새 기록은 표에 있는 새 이름으로 적고, 회고는 이 이름을 표에 넣지도 사용자에게 묻지도 않습니다(RETRO.md 4번).`);
}

function printUnknownGroups(summaryRows, table, showCorrections) {
  console.log('\n표에 없는 일 종류(이번 대상 기록 중 일 종류가 표의 어떤 이름과도 다른 것)');
  if (!table.known) {
    console.log(`  표를 읽지 못해 가려내지 못했습니다: ${table.problems.join('; ')}`);
    return;
  }
  const groups = unknownKindGroups(summaryRows, table.known);
  const removed = new Set(readConfig().removedKinds);
  for (const g of groups) {
    const defs = [...g.defs].map(([d, n]) => `${d} ${n}건`).join(', ');
    const cost = g.costKnown ? `$${g.costSum.toFixed(3)}(짝지은 ${g.costKnown})` : '-';
    const unknown = g.costUnknown ? `, 비용 모름 ${g.costUnknown}건` : '';
    console.log(`  ${kindLabel(g.kind)}${removed.has(g.kind) ? `  ${removedMark(g.kind, table.known)}` : ''}  ${g.count}건  정의: ${defs}  ok ${g.ok}, 재지시 ${g.redo}, 올림 ${g.up}${showCorrections ? `, 정정 ${g.corrections}` : ''}  어림 비용 ${cost}${unknown}`);
  }
  if (!groups.length) console.log('  없음');
  printRemovedNotes(groups.filter((g) => removed.has(g.kind)).map((g) => g.kind), table.known, '  ');
}

// 비용 기록 전체가 대상이다. 요율표에 넣은 뒤 subagent-usage.js --recost로 채울 에이전트가 몇 건인지 알려 준다.
function printUnknownModels(costMap) {
  const { models, unnamed } = unknownModelSummary(costMap);
  console.log('\n요율표에 없는 모델(비용 기록 전체, 에이전트 수. 비용을 모르는 건은 위 합계와 평균에서 뺐습니다)');
  for (const m of models) console.log(`  ${m.model}  ${m.count}건`);
  if (!models.length) console.log('  없음');
  else console.log('  rates.json에 이 모델의 요율을 찍힌 이름 그대로 키로 넣어야 비용이 계산됩니다(RETRO.md 6단계).');
  if (unnamed) console.log(`  모델 이름 없이 비용을 모르는 건 ${unnamed}건(옛 기록이거나 rates.json을 못 읽은 때). subagent-usage.js --recost로 다시 계산해 봅니다.`);
}

function printKinds(parsed, table) {
  if (!table.known) {
    console.log(`표를 읽지 못했습니다: ${table.problems.join('; ')}`);
    process.exitCode = 1;
    return;
  }
  const names = unknownKindNames(parsed.all, table.known);
  const removed = new Set(readConfig().removedKinds);
  console.log('기록 전체에서 표에 없는 일 이름(건수 많은 순)');
  for (const n of names) console.log(`  ${kindLabel(n.kind)}${removed.has(n.kind) ? `  ${removedMark(n.kind, table.known)}` : ''}\t${n.count}건\t마지막 ${n.last}`);
  if (!names.length) console.log('  없음');
  printRemovedNotes(names.filter((n) => removed.has(n.kind)).map((n) => n.kind), table.known, '', true);
}

// 표 칸의 정의 파일을 읽는다. 파일이 없으면 null, 있는데 description이 없으면 빈 문자열이다.
function readDescriptions(cells) {
  const map = new Map();
  for (const c of cells) {
    const def = `${c.model}-${c.effort}`;
    if (!c.kinds.length || map.has(def)) continue;
    const file = path.join(AGENTS_DIR, `${def}.md`);
    map.set(def, fs.existsSync(file) ? descriptionOf(fs.readFileSync(file, 'utf8')) : null);
  }
  return map;
}

// 종료 코드는 1(문제 있음)과 0(문제 없음)만 쓴다. 표를 못 읽은 것도 문제다.
function printCheck() {
  if (!fs.existsSync(GUIDE_FILE)) return fail(`GUIDE 파일이 없습니다: ${GUIDE_FILE}`);
  const { cells, problems } = parseRoutingTable(fs.readFileSync(GUIDE_FILE, 'utf8'));
  if (problems.length) return fail(`표를 읽지 못했습니다: ${problems.join('; ')}`);
  const hasUsage = fs.existsSync(USAGE_FILE);
  const r = checkRouting({ cells, usage: hasUsage ? parseUsage(fs.readFileSync(USAGE_FILE, 'utf8')).all : null, descriptions: readDescriptions(cells), removedDefs: readConfig().removedDefs });

  console.log('표 칸과 다른 정의로 보낸 기록(전체 기록. 올림, 칸의 시험 표시가 가리키는 정의, opus-xhigh와 fable-high는 뺌. 표가 바뀌기 전 기록일 수 있어 마지막 날짜를 봄)');
  if (!hasUsage) console.log(`  사용 기록이 없어 건너뜁니다: ${USAGE_FILE}`);
  for (const g of r.mismatched) console.log(`  ${kindLabel(g.kind)}  ${g.def} ${g.count}건  표의 칸 ${g.expected.join(', ')}  마지막 ${g.last}`);
  if (hasUsage && !r.mismatched.length) console.log('  없음');

  console.log(`\n정의 description과 표 칸이 다른 곳(${AGENTS_DIR})`);
  for (const d of r.descriptionDiffs) {
    const parts = [];
    if (d.missing.length) parts.push(`description에 없는 칸 이름: ${d.missing.join(', ')}`);
    if (d.extra.length) parts.push(`칸에 없는 description 이름: ${d.extra.join(', ')}`);
    console.log(`  ${d.def}  ${parts.join(' / ')}`);
  }
  if (!r.descriptionDiffs.length) console.log('  없음');
  if (r.loose.length) console.log(`  (description에서 일 이름 나열을 나누지 못해 칸 이름이 문자열로 들어 있는지만 본 정의: ${r.loose.join(', ')})`);

  console.log('\n표에 칸이 있는데 정의 파일이 없는 칸');
  for (const m of r.missingDefs) console.log(`  ${m.def}  ${path.join(AGENTS_DIR, `${m.def}.md`)}  칸의 일: ${m.kinds.join(', ')}`);
  if (!r.missingDefs.length) console.log('  없음');

  console.log('\nremovedDefs에 든 정의인데 표의 칸에 일이 있는 칸');
  for (const m of r.removedConflicts) console.log(`  ${m.def}: removedDefs에 있는데 표의 그 칸에 일이 있습니다. 정의를 다시 만들고 removedDefs에서 빼거나 칸의 일을 옮기세요  칸의 일: ${m.kinds.join(', ')}`);
  if (!r.removedConflicts.length) console.log('  없음');

  const count = r.mismatched.length + r.descriptionDiffs.length + r.missingDefs.length + r.removedConflicts.length;
  console.log(count ? `\n문제 ${count}건` : '\n문제 없음');
  if (count) process.exitCode = 1;
}

function countByAgent(rows) {
  const map = new Map();
  for (const r of rows) if (r.agentId && r.agentId !== '-') map.set(r.agentId, (map.get(r.agentId) ?? 0) + 1);
  return map;
}

// 회고가 CLAUDE.md를 읽을지 정하는 줄이다. 대상이 아니면 CLAUDE.md는 읽지 않는다.
function printClaudeMd() {
  const file = path.join(CLAUDE_DIR, 'CLAUDE.md');
  const sum = claudeMdSummary(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null, readConfig().claudeMdKeptLines);
  if (!sum.exists) return console.log(`\nCLAUDE.md 정리: CLAUDE.md 없음(${file})`);
  const counts = `전체 ${sum.total}줄, 키트 구역 ${sum.kit}줄`;
  // 사용자가 회고 밖에서 줄여도 옛 값이 남아 다시 늘 때 200줄이 아니라 옛 값 + 20줄부터 제안되므로, 200줄 이하가 되면 여기서 지운다.
  let cleared = '';
  if (sum.total <= CLAUDE_MD_LIMIT_LINES && sum.keptLines !== null) {
    try {
      const next = configTextWithoutKeptLines(readIfExists(CONFIG_FILE));
      if (next === null) throw new Error('설정 파일을 읽지 못했습니다');
      fs.writeFileSync(CONFIG_FILE, next);
      cleared = `  (남겨 둔 ${sum.keptLines}줄 기록을 지웠습니다)`;
    } catch (e) {
      cleared = `  (남겨 둔 ${sum.keptLines}줄 기록을 지우지 못했습니다: ${e.message})`;
    }
  }
  console.log(`\nCLAUDE.md 정리: ${sum.target ? '정리 제안 대상' : `정리 제안 대상 아님(${sum.reason})`}  ${counts}  ${file}${cleared}`);
}

function printReport(parsed, costMap, correctionMap, showCorrections, table) {
  const { boundary } = parsed;
  console.log(boundary ? `회고 경계: ${boundary.at ? boundary.at.toISOString() : '시각 없음'} 뒤 ${parsed.target.length}줄` : `회고 경계 없음: 전체 ${parsed.target.length}줄`);
  const s = summarize(parsed.target, costMap, correctionMap, { all: parsed.all, since: boundary?.date ?? null });
  const cell = (c) => [
    c.def, c.kind, c.count, c.ok, c.redo, c.up, showCorrections ? c.corrections : '-',
    c.costKnown ? c.costSum.toFixed(3) : '-', c.costAvg === null ? '-' : c.costAvg.toFixed(3), c.paired, c.costUnknown, c.avgSeconds ?? '-',
  ];
  printTable([['정의', '일 종류', '건수', 'ok', '재지시', '올림', '정정', '비용 합계($)', '건당 평균($)', '짝지은 에이전트 수', '비용 모름(건)', '평균 초'], ...s.rows.map(cell), cell(s.total)], 2);
  const stage = retroStage(parsed.retroChanged, { trialsPending: table.trials.length > 0 });
  console.log(`회고 기준: ${stage.threshold}건 (${stage.phase}${stage.stable ? ': 바꾼 칸이 0인 회고가 ' + STABLE_RETROS + '번 이어짐' : ''}${stage.held ? ': 판정 전 시험 표시가 있어 표 안정으로 보지 않음' : ''})`);
  const piles = upPiles(parsed.target, correctionMap);
  if (piles.length) console.log(`올림이 쌓인 칸(올리기 후보와 같은 조건이라 기록 건수와 상관없이 회고를 묻는 기준. 에이전트 수로 셈): ${piles.map((p) => `${p.def} / ${kindLabel(p.kind)} ${p.count}/${p.total}명`).join(', ')}`);
  console.log(`\n비용 없음: ${s.noCost}줄`);
  console.log(`비용만 있는 줄: ${s.costOnly.length}줄`);
  for (const c of s.costOnly) console.log(`  ${c.agentId}  ${c.def}  ${c.description}  $${c.cost === null ? '?' : c.cost.toFixed(3)}`);

  const history = downFailHistory(parsed, costMap, correctionMap);
  const failNote = (kind) => (history.get(kind)?.count ? `  (내림 실패 ${history.get(kind).count}번)` : '');
  const down = downCandidates(parsed.all, correctionMap, table.pinned, table.floors);
  console.log('\n내려 보기 후보(파일 전체 마지막 5건이 모두 ok, 정정 없음. 표의 「(고정)」 칸, 바로 아래 칸이 최저선보다 아래인 칸, 「무조건 Opus」 영역, 사다리 밖 정의, opus-xhigh, fable-high, haiku-low는 뺌)');
  if (!table.known) console.log(`  표를 읽지 못해 「(고정)」 칸과 최저선을 빼지 못했습니다. 아래 후보에 그런 칸이 섞여 있을 수 있습니다: ${table.problems.join('; ')}`);
  for (const c of down) console.log(`  ${c.def} / ${c.kind}${failNote(c.kind)}`);
  if (!down.length) console.log('  없음');

  const verdicts = table.trials.map((t) => trialVerdict(t, parsed.target, costMap, correctionMap));
  const runs = undecidedRuns(parsed, costMap, correctionMap);
  console.log(`\n시험 표시(대기는 마지막 회고 뒤 그 정의와 일 종류 기록이 없음, 보냄은 있음. 시험한 1건이 ok이고 정정이 없을 때 어림 비용이 원래 칸의 회고 구간 평균보다 ${COST_SIMILAR_RATIO * 100}% 넘게 낮으면 통과, 평균의 ±${COST_SIMILAR_RATIO * 100}% 안이면 걸린 시간이 평균보다 짧을 때 통과)`);
  for (const v of verdicts) console.log(`  ${trialText(v)}${isRetrial(v.kind, v.def, table.floors) ? '  (최저선 다시 시험)' : ''}`);
  if (!table.known) console.log(`  표를 읽지 못해 시험 표시를 보지 못했습니다: ${table.problems.join('; ')}`);
  else if (!verdicts.length) console.log('  없음');
  for (const v of verdicts) {
    if (v.verdict === '판정 불가' && (runs.get(undecidedKey(v)) ?? 0) + 1 >= UNDECIDED_LIMIT) console.log(`판정 불가 ${UNDECIDED_LIMIT}번이라 시험 표시를 지움: ${trialName(v)}`);
  }

  console.log(`\n내림 실패(회고 표시에 남은 표 모양으로 셈. 시험 실패와, 내린 칸을 다시 올린 것. 최저선 아래로 보낸 다시 시험은 세지 않음. 최저선이 바뀌면 0부터 다시 셈)`);
  const fails = [...history.values()].filter((h) => h.count || h.lowered).sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
  for (const h of fails) console.log(`  ${kindLabel(h.kind)}  ${h.count}번${h.failedDefs.length ? `(실패한 정의 ${h.failedDefs.join(', ')})` : ''}${h.lowered ? ', 지금 내린 칸' : ''}`);
  if (!fails.length) console.log('  없음');

  const { up, watch } = upCandidates(s.rows);
  const cellOf = new Map((table.cells ?? []).flatMap((c) => c.kinds.map((k) => [k, `${c.model}-${c.effort}`])));
  const mixed = mixedCells(parsed.target, correctionMap, cellOf);
  const mixedKinds = new Set(mixed.map((m) => m.kind));
  console.log(`\n섞인 칸(회고 구간에서 한 일 종류의 실패(올림, 정정) ${MIXED_MIN_FAILS}건 이상이면서 성공(모든 줄 ok, 정정 없음) ${MIXED_MIN_OKS}건 이상. 두 묶음의 지시문을 읽고 맡기기 전에 볼 수 있는 기준으로 쪼갤지 봄. 지시문은 대화 기록 파일의 첫 사용자 메시지)`);
  for (const m of mixed) {
    console.log(`  ${m.cellDef ?? '?'} / ${kindLabel(m.kind)}  실패 ${m.fails.length}건, 성공 ${m.oks.length}건`);
    for (const a of m.fails) console.log(`    실패 ${a.agentId ?? '-'}(${a.def})  ${transcriptOf(costMap, a.agentId)}`);
    for (const a of m.oks) console.log(`    성공 ${a.agentId ?? '-'}(${a.def})  ${transcriptOf(costMap, a.agentId)}`);
  }
  if (!mixed.length) console.log('  없음');

  const { proposals, aboveFloor, raise } = floorProposals({ history, trialVerdicts: verdicts, upCands: up, floors: table.floors, cellOf, all: parsed.all, target: parsed.target });
  const why = (p) => `(앞서 ${p.before}번${p.why.length ? `, 이번 ${p.why.join(', ')}` : ''})`;
  const splitFirst = (kind) => (mixedKinds.has(kind) ? '  섞인 칸이라 먼저 쪼개기를 보고, 공통점을 못 찾으면 이 제안' : '');
  console.log(`최저선 제안(최저선이 없는 칸에서 이번 회고를 넣어 내림 실패가 ${DOWN_FAIL_LIMIT}번 이상. 실패한 정의 가운데 가장 높은 것의 바로 위 칸)`);
  for (const p of proposals) console.log(`  ${p.cellDef ?? '?'} / ${kindLabel(p.kind)}  내림 실패 ${p.count}번${why(p)}  최저선을 ${p.floor} 정의로 두자고 제안${splitFirst(p.kind)}`);
  if (!proposals.length) console.log('  없음');
  for (const p of aboveFloor) console.log(`최저선 위에서 내림 실패 ${p.count}번: ${p.cellDef ?? '?'} / ${kindLabel(p.kind)} (최저선 ${p.current}) ${why(p)}`);
  console.log(`최저선 올리기 후보(이번 회고에 새 실패가 있고, 최저선 위에서 내림 실패 ${DOWN_FAIL_LIMIT}번 이상이면서 최저선을 단 뒤 그 일 기록의 ${UP_MIN_RATIO * 100}% 이상. 먼저 쪼개기를 보고 공통점을 못 찾았을 때만 올림)`);
  for (const p of raise) console.log(`  ${p.cellDef ?? '?'} / ${kindLabel(p.kind)}  ${p.count}/${p.total}건 (${(p.ratio * 100).toFixed(0)}%)  최저선을 ${p.current}에서 ${p.floor} 정의로 올리자고 제안${splitFirst(p.kind)}`);
  if (!raise.length) console.log('  없음');

  const plan = retrialPlan({ states: retrialHistory(parsed, costMap, correctionMap), retroCount: retroCountOf(parsed), floors: table.floors, cellOf, pinned: table.pinned, verdicts, all: parsed.all, costMap, correctionsByAgent: correctionMap });
  const reason = (w) => (w.modelChange ? `모델이 바뀜(${w.modelChange.from} → ${w.modelChange.to})` : `최저선을 단 뒤나 마지막 다시 시험 뒤 회고 ${w.interval}번`);
  console.log(`최저선 다시 시험(최저선을 단 뒤 회고 ${RETRIAL_START}번이 지나면 바로 아래 정의로 1건. 실패하면 간격을 두 배로, 통과하면 처음으로. 최저선 아래 정의의 모델이 바뀌면 간격과 상관없이. 회고 한 번에 한 칸)`);
  if (plan.proposal) {
    const p = plan.proposal;
    console.log(`  제안: ${p.cellDef ?? '?'} / ${kindLabel(p.kind)}  최저선 ${p.floor} 아래 ${p.def} 정의로 1건 다시 시험(표에 「(시험: 다음 1건 \`${p.def}\`)」)  까닭: ${reason(p)}`);
  } else console.log('  제안: 없음');
  for (const p of plan.deferred) console.log(`  다음 회고로 미룸: ${p.cellDef ?? '?'} / ${kindLabel(p.kind)}  까닭: ${reason(p)}`);
  for (const w of plan.waits) {
    const last = w.last ? `, 마지막 다시 시험 ${w.last.date} ${w.last.verdict}` : '';
    const state = !w.def ? '더 내릴 정의 없음' : w.pending && w.last?.date !== '이번 회고' ? `다시 시험 ${w.pending.state}` : `다음 다시 시험까지 회고 ${w.remaining}번`;
    console.log(`  ${w.cellDef ?? '?'} / ${kindLabel(w.kind)}  최저선 ${w.floor}  ${state}(간격 ${w.interval}번${last})`);
  }
  console.log('최저선 내리기 제안(최저선 다시 시험 통과)');
  for (const l of plan.lowerFloor) console.log(`  ${l.cellDef ?? '?'} / ${kindLabel(l.kind)}  ${l.to} 다시 시험 통과(${l.agentId ?? '-'})  최저선을 ${l.floor}에서 ${l.to} 정의로 한 칸 내리자고 제안, 간격은 ${RETRIAL_START}번으로`);
  if (!plan.lowerFloor.length) console.log('  없음');
  const pctOf = (c) => `${c.count}/${c.total}명 (${(c.ratio * 100).toFixed(0)}%)`;
  console.log(`올리기 후보(이번 대상에서 올림이나 정정이 붙은 에이전트가 ${UP_MIN_COUNT}명 이상이면서 그 칸 에이전트의 ${UP_MIN_RATIO * 100}% 이상. 같은 에이전트의 올림 줄과 정정은 1명으로 셈. 사다리 밖 정의와 올릴 칸이 없는 opus-xhigh, fable-high는 뺌. 다시 보낸 기록은 올림 뒤 같은 일 종류의 더 높은 정의 ok 줄을 순서로 짝지은 어림값이라 다른 일이 섞일 수 있음)`);
  const resentText = (c) => {
    const sent = resendsOf(parsed.target, parsed.all, c.def, c.kind, correctionMap);
    return sent.length ? `다시 보낸 기록 ${sent.map((x) => `${x.def} ${x.count}건`).join(', ')}` : '다시 보낸 기록 없음';
  };
  for (const c of up) console.log(`  ${c.def} / ${c.kind}  ${pctOf(c)}  ${resentText(c)}`);
  if (!up.length) console.log('  없음');
  console.log(`지켜볼 칸(올림이나 정정이 붙은 에이전트가 ${UP_MIN_COUNT}명 이상이지만 ${UP_MIN_RATIO * 100}%가 안 됨. 아직 올리지 않음. 올릴 칸이 없는 정의는 뺌)`);
  for (const c of watch) console.log(`  ${c.def} / ${c.kind}  ${pctOf(c)}`);
  if (!watch.length) console.log('  없음');
  printUnknownGroups(s.rows, table, showCorrections);
  printUnknownModels(costMap);
  printClaudeMd();
  console.log(`지난 회고 메모: ${boundary ? boundary.memo : '없음'}`);
}

function extractToFile(file, parsed) {
  const { at: since, source } = extractSince(parsed);
  const sourceText = { boundary: '마지막 회고 표시', firstUsage: '사용 기록 첫 날짜 0시', none: '기록 없음, 전체' }[source];
  console.log(`\n추출 시작 시점: ${since ? since.toISOString() : '없음'} (${sourceText})`);
  if (!fs.existsSync(PROJECTS_ROOT)) console.log(`대화 기록 폴더가 없습니다: ${PROJECTS_ROOT}`);
  const sessions = listSessions()
    .filter((s) => since === null || s.mtime >= since.getTime())
    .sort((a, b) => a.mtime - b.mtime);

  const heads = [];
  const rows = [];
  let filtered = 0;
  let multi = 0;
  for (const s of sessions) {
    const r = extractMessages(readJsonl(s.file), since);
    if (r.total === 0) continue;
    const id8 = s.id.slice(0, 8);
    const project = projectRoot(sessionCwd(s.file) ?? path.basename(s.dir));
    heads.push(`# 세션\t${id8}\t${r.total}\t${project}`);
    filtered += r.filtered;
    for (const m of r.messages) {
      if (m.agents.length > 1) multi++;
      const agents = m.agents.map((a) => `${a.agentId}:${a.def}:${flat(a.description).replace(/\|/g, ' ').slice(0, 30)}`).join('|') || '-';
      rows.push([rows.length + 1, id8, project, m.time, agents, flat(m.prev), flat(m.text).slice(0, 400)].join('\t'));
    }
  }
  const out = [`# 사용 줄\t${parsed.lineCount}`, `# 추출 시각\t${new Date().toISOString()}`, ...heads, MESSAGES_HEADER, ...rows];
  fs.writeFileSync(file, out.join('\n') + '\n');
  console.log(`\n사용자 메시지 ${rows.length}개를 ${file}에 썼습니다. 미리 걸러진 것 ${filtered}개, 끝난 에이전트가 둘 이상인 메시지 ${multi}개.`);
}

const REPEAT_TITLES = { user: '사용자 지시', bash: 'Bash 명령', agent: 'Agent 지시문(첫 내용 줄)' };
const clip = (text, n = 120) => [...flat(text)].slice(0, n).join('');

// --since가 있으면 그 날 로컬 0시, 없으면 --extract와 같은 지난 회고 추출 시각이다. 범위를 못 정하면 at이 null이다.
function repeatsRange(opts) {
  if (opts.since !== null) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(opts.since);
    const at = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
    if (!at || at.getMonth() !== Number(m[2]) - 1) fail(`--since는 YYYY-MM-DD 형식의 날짜여야 합니다: ${opts.since}`);
    return { at, text: `--since ${opts.since} 0시` };
  }
  const { at, source } = extractSince(parseUsage(readIfExists(USAGE_FILE)));
  return { at, text: { boundary: '마지막 회고 표시', firstUsage: '사용 기록 첫 날짜 0시', none: '' }[source] };
}

// 파일은 쓰지 않고 찍기만 한다. 기록이 없는 컴퓨터에서도 실패하지 않아야 하므로 어느 경우든 종료 코드는 0이다.
function printRepeats(opts) {
  const { at: since, text: sinceText } = repeatsRange(opts);
  if (!since) return console.log(`사용 기록이 없어 범위를 정하지 못했습니다(${USAGE_FILE}). --since YYYY-MM-DD로 범위를 줄 수 있습니다.`);
  if (!fs.existsSync(PROJECTS_ROOT)) return console.log(`대화 기록 폴더가 없습니다: ${PROJECTS_ROOT}`);

  const sessions = listSessions().filter((s) => s.mtime >= since.getTime());
  const items = [];
  for (const s of sessions) {
    const found = extractRepeatItems(readJsonl(s.file), since);
    if (!found.length) continue;
    const project = projectRoot(sessionCwd(s.file) ?? path.basename(s.dir));
    for (const it of found) items.push({ ...it, session: s.id, project });
  }

  console.log('반복 찾기(어림 토큰은 같은 꼴이 든 메시지나 도구 입력과 결과의 글자 수 합을 3으로 나눈 어림값입니다)');
  console.log(`범위: ${since.toISOString()} 뒤 (${sinceText})`);
  const counted = (kind) => items.filter((i) => i.kind === kind).length;
  console.log(`셈: 대화 ${sessions.length}개, 사용자 메시지 ${counted('user')}개, Bash 명령 ${counted('bash')}개, Agent 지시문 ${counted('agent')}개`);
  console.log(`후보 기준: 같은 꼴 ${REPEAT_MIN_COUNT}번 이상이면서 세션 ${REPEAT_MIN_SESSIONS}개 이상. 키트 스크립트 호출, 짧은 확인 명령, 짧은 메시지와 승인은 세지 않았습니다.`);
  if (!sessions.length) return console.log('\n범위 안에 대화 기록이 없습니다.');

  const ranked = rankRepeats(items);
  for (const kind of REPEAT_KINDS) {
    console.log(`\n${REPEAT_TITLES[kind]} (상위 ${REPEAT_TOP}개)`);
    if (!ranked[kind].length) {
      console.log('  후보 없음');
      continue;
    }
    printTable([['횟수', '세션 수', '프로젝트 수', '어림 토큰', '꼴', '예시'], ...ranked[kind].map((r) => [r.count, r.sessions, r.projects, r.tokens, clip(r.shape), clip(r.example)])], 6);
  }
}

function printLabelNames(history) {
  const names = repeatedLabels(history, 1);
  console.log('\n지금까지의 이름표(많이 나온 순)');
  for (const r of names) console.log(`  ${r.label} (${r.count})`);
  if (!names.length) console.log('  없음');
}

function readMessagesFile(file) {
  if (!fs.existsSync(file)) fail(`메시지 파일이 없습니다: ${file}`);
  const head = { usageLines: null, extractedAt: null, sessions: new Map() };
  const messages = [];
  for (const raw of splitLines(fs.readFileSync(file, 'utf8'))) {
    const c = raw.split('\t');
    if (c[0] === '# 사용 줄') head.usageLines = Number(c[1]);
    else if (c[0] === '# 추출 시각') head.extractedAt = c[1];
    else if (c[0] === '# 세션') head.sessions.set(c[1], Number(c[2]));
    else if (/^\d+$/.test(c[0])) {
      messages.push({ n: Number(c[0]), session: c[1], project: c[2], time: c[3], agents: agentsFromCell(c[4]), prev: c[5], text: c.slice(6).join('\t') });
    }
  }
  return { head, messages };
}

function applyLabels(opts, parsed, costMap, table) {
  const { head, messages } = readMessagesFile(opts.messages);
  if (!fs.existsSync(opts.labels)) fail(`분류 파일이 없습니다: ${opts.labels}`);
  const { labels, skipped, unlabeled } = parseLabels(fs.readFileSync(opts.labels, 'utf8'), messages);
  if (skipped.length + unlabeled.length > messages.length * MAX_SKIPPED_RATIO) {
    for (const s of skipped) console.error(`건너뜀 ${s.n}번: ${s.reason}`);
    if (unlabeled.length) console.error(`분류 답이 없는 메시지: ${unlabeled.join(', ')}번`);
    fail(`건너뛴 줄과 분류 답이 없는 메시지가 합쳐 메시지 ${messages.length}개의 20%를 넘어 정정 기록에 쓰지 않고 멈춥니다(건너뜀 ${skipped.length}줄, 답 없음 ${unlabeled.length}개).`);
  }

  const history = parseCorrections(readIfExists(CORRECTIONS_FILE));
  const known = new Set(history.map((r) => `${r.session}\u0000${r.time}`));
  const lastUsage = lastLineByAgent(parsed.all);
  const byN = new Map(messages.map((m) => [m.n, m]));

  const fresh = [];
  for (const l of labels) {
    if (l.kind !== '정정') continue;
    const m = byN.get(l.n);
    if (known.has(`${m.session}\u0000${m.time}`)) continue;
    const main = l.target === '메인';
    const usage = main ? null : lastUsage.get(l.target);
    const def = main ? '-' : usage?.def ?? costMap.get(l.target)?.def ?? '-';
    fresh.push({ date: localDate(new Date(m.time)), project: m.project, session: m.session, time: m.time, target: main ? '메인' : '서브에이전트', agentId: main ? '-' : l.target, def, kind: usage?.kind ?? '-', label: l.label, message: flat(m.text).slice(0, 100) });
  }
  const everything = [...history, ...fresh];
  printReport(parsed, costMap, countByAgent(everything), true, table);

  console.log('\n정정률');
  const fixes = labels.filter((l) => l.kind === '정정');
  const turns = labels.filter((l) => l.kind === '방향 전환');
  const totalAll = [...head.sessions.values()].reduce((a, b) => a + b, 0);
  const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : '-');
  for (const [id, total] of head.sessions) {
    const inSession = (l) => byN.get(l.n).session === id;
    console.log(`  ${id}: 정정 ${fixes.filter(inSession).length}/${total} (${pct(fixes.filter(inSession).length, total)}), 방향 전환 ${turns.filter(inSession).length}`);
  }
  console.log(`  전체: 정정 ${fixes.length}/${totalAll} (${pct(fixes.length, totalAll)}), 방향 전환 ${turns.length}`);
  if (unlabeled.length) console.log(`  분류 답이 없는 메시지: ${unlabeled.map((m) => m.n).join(', ')}번`);
  if (skipped.length) console.log(`  건너뛴 줄: ${skipped.map((s) => `${s.n}번(${s.reason})`).join(', ')}`);

  console.log('\n반복 지적(같은 이름표 2건 이상, 규칙이 먹히지 않는 신호)');
  const repeated = repeatedLabels(everything);
  for (const r of repeated) console.log(`  ${r.label}  ${r.count}건  ${r.first} ~ ${r.last}\n    예: ${r.examples.join(' / ')}`);
  if (!repeated.length) console.log('  없음');

  if (fresh.length) appendWithHeader(CORRECTIONS_FILE, CORRECTIONS_HEADER, fresh.map((r) => [r.date, r.project, r.session, r.time, r.target, r.agentId, r.def, r.kind, r.label, r.message].join('\t')));
  console.log(`\n정정 기록에 ${fresh.length}줄을 덧붙였습니다.`);
}

function mark(opts) {
  if (!opts.messages) fail('--mark에는 --messages <파일>이 필요합니다.');
  if (!fs.existsSync(USAGE_FILE)) fail(`사용 기록이 없습니다: ${USAGE_FILE}`);
  const { head } = readMessagesFile(opts.messages);
  if (opts.changed !== null && !/^\d+$/.test(opts.changed)) fail(`--changed는 0 이상의 정수여야 합니다: ${opts.changed}`);
  if (!head.extractedAt || !Number.isInteger(head.usageLines)) fail('메시지 파일 머리에서 사용 줄 수와 추출 시각을 읽지 못했습니다.');
  const later = findLaterBoundary(fs.readFileSync(USAGE_FILE, 'utf8'), head.usageLines);
  if (later) fail(`다른 세션이 이미 회고했습니다(경계 줄 ${later.line}, ${later.memo.slice(0, 40)}). 이번 회고의 칸 수정이 겹치는지 확인하세요.`);
  const changed = opts.changed === null ? null : Number(opts.changed);
  const table = readTable();
  fs.appendFileSync(USAGE_FILE, retroLine(head.extractedAt, head.usageLines, changed, flat(opts.mark), table.cells ? tableSnapshot(table.cells) : '-') + '\n');
  console.log(`회고 경계 줄을 덧붙였습니다(줄 수 ${head.usageLines}, 추출 시각 ${head.extractedAt}, 바꾼 칸 ${changed ?? '모름'}).`);
  if (table.cells) console.log(`표 모양을 같은 줄에 남겼습니다(시험 표시 ${table.trials.length}개, 최저선 ${table.floors.size}개).`);
  else console.log(`표를 읽지 못해 표 모양을 남기지 못했습니다. 이 회고 앞뒤의 칸 이동은 내림 실패로 세지 않습니다: ${table.problems.join('; ')}`);
  if (releaseLock()) console.log('회고 잠금을 풀었습니다.');
  resetFailures();
  if (changed === null) console.log('--changed가 없어 바꾼 칸을 모르는 표시로 남았습니다. 표 안정 판정에서는 안정을 끊는 것으로 봅니다.');
}

// 메인이 셸과 상관없이 같은 결과로 사용 기록을 적게 하려고 만든 명령이다(PowerShell에는 printf가 없고 셸마다 따옴표와 인코딩 처리가 달라서 메인이 직접 치는 명령으로는 같은 줄을 보장하지 못한다).
// 머리줄이 없는 파일이라 새 파일도 줄만 덧붙이고, 파일을 다시 쓰지 않는다.
function logUsage(args) {
  const { line, error } = usageLineFromArgs(args);
  if (error) fail(`${error}\n사용법: node subagent-retro.js --log --project "<세션을 시작한 폴더의 절대 경로>" --def <정의> --kind "<일 종류>" --result ok|재지시|올림 --memo "<agentId 메모>" [--tokens N] [--tools N] [--secs N] [--date YYYY-MM-DD]`);
  fs.mkdirSync(RECORDS_DIR, { recursive: true });
  fs.appendFileSync(USAGE_FILE, line + '\n', 'utf8');
  console.log(`사용 기록에 한 줄 덧붙였습니다(${USAGE_FILE})\n${line}`);
}

const upLabel = (p) => `올림 에이전트 ${p.count}명: ${p.def} / ${kindLabel(p.kind)}`;

// 거절을 세션이 바뀌어도 이어 가려고 회고 표시 줄처럼 사용 기록에 남긴다. 기록이 없으면 미룰 대상도 없다.
// 올림이 쌓인 칸은 지금 올림 수를 줄에 남겨, 그 칸에 올림이 새로 생길 때까지 묻지 않게 한다.
// 올림이나 기간 기준만 걸려 거절한 것이면 건수 기준은 미루지 않은 것이라 그 사실을 줄에 남긴다.
// 기간 기준이 걸려 미룬 줄만 기간 셈을 옮기므로 그 사실(기간: true)도 줄에 남긴다.
// 비용 기록은 날짜만 있어 미룸 줄 앞뒤를 못 가리므로, 미룰 때 그날 비용 기록에만 있던 건수를 남겨 --due가 그 수를 뺀 늘어난 몫만 새 기록으로 세게 한다.
// 이미 미뤄 둔 건수 기준이 아직 안 찼으면(byCount가 false) 다시 미루지 않는다. 다시 미루면 건수 미룸 시작점이 뒤로 밀려 그 뒤 건수 기준이 차도 묻지 않고 건너뛴다.
function snooze() {
  if (!fs.existsSync(USAGE_FILE)) fail(`사용 기록이 없습니다: ${USAGE_FILE}`);
  const parsed = parseUsage(fs.readFileSync(USAGE_FILE, 'utf8'));
  // --due와 같은 보존 기간과 오늘로 판정해야 그때 물은 기준을 그대로 미룬다.
  const now = todayForDue();
  const d = retroDue(parsed, { costMap: readCost(), trialsPending: readTable().trials.length > 0, retentionDays: retentionDays(), now });
  const countSnoozed = d.byCount || (!d.piles.length && !d.byPeriod);
  const costOnly = unloggedCostSince(parsed.all, readCost(), localDate(now));
  const line = snoozeLine(now, { countSnoozed, periodSnoozed: d.byPeriod, ups: d.piles, costOnly });
  fs.appendFileSync(USAGE_FILE, line + '\n', 'utf8');
  const said = [];
  if (countSnoozed) said.push(`기록이 ${d.snoozeLines}줄 더 쌓일 때까지 --due는 wait입니다.`);
  if (d.byPeriod) said.push(`기간 기준은 오늘부터 ${d.periodLimit}일을 다시 셉니다. 경고: ${periodSnoozeLossDate(d, now)} 이전 대화의 정정은 다음 회고 전에 지워질 수 있습니다.`);
  if (d.piles.length) said.push(`올림이 쌓인 칸(${d.piles.map((p) => `${p.def} / ${kindLabel(p.kind)}`).join(', ')})은 그 칸에 올림이 붙은 에이전트가 1명 더 생겨 조건을 다시 채울 때까지 올림 기준으로 묻지 않습니다.`);
  console.log(`미룸 표시 줄을 덧붙였습니다. ${said.join(' ')}`);
}

const readConfig = () => parseConfig(readIfExists(CONFIG_FILE));

function lockMtime() {
  try {
    return fs.statSync(LOCK_FILE).mtimeMs;
  } catch {
    return null;
  }
}

// 회고가 끝나거나 실패했을 때 잠금만 푼다. 잠금이 있었는지를 돌려준다.
function releaseLock() {
  if (lockMtime() === null) return false;
  fs.rmSync(LOCK_FILE, { force: true });
  return true;
}

const pendingCount = () => countPending(readIfExists(PENDING_FILE));

// 여러 세션이 동시에 auto를 보고 회고를 두 번 띄우지 않게 잠금 파일을 배타적으로(wx) 만든다.
// 오래된 잠금을 지우고 다시 만드는 사이에 다른 세션이 끼면 그쪽이 이기고 이쪽은 busy가 된다.
function claim() {
  fs.mkdirSync(RECORDS_DIR, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(LOCK_FILE, JSON.stringify({ at: new Date().toISOString(), pid: process.pid }) + '\n', { flag: 'wx' });
      return console.log('ok');
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
    if (lockState(lockMtime()) === 'live') break;
    fs.rmSync(LOCK_FILE, { force: true });
  }
  console.log('busy');
}

// 회고가 끝까지 돌아 표시를 남겼으니 이어 실패한 것이 아니다. 횟수가 남아 있을 때만 파일을 쓴다.
function resetFailures() {
  if (readConfig().retroFailures > 0) fs.writeFileSync(CONFIG_FILE, configTextWithFailures(readIfExists(CONFIG_FILE), 0));
}

// 묻기 방식의 회고는 사용자가 직접 시켜 실패를 곁에서 보므로 자동 회고의 실패만 센다.
function countFailure() {
  const { retroMode, commandName, retroFailures } = readConfig();
  if (retroMode !== 'auto') return console.log('회고 방식이 묻기라 자동 회고 실패로 세지 않았습니다.');
  const failures = retroFailures + 1;
  if (failures >= RETRO_FAIL_LIMIT) {
    saveMode('ask');
    return console.log(`자동 회고가 두 번 이어 실패해 묻기 방식으로 돌아갔습니다. 권한 확인 창을 거부했거나 권한 모드가 쓰기를 막았을 수 있습니다. 다시 켜려면 /${commandName} auto`);
  }
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, configTextWithFailures(readIfExists(CONFIG_FILE), failures));
  console.log(`자동 회고 연속 실패 ${failures}회입니다. 두 번 이어 실패하면 묻기 방식으로 돌아갑니다.`);
}

function release(failed) {
  console.log(releaseLock() ? 'released' : 'none');
  if (failed) countFailure();
}

function saveMode(value) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, configTextWithMode(readIfExists(CONFIG_FILE), value));
}

// 인자가 없으면 지금 값을 찍고, 값이 있으면 저장한 뒤 바뀐 값을 찍는다.
function retroMode(value) {
  if (value !== undefined) {
    if (!RETRO_MODES.includes(value)) fail(`--retro-mode는 ${RETRO_MODES.join(' 또는 ')}만 받습니다: ${value}`);
    saveMode(value);
  }
  console.log(readConfig().retroMode);
}

// 사용자가 표에서 뺀 일 이름을 설정 파일에 남기거나 다시 뺀다. 회고가 직전 회고의 표 모양에 기대 뺀 이름을 가리면
// 뺀 뒤 회고를 한 번 거치거나 첫 회고 전에 뺀 이름이 다시 들어가므로, 뺀 이름은 회고 횟수와 상관없이 여기에 남긴다.
function changeRemovedKind(raw, add) {
  const flag = add ? '--remove-kind' : '--restore-kind';
  if (raw === undefined || raw.startsWith('--')) fail(`${flag}에는 일 이름이 필요합니다: ${flag} "<일 이름>"`);
  const name = kindNameOf(raw);
  if (!name) fail(`${flag}의 일 이름이 비어 있습니다: ${raw}`);
  if (add && RETRO_OWN_KINDS.includes(name)) fail(`「${name}」: 체계가 쓰는 여섯 가지 일이라 표에서 빼지 않습니다. 사용자가 빼 달라고 했으면 그렇다고 알리세요.`);
  const text = readIfExists(CONFIG_FILE);
  const kinds = readConfig().removedKinds;
  const has = kinds.includes(name);
  const next = configTextWithRemovedKinds(text, add ? (has ? kinds : [...kinds, name]) : kinds.filter((k) => k !== name));
  if (next === null) fail(`설정 파일이 깨져 removedKinds를 쓰지 못했습니다: ${CONFIG_FILE}`);
  if (add === has) {
    console.log(add ? `이미 removedKinds에 있어 그대로 뒀습니다: ${name}` : `removedKinds에 없어 그대로 뒀습니다: ${name}`);
  } else {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    fs.writeFileSync(CONFIG_FILE, next);
    console.log(add ? `removedKinds에 더했습니다: ${name}` : `removedKinds에서 뺐습니다: ${name}`);
  }
  if (add && readTable().known?.has(name)) console.log('표에 아직 그 이름이 있습니다. 표와 그 칸 정의의 description 일 이름 나열에서도 뺐는지 확인하세요.');
}

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));

function walkFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(f));
    else if (e.isFile()) out.push(f);
  }
  return out;
}

// 키는 설정 폴더 아래 경로(슬래시)다. 스크립트 폴더는 이 스크립트가 있는 폴더, 문서는 GUIDE 옆, 정의는 AGENTS_DIR, 스킬은 commandName으로 찾는다.
// rates.json(키트에만 있는 모델만 더함)과 SUBAGENT_BRIEF_CHECKLIST.md(사용자 줄이 섞임)는 통째로 바꾸지 않으므로 뺀다.
function kitHashesOf({ scriptsDir, retro, guide, agentsDir, skill, adapt = (t) => t }) {
  const out = new Map();
  const command = readConfig().commandName;
  for (const f of walkFiles(scriptsDir)) out.set(`subagent-system/scripts/${path.relative(scriptsDir, f).split(path.sep).join('/')}`, sha256(fs.readFileSync(f)));
  if (fs.existsSync(retro)) out.set('subagent-system/docs/RETRO.md', sha256(adapt(fs.readFileSync(retro, 'utf8'))));
  if (fs.existsSync(guide)) out.set('subagent-system/docs/SUBAGENT_GUIDE.md', sha256(guideTextOutsideZones(adapt(fs.readFileSync(guide, 'utf8')))));
  for (const name of KIT_DEF_NAMES) {
    const f = path.join(agentsDir, `${name}.md`);
    if (fs.existsSync(f)) out.set(`agents/${name}.md`, sha256(definitionTextForHash(adapt(fs.readFileSync(f, 'utf8')))));
  }
  if (fs.existsSync(skill)) out.set(`skills/${command}/SKILL.md`, sha256(adapt(fs.readFileSync(skill, 'utf8'), true)));
  return out;
}

function currentKitHashes() {
  const command = readConfig().commandName;
  return kitHashesOf({ scriptsDir: SCRIPTS_DIR, retro: path.join(path.dirname(GUIDE_FILE), 'RETRO.md'), guide: GUIDE_FILE, agentsDir: AGENTS_DIR, skill: path.join(CLAUDE_DIR, 'skills', command, 'SKILL.md') });
}

// 키트 폴더(subagent-system이 든 폴더)의 파일을 설치본에 놓을 때 하는 치환(CLAUDE_CONFIG_DIR 폴더, 커맨드 이름)을 거쳐 해시를 낸다.
// 업데이트가 이미 놓은 파일이 새 키트와 같은지 설치본 해시와 견주려는 것이다.
// 스킬은 $HOME 표기가 권한 규칙과 맞지 않을 때의 대비책으로 $HOME/.claude를 풀어 쓴 절대 경로로 바꿔 두기도 하므로 그 꼴의 해시도 alt에 낸다.
function kitFolderHashes(kitDir) {
  const base = path.join(kitDir, 'subagent-system');
  if (!fs.existsSync(path.join(base, 'scripts'))) fail(`키트 폴더가 아닙니다(subagent-system/scripts가 없음): ${kitDir}`);
  const command = readConfig().commandName;
  const dir = CLAUDE_DIR.split(path.sep).join('/');
  const adapt = (text, isSkill = false) => {
    let t = process.env.CLAUDE_CONFIG_DIR ? text.split('$HOME/.claude').join(dir).split('~/.claude').join(dir) : text;
    if (isSkill) t = t.replace(/^name: .*$/m, `name: ${command}`);
    return t;
  };
  const skill = path.join(base, 'skills', 'retro', 'SKILL.md');
  const hashes = kitHashesOf({ scriptsDir: path.join(base, 'scripts'), retro: path.join(base, 'docs', 'RETRO.md'), guide: path.join(base, 'docs', 'SUBAGENT_GUIDE.md'), agentsDir: path.join(base, 'agents'), skill, adapt });
  const alt = new Map();
  if (fs.existsSync(skill)) alt.set(`skills/${command}/SKILL.md`, sha256(adapt(fs.readFileSync(skill, 'utf8').split('$HOME/.claude').join(dir), true)));
  return { hashes, alt };
}

function recordKitHashes() {
  const current = currentKitHashes();
  const hashes = Object.fromEntries([...current].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const next = configTextWithKitHashes(readIfExists(CONFIG_FILE), hashes);
  if (next === null) fail(`설정 파일이 없거나 깨져 kitFileHashes를 쓰지 못했습니다: ${CONFIG_FILE}`);
  fs.writeFileSync(CONFIG_FILE, next);
  console.log(`kitFileHashes에 파일 ${current.size}개의 해시를 적었습니다`);
}

function checkKitHashes(kitDir) {
  let parsed = null;
  try {
    parsed = JSON.parse(readIfExists(CONFIG_FILE));
  } catch {
    // 설정 파일이 없거나 깨졌으면 기록이 없는 것으로 본다.
  }
  const recorded = kitFileHashesOf(parsed);
  if (!recorded) return console.log('기록 없음: config.json에 kitFileHashes가 없어 손으로 고친 파일을 가리지 못합니다.');
  const current = currentKitHashes();
  const kit = kitDir ? kitFolderHashes(kitDir) : null;
  const sameAsKit = (k) => kit && (kit.hashes.get(k) === current.get(k) || kit.alt.get(k) === current.get(k));
  const { changed, missing, removed, same } = diffKitHashes(recorded, current, readConfig().removedDefs);
  console.log(`기록과 같은 파일 ${same}개`);
  console.log(`기록과 다른 파일 ${changed.length}개(키트를 놓은 뒤 손으로 고쳤을 수 있음${kit ? '. 새 키트와 같음이 붙은 파일은 이미 새 키트로 놓인 것이라 고친 파일이 아님' : ''})`);
  for (const k of changed) console.log(`  다름  ${k}${sameAsKit(k) ? '  (새 키트와 같음)' : ''}`);
  console.log(`기록에 있는데 설치본에 없는 파일 ${missing.length}개`);
  for (const k of missing) console.log(`  없음  ${k}`);
  console.log(`회고가 지운 정의 ${removed.length}개(removedDefs에 든 이름이라 다시 놓지 않음)`);
  for (const k of removed) console.log(`  지움  ${k}`);
}

// 환경 변수는 날짜를 바꿔 시험하려는 용도다(YYYY-MM-DD, 로컬 정오).
function todayForDue() {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(process.env.SUBAGENT_TODAY ?? '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) : new Date();
}

// 지난 날수는 시각이 아니라 달력 날짜의 차이라서, 보존 기간과 같은 날에도 시작일 이른 시각에 끝난 대화는 이미 보존 기간(일 x 24시간)을 넘겨 지워졌을 수 있다.
const retentionReached = (d) => d.periodElapsed >= d.retentionDays;
const lossNote = (d, now) => `${retentionLossDate(d, now)} 이전 대화의 정정은 이미 지워졌을 수 있습니다`;

const periodReason = (d, now) => {
  const head = `${d.periodAnchor}부터 ${d.periodElapsed}일이 지나 대화 기록 보존 기간(${d.retentionDays}일)`;
  if (!retentionReached(d)) return `${head}이 가까워졌습니다`;
  return `${head}${d.periodElapsed > d.retentionDays ? '을 넘었습니다' : '에 닿았습니다'}. ${lossNote(d, now)}`;
};

function dueState() {
  // 기록이 없는 새 컴퓨터는 아직 물을 때가 아니다.
  const parsed = fs.existsSync(USAGE_FILE) ? parseUsage(fs.readFileSync(USAGE_FILE, 'utf8')) : parseUsage('');
  const table = readTable();
  const d = retroDue(parsed, { costMap: readCost(), trialsPending: table.trials.length > 0, retentionDays: retentionDays(), now: todayForDue() });
  const lock = lockState(lockMtime());
  return { d, lock, mode: readConfig().retroMode, pending: pendingCount(), parsed, table };
}

function dueLines() {
  const { d, lock, mode, pending } = dueState();
  const head = dueHead(d, { mode, lockLive: lock === 'live' });
  const lines = [head];
  if (d.upCells.length) lines.push(d.upCells.map(upLabel).join(', '));
  const extra = [lock === 'live' ? '회고 진행 중' : null, pending ? `물을 것 ${pending}건` : null].filter(Boolean);
  lines.push(`(사용 기록 ${d.usageCount}줄에 비용 기록에만 있는 ${d.count - d.usageCount}건을 더해 ${d.count}건으로 셌습니다. ${d.label}${d.byPeriod ? `. ${periodReason(d, todayForDue())}` : ''})${extra.length ? ' ' + extra.join(', ') : ''}`);
  return { head, lines, pending };
}

function printDue() {
  console.log(dueLines().lines.join('\n'));
}

function printStatus() {
  const { d, lock, mode, pending } = dueState();
  const head = dueHead(d, { mode, lockLive: lock === 'live' });
  const mtime = lockMtime();
  const lockText = { none: '없음', live: `진행 중(시작한 지 ${Math.round((Date.now() - mtime) / 60000)}분)`, stale: `버려진 잠금(${LOCK_STALE_MS / 3600000}시간 넘음, 다음 --claim이 다시 잡음)` }[lock];
  console.log(`회고 방식: ${mode === 'auto' ? '자동(auto)' : '묻기(ask)'}${fs.existsSync(CONFIG_FILE) ? '' : ' (설정 파일이 없어 묻기로 봅니다)'}`);
  const due = head === 'ask' ? '회고할 때입니다(ask)' : head === 'auto' ? '회고할 때입니다(auto, 회고할지는 묻지 않고 자동 회고를 띄웁니다)' : lock === 'live' ? '회고가 진행 중이라 새로 띄우지 않습니다(wait)' : `다음 회고까지 ${d.remaining}건(wait ${d.remaining})`;
  console.log(`회고 시점: ${due}`);
  console.log(`회고 기준: ${d.label}, 지금 ${d.count}건(사용 기록 ${d.usageCount}줄에 비용 기록에만 있는 ${d.count - d.usageCount}건을 더함)`);
  const periodState = d.byPeriod
    ? `${d.periodAnchor}부터 ${d.periodLimit}일째인 ${d.periodDueDate}에 묻습니다(지금 ${d.periodElapsed}일 지남)${retentionReached(d) ? `. ${lossNote(d, todayForDue())}` : ''}`
    : d.periodElapsed >= d.periodLimit
      ? `기간은 지났으나 ${d.periodAnchor} 뒤 새 기록이 없어 묻지 않습니다(새 기록이 생기면 묻습니다)`
      : `${d.periodAnchor}부터 ${d.periodLimit}일째인 ${d.periodDueDate}에 묻습니다`;
  console.log(`기간 기준: 보존 기간 ${d.retentionDays}일, ${d.periodAnchor ? periodState : '기준 날짜 없음(사용 기록이 비어 있음)'}`);
  console.log(`올림이 쌓인 칸: ${d.upCells.length ? d.upCells.map(upLabel).join(', ') : '없음'}`);
  console.log(`회고 잠금: ${lockText}`);
  console.log(`물을 것: ${pending}건`);
  const { parsed, table } = dueState();
  // 시험을 보내기 전에 이미 보냈는지 가리는 줄이라, 정정과 비용이 필요한 판정은 회고 출력에만 찍는다.
  const trials = table.trials.map((t) => trialVerdict(t, parsed.target));
  const trialState = !table.cells ? `표를 읽지 못함(${table.problems.join('; ')})` : trials.length ? trials.map((v) => `${v.cellDef} / ${kindLabel(v.kind)} → ${v.def} ${v.state}`).join(', ') : '없음';
  console.log(`시험 표시: ${trialState}`);
  const retrials = trials.filter((v) => isRetrial(v.kind, v.def, table.floors));
  if (retrials.length) console.log(`최저선 다시 시험: ${retrials.map((v) => `${trialName(v)} ${v.state}`).join(', ')}`);
  const { retroFailures } = readConfig();
  if (retroFailures > 0) console.log(`자동 회고 연속 실패: ${retroFailures}회(두 번 이어 실패하면 묻기 방식으로 돌아감)`);
  console.log(`설정 파일: ${CONFIG_FILE}`);
}

// 어떤 인자에도 종료 코드 0으로 끝난다. Claude가 이 출력을 읽고 다음 일을 정하므로 오류 종료로 흐름이 끊기지 않게 하려는 것이다.
function slash(raw) {
  const arg = String(raw ?? '').trim();
  const name = readConfig().commandName;
  if (arg === '' || arg === 'now') {
    printStatus();
    if (arg === 'now') {
      // 기록이 없는데 지금 회고 요청을 내보내면 볼 것이 없는 회고가 돈다.
      if (dueState().d.count === 0) console.log(`\n사용 기록이 없어 회고하지 않습니다. 서브에이전트를 쓰면서 기록이 쌓인 뒤에 /${name} now를 다시 입력하세요.`);
      else console.log(`\n요청: 지금 회고(now), 회고 방식 ${readConfig().retroMode}`);
    }
    return;
  }
  if (arg === 'auto' || arg === 'ask') {
    const before = readConfig().retroMode;
    saveMode(arg);
    console.log(before === arg ? `회고 방식은 이미 ${arg}입니다.` : `회고 방식을 ${before}에서 ${arg}로 바꿨습니다.`);
    console.log('');
    printStatus();
    return;
  }
  console.log(`알 수 없는 인자입니다: ${arg}\n사용법\n  /${name}        상태 보기\n  /${name} auto   회고 방식을 자동으로\n  /${name} ask    회고 방식을 묻기로\n  /${name} now    기준과 상관없이 지금 회고`);
}

// 묻기를 마친 뒤 메인이 줄 수를 직접 세지 않고 적게 하려는 것이다. 설정 파일은 없으면 만들지 않는다.
function claudeMdDone() {
  const file = path.join(CLAUDE_DIR, 'CLAUDE.md');
  const sum = claudeMdSummary(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);
  if (!fs.existsSync(CONFIG_FILE)) fail(`설정 파일이 없어 claudeMdKeptLines를 쓰지 못했습니다: ${CONFIG_FILE}`);
  const text = fs.readFileSync(CONFIG_FILE, 'utf8');
  const over = sum.exists && sum.total > CLAUDE_MD_LIMIT_LINES;
  const next = over ? configTextWithKeptLines(text, sum.total) : configTextWithoutKeptLines(text);
  if (next === null) fail(`설정 파일이 깨져 claudeMdKeptLines를 쓰지 못했습니다: ${CONFIG_FILE}`);
  if (over) {
    fs.writeFileSync(CONFIG_FILE, next);
    return console.log(`CLAUDE.md ${sum.total}줄: claudeMdKeptLines에 ${sum.total}줄을 적었습니다`);
  }
  const had = 'claudeMdKeptLines' in JSON.parse(text);
  if (had) fs.writeFileSync(CONFIG_FILE, next);
  const head = sum.exists ? `CLAUDE.md ${sum.total}줄: ${CLAUDE_MD_LIMIT_LINES}줄 이하라` : 'CLAUDE.md 없음:';
  console.log(`${head} claudeMdKeptLines를 ${had ? '지웠습니다' : '지울 것이 없어 그대로 뒀습니다'}`);
}

function main() {
  const args = process.argv.slice(2);
  const slashAt = args.indexOf('--slash');
  if (slashAt >= 0) return slash(args[slashAt + 1]);
  const modeAt = args.indexOf('--retro-mode');
  if (modeAt >= 0) return retroMode(args[modeAt + 1]?.startsWith('--') ? undefined : args[modeAt + 1]);
  for (const [flag, add] of [['--remove-kind', true], ['--restore-kind', false]]) {
    const at = args.indexOf(flag);
    if (at >= 0) return changeRemovedKind(args[at + 1], add);
  }
  if (args.includes('--record-kit-hashes')) return recordKitHashes();
  if (args.includes('--check-kit-hashes')) {
    const kitAt = args.indexOf('--kit');
    if (kitAt >= 0 && (!args[kitAt + 1] || args[kitAt + 1].startsWith('--'))) fail('--kit에는 키트 폴더를 줍니다.');
    return checkKitHashes(kitAt >= 0 ? path.resolve(args[kitAt + 1]) : null);
  }
  if (args.includes('--claude-md-done')) return claudeMdDone();
  if (args.includes('--claim')) return claim();
  if (args.includes('--release')) return release(args.includes('--failed'));
  if (args.includes('--status')) return printStatus();
  if (args.includes('--log')) return logUsage(args);
  if (args.includes('--snooze')) return snooze();
  if (args.includes('--due')) return printDue();
  const opts = parseArgs(args);
  if (opts.where) return console.log(RECORDS_DIR);
  if (opts.check) return printCheck();
  if (opts.repeats) return printRepeats(opts);
  if (opts.mark !== null) return mark(opts);
  if ((opts.messages === null) !== (opts.labels === null)) fail('--messages와 --labels는 함께 씁니다.');

  if (opts.kinds) {
    // 새로 깐 컴퓨터는 기록이 비어 있어도 표 형식은 검사할 수 있어야 한다.
    const table = readTable();
    if (!table.known || !fs.existsSync(USAGE_FILE)) {
      if (table.known) console.log(`표는 읽었습니다. 사용 기록이 없습니다: ${USAGE_FILE}`);
      else printKinds(null, table);
      return;
    }
    return printKinds(readUsage(), table);
  }

  // 기록이 아직 없는 것은 정상 상태라 오류로 끝내지 않는다.
  if (opts.count && !fs.existsSync(USAGE_FILE)) return console.log(`사용 기록이 없습니다: ${USAGE_FILE}`);
  const parsed = readUsage();
  if (opts.count) return console.log(parsed.target.length);
  const costMap = readCost();
  const table = readTable();
  if (opts.labels !== null) return applyLabels(opts, parsed, costMap, table);

  const history = parseCorrections(readIfExists(CORRECTIONS_FILE));
  printReport(parsed, costMap, countByAgent(history), false, table);
  if (opts.extract !== null) {
    extractToFile(opts.extract, parsed);
    printLabelNames(history);
  }
}

main();
