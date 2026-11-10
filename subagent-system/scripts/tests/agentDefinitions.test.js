import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 실무자 정의 열 개가 모두 휴지통 지우기 길(trash.js)을 안내한다. 안내가 없으면 실무자가 rm을 쓰다 막힌다(휴지통 막음 14번 가운데 12번이 실무자 몫).
// 키트 원본은 subagent-system/agents, 설치본은 설정 폴더의 agents(subagent-system과 나란히)에 놓인다. 둘 다 없으면(라우팅 묶음을 안 고른 설치) 건너뛴다.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const AGENTS = [path.resolve(HERE, '..', '..', 'agents'), path.resolve(HERE, '..', '..', '..', 'agents')].find((d) => fs.existsSync(d));

test('실무자 정의 모두에 trash.js 안내 한 줄이 있다', { skip: !AGENTS }, () => {
  const files = fs.readdirSync(AGENTS).filter((f) => f.endsWith('.md'));
  assert.equal(files.length, 10);
  for (const f of files) {
    const lines = fs.readFileSync(path.join(AGENTS, f), 'utf8').split('\n').filter((l) => l.includes('scripts/trash.js'));
    // 설치가 ~/.claude를 설치 경로로 바꾸므로 앞 경로는 가리지 않는다.
    assert.equal(lines.length, 1, f);
    assert.match(lines[0], /^- 휴지통 스크립트가 있으면 파일과 폴더 지우기는 `node \S*\/subagent-system\/scripts\/trash\.js <절대경로>`/);
  }
});
