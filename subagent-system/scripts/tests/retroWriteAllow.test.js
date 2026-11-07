// 회고 쓰기 허용 훅의 보호 목록을 시험한다(설치 바닥 설계 U4-12).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const SUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { shouldAllow, PROTECTED_FILES } = createRequire(import.meta.url)(path.join(SUB, 'hooks', 'retro-write-allow.js'));

function setup() {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'rwa-'));
  fs.mkdirSync(path.join(cfg, 'subagent-system', 'records'), { recursive: true });
  fs.writeFileSync(path.join(cfg, 'subagent-system', 'config.json'), JSON.stringify({ profile: 'personal', retroWriteAllow: true }));
  fs.writeFileSync(path.join(cfg, 'subagent-system', 'records', 'retro.lock'), '{}');
  return cfg;
}
const write = (cfg, rel) => ({ agent_id: 'a', tool_name: 'Write', tool_input: { file_path: path.join(cfg, ...rel.split('/')) } });

describe('retro-write-allow 보호 목록', () => {
  it('U4-12 사용자 설정 문서, 깐 상태 기록, 보관한 설치 값은 회고 잠금이 있어도 허용하지 않는다', () => {
    const cfg = setup();
    const env = { CLAUDE_CONFIG_DIR: cfg };
    assert.equal(shouldAllow(write(cfg, 'docs/x.md'), env), true, '기존 판정: 문서 자리는 허용');
    assert.equal(shouldAllow(write(cfg, 'rules/kit-x.md'), env), true, '기존 판정: 규칙 자리는 허용');
    for (const rel of ['USER_SETTINGS.md', 'subagent-system/bundles.lock.json', 'subagent-system/kept-values.json']) {
      assert.equal(shouldAllow(write(cfg, rel), env), false, rel);
    }
    assert.equal(shouldAllow(write(cfg, 'CLAUDE.md'), env), false, '기존 판정: CLAUDE.md는 보호');
    assert.equal(shouldAllow(write(cfg, 'subagent-system/config.json'), env), false, '기존 판정: config.json은 보호');
  });

  it('U4-12 허용 자리가 넓어져도 막히도록 보호 목록에 이름이 올라 있다', () => {
    for (const f of ['user_settings.md', 'subagent-system/bundles.lock.json', 'subagent-system/kept-values.json']) assert.ok(PROTECTED_FILES.includes(f), f);
  });
});
