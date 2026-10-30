# 서브에이전트 체계 설치, 업데이트, 제거 안내

목표: 받는 사람의 환경(전역 `CLAUDE.md`, 직군, OS)이 달라도 받는 사람이 서브에이전트 체계를 깔고, 올리고, 지울 수 있게 되는 것이다.
체계의 목표는 쓰면 쓸수록 그 사람에게 맞게 스스로 나아지는 것이다. 이 문서에 없는 것을 정해야 하면 아래 원칙으로 판단한다.

- 받는 사람의 설정과 기록을 잃지 않는다. 고치는 파일 옆에 백업이 남고, 사용자가 고친 줄은 지켜진다(스크립트와 훅은 예외로 키트 것으로 바뀌고 옆 백업을 보고 다시 넣을지 정한다).
- 바뀔 것을 먼저 보이고 사용자가 고르게 한다. 보이지 않은 것은 바꾸지 않는다.
- 끊겨도 이어 할 수 있게 한다. `install`과 `update`는 다시 돌려도 같은 결과가 나온다.

## 이 문서를 읽는 법

- 기계 단계(파일 놓기, 3방향 병합, 훅과 `settings.json` 고치기, `config.json` 쓰기, 백업, 제거)는 `kit-setup.js`가 한다. Claude는 사용자에게 고를 것을 묻고 결과를 알린다.
- 요청에 따라 읽을 범위가 다르다. 처음 설치는 「전제 확인」부터 「설치 뒤 보고」까지, 업데이트는 「전제 확인」과 「업데이트」(메인 설정은 「설치 뒤 보고」의 그 대목), 제거는 「제거」다. 「개인용과 회사용」은 어느 요청에서나 필요할 때 찾아 읽는다.
- 이 문서는 `node "<키트>/subagent-system/scripts/kit-setup.js"`를 `<kit-setup>`으로 줄여 적고, `<키트>`는 이 문서 옆 `subagent-system/`이 든 폴더다. 설치본 스크립트가 없거나 옛 버전이어도 돌도록 키트의 것으로 돌린다.
- 하위 명령은 `install`, `update`, `uninstall`, `set-profile`이고 낱개 플래그는 `<kit-setup> --help`가 보여 준다.
- 이 문서가 쓰는 낱개 플래그는 `--config-set`, `--config-unset`, `--add-config-lines`, `--backup-file`, `--check-json`, `--remove-agent-meter`, `--move-agent-meter`다.
- 결과는 JSON으로 나온다. `--dry-run`을 붙이면 아무것도 쓰지 않고 같은 결과를 보여 준다. 오류는 메시지와 종료 코드 1이고 파일은 바뀌지 않았으니 사용자에게 보이고 멈춘다.
- 설정 폴더는 `~/.claude`이고 `CLAUDE_CONFIG_DIR`이 있으면 그 폴더다. kit-setup은 설치하는 문서 안의 경로도 그 폴더로 바꿔 놓는다. Claude가 직접 읽고 쓰는 파일은 경로를 바꿔 읽는다.
- 백업은 kit-setup이 고치는 파일 옆에 `<파일>.bak-<이름>-<날짜-시각>`으로 하나만 남긴다. 지우지 않고 지울지는 사용자가 정한다.
- 이 키트 폴더의 파일은 고치지 않고 커밋하지 않는다. 확인하지 못한 것은 `미확인`으로 적고 어디까지 봤는지 쓴다.
- 명령은 Git Bash(Windows)나 터미널(macOS, 리눅스)에서 돈다. 글롭에 맞는 파일이 없으면 bash는 `No such file`, zsh는 `no matches found`를 찍고 둘 다 파일이 없다는 뜻이다. bash 전용 표기는 쓰지 않는다.

## 묻는 방법

이 문서에서 사용자에게 묻는 모든 곳에 같은 규칙을 쓴다. 사용자는 이 키트의 말을 모르기 때문이다.

- 묻는 대상의 실제 내용을 같은 메시지에 먼저 보인다. 표를 바꾸면 표 전체를, 규칙이나 줄을 넣으면 원문을, 설정을 고치면 JSON 조각을, 지우면 경로 목록을 보인다.
- 처음 나오는 용어는 괄호로 한 줄 풀고 한 번만 푼다. 정의(모델과 effort를 정해 둔 서브에이전트 설정 파일), effort(생각의 깊이), 칸(표에서 모델과 effort가 만나는 자리)이 예다.
- 「무조건 Opus」(작업 크기와 상관없이 가장 신중한 Opus high로 보내는 영역), 회고(쌓인 사용 기록을 보고 표를 고치는 일), 훅(정해진 때 자동으로 도는 명령)도 첫 질문에서 푼다.
- 질문 목록(Q1~Q7 제목)을 먼저 한 번에 보이고 질문(Q) 단위로 하나씩 묻는다. 목록을 먼저 봐야 사용자가 남은 질문 수를 알고 답이 엇갈리지 않는다. Q4와 Q5처럼 고를 항목이 여럿인 질문은 항목을 번호로 한 메시지에 모두 보이고 한 번에 고르게 한다. 고르는 기준(근거가 있을 때만 추천)이 항목마다 같아 모아 보여도 판단 근거가 줄지 않고, 사용자 왕복이 항목 수만큼 늘지 않게 하려는 것이다. 고르면 달라지는 것과 안 바뀌는 것을 적으며, 나중에 바꾸는 법을 한 줄 단다. 선택지는 a/b/c로 쓰고 추천은 맨 앞에 「(추천: 이유)」로 단다.
- 답이 없는 항목은 짐작으로 정하지 않고 그 항목만 다시 묻는다. 질문 번호는 실제로 묻는 순서대로 `Q<순번>/<전체>`로 단다.
- 마무리 보고는 첫 줄에 한 일을 한 문장으로, 이어서 「정할 것」(사용자 답이 필요한 것, 번호와 선택지), 「알아 둘 것」(실패, 위험, 되돌리기 어려운 변경, 미확인)만 쓴다. 해당이 없으면 그 구역은 쓰지 않는다.
- 정상인 것의 목록, 과정 설명, 바뀐 파일 목록은 쓰지 않고 사용자가 물으면 답한다. 같은 내용을 두 번 쓰지 않는다. 긴 보고에서 정할 것이 묻히지 않게 하려는 것이다.

## 전제 확인

처음 설치와 업데이트 모두 질문 앞에 한다. 안 맞는 전제로 질문을 다 받은 뒤 멈추는 일이 없게 하려는 것이다.

- `node -p "process.platform"`이 `win32`이면 `git --version`에 `windows`가 들어야 Git for Windows가 있다. 없으면 https://git-scm.com/download/win 설치를 안내하고 멈춘다. 설치 뒤 `claude --continue`로 이 대화를 이어 연다.
- `claude --version`이 2.1.293 이상이어야 한다(정의 `haiku-*`가 쓰는 Haiku 5.5의 요구 버전). 낮으면 멈추고 업데이트를 안내한다.
- 설치 방식별 명령은 `claude update`(네이티브), `brew upgrade claude-code`, `winget upgrade Anthropic.ClaudeCode`, `npm install -g @anthropic-ai/claude-code@latest`다.
- `node --version`이 24 이상이어야 한다. 없거나 낮으면 멈추고 설치를 청한다. 키트를 시험하는 판이 24라서, 시험하지 않은 낮은 판을 약속하지 않는다.
- 환경변수는 프로젝트 `.claude/settings.local.json`의 `env`, 프로젝트 `.claude/settings.json`의 `env`, 사용자 `settings.json`의 `env`, 셸 순으로 먼저 있는 값을 쓴다. 근거 https://code.claude.com/docs/en/env-vars
- 읽은 곳을 적는다. 프로젝트 파일의 값은 그 프로젝트에서 연 세션에만 적용된다. 조직 관리 설정과 `--settings` 파일의 값은 읽지 못하므로 `미확인`이다. 아래 알림은 모두 설정을 고치지 않는다.
- `CLAUDE_CODE_EFFORT_LEVEL`(정의의 effort를 덮어씀)이나 `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`(정의의 모델을 덮어씀)가 켜져 있으면(`1`, `true`, `yes`, `on`) 라우팅 표가 의도대로 안 돈다고 알린다.
- `maxEffortLevel`(effort 상한)이 설정 파일에 있으면 정의의 effort와 `/effort`가 그 값까지만 올라간다고 알린다. 파일마다 `modelSettings.<모델>`의 값이 최상위 값을 대신하고 여럿이면 가장 낮은 값이 쓰인다.
- `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_USE_FOUNDRY`, `CLAUDE_CODE_USE_ANTHROPIC_AWS` 중 하나가 켜져 있으면 알린다.
- 이때 `opus`, `sonnet`, `haiku` 별칭이 effort를 덜 지원하는 옛 모델로 풀려 같은 모델의 effort 칸이 같은 동작이 될 수 있다.
- 이때 `ANTHROPIC_DEFAULT_OPUS_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL`, `ANTHROPIC_DEFAULT_HAIKU_MODEL`로 모델을 고정할 수 있다고 안내한다.
- 고정한 ID를 Claude Code가 모르면(Foundry 배포 이름 등) `ANTHROPIC_DEFAULT_<계열>_MODEL_SUPPORTED_CAPABILITIES`에 `effort`를 적어야 effort가 켜진다.
  근거 https://code.claude.com/docs/en/model-config
- 설정 파일의 `disableAllHooks`나 관리 설정의 `allowManagedHooksOnly`가 `true`이면 이 키트의 훅, agent-meter, 사용자의 `statusLine`이 멈추고 비용이 기록되지 않아 회고도 안 돈다고 알린다. 설치는 이어 가고 바꾸지 않는다.
- 관리 설정 파일(`managed-settings.json`과 같은 폴더의 `managed-settings.d/*.json`)의 `strictKnownMarketplaces`나 `blockedMarketplaces`가 `daum7766/claude-token-save`를 막으면 agent-meter는 깔지 않는다.
- 파일로 못 읽은 서버나 MDM 값은 설치 명령의 거절로 드러난다.

## 처음 설치

### 1. 상태 가르기

`~/.claude/subagent-system/VERSION`으로 가른다. 기능이 있는지가 아니라 이 파일로 가려야 끊긴 설치를 놓치지 않는다.

- VERSION이 있으면 설치된 곳이다. 키트의 VERSION(이 문서 옆 `subagent-system/VERSION`)과 견줘 낮으면 「업데이트」, 같으면 「이미 이 버전」이라고 알리고 끝낸다. 높으면 `update`가 거절하니 더 새 키트를 받았는지 사용자가 확인한다.
- VERSION이 없고 `~/.claude/subagent-system/`이나 settings의 SubagentStop 훅이 있으면 처음 설치가 끊겼거나 프로젝트 저장소 안에 깔린 옛 설치다.
  훅의 `scripts` 폴더가 `~/.claude/subagent-system/scripts`가 아니면 멈추고 보여 준다. 이 키트는 `~/.claude` 설치만 다룬다.
- 끊긴 설치이면 아래 질문부터 다시 하고 같은 `install`을 다시 돌려 이어 한다. 이미 놓인 파일은 그대로 두고 빠진 것만 채워진다. Q1에서 앞 설치와 다른 profile을 고르면 `install`이 `set-profile`과 같은 규칙으로 옮기고 `notes`로 알리므로 그 `notes`를 보인다(「개인용과 회사용」의 권한과 보호 스위치 줄).
  앞 설치가 놓았는데 이번에 고르지 않은 규칙, 스킬, 훅은 키트가 놓은 그대로면 `install`이 지우고 `unchosenRemoved`로 알린다. 고쳤거나 키트가 놓지 않은 같은 이름이면 두고 `unchosenKept`로 알리므로, 그 목록을 보이고 뺄지 묻는다. 남은 규칙은 세션마다 읽히고 `update`가 설치된 것으로 세어서다.
- 둘 다 없으면 처음 까는 컴퓨터다. `retro` 이름이 `~/.claude/commands/retro.md`, `~/.claude/skills/retro/`, 지금 연 프로젝트, 켜진 플러그인에 이미 있으면 다른 이름을 고르게 하고 `--command-name`으로 넘긴다.

### 2. 질문

Q1 앞에 한 메시지로 알린다. 이 컴퓨터의 `~/.claude`에 정의 10개, 지침 문서, 비용 기록 스크립트, 훅을 깔고 `settings.json`을 고친다. 고치는 파일 옆에 백업이 남는다.
지시문 검사 훅 `brief-check`는 개인용과 회사용 모두 늘 깔린다. `목표:` 줄이나 결정 문서 경로가 없는 서브에이전트 지시문, 표보다 높은 정의로 보내면서 `높임:`이나 `올림:`(올려 다시 보내는 지시)이 없는 지시문을 보내기 전에 막는다.
600자 아래 지시와 haiku 정의는 통과한다. 까닭: 목표 없는 지시문은 재지시 비용을 만들고, 이는 회사용이든 개인용이든 같다.
승인 창 기록 훅 `ask-log`도 개인용과 회사용 모두 늘 깔린다. Claude Code가 사용자에게 승인 창을 띄울 때마다 `permission-asks.jsonl`(설정 폴더, 환경 변수 `ASK_LOG_FILE`로 바꿈)에 한 줄을 남길 뿐 출력하지 않아 승인 결정에는 끼어들지 않는다. 회고 쓰기 허용 훅이 허용해 창이 뜨지 않는 요청은 적지 않는다. 회고가 그 기록으로 승인 창을 줄인다.
질문에 답하는 동안은 아무것도 바꾸지 않고, 설치 직전에 바뀔 내용을 보여 준다. 설치하는 중에도 `CLAUDE.md` 정리와 statusLine 정리처럼 따로 묻는 것이 있다. 언제든 멈출 수 있다.

**Q1. 개인용과 회사용.** 「개인용과 회사용」의 표를 그대로 보이고 고르게 한다. 답은 `--profile personal|company`가 된다. 나중에 `set-profile`로 바꾼다.
(추천: 혼자 쓰는 컴퓨터면 개인용, 승인이 필요한 팀이나 회사 컴퓨터면 회사용)

**Q2. 주로 하는 일.** `docs/ROUTING_PRESETS.md`의 직군(백엔드, 프론트엔드와 앱, 데이터, 인프라와 운영, QA와 테스트, 기획과 문서)을 보기로 주고 여러 개를 골라도 된다고 알린다.
- 보기마다 그 직군 표의 Sonnet medium 칸과 Opus high 칸 일을 칸마다 최대 셋 한 줄로 붙인다. 이름만 주면 고르면 무엇이 바뀌는지 알 수 없기 때문이다.
- 추천은 사용자 `CLAUDE.md`, 사용자가 넣은 스킬의 이름과 설명, 쌓인 사용 기록에서 근거가 있을 때만 근거와 함께 단다. 프로젝트 소스는 읽지 않는다.
- 답은 `--roles 직군,…`이 된다. 하나도 안 고르면 기획과 문서 표로 시작하고 `--roles`를 생략하며 체크리스트는 공통 줄만 쓴다.

**Q3. 표와 「무조건 Opus」 확정.** Q2로 만든 표(합치는 규칙은 `ROUTING_PRESETS.md`의 「여러 직군을 고를 때 합치는 규칙」)와 직군 기본안을 합친 「무조건 Opus」 목록을 보이고 빠진 일이나 고칠 것을 받는다.
- 「무조건 Opus」는 이 사람의 모든 프로젝트에 걸리는 공통 항목의 초안이다. 프로젝트별 항목은 쓰면서 회고가 더한다. 영역을 넣으면 그 판단과 검증은 작아도 Opus high로 가 비용이 더 든다.
- 빼면 일반 표의 칸으로 가 싸지만 틀려도 알아채기 어려운 일이 싼 정의로 갈 수 있다. 더한 일은 짧은 명사구로 이름 짓고 칸은 `SUBAGENT_GUIDE.md`의 「모델과 effort 고르기」로 정한다.
- 이름에 「누락 점검」, 「영향 범위」, 「검수」가 든 일에는 `「(고정)」`을 붙이고 알린다. 정의가 있는 칸에만 넣는다. Haiku high, Opus low 칸은 내려 보기 시험 자리라 비우고 xhigh 칸에는 새 일을 넣지 않는다.
- 자료에서 찾은 후보(사용자 `CLAUDE.md`의 운영 배포나 DB 규칙 같은 것)는 근거를 붙여 보이고 넣을지는 사용자가 정한다. 후보가 없을 때만 기본안 그대로를 추천한다.

**Q4. 권장 규칙.** `<키트>/subagent-system/rules/`의 `kit-core.md`는 체계가 돌아가는 데 필요해 늘 깔린다. 나머지 여덟은 한 메시지에 번호를 붙여 모두 보이고 한 번에 고르게 하며(「추천대로」 또는 번호 목록으로 답), 선택 단위는 파일이다.
- 경로 규칙 넷: `kit-code.md`, `kit-db.md`, `kit-tests.md`, `kit-docs.md`
- 주제별 권장 규칙 넷: `kit-rec-align.md` 생각 맞추기와 반대와 결정 문서 쓰는 때, `kit-rec-ambiguity.md` 애매할 때와 이어 가기, `kit-rec-report.md` 보고 모양, `kit-rec-verify.md` 실물 확인과 규칙 부딪힘
- 규칙마다 파일의 문장 원문과 줄 끝 「까닭」을 보이고, 읽히는 때(`paths`가 있으면 그 파일을 열 때만, 없으면 늘)와 늘어나는 줄 수를 적는다. 하나도 안 넣어도 체계는 돈다.
- 추천은 근거가 있을 때만 단다. `kit-db`는 Q2에서 백엔드, 데이터, 인프라와 운영을 골랐을 때, `kit-code`는 코드 파일을 다룰 때, `kit-tests`는 시험 파일을 다룰 때(읽는 문서는 `docs/TESTING.md`), `kit-docs`는 문서(마크다운)를 다룰 때(읽는 문서는 `docs/DOC_WRITING.md`), `kit-rec-*`는 주제마다 사용자 `CLAUDE.md`에 같은 뜻의 규칙이 없을 때다.
- 답은 `--rules code,db,tests,docs,rec-align,rec-ambiguity,rec-report,rec-verify` 가운데 고른 것이 된다. 규칙이 나뉘기 전 이름 `recommended`는 `kit-rec-*` 넷 전부로 풀린다.

**Q5. 권장 스킬과 훅.** `skills/`의 `retro`는 늘 깔린다. 나머지(`backlog-priority`, `git-work`, `review-panel`)와 아래 훅은 frontmatter의 `description`을 원문으로 이유와 함께 한 메시지에 번호로 보이고 한 번에 고르게 한다(Q4와 같게 「추천대로」 또는 번호 목록으로 답). 스킬 답은 `--skills`가 된다.
- 훅은 `commit-msg`(커밋 메시지에 `왜:`와 `전제:` 줄이 없으면 막음) 하나만 고른다. 개인용은 넣는 것이 기본이고 회사용은 묻고 기본은 안 넣는다. 까닭: 개인용은 `commitCheck`가 막기이고, 회사용은 팀의 저장소에 걸린다.
- 답은 `--hooks commit-msg`가 된다. 설치 뒤에는 `add --hooks`로 더한다.
- 회사용이 `commit-msg`를 고르면 `commitCheck`가 `off`라 훅이 검사하지 않으므로, 설치 뒤 `<kit-setup> --config-set "$HOME/.claude/subagent-system/config.json" commitCheck '"block"'`도 돌린다. 고른다는 것이 막기를 바란다는 뜻이기 때문이다. 이 값은 `update`가 지키고, 개인용은 이미 `block`이라 따로 하지 않는다. 설치 결과에는 걸 명령(`commitMsgHook.command`)이 없으므로 `git -C <저장소 폴더> config --local core.hooksPath "$HOME/.claude/subagent-system/hooks/git"`을 사용자가 고른 저장소용으로 안내한다. 옛 명령의 `--hooks brief-check`는 받아서 무시하고 늘 설치됨을 알린다.
- `commit-msg`는 저장소마다 `git config --local core.hooksPath`를 걸어야 켜진다. `commitCheck`가 막기일 때 결과의 `commitMsgHook.command`를 사용자가 고른 저장소에서 돌리도록 안내만 하고 전역으로는 걸지 않는다.
- 걸기 전에 그 저장소의 `git -C <저장소> config --get core.hooksPath`와 `.git/hooks`의 `.sample` 아닌 파일을 본다. 있으면 「걸면 그 훅들이 돌지 않는다」를 보이고 걸지 묻고, 이미 `core.hooksPath`가 있는 저장소에는 걸지 않기를 권한다. 제거 때 `--unset`으로 풀어도 옛 값은 돌아오지 않기 때문이다. 개인용과 회사용 모두 같다.

**Q6. git 확인 창.** `extras/git-permissions.json`의 항목을 `settings.json`의 `permissions.ask`에 더할지 묻는다. 더하기만 하고 이미 있는 항목은 줄이지 않는다.
- 개인용은 commit, merge, rebase, push 확인이 빠진 목록이고 회사용은 전체 목록이다. 실제 개수는 아래 `--dry-run`의 `settings.gitAsk`에서 읽어 보인다.
- (추천: git 저장소에서 일하면 넣는다. 문구로 막아도 서브에이전트가 `stash`나 `reset`으로 작업 트리를 바꿀 수 있어 실행 전 확인 창이 마지막 안전장치다.) 안 넣으면 `--no-git-ask`를 붙인다.

**Q7. 목적과 올릴 것.** 키트 원칙과 규칙 파일은 사용자 `CLAUDE.md`의 「목적」과 「올릴 것」 칸을 가리킨다. 칸이 없으면 가리킬 곳이 없어 사용자에게 물을 일이 사라진다.
- 사용자 `CLAUDE.md`에 두 칸이 이미 있는지 먼저 본다. 없는 칸만 묻는다.
- 「목적」은 무엇을 위해 쓰는 설정인지 한두 문장을 사용자가 말하게 한다. 「올릴 것」은 기본안을 보이고 고르게 한다. 기본안: 돈이 나가는 결정, 되돌리기 어려운 일, 정책(API 동작, 데이터 정책, 스코프 컷), 목표만으로 못 가르는 트레이드오프. 사용자가 항목을 더하고 빼고 고쳐 쓴다.
- 「우선순위」 칸은 설치 때 묻지 않는다. 질과 비용이 처음 부딪힐 때 `SUBAGENT_GUIDE.md`의 기본 동작(질을 먼저 지키고 한 번 물어 적기)이 채운다.
- 칸과 상관없이 회고가 늘 묻는 승인 예외 둘(사용자 작업에 걸리는 장치, 문지기 풀기)도 알린다.
- 답은 설치 뒤 4번 단계의 「CLAUDE.md 정리」와 같은 때에 묻고 백업한 뒤 사용자 `CLAUDE.md`에 적는다. 칸을 안 채우면 `kit-core.md`의 기본 동작(되돌리기 어려운 일과 정책은 묻는다)만 돈다.

### 3. 설치 실행

먼저 답을 인자로 한 `--dry-run`을 돌려 결과를 보인다. 예는 아래와 같고 값은 답에 맞춘다.

```
<kit-setup> install --profile personal --rules code,rec-report --skills git-work --roles 백엔드 --dry-run
```

- 보일 것은 놓일 파일 수(`counts`), 더해질 훅(`settings.hooksAdded`, 업데이트면 훅 명령 원문도), `permissions.ask`에 더해질 개수(`settings.gitAsk`), 정해질 `config.json` 값(`config.changes`), 고르지 않아 안 깔리는 규칙, 스킬, 훅(`unchosenOptional`), 끊긴 설치를 이어 하면 지울 것과 둘 것(`unchosenRemoved`, `unchosenKept`), 그리고 알림(`notes`)이다. 회사용이 `commit-msg`를 골랐으면 `notes`에 「commitCheck가 "off"이라 ... 걸 방법은 알리지 않습니다」가 나오므로 Q5의 `commitCheck` 설정을 함께 안내한다. 개인용이면 `settings.gitAsk.keptCommitAsks`도 보이고 「개인용과 회사용」의 `keptCommitAsks` 줄대로 한다.
- `conflictFiles`나 `unresolvedFiles`가 있으면 같은 이름의 사용자 파일이 이미 있다는 뜻이다. 파일 목록과 「업데이트」의 충돌 처리 규칙대로 어느 쪽을 살릴지 먼저 정한다.
- 사용자가 진행하라고 하면 `--dry-run`만 빼고 같은 명령을 돌린다. 설정 폴더를 처음 바꾸는 순간이므로 이 확인 전에는 돌리지 않는다.
- 끝나면 `<kit-setup> --check-json "$HOME/.claude/settings.json" "$HOME/.claude/subagent-system/config.json" "$HOME/.claude/subagent-system/rates.json"`이 아무것도 안 찍어야 한다.

### 4. 설치 뒤 Claude가 하는 일

1. **표와 「무조건 Opus」 쓰기.** 설치본 `~/.claude/subagent-system/docs/ROUTING_TABLE.md`에는 키트의 예시(백엔드)가 놓였다. Q3에서 확정한 표와 목록으로 바꾸고 `키트 원본의 예시` 주석 줄을 지운다.
   업데이트는 이 파일을 덮어쓰지 않는다. 일 이름 형식은 `ROUTING_PRESETS.md`의 「표 형식」을 따른다.
2. **정의 description 맞추기.** 표에 이름을 더했거나 예시에서 바뀐 칸의 정의 `~/.claude/agents/<정의>.md` description 일 이름 나열을 표와 같게 맞춘다(꼴은 `SUBAGENT_GUIDE.md`의 「표와 무조건 Opus」).
   `node "$HOME/.claude/subagent-system/scripts/subagent-retro.js" --check`에서 아래 셋이 `없음`이어야 한다. 표에 든 이름이 정의 description에도 있어야 라우팅이 표대로 돈다.
   「정의 description과 표 칸이 다른 곳」, 「표에 칸이 있는데 정의 파일이 없는 칸」, 「removedDefs에 든 정의인데 표의 칸에 일이 있는 칸」이다.
3. **체크리스트 직군 줄.** 고른 직군의 「지시문 체크리스트 기본 줄」(`ROUTING_PRESETS.md`)을 `~/.claude/subagent-system/docs/SUBAGENT_BRIEF_CHECKLIST.md`에 더하되 자리는 그 절이 정한 대로 한다. 직군 표에는 공통 줄에 없는 줄만 있어 줄마다 뜻을 견주지 않고, 같은 문장이 이미 있으면(다시 설치하는 경우) 넣지 않는다.
4. **CLAUDE.md 정리.** 아래 「CLAUDE.md 정리」를 한다.
5. **agent-meter.** 아래 「agent-meter」를 한다. `settings.json`을 고치는 `install`이 끝난 뒤에 한다.
6. **확인과 재시작.** 아래 「확인과 재시작」을 한다.

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
- Opus 5.5일 때만: `opus55.lines`의 「think hard」 같은 줄은 지운다. `kit-rec-ambiguity`를 안 넣었으면 입력이 필요 없는 단계는 멈추지 않고 이어 가는 규칙을, `kit-rec-report`를 안 넣었으면 보고 형식 규칙을 「글이 권한다」로만 보인다.

고치기 전에 `backupPath`가 가리키는 이름으로 `<kit-setup> --backup-file "$HOME/.claude/CLAUDE.md" claude-md`를 돌린다. 묻기를 마치면(전부 마다했거나 일부만 고쳤어도) `node "$HOME/.claude/subagent-system/scripts/subagent-retro.js" --claude-md-done`을 돌린다.
이 명령은 늘 읽히는 줄의 합이 아직 기준을 넘으면 그 합을 `config.json`의 `claudeMdKeptLines`에 남겨 업데이트와 회고가 같은 제안을 되풀이하지 않게 하고, 이하이면 그 키를 지운다.

### agent-meter

입력창 아래에 모델, effort, 문맥, 토큰, 어림 비용, 프롬프트 캐시 만료까지 남은 시간을 보여 주는 플러그인이다. 늘 함께 설치하므로 묻지 않고 설치 전에 알린다. 표는 `/meter`로 켜고 끈다. 전체 설명은 `agent-meter/README.md`에 있다.
`/meter`는 토글이라 응답이 「사용량 표를 숨겼습니다.」이면 방금 껐다는 뜻이다.

- `claude plugin list --json`의 `id`에 `agent-meter@claude-token-save`가 있으면 `claude plugin marketplace update claude-token-save`와 `claude plugin update agent-meter@claude-token-save`로 갱신한다.
- 없으면 `claude plugin install agent-meter --marketplace daum7766/claude-token-save`로 깐다. 마켓플레이스 등록도 이 명령이 한다. 회사용은 끝에 `--config keep_alive=false`를 붙인다.
- 실패(종료 코드 1)이면 출력을 그대로 보이고 멈춘다. 조직 설정이 마켓플레이스 출처를 막은 거절이면 사용자에게 까닭과 체계는 agent-meter 없이 돈다는 것을 알리고 `config.json`에 `agentMeterDeclined`를 `true`로 남긴다.
- 성공이면 `claude plugin list`에서 그 항목이 `Scope: user`, `Status: ✔ enabled`인지 본다. 아니면 출력을 「알아 둘 것」에 적고 이어 간다.
- keep-alive(서브에이전트가 도는 동안 메인 캐시 만료 직전에 요청을 한 번 더 보내 만료를 늘리는 기능)는 개인용은 켜고 회사용은 끈다. 이 요청도 비용이 들고, 회사 관리 설정은 mod가 보내는 요청을 막아 「hook skipped」 경고를 되풀이해 띄우기 때문이다. 업데이트 때도 회사용이 켜져 있으면 끄고 알린다. 표와 기록 같은 나머지 기능은 그대로 둔다. 보고에 켜고 끄는 법을 적는다.
- 끄려면 `echo '{"keep_alive":"false"}' | claude plugin configure agent-meter@claude-token-save --values-stdin`이고(켜려면 `"true"`) Claude Code를 다시 열어야 적용된다. 끈 뒤에도 「hook skipped」가 나면 `claude --debug`로 어느 이벤트인지 찾아 알리고, 계속되면 `claude plugin disable agent-meter@claude-token-save`를 권한다.
- 예전 방식(`~/.claude/mods/agent-meter`나 `env.CLAUDE_CODE_PLUGIN_DIRS`의 그 폴더)이 있으면 위 설치가 `✔ enabled`로 확인된 뒤에만 치운다. 옛 `env.AGENT_METER_KEEPALIVE`가 끔이었으면 먼저 위 `configure`로 옮긴다.
- 치우는 명령은 `<kit-setup> --remove-agent-meter "$HOME/.claude/settings.json" "$HOME/.claude/mods/agent-meter"`와 `<kit-setup> --move-agent-meter "$HOME/.claude/mods/agent-meter"`다.
- 첫째는 `settings.json`에서 그 경로와 keep-alive 키만 빼고 백업을 남기며, 둘째는 폴더를 지우지 않고 `agent-meter-backup-<날짜-시각>`으로 옮긴다. 하기 전에 이 둘을 알린다.

**statusLine 정리.** statusLine은 화면에 모델이나 비용을 한 줄로 보여 주는 설정이라 agent-meter 표와 같은 정보가 두 번 보일 수 있다.
- 사용자 설정 폴더의 `settings.json`, 현재 프로젝트의 `.claude/settings.json`과 `.claude/settings.local.json`에서 `statusLine`을 읽는다. 없으면 한 줄 알리고 끝낸다.
- `command`가 가리키는 스크립트를 읽어 보여 주는 항목을 뽑고 agent-meter 항목(모델, effort, 문맥, 세션 비용, 토큰, 브랜치, 작업 폴더)과 견준 표를 보인다. 읽지 못했거나 외부 도구를 부르면 `미확인`으로 두고 b와 c만 묻는다.
- 토큰 행은 상태줄이 지금 문맥 기준이고 agent-meter는 누적이라 겹침으로 세지 않는다. 겹침이 없으면 알리고 끝낸다.
- 겹침이 있고 고칠 수 있는 것(사용자 설정 폴더의 `settings.json`에 있고 스크립트가 저장소 밖)이면 뺄 조각 원문과 함께 묻는다. 프로젝트 쪽, 저장소 안 스크립트, 플러그인이나 조직 설정의 statusLine은 알리기만 한다.
- a. (추천: 겹치는 정보는 agent-meter 표가 이미 보여 준다) 겹치는 항목만 뺀다. b. 그대로 둔다. c. `statusLine` 키를 지운다(스크립트 파일은 남음). 남는 항목이 없으면 a는 뺀다.
- a나 c를 고르면 `<kit-setup> --backup-file "<고칠 파일>" statusline`으로 백업하고 경로를 알린다. a는 스크립트를 읽어 겹치는 항목만 빼고 샘플 입력으로 돌려 본다. c는 `<kit-setup> --config-unset "$HOME/.claude/settings.json" statusLine`이다.
- 끝나면 고른 값(`"a"`, `"b"`, `"c"`)을 `<kit-setup> --config-set "$HOME/.claude/subagent-system/config.json" statusLineCleanup '"a"'`로 남겨 업데이트가 다시 묻지 않게 한다. 정리할 것이 없었으면 남기지 않는다.

### 확인과 재시작

- 위 「설치 뒤 Claude가 하는 일」 2번의 `--check` 셋이 `없음`이고, `--kinds`가 「표를 읽지 못했습니다」 없이 돈다.
- `grep -n '키트 원본의 예시' "$HOME/.claude/subagent-system/docs/ROUTING_TABLE.md"`가 비어야 한다. 남았으면 키트의 예시 표가 그대로인 것이니 위 1번으로 돌아간다.
- 시험은 `cd "$HOME/.claude/subagent-system/scripts" && SUBAGENT_RECORDS_DIR=<임시 폴더> node --test --test-reporter=dot tests/*.test.js; echo "EXIT=$?"`로 돌려 `EXIT=0`이어야 한다. 임시 폴더를 쓰면 실제 사용 기록을 건드리지 않는다.
  - `dot`은 통과를 점 하나로 찍어 출력이 작고 실패하면 실패한 시험 이름과 오류가 끝에 나온다. 기본 출력은 시험 하나마다 한 줄이라 설치와 업데이트마다 메인 입력이 약 3만 토큰씩 늘어서다.
  - 설치 때 고르지 않은 선택 훅(commit-msg)의 시험은 설치본에서 건너뛴다. 건너뛴 것은 실패가 아니다.
- 새로 놓은 정의와 스킬은 재시작으로 확실히 읽힌다. 사용자에게 Claude Code를 닫고 같은 폴더에서 `claude --continue`로 이 대화를 이어 열어 달라고 하고, 여는 대로 「이어서 진행해줘」라고 하면 된다고 알린다.
- 이어 연 세션은 정의 목록에 키트 정의가 보이는지 확인한 뒤 `haiku-low`로 짧은 일 하나(예: `ls` 결과를 세 줄로 정리)를 보낸다. 끝나면 `records/subagent-cost.tsv`에 그 에이전트 줄이 생기고 프로젝트 열이 채워졌는지 본다.
- 줄이 안 생기면 훅 명령을 터미널에서 직접 돌려 오류를 본다. 전제 확인에서 `disableAllHooks`나 `allowManagedHooksOnly`가 읽혔으면 그것이 원인 후보다.
- 그 에이전트를 사용 기록에 적고(`subagent-retro.js --log`, 인자는 `--log --help`), `/retro`를 입력해 첫 줄이 「회고 방식: …」으로 뜨는지 본다.
- 「Shell command permission check failed」가 나오면 스킬의 `allowed-tools`와 명령이 맞지 않는 것이니 출력을 보이고 사용자에게 묻는다.
- agent-meter를 깔았으면 입력창 아래에 `total … | branch … | path …` 줄과 표가 보이는지 사용자에게 묻는다. 안 보이면 조직 설정이나 `disableAllHooks` 때문일 수 있고 체계는 표 없이도 돈다.

### 설치 뒤 보고

위 「묻는 방법」의 보고 형식으로 쓴다.
- **정할 것**: 요율표에 없는 모델이 있으면 그 사실과 요율을 알려 달라는 말(없으면 `?`로 보인다). 메인 설정이 권장값이 아니면 아래 명령 셋과 「필수는 아니고 추천」이라는 말.
- **알아 둘 것**: 사용자 파일(`settings.json`, `CLAUDE.md`)을 고쳤다는 사실과 백업 옆 경로, 지우는 방법이 이 문서의 「제거」 절이라는 것. 사용자가 넣지 않았거나 조직 설정으로 못 깐 것과 그 까닭.
- 실패하거나 멈춘 확인, `✔ enabled`가 아닌 `Status`, 표가 안 보인 것, keep-alive를 끄는 법, `미확인`인 것과 어디까지 봤는지도 여기에 쓴다.
- **쓰는 법**(처음 설치 보고에만): 평소처럼 일을 시키면 메인이 표를 보고 알맞은 정의에 맡긴다. 결과가 모자라면 그렇다고 말하면 회고가 표를 고친다. 하지 않는 일은 표에서 빼 달라고 하면 된다. 상태는 `/retro`로 본다.
- 회고 건수 기준은 보고를 쓸 때 `node "$HOME/.claude/subagent-system/scripts/subagent-retro.js" --help`의 `--due` 줄에서 읽어 적는다. 개인용은 회고가 저절로 돌고 회사용은 회고할지 묻는다.

**메인 설정**은 필수가 아니고 추천이다. Claude는 설정하지 않고 값이 권장값이 아니면 위 「정할 것」에 알린다. 메인은 맡기고 확인하는 역할이라 판단이 틀려도 알아챌 신호가 없어 Opus high를 권한다.
- 권장값은 Opus 5.5(`claude-opus-5-5`), effort high, autocompact 400k에서 600k다. autocompact는 문맥이 차면 대화를 요약해 줄이는 기능이다. 문맥이 길수록 요청마다 캐시를 다시 읽는 비용과 만료 때 다시 쓰는 비용이 커지기 때문이다.
- 모델은 지금 세션의 모델 ID에서 `[1m]` 꼬리와 `-YYYYMMDD`를 뗀 이름으로 본다. ID가 `claude-`로 시작하지 않거나 `@`가 들면 판정하지 않고 「`/model` 화면에서 Opus 5.5를 고른 뒤 `/effort high`, `/autocompact 400k`」만 안내한다.
- effort는 `CLAUDE_CODE_EFFORT_LEVEL`, 사용자 `settings.json`의 `modelSettings.claude-opus-5-5.effortLevel`, 기본값 medium 순으로 읽는다.
- autocompact는 `modelSettings.claude-opus-5-5.autoCompactWindow`, 최상위 `autoCompactWindow` 순이다.
- `CLAUDE_CODE_DISABLE_1M_CONTEXT`가 켜져 있거나 `CLAUDE_CODE_AUTO_COMPACT_WINDOW`가 있거나 프로젝트 설정이 정했거나 `maxEffortLevel`이 high보다 낮으면 그 항목은 판정하지 않는다. 읽은 곳을 「알아 둘 것」에 적는다.
- 명령 셋은 권장값이 아닌 항목만 `/model claude-opus-5-5`, `/effort high`, `/autocompact 400k` 순으로 넣는다. `/effort`와 `/autocompact`는 모델마다 저장되므로 `/model`을 먼저 친다고 적는다. 모두 권장값이면 쓰지 않는다.

## 업데이트

사용자 것은 지키고 나머지는 키트 것으로 바꾼다. `update`는 설치할 때 `subagent-system/.kit-base/`에 둔 키트 원본을 기준으로 3방향 병합해 사용자가 고친 줄과 키트가 고친 줄을 둘 다 살린다. 같은 줄을 서로 다르게 고친 곳만 충돌이다.
스크립트(`scripts/`)와 훅(`hooks/`)은 줄 병합을 하지 않는 예외라 키트 것으로 통째로 바뀌고, 사용자가 고친 것은 `overwritten-modified`로 나오며 옆에 백업이 남는다. 까닭: 코드는 줄 단위로 합치면 서로 어긋난 채 돌 수 있다.
`.kit-base`가 없는 옛 설치본은 키트 git 기록에서 설치본 VERSION과 같은 커밋의 원문을 기준본으로 쓴다.

1. 전제 확인을 한다. 다른 세션이 서브에이전트를 돌리고 있으면 끝날 때까지 기다리자고 한다. 기록 파일을 여러 세션이 동시에 쓰기 때문이다.
2. `<kit-setup> update --dry-run`을 돌려 보인다. `fromVersion`에서 `toVersion` 사이 `CHANGES.md` 항목을 함께 보인다.
   파일 수(`counts`), 충돌 파일(`conflictFiles`), 사용자가 고쳐 키트 것으로 덮일 스크립트와 훅(`files`의 `overwritten-modified`), 키트에 새로 생긴 선택 항목(`newOptional`), 지워질 파일(`orphansRemoved`)을 짚는다. 설치본이 키트보다 새로우면 거절하고 `--allow-older`로만 덮는다.
   - `needsProfile`이 `true`이고 종료 코드가 2이면 `config.json`에 `profile`이 없는 업데이트 전 설치본이라 `update`가 파일을 하나도 바꾸지 않고 멈춘 것이다. 짐작해 채우지 않는 까닭은 「개인용과 회사용」에 있다.
     Q1의 표를 보이고 사용자에게 개인용인지 회사용인지 고르게 한 뒤 `<kit-setup> set-profile personal|company`를 돌리고 `update --dry-run`을 다시 돌린다. `set-profile`이 바꾸는 것은 `profile`, 이전 profile의 기본값 그대로인 `retroMode`(이전 profile이 없던 설치는 어느 profile의 기본값과든 같은 값), 회사용으로 갈 때의 `retroWriteAllow`(켜져 있으면 끄고 훅 등록도 뺌)뿐이다. 그 밖의 권한과 보호 스위치는 값이 새 profile의 기본값과 달라도 바꾸지 않고 `notes`로 알린다.
3. 사용자가 진행하라고 하면 `<kit-setup> update`를 돌린다. 고친 파일 옆에 `.bak-update-…` 백업이 남는다. 사용자 파일은 이렇게 다룬다.
   - `ROUTING_TABLE.md`, `records/`, `config.json`의 사용자 값, 고르지 않은 규칙과 스킬은 건드리지 않는다.
   - `rates.json`은 설치본 값을 지키고 키트에만 있는 모델만 더한다. 값이 다른 모델(가격이 바뀐 경우)은 모델별 차이를 보이고 묻는다.
   - 옛 설치본의 GUIDE에 있던 사용자 표와 무조건 Opus 목록은 `ROUTING_TABLE.md`로, 사용자 규칙 줄은 `docs/MIGRATED_USER_RULES.md`로 옮겨진다.
   - 그 규칙 줄은 정책이면 사용자 `CLAUDE.md`로, 방법이면 규칙 파일로 나눠 옮기고 옮긴 줄은 그 파일에서 지울지 묻는다.
   - 옛 `records/retro-pending.md`의 항목은 `docs/PROPOSALS.md`의 `## 제안` 아래로 옮겨지고 원본은 `.bak-update-…`로 남는다. 보고의 `retroPending`을 보인다.
   - 옛 `SessionStart` 훅은 빠지고 빠진 `SubagentStop` 훅이 더해진다. `permissions.ask`는 줄이지 않고, `--git-ask`를 줄 때만 없는 항목을 더한다. 개인용이면 `settings.gitAsk.keptCommitAsks`가 비어 있는지 보고 「개인용과 회사용」의 `keptCommitAsks` 줄대로 한다.
4. **충돌 파일**은 `<<<<<<< 설치본`, `=======`, `>>>>>>> 새 키트` 표시가 들어 있고 고치기 전 파일이 옆에 백업돼 있다. 표시가 남은 파일은 다음 `update`가 건드리지 않는다.
   - 개인용: Claude가 충돌마다 양쪽 문장을 읽고 사용자 `CLAUDE.md`의 목적과 그 파일의 목표에 맞는 쪽으로 푼다. 둘 다 살릴 수 있으면 합친다. 푼 뒤 어느 쪽을 골랐고 왜인지 한 줄씩 알린다.
   - 회사용: 충돌마다 양쪽 원문을 같은 메시지에 보이고 사용자가 고르게 한다. 정책 문서에 걸리는 충돌은 개인용이어도 묻는다.
   - 푼 뒤 `grep -rn -e '^<<<<<<< 설치본' -e '^>>>>>>> 새 키트'`로 해당 파일에 표시가 안 남았는지 보고, `--check-json`이 필요한 JSON 파일은 읽히는지 본다.
   - **덮인 스크립트와 훅**(`overwritten-modified`)은 옆 `.bak-update-…`와 새 파일의 차이를 보이고 사용자 변경을 다시 넣을지 정한다. 개인용은 Claude가 변경의 목적을 보고 다시 넣을지 정해 알리고, 회사용은 차이를 보이고 사용자가 고르게 한다. 키트가 같은 곳을 고쳤으면 키트 것을 따르고 사용자 변경은 키트 원본에 올리거나 제안으로 둔다.
5. `update` 결과의 `notes`를 보인다. 정의 description이 키트 것으로 바뀌었다는 알림이 있으면 옆 백업을 보고 설치본 `ROUTING_TABLE.md`에 맞게 다시 맞춘다(「설치 뒤 Claude가 하는 일」 2번). 옛 설정 키를 지웠다는 알림이 있으면 그대로 보이고, 무엇을 묻고 바로 고칠지는 이제 profile이 정한다고 한 줄 알린다.
6. `config.json`의 `retroWriteAllow`가 false이면서 이번 `update`가 그 키를 채웠으면(`config.changes`에 `retroWriteAllow: 없음 -> false`) 개인용은 켤지 묻는다. 회사용에서 `set-profile personal`로 바꾼 직후는 키가 이미 false로 있어 `update`가 채우지 않으므로, `set-profile`의 `notes`에 `retroWriteAllow는 false 그대로`가 나온 것으로 같은 질문을 한다. 까닭: 키트의 어떤 명령도 권한 스위치를 켜지 않아야 한다(「개인용과 회사용」의 권한과 보호 스위치 줄). 묻기 전에 켜져 있으면 사용자가 거절해도 켜진 채라 확인 창을 없애는 스위치가 승인 없이 켜진다.
   - 이 키가 하는 일(회고 잠금 동안 서브에이전트가 방법 파일을 쓸 때 확인 창이 뜨지 않음. 정책 문서와 권한 설정 같은 보호 목록은 늘 확인 창)을 보이고 켤지 묻는다. 켠다고 하면 `<kit-setup> --config-set "$HOME/.claude/subagent-system/config.json" retroWriteAllow true`를 돌린다. 이 명령이 settings.json의 `retro-write-allow` 훅 등록도 함께 맞추고(결과의 `hook`이 `registered`), 키트 폴더 밖의 스크립트로 돌려 `not-registered`가 나오면 키트 폴더에서 `update`를 돌려 훅을 건다. 안 켜면 회고의 쓰기마다 확인 창이 뜬다고 알린다.
   - `set-profile`은 `settings.json`에서 `retro-write-allow` 훅 등록(회사용으로 가며 쓰기 허용을 껐을 때)만 빼고 바꾸지 않는다. 빠진 git 확인 항목은 원할 때 `update --git-ask`로 더한다(더하기만 하고 줄이지 않는다). 개인용이 된 뒤 전역에 남은 commit 확인은 `update --git-ask`가 줄이지 못하므로 `settings.gitAsk.keptCommitAsks`(`update`와 개인용으로 가는 `set-profile`의 출력에 같은 이름으로 나온다)를 보고 「개인용과 회사용」의 `keptCommitAsks` 줄대로 한다.
7. `newOptional`에 규칙, 스킬, 훅이 있으면 이번 업데이트로 키트에 새로 생긴 것이니 이유와 함께 알린다. 설치 때 고르지 않은 항목은 `unchosenOptional`로 따로 나오고 알리지 않는다(사용자가 물을 때만 보인다). 스크립트가 `config.json`의 `knownOptional`(설치와 업데이트 때 본 키트의 선택 항목 목록)에 없던 것만 새것으로 가른다. 목록이 없는 옛 설치는 첫 업데이트에서 고르지 않은 항목이 모두 `unchosenOptional`로 나오고 그 업데이트가 목록을 남긴다. 사용자가 고르면 `kit-setup.js add --rules 이름,… --skills 이름,…`로 더한다(`--dry-run` 있음). 파일과 `.kit-base` 기준본을 놓고 이미 있는 파일은 건너뛴다.
8. `claudeMd`에 옛 키트 구역(`kitZones`)이나 「구역:」 줄(`zoneEditLines`)이 있거나 `tidyTarget`이 참이면 「CLAUDE.md 정리」를 한다. 둘 다 아니면 하지 않는다(`tidyTarget`은 기준 `limit`과 마다한 줄 수 `keptLines`를 이미 따진 값이라 `overBy`만 보고 판정하지 않는다).
9. agent-meter가 깔려 있으면 「agent-meter」의 갱신을 한다. 안 깔려 있고 `agentMeterDeclined`가 없으면 설치를 한 번 알리고 한다.
10. 재시작이 필요하다고 알리고(정의와 스킬이 바뀌었을 수 있다) 「확인과 재시작」의 검사를 하며 새 세션에서 `haiku-low` 시험을 한 번 한다. 「설치 뒤 보고」의 **메인 설정** 판정을 처음 설치와 같게 하고, 권장값이 아니면 11번 「정할 것」에 넣는다.
11. 보고는 「묻는 방법」의 형식이다. 「정할 것」에는 충돌을 푼 선택(회사용), 새 선택 항목, 요율 차이, 권장값이 아닌 메인 설정을, 「알아 둘 것」에는 `fromVersion`에서 `toVersion`으로 올랐다는 것, 풀린 충돌(개인용), 백업 경로, `미확인`을 쓴다.

## 개인용과 회사용

`profile` 하나가 아래 판정을 모두 정하고, 판정을 따로 바꾸는 설정 키는 없다. 질문을 하나로 줄여 설치 질문이 늘지 않게 하고, 문서의 「개인용은, 회사용은」과 동작이 갈리지 않게 하려는 것이다. 따로 바꾸는 키는 `retroMode`, `retroWriteAllow`, `commitCheck`뿐이고 표에서 (키)로 적는다. 이 키들은 없으면 안전한 쪽으로 읽힌다: `retroMode`는 `ask`, `retroWriteAllow`는 허용 안 함, `commitCheck`는 검사(`commit-msg` 훅은 키가 없을 때 검사한다). `install`과 `update`가 빠진 키를 채울 때는 `retroMode`는 `profile`의 기본값이고, `retroWriteAllow`는 처음 설치의 개인용만 true이며 업데이트는 false이고, `commitCheck`는 처음 설치는 `profile`의 기본값이며 업데이트는 `commit-msg` 훅이 깔려 있으면 `block`(지금 동작을 지킴)이고 없으면 기본값이다.

| 하는 일(키) | 개인용 | 회사용 |
|:---|:---|:---|
| 표 칸 조정과 쪼개기, 정의 description 맞추기, 규칙 문장과 체크리스트 고치기 | 근거가 있으면 바로 고치고 기록 | 「물을 것」에 모아 승인 뒤 |
| 새 스킬, 훅, 스크립트, 정의 만들기와 지우기, 바깥 자료 조사 | 바로 함 | 승인 뒤 |
| 물을 것 세기 | `- 묻기:` 줄이 있는 항목만 | 제안 목록 전부 |
| 고친 근거를 남기는 곳 | 커밋 메시지 | 최종 보고의 「하고 알린 것」 |
| 「하고 알리기」 문턱(애매할 때) | 애매하면 하고 알림 | 되돌리는 비용이 거의 없는 것만, 나머지는 묻기(kit-core가 `--status`의 「애매할 때」 줄로 읽음) |
| 회고(`retroMode`) | `auto`: 최종 보고 뒤 묻지 않고 회고 서브에이전트가 백그라운드로 돎 | `ask`: 회고할지 묻고, 하자고 하면(`/retro now` 포함) 같은 회고 서브에이전트가 돎. 메인이 직접 회고하지 않음 |
| 회고의 `~/.claude` 쓰기 허용(`retroWriteAllow`) | 처음 설치는 둠(회고 중 방법 자리 쓰기에 확인 창 없음, 훅은 처음 설치가 건다). 개인용으로 가는 `set-profile personal`은 바꾸지 않고 `notes`로 알린다. 업데이트로 키가 새로 생기면 끄고, 업데이트 6단계가 켤지 물어 `--config-set`으로 켠다(훅 등록도 그 명령이 함께 맞춤) | 두지 않음: 확인 창이 뜸. 회사용으로 가는 `set-profile company`와 다른 profile로 다시 돌린 `install`은 켜져 있으면 끄고 훅 등록도 뺀다 |
| 커밋 메시지 검사(`commitCheck`, `commit-msg` 훅을 건 저장소) | 막기 | 끔(훅을 고르면 Q5가 막기로 바꿈). `set-profile`은 어느 쪽 값도 바꾸지 않고 `notes`로 알림 |
| git 확인 창(`permissions.ask`) | commit, merge, rebase, push 확인이 빠진 목록 | 전체 목록 |
| 업데이트의 충돌 파일 | AI가 목표로 풀고 알림 | 양쪽을 보이고 묻기 |
| 거절한 git 확인 항목 | 기억하지 않음 | `gitAskDeclined`에 남겨 다시 안 더함 |

- `config.json`에 `profile`이 없는 설치본(업데이트 전)은 회고 스크립트가 회사용으로 보고 묻는 쪽으로 동작한다. 회고 방식 값으로 profile을 짐작하지 않으며, `update`는 `profile`을 먼저 정하게 하고 멈춘다(업데이트 2단계). 까닭: 짐작한 profile 위에 `set-profile`이 겹치는 순서에서 권한 스위치가 승인 없이 켜지는 조합이 회차마다 나왔고, 회사용으로 보면 틀려도 묻는 쪽이라 비용이 작다.
- 옛 설치의 `config.json`에 이 판정을 따로 정하던 키가 남아 있으면 읽지 않으며, `update`와 `set-profile`이 지우고 `notes`로 알린다. `--config-set`도 그 키를 거절한다.
- 원칙은 「명령은 보호를 느슨하게 바꾸지 않는다」이다. 권한과 보호 스위치(`retroWriteAllow`, `commitCheck`, 이 둘이 거는 훅)는 키트의 어떤 명령(`install`, `update`, `set-profile`, `--config-unset`)도 느슨한 쪽으로 바꾸지 않는다. 푸는 것은 사용자가 답한 뒤 `--config-set`으로만 하고, `retroWriteAllow`는 그때 `settings.json`의 훅 등록도 함께 맞춘다(`--config-unset`은 훅 등록을 뺀다). 조이는 쪽은 명령이 하고 `notes`로 알린다: 회사용으로 가는 `set-profile company`와 VERSION이 없는 끊긴 설치를 다른 profile로 다시 돌린 `install`은 `retroWriteAllow`를 끄고 훅 등록을 빼며 `retroMode`를 `ask`로 한다. 개인용으로 갈 때와 `commitCheck`(사용자 커밋에 걸리는 장치)는 두고 `notes`로 알린다. 키가 없으면 위 안전한 쪽으로 본다. 까닭: 보호를 푸는 것은 사용자 승인 몫이고 조이는 것은 승인이 필요 없는데, 둘을 가르지 않고 조합마다 따로 막으면 조합 막음이 회차마다 새로 나왔다.
- 두 쪽 같은 것: 사용자 커밋에 걸리는 커밋 메시지 검사 훅(`commit-msg`)을 푸는 것은 늘 승인(사용자 작업에 걸리는 장치라서), 새 외부 모델과 유료 도구도 늘 승인(돈이 나가서).
- 개인용에서 회고 쓰기 허용 훅(PermissionRequest)은 서브에이전트가 회고 잠금이 잡힌 동안 설정 폴더 아래 방법 파일을 쓸 때만 확인 창 없이 허용한다.
  확인 창 없이 쓰는 자리와 늘 확인 창이 뜨는 것은 RETRO 「권한 확인 창과 연속 실패」에 있다. 스크립트, 훅, 권한 설정, 정책 문서(`CLAUDE.md`, `docs/plan/`, `MIGRATED_USER_RULES.md`)와 권한이나 실행을 바꾸는 머리 키는 늘 확인 창이 뜬다. 설정 폴더에 기획서나 결정 문서를 두려면 `docs/plan/`에 둔다.
- 개인용은 `retroMode`가 `auto`로 시작해 `--config-set`이 다른 값을 거절한다. 묻기로 바꾸려면 `set-profile company`로 회사용으로 바꾼다.
- 회사용은 회고 방식을 `/retro auto`(회고할지 묻지 않고 백그라운드로 돎)와 `/retro ask`(묻기)로 바꾼다. 개인용은 `/retro auto`를 실패로 묻기가 된 것을 다시 켤 때만 쓴다.
- 자동 회고가 두 번 이어 실패하면 개인용도 묻기로 돌아간다. 다시 켜는 법은 `docs/RETRO.md`의 「권한 확인 창과 연속 실패」를 따른다. 사실 하나를 한 곳에 두려는 것이다.
- 거절한 git 확인 항목을 기억시키려면 줄을 입력으로 줘 `<kit-setup> --add-config-lines "$HOME/.claude/subagent-system/config.json" gitAskDeclined`를 돌린다. 개인용에서는 이 키가 지워진다.
- 남는 키 하나만 바꾸려면 `<kit-setup> --config-set "$HOME/.claude/subagent-system/config.json" <키> <JSON 값>`이고, `set-profile`은 `retroMode`와 회사용으로 갈 때의 `retroWriteAllow`만 따라 바꾼다.
- 개인용인데 전역 `permissions.ask`에 commit, merge, rebase, push 확인이 남아 있으면 `update`와 개인용으로 가는 `set-profile`의 출력에서 `settings.gitAsk.keptCommitAsks`가 비어 있지 않게 나온다(처음부터 전역에 둔 경우와 회사용에서 바꾼 경우 모두. `set-profile`은 보기만 하고 `settings.json`을 쓰지 않는다). 그 목록을 보이고, 남기면 프로젝트별 허용이 이 확인을 이기지 못한다는 까닭(`git-work` 스킬의 `PROJECT_PERMISSIONS.md`)과 함께 뺄지 묻는다. 빼기로 하면 `<kit-setup> --backup-file "$HOME/.claude/settings.json" git-ask`로 백업한 뒤 고른 항목만 `permissions.ask`에서 빼고 `--check-json`으로 읽히는지 본다. 키트 스크립트는 이 항목을 빼지 않는다. 사용자 `settings.json`의 확인 창을 사용자 몰래 줄이지 않으려는 것이다.
- 어느 쪽이든 사용자 `CLAUDE.md`와 프로젝트 규칙이 먼저이고 키트 규칙은 그 아래에 놓인다.

## 제거

사용자가 지워 달라고 하면 이 절을 따른다. 지울 대상은 서브에이전트 체계, agent-meter, 둘 다 가운데 하나다. 요청에 대상이 있으면 다시 묻지 않고 없으면 먼저 묻는다. 「묻는 방법」을 따른다.
삭제와 설정 변경은 무엇이 지워지고 남는지 보이고 확인을 받은 뒤 한다. 한 단계의 승인을 다음 단계로 넓히지 않는다. 키트 폴더는 건드리지 않는다.

### 서브에이전트 체계

1. 기록을 어떻게 할지 묻는다. `records/`는 사용 기록, 비용 기록, 회고 잠금, 속도 기록, 고침 기록이 든 폴더다. `node "$HOME/.claude/subagent-system/scripts/subagent-retro.js" --where`가 찍는 경로의 파일 목록과 줄 수를 보인다.
   - a. 남긴다(`--records keep`) b. 지운다(`--records delete`) c. 다른 경로로 옮긴다(`--records <경로>`, 그 경로가 이미 있으면 거절된다).
2. `<kit-setup> uninstall --records <답> --dry-run`을 돌려 지울 것과 남길 것을 보이고 승인을 받아 `--dry-run`만 빼고 돌린다. 결과는 이렇게 읽는다.
   - `removed`: 키트가 놓은 그대로여서 지운 파일(훅, 정의, 규칙, 스킬, 스크립트, 문서).
   - `keptAsBackup`: 사용자가 고친 파일이라 지우지 않고 옆에 `.bak-uninstall-…`로 옮긴 것. 지울지는 사용자가 정한다.
   - `skippedUnknown`: 키트가 놓았는지 알 수 없는 같은 이름의 파일이라 두었다고 알린다.
   - `config.json`, `ROUTING_TABLE.md`, `MIGRATED_USER_RULES.md`도 `.bak-uninstall-…`로 남는다. 사용자 데이터이기 때문이다.
3. kit-setup이 하지 않는 것을 Claude가 묻는다.
   - `permissions.ask`의 git 확인 항목은 설치 전부터 있었는지 알 수 없어 그대로 둔다. 설치할 때 남은 `settings.json.bak-install-…`와 견줘 키트가 더한 것만 뺄지 묻는다.
   - 빼기 전에 `<kit-setup> --backup-file "$HOME/.claude/settings.json" remove`로 백업한다.
   - 고친 `settings.json`은 `--check-json`으로 읽어 본다. 현재 프로젝트의 `.claude/settings.json`에 같은 훅 명령이 있으면 보이고 지울지 묻는다.
   - 사용자 `CLAUDE.md`의 옛 키트 구역과 「구역:」 줄은 「CLAUDE.md 정리」처럼 줄을 보이고 지울지 묻는다. 표시가 없으면 줄을 마음대로 고르지 않고 사용자가 고른 줄만 지운다.
   - 정의나 스킬이 설치 전 사용자 파일을 덮은 적이 있으면 `agents/*.md.bak-install-…`가 남아 있다. 되돌릴지 파일마다 묻는다.
   - `~/.claude/docs/PROPOSALS.md`는 kit-setup이 건드리지 않는 제안 기록이라 남긴다고 알린다.
   - 설정 폴더의 승인 창 기록 `permission-asks.jsonl`도 kit-setup이 지우지 않는다(`notes`에 나온다). 지울지는 사용자가 정한다.
   - commit-msg 훅을 건 저장소가 있는지 묻고, 있으면 저장소마다 `git -C <저장소> config --local --unset core.hooksPath`를 돌릴지 묻는다. 걸어 둔 채면 훅 파일이 지워져 그 저장소의 커밋 훅이 아무것도 돌지 않는다.
4. 열린 세션이 지운 정의를 들고 있을 수 있어 Claude Code를 다시 열고 새 세션에서 정의 목록에 키트 정의가 안 보이는지 확인하게 한다.

### agent-meter

깔린 방식을 `claude plugin list --json`의 `id`(`agent-meter@claude-token-save`), `~/.claude/mods/agent-meter`, `env.CLAUDE_CODE_PLUGIN_DIRS`로 읽어 있는 것만 지운다. 두 방식이 함께 있을 수 있다.
1. 마켓플레이스로 깔려 있으면 지울 것과 함께 보이고 승인을 받아 `claude plugin uninstall agent-meter@claude-token-save`를 돌린다. 저장된 옵션(`keep_alive`)과 플러그인 데이터도 함께 지워진다.
2. 마켓플레이스 `claude-token-save`는 agent-meter 하나만 담고 있다. 등록도 뺄지 묻는다(`claude plugin marketplace remove claude-token-save`). 남기면 나중에 `claude plugin install agent-meter@claude-token-save`로 바로 다시 깔 수 있다.
3. 예전 방식이 있으면 「agent-meter」의 `--remove-agent-meter`와 `--move-agent-meter`로 치운다.
4. statusLine을 정리했는지는 `config.json`의 값이 아니라 `.bak-statusline-…` 백업이 있는지로 읽는다. 정리 뒤 다시 깔면 값이 바뀔 수 있어서다. 있으면 되돌릴지 묻고, 되돌리기 전 지금 파일과 백업의 차이를 보인다.
5. 설정 파일 백업은 통째로 덮지 않는다. 그 뒤 바뀐 다른 설정이 사라지기 때문이다. 백업에서 `statusLine` 키만 가져와 넣고(전에 `<kit-setup> --backup-file "$HOME/.claude/settings.json" remove`) `--check-json`으로 읽어 본다.
6. 체계는 남기고 agent-meter만 지웠으면 `config.json`에 `agentMeterDeclined`를 `true`로 남겨 다음 업데이트가 다시 깔지 않게 한다.
   statusLine을 되돌렸으면 `<kit-setup> --config-unset "$HOME/.claude/subagent-system/config.json" statusLineCleanup`도 돌린다.
7. 다시 깔려면 `claude plugin install agent-meter --marketplace daum7766/claude-token-save`다. 지운 뒤 Claude Code를 다시 열면 입력창 아래 표가 사라진다.

### 제거 뒤 보고

「묻는 방법」의 형식으로 쓴다. 「정할 것」에는 지우지 않고 남겨 둔 사용자 줄을 지울지, 백업 파일을 언제 지울지를 쓴다.
「알아 둘 것」에는 되돌릴 때 필요한 경로(`.bak-uninstall-…`, `.bak-remove-…`, 옮긴 `records/`)와 못 찾았거나 `미확인`인 것과 어디까지 봤는지를 쓴다. 단계마다 한 일은 쓰지 않고 물으면 답한다.
