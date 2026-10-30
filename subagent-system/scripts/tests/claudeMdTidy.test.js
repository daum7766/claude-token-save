import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_LIMIT_LINES,
  KEPT_MARGIN_LINES,
  alwaysLoadedLines,
  analyzeClaudeMd,
  claudeMdSettingsOf,
  claudeMdTarget,
  claudeMdVerdict,
  backupPathFor,
  classifyLines,
  findKitZones,
  findRemovableLines,
} from '../claudeMdTidy.js';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'claude-md-tidy-'));
const write = (dir, name, text) => {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
};
const nLines = (n, prefix = '줄') => Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`).join('\n') + '\n';

describe('findKitZones 옛 키트 구역과 「구역:」 줄', () => {
  const OLD = [
    '# 사용자 기본',
    '<!-- subagent-system 시작 -->',
    '- 키트 줄 1',
    '- 키트 줄 2',
    '<!-- subagent-system 끝 -->',
    '<!-- claude-setup-kit extras 시작 -->',
    '- extras 줄',
    '<!-- claude-setup-kit extras 끝 -->',
    '## 구역 고침',
    '- 구역: 「## git」의 「옛 문장」 대신 「새 문장」.',
    '- 구역: 「## 질문」에 「문장」을 더한다.',
    '- 구역: 그 밖의 꼴',
    '- 내 줄',
  ].join('\n');

  it('짝이 맞는 두 구역의 시작, 끝, 줄 수를 낸다', () => {
    const { zones } = findKitZones(OLD);
    assert.deepEqual(zones, [
      { name: 'subagent-system', start: 2, end: 5, status: 'paired', lineCount: 4 },
      { name: 'claude-setup-kit extras', start: 6, end: 8, status: 'paired', lineCount: 3 },
    ]);
  });

  it('「구역:」 줄을 고침 꼴(대신, 더한다, 그 밖)로 가르고 가장 가까운 제목을 붙인다', () => {
    const { zoneEdits } = findKitZones(OLD);
    assert.deepEqual(zoneEdits.map((e) => [e.line, e.kind, e.section, e.inZone]), [
      [10, 'replace', '구역 고침', false],
      [11, 'add', '구역 고침', false],
      [12, 'other', '구역 고침', false],
    ]);
  });

  it('끝 표시가 없는 시작과 시작 없는 끝은 구역으로 세지 않고 상태로 알린다', () => {
    const { zones } = findKitZones(['<!-- subagent-system 시작 -->', 'a', '<!-- claude-setup-kit extras 끝 -->'].join('\n'));
    assert.deepEqual(zones.map((z) => [z.name, z.status, z.lineCount]), [
      ['subagent-system', 'unclosed', 0],
      ['claude-setup-kit extras', 'orphan-end', 0],
    ]);
  });

  it('키트 구역 이름이 아닌 주석과 코드 블록 안 표시는 찾지 않는다', () => {
    const text = ['<!-- 내 메모 시작 -->', '```', '<!-- subagent-system 시작 -->', '- 구역: 예시', '```', '<!-- 내 메모 끝 -->'].join('\n');
    const r = findKitZones(text);
    assert.deepEqual(r.zones, []);
    assert.deepEqual(r.zoneEdits, []);
  });
});

describe('classifyLines 정책 후보와 방법 후보', () => {
  const pick = (text) => Object.fromEntries(classifyLines(text).map((l) => [l.line, l.candidate]));

  it('목적, 우선순위, 묻는 일을 말하는 줄은 정책 후보다', () => {
    const r = pick(['- 프로젝트 규칙이 있으면 그쪽이 우선이다.', '- 되돌릴 수 없는 작업은 먼저 묻는다.', '- 목표는 사용자가 결과만 확인하는 것이다.'].join('\n'));
    assert.deepEqual(r, { 1: 'policy', 2: 'policy', 3: 'policy' });
  });

  it('절차, 형식, 도구를 말하는 줄은 방법 후보다', () => {
    const r = pick(['- 보고는 표로 쓰고 `report.md` 경로를 붙인다.', '- 단계는 순서대로 하고 npm 명령으로 빌드한다.'].join('\n'));
    assert.deepEqual(r, { 1: 'method', 2: 'method' });
  });

  it('빈 줄, 제목, 코드 블록, 키트 구역, 「구역:」 줄은 가르지 않는다', () => {
    const text = [
      '# 제목',
      '',
      '<!-- subagent-system 시작 -->',
      '- 목표 구역 안 줄',
      '<!-- subagent-system 끝 -->',
      '- 구역: 「a」 대신 「b」',
      '```',
      '- 목표 코드 안',
      '```',
      '- 목표 내 줄',
    ].join('\n');
    assert.deepEqual(classifyLines(text).map((l) => l.line), [10]);
  });

  it('각 줄에 어느 단서에 걸렸는지 남기고 후보는 확정이 아니다', () => {
    const [l] = classifyLines('## 형식\n- 목표를 `a.md`에 적는다.\n');
    assert.equal(l.section, '형식');
    assert.deepEqual(l.policyHits, ['목표']);
    assert.deepEqual(l.methodHits, ['경로']);
    assert.equal(l.candidate, 'mixed');
  });
});

describe('늘 읽히는 줄 수', () => {
  it('CLAUDE.md와 paths 없는 규칙을 합쳐 세고 paths 있는 규칙은 뺀다', () => {
    const dir = tmpDir();
    write(dir, 'CLAUDE.md', nLines(30));
    write(dir, 'rules/kit-core.md', nLines(20));
    write(dir, 'rules/nested/free.md', '---\ndescription: x\n---\n' + nLines(5));
    write(dir, 'rules/scoped.md', '---\npaths:\n  - "src/**"\n---\n' + nLines(40));
    write(dir, 'rules/notes.txt', nLines(40));
    const r = alwaysLoadedLines({ configDir: dir });
    assert.equal(r.total, 55);
    assert.equal(r.over, false);
    assert.deepEqual(r.files.map((f) => [path.relative(dir, f.path), f.kind, f.lines]), [
      ['CLAUDE.md', 'claude-md', 30],
      ['rules/kit-core.md', 'rule', 20],
      ['rules/nested/free.md', 'rule', 5],
    ]);
    assert.deepEqual(r.pathScopedRules.map((p) => path.relative(dir, p)), ['rules/scoped.md']);
  });

  it('늘 읽히는 줄이 기준 80줄을 넘으면 넘었다는 판정과 넘은 줄 수가 나온다', () => {
    const dir = tmpDir();
    write(dir, 'CLAUDE.md', nLines(60));
    write(dir, 'rules/a.md', nLines(21));
    const r = alwaysLoadedLines({ configDir: dir });
    assert.equal(DEFAULT_LIMIT_LINES, 80);
    assert.deepEqual([r.total, r.over, r.overBy], [81, true, 1]);
    assert.equal(alwaysLoadedLines({ configDir: dir, limit: 81 }).over, false);
  });

  it('정확히 기준 줄 수이면 넘지 않은 것이다', () => {
    const dir = tmpDir();
    write(dir, 'CLAUDE.md', nLines(80));
    assert.equal(alwaysLoadedLines({ configDir: dir }).over, false);
  });

  it('`@` 불러오기 대상은 있을 때만 세고 순환과 코드 span 안은 세지 않는다', () => {
    const dir = tmpDir();
    write(dir, 'CLAUDE.md', ['시작', '@core.md', '@missing.md', '`@ignored.md` 설명', '메일 a@ignored.md'].join('\n') + '\n');
    write(dir, 'core.md', '@CLAUDE.md\n' + nLines(10));
    write(dir, 'ignored.md', nLines(99));
    const r = alwaysLoadedLines({ configDir: dir });
    assert.deepEqual(r.files.map((f) => [path.basename(f.path), f.kind, f.lines]), [
      ['CLAUDE.md', 'claude-md', 5],
      ['core.md', 'import', 11],
    ]);
    assert.equal(r.total, 16);
  });
});

describe('findRemovableLines Opus 5.5 글의 지울 것', () => {
  const TEXT = [
    '- Think hard before answering.',
    '- 항상 step by step으로 풀어라.',
    '- 생각 과정을 그대로 적어라.',
    '- 화면은 예쁘게 만들어라.',
    '- 평범한 규칙이다.',
    '<!-- subagent-system 시작 -->',
    '- think carefully는 지운다.',
    '<!-- subagent-system 끝 -->',
    '```',
    'think hard',
    '```',
  ].join('\n');

  it('Opus 5.5 세션이면 사고 지시, 추론 재현, 모호한 디자인 지시를 분류해 낸다', () => {
    const r = findRemovableLines(TEXT, 'claude-opus-5-5');
    assert.equal(r.applies, true);
    assert.deepEqual(r.lines.map((l) => [l.line, l.category]), [
      [1, 'thinking-directive'],
      [2, 'thinking-directive'],
      [3, 'reasoning-echo'],
      [4, 'vague-design'],
    ]);
  });

  it('다른 모델이면 적용하지 않고 줄을 내지 않는다', () => {
    assert.deepEqual(findRemovableLines(TEXT, 'claude-sonnet-5-5'), { applies: false, lines: [] });
  });

  it('모델을 모르면 Opus 5.5 권고를 적용할지 정하지 않고 후보 줄은 함께 낸다', () => {
    const r = findRemovableLines(TEXT);
    assert.equal(r.applies, null);
    assert.equal(r.lines.length, 4);
  });
});

describe('backupPathFor 백업 경로 계산', () => {
  const NOW = new Date(2026, 9, 30, 9, 5, 7);

  it('같은 이름이 이미 있으면 덮지 않고 -1, -2를 붙인다', () => {
    const taken = new Set();
    const exists = (p) => taken.has(p);
    const first = backupPathFor('/c/CLAUDE.md', { now: NOW, exists });
    taken.add(first);
    const second = backupPathFor('/c/CLAUDE.md', { now: NOW, exists });
    taken.add(second);
    assert.equal(second, `${first}-1`);
    assert.equal(backupPathFor('/c/CLAUDE.md', { now: NOW, exists }), `${first}-2`);
  });
});

describe('analyzeClaudeMd와 명령줄', () => {
  const LEGACY = [
    '# 사용자 기본',
    '- 프로젝트 규칙이 있으면 그쪽이 우선이다.',
    '<!-- subagent-system 시작 -->',
    '- 키트 줄',
    '<!-- subagent-system 끝 -->',
    '## 구역 고침',
    '- 구역: 「a」 대신 「b」',
    '- Think hard 하라.',
    '- 보고는 표로 `a.md`에 쓴다.',
  ].join('\n') + '\n';

  it('CLAUDE.md 정리 점검은 판정을 한 번에 내고 파일을 고치거나 백업을 만들지 않는다', () => {
    const dir = tmpDir();
    const file = write(dir, 'CLAUDE.md', LEGACY);
    const before = fs.readdirSync(dir);
    const r = analyzeClaudeMd({ configDir: dir, model: 'claude-opus-5-5', now: new Date(2026, 0, 2, 3, 4, 5) });
    assert.equal(r.file, file);
    assert.equal(r.zones.length, 1);
    assert.equal(r.zoneEdits.length, 1);
    assert.deepEqual(r.lines.map((l) => [l.line, l.candidate]), [[2, 'policy'], [8, 'unknown'], [9, 'method']]);
    assert.deepEqual(r.opus55.lines.map((l) => l.line), [8]);
    assert.equal(r.loaded.total, 9);
    assert.equal(r.summary.confirmed, false);
    assert.equal(r.backupPath, `${file}.bak-claude-md-20260102-030405`);
    assert.deepEqual(fs.readdirSync(dir), before);
    assert.equal(fs.readFileSync(file, 'utf8'), LEGACY);
  });
});

// 까닭: 설치, 업데이트, 회고가 같은 판정을 쓰게 한 함수다(19회차 막음 1, 2와 비용 1). 셋이 따로 세면 같은 상태에서 판정이 갈린다.
describe('claudeMdVerdict 설치, 업데이트, 회고가 함께 쓰는 정리 판정', () => {
  const configAt = (dir, obj) => write(dir, 'subagent-system/config.json', JSON.stringify(obj));
  const base = () => {
    const dir = tmpDir();
    write(dir, 'CLAUDE.md', nLines(54));
    write(dir, 'rules/kit-a.md', nLines(29));
    return dir;
  };

  it('기준과 마다함을 안 주면 설정 폴더의 config.json에서 읽고, 파일이 없거나 깨졌으면 기본 80줄에 마다함 없음이다', () => {
    const dir = base();
    assert.deepEqual([claudeMdVerdict({ configDir: dir }).limit, claudeMdVerdict({ configDir: dir }).target], [80, true]);
    configAt(dir, { claudeMdLimitLines: 120 });
    const r = claudeMdVerdict({ configDir: dir });
    assert.deepEqual([r.limit, r.total, r.over, r.target, r.reason], [120, 83, false, false, '120줄 이하']);
    write(dir, 'subagent-system/config.json', '{');
    assert.deepEqual([claudeMdVerdict({ configDir: dir }).limit, claudeMdVerdict({ configDir: dir }).target], [80, true]);
  });

  it('claudeMdKeptLines에서 여유 20줄 이내면 합이 기준을 넘어도 묻지 않고, 넘게 늘면 다시 묻는다', () => {
    const dir = base();
    configAt(dir, { claudeMdKeptLines: 83 });
    assert.deepEqual([claudeMdVerdict({ configDir: dir }).target, claudeMdVerdict({ configDir: dir }).reason], [false, `정리 뒤 남긴 83줄에서 ${KEPT_MARGIN_LINES}줄 이내`]);
    configAt(dir, { claudeMdKeptLines: 62 });
    assert.equal(claudeMdVerdict({ configDir: dir }).target, true);
  });

  it('analyzeClaudeMd는 --limit를 안 주면 config.json을 읽고 주면 그 값이 이긴다', () => {
    const dir = base();
    configAt(dir, { claudeMdLimitLines: 120 });
    assert.deepEqual([analyzeClaudeMd({ configDir: dir }).loaded.limit, analyzeClaudeMd({ configDir: dir }).loaded.target], [120, false]);
    assert.deepEqual([analyzeClaudeMd({ configDir: dir, limit: 82 }).loaded.limit, analyzeClaudeMd({ configDir: dir, limit: 82 }).loaded.target], [82, true]);
  });

  it('명령줄 --limit가 없으면 config.json의 기준을 쓴다', () => {
    const dir = base();
    configAt(dir, { claudeMdLimitLines: 120 });
    const run = (...extra) => JSON.parse(spawnSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'claudeMdTidy.js'), '--config-dir', dir, ...extra], { encoding: 'utf8' }).stdout).loaded;
    assert.deepEqual([run().limit, run().over], [120, false]);
    assert.deepEqual([run('--limit', '82').limit, run('--limit', '82').over], [82, true]);
  });

  it('값이 정수가 아니거나 범위 밖이면 없는 것으로 보고, 규칙은 경계에서 갈린다', () => {
    assert.deepEqual(claudeMdSettingsOf({ claudeMdLimitLines: 0, claudeMdKeptLines: -1 }), { limit: 80, keptLines: null });
    assert.deepEqual(claudeMdSettingsOf({ claudeMdLimitLines: 90.5, claudeMdKeptLines: 0 }), { limit: 80, keptLines: 0 });
    assert.equal(claudeMdTarget(80, 80, null).target, false);
    assert.equal(claudeMdTarget(81, 80, null).target, true);
    assert.equal(claudeMdTarget(100, 80, 80).target, false);
    assert.equal(claudeMdTarget(101, 80, 80).target, true);
  });
});
