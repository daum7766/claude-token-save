'use strict';

/**
 * 키트 고정 파일 검사(base 묶음의 git 조각). 설치본 저장소의 커밋에서 키트가 놓은 파일이 원본과 다르면 막는다. 실제 검사는 `kit-setup.js check-staged`가 한다.
 * 왜: 설치본에서 키트가 놓은 고정 파일을 원본과 다르게 고쳐 커밋하면 원본과 설치본이 벌어져 공통 개선이 키트로 올라가지 않았다.
 * 전제:
 *  - config에 kitSourcePath가 있을 때만 돈다(없으면 검사하지 않음). 설치본 저장소가 아닌 저장소의 커밋은 check-staged가 건너뛴다.
 *  - 한 번 건너뛰려면 KIT_DRIFT_SKIP=1을 붙여 커밋한다(check-staged가 읽음). commitCheck와 상관없이 돈다.
 *  - check-staged는 별도 프로세스로 부른다(ESM이고 크기가 커서 같은 프로세스에 싣지 않음). 종료 코드가 0이 아니면 그 표준 에러를 막는 말로 돌려준다.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function run(ctx) {
  const source = ctx.config.kitSourcePath;
  if (typeof source !== 'string' || source.trim() === '') return null;
  const setup = path.join(ctx.configDir, 'subagent-system', 'scripts', 'kit-setup.js');
  if (!fs.existsSync(setup)) return null;
  const r = spawnSync(process.execPath, [setup, 'check-staged'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], cwd: ctx.repoTop || undefined });
  if (r.error) throw r.error;
  if (r.status !== 0) return (r.stderr || '').trim() || `kit-setup.js check-staged가 종료 코드 ${r.status}로 끝났습니다`;
  if (r.stderr) process.stderr.write(r.stderr);
  return null;
}

module.exports = { name: 'kit-drift', run };
