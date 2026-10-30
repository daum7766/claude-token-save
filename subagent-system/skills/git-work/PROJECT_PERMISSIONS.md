# 프로젝트마다 git 확인 걸기

목표: 커밋, 머지, rebase, push가 필요한 프로젝트에서만 사용자 확인을 거쳐, 되돌릴 수 없는 git 변경이 허락 없이 나가지 않게 한다.

커밋, 머지, rebase, push를 막을지는 전역이 아니라 프로젝트마다 정한다. 자동 배포가 걸린 저장소는 막고 개인 실험 저장소는 풀어도 되기 때문이다. 막기는 문서 문장이 아니라 설정으로 한다. 문장은 에이전트가 놓칠 수 있고 설정은 도구가 막는다.

- 권한은 어디에 적었든 deny, ask, allow 순으로 이긴다. 전역 `permissions.ask`에 commit이 남아 있으면 프로젝트 allow가 이기지 못하므로 막지 않을 때는 전역에서 뺀다.
- 프로젝트의 ask는 확인을 건너뛰는 모드(bypass)에서도 묻는다. deny는 아예 막는다.
- 설정은 세션의 작업 폴더 `.claude/`에서만 읽고 부모 폴더로 올라가지 않는다. 그래서 막는 규칙은 커밋되지 않는 `settings.local.json`이 아니라 기본 브랜치에 커밋된 `.claude/settings.json`에 둬야 세션 워크트리에도 들어간다.
- 설정이 없는 새 저장소는 확인이 없다. 프로젝트를 시작할 때 한 번 설정한다.

프로젝트 `.claude/settings.json` 예:

```json
{
  "permissions": {
    "ask": [
      "Bash(git commit:*)", "Bash(git * commit *)",
      "Bash(git merge:*)", "Bash(git * merge *)",
      "Bash(git rebase:*)", "Bash(git * rebase *)",
      "Bash(git push:*)", "Bash(git * push *)"
    ]
  }
}
```

견본은 키트 `extras/git-permissions.json`에 둘이다.
- `permissions.ask`는 회사용이다. 모든 git 변경 명령을 묻는다.
- `personal.permissions.ask`는 개인용이다. commit, merge, rebase, push 확인만 뺐다. 전역 `~/.claude/settings.json`에 이것을 쓰고, 막을 프로젝트에만 위 예처럼 건다.
- reset, restore, checkout, switch, clean, rm, stash 계열, `branch -D`는 개인용에서도 묻는다. `SKILL.md`의 위험 명령 표처럼 사고가 나면 복구할 수 없기 때문이다.
- Windows는 PowerShell 도구가 따로 있어 `PowerShell(...)` 항목도 같이 넣는다. 견본에 짝이 들어 있다.
