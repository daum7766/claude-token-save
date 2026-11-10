#!/usr/bin/env node
/**
 * Stop 훅. 메인이 멈추려 할 때 할 일이 남았는데 멈추는 꼴 셋을 막는다.
 *
 * 무엇을:
 *  - 실무자 기다림: 뒤에서 도는 실무자가 있는데 깨우는 예약(<check-in>으로 시작하는 CronCreate 예약)이 없으면, 예약을 건 뒤 멈추게 한다.
 *    이름 붙인 실무자(teammate)가 있으면 15분마다, 이름 없는 실무자만 있으면 60분 뒤 한 번 울리는 예약을 걸게 한다.
 *  - 예약 정리: 도는 실무자가 없는데 깨우는 예약이 남았으면 지우게 한다. 사용자가 건 예약(/loop 등)은 건드리지 않는다.
 *  - 결과 늦음과 멈춘 듯: 끝난 이름 붙인 실무자의 끝 메시지가 안 닿았으면 그 마지막 답을 실어 알리고, 기록이 20분 넘게 그대로인 실무자는 거두게 한다.
 *  - 이어 하기: 답 끝 「다음」에 AI 할 일이 남았고 사용자 몫이 없고 도는 일도 없으면, 멈추지 말고 이어 하게 한다.
 *    사용자 몫이 push나 배포 지시뿐이면 AI 할 일을 막지 않는 따로 기다림이라 몫이 없는 것으로 본다.
 *  - 결정 알림: 답에 ②정할 것이나 ⑦선택지가 새로 생겼는데 이번 차례에 PushNotification을 부르지 않았으면, 한 번 막아 휴대폰 알림을 보내게 한다.
 *    논의 잠금과 상관없이 본다(결정은 물음 차례에도 생겨서). 같은 결정은 한 번만 조른다.
 *  - 결정 대기 중 이어 하기: 정할 것을 올린 답은 「다음」 AI 줄을 `AI(답과 별개)`와 `AI(답 뒤)`로 나눠 적게 하고, 답과 별개 줄이 남았으면 멈추지 않고 이어 하게 한다.
 *  - 열린 칸 대조: 이번 세션이 고친 진행 기록(기본 `docs/plan/work/`, 설정 `progressDirs`로 더한 폴더)의 AI 몫 남은 일(열린 칸 `- [ ]`와 「남은 물음」, 「남은 일」, 「남은 것」 절 항목)이 최종 보고의 「다음」 칸에 하나도 안 보이면 한 번 막는다.
 *    지적 없이는 남은 일을 먼저 꺼내지 않아 사용자가 「더 없어?」를 물었고(정정 7번), 점검 목록 문장으로 시킨 것이 듣지 않아서 기계로 대조한다.
 *  - 남은 일 수: 「다음」 칸이 있는 끝 보고에 「남은 일 N건」 줄이 없는데 이번 세션이 30분 안에 고친 진행 기록에 닫히지 않은 AI 몫 줄이 있으면, 그 수와 진행 기록별 목록을 실어 한 번 막는다.
 *    실무자가 도는 동안의 끝 보고도 본다. 보고가 바로 다음 한두 가지만 보여 대표가 「이거만 하면 끝이야?」를 되물었다(11-08 두 번, 결정 「끝 보고의 남은 일」).
 * 왜(결정): 본문으로 선택지를 받으면 질문 창이 뜨지 않아 휴대폰에 아무것도 가지 않았고, 정할 것이 있으면 답과 상관없는 일까지 멈췄다(2026-11-08 사용자 지적).
 *   답에 걸리는지를 자유 문장으로 짐작하면 낱건 오탐 고침이 되풀이되어(11-06~08 이 파일 고침 6번) 표지 줄만 읽는다.
 * 왜: 2026-10-29~11-06 대화 기록에서 사용자 입력 없이 이어 했어야 할 시간이 약 830분이었다. 이름 붙인 실무자의 끝 메시지가 8시간 늦게 닿았고
 *   멈춘 실무자를 「도는 중」으로 믿고 기다렸으며(11-05, 약 490분), 「AI: 5단계 2번을 시작합니다, 대표: 없음」으로 보고하고 멈췄다(11-06, 226분).
 *   예약은 메인이 쉬는 동안에만 울려 알림이 늦어도 메인을 깨운다. 이름 없는 실무자는 끝 알림이 늦은 적이 없어(885건) 멈춘 경우만 잡는 한 번짜리로 둔다.
 *   깨울 때마다 메인 문맥 전체를 다시 읽어서다. 뒤 명령(shell)은 지연이 1~9분이라 예약으로 앞당길 수 없어 세지 않는다.
 * 구조(뿌리): 실무자 상태(돎, 뒤 작업 기다림, 쉼)와 걸린 깨우기 예약을 판정마다 따로 읽고 짐작하면 같은 상태를 엇갈려 판정한다
 *   (예약 지움과 예약 걸기가 번갈아 나왔고 이름 없는 한 번짜리 예약을 못 알아봤다, 11-08). 그래서 check는 workers(실무자 상태)와 wakeups(예약)를
 *   한 번씩만 판정하고, 예약 걸기, 예약 지우기, 이어 하기, 멈춘 듯이 그 결과를 함께 쓴다. 새 상태는 workers에만 더한다.
 * 전제:
 *  - 뒤 작업을 기다리는 서브에이전트(차례를 끝냈는데 자기가 띄운 뒤 작업이 돌아 끝 알림이 「is waiting on its own background work」로 오는 것)는
 *    돌고 있는 실무자와 같이 기다리는 대상이다. 입력 status가 waiting이거나, 대화 기록의 마지막 알림이 그 문구면 그렇게 본다(기억은 상태 파일 waits).
 *    기록이 4시간 넘게 그대로면 잃은 것으로 보고 세지 않는다. 기다리는 중에는 기록이 자라지 않으므로 멈춘 듯으로 알리지 않는다.
 *    그 실무자 기록(subagents/agent-<id>.jsonl)에 끝나지 않은 뒤 작업(끝 알림 없는 셸과 실무자, 만료 전 Monitor)이 없거나 기록을 못 읽으면 기다리지 않는다
 *    (하네스가 남은 Monitor 만료 뒤 끝 알림을 다시 보내지 않아, 끝난 실무자를 4시간 기다림으로 세었다, 11-09).
 *  - 깨우는 예약은 `<check-in>`으로 시작하는 예약이다. 다른 한 번짜리 예약(recurring false)도 메인을 깨우므로 새 예약을 요구하지 않되, 지우지는 않는다.
 *  - 열린 칸 대조는 이번 세션이 Edit, Write나 쓰는 꼴의 셸 명령으로 고친 진행 기록 폴더(기본 `docs/plan/work`, config.json `progressDirs`로 더함)의 `.md`만 본다.
 *    프로젝트마다 진행 기록 자리가 달라서(키트 기본은 `docs/plan/work`, 어떤 프로젝트는 `docs/_temp`) 자리는 코드에 박지 않고 설정으로 더한다. 하위 폴더도 본다.
 *    막을 때마다 hook-blocks.tsv에 「멈춤 검사 <판정 이름>」 줄을 남기고, 막은 뒤 답이 그대로 다시 나오면(이어 하기, 열린 칸 대조, 결정 대기 표시) hook-false-positive.tsv에 「통과」 줄을 남긴다. 회고의 낭비 보기가 헛막음을 재려는 것이다.
 *    TaskStop으로 멈춘 실무자는 대화 기록의 TaskStop 성공 결과를 읽어 뒤 작업 기다림 기억에서 지운다(안 지우면 멈춘 실무자를 4시간 기다린다). 칸 주인은 줄 머리(첫 쌍점, 여는 괄호, 줄표 앞 30자)만 보고,
 *    머리에 대표, 사용자, 기다림, push, 배포가 든 칸과 날짜를 앞세운 칸(「11-10: …」), 「(풀림)」은 AI 몫으로 세지 않는다. 뒤쪽 글이 「대표 물음」이나 「기다림」을 인용해도 AI 몫이다.
 *    답에 적힌 것으로 치는 기준: 칸의 핵심 낱말(괄호 속 보충 제외, 한글은 앞 두 글자)이 두 개 이상, 그리고 40% 이상 「다음」 칸 글(기다림 줄 포함)에 나오면 적은 것이다.
 *    「다음」 칸이 없는 답은 CLOSING_MIN자 이상이면 끝맺음 답으로 보고 답 전체를 그 글로 본다. 「기다림:」 줄이 있어도 기다리는 것과 상관없는 칸이 「다음」 칸에 없으면 막는다
 *    (기다림 줄을 면제하면 「기다림: 대표님의 다음 지시」로 끝난 답 셋이 모두 빠져, 정정 7건 가운데 3건을 놓쳤다). 사용자 줄이 사용자에게 답을 청하는 답과 정할 것이 든 답은 막지 않는다.
 *    같은 남은 일 묶음으로는 세션에 한 번만 막는다. 진행 기록 폴더가 없는 설치에서는 아무것도 막지 않는다.
 *  - 하네스가 Stop 입력에 background_tasks(id, type: shell, subagent, teammate, monitor, workflow, status, description)와
 *    session_crons(id, schedule, recurring, prompt)를 준다(Claude Code 2.1.319에서 확인). 이 칸이 없는 판에서는 세 검사를 모두 건너뛴다.
 *    쉬는 teammate도 status running으로 남아, 그 실무자 기록(설명마다 가장 늦게 생긴 것)의 마지막 답이 끝맺음이면 쉬는 것으로 본다.
 *    쉬는데 메인 기록에 그 실무자 메시지가 끝맺은 뒤로 없으면 「결과 늦음」으로 한 번 알린다.
 *  - 「다음」 칸의 꼴은 보고 모양(kit-rec-report ⑧)을 따른다: `다음` 머리 줄 아래 AI 줄과 사용자 줄. 꼴이 다르면 이어 하기는 건너뛴다.
 *    조건이 걸린 할 일(「답을 받으면」, 「고르시면」, 「받는 대로」)과 `기다림:` 줄을 쓴 답, ②정할 것이나 ⑦선택지가 든 답은 기다릴 까닭이 있는 것으로 본다.
 *  - 사용자가 물은 차례(논의 중)에는 이어 하기를 하지 않는다. 설치본이 논의 잠금 훅을 두면 config.json `turnLockHook`에 그 모듈 경로를 적고,
 *    그 모듈의 isTurnLocked(세션, 기록 경로)가 차례 상태를 지금 기록에 맞춰 답한다(두 훅이 함께 돌아 앞 차례 상태를 읽지 않게). 키가 없으면 잠금은 없는 것으로 본다.
 *  - 한 번 막은 뒤(stop_hook_active)에도 실무자 기다림과 예약 정리는 같은 상태로 한 번만 더 본다. 이어 하기는 답이 바뀌었을 때만, 한 줄기에 세 번까지 막는다.
 *    막은 기록은 임시 폴더 stall-check-<세션>.json에 둔다. 오류가 나면 아무것도 막지 않는다.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
// 셸 명령에서 쓴 파일 경로를 얻는 공용 풀이(결정 대조와 같은 규칙). 피드백 묶음이 없으면 옛 풀이로 돌아간다
let shellWrittenFiles = null;
try { ({ shellWrittenFiles } = require('./lib/shellWrites.cjs')); } catch { shellWrittenFiles = null; }

const CHECK_IN = '<check-in>';
const AGENT_TYPES = /^(?:subagent|teammate|workflow|in_process_teammate|local_agent|remote_agent)$/;
const LIVE = /^(?:running|pending)$/;
const STUCK_MIN = 20;
const LATE_GRACE_MS = 5 * 60000;
// 끝난 지 이보다 오래된 결과는 전문을 싣지 않고 이름, 끝난 시각, 첫 줄만 묶어 보인다. 메인이 이미 다른 길로 받았거나 뒤의 일이 담은 경우가 많아서다
// (11-08 한 세션에서 0시대에 끝난 실무자 8명의 결과가 몇 시간 뒤 하나씩 실려, 메인이 「늦게 닿은 결과는 … 새로 할 일은 없습니다」로 8번 답했다).
const STALE_MS = 60 * 60000;
// 「기다림:」 줄. 목록 꼴(- 기다림:, * **기다림:**)도 센다. 목록으로 쓴 줄을 못 알아봐 기다리는 답을 이어 하기로 막았다(11-08).
const WAIT_LINE = /(^|\n)\s*(?:[-*]\s*)?(?:\*\*)?기다림(?:\*\*)?\s*[:：]/;
const WAIT_NOTE = /is waiting on its own background work/;
// 뒤 작업을 기다리는 서브에이전트가 이보다 오래 소식이 없으면 잃은 것으로 보고 기다림에서 뺀다.
const WAIT_MAX_MS = 4 * 3600000;
const LONG_LIVED = /\b(?:dev|serve|preview|watch|start)\b|tail\s+-[fF]|--watch/;

// 남을 기다리는 조건(사용자 답, 실무자 결과)과 제 일의 순서(「커밋이 되면」)를 가른다. 뒤쪽은 같은 문장이 바로 하는 끝맺음이면 할 일로 본다(리뷰 2회차 4번).
const WAITS_ON = /(시면|오면|받으면|[을를] 받아|풀리면|쌓이면|정해지면|는 대로|기다|진행 중|돌고 있|도는 중|건이면)/;
const WAITS_SELF = /(끝나면|되면)/;
const NOW_VERB = /(시작합니다|띄웁니다|이어 갑니다|짭니다|만듭니다|고칩니다)\s*\.?\s*$/;
// 「다음」 칸이 없는 답도 이 길이 이상이면 끝맺음 답으로 보고 남은 일을 대조한다(11-08 최종 답 1516건 가운데 「다음」 칸이 없는 636건의 중앙값은 182자, 100자 아래는 한 줄 응답 155건).
const CLOSING_MIN = 100;
const NOTHING = /할 (?:일|것)(?:은|이)? ?(?:따로 )?없|하실 (?:일|것)(?:은|이)? ?(?:따로 )?없|^(?:지금은? |더 )?없(?:습니다|음|어요)|(?:모두|다) (?:끝냈|마쳤)습니다|대기합니다/;
const ASKS = /(골라|정해|답해|알려|말씀해|승인해|확인해) ?주세요|여쭙/;
const PARALLEL = /push|푸시|배포/i;
// 날짜를 정한 할 일과 배포 뒤에 할 일은 지금 이어 할 일이 아니다.
const LATER = /^(?:(?:\d{1,2}-\d{1,2}|\d{1,2}월 ?\d{1,2}일|내일|모레|다음 주)(?:에|부터|쯤)|(?:배포|push|푸시)\S{0,3} ?(?:뒤|후|되면))/i;

// 「다음」 머리 줄을 찾고, 그 아래에서 AI 줄과 사용자 줄의 내용(같은 줄 뒤와 들여쓴 아래 줄)을 꺼낸다.
const HEAD = /(?:^|\n)[ \t]*(?:#{1,4}[ \t]+)?(?:\*\*)?(?:⑧[ \t]*)?(?:\*\*)?다음(?:\([^)\n]*\))?(?:\*\*)?[ \t]*[:：]?[ \t]*(?:\*\*)?[ \t]*(?=\n)/g;
function nextItems(text) {
  const heads = [...text.matchAll(HEAD)];
  if (!heads.length) return null;
  const lines = text.slice(heads[heads.length - 1].index).split('\n').slice(1);
  const items = [];
  for (const line of lines) {
    const top = line.match(/^(?:[-*]|\d+\.)[ \t]+(?:\*\*)?([^:：*\n(]{1,24}?)[ \t]*(?:\(([^)\n]*)\))?(?:\*\*)?[ \t]*(?:[:：](?:\*\*)?[ \t]*(.*))?$/);
    if (top) { items.push({ who: top[1].trim(), tag: (top[2] || '').trim(), body: (top[3] || '').trim() }); continue; }
    if (/^\s+\S/.test(line) && items.length) { items[items.length - 1].body += `${items[items.length - 1].body ? '\n' : ''}${line.trim()}`; continue; }
    if (line.trim() === '' && items.length) continue;
    if (items.length) break;
  }
  return items;
}
const firstSentence = (s) => s.replace(/^[-*\d.\s]+/, '').split(/(?<=[.!?])\s/)[0];

// 정할 것과 선택지 칸의 항목. 실제 보고는 동그라미 번호 없이 쓰는 일이 많아(11월 대화 기록 머리 줄 72건 가운데 70건) 번호는 있어도 없어도 된다.
// 칸 이름 바로 뒤가 줄 끝, 괄호, 굵은 글씨 끝, 쌍점일 때만 머리 줄로 본다(「② 정할 것이 없어 …」 같은 문장은 안 걸림). 머리 줄에 붙여 쓴 내용도 본문으로 넣는다.
// 다른 머리 줄(동그라미 번호, 굵은 글씨만인 줄, ## 줄, 「다음」)에서 칸을 끝낸다. 정할 것은 맨 앞 목록 줄마다 한 항목, 선택지는 칸 전체를 한 항목으로 본다.
const SECTION = /^[ \t]*(?:#{1,4}[ \t]*)?(?:\*\*)?[ \t]*(?:[①-⑧][ \t]*)?(?:\*\*)?[ \t]*(?:남은 |새로 |새 )?(정할 것|결정할 것|선택지)(?:[ \t]*\d+(?:\/\d+)?)?(?=[ \t]*(?:\*\*|[:：(（.]|$))(.*)$/;
const OTHER_HEAD = /^[ \t]*(?:#{1,4}[ \t]+\S|(?:\*\*)?[ \t]*[①-⑧]|\*\*[^*\n]+\*\*[ \t]*[:：]?[ \t]*$)/;
// 굵은 질문 줄(「**Q1/1. 운영 DB에 적용할까요?**」)은 한 번에 하나씩 묻는 꼴의 결정 자체라 머리 줄로 보지 않는다.
const QUESTION = /^[ \t]*(?:\*\*)?[ \t]*(?:Q\d+(?:\/\d+)?\b|[^\n]*\?[ \t]*(?:\*\*)?[ \t]*$)/;
const OPTION = /^(?:[a-zA-Z가-하][).]|\(?[a-zA-Z]\))\s|^(?:지금 상황|얻는 것|잃는 것|추천|까닭|이유|근거)\s*[:：]/;
const EMPTY = (body) => body.length <= 60 && /없(?:음|습니다|어요|다)/.test(body.split('\n')[0]);
function decisionSections(text) {
  const out = [];
  let cur = null;
  const flush = () => {
    if (!cur) return;
    const body = cur.lines.join('\n').trim();
    if (body && !EMPTY(body)) {
      const tops = cur.lines.filter((l) => /^(?:[-*]|\d+\.)\s+\S/.test(l)).map((l) => l.replace(/^(?:[-*]|\d+\.)\s+/, '').replace(/\*\*/g, '').trim());
      const qs = cur.lines.filter((l) => /^[ \t]*(?:\*\*)?[ \t]*Q\d+(?:\/\d+)?\b/.test(l)).length;
      const real = tops.filter((t) => !OPTION.test(t));
      out.push({ kind: cur.kind === '선택지' ? '선택지' : '정할 것', count: qs || real.length || 1, items: cur.kind === '선택지' || !tops.length ? [body.slice(0, 400)] : tops, lines: cur.lines });
    }
    cur = null;
  };
  for (const line of String(text || '').split('\n')) {
    const m = line.match(SECTION);
    if (m) {
      flush();
      cur = { kind: m[1], lines: [] };
      const rest = m[2].replace(/[(（][^)）\n]*[)）]/g, '').replace(/\*\*/g, '').replace(/^[ \t:：]+/, '').trim();
      if (rest) cur.lines.push(rest);
      continue;
    }
    if ((OTHER_HEAD.test(line) && !QUESTION.test(line)) || HEAD_LINE.test(line)) { flush(); continue; }
    if (cur) cur.lines.push(line);
  }
  flush();
  return out;
}

// 새 결정인지 가리는 지문 거리(정할 것 항목과 선택지 칸 모두).
const decisionItems = (text) => decisionSections(text).flatMap((x) => x.items);
// 같은 결정인지는 줄마다 괄호 덧말, 굵게, 앞 번호를 떼고 앞 40자만 남긴 머리로 가린다(선택지 칸은 보기 줄마다).
// 왜: 글 전체 해시로 가리니 열린 결정을 덧말만 바꿔 다시 적을 때마다 새 결정으로 보고 막아, 한 결정이 하루 15번 휴대폰 알림으로 갔다(11-09, 바퀴 13 판정 막음 1).
const decisionKey = (item) => String(item).split('\n')
  .map((l) => l.replace(/[(（][^)）\n]*[)）]/g, '').replace(/\*\*/g, '').replace(/^[\s\-*\d.)]+/, '').replace(/\s+/g, ' ').trim().slice(0, 40))
  .filter(Boolean).join('\n');
// 알림에 적을 결정 수. 선택지는 정할 것을 고르는 꼴이라 정할 것이 있으면 따로 세지 않는다.
function decisionCount(text) {
  const secs = decisionSections(text);
  const n = secs.filter((x) => x.kind === '정할 것').reduce((a, x) => a + x.count, 0);
  return n || (secs.length ? 1 : 0);
}
const HEAD_LINE = /^[ \t]*(?:#{1,4}[ \t]+)?(?:\*\*)?다음(?:\([^)\n]*\))?(?:\*\*)?[ \t]*[:：]?[ \t]*(?:\*\*)?[ \t]*$/;
const AI_WHO = /^(?:AI(?:가 할 일| 몫)?|저|제가 할 일|제 몫)$/;
const FREE = /답과 ?별개/;
const AFTER = /답 ?뒤|답을? 받은 ?뒤/;
// 남을 기다리는 말과 제 일의 순서 말은 기존 판정과 같이 거른다(「실무자 결과를 기다립니다」를 이어 하기로 막지 않게).
const realWork = (x) => {
  if (!x.body) return false;
  const a = firstSentence(x.body);
  return !NOTHING.test(a) && !WAITS_ON.test(a) && !(WAITS_SELF.test(a) && !NOW_VERB.test(a)) && !LATER.test(x.body.trim());
};
// 정할 것을 올린 답의 「다음」 AI 줄 가운데 답과 별개인 일이 남았나(free), 표지 없이 할 일만 적었나(unlabeled).
function decisionWait(text) {
  const items = nextItems(text) || [];
  const ai = items.filter((x) => AI_WHO.test(x.who) && realWork(x));
  return { free: ai.some((x) => FREE.test(x.tag)), unlabeled: ai.length > 0 && !ai.some((x) => FREE.test(x.tag) || AFTER.test(x.tag)) };
}

function leftoverWork(text) {
  if (!text || /hit your .*limit|사용 한도/.test(text)) return false;
  if (decisionItems(text).length) return decisionWait(text).free;
  if (WAIT_LINE.test(text)) return false;
  const items = nextItems(text);
  if (!items) return false;
  const ai = items.find((x) => AI_WHO.test(x.who));
  const user = items.find((x) => /^(?:대표|사용자)/.test(x.who));
  if (!ai || !ai.body) return false;
  const a = firstSentence(ai.body);
  if (NOTHING.test(a) || WAITS_ON.test(a) || LATER.test(ai.body.trim()) || (WAITS_SELF.test(a) && !NOW_VERB.test(a))) return false;
  if (!user) return true;
  // push와 배포 지시는 AI 할 일과 따로 기다리는 몫이라 사용자 몫에서 뺀다(2026-11-07 「진행합니다」 뒤 대표 줄에 push 지시만 있어 두 번 멈춤).
  const parts = user.body.split(/(?<=[.!?])\s+|\n/).filter((x) => x.trim() && !PARALLEL.test(x));
  if (user.body && !parts.length) return true;
  // 사용자에게 묻는 문장은 몫 전체에서 찾되, 「~시면 말씀해 주세요」 같은 조건부 안내는 묻는 것으로 보지 않는다.
  const asks = parts.some((x) => ASKS.test(x) && !/시면/.test(x));
  return !!user.body && NOTHING.test(firstSentence(parts.join(' '))) && !asks;
}

const stateFile = (sid) => path.join(os.tmpdir(), `stall-check-${String(sid || 'none').replace(/[^\w-]/g, '')}.json`);
function readState(sid) { try { return JSON.parse(fs.readFileSync(stateFile(sid), 'utf8')); } catch { return {}; } }
function writeState(sid, s) { try { fs.writeFileSync(stateFile(sid), JSON.stringify(s)); } catch { /* 반복 막기 상한만 빠진다 */ } }

// 설치본의 논의 잠금 훅이 이 차례를 잠갔나. 훅 이름과 상태 파일 꼴은 설치본 몫이라 config.json `turnLockHook`이 가리키는 모듈에 묻는다.
function lockedTurn(input) {
  if (!input.session_id) return false;
  const cfgDir = process.env.CLAUDE_CONFIG_DIR || path.join(process.env.HOME || '', '.claude');
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(cfgDir, 'subagent-system', 'config.json'), 'utf8'));
    if (!cfg.turnLockHook) return false;
    const mod = require(cfg.turnLockHook.replace(/^~(?=\/)/, process.env.HOME || ''));
    return typeof mod.isTurnLocked === 'function' && mod.isTurnLocked(input.session_id, input.transcript_path) === true;
  } catch { return false; }
}

function lastAssistantText(transcriptPath) {
  try {
    const lines = tailLines(transcriptPath);
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"assistant"')) continue;
      let o;
      try { o = JSON.parse(lines[i]); } catch { continue; }
      if (o.type !== 'assistant' || o.isSidechain || !Array.isArray(o.message?.content)) continue;
      const t = o.message.content.filter((x) => x.type === 'text').map((x) => x.text).join('\n');
      if (t.trim()) return t;
    }
  } catch { /* 없음 */ }
  return '';
}

// 이름 붙인 실무자(teammate)는 일을 마치고 쉬어도 목록에 status running으로 남는다(2026-11-06 실제 입력). 그 실무자 기록의
// 마지막 답이 끝맺음(end_turn)이면 쉬는 것으로 본다. 기록은 <대화 기록>/subagents/agent-*.jsonl, 곁의 meta.json의 description으로 짝짓는다.
function lastEntry(file) {
  try {
    const size = fs.statSync(file).size;
    const len = Math.min(size, 65536);
    const buf = Buffer.alloc(len);
    const fd = fs.openSync(file, 'r');
    try { fs.readSync(fd, buf, 0, len, size - len); } finally { fs.closeSync(fd); }
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      try { const o = JSON.parse(lines[i]); if (o.type === 'assistant' || o.type === 'user') return o; } catch { /* 잘린 줄 */ }
    }
  } catch { /* 못 읽음 */ }
  return null;
}
const firstStamp = (file) => {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(4096);
    try { fs.readSync(fd, buf, 0, 4096, 0); } finally { fs.closeSync(fd); }
    return Date.parse(JSON.parse(buf.toString('utf8').split('\n')[0]).timestamp) || 0;
  } catch { return 0; }
};
// 설명마다 가장 늦게 생긴 실무자 기록 하나만 본다(거두고 같은 설명으로 다시 띄우는 일이 잦아서, 리뷰 2회차).
// 돌려주는 값: 설명 → {name, file, ended(끝맺은 시각 ms, 일하는 중이면 0), moved(기록이 마지막으로 바뀐 시각 ms)}.
function agentRecords(transcriptPath) {
  const out = new Map();
  if (!transcriptPath) return out;
  const dir = path.join(transcriptPath.replace(/\.jsonl$/, ''), 'subagents');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.meta.json')); } catch { return out; }
  for (const f of files) {
    let meta;
    try { meta = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
    if (!meta.description) continue;
    const file = path.join(dir, f.replace(/\.meta\.json$/, '.jsonl'));
    let born = firstStamp(file);
    if (!born) { try { born = fs.statSync(file).birthtimeMs; } catch { born = 0; } }
    const key = meta.description.trim();
    const had = out.get(key);
    if (had && had.born > born) continue;
    // 생긴 시각으로 가를 수 없으면 일하는 중으로 본다. 틀려도 예약이 하나 더 걸릴 뿐이다.
    if (had && had.born === born) { out.set(key, { ...had, ended: 0 }); continue; }
    const last = lastEntry(file);
    const ended = last?.type === 'assistant' && /^(?:end_turn|stop_sequence)$/.test(String(last.message?.stop_reason || '')) ? (Date.parse(last.timestamp) || 1) : 0;
    let moved = 0;
    try { moved = fs.statSync(file).mtimeMs; } catch { /* 없음 */ }
    out.set(key, { name: meta.name || '', file, born, ended, moved });
  }
  return out;
}
// 메인 기록 끝에 그 실무자의 메시지가 끝맺은 시각 뒤로 닿았나. 끝 메시지가 몇 시간 늦게 닿은 일이 있어서다(11-05 checklist-judge2, 8시간).
// 실무자가 끝맺기 직전에 직접 보낸 보고(agent-message)도 닿은 것으로 센다. 세지 않으면 이미 받은 보고를 또 실어 같은 보고가 두세 번 온다(11-07).
// 끝맺기 1분보다 앞선 보고는 중간 보고일 수 있어 세지 않는다(11-07 실측: 마지막 보고는 끝맺기 2~15초 전).
const SENT_BEFORE_END_MS = 60_000;
// 끝부분에서 못 찾으면 기록 전체에서 찾는다. 바쁜 세션은 몇 분 만에 끝부분(2MB)을 넘겨, 제때 닿은 보고를 몇 시간 뒤 늦은 결과로 다시 실었다
// (11-07 한 세션에서 늦은 결과로 실린 47명 가운데 45명은 끝맺은 지 1분 안에 메인에 닿아 있었다).
function delivered(transcriptPath, name, ended, tail) {
  const marks = [[`teammate_id=\\"${name}\\"`, 5000], [`agent-message from=\\"${name}\\"`, SENT_BEFORE_END_MS]];
  if (deliveredIn(tail, marks, ended)) return true;
  return deliveredIn(linesWith(transcriptPath, marks.map(([m]) => m)), marks, ended);
}
let fullRead = null;
// 기록 전체에서 표시 글자가 든 줄만 꺼낸다. 수십 MB라도 한 번 읽고 표시 자리 둘레만 자른다.
function linesWith(transcriptPath, needles) {
  let buf;
  try {
    // 한 번 멈출 때 여러 실무자를 보니 같은 크기면 읽은 것을 다시 쓴다.
    const size = fs.statSync(transcriptPath).size;
    if (!(fullRead && fullRead.path === transcriptPath && fullRead.size === size)) fullRead = { path: transcriptPath, size, buf: fs.readFileSync(transcriptPath) };
    buf = fullRead.buf;
  } catch { return []; }
  const out = [];
  for (const n of needles) {
    const nb = Buffer.from(n);
    for (let at = buf.indexOf(nb); at !== -1; at = buf.indexOf(nb, at + nb.length)) {
      const start = buf.lastIndexOf(10, at) + 1;
      let end = buf.indexOf(10, at);
      if (end === -1) end = buf.length;
      out.push(buf.toString('utf8', start, end));
      at = end;
    }
  }
  return out;
}
function deliveredIn(lines, marks, ended) {
  for (const line of lines) {
    const hit = marks.find(([mark]) => line.includes(mark));
    if (!hit) continue;
    try { if (Date.parse(JSON.parse(line).timestamp) >= ended - hit[1]) return true; } catch { /* 잘린 줄 */ }
  }
  return false;
}
// 실무자 기록의 마지막 답 글. 끝 메시지가 늦을 때 막는 글에 실어 메인이 바로 받게 한다.
function lastText(file, max = 4000) {
  const lines = tailLines(file, 400_000);
  for (let i = lines.length - 1; i >= 0; i--) {
    let o;
    try { o = JSON.parse(lines[i]); } catch { continue; }
    if (o.type !== 'assistant' || !Array.isArray(o.message?.content)) continue;
    const t = o.message.content.filter((x) => x.type === 'text').map((x) => x.text).join('\n').trim();
    if (t) return t.length > max ? `${t.slice(0, max)}\n…(뒤는 ${file} 끝에 있다)` : t;
  }
  return '';
}
function tailLines(transcriptPath, bytes = 2_000_000) {
  try {
    const size = fs.statSync(transcriptPath).size;
    const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len);
    const fd = fs.openSync(transcriptPath, 'r');
    try { fs.readSync(fd, buf, 0, len, size - len); } finally { fs.closeSync(fd); }
    return buf.toString('utf8').split('\n');
  } catch { return []; }
}

const hashOf = (s) => require('crypto').createHash('sha1').update(String(s).replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 12);
// 이번 차례(마지막 사용자 말이나 알림 뒤)에 PushNotification을 불렀나. 차례는 promptSource가 있는 사용자 줄이 연다(예약 깨우기는 isMeta와 함께 system을 가짐).
// 훅 되먹임 줄은 promptSource가 없어 차례를 새로 열지 않는다.
function pushedThisTurn(transcriptPath) {
  const lines = tailLines(transcriptPath);
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (l.includes('"PushNotification"')) {
      try { const o = JSON.parse(l); if (o.type === 'assistant' && !o.isSidechain && (o.message?.content || []).some((x) => x.type === 'tool_use' && x.name === 'PushNotification')) return true; } catch { /* 잘린 줄 */ }
    }
    if (l.includes('"promptSource"')) {
      try { const o = JSON.parse(l); if (o.type === 'user' && o.promptSource && !o.isSidechain) return false; } catch { /* 잘린 줄 */ }
    }
  }
  return false;
}

function oneShotIn(minutes, now = new Date()) {
  const t = new Date(now.getTime() + minutes * 60000);
  return `${t.getMinutes()} ${t.getHours()} ${t.getDate()} ${t.getMonth() + 1} *`;
}

// 대화 기록 줄에서 작업 알림(<task-notification>)을 순서대로 모은다. 도구 결과에 그 글이 인용된 줄은 알림이 아니라서 줄 머리가 알림인 것만 센다.
function taskNotes(lines) {
  const out = [];
  for (const l of lines) {
    if (!l.includes('<task-notification>')) continue;
    let o;
    try { o = JSON.parse(l); } catch { continue; }
    const c = typeof o.content === 'string' ? o.content : typeof o.message?.content === 'string' ? o.message.content : '';
    if (!c.trimStart().startsWith('<task-notification>')) continue;
    const id = (c.match(/<task-id>([^<]+)<\/task-id>/) || [])[1];
    const sum = (c.match(/<summary>([\s\S]*?)<\/summary>/) || [])[1];
    if (!id || sum === undefined) continue;
    const waiting = WAIT_NOTE.test(sum);
    out.push({ id: id.trim(), at: Date.parse(o.timestamp) || 0, waiting, desc: waiting ? ((sum.match(/"(.*)" is waiting/) || [])[1] || '') : '' });
  }
  return out;
}

// 메인이 TaskStop으로 멈춘 일. 대화 기록의 TaskStop 성공 결과(「Successfully stopped task: <id>」, toolUseResult.task_id)를 모은다.
// 멈춘 실무자는 끝 알림이 안 와서 기다림 기억에 남기 때문이다(11-08 바퀴 2 묶음 가를 07:28에 멈췄는데 4시간 더 기다리는 것으로 셈).
function stopNotes(lines) {
  const out = [];
  for (const l of lines) {
    if (!l.includes('Successfully stopped task')) continue;
    let o;
    try { o = JSON.parse(l); } catch { continue; }
    if (o.type !== 'user' || o.isSidechain) continue;
    const id = o.toolUseResult?.task_id || (JSON.stringify((Array.isArray(o.message?.content) ? o.message.content : []).filter((c) => c?.type === 'tool_result')).match(/Successfully stopped task: ([\w-]+)/) || [])[1];
    if (id) out.push({ id: String(id), at: Date.parse(o.timestamp) || 0 });
  }
  return out;
}

// 차례를 끝냈는데 자기가 띄운 뒤 작업이 돌아 기다리는 서브에이전트. 입력 status가 waiting이면 그대로 보고, 아니면(끝남으로 오는 판이 있다)
// 대화 기록의 마지막 알림이 「is waiting on its own background work」인 것을 상태 파일에 기억한다. 기억하지 않으면 알림이 읽는 끝부분에서 밀려난 뒤 다시 없는 것으로 판정한다.
// 돌고 있으면(running) 기억을 지운다. 끝나면 새 알림이 와서 다시 적히거나 끝 알림이 기억을 지운다.
function trackWaits(tasks, st, tail) {
  st.waits ||= {};
  // 알림과 TaskStop 결과를 시각 순으로 적용한다(멈춘 뒤에 다시 기다림 알림이 오면 다시 기다림으로 본다).
  const events = [...taskNotes(tail), ...stopNotes(tail).map((x) => ({ ...x, stopped: true }))].sort((a, b) => a.at - b.at);
  for (const n of events) {
    if (n.waiting) st.waits[n.id] = { desc: n.desc, at: n.at };
    else delete st.waits[n.id];
  }
  const out = [];
  for (const t of tasks) {
    const id = String(t.id);
    if (LIVE.test(String(t.status))) { delete st.waits[id]; continue; }
    if (/^waiting$/i.test(String(t.status)) && AGENT_TYPES.test(String(t.type))) out.push({ ...t, waiting: true });
  }
  for (const [id, w] of Object.entries(st.waits)) {
    if (out.some((x) => String(x.id) === id)) continue;
    const t = tasks.find((x) => String(x.id) === id);
    out.push({ ...(t || {}), id, type: t?.type || 'subagent', status: 'waiting', description: t?.description || w.desc, waiting: true, noted: w.at });
  }
  return out;
}

// 뒤 작업을 기다린다는 서브에이전트의 기록(<대화 기록>/subagents/agent-<id>.jsonl)에서 지금 끝나지 않은 뒤 작업 id를 모은다. 못 읽으면 null.
// 띄움은 도구 결과의 구조 칸(셸 backgroundTaskId, Monitor taskId와 timeoutMs, 실무자 async_launched agentId)으로, 끝은 그 id의 알림에 <status>가 붙은 것
// (Monitor event 알림은 status가 없고 감시가 이어진다)과 TaskStop 성공으로 본다. Monitor는 띄운 시각과 timeoutMs가 지나면 끝난 것으로 본다.
// 왜: 하네스는 마지막 알림을 「is waiting on its own background work」로 보내 놓고, 남은 Monitor가 만료돼도 끝 알림을 다시 보내지 않는다.
//   11-09 15:16Z에 끝난 실무자(남은 것은 5분짜리 Monitor 하나)를 그 뒤 4시간 기다림으로 세어 17:30Z에 헛막았다(57af3589). 지난 기록에서 마지막 알림이 기다림인 채 끝난 실무자 16명 가운데 6명은 15분 뒤 남은 뒤 작업이 없었고, 10명은 끝 알림 없는 셸이 남아 전처럼 4시간 상한으로 빠진다.
//   meta.json의 finished는 기다리며 쉴 때도 적혀(같은 실무자 meta가 기다림 알림과 같은 15:16:18Z에 바뀜) 끝난 표지로 쓰지 않는다.
//   기록 끝 32MB만 본다(실무자 기록이 1.8GB까지 커진 적이 있어 통째로 읽지 않는다). 지난 기다림 228번에서 마지막 뒤 작업을 띄운 자리는 기다림 시각 기록 끝에서 중앙값 27KB, 가장 먼 것 12.7MB였다. 그 앞에서 띄운 뒤 작업은 못 보아 기다리지 않는 쪽으로 기운다.
const BG_TAIL = 32 * 1024 * 1024;
function bgLeft(file, nowMs) {
  try { fs.statSync(file); } catch { return null; }
  const started = new Map();
  const ended = new Set();
  for (const l of tailLines(file, BG_TAIL)) {
    if (!/backgroundTaskId|"taskId"|async_launched|<task-id>|Successfully stopped task/.test(l)) continue;
    let o;
    try { o = JSON.parse(l); } catch { continue; }
    const at = Date.parse(o.timestamp) || 0;
    if (!at || at > nowMs || (o.type !== 'user' && o.type !== 'attachment')) continue;
    const r = o.toolUseResult;
    if (r && typeof r === 'object') {
      if (r.backgroundTaskId) started.set(String(r.backgroundTaskId), 0);
      if (r.taskId && r.timeoutMs !== undefined) started.set(String(r.taskId), r.persistent ? 0 : at + Number(r.timeoutMs || 0));
      if (r.status === 'async_launched' && r.agentId) started.set(String(r.agentId), 0);
      if (r.task_id && /Successfully stopped/.test(String(r.message || ''))) ended.add(String(r.task_id));
    }
    // 알림은 사용자 줄의 글(배열이면 text 조각)이나 붙임(queued_command)의 prompt로 온다. 도구 결과에 인용된 글은 보지 않는다.
    const c = o.message?.content;
    const body = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((x) => x?.type === 'text').map((x) => x.text).join('\n') : '';
    const note = [body, typeof o.attachment?.prompt === 'string' ? o.attachment.prompt : ''].join('\n');
    for (const m of note.matchAll(/<task-notification>([\s\S]*?)(?:<\/task-notification>|$)/g)) {
      const id = (m[1].match(/<task-id>([^<]+)<\/task-id>/) || [])[1];
      if (id && /<status>/.test(m[1])) ended.add(id.trim());
    }
  }
  return [...started].filter(([id, exp]) => !ended.has(id) && !(exp && exp <= nowMs)).map(([id]) => id);
}

// 실무자 상태를 한 번 판정한다. 예약 걸기, 예약 지우기, 이어 하기, 멈춘 듯, 결과 늦음이 모두 이 결과를 쓴다(판정마다 따로 읽으면 같은 상태를 엇갈려 본다).
// alive: 돌거나 뒤 작업을 기다리는 일 전부(뒤 명령, Monitor 포함). agents: 그 가운데 실무자이고 쉬는 것이 아닌 것. waiting 표지가 붙은 것은 뒤 작업을 기다리는 서브에이전트다.
function workers(input, st, now) {
  const tasks = Array.isArray(input.background_tasks) ? input.background_tasks : null;
  const none = { tasks, alive: [], agents: [], idle: new Set(), late: [], recs: new Map() };
  if (!tasks) return none;
  let tail = null;
  const tailOf = () => (tail ??= tailLines(input.transcript_path));
  const live = tasks.filter((t) => LIVE.test(String(t.status)));
  let waits = trackWaits(tasks, st, tailOf());
  const isAgent = (t) => AGENT_TYPES.test(String(t.type));
  const recs = live.some(isAgent) || waits.length ? agentRecords(input.transcript_path) : new Map();
  // 기록이 오래 그대로면 잃은 것으로 본다(끝나는 알림이 안 올 수 있어서, 예약이 끝없이 이어지지 않게).
  waits = waits.filter((t) => {
    const stamp = Math.max(t.noted || 0, recs.get(String(t.description || '').trim())?.moved || 0);
    return !stamp || now.getTime() - stamp <= WAIT_MAX_MS;
  });
  // 기록에 끝나지 않은 뒤 작업이 남은 것만 기다린다. 기록을 못 읽어 가를 수 없으면 기다리지 않는다(헛막음보다 예약 하나 덜 거는 쪽이 싸서다).
  const subDir = input.transcript_path ? path.join(String(input.transcript_path).replace(/\.jsonl$/, ''), 'subagents') : null;
  waits = waits.filter((t) => {
    const left = subDir ? bgLeft(path.join(subDir, `agent-${t.id}.jsonl`), now.getTime()) : null;
    if (left && left.length) return true;
    delete st.waits[String(t.id)];
    return false;
  });
  const alive = [...live, ...waits];
  const tms = live.filter((t) => /teammate/.test(String(t.type)));
  const idle = new Set();
  const late = [];
  for (const t of tms) {
    const d = String(t.description || '').trim();
    const rec = recs.get(d);
    if (!rec || !rec.ended || tms.filter((x) => String(x.description || '').trim() === d).length > 1) continue;
    const tag = `${rec.name}:${rec.ended}`;
    let seen = (st.got || []).includes(tag);
    // 닿은 것을 본 때 기억한다. 기억하지 않으면 대화가 길어져 그 줄이 읽는 끝부분에서 밀려난 뒤 같은 보고를 또 싣는다(11-07)
    if (!seen && delivered(input.transcript_path, rec.name, rec.ended, tailOf())) {
      seen = true;
      (st.got ||= []).push(tag);
    }
    // 끝맺은 지 얼마 안 됐으면 끝 알림이 곧 닿으니 마지막 답을 싣지 않고 기다리는 실무자로 둔다. 실으면 뒤이어 끝 알림이 또 닿아 같은 보고가 두 번 온다(11-07).
    if (!seen && now.getTime() - rec.ended < LATE_GRACE_MS) continue;
    idle.add(t);
    if (!seen) {
      late.push(rec);
      (st.got ||= []).push(tag);
    }
  }
  return { tasks, alive, agents: alive.filter((t) => isAgent(t) && !idle.has(t)), idle, late, recs };
}

// 깨우는 예약을 한 번 판정한다. 우리 예약(<check-in>)은 지울 수 있고, 다른 한 번짜리 예약은 메인을 깨우므로 새 예약을 요구하지 않되 지우지 않는다.
// 반복 예약(/loop 등)은 사용자 것이라 깨우는 예약으로 세지 않는다.
// 지울 수 있는 것은 이 훅이 걸게 한 예약(OWN_WAKE로 시작)뿐이다. AI가 다른 까닭으로 건 <check-in> 예약(정해 둔 때의 확인 같은)은 지우지 않는다(11-09 바퀴 13 판정 막음 2).
const OWN_WAKE = `${CHECK_IN} 뒤 작업 확인`;
function wakeups(crons) {
  const checkins = crons.filter((c) => String(c.prompt || '').startsWith(CHECK_IN));
  const others = crons.filter((c) => !String(c.prompt || '').startsWith(CHECK_IN) && c.recurring === false);
  const ours = checkins.filter((c) => String(c.prompt || '').startsWith(OWN_WAKE));
  return { checkins, ours, covered: checkins.length > 0 || others.length > 0 };
}

// 이번 세션이 고친 진행 기록. 상태 파일에 쌓아 두어 대화 기록 끝부분에서 밀려나도 잊지 않는다.
// 진행 기록은 Edit, Write보다 셸 명령(python 쓰기, sed -i, 리다이렉트)으로 고치는 일이 많아서(11-08 기록 세 세션 가운데 둘은 셸로만 고침) 쓰는 꼴의 셸 명령도 본다.
const SHELL_WRITES = /\.write\(|write_text|\bsed\s+-[a-zA-Z]*i|\btee\b|\bmv\b|>>?\s*(?!\/dev\/null)[~\/\w$"']/;
const cfgDirOf = () => process.env.CLAUDE_CONFIG_DIR || path.join(process.env.HOME || os.homedir(), '.claude');
// 진행 기록 폴더: 기본 docs/plan/work에 config.json progressDirs(프로젝트 루트 기준 상대 경로 배열)를 더한다. 설정이 없거나 깨져도 기본값은 남는다.
function progressDirs() {
  const dirs = ['docs/plan/work'];
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(cfgDirOf(), 'subagent-system', 'config.json'), 'utf8'));
    for (const d of Array.isArray(cfg.progressDirs) ? cfg.progressDirs : []) {
      const n = typeof d === 'string' ? d.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '').replace(/^\/+|\/+$/g, '') : '';
      if (n && !n.includes('..') && !dirs.includes(n)) dirs.push(n);
    }
  } catch { /* 기본값만 */ }
  return dirs;
}
const escRe = (d) => d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isWorkFile = (f, dirs) => { const n = String(f).replace(/\\/g, '/'); return n.endsWith('.md') && dirs.some((d) => n.includes(`/${d}/`)); };
function shellWorkFiles(cmd, cwd, dirs = progressDirs()) {
  if (!dirs.some((d) => cmd.includes(d))) return [];
  const w = shellWrittenFiles ? shellWrittenFiles(cmd, cwd) : null;
  return w ? w.filter((f) => isWorkFile(f, dirs)) : shellWorkFilesOld(cmd, cwd, dirs);
}
function shellWorkFilesOld(cmd, cwd, dirs) {
  if (!SHELL_WRITES.test(cmd)) return [];
  const home = process.env.HOME || '';
  const out = new Set();
  for (const d of dirs.map(escRe)) {
    for (const m of cmd.matchAll(new RegExp(`((?:~|\\/)[^\\s'"\`;|&()<>]*?${d}\\/)([\\w.\\-\\/]+\\.md)`, 'g'))) out.add(m[1].replace(/^~(?=\/)/, home) + m[2]);
    if (cwd) for (const m of cmd.matchAll(new RegExp(`(?<![\\w\\/~.-])(${d}\\/)([\\w.\\-\\/]+\\.md)`, 'g'))) out.add(path.join(cwd, m[1] + m[2]));
    // `cd ~/.claude/docs/plan/work` 뒤에 파일 이름만 적은 명령
    const cd = cmd.match(new RegExp(`\\bcd\\s+((?:~|\\/)[^\\s;&|'"]*${d})(?![\\w\\/])`));
    if (cd) for (const m of cmd.matchAll(/['"]([\w.\-]+\.md)['"]/g)) out.add(path.join(cd[1].replace(/^~(?=\/)/, home), m[1]));
  }
  return [...out];
}
// 이번 세션이 고친 진행 기록을 대화 기록에서 찾아 st.workFiles(열린 칸 대조)에 더한다.
// 한 번 읽은 곳(st.workScan.offset)은 다시 읽지 않고 그다음부터 읽는다. 끝 2MB만 읽던 때는 긴 세션에서 앞서 고친 기록이 밀려나 빠졌다.
// 왜: 열린 칸 대조가 Stop마다 끝 2MB만 읽었고, 2MB 앞에서 고친 진행 기록은 놓쳤다(바퀴 7 판정).
// 전제: 대화 기록은 줄을 덧붙이기만 한다. 파일이 줄었거나 다른 파일이면 처음부터 다시 읽는다. 한 Stop에 읽는 양은 SCAN_MAX까지이고 남은 것은 다음 Stop에 읽는다.
const SCAN_CHUNK = 4_000_000;
const SCAN_MAX = 64_000_000;
let workScans = 0;
function noteWorkFiles(st, transcriptPath) {
  const dirs = progressDirs();
  const add = (f, at) => {
    if (!isWorkFile(f, dirs)) return;
    if (!(st.workFiles ||= []).includes(f)) st.workFiles.push(f);
    if (at > ((st.workTimes ||= {})[f] || 0)) st.workTimes[f] = at;
  };
  const eat = (line) => {
    if (!line.includes('"tool_use"') || !dirs.some((d) => line.includes(d))) return true;
    let o;
    try { o = JSON.parse(line); } catch { return false; }
    if (o.type !== 'assistant' || o.isSidechain) return true;
    for (const c of o.message?.content || []) {
      if (c?.type !== 'tool_use') continue;
      const at = Date.parse(o.timestamp) || 0;
      if (/^(?:Edit|Write|MultiEdit)$/.test(c.name) && typeof c.input?.file_path === 'string') add(c.input.file_path, at);
      else if (c.name === 'Bash' && typeof c.input?.command === 'string') shellWorkFiles(c.input.command, o.cwd, dirs).forEach((f) => add(f, at));
    }
    return true;
  };
  try {
    const size = fs.statSync(transcriptPath).size;
    const was = st.workScan;
    const start = was && was.path === transcriptPath && was.offset <= size ? was.offset : 0;
    const end = Math.min(size, start + SCAN_MAX);
    if (end > start) {
      workScans += 1;
      const fd = fs.openSync(transcriptPath, 'r');
      let done = start;
      try {
        let rest = Buffer.alloc(0);
        for (let pos = start; pos < end; pos += SCAN_CHUNK) {
          const len = Math.min(SCAN_CHUNK, end - pos);
          const buf = Buffer.alloc(len);
          fs.readSync(fd, buf, 0, len, pos);
          const all = Buffer.concat([rest, buf]);
          const cut = all.lastIndexOf(0x0a);
          if (cut >= 0) {
            for (const line of all.subarray(0, cut).toString('utf8').split('\n')) eat(line);
            done = pos + len - (all.length - cut - 1);
            rest = all.subarray(cut + 1);
          } else rest = all;
        }
        // 파일 끝에서 줄바꿈 없이 끝난 마지막 줄이 온전한 JSON이면 그 줄도 읽은 것으로 본다. 덜 쓰인 줄이면 다음에 다시 읽는다
        if (end === size && rest.length) {
          const tail = rest.toString('utf8');
          let isWhole = false;
          try { JSON.parse(tail); isWhole = true; } catch { /* 덜 쓰인 줄 */ }
          if (isWhole) { eat(tail); done = size; }
        }
      } finally { fs.closeSync(fd); }
      st.workScan = { path: transcriptPath, offset: done };
    } else if (!was || was.path !== transcriptPath || was.offset > size) st.workScan = { path: transcriptPath, offset: end };
  } catch { /* 기록을 못 읽으면 이번에는 건너뛴다 */ }
  st.workFiles = (st.workFiles || []).slice(-20);
  for (const f of Object.keys(st.workTimes || {})) if (!st.workFiles.includes(f)) delete st.workTimes[f];
}
// 열린 칸 대조가 볼 진행 기록 거르기: 이번 Stop 앞 이 시간 안에 고친 기록만 본다. 고친 때를 모르는 기록(옛 상태 파일)은 거르지 않는다.
// 왜: 세션이 오래전에 고치고 더 안 돌보는 기록(개편 진행 기록이 이틀 넘게 그대로인 채 세션은 다른 기록으로 일함)의 열린 칸은 낡아서, 새로 볼 폴더(progressDirs)를 넓히자 지난 10일 새로 막는 30건 중 14건이 칸이 끝났거나 낡은 헛막음이었다.
// 근거(지난 10일 Stop 4361개를 시간별로 되돌려 봄): 30분은 진짜 10건을 모두 지키고 헛 14건 중 12건을 뺐다. 15분은 기본 폴더에서 지금 막는 12건 중 2건이 빠져(30분은 1건) 더 짧게 줄이면 새는 쪽이 늘었고, 1시간은 헛 3건이 남았다.
// 한 번만 묻는 서명(st.opened)은 거르기 전 열린 칸 전체로 세고 낡은 칸만 있는 Stop도 읽은 것으로 적는다. 거르는 바람에 서명이 달라져 같은 세션이 한 번 더 막히는 일을 없애려는 것이다(지난 10일에 5건).
// 잃는 것: 낡은 칸만 보고 지나간 뒤 같은 칸이 그대로인 채 그 기록을 다시 고쳐도 막지 않는다(칸이 달라지면 서명이 달라져 묻는다).
// 전제: 진행 기록을 돌보는 세션은 차례마다 그 기록을 고친다. 실무자를 오래 기다리다 깨어난 Stop에서 기록을 안 고쳤으면 막지 않는다(그 일은 앞 차례의 「다음」 칸이 이미 밝혔다).
const WORK_FRESH_MS = 30 * 60000;
function liveWorkFiles(st, nowMs) {
  const times = st.workTimes || {};
  return (st.workFiles || []).filter((f) => !times[f] || nowMs - times[f] <= WORK_FRESH_MS);
}
// 이번 세션이 고친 진행 기록에서 AI 몫으로 볼 남은 일: 열린 칸(`- [ ]`)과 「남은 물음」, 「남은 일」, 「남은 것」, 「남은 할 일」 절의 항목.
// 왜(남은 것): 진행 기록이 남은 일을 「## 남은 것」 절에 목록으로 적었는데 절 이름이 달라 하나도 세지 않았다(11-08 「규칙문서나 찾았던결함도 다 해결된거지?」 앞 답).
const LEFT_HEAD = /^#{1,4}\s*남은 (?:물음|일|것|할 일)\s*$/;
// 칸 주인은 줄 머리(첫 쌍점, 여는 괄호, 줄표 앞 30자)만 본다. 뒤쪽 글에 「대표 물음」이나 「기다림」이 인용돼 있어도 AI 몫이다(11-08 열린 칸 6개 가운데 2개가 이 때문에 빠졌다).
// 날짜를 앞세운 칸(「11-10: …」, 「내일부터 …」)은 때가 되면 할 일이라 세지 않는다.
const USER_HEAD = /대표|사용자|기다림|push|푸시|배포/i;
const TIMED = /^\d{1,2}-\d{1,2}\s*[:：]/;
const boxHead = (s) => s.split(/[:：(（—]/)[0].slice(0, 30);
// 「도는 중」, 「진행 중」이 줄 머리에 든 칸은 남이 지금 하고 있다는 상태 표시라 AI가 이어 할 일이 아니다(실무자가 도는 동안은 훅이 막지 않고, 끝난 뒤 칸을 닫는 쪽이 맞다).
const RUNNING = /도는 중|돌고 있|진행 중/;
const ownBox = (s) => !!s && !USER_HEAD.test(boxHead(s)) && !RUNNING.test(s.slice(0, 60)) && !TIMED.test(s) && !LATER.test(s) && !/^\(?풀림\)?|^없음|없습니다\.?$/.test(s);
// 세션 워크트리(<저장소>/.claude/worktrees/<이름>/…)에서 고친 진행 기록은 머지하고 워크트리를 지운 뒤 끝맺는 답에서 그 경로가 없다. 없으면 본 폴더의 같은 파일을 연다.
// 워크트리가 아직 있으면 그 파일을 그대로 연다(머지 전 고침이 거기 있다). 워크트리와 본 폴더 경로로 같은 파일을 둘 적어 둔 것은 한 번만 센다(먼저 읽은 쪽).
// 왜: 새 셸 해석이 워크트리 경로를 그대로 적어 머지 뒤 열린 칸 대조가 파일을 못 읽고 건너뛰었다(2026-11-08 판정, 10일 15짝 가운데 14개 워크트리가 이미 없음). 옛 해석은 본 폴더 경로를 적어 우연히 읽혔다.
const WORKTREE_DIR = /\/\.claude\/worktrees\/[^/]+(?=\/)/;
const bareWorkPath = (f) => f.replace(WORKTREE_DIR, '');
function readWorkFile(f) {
  try { return fs.readFileSync(f, 'utf8'); } catch { /* 아래에서 본 폴더 경로를 본다 */ }
  const bare = bareWorkPath(f);
  if (bare === f) return null;
  try { return fs.readFileSync(bare, 'utf8'); } catch { return null; }
}
function openBoxes(files) {
  const out = [];
  const seen = new Set();
  for (const f of files) {
    if (seen.has(bareWorkPath(f))) continue;
    const text = readWorkFile(f);
    if (text === null) continue;
    seen.add(bareWorkPath(f));
    let inAsk = false;
    for (const line of text.split('\n')) {
      if (/^#{1,4}\s/.test(line)) { inAsk = LEFT_HEAD.test(line); continue; }
      const box = line.match(/^\s*[-*]\s*\[ \]\s*(.*)$/);
      const ask = inAsk && !box ? line.match(/^[-*]\s+(\S.*)$/) : null;
      const body = (box || ask)?.[1].trim();
      if (body && ownBox(body)) out.push({ file: path.basename(f), line: body });
    }
  }
  return out;
}
// 남은 일 수: 끝 보고(「다음」 칸이 있는 답)는 이번 세션이 고친 진행 기록의 닫히지 않은 AI 몫 줄 수를 「남은 일 N건」으로 밝히고 묶음(파일)별로 보인다.
// 왜: 남은 일은 진행 기록에 적혀 있었는데 보고가 바로 다음 한두 가지만 보여 대표가 「이거만 하면 끝이야?」를 되물었다(11-08 두 번, 결정 「끝 보고의 남은 일」 11-09).
//   열린 칸 대조는 한 칸이라도 「다음」 칸에 비슷한 낱말이 있으면 넘어가서 나머지 칸이 보이지 않았다.
// 전제: 센 수와 답의 수가 같은지는 보지 않는다(AI가 묶어 셀 수 있다). 줄이 있는지만 본다. 진행 기록에 안 적힌 일은 못 잡는다(결정에서 받아들임).
//   실무자가 도는 동안의 끝 보고도 본다(「기다림: 실무자 둘」만 보인 답에서 되물음이 나왔다). 같은 남은 일 묶음으로는 세션에 한 번만 막는다.
const leftHash = (left) => hashOf(left.map((x) => `${x.file}:${x.line}`).join('\n'));
const COUNT_LINE = /남은 (?:일|것|할 일) ?\d+ ?(?:건|개|가지)/;
function leftGroups(open) {
  const by = new Map();
  for (const x of open) by.set(x.file, [...(by.get(x.file) || []), x.line]);
  return [...by].map(([f, ls]) => `${f} ${ls.length}건(${ls.slice(0, 3).map((l) => `「${l.slice(0, 40)}」`).join(', ')}${ls.length > 3 ? ' 외' : ''})`).join(', ');
}
// 「다음」 칸 아래 글(기다림 줄 포함). 다음 칸이 없는 답은 답 전체가 남은 일을 밝힌 자리다.
function nextArea(text, items) {
  if (!items) return String(text || '');
  const heads = [...String(text).matchAll(HEAD)];
  return String(text).slice(heads[heads.length - 1].index);
}
// 남은 일의 핵심 낱말: 괄호 속 보충을 빼고, 한글은 앞 두 글자로 줄여(조사와 어미를 떼어) 답에 있는지 본다.
const GENERIC = new Set(['진행', '기록', '작업', '확인', '정리', '일', '하기', '결과', '이번', '다음']);
function keyWords(s) {
  const toks = s.replace(/[(（][^)）]*[)）]/g, ' ').match(/[가-힣A-Za-z0-9][가-힣A-Za-z0-9_./-]*/g) || [];
  const out = new Set();
  for (const t of toks) {
    if (t.length < 2) continue;
    const k = /[가-힣]/.test(t) && t.length > 2 ? t.slice(0, 2) : t;
    if (!GENERIC.has(k)) out.add(k);
  }
  return [...out];
}
// 남은 일 낱말이 두 개 이상, 그리고 40% 이상 답의 「다음」 칸 글에 나오면 적은 것으로 본다. 낱말이 하나뿐인 칸은 그 하나가 나오면 적은 것이다.
// 「남은 칸을 이어 합니다」처럼 남은 일 전부를 한꺼번에 가리키는 AI 줄도 모두 적은 것으로 본다.
const ALL_REMAINING = /(?:남은|열린) ?(?:칸|일|항목)[^.\n]{0,12}(?:이어|차례로|계속|모두|마저|하나씩)/;
function covered(item, area) {
  if (ALL_REMAINING.test(area)) return true;
  const keys = keyWords(item.line);
  if (!keys.length) return false;
  const hit = keys.filter((k) => area.includes(k)).length;
  return hit >= Math.min(2, keys.length) && hit / keys.length >= 0.4;
}
// 「다음」 AI 줄이 비었거나 「없음」인가(AI 줄이 하나도 없는 것도 포함). 사용자 줄이 사용자에게 답을 청하면(「골라 주세요」) AI는 그 답을 기다리는 것이라 비어도 막지 않는다.
const userAsked = (items) => items.some((x) => !AI_WHO.test(x.who) && x.body && ASKS.test(x.body) && !/시면/.test(x.body));
function nextAiEmpty(items) {
  const ai = items.filter((x) => AI_WHO.test(x.who));
  return !userAsked(items) && !ai.some((x) => x.body && !NOTHING.test(firstSentence(x.body)));
}

const recordsDir = () => process.env.SUBAGENT_RECORDS_DIR || path.join(cfgDirOf(), 'subagent-system', 'records');
// 막음 기록은 감싸개(kit-hook.cjs)가 한 곳에서 적는다. 여기서는 막는 출력에 판정 이름을 붙이고 끝에서 알리기만 한다. 감싸개 밖(시험, 수동 실행)에서는 아무것도 적히지 않는다.
const { named, reportBlocks } = (() => { try { return require('./kit-hook.cjs'); } catch { return { named: (o) => o, reportBlocks: () => {} }; } })();
// 막음 기록: answer-check와 같은 파일, 같은 꼴(시각, 세션, 판정 이름, 도구, 입력). 기록만 빠지고 막기는 그대로 간다.
function records(file, rows) {
  if (!rows.length) return;
  const dir = recordsDir();
  try { fs.appendFileSync(path.join(dir, file), rows.map((cols) => `${cols.map((c) => String(c).replace(/[\t\n]/g, ' ')).join('\t')}\n`).join('')); } catch { /* 기록만 빠진다 */ }
}
// 막은 뒤 같은 답에서 열린 칸 목록이 그대로인가.
function sameOpen(st, text, sig) {
  try {
    const items = nextItems(text || '');
    const area = nextArea(text, items);
    const open = openBoxes(st.workFiles || []).filter((x) => !covered(x, area));
    return hashOf(open.map((x) => `${x.file}:${x.line}`).join('\n')) === sig;
  } catch { return false; }
}

function check(input, now = new Date()) {
  const sid = input.session_id;
  const again = input.stop_hook_active === true;
  // 한 줄기(사용자 말이나 알림 하나에서 멈출 때까지) 안의 막은 기록은 줄기가 바뀌면 지운다. 앞 줄기 기록이 검사를 끄지 않게(리뷰 2회차 2번).
  // 결과를 이미 알린 실무자(got), 뒤 작업을 기다리는 서브에이전트(waits), 열린 칸 대조를 이미 한 것(opened), 이번 세션에 고친 진행 기록(workFiles)만 줄기를 넘어 남긴다.
  const prev = readState(sid);
  const st = again ? prev : { got: (prev.got || []).slice(-500), stuck: (prev.stuck || []).slice(-50), told: (prev.told || []).slice(-200), asked: (prev.asked || []).slice(-200), waits: prev.waits || {}, opened: (prev.opened || []).slice(-50), counted: (prev.counted || []).slice(-50), workFiles: prev.workFiles || [], workTimes: prev.workTimes || {}, workScan: prev.workScan };
  // 진행 기록 찾기는 Stop마다 한 번만 한다(열린 칸 대조가 그 결과를 쓴다)
  noteWorkFiles(st, input.transcript_path);
  let openSig = null;
  let leftSig = null;
  const parts = [];
  const text = typeof input.last_assistant_message === 'string' && input.last_assistant_message ? input.last_assistant_message : lastAssistantText(input.transcript_path);
  const decisions = decisionItems(text);
  const fresh0 = [...new Set(decisions.map((d) => hashOf(decisionKey(d))))].filter((h) => !(st.told || []).includes(h));
  if (fresh0.length) {
    if (pushedThisTurn(input.transcript_path) || fresh0.every((h) => (st.asked || []).includes(h))) {
      // 보냈거나, 한 번 조른 뒤에도 안 보냈으면 알린 것으로 넘긴다. 같은 결정으로 거듭 막지 않게.
      (st.told ||= []).push(...fresh0);
    } else {
      (st.asked ||= []).push(...fresh0);
      const n = decisionCount(text);
      parts.push(`결정 알림: 이 답에 사용자가 정할 것이 새로 생겼는데 이번 차례에 휴대폰 알림을 보내지 않았다. PushNotification(안 보이면 ToolSearch "select:PushNotification"으로 불러온다)으로 「결정 ${n}건: <첫 결정 요지>」를 200자 안 한 줄로 보낸다. 보낸 뒤에는 이 글의 다른 지시를 따르고, 다른 지시가 없으면 멈춘다. 사용자가 터미널 앞이면 도구가 알아서 건너뛴다.`);
    }
  }
  const W = workers(input, st, now);
  const { tasks, alive, agents, idle, late, recs } = W;
  const wake = wakeups(Array.isArray(input.session_crons) ? input.session_crons : []);
  const fresh = late.filter((r) => now.getTime() - r.ended <= STALE_MS);
  const stale = late.filter((r) => now.getTime() - r.ended > STALE_MS);
  if (fresh.length) {
    parts.push(`결과 늦음: 이름 붙인 실무자가 일을 마쳤는데 끝 메시지가 아직 메인에 닿지 않았다. 아래 마지막 답을 결과로 받아 이어 한다.\n${fresh.map((r) => `[${r.name}]\n${lastText(r.file)}`).join('\n\n')}\n`);
  }
  if (stale.length) {
    const hhmm = (ms) => { const d = new Date(ms); return `${d.getHours()}시 ${d.getMinutes()}분`; };
    const first = (r) => lastText(r.file, 300).split('\n').find((x) => x.trim()) || '';
    parts.push(`오래된 결과: 끝난 지 1시간 넘은 실무자 ${stale.length}명의 끝 메시지가 닿지 않은 채 이제 잡혔다. 대화에서 이미 받았거나 뒤의 일이 담았으면 사용자에게 다시 알리지 않고 하던 일을 잇는다. 새로 반영할 것이 있을 때만 그 실무자 기록 끝을 읽어 반영하고 알린다.\n${stale.map((r) => `- [${r.name}] ${hhmm(r.ended)} 끝남: ${first(r)} (전문: ${r.file})`).join('\n')}\n`);
  }
  // 멈춘 듯: 하네스는 멈춘 실무자도 running으로 넘긴다(11-05 s2-56b를 8시간 기다림). 기록이 STUCK_MIN분 넘게 자라지 않으면 알린다.
  // 같은 멈춤(같은 기록 시각)은 한 번만 알린다. 오래 걸리는 명령을 돌리는 중이라 두기로 했으면 다시 조르지 않게. 뒤 작업을 기다리는 서브에이전트는 기록이 안 자라는 게 정상이라 본다에서 뺀다.
  const stuck = agents.filter((t) => !t.waiting).map((t) => ({ t, rec: recs.get(String(t.description || '').trim()) }))
    .filter(({ rec }) => rec && !rec.ended && rec.moved && now.getTime() - rec.moved >= STUCK_MIN * 60000)
    .filter(({ t, rec }) => !(st.stuck || []).includes(`${t.id}:${rec.moved}`));
  if (stuck.length) {
    for (const { t, rec } of stuck) (st.stuck ||= []).push(`${t.id}:${rec.moved}`);
    parts.push(`멈춘 듯: ${stuck.map(({ t, rec }) => `${String(t.description || t.id).slice(0, 30)}(id ${t.id}, ${Math.floor((now.getTime() - rec.moved) / 60000)}분째 기록이 그대로)`).join(', ')}. 오래 걸리는 명령을 기다리는 중이 아니면 TaskStop으로 거두고, 끝난 기준과 남은 일을 넘겨 다시 띄운다.`);
  }
  const key = agents.map((t) => t.id).sort().join(',');
  if (tasks && agents.length && !wake.covered && !(again && st.wait === key)) {
    const teammates = agents.some((t) => /teammate/.test(String(t.type)));
    const names = agents.map((t) => String(t.description || t.id).slice(0, 30)).slice(0, 4).join(', ');
    const when = teammates ? 'cron "7,22,37,52 * * * *"(이름 붙인 실무자가 있어 15분마다)' : `cron "${oneShotIn(60, now)}", recurring false(이름 없는 실무자만 있어 60분 뒤 한 번)`;
    parts.push(`실무자 기다림: 뒤에서 도는 실무자 ${agents.length}명(${names})을 기다리며 멈추려 한다. 끝 알림이 늦거나 안 올 수 있어 CronCreate(안 보이면 ToolSearch로 불러온다)로 깨우는 예약을 건 뒤 멈춘다. ${when}, prompt "${CHECK_IN} 뒤 작업 확인: 기다리던 실무자의 결과가 와 있으면 받아 이어 하고, 아니면 그대로 멈춘다. 멈출 때 멈춤 검사가 멈춘 실무자와 늦게 닿은 결과를 알려 준다."`);
    st.wait = key;
  }
  // 같은 Stop에 늦게 닿은 결과를 넘기면 지우라고 하지 않는다. 메인이 그 실무자에게 일을 다시 보내 예약이 계속 쓰이는 일이 많았다(11-09 헛 11건 가운데 8건).
  if (tasks && !agents.length && !late.length && wake.ours.length && !(again && st.stale)) {
    parts.push(`예약 정리: 기다리는 실무자가 없는데 깨우는 예약이 남아 있다. CronDelete로 지운다(id ${wake.ours.map((c) => c.id).join(', ')}).`);
    st.stale = true;
  }
  // 이어 하기는 도는 일을 알 수 있는 판에서만 본다. 칸이 없는 옛 판에서는 실무자를 기다리는 중에도 막게 되어서다(리뷰 2회차 6번).
  const inflight = alive.filter((t) => !idle.has(t) && !(t.type === 'shell' && LONG_LIVED.test(String(t.command || ''))));
  if (tasks && !inflight.length && !late.length) {
    const n = st.carry || 0;
    // 이어 하기로 막은 뒤 메인이 점검 줄만 쓰고 다시 멈추면(「다음」 칸이 없음) 앞 답의 할 일로 한 번 더 막는다(리뷰 17번 다).
    const pending = again && st.carryText && text !== st.carryText && !nextItems(text || '') && !WAIT_LINE.test(text || '') ? st.carryText : text;
    if (n < 3 && !(again && st.carryText === text) && leftoverWork(pending) && !lockedTurn(input)) {
      parts.push('이어 하기: 답 끝 「다음」에 AI 할 일이 남았고 사용자 몫이 없다. 다른 점검 줄을 쓴 뒤에도 멈추지 말고, 그 일을 지금 도구를 불러 이어 한다. 되돌릴 수 없는 일(운영 반영, 배포, push)이거나 사용자 몫이면 하지 않는다. 사용자 답이나 한도처럼 기다릴 것이 있으면 「기다림: <무엇>」 한 줄을 쓴다.');
      st.carry = n + 1;
      st.carryText = text;
    } else if (decisions.length && !st.labelAsked && decisionWait(text).unlabeled && !lockedTurn(input)) {
      parts.push('결정 대기 표시: 정할 것을 올린 답이다. 「다음」의 AI 줄을 `- AI(답과 별개): …`와 `- AI(답 뒤): …`로 나눠 적는다. 답과 별개인 일이 있으면 멈추지 말고 지금 이어 한다. 애매하면 답 뒤로 둔다.');
      st.labelAsked = true;
    } else if (!decisions.length && !again) {
      // 열린 칸 대조: 끝맺음 답(「다음」 칸이 있는 답, 또는 CLOSING_MIN자 이상인 답)에서 이번 세션이 고친 진행 기록의 AI 몫 남은 일이 답의 「다음」 칸에 하나도 없으면 한 번 묻는다.
      const items = nextItems(text || '');
      const asked = !!items && userAsked(items);
      if ((items || (text || '').length >= CLOSING_MIN) && !asked && !lockedTurn(input)) {
        const area = nextArea(text, items);
        // 한 번만 묻는 서명은 거르기 전 열린 칸 전체의 것과 30분 안 칸만의 것 둘을 읽은 것으로 적고, 둘 중 하나라도 앞서 읽었으면 다시 막지 않는다.
        // 낡아서 거른 기록이 빠져 서명이 달라져도 같은 세션이 한 번 더 막히지 않게 하고(전체 서명), 거른 칸만의 서명이 겹치는 Stop은 앞서 막은 것으로 센다.
        // 낡은 칸만 있는 Stop도 읽은 것으로 적고 막지는 않는다. 막을지는 30분 안에 고친 기록의 칸으로 가린다.
        const all = openBoxes(st.workFiles || []).filter((x) => !covered(x, area));
        const open = openBoxes(liveWorkFiles(st, now.getTime())).filter((x) => !covered(x, area));
        const sig = hashOf(all.map((x) => `${x.file}:${x.line}`).join('\n'));
        const liveSig = hashOf(open.map((x) => `${x.file}:${x.line}`).join('\n'));
        openSig = sig;
        const seen = (st.opened || []).includes(sig) || (!!open.length && (st.opened || []).includes(liveSig));
        for (const [list, g] of [[all, sig], [open, liveSig]]) if (list.length && !(st.opened || []).includes(g)) (st.opened ||= []).push(g);
        if (open.length && !seen) {
          const shown = open.slice(0, 3).map((x) => `「${x.line.slice(0, 50)}」(${x.file})`).join(', ');
          parts.push(`열린 칸 대조: 이번 세션에서 고친 진행 기록에 남은 일(열린 칸 - [ ]와 「남은 물음」)이 ${open.length}개 있는데(${shown}) 이 답의 「다음」 칸에 없다. AI 몫이면 「다음」 AI 줄에 적고 이어 한다. 사용자 몫이거나 기다리는 것이면 그 줄(사용자 줄이나 「기다림: <무엇>」)에 그 일을 적고, 이미 끝났으면 칸을 - [x]로 고친다.`);
        }
      }
    }
  }
  // 남은 일 수: 끝 보고에 「남은 일 N건」이 없으면 한 번 막는다. 이어 하기나 결정 대기 표시로 이미 막는 Stop에서는 그 일을 먼저 하게 두고 묻지 않는다.
  // 열린 칸 대조와 함께 막으면 두 글을 함께 싣는다(앞 글은 「다음」 칸에 없는 칸, 이 글은 남은 줄 전체의 수와 묶음).
  if (!again && !decisions.length && !parts.some((x) => /^(?:이어 하기|결정 대기 표시):/.test(x))) {
    const items = nextItems(text || '');
    if (items && !userAsked(items) && !COUNT_LINE.test(text) && !lockedTurn(input)) {
      const left = openBoxes(liveWorkFiles(st, now.getTime()));
      const sig = leftHash(left);
      if (left.length && !(st.counted || []).includes(sig)) {
        (st.counted ||= []).push(sig);
        leftSig = sig;
        parts.push(`남은 일 수: 이번 세션에서 고친 진행 기록에 닫히지 않은 AI 몫 줄이 ${left.length}건 있다(${leftGroups(left)}). 「다음」 칸에 「남은 일 ${left.length}건」 한 줄과 묶음(진행 기록이나 절)별 목록을 싣고, 바로 할 일은 AI 줄에 적어 이어 한다. 이미 끝난 줄은 - [x]로 닫거나 절에서 지우고 남은 수로 고쳐 적는다.`);
      }
    }
  }
  if (parts.length) {
    const names = parts.map((x) => x.split(':')[0]);
    st.lastBlock = { names, text: hashOf(text || ''), sig: openSig, left: leftSig };
  } else if (again && st.lastBlock) {
    // 막은 뒤 답이 그대로 다시 나와 통과했으면 그 막음은 헛막음 후보다. 답을 바꾸지 않고 해결하는 막음(예약 걸기, 알림 보내기)은 세지 않고,
    // 열린 칸 대조는 남은 일 목록이 그대로일 때만 센다(칸을 고쳐 해결했을 수 있어서).
    const last = st.lastBlock;
    if (hashOf(text || '') === last.text) {
      const same = last.names.filter((n) => n === '이어 하기' || n === '결정 대기 표시' || (n === '남은 일 수' && leftHash(openBoxes(liveWorkFiles(st, now.getTime()))) === last.left) || (n === '열린 칸 대조' && sameOpen(st, text, last.sig)));
      records('hook-false-positive.tsv', same.map((n) => [new Date().toISOString(), sid, `멈춤 검사 ${n}`, '오탐 후보', '통과', 'Stop']));
    }
    delete st.lastBlock;
  }
  writeState(sid, st);
  if (!parts.length) return null;
  return named({ decision: 'block', reason: parts.join(' ') }, parts.map((x) => `멈춤 검사 ${x.split(':')[0]}`));
}

module.exports = { workScanCount: () => workScans, noteWorkFiles, check, workers, bgLeft, wakeups, taskNotes, stopNotes, progressDirs, openBoxes, shellWorkFiles, nextAiEmpty, leftoverWork, nextItems, oneShotIn, delivered, decisionItems, decisionCount, decisionWait };

if (require.main === module) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => (raw += c));
  process.stdin.on('end', () => {
    let out = null;
    try { out = check(JSON.parse(raw)); } catch { out = null; }
    if (out) { reportBlocks(out); process.stdout.write(JSON.stringify(out)); }
    process.exit(0);
  });
}
