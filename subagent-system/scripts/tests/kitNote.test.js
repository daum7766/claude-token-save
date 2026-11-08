// 설치본 커밋 메시지의 「키트 <번호> 같은 고침」 꼬리와 고정 파일 검사 건너뛰기(KIT_DRIFT_SKIP)를 시험한다.
// 판정 함수는 직접 부르고, 훅 동작은 임시 설정 폴더 저장소의 진짜 git 커밋으로 본다. HOME과 설정 폴더는 임시로 준다.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { hasFile } from './fixtures/installedLayout.js';

const require = createRequire(import.meta.url);
const SUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PIECE = path.join(SUB, 'hooks', 'git', 'commit-msg.d', '10-kit-note.cjs');
const HAS_GIT = spawnSync('git', ['--version']).status === 0;
const SKIP = !HAS_GIT ? 'git이 없음' : process.platform === 'win32' ? 'sh 훅은 Windows에서 Git Bash가 돌려 여기서는 건너뜀' : !hasFile('subagent-system/hooks/git/commit-msg.d/10-kit-note.cjs') ? '설치본에 키트 고침 자리 검사 조각이 없음' : false;

const BODY = '제목\n\n왜: 까닭\n전제: 사실\n';
const HASH = 'abc1234';

describe('키트 고침 자리 판정', { skip: SKIP }, () => {
  const { checkKitNote } = require(PIECE);

  it('꼬리의 키트 번호가 빈 메시지는 막는다', () => {
    const msg = checkKitNote(`${BODY}(키트  같은 고침)\n`);
    assert.match(msg, /비어 있습니다/);
  });

  it('꼬리에 키트 커밋 해시가 있으면 통과한다', () => {
    assert.equal(checkKitNote(`${BODY}(키트 ${HASH} 같은 고침)\n`, { resolves: () => true }), null);
  });

  it('꼬리에 판 번호가 있으면 통과한다', () => {
    assert.equal(checkKitNote(`${BODY}(키트 2026.11.8.11 같은 고침)\n`), null);
  });

  it('꼬리의 번호가 해시나 판 번호 꼴이 아니면 막는다', () => {
    assert.match(checkKitNote(`${BODY}(키트 곧 같은 고침)\n`), /꼴이 아닙니다/);
  });

  it('원본 저장소에 없는 해시는 막고 있는 해시는 통과한다', () => {
    assert.match(checkKitNote(`${BODY}(키트 ${HASH} 같은 고침)\n`, { resolves: () => false }), /커밋이 없습니다/);
    assert.equal(checkKitNote(`${BODY}(키트 ${HASH} 같은 고침)\n`, { resolves: () => true }), null);
  });

  it('키트 꼬리가 없는 메시지는 건너뛰기를 쓰지 않았으면 통과한다', () => {
    assert.equal(checkKitNote(BODY), null);
    assert.equal(checkKitNote('키트 2026.11.8.11을 내린다\n\n왜: 까닭\n전제: 사실\n'), null);
  });

  it('고정 파일 검사를 건너뛴 커밋이 키트 쪽 자리를 안 적으면 막는다', () => {
    assert.match(checkKitNote(BODY, { skip: true }), /KIT_DRIFT_SKIP/);
  });

  it('고정 파일 검사를 건너뛴 커밋도 키트 쪽 자리를 적으면 통과한다', () => {
    assert.equal(checkKitNote(`${BODY}키트 ${HASH}에 올림\n`, { skip: true }), null);
    assert.equal(checkKitNote(`${BODY}키트 2026.11.8.11에 올림\n`, { skip: true }), null);
  });

  it('merge와 fixup 커밋과 빈 메시지는 건너뛰기를 써도 통과한다', () => {
    assert.equal(checkKitNote('Merge branch x\n', { skip: true }), null);
    assert.equal(checkKitNote('fixup! 제목\n', { skip: true }), null);
    assert.equal(checkKitNote('', { skip: true }), null);
  });
});

// 임시 설정 폴더 저장소. kit는 키트 원본 대신 쓰는 임시 저장소로, 커밋 하나를 가진다.
function rig({ withKit = true } = {}) {
  const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') && k !== 'CLAUDE_CONFIG_DIR' && k !== 'KIT_DRIFT_SKIP'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-note-home-'));
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-note-cfg-'));
  const kit = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-note-src-'));
  const g = (cwd, ...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', env: { ...gitEnv, HOME: home } });
  const hooks = path.join(cfg, 'subagent-system', 'hooks', 'git');
  fs.cpSync(path.join(SUB, 'hooks', 'git'), hooks, { recursive: true });
  fs.rmSync(path.join(hooks, 'pre-commit.d'), { recursive: true, force: true });
  for (const d of fs.readdirSync(path.join(hooks, 'commit-msg.d'))) if (d !== '10-kit-note.cjs') fs.rmSync(path.join(hooks, 'commit-msg.d', d));
  fs.mkdirSync(path.join(cfg, 'subagent-system', 'scripts'), { recursive: true });
  for (const f of ['userSettings.cjs', 'kitInstalled.cjs']) fs.copyFileSync(path.join(SUB, 'scripts', f), path.join(cfg, 'subagent-system', 'scripts', f));
  fs.writeFileSync(path.join(cfg, 'subagent-system', 'config.json'), JSON.stringify({ profile: 'personal', ...(withKit ? { kitSourcePath: kit } : {}) }));
  g(kit, 'init', '-q');
  fs.writeFileSync(path.join(kit, 'a.txt'), 'a');
  g(kit, 'add', '-A');
  g(kit, 'commit', '-q', '-m', 'k');
  const kitHash = g(kit, 'rev-parse', '--short', 'HEAD').stdout.trim();
  g(cfg, 'init', '-q');
  g(cfg, 'config', 'core.hooksPath', hooks);
  let n = 0;
  const commit = (msg, env = {}) => {
    fs.writeFileSync(path.join(cfg, 'f.txt'), String(++n));
    g(cfg, 'add', 'f.txt');
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', msg], { cwd: cfg, encoding: 'utf8', env: { ...gitEnv, HOME: home, ...env } });
    return r;
  };
  return { commit, kitHash, cfg };
}

describe('키트 고침 자리 검사 훅', { skip: SKIP }, () => {
  it('설치본 저장소에서 꼬리의 키트 번호가 빈 커밋은 막힌다', () => {
    const r = rig();
    const res = r.commit(`${BODY}(키트  같은 고침)`);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /비어 있습니다/);
  });

  it('원본에 있는 커밋 해시를 적은 커밋은 통과한다', () => {
    const r = rig();
    const res = r.commit(`${BODY}(키트 ${r.kitHash} 같은 고침)`);
    assert.equal(res.status, 0, res.stderr);
  });

  it('원본에 없는 해시를 적은 커밋은 막힌다', () => {
    const r = rig();
    assert.notEqual(r.commit(`${BODY}(키트 deadbee 같은 고침)`).status, 0);
  });

  it('건너뛰기를 쓰고 키트 쪽 자리를 안 적은 커밋은 막힌다', () => {
    const r = rig();
    const res = r.commit(BODY, { KIT_DRIFT_SKIP: '1' });
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /KIT_DRIFT_SKIP/);
  });

  it('건너뛰기를 안 쓴 평범한 커밋은 통과한다', () => {
    const r = rig();
    assert.equal(r.commit(BODY).status, 0);
  });

  it('원본 표시(kitSourcePath)가 없는 설치는 빈 번호 꼬리도 보지 않는다', () => {
    const r = rig({ withKit: false });
    assert.equal(r.commit(`${BODY}(키트  같은 고침)`).status, 0);
  });
});
