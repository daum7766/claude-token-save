---
name: retro
description: 사용자가 /retro로 회고 상태를 보거나 지금 회고하자고 할 때 쓴다. 인자가 없으면 상태, now는 지금 회고, auto는 자동 회고 켜기(개인용은 실패로 묻기가 된 뒤 다시 켜기), ask는 회사용에서만 묻기로 바꾸기.
argument-hint: "[auto|ask|now]"
disable-model-invocation: true
allowed-tools: Bash(node "$HOME/.claude/subagent-system/scripts/subagent-retro.js" *) Bash(node "$HOME/.claude/subagent-system/scripts/speed-review.js" *)
---

목표: 사용자가 회고 상태를 보고 지금 회고를 시킬 수 있어, 쌓인 기록으로 체계가 스스로 나아지는 것이다.

서브에이전트 회고 커맨드다. 아래는 인자와 상관없이 지금 상태를 미리 실행한 결과다.

!`node "$HOME/.claude/subagent-system/scripts/subagent-retro.js" --status`

사용자가 입력한 인자는 아래 `인자:` 뒤의 글자 전체다. 비어 있으면 인자가 없는 것이다. 인자는 셸 명령에 넣지 않는다.

인자: $ARGUMENTS

## 할 일

- 위 결과에 「회고 방식:」 줄이 없거나 `[shell command execution disabled by policy]`가 있으면 미리 실행이 막힌 것이다(`disableSkillShellExecution`이 켜진 환경).
  - 같은 명령을 Bash로 직접 실행해 상태를 얻는다: `node "$HOME/.claude/subagent-system/scripts/subagent-retro.js" --status`.
- 인자의 앞뒤 공백을 뗀 값이 무엇인지 본다.
  - 비어 있으면 상태 결과를 그대로 보여 준다.
  - `auto`, `ask`, `now` 가운데 하나와 글자 하나까지 같을 때만 Bash로 실행한다: `node "$HOME/.claude/subagent-system/scripts/subagent-retro.js" --slash <값>`. `<값>`에는 그 세 단어 중 하나만 넣는다.
  - 그 밖의 값(대소문자가 다르거나 다른 말이 섞인 것)은 명령을 실행하지 않고 사용법을 보여 준다. `/retro` 상태 보기, `/retro auto` 자동으로, `/retro ask` 묻기로, `/retro now` 지금 회고.
- `auto`는 개인용과 회사용 모두 실행한다(실패로 묻기가 된 개인용을 다시 켜는 길도 이것이다). `ask`는 `config.json`의 `profile`이 `personal`이면 스크립트가 바꾸지 않고 `kit-setup.js set-profile company`를 알린다(`update`가 개인용을 auto로 되돌려서).
- 결과를 사용자에게 그대로 보여 준다. 줄마다 풀어 쓰지 않고, 사용자가 놓치기 쉬운 것(올림이 쌓인 칸, 「기간 기준」 줄의 묻는 날짜, 물을 것 건수, 진행 중인 잠금, 자동 회고 연속 실패 횟수)만 한 줄로 덧붙인다.
- `now`의 결과에 `요청: 지금 회고(now)` 줄이 있을 때만 지금 회고를 한다. 「사용 기록이 없어 회고하지 않습니다」가 있으면 그 말만 알리고 끝낸다.
  - 회고 방식(`auto`, `ask`)과 상관없이 길은 하나다. 사용자가 시킨 것이라 다시 묻지 않고, 메인이 회고 단계를 직접 하지 않고 회고 서브에이전트를 띄운다. `node "$HOME/.claude/subagent-system/scripts/subagent-retro.js" --claim`을 돌린다.
    - `ok`이면 `~/.claude/subagent-system/docs/AUTO_RETRO.md` 3번의 「`ok`가 나오면」 이하(`--pick`, 병목 분석 리뷰어, 회고 서브에이전트)와 4~5번을 따른다. 지시문에는 `profile`에 따른 승인 규칙(회사용은 제안으로 모음)을 넣는다. `--claim`은 다시 돌리지 않는다. 띄웠다고만 알린다.
      - 회고 서브에이전트의 답이 오면 같은 문서 7~8번(알리기와 커밋, 실패하면 `--release --failed`)도 따른다.
    - `busy`이면 다른 회고가 진행 중이라 새로 띄우지 않았다고 알린다.
- 회고를 띄운 뒤 표와 칸 조정 후보는 `node "$HOME/.claude/subagent-system/scripts/subagent-retro.js" --report`로 본다(기록은 쓰지 않음). 사용법만 보려면 인자 없이 실행한다.
- 회고가 사용자에게 물을 것은 설정 폴더 `docs/PROPOSALS.md`의 `## 제안` 절에 쌓이고, 건수는 `--due` 마지막 줄의 「물을 것 N건」이다.
- 그 밖의 경우에는 회고를 시작하지 않는다.
