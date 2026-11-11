# 서브에이전트 체계 설치, 업데이트, 제거 안내

목표: 받는 사람의 환경(전역 `CLAUDE.md`, 직군, OS)이 달라도 받는 사람이 필요한 묶음만 골라 깔고, 더하고, 빼고, 올리고, 지울 수 있게 되는 것이다.
체계의 목표는 쓰면 쓸수록 그 사람에게 맞게 스스로 나아지는 것이다. 이 문서에 없는 것을 정해야 하면 아래 원칙으로 판단한다.

- 받는 사람의 설정과 기록을 잃지 않는다. 고치는 파일 옆에 백업이 남고, 사용자가 고친 줄은 지켜진다(스크립트와 훅은 예외로 키트 것으로 바뀌고 옆 백업을 보고 다시 넣을지 정한다).
- 바뀔 것을 먼저 보이고 사용자가 고르게 한다. 보이지 않은 것은 바꾸지 않는다.
- 끊겨도 이어 할 수 있게 한다. `install`과 `update`는 다시 돌려도 같은 결과가 나온다.

## 이 문서를 읽는 법

- 이 키트는 늘 깔리는 바닥(설치 도구, 사용자 설정 문서, 승인 창 기록, git 훅 연결)과 고르는 묶음으로 되어 있다. 이 문서는 바닥 몫이다. 묶음마다 `bundles/<묶음>/install.md`에 `## 질문`, `## 설치 뒤`, `## 확인`, `## 업데이트`, `## 빼기`, `## 개인용과 회사용 행` 절이 있고, 사용자가 고른 묶음의 해당 절만 이 문서의 같은 단계에서 `order` 차례로 읽는다. 어느 묶음을 읽을지는 `<kit-setup> bundles --json`의 `installDoc`(키트 몫)과 `localInstallDocs`(설치본에 깐 로컬 조각 몫)가 알려 준다.
- 기계 단계(파일 놓기, 3방향 병합, 훅과 `settings.json` 고치기, `config.json` 쓰기, 백업, 제거)는 `kit-setup.js`가 한다. Claude는 사용자에게 고를 것을 묻고 결과를 알린다.
- 요청에 따라 읽을 범위가 다르다. 처음 설치는 「전제 확인」부터 「설치 뒤 보고」까지, 묶음을 더하거나 빼는 일은 「묶음 더하기와 빼기」, 업데이트는 「전제 확인」과 「업데이트」, 제거는 「제거」다. 「개인용과 회사용」은 어느 요청에서나 필요할 때 찾아 읽는다.
- 이 문서는 `node "<키트>/subagent-system/scripts/kit-setup.js"`를 `<kit-setup>`으로 줄여 적고, `<키트>`는 이 문서 옆 `subagent-system/`이 든 폴더다. 설치본 스크립트가 없거나 옛 버전이어도 돌도록 키트의 것으로 돌린다.
- 하위 명령은 `install`, `add`, `remove`, `update`, `uninstall`, `set-profile`, `diff`, `sync`, `bundles`, `settings`, `settings-init`, `name-candidates`이고 낱개 플래그는 `<kit-setup> --help`가 보여 준다. 훅 장치를 잠시 끄고 켜는 `hook-off`와 `hook-on`, 설치본 경로로 키트 몫인지 로컬 몫인지 가르는 `source-of`도 있다.
- 이 문서가 쓰는 낱개 플래그는 `--config-set`, `--config-unset`, `--add-config-lines`, `--backup-file`, `--check-json`, `--remove-agent-meter`, `--move-agent-meter`다.
- 결과는 JSON으로 나온다. `--dry-run`을 붙이면 아무것도 쓰지 않고 같은 결과를 보여 준다. 오류는 메시지와 종료 코드 1이고 파일은 바뀌지 않았으니 사용자에게 보이고 멈춘다.
- 설정 폴더는 `~/.claude`이고 `CLAUDE_CONFIG_DIR`이 있으면 그 폴더다. kit-setup은 설치하는 문서 안의 경로도 그 폴더로 바꿔 놓는다. Claude가 직접 읽고 쓰는 파일은 경로를 바꿔 읽는다.
- 백업은 kit-setup이 고치는 파일 옆에 `<파일>.bak-<이름>-<날짜-시각>`으로 하나만 남긴다. 지우지 않고 지울지는 사용자가 정한다.
- 이 키트 폴더의 파일은 고치지 않고 커밋하지 않는다. 확인하지 못한 것은 `미확인`으로 적고 어디까지 봤는지 쓴다.
- 명령은 Git Bash(Windows)나 터미널(macOS, 리눅스)에서 돈다. 글롭에 맞는 파일이 없으면 bash는 `No such file`, zsh는 `no matches found`를 찍고 둘 다 파일이 없다는 뜻이다. bash 전용 표기는 쓰지 않는다.
- 설치본에는 깐 상태 기록 `subagent-system/bundles.lock.json`이 있다. 어느 묶음, 고를 항목, 조각, 훅이 깔렸는지 담고 `install`, `add`, `remove`, `update`가 다시 쓴다. 손으로 고치지 않는다. 기록이 없는 옛 설치는 `update`가 파일과 설정에서 추정해 만들고 `lock.estimated`로 알린다.
- 설치본 `subagent-system/local-bundles/<묶음>/`에 둔 로컬 조각(사용자 자신의 장치 정의)은 키트가 파일을 쓰지 않고 settings 훅 등록만 이름표(`# kit:<묶음>/<이름>`) 꼴로 맞춘다. 로컬 조각의 설치 안내는 `<조각>.install.md`에 있다.

## 묻는 방법

이 문서에서 사용자에게 묻는 모든 곳에 같은 규칙을 쓴다. 사용자는 이 키트의 말을 모르기 때문이다.

- 묻는 대상의 실제 내용을 같은 메시지에 먼저 보인다. 표를 바꾸면 표 전체를, 규칙이나 줄을 넣으면 원문을, 설정을 고치면 JSON 조각을, 지우면 경로 목록을 보인다.
- 처음 나오는 용어는 괄호로 한 줄 풀고 한 번만 푼다. 묶음(같이 깔고 빼는 파일과 훅의 모음), 훅(정해진 때 자동으로 도는 명령)이 예다. 묶음의 용어(정의, effort, 칸, 무조건 Opus, 회고)는 그 묶음의 `install.md`가 푼다.
- 질문 목록(질문 제목)을 먼저 한 번에 보이고 질문(Q) 단위로 하나씩 묻는다. 목록을 먼저 봐야 사용자가 남은 질문 수를 알고 답이 엇갈리지 않는다. 묶음의 고를 항목처럼 여럿인 질문은 항목을 번호로 한 메시지에 모두 보이고 한 번에 고르게 한다. 고르는 기준(근거가 있을 때만 추천)이 항목마다 같아 모아 보여도 판단 근거가 줄지 않고, 사용자 왕복이 항목 수만큼 늘지 않게 하려는 것이다. 고르면 달라지는 것과 안 바뀌는 것을 적으며, 나중에 바꾸는 법을 한 줄 단다. 선택지는 a/b/c로 쓰고 추천은 맨 앞에 「(추천: 이유)」로 단다.
- 답이 없는 항목은 짐작으로 정하지 않고 그 항목만 다시 묻는다. 질문 번호는 실제로 묻는 순서대로 `Q<순번>/<전체>`로 단다.
- 마무리 보고는 첫 줄에 한 일을 한 문장으로, 이어서 「정할 것」(사용자 답이 필요한 것, 번호와 선택지), 「알아 둘 것」(실패, 위험, 되돌리기 어려운 변경, 미확인)만 쓴다. 해당이 없으면 그 구역은 쓰지 않는다.
- 정상인 것의 목록, 과정 설명, 바뀐 파일 목록은 쓰지 않고 사용자가 물으면 답한다. 같은 내용을 두 번 쓰지 않는다. 긴 보고에서 정할 것이 묻히지 않게 하려는 것이다.


## 전제 확인

처음 설치와 업데이트 모두 질문 앞에 한다. 안 맞는 전제로 질문을 다 받은 뒤 멈추는 일이 없게 하려는 것이다.

- `node -p "process.platform"`이 `win32`이면 `git --version`에 `windows`가 들어야 Git for Windows가 있다. 없으면 https://git-scm.com/download/win 설치를 안내하고 멈춘다. 설치 뒤 `claude --continue`로 이 대화를 이어 연다.
- `node --version`이 24 이상이어야 한다. 없거나 낮으면 멈추고 설치를 청한다. 키트를 시험하는 판이 24라서, 시험하지 않은 낮은 판을 약속하지 않는다.
- 환경변수는 프로젝트 `.claude/settings.local.json`의 `env`, 프로젝트 `.claude/settings.json`의 `env`, 사용자 `settings.json`의 `env`, 셸 순으로 먼저 있는 값을 쓴다. 근거 https://code.claude.com/docs/en/env-vars. 읽은 곳을 적는다. 조직 관리 설정과 `--settings` 파일의 값은 읽지 못하므로 `미확인`이다. 전제 확인의 알림은 설정을 고치지 않는다.
- 설정 파일의 `disableAllHooks`나 관리 설정의 `allowManagedHooksOnly`가 `true`이면 이 키트의 훅이 멈춰 승인 창 기록과 묶음의 훅이 돌지 않는다고 알린다. 설치는 이어 가고 바꾸지 않는다.
- 고를 묶음이 더 보는 전제(Claude Code 버전, effort 환경변수, 클라우드 모델 설정, 마켓플레이스 차단)는 그 묶음 `install.md`의 `## 질문` 앞부분에 있다. 묶음을 고른 뒤 질문 앞에 보인다.

## 처음 설치

### 1. 상태 가르기

`~/.claude/subagent-system/VERSION`으로 가른다. 기능이 있는지가 아니라 이 파일로 가려야 끊긴 설치를 놓치지 않는다.

- VERSION이 있으면 설치된 곳이다. 키트의 VERSION(이 문서 옆 `subagent-system/VERSION`)과 견줘 낮으면 「업데이트」, 같으면 「이미 이 버전」이라고 알리고 끝낸다. 높으면 `update`가 거절하니 더 새 키트를 받았는지 사용자가 확인한다.
- VERSION이 없고 `~/.claude/subagent-system/`이나 settings의 SubagentStop 훅이 있으면 처음 설치가 끊겼거나 프로젝트 저장소 안에 깔린 옛 설치다. 훅의 `scripts` 폴더가 `~/.claude/subagent-system/scripts`가 아니면 멈추고 보여 준다. 이 키트는 `~/.claude` 설치만 다룬다.
- 끊긴 설치이면 아래 질문부터 다시 하고 같은 `install`을 다시 돌려 이어 한다. 이미 놓인 파일은 그대로 두고 빠진 것만 채워진다. 앞 설치와 다른 profile을 고르면 `install`이 `set-profile`과 같은 규칙으로 옮기고 `notes`로 알리므로 그 `notes`를 보인다(「개인용과 회사용」의 권한과 보호 스위치 줄). 앞 설치가 놓았는데 이번에 고르지 않은 묶음의 파일은 키트가 놓은 그대로면 `install`이 지우고 `unchosenRemoved`로 알린다. 고쳤거나 키트가 놓지 않은 같은 이름이면 두고 `unchosenKept`로 알리므로, 그 목록을 보이고 뺄지 묻는다.
- 둘 다 없으면 처음 까는 컴퓨터다.

### 2. 질문

Q1 앞에 한 메시지로 알린다. 이 컴퓨터의 `~/.claude`에 바닥(설치 도구, 승인 창 기록 훅 `ask-log`, git 훅 연결, 설정 문서)과 고른 묶음의 파일, 훅을 깔고 `settings.json`을 고친다. 고치는 파일 옆에 백업이 남는다.
승인 창 기록 훅 `ask-log`는 바닥이라 늘 깔린다. Claude Code가 사용자에게 승인 창을 띄울 때마다 `permission-asks.jsonl`(설정 폴더, 환경 변수 `ASK_LOG_FILE`로 바꿈)에 한 줄을 남길 뿐 출력하지 않아 승인 결정에는 끼어들지 않는다. 라우팅 묶음이 있으면 회고가 그 기록으로 승인 창을 줄인다.
질문에 답하는 동안은 아무것도 바꾸지 않고, 설치 직전에 바뀔 내용을 보여 준다. 설치하는 중에도 `CLAUDE.md` 정리처럼 따로 묻는 것이 있다. 언제든 멈출 수 있다.

**Q1. 개인용과 회사용.** 「개인용과 회사용」의 표(바닥 행과 고른 묶음의 `## 개인용과 회사용 행`을 합친 것)를 그대로 보이고 고르게 한다. 답은 `--profile personal|company`가 된다. 나중에 `set-profile`로 바꾼다.
(추천: 혼자 쓰는 컴퓨터면 개인용, 승인이 필요한 팀이나 회사 컴퓨터면 회사용)

**Q2. 묶음 고르기.** `<kit-setup> bundles --json`의 묶음(`title`, `summary`, 고를 항목, 기댐)을 한 메시지에 번호로 모두 보이고 한 번에 고르게 한다(「추천대로」 또는 번호 목록으로 답). 바닥(`base`)은 고르지 않고 늘 깔린다.
- 묶음마다 무엇을 깔고 어떤 훅이 도는지 `summary`와 `uses`(다른 묶음에 기대는 부분, `without`은 그 묶음 없이 고르면 쉬는 것)를 보인다. 기대는 묶음을 안 고르면 쉬는 것을 알린다.
- 추천은 사용자 `CLAUDE.md`, 사용자가 넣은 스킬, 쌓인 사용 기록에서 근거가 있을 때만 근거와 함께 단다. 하나도 안 골라도 바닥은 돈다.
- 답은 `--bundles 이름,…`(모두는 `all`, 바닥만은 `none`)이 된다.

**Q3~. 고른 묶음의 질문.** 고른 묶음의 `install.md` `## 질문` 절을 `order` 차례로 읽고 물어 고를 항목(`--options 묶음.항목,…`, 기본값 그대로는 `default`, 없음은 `none`)과 그 묶음의 인자를 모은다. 묶음마다 질문이 없을 수 있다.

**마지막. 호칭과 선택지 받는 꼴, 답할 언어.** 사용자 설정 문서(`USER_SETTINGS.md`)의 `## 값`을 채운다. 사용 방식 줄은 `kit-setup`이 profile에서 써 넣는다.
- 호칭: `<kit-setup> name-candidates`가 내는 후보(git 사용자 이름, OS 사용자 이름, 기본 후보)와 「비워 두기」를 보이고 고르게 한다.
- 선택지 받는 꼴: 창(질문 창으로 고르기)이나 본문(a/b/c로 쓰기) 중 하나.
- 답할 언어: 기본 `ko`.
- 휴대폰 알림: 묻지 않는다. 비워 두면 사용 방식을 따라 개인용은 켬, 회사용은 끔이고, 켜고 끄려면 `--phone-notify 켬|끔|기본`(기본은 값을 비워 사용 방식을 다시 따르게 함)이다. 끔이면 결정이 생겨도 휴대폰 알림을 보내지 않고 멈춤 검사도 알림을 요구하지 않는다.
- 쓰기: `<kit-setup> settings-init --name "<호칭>" --choice 창|본문 --lang ko`. 호칭을 주면 설정의 `decisionWords`와 `personalMarkers`에도 함께 더해진다. 설정 문서를 사용자 `CLAUDE.md`가 불러오게 하는 줄은 보이고 묻고 백업한 뒤 더한다. 이미 있으면 건너뛴다. 거절하면 목적과 올릴 것의 답은 사용자 `CLAUDE.md`에 칸으로 적는다. `## 값`은 거절해도 설정 문서에 쓴다(훅이 직접 읽는다).

### 3. 설치 실행

먼저 답을 인자로 한 `--dry-run`을 돌려 결과를 보인다. 예는 아래와 같고 값은 답에 맞춘다.

```
<kit-setup> install --profile personal --bundles company,work-git --options company.rec-report --dry-run
```

`--bundles`와 `--options`는 둘 다 있어야 설치가 돈다. 사용자가 고른 답만 넣고, 고른 것이 없으면 `none`을 준다. 묻지 않고 넘어가거나 「추천대로」를 사용자 답 없이 넣지 않는다. 까닭: 고를 항목에는 시험을 지우거나 DB를 다루는 규칙처럼 회사 정책과 부딪힐 수 있는 것이 있어, 사용자가 고르지 않은 것이 깔리면 안 된다. 옛 `--rules`, `--skills`, `--hooks`는 받지 않고 새 꼴을 알리며 멈춘다.

- 보일 것은 놓일 파일 수(`counts`), 더해질 훅(`settings.hooks`의 `added`, 업데이트면 `replaced`의 원문도), `permissions.ask`에 더해질 개수(`settings.gitAsk`), 정해질 `config.json` 값(`config.changes`), 고르지 않아 안 깔리는 묶음과 항목(`unchosenBundles`, `unchosenOptions`), 끊긴 설치를 이어 하면 지울 것과 둘 것(`unchosenRemoved`, `unchosenKept`), 정의를 읽다 난 경고(`definitionWarnings`), 설정 문서의 사용 방식 줄을 맞췄는지(`userSettingsProfileLine`), 깔려 있던 로컬 조각 파일 수(`localPartFiles`), 그리고 알림(`notes`)이다. 개인용이면 `settings.gitAsk.keptCommitAsks`도 보이고 「개인용과 회사용」의 `keptCommitAsks` 줄대로 한다.
- 새로 부를 훅 스크립트가 원본에 없으면 `새 명령의 스크립트 없음`으로 멈춘다(`--dry-run`도 같다). 키트 폴더가 덜 받아졌다는 뜻이니 키트를 다시 받는다. 이때 설치 폴더는 하나도 바뀌지 않는다.
- `conflictFiles`나 `unresolvedFiles`가 있으면 같은 이름의 사용자 파일이 이미 있다는 뜻이다. 파일 목록과 「업데이트」의 충돌 처리 규칙대로 어느 쪽을 살릴지 먼저 정한다. 다른 사용자의 같은 경로 파일(예: 설정 폴더의 `hooks/` 아래)을 키트가 덮을 때는 `overwritten-modified`로 나오고 옆에 백업이 남으니 처음 설치의 dry-run에서 보이고 묻는다.
- 사용자가 진행하라고 하면 `--dry-run`만 빼고 같은 명령을 돌린다. 설정 폴더를 처음 바꾸는 순간이므로 이 확인 전에는 돌리지 않는다.
- 끝나면 `<kit-setup> --check-json "$HOME/.claude/settings.json" "$HOME/.claude/subagent-system/config.json"`이 아무것도 안 찍어야 한다(`rates.json`이 있으면 함께 준다).

### 4. 설치 뒤 Claude가 하는 일

1. 고른 묶음의 `install.md` `## 설치 뒤` 절을 `order` 차례로 한다(예: 라우팅의 표 쓰기와 agent-meter). 회사 규칙 묶음에서 목적을 모르겠다고 답했으면 그 `install.md`의 `## 알아가기 인터뷰`를 이 단계에서 한다(설정 문서가 만들어진 뒤이고, 설정 문서에 `## 알아가기 인터뷰 (진행 중)` 절이 남아 있으면 이어 한다).
2. **CLAUDE.md 정리.** 아래 「CLAUDE.md 정리」를 한다.
3. **commit-msg 연결.** 아래 「commit-msg 연결」을 안내한다.
4. **확인과 재시작.** 아래 「확인과 재시작」을 한다.

### commit-msg 연결

바닥이 `commit-msg`와 `pre-commit` 이어 부르는 장치(`subagent-system/hooks/git/`)를 늘 깐다. 이 장치는 묶음이 더한 검사 조각을 차례로 부르고 이어서 저장소 자체의 `.githooks/<훅>`을 부른다. 조각을 못 불러오거나 던지면 커밋을 막고, node가 없으면 키트 검사만 건너뛰고 저장소 자체 훅은 돈다.

- 저장소마다 `git -C <저장소 폴더> config --local core.hooksPath "$HOME/.claude/subagent-system/hooks/git"`를 걸어야 켜진다. 전역으로는 걸지 않는다. `commitCheck`가 막기일 때 결과의 `commitMsgHook.command`가 이 명령이다. `commitCheck`가 `off`인 설치는 결과에 이 명령이 없으니 위 명령을 사용자가 고른 저장소용으로 안내한다.
- 걸기 전에 그 저장소의 `git -C <저장소> config --get core.hooksPath`와 `.git/hooks`의 `.sample` 아닌 파일을 본다. 있으면 「걸면 그 훅들이 돌지 않는다」를 보이고 걸지 묻고, 이미 `core.hooksPath`가 있는 저장소에는 걸지 않기를 권한다. 제거 때 `--unset`으로 풀어도 옛 값은 돌아오지 않기 때문이다. 개인용과 회사용 모두 같다.

### CLAUDE.md 정리

처음 설치와, 업데이트 결과의 `claudeMd`에 옛 키트 구역이 남았거나 정리를 물을 때(`tidyTarget`이 참) 한다. 사용자 `CLAUDE.md`는 그 사람의 정책 문서라 개인용, 회사용 모두 고치기 전에 묻고 백업한다.

```
node "$HOME/.claude/subagent-system/scripts/claudeMdTidy.js" --model <지금 세션의 모델 ID>
```

- 출력은 파일을 쓰지 않는다. `zones`는 옛 키트 구역 표시, `zoneEdits`는 「구역:」 줄, `lines`는 줄마다 정책과 방법 후보, `loaded`는 늘 읽히는 줄 수와 정리를 물을지(`target`, `reason`), `opus55`는 Opus 5.5일 때 지울 후보, `backupPath`는 고치기 전 백업 경로다.
- 기준은 늘 읽히는 줄(`CLAUDE.md`, `@`로 불러온 파일, `paths`가 없는 `rules/`)의 합 80줄이다. 한 파일의 줄 수가 아니라 합이다. `config.json`의 `claudeMdLimitLines`로 바꾸고, 명령에 `--limit`을 주지 않으면 이 키를 읽는다.
- 정리를 물을지는 설치, 업데이트, 회고가 같은 판정(`claudeMdTidy.js`의 `claudeMdVerdict`)으로 가른다. 합이 기준을 넘고, 사용자가 정리를 마다하며 `config.json`의 `claudeMdKeptLines`에 남긴 줄 수가 없거나 그 줄 수보다 20줄 넘게 늘었을 때만 묻는다(`tidyTarget`). 까닭: 마다한 사용자에게 같은 정리가 업데이트와 회고마다 되풀이되지 않게 하려는 것이다.
- 근거는 공식 memory 문서(https://code.claude.com/docs/en/memory)다. 파일을 짧게 두라고 권하고 한 파일 200줄을 넘기면 지켜지는 정도가 떨어지며 `@`로 불러온 파일도 통째로 읽힌다고 한다.
- 모델별 권고는 Opus 5.5 글(https://claude.dev/blog/getting-the-most-out-of-opus-5-5/)에서 나온다. 지금 모델 ID에 `claude-opus-5-5`가 없으면 그 권고는 쓰지 않고 그 모델의 같은 종류 공식 글을 보라고 알린다.
- 권고 목록을 먼저 한 번에 보이고(해당 줄 위치, 줄 수, 근거 주소), 권고마다 하나씩 `권고 1/N`으로 묻는다. 줄을 줄이거나 옮기면 고친 뒤 문장 원문을 보인다.
- 줄 수가 기준을 넘는다는 것만으로는 권고가 아니다. 줄이는 방법은 아래 권고들로 묻는다.

권고 종류는 이렇다. 사용자가 고른 것만 고친다.
- 옛 키트 구역(`subagent-system`, `claude-setup-kit extras` 표시 사이)의 문장: 이제 키트 규칙 파일(`rules/kit-*.md`)로 오므로 구역을 지울지 묻는다. 정책 문장(멈추고 묻는 기준, 질문 방식, git)은 사용자 줄로 옮길지 따로 묻는다.
- 「구역:」 줄: 구역이 사라지면 뜻이 없다. 정책이면 사용자 줄로 녹이고 방법이면 규칙 파일로 옮기며 낡았으면 지운다. 구역을 남기는 경우는 구역 안 문장과 겹치는 줄만 합친다.
- 정책과 방법 가르기: 정책(목적, 우선순위, 사용자에게 올릴 것)은 `CLAUDE.md`에 둔다. 절차와 도구 사용법은 스킬로, 특정 파일에서만 필요한 규칙은 `paths`가 있는 `rules/<이름>.md`로 옮긴다. 가르지 못한 줄은 `mixed`나 `unknown`으로 묻는다.
- 늘 필요하지 않은 내용을 `@`로 불러오지 않는다. 가끔 보는 참고는 별도 문서로 빼고 `CLAUDE.md`에는 「~할 때 `<경로>`를 읽는다」 한 줄만 남긴다. `@`는 세션 시작 때 본문을 통째로 읽기 때문이다.
- 모순이거나 같은 말을 되풀이하는 줄은 합치거나 지운다. `CLAUDE.md`에 목표가 있으면 그 목표에 맞는 쪽을 근거로 권하고, 없거나 못 가르면 두 줄이 막으려는 것을 보이고 추천 없이 묻는다.
- Opus 5.5일 때만: `opus55.lines`의 「think hard」 같은 줄은 지운다. `company.rec-ambiguity`를 안 넣었으면 입력이 필요 없는 단계는 멈추지 않고 이어 가는 규칙을, `company.rec-report`를 안 넣었으면 보고 형식 규칙을 「글이 권한다」로만 보인다.

고치기 전에 `backupPath`가 가리키는 이름으로 `<kit-setup> --backup-file "$HOME/.claude/CLAUDE.md" claude-md`를 돌린다. 묻기를 마치면(전부 마다했거나 일부만 고쳤어도) `<kit-setup> claude-md-done`을 돌린다.
이 명령은 늘 읽히는 줄의 합이 아직 기준을 넘으면 그 합을 `config.json`의 `claudeMdKeptLines`에 남겨 업데이트와 회고가 같은 제안을 되풀이하지 않게 하고, 이하이면 그 키를 지운다.

### 확인과 재시작

- 고른 묶음의 `install.md` `## 확인` 절을 `order` 차례로 한다.
- `<kit-setup> diff`가 `same`이 아닌 파일 없이 나오고, `hookRegistrations`(훅 등록 차이)가 비어 있다.
- 시험은 `cd "$HOME/.claude/subagent-system/scripts" && SUBAGENT_RECORDS_DIR=<임시 폴더> node --test --test-reporter=dot tests/*.test.js; echo "EXIT=$?"`로 돌려 `EXIT=0`이어야 한다. 임시 폴더를 쓰면 실제 사용 기록을 건드리지 않는다.
  - `dot`은 통과를 점 하나로 찍어 출력이 작고 실패하면 실패한 시험 이름과 오류가 끝에 나온다. 기본 출력은 시험 하나마다 한 줄이라 설치와 업데이트마다 메인 입력이 약 3만 토큰씩 늘어서다.
  - 고르지 않은 묶음의 시험은 설치본에 없다.
- 새로 놓은 정의와 스킬은 재시작으로 확실히 읽힌다. 사용자에게 Claude Code를 닫고 같은 폴더에서 `claude --continue`로 이 대화를 이어 열어 달라고 하고, 여는 대로 「이어서 진행해줘」라고 하면 된다고 알린다.

### 설치 뒤 보고

위 「묻는 방법」의 보고 형식으로 쓴다.
- **정할 것**: 고른 묶음의 `## 확인` 절이 정할 것으로 올리라고 한 것.
- **알아 둘 것**: 사용자 파일(`settings.json`, `CLAUDE.md`)을 고쳤다는 사실과 백업 옆 경로, 지우는 방법이 이 문서의 「제거」 절이라는 것. 사용자가 넣지 않았거나 조직 설정으로 못 깐 것과 그 까닭. 실패하거나 멈춘 확인, `미확인`인 것과 어디까지 봤는지도 여기에 쓴다.
- 묶음을 더하거나 빼는 법(`add`, `remove`), 설정 확인(`settings`)을 한 줄로 알린다.

## 업데이트

사용자 것은 지키고 나머지는 키트 것으로 바꾼다. `update`는 설치할 때 `subagent-system/.kit-base/`에 둔 키트 원본을 기준으로 3방향 병합해 사용자가 고친 줄과 키트가 고친 줄을 둘 다 살린다. 같은 줄을 서로 다르게 고친 곳만 충돌이다.
스크립트(`scripts/`)와 훅(`hooks/`)은 줄 병합을 하지 않는 예외라 키트 것으로 통째로 바뀌고, 사용자가 고친 것은 `overwritten-modified`로 나오며 옆에 백업이 남는다. 까닭: 코드는 줄 단위로 합치면 서로 어긋난 채 돌 수 있다.
`.kit-base`가 없는 옛 설치본은 키트 git 기록에서 설치본 VERSION과 같은 커밋의 원문을 기준본으로 쓴다. 깐 상태 기록이 없는 옛 설치본은 `update`가 기록을 추정해 만들고(`lock.estimated`) 어느 묶음과 고를 항목으로 읽었는지 보인다. 추정이 틀렸으면 `add`나 `remove`로 맞춘다.
정의의 description 줄은 설치 값이라 키트와 병합하지 않고 다시 만든다.
`update`는 로컬 조각 파일을 쓰지 않고, 깐 상태 기록의 로컬 조각 항목과 settings 훅 등록을 지킨다.

키트 원본 폴더가 있는 설치(`config.json`의 `kitSourcePath`)에는 업데이트 말고 두 명령이 더 있다. 둘 다 원본의 커밋된 HEAD를 읽는다.
- `<kit-setup> diff`는 설치본, 기준본, 원본을 파일마다 대 같음, 키트가 앞섬, 설치본만 고침(설치 값 자리 안, 밖), 둘 다 고침, 설치본에만 있음으로 보인다. 파일마다 어느 묶음의 어느 조각인지 함께 나오고, 로컬 조각은 개수만 보이며 비교하지 않는다. 훅 등록 차이와 설정 문서의 사용 방식 줄이 config와 다른 곳도 알린다. 아무것도 쓰지 않고 `--json`이 있다. 「설치본만 고침(밖)」은 원본으로 올릴 후보이고, 줄에 붙은 개인 표지는 `config.json`의 `personalMarkers`에 걸린 낱말이다.
- `<kit-setup> sync`는 키트가 놓는 파일만 원본 HEAD로 덮고 `.kit-base`를 새로 쓴다. 설치 값 자리(체크리스트의 「이 설치에서 더한 줄」, 정의 description)와 `config.json`, 라우팅 표는 건드리지 않고, 설치본 `VERSION`은 원본 HEAD의 `VERSION`으로 맞춘다(「1. 상태 가르기」가 이 파일로 업데이트 필요를 가리므로, 맞추지 않으면 최신인 설치본이 늘 업데이트 필요로 나온다). 깐 상태 기록의 키트 조각 항목과 settings 훅 등록은 원본 정의에 맞춘다. 백업 규칙은 update와 같다(git이 지키는 깨끗한 파일은 백업하지 않음). `--dry-run`이 있다. 일반 개선을 원본에 커밋한 뒤 이것으로 설치본을 맞춘다(3방향 `update`로 맞추면 개인 줄이 남거나 충돌한다).
이 설치에서 고정 파일을 원본과 다르게 커밋하면 pre-commit이 막는다. 한 번 건너뛰려면 `KIT_DRIFT_SKIP=1`을 붙여 커밋한다.

1. 전제 확인을 한다. 다른 세션이 서브에이전트를 돌리고 있으면 끝날 때까지 기다리자고 한다. 기록 파일을 여러 세션이 동시에 쓰기 때문이다.
2. `<kit-setup> update --dry-run`을 돌려 보인다. `fromVersion`에서 `toVersion` 사이 `CHANGES.md` 항목을 함께 보인다.
   파일 수(`counts`), 충돌 파일(`conflictFiles`), 사용자가 고쳐 키트 것으로 덮일 스크립트와 훅(`files`의 `overwritten-modified`), 키트에 새로 생긴 묶음과 고를 항목(`newBundles`, `newOptions`), 지워질 파일(`orphansRemoved`), 공개판처럼 묶음 일부만 든 키트라 지우지 않고 남길 파일(`orphansLeft`), 이름표 없는 사용자 훅이 아직 불러 지우지 않은 파일(`keptForUserHooks`, 그 훅을 고치거나 빼면 다음 업데이트가 지움), 바뀔 훅 등록(`settings.hooks`)을 짚는다. 남길 파일은 파일 이름 목록을 사용자에게 그대로 보이고, 쓰지 않으면 설정 폴더에서 지우면 된다고 알린다(더는 갱신되지 않는 옛 판이다). 내용은 같고 git 훅의 실행 권한만 빠졌던 파일은 `files`에 `execRestored`로 나오며 권한만 되살린 것이다. 설치본이 키트보다 새로우면 거절하고 `--allow-older`로만 덮는다.
   - `needsProfile`이 `true`이고 종료 코드가 2이면 `config.json`에 `profile`이 없는 업데이트 전 설치본이라 `update`가 파일을 하나도 바꾸지 않고 멈춘 것이다. 짐작해 채우지 않는 까닭은 「개인용과 회사용」에 있다. Q1의 표를 보이고 사용자에게 개인용인지 회사용인지 고르게 한 뒤 `<kit-setup> set-profile personal|company`를 돌리고 `update --dry-run`을 다시 돌린다. `set-profile`이 바꾸는 것은 `profile`, 이전 profile의 기본값 그대로인 `retroMode`, 회사용으로 갈 때의 `retroWriteAllow`(켜져 있으면 끄고 훅 등록도 뺌), 설정 문서의 사용 방식 줄뿐이다. 그 밖의 권한과 보호 스위치는 값이 새 profile의 기본값과 달라도 바꾸지 않고 `notes`로 알린다.
3. 사용자가 진행하라고 하면 `<kit-setup> update`를 돌린다. 고친 파일 옆에 `.bak-update-…` 백업이 남는다(그 파일이 git 저장소의 추적 파일이고 변경이 없으면 git이 되돌릴 길이라 만들지 않고, 같은 파일의 앞 백업은 휴지통으로 옮겨 가장 새것 하나만 남는다). 사용자 파일(`user-file`)은 건드리지 않았다고 `notes`로 알린다. `config.json`의 사용자 값과 고르지 않은 묶음은 건드리지 않고, 묶음의 사용자 파일을 다루는 법은 그 묶음 `install.md`의 `## 업데이트`에 있다. `permissions.ask`는 줄이지 않고, `--git-ask`를 줄 때만 없는 항목을 더한다.
4. **충돌 파일**은 `<<<<<<< 설치본`, `=======`, `>>>>>>> 새 키트` 표시가 들어 있고 고치기 전 파일이 옆에 백업돼 있다. 표시가 남은 파일은 다음 `update`가 건드리지 않는다.
   - 개인용: Claude가 충돌마다 양쪽 문장을 읽고 사용자 설정(목적)과 그 파일의 목표에 맞는 쪽으로 푼다. 둘 다 살릴 수 있으면 합친다. 푼 뒤 어느 쪽을 골랐고 왜인지 한 줄씩 알린다.
   - 회사용: 충돌마다 양쪽 원문을 같은 메시지에 보이고 사용자가 고르게 한다. 정책 문서에 걸리는 충돌은 개인용이어도 묻는다.
   - 푼 뒤 `grep -rn -e '^<<<<<<< 설치본' -e '^>>>>>>> 새 키트'`로 해당 파일에 표시가 안 남았는지 보고, `--check-json`이 필요한 JSON 파일은 읽히는지 본다.
   - **덮인 스크립트와 훅**(`overwritten-modified`)은 옆 `.bak-update-…`와 새 파일의 차이를 보이고 사용자 변경을 다시 넣을지 정한다. 개인용은 Claude가 변경의 목적을 보고 다시 넣을지 정해 알리고, 회사용은 차이를 보이고 사용자가 고르게 한다. 키트가 같은 곳을 고쳤으면 키트 것을 따르고 사용자 변경은 키트 원본에 올리거나 제안으로 둔다.
5. `update` 결과의 `notes`를 보인다. 파일을 남겼다는 알림(`orphansLeft`)과 커밋 메시지 검사가 꺼졌다는 알림은 목록과 함께 사용자에게 그대로 전한다. 옛 설정 키를 지웠다는 알림이 있으면 그대로 보이고, 무엇을 묻고 바로 고칠지는 이제 profile이 정한다고 한 줄 알린다.
6. 고른 묶음의 `install.md` `## 업데이트` 절을 `order` 차례로 한다.
7. `newBundles`와 `newOptions`가 있으면 이번 업데이트로 키트에 새로 생긴 것이니 이유와 함께 알린다. 설치 때 고르지 않은 것은 `unchosenBundles`로 따로 나오고 알리지 않는다(사용자가 물을 때만 보인다). 스크립트가 `config.json`의 `knownBundles`(설치와 업데이트 때 본 묶음 목록)에 없던 것만 새것으로 가른다. 사용자가 고르면 아래 「묶음 더하기와 빼기」로 더한다.
8. `claudeMd`에 옛 키트 구역(`kitZones`)이나 「구역:」 줄(`zoneEditLines`)이 있거나 `tidyTarget`이 참이면 「CLAUDE.md 정리」를 한다. 둘 다 아니면 하지 않는다(`tidyTarget`은 기준 `limit`과 마다한 줄 수 `keptLines`를 이미 따진 값이라 `overBy`만 보고 판정하지 않는다).
9. 재시작이 필요하다고 알리고(정의와 스킬이 바뀌었을 수 있다) 「확인과 재시작」의 검사를 한다.
10. 보고는 「묻는 방법」의 형식이다. 「정할 것」에는 충돌을 푼 선택(회사용), 새 묶음과 고를 항목, 묶음 `install.md`가 올리라고 한 것을, 「알아 둘 것」에는 `fromVersion`에서 `toVersion`으로 올랐다는 것, 풀린 충돌(개인용), 백업 경로, `미확인`을 쓴다.

## 묶음 더하기와 빼기

- 더하기: `<kit-setup> add --bundles 이름,… [--options 묶음.항목,…]`. 고를 항목을 안 주면 그 묶음의 기본 항목이 들어간다. 먼저 `--dry-run`으로 놓일 파일과 훅을 보이고, 그 묶음 `install.md`의 `## 질문`과 `## 설치 뒤`를 한다. 이미 있는 파일은 건너뛰고 결과의 `skipped`로 알린다. 건너뛴 파일 가운데 키트가 놓은 적 없는 것(기준본이 없는 같은 이름 파일)은 사용자 파일로 깐 상태 기록의 `userFiles`에 남고(결과의 `userFiles`), 이후 `update`와 `sync`는 그 파일을 병합하거나 덮지 않고 `user-file`로 알리기만 하며 `uninstall`도 두고 알린다. 그래서 `--dry-run`의 `skipped`에 사용자가 만든 같은 이름 파일이 있으면 더하기 전에 키트 판을 쓸지 묻고, 키트 판이면 그 파일을 지운 뒤 더한다(지우면 기록에서도 빠진다). 지우지 않고 두면 키트 판은 놓이지 않는다. 전에 뺄 때 보관한 설치 값(`kept-values.json`)은 되살아난다. git 확인 창은 `--git-ask`를 줄 때만 더한다.
- 빼기: `<kit-setup> remove --bundles 이름,… [--options 묶음.항목,…]`. 키트가 놓은 그대로인 파일만 지우고 고친 파일은 옆에 `.bak-remove-…`로 둔다. 설치 값(정의 description, 체크리스트 「이 설치에서 더한 줄」, `rates.json`)은 `subagent-system/kept-values.json`에 보관하고 다시 넣을 때 되살린다. 사용자 훅이 키트 파일을 부르면 그 파일은 지우지 않고 `notes`로 알린다. 결과의 `configKeysKept`(그 묶음의 설정 키는 남김)와 `recordsKept`(기록 파일은 남김)를 알린다. 묶음 `install.md`의 `## 빼기`를 읽고 그 묶음이 따로 정한 확인을 한다. 바닥은 뺄 수 없다.
- 깐 묶음과 고른 항목은 `<kit-setup> bundles`로 본다. 훅 하나만 잠시 끄거나 켜려면 `hook-off <묶음>/<이름>`, `hook-on <묶음>/<이름>`이다.
- 사용자 설정 문서의 값은 `<kit-setup> settings`로 보고(어느 곳에서 읽었는지 함께 나온다), 고치려면 `settings-init`을 다시 돌린다.

## 개인용과 회사용

`profile` 하나가 아래 판정을 모두 정하고, 판정을 따로 바꾸는 설정 키는 없다. 질문을 하나로 줄여 설치 질문이 늘지 않게 하고, 문서의 「개인용은, 회사용은」과 동작이 갈리지 않게 하려는 것이다. 따로 바꾸는 키는 `retroMode`, `retroWriteAllow`, `commitCheck`뿐이고 표에서 (키)로 적는다. 이 키들은 없으면 안전한 쪽으로 읽힌다: `retroMode`는 `ask`, `retroWriteAllow`는 허용 안 함, `commitCheck`는 검사다. `install`과 `update`가 빠진 키를 채울 때는 `retroMode`는 `profile`의 기본값이고, `retroWriteAllow`는 처음 설치의 개인용만 true이며 업데이트는 false이고, `commitCheck`는 처음 설치는 `profile`의 기본값이며 업데이트는 `block`(지금 동작을 지킴)이다.

표는 바닥 몫(아래)과 묶음 몫(고른 묶음 `install.md`의 `## 개인용과 회사용 행`)을 합친 것이다. 라우팅 묶음의 회고와 쓰기 허용 행, git 관리 묶음의 `commitCheck`와 git 확인 창 행이 묶음 쪽에 있다.

| 하는 일(키) | 개인용 | 회사용 |
|:---|:---|:---|
| 업데이트의 충돌 파일 | AI가 목표로 풀고 알림 | 양쪽을 보이고 묻기 |
| 설정 문서의 사용 방식 줄 | `set-profile`이 profile에 맞춰 씀 | `set-profile`이 profile에 맞춰 씀 |

- `config.json`에 `profile`이 없는 설치본(업데이트 전)은 회고 스크립트가 회사용으로 보고 묻는 쪽으로 동작한다. 회고 방식 값으로 profile을 짐작하지 않으며, `update`는 `profile`을 먼저 정하게 하고 멈춘다(업데이트 2단계). 까닭: 짐작한 profile 위에 `set-profile`이 겹치는 순서에서 권한 스위치가 승인 없이 켜지는 조합이 회차마다 나왔고, 회사용으로 보면 틀려도 묻는 쪽이라 비용이 작다.
- 옛 설치의 `config.json`에 이 판정을 따로 정하던 키가 남아 있으면 읽지 않으며, `update`와 `set-profile`이 지우고 `notes`로 알린다. `--config-set`도 그 키를 거절한다.
- 원칙은 「명령은 보호를 느슨하게 바꾸지 않는다」이다. 권한과 보호 스위치(`retroWriteAllow`, `commitCheck`, 이 둘이 거는 훅)는 키트의 어떤 명령(`install`, `update`, `set-profile`, `--config-unset`)도 느슨한 쪽으로 바꾸지 않는다. 푸는 것은 사용자가 답한 뒤 `--config-set`으로만 하고, `retroWriteAllow`는 그때 `settings.json`의 훅 등록도 함께 맞춘다(`--config-unset`은 훅 등록을 뺀다). 조이는 쪽은 명령이 하고 `notes`로 알린다: 회사용으로 가는 `set-profile company`와 VERSION이 없는 끊긴 설치를 다른 profile로 다시 돌린 `install`은 `retroWriteAllow`를 끄고 훅 등록을 빼며 `retroMode`를 `ask`로 한다. 개인용으로 갈 때와 `commitCheck`(사용자 커밋에 걸리는 장치)는 두고 `notes`로 알린다. 키가 없으면 위 안전한 쪽으로 본다. 까닭: 보호를 푸는 것은 사용자 승인 몫이고 조이는 것은 승인이 필요 없는데, 둘을 가르지 않고 조합마다 따로 막으면 조합 막음이 회차마다 새로 나왔다.
- 두 쪽 같은 것: 사용자 커밋에 걸리는 커밋 메시지 검사를 푸는 것은 늘 승인(사용자 작업에 걸리는 장치라서), 새 외부 모델과 유료 도구도 늘 승인(돈이 나가서). `commitCheck`가 키를 비워 둔 설치(깨진 경우)는 늘 검사다.
- 남는 키 하나만 바꾸려면 `<kit-setup> --config-set "$HOME/.claude/subagent-system/config.json" <키> <JSON 값>`이고, `set-profile`은 `retroMode`와 회사용으로 갈 때의 `retroWriteAllow`만 따라 바꾼다.
- 개인용인데 전역 `permissions.ask`에 commit, merge, rebase, push 확인이 남아 있으면 `update`와 개인용으로 가는 `set-profile`의 출력에서 `settings.gitAsk.keptCommitAsks`가 비어 있지 않게 나온다(처음부터 전역에 둔 경우와 회사용에서 바꾼 경우 모두. `set-profile`은 보기만 하고 `settings.json`을 쓰지 않는다). 그 목록을 보이고, 남기면 프로젝트별 허용이 이 확인을 이기지 못한다는 까닭(`git-work` 스킬이 깔려 있으면 그 `PROJECT_PERMISSIONS.md`)과 함께 뺄지 묻는다. 빼기로 하면 `<kit-setup> --backup-file "$HOME/.claude/settings.json" git-ask`로 백업한 뒤 고른 항목만 `permissions.ask`에서 빼고 `--check-json`으로 읽히는지 본다. 키트 스크립트는 이 항목을 빼지 않는다. 사용자 `settings.json`의 확인 창을 사용자 몰래 줄이지 않으려는 것이다.
- 어느 쪽이든 사용자 `CLAUDE.md`와 프로젝트 규칙이 먼저이고 키트 규칙은 그 아래에 놓인다.

## 제거

사용자가 지워 달라고 하면 이 절을 따른다. 지울 대상은 서브에이전트 체계 전체, 묶음 하나(「묶음 더하기와 빼기」), agent-meter 가운데 하나다. 요청에 대상이 있으면 다시 묻지 않고 없으면 먼저 묻는다. 「묻는 방법」을 따른다.
삭제와 설정 변경은 무엇이 지워지고 남는지 보이고 확인을 받은 뒤 한다. 한 단계의 승인을 다음 단계로 넓히지 않는다. 키트 폴더는 건드리지 않는다.

### 서브에이전트 체계

1. 기록을 어떻게 할지 묻는다. `records/`는 묶음이 쌓은 기록(사용 기록, 비용 기록, 회고 잠금, 속도 기록, 고침 기록 등)이 든 폴더다. `<kit-setup> where`가 찍는 경로의 파일 목록과 줄 수를 보인다.
   - a. 남긴다(`--records keep`) b. 지운다(`--records delete`) c. 다른 경로로 옮긴다(`--records <경로>`, 그 경로가 이미 있으면 거절된다).
2. `<kit-setup> uninstall --records <답> --dry-run`을 돌려 지울 것과 남길 것을 보이고 승인을 받아 `--dry-run`만 빼고 돌린다. 결과는 이렇게 읽는다.
   - `removed`: 키트가 놓은 그대로여서 지운 파일(훅, 정의, 규칙, 스킬, 스크립트, 문서).
   - `keptAsBackup`: 사용자가 고친 파일이라 지우지 않고 옆에 `.bak-uninstall-…`로 옮긴 것. 지울지는 사용자가 정한다.
   - `skippedUnknown`: 키트가 놓았는지 알 수 없는 같은 이름의 파일이라 두었다고 알린다.
   - `config.json`과 설치 값 파일(`ROUTING_TABLE.md` 등)도 `.bak-uninstall-…`로 남는다. 사용자 데이터이기 때문이다.
   - 결과의 「로컬 조각 장치 등록도 뺌」 알림과 `localHooksRemoved`는 settings의 로컬 조각 훅 등록도 뺐다는 뜻이다. 로컬 조각의 파일은 지우지 않고 `localPartFilesKept`로 알린다.
3. kit-setup이 하지 않는 것을 Claude가 묻는다.
   - 고른 묶음의 `install.md` `## 빼기` 절이 따로 정한 확인(예: git 확인 항목, agent-meter, statusLine)을 `order` 차례로 한다.
   - 고친 `settings.json`은 `--check-json`으로 읽어 본다. 현재 프로젝트의 `.claude/settings.json`에 같은 훅 명령이 있으면 보이고 지울지 묻는다.
   - 사용자 `CLAUDE.md`의 옛 키트 구역과 「구역:」 줄은 「CLAUDE.md 정리」처럼 줄을 보이고 지울지 묻는다. 표시가 없으면 줄을 마음대로 고르지 않고 사용자가 고른 줄만 지운다.
   - 정의나 스킬이 설치 전 사용자 파일을 덮은 적이 있으면 `agents/*.md.bak-install-…`가 남아 있다. 되돌릴지 파일마다 묻는다.
   - 설정 폴더의 승인 창 기록 `permission-asks.jsonl`과 사용자 설정 문서 `USER_SETTINGS.md`는 kit-setup이 지우지 않는다(`notes`에 나온다). 지울지는 사용자가 정한다.
   - commit-msg 연결을 건 저장소가 있는지 묻고, 있으면 저장소마다 `git -C <저장소> config --local --unset core.hooksPath`를 돌릴지 묻는다. 걸어 둔 채면 훅 파일이 지워져 그 저장소의 커밋 훅이 아무것도 돌지 않는다.
4. 열린 세션이 지운 정의를 들고 있을 수 있어 Claude Code를 다시 열고 새 세션에서 정의 목록에 키트 정의가 안 보이는지 확인하게 한다.

### 제거 뒤 보고

「묻는 방법」의 형식으로 쓴다. 「정할 것」에는 지우지 않고 남겨 둔 사용자 줄을 지울지, 백업 파일을 언제 지울지를 쓴다.
「알아 둘 것」에는 되돌릴 때 필요한 경로(`.bak-uninstall-…`, `.bak-remove-…`, 옮긴 `records/`)와 못 찾았거나 `미확인`인 것과 어디까지 봤는지를 쓴다. 단계마다 한 일은 쓰지 않고 물으면 답한다.
