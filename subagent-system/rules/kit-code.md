---
paths:
  - "**/*.{js,jsx,ts,tsx,mjs,cjs,py,rb,go,rs,java,kt,swift,php,cs,sh}"
---
# 키트 원칙: 코드 파일

코드 파일을 다룰 때만 불려 오는 원칙이다. 사용자 CLAUDE.md와 프로젝트 규칙이 먼저다.

- 토큰, 비밀번호 같은 민감한 정보는 로그에 남기지 않는다. 까닭: 로그를 거쳐 밖으로 새는 것을 막는다.
