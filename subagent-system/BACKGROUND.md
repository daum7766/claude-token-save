# 키트 규칙의 근거

목표: 모델이나 공식 동작이 바뀌었을 때 키트 규칙을 다시 따질 자료(출처와 확인 날짜)를 한 곳에서 찾게 하는 것입니다.

키트의 규칙을 왜 그렇게 정했는지, 어떤 자료로 확인했는지 모아 둔 참고 문서입니다. 설치하지 않습니다. 설치되는 문서(`SUBAGENT_GUIDE.md`, `RETRO.md` 등)는 Claude가 일할 때마다 읽으므로 규칙만 두고, 근거는 여기에 둡니다. 모델이나 가격이 바뀌어 규칙을 다시 따져 볼 때 읽습니다. 날짜는 확인한 시점입니다.

## 공식 모델별 권장(2026-10-13 확인)

| 모델 | 공식 권장 용도 | 입력 / 출력(100만 토큰당 달러) | Terminal-Bench 4.0 | 기본 effort(API / Claude Code) |
|:---|:---|---:|---:|:---|
| Haiku 5.5 | 「summarization」, 「subagent tasks」, 「short tool tasks」 | 0.1 / 0.5 | 39.2% | medium / medium |
| Sonnet 5.5 | 「Code generation, data analysis, content creation」, 「creating polished documents, slides, and spreadsheets」 | 2 / 10 | 70.6%(effort 표기 없음) | high / medium |
| Opus 5.5 | 「complex work requiring careful judgment」 | 4 / 20 | 66.4%(xhigh) | medium / medium |
| Fable 5.1 | 「If your evals at `xhigh` or `max` effort still fall short on demanding reasoning or long-horizon agentic work, move to Claude Fable 5.1」 | 10 / 50 | 55.8% | high / high |

- Haiku 5.5는 「It pairs well with Opus 5.5 and Sonnet 5.5 as a subagent on coding work」이지만 「Sonnet 5.5 and Opus 5.5 remain better choices for complex agentic coding tasks」라고 합니다. Haiku는 프롬프트가 10만 토큰을 넘는 요청에 입력 0.5, 출력 2.5를 씁니다(`rates.json`의 `longPrompt`).
- Terminal-Bench 4.0에서는 Sonnet이 Opus보다 높아서, 터미널 중심 코딩은 Sonnet으로 충분할 수 있습니다.
- 네 모델 모두 low부터 max까지 지원합니다. 키트가 메인을 high로 두는 것은 공식 기본값(Claude Code에서 Opus 5.5 medium)보다 한 단계 높은 선택입니다.
- xhigh의 공식 용도는 「Long-running agentic and coding tasks (over 30 minutes)」입니다. 키트는 xhigh가 high보다 1.4점 높고 비용이 2.5배라, 긴 일을 Sonnet high로 보냅니다.

출처는 다음과 같습니다.
- Haiku 5.5 https://www.anthropic.com/claude-haiku-5-5, https://platform.claude.com/docs/en/about-claude/models/choosing-a-model
- Sonnet 5.5 https://www.anthropic.com/claude-sonnet-5-5, https://platform.claude.com/docs/en/about-claude/models/choosing-a-model
- Opus 5.5 https://www.anthropic.com/claude-sonnet-5-5 (권장 용도. Opus 5.5 페이지에는 권장 용도 문장이 없고, Sonnet 5.5 페이지가 「Where Opus 5.5 is built for complex work requiring careful judgment」로 Opus 5.5를 설명합니다), https://www.anthropic.com/claude-opus-5-5(Terminal-Bench)
- Fable 5.1 https://platform.claude.com/docs/en/about-claude/models/choosing-a-model
- 요율 https://platform.claude.com/docs/en/about-claude/pricing
- 기본 effort https://platform.claude.com/docs/en/build-with-claude/effort (API), https://code.claude.com/docs/en/model-config (Claude Code. 「`high` on every model that supports effort, except that Opus 5.5, Sonnet 5.5, and Haiku 5.5 default to `medium`」라서 Fable 5.1은 high)

## 서브에이전트를 부르는 법

- Agent 도구에는 호출마다 effort를 덮어쓰는 `effort` 인자가 있습니다(Claude Code v2.1.292 이상, fork에는 쓸 수 없음, 2026-10-13 공식 문서 확인). 키트는 정의의 effort를 따르게 하려고 이 인자를 빼고 부릅니다(마지막 올리기 단계인 Fable 5.1과 사용자나 `CLAUDE.md`가 effort를 명시한 때는 넘깁니다).
- 정의 없이 부르면 메인 대화의 모델과 effort를 물려받습니다. 모델은 호출의 `model`, 정의의 `model`, 환경변수 `CLAUDE_CODE_SUBAGENT_MODEL`, 메인 대화 모델 순서로 정해집니다(https://code.claude.com/docs/en/sub-agents 「Choose a model」).
- 정의의 `model`은 별칭(`opus`, `sonnet`, `haiku`)입니다. 메인 대화의 모델이 같은 계열이면 서브에이전트는 메인 모델 그대로(`[1m]` 꼬리가 있으면 그것까지) 돌고, 아니면 Claude Code가 그 별칭이 가리키는 모델로 정합니다(https://code.claude.com/docs/en/sub-agents 「Choose a model」). 새 모델이 나와도 정의를 고치지 않아도 되지만, Bedrock, Google Cloud(Vertex), Foundry, Claude Platform on AWS에서는 `opus`, `sonnet`, `haiku`가 effort를 일부만 지원하거나 지원하지 않는 이전 모델로 풀려 같은 모델의 effort 칸이 같은 동작이 될 수 있습니다(https://code.claude.com/docs/en/model-config 의 공급자별 별칭 표와 「Customize pinned model display and capabilities」. `ANTHROPIC_DEFAULT_OPUS_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL`, `ANTHROPIC_DEFAULT_HAIKU_MODEL`로 고정할 수 있고, 고정한 ID를 Claude Code가 알아보지 못하면 `ANTHROPIC_DEFAULT_<계열>_MODEL_SUPPORTED_CAPABILITIES`에 `effort`를 적어야 effort가 켜짐).
- 요율표에 없는 새 모델이 쓰이면 비용이 `?`로 보이고, 회고 6단계에서 요율을 더합니다.

## 모델 고르기

- 아래 모델일수록 싸서 할 수 있는 일은 내려 보냅니다. 입력 100만 토큰당 Haiku 0.1달러, Sonnet 2달러, Opus 4달러입니다(2026-10-09 기준).
- Haiku에 코드와 문서를 고치는 일을 처음부터 보내지 않는 것은 공식 벤치마크에서 Sonnet과 차이가 크고(Terminal-Bench 4.0에서 Haiku 5.5 39.2%, Sonnet 5.5 70.6%), 고친 뒤 확인 없이 완료를 보고하는 약점이 공식 문서에 적혀 있기 때문입니다(2026-10-09 조사). Haiku 정의 본문에는 고친 뒤 확인을 돌려 출력을 붙이라는 문장이 있습니다.
- 내려 보기 시험이 `haiku-high`로 가는 때의 판정 기준은 `RETRO.md`의 「정정과 후보 판정」에 있습니다.
- 모델을 내린 시험이 통과하면 같은 모델에서 effort도 한 칸 내려 2건 이상 시험합니다. 시간은 effort의 영향이 커서 모델을 내린 뒤 effort가 높게 남아 있으면 시간이 오히려 늘 수 있기 때문입니다. 작은 수정을 Sonnet low에서 Haiku high로 내렸을 때 건당 중앙 시간이 28초에서 168초가 된 사례가 있습니다(3건, 일 크기 차이 가능성 있음). 판정은 `RETRO.md`의 「정정과 후보 판정」에 있습니다.
- Sonnet은 high 위로 올리지 않고 Opus medium으로 보냅니다. Sonnet xhigh는 Opus medium과 점수가 비슷한데 작업당 비용이 약 2배였습니다(Artificial Analysis 종합 지수, 2026-10-09 조사).
- 모델을 올릴 때 effort는 표에 그 일의 칸이 있으면 그 칸, 없으면 low입니다. 공식 안내가 「try the next tier up at low effort」입니다. 원인에 따라 effort나 모델을 올리는 구분은 Anthropic의 「모델과 effort 고르기」 안내를 따랐습니다.

## effort 고르기

- 칸을 「잘못됐을 때 메인이 알아챌 수 있는가」로 나눈 것은 공식 문서를 조사한 결과입니다(2026-10-11).
- 테스트, 로그, 출처로 잘못이 드러나는 일을 낮게 보내는 근거는 Opus 5.5에서 잰 공식 측정입니다. 모두 low로 돌리고 실패만 high로 다시 돌렸더니 통과율은 조금 높았고 비용은 약 58%였습니다(https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence). 대신 실패한 일은 두 번 돌아 그만큼 늦게 끝납니다. 실패를 알아챌 신호가 있어야 통하는 방식이라고 문서에 적혀 있어, 신호가 없는 일은 high로 보냅니다.
- 오래 걸리는 일을 low에 두지 않는 것은 low가 긴 일에서 일찍 멈추거나 되묻는 일이 늘기 때문입니다. low에서는 검색이나 고친 뒤 확인을 건너뛰기 쉬워(Haiku 공식 안내), low 정의 본문에는 확인하고 끝내라는 문단이 있습니다.
- xhigh는 Opus 5.5 코딩 측정에서 high보다 1.4점 높고 비용은 2.5배였습니다. 그래서 high로 안 풀린다는 기록이 쌓여 표의 xhigh 칸에 든 일과 다시 보내는 일에만 쓰고, max는 쓰지 않습니다.
- Opus xhigh로도 안 풀리면 마지막으로 Fable 5.1에 보냅니다. 요율표에서 가장 비싸고 요금제에 따라 사용 크레딧(추가 요금)으로 청구될 수 있어(model-config 의 「Fable and usage credits」) 올리기 전에 사용자에게 묻습니다.
- Fable로 보낸 호출이 다른 모델로 돌 수 있는 경로는 다섯입니다. 어느 쪽이든 호출은 실패하지 않아 다른 모델의 결과를 Fable 결과로 보고할 수 있습니다.
  - 조직의 `availableModels`가 Fable을 막으면 다른 모델로 돕니다(https://code.claude.com/docs/en/model-config 의 「Restrict model selection」).
  - `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`가 켜져 있으면 호출에서 모델을 넘길 수 없습니다(https://code.claude.com/docs/en/sub-agents 의 「Run every subagent on one model」).
  - 보안이나 생물 관련 요청은 안전 분류기가 잡아 다른 모델로 다시 돌립니다(model-config 의 「biology-flagged requests re-run on Opus 5, and cybersecurity-flagged requests re-run on Opus 4.8」).
  - `fallbackModel` 사슬은 서브에이전트에도 적용돼 다른 모델에서 이어 돕니다.
  - 대화형 세션에서는 사용 크레딧 동의 창이 떠서 기본 모델로 바꾸거나 창을 닫으면 기본 모델로 이어질 수 있습니다(서브에이전트 호출에도 뜨는지는 공식 문서로 확인되지 않았습니다).
- 그래서 끝난 뒤 비용 기록의 모델 열로 확인합니다. 판정 방식과 전제는 `subagent-retro.js`의 `checkFable` 머리 주석과 `--check-fable --help`에 있습니다.
  판정 로직을 여기에 옮겨 적으면 코드가 바뀔 때 문서가 거짓이 되기 때문입니다.
- advisor(작은 모델이 큰 모델에게 조언을 구하는 기능)를 켜지 않는 것은 공식 측정에서 Sonnet 5.5와 Haiku 5.5가 198문항에서 한 번도 조언을 구하지 않았고, Opus 5.5를 low로 돌린 조합은 막힌 것을 알아채지 못해 점수가 떨어졌기 때문입니다.

## 「(고정)」 표시가 붙는 일

표 칸 이름 뒤의 `「(고정)」`은 원칙 때문에 그 칸에 두고 짝 시험으로 잴 때까지 내려 보지 않는 일입니다. 세 부류에 붙습니다.
- Opus high의 종합 검토, 최종 코드 리뷰, 원인 찾기, 무조건 Opus 영역 판단과 구현입니다. 계획이 정한 무조건 Opus 영역 단계 구현은 Sonnet high 칸이라 「(고정)」 대신 ``「(최저: `sonnet-medium`)」``을 붙여, 평소에는 Sonnet medium 아래로 내려 보내지 않습니다. 다른 최저선과 같이 다시 시험합니다(아래 「내려 보기와 최저선의 설계」).
- 이름에 누락 점검, 영향 범위, 검수가 든 일입니다. 이 둘은 놓쳐도 신호가 없어, 싼 정의로 내려도 실패가 기록되지 않습니다.
- 회고가 쓰는 네 일(회고 정정 분류, 자동 회고, 작업 기록 병목 분석, 문서 내용 검토)과 데이터 직군 표의 수치 검증입니다. 회고가 칸을 올리면 `RETRO.md`가 올라간 칸의 정의를 따릅니다. 수치 검증은 다른 경로로 다시 계산해 대조하는 일이라 틀려도 드러나지 않습니다.

표시는 짝 시험 모음으로 회고가 뗍니다(`SUBAGENT_SITUATIONS.md`와 `RETRO.md`).
떼면 다른 칸처럼 내려 볼 수 있습니다. 스크립트는 `haiku-low` 칸도 아래 칸이 없어 후보에서 뺍니다. 표의 Haiku high 칸과 Opus low 칸은 처음에 비어 있고, Sonnet low 칸의 일이 내려 보기 후보가 되면 `haiku-high`로, Opus medium 칸의 일이 후보가 되면 `opus-low`로 내려 보는 시험을 해서 옮길 일이 정해지면 채웁니다(후보 조건은 `RETRO.md`의 「정정과 후보 판정」).

## 내려 보기와 최저선의 설계

- 내려 보기 사다리는 모델을 내릴 때 effort까지 함께 낮추지 않습니다. 「문제가 생기면 올리기」에서 모델을 올릴 때 위 모델의 low로 가는 것과 짝을 이룹니다.
- 내림 시험의 비용 판정은 2~3건의 중앙값으로 합니다. 한 건은 일 크기 차이로 튀어(작은 수정을 Sonnet low에서 Haiku high로 내린 시험 한 건이 더 비싸게 나온 사례) 같은 실패가 되풀이됐기 때문입니다. 비용 때문에 실패하면 같은 모델에서 effort를 한 칸 아래로 시험합니다.
- 시험 결과가 같고 비용이 비슷하면 빠른 쪽이 낫기 때문에, 비용이 평균의 ±10% 안이면 걸린 시간이 짧을 때만 칸을 옮깁니다.
- 최저선은 실측으로 바닥만 정하고 그 위에서는 평소처럼 올리고 내려 봅니다. 최저선이 올라가기만 하면 결국 모든 일이 Opus로 몰리므로, 최저선을 단 뒤 회고 2번이 지나면 바로 아래 정의로 2건 이상 다시 시험하고, 실패하면 간격을 4번, 8번으로 늘립니다.
- 최저선을 달거나 바꾸거나 떼면 그 칸의 내림 실패를 0부터 다시 셉니다. 사용자가 그 칸의 바닥을 새로 정한 것이라 그 뒤의 실패만으로 판단하기 위해서입니다.
- 성공과 실패가 섞이는 칸에 최저선을 달거나 올리면 쉬운 건까지 비싼 정의로 가서 아낄 수 있던 비용을 놓칩니다. 그래서 맡기기 전에 볼 수 있는 기준으로 먼저 쪼갭니다.

## 회고 시기의 설계

- 기준 건수는 표를 맞추는 초반에 낮고 회고가 쌓일수록 오릅니다. 표가 자리 잡을수록 덜 묻게 하려는 것입니다. 판정 전 시험 표시가 있는데 표 안정으로 보면 기준이 가장 높은 단계로 늘어 시험 판정이 그만큼 밀리기 때문에, 그때는 안정으로 보지 않습니다.
- 기준 건수에 못 미쳐도 올림이 쌓인 칸이 올리기 후보와 같은 조건이면 묻습니다. 회고가 칸을 내린 뒤 그 칸에서 실패가 이어지면 다음 기준 건수까지 표가 낮은 채로 남아, 메인이 실패할 때마다 위 정의로 다시 보내게 되기 때문입니다. 묻는 기준과 올리는 기준이 같아서, 물어서 회고했는데 올릴 칸이 없는 일은 생기지 않습니다. 올릴 칸이 없는 `opus-xhigh`와 `fable-high`는 두 기준에서 모두 뺍니다.
- 기간 셈 시작일(마지막 회고, 회고가 없으면 사용 기록 첫 줄, 기간 기준을 미뤘으면 그 날짜)부터 (대화 기록 보존 기간 - 5일)이 지나면 건수와 상관없이 묻습니다. Claude Code가 보존 기간(`cleanupPeriodDays`, 기본 30일)이 지난 대화 기록을 서브에이전트 기록까지 지우는데, 회고는 정정을 그 대화 기록에서 뽑아서 늦으면 정정이 소리 없이 사라집니다. 5일을 뺀 것은 지워지기 전에 회고를 끝낼 여유이고, 보존 기간이 5일 이하이면 (보존 기간 - 1)일로 셉니다. 뽑을 새 기록이 없으면 지워질 정정도 없어서 걸지 않습니다.
- 보존 기간은 Claude 설정 폴더의 `settings.local.json`과 `settings.json`에서만 읽고, 둘 다 유효하면 작은 값을 씁니다. 공식 문서의 사용자 범위는 `settings.json`뿐이고 그 폴더의 `settings.local.json`은 설정 폴더가 세션의 프로젝트 `.claude`와 같은 폴더일 때(예: `CLAUDE_CONFIG_DIR` 없이 홈 폴더에서 연 세션)만 프로젝트 로컬로 읽혀, 어느 값이 실제로 적용됐는지 알 수 없습니다. 작은 값을 쓰면 회고를 일찍 물어 기록이 지워지기 전에 정정을 놓치지 않습니다. 기록이 프로젝트와 상관없이 한 곳에 모이므로 프로젝트 설정은 읽지 않고, 조직이 내려보내는 managed settings 같은 다른 위치의 값도 읽지 않습니다. 그런 곳에서 보존 기간을 줄여 둔 컴퓨터는 이 조건이 실제보다 늦게 걸립니다. `CLAUDE_CONFIG_DIR`이 있으면 그 폴더의 파일을 읽고, 두 파일 모두 값이 없거나 정수 1 이상이 아니면 30일로 봅니다.
- 기간 기준을 `/retro` 상태와 `--due`가 날짜로 보이고, 이미 지났거나 새 기록이 없으면 그 까닭을 함께 찍습니다. 날짜만 찍으면 이미 지난 날짜에 묻는다고 읽혀 왜 안 묻는지 알 수 없기 때문입니다. 출력 꼴은 `subagent-retro.js`의 `기간 기준:` 출력 코드에 있습니다.
- 미룸 줄에는 미룰 때 그날 비용 기록에만 있던 에이전트 수를 남깁니다. 비용 기록은 날짜만 있어 미룬 날 당일 것이 미룸 앞인지 뒤인지 가를 수 없고, 당일 것을 모두 세면 미룬 직후 기록이 없어도 다시 묻게 되기 때문입니다.
- `--mark`는 그때의 표 모양을 회고 표시 줄에 남깁니다. 다음 회고들이 이 모양을 앞뒤로 이어 보며 내림 실패와 판정 불가가 이어진 횟수를 세기 때문입니다. 저장 꼴은 `subagentRetroHelpers.js`의 표 모양(회고 표시 줄) 주석에 있습니다.

## 반복 찾기

- 되풀이되는 지시를 스킬 본문으로 만들어도 본문은 쓸 때마다 읽히므로 토큰은 거의 줄지 않습니다. 이득은 줄어드는 재지시와 정정이라 그 건수를 적게 했습니다. 메인이 짜던 Agent 지시문을 스킬로 옮기면 메인이 쓰던 출력이 입력 읽기로 바뀌고, 출력이 입력보다 비싸므로 그 몫만큼 줄어듭니다.
- 스크립트만 `~/.claude/scripts/`에 두면 Claude가 그 위치를 알 수 없어 `CLAUDE.md`에 위치를 알리는 줄이 필요하고, 그 줄은 세션마다 읽힙니다. 스킬은 평소 description만 읽히고 본문과 스크립트는 쓸 때만 읽힙니다. 그래서 스크립트만 두는 것은 훅이나 다른 스크립트가 부를 때로 한정했습니다.

## CLAUDE.md 정리 제안

- 공식 문서(https://code.claude.com/docs/en/memory)는 CLAUDE.md의 줄 수를 일정 아래로 두기를 권장하고, 규칙끼리 모순되면 Claude가 어느 쪽이든 고를 수 있다고 합니다. 회고가 쓰는 기준 줄 수와 정리 뒤 다시 제안하기까지의 여유는 이 권장을 따른 값이고, 값은 `RETRO.md`의 「반복 찾기」 가운데 CLAUDE.md 정리 항목에 있습니다.
- 줄 수는 회고 출력이 세고, 대상이 아니면 회고가 CLAUDE.md를 읽지 않습니다. 회고마다 파일 전체를 읽어 토큰을 쓰지 않으려는 것입니다.
- 줄이는 길은 옮기기입니다. `@<경로>`로 가져오는 파일은 세션 시작 때 본문이 통째로 읽혀 줄 수만 옮겨 갈 뿐 문맥은 줄지 않으므로 쓰지 않습니다. 별도 문서는 CLAUDE.md의 한 줄 조건을 보고 Claude가 필요할 때만 읽고, 경로 한정 규칙(`paths:`)은 그 경로의 파일을 다룰 때만 읽힙니다.
- 키트 원칙은 사용자 CLAUDE.md 밖의 `rules/kit-*.md`에 있어 정리 대상이 아닙니다. 사용자 CLAUDE.md는 그 사람의 정책 문서라 고치기 전에 묻고 백업합니다.

## 회고 알림 시점

- 회고할 때인지는 메인이 맡긴 작업 하나를 마치고 최종 보고를 할 때 `--due`를 직접 돌려 확인하고, 묻는다면 그 보고 끝에서 묻습니다(개인용은 묻지 않고 뒤에서 회고를 띄웁니다). 세션을 열 때 훅으로 알리거나 묻지 않습니다. 일을 시작하기 전에 끼어드는 질문이 불편했기 때문입니다.

## 직군을 더할 때 이미 있는 일 이름

처음 설치에서 여러 직군을 고르면 같은 일 이름이 두 칸에 있을 때 높은 칸에 둡니다. 설치한 뒤에 직군을 더할 때는 이미 있는 일 이름의 칸과 표시는 그대로 두고 새 이름만 더합니다. 회고로 실측한 칸이 출발 표의 추정보다 정확하기 때문입니다. 사용자가 표에서 뺀 이름(`removedKinds`)은 더하지 않고 다시 넣을지 묻고, 표에 `<이름>[기준]` 꼴 칸이 있는 이름은 회고가 쪼갠 옛 이름이라 묻지도 더하지도 않습니다(SUBAGENT_GUIDE의 `--remove-kind` 줄). 높은 칸을 따르면 내려 보기로 줄인 칸이 다시 올라가고 「(고정)」과 최저선이 지워질 수 있습니다.

## 메인 세션 설정

- 메인 모델을 Opus 5.5 high로 권하는 것은 메인이 정의를 잘못 고르거나 근거 없는 결과를 받아들여도 알려 줄 신호가 없어서입니다. xhigh는 위 측정 때문에 권하지 않습니다. 설정은 `/model claude-opus-5-5`와 `/effort high`입니다. Anthropic API가 아니면 `/model` 화면에서 Opus 5.5를 고릅니다.
- autocompact(문맥이 차면 대화를 요약해 줄이는 기능)를 400k에서 600k 사이로 정하기를 권하는 것은 Opus 5.5의 문맥 창이 100만 토큰이라 40~60%이기 때문입니다. 요청마다 대화 전체를 캐시에서 다시 읽고 캐시가 만료되면 대화 전체를 다시 쓰므로, 문맥이 길수록 요청당 비용과 만료 때 비용이 커집니다. 1M 문맥을 쓰고 정하지 않으면 약 967K에서 압축됩니다. `CLAUDE_CODE_DISABLE_1M_CONTEXT`로 1M 문맥을 끄면 Claude Code가 압축 창을 200K로 묶어 400k를 정해도 효과가 없어서, 그때는 autocompact를 권장값 판정에서 뺍니다.
- 프로젝트 설정에 최상위 `model` 키가 있거나 `ANTHROPIC_MODEL`이 있으면 `/model claude-opus-5-5`는 그 세션에만 쓰이고 다음 실행에서는 그 값으로 돌아갑니다(https://code.claude.com/docs/en/model-config 의 「A new session starts on a different model than you picked」). 그래도 모델은 effort와 달리 판정을 바꾸지 않고 명령도 그대로 권하며, 그 파일, 키, 값과 「이 세션에만 쓰인다」는 한 줄만 덧붙입니다. 이 세션을 Opus 5.5로 돌리는 데는 명령이 맞고, 그 한 줄이 다음 실행에서 되돌아가는 까닭을 알려 주기 때문입니다.
- 설정은 Claude Code에서 `/autocompact 400k`처럼 칩니다. 값은 현재 모델의 사용자 설정(`modelSettings`)에 저장됩니다(v2.1.288 이상. 그 전에는 모든 모델에 하나로 최상위 `autoCompactWindow`에 저장했습니다. 출처 https://code.claude.com/docs/en/model-config ). `~/.claude/settings.json`에 직접 적으려면 `"modelSettings": { "claude-opus-5-5": { "autoCompactWindow": 400000 } }`처럼 숫자로 적습니다(v2.1.288 이상).
- 프로젝트 `.claude/settings.json`이나 `.claude/settings.local.json`에 effort나 autocompact를 정하는 키가 있으면 그 항목은 판정하지 않고 명령도 권하지 않습니다. 프로젝트 설정이 사용자 설정보다 먼저 적용되므로(https://code.claude.com/docs/en/settings 의 「Settings precedence」) `/effort`와 `/autocompact`로 저장한 값이 가려져, 명령을 권해도 바뀌지 않고 업데이트 때마다 같은 권고가 나올 수 있습니다. 키 종류(`modelSettings`, 최상위 키)와 파일에 따라 어느 값이 이기는지가 갈리고 autocompact의 파일 사이 순서는 확인하지 못해, 값을 읽어 판정하는 대신 키가 있으면 판정하지 않기로 했습니다. `env`의 변수는 APPLY_GUIDE의 「전제 확인」에서 하는 환경변수 찾기가 먼저 처리합니다.
- 환경변수 `CLAUDE_CODE_EFFORT_LEVEL`은 쓰지 않습니다. 정의의 effort보다 먼저라 모든 서브에이전트가 같은 effort로 돕니다. `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`도 같은 까닭으로 쓰지 않습니다. `CLAUDE_CODE_AUTO_COMPACT_WINDOW`는 토큰 수 정수만 받고 `/autocompact`와 설정값보다 먼저 적용돼 `/autocompact`로 바꿀 수 없어서 쓰지 않습니다.
- effort 상한 `maxEffortLevel`은 `/effort`, `CLAUDE_CODE_EFFORT_LEVEL`, 정의의 effort에 모두 걸립니다(https://code.claude.com/docs/en/settings-reference 의 `maxEffortLevel`). 지금 값이 상한보다 높으면 상한으로 돌아서 상한을 지금 값으로 봅니다(상한 high에 저장값 xhigh면 high로 도니 권장값입니다). 상한이 high보다 낮으면 `/effort high`를 권해도 상한으로 돌아 바뀌지 않으므로, 그 항목은 판정하지 않고 명령도 권하지 않고 파일, 키, 값만 알립니다. 어느 설정 파일에 있든 걸리고 여러 곳이면 가장 낮은 값이 쓰여, 프로젝트 설정 키처럼 읽는 순서를 따지지 않고 값만 봅니다.

## 비용 기록

비용을 SubagentStop 훅으로 적는 것은 Claude Code가 서브에이전트별 비용을 주지 않기 때문입니다. 상태줄과 `/usage`는 세션 합계이고, OpenTelemetry는 직접 만든 정의를 `custom` 하나로 묶습니다. 결과에 붙는 「토큰」은 마지막 요청이 읽은 대화 길이라 쓴 양이 아닙니다.

agent-meter는 `~/.claude/subagent-system/rates.json`(`CLAUDE_CONFIG_DIR`이 있으면 그 폴더)을 읽어 요율을 한 곳으로 모읍니다. 파일이 없거나 깨졌을 때만 mod에 든 내장 요율을 쓰므로, subagent-system을 지워도 agent-meter는 돕니다. 한 요청 안에 5분과 1시간 캐시 쓰기가 섞여도 엔진이 둘을 가르는 값을 주지 않아 한쪽 요율로 계산합니다.

## 자동 회고의 권한 확인 창

회고 서브에이전트가 `~/.claude` 아래 파일을 고칠 때 확인 창이 뜰 수 있는 근거는 공식 문서(https://code.claude.com/docs/en/permission-modes, 「Protected paths」)입니다. 「Writes to a small set of paths are never auto-approved, except in `bypassPermissions` mode and in interactive terminal sessions in plan mode with bypass permissions available.」라고 하고, 모드별 보호 경로 쓰기는 이렇게 정리되어 있습니다.
- `default`, `acceptEdits`는 확인 창이 뜹니다(Prompted).
- `auto`는 분류기가 판단합니다(Routed to the classifier).
- `dontAsk`는 거부됩니다(Denied).
- `bypassPermissions`는 확인 없이 씁니다(Allowed).

설정 파일의 `permissions.allow`로는 미리 허용할 수 없습니다. 「`permissions.allow` rules in settings files do not pre-approve protected-path writes.」입니다. 확인 창은 회고가 백그라운드여도 메인 세션에 뜹니다(https://code.claude.com/docs/en/sub-agents, 「Background subagents surface every permission prompt in your main session.」). 확인 창에서 거부하면 그 도구 호출만 거부되고 서브에이전트는 멈추지 않습니다(같은 문서의 「Esc to deny that one tool call without stopping the subagent」). 정의는 막히면 `BLOCKED`로 보고하도록 되어 있어 보통 그렇게 끝납니다. 창에는 `~/.claude` 편집을 이 세션 동안 허용하는 선택지가 나오는 모드가 있습니다(「Yes, and allow Claude to edit files in its ~/.claude folder for this session」).

## 정의 변경이 반영되는 때

정의 파일의 수정과 새 정의는 몇 초 안에 반영됩니다. 공식 문서(https://code.claude.com/docs/en/sub-agents, 「Write subagent files」 아래 설명)에 「Claude Code watches `~/.claude/agents/` and `.claude/agents/`. When you add or edit a subagent file on disk, or ask Claude to write one for you, Claude Code detects the change within a few seconds and the next delegation uses the updated definition, with no restart needed.」라고 적혀 있습니다. 재시작이 필요한 경우는 세션을 시작할 때 없던 `agents` 폴더를 새로 만든 때, `--add-dir`로 추가한 폴더, `--disable-slash-commands`로 시작한 세션입니다.
