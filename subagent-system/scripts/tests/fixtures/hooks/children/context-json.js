// 대화에 문구를 넣는 훅 흉내: additionalContext 5글자와 permissionDecisionReason 3글자.
process.stdout.write(JSON.stringify({ hookSpecificOutput: { additionalContext: '가나다라마', permissionDecisionReason: 'abc' } }));
