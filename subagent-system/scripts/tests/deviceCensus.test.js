import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { nameKey, verdictNames, fragmentsOf, settingsHooks, catches, inventory, resolveName, attribute, blockEvents, scanTranscript, tally, hintOf, COMMIT_NOTE } from '../deviceCensus.js';

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(SCRIPTS, 'work-metrics.js');
const SESSION = '11111111-2222-3333-4444-555555555555';
const tempRoots = [];
after(() => {
  for (const r of tempRoots) fs.rmSync(r, { recursive: true, force: true });
});

// 판정 이름 꼴 셋(머리, 접두, 박힌 이름)을 다 가진 가짜 훅 원본.
const STOP_HOOK = [
  "const { named } = require('./kit-hook.cjs');",
  'function check(text) {',
  '  const parts = [];',
  "  if (text.includes('a')) parts.push(`실무자 기다림: 뒤에서 도는 실무자를 기다리며 멈추려 한다. 예약을 건다.`);",
  "  if (text.includes('b')) parts.push('이어 하기: 답 끝 다음 칸에 AI 할 일이 남았다. 이어 한다.');",
  "  return named({ decision: 'block', reason: parts.join(' ') }, parts.map((x) => `멈춤 검사 ${x.split(':')[0]}`));",
  '}',
].join('\n');
const BRIEF_HOOK = [
  "const { named } = require('./kit-hook.cjs');",
  'function check(input) {',
  '  const problems = [];',
  "  problems.push('결정 문서 경로가 없다. 결정 문서 경로를 적어라.');",
  '  problems.push(`「${cell}」 칸에 시험 표시가 있고 이 회고 구간에 시험 정의로 보낸 건이 적다.`);',
  "  return named({ hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: '서브에이전트 지시문을 보내기 전에 고쳐라.\\n- ' + problems.join('\\n- ') } }, problems.map((p) => `지시문 점검 ${p.split(/[.:(]/)[0].trim().slice(0, 40)}`));",
  '}',
].join('\n');
const CHURN_HOOK = [
  "const { named } = require('./kit-hook.cjs');",
  "const out = named({ hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: `되고침 신호: ${rel} 파일은 최근 여러 번 커밋됐다. 고치기 전에 멈추고 따진다.` } }, [`되고침 신호\\t${rel} ${n}회`]);",
].join('\n');

describe('판정 이름 뽑기', () => {
  it('접두와 머리 이름을 사유 머리 꼴에서 뽑는다', () => {
    const n = verdictNames(STOP_HOOK);
    assert.equal(n.prefix, '멈춤 검사 ');
    assert.deepEqual(n.heads.sort(), ['실무자 기다림', '이어 하기'].sort());
  });
  it('problems.push 글의 머리를 접두 꼴 훅의 판정으로 본다', () => {
    const n = verdictNames(BRIEF_HOOK);
    assert.equal(n.prefix, '지시문 점검 ');
    assert.ok(n.problems.includes('결정 문서 경로가 없다'));
  });
  it('named에 박힌 이름을 뽑는다', () => {
    assert.deepEqual(verdictNames(CHURN_HOOK).literals, ['되고침 신호']);
  });
  it('다른 훅이 부르는 훅은 named가 없어도 머리 글자를 판정으로 본다', () => {
    const src = "return `결정 대조: 이번 대표 말이 결정 문서에 없다.`;";
    assert.deepEqual(verdictNames(src).heads, []);
    assert.deepEqual(verdictNames(src, { called: true }).heads, ['결정 대조']);
  });
  it('열쇠는 칸 이름과 잘린 정의 이름을 줄여 같은 판정을 한데 묶는다', () => {
    assert.equal(nameKey('「정책 점검」은 라우팅 표에서 opus-low 칸인데 opu'), nameKey('「리뷰 지적 수정」은 라우팅 표에서 sonnet-medium 칸인데 op'));
    assert.notEqual(nameKey('지시문이 전체 시험 명령만 준다'), nameKey('지시문이 실무자에게 워크트리 만들기'));
  });
  it('주석 줄은 조각에 넣지 않는다', () => {
    const f = fragmentsOf("// 주석 안의 긴 한국어 문장은 조각이 아니다\nconst a = '사유 글에 실리는 긴 한국어 문장이다';");
    assert.deepEqual(f, ['사유 글에 실리는 긴 한국어 문장이다']);
  });
});

describe('등록 읽기', () => {
  it('이름표로 장치를 묶고 설정 폴더 밖 훅은 바깥으로 센다', () => {
    const settings = {
      hooks: {
        Stop: [{ hooks: [{ command: 'node "$HOME/.claude/subagent-system/hooks/kit-hook.cjs" stall-check node "$HOME/.claude/subagent-system/hooks/stall-check.js" # kit:routing/stall-check' }, { command: '/usr/local/bin/other-tool hook' }] }],
        PreToolUse: [{ matcher: 'Agent', hooks: [{ command: 'node "$HOME/.claude/subagent-system/hooks/brief-check.js" # kit:routing/brief-check' }] }],
      },
    };
    const { hooks, outside } = settingsHooks(settings, '/home/u/.claude');
    assert.equal(outside, 1);
    assert.deepEqual(hooks.map((h) => h.name).sort(), ['brief-check', 'stall-check']);
    assert.equal(hooks.find((h) => h.name === 'stall-check').file, '/home/u/.claude/subagent-system/hooks/stall-check.js');
    const brief = hooks.find((h) => h.name === 'brief-check');
    assert.ok(catches(brief, 'Agent'));
    assert.ok(!catches(brief, 'Bash'));
  });
});

// 가짜 설정 폴더: 훅 셋, 등록 없는 개인 훅 하나, 커밋 훅 하나, 스킬 하나, 정의 하나.
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-census-test-'));
  tempRoots.push(root);
  const claude = path.join(root, 'claude');
  const hooks = path.join(claude, 'subagent-system', 'hooks');
  const records = path.join(root, 'records');
  fs.mkdirSync(path.join(hooks, 'git', 'commit-msg.d'), { recursive: true });
  fs.mkdirSync(path.join(claude, 'hooks'), { recursive: true });
  fs.mkdirSync(path.join(claude, 'skills', 'tidy'), { recursive: true });
  fs.mkdirSync(path.join(claude, 'agents'), { recursive: true });
  fs.mkdirSync(path.join(claude, 'projects', '-work'), { recursive: true });
  fs.mkdirSync(records, { recursive: true });
  fs.writeFileSync(path.join(hooks, 'stall-check.js'), STOP_HOOK);
  fs.writeFileSync(path.join(hooks, 'brief-check.js'), BRIEF_HOOK);
  fs.writeFileSync(path.join(hooks, 'quiet-check.js'), "process.stdout.write('{}');");
  fs.writeFileSync(path.join(hooks, 'guardShared.cjs'), 'module.exports = {};');
  fs.writeFileSync(path.join(hooks, 'git', 'commit-msg.d', '20-why-premise.cjs'), "module.exports = { run: () => '커밋 메시지에 왜 줄과 전제 줄이 없어 커밋을 막았습니다' };");
  fs.writeFileSync(path.join(claude, 'skills', 'tidy', 'SKILL.md'), '---\nname: tidy\n---\n');
  fs.writeFileSync(path.join(claude, 'agents', 'opus-xhigh.md'), '---\nname: opus-xhigh\n---\n');
  const cmd = (name, event) => `node "$HOME/.claude/subagent-system/hooks/kit-hook.cjs" ${name} node "$HOME/.claude/subagent-system/hooks/${name}.js" # kit:routing/${name}`;
  fs.writeFileSync(
    path.join(claude, 'settings.json'),
    JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ command: cmd('stall-check') }] }],
        PreToolUse: [
          { matcher: 'Agent', hooks: [{ command: cmd('brief-check') }] },
          { matcher: 'Bash', hooks: [{ command: cmd('quiet-check') }] },
        ],
      },
    }).replaceAll('$HOME/.claude', claude)
  );
  const lock = { installed: { 'work-git': { parts: { core: { origin: 'kit', hooks: [], gitHooks: [{ hook: 'commit-msg', name: 'why-premise', order: 20, file: 'subagent-system/hooks/git/commit-msg.d/20-why-premise.cjs' }] } } } } };
  return { root, claude, records, lock };
}

const blockRow = (at, name, tool, input = '') => [at, SESSION, name, tool, input].join('\t');

describe('장치 목록과 셈', () => {
  it('등록, 커밋 훅, 부품, 스킬, 정의를 모두 목록에 넣는다', () => {
    const { claude, lock } = setup();
    const settings = JSON.parse(fs.readFileSync(path.join(claude, 'settings.json'), 'utf8'));
    const { devices } = inventory({ configDir: claude, kitDir: '', settings, lock });
    const names = devices.map((d) => `${d.kind}:${d.name}`).sort();
    assert.deepEqual(names, ['부품:guardShared.cjs', '스킬:tidy', '정의:opus-xhigh', '커밋 훅:commit-msg/why-premise', '훅:brief-check', '훅:quiet-check', '훅:stall-check'].sort());
  });

  it('기록 이름을 장치와 판정에 짝짓고 못 지은 이름을 따로 둔다', () => {
    const { claude, lock } = setup();
    const settings = JSON.parse(fs.readFileSync(path.join(claude, 'settings.json'), 'utf8'));
    const { devices } = inventory({ configDir: claude, kitDir: '', settings, lock });
    assert.equal(resolveName(devices, '멈춤 검사 실무자 기다림', 'Stop').device.name, 'stall-check');
    assert.equal(resolveName(devices, '지시문 점검 「정책 점검」 칸에 시험 표시', 'Agent').key, nameKey('「…」 칸에 시험 표시'));
    assert.equal(resolveName(devices, 'quiet-check', 'Bash').key, null);
    assert.equal(resolveName(devices, '없는 판정', 'Stop'), null);
  });

  it('한 Stop 글의 여러 판정을 가르고, 막힌 도구를 같은 입력으로 다시 내 통과하면 헛막음 후보로 센다', async () => {
    const { claude, lock, root } = setup();
    const settings = JSON.parse(fs.readFileSync(path.join(claude, 'settings.json'), 'utf8'));
    const { devices } = inventory({ configDir: claude, kitDir: '', settings, lock });
    assert.deepEqual(attribute(devices.filter((d) => d.kind === '훅'), '실무자 기다림: 뒤에서. 이어 하기: 답 끝.', 'Stop')[0].verdicts.map((v) => v.label).sort(), ['실무자 기다림', '이어 하기'].sort());
    const t0 = Date.UTC(2026, 10, 1);
    const at = (s) => new Date(t0 + s * 1000).toISOString();
    const input = { subagent_type: 'opus-high', prompt: 'x' };
    const lines = [
      { type: 'assistant', timestamp: at(1), message: { content: [{ type: 'tool_use', id: 't1', name: 'Agent', input }] } },
      { type: 'user', timestamp: at(2), message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'PreToolUse:Agent hook error: 서브에이전트 지시문을 보내기 전에 고쳐라.\n- 결정 문서 경로가 없다. 결정 문서 경로를 적어라.' }] } },
      { type: 'assistant', timestamp: at(3), message: { content: [{ type: 'tool_use', id: 't2', name: 'Agent', input }] } },
      { type: 'user', timestamp: at(4), message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: 'ok' }] } },
      { type: 'user', timestamp: at(5), uuid: 'u1', isMeta: true, message: { content: 'Stop hook feedback:\n실무자 기다림: 뒤에서 도는 실무자를 기다리며 멈추려 한다.' } },
      { type: 'assistant', timestamp: at(6), message: { content: [{ type: 'tool_use', id: 't3', name: 'Bash', input: { command: 'git commit -m x' } }] } },
      { type: 'user', timestamp: at(7), message: { content: [{ type: 'tool_result', tool_use_id: 't3', is_error: true, content: '커밋 메시지에 왜 줄과 전제 줄이 없어 커밋을 막았습니다' }] } },
      { type: 'assistant', timestamp: at(8), message: { content: [{ type: 'tool_use', id: 't4', name: 'Bash', input: { command: 'git commit -m y' } }] } },
      { type: 'user', timestamp: at(9), message: { content: [{ type: 'tool_result', tool_use_id: 't4', content: `${COMMIT_NOTE}, 커밋은 그대로 진행): 다른 알림` }] } },
    ];
    const file = path.join(root, 'claude', 'projects', '-work', `${SESSION}.jsonl`);
    fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const scan = await scanTranscript(file, t0);
    const events = blockEvents(devices, [scan]);
    const brief = events.find((e) => e.owner?.name === 'brief-check');
    assert.equal(brief.outcome, '다시 내 통과');
    assert.equal(brief.verdicts[0].label, '결정 문서 경로가 없다');
    assert.ok(events.some((e) => e.owner?.name === 'stall-check' && e.verdicts[0].label === '실무자 기다림'));
    const commit = events.find((e) => e.owner?.kind === '커밋 훅' && !e.note);
    assert.equal(commit.outcome, '다른 입력');
  });

  it('기록을 모아 실마리를 단다: 쓰임 0, 원본에 없는 판정, 문지기', () => {
    const { claude, lock, records } = setup();
    const settings = JSON.parse(fs.readFileSync(path.join(claude, 'settings.json'), 'utf8'));
    const { devices } = inventory({ configDir: claude, kitDir: '', settings, lock });
    const since = Date.UTC(2026, 9, 1);
    fs.writeFileSync(
      path.join(records, 'hook-blocks.tsv'),
      ['시각\t세션\t판정 이름\t도구\t입력', blockRow('2026-11-01T00:00:00.000Z', '멈춤 검사 실무자 기다림', 'Stop'), blockRow('2026-11-01T00:01:00.000Z', '멈춤 검사 패널 답', 'Stop'), blockRow('2026-11-01T00:02:00.000Z', '아무도 아닌 이름', 'Stop')].join('\n') + '\n'
    );
    fs.writeFileSync(path.join(records, 'hook-false-positive.tsv'), [`2026-11-01T00:00:30.000Z\t${SESSION}\t멈춤 검사 실무자 기다림\t오탐 후보\t통과\tStop`].join('\n') + '\n');
    const t = tally({ devices, recordsDir: records, configDir: claude, since, events: [], fixRows: [{ at: '2026-11-01', where: '~/.claude/subagent-system/hooks/stall-check.js#실무자 기다림' }] });
    const get = (name, label = null) => t.rows.find((r) => r.device.name === name && r.label === label);
    const wait = get('stall-check', '실무자 기다림');
    assert.equal(wait.blocksRec, 1);
    assert.equal(wait.fpStop, 1);
    assert.equal(wait.fixes, 1);
    assert.equal(get('stall-check').blocksRec, 2);
    assert.equal(get('stall-check', '패널 답').hint, '원본에 없음(옛 이름이나 걷은 판정)');
    assert.equal(get('quiet-check').hint, '쓰임 0');
    assert.equal(get('guardShared.cjs').hint, '');
    assert.deepEqual(t.unmatched.map((u) => u.name), ['아무도 아닌 이름']);
    assert.equal(hintOf({ ...get('quiet-check'), device: { ...get('quiet-check').device, bundle: 'safety' } }), '문지기(걷기와 느슨하게는 사용자 몫)');
  });

  it('devices 하위 명령이 같은 표를 json으로 낸다', () => {
    const { claude, records } = setup();
    fs.writeFileSync(path.join(records, 'hook-blocks.tsv'), blockRow(new Date().toISOString(), '멈춤 검사 이어 하기', 'Stop') + '\n');
    const r = spawnSync('node', [CLI, 'devices', '--days', '30', '--json'], { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: claude, SUBAGENT_RECORDS_DIR: records, SUBAGENT_AGENTS_DIR: path.join(claude, 'agents'), WORK_METRICS_NO_RG: '1' } });
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    const row = j.rows.find((x) => x.name === 'stall-check' && x.verdict === '이어 하기');
    assert.equal(row.blocksRec, 1);
    assert.ok(j.rows.some((x) => x.kind === '정의' && x.name === 'opus-xhigh' && x.hint === '쓰임 0'));
  });
});
