# 서브에이전트 라우팅과 회고 체계 적용 가이드

이 문서의 목표는 받는 사람의 환경(전역 `CLAUDE.md`, 직군, OS)이 달라도 서브에이전트 체계를 깔고, 올리고, 지울 수 있게 하는 것이다. 체계의 목표는 쓰면 쓸수록 그 사람에게 맞게 스스로 나아지는 것이다. 이 문서에 없는 것을 정해야 하면 아래 원칙으로 판단한다.

- 받는 사람의 설정과 기록을 잃지 않는다. 바꾸기 전에 백업하고, 사용자 칸과 사용자 줄은 지킨다.
- 바뀔 것을 먼저 보이고 사용자가 고르게 한다. 보이지 않은 것은 바꾸지 않는다.
- 끊겨도 이어 할 수 있게 한다. 답과 진행은 파일에 남기고, 다시 할 때 이미 답한 것은 묻지 않는다.

이 문서는 한 번에 읽히지 않을 만큼 크다. Read 도구로 절 단위로 offset을 옮겨 가며 따를 범위의 끝까지 읽고, 긴 줄이 몰린 곳(표와 긴 문단)은 더 작게 나눠 읽는다(한 번에 길게 읽으면 도구의 토큰 한도에 걸린다). 따를 범위는 요청에 따라 다르다. 머리말의 표기 규칙(`<kit-setup>` 포함)은 어느 요청이든 읽는다. 처음 설치는 문서 첫머리(이 머리말의 표기 규칙 포함)부터 「7. 보고」까지 읽고 따른다. 업데이트는 0단계와 1단계에 이어 「업데이트」 절, 제거는 「제거」 절만 따르고, 이 두 절은 그 요청일 때만 읽는다(1단계가 끊긴 설치에서 업데이트로 읽기로 정하면 그때 읽는다). 다만 처음 설치도 두 상황에서는 「업데이트」 절의 대목을 가리키는 자리에서 찾아 읽어 쓴다. 하나는 5단계 git 확인 목록이 가리키는 「체크리스트 대조」의 `checklistDeclined` 명령이고, 다른 하나는 끊긴 설치를 이어 할 때(1단계 5번) 가리키는 「업데이트 순서」 2번과 4번, 「체크리스트 대조」다. 업데이트 절은 처음 설치의 아래 대목을 가리킨다. 가리킨 대목은 그 자리에서 읽어 쓴다.

- 「2. 백업하고 파일 놓기」의 백업 명령과 「`CLAUDE_CONFIG_DIR`을 쓰는 컴퓨터」
- 「파일 놓기」 표의 놓을 곳
- 「Q. 사용자에게 물을 것」의 「묻는 방법」과 「보고 형식」과 「답 기록」의 명령, Q4의 d(agent-meter)와 후속 질문, Q4의 e(목표와 방법)
- 3단계의 「description 자르는 법」과 체크리스트 넣는 자리
- 4단계의 규칙 줄과 같은 뜻 판정 기준, 5단계의 extras 파일(목표와 방법 포함)과 git 확인 목록을 `config.json`에 남기는 명령
- 5-2단계의 설치 명령, 설치 확인, 예전 방식 치우기, 「statusLine 정리」
- 6단계 확인의 1, 2, 3, 4, 6, 7, 8, 12번
- 「7. 보고」의 메인 설정과 `outsideLinesKept`를 옮기는 명령(`keep` 인자 포함)

제거 요청도 「제거」 절이 가리키는 절 밖 대목은 그 자리에서 읽어 쓴다. 「묻는 방법」과 「보고 형식」과 「답 기록」의 명령, 「5. 함께 넣는 것」의 git 확인 목록과 글쓰기 줄, 5-2단계 「statusLine 정리」 9번의 명령, 「6. 확인」 1번과 12번이다. 설치나 업데이트가 끝나지 않아 이어 할 때(「agent-meter 제거」 5번)는 「6. 확인」 10번부터 12번과 「7. 보고」, 업데이트는 「업데이트 순서」 10번과 11번과 「업데이트 뒤 보고」도 읽는다.

이 문서는 **적용을 맡은 Claude**가 읽고 순서대로 진행한다. 사용자는 이 문서 경로를 주고 「읽고 적용해줘」라고만 한다. 처음 까는 컴퓨터인지, 이미 깔린 컴퓨터를 업데이트할지는 1단계에서 설치본의 `VERSION`으로 가린다. 질문하기 전에 0단계에서 전제부터 확인한다. `~/.claude`를 바꾸기 전에는 2단계의 백업을 먼저 하고, 지울 때는 맨 끝 「제거」 절을 따른다. 처음 까는 컴퓨터에서 `installAnswers`의 `q4AgentMeter`(Q4의 d, agent-meter)가 `true`이면 5-2단계에서 agent-meter(입력창 아래에 모델, effort, 문맥, 토큰, 어림 비용, 캐시 표를 그리는 mod)도 함께 깐다(이미 깔려 있으면 묻지 않고 새 버전으로 갱신한다). 사용자에게 묻는 모든 곳은 「Q. 사용자에게 물을 것」 첫머리의 「묻는 방법」을 따른다.

설치 위치는 이 컴퓨터의 `~/.claude` 하나뿐이다. 프로젝트 저장소에는 아무것도 넣지 않는다. `CLAUDE_CONFIG_DIR`을 쓰는 컴퓨터는 이 문서의 `~/.claude`를 그 폴더로 바꿔 읽고, 설치본 파일에 적히는 경로도 그 폴더로 바꿔 넣는다(「2. 백업하고 파일 놓기」의 「`CLAUDE_CONFIG_DIR`을 쓰는 컴퓨터」).

프로젝트 설정 파일은 이렇게 읽는다. 이 문서의 「현재 프로젝트의 `.claude/…`」 파일은 모두 이 규칙을 따른다. 공유용 `.claude/settings.json`은 지금 연 폴더의 것이다. 개인용 `.claude/settings.local.json`은 지금 연 폴더가 git 저장소 안이면 하위 폴더에서 열었어도 저장소 최상위의 것이다(워크트리는 메인 체크아웃의 최상위). 저장소 밖이거나, 최상위가 홈 폴더이거나, Windows이거나, 최상위나 그 `.git`, `.claude`가 사용자 소유가 아니면 지금 연 폴더의 것이다. 옛 버전이 지금 연 폴더에 남긴 `settings.local.json`도 함께 읽히고 같은 키는 최상위 값이 이긴다(근거 https://code.claude.com/docs/en/settings 의 「Where Claude Code keeps the local file in a git repository」). 지금 연 폴더의 `.claude`가 사용자 설정 폴더(`~/.claude`, `CLAUDE_CONFIG_DIR`이 있으면 그 폴더)와 같은 폴더이면(예: `CLAUDE_CONFIG_DIR`이 없을 때 홈 폴더에서 연 경우) 그 폴더의 `settings.json`은 사용자 설정으로만 읽고, `settings.local.json`은 프로젝트 로컬 파일로 읽는다. 같은 파일을 사용자 설정과 프로젝트 설정으로 두 번 읽지 않는다는 뜻이다. 사용자 범위 파일은 `settings.json` 하나뿐이라 두 번 읽힐 수 있는 것도 그 파일뿐이다(근거 https://code.claude.com/docs/en/settings 의 「Settings files and who they affect」 표). 이 문서의 「저장소」는 지금 연 프로젝트 저장소를 뜻한다.

Windows는 Git for Windows(Git Bash 포함)가 있어야 한다. 이 문서의 `grep`, 글롭, `ls`, `VAR=값 명령` 꼴의 확인 명령은 Git Bash(Windows) 또는 터미널(macOS, 리눅스)에서 실행한다. PowerShell용 명령은 따로 적지 않는다. Windows에서는 이 문서의 명령을 PowerShell 도구가 아니라 Bash 도구(Git Bash)로 실행한다. 사용 기록을 적는 `--log` 명령만 셸과 상관없이 같은 결과가 나온다.

`settings.json`과 `config.json`을 고치고 백업을 만드는 명령은 키트의 `scripts/kit-setup.js`로 돌린다. 이 문서는 `node "<키트>/subagent-system/scripts/kit-setup.js"`를 `<kit-setup>`으로 줄여 적고, `<키트>`는 이 문서 옆 `subagent-system/`이 든 폴더다. 설치본 스크립트가 아직 없거나 옛 버전이어도 돌도록 설치본이 아니라 키트의 것으로 돌리며, 이 파일은 다른 스크립트를 불러오지 않는다. 명령이 오류로 멈추면 오류 출력에 까닭을 찍고 종료 코드 1이며, 파일은 쓰기 전에 모두 읽고 검사하므로 그때는 바뀌지 않았다. 오류는 사용자에게 보이고 멈춘다.

macOS의 기본 셸은 zsh다. 이 문서의 명령은 bash와 zsh에서 같게 돈다. 다만 글롭(`*`)에 맞는 파일이 하나도 없으면 bash는 글롭을 그대로 넘겨 `ls`가 「No such file or directory」를 찍고, zsh는 명령을 돌리지 않고 `zsh: no matches found`를 찍는다. 둘 다 「그런 파일이 없다」는 뜻으로 읽는다. 종료 코드는 명령 바로 뒤에 `echo $?`로 보고 파이프 뒤에서는 보지 않는다. bash 전용 표기(`PIPESTATUS`, `[[ ]]`, `${!변수}`)는 셸마다 다르게 돌아 이 문서의 명령에도, 적용하는 Claude가 새로 만드는 명령에도 쓰지 않는다.

## 이 체계가 하는 일

- **라우팅**: 서브에이전트를 모델(Haiku, Sonnet, Opus)과 effort(low부터 xhigh)를 묶은 정의 10개(회고가 지운 정의는 뺀 수다)로 부른다. 어떤 일을 어느 정의로 보낼지는 `~/.claude/subagent-system/docs/SUBAGENT_GUIDE.md`의 표로 정한다. 표에 정한 정의로 보내고, 애매하면 `opus-medium`으로 보낸다. 결과가 모자라면 원인에 따라 effort나 모델을 한 단계 올린다. 비용은 회고의 내려 보기가 줄인다. 표는 설치할 때 사용자가 하는 일을 물어 직군별 출발 표(`docs/ROUTING_PRESETS.md`)로 만들고, 회고로 고쳐 간다.
- **지시문 체크리스트**: 서브에이전트에 일을 보내기 전에 대조하는 목록(`docs/SUBAGENT_BRIEF_CHECKLIST.md`)이다. 설치할 때 직군과 상관없는 공통 줄에 고른 직군의 줄(`docs/ROUTING_PRESETS.md`)을 더해 시작하고, 그 뒤로는 결과가 모자랐던 원인이 지시문이면 회고가 어느 지시에나 걸리는 문장으로 쌓는다.
- **측정**: 서브에이전트가 끝날 때마다 SubagentStop 훅이 그 에이전트의 입력, 캐시 쓰기, 캐시 읽기, 출력 토큰과 어림 비용을 `subagent-cost.tsv`에 저절로 적는다. 메인은 일 종류와 결과를 `subagent-retro.js --log`로 `subagent-usage.tsv`에 한 줄 적는다. 두 기록은 프로젝트와 상관없이 `~/.claude/subagent-system/records/` 한 곳에 쌓이고, 줄마다 프로젝트 열이 있다.
- **회고**: 기록이 쌓이면 `subagent-retro.js`가 두 기록을 짝지어 (정의, 일 종류)별 건수, 비용, 시간과 칸을 옮길 후보를 찍는다. 사용자가 고쳐 말한 메시지는 표의 「회고 정정 분류」 칸의 정의(처음에는 Haiku)가 분류해 정정 기록으로 쌓는다. 이걸 보고 표를 고친다. 표에 맞는 칸이 없어 메인이 새 이름으로 기록한 일은 「표에 없는 일 종류」로 따로 찍히고, 회고 때 표에 들어간다(사용자가 뺀 이름은 `(사용자가 뺐거나 회고가 쪼갠 옛 이름)` 표시가 붙어 들어가지 않고 묻고, 표에 `<이름>[기준]` 꼴 칸이 있는 이름은 `(회고가 쪼갠 옛 이름)`이라 묻지도 않는다). 회고는 모든 프로젝트의 기록을 한 번에 보고, 대화 기록에서 자주 반복되는 지시와 작업(`--repeats`)을 찾아 스킬(스크립트를 담은 것 포함)이나 규칙으로 만들자고 제안해 토큰을 줄인다(만드는 것은 사용자가 승인한 뒤다). 지난 회고 뒤 합계 시간이 가장 큰 일(칸이나 절차) 1건은 작업 기록을 서브에이전트(표의 「작업 기록 병목 분석」 칸의 정의)가 읽어 낭비와 개선안을 찾고, 기록으로 볼 수 없는 곳은 측정 요청으로 내며, 적용한 개선은 다음 회고가 전후 시간을 견준다. 메인 세션 비용이 서브에이전트 비용에 견주어 얼마나 되는지도 보고, 줄일 곳을 제안한다. 전역 `CLAUDE.md`와 회고 구간에 나온 프로젝트의 `CLAUDE.md`가 기준 줄 수를 넘으면 줄일 곳을 제안하고, 회고 구간에 쓴 스킬과 프로젝트 `CLAUDE.md` 가운데 지난 검토 뒤 바뀐 것은 `RETRO.md`의 「문서 검토 기준」으로 읽어 모순, 중복, 뺄 것, 보강할 곳을 제안한다(고치는 것은 사용자가 고른 뒤다). 회고 방식은 둘이다. 기본인 묻기는 회고할 때가 되면 사용자에게 묻고, 자동은 회고할지는 묻지 않고 회고 서브에이전트를 백그라운드로 띄워 판단이 필요하지 않은 것만 바로 고치고 나머지는 모아 두었다가 묻는다(다만 `~/.claude` 파일을 고칠 때 권한 확인 창이 뜰 수 있고, 자동 회고가 두 번 이어 실패하면 묻기로 돌아간다). `/retro` 커맨드로 방식을 바꾸고 상태를 본다. 회고할 때인지는 작업 하나가 끝날 때 메인이 확인하고, 묻는다면 그 최종 보고 끝에서 묻는다. 건수가 모자라도 마지막 회고(또는 기간 기준을 미룬 날) 뒤 대화 기록 보존 기간이 가까워지면 묻는다.

## 들어 있는 것

| 경로 | 내용 |
|:---|:---|
| `agents/*.md` | 정의 10개(haiku-low, haiku-medium, haiku-high, sonnet-low, sonnet-medium, sonnet-high, opus-low, opus-medium, opus-high, opus-xhigh) |
| `docs/SUBAGENT_GUIDE.md` | 모델 선택 표, 올리기 규칙, 내려 보기 시험 규칙, 기록 규칙 |
| `docs/RETRO.md` | 회고 절차(추출, 분류, 후보 판정, 요율 갱신, 경계 표시) |
| `docs/ROUTING_PRESETS.md` | 직군별 출발 표 여섯 개, 처음 설치 때 여러 직군을 합치는 규칙, 직군별 「무조건 Opus」 기본안과 지시문 체크리스트 기본 줄. 키트에서만 읽고 설치하지 않는다(설치 문답과 업데이트의 체크리스트 대조가 키트 사본을 읽는다) |
| `docs/SUBAGENT_BRIEF_CHECKLIST.md` | 지시문 체크리스트의 공통 줄(직군 줄은 설치할 때 3단계에서 더한다) |
| `rates.json` | 모델별 요율표(100만 토큰당 달러)와 출처, 확인 날짜. `scripts/`의 한 단계 위에 둔다 |
| `scripts/subagent-usage.js` | 훅 모드(`--hook`)로 비용 기록, 세션별 집계, 요율 갱신 뒤 지난 `?` 비용을 채우는 `--recost` |
| `scripts/subagent-retro.js` | 회고 표, 후보, 정정 기록, 반복 찾기(`--repeats`), 회고 경계, 기록 폴더 확인(`--where`), 표에 없는 일 이름 확인(`--kinds`), 사용자가 표에서 뺀 일 이름을 남기고 되돌리는 `--remove-kind`와 `--restore-kind`, 회고가 지운 정의 이름을 남기고 되돌리는 `--remove-def`와 `--restore-def`, 사용 기록의 `모자람` 줄 모으기(`--shortfalls`), 규칙과 체크리스트를 고친 기록을 남기는 `--fix`와 고친 뒤 효과를 가려 처리할 것을 찍는 `--fixes`, Fable 5.1로 보낸 에이전트가 Fable로 돌았는지 보는 `--check-fable`, 사용 기록 한 줄 덧붙이기(`--log`), 회고 방식 읽기와 쓰기(`--retro-mode`), CLAUDE.md 정리를 묻고 마친 뒤 줄 수를 적거나 지우는 `--claude-md-done`, 문서 내용 검토 대상을 찍는 `--docs`와 검토를 마친 문서를 남기는 `--docs-done`, 키트가 통째로 바꾸는 설치본 파일의 해시를 `config.json`에 남기고 견주는 `--record-kit-hashes`와 `--check-kit-hashes`, 자동 회고 잠금(`--claim`, `--release`)과 자동 회고가 실패했을 때 횟수를 세는 `--release --failed`, `/retro`가 부르는 `--status`와 `--slash` |
| `scripts/agent-time-breakdown.js` | 서브에이전트가 걸린 시간이 모델 생각, 도구 실행, 사용자 기다림, 그 밖 중 어디에 드는지 일 종류별로 쪼갬. 오래 걸리는 일이 생겼을 때 부른다 |
| `scripts/speed-review.js` | 회고의 「속도와 비용 보기」가 부른다. 지난 회고 뒤 합계 시간이 가장 큰 칸이나 절차 1건을 골라 리뷰어가 읽을 자료 파일을 만들고(`--pick --out`), 측정 결과와 개선 적용을 속도 기록(`records/speed-log.tsv`)에 남기며(`--measure`, `--applied`), 적용 전후 시간을 견줘 찍는다(`--effects`) |
| `scripts/main-session-cost.js` | 메인 세션이 쓴 비용을 프로젝트별로 세어 서브에이전트 비용과 견줌. 회고의 「속도와 비용 보기」가 부른다 |
| `scripts/subagentRetroHelpers.js`, `scripts/claudeProjectPaths.js`, `scripts/transcriptTiming.js`, `scripts/speedReviewHelpers.js` | 위 스크립트들이 쓰는 모듈. 앞의 둘은 회고와 경로, `transcriptTiming.js`는 대화 기록에서 시간을 재는 계산, `speedReviewHelpers.js`는 절차 회차 찾기와 대상 고르기 |
| `scripts/kit-setup.js` | 설치, 업데이트, 제거가 `settings.json`과 `config.json`을 고치고 백업을 만드는 명령 모음(`<kit-setup>`). 키트의 것으로 돌려 설치본 스크립트가 아직 없거나 옛 버전이어도 쓴다 |
| `scripts/package.json` | 스크립트가 ES 모듈임을 알리는 `{"type": "module"}` |
| `scripts/tests/subagentRetroHelpers.test.js`, `scripts/tests/subagentCli.test.js`, `scripts/tests/kitSetup.test.js`, `scripts/tests/agentCostTime.test.js`, `scripts/tests/transcriptTiming.test.js`, `scripts/tests/speedReview.test.js` | 회고 계산, 반복 찾기, `--log`, 회고 방식과 잠금, 시간 쪼개기와 메인 비용 스크립트, 대화 기록 시간 재기, 속도 분석 스크립트 시험(Node 내장 `node:test`) |
| `skills/retro/SKILL.md` | `/retro` 슬래시 커맨드(Claude Code 문서가 새 커맨드는 스킬로 만들라고 권하는 형식). 설치하면 `~/.claude/skills/<이름>/SKILL.md`로 간다 |
| `settings-hook.json` | SubagentStop 훅 설정 조각 |
| `config.json` | 키트에는 없다. 설치할 때 Q5와 Q6의 답으로 `~/.claude/subagent-system/config.json`에 만든다(`{"retroMode": "ask" 또는 "auto"}`, 규칙과 체크리스트를 묻지 않고 바로 고칠지는 Q6의 답으로 `autoApplyRules`(참거짓)에 쓰고 키가 없을 때만 참으로 읽으며 설정 파일이 깨졌으면 거짓으로 읽는다, Q1에서 고른 직군은 `roles`, 커맨드 이름을 바꿨으면 `commandName`도, 자동 회고가 실패하면 스크립트가 `retroFailures`도 쓴다. 회고가 정의를 지우면 그 이름을 `removedDefs`(배열)에 더한다. 사용자가 표에서 일 이름을 빼 달라고 하면 `subagent-retro.js --remove-kind`가 그 이름을 `removedKinds`(배열)에 더하고 `--restore-kind`가 뺀다(회고가 그 이름을 표에 다시 넣지 않고 묻게 한다). 업데이트의 체크리스트 대조가 `checklistDeclined`, `checklistKept`, `checklistSyncedVersion`을 쓰고, 처음 설치는 Q2부터 Q4의 답, 같은 이벤트의 기존 훅을 더하기로 한 답, 고치지 않겠다고 한 표시 밖 줄(4단계와 5단계), 5-1단계를 마쳤다는 표시를 끊긴 설치를 이어 할 때 다시 묻지 않으려고 `installAnswers`(객체)에 쓰고, 설치를 마치면 지운다(키와 값은 「Q. 사용자에게 물을 것」의 「답 기록」). 다만 고치지 않겠다고 한 표시 밖 줄은 지우기 전에 최상위 `outsideLinesKept`(배열, 값은 `{"line": 표시 밖 줄 원문, "kit": 그때 견준 키트 문장}`)로 옮겨 남긴다. 업데이트가 같은 줄을 다시 묻지 않고, 그 줄의 키트 문장이 달라졌을 때만 묻게 하려는 것이다. 처음 설치(6단계 8번)와 업데이트(「업데이트 순서」 9번)는 키트가 통째로 바꾸는 설치본 파일(스크립트 폴더 전체, `RETRO.md`, GUIDE의 사용자 구역 밖, 정의의 description과 글쓰기 줄 밖, `/retro` 스킬)의 sha256을 `kitFileHashes`(객체, `{설정 폴더 아래 경로: sha256}`)에 `subagent-retro.js --record-kit-hashes`로 쓴다. 업데이트 3번이 `--check-kit-hashes --kit <키트>`로 설치본이 기록과 다른 파일 가운데 새 키트와 같지 않은 것만 사용자가 손으로 고친 파일로 가린다. git 확인 목록에서 설치 때 뺀 항목과 업데이트에서 거절한 항목은 `gitAskDeclined`(배열)에 쓴다. 업데이트에서 agent-meter를 새로 까는 질문을 거절하거나 「제거」 절에서 agent-meter만 지우거나 5-2단계 3번의 오류 갈래(조직 설정이 마켓플레이스 출처를 막아 설치가 거절됨)를 만나면 `agentMeterDeclined`(`true`)를(agent-meter가 깔려 있으면 업데이트 7번이 이 키와 상관없이 갱신한다), keep-alive를 켤지 물었으면 `agentMeterKeepaliveAsked`(`true`)를(5-2단계 3번), statusLine 정리를 마치면 고른 답이나 해당 없음(고칠 수 있는 statusLine이 있었는데 겹침이 없었음)을 `statusLineCleanup`(문자열)에 쓴다(처음 설치의 5-2단계도 쓴다. 고칠 수 있는 statusLine이 없어 정리할 것이 없었던 경우는 쓰지 않는다. 셋 다 없거나 고칠 수 없는 쪽만 있어 알리기만 한 경우다). 「제거」 절은 agent-meter만 지우면서 statusLine을 되돌렸으면 `statusLineCleanup`을 지운다. 5단계에서 목표와 방법(Q4 e)을 넣지 않기로 했거나 업데이트 5번에서 거절하면 `goalMethodDeclined`(`true`)를 쓴다. `roles`, `installAnswers`, `outsideLinesKept`, `checklistDeclined`, `checklistKept`, `checklistSyncedVersion`, `gitAskDeclined`, `agentMeterDeclined`, `agentMeterKeepaliveAsked`, `statusLineCleanup`, `goalMethodDeclined`는 스크립트가 읽지 않고 이 문서의 절차만 쓴다(스크립트는 설정 파일의 모르는 키를 지우거나 오류로 보지 않고 그대로 둔다). `kitFileHashes`는 `--record-kit-hashes`와 `--check-kit-hashes`만 읽고 쓴다(`--check-kit-hashes`는 `removedDefs`도 읽는다). CLAUDE.md 정리를 묻고 마친 뒤 `--claude-md-done`이 전체가 기준 줄 수를 넘으면 그때의 전체 줄 수를 `claudeMdKeptLines`(정수)에 쓰고(5-1단계도 쓴다) 기준 이하이면 지운다. 회고 스크립트가 읽고, 회고 밖에서 기준 이하가 되면 회고 출력 때도 지운다. 기준 줄 수는 사용자가 `claudeMdLimitLines`(정수)로 바꿀 수 있고 전역과 프로젝트 `CLAUDE.md`에 같이 쓰인다. 기본값과 다시 제안하기까지의 여유는 `RETRO.md`의 「반복 찾기」 가운데 CLAUDE.md 정리 항목에 있다. 회고의 문서 내용 검토가 마친 문서의 해시는 `subagent-retro.js --docs-done`이 `docReviewHashes`(객체)에 쓰고 `--docs`가 읽는다. 둘 다 스크립트가 읽는 키다) |
| `VERSION` | 키트 버전 한 줄(`YYYY.M.D` 또는 같은 날 두 번째 이후 변경의 `YYYY.M.D.N`). 설치할 때 `~/.claude/subagent-system/VERSION`으로 복사하고, 1단계가 설치본과 비교해 처음 설치, 업데이트, 이미 이 버전을 가린다 |
| `CHANGES.md` | 버전마다 바뀐 것. 업데이트한 뒤 사용자에게 새 항목을 보여 주는 데만 읽고 설치하지 않는다 |
| `BACKGROUND.md` | 모델 선택 규칙의 근거(공식 모델 표, 출처 주소, 측정 수치, 설계 까닭). 참고용이라 설치하지 않는다 |
| `../CLAUDE.md` | 키트 폴더 맨 위의 키트 관리용 지침이다. 키트를 고치는 사람이 읽는 문서라 설치하지 않고 업데이트도 복사하지 않는다 |
| `../.claude-plugin/marketplace.json`, `../agent-meter/` | 이 폴더(`subagent-system/`)의 한 단계 위, 키트 폴더에 있다. 키트 저장소(GitHub `daum7766/claude-token-save`)가 플러그인 마켓플레이스(이름 `claude-token-save`)이고 `agent-meter/`가 그 플러그인이다. 키트 폴더의 파일을 복사하지 않고, `installAnswers`의 `q4AgentMeter`가 `true`이면 5-2단계가 `claude plugin install agent-meter --marketplace daum7766/claude-token-save`로 깐다. 업데이트에서 갱신하거나 새로 까는 절차와 예전 방식(키트의 설치 스크립트)으로 깐 컴퓨터를 옮기는 절차는 「업데이트 순서」 7번이다 |

이 문서에서 「정의 10개」는 키트가 주는 정의의 수다. 회고가 일이 남지 않은 칸의 정의를 지우면 그 이름이 `config.json`의 `removedDefs`에 남으므로, 설치본에는 10개보다 적을 수 있고 이 문서의 정의 10개는 그 이름을 뺀 수로 읽는다.

채울 자리는 둘이고, 둘 다 `SUBAGENT_GUIDE.md`에 있다. 각 자리는 짝을 이룬 표시 주석으로 감싸여 있다. 이와 따로 GUIDE에는 셋째 표시 쌍(`<!-- 사용자 규칙 시작 -->`, `<!-- 사용자 규칙 끝 -->`)이 있다. 회고가 GUIDE의 공통 문장을 고칠 때 쓰는 구역이라 처음 설치에서는 채우지 않고 키트의 빈 구역 그대로 둔다. 업데이트할 때 표시 사이가 사용자 칸으로 지켜지므로 표시 주석은 지우지 않는다.

| 자리 | 표시 주석 | 채울 값 |
|:---|:---|:---|
| 모델 배정 표 | `<!-- 사용자 표 시작 -->`, `<!-- 사용자 표 끝 -->` | Q1에서 고른 직군 표(고르지 않았으면 기획과 문서 표)를 `ROUTING_PRESETS.md`에서 가져와 합치고, Q2에서 사용자가 더한 일을 넣는다. 키트 GUIDE에는 놓기 전에 바꿀 원본으로 백엔드 표가 들어 있다. 표시 바로 아래의 안내 주석 줄(키트 원본의 예시라는 뜻)도 표시 사이라 함께 바뀌어 설치본에 남지 않는다 |
| 「무조건 Opus」 목록 | `<!-- 무조건 Opus 시작 -->`, `<!-- 무조건 Opus 끝 -->` | Q1에서 고른 직군의 기본안(고르지 않았으면 기획과 문서 기본안, `ROUTING_PRESETS.md`)을 합쳐 Q3에서 사용자와 확정한다. 키트 GUIDE에는 놓기 전에 바꿀 원본으로 백엔드 기본안이 들어 있다. 이 표시 아래의 안내 주석 줄도 함께 바뀐다 |

이와 따로 `SUBAGENT_BRIEF_CHECKLIST.md`에 Q1에서 고른 직군의 체크리스트 줄을 더한다(3단계. 고르지 않았으면 더하지 않는다). 표시 주석 없이 파일 전체가 사용자 것이 되고, 업데이트는 사용자가 고른 줄만 지우거나 바꾼다(「체크리스트 대조」).

## 0. 전제 확인

질문과 설치 전에 먼저 한다. 전제가 안 맞으면 사용자가 다섯 질문에 답한 뒤에야 멈추는 일이 없게 하려는 것이다. 처음 설치와 업데이트 모두 한다. 아래 명령은 Git Bash(Windows) 또는 터미널(macOS, 리눅스)에서 실행한다.

- Windows인지 `node -p "process.platform"`으로 본다(`win32`면 Windows). Windows면 `git --version`이 `windows`가 든 버전(예 `git version 2.47.0.windows.1`)을 찍어야 Git for Windows가 있는 것이다. 명령이 없거나 `windows`가 없으면 https://git-scm.com/download/win 에서 Git for Windows를 설치하라고 안내하고 **멈춘다**. 설치한 뒤 Claude Code를 닫고, 같은 폴더에서 `claude --continue`로 이 대화를 이어 열어 달라고 한다. 이어 연 세션이 이 단계부터 다시 확인한다.
- `claude --version`이 **2.1.293 이상**인지 본다. 낮으면 멈추고 업데이트를 안내한다. 설치 방식별 명령은 `claude update`(네이티브), `brew upgrade claude-code` 또는 `brew upgrade claude-code@latest`(Homebrew), `winget upgrade Anthropic.ClaudeCode`(WinGet), `npm install -g @anthropic-ai/claude-code@latest`(npm)이고, 출처는 https://code.claude.com/docs/en/setup 이다. 업데이트한 뒤에는 위와 같이 `claude --continue`로 이 대화를 이어 열어 달라고 한다. 2.1.293은 정의 `haiku-*`가 쓰는 Haiku 5.5가 요구하는 버전이고, 키트에서 가장 높다(Opus 5.5는 2.1.280, Sonnet 5.5는 2.1.284, `settings.json`에 `modelSettings.<모델>.autoCompactWindow`를 직접 적는 기능은 2.1.288, 출처는 https://code.claude.com/docs/en/model-config). 버전이 넘더라도 모델과 Claude Code는 되도록 최신 버전을 쓰기를 권한다고 알린다.
- `node --version`이 18 이상인지 본다. 없으면 멈추고 사용자에게 설치를 청한다.
- 환경변수를 찾는 곳과 순서: 이 키트가 읽는 환경변수(아래 알림들의 변수와, 「7. 보고」가 읽는 `CLAUDE_CODE_EFFORT_LEVEL`, `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, `CLAUDE_CODE_DISABLE_1M_CONTEXT`, `ANTHROPIC_MODEL`)는 셸 환경, 프로젝트 `.claude/settings.local.json`의 `env`, 프로젝트 `.claude/settings.json`의 `env`, 사용자 `settings.json`의 `env`를 모두 찾는다(프로젝트 두 파일을 어디서 읽는지와, 사용자 설정 폴더와 같은 폴더가 되면 프로젝트 `settings.json`은 사용자 `settings.json`과 같은 파일이라 한 번만 읽는 것은 맨 위 규칙을 따른다). 같은 변수가 여러 곳에 있으면 프로젝트 로컬, 프로젝트, 사용자, 셸 순으로 먼저 있는 값을 쓴다. 설정 파일의 `env` 값이 셸에서 내보낸 같은 변수를 덮어쓰기 때문이고(근거 https://code.claude.com/docs/en/settings-reference 의 「How `env` values interact with your shell」, https://code.claude.com/docs/en/env-vars 의 「Precedence」), 파일 사이 순서는 설정 우선순위를 따른다(https://code.claude.com/docs/en/settings 의 「Settings precedence」). Claude Desktop 앱이나 자체 호스팅 환경 러너가 연 세션은 그 실행 환경이 이미 정한 변수의 `env` 값을 무시하므로 이 순서가 맞지 않을 수 있다. 이 판정에는 조직 관리 설정과 `--settings` 파일의 `env`를 넣지 않으므로 `미확인`이다(관리 설정 파일은 아래 관리 설정 항목의 네 값만 읽는다). 변수를 찾았으면 읽은 곳을 적는다. 변수가 설정 파일들 가운데 한 곳에라도 있으면 읽은 곳은 그 파일(위 순서로 가장 먼저 적용되는 파일)이고, 어느 파일에도 없을 때만 셸이다(설정 파일 `env` 값은 Claude Code가 시작하는 모든 하위 프로세스에 전달되므로 Bash의 `printenv`에는 파일에서 온 값도 셸 값처럼 보인다. 근거 https://code.claude.com/docs/en/settings-reference 의 「How `env` values interact with your shell」). 프로젝트 파일에서 찾은 것은 그 프로젝트에서 연 세션에만 적용된다고 알린다.
- 위 곳들에 `CLAUDE_CODE_EFFORT_LEVEL`(정의의 effort를 덮어쓴다)이 있거나 `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`(정의의 모델을 덮어쓴다. `CLAUDE_CODE_SUBAGENT_MODEL`도 함께 있으면 그 모델로, 없으면 메인 모델로 돈다. 호출에서 넘기는 모델도 막혀 마지막 올리기 단계의 Fable 5.1도 그 모델로 돈다)가 켜져 있으면(값이 `1`, `true`, `yes`, `on`이면 켜진 것이고 대소문자는 가리지 않는다. 근거 https://code.claude.com/docs/en/env-vars 의 「Variables」 머리말) 그 사실을 사용자에게 알린다. `CLAUDE_CODE_SUBAGENT_MODEL` 혼자는 호출과 정의에 모델이 없을 때의 기본값이라 정의를 덮어쓰지 않으므로 알리지 않는다(근거 https://code.claude.com/docs/en/sub-agents 의 「Choose a model」과 「Run every subagent on one model」).
- 환경변수를 찾는 설정 파일들(프로젝트 `.claude/settings.local.json`, 프로젝트 `.claude/settings.json`, 사용자 `settings.json`)의 최상위나 `modelSettings.<모델>`에 `maxEffortLevel`(effort 상한)이 `low`, `medium`, `high`, `xhigh` 가운데 하나로 있으면, 정의의 effort와 `/effort`가 그 값보다 높아도 그 값으로 돈다고 알린다(파일마다 `modelSettings.<모델>`의 값이 그 파일의 최상위 값을 그 모델에서 대신하고, 여러 파일에 있으면 가장 낮은 값이 쓰이며, `max`는 상한이 없는 값이다. 근거 https://code.claude.com/docs/en/settings-reference 의 `maxEffortLevel`. 이 판정에는 조직 관리 설정과 `--settings` 파일의 값을 넣지 않으므로 `미확인`. 관리 설정 파일은 아래 관리 설정 항목의 네 값만 읽는다).
- 위 곳들에서 `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_USE_FOUNDRY`, `CLAUDE_CODE_USE_ANTHROPIC_AWS`(Claude Platform on AWS) 가운데 하나가 켜져 있으면, 정의의 `opus`, `sonnet`, `haiku`가 effort를 일부만 지원하거나 지원하지 않는 이전 모델로 풀릴 수 있어 같은 모델의 effort 칸이 같은 동작이 될 수 있다고 알린다. 공급자별로 어느 모델로 풀리는지는 공식 문서의 별칭 표에 있고, `ANTHROPIC_DEFAULT_OPUS_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL`, `ANTHROPIC_DEFAULT_HAIKU_MODEL`로 고정할 수 있다고 안내한다. 고정한 ID를 Claude Code가 알아보지 못하면(Foundry 배포 이름 등) `ANTHROPIC_DEFAULT_<계열>_MODEL_SUPPORTED_CAPABILITIES`에 `effort`를 적어야 effort가 켜진다고 함께 안내한다(출처 https://code.claude.com/docs/en/model-config 의 「Pin models for third-party deployments」와 「Customize pinned model display and capabilities」, https://code.claude.com/docs/en/claude-platform-on-aws). 이 알림들은 모두 설정을 고치지 않는다.
- 설정 파일에서 `disableAllHooks`를 읽는다. 쓰이는 값은 설정 우선순위를 적용하고 남은 값이라, 프로젝트 `.claude/settings.local.json`, 프로젝트 `.claude/settings.json`, 사용자 `settings.json`(읽는 법은 맨 위 규칙) 가운데 먼저 값이 있는 파일의 값이다(위쪽 파일의 `false`가 아래쪽 파일의 `true`를 이긴다. 근거 https://code.claude.com/docs/en/hooks 의 「Disable or remove hooks」). `true`이면 이 키트의 훅(SubagentStop)과 agent-meter와 사용자의 상태줄(`statusLine`)이 멈추고(근거 https://code.claude.com/docs/en/settings-reference 의 `disableAllHooks`), 비용이 기록되지 않아 회고도 돌지 않는다고 알린다. 어느 파일의 값인지 나눠 알린다. 사용자 `settings.json`의 `true`는 프로젝트 파일이 `false`로 덮지 않은 모든 세션에 걸리고, 프로젝트 파일(프로젝트 로컬, 프로젝트)의 `true`는 그 프로젝트에서 연 세션에만 걸린다(위 환경변수 규칙의 「프로젝트 파일에서 찾은 것은 그 프로젝트 세션에만」과 같은 방식이다). 어느 쪽이든 더 위쪽 파일이 `false`로 덮은 자리에서는 돈다(사용자 `true`를 프로젝트 파일이 덮는 경우와 프로젝트 `settings.json`의 `true`를 `settings.local.json`이 덮는 경우 모두). 사용자 `settings.json`이 `true`인데 지금 폴더의 프로젝트 파일이 `false`이면 지금 폴더에서는 돌지만 다른 프로젝트에서는 멈춘다고 알린다. 바꾸지 않는다. 6단계 10번이 실패하면 이 값이 원인 후보다.
- 읽을 수 있는 관리 설정 파일을 읽는다. 파일은 `managed-settings.json`을 먼저, 이어 같은 폴더의 `managed-settings.d/*.json`을 알파벳 순으로 합친 것이고, 같은 단일 값은 뒤 파일이 이긴다. 폴더는 macOS가 `/Library/Application Support/ClaudeCode/`, Linux와 WSL이 `/etc/claude-code/`, Windows가 `C:\Program Files\ClaudeCode\`다(근거 https://code.claude.com/docs/en/managed-settings 의 「Place the file on each machine」, 합치는 법은 「Split a file-based policy across teams」, 폴더 이름은 「Where each mechanism stores the policy」). 서버 관리 설정이나 MDM(기기 관리 도구) 정책이 함께 있으면 기본값(`first-wins`)에 따라 가장 높은 출처 하나만 쓰이고 파일은 통째로 무시될 수 있다(근거 같은 문서의 「How Claude Code combines managed sources」). 그래서 파일에서 읽은 값은 모두 「다른 관리 설정 출처가 있으면 쓰이지 않을 수 있다」는 단서를 달아 알리고, 어느 출처가 쓰이는지는 `/status`의 `Setting sources` 줄로 볼 수 있다고 한 줄 덧붙인다(근거 같은 문서의 「Read the source in /status」). 서버, MDM, Windows 레지스트리로 내려오는 값은 파일로 읽지 못하므로 `미확인`이다.
  - `strictKnownMarketplaces`(마켓플레이스 허용 목록)나 `blockedMarketplaces`(차단 목록)가 있으면 agent-meter가 깔리는지 본다. agent-meter는 GitHub 저장소 `daum7766/claude-token-save`를 마켓플레이스로 등록해 까는데, 설치 명령도 `claude plugin marketplace add`와 같은 조직 정책 검사를 받는다(근거 https://code.claude.com/docs/en/plugins/install 의 「Add and install from your shell」). 허용 목록이 있는데 `{"source": "github", "repo": "daum7766/claude-token-save"}`나 `daum7766/*`나 이 출처에 맞는 `hostPattern`이 없거나, 차단 목록이 이 저장소(또는 `daum7766/*`나 맞는 `hostPattern`)를 막으면 이 컴퓨터에는 깔 수 없다고 알리고, Q4의 d와 「업데이트 순서」 7번의 agent-meter를 하지 않는다(근거 https://code.claude.com/docs/en/plugins/marketplace-reference 의 「Marketplace sources」). 파일로 읽지 못한 서버나 MDM의 값은 5-2단계 3번이 설치 명령의 거절로 가린다.
  - `allowManagedHooksOnly`나 `disableAllHooks`가 `true`이면 이 키트의 훅(비용 기록)과 agent-meter가 돌지 않고 사용자의 상태줄(`statusLine`)도 멈춘다고 알리고(`allowManagedHooksOnly`일 때는 관리 설정이 내려 준 상태줄만 돈다. 근거 https://code.claude.com/docs/en/settings-reference 의 `allowManagedHooksOnly`와 `disableAllHooks`와 「Status line and file suggestion gates」, https://code.claude.com/docs/en/plugins/mods/admin 의 「Choose how much to allow」), 설치는 이어 간다. 바꾸지 않는다. 6단계 10번이 실패하면 이 값이 원인 후보다.

## 1. 처음 까는 컴퓨터인지, 업데이트할 컴퓨터인지 가린다

기능이 있는지가 아니라 설치본의 `~/.claude/subagent-system/VERSION` 파일로 가린다. 0단계 전제 확인을 통과한 뒤에 한다. 아래 명령은 Git Bash 또는 터미널에서 실행한다. 이 단계의 「훅」은 명령에 `subagent-usage.js`가 든 SubagentStop 훅(이 키트가 놓는 것)만 뜻한다. 그 밖의 SubagentStop 훅은 가림에 쓰지 않고 2단계 「기존 훅 확인」에서 다룬다. 아래를 순서대로 본다.

1. `~/.claude/settings.json`과 현재 프로젝트의 `.claude/settings.json`(맨 위 규칙으로 사용자 설정 폴더와 같은 폴더가 되면 `~/.claude/settings.json`과 같은 파일이라 따로 읽지 않는다)에서 SubagentStop 훅 명령을 읽어 `subagent-usage.js` 경로를 찾는다.
2. 훅의 스크립트 폴더가 `~/.claude/subagent-system/scripts`가 아니면(프로젝트 저장소 안에 깔린 경우) 멈추고 위치와 훅 명령을 사용자에게 보여 준다. 이 키트는 `~/.claude` 설치만 다룬다.
3. 훅이 없고 `~/.claude/subagent-system/`도 없고 `~/.claude/agents/`에 키트 정의 10개 이름(「들어 있는 것」 표의 `agents/*.md`) 가운데 하나도 없으면 **처음 까는 컴퓨터**다. 아래 「Q. 사용자에게 물을 것」으로 간다.
4. 훅 없이 같은 이름의 정의나 스크립트, `~/.claude/subagent-system/`만 있거나, 훅만 있고 `~/.claude/subagent-system/`이 없으면 덮어쓰지 말고 멈춰서 사용자에게 보여 준다. 다만 `VERSION`이 없고 `~/.claude/subagent-system/config.json`에 `roles` 키가 있으면 처음 설치가 훅을 놓기 전에 끊긴 것이다. 멈추지 않고 아래 5번에서 「설치본에 `VERSION`이 없으면」으로 시작하는 항목으로 가서 이어 한다. 스크립트나 다른 키트 파일이 지금 키트와 다르면 그 항목에서 덮어쓰기를 묻는다. `VERSION`이 없고 `config.json`이 없거나 `config.json`에 `roles`가 없으면 처음 설치가 답을 기록하기 전에 끊긴 것일 수 있다고 알리고, 덮어쓰고 Q1부터 다시 할지 묻는다(지우기 전 백업은 아래 5번의 「`~/.claude/subagent-system/config.json`을 읽는다」 항목과 같다). 그 밖에 사용자가 덮어써도 된다고 하면 2단계의 백업을 한 뒤 처음 까는 흐름으로 진행한다.
5. 훅과 `~/.claude/subagent-system/`이 모두 있으면 설치본의 `VERSION`과 키트의 `VERSION`(이 문서 옆 `subagent-system/VERSION`)을 비교한다. 값은 한 줄 `YYYY.M.D` 또는 `YYYY.M.D.N`(N은 같은 날 두 번째 변경부터 2, 3, …)이고, 점으로 나눈 숫자를 자리마다 앞에서부터 비교하며 넷째 자리가 없으면 1로 본다(`2026.10.13`은 `2026.9.30`보다 새롭고, `2026.10.13` < `2026.10.13.2` < `2026.10.14`). 이 꼴이 아니면 멈추고 보여 준다.
   - 설치본에 `VERSION` 파일이 없으면 처음 설치가 끊긴 것일 수 있다(업데이트는 `VERSION`을 파일을 바꾸는 마지막 단계에서 놓으므로, 업데이트가 끊겨도 설치본에는 옛 `VERSION`이 남는다). 아래 「설치본에 `VERSION`이 없으면」 항목으로 가서 확인한다.
   - 설치본이 키트보다 낮으면 먼저 바로 아래 끊긴 업데이트 확인(가장 새 백업의 `VERSION`)을 하고, 해당하지 않으면 「업데이트」로 간다.
   - 설치본이 키트보다 낮을 때 업데이트가 중간에 끊겼는지는 가장 새 백업(`~/.claude/subagent-system-backup-<날짜-시각>/`, 이름에 `-retro-`가 든 것은 제외)의 `subagent-system/VERSION`이 설치본 `VERSION`과 같고, 설치본 `VERSION` 파일의 수정 시각이 그 백업 안 `subagent-system/VERSION`의 수정 시각보다 이른지로 읽는다. 업데이트는 1번에서 백업하고 `VERSION`을 파일을 바꾸는 마지막 단계인 9번에서 놓으므로 끊기면 둘이 같고, 끝까지 한 설치본의 가장 새 백업은 업데이트 전 버전을 담고 있어 다르다. 같은 버전을 다시 깐 설치본(위 4번의 「덮어써도 된다」 흐름)도 가장 새 백업의 `VERSION`이 설치본과 같아지므로 시각을 더 본다. 백업 명령은 수정 시각을 보존하지 않고 복사하므로 백업 안 `VERSION`은 백업한 때의 시각이다. 업데이트가 끊기면 설치본 `VERSION`은 그 전에 놓인 옛 파일이라 더 이르고, 설치나 업데이트가 끝까지 가면 `VERSION`을 백업 뒤 맨 끝에 놓아 더 늦다. 둘이 같고 시각이 더 이르면 1번 뒤 9번 전에 끊긴 것이니 백업을 새로 만들지 않고 업데이트 순서 2번부터 다시 한다. 다만 그 백업 폴더 이름의 날짜가 7일 넘게 지났으면 백업만 하고 멈춘 설치본이 한참 뒤에 다시 열린 것일 수 있으니, 끊긴 업데이트로 이어 할지 새로 업데이트(새 백업)할지 사용자에게 묻는다. 이때 업데이트 전 상태는 지금 가장 새 백업 `<경로>`에 있고, 새로 업데이트하면 그보다 새 백업이 하나 더 생긴다고 함께 알린다. 이어 하면 위대로 하고, 새로 하면 「업데이트」로 가서 1번 백업부터 한다. 버전이 다르거나 시각이 늦거나 백업이 하나도 없으면 끊긴 것이 아니니 「업데이트」로 간다. 시각은 아래 명령으로 비교한다(`CLAUDE_CONFIG_DIR`이 있으면 그 폴더를 쓴다). 버전이 같은지는 따로 본다.

     ```
     <kit-setup> --check-update-interrupted
     ```

     명령은 `끊김:` 또는 `끊기지 않음:`으로 시작하는 한 줄을 찍는다.

     - 백업을 새로 만들지 않는다. 지금 만들면 이미 교체된 파일이 담겨 설치 전 원본이 묻힌다. 위 가장 새 백업의 경로를 사용자에게 알린다.
     - 2번에서 읽는 값은 모두 설치본에서 읽는다. 정의와 GUIDE는 4번의 「한 번에 놓기」에서 복사본으로 바뀌므로, 끊긴 때가 그 전이면 설치본 그대로이고 그 뒤면 사용자 칸을 되넣은 것이다. 어느 쪽이든 사용자 값이다.
     - 3번의 파일 교체는 다시 해도 같은 결과다. 키트 파일로 덮어쓰고 키트에만 있는 키만 더하는 것이라, 이미 바뀐 파일은 목록에 나오지 않고 사용자 값을 지우는 단계는 없다.
     - 3번의 손으로 고친 파일 가리기는 이미 새 키트로 놓인 파일(4번 뒤에 끊겼다면 GUIDE와 정의)을 `(새 키트와 같음)`으로 가려 손으로 고친 파일로 보지 않는다. 4번 전에 끊겼으면 GUIDE와 정의의 `다름`은 버전 사이 차이일 수도 있다고 함께 알린다.
     - 다시 하는 3번, 5번, 6번, 7번의 질문은 이미 반영된 것이면 묻지 않는다. 확인할 곳은 아래와 같고, 먼저 설치본 `config.json`을 읽는다(파일이 없거나 JSON으로 읽히지 않으면 2번대로 멈추고 보여 준다).
       - `rates.json`: 키트에만 있는 모델 키는 이미 더해졌고, 값이 승인되어 바뀐 모델은 키트와 같아져 다시 묻지 않는다. 값이 아직 다르면 3번대로 묻되, 이 대화에서 답을 받은 모델은 묻지 않는다. `_checked`도 3번의 규칙대로, 키트와 값이 다른 모델이 없었거나 모두 키트 값이 된 뒤에만 올라가 있다.
       - `/retro` 스킬과 `config.json`의 키: 이미 같거나 있으면 그대로 두고, 아니면 3번대로 놓는다.
       - git 확인 목록: 사용자가 일부러 지운 항목도 빠진 채로 남아 파일만으로는 끝났는지 가려지지 않는다. 이 대화에서 그 항목의 답을 이미 받았으면 묻지 않고, 아니면 6번의 git 확인 목록 항목대로 묻는다(`gitAskDeclined`에 든 항목은 묻지 않는다).
       - 3번의 옮기기: 옮길 줄이 설치본 GUIDE의 사용자 규칙 구역이나 체크리스트에 이미 있으면 다시 묻지 않는다.
       - 키트 문장을 가리키는 줄 점검(4번)과 `CLAUDE.md`의 「구역:」 줄 점검(5번): 이 대화에서 답을 받은 줄은 다시 묻지 않는다. 새 대화에서 이어 하면 다시 점검한다. 4번의 한 번에 놓기 뒤에 끊겼으면 고치거나 지운 줄은 점검에 걸리지 않고, 그 전에 끊겼으면 다시 묻는다. 5번은 답을 받는 대로 `CLAUDE.md`를 고치므로, 실제로 고치거나 지운 줄만 점검에 걸리지 않고 아직 고치지 않은 줄은 다시 묻는다.
       - 목표와 방법(5번): 구역에 「목표와 방법」 소제목이 있거나 `goalMethodDeclined`가 있으면 묻지 않는다.
       - 체크리스트 대조: 대조는 답을 받을 때마다 파일과 `config.json`에 반영하므로, 이미 넣거나 바꾼 줄과 `checklistDeclined`, `checklistKept`에 남은 줄은 다시 묻지 않는다.
       - 규칙 바로 고치기 질문: `config.json`에 `autoApplyRules` 키가 있으면 묻지 않는다.
       - agent-meter: 이미 `agent-meter@claude-token-save`로 깔려 있거나 예전 방식의 `~/.claude/mods/agent-meter`가 있으면 7번이 설치 여부는 묻지 않고 갱신하거나 옮길 뿐이라 같은 결과다. keep-alive는 `agentMeterKeepaliveAsked`가 `true`이면 묻지 않는다. 없고 `config.json`에 `agentMeterDeclined`가 `true`이면 묻지 않는다. 이 대화에서 이미 답을 받았으면(이어 연 세션이면 설치본에 mod가 있는지로 가린다) 다시 묻지 않는다. statusLine 정리는 `statusLineCleanup`이 있으면 하지 않는다.
   - 설치본에 `VERSION`이 없으면(위 4번의 예외로 훅이 아직 없는 컴퓨터도 여기에 온다) 이미 놓인 키트 파일이 지금 키트와 같은지 본다. 처음 설치가 옛 키트로 시작해 끊겼다가 더 새 키트로 이어 하는 경우를 가리려는 것이다.
     - 스크립트는 `diff -rq <키트>/subagent-system/scripts ~/.claude/subagent-system/scripts`로 본다. `differ`나 `Only in <키트 쪽>` 줄이 나오면 다르다.
     - 이미 놓인 `docs/RETRO.md`는 키트 파일과, `/retro` 스킬은 이름과 경로 치환을 한 키트 사본과 견준다. `SUBAGENT_GUIDE.md`와 정의는 「업데이트 순서」 2번으로 설치본의 사용자 칸을 읽어 4번대로 되넣은 복사본과 견준다. 설치본에 `SUBAGENT_GUIDE.md`가 없으면 같은 이름의 정의는 키트가 놓은 것이 아니니(키트는 둘을 한 번에 놓는다) 버전을 견주지 않는다. 놓이지 않은 파일은 이어 하기가 놓으므로 견주지 않는다. `SUBAGENT_BRIEF_CHECKLIST.md`는 통째로 바꾸지 않고, 키트의 공통 줄과 다르면 이어 하기를 마친 뒤 「체크리스트 대조」를 한다.
     - 이때 아래 「`config.json`을 읽는다」 항목에서 `roles`가 있고 다른 것이 있으면, 차이 목록(스크립트는 `diff -rq` 줄, 나머지는 파일 이름)과 함께 이미 놓인 키트 파일이 지금 키트와 다르다고 보여 주고, 키트 것으로 덮어써도 되는지 한 번에 묻는다. 물을 때 키트의 `VERSION` 값을 함께 보여 주고, 설치본이 더 새 키트로 깔렸을 수 있다고 알린다. 동의하면 스크립트, `RETRO.md`, `/retro` 스킬은 키트 것으로 덮어쓰고, GUIDE와 정의는 위 복사본을 「업데이트 순서」 4번의 한 번에 놓기대로 놓은 뒤 같은 이어 하기 흐름으로 간다. 거절하면 멈춘다.
     - `roles`나 `installAnswers`가 없으면 아래 「`config.json`을 읽는다」 항목대로 처음 까는 흐름을 Q1부터 다시 할지 묻는다.
     - 다른 것이 없으면 처음 설치가 `VERSION`을 놓기 전에 끊긴 것이다. 문답을 처음부터 다시 하지 않고 남은 것부터 이어 한다. 백업은 새로 만들지 않는다.
     - `~/.claude/subagent-system/config.json`을 읽는다. 파일이 없거나 JSON으로 읽히지 않거나 `roles`나 `installAnswers` 키가 없으면(2단계가 답을 쓴 뒤 `roles`를 맨 끝에 쓰므로, 그 전에 끊김) 답이 남지 않은 것이라 멈추고 보여 준 뒤, 처음 까는 흐름을 Q1부터 다시 할지 묻는다.
       - Q1부터 다시 하면 남은 `config.json`을 지우고 시작한다. 지우기 전에 「2. 백업하고 파일 놓기」의 백업 명령으로 `config.json`을 포함해 백업하고 경로를 알린다(이어 하기는 백업을 새로 만들지 않지만, 이 경우는 지우는 것이라 사본을 만든다).
       - 지우기 전에 `removedKinds`는 읽어 두었다가 Q2 표와 새 `config.json`에 반영한다. 다만 옛 표(설치본 `SUBAGENT_GUIDE.md`의 사용자 표)에 `<이름>[기준]` 꼴 칸이 있던 이름은 회고가 쪼갠 옛 이름이라 사용자가 뺀 것이 아니므로 읽어 두지 않는다(새 표에서 빼지 않고 새 `config.json`에도 남기지 않는다. 설정 파일을 지우므로 `--restore-kind`로 되돌릴 것이 따로 없다). 읽어 둔 이름은 Q1로 만든 표에서 빼고 Q2에서 그렇게 했다고 알리며(3단계의 표 만들기도 같다), 2단계 `config.json` 순서의 3번 뒤 `roles`를 쓰기 전에 이름마다 `--remove-kind "<일 이름>"`을 돌려 다시 남긴다.
       - `records/`에 기록이 있으면 다 쓴 설치본에서 `VERSION`만 없어진 것일 수 있다. Q1부터 다시 할지와 함께 업데이트로 읽을지(「업데이트」 절, 1번 백업부터)도 묻는다. 처음부터 다시 하면 회고로 고친 표가 키트의 직군 표로 바뀐다고 알린다.
     - `roles`와 `installAnswers`가 있으면(`roles`는 빈 배열도 포함) 답을 이렇게 모은다. 이어 연 대화에 남은 답이 있으면 그것을 쓰고, 없으면 `config.json`에서 읽는다(키는 「Q. 사용자에게 물을 것」의 「답 기록」).
       - Q1은 `roles`, Q5는 `retroMode`, Q6은 `autoApplyRules`(키가 없으면 아직 묻지 않은 것이다), Q2부터 Q4와 기존 훅 확인은 `installAnswers`에서 읽는다.
       - Q2부터 Q4의 키는 2단계가 한꺼번에 쓰므로 `roles`가 있으면 모두 있다. `hookAdd`, `q4AgentMeterKeepalive`는 묻지 않았으면 키가 없는 것이 정상이다. 그 뒤 단계의 답은 받는 대로 쓰므로 끊긴 때에 따라 없을 수 있고, 없으면 그 단계에서 묻는다. 4단계의 위임 기준은 `CLAUDE.md`에 `subagent-system` 구역이 이미 있으면 답한 것이라 묻지 않고, 5-1단계는 `claudeMdAdviceDone`이 `true`이면 하지 않는다. 표시 밖 줄(4단계와 5단계)은 `keptOutsideLines`나 `outsideLinesKept`에 쌍이 있거나 키트 문장과 같은 뜻(이미 고친 줄 포함. 4단계의 기준으로 가른다)이면 다시 묻지 않는다. 쌍이 있는 줄의 키트 줄이나 덩어리를 구역에 넣을지는 5단계의 끊긴 설치 처리대로 정한다. 「구역:」 줄(4단계 규칙 줄의 두 꼴)은 표시 밖 같은 뜻 줄로 보지 않는다.
       - 정의 10개와 GUIDE가 이미 놓였으면 표와 「무조건 Opus」 목록은 GUIDE에 들어 있어 Q2와 Q3의 답은 쓸 데가 없다.
       - 파일 흔적(정의의 글쓰기 줄, agent-meter 설치 흔적, extras 구역, `permissions.ask`)으로 답을 짐작하지 않는다. 흔적이 없는 것은 안 넣기로 한 것이 아니라 아직 못 넣은 것일 수 있다. 아래 단계를 이미 마쳤는지만 파일로 가린다.
     - 2단계 「파일 놓기」 표의 항목마다 `~/.claude` 아래에 놓였는지 확인해 놓이지 않은 것만 놓는다. 이미 놓인 파일은 위에서 동의해 바꾼 것 말고는 덮어쓰지 않는다.
       - 다른 훅이 있고 이 키트의 항목이 아직 없는 이벤트마다 2단계 「기존 훅 확인」의 답이 있는지 본다. SubagentStop은 `hookAdd`에 답이 있으면 다시 묻지 않는다. 답이 없는 이벤트가 있으면 같은 질문을 한다. 정의 10개와 GUIDE가 아직 놓이지 않았으면 파일을 놓기 전에, 이미 놓였으면 3단계의 훅 전에 한다. 받은 답은 바로 `installAnswers`에 쓴다. `hookAdd`에는 새 이벤트만 넘기면 된다(답 기록 명령이 배열을 이미 든 값과 합친다). 이어 하다 `SubagentStop` 거절로 멈추면 놓인 파일은 그대로 있으니 이미 놓인 파일 목록(스크립트, 문서, `config.json`, 놓였으면 정의와 GUIDE)을 알린다.
       - 그 뒤 3단계부터 이어 한다. 정의 10개와 GUIDE가 둘 다 이미 놓였으면 3단계의 복사본 만들기와 한 번에 놓기는 건너뛰고 훅이 있는지 본다.
         - 이 키트의 SubagentStop 항목이 없으면 3단계의 훅부터 한다(`hookAdd`를 따른다). 있으면 4단계부터 한다.
         - 3단계의 체크리스트 직군 줄은 다시 한다(같은 「지킬 것」 문장이 있으면 넣지 않는다는 3단계 규칙대로).
   - 같으면 「이미 이 버전」이라고 알리고, 스크립트와 문서를 바꾸지 않고 끝낸다. 처음 설치 도중에 재시작한 컴퓨터일 수 있으니, `~/.claude/subagent-system/records/subagent-cost.tsv`가 없거나 비었거나 `config.json`에 `installAnswers`가 있으면 6단계 10번부터 12번(서브에이전트 하나로 비용 기록 확인, 사용 기록 적기, `/retro` 확인)과 「7. 보고」가 안 끝난 것일 수 있다고 알리고 그 확인만 이어 할지 묻는다. 이어 하면 그 확인과 보고에 쓸 Q4의 답은 `config.json`의 `installAnswers`에서 읽는다(보고를 마친 설치는 이 키가 지워져 없다).
   - 설치본이 키트보다 높으면 「키트가 설치본보다 옛것」이라고 알리고 멈춘다. 사용자가 더 새 키트를 받았는지 확인하게 한다.

## Q. 사용자에게 물을 것

처음 까는 경우만 묻는다(업데이트는 설치본에 agent-meter가 없을 때 Q4의 d와 후속 질문을, extras 구역은 있는데 목표와 방법이 없을 때 Q4의 e를, `config.json`에 `autoApplyRules` 키가 없을 때 Q6을 묻는다. 「업데이트 순서」 7번과 5번, 「규칙 바로 고치기 질문」). Q1, Q2, Q3, Q4의 a부터 e까지 다섯, Q5, Q6으로 모두 열 번을 한 번에 하나씩 순서로 묻는다(agent-meter가 이미 깔려 있거나 조직 설정이 마켓플레이스 출처를 막고 있어 d를 묻지 않으면 아홉 번이다). 앞 질문의 답을 받은 뒤 다음 질문을 한다. Q4의 d(agent-meter)에 「a. 넣는다」로 답하면 그 안에서 keep-alive를 켤지 하나를 더 묻는다. agent-meter가 이미 깔려 있어 d를 묻지 않아도 keep-alive를 켤지는 아직 묻지 않았으면 한 번 묻는다(최상위 `agentMeterKeepaliveAsked`가 `true`이면 이미 물은 것이다). 설치하는 중에 규칙 줄 확인, `CLAUDE.md` 개선 권고, statusLine 정리, 기존 설정과 부딪히는 것은 그 단계에서 따로 묻는다. 나머지 구현 방식은 이 문서대로 정하고 이유만 한 줄 알린다.

**묻는 방법.** 이 문서에서 사용자에게 묻는 모든 곳(처음 설치의 Q1부터 Q6, 1단계부터 6단계(5-1과 5-2 포함)에서 따로 묻는 것, 업데이트, 제거)에 같은 규칙을 쓴다. 사용자는 이 키트의 말을 모른다고 가정한다. 「넣을까요?」처럼 무엇을 넣는지 보이지 않고 묻는 일이 없게 하려는 것이다.

- 묻는 대상의 실제 내용을 같은 메시지에 먼저 보인다. 표를 바꾸는 질문은 표 전체를, 규칙이나 줄을 넣거나 빼는 질문은 그 줄 원문(길면 줄인 꼴이 아니라 실제로 들어갈 문장)을, 설정을 고치는 질문은 넣을 JSON 조각(기존 항목이 있으면 함께)을 보인다. 파일이나 폴더를 지우거나 바꾸는 질문은 경로 목록을 보인다.
- 질문에 처음 나오는 용어는 괄호로 한 줄 푼다. 칸(모델과 effort가 만나는 표의 한 자리), 정의(모델과 effort를 정해 둔 서브에이전트 설정 파일), effort(생각을 얼마나 깊게 할지 정하는 값), 「무조건 Opus」(작업 크기와 상관없이 판단과 검증을 가장 신중한 Opus high로 보내는 영역), 서브에이전트(메인 Claude가 일을 나눠 맡기는 별도의 Claude), 「(고정)」(표에서 일 이름 뒤에 붙어 그 일을 싼 정의로 내려 보지 않는다는 표시), 회고(쌓인 사용 기록을 보고 표를 고치는 일), 훅(정해진 때 자동으로 도는 명령)이 이 문서의 예다. 풀이는 한 번만 하고, 이미 풀어 쓴 용어는 다시 풀지 않는다.
- 고르면 달라지는 것과 안 바뀌는 것을 적는다. 나중에 바꿀 수 있으면 바꾸는 법도 한 줄 적는다.
- 선택지는 a/b/c로 쓰고, 추천은 맨 앞에 「(추천: 이유)」로 단다. 한 번에 하나만 묻고, 답이 없는 항목은 짐작으로 정하지 않고 그 항목만 다시 묻는다.
- 처음 설치의 질문 번호는 이 문서의 이름(Q1부터 Q6, Q4의 a부터 e)이 아니라 실제로 묻는 질문을 차례로 센 `Q<순번>/<전체>`로 화면에 단다. 전체는 d를 묻지 않으면 뺀 수이고, d의 후속 질문(keep-alive. 이미 깔려 있어 d 대신 묻는 것도 같다)과 설치하는 중에 따로 묻는 것(`권고 1/N` 같은 것)은 세지 않고 번호도 달지 않는다. 업데이트에서 d, e, Q6만 물을 때(「업데이트 순서」 7번과 5번, 「규칙 바로 고치기 질문」)도 번호를 달지 않는다. 보통은 `Q1/10`부터 `Q10/10`이고, 이 문서의 Q4 a는 화면에서 `Q4/10`, 이 문서의 Q4 e는 `Q8/10`, 이 문서의 Q5는 `Q9/10`, 이 문서의 Q6은 `Q10/10`이다.
- 아래 Q1부터 Q6과 각 단계의 개별 문장은 이 규칙 위에 그 자리에서 보일 구체적인 내용을 더한 것이다.

**보고 형식.** 이 문서가 시키는 마무리 보고(「7. 보고」, 「업데이트 뒤 보고」, 「제거」의 「마무리」)는 모두 이 형식으로 쓴다. 보고는 사용자가 보고 판단하고 결정하는 데 필요한 것만 쓰고, 같은 내용을 두 번 쓰지 않는다.

- 첫 줄: 한 일을 한 문장으로 요약한다. 아래 구역에 나오는 건수는 다시 쓰지 않는다.
- 「결정할 것」: 사용자의 답이 필요한 것만 번호를 붙여 쓰고, 고를 것이 있으면 선택지를 단다. 없으면 이 구역을 쓰지 않는다.
- 「알아 둘 것」: 결정은 아니지만 판단이 달라지는 것만 쓴다(실패, 위험, 되돌리기 어려운 변경, 확인하지 못한 것). 없으면 이 구역을 쓰지 않는다.
- 쓰지 않는 것: 과정 설명, 근거 나열, 변화 없는 수치, 정상인 것의 목록. 바뀐 파일은 사용자가 열어 봐야 할 때만 쓴다. 물으면 자세히 답한다.
- 각 보고 절은 이 형식을 다시 정의하지 않고, 그 보고에서 무엇이 「결정할 것」과 「알아 둘 것」에 들어가는지만 정한다.

**답 기록.** 처음 설치에서 받은 답은 `~/.claude/subagent-system/config.json`에 남긴다. 설치가 끊겨 새 대화에서 이어 할 때 1단계 5번이 이 기록을 읽어 이미 답한 질문을 다시 묻지 않으려는 것이다. 파일 흔적(정의의 글쓰기 줄, mod 폴더, extras 구역)으로 답을 짐작하지 않는다.
- Q1의 답은 `roles`에, Q5의 답은 `retroMode`에, Q6의 답은 `autoApplyRules`에 이미 쓰이므로 따로 쓰지 않는다. 나머지는 `installAnswers`(객체)에 아래 키로 쓴다. 답을 받은 키만 들어간다.

  | 키 | 값 | 답을 받는 곳 |
  |:---|:---|:---|
  | `q2` | 더한 일의 배열 `[{"kind": "<일 이름>", "cell": "<정의>"}]`. 이름에 붙인 「(고정)」은 `kind`에 넣는다. 더한 일이 없으면 `[]` | Q2 |
  | `q3` | 확정한 「무조건 Opus」 목록(문자열 배열) | Q3 |
  | `q4Rules`, `q4GitAsk`, `q4WritingLine`, `q4AgentMeter`, `q4GoalMethod` | 넣기로 했으면 `true`, 아니면 `false` | Q4의 항목마다 |
  | `q4AgentMeterKeepalive` | `"on"` 또는 `"off"` | Q4 d의 후속 질문, 이미 깔려 있을 때 대신 묻는 keep-alive 질문 |
  | `hookAdd` | 같은 이벤트에 다른 훅이 있어 키트 항목을 더하기로 한 이벤트 이름의 배열(`"SubagentStop"`) | 2단계 「기존 훅 확인」 |
  | `keptOutsideLines` | 표시 밖의 비슷하거나 부딪히는 줄을 고치지 않겠다고 한 줄의 쌍 배열 `[{"line": "<표시 밖 줄 원문>", "kit": "<그때 견준 키트 문장>"}]`. 키트 문장은 4단계는 아래 「넣을 뜻」의 줄, 5단계는 `extras/CLAUDE_RULES.md`의 줄이다 | 4단계, 5단계 |
  | `claudeMdAdviceDone` | 5-1단계를 마쳤으면 `true`(권고할 것이 없다고 알린 때도 쓴다) | 5-1단계 |

- `config.json`은 2단계에서 스크립트를 놓은 뒤에 생긴다. 그 전에 받은 답(Q2부터 Q4, 기존 훅 확인)은 대화에 두었다가 만든 바로 뒤에 한꺼번에 쓴다(2단계의 `config.json` 문단). 그 뒤의 답(고치지 않겠다고 한 줄)은 받는 대로 쓴다.
- 쓰는 명령은 아래와 같다. 쓸 키를 JSON 객체로 `<<'EOF'`에 넘기면 `installAnswers`에 합쳐진다. 값이 배열이고 이미 든 값도 배열이면 더해지고(문자열 원소는 중복 없이, `line`이 든 객체는 같은 `line`이면 새 것으로 바뀌고, 그 밖의 원소는 같은 것이 없을 때만), 그 밖의 값은 새 값으로 바뀐다. 그래서 배열 키에는 새 원소만 넘기면 된다. 문장에 따옴표가 들어 있어도 셸이 풀지 않게 인자가 아니라 입력으로 넘긴다.

  ```
  <kit-setup> --add-answers "$HOME/.claude/subagent-system/config.json" <<'EOF'
  {"q4Rules": true, "q4GitAsk": false}
  EOF
  ```

- 설치를 마치면(「7. 보고」) 지운다. 다만 `keptOutsideLines`는 `outsideLinesKept`로 지우기 전에 옮긴다.

**질문에 붙이는 추천과 후보의 자료.** Q1과 Q4의 추천, Q2와 Q3의 후보는 아래 자료에서만 찾아 근거와 함께 붙인다. Q4의 d(agent-meter)만 예외로, 자료와 상관없이 늘 추천한다. 자료에서 후보를 찾았으면 Q2와 Q3을 빈칸으로만 묻지 않는다. 처음 쓰는 사람은 무엇을 적을지 몰라 비우기 쉽기 때문이다.

- 읽는 자료는 셋뿐이다.
  - 사용자의 `~/.claude/CLAUDE.md`
  - 사용자가 직접 넣은 스킬의 이름과 설명. `~/.claude/skills/*/SKILL.md`와 지금 연 프로젝트의 `.claude/skills/*/SKILL.md`의 frontmatter(파일 맨 위 설정 블록)만 읽는다(지금 연 폴더의 `.claude`가 사용자 설정 폴더와 같은 폴더이면 한 번만 읽는다). Claude Code나 플러그인이 기본으로 딸려 보내는 스킬(예: xlsx, pdf, docx)은 근거로 치지 않는다. 누구에게나 같은 후보가 붙어 그 사람이 하는 일을 보여 주지 못하기 때문이다.
  - 이미 쌓인 사용 기록(기록이 있을 때만): `node "$HOME/.claude/subagent-system/scripts/subagent-retro.js" --kinds`의 출력과 사용 기록의 일 종류 열
- 프로젝트 소스 코드와 다른 파일은 읽지 않는다. 읽은 내용은 컴퓨터 밖으로 보내지 않는다.
- 후보는 제안일 뿐이다. 사용자가 고른 것만 표와 「무조건 Opus」 목록에 넣고, 정의 description에도 같은 이름을 넣는다(3단계).
- 후보는 질문마다 3개 안팎으로, 후보마다 근거를 한 마디 붙인다. 근거가 없는 후보는 붙이지 않고, 후보가 하나도 없으면 아래 질문을 후보 없이 묻는다.

**시작 안내.** 0단계를 통과했으면 Q1 앞에 아래 여섯 가지를 한 메시지로 먼저 알린다. 용어는 「묻는 방법」대로 처음 나올 때 푼다.

- 이 컴퓨터의 `~/.claude`에 서브에이전트(메인 Claude가 일을 나눠 맡기는 별도의 Claude)의 정의 10개(모델과 effort를 정해 둔 설정 파일), 지침 문서, 비용 기록 스크립트, 훅(정해진 때 자동으로 도는 명령)을 깔고 `settings.json`과 `CLAUDE.md`를 고친다. 바꾸기 전에 `~/.claude/subagent-system-backup-<날짜-시각>/`에 백업한다.
- 앞의 질문은 열 번이다(주로 하는 일, 표에 없는 일, 「무조건 Opus」, 함께 넣을 것 다섯, 회고 방식, 규칙 바로 고치기). agent-meter가 이미 깔려 있으면 아홉 번이고, 그것은 묻지 않고 갱신한다(조직 설정이 마켓플레이스 출처를 막고 있으면 아홉 번이고 깔지 않는다). 질문 번호는 `Q1/10`처럼 전체와 함께 달아 보인다. 함께 넣을 것에서 agent-meter에 「a. 넣는다」로 답하면 둘이 더 이어진다. 이 질문들에 답하는 동안은 아무것도 바꾸지 않는다. 열 번이 끝이 아니고, 설치하는 중에도 상황에 따라 질문이 더 나온다(다음 항목).
- 설치하는 중에 따로 묻는 것이 있다. 규칙 줄 확인과 위임 기준(4단계), `CLAUDE.md` 개선 권고(5-1단계, 권할 것이 있을 때), statusLine 정리(5-2단계, agent-meter를 넣을 때), 기존 설정과 부딪히는 것(커맨드 이름 겹침, 같은 이벤트의 기존 훅, `permissions.allow`의 같은 명령, 표시 밖의 비슷한 규칙 줄)이다.
- 모델 배정 표(일 종류마다 어느 정의로 보낼지 적은 표)는 직군별 일반 표로 시작한다. 쓰면서 기록이 쌓이면 회고(쌓인 기록을 보고 표를 고치는 일)가 이 사람이 하는 일에 맞게 고쳐 간다.
- 서브에이전트의 결과가 모자라면 그렇다고 말하면 된다. 그 말이 표를 고치는 근거가 된다.
- 언제든 멈출 수 있다. 멈추면 그때까지 바꾼 것과 백업 위치를 알린다.
**Q1. 주로 하는 일을 골라 주세요.** `docs/ROUTING_PRESETS.md`의 직군을 보기로 주고, 여러 개 골라도 된다고 알린다. 질문할 때 「가장 가까운 것을 고르면 된다. 표는 쓰면서 고쳐진다.」를 함께 보여 준다. 하나도 고르지 않으면 개발 전제가 가장 적은 f. 기획과 문서의 표와 「무조건 Opus」 기본안(`ROUTING_PRESETS.md`의 「기획과 문서」 절)으로 시작한다. 이때 지시문 체크리스트는 공통 줄만으로 시작하고, `config.json`의 `roles`는 `[]`로 남기며, 늘 지키는 규칙의 직군 묶음은 넣지 않는다. 사용자에게는 「직군을 고르지 않아 기획과 문서 표와 공통 체크리스트로 시작한다. 나중에 직군을 더할 수 있다.」고 알린다. `roles`가 `[]`이면 업데이트가 직군을 다시 묻지 않는다.

- a. 백엔드
- b. 프론트엔드와 앱
- c. 데이터(분석과 엔지니어링)
- d. 인프라와 운영
- e. QA와 테스트
- f. 기획과 문서

보기마다 그 직군 출발 표의 예를 한 줄씩 붙인다. `ROUTING_PRESETS.md`의 그 직군 표에서 Sonnet medium 칸과 Opus high 칸 각각에 든 일을 있는 만큼(칸마다 최대 세 개) 뽑는다. 「모든 표에 남는 칸」의 일(무조건 Opus 영역 판단과 구현 등)은 뽑지 않는다. 예를 들어 「a. 백엔드: 범위가 정해진 테스트 작성과 로그와 쿼리 결과 가공은 Sonnet medium, 최종 코드 리뷰와 원인 찾기는 Opus high로 보낸다」처럼 쓴다. 일 이름은 표에 적힌 그대로 쓴다. 이름만 주면 처음 쓰는 사람은 고르면 무엇이 바뀌는지 알 수 없기 때문이다. 질문에는 출발 표(일 종류마다 어느 정의로 보낼지 적은 표)가 고른 직군으로 정해지고, 지시문 체크리스트와 늘 지키는 규칙에 더할 줄도 이 답을 따른다는 것을 적는다. 안 바뀌는 것은 표가 쓰면서 회고로 하는 일에 맞게 고쳐진다는 점이다.

위 자료에 직군을 짐작할 근거가 있으면 그 보기 맨 앞에 「(추천: 근거)」를 붙인다. 근거가 없으면 추천을 달지 않고 보기 바로 아래에 「(추천 없음: 자료에서 직군을 짐작할 근거가 없음)」 한 줄을 쓴다. 프로젝트 코드는 읽지 않는다. 여러 개를 고르면 `ROUTING_PRESETS.md`의 합치는 규칙으로 표 하나와 「무조건 Opus」 기본안 하나를 만든다. 고른 직군(고르지 않았으면 기획과 문서 표를 쓰고 직군 줄과 직군 묶음은 없다)은 지시문 체크리스트의 직군 줄(3단계)과 늘 지키는 규칙의 직군 묶음(Q4 a)을 정하고, 2단계에서 `config.json`의 `roles`에 남겨 업데이트가 읽는다.

**Q2. 자주 하는 일 가운데 이 표에 없는 것이 있나요?** Q1로 만든 표를 그대로 보여 주고 묻는다. 표 위에 읽는 법을 붙인다. 「줄은 모델(Haiku가 가장 싸고 Opus가 가장 신중하고 비싸다), 열은 effort(생각하는 깊이), 칸 안의 이름은 그 정의(모델과 effort를 정해 둔 서브에이전트 설정)로 보낼 일 종류다. 모델과 effort가 만나는 한 자리를 칸이라 부른다.」 질문할 때 「떠오르는 것이 없으면 「없음」으로 넘어가도 된다. 표에 없는 일을 맡기면 그 일은 새 이름으로 기록되고, 회고 때 표에 들어가 하는 일에 맞게 표가 바뀌어 간다.」를 함께 보여 준다. 보기는 a. (추천: 표에 없는 일은 쓰면서 새 이름으로 기록되고 회고 때 표에 들어간다) 없음, 이 표로 시작한다, b. 더할 일이 있다(일 이름과 하는 일을 받는다)이다. 「없음, 이 표로 시작한다」를 고르면 넘어간다.

자료에서 찾은 후보가 있으면 위 보기 앞에 후보를 a/b/c로 붙이고 근거를 함께 보인다. 위 보기는 후보 다음 글자로 잇고, 이때는 추천을 달지 않는다. 후보마다 넣으면 어떻게 되는지와 안 넣으면 어떻게 되는지를 함께 묻는다. 예를 들어 사용자가 넣은 스프레드시트 처리 스킬이 있으면 「a. 스프레드시트 정리와 변환을 Sonnet medium 칸에 넣을까요? 넣으면 이 일을 맡길 때 Sonnet medium 정의로 보낸다. 안 넣으면 맞는 칸이 없어 새 이름으로 기록되고, 회고 때 칸이 정해진다. (근거: 스프레드시트 처리 스킬이 있음)」처럼 묻는다. 라우팅 표의 「표」와 헷갈리지 않게 후보 이름에는 「표」 대신 「스프레드시트」 같은 구체적인 말을 쓴다. 회사나 도구의 고유 이름은 후보 이름에 쓰지 않고 일의 성격으로 적는다. 사용자는 후보를 고르거나 고치거나 다른 일을 더할 수 있다.

- 답한 일은 표 칸의 이름처럼 짧은 명사구로 이름을 짓는다.
- 칸은 `SUBAGENT_GUIDE.md` 표 위의 원칙(일의 성격, 잘못됐을 때 메인이 알아챌 수 있는가)으로 정하고, 그 원칙으로도 고르기 어려우면 Opus medium 칸에 둔다. 회고가 결과를 보고 칸을 옮기고, 내려 보기가 비용을 줄인다.
- 일 이름에 「누락 점검」, 「영향 범위」, 「검수」가 들었으면 이름 뒤에 `「(고정)」`을 붙이고 그 사실을 알린다. 놓쳐도 신호가 없어 싼 정의로 내려 보지 않는 일이라는 표시다(`SUBAGENT_GUIDE.md`의 규칙).
- 정의가 있는 열 칸에만 넣는다. Haiku xhigh와 Sonnet xhigh는 정의가 없고, Opus xhigh에는 새 일을 넣지 않는다. Haiku high는 정의는 있지만 내려 보기 시험 자리라 처음에는 비워 둔다. Opus low도 비워 둔다. `opus-low`는 Opus medium 칸의 일을 낮은 effort로 내려 보는 시험에만 쓰는 정의이기 때문이다. 사용자가 직접 일을 더할 때도 두 칸에는 넣지 않는다.
- 넣은 일마다 「<일 이름>을 <모델> <effort>에 넣었다(까닭)」를 한 줄씩 알린다.

**Q3. 「무조건 Opus」 영역을 정해 주세요.** 틀리면 되돌리기 어렵거나 겉으로 드러나지 않아, 작업 크기와 상관없이 판단과 검증을 Opus high로 보낼 영역이다. Q1에서 고른 직군의 기본안을 합쳐 보여 준다(Q1에서 고르지 않았으면 「기획과 문서」 기본안을 보여 준다). 보기는 a. (추천: 기본안은 이 직군에서 틀리면 되돌리기 어렵거나 겉으로 드러나지 않는 영역을 미리 모은 것이다) 기본안 그대로, b. 고친다(뺄 것, 더할 영역, 아래 후보에서 넣을 것을 받는다)이다. 질문에 이 영역을 넣으면 달라지는 것을 적는다. 그 영역의 판단과 검증은 작아도 Opus high로 가므로 Sonnet이나 Haiku로 보낼 때보다 비용이 더 든다(`rates.json`의 입력 요율로 Opus는 Sonnet의 두 배). 빼면 일반 표의 칸으로 보내져 싸지만, 틀려도 알아채기 어려운 일이 싼 정의로 갈 수 있다. 안 바뀌는 것은 목록을 회고가 마음대로 고치지 않는다는 점이다(회고는 모아 두었다가 사용자에게 물어 바꾼다). 나중에 바꾸려면 Claude에게 `~/.claude/subagent-system/docs/SUBAGENT_GUIDE.md`의 「무조건 Opus」 목록을 고쳐 달라고 한다. 데이터(분석과 엔지니어링), 인프라와 운영, QA와 테스트, 기획과 문서 가운데 하나라도 골랐거나 직군을 하나도 고르지 않았으면 `ROUTING_PRESETS.md` 「「무조건 Opus」가 무엇인가」와 그 직군 절의 「틀리면 되돌리기 어렵거나 드러나지 않는 일의 예」를 함께 보여 준다(이 문단은 그 넷의 절에만 있다). 프로젝트 코드는 읽지 않으므로 모듈 이름은 붙이지 않는다.

자료에서 찾은 후보는 기본안 뒤에 근거를 붙여 보이고, 넣을지는 b에서 받는다. 후보가 있으면 a에 추천을 달지 않고 보기 아래에 「(추천 없음: 후보를 넣을지는 사용자가 정한다)」 한 줄을 쓴다. 후보가 없을 때만 a를 추천한다. 예를 들어 `~/.claude/CLAUDE.md`에 운영 배포나 DB 마이그레이션 규칙이 있으면 「운영 배포와 DB 마이그레이션 (근거: CLAUDE.md에 운영 배포 규칙이 있음)」을 후보로 붙인다.

**Q4. 함께 넣을 것을 하나씩 정해 주세요.** `../extras/`의 세 가지(a부터 c), agent-meter(d), `../extras/`의 목표와 방법(e)을 a, b, c, d, e 순서로 하나씩 묻는다. e는 나중에 키트에 더한 항목이라 d 뒤에 둔다. 글자를 바꾸면 이 문서와 `config.json`의 d 참조가 모두 바뀌기 때문이다. 답을 받은 뒤 다음 항목을 묻는다. 항목마다 아래 「보일 내용」을 같은 메시지에 보이고 「<이름>을 넣을까요?」를 따로 묻는다. 사용자에게 보일 메시지에서는 항목을 글자(a~e) 대신 이름(늘 지키는 규칙, git 명령 확인 목록, 글쓰기 줄, agent-meter, 목표와 방법)으로 부른다. 답 보기의 a, b와 섞이지 않게 하려는 것이다. 이 문서 안의 「Q4의 d」 같은 내부 참조는 글자 그대로 둔다. 보기는 둘이다. 「a. 넣는다」, 「b. 넣지 않는다」이고, 아래 추천이 있으면 해당 보기 앞에 「(추천: 근거)」로 단다. 첫 항목(a)을 묻는 메시지에 「다섯을 차례로 묻는다. 어느 것이든 안 넣어도 되고, 서브에이전트 체계는 다섯 없이도 돈다」를 함께 알린다(d를 묻지 않으면 「넷」으로 쓴다). 넣지 않기로 한 것은 넣지 않는다(a부터 c와 e는 5단계, d는 5-2단계). d에 「a. 넣는다」로 답하면 후속 질문(keep-alive)이 이어진다.

- a. 늘 지키는 규칙(`extras/CLAUDE_RULES.md`): `~/.claude/CLAUDE.md` 끝에 별도 덩어리로 더한다. 바뀌는 것은 멈추고 묻는 기준, 질문은 한 번에 하나씩 하고 답 없는 항목은 다시 묻는 것, 커밋과 push는 명시 지시가 있을 때만 하고 여러 git 단계를 빠짐없이 하며 하지 못한 단계는 그렇다고 적는다는 것, 조사는 전수 실측, 주석과 로그(민감한 정보를 남기지 않는 것), 사용자에게 하는 보고의 형식(첫 줄 요약, 「결정할 것」, 「알아 둘 것」. 서브에이전트의 보고는 정의를 따른다), 필요한 말만 쓰고 확인하지 못한 것은 그렇다고 적는 것이다. 규칙마다 무엇을 막으려는지가 한 구절씩 붙는다. Q1에서 백엔드, 데이터, 인프라와 운영 가운데 하나라도 골랐으면 되돌릴 수 없는 작업에 DB 마이그레이션 적용과 운영 DB 데이터 변경이(이미 적용된 마이그레이션 파일은 고치지 않는다는 말과 함께), 전수 실측에 DB 스키마와 운영 설정을 확인하는 두 줄이 더해진다. 안 바뀌는 것은 정의와 표다.
  - 보일 내용: 실제로 들어갈 규칙 전체를 원문 그대로 보인다(`CLAUDE_RULES.md`에서 맨 위 제목 줄과 「넣는 법」 문단, 직군 묶음의 소제목 줄을 뺀 것. Q1에서 고른 직군에 따라 두 묶음의 줄이 들어가거나 빠진 꼴이다).
- b. git 명령 확인 목록(`extras/git-permissions.json`): `~/.claude/settings.json`의 `permissions.ask`에 합친다. 바뀌는 것은 git 명령을 실행하기 전에 확인 창이 뜨는 것이다. 목록의 기준은 둘이다. 끝나지 않은 작업이 커밋되거나 사용자가 정하고 싶은 커밋 메시지를 Claude가 마음대로 정하는 것을 막는 것(commit, push, merge, rebase)과, 복구할 수 없는 일을 막는 것(reset, restore, checkout, switch, clean, rm, stash 계열, `branch -D`, `branch -d`, `branch --delete`)이다. cherry-pick과 revert는 사용자가 되돌릴 수 있어 넣지 않는다. 안 바뀌는 것은 status, log, diff 같은 읽기 명령이다.
  - 보일 내용: `permissions.ask`에 들어갈 명령 목록은 대표 몇 줄(예: `Bash(git commit:*)`, `Bash(git * commit *)`, `Bash(git * branch -D*)`)과 `git-permissions.json`의 `Bash(...)` 항목 전체 줄 수(파일에서 세어 보인다)로 보이고, `git -C <폴더> commit`처럼 git 뒤에 옵션이 붙은 꼴도 잡는다고 한 줄 설명한다. 사용자가 원하면 전체 목록을 원문으로 보인다. `PowerShell(...)` 항목은 같은 명령의 짝이라고 한 줄로 알린다. ask 규칙은 해당 명령을 실행하기 전에 사용자에게 확인을 받는 규칙이라고 한 줄 푼다.
- c. 글쓰기 줄(`extras/DEFINITION_WRITING_LINE.md`): `CLAUDE.md`와 정의 10개에 줄표, 가운뎃점 금지 줄을 더한다. `CLAUDE.md`에는 `claude-setup-kit extras` 구역 안에 한 줄, 정의에는 본문 끝에 한 줄이다. 바뀌는 것은 메인의 응답과 문서, 서브에이전트 지시문, 서브에이전트의 보고에서 줄표(—)로 부연을 덧붙이거나 가운뎃점(·)으로 항목을 잇지 않는 것이다. 한국어 글쓰기 취향이라 안 맞는 사람도 있다. 안 바뀌는 것은 근거 붙이기 같은 다른 보고 규칙이다.
  - 보일 내용: 더할 두 줄(메인용, 정의용)을 `DEFINITION_WRITING_LINE.md`의 「더할 줄」 원문으로 보인다.
- d. agent-meter(`../agent-meter/`): 입력창 아래에 메인과 서브에이전트의 모델, effort, 문맥(지금 대화가 문맥 창을 얼마나 채웠는지), 토큰, 어림 비용, 프롬프트 캐시(같은 대화 앞부분을 싸게 다시 읽게 해 주는 저장)가 만료되기까지 남은 시간을 보여 주는 mod(Claude Code 화면에 붙이는 확장)다. `q4AgentMeter`가 `true`이면 5-2단계가 이 키트 저장소(GitHub `daum7766/claude-token-save`)를 플러그인 마켓플레이스로 등록하고 그 안의 agent-meter 플러그인을 `claude plugin install`로 깐다. 바뀌는 것은 입력창 아래에 표가 한 줄 더 생기는 것과, 사용자 `settings.json`에 마켓플레이스 등록과 플러그인을 켰다는 표시가 들어가는 것이다. 안 바뀌는 것은 서브에이전트 체계(agent-meter 없이도 돈다)와 비용 요율(`rates.json`)이다. 표는 `/meter`로 켜고 끈다. 토큰 열은 `/meter tokens`로 켜고 끈다. 처음에는 보이고, 정한 상태는 새 세션에서도 이어진다. 조직 설정에 따라 표만 안 뜨거나(`allowManagedModsOnly`, `allowManagedHooksOnly`, 관리 설정의 `disableAllHooks`) 설치 명령이 거절될 수 있다(마켓플레이스 출처를 막는 `strictKnownMarketplaces`, `blockedMarketplaces`). 거절되는 경우는 설치 과정이 미리 가리고(0단계와 5-2단계 3번), 표만 안 뜨는 경우는 설치가 막지 못한다.
  - 보일 내용 첫째, 표의 모양: 표의 모양을 코드에서 읽은 머리글로 보인다. 첫 줄은 `total <세션 비용> | branch <브랜치> | path <작업 폴더>`이고, 그 아래 표의 열은 `agent`, `model`, `effort`, `context`, `경과`, `캐시`, `재캐시`, `캐시만료`, 토큰 열 넷(`입력`, `출력`, `캐시읽기`, `캐시쓰기`), `비용` 순서다(`agent-meter/hooks/register.tsx`가 그리는 표). 숫자는 지어서 보이지 않는다. 터미널이 좁으면 토큰 열은 빠진다.
  - 보일 내용 둘째, 실행할 명령과 바뀌는 설정: 아래 명령을 보인다. 사용자 `settings.json`에 이 키트 저장소가 마켓플레이스 `claude-token-save`로 등록되고(`extraKnownMarketplaces`) agent-meter를 켰다는 표시(`enabledPlugins`)가 들어가며, keep-alive를 끄면 그 값(`pluginConfigs`)도 들어간다. 플러그인 파일은 `~/.claude/plugins/` 아래 캐시에 놓이고 `~/.claude/mods/`는 쓰지 않는다. 지금 `settings.json`의 `extraKnownMarketplaces`와 `enabledPlugins`에 이미 이 이름이 있으면 함께 보인다(없으면 없다고 쓴다).

    ```
    claude plugin install agent-meter --marketplace daum7766/claude-token-save
    ```
  - 0단계에서 마켓플레이스 출처를 막는 설정이 읽혔으면 d는 묻지 않는다(Q4는 a, b, c, e 넷만 묻는다). 보기 없이 「조직 설정이 이 마켓플레이스 출처(`daum7766/claude-token-save`)를 막고 있어 agent-meter는 깔지 않는다」고 알리고 `installAnswers`의 `q4AgentMeter`를 `false`로 쓴다.
  - 이미 agent-meter가 깔려 있으면(`agent-meter@claude-token-save`로 깐 것이나, 키트의 옛 설치 스크립트로 깐 `~/.claude/mods/agent-meter`) d는 묻지 않는다(Q4는 a, b, c, e 넷만 묻는다). 보기 없이 「이미 깔려 있어 최신으로 갱신한다」고 알리고, `installAnswers`의 `q4AgentMeter`를 `true`로 쓴다(Q4에서 답을 받은 때와 같은 갈래를 탄다). 설치는 5-2단계가 한다. keep-alive는 아래 후속 질문을 한 번 묻는다. 같은 메시지에 지금 값(켬 또는 끔)을 보이고 추천은 지금 값 그대로 둠으로 단다. 최상위 `agentMeterKeepaliveAsked`가 `true`이거나 `installAnswers`에 `q4AgentMeterKeepalive`가 있으면(끊긴 설치를 이어 하는 경우) 이미 물은 것이라 묻지 않고 지금 값 그대로 둔다(옛 방식이면 옛 값을 새 설정으로 옮긴다). 지금 값은 마켓플레이스로 깐 것이면 5-2단계 3번의 `pluginConfigs` 확인 명령으로, 옛 방식이면 4번의 `AGENT_METER_KEEPALIVE` 확인 명령으로 읽는다. 지우고 싶으면 「제거」 절을 보라고 한 줄 덧붙인다. 깔려 있는 동안 업데이트도 갱신한다.
  - 「a. 넣는다」로 답하면 이어서 keep-alive를 켤지 하나를 묻는다. 답은 5-2단계의 설치 명령 인자가 된다.
    - keep-alive를 켤지. keep-alive는 서브에이전트가 도는 동안 메인 캐시가 곧 만료되면 메인 요청을 한 번 더 보내 만료 시각을 늘리는 기능이다(만료 몇 분 전에 보내는지는 보여 줄 때 키트 `README.md` 「1. agent-meter만 직접 설치」의 「알아 둘 것」 keep-alive 문단에서 읽어 적는다). 이 요청도 비용이 든다. 끄면 서브에이전트 실행 중 유휴 압축 건너뛰기도 꺼진다. 회사 정책 등으로 「hook skipped」 경고가 나면 끄기를 권한다. 보기는 a. (추천: 켬. 설치 기본값이고, 돌아와서 대화 전체를 캐시에 다시 쓰는 것보다 싸다) 켬, b. 끔이다. b를 고르면 설치 명령에 `--config keep_alive=false`가 붙고, a를 고르면 붙지 않는다(기본값이 켬). 끄면 연장하지 않고 만료 알림만 낸다. 이미 마켓플레이스로 깔려 있어 묻는 경우는 답을 5-2단계 3번의 마지막 항목대로 `claude plugin configure`로 바꾸고, 바꾼 값은 Claude Code를 다시 열어야 적용된다고 알린다. 나중에 Claude Code 안에서 `/config`의 agent-meter 줄이나 `/plugin configure agent-meter@claude-token-save`로 바꾼다. 셸의 `claude plugin configure`는 Claude Code를 다시 열어야 적용된다고 안내하고, `/config`로 바꾼 값이 바로 적용되는지는 확인하지 못했으니 바꾼 뒤 다시 열라고 알린다.
- e. 목표와 방법(`extras/GOAL_AND_METHOD.md`): `~/.claude/CLAUDE.md`의 `claude-setup-kit extras` 구역 맨 끝에 「목표와 방법」 절 하나를 더한다(a도 c도 넣지 않아 구역이 없으면 구역을 만든다). 바뀌는 것은 메인이 일을 시작할 때 목표를 찾아 한 문장으로 정하고, 규칙끼리나 규칙과 지시가 부딪힐 때 묻기 전에 그 목표로 가르며, 새 규칙에 목적을 함께 적는 것이다. 목표로 가르지 못할 때만 두 규칙의 목적을 붙여 묻고, API 동작, 데이터 정책, 스코프 컷은 목표와 상관없이 묻는다. 안 바뀌는 것은 정의와 표이고, a와 함께 넣어도 a의 「멈추고 묻는 경우」는 그대로다. `CLAUDE.md`가 이 절의 줄 수만큼 늘어 세션마다 그만큼 더 읽힌다.
  - 보일 내용: 넣을 절 원문(`GOAL_AND_METHOD.md`에서 맨 위 제목 줄과 「넣는 법」 문단을 뺀 것), 넣을 자리(extras 구역 맨 끝), 늘어나는 줄 수(파일에서 세어 보인다).

추천은 자료에서 찾은 것만(d는 늘 추천), 해당 항목의 「넣는다」 앞에 「(추천: 근거)」로 붙인다. 추천하지 않는 항목은 보기에 추천을 달지 않고, 보기 바로 아래에 「(추천 없음: 근거)」 한 줄을 쓴다(예: 「(추천 없음: 자료에서 그런 취향이 보이지 않음)」).
- a: `CLAUDE.md`에 멈추고 묻는 기준, 질문 방식, 커밋과 push 규칙이 없으면 추천한다(근거: 그 규칙이 `CLAUDE.md`에 없음). 이미 있으면 추천하지 않고, 겹치는 줄 가운데 뜻이 다른 줄은 5단계에서 그 줄 원문과 고칠 문장을 보이고 그 자리에서 고칠지 묻고 같은 뜻의 줄은 묻지 않고 위치만 알린다고 알린다.
- b: Q1에서 백엔드, 프론트엔드와 앱, 데이터, 인프라와 운영, QA와 테스트 가운데 하나라도 골랐거나 `CLAUDE.md`에 git 규칙이 있으면 추천한다(근거: git 저장소에서 일할 가능성이 높고, SUBAGENT_GUIDE의 「git 금지」대로 문구로 막아도 서브에이전트가 `stash`나 `reset`으로 작업 트리를 바꿀 수 있어 실행 전 확인 창이 마지막 안전장치가 됨). 기획과 문서만 골랐거나 직군을 하나도 고르지 않았고 `CLAUDE.md`에 git 규칙도 없으면 추천하지 않고, git 저장소에서 일한다면 고르는 편이 낫다고만 알린다. 이 추천은 위 자료 셋에 더해 Q1의 답을 근거로 쓴다.
- c: `CLAUDE.md`에 줄표나 가운뎃점을 쓰지 말라는 줄이 있으면 추천한다(근거: 그 줄이 있음). 없으면 추천하지 않는다(근거: 자료에서 그런 취향이 보이지 않음. 위대로 보기 아래에 한 줄로 쓴다).
- d: 추천한다(근거: 서브에이전트마다 어느 모델과 effort로 돌고 비용이 얼마인지 입력창 아래에서 바로 보여, 라우팅이 의도대로 도는지 확인하는 데 쓴다). 다만 화면 하단에 이미 상태줄이 있으면 겹칠 수 있다는 것은 설치한 뒤 5-2단계가 확인하고 정리를 묻는다고 함께 알린다.
- e: `CLAUDE.md`에 서로 부딪히는 규칙 줄이 있거나 규칙에 목적이나 까닭을 붙여 쓴 줄이 있으면 추천한다(근거: 그런 줄이 있음). 같은 뜻의 절이 이미 있으면 추천하지 않고, 5단계가 같은 뜻 줄은 위치만 알린다고 알린다. 그 밖에는 추천하지 않는다(근거: 자료에서 그런 줄이 보이지 않음).

**Q5. 회고 방식을 골라 주세요.** 회고(쌓인 서브에이전트 사용 기록을 보고 모델 배정 표를 고치는 일)는 사용 기록이 기준 건수에 닿으면 하는 일이다. 기준은 처음에 낮고 회고를 거듭할수록 오른다(단계별 건수는 보여 줄 때 키트 `docs/RETRO.md`의 「정정과 후보 판정」에서 읽어 적는다). 어느 쪽을 골라도 나중에 `/retro auto`와 `/retro ask`로 바꿀 수 있다고 알린다.

- a. (추천: 이 키트의 기본값이다. 자동은 회고할지를 묻지 않고 표와 정의를 고치므로, 먼저 회고가 어떻게 돌아가는지 본 뒤에 정하는 편이 안전하다) 묻기(기본): 회고할 때가 되면 메인이 물어보고, 하자고 하면 그때 회고한다. 바뀌는 것은 없다. 표와 정의는 사용자가 하자고 한 회고 안에서만 바뀐다.
- b. 자동: 회고할 때가 되면 회고할지는 묻지 않고 회고 서브에이전트(표의 「자동 회고」 칸의 정의, 처음에는 `opus-medium`)를 백그라운드로 띄운다. 사용자에게는 이렇게 알린다.
  - 자동은 사용 기록만 보고 판단이 서는 것만 바로 고친다. 표의 칸 옮기기, 싼 정의로 한 번 시험해 보기, 표에 없는 일 넣기다(사용자가 표에서 뺀 일 이름은 `config.json`의 `removedKinds`에 남아 있어 제외다). 고치기 전에 `~/.claude/subagent-system-backup-retro-<날짜-시각>/`에 백업한다.
  - 「무조건 Opus」 목록, 요율, 정의 파일 지우기, 사용자가 표에서 뺀 일 이름 되돌리기처럼 판단이 필요한 것은 바꾸지 않고 모아 두었다가 작업이 끝날 때 하나씩 묻는다. 규칙 문서와 `CLAUDE.md`는 Q6에서 바로 고치기를 골랐을 때 근거 기록이 있는 체크리스트와 규칙 문장 고침만 바로 고치고, 그 밖의 고침은 묻는다.
  - 회고 서브에이전트가 지키는 정확한 범위는 `RETRO.md`의 「자동 회고」 가운데 「바로 적용하는 것」과 「물을 것으로 모으는 것」이다. 위 알림은 그 요약이다.
  - 다만 이 서브에이전트가 `~/.claude` 아래 파일(표, 정의, 체크리스트, 규칙 문장)을 고칠 때는 Claude Code의 권한 확인 창이 뜰 수 있다. Claude Code가 `.claude` 쓰기를 보호 경로로 다뤄 설정의 `permissions.allow`로 미리 허용할 수 없기 때문이다(https://code.claude.com/docs/en/permission-modes 「Protected paths」). 기본 모드와 acceptEdits는 확인 창이 메인 세션에 뜨고, auto는 분류기가 판단하고, dontAsk는 거부되어 회고가 실패하며, bypassPermissions는 확인 없이 쓴다. 자동 회고가 두 번 이어 실패하면 스크립트가 묻기 방식으로 돌려놓고 알린다. 이 사실을 보기와 함께 알린다.

b를 고르고 `~/.claude/CLAUDE.md`에 저장소 밖 변경을 묻는 규칙이 있으면, 4단계 마지막 규칙 줄(회고 서브에이전트가 표, 사용자 규칙 구역, 체크리스트, `~/.claude/CLAUDE.md`의 구역 밖, 정의 description, 기록 폴더를 고치는 것과, 새 정의를 만드는 것, 백업 폴더를 만드는 것은 묻지 않는다는 예외)이 그 규칙과 겹친다고 알리고, 이 경우에만 그 줄을 넣는다. 둘 중 하나라도 해당하지 않으면 그 줄은 넣지 않는다. 나중에 `/retro auto`로 자동으로 바꾸는 경우는 설치본 `/retro` 스킬이 같은 조건에서 이 줄을 보여 주고 넣을지 묻는다. 이 예외는 `CLAUDE.md`의 규칙에 대한 것이고, Claude Code의 권한 확인 창은 따로 뜰 수 있다. 고른 값은 2단계에서 `config.json`에 쓴다.

**Q6. 규칙과 체크리스트를 묻지 않고 바로 고칠지 골라 주세요.** 서브에이전트 결과가 모자라거나 같은 지적이 되풀이되면 메인과 회고가 지시문 체크리스트(서브에이전트에 일을 보내기 전에 대조하는 목록)나 규칙 문장을 고쳐야 한다. 근거 기록이 있고, 고친 뒤 같은 지적이 다시 나오는지로 효과를 잴 수 있는 고침은 사용자에게 묻지 않고 바로 고치고, 효과가 없거나 나빠지면 되돌리거나 고치는 방식을 한 단계 올린다. 어느 쪽을 골라도 나중에 `<kit-setup> --config-set "$HOME/.claude/subagent-system/config.json" autoApplyRules <true 또는 false>`로 바꿀 수 있다고 알린다.

- a. (추천: 고칠 때마다 `records/fixes.tsv`에 남고 효과를 기록으로 재서 나빠지면 알려 주므로, 사용자는 정책만 답하면 된다) 바로 고친다(기본): 근거 기록이 있는 지시문 체크리스트 고침과, 사용자 규칙 구역(`SUBAGENT_GUIDE.md`에서 회고가 더한 공통 문장을 두는 자리)과 `~/.claude/CLAUDE.md`의 표시 주석 구역(키트가 넣은 규칙을 주석 표시로 감싼 자리) 밖 규칙 문장 고침을 묻지 않고 하고, 최종 보고에 한 줄씩 적는다. 그 밖에는 계속 묻는다. 정책 결정, 「무조건 Opus」 목록, 새 스크립트와 훅과 스킬 같은 새 파일 만들기, 프로젝트 `CLAUDE.md` 고치기, 되돌릴 수 없는 것이다.
- b. 묻는다: 모든 규칙과 체크리스트 고침을 물을 것에 모아 하나씩 묻는다. 바뀌는 것은 없고, 고침은 사용자가 승인한 것만 일어난다.

## 2. 백업하고 파일 놓기

### 백업

`~/.claude`를 처음 바꾸기 전에 이 백업부터 한다. 처음 설치와 업데이트 모두 해당한다(업데이트는 「업데이트 순서」 1번에서 이 명령을 쓴다). 백업은 새 파일을 만들 뿐 기존 파일을 바꾸지 않으므로 묻지 않고 한다.

- 위치: `~/.claude/subagent-system-backup-<YYYYMMDD-HHMMSS>/`. 실행할 때마다 새 폴더가 생겨 이전 백업을 덮어쓰지 않는다.
- 복사하는 것(있는 것만): `settings.json`, `CLAUDE.md`, 덮어쓸 같은 이름의 `agents/<정의 10개>.md`, 그리고 이미 깔린 `subagent-system/`의 `docs/`(`RETRO.md` 포함), `scripts/`, `rates.json`, `config.json`, `VERSION`. 같은 이름의 기존 커맨드(`commands/<이름>.md`)와 스킬(`skills/<이름>/`)도 넣는다. 이름은 설치본 `config.json`의 `commandName`이고, 없으면 `retro`다.
- `subagent-system/records/`는 복사하지 않고 그대로 둔다. 기록은 설치와 업데이트가 지우지 않는다.
- 심볼릭 링크(dotfiles 저장소에 둔 `settings.json`, `CLAUDE.md` 등)는 링크가 아니라 가리키는 내용을 복사한다. 링크만 복사하면 원본을 고칠 때 백업도 함께 바뀌어 되돌릴 수 없기 때문이다.
- 없는 파일은 건너뛴다. 복사된 파일이 하나도 없으면(아무것도 깔리지 않은 컴퓨터) 폴더도 생기지 않고, 명령은 「백업할 것 없음」만 찍는다.

Git Bash(Windows) 또는 터미널(macOS, 리눅스)에서 실행한다. `CLAUDE_CONFIG_DIR`이 있으면 그 폴더를 쓴다.

```
<kit-setup> --backup-install
```

명령이 「백업 위치」를 찍었으면 그 경로를 사용자에게 알린다. 「백업할 것 없음」을 찍었으면 복사한 것이 없어 폴더가 만들어지지 않았으니 경로를 알리지 않는다. 백업은 지우지 않는다. 되돌릴 때 쓰고, 지울지는 사용자가 정한다.

### 파일 놓기

먼저 `/retro` 커맨드의 이름이 겹치지 않는지 본다. 처음 설치할 때 한다. 아래 넷에 `retro`가 이미 있는지 읽는다.

- `~/.claude/commands/retro.md`
- `~/.claude/skills/retro/`
- 지금 연 폴더의 프로젝트 `.claude/commands/retro.md`와 `.claude/skills/retro/`(지금 연 폴더의 `.claude`가 사용자 설정 폴더와 같은 폴더가 되면 위 두 줄과 같은 파일이라 따로 읽지 않는다)
- 켜진 플러그인. `~/.claude/settings.json`의 `enabledPlugins`에서 켜진 플러그인 이름을 읽고, `~/.claude/plugins/` 아래 그 플러그인 폴더에서 `commands/retro.md`와 `skills/retro/`를 찾는다. 세션의 스킬 목록에 `retro`나 `<플러그인>:retro`가 보이는지도 본다.

하나도 없으면 이름은 `retro`다. 있으면 덮어쓰지 말고 어디에 있는지 보여 주고 다른 이름을 묻는다(후보 `sub-retro`, `agent-retro`와 직접 입력). 이름은 영문 소문자, 숫자, 하이픈이고 64자 이하다. 공식 문서(https://code.claude.com/docs/en/skills)는 같은 이름이면 스킬이 `commands/` 파일보다 앞서고 개인 스킬이 프로젝트 스킬보다 앞서며, 플러그인의 스킬은 `/플러그인이름:이름`으로 불려 이름이 겹치지 않는다고 한다. 그래서 `commands/retro.md`가 있는데 같은 이름의 스킬을 놓으면 사용자의 커맨드가 가려진다. 프로젝트의 `.claude/commands/retro.md`나 `.claude/skills/retro/`도 같은 이유로 가려진다. 문서의 해당 표에 「Enterprise over personal, and personal over project」와 「A skill and a file in `.claude/commands/`: The skill」이 있다. 프로젝트 쪽에서 찾았으면 그 프로젝트에서는 `/retro`가 이 키트의 것으로 열리고 프로젝트의 것은 열리지 않는다고 알리고, 그대로 `retro`를 쓸지 다른 이름을 쓸지 묻는다. 이 단계는 지금 연 폴더만 읽으므로 다른 프로젝트에 같은 이름이 있는지는 알 수 없다(미확인). 그런 프로젝트가 있으면 그 프로젝트의 `/retro`가 가려진다는 것도 함께 알린다. 플러그인에만 있는 경우는 이름이 겹치지는 않지만 알리고, 그대로 `retro`를 쓸지 묻는다. 이미 이 키트가 놓은 스킬(`config.json`의 `commandName`이 가리키는 `skills/<이름>/SKILL.md`, 또는 `subagent-retro.js`가 든 파일)은 겹침이 아니다.

**기존 훅 확인.** `/retro` 이름을 정한 바로 뒤, 아래 파일을 놓기 전에 한다. 처음 설치와, 답이 없는 이벤트가 있는 끊긴 설치의 이어 하기(1단계 5번)에서 한다. 3단계에서 `~/.claude/settings.json`의 `hooks`에 이 키트의 훅(`SubagentStop`)을 더하는데, 그 전에 같은 이벤트의 다른 훅이 있는지 본다. 거절하면 설치를 멈춰야 하는 질문이라, 파일을 놓은 뒤가 아니라 놓기 전에 묻는다.

- `~/.claude/settings.json`의 `hooks.SubagentStop`에 이 키트의 것이 아닌 훅이 있는지 읽는다. 이 키트의 것은 명령에 `subagent-usage.js`가 든 항목이다.
- 이벤트마다 다른 훅이 이미 있으면 덮어쓰지 않고, 같은 배열에 이 키트의 항목을 더할지 사용자에게 먼저 묻는다. 물을 때 그 이벤트의 기존 항목(명령 원문 포함)과 더할 JSON 조각(`settings-hook.json`의 그 이벤트 항목 원문)을 같은 메시지에 나란히 보이고, 고르기 전에 안 더하면 어떻게 되는지를 아래대로 알린다. 더하면 같은 이벤트에서 기존 훅과 이 키트의 명령이 둘 다 돈다고 적는다. 더하자고 하면 기존 항목을 두고 이 항목만 더한다. 이벤트마다 이렇게 묻는다.
  - `SubagentStop`: 안 더하면 서브에이전트 비용 기록이 남지 않아 회고가 돌지 않으므로 아무것도 놓지 않고 설치를 멈춘다고 먼저 알린다. 보기는 a. (추천: 더해야 설치가 이어진다) 더한다, b. 더하지 않는다(설치를 멈춘다)이다.
- `SubagentStop`에서 b를 고르면(거절은 허용하지 않는다) 「이 훅이 없으면 서브에이전트 비용 기록이 남지 않아 회고가 돌지 않는다」고 알리고 **아무것도 놓지 않고 설치를 멈춘다.** 이때까지 `~/.claude`에서 바뀐 것은 없고 백업 폴더만 남았을 수 있다고 함께 알린다. 이 안내는 처음부터 하는 설치에서만 쓴다. 끊긴 설치를 이어 하다 멈추면 이미 놓인 파일이 있으니 1단계 5번대로 그 목록을 알린다.
- 더하겠다고 한 이벤트의 이름은 `installAnswers`의 `hookAdd`(배열)에 남긴다(「Q. 사용자에게 물을 것」의 「답 기록」).
  - 처음 설치에서는 `config.json`을 스크립트를 놓은 뒤에 만들므로(아래 `config.json` 문단) 이 시점에는 아직 없다. 없으면 답(`hookAdd`에 들어갈 이벤트)만 대화에 적어 두었다가, `config.json`을 만든 바로 뒤에 「답 기록」 명령으로 남긴다. 끊긴 처음 설치를 이어 하는 경우(1단계 5번)에는 `config.json`이 이미 있으니 바로 남긴다.
- 답에 따라 3단계가 더할 항목이 정해진다. 더하기로 한 이벤트만 3단계에서 더하고, 다른 훅이 없던 이벤트는 묻지 않고 더한다.

| | 놓을 곳 |
|:---|:---|
| 정의 10개 | `~/.claude/agents/`. 2단계에서는 놓지 않는다. 3단계에서 description까지 고친 뒤 GUIDE와 함께 한 번에 놓는다 |
| 문서 둘(`RETRO.md`, `SUBAGENT_BRIEF_CHECKLIST.md`) | `~/.claude/subagent-system/docs/`. 체크리스트는 키트의 공통 줄을 놓은 뒤 3단계에서 직군 줄을 더한다. `ROUTING_PRESETS.md`는 설치하지 않고 키트에서 읽는다 |
| `SUBAGENT_GUIDE.md` | `~/.claude/subagent-system/docs/`. 2단계에서는 놓지 않는다. 3단계에서 직군 표, 「무조건 Opus」, 정의 description이 정해진 뒤 정의 10개와 한 번에 놓는다(업데이트가 사용자 칸을 되넣은 뒤 GUIDE를 놓는 방식과 같다) |
| `rates.json` | `~/.claude/subagent-system/rates.json` (스크립트 폴더가 아니라 그 한 단계 위. 스크립트가 `../rates.json`으로 읽는다) |
| `VERSION` | `~/.claude/subagent-system/VERSION`. 파일이 다 놓이고 확인이 통과한 뒤에 놓는다(처음 설치는 6단계 8번, 업데이트는 「업데이트 순서」 9번. 둘 다 `VERSION` 바로 앞에 키트 파일 해시를 `config.json`에 남긴다). 중간에 멈춘 설치가 「이미 이 버전」으로 읽히지 않게 하려는 것이다. 재시작이 있어야 되는 확인(6단계 10번부터 12번)은 `VERSION` 뒤에 한다. 사용자의 답이나 확인이 남아 검증이 끝나지 않았으면 `VERSION`도 놓지 않고, 그 확인을 마친 뒤에 놓는다 |
| 스크립트 열, `package.json` | `~/.claude/subagent-system/scripts/` (스크립트끼리 import하므로 같은 폴더에 둔다) |
| 시험 파일 | `~/.claude/subagent-system/scripts/tests/` |
| 기록 폴더 | 만들지 않아도 된다. `--log`와 훅이 처음 쓸 때 만든다 |
| `/retro` 스킬 | `skills/retro/SKILL.md`를 `~/.claude/skills/<이름>/SKILL.md`로 복사한다. 이름이 `retro`가 아니면 복사본 frontmatter의 `name: retro` 줄을 `name: <이름>`으로 바꾼다. 본문은 그대로 둔다. `CLAUDE_CONFIG_DIR`을 쓰는 컴퓨터는 아래 「`CLAUDE_CONFIG_DIR`을 쓰는 컴퓨터」대로 경로를 바꾼다 |
| `config.json` | `~/.claude/subagent-system/config.json`. 아래 설명대로 만든다 |
| 훅(SubagentStop) | `~/.claude/settings.json` |
| 규칙 줄 | `~/.claude/CLAUDE.md`(표시 주석 사이) |

### `CLAUDE_CONFIG_DIR`을 쓰는 컴퓨터

`node -p "process.env.CLAUDE_CONFIG_DIR||''"`가 값을 찍는 컴퓨터만 한다. 이 변수를 쓰지 않는 컴퓨터는 바꾸지 않는다. 설치본 문서와 정의, 훅 명령이 `~/.claude`와 `$HOME/.claude`로 적혀 있어, 그대로 두면 이 컴퓨터에서는 `--log`와 `--due`가 파일을 못 찾는다(스크립트 자체는 이 변수가 있으면 그 폴더의 `projects/`와 `settings.local.json`, `settings.json`을 읽는다).

- 바꾸는 곳: `subagent-system/docs/`의 문서(`SUBAGENT_GUIDE.md`, `RETRO.md`, `SUBAGENT_BRIEF_CHECKLIST.md`), 정의 10개(description의 가이드 경로 포함), `/retro` 스킬, `CLAUDE.md`에 넣는 규칙 줄(4단계와 5단계), 훅 명령(3단계)이다. 스킬은 본문 명령과 frontmatter `allowed-tools`의 `$HOME/.claude`, 본문 글의 `~/.claude`를 모두 바꾼다. 미리 실행하는 명령은 `allowed-tools` 규칙과 같은 꼴이어야 권한 확인을 통과하므로 둘을 함께 바꾼다. 키트 폴더의 파일은 고치지 않고 놓기 전의 복사본이나 넣을 문장에서 바꾼다.
- 바꾸는 법: `$HOME/.claude`를 먼저, 그다음 `~/.claude`를 `CLAUDE_CONFIG_DIR`의 값으로 바꾼다. Windows는 역슬래시를 슬래시로 쓴다. 이 문서의 명령도 같게 바꿔 읽는다.
- 업데이트도 같다. 키트 문장을 다시 놓는 모든 곳(문서, 정의, 스킬, `CLAUDE.md` 표시 사이)에 같은 치환을 하고, 설치본과 비교할 때도 새 문장을 치환한 것으로 비교한다.
- 확인은 6단계 2번에 있다.

스크립트는 ES 모듈(`import`)이라 스크립트 폴더의 `package.json`(`{"type": "module"}`)이 있어야 돈다. 키트의 파일을 그대로 놓는다.

`config.json`은 스크립트를 놓은 뒤 Q5의 답으로 만든다. 아래 순서로 쓰고 `roles`는 맨 끝에 쓴다. 1단계 5번이 끊긴 처음 설치를 `roles`로 가리므로, 답을 모두 쓴 뒤에 써서 `roles`가 있으면 답 기록도 끝난 것이 되게 하려는 것이다.

1. `node "$HOME/.claude/subagent-system/scripts/subagent-retro.js" --retro-mode <ask 또는 auto>`가 파일을 쓰고 값을 찍는다. 이어 Q6의 답을 `<kit-setup> --config-set "$HOME/.claude/subagent-system/config.json" autoApplyRules <true 또는 false>`로 쓴다.
2. 커맨드 이름이 `retro`가 아니면 `commandName`을 더한다. `<kit-setup> --set-command-name "$HOME/.claude/subagent-system/config.json" <이름>`.
3. 이때까지 대화에 둔 답을 한꺼번에 쓴다. Q2, Q3, Q4의 답과 기존 훅 확인에서 더하기로 한 이벤트를 「Q. 사용자에게 물을 것」의 「답 기록」 명령으로 `installAnswers`에 쓴다. 1단계 5번에서 읽어 둔 `removedKinds`가 있으면(Q1부터 다시 하는 경우) 이름마다 `--remove-kind "<일 이름>"`을 이어 돌린다.
4. Q1에서 고른 직군을 `roles`에(하나도 고르지 않았으면 `[]`로, 아래 명령을 직군 인자 없이 돌린다) `ROUTING_PRESETS.md`의 직군 절 제목 그대로(`백엔드`, `프론트엔드와 앱`, `데이터(분석과 엔지니어링)`, `인프라와 운영`, `QA와 테스트`, `기획과 문서`) 배열로 더한다. `<kit-setup> --set-roles "$HOME/.claude/subagent-system/config.json" "<직군>" "<직군>"`.

회고 스크립트는 `roles`와 `installAnswers`를 읽지 않고 `autoApplyRules`를 읽으며, `retroMode`와 `retroFailures`를 쓸 때 다른 키를 그대로 둔다. 업데이트가 체크리스트와 늘 지키는 규칙의 직군 줄을 맞출 때 `roles`를 읽는다. 이 파일은 사용자 설정이라 업데이트가 지킨다.

스킬은 `~/.claude/skills/` 폴더가 이 세션을 시작할 때 이미 있었으면 놓는 즉시 읽힌다. 폴더가 없었으면 새로 열 때까지 보이지 않는다(공식 문서는 `/reload-skills`를 안내하고, 처음 설치는 어차피 6단계 9번에서 다시 연다).

`rates.json`의 요율(100만 토큰당 달러)은 파일 안의 `_source`와 `_checked`대로 2026-10 Anthropic 가격표 기준이다. 쓰는 모델이 표에 없거나 회사가 다른 요율로 쓰면 사용자에게 알린다. 표에 없는 모델의 비용은 `?`로 남고, 회고가 그 모델 이름을 「요율표에 없는 모델」로 찍는다. 갱신 방법은 `RETRO.md`의 6단계에 있다. `rates.json`이 없거나 JSON이 깨져도 훅은 죽지 않고 모든 비용을 `?`로 적는다. agent-meter도 이 파일을 읽고, 없거나 깨졌을 때만 mod에 든 내장 요율을 쓴다.

## 3. 자리 채우기와 훅

- 키트의 `SUBAGENT_GUIDE.md`와 정의 10개를 임시 폴더(세션의 스크래치 폴더가 있으면 거기, 없으면 운영체제 임시 폴더)에 복사하고, 아래 표, 목록, description과 「`CLAUDE_CONFIG_DIR`을 쓰는 컴퓨터」 치환은 이 복사본에서 바꾼다. 직군 표와 「무조건 Opus」와 description이 정해지기 전에 놓으면, 설치가 끊겼을 때 다른 직군 사용자도 키트의 백엔드 표로 서브에이전트가 배정되기 때문이다. `~/.claude/subagent-system/` 아래에는 두지 않는다(설치가 끊기면 바꾸다 만 임시 파일이 설치본 안에 남는다).
- 복사본 GUIDE의 `<!-- 사용자 표 시작 -->`과 `<!-- 사용자 표 끝 -->` 사이를 Q1과 Q2로 만든 표로 바꾼다. 표시 주석 줄은 지우지 않는다.
  - Q1부터 다시 하는 경우 1단계 5번에서 읽어 둔 `removedKinds`에 든 이름은 표에서 뺀다(회고가 그 이름을 다시 넣지 않게 남긴 것이라, 새로 만든 표에도 넣지 않는다).
  - 표 형식을 그대로 지킨다. 머리줄은 `| | low | medium | high | xhigh |`, 모델 줄은 `| **Haiku** |` 꼴이고, 칸 안의 일 이름은 쉼표로 나누며 부연은 이름 끝의 괄호에 넣는다(괄호가 이름 가운데 있으면 스크립트가 그 괄호를 이름에서 빼 기록과 어긋난다). 회고 스크립트가 이 형식으로 표를 읽어 일 이름을 뽑기 때문에, 형식이 바뀌면 회고가 「표에 없는 일 종류」를 가리지 못한다.
  - 직군 표를 합칠 때 이름 뒤의 고정 표시를 지킨다(Opus high 칸의 일과, 이름에 「누락 점검」, 「영향 범위」, 「검수」가 든 일). 표에는 `「(고정)」`처럼 낫표까지 적고, 낫표 없는 `(고정)`도 스크립트가 고정 표시로 읽는다. 합치면서 이름이 바뀌거나 칸을 옮겨도 그 칸에는 표시를 남긴다. 회고가 쓰는 네 일(회고 정정 분류, 자동 회고, 작업 기록 병목 분석, 문서 내용 검토)과 데이터 표의 수치 검증에도 표시가 붙어 있고, Q2에서 더한 일 가운데 이름에 「누락 점검」, 「영향 범위」, 「검수」가 든 일에도 붙인다. 스크립트가 이 표시로 내려 보기 후보에서 뺄 칸을 가린다. 이름 뒤의 최저선 표시 ``「(최저: `<정의>`)」``도 이름과 함께 그대로 옮긴다.
  - `ROUTING_PRESETS.md` 「모든 표에 남는 칸」의 여덟 가지 일(회고 정정 분류, 자동 회고, 작업 기록 병목 분석, 문서 내용 검토, 무조건 Opus 영역 판단, 계획이 정한 무조건 Opus 영역 단계 구현, 무조건 Opus 영역 구현, high로도 안 풀려 다시 보내는 일)이 남았는지 본다.
- 복사본 GUIDE의 `<!-- 무조건 Opus 시작 -->`과 `<!-- 무조건 Opus 끝 -->` 사이를 Q3에서 정한 영역의 목록으로 바꾼다. 표시 주석 줄은 지우지 않는다. `<!-- 사용자 규칙 시작 -->`과 `끝` 사이는 비워 둔다.
- 지시문 체크리스트를 「공통 줄과 고른 직군의 줄」로 만든다. 놓은 `~/.claude/subagent-system/docs/SUBAGENT_BRIEF_CHECKLIST.md`에는 공통 줄만 있다. Q1에서 고른 직군마다 `ROUTING_PRESETS.md`의 「지시문 체크리스트 기본 줄」 표에서 줄을 가져와, 「절」 칸이 가리키는 절의 표 끝에 「지킬 것」과 「이유」 두 칸으로 더한다. 그 절이 없으면 문서 끝에 같은 이름의 절과 표 머리줄(`| 지킬 것 | 이유 |`, `|:---|:---|`)을 만든다. 여러 직군에 「지킬 것」 문장이 글자까지 같은 줄이 있으면 한 번만 넣는다. 뜻이 같은 줄이 둘 이상 들어가게 되면(직군에 맞게 쓴 코드 리뷰 줄처럼) `ROUTING_PRESETS.md` 「여러 직군을 고를 때 합치는 규칙」대로 한 줄로 합치고, 직군마다 다른 부분은 한 문장 안에 함께 적는다. 같은 일을 맡길 때 어느 줄을 넣을지 두 가지로 읽히는 것을 막으려는 것이다. 합친 줄의 「이유」 칸도 두 줄의 이유를 한 칸에 함께 적는다. 업데이트의 체크리스트 대조는 합친 줄을 그 키트 줄들의 묶음으로 견준다(「체크리스트 대조」의 「견주는 기준」). 놓은 체크리스트에 같은 「지킬 것」 문장이 이미 있거나 합친 줄이 이미 있으면(끊긴 첫 설치를 이어 하는 경우) 넣지 않는다. 「판단과 리뷰를 맡길 때」 절은 공통 줄에 있고, 직군 줄은 그 절의 표 끝에 더해진다(옛 설치본의 체크리스트는 같은 절 이름이 「리뷰」이므로 그 절 끝에 더하고 새로 만들지 않는다). 기획과 문서처럼 줄이 없는 직군만 골랐거나 Q1에서 직군을 하나도 고르지 않았으면 공통 줄 그대로 둔다. 더한 줄 수를 직군별로 알린다. 여러 직군에 글자까지 같아 한 번만 넣은 줄과 뜻이 같아 합친 줄은 Q1 보기 순서(a부터 f)가 앞선 직군에 세고, 뒤 직군에는 「앞 직군과 같거나 합쳐 n줄은 따로 넣지 않았다」고 덧붙이며, 합친 줄은 합친 문장 원문을 함께 보인다.
- 복사본 정의 10개(`<임시 폴더>/agents/<정의>.md`)의 frontmatter `description`은 「일반 성격 한 문장. 표 칸 일 이름 나열. (가이드 경로)」 꼴이다. 가운데 일 이름 나열을 새 표에서 그 정의 칸의 일 이름으로 바꾼다. 괄호 부연은 줄여도 되고, 칸이 비면 일반 성격 문장과 가이드 경로만 남긴다. `opus-xhigh`는 일 이름을 나열하지 않으므로 그대로 둔다.
  - **description 자르는 법**(업데이트에서도 같다. 회고 스크립트도 같은 규칙으로 가른다):
    - 첫 문장은 맨 앞부터 처음 나오는 `. `(마침표와 공백)까지다. 괄호 안의 `. `는 건너뛴다.
    - 나열은 첫 문장 뒤부터 마지막 ``. (` `` 앞까지다. 끝의 마침표는 나열에 넣지 않는다.
    - 가이드 경로는 끝의 ``(`~/.claude/subagent-system/docs/SUBAGENT_GUIDE.md`)``다.
    - 가이드 경로를 뺀 나머지에 첫 `. `가 없으면 나열이 없는 description이다(예: `haiku-high`). 이런 정의에 일 이름을 더할 때는 첫 문장 끝의 마침표 뒤에 `<첫 문장>. <이름>, <이름>. (가이드 경로)` 꼴로 쓴다.
- Q4에서 글쓰기 줄(c)을 골랐으면 복사본 정의 10개 본문 맨 끝에 `extras/DEFINITION_WRITING_LINE.md`의 정의용 줄을 더한다(방법은 5단계). 놓은 뒤가 아니라 복사본에 더해야 한 번에 놓기가 줄까지 같이 놓는다.
- **한 번에 놓기**: 표, 목록, description이 모두 정해졌으면 복사본 GUIDE를 `~/.claude/subagent-system/docs/SUBAGENT_GUIDE.md`로, 복사본 정의 10개를 `~/.claude/agents/`로 한 번에 놓는다. 이 둘이 놓이기 전에는 `~/.claude`에 정의도 GUIDE도 없다.
- 훅은 `settings-hook.json`을 `~/.claude/settings.json`의 `hooks`에 합친다. 다른 키와 다른 훅은 그대로 둔다. 항목은 하나다.
  - `SubagentStop`: 서브에이전트가 끝날 때마다 비용을 적는 `node "$HOME/.claude/subagent-system/scripts/subagent-usage.js" --hook`이다.
  - 같은 이벤트에 이 키트의 것이 아닌 다른 훅이 이미 있으면 2단계 「기존 훅 확인」에서 받은 답을 따른다. 답은 `config.json`의 `installAnswers.hookAdd`(더하기로 한 이벤트)에 있다. 더하기로 한 이벤트만 더한다. 기존 항목은 두고 이 키트의 항목만 더한다.
  - `CLAUDE_CONFIG_DIR`을 쓰는 컴퓨터는 두 명령의 `$HOME/.claude`를 그 폴더로 바꿔 넣어야 하는데, 아래 명령이 이 변수를 보고 직접 바꿔 넣는다.
  - 합치기는 아래 명령으로 한다. Claude가 `settings.json`을 읽고 고쳐 통째로 다시 쓰지 않는다. 긴 파일에서 다른 훅 명령의 따옴표와 이스케이프가 깨지거나 같은 항목이 두 번 들어가는 것을 막으려는 것이다. `<더할 이벤트들>`에는 더할 이벤트만 공백으로 나눠 적는다(`SubagentStop`). 이 키트의 항목이 이미 있는 이벤트는 「이미 있음」을 찍고 건너뛴다. 다른 키와 다른 훅의 값은 그대로 두고 파일 권한도 지킨다. 심볼릭 링크면 가리키는 실제 파일에 쓴다. 명령이 오류로 멈추면 파일은 바뀌지 않았으니 오류를 사용자에게 보이고 멈춘다. 끝나면 「6. 확인」 1번 명령으로 읽어 본다.

```
<kit-setup> --add-hooks "$HOME/.claude/settings.json" "<키트>/subagent-system/settings-hook.json" <더할 이벤트들>
```

- 스크립트 명령은 어느 폴더에서 실행해도 결과가 같다. 훅은 서브에이전트 기록 파일의 첫 `cwd`로 프로젝트 열을 채운다.

## 4. 규칙 줄 넣기

`~/.claude/CLAUDE.md`에 아래 뜻을 그 파일의 말투와 형식에 맞춰 넣는다. 파일 맨 끝에 한 덩어리로 더하고, 앞뒤를 아래 표시 주석으로 감싼다(파일이 없으면 만든다). 표시 주석은 제거할 때 이 사이만 지우려는 것이라 문구를 그대로 쓴다. 구역의 이름과 경계는 표시 주석이 맡으므로 파일이 없어 새로 만들 때도 구역 안에 제목 줄을 따로 두지 않는다(5단계의 늘 지키는 규칙 구역도 같다).

```
<!-- subagent-system 시작 -->
(아래 규칙 줄)
<!-- subagent-system 끝 -->
```

- 표시가 이미 있으면 그 사이만 새 문장으로 바꾼다.
- 표시 사이에는 아래 규칙 줄만 넣고 사용자가 따로 쓴 줄은 넣지 않는다. 나중에 업데이트가 이 사이를 새 문장으로 바꿀 때 사용자 줄이 함께 지워지기 때문이다. 처음 설치는 규칙 줄을 파일 끝에 새 덩어리로 더하므로 사용자 줄이 섞이지 않는다.
- 사용자가 따로 쓴 같은 뜻의 줄이 표시 밖에 있으면 새로 더하지 않는다. 아래 위임 기준 질문보다 먼저 가린다. 「구역:」 줄(아래 규칙 줄의 「대신」 꼴과 「더한다」 꼴. 누가 더했든)은 이 가림에서 뺀다.
  - 같은 뜻인지 가르는 기준(5단계와 「업데이트 순서」 5번도 같다): 표시 밖 줄과 키트 문장, 두 줄을 따르면 같은 행동이 나오면 같은 뜻이다. 한쪽을 따르면 다른 쪽을 어기게 되면 부딪힌다. 그 밖은 다른 주제라 이 가림의 대상이 아니다. 같은 뜻인지 애매하면 같은 뜻으로 보지 않고 키트 문장을 구역에 넣은 뒤, 비슷한 사용자 줄의 위치를 함께 알린다. 사용자 줄이 키트 줄의 일부만 덮는 경우도 애매한 쪽이다(예: 5단계의 git 줄에서 「커밋은 지시할 때만 한다」는 push, 그 지시는 한 번에만 유효하다는 것, plan에 commit 단계를 적지 않는 것을 덮지 않는다). 이렇게 위치를 알린 사용자 줄은 구역 안 키트 줄과 한 파일에 겹쳐 남으므로 5-1단계가 되풀이 권고 후보로 넘겨받는다.
  - 뜻이 같은 줄은 묻지 않고 구역에도 더하지 않으며 그 줄의 위치만 알린다. 같은 뜻이라 고칠 것도 업데이트가 견줄 것도 없어 `keptOutsideLines`에도 남기지 않는다.
  - 뜻이 다른(부딪히는) 줄만 그 줄 원문과 고칠 문장을 같은 메시지에 보이고 그 자리에서 고칠지 묻는다. 두 줄의 목적을 함께 보이는 법은 5단계 「보기」와 같다. 보기는 a. (추천: 이 체계가 전제하는 규칙과 같은 뜻이 되어 메인이 키트 문서와 다른 기준으로 움직이지 않는다) 고칠 문장으로 바꾼다, b. 그대로 둔다(구역에도 넣지 않는다)이다.
  - a를 고르면 그 자리에서 고친다. 그 줄은 표시 밖이라 제거할 때 남는다. 줄 위치를 사용자에게 알린다.
  - b를 고르면 그 줄을 그대로 두고 구역에도 넣지 않는다. 그 줄 원문과 그때 견준 키트 문장의 쌍(`{"line": ..., "kit": ...}`)을 `installAnswers`의 `keptOutsideLines`에 더해 이어 하기가 같은 줄을 다시 묻지 않게 한다. 쌍은 설치를 마칠 때 `outsideLinesKept`로 옮겨 남는다(「7. 보고」). 같은 키트 줄과 부딪히는 사용자 줄이 여럿이면 5단계의 묶음 규칙대로 한 질문으로 묻는다.
  - 표시 밖 줄이 아래 위임 기준 두 줄(넣을 뜻의 첫째와 둘째 줄)을 대신하는지에 따라 위임 기준 질문을 가른다(대신하는 줄은 구역에 넣지 않는다).
    - 둘째 줄(위임 기준 목록)을 대신하면 위임 기준 질문을 하지 않는다.
    - 첫째 줄(오케스트레이션 줄)만 대신하면 위임 기준 질문은 그대로 한다.
  - 업데이트의 구역 비교는 이런 줄을 다시 넣자고 하지 않고, 그 줄의 키트 문장이 달라졌을 때만 고칠지 묻는다(「업데이트 순서」 5번).
- `CLAUDE_CONFIG_DIR`을 쓰는 컴퓨터는 아래 규칙 줄의 `~/.claude`와 `$HOME/.claude`를 「`CLAUDE_CONFIG_DIR`을 쓰는 컴퓨터」대로 바꿔 넣는다.

넣을 뜻은 다음과 같다. 아래 위임 기준(파일 3개 이상을 읽어야 하면 맡긴다 등)은 키트의 기본값이다. 넣기 전에 넣을 규칙 줄 전체(아래 목록을 그 파일의 말투와 형식에 맞춘 실제 문장. 표시 밖 줄이 대신하는 줄은 뺀다)를 같은 메시지에 보이고 위임 기준을 묻는다. 위임 기준 질문을 하지 않을 때도 넣을 규칙 줄 전체는 보이고 넣는다(넣을지는 묻지 않는다). 위임 기준은 메인이 직접 할 일과 서브에이전트에 맡길 일을 가르는 선이다. 기준을 낮추면(예: 파일 1개만 읽어도 맡김) 서브에이전트가 더 자주 돌고, 높이면 메인이 직접 하는 일이 늘어 메인 문맥에 소스가 더 쌓인다. 안 바뀌는 것은 표와 정의다. 보기는 a. (추천: 키트 기본값) 이대로 넣는다, b. 기준을 바꾼다(바꿀 값을 받는다)이다. b를 고르면 구역에는 키트 기본값을 그대로 넣고, 구역 바로 아래(표시 밖)에 「구역: <위임 기준 요지> 대신 <바꾼 기준>」 줄을 더한다. 끊겨도 한쪽만 남지 않게 구역과 이 줄은 한 번에 쓴다. 끊긴 설치를 이어 하는 경우 `CLAUDE.md`에 `subagent-system` 구역이 이미 있으면 위임 기준은 이미 답한 것이라 다시 묻지 않는다. 마지막 줄(저장소 밖의 변경을 묻는 규칙이 있어도 …)은 Q5에서 자동을 골랐고 `~/.claude/CLAUDE.md`에 저장소 밖 변경을 묻는 규칙이 있을 때만 넣는다.

- 메인 세션은 오케스트레이션을 한다. 다음을 모두 만족하는 간단한 일만 직접 한다: 파일 1~2개 읽기나 짧은 확인, 넓은 검색이 필요 없음, 파일을 만들거나 고치지 않음.
- 다음 중 하나라도 해당하면 서브에이전트에 맡긴다: 파일 3개 이상을 읽어야 함, 넓은 검색, 파일을 만들거나 고치는 일(구현, 문서 작성, 결과 가공 포함), 디버깅과 테스트 실행, 리뷰와 설계 검토와 원인 분석처럼 판단 범위가 넓은 일, 「조금만 더 보면 알 것 같다」 싶은 상황. 간단한 일로 시작했어도 파일 2개를 읽고 부족하면 멈추고 맡긴다.
- 서브에이전트 결과는 근거(파일 경로, 명령 출력)를 확인한 뒤 받아들인다. 근거 없이 결론만 온 것은 되묻거나 「미확인」으로 둔다.
- 독립적인 일은 서브에이전트를 병렬로 보낸다.
- 서브에이전트는 정의 이름(`subagent_type`)으로 부르고 `model`에는 그 정의의 모델(`haiku`, `sonnet`, `opus`)을 적는다(마지막 올리기 단계인 Fable 5.1의 예외는 GUIDE에 있다). 어느 정의로 보낼지는 `~/.claude/subagent-system/docs/SUBAGENT_GUIDE.md` 표로 정한다.
- 서브에이전트에 일을 보내기 전에 `~/.claude/subagent-system/docs/SUBAGENT_BRIEF_CHECKLIST.md`를 대조한다.
- 서브에이전트가 끝날 때마다 사용 기록에 한 줄 적는다(절차는 SUBAGENT_GUIDE 「기록과 회고」, 명령은 `subagent-retro.js --log`).
- 이 구역과 `claude-setup-kit extras` 구역(각각 표시 주석 사이)은 고치지 않는다. 구역 문장을 바꾸려면 구역 밖에 「구역: <바꿀 문장 요지> 대신 <새 문장>」 꼴로 적고, 구역 안 절이나 항목에 문장을 더하려면 「구역: <절이나 항목 이름>에 「<새 문장>」을 더한다」 꼴로 적는다. 그 줄이 구역 문장보다 먼저다.
- 맡긴 작업 하나가 끝났다고 판단될 때(최종 보고를 할 때)는 `node "$HOME/.claude/subagent-system/scripts/subagent-retro.js" --due --project "<세션을 시작한 폴더의 절대 경로>"`를 직접 돌린다. 마지막 줄에 「그 자리에서 고칠 것 N건」이 있으면 회고를 띄우기 전에 `~/.claude/subagent-system/docs/SUBAGENT_GUIDE.md`의 「그 자리에서 고치기」대로 먼저 처리하고, 그 뒤 첫 줄의 판정대로 한다. `ask`이고 이 세션에서 아직 묻지 않았으면 최종 보고 끝에 「회고 기준을 넘었습니다. 지금 회고할까요?」를 묻고(`--due` 마지막 줄에 「이미 지워졌을 수 있습니다」가 있으면 그 문장을 질문 앞에 붙여 함께 알린다), 「예」이면 회고를 시작한다(`~/.claude/subagent-system/docs/RETRO.md`의 「회고 단계」). `auto`이면 `~/.claude/subagent-system/docs/RETRO.md`의 「자동 회고」 「메인이 하는 일」대로 띄우고(같은 문장이 있으면 그것도 알린다) 하던 일을 이어 간다. 같은 세션에서 이미 물었거나 띄웠으면 다시 하지 않고, `wait`이면 하지 않는다. 사용자가 지금은 안 한다고 하면 같은 명령에 `--snooze`를 붙여 돌리고, 출력에 「지워질 수 있습니다」가 있으면 그 문장을 사용자에게 알린다. 회고할지의 판정과 별개로, `--due` 마지막 줄에 「물을 것 N건」이 있으면 이때 기록 폴더의 `retro-pending.md`를 읽어 항목을 한 번에 하나씩 묻고, 답을 받으면 적용하고 그 항목을 지운다. 첫 줄이 `wait`이어도, 이 세션에서 이미 물었어도, 회고 방식이 무엇이어도 한다. 답이 없거나 나중에 하자고 하면 항목을 그대로 두고 다음 작업이 끝날 때 다시 묻는다.
- 자동 회고가 끝나면 서브에이전트가 돌려준 한 줄을 사용자에게 그대로 알리고, 실패했으면 `--release --failed`로 잠금을 풀고 그 출력을 알린다. 병목 분석 리뷰어의 답은 메인이 `retro-pending.md`에 물을 것으로 덧붙이고, 리뷰어가 실패하면 「병목 분석 실패: <까닭>」 한 줄을 알린다. 절차는 `~/.claude/subagent-system/docs/RETRO.md`의 「자동 회고」다.
- 서브에이전트 하나가 20분을 넘기거나 같은 일을 여러 번 되풀이하면 `~/.claude/subagent-system/docs/SUBAGENT_GUIDE.md`의 「오래 걸릴 때」대로 한다.
- 지적을 받아 체크리스트나 규칙의 문장을 고친 뒤에도 같은 지적이 또 나오면 스크립트나 훅으로 막자고 제안하고, 그것으로도 또 나오면 `~/.claude/subagent-system/docs/SUBAGENT_GUIDE.md`의 「바깥 자료 조사」대로 제안한다.
- 저장소 밖의 변경을 묻는 규칙이 있어도, 자동 회고가 켜져 있으면 회고 서브에이전트가 `~/.claude/subagent-system/docs/SUBAGENT_GUIDE.md`의 사용자 표 구역과 사용자 규칙 구역, `~/.claude/subagent-system/docs/SUBAGENT_BRIEF_CHECKLIST.md`, `~/.claude/CLAUDE.md`의 표시 주석 구역 밖, `~/.claude/agents/`의 정의 description, 기록 폴더(고침 기록 `fixes.tsv` 포함)를 고치는 것과, 올린 칸에 정의가 없을 때 새 정의를 만들고 `~/.claude/subagent-system/config.json`의 `removedDefs`에서 그 이름을 빼는 것, 고치기 전에 `~/.claude/subagent-system-backup-retro-<날짜-시각>/` 폴더를 만드는 것은 묻지 않는다. 그 밖의 파일은 이 예외에 들지 않는다.

## 5. 함께 넣는 것(`../extras/`)

Q4에서 넣기로 한 a부터 c와 e만 넣는다. `extras/*.md`의 맨 위 제목 줄과 설명 문단은 어느 파일이든 넣지 않고, 아래 항목이 가리키는 규칙 줄만 넣는다. 넣지 않기로 한 것은 넣지 않는다. 하나도 안 넣기로 했으면 이 단계를 건너뛰되, e를 넣지 않기로 한 기록은 아래 e 항목대로 남긴다(d의 agent-meter는 5-2단계가 다룬다). 끊긴 설치를 이어 할 때는 `installAnswers`의 `q4Rules`, `q4GitAsk`, `q4WritingLine`, `q4GoalMethod`가 `true`인 것만 하고, 이미 들어 있는지는 파일로 가려 들어 있는 것은 다시 넣지 않는다.

- **늘 지키는 규칙(Q4 a)**: `extras/CLAUDE_RULES.md`의 규칙을 4단계와 같은 `~/.claude/CLAUDE.md`에 넣는다. 파일 맨 위의 제목 줄(`# 늘 지키는 규칙`)과 「넣는 법」 안내 문단은 넣지 않는다. 4단계 구역처럼 구역의 경계와 이름은 표시 주석이 맡으므로 제목 줄이 따로 필요하지 않다. 구역 안에는 `##` 소제목(「멈추고 묻는 경우는 둘뿐」 등)부터 들어간다. 「백엔드, 데이터, 인프라를 고른 경우」 묶음 둘(「멈추고 묻는 경우는 둘뿐」 아래와 「조사와 이슈 분석은 전수 실측」 아래)은 Q1에서 백엔드, 데이터(분석과 엔지니어링), 인프라와 운영 가운데 하나라도 골랐을 때만 넣는다(직군을 하나도 고르지 않았으면 넣지 않는다). 넣을 때는 소제목 줄을 빼고, 「멈추고 묻는 경우」 묶음의 한 줄은 ②의 하위 줄로, 「전수 실측」 묶음의 두 줄은 그 절 목록 끝에 잇는다. 자동 회고 예외는 4단계 구역의 마지막 규칙 줄이 이미 담고 있어 이 파일에는 없다. 고르지 않았으면 두 묶음 모두 넣지 않는다. 4단계의 표시 밖, 파일 맨 끝에 별도 덩어리로 더하고 앞뒤를 `<!-- claude-setup-kit extras 시작 -->`, `<!-- claude-setup-kit extras 끝 -->`로 감싼다. 표시가 이미 있으면 그 사이만 바꾸되, c의 메인용 줄이 그 사이에 있으면 지우지 않는다. 그 파일에 같은 뜻의 규칙이 표시 밖에 이미 있으면(예: 「필요한 말만 써라」) 새로 더하지 않는다(「구역:」 줄은 뺀다). 같은 뜻의 줄은 묻지 않고 그 줄의 위치만 알린다(4단계와 같다. 같은 뜻인지는 4단계의 기준으로 가르고, 애매하면 같은 뜻으로 보지 않고 넣은 뒤 비슷한 사용자 줄의 위치를 함께 알린다). ①이나 ② 가운데 하나라도 구역에 넣지 않으면(같은 뜻 줄로 빼거나, 아래 묶음 a로 빼거나, 이어 하기에서 이미 고친 줄로 빼는 경우 모두) 소제목의 「둘뿐」이 맞지 않으므로 소제목은 「멈추고 묻는 경우」로 넣는다. 부딪히는 줄만 묻고, 묻는 단위는 묶음이다. 아래 묶음 규칙은 4단계의 표시 밖 줄 점검과 「업데이트 순서」 5번의 두 구역 비교에도 같이 쓰인다(업데이트에서 다른 점은 그 자리에 적었다).
  - **묶음**: 부딪히는 사용자 줄과 그 줄이 부딪히는 키트 줄(소제목 줄이 아닌 줄)을 이어, 서로 연결된 것 전부를 한 묶음으로 본다. 묶음마다 한 질문으로 묻는다. 키트 쪽이 소제목 아래 여러 줄 덩어리(`## git` 등)여도 묶음에 드는 것은 그 사용자 줄과 부딪히는 줄뿐이다. 예를 들어 「작업 트리 바꾸는 git도 묻지 말고 해라」는 `## git`이 아니라 「멈추고 묻는 경우는 둘뿐」의 ②와 부딪히고, 「커밋은 알아서 해」는 ②와 `## git` 첫 줄에 부딪힌다. 두 사용자 줄이 ②로 이어지므로 사용자 줄 둘과 키트 줄 둘이 한 묶음이다. 같은 키트 줄과 부딪히는 사용자 줄이 여럿인 경우(「커밋은 알아서 해」와 「푸시도 알아서 해」)도 한 묶음이다. 따로 물으면 같은 고칠 문장이 두 줄 남고, 줄마다 고칠 문장이 달라 결과가 갈리기 때문이다.
  - **고칠 문장**: 묶음에 든 키트 줄을 키트 파일의 순서대로 이은 문장 하나다(키트 줄이 하나면 그 줄). 고칠 문장에 든 키트 줄이 소제목이나 앞 문장에 뜻을 기대는 줄이면(「멈추고 묻는 경우는 둘뿐」의 ①과 ②, 「조사와 이슈 분석은 전수 실측」과 「질문」 아래 목록 줄처럼 소제목이 범위를 정하는 줄), 그 줄 앞에 소제목이 주던 뜻을 한 구절로 붙여 혼자 읽어도 같은 행동이 나오게 한다. 예를 들어 ②는 「되돌릴 수 없는 작업(운영 데이터 변경, …)은 하기 전에 멈추고 묻는다」로, ①은 「정책 결정(API 동작, …)은 멈추고 묻는다」로 쓴다. 붙인 구절은 줄의 뜻을 풀어 쓴 것이라 업데이트 5번의 뜻 비교에서는 같은 뜻으로 본다. 질문에는 묶음의 사용자 줄 원문을 모두와 고칠 문장을 같은 메시지에 보이고, 고치는 순간 사용자의 규칙이 바뀐다고 함께 알린다.
  - **보기**: a. (추천: 이 체계가 전제하는 규칙과 같은 뜻이 되어 메인이 키트 문서와 다른 기준으로 움직이지 않는다) 사용자 줄을 키트 문장으로 고친다, b. 사용자 줄을 두고 키트 줄은 넣지 않는다.
  - **두 줄의 목적**: 질문에는 사용자 줄과 키트 줄이 각각 무엇을 막거나 이루려는지를 함께 보인다. 키트 줄은 줄에 붙은 목적 구절(없으면 이 문서가 그 줄에 적은 까닭)을, 사용자 줄은 줄에 적힌 목적(없으면 줄에서 읽히는 목적, 읽히지 않으면 그렇다고)을 쓴다. 두 목적이 같으면 그 사실을 a의 추천 이유로 쓴다(예: 「(추천: 두 줄 모두 검토하지 않은 변경이 기록되는 것을 막으려는 것이라, 키트 문장으로 고쳐도 사용자 줄의 목적이 지켜진다)」). 목적이 다르면 위 추천 이유를 쓰되 키트 문장으로 고치면 사용자 줄의 어느 목적이 빠지는지 함께 적는다. 사용자가 문장이 아니라 목적으로 고를 수 있게 하려는 것이다.
  - **a**: 묶음의 사용자 줄 가운데 파일에서 처음 나오는 줄을 고칠 문장으로 바꾸고 나머지 사용자 줄은 지운다. 지울 줄은 같은 질문에서 함께 보인다. 고친 줄은 표시 밖이라 제거할 때 남는다. 구역에는 묶음에 든 키트 줄을 뺀 덩어리 나머지 줄을 소제목과 함께 넣는다(남는 줄이 없으면 소제목도 넣지 않는다. ②를 뺐으면 ②의 하위 줄은 하위 줄 표시 없이 그 소제목 아래에 넣는다. ①이나 ②가 빠지면 소제목은 위 규칙대로 「멈추고 묻는 경우」로 넣는다. 빠진 줄의 뜻은 고친 사용자 줄이 지고 있다). 사용자 줄을 지우고 덩어리를 통째로 넣는 방식은 쓰지 않는다. 같은 말이 고친 사용자 줄과 구역에 두 번 남지 않게 하려는 것이고, 보기에 지우기가 보이지 않기 때문이다.
  - **b**: 사용자 줄을 모두 그대로 두고, 묶음에 든 키트 줄이 속한 덩어리 전체(덩어리가 여럿이면 모두)를 구역에 넣지 않는다. 사용자 줄마다 쌍 `{"line": 그 사용자 줄, "kit": 고칠 문장}`을 `keptOutsideLines`에 더한다(4단계와 같다).
  - 끊긴 설치를 이어 할 때 이미 고쳤거나 쌍이 있거나 같은 뜻인 줄은 다시 묻지 않는다. 쌍이 있는 줄은 b로 답한 것으로 보고, 그 쌍의 `kit`에 든 키트 줄이 속한 덩어리를 구역에 넣지 않는다(4단계는 그 키트 줄을 넣지 않는다). 구역을 쓰기 전에 끊겼어도 사용자 줄과 정반대 규칙이 한 파일에 함께 남지 않게 하려는 것이다.
- **git 명령 확인 목록(Q4 b)**: `extras/git-permissions.json`의 `permissions.ask` 항목을 `~/.claude/settings.json`의 `permissions.ask`에 합친다. 이 목록의 git 명령은 실행 전에 사용자 확인을 받는다. 같은 명령이 `Bash(...)`와 `PowerShell(...)` 두 벌로 들어 있다. Windows에서 claude.ai 계정은 PowerShell 도구가 기본으로 켜져 있어, `Bash(...)` 규칙만으로는 그 도구로 도는 git이 확인 없이 실행될 수 있기 때문이다(`PowerShell(...)` 규칙 문법은 https://code.claude.com/docs/en/permissions 의 PowerShell 절). macOS와 리눅스에서도 둘 다 합친다.
  - 합치기 전에 사용자의 `CLAUDE.md`에 브랜치 이동은 `git switch`, 파일 복원은 `git restore`를 쓰라는 규칙이 있는지 본다. 있으면 `switch`나 `restore`가 든 열두 항목(`Bash(git switch:*)`, `Bash(git restore:*)`, `Bash(git * switch)`, `Bash(git * switch *)`, `Bash(git * restore)`, `Bash(git * restore *)`와 그 짝인 `PowerShell(...)` 여섯)을 원문 그대로 보이며 목록에서 뺄지 먼저 묻는다. `git -C <폴더> switch`처럼 git 뒤에 옵션이 붙은 꼴은 `git * ...` 항목이 잡으므로, 네 항목만 빼면 그 꼴은 계속 확인 창이 뜬다. 넣으면 브랜치를 옮기거나 파일을 복원할 때마다 승인 창이 뜨고, 빼면 그 두 명령은 확인 없이 돈다. 안 바뀌는 것은 나머지 항목이다. 뺀 항목은 `settings.json`에 합치지 않고, 항목 문자열 그대로 `config.json`의 `gitAskDeclined`(배열)에 더한다. 업데이트가 이 항목을 빠진 키트 항목으로 다시 묻지 않게 하려는 것이다. 더하는 명령은 「체크리스트 대조」의 `checklistDeclined` 명령에서 키 이름만 `gitAskDeclined`로 바꾸고 항목을 `<<'EOF'`로 한 줄에 하나씩 넘기는 것이다.
  - 이미 있는 항목은 다시 넣지 않고, 같은 명령이 `permissions.allow`에 있으면 고치지 말고 사용자에게 보여 묻는다. 묻고 사용자가 넣지 않기로 한 항목도 위와 같은 명령으로 `gitAskDeclined`에 더한다.
  - 끊긴 설치를 이어 할 때 `gitAskDeclined`에 든 항목은 묻지 않고 합치지 않는다.
  - 합치기도 아래 명령으로 하고, Claude가 `settings.json`을 통째로 다시 쓰지 않는다(위 훅과 같은 까닭이다). 먼저 끝 인자를 `check`로 돌리면 아무것도 쓰지 않고 `permissions.allow`에도 있는 항목(「allow에도 있음:」)과 더할 항목 수를 찍는다. 그 항목을 위대로 묻고, 넣지 않기로 한 것과 위에서 뺀 switch, restore 항목을 `gitAskDeclined`에 더한 뒤 끝 인자를 `merge`로 다시 돌린다. 명령은 `permissions.ask`에 이미 있는 항목과 `config.json`의 `gitAskDeclined`에 든 항목을 빼고 나머지를 키트 순서대로 끝에 더한다. 다른 키와 기존 항목은 그대로 두고 파일 권한도 지킨다.

  ```
  <kit-setup> --merge-git-ask "$HOME/.claude/settings.json" "<키트>/extras/git-permissions.json" "$HOME/.claude/subagent-system/config.json" <check 또는 merge>
  ```

- **글쓰기 줄(Q4 c)**: `extras/DEFINITION_WRITING_LINE.md`의 「더할 줄」 두 가지를 넣는다. 방법은 그 문서의 「더하는 법」을 따른다.
  - 메인용 줄은 `~/.claude/CLAUDE.md`의 `claude-setup-kit extras` 표시 사이, 구역 맨 끝에 더한다. a도 골랐으면 `CLAUDE_RULES.md` 내용 바로 뒤다. a를 고르지 않아 구역이 없으면 4단계의 표시 밖, 파일 맨 끝에 같은 표시 주석 두 줄로 구역을 만들어 이 줄만 넣는다. 그 파일에 같은 뜻의 줄이 표시 밖에 이미 있으면(4단계의 기준으로 가르고, 애매하면 같은 뜻으로 보지 않고 더한 뒤 비슷한 줄의 위치를 함께 알린다) 더하지 않고 그 줄의 위치를 알린다. 구역 안에 이미 있으면(끊긴 설치를 이어 하는 경우) 더하지 않는다.
  - 정의용 줄은 정의 10개 본문 맨 끝에 더한다. 3단계에서 정의 description을 고칠 때 임시 폴더의 복사본 정의에 더하고, 한 번에 놓기가 `~/.claude/agents/`에 함께 놓는다. `~/.claude/agents/`에 놓은 정의에는 더하지 않는다. 이 줄은 정의 본문이라 업데이트 때 키트 것으로 바뀌므로, 업데이트가 다시 더한다.
- **목표와 방법(Q4 e)**: `extras/GOAL_AND_METHOD.md`의 「목표와 방법」 절(소제목 줄부터 끝 줄까지. 맨 위 제목 줄과 「넣는 법」 문단은 넣지 않는다)을 `claude-setup-kit extras` 구역 맨 끝에 넣는다. a나 c를 넣었으면 그 뒤다. 구역이 없으면 4단계의 표시 밖, 파일 맨 끝에 같은 표시 주석 두 줄로 구역을 만들어 이 절만 넣는다. 표시 밖에 같은 뜻의 줄이 있거나 부딪히는 줄이 있으면 a와 같은 규칙(4단계의 같은 뜻 기준, 묶음, 고칠 문장, 보기, 두 줄의 목적)으로 다룬다. 구역 안에 이미 있으면(끊긴 설치를 이어 하는 경우) 넣지 않는다.
  - 키트 절을 넣지 않는 쪽이면 `config.json`의 `goalMethodDeclined`를 `true`로 남긴다. 「넣지 않는다」로 답했을 때와, 같은 뜻의 사용자 줄이 있어 그것을 두고 키트 절은 넣지 않기로 했을 때 모두 해당한다. 업데이트가 이 항목을 새 항목으로 다시 묻지 않게 하려는 것이다. 명령은 5-2단계 「statusLine 정리」 9번의 명령에서 마지막 두 인자를 `goalMethodDeclined`와 `'true'`로 바꾼 것이다.

## 5-1. CLAUDE.md 개선 권고

처음 설치에서만 한다(업데이트에서는 하지 않는다). 끊긴 설치를 이어 할 때 `installAnswers`의 `claudeMdAdviceDone`이 `true`이면 이 단계를 하지 않는다(도중에 끊겼으면 처음부터 다시 권한다). 4단계와 5단계로 `CLAUDE.md`에 구역을 넣은 뒤, 5-2단계(`q4AgentMeter`가 `true`일 때)와 6단계 확인 전에 한다. 사용자의 `~/.claude/CLAUDE.md`(`CLAUDE_CONFIG_DIR`이 있으면 그 폴더의 `CLAUDE.md`)를 읽고 개선을 권한다. 권하기만 하고, 고치는 것은 사용자가 고른 것만이다. 이 문서의 목록이 권고 내용이므로 아래 주소를 직접 열어 읽을 필요는 없다. 주소는 사용자가 읽어 볼 수 있게 권고마다 함께 보여 준다.

- 읽는 범위: `<!-- subagent-system 시작 -->`과 `끝` 사이, `<!-- claude-setup-kit extras 시작 -->`과 `끝` 사이는 키트가 넣은 구역이라 보지 않는다. 구역 문장을 바꾸거나 구역에 문장을 더하는 「구역:」 줄도 보지 않는다. 권고 대상 줄은 그 밖의 줄뿐이다. 4단계와 5단계에서 구역 안 키트 줄과 겹친다고 위치를 알린 사용자 줄은 구역 밖 줄이므로 대상에 들어가고, 아래 되풀이 권고의 후보가 된다(대화에 남은 줄만 쓰고, 이어 연 대화에서 대화에 없으면 후보도 없다). 다만 줄 수는 키트 구역을 포함한 파일 전체로 센다(구역도 같은 파일이라 매 세션 문맥에 올라가고, 스크립트와 `RETRO.md`도 전체로 센다). 이 단계의 「기준 줄 수」는 회고와 같은 값이다. 키트 `docs/RETRO.md`의 「반복 찾기」 가운데 CLAUDE.md 정리 항목에서 읽고, 설치본 `config.json`에 `claudeMdLimitLines`가 있으면 그 값을 쓴다. 파일이 없거나 구역만 있거나 권고할 것이 없으면(기준 줄 수를 넘는 것만으로는 권고가 되지 않는다) 「CLAUDE.md에 권고할 것이 없다」고 한 줄만 알린다(명령 출력은 전하지 않는다). 전체가 기준 줄 수를 넘는데 다른 권고가 없으면 그 한 줄에 줄 수를 넣는다(예: 「CLAUDE.md에 권고할 것이 없다. 키트 구역을 포함해 N줄로 권장 M줄을 넘지만 줄일 곳을 찾지 못했다」). 권고를 마친 갈래와 같이 아래 진행의 5번(`--claude-md-done`)과 6번(`claudeMdAdviceDone`)을 한 뒤 5-2단계로 간다(`q4AgentMeter`가 `true`가 아니면 6단계). 전체 줄 수가 기준 줄 수를 넘으면 그 줄 수가 남아 첫 회고가 같은 제안을 되풀이하지 않고, 이하이면 남길 것이 없어 명령이 키를 지울 것이 없다고 찍는다.
- 권고는 두 갈래 근거에서 나온다.

**모델과 상관없는 것**(근거 https://code.claude.com/docs/en/memory)
- 키트 구역을 포함한 파일 전체가 기준 줄 수를 넘으면 권고 목록 머리(다른 권고가 없으면 위 「권고할 것이 없다」 한 줄)에 그 줄 수를 근거로 적는다(구역 줄도 세지만 줄일 대상은 구역 밖 줄이다). 기준 초과는 따로 묻지 않고, 줄이는 방법은 아래 권고들(옮기기, 되풀이 지우기, 같은 뜻을 더 짧게 쓰기 등)로 묻는다. 구역 안 줄은 줄이지 않는다. 기준 줄 수는 권장값이라 매 세션 필요한 줄은 남기고, 같은 뜻을 더 짧게 쓸 수 있을 때만 줄이자고 한다.
- 서로 모순되거나 같은 말을 되풀이하는 줄은 합치거나 지운다. 어느 쪽으로 합칠지는 `CLAUDE.md`에 목표(무엇이 어떻게 좋아지면 되는지)가 적혀 있으면 그 목표에 맞는 쪽을 권하고 추천 이유에 목표 문장을 적는다. 목표가 없거나 목표로 가르지 못하면 두 줄이 각각 무엇을 막으려는지(줄에 적힌 목적, 없으면 줄에서 읽히는 목적)를 함께 보이고 추천 없이 묻는다. 두 줄 가운데 어느 쪽이 맞는지를 짐작으로 정하지 않으려는 것이다. 4단계와 5단계에서 넘겨받은 줄은 구역 안 키트 줄을 두고 그 사용자 줄을 지우거나 줄이는 권고로 한다(구역 안 줄은 고치지 않는다).
- 여러 단계 절차나 작업 방식은 스킬로 옮긴다.
- 특정 파일을 다룰 때만 필요한 규칙은 경로 한정 규칙(`~/.claude/rules/<이름>.md`에 `paths:` frontmatter)으로 옮긴다.
- 가끔 보는 참고 내용은 별도 문서로 빼고, `CLAUDE.md`에는 「~할 때 `<경로>`를 읽는다」처럼 읽을 상황이 분명한 조건과 백틱으로 감싼 경로 한 줄만 남긴다. `@<경로>`로 가져오는 것은 세션 시작 때 본문을 통째로 읽어 줄지 않으니 쓰지 않는다.

**모델에 따른 것**(근거 https://claude.dev/blog/getting-the-most-out-of-opus-5-5/ , Opus 5.5 기준 글)
- 「think hard」, 「think carefully」, 「think step by step」 같은 줄은 지운다. 모델이 생각할 양을 스스로 정한다.
- 입력이 필요 없는 단계는 멈추지 않고 이어 가게 하고, 멈출 때(입력 없이는 못 나갈 때, 되돌리기 어려운 작업 전)를 적는다. `CLAUDE.md`에 그런 줄이 없을 때만 권한다. Q4에서 a(`extras/CLAUDE_RULES.md`)를 넣었으면 「멈추고 묻는 경우는 둘뿐」이 이미 있으므로 이 권고는 뺀다.
- 작업이 끝날 때의 보고 형식을 적는다. 글이 권하는 것이라 자동으로 넣지 않고, 「글이 권한다」는 선택지로만 보여 준다. Q4에서 a(`extras/CLAUDE_RULES.md`)를 넣었으면 「작업을 마친 뒤 하는 보고」가 이미 있으므로 이 권고는 뺀다.

지금 세션의 모델 ID(모르면 「7. 보고」 모델 항목처럼 사용자에게 `/model` 화면을 보여 달라고 한다)에 `claude-opus-5-5`가 들어 있지 않으면(공급자 접두사나 `@` 꼬리가 붙은 ID도 이 이름이 들어 있으면 Opus 5.5로 본다. `settings.json`의 `model` 키만 보고 가리지 않는다) 모델에 따른 권고는 적용하지 않는다. 그 모델의 같은 종류 공식 글을 보라고 알리고, 위 글의 모델별 권고는 그대로 쓰지 않는다고 말한다(글이 낡을 수 있다). 모델과 상관없는 권고만 한다.

진행은 이렇게 한다.
1. 권고 목록을 먼저 한 번에 보여 준다. 권고마다 해당 줄(위치와 줄 수), 근거 주소를 적고, 기준 줄 수를 넘었으면 목록 머리에 전체 줄 수와 근거 주소를 적는다.
2. 권고마다 한 번에 하나씩(`권고 1/N`) 「묻는 방법」대로 묻는다. 선택지는 a/b로 쓰고, 줄을 줄이거나 옮기는 권고는 고친 뒤의 문장 원문을 보인다. 보고 형식은 추천 없이 「(글이 권함)」으로 보이고, 하겠다고 하면 `extras/CLAUDE_RULES.md`의 「작업을 마친 뒤 하는 보고」 절 원문(소제목 줄부터 끝 줄까지)을 같은 메시지에 보이고 그대로 `CLAUDE.md`의 키트 구역 밖 맨 끝에 넣는다.
3. 고치기 전에 2단계 백업 폴더에 `CLAUDE.md`가 있는지 본다. 이미 있으면 그대로 두고 고친다. 백업 폴더가 없거나 `CLAUDE.md`가 없는데 사용자 줄이 든 `CLAUDE.md`가 있으면, 고치기 전에 그 파일을 백업 폴더(없으면 새로 만든 같은 꼴의 폴더)에 복사해 두고 경로를 알린다.
4. 사용자가 고른 것만 고친다. 스킬, 경로 한정 규칙, 별도 문서를 새로 만들면 경로를 알린다. 키트 구역 안은 고치지 않는다.
5. 권고를 마친 뒤 `CLAUDE.md`가 기준 줄 수를 넘으면(받아들인 수와 상관없이) 그때의 전체 줄 수를 2단계에서 만든 `config.json`의 `claudeMdKeptLines`에 적는다(첫 회고가 같은 제안을 되풀이하지 않게 하려는 것이다). 명령은 `node "$HOME/.claude/subagent-system/scripts/subagent-retro.js" --claude-md-done`이다(전체 줄 수는 스크립트가 세어 기준 줄 수를 넘으면 적고 이하이면 키를 지운다). `CLAUDE_CONFIG_DIR`을 쓰는 컴퓨터는 `$HOME/.claude`를 「`CLAUDE_CONFIG_DIR`을 쓰는 컴퓨터」대로 그 폴더로 바꿔 넣는다.
6. 끝나면 `claudeMdAdviceDone`을 `true`로 쓰고(「답 기록」 명령) 5-2단계(`q4AgentMeter`가 `true`가 아니면 6단계)로 간다. 6단계 7번(`CLAUDE.md` 표시 주석 짝 확인)이 고친 결과에 대해 돈다.

## 5-2. agent-meter 설치

처음 설치에서 `installAnswers`의 `q4AgentMeter`가 `true`이면 한다(이미 깔려 있어 d를 묻지 않는 경우도 `true`다. 업데이트에서 깔거나 갱신하는 것은 「업데이트 순서」 7번이 이 단계를 가져다 쓴다). `true`가 아니면 건너뛰고 6단계로 간다. 끊긴 설치를 이어 할 때도 같고, keep-alive 답은 `installAnswers`의 `q4AgentMeterKeepalive`에서 읽는다(키가 없으면 묻지 않은 것이라 지금 값을 건드리지 않는다). `claude plugin` 명령이 사용자 `settings.json`에 쓰므로(마켓플레이스 등록, 켠 표시, 옵션) 이 단계는 `settings.json`을 고치는 다른 단계(3단계의 훅, 5단계의 git 확인 목록)를 모두 마친 뒤에 한다. 아래 명령은 Claude Code 2.1.292 이상이 필요하고 0단계의 버전 기준(2.1.293)이 이미 넘는다.

1. 지금 상태를 가른다.
   - **예전 방식 흔적**: `~/.claude/mods/agent-meter/.claude-plugin/plugin.json`이 있거나 `settings.json`의 `env.CLAUDE_CODE_PLUGIN_DIRS`에 그 폴더 항목이 있다. 이 키트의 옛 설치 스크립트로 깐 것이다. 아래 2번과 3번으로 마켓플레이스 설치를 먼저 하고, 확인을 통과한 뒤 4번에서 옛 것을 치운다. 옛 항목이 남으면 `CLAUDE_CODE_PLUGIN_DIRS`로 읽힌 폴더가 같은 이름의 마켓플레이스 복사본을 조용히 대신해 새 버전이 읽히지 않는다(근거 https://code.claude.com/docs/en/plugins/loading 의 「Name conflicts」).
   - **마켓플레이스로 깔려 있음**: `claude plugin list --json`의 `id` 가운데 `agent-meter@claude-token-save`가 있다. 2번의 설치 대신 `claude plugin marketplace update claude-token-save`와 `claude plugin update agent-meter@claude-token-save`를 차례로 돌린다. `already at the latest version`이 나와도 정상이다(마켓플레이스가 새 버전을 내놓지 않았거나 이미 최신이다). 새 버전은 다음 세션부터 읽힌다.
   - 둘 다 아니면 새로 깐다. 둘 다 해당하면(예전 방식 흔적과 마켓플레이스 설치가 함께 있음) 갱신하고 4번을 한다.
2. 새로 까는 명령은 아래와 같다. 마켓플레이스 `claude-token-save`가 아직 없으면 명령이 등록까지 하고 `Successfully added marketplace: claude-token-save (declared in user settings)`를 찍는다. 이미 있으면 그것을 쓴다. 사용자 범위(기본값)로 깐다.

   ```
   claude plugin install agent-meter --marketplace daum7766/claude-token-save
   ```

   - 이번에 받은 keep-alive 답(처음 설치는 `installAnswers`의 `q4AgentMeterKeepalive`, 업데이트는 「업데이트 순서」 7번에서 받은 답)이 끔이면 `--config keep_alive=false`를 덧붙인다. 켬이거나 답이 없으면 붙이지 않는다(기본값이 켬이다). 예전 방식에서 옮기는 컴퓨터도 이번 답이 있으면 옛 `AGENT_METER_KEEPALIVE` 값보다 이 답이 먼저이고, 답이 없을 때만 옛 값을 4번에서 옮긴다.
   - 마켓플레이스를 새로 등록하는 것은 확인 없이 되는 명령이다. 그래서 Q4의 d(업데이트는 7번)에서 사용자가 이미 넣겠다고 답했거나 갱신을 맡긴 경우에만 돌린다.
   - `claude`를 Bash로 돌려도 이 명령은 확인 질문 없이 끝난다(확인 질문은 마켓플레이스가 설치 명령을 실행하는 플러그인에만 있다. 근거 https://code.claude.com/docs/en/plugins/cli-reference 의 `plugin install`).
3. 출력을 읽고 설치를 확인한다. 재시작 없이 되는 확인이라 설치 직후, 옛 것을 치우기 전과 statusLine 정리 전에 한다.
   - **실패(종료 코드 1)**: 출력을 그대로 보여 주고 이 단계를 멈춘다. 설치 전에 막히므로 바뀐 것이 없고 예전 방식 흔적도 건드리지 않았다. 출력이 관리 설정이 마켓플레이스 출처를 막았다는 뜻이면(0단계에서 파일로 읽지 못한 서버나 MDM 설정이 여기서 드러난다) 이 갈래가 오류 갈래다. 묻지 않고, 사용자에게 까닭(조직 설정이 이 마켓플레이스 출처를 막아 깔지 못했다)과 서브에이전트 체계는 agent-meter 없이 돈다는 것을 알린다. `config.json`에 `agentMeterDeclined`를 `true`로 남기고(명령은 아래 「statusLine 정리」 9번의 명령에서 마지막 두 인자를 `agentMeterDeclined`와 `'true'`로 바꾼 것), keep-alive를 물었으면 `agentMeterKeepaliveAsked`도 같은 명령으로 `true`로 남기고(답은 반영되지 않았으므로 「알아 둘 것」에 적는다), 처음 설치이면 `installAnswers`의 `q4AgentMeter`를 `false`로 고친다. 이 갈래는 확인을 통과한 것으로 보고 이어 가며, statusLine 정리와 4번은 하지 않는다. 오류 갈래가 아닌 실패(네트워크, 저장소 접근 등)는 이 단계를 멈추고 출력만 보여 주며, `agentMeterDeclined`는 남기지 않는다.
   - **성공**: `claude plugin list`에서 `agent-meter@claude-token-save` 항목이 `Scope: user`, `Status: ✔ enabled`이고 `Version`이 찍혀야 한다. `claude plugin list --json`의 그 항목에 `errors`가 없어야 한다. 항목이 없거나 `enabled`가 아니거나 오류가 있으면 설치를 멈추지 않는다. 찍힌 출력을 「7. 보고」(업데이트는 「업데이트 뒤 보고」)의 「알아 둘 것」에 적고 이어 간다. 6단계 12번의 표 확인에서 안 보이면 함께 알린다. 이 경우 4번은 하지 않는다(옛 것을 치우면 표가 없어진다).
   - keep-alive를 끈 설치이면 옵션이 저장됐는지 본다. `node -p "JSON.stringify(((JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).pluginConfigs||{})['agent-meter@claude-token-save']||{}).options||null)" "$HOME/.claude/settings.json"`가 `keep_alive`가 거짓(`false` 또는 `"false"`)인 객체를 찍어야 한다. `null`이거나 값이 없으면 저장되지 않은 것이다. 이때는 「알아 둘 것」에 적고, 사용자에게 Claude Code 안에서 `/config`의 agent-meter 줄이나 `/plugin configure agent-meter@claude-token-save`로 끄고 Claude Code를 다시 열라고 안내한다(`pluginConfigs`의 정확한 모양은 이 문서가 `미확인`이다).
   - 이미 `agent-meter@claude-token-save`로 깔려 있어 1번이 갱신으로 간 컴퓨터에서 keep-alive를 물어 받은 이번 답(위 2번 항목의 답)이 지금 값과 다르면 `echo '{"keep_alive":"true"}' | claude plugin configure agent-meter@claude-token-save --values-stdin`(끔이면 `"false"`)으로 바꾼다. `Configuration saved. Restart Claude Code to apply it.`가 나와야 하고, 바꾼 값은 Claude Code를 다시 열어야 적용된다고 알린다. `Failed to save configuration:`이 나오거나 종료 코드가 1이면 출력을 「알아 둘 것」에 적고 `/config`의 agent-meter 줄로 바꾸라고 안내한다(`configure`가 문자열을 불리언으로 받는지는 이 문서가 `미확인`이다).
   - keep-alive를 물었으면(처음 설치의 Q4 d 후속 질문, 이미 깔려 있어 대신 묻는 질문, 「업데이트 순서」 7번의 질문 모두) 답을 반영한 뒤 `config.json`에 `agentMeterKeepaliveAsked`를 `true`로 남겨 다음 업데이트가 다시 묻지 않게 한다. 명령은 아래 「statusLine 정리」 9번의 명령에서 마지막 두 인자를 `agentMeterKeepaliveAsked`와 `'true'`로 바꾼 것이다. 3번의 오류 갈래로 가서 답을 반영하지 못했어도 물었으면 남기고(오류 갈래는 위 3번 실패 항목에서 남긴다), 반영하지 못한 답은 「알아 둘 것」에 적는다.
   - `jq --version`이 실패하면 resume(`claude --resume`으로 지난 대화를 다시 연 것)한 세션의 지난 사용량을 되살리는 기능만 빠진다고 전하기만 한다. `jq`를 설치하지 않는다.
4. 예전 방식을 치운다(1번에서 예전 방식 흔적이 있었고 3번이 성공해 `✔ enabled`일 때만). 묻지 않고 하되, 하기 전에 아래 셋을 한 메시지로 알린다(「지킬 규칙」의 확인에서 빠진다. 이미 깐 사람이 업데이트를 맡겼기 때문이다).
   - 사용자 `settings.json`의 `env`에서 `CLAUDE_CODE_PLUGIN_DIRS`의 agent-meter 폴더 항목만 빼고(다른 항목은 그대로, 비면 키를 지운다) `AGENT_METER_KEEPALIVE` 키를 지운다. 둘 뒤에 `env`가 비면 `env` 키도 지운다. 고치기 전 파일은 `settings.json.bak-agent-meter-<날짜-시각>`으로 남는다.
   - `~/.claude/mods/agent-meter` 폴더를 지우지 않고 `~/.claude/agent-meter-backup-<날짜-시각>/`으로 옮긴다. 손으로 고친 파일이 있었을 수 있어서이고, `mods/` 밖에 두어 Claude Code가 mod로 읽지 않게 한다.
   - 이번에 받은 keep-alive 답이 없고 옛 `AGENT_METER_KEEPALIVE`가 끔이었으면 같은 값을 새 설정(`keep_alive`)으로 옮긴다. 이번 답이 있으면 2번이 이미 그 답으로 깔았으므로 옮기지 않는다.

   순서는 옛 값 읽기, 새 설정으로 옮기기, 옛 항목 지우기다. 옛 `AGENT_METER_KEEPALIVE`는 지우는 순간 값이 사라지므로, 먼저 읽기만 하고 옮긴 것을 확인한 뒤에 지운다. 중간에 끊겨 다시 돌려도 같은 결과가 나온다. 값이 아직 있으면 옮기기부터 다시 하고, 이미 지워졌으면 옮기기는 앞서 끝난 것이다.

   a. 옛 값을 읽기만 한다. `끔`이면 b를 하고, `켬`이나 `키 없음(켬)`이면 b를 건너뛴다(새 설정의 기본값이 켬이다). `CLAUDE_CONFIG_DIR`을 쓰는 컴퓨터는 인자의 `$HOME/.claude`를 그 폴더로 바꿔 넣는다.

   ```
   node -p "const v=(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8').replace(/^﻿/,'').trim()||'{}').env||{}).AGENT_METER_KEEPALIVE;v===undefined?'키 없음(켬)':['0','false','off'].includes(String(v).trim().toLowerCase())?'끔':'켬'" "$HOME/.claude/settings.json"
   ```

   b. 새 설정으로 옮긴다. 명령은 `echo '{"keep_alive":"false"}' | claude plugin configure agent-meter@claude-token-save --values-stdin`이고 `Configuration saved. Restart Claude Code to apply it.`가 나와야 한다(바꾼 값은 Claude Code를 다시 열어야 적용된다. 근거 https://code.claude.com/docs/en/plugins/cli-reference 의 `plugin configure`). `Failed to save configuration:`이 나오거나 종료 코드가 1이면 옛 키와 경로를 지우지 않고 4번을 여기서 멈춘다. 출력을 그대로 「알아 둘 것」에 적고, 사용자에게 `/config`의 agent-meter 줄로 끄고 같은 요청을 다시 해 달라고 안내한다(`configure`가 문자열 `"false"`를 불리언으로 받는지는 이 문서가 `미확인`이다).

   c. 옛 항목을 지운다. 명령 하나가 `settings.json` 읽기, 백업, 고치기, 쓰기를 이어 한다(심볼릭 링크면 실제 대상에 쓰고, 파일 권한을 지킨다). 읽기에서 끊긴 JSON이면 멈추고 아무것도 바꾸지 않는다. `CLAUDE_CONFIG_DIR`을 쓰는 컴퓨터는 마지막 두 인자의 `$HOME/.claude`를 「`CLAUDE_CONFIG_DIR`을 쓰는 컴퓨터」대로 그 폴더로 바꿔 넣는다.

   ```
   <kit-setup> --remove-agent-meter "$HOME/.claude/settings.json" "$HOME/.claude/mods/agent-meter"
   ```

   d. 이어 옛 폴더를 옮긴다. 폴더가 없으면 「옮길 폴더 없음」이 찍힌다. 같은 이름이 있으면 덮어쓰지 않고 `-1`, `-2`를 붙인다. 옮긴 뒤 `~/.claude/mods/`가 비어도 그 폴더는 그대로 둔다. `CLAUDE_CONFIG_DIR`을 쓰는 컴퓨터는 인자의 `$HOME/.claude`를 그 폴더로 바꿔 넣는다.

   ```
   <kit-setup> --move-agent-meter "$HOME/.claude/mods/agent-meter"
   ```

   - 4번을 마치면 `claude plugin list`가 3번처럼 `✔ enabled`인지 한 번 더 본다. `node -p "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).env?.CLAUDE_CODE_PLUGIN_DIRS" "$HOME/.claude/settings.json"`가 agent-meter 폴더를 가리키는 항목을 더 찍지 않아야 한다.
5. 3번이 성공했으면(4번을 했으면 그 뒤에) 아래 「statusLine 정리」를 한다. 사용자 설정 폴더에 statusLine이 없어도 프로젝트 쪽에 있을 수 있어 늘 한다. 3번이 실패했거나 오류 갈래였으면 하지 않는다.
6. 재시작은 따로 청하지 않고 6단계 9번(업데이트는 「업데이트 순서」 10번)의 재시작에 합친다. 새로 깐 플러그인과 갱신된 버전은 다음 세션부터 읽힌다.

### statusLine 정리

statusLine은 화면에 모델이나 비용 같은 것을 한 줄로 보여 주는 Claude Code 설정이다. agent-meter 표와 같은 정보를 보여 주면 같은 숫자가 두 번 보이므로, 겹치는 것을 정리할지 묻는다. 고치는 대상은 사용자 설정 폴더(`~/.claude`, `CLAUDE_CONFIG_DIR`이 있으면 그 폴더)의 `settings.json`과 그 `statusLine`이 부르는 스크립트(저장소 밖)뿐이다. 프로젝트 저장소의 `.claude/settings.json`, `.claude/settings.local.json`, 저장소 안 스크립트는 읽어서 겹치는 항목만 알리고 고치지 않는다(이 문서 첫머리의 「프로젝트 저장소에는 아무것도 넣지 않는다」). `config.json`에 `statusLineCleanup`이 있으면(끊긴 설치를 이어 하는 경우) 이미 한 것이라 하지 않는다. 순서는 이렇다.

1. 사용자 설정 폴더의 `settings.json`과 현재 프로젝트의 `.claude/settings.json`, `.claude/settings.local.json`(맨 위 규칙대로 읽는다)에서 `statusLine`을 읽는다(사용자 설정 폴더와 같은 폴더이면 프로젝트 `.claude/settings.json`은 사용자 `settings.json`과 같은 파일이라 따로 읽지 않고 고칠 수 있는 쪽으로 다룬다. 그 폴더의 `settings.local.json`은 프로젝트 로컬 파일이라 프로젝트 쪽으로 읽고 고치지 않는다). 셋 다 없으면 「statusLine 설정이 없어 정리할 것이 없다」고 한 줄 알리고 `statusLineCleanup`은 남기지 않은 채 끝낸다(9번대로 남기지 않는 경우다).
2. `type`이 `command`이면 `command`가 가리키는 스크립트를 읽어 그 상태줄이 보여 주는 항목을 뽑는다. 파일 없이 한 줄 명령이면 그 명령 문자열을 읽는다. 스크립트를 읽지 못했거나(파일이 없음, 경로를 풀지 못함, 권한 없음) `type`이 `command`가 아니면 항목을 `미확인`으로 두고 어디를 봤는지 적은 뒤 건너뛴다. 다만 한 줄 명령이 패키지 실행기(`npx`, `bunx`, `pnpm dlx`, `uvx` 등)로 외부 도구를 부르거나 PATH에 있는 외부 프로그램을 이름만으로 부르는 경우(읽을 스크립트 파일이 없고 문자열에서 항목을 뽑지 못하는 것)는 건너뛰지 않는다. 그 도구가 무엇을 보여 주는지 이 문서가 읽을 수 없으므로 항목을 `미확인`으로 두고, 5번에서 a 없이 b와 c만 묻는다.
3. 뽑은 항목을 agent-meter 항목과 견준 표를 보인다. 행은 모델, effort, 문맥 사용률, 세션 비용 합계, 토큰, git 브랜치, 작업 폴더이고, 열은 「지금 상태줄」과 「agent-meter」다. agent-meter 쪽은 `model` 열, `effort` 열, `context` 열, 첫 줄의 `total`, 토큰 열 넷(`/meter tokens`로 켜고 끈다), `branch`, `path`다.
   - 보여 주는 정도가 달라도(예: 작업 폴더를 상태줄은 폴더 이름만, agent-meter는 `~`로 줄인 전체 경로) 같은 종류의 정보면 겹침으로 센다.
   - 겹침으로 세지 않는 것은 아래 둘이다. 4번과 5번의 「겹치는 항목」 판정은 이 둘을 뺀 행만 본다.
     - 토큰 행. statusLine이 받는 입력 값(`context_window.total_input_tokens` 등)은 지금 문맥 기준이고 agent-meter는 누적이라 숫자의 뜻이 달라서, 둘 다 보여도 겹침으로 세지 않는다. 표에는 지금처럼 둘 다 보이고 「숫자의 뜻이 다르다」를 적는다. statusLine이 토큰을 보여 줄 때만 5번의 「겹치지 않는 항목」으로 센다.
     - 사용량 한도처럼 statusLine에만 있는 항목은 표 아래에 따로 적는다.
   - 표에는 그 statusLine이 어느 파일에서 왔는지(사용자 설정 폴더인지 프로젝트인지)를 함께 적는다.
4. 겹치는 항목이 없으면 그렇다고 알리고 9번으로 간다(2번의 패키지 실행기나 외부 프로그램 경우는 겹침을 가리지 못했으므로 여기서 끝내지 않는다).
5. 겹치는 항목이 있고 그 statusLine이 고칠 수 있는 것(사용자 설정 폴더의 `settings.json`에 있고, 부르는 스크립트가 저장소 밖에 있으며, 아래 8번에 해당하지 않음)이면, 겹치는 항목과 바뀔 조각(뺄 줄이나 블록의 원문)을 같은 메시지에 먼저 보이고 묻는다. 고칠 수 없는 것(프로젝트 쪽, 저장소 안 스크립트, 8번)은 겹치는 항목만 알리고 묻지 않는다. 고치려면 그 설정의 주인이 직접 해야 한다고 한 줄 덧붙인다.
   - a. (추천: 겹치는 정보는 agent-meter 표가 이미 보여 주므로 상태줄에는 겹치지 않는 항목만 남는다) 겹치는 항목만 statusLine에서 뺀다. 상태줄은 남고 겹친 항목만 사라진다. 스크립트나 설정이 바뀌므로 백업이 생긴다.
   - b. 그대로 둔다. 같은 정보가 두 곳에 보인다. 근거: 스크립트는 사람마다 손으로 만든 것이라 고치면 깨질 수 있고, 입력창 아래 힌트 줄이 없는 화면(예: IDE 확장)에서는 agent-meter가 안 보일 수 있다.
   - c. `statusLine` 키를 지운다(스크립트 파일은 남긴다). 상태줄이 통째로 사라지고 agent-meter 표만 남는다. 나중에 키를 다시 넣으면 스크립트가 그대로 돌아온다.
   - **statusLine이 보여 주는 항목 가운데 겹치지 않는 것(statusLine이 보여 주는 토큰과 statusLine에만 있는 항목 포함)이 하나도 없으면**: a는 빈 상태줄을 남겨 화면에 보이지 않으므로 보기에서 뺀다.
     - b와 c만 묻고, c 앞에 「(추천: 상태줄의 모든 정보를 agent-meter가 보여 준다)」를 단다. c는 5번에서 고칠 수 있는 것일 때만 묻는다.
     - 고른 값(`"b"` 또는 `"c"`)은 9번대로 `statusLineCleanup`에 남긴다.

   2번의 패키지 실행기나 외부 프로그램 경우는 겹치는 항목 대신 `command` 원문과 「agent-meter 표와 겹치는지는 미확인」을 같은 메시지에 보이고 b와 c만 묻는다(a는 스크립트를 고쳐 항목을 빼는 방식이라 보이지 않는다). 보기는 b. (추천: 무엇을 보여 주는지 확인하지 못해 지우면 잃는 항목을 알 수 없다) 그대로 둔다, c. `statusLine` 키를 지운다(그 도구가 보여 주던 항목이 모두 사라지고, 무엇이었는지는 미확인이다)이다. c는 5번에서 고칠 수 있는 것일 때만 묻고, 고칠 수 없는 것(프로젝트 쪽 등)이면 묻지 않고 알리기만 한다. 두 경우 모두 그 도구 자체의 설정으로 항목을 끄는 것은 사용자가 직접 해야 한다고 알린다.

   b의 근거 가운데 힌트 줄이 없는 화면에서 agent-meter가 어떻게 되는지는 `미확인`이다. `register.tsx`가 입력창 아래 힌트 줄 자리에 표를 그리는 것은 코드에서 봤지만, 그 줄이 없는 화면은 확인하지 못했다.
6. a나 c를 고르면 고치기 전에 고칠 파일을 백업하고 경로를 알린다. 이름은 예전 방식을 치울 때의 사본(`.bak-agent-meter-`)과 구분되게 `.bak-statusline-`로 붙인다.
   - a에서 statusLine이 스크립트 파일을 부르면 그 스크립트를 `<스크립트 경로>.bak-statusline-<날짜-시각>`으로 복사한다.
   - a에서 `command`가 한 줄 명령이라 스크립트 파일이 없으면 그 명령이 든 설정 파일(사용자 설정 폴더의 `settings.json`)을 `settings.json.bak-statusline-<날짜-시각>`으로 복사한다.
   - c는 `statusLine`이 든 사용자 설정 폴더의 `settings.json`을 `settings.json.bak-statusline-<날짜-시각>`으로 복사한다.
   - 같은 이름이 있으면 덮어쓰지 않고 `-1`, `-2`를 붙인다. 아래 명령의 `<파일 경로>`만 파일로 바꾼다.

   ```
   <kit-setup> --backup-file "<파일 경로>" statusline
   ```

7. 고친다. a는 그 스크립트(한 줄 명령이면 `settings.json`의 `command` 값)를 읽고 겹치는 항목만 뺀다. 줄 단위 수정법은 이 문서에 적지 않는다. 스크립트가 사람마다 달라서, 읽은 스크립트에 맞게 고친다. 고친 뒤 스크립트(한 줄 명령이면 그 명령)가 읽는 키만 채운 샘플 JSON을 입력으로 넣어 돌려, 종료 코드 0과 출력이 나오고 뺀 항목만 사라졌는지 본다. 한 줄 명령을 고쳤으면 `settings.json`도 「6. 확인」 1번의 JSON 확인 명령으로 읽어 본다. 오류가 나면 백업으로 되돌리고 알린다. c는 아래 명령으로 `settings.json`에서 `statusLine` 키만 지운다(다른 키는 그대로이고, 파일 전체가 다시 써져 들여쓰기가 바뀔 수 있다. 지우기 전에 6번이 백업했다). `CLAUDE_CONFIG_DIR`을 쓰는 컴퓨터는 `$HOME/.claude`를 「`CLAUDE_CONFIG_DIR`을 쓰는 컴퓨터」대로 그 폴더로 바꿔 넣는다. 지운 뒤에는 「6. 확인」 1번의 JSON 확인 명령으로 읽어 보고, `node -p "'statusLine' in JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$HOME/.claude/settings.json"`가 `false`를 찍는지 본다.

   ```
   <kit-setup> --config-unset "$HOME/.claude/settings.json" statusLine
   ```
8. 플러그인이나 조직 관리 설정에서 온 statusLine은 고치지 않고 겹치는 항목만 알린다. 스크립트가 `~/.claude/plugins/` 아래에 있거나 사용자가 조직이 관리하는 설정이라고 하면 이에 해당한다. 이 정리가 읽는 설정은 위 세 파일뿐이라 조직 관리 설정에 든 statusLine은 보이지 않는다(미확인).
9. 정리를 마치면 결과를 `config.json`의 `statusLineCleanup`에 남겨 업데이트가 다시 하지 않게 한다. 값은 고른 선택지(`"a"`, `"b"`, `"c"`)이거나, 고칠 수 있는 statusLine이 있었는데 겹침이 없었던 경우의 `"해당 없음"`이다. 5번에서 고칠 수 있는 statusLine이 없으면(1번에서 셋 다 없었거나, 프로젝트 쪽, 플러그인, 조직 관리 statusLine만 있어 알리기만 했으면) 남기지 않는다. 2번에서 스크립트를 읽지 못해 항목을 `미확인`으로 두고 건너뛴 경우, 설치가 멈춘 경우, 사용자가 답을 미룬 경우, 7번에서 오류로 백업을 되돌린 경우도 남기지 않는다. 남기지 않은 경우는 다음 업데이트가 이 정리를 다시 점검하고, 그 사이 사용자가 사용자 설정 폴더에 `statusLine`을 더했다면 그때 정리를 묻는다. 패키지 실행기(`npx` 등)나 외부 프로그램으로 외부 도구를 부르는 경우는 고칠 수 있는 쪽이면 b나 c를 골랐을 때 그 값을 남긴다(항목을 뽑지 못했는데 `"해당 없음"`을 남기지 않는다). 아래 명령의 마지막 두 인자(키와 값)만 바꾼다.

   ```
   <kit-setup> --config-set "$HOME/.claude/subagent-system/config.json" statusLineCleanup '"a"'
   ```

## 6. 확인

이 단계의 명령은 Git Bash(Windows) 또는 터미널(macOS, 리눅스)에서 실행한다. 1번부터 7번까지는 재시작 없이 할 수 있으니 먼저 하고, 8번에서 `VERSION`을 놓은 뒤 9번에서 재시작한다. 1번부터 7번까지 사용자의 확인이 남아 있으면 그 확인을 마치기 전에는 8번도 9번도 하지 않는다. 정의와 훅과 스킬이 읽혀야 되는 확인은 10번부터 12번까지라, 이어 연 세션이 한다.

1. 설정 파일이 깨지지 않았는지 본다. `~/.claude/subagent-system/rates.json`도 같은 명령으로 본다. 고친 `settings.json`마다 `<kit-setup> --check-json <파일>`이 오류 없이 끝나야 한다(파일 여러 개를 한 번에 줄 수 있고, 읽히면 아무것도 찍지 않는다).
2. 키트의 예시가 남지 않았는지 본다. `grep -n '키트 원본의 예시' ~/.claude/subagent-system/docs/SUBAGENT_GUIDE.md` 결과가 비어야 한다. 이 문구는 키트 GUIDE의 사용자 표와 「무조건 Opus」 목록 표시 바로 아래 안내 주석에만 있어서, 3단계(업데이트는 「업데이트 순서」 4번)에서 표시 사이를 바꾸면 함께 없어진다. 남아 있으면 키트의 백엔드 예시 표가 그대로 놓인 것이니 멈추고 그 단계로 돌아가 표와 목록을 바꾼 뒤 다시 놓는다. 표가 그대로면 정의 description도 키트 것 그대로라 `--check`로는 잡히지 않는다. 아래에 쓰는 `<정의 파일들>`은 `~/.claude/agents/`(`CLAUDE_CONFIG_DIR`을 쓰는 컴퓨터는 그 폴더의 `agents/`)에 있는 키트 정의 10개 파일(`haiku-low.md`, `haiku-medium.md`, `haiku-high.md`, `sonnet-low.md`, `sonnet-medium.md`, `sonnet-high.md`, `opus-low.md`, `opus-medium.md`, `opus-high.md`, `opus-xhigh.md`)이고, `config.json`의 `removedDefs`에 든 이름은 뺀다. 사용자가 따로 만든 정의가 같은 폴더에 있을 수 있어 폴더째 넘기지 않는다. `CLAUDE_CONFIG_DIR`을 쓰는 컴퓨터는 치환이 됐는지도 본다. `grep -rn -e '~/\.claude' -e '\$HOME/\.claude' <정의 파일들> <그 폴더>/subagent-system/docs <그 폴더>/skills/<이름>` 결과가 비어야 하고, `grep -n -e '~/\.claude' -e '\$HOME/\.claude' <그 폴더>/settings.json <그 폴더>/CLAUDE.md`에는 이 키트의 줄(`subagent-system`이 든 줄)이 없어야 한다.
3. 시험을 돌린다. `node --test ~/.claude/subagent-system/scripts/tests/subagentRetroHelpers.test.js ~/.claude/subagent-system/scripts/tests/subagentCli.test.js ~/.claude/subagent-system/scripts/tests/agentCostTime.test.js ~/.claude/subagent-system/scripts/tests/kitSetup.test.js ~/.claude/subagent-system/scripts/tests/transcriptTiming.test.js ~/.claude/subagent-system/scripts/tests/speedReview.test.js`가 모두 통과해야 한다. 디렉터리를 넘기면(`node --test <폴더>/tests/`) Node 24에서 `Cannot find module`로 실패하고, 글롭(`*.test.js`)은 Node 18부터 20까지는 직접 받지 못하니 파일 이름을 하나씩 넘긴다. 실제 기록을 건드리지 않게 `SUBAGENT_RECORDS_DIR=<임시 폴더>`를 앞에 붙여도 된다.
4. 스크립트가 뜨는지 본다. `node "$HOME/.claude/subagent-system/scripts/subagent-retro.js" --where`는 `~/.claude/subagent-system/records`의 절대 경로를 찍어야 한다. 서로 다른 두 폴더에서 실행해도 같은 값이다. `--count`는 기록이 없으면 「사용 기록이 없습니다」 문구와 위 경로를 찍고 종료 코드 0으로 정상 종료하고, 있으면 숫자다. `--due`는 기록이 없으면 첫 줄에 `wait <N>`을 찍고, 마지막 줄 괄호 안에 `첫 회고 기준 <N>건`이 있다(N은 `RETRO.md`의 「정정과 후보 판정」의 첫 회고 기준이다. `ask`가 나오는 줄 구성과 회고를 거듭한 뒤의 단계도 그 절에 있다). `agent-time-breakdown.js --top 0`, 인자 없는 `main-session-cost.js`, 인자 없는 `speed-review.js`는 사용법을 오류 출력에 찍고 종료 코드 1로 끝나야 한다. 셋 다 같은 폴더의 모듈을 불러오므로 모듈 경로가 맞는지 보는 확인이다. `agent-time-breakdown.js`는 인자 없이 돌리면 마지막 회고 뒤 기록을 분석하므로 `--top 0`을 준다. `--retro-mode`는 Q5에서 고른 값(`ask` 또는 `auto`)을 찍어야 하고, `--status`는 첫 줄에 같은 회고 방식을 찍어야 한다. `node -p "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).roles" "$HOME/.claude/subagent-system/config.json"`는 Q1에서 고른 직군을 찍어야 한다(직군을 하나도 고르지 않았으면 `[]`). `~/.claude/skills/<이름>/SKILL.md`가 있고 `grep -n '^name: <이름>$' ~/.claude/skills/<이름>/SKILL.md`가 한 줄 나와야 한다(`<이름>`은 `config.json`의 `commandName`, 없으면 `retro`). 이 확인은 `--claim`을 돌리지 않는다. 기록 폴더에 잠금 파일을 남기기 때문이다. 훅은 `~/.claude/settings.json`의 `hooks`에 `SubagentStop`(명령에 `subagent-usage.js`)이 있어야 한다.
5. `node "$HOME/.claude/subagent-system/scripts/subagent-retro.js" --kinds`가 표 문제 없이 돈다. 「표를 읽지 못했습니다」 없이 「기록 전체에서 표에 없는 일 이름」 목록이 나와야 한다. 기록이 없으면 목록 대신 「표는 읽었습니다. 사용 기록이 없습니다」가 찍히고 종료 코드 0으로 끝난다. 표에 문제가 있으면 기록이 없어도 까닭이 찍힌다. 표 형식 자체는 3번 시험도 실제 `SUBAGENT_GUIDE.md`를 읽어 확인한다. `node "$HOME/.claude/subagent-system/scripts/subagent-retro.js" --repeats`도 종료 코드 0으로 끝나야 한다. 사용 기록이 없으면 「사용 기록이 없어 범위를 정하지 못했습니다」, 대화 기록 폴더가 없으면 「대화 기록 폴더가 없습니다」가 찍히고, 기록이 있으면 종류별 목록(후보가 없으면 「후보 없음」)이 찍힌다. 어느 쪽이든 파일은 쓰지 않는다.
6. 정의 description의 일 이름이 표 칸과 같고 표에 칸이 있는 정의 파일이 모두 있다. `node "$HOME/.claude/subagent-system/scripts/subagent-retro.js" --check`를 돌린다. 이 명령은 `opus-xhigh`를 뺀 정의마다 description에 나열한 일 이름(괄호 밖)이 표에서 그 정의 칸의 일 이름과 빠지거나 더해진 것 없이 같은지도 본다. 출력은 네 항목이다. 통과 기준은 항목마다 다르다.
   - 「정의 description과 표 칸이 다른 곳」, 「표에 칸이 있는데 정의 파일이 없는 칸」, 「removedDefs에 든 정의인데 표의 칸에 일이 있는 칸」은 셋 다 `없음`이어야 한다. 처음 설치는 사용 기록이 없으니 「문제 없음」과 종료 코드 0까지 같이 나와야 한다.
   - 「표 칸과 다른 정의로 보낸 기록」은 통과 기준이 아니다. 기록이 쌓인 컴퓨터에서는 표를 고치기 전에 쌓인 기록 때문에 찍히고, 그 건수 때문에 종료 코드가 1이 된다. 건수와 마지막 날짜를 사용자에게 보여 주고 고치지 않는다. 표와 기록의 어긋남은 회고가 다룬다.
   - Q4에서 글쓰기 줄(c)을 골랐으면 `grep -c '글은 필요한 말만 쓴다' <정의 파일들>`(2번과 같이 키트 정의 파일 이름만 넘긴다. `~/.claude/agents/*.md`로 넘기면 사용자가 만든 정의까지 센다)가 정의 10개(`removedDefs`에 든 것은 뺌) 모두 1이어야 하고, `grep -n '줄표(—)로 부연을 덧붙이지 않고' ~/.claude/CLAUDE.md`가 `claude-setup-kit extras 시작`과 `끝` 사이에서 한 줄 나와야 한다(같은 뜻의 줄이 표시 밖에 이미 있어 더하지 않았다면 그 줄이 있는 자리를 본다). 안 골랐으면 정의는 모두 0이고 extras 구역 안에 그 줄이 없어야 한다.
7. CLAUDE.md의 표시 주석이 짝을 이뤘다. `grep -n -e '<!-- subagent-system 시작 -->' -e '<!-- subagent-system 끝 -->' ~/.claude/CLAUDE.md`가 시작 한 줄, 끝 한 줄을 그 순서로 찍어야 한다. extras(a, c, e 가운데 하나라도)를 넣었으면 `claude-setup-kit extras 시작`과 `끝`도 같은 방식으로 본다. 다만 extras 구역을 만들지 않았으면(a를 넣지 않았고 c의 메인용 줄과 e의 절도 넣지 않았거나 같은 뜻의 줄이 표시 밖에 있어 더하지 않은 경우) 짝이 없는 것이 정상이다. e를 넣었으면 `grep -n '목표와 방법' ~/.claude/CLAUDE.md`가 extras 구역 안에서 소제목 한 줄을 찍어야 한다(같은 뜻의 줄이 표시 밖에 있어 넣지 않았으면 그 자리를 본다). 4단계 규칙 줄은 시작과 끝 사이에만 있어야 한다. 4단계와 5단계에서 표시 밖 줄을 고쳤거나 그대로 둔 줄과 「구역:」 줄(누가 더했든)은 빼고 본다.
   - agent-meter(`q4AgentMeter`가 `true`이거나 업데이트에서 다시 깔거나 새로 깐 경우): 설치 확인(`claude plugin list`와 그 갈래)은 5-2단계 3번에서 이미 했다. 업데이트는 「업데이트 순서」 7번이 그 단계를 쓴다. 그 결과를 쓰고 여기서 다시 돌리지 않는다.
   - keep-alive는 Q4의 후속 질문에 답했으면 끔을 골랐을 때만 5-2단계 3번의 `pluginConfigs` 확인이 `keep_alive`가 거짓인 객체를 찍어야 하고, 이미 깔려 있어 묻지 않았거나(`agentMeterKeepaliveAsked`가 이미 `true`) 업데이트에서 갱신만 했으면 전 값 그대로여야 하고, 이미 깔려 있어 대신 물었으면 고른 값이어야 한다(옛 방식에서 옮겼으면 옛 `AGENT_METER_KEEPALIVE` 값이 `keep_alive`로 옮겨진 것이다). 둘 다 아니거나 5-2단계 3번이 오류 갈래였으면 이 확인은 건너뛴다.
8. 1부터 7까지가 통과하고(5-2단계 3번이 `✔ enabled`가 아닌 채 진행했거나 오류 갈래였던 경우도 통과로 본다) 사용자 확인이 남아 있지 않으면 먼저 `node "$HOME/.claude/subagent-system/scripts/subagent-retro.js" --record-kit-hashes`를 돌려 방금 놓은 키트 파일의 해시를 `config.json`의 `kitFileHashes`에 남기고(`CLAUDE_CONFIG_DIR`을 쓰는 컴퓨터는 `$HOME/.claude`를 그 폴더로 바꿔 넣는다. 출력은 `kitFileHashes에 파일 N개의 해시를 적었습니다`), 이어 키트의 `VERSION`을 `~/.claude/subagent-system/VERSION`으로 복사한다. `VERSION`이 놓이면 설치가 끝난 것으로 읽히므로 해시를 먼저 남긴다. `cat ~/.claude/subagent-system/VERSION`이 키트의 `VERSION`과 같은 값을 찍어야 한다. 이 파일은 1단계가 설치본의 버전을 가리는 근거이니 확인이 통과하기 전에는 놓지 않고, 남은 확인을 마친 뒤에 놓는다. 10번부터 12번은 재시작이 있어야 되는 확인이라 이 복사 뒤에 한다. 업데이트에서는 「업데이트 순서」 9번이 이 두 가지를 한다.
9. 재시작은 처음 설치 뒤에 늘 청한다. 새로 놓은 정의와 스킬을 확실히 읽히려는 것이다. 이미 있던 `agents` 폴더의 정의 수정은 몇 초 안에 읽혀 재시작이 필요 없고(https://code.claude.com/docs/en/sub-agents), 훅 설정 수정도 보통 바로 읽힌다(https://code.claude.com/docs/en/hooks). 재시작은 8번에서 `VERSION`을 놓은 뒤에만 청한다. 확인이 남은 채로 재시작을 청하면 이어 연 세션이 중간 상태를 모르고 시작한다. 사용자에게 Claude Code를 닫고, 같은 폴더에서 `claude --continue`로 이 대화를 이어 열어 달라고 한다(열린 뒤 `/resume`으로 이 대화를 골라도 된다). `q4AgentMeter`가 `true`이면 agent-meter도 같은 재시작으로 읽히므로 따로 청하지 않는다. 메인 설정(「7. 보고」의 첫 칸)이 권장값이 아니면 이 재시작 안내에 그 칸의 지금 값, 권장값, 명령 셋(그 칸의 「명령 셋 규칙」대로)을 필수가 아닌 추천으로 함께 알린다. 설정은 하지 않는다. 판정 방법은 그 칸에 있고, effort는 사용자에게 묻지 않고, 그 칸대로 환경변수 값이 아닐 때만 읽은 값 뒤에 「세션 중 `/effort`로 바꿨다면 그 값이 우선한다」 한 줄을 붙인다. 명령 셋에 `/model`이 들어 있고 그 칸의 「모델 명령 안내」 조건이 맞으면 그 한 줄도 붙인다. 그 칸이 판정하지 않은 경우(모델 ID가 `claude-`로 시작하지 않거나 `@`가 든 경우)에는 그 칸의 한 줄(조건이 맞으면 「모델 명령 안내」 한 줄 포함)만 붙인다. 이어 연 뒤 「이어서 진행해줘」라고 하면 된다고 알린다. 이어 연 세션은 10번부터 한다. 새 대화로 열어 같은 요청을 하면 1단계가 「이미 이 버전」으로 읽고 남은 확인(10번부터 12번)을 이어 할지 묻는다. `claude --continue`가 대화 맥락이 이어져 더 매끄럽다.
10. `haiku-low`로 짧은 일 하나를 보낸다(예: 「`ls` 결과를 세 줄로 정리」). 끝나면 `~/.claude/subagent-system/records/subagent-cost.tsv`에 그 에이전트 줄이 생겼고 프로젝트 열(날짜 다음 칸)이 채워졌는지 본다. 안 생겼으면 훅 명령을 터미널에서 직접 돌려 오류를 본다. 0단계에서 `disableAllHooks`나 관리 설정의 `allowManagedHooksOnly`가 `true`로 읽혔다면 훅이 멈춘 것이 원인일 수 있다. 0단계에서 읽지 못한 서버나 MDM의 관리 설정도 같은 원인이 될 수 있다.
11. 그 에이전트를 사용 기록에 적는다(SUBAGENT_GUIDE의 `--log` 명령. `--project`에는 세션을 시작한 폴더의 절대 경로를, `--kind`에는 설치된 표의 Haiku low 칸 첫 일 이름을 준다). 그 뒤 `node "$HOME/.claude/subagent-system/scripts/subagent-retro.js"`가 표 한 줄을 찍는지 본다.
12. 사용자에게 `/<이름>`(기본 `/retro`)을 입력해 상태가 뜨는지 봐 달라고 한다. 첫 줄이 「회고 방식: …」이면 된다. 「Shell command permission check failed」가 나오면 스킬 frontmatter의 `allowed-tools`가 명령과 맞지 않아 미리 실행이 막힌 것이다(공식 문서: 미리 실행하는 명령은 권한 규칙을 확인하고 허용이 아니면 호출을 중단한다). 명령과 `allowed-tools`가 모두 `$HOME` 표기라, 이 표기가 규칙과 맞지 않는 것일 수 있다. 그렇다면 같은 `$HOME` 규칙을 `permissions.allow`에 더해도 맞지 않으므로, 홈 경로를 풀어 쓴 절대 경로로 규칙을 쓴다. 먼저 사용자에게 묻는다. 절대 경로는 `node -p "require('os').homedir()"`가 찍는 값에 `/.claude`를 붙인 것이다(`CLAUDE_CONFIG_DIR`이 있으면 그 폴더, Windows는 역슬래시를 슬래시로 바꿔 쓴다). 승인하면 같은 문자열로 두 곳을 바꾼다. 하나는 `~/.claude/settings.json`의 `permissions.allow`에 `Bash(node "<절대 경로>/subagent-system/scripts/subagent-retro.js" *)`를 더하는 것이다. 다른 하나는 설치된 스킬 `SKILL.md`의 frontmatter `allowed-tools`와 본문 명령의 `$HOME/.claude`를 같은 절대 경로로 바꾸는 것이다. 규칙은 실행하는 명령 문자열과 같은 꼴이어야 맞기 때문이다. 바꾼 뒤 `--record-kit-hashes`를 다시 돌려(`SKILL.md`가 바뀌었으므로, 안 돌리면 다음 업데이트가 이 스킬을 손으로 고친 파일로 본다) 다시 입력해 보게 한다. 이 대비책과 `$HOME` 표기가 맞지 않는지는 키트가 실제 Claude Code에서 확인하지 못했다(미확인). 더한 allow 규칙은 「제거」에서 뺀다.
   - `q4AgentMeter`가 `true`이면 같은 때 사용자에게 입력창 아래에 `total … | branch … | path …` 줄과 그 아래 표가 보이는지 봐 달라고 한다. 안 보이면 조직 설정으로 mod가 막혔거나(`allowManagedModsOnly`나 관리 설정의 `allowManagedHooksOnly`) 0단계에서 읽은 `disableAllHooks`가 `true`여서 mod가 멈췄을 수 있다고 알리고(플러그인이 `claude plugin list`에서 `✔ enabled`인지는 5-2단계 3번으로 이미 확인했다), 표가 안 보여도 서브에이전트 체계는 돈다고 알린다. `/meter`로 꺼져 있을 수도 있어 먼저 `/meter`를 한 번 입력해 보라고 한다. `/meter`는 켜고 끄는 토글이라 응답이 「사용량 표를 숨겼습니다.」이면 방금 껐다는 뜻이니 한 번 더 입력하게 하고, 「사용량 표를 켰습니다.」이면 표가 보여야 한다(`agent-meter/hooks/register.tsx`의 응답 문구).

## 7. 보고

6단계 12번까지 끝난 뒤 사용자에게 보고한다. 형식은 「Q. 사용자에게 물을 것」의 「보고 형식」을 따르고, 이 문서는 무엇이 「결정할 것」과 「알아 둘 것」에 들어가는지만 정한다. 메인 설정은 따로 칸을 두지 않고 두 구역에 나눠 넣고, 쓰는 법은 처음 설치 보고 끝에만 덧붙인다. 재시작했으면 이어 연 세션이 한다.

이어 한 설치(끊긴 설치를 이어 하거나 새 대화에서 보고만 이어 한 경우)에서 대화에 없는 항목은 파일로 확인되는 것(백업 폴더, `settings.json.bak-agent-meter-*`, `statusLineCleanup` 등)만 적고 나머지는 `미확인`으로 「알아 둘 것」에 적는다.
- **메인 설정**(필수가 아니고 추천. 권장값이 아닌 것은 「결정할 것」에, 판정하지 않은 것과 상한 안내는 「알아 둘 것」에 넣고, 권장값이면 쓰지 않는다): 메인 세션의 모델, effort, autocompact(문맥이 차면 대화를 요약해 줄이는 기능)가 권장값인지 본다. Claude는 이 값을 설정하지 않고 알리기만 하며, 명령은 사용자가 입력한다.
  - 권장값은 Opus 5.5(`claude-opus-5-5`), effort high, autocompact 400k에서 600k(문맥 창 100만 토큰의 40~60%)다. 메인은 맡기고 확인하는 역할이라 판단이 틀리면 알아챌 신호가 없어 Opus high를 권한다. autocompact는 요청마다 대화 전체를 캐시에서 다시 읽고 캐시가 만료되면 대화 전체를 다시 쓰므로, 문맥이 길수록 요청당 비용과 만료 때 비용이 커진다. 1M 문맥을 쓰고 정하지 않으면 약 967K에서 압축된다. 환경변수 `CLAUDE_CODE_AUTO_COMPACT_WINDOW`는 안내하지 않는다(토큰 수 정수만 받고 `/autocompact`와 설정값보다 먼저 적용돼 `/autocompact`로 바꿀 수 없다).
  - 지금 값은 이렇게 읽는다(근거 https://code.claude.com/docs/en/model-config , https://code.claude.com/docs/en/settings-reference).
    - 모델: 지금 세션의 모델 ID 끝에서 `[1m]` 같은 대괄호 꼬리와 `-YYYYMMDD`를 뗀 이름이 `claude-opus-5-5`인지 본다(회고 스크립트가 모델 이름을 묶는 규칙과 같다. Claude가 아는 자기 모델 ID. 모르면 사용자에게 `/model` 화면을 보여 달라고 한다). `settings.json`의 `model` 키가 없어도 계정 기본값이 Opus 5.5일 수 있어 그 키만 보고 판정하지 않는다. 다만 모델 ID가 `claude-`로 시작하지 않거나 `@`가 들어 있으면(공급자 접두사나 버전 꼬리가 붙은 꼴. 예: `us.anthropic.claude-opus-5-5-…`, `claude-opus-5-5@…`) 모델, effort, autocompact 모두 판정하지 않고 권장값(Opus 5.5 high, autocompact 400k에서 600k)과 「`/model` 화면에서 Opus 5.5를 고른 뒤 `/effort high`, `/autocompact 400k`」를 한 줄로 알린다(빼는 명령은 아래 「명령 셋 규칙」을 따른다). 이 한 줄에도 `/model` 화면 안내가 들어 있으니 아래 「모델 명령 안내」 조건이 맞으면 같은 한 줄을 붙인다. 6단계 9번의 재시작 안내도 같은 줄을 쓴다.
    - 읽는 규칙의 순서: 항목마다 환경변수 규칙(아래 effort와 autocompact 항목의 환경변수, 1M 문맥 끔), 프로젝트 설정 규칙(아래 「프로젝트 설정 규칙」 항목), 사용자 설정 순으로 보고, 앞 규칙이 정한 항목은 뒤 규칙을 쓰지 않는다. effort는 상한이 high보다 낮아 판정하지 않는지를 아래 effort 상한 규칙으로 이 앞에 먼저 보고, 상한으로 값을 깎는 것은 아래 effort 항목으로 값을 읽은 뒤에 한다(상한은 환경변수 값에도 걸린다). 환경변수를 찾을 곳, 그 사이의 순서, 읽은 곳을 적는 법은 0단계의 「환경변수를 찾는 곳과 순서」를 따른다.
    - effort: `CLAUDE_CODE_EFFORT_LEVEL`이 있으면(0단계의 「환경변수를 찾는 곳과 순서」) 그 값(값이 `auto`이면 모델 기본값을 쓰는 것이라 Opus 5.5의 기본값(medium)을 지금 값으로 보고 읽은 값 `auto`를 함께 보인다. 근거 https://code.claude.com/docs/en/env-vars 의 `CLAUDE_CODE_EFFORT_LEVEL` 행)이 지금 값이다. 환경변수가 없고 아래 프로젝트 설정 규칙에도 걸리지 않으면 사용자 설정의 `modelSettings.claude-opus-5-5.effortLevel`, 그것도 없으면 medium이다(Opus 5.5의 기본값). 이 키는 지금 모델과 상관없이 늘 읽는다. effort와 autocompact는 모델마다 저장되어 `/model claude-opus-5-5` 뒤에는 이 키의 값이 쓰이기 때문이다. 지금 값을 보일 때 `modelSettings.claude-opus-5-5`에서 읽은 값만 「Opus 5.5에 정해 둔 값」이라고 적고, 환경변수에서 읽은 값과 autocompact의 최상위 키에서 읽은 값은 읽은 곳을 적고, 어디에도 없어 기본값이 되면(effort는 medium, autocompact는 「없음」) 「기본값」이라고 적는다(autocompact도 같다). 이 환경변수는 `/effort`와 `--effort`와 설정값보다 먼저 적용된다(https://code.claude.com/docs/en/env-vars). 사용자 설정 파일(`~/.claude/settings.json`)의 최상위 `effortLevel`은 Opus 5.5에 적용되지 않으므로 보지 않는다. 세션 중 `/effort`나 `--effort`로 바꾼 값은 설정 파일로 알 수 없으므로 묻지 않는다. 환경변수 값이 아니면 읽은 값 뒤에 「세션 중 `/effort`로 바꿨다면 그 값이 우선한다」를 한 줄 붙여 보인다. 상한이 있으면 이 값은 아래 effort 상한 규칙으로 실제로 도는 값을 가린다.
    - autocompact: `CLAUDE_CODE_DISABLE_1M_CONTEXT`가 켜져 있으면(0단계의 「환경변수를 찾는 곳과 순서」. 값이 `1`, `true`, `yes`, `on`이면 켜진 것이고 대소문자는 가리지 않는다) 판정하지 않고, 자리에 「1M 문맥을 꺼 두어 200K 창에서 압축된다(권장값은 1M 창 기준)」만 보인다. 1M 문맥을 끄면 Claude Code가 압축 창을 모델의 문맥 창으로 묶어 400k로 정해도 효과가 없기 때문이다(근거 https://code.claude.com/docs/en/model-config 의 「Turn off 1M context」, https://code.claude.com/docs/en/env-vars ). 켜져 있지 않으면 아래대로 읽는다. `CLAUDE_CODE_AUTO_COMPACT_WINDOW`가 있으면(같은 곳을 찾는다) 그 값이 지금 값이다(바꾸는 법은 안내하지 않는다). 다만 권장값인지는 실제로 쓰이는 값으로 가리고 적힌 값과 다르면 둘을 함께 보인다(이 변수는 정수만 받아 `500k`는 앞의 숫자 `500`으로 읽히고, 값은 100000 이상 1000000 이하로 맞춰져 `500k`는 100000이 되며, Opus 5.5의 문맥 창(1M 문맥을 끄지 않은 이 경우에는 1M)도 넘지 못한다. 근거 https://code.claude.com/docs/en/env-vars ). 환경변수가 없고 아래 프로젝트 설정 규칙에도 걸리지 않으면 사용자 설정의 `modelSettings.claude-opus-5-5.autoCompactWindow`(effort와 같은 까닭으로 늘 이 키를 읽는다), 없으면 사용자 설정의 최상위 `autoCompactWindow`가 지금 값이다. 「Opus 5.5에 정해 둔 값」과 읽은 곳을 적는 법은 effort 항목과 같다. 값이 `"auto"`이거나 둘 다 없으면 「없음」이다. 400000 이상 600000 이하이면 권장 범위다.
    - 프로젝트 설정 규칙: 환경변수로 정한 항목과 1M 문맥을 꺼 판정하지 않는 autocompact에는 이 규칙을 쓰지 않는다(위 규칙이 먼저다). 그 밖의 항목은 프로젝트 `.claude/settings.json`과 `.claude/settings.local.json`(맨 위 규칙대로 읽고, 사용자 설정 폴더와 같은 폴더가 되면 `settings.json`은 사용자 설정이라 이 규칙에서 빼고 `settings.local.json`만 본다) 가운데 하나에 effort나 autocompact를 정하는 키가 있으면 판정하지 않는다. 키는 `modelSettings.claude-opus-5-5`의 `effortLevel`이나 `autoCompactWindow`, 최상위 `effortLevel`이나 `autoCompactWindow`다. 프로젝트 설정이 사용자 설정보다 먼저 적용되어(https://code.claude.com/docs/en/settings 의 「Settings precedence」) 명령으로 저장한 값이 가려지므로, 명령을 권해도 바뀌지 않을 수 있기 때문이다. 그 파일, 키, 값을 보이고 「이 폴더에서는 프로젝트 설정이 쓰인다」고만 적는다. 이 판정에는 조직 관리 설정을 넣지 않으므로 `미확인`이다(0단계와 같다).
    - effort 상한 규칙: 0단계 「환경변수를 찾는 곳과 순서」가 보는 설정 파일들에서 `maxEffortLevel`을 읽는다. 파일마다 `modelSettings.claude-opus-5-5.maxEffortLevel`이 있으면 그 값이, 없으면 최상위 `maxEffortLevel`이 그 파일의 값이고, 값이 여럿이면 가장 낮은 값이 쓰인다. 순서는 low, medium, high, xhigh, max이고 `max`는 상한이 없는 값이다. `/effort`, `CLAUDE_CODE_EFFORT_LEVEL`, 정의의 effort가 모두 상한까지만 올라간다(근거 https://code.claude.com/docs/en/settings-reference 의 `maxEffortLevel`). 그래서 상한이 있고 위 effort 항목으로 읽은 지금 값(환경변수든 설정이든)이 상한보다 높으면 상한을 지금 값으로 보고, 읽은 값과 상한을 함께 보인다(예: 「`xhigh`로 저장돼 있지만 상한이 `high`라서 high로 돈다」). `auto`는 위 effort 항목대로 medium으로 본 뒤 견준다. 상한이 high보다 낮으면(`low`, `medium`) effort를 판정하지 않고 `/effort high`도 넣지 않는다. 명령을 권해도 상한까지만 올라 바뀌지 않기 때문이다. 이때는 그 파일, 키, 값을 보이고 「effort는 이 상한 이하로만 돈다」고만 적는다. 이 판정에는 조직 관리 설정과 `--settings` 파일을 넣지 않으므로 `미확인`이다(0단계와 같다). 상한이 없으면 이 규칙은 걸리지 않는다.
  - 판정하지 않은 경우(위 모델 항목)는 그 한 줄(조건이 맞으면 아래 「모델 명령 안내」 한 줄 포함)만 「알아 둘 것」에 쓴다. 판정했고 권장값이 아닌 것이 하나라도 있으면 지금 값, 권장값, 명령 셋을 「결정할 것」에 번호를 붙여 보이고(명령을 입력할지, 그대로 둘지) 「필수는 아니고 추천」이라고 적는다. 권장값인지 가릴 때 판정하지 않은 항목(1M 문맥을 끈 autocompact, 프로젝트 설정이 정한 항목, 상한이 high보다 낮아 판정하지 않는 effort)은 뺀다.
  - 명령 셋 규칙: 명령 셋에는 `/model claude-opus-5-5`, `/effort high`, `/autocompact 400k` 가운데 권장값이 아닌 항목의 명령만 이 순서로 넣는다. 환경변수로 정한 항목(`CLAUDE_CODE_EFFORT_LEVEL`이 있는 effort와 `CLAUDE_CODE_AUTO_COMPACT_WINDOW`가 있는 autocompact. 0단계 「환경변수를 찾는 곳과 순서」의 어느 곳에 있든 그 변수가 명령보다 먼저 적용된다), 1M 문맥을 꺼 판정하지 않는 autocompact, 프로젝트 설정이 정해 판정하지 않는 항목의 명령, `maxEffortLevel`이 high보다 낮아 판정하지 않는 effort의 `/effort high`는 넣지 않는다. `/effort`나 `/autocompact`가 들어가면 `/model claude-opus-5-5`를 앞에 두고, 두 명령은 모델마다 저장되므로 `/model`을 먼저 친다고 함께 적는다. 남는 명령이 없으면 지금 값과 권장값만 보인다. 판정하지 않은 공급자의 한 줄은 모델 항목에 적힌 꼴을 쓰고, 위에서 명령을 넣지 않는다고 한 경우의 명령만 뺀다. autocompact 명령을 뺐으면 권장값 괄호에서도 autocompact를 빼고, 프로젝트 설정이 정했거나 상한이 high보다 낮아 판정하지 않는 effort도 괄호에서 뺀다. 두 명령이 모두 빠지면 「`/model` 화면에서 Opus 5.5를 고른다」로 쓴다.
  - 모델 명령 안내: 명령 셋에 `/model claude-opus-5-5`가 들어 있거나(지금 모델이 이미 Opus 5.5이고 `/effort`나 `/autocompact`도 없어 `/model`이 빠지면 들어 있지 않은 것이다) 모델 항목의 공급자 한 줄(`/model` 화면에서 Opus 5.5를 고르는 안내)을 쓰고, 프로젝트 `.claude/settings.json`이나 `.claude/settings.local.json`(맨 위 규칙대로 읽고, 사용자 설정 폴더와 같은 폴더가 되면 `settings.json`은 사용자 설정이라 이 조건에서 빼고 `settings.local.json`만 본다)에 최상위 `model` 키가 있거나 `ANTHROPIC_MODEL`이 0단계의 「환경변수를 찾는 곳과 순서」가 찾는 곳 어디에든 있으면, 그 파일(환경변수는 읽은 곳), 키, 값과 함께 「`/model`은 이 세션에만 쓰이고 다음 실행에서는 이 값으로 돌아간다」를 한 줄 덧붙인다. 판정과 명령 셋은 바꾸지 않는다. 프로젝트 설정의 `model`과 `ANTHROPIC_MODEL`은 `/model`로 저장한 값보다 먼저 적용되기 때문이다(근거 https://code.claude.com/docs/en/model-config 의 「A new session starts on a different model than you picked」와 `ANTHROPIC_MODEL` 설명). 이 안내에는 조직 관리 설정과 조직 기본 모델을 넣지 않으므로 따로 적지 않는다.
  - 판정한 항목이 모두 권장값이면 메인 설정은 보고에 쓰지 않는다(정상인 것의 목록이라서다). 다만 상한으로 깎여 권장값이 된 effort가 있으면 읽은 값과 상한을 「알아 둘 것」에 쓰고, 판정하지 않은 항목이 있으면 그 항목의 안내(1M 문맥을 껐다는 말이나 프로젝트 설정 또는 effort 상한의 파일, 키, 값)를 「알아 둘 것」에 쓴다.
- **결정할 것**: 요율표에 없는 모델이 있으면 그 사실과 요율을 알려 달라는 말(없으면 `?`로 보인다). 메인 설정이 권장값이 아니면 위 명령 셋. 해당하는 것이 없으면 이 구역을 쓰지 않는다.
- **알아 둘 것**: 아래만 쓴다. 놓은 파일 목록, 합친 설정 내용, 넣은 규칙 줄과 표시 주석 위치, 만든 표와 「무조건 Opus」 목록, 시험 통과 수는 쓰지 않고 사용자가 물으면 답한다.
  - 사용자 파일(`settings.json`, `CLAUDE.md`)을 고쳤다는 사실, 백업 폴더 경로(복사한 파일이 있을 때), 지우는 방법(이 문서 끝 「제거」 절)이 있다는 것
  - 사용자가 넣지 않기로 하거나 거절해 빠진 기능과 그 기록(`agentMeterDeclined`, `goalMethodDeclined`)
  - 조직 설정 때문에 깔지 못한 것과 그 까닭, 프로젝트 쪽 statusLine과 겹침
  - 확인 단계가 실패했거나 멈췄던 충돌, `✔ enabled`가 아니라는 `Status` 줄, `q4AgentMeter`가 `true`인데 입력창 아래 표가 보이지 않은 것, keep-alive 끔이나 바꾼 값이 저장되지 않아 `/config`로 바꾸라고 안내한 것, 바꾼 keep-alive 값이 Claude Code를 다시 열어야 적용된다는 것
  - `미확인`인 것과 어디까지 봤는지
- **쓰는 법**(처음 설치 보고에만 둔다):
  - 평소처럼 일을 시킨다. 메인이 표를 보고 알맞은 정의로 서브에이전트에 맡긴다.
  - 결과가 모자라면 그렇다고 말한다. 회고가 그 말을 근거로 표의 칸을 고친다.
  - 처음에는 서브에이전트 기록이 첫 회고 기준 건수만큼 쌓이면 회고할지 묻는다(Q5에서 자동을 골랐으면 묻지 않고 돈다. 회고를 거듭할수록 기준이 오른다. 건수는 이 보고를 쓸 때 키트 `docs/RETRO.md`의 「정정과 후보 판정」에서 읽어 적는다).
  - 상태는 `/retro`(커맨드 이름을 바꿨으면 그 이름)로 본다.
  - 표에 있지만 하지 않는 일은 Claude에게 표에서 빼 달라고 하면 된다(그 칸 정의의 description 일 이름 나열도 함께 빼고, 뺀 이름은 회고가 다시 넣지 않는다).

보고에 쓸 내용을 모두 모았으면 `config.json`의 `installAnswers`를 지운다(최종 메시지를 보내기 전에 명령을 돌린다). 이 키는 끊긴 설치를 이어 할 때만 읽히고, 설치가 끝난 뒤의 업데이트는 읽지 않아 두면 낡은 답만 남기 때문이다. 다만 지우기 전에 `installAnswers.keptOutsideLines`를 최상위 `outsideLinesKept`로 옮긴다. 업데이트가 같은 줄을 다시 묻지 않으려면 그 줄과 그때 견준 키트 문장이 남아야 하기 때문이다.

`roles`, `retroMode`, `gitAskDeclined`처럼 업데이트가 읽는 키는 지우지 않는다. 명령 끝에 `keep`을 붙이면 `installAnswers` 전체는 지우지 않고 옮긴 `keptOutsideLines`만 `installAnswers`에서 지운다. 업데이트가 끝나지 않은 설치의 답을 옮길 때 쓴다(「업데이트 순서」 3번). 옮긴 답을 `installAnswers`에 남겨 두면, 업데이트가 `outsideLinesKept`를 고치거나 지운 뒤 다음 업데이트가 낡은 답을 다시 옮겨 되살리기 때문이다.

```
<kit-setup> --finish-answers "$HOME/.claude/subagent-system/config.json"
```

---

# 업데이트

1단계에서 설치본 `VERSION`이 키트보다 낮아 이 절로 온 컴퓨터만 따른다(끊긴 업데이트는 1단계 5번대로 아래 2번부터 다시 한다). 방식은 하나다. 사용자 칸만 지키고 나머지는 키트 것으로 바꾼다. 버전마다 무엇이 바뀌었는지는 가리지 않는다. 키트에 없는 설치본 파일(사용자가 따로 둔 것)은 건드리지 않는다.

## 지킬 규칙

- 덮어쓰기, 삭제, `settings.json` 수정 전에는 사용자에게 먼저 묻는다(아래 7번의 agent-meter 갱신과 예전 방식 치우기는 빼고. 새로 까는 것은 묻는다). 묻는 모든 곳은 「Q. 사용자에게 물을 것」의 「묻는 방법」을 따른다. 바꿀 내용(파일 목록, 차이, JSON 조각)을 같은 메시지에 보인다.
- 커밋하지 않는다.
- 파일을 바꾸기 전에 「2. 백업하고 파일 놓기」의 백업 명령으로 백업한다. 담기는 것은 `settings.json`, `CLAUDE.md`, 같은 이름의 정의, 설치된 `subagent-system/`의 `docs/`(`RETRO.md` 포함), `scripts/`, `rates.json`, `config.json`, `VERSION`, 같은 이름의 커맨드와 스킬(`commands/<이름>.md`, `skills/<이름>/`)이다. `records/`는 복사하지 않고 그대로 둔다.
- 이 키트 폴더의 파일은 고치지 않는다.
- 아래 명령은 Git Bash(Windows) 또는 터미널(macOS, 리눅스)에서 실행한다.
- 확인하지 못한 것은 `미확인`으로 적고 어디까지 봤는지 쓴다.
- 기록 파일은 여러 세션이 동시에 쓰므로, 업데이트하는 동안에는 다른 세션이 서브에이전트를 돌리고 있지 않아야 한다. 돌고 있으면 끝날 때까지 기다리자고 사용자에게 말한다.
- `settings.json`의 SubagentStop 훅 명령과 5단계의 extras 파일은 새로 넣지 않는다. git 확인 목록만 아래 6번에서 묻고 맞추고, 목표와 방법(Q4 e)은 extras 구역이 있는 설치본에만 아래 5번에서 한 번 묻는다. 규칙 바로 고치기(Q6)는 `autoApplyRules` 키가 없는 설치본에만 아래 「규칙 바로 고치기 질문」에서 한 번 묻는다. agent-meter는 설치본에 있으면 아래 7번에서 갱신하고, 없으면 7번에서 한 번 묻는다(업데이트에서 거절했거나 agent-meter만 지웠거나 5-2단계 3번의 오류 갈래를 만났으면 묻지 않는다). `CLAUDE.md`의 extras 구역은 아래 5번에서 차이를 보여 주고 묻는다. 정의의 글쓰기 줄은 정의 본문을 교체하는 같은 단계(아래 4번)에서 다시 더한다.

## 지키는 것과 바꾸는 것

| 지키는 것 | 어떻게 |
|:---|:---|
| GUIDE의 사용자 구역 | `<!-- 사용자 표 시작 -->`와 `<!-- 사용자 표 끝 -->` 사이의 모델 배정 표, `<!-- 무조건 Opus 시작 -->`와 `<!-- 무조건 Opus 끝 -->` 사이의 목록, `<!-- 사용자 규칙 시작 -->`와 `<!-- 사용자 규칙 끝 -->` 사이의 회고가 더한 공통 문장. 키트 GUIDE의 복사본에서 같은 표시 사이를 설치본 값으로 바꾸고, 4번에서 한 번에 놓는다. |
| 정의 10개의 description 가운데 일 이름 나열 | 「일반 성격 한 문장. 일 이름 나열. (가이드 경로)」에서 가운데 나열만 설치본 것을 둔다. 첫 문장과 가이드 경로는 키트 것이다. 자르는 법은 3단계의 「description 자르는 법」 |
| `rates.json` | 설치본 값을 그대로 두고, 키트에만 있는 모델 키만 더한다(`_`로 시작하는 키는 그대로). 이미 있는 모델의 값이 키트와 다르면(가격이 바뀐 경우) 모델별로 차이를 보여 주고 묻는다. 키트와 값이 다른 모델이 없었거나 모두 키트 값으로 바꿨으면 `_checked`를 설치본과 키트 가운데 늦은 값으로 둔다. 하나라도 그대로 두면 `_checked`는 설치본 값 그대로 둔다 |
| `config.json` | 회고 방식(`retroMode`), 고른 직군(`roles`), 커맨드 이름(`commandName`), 회고가 지운 정의 이름(`removedDefs`), 사용자가 표에서 뺀 일 이름(`removedKinds`), 처음 설치에서 고치지 않겠다고 한 표시 밖 줄과 그때 견준 키트 문장의 쌍(`outsideLinesKept`), 체크리스트 대조의 답(`checklistDeclined`, `checklistKept`), git 확인 목록에서 넣지 않기로 한 항목(`gitAskDeclined`), agent-meter를 새로 까는 질문을 거절했거나 agent-meter만 제거했거나 5-2단계 3번의 오류 갈래를 만났다는 표시(`agentMeterDeclined`. agent-meter가 깔려 있으면 7번이 이 키와 상관없이 갱신한다), keep-alive를 켤지 물었다는 표시(`agentMeterKeepaliveAsked`), statusLine 정리를 마쳤다는 표시와 그때 고른 답(`statusLineCleanup`. agent-meter만 제거하면서 statusLine을 되돌렸으면 지운다), CLAUDE.md 정리를 마치고 남긴 줄 수(`claudeMdKeptLines`, 회고와 5-1단계가 `--claude-md-done`으로 쓰고 기준 줄 수 이하가 되면 지움. 회고 밖에서 줄었으면 회고 출력 때 스크립트가 지움), 사용자가 바꾼 CLAUDE.md 기준 줄 수(`claudeMdLimitLines`), 목표와 방법을 넣지 않기로 했다는 표시(`goalMethodDeclined`), 회고의 문서 내용 검토가 마친 문서의 해시(`docReviewHashes`, `--docs-done`이 쓰고 `--docs`가 읽음)가 든 사용자 설정이라 설치본 값을 그대로 두고, 설치본에 없는 키만 키트의 기본값(`retroMode`는 `ask`)으로 더한다. 다만 `autoApplyRules`는 더하지 않는다(키가 없으면 참으로 읽혀, 사용자가 답하기 전에 규칙이 고쳐지는 것을 막으려고 「규칙 바로 고치기 질문」이 따로 한 번 묻는다). 자동 회고가 연속으로 실패하면 스크립트가 만들고 지우는 `retroFailures`, 기본값이 없는 `removedKinds`, `outsideLinesKept`, `gitAskDeclined`, `agentMeterDeclined`, `agentMeterKeepaliveAsked`, `statusLineCleanup`, `claudeMdKeptLines`, `claudeMdLimitLines`, `goalMethodDeclined`, `docReviewHashes`는 기본값이 없어 더하지 않고, 설치본에 있으면 그대로 둔다. `installAnswers`(처음 설치가 끊겼을 때 답을 남기는 키)는 설치를 마치면 지워지므로 보통 없다. 설치본에 있으면 끝나지 않은 설치의 답이라 읽거나 지우지 않고 그대로 두되(`keptOutsideLines`만 3번이 `outsideLinesKept`로 옮긴다), 없으면 더하지 않는다. `kitFileHashes`는 사용자가 정한 값이 아니라 키트 파일의 기록이라 지키지 않는다. 설치본에 없으면 더하지 않고, 있어도 9번이 새로 쓴다(그 전까지 3번이 읽는 옛 기록이다). `checklistDeclined`, `checklistKept`, `checklistSyncedVersion`은 「체크리스트 대조」가 쓴다. |
| `records/` | 건드리지 않는다. 안의 회고 잠금(`retro.lock`), 물을 것(`retro-pending.md`), 속도 기록(`speed-log.tsv`), 고침 기록(`fixes.tsv`)도 그대로 둔다 |
| `CLAUDE.md`의 표시 주석 사이 | 새 문장과 차이를 보여 주고 바꿀지 묻는다. 표시 밖은 건드리지 않는다. 다만 구역 밖의 「구역:」 줄은 5번이 그 줄이 가리키는 문장이나 절을 새 구역과 견주어 맞지 않을 때만 고칠지 묻는다 |
| 정의 10개 본문 끝의 글쓰기 줄 | 설치본 정의에 `글은 필요한 말만 쓴다` 줄이 있었으면 4번에서 키트 정의를 임시 폴더에 복사해 그 복사본 본문 끝에 `extras/DEFINITION_WRITING_LINE.md`의 정의용 줄을 더한 뒤 놓는다. 놓은 정의에 나중에 더하면 그 사이 줄이 빠진 채 남을 수 있다. 이 줄은 사용자가 Q4에서 고른 것이므로 설치본에 있었다면 지킨다 |
| `CLAUDE.md`의 extras 구역 안 메인용 글쓰기 줄 | 구역 안이라 위 표시 사이 규칙(차이를 보여 주고 묻는다)을 따른다. 설치본 정의에 글쓰기 줄이 있었으면 c를 고른 것으로 보고 이 줄을 남긴다 |
| `SUBAGENT_BRIEF_CHECKLIST.md` | 설치본에는 공통 줄, 고른 직군의 줄, 회고와 사용자가 더하거나 고친 줄이 섞여 있어 키트 파일과 늘 다르다. 그래서 파일을 통째로 바꾸지 않는다. 키트의 공통 줄과 `roles` 직군의 줄 가운데 설치본에 없는 줄, 고르지 않은 직군의 줄로 보이는 설치본 줄만 「체크리스트 대조」에서 묻고, 사용자가 고른 것만 더하거나 바꾸거나 지운다. 어느 직군 기본 줄과도 비슷하지 않은 설치본 줄(회고나 사용자가 더한 줄)은 건드리지 않는다 |

위에 없는 것은 키트 것으로 바꾼다. `/retro` 스킬(`skills/retro/SKILL.md`. 설치본 `config.json`에 `commandName`이 있으면 그 이름의 `~/.claude/skills/<이름>/SKILL.md`로 놓고 `name:` 줄을 그 이름으로 바꾼다), 스크립트 전부(`scripts/`의 모듈, `package.json`, `tests/`), `SUBAGENT_GUIDE.md`의 사용자 구역 밖(놓는 때는 4번), `RETRO.md`, 정의 10개의 나머지(놓는 때는 4번. frontmatter의 `model`과 `effort`, description 첫 문장과 가이드 경로, 본문. 사용자가 frontmatter에 더한 줄은 4번이 되넣는다), 설치본에 없던 새 정의(설치본 `config.json`의 `removedDefs`에 든 이름은 놓지 않는다), `VERSION`이다. 설치본 `docs/ROUTING_PRESETS.md`는 키트 파일이라 있으면 3번에서 지운다(1번의 백업에 남는다).

## 업데이트 순서

1. **백업**: 「2. 백업하고 파일 놓기」의 백업 명령을 실행하고, 찍힌 백업 경로를 사용자에게 알린다.
2. **사용자 칸 읽어 두기**: 교체하기 전에 설치본에서 아래를 읽어 대화에 적어 둔다.
   - 설치된 `SUBAGENT_GUIDE.md`의 모델 배정 표, 「무조건 Opus」 목록, 사용자 규칙 구역.
     - 표시 주석이 세 쌍 다 짝으로 있으면 표시 사이를 그대로 읽는다.
     - 한 쌍이라도 없거나 한쪽만 있으면 멈추고 보여 준 뒤 어떻게 읽을지 묻는다.
   - 설치된 정의 10개 가운데 본문에 `글은 필요한 말만 쓴다`가 든 정의(키트 정의 파일 이름만 넘긴 `grep -l '글은 필요한 말만 쓴다' <정의 파일들>`). 줄이 있는 정의 이름을 대화에 적어 둔다.
   - 설치본 `config.json`의 `retroMode`, `roles`, `commandName`. 파일이 없거나 JSON으로 읽히지 않으면 멈추고 보여 준다.
   - 설치본 `config.json`에 `kitFileHashes`가 있는지. `kitFileHashes`가 없으면 3번의 손으로 고친 파일 판단을 기록 없이 하고, 키트 버전 사이 변경일 수 있음을 함께 보인다. 9번이 이 키를 맨 끝에 쓰므로 끊긴 업데이트를 이어 해도 같은 기록을 읽는다.
   - 설치된 `/retro` 스킬 `SKILL.md`의 frontmatter `allowed-tools`가 `$HOME`을 쓰는지, 풀어 쓴 절대 경로를 쓰는지.
   - 설치된 정의 10개의 description에서 가운데 일 이름 나열. `opus-xhigh`는 나열이 없으니 읽지 않는다. description이 위 꼴이 아니면(끝의 가이드 경로 괄호를 못 찾으면) 보여 주고 어떻게 할지 묻는다. 첫 `. `가 없는 description은 나열이 없는 것으로 읽는다(`haiku-high`, `opus-low`). 자르는 법은 3단계의 「description 자르는 법」이다.
3. **파일 교체**: 키트 파일 가운데 설치본과 다른 것의 목록을 사용자에게 보여 주고 덮어써도 되는지 한 번에 묻는다. 이 목록에는 4번에서 놓을 `SUBAGENT_GUIDE.md`와 정의 10개도 넣는다. 이 둘은 「사용자 칸은 지킨다」를 함께 적고(GUIDE의 사용자 구역 세 쌍, 정의 description의 일 이름 나열), 놓는 때는 4번이라고 알린다. 스크립트, `RETRO.md`, 정의 본문, GUIDE의 구역 밖, `/retro` 스킬에 사용자가 손으로 고친 부분이 있으면 그 내용도 함께 보여 준다. 손으로 고친 파일은 아래 「손으로 고친 파일을 가리는 법」으로 가린다. 고친 줄이 서브에이전트가 늘 지켜야 하는 줄이면 지시문 체크리스트(`SUBAGENT_BRIEF_CHECKLIST.md`)로, 메인이 따를 줄이면 GUIDE의 사용자 규칙 구역으로 옮기자고 제안하고, `RETRO.md`의 줄이면 그 구역에 옮기자고 제안한다. `RETRO.md`에서 바꾼 줄은 「RETRO.md: A 대신 B」로, 더한 줄은 「RETRO.md <절 이름>: B」로, GUIDE의 구역 밖에서 바꾼 줄은 「A 대신 B」로 옮긴다(이 곳들은 업데이트 때 키트 것으로 바뀌기 때문이다). 옮기기는 덮어쓰기를 승인받은 뒤, 파일을 놓기 전에 줄마다 묻는다. GUIDE의 사용자 규칙 구역으로 옮기는 줄(메인이 따를 줄과 `RETRO.md`의 줄)은 설치본 GUIDE의 그 구역 끝에 바로 더하고, 2번에서 적어 둔 값에도 더한다(4번이 2번의 값으로 복사본 구역을 채운다. 끊겨 새 대화에서 이어 해도 2번이 설치본에서 다시 읽는다). 체크리스트로 옮기는 줄은 설치본 `SUBAGENT_BRIEF_CHECKLIST.md`에 바로 더한다. 옮긴 「RETRO.md: A 대신 B」 줄은 4번에서 점검한다. 승인과 옮기기를 마치면 「지키는 것과 바꾸는 것」의 아래쪽(키트 것으로 바꾸는 것)을 `~/.claude/` 아래 제자리에 놓는다. 위치는 「파일 놓기」 표와 같다. `SUBAGENT_GUIDE.md`와 정의 10개는 이 단계에서 놓지 않는다. 키트 GUIDE를 통째로 놓으면 사용자 칸을 되넣기 전까지 키트의 예시 표인 반쪽 상태로 남아 그동안 메인이 그 표로 서브에이전트를 배정하고, 정의를 먼저 놓으면 description의 일 이름 나열이 키트 것으로 돌아가 사용자 표와 어긋난 채 남기 때문이다. 둘 다 4번에서 복사본을 마무리한 뒤 한 번에 놓고, 그때까지 설치본은 그대로 둔다(옮긴 줄을 더한 GUIDE의 사용자 규칙 구역만 예외다). `VERSION`도 아직 놓지 않는다. 목록에는 지울 파일(설치본 `docs/ROUTING_PRESETS.md`가 있으면 그것)도 넣는다. 거절하면 아무것도 바꾸지 않고 멈추고, 설치본 `VERSION`은 옛 값으로 남는다고 알린다(1번에서 만든 백업 경로도 다시 알린다).
   - **손으로 고친 파일을 가리는 법**: 키트 파일을 바꾸기 전에 설치본 스크립트로 `node "$HOME/.claude/subagent-system/scripts/subagent-retro.js" --check-kit-hashes --kit "<키트>"`를 돌린다(`<키트>`는 이 문서 옆 `subagent-system/`이 든 폴더다. `CLAUDE_CONFIG_DIR`을 쓰는 컴퓨터는 `$HOME/.claude`를 그 폴더로 바꿔 넣는다). 2번에서 `kitFileHashes`가 있었을 때만 돌린다. 이 명령은 아무것도 쓰지 않는다. 설치본 스크립트가 `--kit`을 모르는 옛 버전이면 표시 없이 찍히지만, 그때는 아직 아무것도 놓지 않은 때라 표시가 필요 없다.
     - 「다름」으로 찍힌 파일 가운데 위 목록(키트와 다른 파일)에 든 것만 손으로 고친 파일 후보로 본다. 설치 때 해시를 남긴 뒤 설치본이 바뀐 파일이다. GUIDE는 세 구역 안(회고가 고치는 곳)을, 정의는 description 줄과 글쓰기 줄을 뺀 나머지를 견주므로 회고가 한 수정은 「다름」에 들지 않는다.
     - 설치본이 키트와 달라도 기록과 같은 파일은 키트 버전 사이의 변경이라 손으로 고친 파일로 보지 않는다. 옮기기도 제안하지 않는다.
     - 「다름」 뒤에 `(새 키트와 같음)`이 붙은 파일은 이미 새 키트로 놓인 것이라(끊긴 업데이트를 이어 하는 경우) 손으로 고친 파일로 보지 않고 옮기기도 제안하지 않는다. `/retro` 스킬은 `$HOME`을 풀어 쓴 절대 경로로 바꾼 것(6단계 12번의 대비책)이 그 경로만 새 키트와 달라도 붙는다.
     - 「없음」으로 찍힌 파일은 사용자가 지운 것이니 3번(정의와 GUIDE는 4번)이 다시 놓는다고 알린다. 「지움」으로 찍힌 정의는 `removedDefs`에 든 이름이라 회고가 지운 것이니 다시 놓지 않는다(4번도 놓지 않는다).
     - 손으로 고친 파일은 설치본과 새 키트 파일의 차이를 보이고(GUIDE는 세 구역 밖만, 정의는 description 줄과 글쓰기 줄 밖만 차이를 보인다), 고친 줄이 있으면 위 옮기기를 제안한다. 옮길 곳이 있는 줄(규칙 문장)만 줄마다 묻는다. 스크립트 코드처럼 옮길 곳이 없는 차이는 보여 주고, 덮어쓰면 사라진다고 알린다. 새 키트 줄과 같은 자리에서 다른 줄은 「a. (추천: 새 키트가 바꾼 문장일 수 있다) 옮기지 않는다, b. 옮긴다」로 묻는다. 새 키트 줄 사이에 새로 들어간 줄은 「사용자가 더했거나 새 키트가 지운 줄이다」라고 보이고 「a. (추천: 줄을 읽고 사용자가 더한 줄이면) 옮긴다, b. 옮기지 않는다」로 묻는다. 해시는 어느 파일을 이 단계에 올릴지 가리는 데만 쓰고 추천에는 쓰지 않는다.
     - 정의는 키트 정의 파일들 어디에도 없는 줄을 후보로 본다. 회고가 일을 옮긴 칸의 정의를 다른 정의에서 복사해 만들었으면(`RETRO.md`의 「표와 정의를 고친 뒤」) 그 줄이 모두 키트 정의에 있어 제안할 것이 없고, 4번이 키트 본문으로 놓는다. 찾는 명령은 `grep -vxF -f <(cat "<키트>"/subagent-system/agents/*.md) <설치본 정의 파일> | grep -v -e '^description:' -e '^$' -e '글은 필요한 말만 쓴다'`이다. description 줄과 글쓰기 줄은 사용자 칸이라 빼고, 빈 줄은 줄이 아니라 뺀다. 잡힌 줄은 바로 위 규칙으로 가린다. frontmatter(첫 `---`와 다음 `---` 사이)의 줄은 옮기지 않는다. 키트 정의의 frontmatter에 없는 키(예: `color:`, `tools:`)의 줄은 4번이 복사본에 다시 넣고, `model:`과 `effort:`처럼 키트에 있는 키는 키트 값을 따른다.
     - 2번에서 `kitFileHashes`가 없었으면 가릴 기록이 없으니 키트와 다른 파일 모두를 손으로 고친 파일로 보고 위 규칙대로 묻는다.
   - 정의 10개와 그 본문 끝의 글쓰기 줄은 4번에서 다룬다.
   - 설치본 `docs/ROUTING_PRESETS.md`가 있으면 지운다(1번의 백업에 남는다).
   - 설치본에 `rates.json`이 없으면 키트 것을 놓는다. 있으면 키트에만 있는 모델 키만 더하고, 더한 모델 이름을 사용자에게 알린다. 이미 있는 모델의 값이 키트와 다르면 모델별로 설치본 값과 키트 값을 보여 주고 묻는다. `_checked`는 `2026-10` 꼴의 연월 문자열이라 글자 순서로 견준다. 설치본 `_checked`가 키트보다 늦으면 「a. (추천: 회고가 더 새 가격표로 고친 값이다) 그대로 둔다, b. 키트 값으로 바꾼다」, 아니면 「a. (추천: 키트가 새 가격표를 반영했다) 키트 값으로 바꾼다, b. 그대로 둔다」로 묻는다. 키트와 값이 다른 모델이 없었거나 모두 키트 값으로 바꿨으면 `_checked`를 설치본과 키트 가운데 늦은 값으로 둔다. 하나라도 그대로 두면 `_checked`는 설치본 값 그대로 둔다(표 전체를 새 가격표로 확인한 달이 아니기 때문이다). 그 모델의 값만 바꾸고 다른 모델은 건드리지 않는다.
   - `/retro` 스킬을 놓는다. 설치본 `config.json`의 `commandName`(없으면 `retro`)을 이름으로 쓰고 `~/.claude/skills/<이름>/SKILL.md`를 키트 것으로 바꾼다. `CLAUDE_CONFIG_DIR`을 쓰는 컴퓨터는 새 `SKILL.md`에 「`CLAUDE_CONFIG_DIR`을 쓰는 컴퓨터」의 치환을 한다. 업데이트 순서 2번에서 읽어 둔 설치본 스킬이 `$HOME` 대신 풀어 쓴 절대 경로를 쓰고 있었으면(6단계 12번의 대비책을 쓴 컴퓨터) 새 `SKILL.md`도 같은 절대 경로로 바꾼다.
   - `config.json`을 맞춘다. 값을 그대로 두고 빠진 키만 더한다(`autoApplyRules`는 더하지 않고 아래 「규칙 바로 고치기 질문」이 묻는다). `installAnswers.keptOutsideLines`가 있으면(끝나지 않은 설치의 답) 「7. 보고」의 옮기는 명령에 `keep`을 붙여 돌려 `outsideLinesKept`로 옮긴다. 옮긴 답은 `installAnswers`에서 지우고 나머지 답은 그대로 둔다.
   - 옛 SessionStart 훅을 뺀다. 설치본 `~/.claude/settings.json`의 `hooks.SessionStart`에서 명령에 `subagent-retro.js`와 `--session-start`가 함께 든 항목만 뺀다. 그런 항목이 없으면 건너뛴다. 이 키트는 회고 알림을 작업이 끝날 때만 하므로 세션을 열 때 도는 훅이 필요 없고, 남겨 두면 `--session-start`가 무시된 채 매 세션 시작마다 `--due` 출력이 문맥에 들어간다. 다른 훅(사용자의 다른 SessionStart 훅 포함)은 그대로 둔다. 빼는 단위는 `matcher` 묶음이 아니라 묶음 안의 명령 하나(`{"type", "command"}`)다. 명령을 뺀 묶음의 `hooks`가 비면 그 묶음을, 이벤트 배열이 비면 그 이벤트 키를, 마지막에 `hooks`가 비면 `hooks` 키를 지운다. 빼기 전에 뺄 명령을 보여 주고 확인을 받는다. Claude가 `settings.json`을 통째로 다시 쓰지 않고 아래 명령으로 뺀다(파일 권한도 지킨다). 뺀 뒤 「6. 확인」 1번 명령으로 읽어 본다.
     ```
     <kit-setup> --remove-hooks "$HOME/.claude/settings.json" SessionStart
     ```
   - `SUBAGENT_BRIEF_CHECKLIST.md`는 통째로 바꾸지 않고, `config.json`을 맞춘 뒤 아래 「체크리스트 대조」를 한다.
4. **사용자 칸 되넣기와 한 번에 놓기**: 설치본 `SUBAGENT_GUIDE.md`와 정의 10개는 복사본에서 사용자 칸을 되넣고 글쓰기 줄을 더하는 것까지 마친 뒤에 한 번에 바꾼다. 그때까지는 건드리지 않는다(3번에서 옮긴 줄을 더한 GUIDE의 사용자 규칙 구역만 예외다).
   - 키트의 `SUBAGENT_GUIDE.md`와 정의 10개(설치본 `config.json`의 `removedDefs`에 든 이름은 뺀다)를 임시 폴더(세션의 스크래치 폴더가 있으면 거기, 없으면 운영체제 임시 폴더)에 복사하고, 아래는 모두 이 복사본에서 한다. `~/.claude/subagent-system/` 아래에 두면 업데이트가 끊겼을 때 바꾸다 만 임시 파일이 설치본 안에 남는다. `CLAUDE_CONFIG_DIR`을 쓰는 컴퓨터는 「`CLAUDE_CONFIG_DIR`을 쓰는 컴퓨터」 치환도 이 복사본에서 한다.
   - 복사본 GUIDE의 표 쌍, 목록 쌍, 사용자 규칙 쌍 사이(키트의 예시 표와 목록, 빈 규칙 구역)를 설치본 GUIDE의 같은 쌍 사이로 통째로 바꾼다. 표시 주석 줄은 그대로 둔다. 바꾸기는 아래 명령으로 하고, Claude가 표를 다시 받아 적지 않는다. 표 칸 안의 `「(시험: 다음 1건 …)」`, `「(최저: …)」`, `「(고정)」` 같은 표시가 받아 적다 빠지면 `--check`로도 잡히지 않고 진행 중이던 시험이 사라지기 때문이다. 명령은 설치본 파일에서 글자 그대로 옮기고(3번에서 사용자 규칙 구역에 더한 줄 포함), 어느 쪽이든 표시가 한 쌍이 아니면 복사본을 바꾸지 않고 오류로 멈춘다. 그때는 2번처럼 보여 주고 묻는다.

     ```
     <kit-setup> --copy-guide-zones "$HOME/.claude/subagent-system/docs/SUBAGENT_GUIDE.md" "<임시 폴더>/SUBAGENT_GUIDE.md"
     ```

   - **키트 문장을 가리키는 줄 점검**: 되넣은 복사본 구역의 줄 가운데 키트 문장이나 절을 가리키는 줄(「~ 대신 ~」, 「RETRO.md <절 이름>: ~」)이 있으면 줄마다 가리키는 문장(「A」)이나 절이 새 키트 GUIDE(복사본의 구역 밖)나 `RETRO.md`에 아직 있는지 본다. 있고 뜻이 같으면 그대로 두고 묻지 않는다. 없거나 뜻이 바뀌었으면 그 줄, 새 키트의 가까운 문장, `CHANGES.md`의 해당 항목(없으면 없다고)을 같은 메시지에 보이고 묻는다. 줄마다 한 번에 하나씩 묻는다.
     - a. (추천: 줄이 가리키는 키트 문장이 새 키트에서 바뀌었거나 없어져 그대로 두면 이 줄이 어느 문장 대신인지 알 수 없다) 새 문장에 맞춰 고친다. 그 줄을 새 키트의 가까운 문장 기준으로 다시 쓴다.
     - b. 지운다. 그 줄의 뜻은 더 이상 적용되지 않는다.
     - 「그대로 둔다」는 보기를 두지 않는다. 답이 남지 않아 업데이트마다 같은 줄을 다시 묻게 되기 때문이다.
     - 고르면 복사본의 그 줄만 고치거나 지운다. 다른 줄은 건드리지 않는다.
   - **정의 description 되넣기**: 복사본 정의 10개(`opus-xhigh` 제외)의 description 가운데 일 이름 나열을 2단계에서 읽은 설치본 것으로 바꾼다. 자르는 법은 3단계의 「description 자르는 법」이고, 첫 문장과 가이드 경로는 키트 것 그대로 둔다. 키트 description에 나열이 없는데(`haiku-high`, `opus-low`) 설치본에 나열이 있으면 키트 첫 문장 뒤에 그 나열을 붙여 `<첫 문장>. <나열>. (가이드 경로)` 꼴로 만든다. 설치본에 없던 새 정의(`removedDefs`에 든 이름은 제외)는 나열 자리를 복사본 GUIDE의 표에서 그 정의 칸의 일 이름으로 채우고(칸이 비면 일반 성격 문장과 가이드 경로만 남긴다), 나머지는 키트 것 그대로 둔다.
   - **체계 칸 점검**: 되넣은 복사본 GUIDE의 표에 `ROUTING_PRESETS.md` 「모든 표에 남는 칸」의 여덟 가지 일 이름이 모두 있는지 본다. 빠진 일이 「작업 기록 병목 분석」이나 「문서 내용 검토」이면 이름 뒤에 「(고정)」을 붙여 Opus medium 칸에 더하고, 「무조건 Opus 영역 판단」(「(고정)」을 붙인다)이면 「무조건 Opus 영역 구현」이 든 칸에, 「계획이 정한 무조건 Opus 영역 단계 구현」이면 이름 뒤에 ``「(최저: `sonnet-medium`)」``을 붙여 Sonnet high 칸에 더한다. 어느 쪽이든 더한 칸 정의 복사본의 description 일 이름 나열에도 같은 이름을 더한다. 그 정의가 `removedDefs`에 들어 있으면 복사본에 정의 파일이 없으니, 키트의 같은 정의 파일을 복사본에 더하고 description 나열을 복사본 GUIDE 표의 그 칸 일 이름으로 채운다. 되넣기가 새 정의에 하는 것과 같은 일이지만 되넣기가 앞서 돌아 이 정의를 건너뛰었으므로, 여기서 해야 키트 기본 나열이 남지 않는다. 나머지 네 가지가 빠졌으면 멈추고 보여 준다. 더한 칸은 사용자에게 알린다.
   - **정의 frontmatter에 더한 줄**: 설치본 정의의 frontmatter(첫 `---`와 다음 `---` 사이)에 키트 정의의 frontmatter에 없는 키(예: `color:`, `tools:`)의 줄이 있으면 복사본의 frontmatter 끝에 그대로 다시 넣는다(값이 여러 줄이면 이어지는 들여쓴 줄까지). `model`과 `effort`는 키트 값을 따른다.
   - **글쓰기 줄**: 2번에서 적어 둔 정의마다 복사본 본문 맨 끝에 `extras/DEFINITION_WRITING_LINE.md`의 정의용 줄을 더한다. 설치본에 없던 새 정의(예: `haiku-high`)도 다른 정의에 줄이 있었으면 같이 더한다. 빠뜨리면 6단계 6번의 `grep -c`가 그 정의에서 0을 찍는다. 놓은 정의에 나중에 더하면 그 사이에 세션이 끊길 때 줄이 빠진 채 남는다.
   - **한 번에 놓기**: 복사본 GUIDE를 `~/.claude/subagent-system/docs/SUBAGENT_GUIDE.md`로, 복사본 정의를 `~/.claude/agents/`로 놓는다. `VERSION`은 아직 놓지 않는다(9번).
   - **`removedDefs` 빼기**: 체계 칸 점검에서 정의를 다시 더했으면 한 번에 놓기를 마친 뒤 그 이름을 `config.json`의 `removedDefs`에서 뺀다. 명령은 `RETRO.md`의 「표와 정의를 고친 뒤」에 있다.
5. **CLAUDE.md 구역**: `~/.claude/CLAUDE.md`에서 `<!-- subagent-system 시작 -->`을 찾는다.
   - **표시가 있으면** 시작과 끝 사이가 이 키트가 넣은 규칙이다. 지금 사이 내용과 「4. 규칙 줄 넣기」의 새 문장(「`CLAUDE_CONFIG_DIR`을 쓰는 컴퓨터」 치환을 한 것)을 사용자에게 보여 주고, 승인하면 그 사이만 새 문장으로 바꾼다. 지금 사이에 자동 회고 예외 줄(마지막 규칙 줄)이 없었으면 새 문장에서도 그 줄은 뺀다. 새 문장 가운데 표시 밖에 같은 뜻의 줄이 있고(4단계의 기준으로 가른다) 지금 구역에 그 뜻의 키트 줄이 없는 것은 설치 때 같은 뜻이라 두었거나 부딪히는 키트 줄을 그 자리에서 사용자 줄로 고쳐(a) 구역에는 넣지 않은 줄이므로 비교에서 빼고, 그 줄이 표시 밖에 있다고만 알린다. 고친 사용자 줄은 그 키트 줄과 같은 뜻이 되었으므로 이 가림으로 빠진다. 다만 표시 밖 줄과 부딪히는 새 키트 문장이 있으면(설치 때 b를 골라 `outsideLinesKept`에 쌍이 있는 줄 포함) 아래대로 가린다. 지금 구역에 그 뜻의 키트 줄이 이미 있으면 표시 밖 같은 뜻의 줄은 설치 뒤에 회고나 사용자가 더한 보충 줄이라 견주지 않고, 구역과 새 문장의 비교만 한다(설치 때 구역에 넣지 않은 줄만 위 가림의 대상이다). 차이가 없으면 건너뛴다. 그 밖에는 건드리지 않는다.
     - 묶음은 5단계의 묶음 규칙을 따르되, 쌍이 있는 줄은 같은 `kit`을 가진 쌍들의 사용자 줄을 한 묶음으로 본다. 설치 때 a로 고친 사용자 줄은 고친 문장이 곧 그 줄의 `kit`인 쌍으로 본다. 이 규칙은 `subagent-system` 구역과 아래 extras 구역 비교에 같이 쓰인다.
     - 쌍이 있으면 `kit`(그때 견준 키트 문장. 묶음이면 이은 문장)과 새 키트에서 그 `kit`에 든 줄들을 같은 순서로 이어 만든 문장을 뜻으로 견준다. 같은 뜻이면 키트가 문장을 바꾸지 않은 것이라 묻지 않고, 새 키트 문장도 구역에 넣지 않으며 쌍은 그대로 둔다. 뜻이 달라졌을 때만 묶음마다 아래 질문을 한다. 줄 하나씩 견주면 키트가 그대로여도 업데이트마다 같은 줄을 다시 묻고, b에서 `kit`이 한 줄로 바뀌어 다음 업데이트에서 뺀 덩어리가 다시 오르기 때문이다.
     - 쌍이 없으면 표시 밖 줄과 새 키트 문장을 견주고, 뜻이 다를 때 아래 질문을 한다. 같은 뜻인지, 부딪히는지, 다른 주제인지는 4단계의 기준으로 가른다.
     - 질문: 묶음의 사용자 줄 원문과 새 고칠 문장(쌍이 있으면 그때의 `kit`도)을 같은 메시지에 보이고 5단계의 보기로 묻는다.
     - a를 고르면 묶음의 첫 사용자 줄만 새 문장으로 고치고 나머지 사용자 줄은 지우며(지울 줄은 질문에 보인다), 묶음의 쌍은 모두 `outsideLinesKept`에서 지운다(이제 같은 뜻이라 견줄 것이 없다). b를 고르면 새 문장도 구역에 넣지 않고 사용자 줄을 그대로 둔다(서로 다른 규칙이 함께 남지 않게). 묶음의 쌍은 `kit`을 모두 새 이은 문장으로 고치고, 쌍이 없었으면 새로 만든다. 다음 업데이트는 그 키트 문장이 또 달라졌을 때만 다시 묻는다.
     - 쌍을 고치거나 새로 만들거나 지우는 명령은 아래와 같다. 같은 `line`의 쌍은 바뀌고, `kit` 없이 `line`만 넘기면 그 쌍이 지워진다. 묶음이면 쌍마다 한 번씩 돌린다. 문장에 따옴표가 들어 있어도 셸이 풀지 않게 입력으로 넘긴다.

       ```
       <kit-setup> --keep-outside-line "$HOME/.claude/subagent-system/config.json" <<'EOF'
       {"line": "<표시 밖 줄 원문>", "kit": "<새 키트 문장>"}
       EOF
       ```
   - **비교하는 법**: 새 문장은 「4. 규칙 줄 넣기」의 뜻을 지금 구역의 말투와 형식으로 쓴 것이므로 글자로 견주지 않는다.
     - 줄마다 뜻으로 견주고, 표현만 다른 줄은 차이로 보이지 않는다.
     - 위임 기준 줄도 다른 줄처럼 새 키트 문장으로 바꾼다. 사용자가 바꾼 기준은 구역 밖의 「구역: A 대신 B」 줄이 지키므로 구역에 따로 남기지 않는다.
   - **표시가 없으면** 사용자가 지웠거나 규칙 줄을 넣지 않은 것이므로 `subagent-system` 구역 비교만 건너뛴다고 알린다. 아래 extras 구역 비교와 「구역:」 줄 점검은 그대로 하고, 6번과 7번도 따로 한다.
   - extras 구역(`<!-- claude-setup-kit extras 시작 -->`과 `끝` 사이)이 있으면 그 사이를 키트의 새 내용(`extras/CLAUDE_RULES.md`의 규칙. 맨 위 제목 줄과 「넣는 법」 안내 문단은 뺀다. 「백엔드, 데이터, 인프라를 고른 경우」 묶음 둘은 `roles`에 그 직군이 하나라도 있을 때만 「5. 함께 넣는 것」과 같은 자리에 소제목 없이 넣는다. `roles`가 빈 배열이면 넣지 않는다. c를 골랐으면 그 뒤에 메인용 글쓰기 줄, 구역에 「목표와 방법」 소제목이 있으면 그 뒤에 `extras/GOAL_AND_METHOD.md`의 「목표와 방법」 절)과 비교해 차이를 보여 주고, 승인하면 그 사이만 바꾼다. 비교는 `subagent-system` 구역처럼 줄마다 뜻으로 견주며, 표현이나 하위 줄 들여쓰기 같은 꼴 차이는 차이로 보지 않는다. 새 내용에서 ①이나 ②가 비교에서 빠지면(표시 밖 같은 뜻 줄이나 설치 때 a로 고친 줄) 새 내용의 소제목도 「멈추고 묻는 경우」로 바꿔 견주므로, 구역의 「멈추고 묻는 경우」 소제목은 차이가 아니다. 빠지는 줄이 없는데 구역 소제목이 「멈추고 묻는 경우」이면 「둘뿐」으로 바꾸는 차이로 보여 준다. 구역이 없으면 건너뛴다. 구역에 `CLAUDE_RULES.md`의 절 제목(「질문」, 「git」, 「멈추고 묻는 경우는 둘뿐」 등. 소제목 줄의 `#` 개수와 상관없이 제목 글자로 찾는다. 「목표와 방법」은 이 파일의 절이 아니다)이 하나도 없으면 Q4에서 a를 넣지 않고 c나 e만 넣은 것이므로, `CLAUDE_RULES.md`의 규칙은 비교에서 빼고 구역에 든 메인용 글쓰기 줄과 「목표와 방법」 절만 비교한다. 새 내용 가운데 표시 밖에 같은 뜻의 줄이 있고 지금 구역에 그 뜻의 줄이 없는 문장도 위와 같은 까닭으로 비교에서 뺀다(설치 때 a로 고친 줄도 같다. 구역에 그 뜻의 줄이 이미 있으면 표시 밖 줄은 설치 뒤에 더한 보충 줄이라 견주지 않는다). 설치 때 b로 덩어리 전체를 구역에 넣지 않았으면 `outsideLinesKept` 쌍의 키트 문장에 든 줄과 같은 덩어리(같은 소제목 아래)의 나머지 줄도 비교에서 뺀다(구역에 넣지 않은 덩어리라 견줄 짝이 없다. 쌍은 그대로 둔다). 다만 표시 밖 줄과 부딪히는 새 문장이 있으면(설치 때 b를 골라 `outsideLinesKept`에 쌍이 있는 줄 포함) 위 CLAUDE.md 구역과 같은 규칙으로 가린다(묶음, 쌍 견주기, 질문의 보기와 답 처리가 모두 같다). 설치본의 구역에 자동 회고 예외 줄이 있으면 4단계 구역에 같은 뜻의 규칙이 있으므로 지우는 차이로 보여 준다. 2단계에서 적어 둔 정의에 글쓰기 줄이 있었으면 c를 고른 것으로 보고 그 문장을 메인용 줄로 남긴다고 알린다.
   - **목표와 방법을 새로 넣을지**: extras 구역이 있고, 구역에 「목표와 방법」 소제목이 없고, 표시 밖에도 같은 뜻의 절이 없고, `config.json`에 `goalMethodDeclined`가 없으면 위 비교를 마친 뒤 Q4의 e와 같은 질문을 한 번 한다(e 첫머리의 설명과 「보일 내용」을 같은 메시지에 보인다). 키트에 새로 생긴 선택 항목을 이미 extras를 깐 사람에게 한 번 권하려는 것이다. 넣는다고 하면 「5. 함께 넣는 것」의 e대로 구역 맨 끝에 넣는다. 넣지 않는다고 하거나 같은 뜻의 사용자 줄을 두고 키트 절은 넣지 않기로 하면 그 e의 명령으로 `goalMethodDeclined`를 `true`로 남겨 다음 업데이트에서 다시 묻지 않는다. extras 구역이 없는 설치본(extras를 넣지 않은 컴퓨터)에는 묻지 않는다.
   - **구역 밖의 「구역:」 줄**: 두 구역을 정한 뒤(승인받아 바꿨으면 바꾼 구역으로), 줄마다 꼴에 따라 본다. 구역 문장이 바뀌어도 사용자가 적은 고침이 엉뚱한 문장에 걸리거나 할 일 없이 남지 않게 하려는 것이다.
     - 「구역: A 대신 B」: 「A」를 지금 `CLAUDE.md`의 두 구역에서 찾는다. 있고 뜻이 같으면 묻지 않는다. 없거나 뜻이 바뀌었으면 묻는다.
     - 「구역: <절이나 항목 이름>에 「B」를 더한다」: 가리킨 절이나 항목이 지금 두 구역에 남아 있는지와, B와 같은 뜻의 문장이 새 키트 구역에 이미 들어왔는지를 본다. 절이나 항목이 남아 있고 B와 같은 뜻의 문장이 구역에 없으면 묻지 않는다. 절이나 항목이 없어졌으면(이름이 바뀐 것 포함) 묻는다. B와 같은 뜻의 문장이 구역에 들어왔으면 그 줄은 할 일이 없어진 것이라 묻고, 이때는 보기의 b(지운다)에 추천을 단다.
     - 뜻이 같은지는 4단계의 기준으로 가른다. 가리킨 문장이나 절이 남았는지, 뜻이 같은지를 가르지 못하면 묻는다.
     - 묻는 것은 위 4번의 점검과 같은 질문과 보기(고친다, 지운다)이고, 고르면 `CLAUDE.md`의 그 줄만 고치거나 지운다. 이 줄은 위의 같은 뜻 표시 밖 줄 가림에서 뺀다.
6. **git 확인 목록**: 설치본 `~/.claude/settings.json`의 `permissions.ask`에 키트 `extras/git-permissions.json`의 항목이 하나라도 있으면(처음 설치 때 이 목록을 골랐다는 뜻이다) 맞춘다. 하나도 없으면 고르지 않았거나 지운 것이므로 건너뛰고 넣지 않는다. 키트 목록에서 설치본 `ask`에 빠진 항목을 찾되, `config.json`의 `gitAskDeclined`에 든 항목(설치 때 뺐거나 전에 거절한 것)은 묻지 않고 뺀다. 남은 빠진 항목은 대표 몇 줄과 빠진 줄 수로 보여 주고(사용자가 원하면 전체 원문), 사용자가 승인한 것만 더한다. 승인하지 않은 항목은 `gitAskDeclined`에 더해 다음 업데이트에서 다시 묻지 않는다(명령은 처음 설치 5단계의 git 항목과 같다). 사용자가 일부러 지운 항목일 수 있으므로 승인 없이는 넣지 않는다. 설치본의 그 밖의 항목은 건드리지 않는다. 고친 `settings.json`은 「6. 확인」 1번 명령으로 읽어 본다.
7. **agent-meter**: 0단계에서 마켓플레이스 출처를 막는 설정이 읽혔으면 하지 않고 그 사실을 알린다. 읽히지 않았으면 설치본 상태에 따라 둘로 나뉜다. 어느 쪽이든 `settings.json`을 고치는 위 6번의 git 확인 목록을 마친 뒤에 한다(`claude plugin` 명령도 `settings.json`에 쓰기 때문이다).
   - **이미 깔려 있으면**(`claude plugin list --json`에 `agent-meter@claude-token-save`가 있거나, 예전 방식 흔적인 `~/.claude/mods/agent-meter`나 `env.CLAUDE_CODE_PLUGIN_DIRS`의 그 폴더 항목이 있음. 처음 설치에서 깔았거나 키트의 옛 설치 스크립트로 직접 깐 것이다): 설치 여부는 묻지 않고 5-2단계의 1번부터 4번을 한다. 마켓플레이스로 깔려 있으면 갱신하고, 예전 방식이면 마켓플레이스로 새로 깐 뒤 옛 것을 치운다. 다만 `config.json`에 `agentMeterKeepaliveAsked`가 `true`가 아니면 갱신 전에 keep-alive를 켤지 한 번 묻는다(Q4의 d 둘째 항목 「이미 깔려 있으면」의 질문과 같고 번호를 달지 않는다. 답은 5-2단계 3번의 마지막 두 항목대로 반영하고 기록한다). 이번에 받은 keep-alive 답이 있으면 그 답이 먼저이고(끔이면 설치 명령에 `--config keep_alive=false`를 붙이고 옛 값은 옮기지 않는다), 답이 없을 때만 옛 `AGENT_METER_KEEPALIVE`가 끔인 것을 `keep_alive`로 옮긴다. 위 「지킬 규칙」의 `settings.json` 수정 전 확인에서 빠진다. 이미 깐 사람이 업데이트를 맡겼으므로 agent-meter도 함께 새로 고친다. 예전 방식이면 치우기 전에 5-2단계 4번의 알림 셋을 알리고, 출력 처리와 설치 확인(3번. 오류 갈래 포함)은 5-2단계를 따른다.
   - **깔려 있지 않으면**: `config.json`에 `agentMeterDeclined`가 `true`이면 전에 거절한 것이니 묻지 않고 건너뛴다. 아니면 Q4의 d와 같은 질문을 한 번 한다. 처음 설치에서 거절한 사람도 `agentMeterDeclined`가 없으므로 첫 업데이트에서 한 번 더 권한다. 그 사이 키트가 바뀌었을 수 있어서이고, 의도한 동작이다. 같은 메시지에 d 첫머리의 설명(agent-meter가 무엇인지, 바뀌는 것, 안 바뀌는 것)과 d의 「보일 내용」(표의 모양, 실행할 명령과 바뀌는 설정)을 보이고 「agent-meter를 넣을까요?」를 묻는다. 보기는 「a. (추천: 서브에이전트마다 어느 모델과 effort로 돌고 비용이 얼마인지 입력창 아래에서 바로 보여, 라우팅이 의도대로 도는지 확인할 수 있다) 넣는다」, 「b. 넣지 않는다」이다. 서브에이전트 체계는 agent-meter 없이도 돈다고 함께 알린다.
     - 넣는다: Q4의 후속 질문(keep-alive)을 묻고, 「5-2. agent-meter 설치」의 2번(끔을 골랐으면 `--config keep_alive=false`를 붙인다)과 3번대로 새로 깔고 확인한다. `agentMeterKeepaliveAsked`도 3번대로 남긴다.
     - 넣지 않는다: `config.json`에 `agentMeterDeclined`를 `true`로 남겨 다음 업데이트에서 다시 묻지 않게 한다. 명령은 5-2단계 「statusLine 정리」 9번의 명령에서 마지막 두 인자를 `agentMeterDeclined`와 `'true'`로 바꾼 것이다. 나중에 깔려면 README의 「1. agent-meter만 직접 설치」(`claude plugin install agent-meter --marketplace daum7766/claude-token-save`)로 깔면 되고, 깐 뒤의 업데이트는 `agentMeterDeclined`가 남아 있어도 위 「이미 깔려 있으면」대로 갱신한다고 알린다.
   - **정리**(위에서 갱신했거나 새로 깐 뒤): 5-2단계의 「statusLine 정리」를 한다. 다만 `config.json`에 `statusLineCleanup`이 있으면 전에 한 것이니 하지 않고, 5-2단계 3번이 실패했거나 오류 갈래였으면 하지 않는다. 정리를 마치면 같은 9번대로 `statusLineCleanup`을 남긴다.
8. **검증**: 「6. 확인」의 1부터 4까지(설정 파일 파싱, 남은 자리, `node --test`, `--where`, `--count`, `--due`, 훅 확인)와 6(`--check`), 7(표시 주석 짝. 5번에서 표시가 없어 건너뛰었으면 `subagent-system` 짝이 없는 것이 정상이고, extras 구역이 없었으면 extras 짝도 없는 것이 정상이다)을 한다. 서로 다른 폴더 두 곳에서 `--where`와 `--count`가 같은 값을 내는지도 본다.
   - 스크립트나 시험이 실패하면 `VERSION`을 놓지 않고 멈춰 사용자에게 보여 준다. 설치본 `VERSION`이 옛 값으로 남아 다음에 다시 업데이트로 간다.
   - `--check`의 통과 기준은 종료 코드가 아니라 항목별이다. 「정의 description과 표 칸이 다른 곳」, 「표에 칸이 있는데 정의 파일이 없는 칸」, 「removedDefs에 든 정의인데 표의 칸에 일이 있는 칸」은 셋 다 `없음`이어야 한다(셋째는 회고가 지운 정의 이름이 `config.json`의 `removedDefs`에 있는데 표의 그 칸에 일이 남은 것이다). 남아 있으면 사용자 칸에서 온 것일 수 있으니 고치지 말고 사용자에게 보여 주고, 어떻게 할지 정해 고친 뒤 다시 돌려 `없음`이 되기 전에는 `VERSION`을 놓지 않는다.
   - 「표 칸과 다른 정의로 보낸 기록」은 통과 기준이 아니다. 기록이 쌓인 설치본은 표를 고치기 전에 쌓인 기록 때문에 이 항목이 찍히고 종료 코드가 1이 된다. 건수와 마지막 날짜를 사용자에게 보여 주고 고치지 않으며, 회고로 넘긴다고 알린다.
   - 이름에 `_`가 든 프로젝트에서도 `--count`가 「사용 기록이 없습니다」 없이 숫자를 낸다(기록이 있을 때).
   - 기본 실행 `node "$HOME/.claude/subagent-system/scripts/subagent-retro.js"`는 기록이 있으면 오류 없이 표를 찍는다. 기록이 없으면 「사용 기록이 없습니다: <경로>」를 오류 출력에 찍고 종료 코드 1로 끝나는 것이 정상이다.
   - `--repeats`가 종료 코드 0으로 끝난다(기록이 없으면 범위를 정하지 못했다는 문구가 찍히는 것이 정상이다).
   - `config.json`에 `autoApplyRules` 키가 있다. 없으면 「규칙 바로 고치기 질문」을 마치지 않은 것이다.
   - 기록이 있으면 `--kinds`가 「표를 읽지 못했습니다」 없이 목록을 찍는다. 이 문구가 나오면 설치된 표의 형식이 회고 스크립트가 읽는 형식과 다른 것이다. 찍힌 까닭을 사용자에게 보여 주고, 칸의 일 이름은 그대로 두고 형식만 맞출지 묻는다.
   - 사용자의 답이나 확인이 남은 항목(`--check`의 어긋남, `--kinds`의 형식, `autoApplyRules` 키)이 하나라도 있으면 검증이 끝난 것이 아니다. 9번으로 가지 말고 그 확인부터 마친다. 사용자가 확인을 미루겠다고 하면 `VERSION`은 옛 값인 채로 멈추고, 다음에 이어 열면 1단계가 끊긴 업데이트로 읽는다고 알린다.
9. **키트 파일 해시 남기기와 VERSION 놓기**: 8번의 검증이 모두 끝나 남은 확인이 없을 때만 한다. 먼저 새로 놓은 스크립트로 `node "$HOME/.claude/subagent-system/scripts/subagent-retro.js" --record-kit-hashes`를 돌려(`CLAUDE_CONFIG_DIR`을 쓰는 컴퓨터는 `$HOME/.claude`를 그 폴더로 바꿔 넣는다) 3번과 4번에서 놓은 파일의 해시를 `kitFileHashes`에 새로 쓴다. 이 키는 업데이트가 새로 쓰므로 지난 업데이트의 기록은 3번에서 읽은 것으로 끝난다. 이어 키트의 `VERSION`을 `~/.claude/subagent-system/VERSION`으로 복사하고, `cat`이 키트의 `VERSION`과 같은 값을 찍는지 본다(「6. 확인」 8번과 같다). 해시를 맨 끝에 남기는 것은 중간에 끊긴 업데이트를 이어 할 때 3번이 같은 옛 기록을 읽게 하려는 것이다.
10. **안내**: 9번에서 `VERSION`을 놓은 뒤에 한다. 확인이 남은 채로 재시작을 청하지 않는다. 이미 있던 `~/.claude/agents/`의 정의 수정은 몇 초 안에 읽히지만(공식 문서 https://code.claude.com/docs/en/sub-agents) 새 정의 폴더나 `--add-dir` 폴더는 재시작이 필요하다. `/retro` 스킬은 `~/.claude/skills/` 폴더가 이 세션을 시작할 때 있었으면 바로 읽히고, 없었으면 `/reload-skills`나 새 세션이 필요하다. 사용자에게 `/<이름>`(기본 `/retro`)을 입력해 상태가 뜨는지 봐 달라고 하고, 「Shell command permission check failed」가 나오면 「6. 확인」 12번처럼 처리한다(그때 바꾼 `SKILL.md`의 해시는 12번대로 `--record-kit-hashes`를 다시 돌려 남긴다). 이미 열려 있던 세션의 메인은 옛 `SUBAGENT_GUIDE.md`와 옛 규칙으로 움직이므로, 새 세션을 열어 문서를 다시 읽게 하라고 사용자에게 알린다. 7번에서 agent-meter를 새로 깔았거나 예전 방식에서 옮겼으면(5-2단계 3번이 오류 갈래였으면 하지 않는다) 새 세션에서 입력창 아래에 `total … | branch … | path …` 줄과 그 아래 표가 보이는지 「6. 확인」 12번의 agent-meter 항목대로 봐 달라고 한다.
11. **바뀐 것 보여 주기**: 키트의 `CHANGES.md`에서 업데이트 전 설치본 버전보다 새 항목(`## <버전>` 머리줄로 나뉜다)을 사용자에게 보여 준다. 업데이트 전 버전은 1단계에서 읽은 값이다. 9번 뒤에 끊겨 새 대화에서 이어 하면 설치본 `VERSION`이 이미 새 값이므로, 가장 새 백업(`~/.claude/subagent-system-backup-<날짜-시각>/`, 이름에 `-retro-`가 든 것은 제외)의 `subagent-system/VERSION`에서 읽는다. 버전 항목이 하나도 없으면 보여 줄 것이 없다고 알린다.

## 체크리스트 대조

업데이트 순서 3번에서 `config.json`을 맞춘 뒤에 한다. 설치본 `~/.claude/subagent-system/docs/SUBAGENT_BRIEF_CHECKLIST.md`는 통째로 바꾸지 않고, 아래 순서의 네 가지에서 사용자가 고른 것만 더하거나 바꾸거나 지운다. 어디에도 걸리지 않은 설치본 줄은 건드리지 않는다.

**견주는 기준**
- 키트 줄은 키트의 공통 줄(`SUBAGENT_BRIEF_CHECKLIST.md`)과 `roles` 직군의 줄(키트의 `ROUTING_PRESETS.md`의 「지시문 체크리스트 기본 줄」)이다. `roles`가 빈 배열이면 공통 줄만이다. 여러 직군의 줄은 「지킬 것」 문장이 글자까지 같으면 한 줄로 본다. 뜻이 같은 줄이 둘 이상이면(3단계가 한 줄로 합쳐 넣는 줄) 그 줄들을 한 키트 묶음으로 본다.
- 다른 직군 줄은 `roles`에 없는 직군의 기본 줄 가운데 키트 줄에 같은 문장이 없는 줄이다.
- 줄은 「지킬 것」 칸으로 견준다. 「같다」는 글자까지 같은 것이고, 「뜻이 같다」는 시키는 일이 같고 표현만 다른 것이다.
- 키트 줄과 「지킬 것」 문장이 같은 설치본 줄이 있으면 그 키트 줄은 이미 들어 있는 것이라 묻지 않는다.
- 키트 묶음은 같은 절에 묶음의 줄마다 시키는 일을 모두 담은 설치본 줄(3단계가 합쳐 넣은 줄이나 그렇게 고친 줄)이 하나 있으면 이미 들어 있는 것이라 묻지 않고, 아래 「나뉜 줄」로도 보지 않는다. 합친 줄은 글자가 키트 줄 어느 것과도 달라, 이 규칙이 없으면 업데이트마다 같은 줄이 나뉜 줄로 다시 오르기 때문이다. 담기지 않은 일이 있는 줄만 「표현만 다른 줄」의 뜻이 겹치지만 더하거나 빠진 줄로 한 번 묻고, 넣지 않기로 하면 담기지 않은 키트 줄의 문장을 `checklistDeclined`에 더한다. 묶음의 키트 줄 문장이 바뀌면 글자가 달라져 위 규칙대로 다시 견준다.
- `config.json`의 `checklistDeclined`에 글자까지 같은 문장이 있는 키트 줄은 묻지 않는다(전에 넣지 않기로 한 줄). `checklistKept`에 글자까지 같은 문장이 있는 설치본 줄은 아래 「다른 직군 줄 정리」 표에 넣지 않는다(전에 두기로 한 줄). 키트가 문장을 고치면 글자가 달라지므로 새 줄로 보고 다시 묻는다.
- 답은 받을 때마다 바로 체크리스트에 반영하고, 넣지 않기로 한 키트 문장과 두기로 한 설치본 문장도 그때 `config.json`에 더한다. 대조가 중간에 끊겨도 다시 할 때 같은 질문이 되풀이되지 않게 하려는 것이다. 더하는 명령은 아래와 같다. 문장에 따옴표나 `$`, 역따옴표가 들어 있어도 셸이 풀지 않게 문장은 명령 인자가 아니라 `<<'EOF'`(따옴표를 붙여 안을 풀지 않는 입력)로 한 줄에 하나씩 넘긴다. `checklistKept`에 더할 때는 키 이름만 바꾼다.

```
<kit-setup> --add-config-lines "$HOME/.claude/subagent-system/config.json" checklistDeclined <<'EOF'
<「지킬 것」 문장>
EOF
```

**순서**: 앞에서 다룬 줄은 뒤에 다시 보이지 않는다. 보일 줄이 없으면 묻지 않고 다음으로 넘어간다.

1. **다른 직군 줄 정리**: 설치본 줄 가운데 키트 줄과는 같지도 뜻이 같지도 않고, 다른 직군 줄과 같거나 뜻이 같은 줄을 표 하나(절, 설치본 줄, 그 줄이 기본 줄인 직군)로 보여 준다. `roles`가 바뀐 경우에 생긴다.
   - 어느 직군 기본 줄과도 비슷하지 않은 줄(회고나 사용자가 더한 줄)은 이 표에 넣지 않는다. 키트 줄과도 비슷한 줄은 이 표에 넣지 않고 아래 「나뉜 줄」이나 「표현만 다른 줄」에서 다룬다.
   - 묻기 전에 업데이트 순서 1번의 백업 폴더에 `subagent-system/docs/SUBAGENT_BRIEF_CHECKLIST.md`가 있는지 본다. 끊긴 업데이트를 이어 하는 중이면 1단계 5번에서 사용자에게 알린 가장 새 백업을 본다. 없으면 이 단계를 하지 않고 그 사실을 알린다.
   - a. 모두 지움 b. 모두 둠 c. 줄마다 가운데 고르게 한다. c면 줄마다 지울지 둘지 묻는다.
   - 둔 줄은 「지킬 것」 문장을 `checklistKept`에 더한다.
2. **나뉜 줄**: 설치본 한 줄이 키트 줄 여럿과 비슷하면 그 설치본 줄과 키트 줄들을 한 묶음으로 보여 준다. 그 키트 줄들이 위 「견주는 기준」의 키트 묶음(뜻이 같아 합쳐 넣는 줄)이면 여기서 다루지 않고 그 기준을 따른다.
   - 묶음마다 a. 나눠 넣기(설치본 줄을 지우고 그 자리에 키트 줄들을 넣는다. 키트 줄의 절이 다르면 그 줄은 「절」 칸의 절에 넣는다) b. 그대로 둠(키트 줄들을 넣지 않는다) c. 둘 다 둠(설치본 줄을 두고 키트 줄들도 넣는다) 가운데 고르게 한다.
   - 묶음은 한 번에 바꾼다. 키트 줄마다 따로 「설치본 줄을 키트 문장으로 바꾼다」를 고르게 하면, 같은 설치본 줄을 두 번 바꾸며 먼저 넣은 키트 줄이 사라진다.
   - 설치본 줄의 일부가 `roles`에 없는 직군의 줄에만 해당하면, a를 고를 때 그 부분이 빠진다고 함께 알린다.
   - b를 고르면 그 키트 줄들의 문장을 `checklistDeclined`에 더한다.
3. **표현만 다른 줄**: 설치본 같은 절에 뜻이 같고 표현만 다른 줄이 있는 키트 줄을 표 하나(절, 설치본 줄, 키트 줄)로 보여 준다. 키트가 문장을 고친 줄이 여기에 온다. a. 모두 키트 문장으로(설치본 줄 자리에 키트 문장을 넣는다) b. 모두 그대로 c. 줄마다 가운데 고르게 한다. 그대로 둔 키트 줄의 문장은 `checklistDeclined`에 더한다.
   - 뜻이 겹치지만 시키는 일이 더하거나 빠진 설치본 줄이 있는 키트 줄은 이 표에 넣지 않고 줄마다 나란히 보여 준다. a. 설치본 줄을 키트 문장으로 바꾼다 b. 키트 줄을 더한다 c. 넣지 않는다 가운데 고르게 하고, c면 `checklistDeclined`에 더한다.
4. **새 줄**: 남은 키트 줄(설치본에 같은 문장도 비슷한 줄도 없는 줄)을 들어갈 절과 함께 보여 주고 줄마다 더할지 묻는다. 회고나 사용자가 일부러 지운 줄일 수도 있다고 함께 알린다. 넣지 않는다고 하면 `checklistDeclined`에 더한다.

넣는 자리는 3단계의 체크리스트 규칙과 같다. 「절」 칸이 가리키는 절의 표 끝에 「지킬 것」과 「이유」 두 칸으로 넣고, 그 절이 없으면 문서 끝에 같은 이름의 절과 표 머리줄(`| 지킬 것 | 이유 |`, `|:---|:---|`)을 만든다.

네 가지를 마치면 `config.json`의 `checklistSyncedVersion`에 키트 `VERSION` 값을 쓴다. 보일 줄이 하나도 없었어도 쓴다. 대조는 이 값과 상관없이 다시 해도 이미 답한 줄은 묻지 않는다.

```
<kit-setup> --checklist-synced "$HOME/.claude/subagent-system/config.json" "<키트>/subagent-system/VERSION"
```

## 규칙 바로 고치기 질문

업데이트 순서 3번에서 `config.json`을 맞춘 뒤, 8번 검증 전에 한다. 번호가 달린 다른 단계를 건너뛰거나 해당하지 않아도(예: git 확인 목록이 없는 설치본) 이 질문은 빠지지 않는다. 키가 없는 설치본은 참으로 읽혀, 답하기 전에 규칙이 고쳐지기 때문이다.

설치본 `config.json`에 `autoApplyRules` 키가 있으면 묻지 않는다. 없으면 Q6과 같은 질문을 한 번 한다(번호는 달지 않는다). 같은 메시지에 Q6의 보기(무엇이 바로 바뀌고 무엇은 계속 묻는지)를 보이고, 답을 5-2단계의 값 쓰기와 같은 `<kit-setup> --config-set "$HOME/.claude/subagent-system/config.json" autoApplyRules <true 또는 false>`로 남긴다.

## 업데이트 뒤 보고

「Q. 사용자에게 물을 것」의 「보고 형식」으로 보고하되(메인 설정 처리는 위 「7. 보고」와 같다. **쓰는 법**은 처음 설치 보고에만 둔다), 아래를 더 정한다.
- **결정할 것**: 업데이트 중 답을 받지 못해 남은 질문이 있으면 그것.
- **알아 둘 것**: 아래만 쓴다. 만들거나 고친 파일 목록, 체크리스트와 git 확인 목록에 더하거나 바꾼 줄, `rates.json` 변경, `kitFileHashes` 갱신, 11번에서 이미 보여 준 새 항목은 쓰지 않고 사용자가 물으면 답한다.
  - 업데이트 전후의 `VERSION`, 백업 폴더 위치(고친 것이 있을 때)
  - 손으로 고친 파일로 가려 보여 키트 것으로 바꾸지 않은 것과 옮긴 줄(해시 기록이 없어 가리지 못했으면 그 사실), 키트 문장을 가리키는 줄을 점검해 고치거나 지운 것
  - 묻고 거절해 남은 기록(`checklistDeclined`, `gitAskDeclined`, `agentMeterDeclined`, `goalMethodDeclined`)으로 빠진 기능
  - agent-meter 처리 가운데 사용자가 알아야 하는 것: 조직 설정으로 깔지 못한 까닭, statusLine 정리 선택지와 `statusLineCleanup` 값, 예전 방식에서 옮겼으면 그 사실과 백업 경로(`settings.json.bak-agent-meter-*`, `~/.claude/agent-meter-backup-*`), keep-alive 값과 바꾸는 법(Claude Code 안에서 `/config`의 agent-meter 줄), 바꾼 값은 다시 열어야 적용된다는 것
  - 새로 깔았거나 옮겼으면 새 세션에서 확인해 달라고 청한 것(이 세션에서는 `미확인`), `미확인`과 어디까지 봤는지

---

# 제거

사용자가 지워 달라고 하면 이 절을 따른다. 지울 대상은 서브에이전트 체계, agent-meter, 둘 다 가운데 하나다. 사용자 요청에 대상이 이미 들어 있으면 다시 묻지 않고 그대로 따르고, 없으면 먼저 묻는다. 「Q. 사용자에게 물을 것」의 「묻는 방법」을 따른다. 지우는 단계마다 무엇이 지워지고 무엇이 남는지 보이고 묻는다. 이 문서의 `~/.claude`는 `CLAUDE_CONFIG_DIR`이 있으면 그 폴더로 바꿔 읽는다.

## 지킬 규칙

- 삭제와 설정 변경은 단계마다 무엇을 어떻게 바꾸는지 보여 주고 사용자 확인을 받은 뒤 한다. 한 단계의 승인을 다음 단계로 넓히지 않는다.
- `settings.json`과 `CLAUDE.md`는 고치기 전에 같은 폴더에 `<파일 이름>.bak-remove-<YYYYMMDD-HHMMSS>`로 복사하고 경로를 알린다. 같은 이름이 있으면 덮어쓰지 않고 `-1`, `-2`를 붙인다. 아래는 `settings.json`용이다. `CLAUDE.md`는 파일 인자만 바꾼다.

  ```
  <kit-setup> --backup-file "$HOME/.claude/settings.json" remove
  ```

- 고친 `settings.json`은 「6. 확인」 1번의 JSON 확인 명령으로 읽어 본다.
- 파일과 폴더는 지울 경로 목록을 먼저 보여 주고 확인을 받은 뒤 지운다. 목록에 없는 것은 지우지 않는다.
- 이 키트 폴더는 건드리지 않는다. 커밋하지 않는다.
- 명령은 Git Bash(Windows) 또는 터미널(macOS, 리눅스)에서 실행한다.

## 서브에이전트 체계 제거

먼저 깔린 것을 확인해 보여 준다. `settings.json`의 SubagentStop 훅과 (옛 버전이 놓은 SessionStart 훅이 남아 있으면) 그 훅, `~/.claude/agents/`의 정의 10개, `/retro` 스킬(`~/.claude/skills/<이름>/`), `~/.claude/subagent-system/`, `CLAUDE.md`의 표시 주석, 백업 폴더(`ls -d ~/.claude/subagent-system-backup-*`)다. 아래는 순서대로 진행한다.

1. **훅**: `~/.claude/settings.json`의 `hooks.SubagentStop`에서 명령에 `subagent-system/scripts/subagent-usage.js`가 든 항목만, 옛 버전이 놓은 SessionStart 훅이 남아 있으면 `hooks.SessionStart`에서 명령에 `subagent-system/scripts/subagent-retro.js`와 `--session-start`가 든 항목만 뺀다. 다른 훅(사용자의 다른 SessionStart 훅 포함)은 그대로 둔다. 빼는 단위는 `matcher` 묶음이 아니라 묶음 안의 명령 하나(`{"type", "command"}`)다. 사용자가 이 키트의 묶음 안에 자기 명령을 더해 두었을 수 있기 때문이다. 명령을 뺀 묶음의 `hooks`가 비면 그 묶음을, 이벤트 배열이 비면 그 이벤트 키를, 마지막에 `hooks`가 비면 `hooks` 키를 지운다. 빼기는 아래 명령으로 하고 Claude가 `settings.json`을 통째로 다시 쓰지 않는다(파일 권한도 지킨다). 빼기 전에 뺄 명령을 보여 주고 확인을 받는다. 현재 프로젝트의 `.claude/settings.json`에 같은 명령이 있으면 보여 주고 지울지 묻는다.

   ```
   <kit-setup> --remove-hooks "$HOME/.claude/settings.json" SubagentStop SessionStart
   ```

   - 「6. 확인」 12번의 대비책으로 `permissions.allow`에 `subagent-system/scripts/subagent-retro.js`가 든 `Bash(node ...)` 규칙을 더했다면, 그 규칙만 뺄지 묻는다. 다른 allow 규칙은 그대로 둔다.
   - 「5. 함께 넣는 것」에서 `extras/git-permissions.json`의 권한을 넣었다면(`permissions.ask`에 그 파일의 항목이 있다면), 넣은 규칙만 뺄지 묻는다. 그 항목이 설치 전부터 있었는지는 백업의 `settings.json`과 비교해 보여 준다. 설치 전부터 있던 항목은 빼지 않는다. 빼고 나서 `permissions.ask`가 비면 그 키를, `permissions`가 비면 `permissions` 키를 지운다.
2. **정의 10개**: 지울 `~/.claude/agents/<정의>.md` 목록(haiku-low, haiku-medium, haiku-high, sonnet-low, sonnet-medium, sonnet-high, opus-low, opus-medium, opus-high, opus-xhigh)을 보여 주고 확인을 받아 지운다. 5단계에서 더한 정의의 글쓰기 줄은 정의 파일과 함께 지워진다. 정의는 두고 그 줄만 빼려면 `extras/DEFINITION_WRITING_LINE.md`의 「빼는 법」을 따른다. `CLAUDE.md`의 메인용 줄은 아래 4번에서 다룬다.
   - 백업 폴더가 있으면(이름에 `-retro-`가 든 회고 백업은 키트가 놓은 정의를 담고 있어 설치 전 원본이 아니므로 뺀다) `<백업>/agents/`에서 같은 이름의 원본을 찾아, 되돌릴지 정의마다 묻고 되돌린다. 백업이 여러 개면 목록을 보여 주고 어느 것이 설치 전 원본인지 사용자와 정한다. 가장 오래된 백업이 보통 설치 전이고, 업데이트 때 만든 백업의 정의는 키트가 놓은 것일 수 있다.
3. **`/retro` 스킬**: 이름은 `~/.claude/subagent-system/config.json`의 `commandName`이고, 파일이 없거나 값이 없으면 `retro`다(이 파일은 아래 5번에서 지우니 먼저 읽어 둔다). 지울 경로 `~/.claude/skills/<이름>/`(안의 `SKILL.md` 하나)를 보여 주고 확인을 받아 지운다. 그 폴더의 `SKILL.md`에 `subagent-retro.js`가 들어 있는지 먼저 확인하고, 없으면 사용자가 따로 만든 같은 이름의 스킬이니 지우지 말고 보여 준다.
4. **CLAUDE.md**: `~/.claude/CLAUDE.md`에서 `<!-- subagent-system 시작 -->`부터 `<!-- subagent-system 끝 -->`까지(표시 줄 포함)를 지울 범위로 보여 주고 확인을 받아 지운다.
   - extras 규칙을 넣었으면 `<!-- claude-setup-kit extras 시작 -->`부터 `끝`까지는 따로 묻는다. 사용자가 늘 지키는 규칙으로 계속 쓰고 싶을 수 있다. 글쓰기 줄(c)의 메인용 줄과 목표와 방법(e)의 절도 이 구역 안에 있으니, 구역 전체를 지울지 일부만 지울지 묻고 구역 안 내용을 보여 준다.
   - 표시가 없으면 줄을 마음대로 고르지 않는다. 백업의 `CLAUDE.md`와 지금 파일을 비교해 늘어난 줄을 보여 주고, 사용자가 고른 줄만 지운다.
   - 표시 밖에서 고쳐 둔 사용자 줄(4단계와 5단계에서 그 자리에서 고친 줄)은 지우지 않는다. 설치 전 문장으로 되돌리고 싶으면 백업의 `CLAUDE.md`와 비교해 보여 주고 묻는다. 「구역:」 줄(두 꼴 모두)은 보여 주고 지울지 묻는다(지우는 구역에 걸린 줄은 지우자고, 남기는 extras 구역에 걸린 줄은 두자고 추천한다).
5. **`~/.claude/subagent-system/`**(`docs/`의 `RETRO.md`, `config.json`, `VERSION` 포함. `config.json`은 폴더와 함께 지운다): 지우기 전에 `records/`를 따로 묻는다. 사용 기록이 쌓여 있으면 줄 수(`node "$HOME/.claude/subagent-system/scripts/subagent-retro.js" --count`)를 함께 알린다. `records/`에는 회고 잠금(`retro.lock`), 물을 것(`retro-pending.md`), 속도 기록(`speed-log.tsv`), 고침 기록(`fixes.tsv`)도 있어 `records/`와 같이 묻고, 지우면 함께 지워지고 옮기면 함께 옮겨진다. 물을 것이 남아 있으면(`--due`의 「물을 것 N건」) 건수를 함께 알린다.
   - 지우겠다고 하면 `records/`도 함께 지운다.
   - 남기겠다고 하면 옮길 경로를 묻고, 그 경로로 `records/`를 옮긴 뒤(경로가 이미 있으면 덮어쓰지 말고 다시 묻는다) 나머지를 지운다.
   - 그 뒤 `~/.claude/subagent-system/` 폴더를 지운다. 백업 폴더(`subagent-system-backup-*`)는 이름이 달라 남는다. subagent-system을 지워도 agent-meter는 내장 요율로 돈다.
6. **백업 폴더**: 지우지 않고 위치를 알린다. `subagent-system-backup-retro-*`는 자동 회고가 표와 정의를 고치기 전에 만든 사본이라 설치 전 원본이 아니다. 지우고 싶으면 사용자가 말하도록 안내하고, 말하면 경로를 보여 주고 확인을 받아 지운다.

## agent-meter 제거

깔린 방식을 `claude plugin list --json`의 `id`(`agent-meter@claude-token-save`)와 `~/.claude/mods/agent-meter`, `env.CLAUDE_CODE_PLUGIN_DIRS`로 읽어, 있는 것만 지운다. 두 방식이 함께 있을 수 있다.

1. 마켓플레이스로 깔려 있으면 `claude plugin uninstall agent-meter@claude-token-save`를 돌린다. 저장된 옵션(`keep_alive`)과 플러그인 데이터도 마지막 범위에서 지울 때 함께 지워진다(근거 https://code.claude.com/docs/en/plugins/cli-reference 의 `plugin uninstall`). 지우기 전에 이 명령과 지워지는 것을 보이고 확인을 받는다.
2. 마켓플레이스 `claude-token-save`는 agent-meter 하나만 담고 있다. 1번을 했으면 마켓플레이스 등록도 같이 뺄지 묻는다(`claude plugin marketplace remove claude-token-save`). 빼면 `extraKnownMarketplaces`의 등록이 사라진다. 남기면 나중에 `claude plugin install agent-meter@claude-token-save`로 바로 다시 깔 수 있다.
3. 예전 방식(키트의 옛 설치 스크립트)으로 깐 흔적이 있으면 아래 셋을 한다.
   - `~/.claude/settings.json`의 `env.CLAUDE_CODE_PLUGIN_DIRS`에서 agent-meter 경로(`~/.claude/mods/agent-meter`를 풀어 쓴 절대 경로, 또는 같은 폴더를 가리키는 표기)만 뺀다. 여러 경로는 Windows에서 `;`, 그 밖에서 `:`로 이어져 있다. 다른 경로는 그대로 두고, 빼고 나서 값이 비면 `CLAUDE_CODE_PLUGIN_DIRS` 키를 지운다. 경로가 이미 없으면 지우지 않고 넘어간다.
   - 같은 `env`에 `AGENT_METER_KEEPALIVE`가 있으면 그 키를 지운다. keep-alive를 끄게 설치한 컴퓨터에만 있다. 이 키와 위 경로를 뺀 뒤에 `env`가 비면 `env` 키도 지운다. `env`에 다른 키가 남아 있으면 그대로 둔다.
   - `~/.claude/mods/agent-meter` 폴더를 지운다. 지운 뒤 `~/.claude/mods/`가 비어도 그 폴더는 그대로 둔다.
4. 예전 방식을 치울 때 만들어진 `settings.json.bak-agent-meter-<날짜-시각>` 백업과 `~/.claude/agent-meter-backup-<날짜-시각>/` 폴더는 지우지 않고 위치만 알린다. 설치 뒤 statusLine을 정리했는지(5-2단계)는 `config.json`의 `statusLineCleanup` 값과 상관없이 `.bak-statusline-` 사본(statusLine이 부르는 스크립트 옆, 사용자 설정 폴더의 `settings.json` 옆)이 있는지로 읽는다. 정리한 뒤 다시 깔면 겹침이 이미 없어 그 값이 「해당 없음」으로 바뀔 수 있어서다. 사본이 있으면 정리한 것이니 그 백업(`<스크립트 경로>.bak-statusline-<날짜-시각>`, 또는 한 줄 명령을 고쳤거나 `statusLine` 키를 지운 `settings.json.bak-statusline-<날짜-시각>`. 같은 이름이 있었으면 끝에 `-1`, `-2`가 붙는다)에서 되돌릴 수 있다고 알리고, 되돌릴지는 따로 묻는다. 사본이 여럿이면 이름 끝의 날짜-시각이 가장 이른 것(같은 시각이면 `-1`, `-2`가 없는 것)이 정리 전 원본이므로 그것으로 되돌린다. 지금 파일(또는 `statusLine` 값)이 그 사본과 같으면 정리하지 않은 것이니 되돌리기를 묻지 않는다. 나중 사본은 이미 정리된 파일이거나 같은 원본의 사본이다.
   - 스크립트 파일 백업은 그 파일을 되돌린다. 되돌리기 전에 지금 파일과 백업의 차이를 보인다. 정리로 뺀 항목 말고 다른 차이가 있으면 정리 뒤에 고친 것이라 덮어쓰면 사라진다고 알리고 묻는다.
   - 설정 파일 백업(`settings.json.bak-statusline-<날짜-시각>`)은 통째로 덮어쓰지 않는다. 그 뒤 바뀐 다른 설정이 사라지기 때문이다. 백업에서 `statusLine` 키만 가져와 지금 `settings.json`에 넣고(고치기 전에 「지킬 규칙」의 `.bak-remove-` 백업을 한다), 「6. 확인」 1번의 JSON 확인 명령으로 읽어 본다. 넣기 전에 지금 `statusLine` 값과 백업의 값을 나란히 보인다. 지금 값이 정리 직후 상태(`c`는 키가 없는 꼴, `a`는 백업의 값에서 겹친 항목만 뺀 꼴)와 다르면 정리 뒤에 바꾼 것이라 덮어쓰면 사라진다고 알리고 묻는다.
   - statusLine을 되돌렸으면 아래 5번에서 `statusLineCleanup`을 지운다. 되돌리지 않았으면 그 값은 둔다.
5. `~/.claude/subagent-system/config.json`에 남길 것을 맞춘다. 이 파일은 서브에이전트 체계를 지울 때 폴더째 지워지므로(위 「서브에이전트 체계 제거」 5번), 체계를 남기는 컴퓨터에서만 한다. 체계도 지우는 중이거나 `config.json`이 없으면(체계를 깔지 않았음) 이 번호는 건너뛴다.
   - agent-meter만 지웠으므로 `agentMeterDeclined`를 `true`로 남긴다. 사용자가 직접 지운 agent-meter를 다음 업데이트가 다시 권하지 않게 하려는 것이다. 설치가 끝나지 않아 `installAnswers`가 있으면 그 `q4AgentMeter`도 「답 기록」 명령으로 `false`로 고쳐 이어 하는 설치가 다시 깔지 않게 한다. 나중에 깔려면 README의 「1. agent-meter만 직접 설치」(`claude plugin install agent-meter --marketplace daum7766/claude-token-save`)로 깔면 되고, statusLine 정리는 다음 업데이트 때 `statusLineCleanup`이 없으면 묻는다고 알린다. 명령은 5-2단계 「statusLine 정리」 9번의 명령에서 마지막 두 인자를 `agentMeterDeclined`와 `'true'`로 바꾼 것이다.
   - 4번에서 statusLine을 되돌렸으면 `statusLineCleanup` 키를 지운다. statusLine을 되돌렸는데 정리했다는 기록이 남으면 실제 상태와 맞지 않기 때문이다. 명령은 `<kit-setup> --config-unset "$HOME/.claude/subagent-system/config.json" statusLineCleanup`이다.
   - 설치가 끝나지 않아 `installAnswers`가 있으면 제거를 마친 뒤 「마무리」 대신 처음 설치의 남은 확인(「6. 확인」 10번부터 12번)과 「7. 보고」를 이어 할지 묻는다. 업데이트 순서 10번의 안내까지 마친 뒤였으면 업데이트의 남은 확인(10번)과 11번, 「업데이트 뒤 보고」를 이어 할지 묻는다.

## 마무리

- 설정 파일에서 지운 훅은 보통 파일 감시가 바로 읽는다(공식 문서 https://code.claude.com/docs/en/hooks 에 「normally picked up automatically by the file watcher」라고 적혀 있다). 그래도 이미 열린 세션이 지운 정의와 플러그인 경로를 그대로 들고 있을 수 있어, 사용자에게 Claude Code를 다시 열어 달라고 말하고 새 세션에서 확인한다.
- 다시 연 뒤에 확인한다. 서브에이전트 체계는 `/agents`에 정의 10개가 안 보이고(되돌린 원본은 보인다), agent-meter는 입력창 아래 표가 사라졌다.
- 보고 형식은 「Q. 사용자에게 물을 것」의 「보고 형식」을 따른다. 「결정할 것」은 사용자가 정해야 하는 남겨 둔 것(지우지 않은 사용자 줄을 지울지, 백업 폴더를 언제 지울지)이고, 「알아 둘 것」은 되돌릴 때 필요한 경로(백업 폴더, 옮긴 `records/` 경로, `.bak-remove-*` 백업 경로)와 못 찾았거나 `미확인`인 것과 어디까지 봤는지다. 단계마다 한 일은 쓰지 않고 물으면 답한다.
