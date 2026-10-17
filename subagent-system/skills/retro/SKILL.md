---
name: retro
description: 서브에이전트 회고의 방식(묻기 또는 자동)을 보고 바꾸거나 지금 회고한다. 인자가 없으면 상태, auto와 ask는 방식 변경, now는 지금 회고.
argument-hint: "[auto|ask|now]"
disable-model-invocation: true
allowed-tools: Bash(node "$HOME/.claude/subagent-system/scripts/subagent-retro.js" *)
---

서브에이전트 회고 커맨드다. 아래는 인자와 상관없이 지금 상태를 미리 실행한 결과다.

!`node "$HOME/.claude/subagent-system/scripts/subagent-retro.js" --status`

사용자가 입력한 인자는 아래 `인자:` 뒤의 글자 전체다. 비어 있으면 인자가 없는 것이다. 인자는 셸 명령에 넣지 않는다.

인자: $ARGUMENTS

## 할 일

- 위 결과에 「회고 방식:」 줄이 없거나 `[shell command execution disabled by policy]`가 있으면 미리 실행이 막힌 것이다(`disableSkillShellExecution`이 켜진 환경). 같은 명령을 Bash로 직접 실행해 상태를 얻는다: `node "$HOME/.claude/subagent-system/scripts/subagent-retro.js" --status`.
- 인자의 앞뒤 공백을 뗀 값이 무엇인지 본다.
  - 비어 있으면 상태 결과를 그대로 보여 준다.
  - `auto`, `ask`, `now` 가운데 하나와 글자 하나까지 같을 때만 Bash로 실행한다: `node "$HOME/.claude/subagent-system/scripts/subagent-retro.js" --slash <값>`. `<값>`에는 그 세 단어 중 하나만 넣는다.
  - 그 밖의 값(대소문자가 다르거나 다른 말이 섞인 것)은 명령을 실행하지 않고 사용법을 보여 준다. `/retro` 상태 보기, `/retro auto` 자동으로, `/retro ask` 묻기로, `/retro now` 지금 회고.
- 결과를 사용자에게 그대로 보여 준다. 줄마다 풀어 쓰지 않고, 사용자가 놓치기 쉬운 것(올림이 쌓인 칸, 「기간 기준」 줄의 묻는 날짜, 물을 것 건수, 진행 중인 잠금, 자동 회고 연속 실패 횟수)만 한 줄로 덧붙인다.
- `auto`로 바꾼 결과이고 `~/.claude/CLAUDE.md`에 저장소 밖 변경을 묻는 규칙이 있는데 `<!-- subagent-system 시작 -->`과 `<!-- subagent-system 끝 -->` 사이에 「저장소 밖의 변경을 묻는 규칙이 있어도」로 시작하는 줄이 없으면, 아래 줄을 그대로 보여 주고 그 구역 맨 끝에 넣을지 묻는다. 거절하면 넣지 않고, 구역이 없으면 묻지 않는다.

  ```
  - 저장소 밖의 변경을 묻는 규칙이 있어도, 자동 회고가 켜져 있으면 회고 서브에이전트가 `~/.claude/subagent-system/docs/SUBAGENT_GUIDE.md`의 사용자 표 구역, `~/.claude/agents/`의 정의 description, 기록 폴더를 고치는 것과, 올린 칸에 정의가 없을 때 새 정의를 만들고 `~/.claude/subagent-system/config.json`의 `removedDefs`에서 그 이름을 빼는 것, 고치기 전에 `~/.claude/subagent-system-backup-retro-<날짜-시각>/` 폴더를 만드는 것은 묻지 않는다. 그 밖의 파일은 이 예외에 들지 않는다.
  ```
- `now`의 결과에 `요청: 지금 회고(now)` 줄이 있을 때만 지금 회고를 한다. 줄의 회고 방식을 따른다. 「사용 기록이 없어 회고하지 않습니다」가 있으면 그 말만 알리고 끝낸다.
  - `auto`: `node "$HOME/.claude/subagent-system/scripts/subagent-retro.js" --claim`을 돌린다. `ok`이면 `~/.claude/subagent-system/docs/RETRO.md`의 「자동 회고」 절을 따라 회고 서브에이전트를 백그라운드로 띄우고, 띄웠다고만 알린다. `busy`이면 다른 회고가 진행 중이라 새로 띄우지 않았다고 알린다.
  - `ask`: 사용자가 지금 회고를 요청한 것이라 다시 묻지 않고 `~/.claude/subagent-system/docs/RETRO.md`의 회고 절차를 시작한다.
- 그 밖의 경우에는 회고를 시작하지 않는다.
