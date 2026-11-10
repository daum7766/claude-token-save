# 안전장치 설치 안내

되살릴 수 없는 일을 실행 전에 막거나 묻는 훅(정해진 때 자동으로 도는 명령) 묶음이다. 이 묶음을 고른 설치에서만 아래 절을 읽는다. `<kit-setup>`과 `묻는 방법`은 `APPLY_GUIDE.md`를 따른다.
- `rm-guard`: 재귀 삭제(`rm -r`, `rm -rf`)의 대상을 따진다. Claude 임시 폴더 안, 파일 하나, 다시 만들어지는 캐시, git에서 되살릴 수 있는 폴더는 묻지 않고, 대상을 미리 알 수 없는 꼴(모르는 변수, 명령 치환, `xargs`)과 Claude 임시 폴더가 아닌 `/tmp`는 다시 쓰는 법과 함께 거절하며, 그 밖의 실제 경로는 승인 창을 띄운다.
- `git-discard-guard`: 커밋하지 않은 변경이 있는 파일을 `git checkout`, `git restore`로 되돌리려 하면 막고, 모든 세션이 함께 쓰는 보관함을 바꾸는 `git stash`(`list`, `show` 제외)도 막는다.
- `supabase-sql-guard`(고를 항목): Supabase MCP의 SQL 실행에서 데이터를 고치거나 지우거나 구조, 권한을 바꾸는 SQL만 승인 창을 띄운다. 조회와 INSERT는 통과한다.
- 휴지통으로 지우기(설정 `deleteToTrash`): 켜면 `rm-guard`가 임시 폴더와 캐시 밖의 `rm`(파일 하나 포함)과 작업 트리에서도 지우는 `git rm`을 거절하고, 대신 `node "$HOME/.claude/subagent-system/scripts/trash.js" <대상>…`으로 운영체제의 휴지통에 옮기게 한다. git 안 파일은 옮긴 뒤 그 파일만 지정해 커밋한다. 휴지통에 못 보내면 스크립트는 지우지 않고 실패로 끝난다.
- 막거나 물을 때마다 승인 창 기록(`permission-asks.jsonl`)에 한 줄을 남긴다. 회고가 그 기록으로 쓸데없이 뜬 창을 줄인다.

## 질문

질문 목록: 고를 항목, 워크트리 안 임시 폴더 이름, 휴지통으로 지우기.

**고를 항목.** `supabase`: Supabase MCP로 운영 DB에 SQL을 실행할 때 쓰는 막음이다. (추천: Supabase MCP를 쓰거나 쓸 수 있으면 넣는다. 그 도구를 부르지 않으면 돌지 않아 드는 것이 없다) 답은 `--options safety.supabase`이고, 빼면 `--options none`이다.

**워크트리 안 임시 폴더 이름.** 워크트리(`.claude/worktrees/<이름>/`) 안에서 지워도 되는 임시 폴더 이름이 있는지 묻는다(예: `_temp`, `docs/_temp`). 고르면 그 폴더 안의 재귀 삭제는 묻지 않고, 본 폴더의 같은 이름 폴더는 여전히 묻는다. (추천: 없으면 비워 둔다. 비우면 그 폴더 삭제도 묻는다) 답이 있으면 `<kit-setup> --config-set "$HOME/.claude/subagent-system/config.json" safetyTempDirs '["_temp"]'`처럼 넣는다. 묻지 않는 쪽으로 푸는 설정이라 사용자가 답한 이름만 넣는다.

**휴지통으로 지우기.** Claude가 파일과 폴더를 지울 때 영구 삭제 대신 휴지통으로 옮기게 할지 묻는다. (추천: 켠다. 잘못 지운 것을 휴지통에서 되살릴 수 있다)
- 얻는 것: 지운 뒤 문제가 생겨도 되돌릴 수 있다. 켜지 않으면 임시 폴더 밖의 파일 하나 삭제와 `-f` 없는 `git rm`은 묻지 않고 바로 지워진다.
- 잃는 것: 휴지통이 차서 가끔 비워야 한다. Claude가 `rm`을 쓰면 한 번 거절되고 휴지통 스크립트로 다시 해 도구 호출이 하나 는다. 휴지통이 없는 자리(다른 디스크로 옮겨야 하는 경로, Windows 네트워크 경로)는 지우지 못하고 실패로 알린다.
- 켜도 Claude 임시 폴더, 위의 워크트리 안 임시 폴더, 다시 만들어지는 캐시는 지금처럼 바로 지운다(Claude 자신의 임시 산출물이라 휴지통을 채우기만 한다).
- 켜면 `<kit-setup> --config-set "$HOME/.claude/subagent-system/config.json" deleteToTrash true`이다. 키가 없거나 `true`가 아니면 꺼진 것이다.

## 설치 뒤

해야 할 일이 없다.

## 확인

`subagent-system/hooks/rm-guard.js`와 `git-discard-guard.js`가 설치본에 있고, settings의 PreToolUse(matcher `Bash`)에 `safety/rm-guard`와 `safety/git-discard-guard`가 걸려 있다. `subagent-system/scripts/trash.js`가 있다. `supabase`를 골랐으면 `supabase-sql-guard.js`가 있고 matcher `mcp__supabase__execute_sql`에 `safety/supabase-sql-guard`가 걸려 있다.

## 업데이트

고르지 않은 항목은 건드리지 않고, 키트에 새 항목이 생기면 `newOptions`로 알린다. config.json에 `deleteToTrash` 키가 없으면 「질문」의 휴지통으로 지우기를 묻는다(답이 끄기면 `false`를 넣어 다음에 다시 묻지 않는다).

이 묶음이 키트에 들기 전에 같은 이름(`safety`)의 로컬 조각으로 같은 훅을 쓰던 설치는 갈아탄다.
- 로컬 조각 정의(`subagent-system/local-bundles/safety/`)가 남아 있으면 `update`와 `add`가 「훅 … 겹칩니다」 오류로 아무것도 쓰지 않고 멈춘다. 그 폴더를 백업한 뒤 지우고, 그 조각만 쓰던 부품의 로컬 조각 정의(다른 묶음 폴더에 있을 수 있다)도 함께 치운다. 그다음 `update`가 같은 이름의 훅 등록을 키트 훅으로 갈아 끼운다.
- Supabase 막기를 쓰려면 이어서 `<kit-setup> add --bundles safety --options safety.supabase`를 한다.
- 사용자가 settings.json에 손으로 단 같은 일의 훅(이름표 `# kit:` 없는 줄, 예: matcher `mcp__supabase__execute_sql`의 옛 검사 훅)은 키트가 건드리지 않아 두 번 돈다. 그 줄을 보이고 뺄지 묻는다.
- 옛 훅 파일은 남는다. 이제 아무 훅도 부르지 않는지 보인 뒤 지울지 묻는다.

## 빼기

`<kit-setup> remove --bundles safety`가 이 묶음 파일과 훅 등록을 뺀다. 설정 키 `safetyTempDirs`, `deleteToTrash`와 승인 창 기록은 남는다.

## 개인용과 회사용 행

이 묶음은 profile에 따라 달라지는 행이 없다.
