// 사용자 설정 모듈(userSettings.cjs)을 시험한다. 시험 이름의 U4-n은 설치 바닥 설계 9.4의 번호다.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { askFirstOf, profileOf } from '../kitProfile.js';
import { NOT_KIT_SOURCE, missingFiles } from './fixtures/installedLayout.js';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULE = path.join(HERE, '..', 'userSettings.cjs');
const KIT = path.resolve(HERE, '..', '..', '..');
const us = require(MODULE);

const SETTINGS = (values, extra = '') => `# 사용자 설정\n\n## 값\n${values}\n${extra}`;

// 설정 폴더 하나. settings는 USER_SETTINGS.md 글, claudeMd는 CLAUDE.md 글, config는 config.json 객체(없으면 파일 없음).
function cfgWith({ settings, claudeMd, config } = {}) {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'usersettings-'));
  if (settings !== undefined) fs.writeFileSync(path.join(cfg, 'USER_SETTINGS.md'), settings);
  if (claudeMd !== undefined) fs.writeFileSync(path.join(cfg, 'CLAUDE.md'), claudeMd);
  if (config !== undefined) {
    fs.mkdirSync(path.join(cfg, 'subagent-system'), { recursive: true });
    fs.writeFileSync(path.join(cfg, 'subagent-system', 'config.json'), JSON.stringify(config));
  }
  return cfg;
}

describe('readUserSettings', () => {
  it('U4-1 설정 문서의 호칭이 CLAUDE.md의 호칭보다 먼저다', () => {
    const r = us.readUserSettings(cfgWith({ settings: SETTINGS('- 호칭: 팀장님'), claudeMd: '- 호칭: 대표님\n' }));
    assert.equal(r.values.callName, '팀장');
    assert.equal(r.sources.callName, 'settings');
    assert.deepEqual(r.problems, []);
  });

  it('U4-2 설정 문서가 없으면 CLAUDE.md의 같은 꼴 줄을 읽는다', () => {
    const r = us.readUserSettings(cfgWith({ claudeMd: '# 정책\n- 호칭: 대표님\n' }));
    assert.equal(r.values.callName, '대표');
    assert.equal(r.sources.callName, 'claude-md');
  });

  it('U4-3 둘 다 없으면 config의 첫 결정어', () => {
    const r = us.readUserSettings(cfgWith({ config: { decisionWords: ['대표', '사용자'] } }));
    assert.equal(r.values.callName, '대표');
    assert.equal(r.sources.callName, 'config');
  });

  it('U4-4 아무것도 없으면 기본값', () => {
    const r = us.readUserSettings(cfgWith());
    assert.deepEqual(r.values, { callName: '사용자', choiceForm: '질문 창', lang: 'ko', profileLine: '회사용' });
    assert.deepEqual(r.sources, { callName: 'default', choiceForm: 'default', lang: 'default', profileLine: 'default', raiseKinds: 'default' });
  });

  it('U4-5 쌍점 없는 값 줄은 기본값으로 읽고 problems에 한 줄', () => {
    const r = us.readUserSettings(cfgWith({ settings: SETTINGS('- 호칭') }));
    assert.equal(r.values.callName, '사용자');
    assert.equal(r.sources.callName, 'default');
    assert.equal(r.problems.length, 1);
    assert.match(r.problems[0], /쌍점/);
  });

  it('값 읽기: 선택지 받는 꼴, 언어, 사용 방식은 설정 문서에서, 잘못된 값은 기본값과 problems', () => {
    const ok = us.readUserSettings(cfgWith({ settings: SETTINGS('- 선택지 받는 꼴: 본문\n- 답할 언어: en\n- 사용 방식: 개인용 <!-- kit-setup이 씀 -->'), config: { profile: 'company' } }));
    assert.deepEqual(ok.values, { callName: '사용자', choiceForm: '본문', lang: 'en', profileLine: '개인용' });
    assert.equal(ok.sources.profileLine, 'settings');

    const fromConfig = us.readUserSettings(cfgWith({ config: { profile: 'personal' } }));
    assert.equal(fromConfig.values.profileLine, '개인용');
    assert.equal(fromConfig.sources.profileLine, 'config');

    const bad = us.readUserSettings(cfgWith({ settings: SETTINGS('- 선택지 받는 꼴: 팝업\n- 답할 언어: 한국어') }));
    assert.equal(bad.values.choiceForm, '질문 창');
    assert.equal(bad.values.lang, 'ko');
    assert.equal(bad.problems.length, 2);
  });

  it('주석만 있는 빈 값은 설정하지 않은 것으로 읽는다(견본 그대로)', { skip: NOT_KIT_SOURCE }, () => {
    const template = fs.readFileSync(path.join(KIT, 'bundles', 'base', 'user-settings.template.md'), 'utf8');
    const r = us.readUserSettings(cfgWith({ settings: template, config: { profile: 'personal' } }));
    assert.deepEqual(r.problems, []);
    assert.equal(r.sources.callName, 'default');
    assert.equal(r.values.choiceForm, '질문 창');
    assert.equal(r.values.lang, 'ko');
    assert.equal(r.values.profileLine, '개인용');
    assert.equal(r.sources.profileLine, 'config');
    assert.deepEqual(r.raiseKinds, ['돈', '되돌리기 어려운 일', '정책', '목표로 못 가르는 트레이드오프']);
    assert.equal(r.sources.raiseKinds, 'settings');
  });
});

describe('decisionWords, decidedByPattern, josa', () => {
  it('U4-6 결정어: config 값, 없으면 [호칭 낱말, 사용자], 호칭도 없으면 [사용자]', () => {
    assert.deepEqual(us.decisionWords(cfgWith({ settings: SETTINGS('- 호칭: 팀장님'), config: { decisionWords: ['대표', '사용자'] } })), ['대표', '사용자']);
    assert.deepEqual(us.decisionWords(cfgWith({ settings: SETTINGS('- 호칭: 팀장님') })), ['팀장', '사용자']);
    assert.deepEqual(us.decisionWords(cfgWith()), ['사용자']);
    assert.deepEqual(us.decisionWords(cfgWith({ settings: SETTINGS('- 호칭: 사용자님') })), ['사용자']);
  });

  it('U4-7 「<낱말>(이|가) 정한」에만 맞는다', () => {
    assert.ok(us.decidedByPattern(['팀장']).test('팀장이 정한 기능'));
    assert.ok(us.decidedByPattern(['대표']).test('대표가 정한 기능'));
    assert.ok(!us.decidedByPattern(['팀장']).test('팀장 정한 기능'));
    assert.ok(!us.decidedByPattern(['팀장']).test('대표가 정한 기능'));
    assert.ok(us.decidedByPattern(['대표', '사용자']).test('사용자가 정한 것'));
    assert.ok(!us.decidedByPattern([]).test('대표가 정한'));
    // 같은 정규식을 여러 번 써도 결과가 같다(g 플래그의 lastIndex에 기대지 않음).
    const re = us.decidedByPattern(['팀장']);
    assert.deepEqual([re.test('팀장이 정한'), re.test('팀장이 정한')], [true, true]);
    assert.ok(us.decidedByPattern(['A.B']).test('A.B가 정한') && !us.decidedByPattern(['A.B']).test('AxB가 정한'), '낱말의 특수문자는 글자로 본다');
  });

  it('U4-8 조사 이/가는 받침으로 가른다', () => {
    assert.equal(us.josa('대표', '이/가'), '가');
    assert.equal(us.josa('팀장', '이/가'), '이');
    assert.equal(us.josa('사용자', '이/가'), '가');
    assert.equal(us.josa('PM', '이/가'), '가');
    assert.equal(us.josa('팀장', '은/는'), '은');
    assert.throws(() => us.josa('팀장', '로/으로'), /조사 쌍/);
  });
});

describe('raiseKinds, ambiguityLine', () => {
  it('U4-9 올릴 것 줄머리를 읽고, 절이 없으면 기본 넷', () => {
    const three = SETTINGS('- 호칭: 팀장님', '\n## 올릴 것\n- 돈: 돈이 나가는 결정\n- 배포: 운영에 나가는 일\n- 법무：계약과 약관\n\n## 회사 틀\n- 다른 줄: 무시\n');
    assert.deepEqual(us.raiseKinds(cfgWith({ settings: three })), ['돈', '배포', '법무']);
    assert.deepEqual(us.raiseKinds(cfgWith({ settings: SETTINGS('- 호칭: 팀장님') })), ['돈', '되돌리기 어려운 일', '정책', '목표로 못 가르는 트레이드오프']);
    assert.deepEqual(us.raiseKinds(cfgWith()), us.DEFAULT_RAISE_KINDS);
    assert.deepEqual(us.raiseKinds(cfgWith({ settings: SETTINGS('- 호칭: 팀장님', '\n## 올릴 것\n(비어 있음)\n') })), us.DEFAULT_RAISE_KINDS);
  });

  it('U4-10 개인용과 회사용의 「애매할 때」 줄이 kit-setup.js settings 출력의 줄과 글자 같다', { skip: missingFiles('subagent-system/scripts/kit-setup.js') }, () => {
    for (const config of [{ profile: 'personal' }, { profile: 'company' }, {}, { profile: '모름' }]) {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'usersettings-set-'));
      fs.mkdirSync(path.join(root, 'subagent-system'));
      fs.writeFileSync(path.join(root, 'subagent-system', 'config.json'), JSON.stringify(config));
      const r = spawnSync(process.execPath, [path.join(KIT, 'subagent-system', 'scripts', 'kit-setup.js'), 'settings'], { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: root } });
      fs.rmSync(root, { recursive: true, force: true });
      assert.equal(r.status, 0, r.stderr);
      const line = r.stdout.split('\n').find((l) => l.startsWith('애매할 때:'));
      assert.equal(us.ambiguityLine(config), line, JSON.stringify(config));
      assert.equal(us.ambiguityLine(config).includes('나머지는 묻기'), askFirstOf(profileOf(config)), 'kitProfile 규칙과 같은 쪽');
    }
    assert.equal(us.ambiguityLine(null).includes('나머지는 묻기'), true);
  });
});

describe('모듈 꼴', () => {
  it('U4-13 require와 import가 같은 함수를 주고 최상위에서 기다리지 않는다', async () => {
    const ns = await import(MODULE);
    for (const name of ['readUserSettings', 'callName', 'decisionWords', 'decidedByPattern', 'josa', 'raiseKinds', 'ambiguityLine']) {
      assert.equal(typeof us[name], 'function', name);
      assert.equal(ns[name] ?? ns.default[name], us[name], name);
    }
    assert.ok(!/\bawait\b/.test(fs.readFileSync(MODULE, 'utf8')));
  });

  it('설정 문서나 config가 깨져도 던지지 않고 기본값으로 읽는다', () => {
    const cfg = cfgWith({ settings: '\u0000\u0001 깨진 글', claudeMd: '' });
    fs.mkdirSync(path.join(cfg, 'subagent-system'), { recursive: true });
    fs.writeFileSync(path.join(cfg, 'subagent-system', 'config.json'), '{ 깨진');
    const r = us.readUserSettings(cfg);
    assert.equal(r.values.callName, '사용자');
    assert.deepEqual(us.decisionWords(cfg), ['사용자']);
    assert.equal(us.readUserSettings(path.join(cfg, '없는 폴더')).values.lang, 'ko');
  });
});
