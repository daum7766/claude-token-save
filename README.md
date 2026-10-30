# Claude Code 설정 묶음

Claude Code를 작은 회사처럼 쓰게 해 주는 묶음입니다. 대화하는 Claude는 관리자, 일을 나눠 받는 서브에이전트는 직원입니다. 일마다 알맞은 모델과 생각 깊이(effort)의 직원에게 맡겨 결과의 질은 지키고 비용과 시간을 줄입니다. 쓰는 동안 기록이 쌓이고, 그 기록으로 맡기는 표를 고쳐 쓸수록 그 사람이 하는 일에 맞게 스스로 나아집니다.

한국어로 Claude Code를 쓰는 사람을 위한 묶음입니다(문서와 규칙이 모두 한국어입니다).

## 얻는 것
- 일마다 맞는 모델로 보내서, 가벼운 일에 비싼 모델을 쓰는 낭비가 줄어듭니다.
- 결과가 모자라면 더 센 모델로 올리고, 질이 떨어지는 방향의 절약은 하지 않습니다.
- 쓸수록 표와 지시문이 내 작업에 맞게 고쳐집니다.
- 입력창 아래에서 모델과 어림 비용을 바로 볼 수 있습니다(agent-meter).

## 설치
키트를 받은 뒤 아무 폴더에서 Claude Code를 열고 이 한 문장만 말하면 됩니다.

```
<이 폴더>/subagent-system/APPLY_GUIDE.md 읽고 그대로 적용해줘
```

필요한 것은 node 24 이상과 Claude Code 최신 버전입니다. 키트는 `git clone`으로 받고, 새 버전이 올라오면 `git pull` 뒤 같은 문장을 다시 말하면 업데이트됩니다. 바꾸기 전에 설정을 백업하고, 언제든 멈출 수 있습니다.

## 설치 때 고르는 것
Claude가 하나씩 묻고, 묻는 것마다 바뀔 내용을 먼저 보여 줍니다.
- **개인용과 회사용**: 일하는 방식을 AI가 스스로 바꾸게 할지, 바꾸기 전에 묻게 할지 하나로 고릅니다. 새 외부 모델과 유료 도구는 둘 다 승인을 받습니다.
  - 개인용: 표, 규칙, 스킬, 훅, 정의를 AI가 바로 고치고 만듭니다. 회고도 최종 보고 뒤 저절로 돌고, 커밋 메시지 검사는 훅을 건 저장소에서 막습니다.
  - 회사용: 고칠 것을 물을 것에 모아 승인받은 뒤 바꿉니다. 회고는 할지 묻고, 커밋 메시지 검사는 꺼 둡니다.
- **주로 하는 일**: 백엔드, 프론트엔드, 데이터, 인프라, QA, 기획과 문서 가운데 고르면 그에 맞는 출발 표가 깔립니다.
- **권장 규칙**: 생각 맞추기와 반대, 애매할 때, 보고 모양, 실물 확인 같은 규칙을 이유와 함께 보여 주고, 마음에 드는 것만 고릅니다(시험 파일을 열 때만 읽히는 시험 쓰기 규칙 포함). 하나도 안 넣어도 체계는 돕니다.
- **권장 스킬**: git-work(워크트리, 머지, 사고 복구), backlog-priority(할 일 우선순위), review-panel(결정 지점의 분야별 검토)을 하나씩 고릅니다.
- **git 확인 창**: reset, stash, checkout처럼 되돌리기 어려운 git 명령 전에 확인 창을 띄울지 고릅니다. 회사용은 commit, merge, rebase, push까지 묻고, 개인용은 그 넷을 빼고 필요한 프로젝트에만 겁니다. 서브에이전트가 작업 트리를 바꾸는 사고의 마지막 안전장치입니다.
- **권장 훅**: 커밋 메시지에 `왜:`와 `전제:`가 없으면 막는 훅입니다. 개인용은 넣는 것이 기본이고 회사용은 묻습니다. 쓸 저장소마다 한 줄을 돌려야 켜집니다.
- **CLAUDE.md 정리**: 이미 쓰던 CLAUDE.md가 길거나 겹치면 줄일 곳을 제안합니다. 고치기 전에 반드시 묻습니다.

목표와 결정 문서가 없는 서브에이전트 지시문을 보내기 전에 막는 지시문 검사 훅(brief-check)은 개인용과 회사용 모두 늘 설치합니다.
사용자를 부르는 승인 창을 설정 폴더의 `permission-asks.jsonl`에 기록하는 훅(ask-log)도 늘 설치하며, 회고가 그 기록을 보고 승인 창을 줄입니다. 출력 없이 기록만 하고 승인 결정에는 끼어들지 않습니다.
agent-meter(화면 아래 비용 표시)도 늘 함께 설치합니다. 자세한 설명은 [agent-meter/README.md](agent-meter/README.md)에 있습니다.

## 평소에 쓰는 법
- 그냥 일을 시키면 됩니다. 메인 Claude가 표를 보고 알맞은 직원에게 맡깁니다.
- 결과가 모자라면 그렇다고 말하세요. 그 말이 표를 올리는 근거가 됩니다.
- 하지 않는 일은 표에서 빼 달라고 하면 됩니다.
- 개인용은 회고가 저절로 돌고, 회사용은 Claude가 회고할지 묻습니다. 지금 하려면 `/retro now`, 상태를 보려면 `/retro`를 칩니다.
- 회고가 사용자에게 물을 것은 설정 폴더의 `docs/PROPOSALS.md`에 쌓이고, Claude가 하나씩 묻습니다.
- 메인 모델은 Opus 5.5 high를 권합니다. 맡기고 확인하는 역할이라 판단이 틀려도 알아챌 신호가 없기 때문입니다.

## 더 알고 싶으면
- [APPLY_GUIDE.md](subagent-system/APPLY_GUIDE.md): 설치, 업데이트, 제거의 전체 절차와 예외 처리
- [SUBAGENT_GUIDE.md](subagent-system/docs/SUBAGENT_GUIDE.md): 고르기와 맡기기, 기록과 회고(표는 [ROUTING_TABLE.md](subagent-system/docs/ROUTING_TABLE.md))
- [SUBAGENT_SITUATIONS.md](subagent-system/docs/SUBAGENT_SITUATIONS.md): 맡길 때마다는 필요하지 않고 특정 상황에서만 읽는 절차
- [git-work 스킬](subagent-system/skills/git-work/SKILL.md): 워크트리, 머지, git 사고 복구
- [RETRO.md](subagent-system/docs/RETRO.md): 회고가 하는 일
- [AUTO_RETRO.md](subagent-system/docs/AUTO_RETRO.md): 최종 보고 뒤 회고를 판정하고 회고 서브에이전트를 띄우는 절차
- [DOC_WRITING.md](subagent-system/docs/DOC_WRITING.md): 문서를 쓸 때와 점검할 때 읽는 기준
- [ROUTING_PRESETS.md](subagent-system/docs/ROUTING_PRESETS.md): 직군별 출발 표
- [CHANGES.md](subagent-system/CHANGES.md): 버전마다 바뀐 것
- 지우고 싶을 때: APPLY_GUIDE.md의 「제거」 절
