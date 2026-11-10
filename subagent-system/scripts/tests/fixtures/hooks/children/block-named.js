// 막는 훅 흉내: 판정 이름을 붙여 알리고 막는 출력을 낸다. 첫 인자는 감싸개 경로, 둘째는 출력 종류(stop, deny).
import { createRequire } from 'node:module';
const { named, reportBlocks } = createRequire(import.meta.url)(process.argv[2]);
const kind = process.argv[3];
const out = kind === 'stop'
  ? named({ decision: 'block', reason: '이어 하기: 남은 일' }, ['멈춤 검사 이어 하기', '멈춤 검사 열린 칸 대조'])
  : named({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: '논의 중: 고치지 마라' } }, ['논의 중\tEdit:/a/b.md']);
reportBlocks(out);
process.stdout.write(JSON.stringify(out));
