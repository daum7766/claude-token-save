#!/bin/sh
# git 훅 이어 부르기의 몸통. 이 폴더의 훅 파일(commit-msg, pre-push 등)이 `sh chain.sh <훅> <git이 준 인자…>`로 부른다.
# 이 폴더에 들어오는 길은 둘이고, 환경 변수 GIT_CONFIG_KEY_0, GIT_CONFIG_VALUE_0이 core.hooksPath를 이 폴더로 돌렸는지로 가른다.
#  - 옛 방식(저장소 설정, git -c 등 env 밖의 길): 사용자가 그 저장소에 건 것이다. 키트 검사 조각(<훅>.d)을 부르고 저장소의 .githooks/<훅>을 이어 부른다(commit-msg, pre-commit만).
#    env로 들어왔어도 저장소 설정의 core.hooksPath가 이 폴더이면 옛 방식으로 돈다.
#  - env 방식: 설정 폴더 settings.json의 env(GIT_CONFIG_*)가 이 설정 폴더로 뜬 Claude Code 세션의 git에만 건다.
#    허용 목록(설정 폴더 subagent-system/git-hook-repos.txt, 저장소 최상위 절대경로 한 줄에 하나)에 든 저장소에서만 키트 검사와 .githooks를 부르고,
#    이어서 저장소 원래 훅(설정 파일의 core.hooksPath, 없으면 .git/hooks)을 부른다.
# 왜: 저장소 설정에 건 core.hooksPath는 그 저장소의 모든 커밋(다른 프로필, 터미널)에 걸리고 .git/hooks와 원래 core.hooksPath를 끈다. env 방식은 걸린 세션에만 닿고 원래 훅을 끄지 않는다.
# 전제:
#  - node가 없으면 키트 검사만 건너뛰고(표준 에러 한 줄) 나머지 훅은 돈다. 조각을 못 불러오거나 던지면 커밋을 막는다(git-dispatch.cjs).
#  - sh 내장 명령과 git, dirname만 쓴다. PATH가 좁은 GUI git 도구에서도 돌게 하려는 것이다.
#  - 원래 훅 폴더가 .githooks이고 이미 .githooks를 불렀으면 두 번 부르지 않는다. 원래 훅은 마지막에 exec로 불러 표준 입력(pre-push 등)을 그대로 넘긴다.
hook=$1
shift
dir=$(cd "$(dirname "$0")" && pwd)
top=$(git rev-parse --show-toplevel 2>/dev/null) || top=

absdir() { (cd "$1" 2>/dev/null && pwd); }
# core.hooksPath 값을 폴더 절대경로로 바꾼다. 상대 경로는 저장소 최상위 기준이다(git이 훅을 거기서 돌린다).
resolve() {
  case "$1" in
    /*) absdir "$1" ;;
    "~"/*) absdir "$HOME/${1#\~/}" ;;
    *) absdir "$top/$1" ;;
  esac
}

legacy=1
if [ "${GIT_CONFIG_KEY_0:-}" = core.hooksPath ] && [ -n "${GIT_CONFIG_VALUE_0:-}" ] && [ "$(resolve "$GIT_CONFIG_VALUE_0")" = "$dir" ]; then
  legacy=0
  # 저장소 설정으로도 이 폴더를 건 저장소는 그 사용자의 고름을 따라 옛 방식으로 돈다.
  own=$(git config --local --get core.hooksPath 2>/dev/null) || own=
  [ -n "$own" ] && [ "$(resolve "$own")" = "$dir" ] && legacy=1
fi

allowed=$legacy
if [ "$legacy" = 0 ] && [ -n "$top" ]; then
  # worktree는 본 저장소(공용 .git의 부모) 경로로도 맞춘다.
  common=$(absdir "$(git rev-parse --git-common-dir 2>/dev/null)")
  main=
  case "$common" in */.git) main=${common%/.git} ;; esac
  list="$dir/../../git-hook-repos.txt"
  if [ -f "$list" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      case "$line" in "" | "#"*) continue ;; esac
      if [ "$line" = "$top" ] || { [ -n "$main" ] && [ "$line" = "$main" ]; }; then
        allowed=1
        break
      fi
    done < "$list"
  fi
fi

if [ "$allowed" = 1 ] && [ -d "$dir/$hook.d" ]; then
  if command -v node >/dev/null 2>&1; then
    node "$dir/git-dispatch.cjs" "$hook" "$@" || exit 1
  else
    echo "kit git 훅: node가 없어 키트 검사를 건너뜁니다" >&2
  fi
fi

githooks=0
case "$hook" in
  commit-msg | pre-commit)
    if [ "$allowed" = 1 ] && [ -n "$top" ] && [ -x "$top/.githooks/$hook" ]; then
      [ "$legacy" = 1 ] && exec "$top/.githooks/$hook" "$@"
      "$top/.githooks/$hook" "$@" || exit $?
      githooks=1
    fi
    ;;
esac
[ "$legacy" = 1 ] && exit 0

# env 방식: 저장소 원래 훅. 저장소 설정, 전역 설정, 시스템 설정 차례로 core.hooksPath를 찾고 없으면 .git/hooks다.
orig=
for scope in --local --global --system; do
  v=$(git config "$scope" --get core.hooksPath 2>/dev/null) || v=
  if [ -n "$v" ]; then
    orig=$(resolve "$v")
    break
  fi
done
if [ -z "$v" ]; then
  orig=$(absdir "$(git rev-parse --git-common-dir 2>/dev/null)")
  [ -n "$orig" ] && orig="$orig/hooks"
fi
[ -z "$orig" ] && exit 0
[ "$orig" = "$dir" ] && exit 0
[ "$githooks" = 1 ] && [ "$orig" = "$(absdir "$top/.githooks")" ] && exit 0
[ -x "$orig/$hook" ] && exec "$orig/$hook" "$@"
exit 0
