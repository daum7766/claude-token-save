# Claude Code 설정 묶음

macOS, 리눅스, Windows에서 쓴다. Windows는 Git for Windows가 있어야 한다. 이 git 저장소 하나만 받아 쓰면 된다(받는 법은 아래 「공유」). node 18 이상과 Claude Code 2.1.293 이상이 필요하고, Claude Code는 최신 버전을 권한다. 문서와 표, Claude가 따르는 규칙이 모두 한국어라 한국어로 Claude Code를 쓰는 사람을 위한 묶음이다.

## 목표

Claude Code에서는 메인 세션(내가 대화하는 Claude)이 일을 서브에이전트(메인 세션이 일을 맡기는 별도의 Claude)에게 나눠 맡긴다. 서브에이전트는 모델(Haiku, Sonnet, Opus)과 effort(생각을 얼마나 깊게 할지 정하는 값, low부터 xhigh)를 정해 부르는데, 이 묶음은 그 선택을 일마다 알맞게 하도록 돕는다.

처음에는 직군별로 정해 둔 일반 표로 시작한다. 이 표(라우팅 표)는 일 종류마다 어느 정의(`~/.claude/agents/`에 두는 서브에이전트 설정 파일로, 모델과 effort가 들어 있다)로 보낼지 적은 것이고, 모델과 effort가 만나는 한 자리를 칸이라 부른다. 서브에이전트를 쓰면서 기록이 쌓이고, 회고(쌓인 기록을 보고 표를 고치는 일)를 할 때마다 표가 그 사람이 하는 일에 맞게 바뀐다. 끝에는 일마다 알맞은 모델과 effort를 골라 결과의 질은 그대로 두고 비용을 줄이는 개인 라우팅 표가 남는다. 둘이 부딪히면 질을 먼저 지킨다. 싼 정의로 한 번 보내 본 칸(내려 보기)도 결과가 모자라면 다시 올린다. 회고는 자주 반복되는 지시와 작업을 찾아 스킬(스크립트를 담은 것 포함)이나 규칙으로 만들자고 제안해 토큰을 줄인다(만드는 것은 승인 뒤). `CLAUDE.md`가 200줄을 넘으면 줄이는 방법(스킬이나 별도 문서로 옮기기)도 제안한다. agent-meter는 그 과정에서 모델과 비용을 눈으로 확인하는 도구다.

| 폴더 | 내용 | 까는 법 |
|:---|:---|:---|
| `agent-meter/` | 입력창 아래에 메인과 서브에이전트의 모델, effort, 문맥, 토큰, 어림 비용, 프롬프트 캐시(같은 대화 앞부분을 싸게 다시 읽게 해 주는 저장)가 만료되기까지 남은 시간을 보여 주는 mod(Claude Code 화면에 붙이는 확장) | 2번 문장을 Claude에게 말하면 Claude가 함께 깔지 묻는다. agent-meter만 직접 깔 때는 1번 스크립트 한 번 실행 |
| `subagent-system/` | 서브에이전트 라우팅(모델과 effort 정의 10개, 선택 표, 직군별 출발 표), 지시문 체크리스트, 토큰과 비용 기록, 회고(묻기 또는 자동)와 `/retro` 커맨드, 업데이트(`VERSION`으로 판단). `docs/ROUTING_PRESETS.md`(직군별 출발 표)와 `BACKGROUND.md`(모델 선택 규칙의 근거)는 설치하지 않고 키트에서 읽는 문서 | 2번 문장을 Claude에게 말함 |
| `extras/` | 늘 지키는 규칙(CLAUDE.md에 넣을 줄), git 명령 확인 목록, 글쓰기 줄(CLAUDE.md와 정의에 넣을 줄) | 2번 설치 때 Claude가 묻고 고른 것만 넣음 |

설치는 2번의 문장 하나면 된다.

## 1. agent-meter만 직접 설치

```
cd <이 폴더>
node install-agent-meter.mjs
```

macOS와 리눅스에서는 `./install-agent-meter.sh`로도 된다. 같은 폴더의 `.mjs`를 `node`로 부르는 래퍼이고 인자도 그대로 넘긴다. keep-alive를 묻지 않고 정하려면 인자를 붙인다.

```
node install-agent-meter.mjs --no-keepalive
```

Claude Code를 새로 열면 입력창 아래에 사용량 표가 보인다. `/meter`로 표를 켜고 끄고, `/meter tokens`로 토큰 열(입력, 출력, 캐시 읽기, 캐시 쓰기)만 켜고 끈다. 토큰 열은 처음에는 보인다. 정한 상태(표를 숨긴 것 포함)는 새 세션에서도 이어진다.

스크립트가 하는 일:
- `agent-meter/`에서 시험 파일(`tests/`)과 `tsconfig.json`을 뺀 나머지를 `~/.claude/mods/agent-meter`에 복사한다. Windows에서는 `%USERPROFILE%\.claude` 아래이고, `CLAUDE_CONFIG_DIR`를 정해 두었으면 그 폴더 아래다. 이미 깔린 mod가 있으면 새것으로 바꾼다. 그 mod가 이 키트의 것과 다르면(손으로 고친 파일 등) 지우지 않고 `~/.claude/agent-meter-backup-날짜-시각`으로 옮기고 그 경로를 출력한다. 새 mod를 옆 폴더에 다 복사한 뒤 맞바꾸므로 복사가 실패해도 기존 mod와 `settings.json`은 그대로 남는다.
- 설정 폴더의 `settings.json`에서 `env.CLAUDE_CODE_PLUGIN_DIRS`에 그 폴더를 더한다. 다른 설정과 파일 권한은 그대로 두고, 파일이 이미 있으면 고치기 전 파일을 `settings.json.bak-agent-meter-날짜-시각`으로 남긴다. `settings.json`이 심볼릭 링크(dotfiles 저장소 등)면 링크는 그대로 두고 링크가 가리키는 실제 파일에 쓴다. 실행할 때마다 새 이름이라 이전 백업을 덮어쓰지 않고, 만든 백업 경로를 출력한다.
- 여러 번 실행해도 설정 줄은 한 번만 들어간다. 이미 `~/.claude/mods/agent-meter`처럼 적혀 있어도 같은 폴더면 더하지 않는다.

알아 둘 것:
- `jq`가 없으면 resume(`claude --resume`으로 지난 대화를 다시 연 것)한 세션의 지난 사용량을 되살리는 기능만 빠진다. 설치는 macOS `brew install jq`, Windows `winget install jqlang.jq`, 리눅스는 배포판 패키지 관리자(`sudo apt install jq` 등)로 한다.
- 표 머리글은 `model`, `effort`, `context`를 뺀 나머지가 한국어이고, 어림 비용은 API 요금(2026-10 Anthropic 가격표)으로 환산한 값이다. 구독 요금제로 쓰면 실제로 내는 돈과 다르다. 요율은 아래 「비용 어림값」에 있다.
- 요율은 `~/.claude/subagent-system/rates.json`(`CLAUDE_CONFIG_DIR`을 정해 두었으면 그 폴더 아래)을 읽고, 파일의 수정 시각이 바뀌면 5초 안에 다시 읽는다. 파일이 없거나 깨졌을 때만 mod에 든 내장 요율(`register.tsx`의 `BUILTIN_RATES`)을 쓴다. 파일에 없는 모델은 비용이 `?`로 보인다. 그래서 요율은 `rates.json` 하나만 고치면 되고, agent-meter를 다시 설치해도 그 값이 유지된다.
- 한 요청 안에 5분 캐시 쓰기와 1시간 캐시 쓰기가 섞이면 한쪽 요율로 계산한다(엔진이 둘을 가르는 값을 주지 않는다). 그 요청의 어림 비용은 조금 어긋날 수 있다.
- 표의 「캐시」 열은 프롬프트 캐시가 만료되기까지 남은 시간이고, 「재캐시」 열은 만료된 뒤 다음 요청이 대화 전체를 캐시에 다시 쓸 때 드는 어림 비용이며, 「캐시만료」 열은 지금까지 캐시가 만료된 횟수와 그때 든 비용이다.
- 설치할 때 keep-alive(아래 설명)를 켤지 묻는다. Enter만 치면 지금 값을 그대로 둔다(처음 설치는 켬이라 `[Y/n]`, 꺼 두었으면 `[y/N]`). 질문은 아무것도 바꾸기 전에 해서, 답하다 Ctrl-C로 멈춰도 바뀐 것이 없다. `--no-keepalive`나 `--keepalive`를 붙이면 묻지 않는다. `--keepalive`와 `--no-keepalive`를 함께 주면 오류로 멈춘다. 모르는 인자를 주면 설치하지 않고 쓰는 법을 찍는다(`--help`나 `-h`는 쓰는 법만 찍는다). 터미널이 아닌 곳(Claude의 셸 등)에서 인자 없이 실행하면 묻지 않고 `settings.json`의 기존 값을 그대로 둔다.
- 서브에이전트가 도는 동안 메인 캐시가 곧 만료되면(1시간 캐시는 3분 전, 5분 캐시는 1분 전), 메인 요청을 한 번 더 보내 만료 시각을 늘린다(keep-alive). 돌아와서 대화 전체를 캐시에 다시 쓰는 것보다 싸지만 이 요청도 돈이 들고, 들어간 비용은 알림으로 보여 준다. 끄려면 설치할 때 `--no-keepalive`를 주거나 `settings.json`의 `env`에 `AGENT_METER_KEEPALIVE`를 `"0"`으로 둔다(지우면 켠다). 끄거나 서브에이전트가 돌지 않을 때는 연장하지 않고, 알림만 낸다(1시간 캐시는 만료 5분 전, 5분 캐시는 1분 전). 연장 요청이 캐시를 읽지 못하면 연장 알림 대신 만료 알림이 나가고, 그 요청에 든 비용도 메인 비용에 더한다.
- agent-meter는 캐시 수명 확인에 `grep`을, 권한 모드 표시 폭 맞춤에 `sh`와 `ps`를 부른다. Git for Windows 기본 설치는 이 명령들을 PATH에 넣지 않아 Windows에서는 그 두 기능이 빠질 수 있다(확인하지 못했다). 표는 그대로 뜬다.
- 조직의 관리 설정에 따라 표만 안 뜨거나(`allowManagedModsOnly`, `allowManagedHooksOnly`, 관리 설정의 `disableAllHooks`. 뒤 둘은 서브에이전트 체계의 훅인 비용 기록과 회고 알림도 멈춘다) Claude Code가 아예 시작하지 않을 수 있다. `disableSideloadFlags`가 켜진 곳은 `env`의 `CLAUDE_CODE_PLUGIN_DIRS`에 폴더가 있으면 Claude Code가 오류를 내고 시작하지 않는다. 2번의 설치는 이 설정이 관리 설정 파일에 있으면 미리 가려 agent-meter를 깔지 않고, 서버나 MDM(기기 관리 도구)으로 내려오는 설정이면 깐 뒤 바로 확인해 되돌린다. 이 스크립트를 직접 돌릴 때는 가리지 않는다. 시작하지 않으면 Claude Code가 열리지 않아 Claude에게 부탁할 수 없으니, `settings.json`의 `env.CLAUDE_CODE_PLUGIN_DIRS`에서 agent-meter 경로를 직접 지운 뒤 Claude Code를 열고(2번 설치 도중이었으면 같은 폴더에서 `claude --continue`로 그 대화를 이어 열고) Claude에게 「<이 폴더>/subagent-system/APPLY_GUIDE.md 의 「제거」 절을 읽고, 시작 오류 때문에 agent-meter 지워줘」라고 말한다(아래 「제거」. mod 폴더와 거절 기록, statusLine 되돌리기 질문을 Claude가 처리하고, 설치나 업데이트가 끝나지 않았으면 남은 확인을 이어 할지 묻는다).
- `settings.json`이 깨진 JSON이면 mod 폴더를 바꾸기 전에 설치가 멈춘다. 파일을 고친 뒤 다시 실행한다.

## 2. 서브에이전트 체계 적용

Claude Code를 열고 이렇게 말한다. 어느 폴더에서 열어도 된다.

```
<이 폴더>/subagent-system/APPLY_GUIDE.md 읽고 그대로 적용해줘
```

설치 위치는 이 컴퓨터의 `~/.claude` 하나다. 프로젝트 저장소에는 아무것도 넣지 않는다. `CLAUDE_CONFIG_DIR`을 쓰는 컴퓨터는 Claude가 설치본 파일에 적힌 `~/.claude`를 그 폴더로 바꿔 넣는다. `~/.claude`를 바꾸기 전에 Claude가 `settings.json`, `CLAUDE.md`, 같은 이름의 정의, 이미 깔린 `subagent-system/`의 문서와 스크립트를 `~/.claude/subagent-system-backup-<날짜-시각>/`에 복사하고 경로를 알려 준다. 기록은 `~/.claude/subagent-system/records/` 한 곳에 쌓이고, 모든 프로젝트가 함께 쓴다.

Claude는 먼저 전제(Claude Code 버전, node, Windows면 Git for Windows)를 확인하고, 맞지 않으면 질문하기 전에 멈춘다. 그 뒤 처음 까는 컴퓨터면 먼저 무엇을 깔고 바꾸는지(바꾸기 전에 백업한다는 것 포함), 질문이 몇 개인지, 언제든 멈출 수 있다는 것을 알린다. 질문은 여덟 번이고 하나씩 묻는다(아래 다섯 항목이고, 함께 넣을 것은 넷을 따로 묻는다). agent-meter를 묻지 않는 경우(아래 「함께 넣을 것」)는 일곱 번이다. 여덟 번이 끝이 아니고, 설치하는 중에도 상황에 따라 위임 기준, `CLAUDE.md` 개선 권고, statusLine 정리 같은 질문이 더 나온다. 묻는 것마다 바뀔 내용을 먼저 보여 주고 묻는다. 앞의 세 답으로 그 사람이 하는 일에 맞는 출발 표를 만든다.
- **주로 하는 일**: 백엔드, 프론트엔드와 앱, 데이터, 인프라와 운영, QA와 테스트, 기획과 문서 가운데 고른다. 여러 개 골라도 되고, 고른 직군의 표를 합친다. 지시문 체크리스트(서브에이전트에 일을 보내기 전에 대조하는 목록)도 직군과 상관없는 공통 줄에 고른 직군의 줄을 더해 시작하고, 그 뒤로는 회고가 기록을 근거로 줄을 더해 간다. 하나도 고르지 않으면 기획과 문서 표와 공통 체크리스트로 시작하고, 직군은 나중에 더할 수 있다. 고른 직군은 `~/.claude/subagent-system/config.json`에 남아 업데이트가 읽는다.
- **표에 없는 자주 하는 일**: 합친 표를 보여 주면 빠진 일을 말한다. Claude가 알맞은 칸에 넣고 어디에 넣었는지 알린다. 없으면 넘어간다.
- **「무조건 Opus」 영역**: 작업 크기와 상관없이 가장 신중하게 다룰 영역. 고른 직군의 기본안(백엔드라면 DB 스키마와 마이그레이션, 결제와 환불, 인증과 권한, 동시성, 외부 API 계약)에서 고르거나 고친다.
- **함께 넣을 것**: `extras/`의 세 가지와 agent-meter를 하나씩 묻는다. 항목마다 넣을 내용을 먼저 보여 주고 「넣을까요?」를 따로 묻고, 하나도 안 넣어도 된다. agent-meter에 「넣는다」로 답하면 keep-alive를 켤지도 이어서 묻는다. 이미 깔려 있으면(1번으로 직접 깐 경우 등) agent-meter는 묻지 않고 새 것으로 다시 깐다(keep-alive는 지금 값 그대로). 조직 설정이 막고 있으면 묻지 않고 깔지 않는다. 서브에이전트 체계는 이 넷 없이도 돈다.
- **회고 방식**: 묻기(기본)와 자동 가운데 고른다. 묻기는 회고할 때가 되면 메인이 물어보고, 자동은 회고할지는 묻지 않고 회고 서브에이전트가 백그라운드로 돌아 표와 정의를 고친다(다만 `~/.claude` 파일을 고칠 때 권한 확인 창이 뜰 수 있다. 아래 「쓰는 동안 할 일」). 나중에 `/retro auto`와 `/retro ask`로 바꿀 수 있다.

다 답하지 못해도 된다. 표에 없는 일은 쓰면서 기록되고 회고 때 표에 들어가, 표가 각자 하는 일에 맞게 바뀐다.

그 뒤 파일을 놓고 훅 둘을 설정하고(`SubagentStop`은 서브에이전트가 끝날 때마다 자동으로 도는 명령이고, `SessionStart`는 Claude Code를 새로 열 때 한 번 돌며 회고할 때인지 알린다), 넣기로 한 것만 넣는다. 고를 수 있는 것은 다음 넷이다.
- **늘 지키는 규칙**: 멈추고 묻는 경우 둘, 질문은 한 번에 하나, 답 없는 항목은 다시 묻기, 커밋과 푸시는 지시 때만, 여러 git 단계를 한 번에 지시받으면 빠짐없이 하고 단계마다 보고, 조사는 전수 실측, 주석은 왜만, 작업을 마친 뒤 보고는 첫 줄 요약과 「결정할 것」, 「알아 둘 것」으로, 필요한 말만 쓰고 확인하지 못한 것은 그렇다고 적기. 백엔드, 데이터, 인프라와 운영 가운데 하나라도 골랐으면 멈추고 묻는 작업에 DB 마이그레이션 적용과 운영 DB 데이터 변경이, 전수 실측에 DB 스키마와 운영 설정을 확인하는 줄이 더해진다.
- **git 명령 확인 목록**: 실행 전에 확인을 받는 명령이다. 기준은 둘이다. 하나는 끝나지 않은 작업이 커밋되거나 사용자가 정하고 싶은 커밋 메시지를 Claude가 마음대로 정하는 것을 막는 것이다(commit, push, merge, rebase). 다른 하나는 복구할 수 없는 일을 막는 것이다(reset, restore, checkout, switch, clean, rm, stash 계열, `branch -D`, `branch -d`, `branch --delete`). cherry-pick과 revert는 사용자가 되돌릴 수 있어 넣지 않는다. `~/.claude/settings.json`에 넣는다. CLAUDE.md가 브랜치 이동에 `git switch`, 파일 복원에 `git restore`를 쓰라고 하면, 그 둘은 목록에서 뺄지 먼저 묻는다. 같은 명령이 `PowerShell(...)` 규칙으로도 들어 있어, Windows에서 PowerShell 도구로 도는 git도 확인을 받는다.
- **글쓰기 줄**: 줄표(—)와 가운뎃점(·)을 쓰지 않는 줄을 두 곳에 더한다. CLAUDE.md에 한 줄(메인의 응답과 문서, 서브에이전트에게 쓰는 지시문에 걸린다), 서브에이전트 정의 10개 본문 끝에 한 줄(서브에이전트의 보고에 걸린다)이다. 한국어 글쓰기 취향이라 안 맞는 사람도 있다.
- **agent-meter**: 위 표의 mod를 `install-agent-meter.mjs`로 깐다. 인자로 keep-alive 답을 넘기고, 설정 파일을 모두 고친 뒤 마지막에 깐다. 깐 뒤 `statusLine`(화면에 모델과 비용 같은 것을 한 줄로 보여 주는 설정)이 있으면 agent-meter 표와 겹치는 항목을 보여 주고 겹치는 항목만 빼기(추천), 그대로 두기, `statusLine` 키 지우기 가운데 고르게 하고, 고치기 전에 백업한다. 고치는 것은 사용자 설정 폴더의 `settings.json`과 그것이 부르는 스크립트뿐이고, 프로젝트 저장소 쪽 `statusLine`은 겹치는 항목만 알린다. 이 정리는 한 번 하고, 고른 답을 `config.json`에 남겨 업데이트가 다시 묻지 않는다(고칠 수 있는 `statusLine`이 없었으면 기록을 남기지 않아, 나중에 사용자 설정 폴더에 더하면 다음 업데이트가 정리를 묻는다. 하나도 없거나 프로젝트 쪽, 플러그인, 조직 관리 것만 있어 알리기만 한 경우다). agent-meter만 지우면서 `statusLine`을 되돌렸으면 그 기록이 지워져, 다시 깐 뒤 다음 업데이트가 다시 묻는다.

CLAUDE.md에 넣는 규칙은 `<!-- subagent-system 시작 -->`과 `<!-- subagent-system 끝 -->` 사이에, extras의 늘 지키는 규칙과 글쓰기 줄의 CLAUDE.md 줄은 `<!-- claude-setup-kit extras 시작 -->`과 `<!-- claude-setup-kit extras 끝 -->` 사이에 둔다. 지울 때 그 사이만 지우려는 표시라 지우거나 고치지 않는다. 구역 문장을 바꾸려면 구역 밖에 「구역: A 대신 B」 한 줄을 적는다(업데이트가 지킨다).

처음 설치 끝 무렵에는 Claude가 `CLAUDE.md`를 읽고 개선을 권한다(200줄을 넘으면 줄일 곳 찾기, 줄일 곳이 없으면 줄 수만 알림, 모순과 반복 정리, 절차는 스킬로, 파일별 규칙은 경로 한정 규칙으로, 참고 내용은 별도 문서로, Opus 5.5 기준 글을 따른 모델별 권고). 키트 구역은 보지 않고, 권고마다 근거 주소를 보이며, 고치는 것은 사용자가 고른 것만이다.

재시작 없이 되는 확인(설정 파일, 시험, 표와 정의의 일치, 표시 주석)을 마치고 `VERSION`을 놓은 뒤, Claude Code를 닫고 같은 폴더에서 `claude --continue`로 이 대화를 이어 열어 달라고 한다(열린 뒤 `/resume`으로 이 대화를 골라도 된다). 새로 놓은 정의와 스킬을 확실히 읽히려는 것이다. SessionStart 훅은 이어 연 대화에서는 돌지 않고, 그 뒤 새로 여는 세션부터 돈다. 이어 연 대화에서 Claude가 서브에이전트 하나를 보내 비용 기록이 쌓이는지 확인하고, `/retro`를 입력해 상태가 뜨는지 봐 달라고 한 뒤 보고한다. 보고는 메인 설정(아래 「쓰는 동안 할 일」의 추천), 결정이 필요한 것, 바뀐 것, 발견한 것, 쓰는 법 순서다. `/retro`는 `~/.claude/skills/retro/SKILL.md`로 놓이는 슬래시 커맨드이고, 같은 이름의 커맨드나 스킬이 이미 있으면 덮어쓰지 않고 다른 이름을 묻는다. 지금 연 폴더의 프로젝트에 같은 이름이 있으면 그 프로젝트에서는 `/retro`가 이 키트의 것으로 열린다고 알리고 이름을 묻는다. 새 대화로 열어 같은 문장을 말하면 Claude가 이미 설치된 것으로 읽되 남은 확인을 이어 할지 묻는다(`claude --continue`가 더 매끄럽다).

업데이트:
- **이미 깔린 컴퓨터**에서도, 키트를 `git pull`로 새로 받은 뒤에도 같은 문장을 쓴다.
- Claude가 설치본의 `~/.claude/subagent-system/VERSION`과 키트의 `subagent-system/VERSION`을 비교한다. 설치본이 키트보다 낮으면 업데이트하고, 같으면 끝낸다(처음 설치의 마지막 확인이 남았으면 이어 할지 묻는다). 설치본이 더 높으면 멈춘다.
- 업데이트할 때는 사용자 것만 지키고 나머지는 키트 것으로 바꾼다. 지키는 것은 다음과 같다.
  - 회고로 고쳐 온 모델 배정 표와 「무조건 Opus」 목록
  - 회고가 `SUBAGENT_GUIDE.md`의 사용자 규칙 구역에 더한 공통 문장
  - 정의 description의 일 이름 나열
  - `rates.json`의 값
  - 회고 방식과 고른 직군 설정
  - 회고가 지운 정의 이름
  - 사용자가 표에서 뺀 일 이름
  - 설치 때 고치지 않겠다고 한 표시 밖 줄(`config.json`)
  - 지시문 체크리스트의 줄
  - 사용 기록(`records/`)
- CLAUDE.md의 표시 주석 사이는 차이를 보여 주고 바꿀지 묻는다. 구역 문장을 바꾸려고 구역 밖에 적어 둔 「구역: A 대신 B」 줄(위임 기준 포함)은 지키고, A가 지금 구역에 없거나 뜻이 바뀌었을 때만 고칠지 묻는다.
- 키트가 통째로 바꾸는 파일(스크립트, `RETRO.md`, `SUBAGENT_GUIDE.md`의 사용자 구역 밖, 정의의 description과 글쓰기 줄 밖, `/retro` 스킬)은 설치나 지난 업데이트 때 남긴 해시(`config.json`)와 다른 것만 손으로 고친 것으로 보고, 고친 줄을 지켜질 곳으로 옮길지 묻는다. 스크립트처럼 옮길 곳이 없는 차이는 보여 주고, 덮어쓰면 사라진다고 알린다.
- 지시문 체크리스트는 통째로 바꾸지 않는다. 고르지 않은 직군의 줄로 보이는 설치본 줄은 표로 모아 지울지 묻고, 키트의 공통 줄과 고른 직군의 줄 가운데 설치본에 없는 줄은 나뉜 줄, 표현만 다른 줄, 새 줄 순서로 보여 주고 넣을지 묻는다. 회고나 사용자가 더한 줄은 건드리지 않는다. 넣지 않기로 한 줄은 `config.json`에 남아 다음 업데이트에서 다시 묻지 않는다.
- 설치본에 SessionStart 훅이 없으면 더해도 되는지 묻고 더하며(거절하면 `config.json`에 남아 다시 묻지 않는다), 사용자의 다른 SessionStart 훅은 건드리지 않는다. 설치본 git 확인 목록에 빠진 키트 항목을 보여 주고 승인한 것만 더한다(거절한 항목은 기억해 다시 묻지 않는다).
- agent-meter는 설치본에 `~/.claude/mods/agent-meter`가 있으면 묻지 않고 다시 깔고(keep-alive는 지금 값 그대로), 없으면 처음 설치의 질문을 한 번 묻는다(업데이트에서 거절했거나 agent-meter만 지웠거나 조직 설정 때문에 되돌렸으면 묻지 않는다). 순서는 `APPLY_GUIDE.md`의 「업데이트 순서」 7번이다.
- 설치본에 `docs/ROUTING_PRESETS.md`가 있으면 키트 파일이라 지운다(백업에 남는다).
- 정의에 글쓰기 줄이 있던 설치본은 키트 정의 복사본에 그 줄을 다시 더한 뒤 놓는다(CLAUDE.md의 글쓰기 줄은 extras 구역 안이라 위 규칙대로 차이를 보여 주고 묻는다).
- `SUBAGENT_GUIDE.md`는 사용자 칸을 되넣은 뒤에 한 번에 놓는다.
- 바꾸기 전에 위와 같은 백업을 한다. 모든 확인이 끝난 뒤에 `VERSION`을 놓고, 업데이트가 중간에 끊겼으면 다시 열었을 때 남은 단계부터 이어 한다.
- 버전마다 바뀐 것은 `subagent-system/CHANGES.md`에 있다.

서브에이전트가 git 상태를 망가뜨렸을 때의 복구 절차는 `SUBAGENT_GUIDE.md` 「git 금지」에 있다.

쓰는 동안 할 일:
- 메인 세션 설정은 필수가 아니고 추천이다. Claude가 설정하지는 않고, 지금 값이 권장값이 아니면 보고에서 알린다. 모델은 Opus 5.5 high를 권한다. 메인은 맡기고 확인하는 역할이라 판단이 틀리면 알아챌 신호가 없다.
- 평소처럼 일을 시키면 메인이 표를 보고 정의를 골라 서브에이전트에 맡긴다. 표는 이 컴퓨터의 개인 표이고 `~/.claude/subagent-system/docs/SUBAGENT_GUIDE.md`에 있다.
- 비용을 위해 Opus의 autocompact(문맥이 차면 대화를 요약해 줄이는 기능)를 400k에서 600k 사이로 정하기를 권한다. 1M 문맥을 쓰고 정하지 않으면 약 967K에서 압축되는데, 요청마다 대화 전체를 캐시에서 다시 읽으므로 문맥이 길수록 요청당 비용이 커진다. `CLAUDE_CODE_DISABLE_1M_CONTEXT`로 1M 문맥을 꺼 두었으면 200K 창에서 압축되므로 이 권고는 해당하지 않는다.
- 명령은 이 순서로 친다. `/model claude-opus-5-5`는 지금 모델이 Opus 5.5가 아니거나 뒤 두 명령을 칠 때 치고, `/effort high`와 `/autocompact 400k`는 값이 권장값이 아닐 때만 친다. `/effort`와 `/autocompact`는 모델마다 저장되므로 `/model`을 먼저 친다. 환경변수나 프로젝트 설정이 정한 항목과 effort 상한(`maxEffortLevel`)이 high보다 낮을 때의 `/effort`는 Claude가 명령에서 뺀다([`APPLY_GUIDE.md`](subagent-system/APPLY_GUIDE.md)의 「7. 보고」). Anthropic API가 아니면 `/model` 화면에서 Opus 5.5를 고른다.
- `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_USE_FOUNDRY`, `CLAUDE_CODE_USE_ANTHROPIC_AWS` 가운데 하나가 켜져 있으면 정의의 `opus`, `sonnet`, `haiku`가 effort를 일부만 지원하거나 지원하지 않는 이전 모델로 풀릴 수 있어 같은 모델의 effort 칸이 같은 동작이 될 수 있다. `ANTHROPIC_DEFAULT_OPUS_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL`, `ANTHROPIC_DEFAULT_HAIKU_MODEL`로 고정할 수 있고(Claude Code가 알아보지 못하는 ID는 `ANTHROPIC_DEFAULT_<계열>_MODEL_SUPPORTED_CAPABILITIES`에 `effort`를 적어야 effort가 켜진다), 설치할 때 Claude가 알려 준다.
- 서브에이전트 결과가 모자라면 그렇다고 말한다. 회고가 그 말을 정정(사용자가 고쳐 말한 메시지)으로 세어 칸을 올린다. 정정의 원인이 지시문이면(메인이 맥락이나 기준을 빠뜨림) 칸은 올리지 않고 지시문 체크리스트를 고친다. 메인이 사용 기록에 `올림`과 `재지시` 가운데 무엇으로 적는지와 건수를 세는 방법은 [`SUBAGENT_GUIDE.md`](subagent-system/docs/SUBAGENT_GUIDE.md)의 「기록과 회고」와 [`RETRO.md`](subagent-system/docs/RETRO.md)의 「정정과 후보 판정」에 있다.
- Opus xhigh로도 안 풀리는 일은 마지막으로 Fable 5.1에 보낸다. 요율표에서 가장 비싼 모델이고 요금제에 따라 요금제 한도가 아니라 사용 크레딧(추가 요금)으로 청구될 수 있어, 보내기 전에 Claude가 먼저 묻는다. 호출이 그 모델을 쓸 수 없다고 실패하면 다시 시도하지 않고 `opus-xhigh` 결과와 막힌 점을 보고한다. 실패하지 않아도 조직 설정이나 안전 분류기 등으로 다른 모델로 돌 수 있어서, Claude가 끝난 뒤 비용 기록(`subagent-cost.tsv`)의 모델 열로 실제 모델을 확인하고 Fable 5.1이 아니었으면 알린다. 호출 방법, 실제 모델을 판정하는 순서, 사용 기록에 적는 값은 [`SUBAGENT_GUIDE.md`](subagent-system/docs/SUBAGENT_GUIDE.md)의 「문제가 생기면 올리기」에 있다.
- 내려 본 칸이 두 번 실패하면 회고가 최저선(그 아래로는 내려 보지 않는 정의)을 달자고 제안한다. 달지는 사용자가 정한다. 최저선이 올라가기만 해서 모든 일이 Opus로 몰리지 않게, 단 뒤에도 회고가 가끔 바로 아래 정의로 1건 다시 시험하고 통과하면 최저선을 내리자고 제안한다. 간격과 판정은 [`RETRO.md`](subagent-system/docs/RETRO.md)의 「정정과 후보 판정」에 있다.
- 같은 일인데 성공과 실패가 섞이는 칸은 회고가 맡기기 전에 볼 수 있는 기준(재현 방법이나 원자료가 있는지 같은)으로 두 칸으로 쪼개자고 제안한다. 최저선보다 먼저 본다. 절차는 [`RETRO.md`](subagent-system/docs/RETRO.md)의 「섞인 칸 쪼개기」에 있다.
- 표에 맞는 칸이 없는 일은 메인이 새 일 이름으로 기록해 둔다. 회고 때 「표에 없는 일 종류」로 모아 보고 표에 넣는다.
- 표에 있지만 하지 않는 일은 Claude에게 표에서 빼 달라고 하면 된다(그 칸 정의의 description 일 이름 나열도 함께 뺀다). 뺀 이름은 회고가 표에 다시 넣지 않고 묻는다. 다시 넣고 싶으면 그렇게 말하면 된다([`RETRO.md`](subagent-system/docs/RETRO.md)의 「회고 단계」 4번).
- 서브에이전트 기록이 쌓이면 Claude가 회고할지 묻는다. 세션을 새로 열 때 한 번, 맡긴 작업 하나가 끝날 때 한 번이고 같은 세션에서 다시 묻지 않는다([`APPLY_GUIDE.md`](subagent-system/APPLY_GUIDE.md)의 「4. 규칙 줄 넣기」). 회고 방식을 자동으로 바꿨으면 회고할지는 묻지 않고 회고 서브에이전트가 백그라운드로 돈다(아래 `/retro` 표). 하자고 하면 기록으로 표와 정의를 고친다. 기준은 처음에 30건이고, 회고를 할수록 50건, 100건으로 오른다. 바꾼 칸이 없는 회고가 두 번 이어지면 표가 안정된 것으로 보고 200건으로 늘린다. 처음에는 표를 자주 맞추고, 표가 자리 잡을수록 덜 묻게 하려는 것이다.
- 기준 건수에 못 미쳐도 마지막 회고 뒤 같은 칸에 `올림`이 붙은 서로 다른 에이전트가 2명 이상이고 그 칸 에이전트의 20% 이상이면 묻는다. 칸을 내린 뒤 실패가 이어지면 다음 회고까지 표가 낮은 채로 남아 같은 일을 두 번 하게 되기 때문이다.
- 건수가 모자라도 마지막 회고(또는 기간 기준을 미룬 날) 뒤 (대화 기록 보존 기간 - 5일)이 지나고 그 뒤 새 기록이 있으면 묻는다. Claude Code가 보존 기간이 지난 대화 기록을 서브에이전트 기록까지 지워서, 회고가 늦으면 정정을 놓치기 때문이다. 보존 기간은 Claude 설정 폴더의 `settings.local.json`과 `settings.json`에서 읽은 `cleanupPeriodDays`이고 둘 다 있으면 작은 값을 쓰며 둘 다 없으면 30일이다. 다른 위치(managed settings 등)의 값은 읽지 않는다. 이 두 기준은 [`RETRO.md`](subagent-system/docs/RETRO.md)의 「정정과 후보 판정」에 있다.
- 지금은 안 한다고 하면 기준의 절반(최대 20건)이 더 쌓일 때까지, 올림이 쌓인 칸은 그 칸에 올림이 붙은 에이전트가 1명 더 생길 때까지 다시 묻지 않는다. 세션이 바뀌어도 이어지고, 미루는 것은 그때 걸린 기준뿐이다. 기간 기준을 미루면 기간 셈을 오늘부터 다시 하고, 그 전 대화의 정정이 지워질 수 있다는 경고를 보인다.
- 하는 일이 크게 바뀌어 새 직군의 「무조건 Opus」 항목이나 체크리스트 기본 줄이 필요하면, 키트의 [`subagent-system/docs/ROUTING_PRESETS.md`](subagent-system/docs/ROUTING_PRESETS.md)를 Claude에게 보여 주고 지금 표에 합쳐 달라고 한다. 이미 있는 일 이름의 칸과 표시는 그대로 두고 새 이름만 더한다(회고로 실측한 칸이 출발 표의 추정보다 정확하기 때문이다). 새 직군이 백엔드, 데이터(분석과 엔지니어링), 인프라와 운영이고 늘 지키는 규칙을 깔았으면, `extras/CLAUDE_RULES.md`의 「백엔드, 데이터, 인프라를 고른 경우」 묶음 둘도 CLAUDE.md의 `claude-setup-kit extras` 구역에 함께 넣어 달라고 한다.
- 자동 회고는 질을 지키거나 시험으로 되돌릴 수 있는 것만 바로 고치고, 사용자가 정해야 하는 것은 바꾸지 않고 모아 두었다가 묻는다. 바로 고치는 것은 올리기 후보 칸 올리기, 내려 보기 시험과 그 결과에 따른 칸 옮기기, 표에 없는 일 넣기(사용자가 표에서 뺀 이름은 제외), 올린 칸에 정의가 없을 때 새 정의 만들기다. 고치기 전에 `~/.claude/subagent-system-backup-retro-<날짜-시각>/`에 표와 정의를 복사한다. 묻는 것은 「무조건 Opus」 목록, 「(고정)」 표시, 「최저선」, 섞인 칸 쪼개기, 지시문 체크리스트, `CLAUDE.md`, 요율, 반복 찾기 제안과 규칙 문장 고치기, 정의 파일 지우기, 사용자가 표에서 뺀 일 이름 되돌리기, `opus-xhigh`로 올리기다. 이것들은 기록 폴더의 `retro-pending.md`에 모아 두고 작업 하나가 끝날 때 하나씩 묻는다. 여러 세션이 동시에 회고를 띄우지 않게 잠금을 쓰고, 3시간이 넘은 잠금은 버려진 것으로 본다. 항목별 이유와 절차는 [`RETRO.md`](subagent-system/docs/RETRO.md)의 「자동 회고」에 있다.
- 자동 회고가 묻지 않는 것은 회고할지뿐이고, `~/.claude` 아래 표와 정의 파일을 고칠 때는 Claude Code의 권한 확인 창이 뜰 수 있다. Claude Code가 `.claude` 폴더 쓰기를 보호 경로(실수로 설정이 망가지지 않게 자동 승인하지 않는 경로)로 다루고, 설정 파일의 `permissions.allow`로도 미리 허용할 수 없기 때문이다(공식 문서 https://code.claude.com/docs/en/permission-modes 「Protected paths」). 권한 모드마다 다르다. 기본과 acceptEdits는 확인 창이 뜨고(회고가 백그라운드여도 창은 메인 세션에 뜬다), auto는 분류기가 판단하고, dontAsk는 거부되어 회고가 실패하고, bypassPermissions는 확인 없이 쓴다. 자동 회고가 두 번 이어 실패하면 스크립트가 묻기 방식으로 돌려놓고 알린다. 다시 켜려면 `/retro auto`를 입력한다. 자세한 것은 [`RETRO.md`](subagent-system/docs/RETRO.md)의 「권한 확인 창과 연속 실패」에 있다.
- `/retro`로 회고 방식을 보고 바꾼다.

  | 입력 | 하는 일 |
  |:---|:---|
  | `/retro` | 상태를 보인다. 회고 방식, 다음 회고까지 남은 건수와 단계, 올림이 쌓인 칸, 보존 기간 때문에 묻는 날짜(기간 기준), 진행 중인 회고(잠금), 물을 것 건수, 0이 아니면 자동 회고 연속 실패 횟수 |
  | `/retro auto` | 회고 방식을 자동으로 바꾼다 |
  | `/retro ask` | 회고 방식을 묻기로 바꾼다 |
  | `/retro now` | 기준과 상관없이 지금 회고한다. 묻기 방식이면 평소 절차로, 자동이면 백그라운드 회고를 띄운다. 사용 기록이 없으면 회고하지 않고 그렇다고 알린다 |
  | 그 밖 | 사용법을 보인다. `auto`, `ask`, `now`와 글자 하나까지 같은 인자만 실행한다 |

- 회고 표를 직접 보려면 어느 폴더에서나 `node "$HOME/.claude/subagent-system/scripts/subagent-retro.js"`를 실행한다. 기록 폴더 위치는 같은 명령에 `--where`를 붙이면 나오고, 자주 반복되는 지시와 작업은 `--repeats`를 붙이면 나온다([`RETRO.md`](subagent-system/docs/RETRO.md)의 「반복 찾기」).
- 서브에이전트가 끝날 때 쓰는 사용 기록 한 줄은 `--log` 명령으로 적는다. Git Bash와 PowerShell 어느 쪽에서도 같은 줄이 나와 한글이 깨지지 않는다. 적는 방법은 [`SUBAGENT_GUIDE.md`](subagent-system/docs/SUBAGENT_GUIDE.md)의 「기록과 회고」에 있다.

## 비용 어림값

agent-meter와 회고 표의 비용은 토큰 수에 API 요금을 곱한 어림값이다. 요율은 `subagent-system/rates.json`(설치 뒤 `~/.claude/subagent-system/rates.json`)에 있고, 2026-10에 [Anthropic 가격표](https://platform.claude.com/docs/en/about-claude/pricing)로 확인했다. 100만 토큰당 달러다.

| 모델 | 입력 | 캐시 쓰기(5분) | 캐시 쓰기(1시간) | 캐시 읽기 | 출력 |
|:---|---:|---:|---:|---:|---:|
| Fable 5.1 (`claude-fable-5-1`) | 10 | 12.5 | 20 | 0.25 | 50 |
| Opus 5.5 (`claude-opus-5-5`) | 4 | 5 | 8 | 0.2 | 20 |
| Sonnet 5.5 (`claude-sonnet-5-5`) | 2 | 2.5 | 4 | 0.1 | 10 |
| Haiku 5.5 (`claude-haiku-5-5`) | 0.1 | 0.125 | 0.2 | 0.01 | 0.5 |

Haiku 5.5는 프롬프트가 10만 토큰을 넘는 요청에 다섯 배 요율(입력 0.5, 출력 2.5)을 쓴다. 표에 없는 모델은 비용을 모르는 것으로 두고 회고 표에 따로 보인다. 가격이 바뀌면 회고 때 `rates.json`만 고친다. 새 모델 키는 회고 출력의 「요율표에 없는 모델」에 찍힌 이름 그대로 넣고, 가격표와 견주어 다른 모델 요율도 고친 뒤 `_checked`를 그 달로 바꾼다(agent-meter도 이 파일을 읽는다. 절차는 `subagent-system/docs/RETRO.md`).

## 공유

키트는 git 저장소로 나눈다. 받는 사람은 이렇게 한다.

```
git clone <저장소 주소>
cd <받은 폴더>
```

받은 폴더에서 위 2번(서브에이전트 체계 적용)을 그대로 한다. 키트가 새로 올라왔을 때는 그 폴더에서 `git pull`을 한 뒤 2번의 같은 문장을 다시 말하면 Claude가 `VERSION`을 비교해 업데이트한다(위 「이미 깔린 컴퓨터」. agent-meter 처리도 같은 목록에 있다). 1번으로 직접 깔았고 2번을 하지 않을 때는 `node install-agent-meter.mjs`를 다시 실행하면 다시 깔린다(터미널에서 인자 없이 실행하면 keep-alive를 다시 묻는다).

## 제거

Claude Code를 열고 이렇게 말한다.

```
<이 폴더>/subagent-system/APPLY_GUIDE.md 의 「제거」 절을 읽고 <서브에이전트 체계 / agent-meter / 둘 다> 지워줘
```

Claude가 삭제와 설정 변경마다 무엇을 바꿀지 보여 주고 확인을 받은 뒤 진행한다. `settings.json`과 `CLAUDE.md`는 고치기 전에 `.bak-remove-<날짜-시각>`으로 복사한다. 지우는 내용은 다음과 같다.

- 서브에이전트 체계: `settings.json`에서 이 키트의 SubagentStop 훅과 SessionStart 훅만 빼고(git 확인 목록을 넣었거나 `/retro` 권한 확인 대비책으로 allow 규칙을 더했으면 그 규칙만 뺄지 묻는다), 정의 10개를 지우고 백업에 같은 이름의 원본이 있으면 되돌린다. `/retro` 스킬(`~/.claude/skills/<이름>/`)을 지우고, CLAUDE.md의 표시 주석 사이를 지우고, `~/.claude/subagent-system/`(`config.json` 포함)을 지운다. 사용 기록(`records/`)은 지우기 전에 따로 묻고, 남기려면 옮길 경로를 묻는다. `records/` 안의 회고 잠금과 물을 것(`retro-pending.md`)도 같이 묻는다.
- 서브에이전트 체계를 지워도 agent-meter는 내장 요율로 돈다.
- agent-meter: `settings.json`의 `env.CLAUDE_CODE_PLUGIN_DIRS`에서 agent-meter 경로만 빼고(다른 항목은 그대로, 비면 키를 지운다), `env`에 `AGENT_METER_KEEPALIVE`가 있으면 그 키도 지운다(`env`가 비면 `env` 키도 지운다). 그 뒤 `~/.claude/mods/agent-meter`를 지운다. statusLine을 정리했으면 되돌릴지 묻는다. 서브에이전트 체계를 남기면 다음 업데이트가 agent-meter를 다시 권하지 않는다(다시 깔려면 위 「1. agent-meter만 직접 설치」로 깐다. statusLine 정리는 다음 업데이트 때 `config.json`에 정리 기록이 없으면 묻는다).
- 지운 훅은 보통 파일 감시가 바로 읽는다(공식 문서 https://code.claude.com/docs/en/hooks). 그래도 열린 세션이 지운 정의를 들고 있을 수 있어 Claude Code를 다시 열고 새 세션에서 확인한다. 설치 전에 만든 백업 폴더는 지우지 않고 남긴다.
