# 라우팅(회고 포함) 설치 안내

일마다 맞는 정의에 맡기고, 사용과 비용 기록으로 회고가 표를 고치는 묶음이다. 이 묶음을 고른 설치에서만 아래 절을 읽는다. `<kit-setup>`과 `묻는 방법`은 `APPLY_GUIDE.md`를 따른다.

## 질문

전제 확인에 더해 이 묶음만 보는 것을 설치 질문 앞에 한다. 안 맞는 전제로 질문을 다 받은 뒤 멈추는 일이 없게 하려는 것이다.

- `claude --version`이 2.1.293 이상이어야 한다(정의 `haiku-*`가 쓰는 Haiku 5.5의 요구 버전). 낮으면 멈추고 업데이트를 안내한다. 설치 방식별 명령은 `claude update`(네이티브), `brew upgrade claude-code`, `winget upgrade Anthropic.ClaudeCode`, `npm install -g @anthropic-ai/claude-code@latest`다.
- `CLAUDE_CODE_EFFORT_LEVEL`(정의의 effort를 덮어씀)이나 `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`(정의의 모델을 덮어씀)가 켜져 있으면(`1`, `true`, `yes`, `on`) 라우팅 표가 의도대로 안 돈다고 알린다. 읽는 순서는 프로젝트 `.claude/settings.local.json`의 `env`, 프로젝트 `.claude/settings.json`의 `env`, 사용자 `settings.json`의 `env`, 셸이다. 조직 관리 설정과 `--settings` 파일의 값은 읽지 못하므로 `미확인`이다.
- `maxEffortLevel`(effort 상한)이 설정 파일에 있으면 정의의 effort와 `/effort`가 그 값까지만 올라간다고 알린다. 파일마다 `modelSettings.<모델>`의 값이 최상위 값을 대신하고 여럿이면 가장 낮은 값이 쓰인다.
- `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_USE_FOUNDRY`, `CLAUDE_CODE_USE_ANTHROPIC_AWS` 중 하나가 켜져 있으면 알린다. `opus`, `sonnet`, `haiku` 별칭이 effort를 덜 지원하는 옛 모델로 풀려 같은 모델의 effort 칸이 같은 동작이 될 수 있고, `ANTHROPIC_DEFAULT_OPUS_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL`, `ANTHROPIC_DEFAULT_HAIKU_MODEL`로 모델을 고정할 수 있다. 고정한 ID를 Claude Code가 모르면 `ANTHROPIC_DEFAULT_<계열>_MODEL_SUPPORTED_CAPABILITIES`에 `effort`를 적어야 effort가 켜진다(근거 https://code.claude.com/docs/en/model-config).
- 설정 파일의 `disableAllHooks`나 관리 설정의 `allowManagedHooksOnly`가 `true`이면 이 묶음의 훅, agent-meter, 사용자의 `statusLine`이 멈추고 비용이 기록되지 않아 회고도 안 돈다고 알린다. 설치는 이어 가고 바꾸지 않는다.
- 관리 설정 파일(`managed-settings.json`과 같은 폴더의 `managed-settings.d/*.json`)의 `strictKnownMarketplaces`나 `blockedMarketplaces`가 `daum7766/claude-token-save`를 막으면 agent-meter는 깔지 않는다. 파일로 못 읽은 서버나 MDM 값은 설치 명령의 거절로 드러난다.
- `retro` 이름이 `~/.claude/commands/retro.md`, `~/.claude/skills/retro/`, 지금 연 프로젝트, 켜진 플러그인에 이미 있으면 다른 이름을 고르게 하고 `--command-name`으로 넘긴다.

**주로 하는 일.** `docs/ROUTING_PRESETS.md`의 직군(백엔드, 프론트엔드와 앱, 데이터, 인프라와 운영, QA와 테스트, 기획과 문서)을 보기로 주고 여러 개를 골라도 된다고 알린다.
- 보기마다 그 직군 표의 Sonnet medium 칸과 Opus high 칸 일을 칸마다 최대 셋 한 줄로 붙인다. 이름만 주면 고르면 무엇이 바뀌는지 알 수 없기 때문이다.
- 추천은 사용자 `CLAUDE.md`, 사용자가 넣은 스킬의 이름과 설명, 쌓인 사용 기록에서 근거가 있을 때만 근거와 함께 단다. 프로젝트 소스는 읽지 않는다.
- 답은 `--roles 직군,…`이 된다. 하나도 안 고르면 기획과 문서 표로 시작하고 `--roles`를 생략하며 체크리스트는 공통 줄만 쓴다.

**표와 「무조건 Opus」 확정.** 위 답으로 만든 표(합치는 규칙은 `ROUTING_PRESETS.md`의 「여러 직군을 고를 때 합치는 규칙」)와 직군 기본안을 합친 「무조건 Opus」(작업 크기와 상관없이 가장 신중한 Opus high로 보내는 영역) 목록을 보이고 빠진 일이나 고칠 것을 받는다.
- 이 목록은 사용자의 모든 프로젝트에 걸리는 공통 항목의 초안이다. 프로젝트별 항목은 쓰면서 회고(쌓인 사용 기록을 보고 표를 고치는 일)가 더한다. 영역을 넣으면 그 판단과 검증은 작아도 Opus high로 가 비용이 더 든다.
- 빼면 일반 표의 칸으로 가 싸지만 틀려도 알아채기 어려운 일이 싼 정의로 갈 수 있다. 더한 일은 짧은 명사구로 이름 짓고 칸은 `SUBAGENT_GUIDE.md`의 「모델과 effort 고르기」로 정한다.
- 이름에 「누락 점검」, 「영향 범위」, 「검수」가 든 일에는 `「(고정)」`을 붙이고 알린다. 정의가 있는 칸에만 넣는다. Haiku high, Opus low 칸은 내려 보기 시험 자리라 비우고 xhigh 칸에는 새 일을 넣지 않는다.
- 자료에서 찾은 후보(사용자 `CLAUDE.md`의 운영 배포나 DB 규칙 같은 것)는 근거를 붙여 보이고 넣을지는 사용자가 정한다. 후보가 없을 때만 기본안 그대로를 추천한다.

설치 전에 알릴 것: 정의 10개, 지침 문서, 비용 기록 스크립트, 훅 다섯(`subagent-usage`, `usage-autolog`, `brief-check`, `stall-check`, 개인용의 `retro-write-allow`)이 깔린다. 지시문 검사 훅 `brief-check`는 `목표:` 줄이나 결정 문서 경로가 없는 서브에이전트 지시문, 표보다 높은 정의로 보내면서 `높임:`이나 `올림:`이 없는 지시문을 보내기 전에 막는다. 600자 아래 지시와 haiku 정의는 통과한다. 목표 줄과 결정 문서 줄 검사는 회사 규칙 묶음이 깔렸을 때만 돈다(그 꼴이 회사 규칙에 있어서). `stall-check`는 실무자를 기다리며 멈출 때 깨우는 예약을 걸게 하고, 남은 일이 있는데 멈추면 이어 하게 한다.

## 설치 뒤

1. **표와 「무조건 Opus」 쓰기.** 설치본 `~/.claude/subagent-system/docs/ROUTING_TABLE.md`에는 키트의 예시(백엔드)가 놓였다. 위에서 확정한 표와 목록으로 바꾸고 `키트 원본의 예시` 주석 줄을 지운다. 업데이트는 이 파일을 덮어쓰지 않는다. 일 이름 형식은 `ROUTING_PRESETS.md`의 「표 형식」을 따른다.
2. **정의 description 맞추기.** 표를 바꿨으면 `<kit-setup> descriptions`를 돌려 정의 `~/.claude/agents/<정의>.md`의 description 일 이름 나열을 표에서 다시 만든다(꼴은 `SUBAGENT_GUIDE.md`의 「표와 무조건 Opus」). 손으로 고치지 않는다.
3. **체크리스트 직군 줄.** 고른 직군의 「지시문 체크리스트 기본 줄」(`ROUTING_PRESETS.md`)을 `~/.claude/subagent-system/docs/SUBAGENT_BRIEF_CHECKLIST.md`에 더하되 자리는 그 절이 정한 대로 한다. 같은 문장이 이미 있으면(다시 설치하는 경우) 넣지 않는다.
4. **agent-meter.** `settings.json`을 고치는 `install`이 끝난 뒤에 아래 「agent-meter」를 한다.

### agent-meter

입력창 아래에 모델, effort, 문맥, 토큰, 어림 비용, 프롬프트 캐시 만료까지 남은 시간을 보여 주는 플러그인이다. 라우팅을 고르면 함께 설치하므로 묻지 않고 설치 전에 알린다. 표는 `/meter`로 켜고 끈다(토글이라 응답이 「사용량 표를 숨겼습니다.」이면 방금 껐다는 뜻이다). 전체 설명은 `agent-meter/README.md`에 있다.

- `claude plugin list --json`의 `id`에 `agent-meter@claude-token-save`가 있으면 `claude plugin marketplace update claude-token-save`와 `claude plugin update agent-meter@claude-token-save`로 갱신한다.
- 없으면 `claude plugin install agent-meter --marketplace daum7766/claude-token-save`로 깐다. 마켓플레이스 등록도 이 명령이 한다. 회사용은 끝에 `--config keep_alive=false`를 붙인다.
- 실패(종료 코드 1)이면 출력을 그대로 보이고 멈춘다. 조직 설정이 마켓플레이스 출처를 막은 거절이면 까닭과 체계는 agent-meter 없이 돈다는 것을 알리고 `config.json`에 `agentMeterDeclined`를 `true`로 남긴다.
- 성공이면 `claude plugin list`에서 그 항목이 `Scope: user`, `Status: ✔ enabled`인지 본다. 아니면 출력을 「알아 둘 것」에 적고 이어 간다.
- keep-alive(서브에이전트가 도는 동안 메인 캐시 만료 직전에 요청을 한 번 더 보내 만료를 늘리는 기능)는 개인용은 켜고 회사용은 끈다. 이 요청도 비용이 들고, 회사 관리 설정은 mod가 보내는 요청을 막아 「hook skipped」 경고를 되풀이해 띄우기 때문이다. 업데이트 때도 회사용이 켜져 있으면 끄고 알린다.
- 끄려면 `echo '{"keep_alive":"false"}' | claude plugin configure agent-meter@claude-token-save --values-stdin`이고(켜려면 `"true"`) Claude Code를 다시 열어야 적용된다. 끈 뒤에도 「hook skipped」가 나면 `claude --debug`로 어느 이벤트인지 찾아 알리고, 계속되면 `claude plugin disable agent-meter@claude-token-save`를 권한다.
- 예전 방식(`~/.claude/mods/agent-meter`나 `env.CLAUDE_CODE_PLUGIN_DIRS`의 그 폴더)이 있으면 위 설치가 `✔ enabled`로 확인된 뒤에만 치운다. 옛 `env.AGENT_METER_KEEPALIVE`가 끔이었으면 먼저 위 `configure`로 옮긴다. 치우는 명령은 `<kit-setup> --remove-agent-meter "$HOME/.claude/settings.json" "$HOME/.claude/mods/agent-meter"`와 `<kit-setup> --move-agent-meter "$HOME/.claude/mods/agent-meter"`다. 첫째는 `settings.json`에서 그 경로와 keep-alive 키만 빼고 백업을 남기며, 둘째는 폴더를 지우지 않고 `agent-meter-backup-<날짜-시각>`으로 옮긴다. 하기 전에 이 둘을 알린다.

**statusLine 정리.** statusLine은 화면에 모델이나 비용을 한 줄로 보여 주는 설정이라 agent-meter 표와 같은 정보가 두 번 보일 수 있다.
- 사용자 설정 폴더의 `settings.json`, 현재 프로젝트의 `.claude/settings.json`과 `.claude/settings.local.json`에서 `statusLine`을 읽는다. 없으면 한 줄 알리고 끝낸다.
- `command`가 가리키는 스크립트를 읽어 보여 주는 항목을 뽑고 agent-meter 항목(모델, effort, 문맥, 세션 비용, 토큰, 브랜치, 작업 폴더)과 견준 표를 보인다. 읽지 못했거나 외부 도구를 부르면 `미확인`으로 두고 b와 c만 묻는다. 토큰 행은 상태줄이 지금 문맥 기준이고 agent-meter는 누적이라 겹침으로 세지 않는다. 겹침이 없으면 알리고 끝낸다.
- 겹침이 있고 고칠 수 있는 것(사용자 설정 폴더의 `settings.json`에 있고 스크립트가 저장소 밖)이면 뺄 조각 원문과 함께 묻는다. 프로젝트 쪽, 저장소 안 스크립트, 플러그인이나 조직 설정의 statusLine은 알리기만 한다.
- a. (추천: 겹치는 정보는 agent-meter 표가 이미 보여 준다) 겹치는 항목만 뺀다. b. 그대로 둔다. c. `statusLine` 키를 지운다(스크립트 파일은 남음). 남는 항목이 없으면 a는 뺀다.
- a나 c를 고르면 `<kit-setup> --backup-file "<고칠 파일>" statusline`으로 백업하고 경로를 알린다. a는 스크립트를 읽어 겹치는 항목만 빼고 샘플 입력으로 돌려 본다. c는 `<kit-setup> --config-unset "$HOME/.claude/settings.json" statusLine`이다.
- 끝나면 고른 값(`"a"`, `"b"`, `"c"`)을 `<kit-setup> --config-set "$HOME/.claude/subagent-system/config.json" statusLineCleanup '"a"'`로 남겨 업데이트가 다시 묻지 않게 한다. 정리할 것이 없었으면 남기지 않는다.

## 확인

- `node "$HOME/.claude/subagent-system/scripts/subagent-retro.js" --check`에서 「정의 description과 표 칸이 다른 곳」, 「표에 칸이 있는데 정의 파일이 없는 칸」, 「removedDefs에 든 정의인데 표의 칸에 일이 있는 칸」이 `없음`이어야 한다. 표에 든 이름이 정의 description에도 있어야 라우팅이 표대로 돈다. `--kinds`가 「표를 읽지 못했습니다」 없이 돌아야 한다.
- `grep -n '키트 원본의 예시' "$HOME/.claude/subagent-system/docs/ROUTING_TABLE.md"`가 비어야 한다. 남았으면 키트의 예시 표가 그대로인 것이니 「설치 뒤」 1번으로 돌아간다.
- 재시작한 새 세션에서 정의 목록에 키트 정의가 보이는지 확인한 뒤 `haiku-low`로 짧은 일 하나(예: `ls` 결과를 세 줄로 정리)를 보낸다. 끝나면 `records/subagent-cost.tsv`에 그 에이전트 줄이 생기고 프로젝트 열이 채워졌는지 본다. 줄이 안 생기면 훅 명령을 터미널에서 직접 돌려 오류를 본다. 전제 확인에서 `disableAllHooks`나 `allowManagedHooksOnly`가 읽혔으면 그것이 원인 후보다.
- 그 에이전트를 사용 기록에 적고(`subagent-retro.js --log`, 인자는 `--log --help`), `/retro`를 입력해 첫 줄이 「회고 방식: …」으로 뜨는지 본다. 「Shell command permission check failed」가 나오면 스킬의 `allowed-tools`와 명령이 맞지 않는 것이니 출력을 보이고 사용자에게 묻는다.
- agent-meter를 깔았으면 입력창 아래에 `total … | branch … | path …` 줄과 표가 보이는지 사용자에게 묻는다. 안 보이면 조직 설정이나 `disableAllHooks` 때문일 수 있고 체계는 표 없이도 돈다.
- 보고에 요율표에 없는 모델이 있으면 그 사실과 요율을 알려 달라는 말을 넣는다(없으면 `?`로 보인다). 회고 건수 기준은 `node "$HOME/.claude/subagent-system/scripts/subagent-retro.js" --help`의 `--due` 줄에서 읽어 적는다. 개인용은 회고가 저절로 돌고 회사용은 회고할지 묻는다.
- 쓰는 법(처음 설치 보고에만): 평소처럼 일을 시키면 메인이 표를 보고 알맞은 정의에 맡긴다. 결과가 모자라면 그렇다고 말하면 회고가 표를 고친다. 하지 않는 일은 표에서 빼 달라고 하면 된다. 상태는 `/retro`로 본다.

**메인 설정**은 필수가 아니고 추천이다. Claude는 설정하지 않고 값이 권장값이 아니면 보고의 「정할 것」에 알린다. 메인은 맡기고 확인하는 역할이라 판단이 틀려도 알아챌 신호가 없어 Opus high를 권한다.
- 권장값은 Opus 5.5(`claude-opus-5-5`), effort high, autocompact 400k에서 600k다. autocompact는 문맥이 차면 대화를 요약해 줄이는 기능이다. 문맥이 길수록 요청마다 캐시를 다시 읽는 비용과 만료 때 다시 쓰는 비용이 커지기 때문이다.
- 모델은 지금 세션의 모델 ID에서 `[1m]` 꼬리와 `-YYYYMMDD`를 뗀 이름으로 본다. ID가 `claude-`로 시작하지 않거나 `@`가 들면 판정하지 않고 「`/model` 화면에서 Opus 5.5를 고른 뒤 `/effort high`, `/autocompact 400k`」만 안내한다.
- effort는 `CLAUDE_CODE_EFFORT_LEVEL`, 사용자 `settings.json`의 `modelSettings.claude-opus-5-5.effortLevel`, 기본값 medium 순으로 읽는다. autocompact는 `modelSettings.claude-opus-5-5.autoCompactWindow`, 최상위 `autoCompactWindow` 순이다.
- `CLAUDE_CODE_DISABLE_1M_CONTEXT`가 켜져 있거나 `CLAUDE_CODE_AUTO_COMPACT_WINDOW`가 있거나 프로젝트 설정이 정했거나 `maxEffortLevel`이 high보다 낮으면 그 항목은 판정하지 않는다. 읽은 곳을 「알아 둘 것」에 적는다.
- 명령 셋은 권장값이 아닌 항목만 `/model claude-opus-5-5`, `/effort high`, `/autocompact 400k` 순으로 넣는다. `/effort`와 `/autocompact`는 모델마다 저장되므로 `/model`을 먼저 친다고 적는다. 모두 권장값이면 쓰지 않는다.

## 업데이트

- `ROUTING_TABLE.md`, `records/`, `config.json`의 사용자 값은 건드리지 않는다.
- `rates.json`은 설치본 값을 지키고 키트에만 있는 모델만 더한다. 값이 다른 모델(가격이 바뀐 경우)은 모델별 차이를 보이고 묻는다.
- 옛 설치본의 GUIDE에 있던 사용자 표와 무조건 Opus 목록은 `ROUTING_TABLE.md`로, 사용자 규칙 줄은 `docs/MIGRATED_USER_RULES.md`로 옮겨진다. 그 규칙 줄은 정책이면 사용자 `CLAUDE.md`로, 방법이면 규칙 파일로 나눠 옮기고 옮긴 줄은 그 파일에서 지울지 묻는다.
- 옛 `records/retro-pending.md`의 항목은 `docs/PROPOSALS.md`의 `## 제안` 아래로 옮겨지고 원본은 `.bak-update-…`로 남는다. 보고의 `retroPending`을 보인다.
- 정의의 description 줄은 설치 값이라 키트와 병합하지 않고 라우팅 표에서 다시 만든다(첫 문장만 키트 것). 알림이 나오면 그대로 보인다(손볼 것 없음).
- `config.json`의 `retroWriteAllow`가 false이면서 이번 `update`가 그 키를 채웠으면(`config.changes`에 `retroWriteAllow: 없음 -> false`) 개인용은 켤지 묻는다. 회사용에서 `set-profile personal`로 바꾼 직후는 키가 이미 false로 있어 `update`가 채우지 않으므로, `set-profile`의 `notes`에 `retroWriteAllow는 false 그대로`가 나온 것으로 같은 질문을 한다. 까닭: 키트의 어떤 명령도 권한 스위치를 켜지 않아야 한다(`APPLY_GUIDE.md` 「개인용과 회사용」의 권한과 보호 스위치 줄).
  - 이 키가 하는 일(회고 잠금 동안 서브에이전트가 방법 파일을 쓸 때 확인 창이 뜨지 않음. 정책 문서와 권한 설정 같은 보호 목록은 늘 확인 창)을 보이고 켤지 묻는다. 켠다고 하면 `<kit-setup> --config-set "$HOME/.claude/subagent-system/config.json" retroWriteAllow true`를 돌린다. 이 명령이 settings.json의 `retro-write-allow` 훅 등록도 함께 맞춘다(결과의 `hook`이 `registered`). 안 켜면 회고의 쓰기마다 확인 창이 뜬다고 알린다.
- agent-meter가 깔려 있으면 「agent-meter」의 갱신을 한다. 안 깔려 있고 `agentMeterDeclined`가 없으면 설치를 한 번 알리고 한다. 재시작이 필요하다고 알린다(정의와 스킬이 바뀌었을 수 있다). 「확인」의 `haiku-low` 시험과 메인 설정 판정도 처음 설치와 같게 한다.

## 빼기

- `<kit-setup> remove --bundles routing`이 파일과 훅 등록을 빼고 설치 값(`rates.json`, 체크리스트 「이 설치에서 더한 줄」, 정의 description)을 `kept-values.json`에 보관한다. 다시 넣으면 되살아난다. `ROUTING_TABLE.md`는 설치 값이라 지우지 않는다.
- `records/`(사용 기록, 비용 기록, 회고 잠금, 속도 기록)는 빼도 남는다. 지우거나 옮기려면 전체를 지울 때의 `uninstall --records`를 쓴다.
- agent-meter는 따로 지운다. 깔린 방식을 `claude plugin list --json`의 `id`(`agent-meter@claude-token-save`), `~/.claude/mods/agent-meter`, `env.CLAUDE_CODE_PLUGIN_DIRS`로 읽어 있는 것만 지운다.
  1. 마켓플레이스로 깔려 있으면 지울 것과 함께 보이고 승인을 받아 `claude plugin uninstall agent-meter@claude-token-save`를 돌린다. 저장된 옵션(`keep_alive`)과 플러그인 데이터도 함께 지워진다. 마켓플레이스 `claude-token-save`는 agent-meter 하나만 담고 있으니 등록도 뺄지 묻는다(`claude plugin marketplace remove claude-token-save`).
  2. 예전 방식이 있으면 `--remove-agent-meter`와 `--move-agent-meter`로 치운다.
  3. statusLine을 정리했는지는 `config.json`의 값이 아니라 `.bak-statusline-…` 백업이 있는지로 읽는다. 있으면 되돌릴지 묻고, 되돌리기 전 지금 파일과 백업의 차이를 보인다. 설정 파일 백업은 통째로 덮지 않고(그 뒤 바뀐 다른 설정이 사라지므로) 백업에서 `statusLine` 키만 가져와 넣은 뒤 `--check-json`으로 읽어 본다. 되돌렸으면 `<kit-setup> --config-unset "$HOME/.claude/subagent-system/config.json" statusLineCleanup`도 돌린다.
  4. 체계는 남기고 agent-meter만 지웠으면 `config.json`에 `agentMeterDeclined`를 `true`로 남겨 다음 업데이트가 다시 깔지 않게 한다. 다시 깔려면 `claude plugin install agent-meter --marketplace daum7766/claude-token-save`다.

## 개인용과 회사용 행

| 하는 일(키) | 개인용 | 회사용 |
|:---|:---|:---|
| 표 칸 조정과 쪼개기, 정의 description 맞추기, 규칙 문장과 체크리스트 고치기 | 근거가 있으면 바로 고치고 기록 | 「물을 것」에 모아 승인 뒤 |
| 새 스킬, 훅, 스크립트, 정의 만들기와 지우기, 바깥 자료 조사 | 바로 함 | 승인 뒤 |
| 물을 것 세기 | `- 묻기:` 줄이 있는 항목만 | 제안 목록 전부 |
| 고친 근거를 남기는 곳 | 커밋 메시지 | 최종 보고의 「하고 알린 것」 |
| 「하고 알리기」 문턱(애매할 때) | 애매하면 하고 알림 | 되돌리는 비용이 거의 없는 것만, 나머지는 묻기(kit-core가 `kit-setup.js settings`의 「애매할 때」 줄로 읽음) |
| 회고(`retroMode`) | `auto`: 최종 보고 뒤 묻지 않고 회고 서브에이전트가 백그라운드로 돎 | `ask`: 회고할지 묻고, 하자고 하면(`/retro now` 포함) 같은 회고 서브에이전트가 돎. 메인이 직접 회고하지 않음 |
| 회고의 `~/.claude` 쓰기 허용(`retroWriteAllow`) | 처음 설치는 둠(회고 중 방법 자리 쓰기에 확인 창 없음, 훅은 처음 설치가 건다). 개인용으로 가는 `set-profile personal`은 바꾸지 않고 `notes`로 알린다. 업데이트로 키가 새로 생기면 끄고, 위 업데이트의 질문이 켤지 물어 `--config-set`으로 켠다(훅 등록도 그 명령이 함께 맞춤) | 두지 않음: 확인 창이 뜸. 회사용으로 가는 `set-profile company`와 다른 profile로 다시 돌린 `install`은 켜져 있으면 끄고 훅 등록도 뺀다 |

- 개인용에서 회고 쓰기 허용 훅(PermissionRequest)은 서브에이전트가 회고 잠금이 잡힌 동안 설정 폴더 아래 방법 파일을 쓸 때만 확인 창 없이 허용한다. 확인 창 없이 쓰는 자리와 늘 확인 창이 뜨는 것은 RETRO 「권한 확인 창과 연속 실패」에 있다. 스크립트, 훅, 권한 설정, 정책 문서(`CLAUDE.md`, `docs/plan/`, `MIGRATED_USER_RULES.md`)와 권한이나 실행을 바꾸는 머리 키는 늘 확인 창이 뜬다.
- 개인용은 `retroMode`가 `auto`로 시작해 `--config-set`이 다른 값을 거절한다. 묻기로 바꾸려면 `set-profile company`로 회사용으로 바꾼다. 회사용은 회고 방식을 `/retro auto`와 `/retro ask`로 바꾼다.
- 자동 회고가 두 번 이어 실패하면 개인용도 묻기로 돌아간다. 다시 켜는 법은 `docs/RETRO.md`의 「권한 확인 창과 연속 실패」를 따른다.
