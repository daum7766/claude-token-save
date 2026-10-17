#!/bin/bash
# 설치는 같은 폴더의 install-agent-meter.mjs가 한다
set -euo pipefail
# 심볼릭 링크로 불러도 실제 파일이 있는 폴더를 찾도록 링크를 끝까지 따라간다
SRC="$0"
while [ -L "$SRC" ]; do
  DIR="$(cd "$(dirname "$SRC")" && pwd)"
  SRC="$(readlink "$SRC")"
  case "$SRC" in /*) ;; *) SRC="$DIR/$SRC" ;; esac
done
HERE="$(cd "$(dirname "$SRC")" && pwd)"
if ! command -v node >/dev/null; then
  echo "node 18 이상이 필요합니다. https://nodejs.org 에서 설치한 뒤 다시 실행하세요." >&2
  exit 1
fi
exec node "$HERE/install-agent-meter.mjs" "$@"
