# agent-meter

Claude Code 입력창 아래에 모델, 토큰, 어림 비용, 캐시 만료 시각을 표로 보여 주는 플러그인이다. 서브에이전트 체계를 적용하는 [키트 README](../README.md)가 늘 함께 설치한다.

## 직접 설치

이 저장소가 플러그인 마켓플레이스(`claude-token-save`)이고 agent-meter가 그 안의 플러그인이다. Claude Code 2.1.292 이상에서 터미널에 한 줄이면 마켓플레이스 등록과 설치가 함께 된다.

```
claude plugin install agent-meter --marketplace daum7766/claude-token-save
```

Claude Code 안에서는 `/plugin install agent-meter --marketplace daum7766/claude-token-save`로도 된다. keep-alive를 끄고 싶으면 설치할 때 `--config keep_alive=false`를 붙이거나, 깐 뒤 Claude Code 안에서 `/config`의 agent-meter 줄(또는 `/plugin configure agent-meter@claude-token-save`)로 바꾼다. 셸에서 `claude plugin configure agent-meter@claude-token-save --values-stdin`으로 바꾸면 Claude Code를 다시 열어야 적용된다고 안내가 찍힌다. `/config`로 바꾼 값이 바로 적용되는지는 확인하지 못했다.

Claude Code를 새로 열면 입력창 아래에 사용량 표가 보인다. `/meter`로 표를 켜고 끄고, `/meter tokens`로 토큰 열(입력, 출력, 캐시 읽기, 캐시 쓰기)만 켜고 끈다. 토큰 열은 처음에는 보인다. 정한 상태(표를 숨긴 것 포함)는 새 세션에서도 이어진다.

설치가 하는 일:
- 이 저장소를 마켓플레이스 `claude-token-save`로 등록한다. 사용자 `settings.json`의 `extraKnownMarketplaces`에 들어간다. 이미 등록돼 있으면 그대로 쓴다.
- agent-meter를 사용자 범위로 깔고 `enabledPlugins`에 켠 표시를 남긴다. 플러그인 파일은 `~/.claude/plugins/` 아래 캐시에 놓이고, 이 키트의 옛 설치 스크립트가 쓰던 `~/.claude/mods/`와 `env.CLAUDE_CODE_PLUGIN_DIRS`는 쓰지 않는다.

## 업데이트와 제거

- 사용자가 추가한 마켓플레이스는 자동 업데이트가 기본으로 꺼져 있다. 새 버전은 `claude plugin marketplace update claude-token-save`로 목록을 새로 받고 `claude plugin update agent-meter@claude-token-save`로 올린다. 새 버전은 다음 세션부터 읽힌다. agent-meter의 `.claude-plugin/plugin.json`에 `version`이 적혀 있어서 그 값이 바뀌어야 새 버전으로 본다.
- 지우려면 `claude plugin uninstall agent-meter@claude-token-save`(저장된 옵션도 함께 지워진다)와 `claude plugin marketplace remove claude-token-save`다.

## 옛 설치 옮기기

예전 설치 스크립트(`install-agent-meter.mjs`)로 깐 컴퓨터는 [키트 README](../README.md)의 설치 문장을 말하면 업데이트가 마켓플레이스 설치로 옮기고 옛것을 치운다. 직접 옮기려면 위 설치 명령을 먼저 돌리고, 확인한 뒤 이렇게 정리한다. 옛 항목이 남으면 `CLAUDE_CODE_PLUGIN_DIRS`로 읽힌 폴더가 같은 이름의 마켓플레이스 복사본을 조용히 대신해 새 버전이 읽히지 않는다.
- 설정 폴더의 `settings.json`에서 `env.CLAUDE_CODE_PLUGIN_DIRS`의 agent-meter 폴더(`~/.claude/mods/agent-meter`) 항목만 뺀다. 다른 항목은 그대로 두고, 비면 키를 지운다.
- `env.AGENT_METER_KEEPALIVE`가 `"0"`이었다면 새 설정에서도 끈다(위 `--config`나 `/config`). 그 뒤 키를 지운다. `env`가 비면 `env` 키도 지운다.
- `~/.claude/mods/agent-meter`는 지우지 않고 `mods/` 밖(예: `~/.claude/agent-meter-backup-날짜`)으로 옮겨 둔다.

## 알아 둘 것

- `jq`가 없으면 resume(`claude --resume`으로 지난 대화를 다시 연 것)한 세션의 지난 사용량을 되살리는 기능만 빠진다. 설치는 macOS `brew install jq`, Windows `winget install jqlang.jq`, 리눅스는 배포판 패키지 관리자(`sudo apt install jq` 등)로 한다.
- 표 머리글은 `model`, `effort`, `context`를 뺀 나머지가 한국어이고, 어림 비용은 API 요금(2026-10 Anthropic 가격표)으로 환산한 값이다. 구독 요금제로 쓰면 실제로 내는 돈과 다르다. 요율은 아래 「비용 어림값」에 있다.
- 요율은 `~/.claude/subagent-system/rates.json`(`CLAUDE_CONFIG_DIR`을 정해 두었으면 그 폴더 아래)을 읽고, 파일의 수정 시각이 바뀌면 5초 안에 다시 읽는다. 파일이 없거나 깨졌을 때만 mod에 든 내장 요율을 쓴다. 파일에 없는 모델은 비용이 `?`로 보인다. 그래서 요율은 `rates.json` 하나만 고치면 되고, agent-meter를 다시 설치해도 그 값이 유지된다.
- 한 요청 안에 5분 캐시 쓰기와 1시간 캐시 쓰기가 섞이면 한쪽 요율로 계산한다(엔진이 둘을 가르는 값을 주지 않는다). 그 요청의 어림 비용은 조금 어긋날 수 있다.
- 표의 「캐시」 열은 프롬프트 캐시가 만료되기까지 남은 시간이고, 「재캐시」 열은 만료된 뒤 다음 요청이 대화 전체를 캐시에 다시 쓸 때 드는 어림 비용이며, 「캐시만료」 열은 지금까지 캐시가 만료된 횟수와 그때 든 비용이다.
- 서브에이전트가 도는 동안 메인 캐시가 곧 만료되면(1시간 캐시는 3분 전, 5분 캐시는 1분 전), 메인 요청을 한 번 더 보내 만료 시각을 늘린다(keep-alive). 돌아와서 대화 전체를 캐시에 다시 쓰는 것보다 싸지만 이 요청도 돈이 들고, 들어간 비용은 알림으로 보여 준다. 기본은 켬이고, 끄려면 플러그인 설정 `keep_alive`를 끈다(설치할 때 `--config keep_alive=false`, 깐 뒤에는 `/config`. 바꾼 값은 Claude Code를 다시 열면 확실히 적용된다). 끄거나 서브에이전트가 돌지 않을 때는 연장하지 않고, 알림만 낸다(1시간 캐시는 만료 5분 전, 5분 캐시는 1분 전). 연장 요청이 캐시를 읽지 못하면 연장 알림 대신 만료 알림이 나가고, 그 요청에 든 비용도 메인 비용에 더한다.
- 조직 정책(회사의 관리 설정이나 정책 mod)이 mod가 부르는 엔진 호출을 막으면 「<mod>: <이벤트> hook skipped」 경고가 날 수 있다. 훅이 오류를 던지면 그 훅만 건너뛰고 경고를 내기 때문이다. 이때는 먼저 keep-alive를 끄고(`/config`), 그래도 나면 `claude --debug`로 시작해 로그의 `hook skipped` 줄에서 어느 이벤트와 호출이 막혔는지 확인한다. 계속되면 `claude plugin disable agent-meter@claude-token-save`로 끈다. 근거 https://code.claude.com/docs/en/plugins/mods/admin, https://code.claude.com/docs/en/plugins/mods/troubleshoot 의 「A hook is skipped or a mod is unloaded」.
- agent-meter는 캐시 수명 확인에 `grep`을, 권한 모드 표시 폭 맞춤에 `sh`와 `ps`를 부른다. Git for Windows 기본 설치는 이 명령들을 PATH에 넣지 않아 Windows에서는 그 두 기능이 빠질 수 있다(확인하지 못했다). 표는 그대로 뜬다.
- 조직의 관리 설정에 따라 표만 안 뜨거나(`allowManagedModsOnly`, `allowManagedHooksOnly`, 관리 설정의 `disableAllHooks`. 뒤 둘은 서브에이전트 체계의 훅인 비용 기록도 멈춘다) 설치 명령이 거절될 수 있다. 마켓플레이스 출처를 제한하는 `strictKnownMarketplaces`(허용 목록)에 이 저장소가 없거나 `blockedMarketplaces`(차단 목록)가 이 저장소를 막으면 마켓플레이스 등록이 거절된다. [키트 README](../README.md)의 설치는 이 설정이 관리 설정 파일에 있으면 미리 가려 agent-meter를 깔지 않고, 서버나 MDM(기기 관리 도구)으로 내려오는 설정이면 설치 명령의 거절로 가려 깔지 않는다.

## 비용 어림값

agent-meter와 회고 표의 비용은 토큰 수에 API 요금을 곱한 어림값이다. 모델별 요율(100만 토큰당 달러, 긴 프롬프트 요율 포함)과 출처, 확인한 달은 `subagent-system/rates.json`(설치 뒤 `~/.claude/subagent-system/rates.json`) 한 곳에 있다. 요율표에 없는 모델은 비용을 모르는 것으로 두고 회고 표에 따로 보인다. 가격이 바뀌면 회고 때 `rates.json`만 고친다(agent-meter도 이 파일을 읽는다. 절차는 `subagent-system/docs/RETRO.md`의 「회고 단계」).
