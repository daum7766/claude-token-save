# 섞인 파일 커밋

목표: 한 파일에 이번 작업과 다른 세션의 미커밋 변경이 섞여 있어도 이번 작업의 줄만 커밋하고 남의 변경은 작업 트리에 그대로 둔다.

- 한 파일에 이번 작업과 다른 세션의 미커밋 변경이 섞여 있으면 이번 작업의 hunk만 index에 올려 커밋하고, 다른 세션의 줄은 작업 트리에 그대로 둔다.
- 한 hunk 안에 두 작업이 섞여 있으면 index 내용에 이번 작업의 줄만 직접 끼워 넣는다.
- `git add -p`는 쓰지 못하는 환경이 있고, 문맥 없는 hunk를 `git apply --cached --unidiff-zero`로 올리면 엉뚱한 줄에 붙는다.
- 대신 `git diff HEAD -U0 -- <파일>`에서 hunk를 고르고 `git show HEAD:<파일>`에 그 hunk만 뒤에서부터 적용한다.
- 만든 내용은 `git hash-object -w --stdin`과 `git update-index --cacheinfo`로 index에 넣는다.
- 어느 세션의 것인지 애매한 줄(자동 생성 파일의 통계 같은 것)은 커밋하지 않고 보고한다.
- 중간 커밋은 `git checkout-index -a --prefix=<임시 폴더>/`로 index를 꺼내 관련 테스트와 린트를 돌려, 그 시점에 깨지지 않는지 시험한다.
