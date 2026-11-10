import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOOK = path.join(SUB, 'hooks', 'brief-check.js');
const { parseRoutingTable } = createRequire(import.meta.url)(HOOK);

const TABLE = [
  '| | low | medium | high | xhigh |',
  '|:---|:---|:---|:---|:---|',
  '| **Haiku** | 파일 탐색과 검색 | 번역 키 반영 | | |',
  '| **Sonnet** | 분석과 가공「(시험: 다음 1건 `haiku-high`)」, 코드 정리 검토(/simplify, 찾기만) | 문서 작성, 구현과 문서 | 리뷰 지적 수정 | |',
  '| **Opus** | 데이터 가공 | 영향 범위 조사(바뀌는 코드와 컴포넌트를 쓰는 곳 전수) 「(고정)」 | 최종 코드 리뷰 「(고정)」 | 다시 보내는 일 |',
].join('\n');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brief-check-'));
const tableFile = path.join(dir, 'ROUTING_TABLE.md');
fs.writeFileSync(tableFile, `# 라우팅 표\n\n${TABLE}\n`);

// 설정 폴더는 기본으로 비어 있는 임시 폴더라 시험이 이 컴퓨터의 설정에 기대지 않는다(결정어는 기본 「사용자」).
function run(toolInput, { routing = tableFile, toolName = 'Agent', hook = HOOK, records = path.join(dir, 'no-records'), transcript, configDir = path.join(dir, 'no-config') } = {}) {
  const env = { ...process.env, SUBAGENT_RECORDS_DIR: records, CLAUDE_CONFIG_DIR: configDir };
  if (routing === null) delete env.BRIEF_CHECK_ROUTING_FILES;
  else env.BRIEF_CHECK_ROUTING_FILES = routing;
  const r = spawnSync(process.execPath, [hook], { input: JSON.stringify({ tool_name: toolName, tool_input: toolInput, ...(transcript ? { transcript_path: transcript } : {}) }), encoding: 'utf8', env });
  return { status: r.status, out: r.stdout ? JSON.parse(r.stdout) : null };
}

const FILLER = '세부 지시: 아래 파일들을 읽고 요구대로 고친다. '.repeat(40);
const GOAL = '목표: 훅이 입력표대로 막고 통과시키는 것.\n';
const DOC = '결정 문서: /work/docs/decision.md\n';
const brief = (head) => head + FILLER;
const medium = { subagent_type: 'sonnet-medium', description: '문서 작성' };

function reason(r) {
  assert.equal(r.out.hookSpecificOutput.permissionDecision, 'deny');
  return r.out.hookSpecificOutput.permissionDecisionReason;
}

describe('지시문 검사 훅 brief-check', () => {
  it('목표 줄이 없는 600자 넘는 지시는 deny하고 목표 줄이 빠졌다고 알린다', () => {
    assert.match(reason(run({ ...medium, prompt: brief(DOC) })), /`목표:` 줄이 없다/);
  });

  it('목표 줄과 결정 문서 경로가 있으면 통과한다', () => {
    assert.equal(run({ ...medium, prompt: brief(GOAL + DOC) }).out, null);
  });

  it('결정 문서: 없음(까닭)이 있으면 통과한다', () => {
    assert.equal(run({ ...medium, prompt: brief(GOAL + '결정 문서: 없음(이번 일은 대화에서 정한 것이 없다)\n') }).out, null);
  });

  it('결정 문서 경로도 없음 표시도 없으면 deny한다', () => {
    assert.match(reason(run({ ...medium, prompt: brief(GOAL) })), /결정 문서 경로가 없다/);
  });

  it('까닭이 빈 「결정 문서: 없음()」은 deny한다', () => {
    assert.match(reason(run({ ...medium, prompt: brief(GOAL + '결정 문서: 없음()\n') })), /결정 문서 경로가 없다/);
  });

  it('목표와 결정 문서가 모두 빠지면 둘 다 알린다', () => {
    const msg = reason(run({ ...medium, prompt: brief('') }));
    assert.match(msg, /`목표:` 줄/);
    assert.match(msg, /결정 문서 경로/);
  });

  it('deny 메시지에 왜와 전제가 들어 있다', () => {
    const msg = reason(run({ ...medium, prompt: brief('') }));
    assert.match(msg, /왜:/);
    assert.match(msg, /전제:/);
  });

  it('haiku 정의는 목표 줄이 없어도 통과한다', () => {
    assert.equal(run({ subagent_type: 'haiku-low', description: '파일 탐색과 검색', prompt: brief('') }).out, null);
  });

  it('prompt가 599자면 통과하고 600자면 검사한다', () => {
    assert.equal(run({ ...medium, prompt: 'a'.repeat(599) }).out, null);
    assert.match(reason(run({ ...medium, prompt: 'a'.repeat(600) })), /`목표:` 줄/);
  });

  it('표 칸보다 높은 정의로 보내면서 높임이 없으면 deny한다', () => {
    assert.match(reason(run({ subagent_type: 'opus-high', description: '문서 작성', prompt: brief(GOAL + DOC) })), /높임:/);
  });

  it('prompt나 description에 높임 까닭이 있으면 통과한다', () => {
    assert.equal(run({ subagent_type: 'opus-high', description: '문서 작성', prompt: brief(GOAL + DOC + '높임: 판단이 갈려 놓치면 신호가 없다\n') }).out, null);
    assert.equal(run({ subagent_type: 'opus-high', description: '문서 작성 높임: 범위가 넓다', prompt: brief(GOAL + DOC) }).out, null);
  });

  it('올림 줄이 있으면 표 칸보다 높은 정의여도 통과하고, 거절 문구가 올림 길도 알린다', () => {
    const up = { subagent_type: 'sonnet-medium', description: '분석과 가공' };
    assert.match(reason(run({ ...up, prompt: brief(GOAL + DOC) })), /올림:/);
    assert.equal(run({ ...up, prompt: brief(GOAL + DOC + '올림: sonnet-low에서 파일을 빠뜨려 올림\n') }).out, null);
    assert.equal(run({ subagent_type: 'opus-xhigh', description: '문서 작성', prompt: brief(GOAL + DOC + '올림: opus-high 실패, Fable 단계\n') }).out, null);
  });

  it('올림 줄이 있어도 목표와 결정 문서 검사는 그대로 한다', () => {
    const msg = reason(run({ subagent_type: 'opus-xhigh', description: '문서 작성', prompt: brief('올림: 앞 실패\n') }));
    assert.match(msg, /`목표:` 줄/);
    assert.match(msg, /결정 문서 경로/);
  });

  it('표 칸과 같거나 낮은 정의는 높임이 없어도 통과한다', () => {
    assert.equal(run({ ...medium, prompt: brief(GOAL + DOC) }).out, null);
    assert.equal(run({ subagent_type: 'sonnet-low', description: '리뷰 지적 수정', prompt: brief(GOAL + DOC) }).out, null);
  });

  it('괄호 안 쉼표가 있는 일 이름도 표 칸으로 찾는다', () => {
    assert.match(reason(run({ subagent_type: 'sonnet-high', description: '코드 정리 검토', prompt: brief(GOAL + DOC) })), /sonnet-low 칸/);
  });

  it('쪼갠 두 칸(일[기준] 둘)은 다른 일로 읽어 쉬운 쪽을 표보다 높게 보내면 deny한다', () => {
    const split = [
      '| | low | medium | high | xhigh |',
      '|:---|:---|:---|:---|:---|',
      '| **Sonnet** | | 버그 원인 찾기[재현 있음] | | |',
      '| **Opus** | | | 버그 원인 찾기[재현 없음] 「(고정)」, 「무조건 Opus」 영역 판단 | |',
    ].join('\n');
    const names = parseRoutingTable(split).map((x) => x.name);
    assert.deepEqual(names, ['버그 원인 찾기[재현 있음]', '버그 원인 찾기[재현 없음]', '「무조건 Opus」 영역 판단']);
    const file = path.join(dir, 'ROUTING_SPLIT.md');
    fs.writeFileSync(file, split);
    const input = { subagent_type: 'opus-high', description: '버그 원인 찾기[재현 있음]', prompt: brief(GOAL + DOC) };
    assert.match(reason(run(input, { routing: file })), /sonnet-medium 칸/);
    assert.equal(run({ ...input, description: '버그 원인 찾기[재현 없음]' }, { routing: file }).out, null);
  });

  it('표에서 일 종류를 못 찾거나 정의 이름이 표 형식이 아니면 정의 비교를 건너뛴다', () => {
    assert.equal(run({ subagent_type: 'opus-xhigh', description: '표에 없는 일: 새 조사', prompt: brief(GOAL + DOC) }).out, null);
    assert.equal(run({ subagent_type: 'general-purpose', description: '아무 설명', prompt: brief(GOAL + DOC) }).out, null);
  });

  it('description에 표의 일 이름도 「표에 없는 일:」도 없으면 deny하고 꼴을 알린다', () => {
    assert.match(reason(run({ subagent_type: 'sonnet-high', description: '9회차 막음 고침', prompt: brief(GOAL + DOC) })), /표에 없는 일: <이름>/);
    // 후보: 보낸 정의가 맡는 칸의 일 이름만 싣는다(sonnet-high는 「리뷰 지적 수정」 한 칸, 다른 칸 이름은 없다)
    const hi = reason(run({ subagent_type: 'sonnet-high', description: '9회차 막음 고침', prompt: brief(GOAL + DOC) }));
    assert.match(hi, /sonnet-high가 맡는 칸의 일 이름: 리뷰 지적 수정\./);
    assert.doesNotMatch(hi, /문서 작성|최종 코드 리뷰/);
    const med = reason(run({ subagent_type: 'sonnet-medium', description: '9회차 막음 고침', prompt: brief(GOAL + DOC) }));
    assert.match(med, /일 이름: 문서 작성, 구현과 문서\./);
    assert.equal(run({ subagent_type: 'sonnet-high', description: '리뷰 지적 수정: 9회차 막음 고침', prompt: brief(GOAL + DOC) }).out, null);
    assert.equal(run({ subagent_type: 'sonnet-high', description: '표에 없는 일: 막음 고침, 9회차', prompt: brief(GOAL + DOC) }).out, null);
    assert.match(reason(run({ subagent_type: 'sonnet-high', description: '9회차 막음 고침', prompt: brief(GOAL + DOC + '표에 없는 일: 막음 고침\n') })), /description에 라우팅 표/);
  });

  it('표를 읽지 못하면 description 일 이름 검사도 건너뛴다', () => {
    assert.equal(run({ subagent_type: 'sonnet-high', description: '9회차 막음 고침', prompt: brief(GOAL + DOC) }, { routing: path.join(dir, 'none.md') }).out, null);
  });

  it('표 파일을 읽지 못하면 정의 비교만 건너뛰고 목표 검사는 그대로 한다', () => {
    const missing = path.join(dir, 'none.md');
    assert.equal(run({ subagent_type: 'opus-high', description: '문서 작성', prompt: brief(GOAL + DOC) }, { routing: missing }).out, null);
    assert.match(reason(run({ subagent_type: 'opus-high', description: '문서 작성', prompt: brief(DOC) }, { routing: missing })), /`목표:` 줄/);
  });

  it('Agent가 아닌 도구 입력과 깨진 입력은 막지 않고 통과한다', () => {
    assert.equal(run({ prompt: brief('') }, { toolName: 'Bash' }).out, null);
    const r = spawnSync(process.execPath, [HOOK], { input: 'not json', encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  });

  it('환경 변수가 없으면 훅 옆 설치본 docs/ROUTING_TABLE.md의 표로 정의 비교를 한다', () => {
    const installed = fs.mkdtempSync(path.join(os.tmpdir(), 'brief-check-installed-'));
    fs.mkdirSync(path.join(installed, 'hooks'));
    fs.mkdirSync(path.join(installed, 'docs'));
    fs.copyFileSync(HOOK, path.join(installed, 'hooks', 'brief-check.js'));
    fs.copyFileSync(path.join(SUB, 'hooks', 'package.json'), path.join(installed, 'hooks', 'package.json'));
    fs.writeFileSync(path.join(installed, 'docs', 'ROUTING_TABLE.md'), TABLE);
    const copy = path.join(installed, 'hooks', 'brief-check.js');
    const input = { subagent_type: 'opus-high', description: '문서 작성', prompt: brief(GOAL + DOC) };
    assert.match(reason(run(input, { routing: null, hook: copy })), /높임:/);
  });

  it('본문을 brief 파일에 두고 가리키기만 한 짧은 지시문도 그 파일까지 합쳐 묶음 검사를 한다', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'brief-file-'));
    const file = path.join(d, 'brief.md');
    const short = { subagent_type: 'sonnet-medium', description: '문서 작성', prompt: `공통 지시 ${file} 를 읽고 묶음 03을 적용한다.` };
    fs.writeFileSync(file, GOAL + DOC + FILLER + '\n사용자가 정한 기능은 빼지 않는다.\n');
    assert.match(reason(run(short)), /부딪힐 때/);
    fs.writeFileSync(file, GOAL + DOC + FILLER + '\n지킬 결정: 사용자가 정한 기능은 빼지 않는다.\n부딪힐 때: 결정 문서가 먼저다.\n');
    assert.equal(run(short).out, null);
  });

  describe('묶음 판정 검사는 번호가 이름표로 선 꼴만 묶음 표시로 본다', () => {
    const { isBatchJudging } = createRequire(import.meta.url)(HOOK);
    it('이름표 꼴은 묶음 표시다', () => {
      assert.equal(isBatchJudging('PLAN.md의 「묶음 2. 비로그인 편집기」를 적용한다.', '구현'), true);
      assert.equal(isBatchJudging('구현을 적용한다.', '구현과 문서: 편집기(묶음 3, 서버 함수)'), true);
      assert.equal(isBatchJudging('표의 묶음 01을 채워 판정한다.', '문서 점검'), true);
      assert.equal(isBatchJudging('맡은 묶음(묶음 1, 흐름 문서)을 점검한다.', '점검'), true);
      assert.equal(isBatchJudging('rhaul/apply/packet-02.md를 적용한다.', '문서 갱신'), true);
      assert.equal(isBatchJudging('검수한다.', '문서 검토 묶음 2 보고'), true);
    });
    it('개수, 차례, 단위, 이상이 붙은 셈 말은 묶음 표시가 아니다', () => {
      for (const t of ['효과 표 묶음 6개는 이름만 바뀌었다.', '겹친 묶음 291개를 센다.', '겹친 묶음 3 이상이고 가리킴이 아닌 것.', '정답 묶음 2차를 만든다.', '첫 묶음 13건 반영.', '고침 묶음 5c046f32를 점검한다.']) {
        assert.equal(isBatchJudging(`${t} 판정한다.`, '문서 검토'), false, t);
      }
      assert.equal(isBatchJudging('판정한다.', '용어 점검 첫 묶음 13건 반영'), false);
    });
    it('판정, 적용, 검수, 점검 낱말이 없으면 이름표가 있어도 보지 않는다', () => {
      assert.equal(isBatchJudging('「묶음 2. 편집기」를 만든다.', '구현(묶음 2)'), false);
    });
    it('셈 말만 있는 긴 지시는 지킬 결정 줄이 없어도 막지 않는다', () => {
      const p = brief(GOAL + DOC + '효과 표 묶음 6개를 판정한다.\n');
      assert.equal(run({ subagent_type: 'opus-medium', description: '문서 내용 검토: 판정', prompt: p }, { routing: null }).out, null);
    });
    it('이름표가 있는 나눈 묶음 일은 지킬 결정 줄이 없으면 막는다', () => {
      const p = brief(GOAL + DOC + 'PLAN.md의 「묶음 2. 비로그인 편집기」를 적용한다.\n');
      assert.match(reason(run({ subagent_type: 'sonnet-medium', description: '구현과 문서: 편집기(묶음 2)', prompt: p })), /부딪힐 때/);
    });
  });

  describe('조회용 기본 정의는 목표 줄과 결정 문서를 요구하지 않는다', () => {
    const lookup = FILLER + '공식 문서에서 훅 입력 필드를 찾아 인용해 답하라.';
    it('web-fetch와 claude-code-guide의 긴 물음은 통과한다', () => {
      for (const type of ['web-fetch', 'claude-code-guide', 'Explore']) assert.equal(run({ subagent_type: type, description: '공식 문서 확인', prompt: lookup }).out, null, type);
    });
    it('일을 맡기는 정의와 정의를 안 밝힌 지시는 그대로 요구한다', () => {
      assert.match(reason(run({ subagent_type: 'sonnet-medium', description: '문서 작성', prompt: lookup })), /목표/);
      assert.match(reason(run({ description: '문서 작성', prompt: lookup })), /목표/);
      assert.match(reason(run({ subagent_type: 'general-purpose', description: '문서 작성', prompt: lookup })), /목표/);
    });
  });

  describe('결정어(U4-11)', () => {
    const configWith = (words) => {
      const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'brief-cfg-'));
      fs.mkdirSync(path.join(cfg, 'subagent-system'));
      fs.writeFileSync(path.join(cfg, 'subagent-system', 'config.json'), JSON.stringify({ decisionWords: words }));
      return cfg;
    };
    const batchBrief = (decided) => {
      const d = fs.mkdtempSync(path.join(os.tmpdir(), 'brief-word-'));
      const file = path.join(d, 'brief.md');
      fs.writeFileSync(file, GOAL + DOC + FILLER + `\n${decided} 기능은 빼지 않는다.\n부딪힐 때: 결정 문서가 먼저다.\n`);
      return { subagent_type: 'sonnet-medium', description: '문서 작성', prompt: `공통 지시 ${file} 를 읽고 묶음 03을 적용한다.` };
    };

    it('config 결정어가 팀장이면 「팀장이 정한」을 지킬 결정 줄로 받는다', () => {
      const cfg = configWith(['팀장']);
      assert.equal(run(batchBrief('팀장이 정한'), { configDir: cfg }).out, null);
      assert.match(reason(run(batchBrief('대표가 정한'), { configDir: cfg })), /지킬 결정/);
    });

    it('config 결정어가 대표와 사용자이면 「대표가 정한」과 「사용자가 정한」을 받는다', () => {
      const cfg = configWith(['대표', '사용자']);
      assert.equal(run(batchBrief('대표가 정한'), { configDir: cfg }).out, null);
      assert.equal(run(batchBrief('사용자가 정한'), { configDir: cfg }).out, null);
    });

    it('설정이 없으면 기본 결정어 「사용자」만 받는다', () => {
      assert.equal(run(batchBrief('사용자가 정한')).out, null);
      assert.match(reason(run(batchBrief('팀장이 정한'))), /지킬 결정/);
    });
  });

  describe('회사 규칙 묶음 없음', () => {
    // 깐 상태 기록을 만든다. 묶음 이름만 적고 조각은 비운다(훅은 이름만 본다).
    const lockedConfig = (names) => {
      const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'brief-lock-'));
      fs.mkdirSync(path.join(cfg, 'subagent-system'));
      fs.writeFileSync(path.join(cfg, 'subagent-system', 'bundles.lock.json'), JSON.stringify({ lockVersion: 1, installed: Object.fromEntries(names.map((n) => [n, { options: [], parts: {} }])) }));
      return cfg;
    };
    const routingOnly = lockedConfig(['routing']);
    const batchFile = (decided) => {
      const d = fs.mkdtempSync(path.join(os.tmpdir(), 'brief-nocompany-'));
      const file = path.join(d, 'brief.md');
      fs.writeFileSync(file, FILLER + `\n${decided}\n`);
      return { subagent_type: 'sonnet-medium', description: '문서 작성', prompt: `공통 지시 ${file} 를 읽고 묶음 03을 적용한다.` };
    };

    it('회사 규칙이 안 깔리면 목표 줄과 결정 문서 줄 검사를 쉰다', () => {
      assert.equal(run({ ...medium, prompt: brief('') }, { configDir: routingOnly }).out, null);
    });

    it('회사 규칙이 안 깔리면 지킬 결정 줄 검사도 쉰다', () => {
      assert.equal(run(batchFile('사용자가 정한 기능은 빼지 않는다.'), { configDir: routingOnly }).out, null);
    });

    it('회사 규칙이 안 깔려도 라우팅 꼴(높임, 표에 없는 일)은 그대로 막는다', () => {
      assert.match(reason(run({ subagent_type: 'opus-high', description: '문서 작성', prompt: brief('') }, { configDir: routingOnly })), /높임:/);
      assert.match(reason(run({ subagent_type: 'sonnet-high', description: '9회차 막음 고침', prompt: brief('') }, { configDir: routingOnly })), /표에 없는 일: <이름>/);
    });

    it('회사 규칙이 깔린 기록이면 목표 줄 검사를 지금과 같이 한다', () => {
      const withCompany = lockedConfig(['routing', 'company']);
      assert.match(reason(run({ ...medium, prompt: brief('') }, { configDir: withCompany })), /`목표:` 줄/);
      assert.match(reason(run(batchFile('사용자가 정한 기능은 빼지 않는다.'), { configDir: withCompany })), /부딪힐 때/);
    });

    it('기록이 없거나 깨졌으면 깔린 것으로 보고 목표 줄 검사를 한다', () => {
      assert.match(reason(run({ ...medium, prompt: brief('') })), /`목표:` 줄/);
      const broken = lockedConfig(['routing']);
      fs.writeFileSync(path.join(broken, 'subagent-system', 'bundles.lock.json'), '{ 깨진 기록');
      assert.match(reason(run({ ...medium, prompt: brief('') }, { configDir: broken })), /`목표:` 줄/);
    });
  });

  describe('시험 표시 칸', () => {
    const rec = fs.mkdtempSync(path.join(os.tmpdir(), 'brief-check-rec-'));
    const usage = (lines) => fs.writeFileSync(path.join(rec, 'subagent-usage.tsv'), lines.join('\n') + '\n');
    const row = (def, kind, memo) => ['2026-10-31', '/p', def, kind, '1', '1', '1', 'ok', memo].join('\t');
    const low = { subagent_type: 'sonnet-low', description: '분석과 가공', prompt: brief(GOAL + DOC) };

    it('표에서 시험 정의를 읽는다', () => {
      assert.equal(parseRoutingTable(TABLE).find((x) => x.name === '분석과 가공').trial, 'haiku-high');
    });

    it('회고 뒤 시험 정의로 보낸 건이 2건 아래인데 칸 정의로 보내면 deny한다', () => {
      usage(['회고\t-\t회고', row('haiku-high', '분석과 가공', 'a1111111111 첫 시험')]);
      assert.match(reason(run(low, { records: rec })), /시험 건너뜀:/);
    });

    it('같은 agentId 두 줄은 1건으로 세고, 회고 앞 줄은 세지 않는다', () => {
      usage([row('haiku-high', '분석과 가공', 'a2222222222'), '회고\t-\t회고', row('haiku-high', '분석과 가공', 'a1111111111 표에서 찾음'), row('haiku-high', '분석과 가공', 'a1111111111 요지')]);
      assert.match(reason(run(low, { records: rec })), /1건이다/);
    });

    it('사용 기록에 아직 없어도 이 세션에서 띄운 시험 정의는 센다(한꺼번에 띄우거나 앞 시험이 도는 중)', () => {
      usage(['회고\t-\t회고']);
      const t = path.join(rec, 'session.jsonl');
      const launch = (id) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Agent', input: { subagent_type: 'haiku-high', description: '분석과 가공', prompt: 'x' } }] } });
      fs.writeFileSync(t, [launch('t1'), launch('t2')].join('\n') + '\n');
      assert.equal(run(low, { records: rec, transcript: t }).out, null);
      fs.writeFileSync(t, launch('t1') + '\n');
      assert.match(reason(run(low, { records: rec, transcript: t })), /1건이다/);
    });

    it('이 세션에서 띄운 시험이라도 마지막 회고 경계 앞의 것은 세지 않는다', () => {
      usage(['회고\t-\t회고\t2026-11-07T20:08:35.776Z\t1\t0\t-']);
      const t = path.join(rec, 'session-old.jsonl');
      const launch = (id, ts) => JSON.stringify({ type: 'assistant', timestamp: ts, message: { content: [{ type: 'tool_use', id, name: 'Agent', input: { subagent_type: 'haiku-high', description: '분석과 가공', prompt: 'x' } }] } });
      fs.writeFileSync(t, [launch('t1', '2026-11-07T15:19:06.499Z'), launch('t2', '2026-11-07T15:55:28.752Z')].join('\n') + '\n');
      assert.match(reason(run(low, { records: rec, transcript: t })), /0건이다/);
      fs.appendFileSync(t, launch('t3', '2026-11-08T01:10:38.328Z') + '\n');
      assert.match(reason(run(low, { records: rec, transcript: t })), /1건이다/);
    });

    it('시험 정의로 2건 보냈으면 칸 정의로 보내도 통과한다', () => {
      usage(['회고\t-\t회고', row('haiku-high', '분석과 가공', 'a1111111111'), row('haiku-high', '분석과 가공', 'a3333333333')]);
      assert.equal(run(low, { records: rec }).out, null);
    });

    it('시험 건너뜀이나 높임 줄이 있으면 통과한다', () => {
      usage(['회고\t-\t회고']);
      assert.equal(run({ ...low, prompt: brief(GOAL + DOC + '시험 건너뜀: 판단이 갈리는 묶음\n') }, { records: rec }).out, null);
      assert.equal(run({ ...low, description: '분석과 가공 높임: 범위가 넓다', subagent_type: 'sonnet-medium' }, { records: rec }).out, null);
    });

    it('사용 기록을 못 읽으면 시험 검사만 건너뛴다', () => {
      assert.equal(run(low).out, null);
    });
  });

  // 설치본의 표는 사용자 것이라 키트 원본에서만 본다.
  it('키트의 라우팅 표에서 표 행을 뽑는다', { skip: fs.existsSync(path.join(SUB, 'rules')) ? false : '설치본 배치' }, () => {
    const rows = parseRoutingTable(fs.readFileSync(path.join(SUB, 'docs', 'ROUTING_TABLE.md'), 'utf8'));
    assert.ok(rows.find((x) => x.name === '최종 코드 리뷰' && x.model === 'opus' && x.effort === 'high'));
    assert.ok(rows.find((x) => x.name === '코드 정리 검토' && x.model === 'sonnet' && x.effort === 'medium'));
  });
});

describe('실무자에게 커밋을 시키는 지시 가르기', () => {
  const { gitStateAsk } = createRequire(import.meta.url)(HOOK);
  it('하지 말라는 문장과 「」 인용 안의 커밋 말은 시키는 것으로 보지 않는다', () => {
    // 2026-11-08 오탐 두 건: 금지 문장 속 명령 이름, 만들 훅이 찍을 안내 문구.
    assert.equal(gitStateAsk('임시 폴더에 `git worktree add --detach x`로 만들지 말고 함수를 걸어 본다.'), false);
    assert.equal(gitStateAsk('안내 「새 자리로 고친 뒤 다시 커밋한다」를 찍는다.'), false);
    assert.equal(gitStateAsk('결정 문서 a.md 를 읽되 `git commit`은 쓰지 않는다.'), false);
  });
  it('지시문에 커밋은 메인이 한다고 적혀 있으면 다른 문장의 커밋 말도 통과한다', () => {
    assert.equal(gitStateAsk('고친 뒤 커밋한다.\n커밋은 메인이 한다.'), false);
  });
  it('실무자에게 커밋이나 워크트리 만들기를 시키면 잡는다', () => {
    assert.equal(gitStateAsk('다 고치면 `git commit -m x`로 남긴다.'), true);
    assert.equal(gitStateAsk('끝나면 커밋한다.'), true);
    // 커밋은 메인이 한다고 적어도 워크트리 만들기를 시키면 잡는다(실제 지시문 두 건).
    assert.equal(gitStateAsk('세션 워크트리: `git worktree add -q .claude/worktrees/x -b wt/x main`\n커밋은 메인이 한다.'), true);
  });
});

describe('다른 세션에 일을 넘기는 메시지', () => {
  const { handoffProblems } = createRequire(import.meta.url)(HOOK);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-'));
  it('넘김 문서의 넘김 절에 목표 줄이 없으면 막는다', () => {
    const f = path.join(tmp, 'a.md');
    fs.writeFileSync(f, '목표: 앞 절의 목표\n## 넘김\n할 일: 1. 고친다\n');
    assert.equal(handoffProblems({ to: 'kit-session', message: `정리를 넘깁니다. 넘김 문서: ${f}` }).length, 1);
  });
  it('넘김 절이나 메시지에 목표 줄이 있으면 통과한다', () => {
    const f = path.join(tmp, 'b.md');
    fs.writeFileSync(f, '## 넘김\n목표: 두 벌이 갈리지 않게 한다\n할 일: 1.\n');
    assert.deepEqual(handoffProblems({ to: 'kit-session', message: `넘깁니다: ${f}` }), []);
    assert.deepEqual(handoffProblems({ to: 'kit-session', message: '넘깁니다.\n목표: 끝낸다' }), []);
  });
  it('이 세션이 이름을 붙여 띄운 실무자에게 보내는 이어 말은 넘김이 아니다', () => {
    const t = path.join(tmp, 'session.jsonl');
    const launch = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'u1', name: 'Agent', input: { description: '고치기', subagent_type: 'opus-high', name: 'turn-play-fix', prompt: '목표: x' } }] } });
    const other = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '"name":"turn-play-fix" 라고 적은 글' }] } });
    fs.writeFileSync(t, `${other}\n`);
    const msg = { to: 'turn-play-fix', message: '끝나면 메인이 따로 맡깁니다. 다시 확인해 주세요.' };
    assert.equal(handoffProblems(msg, { transcriptPath: t }).length, 1);
    fs.writeFileSync(t, `${other}\n${launch}\n`);
    assert.deepEqual(handoffProblems(msg, { transcriptPath: t }), []);
    assert.deepEqual(handoffProblems({ to: 'turn-play-fix [pane 2]', message: msg.message }, { transcriptPath: t }), []);
    // 세션 이름으로 보낸 넘김은 그대로 막는다.
    assert.equal(handoffProblems({ to: 'other-session', message: msg.message }, { transcriptPath: t }).length, 1);
    // 대화 기록을 못 읽으면 지금처럼 검사한다.
    assert.equal(handoffProblems(msg, { transcriptPath: path.join(tmp, 'none.jsonl') }).length, 1);
  });
  it('실무자에게 보내는 이어 말과 넘김이 아닌 메시지는 보지 않는다', () => {
    assert.deepEqual(handoffProblems({ to: 'a7f17c342defcf26c', message: '넘김 절을 고쳐라' }), []);
    assert.deepEqual(handoffProblems({ to: 'kit-session', message: '오탐 두 건을 알립니다' }), []);
  });
});

describe('고치는 일의 끝난 기준에 전체 시험만 주는 지시', () => {
  const { fullTestOnly } = createRequire(import.meta.url)(HOOK);
  const base = '할 일: 훅을 고친다.\n끝난 기준: 키트 시험(`node --test tests/*.test.js`) EXIT=0.';
  it('중간 확인도 끝에 한 번도 없으면 잡는다', () => {
    // 전체 시험 명령만 주면 실무자가 고칠 때마다 한 번에 10분짜리를 돌린다(2026-11-08).
    assert.equal(fullTestOnly(base, '구현과 문서: 훅 고치기'), true);
  });
  it('전체는 끝에 한 번이라고 적었거나 고친 파일의 시험을 따로 적으면 통과한다', () => {
    assert.equal(fullTestOnly(base + '\n작업 중에는 고친 파일의 시험만 돌리고 전체는 끝에 한 번.', '구현과 문서: 훅 고치기'), false);
  });
  it('시험을 돌리는 것이 일인 지시와 고치지 않는 지시는 보지 않는다', () => {
    assert.equal(fullTestOnly(base, '시험 실행과 결과 정리: 키트'), false);
    assert.equal(fullTestOnly('끝난 기준: 전체 시험 결과를 표로 낸다.', '분석과 가공: 결과'), false);
  });
  it('파일을 고치지 않는다고 밝혔거나 판정 파일만 쓰게 한 지시는 일 종류와 상관없이 보지 않는다', () => {
    // 일 종류가 문서 내용 검토인 판정 지시가 제약의 전체 시험 말과 「판정 대상에 넣는다」에 걸려 헛막혔다(2026-11-08).
    const review = '목표: 바퀴 5를 판정한다. 끝난 기준: 판정 파일에 막음 표를 쓴다.\n판정 대상에 넣는다.\n하지 말 것:\n- 파일을 고치지 않는다(판정 파일만 쓴다).\n- 키트 전체 시험(`node --test tests/*.test.js`)은 메인이 이미 돌렸다.';
    assert.equal(fullTestOnly(review, '문서 내용 검토: 바퀴 5 판정'), false);
    assert.equal(fullTestOnly('할 일: 훅을 고친다.\n끝난 기준: 판정 파일만 쓴다. 전체 시험은 보지 않는다.', '구현과 문서: 판정'), false);
    assert.equal(fullTestOnly('할 일: 문서를 넣는다.\n끝난 기준: 결과 파일 경로를 답한다.\n제약: 파일은 결과 파일 말고 고치지 않는다. 코드는 읽기만. pytest는 돌려도 된다.', '문서 내용 검토: 4회차'), false);
  });
  it('앞에 말이 붙어 범위를 줄이는 「고치지 않는다」는 고치지 않는 지시로 보지 않는다', () => {
    for (const limit of ['그 밖의 파일은 고치지 않는다.', '너는 문서를 고치지 않는다. 시험 파일은 고쳐도 된다.', '개발 DB에 이미 들어간 앞 회차 파일은 고치지 않는다.']) {
      assert.equal(fullTestOnly(`${base}\n${limit}`, '구현과 문서: 훅 고치기'), true, limit);
    }
  });
});

describe('목업대로 옮기는 일의 사용자 확인 줄', () => {
  // 확인받지 않은 화면의 목업까지 「목업 그대로 이식」으로 맡겨 사용자가 「목업 나한테 안 보여주지 않았어?」라고 짚었다.
  const mk = (readme) => {
    const d = fs.mkdtempSync(path.join(dir, 'mk-'));
    const m = path.join(d, 'content', 'mockups-v2');
    fs.mkdirSync(path.join(m, 'shots'), { recursive: true });
    if (readme !== null) fs.writeFileSync(path.join(m, 'README.md'), readme);
    return m;
  };
  const impl = (m, extra = '') => ({ subagent_type: 'sonnet-medium', description: '구현과 문서: 목록과 상세 화면 목업 그대로 이식', prompt: brief(GOAL + DOC + `목록 화면을 새 목업대로 고친다. 목업 판: ${m}/shots/list-1440.png\n${extra}`) });

  it('목업 폴더 README에 확인 줄이 없으면 막고 폴더를 알린다', () => {
    const m = mk('# 새 목업\n판정 7회차 통과\n');
    const r = reason(run(impl(m)));
    assert.match(r, /사용자 확인 줄이 없다/);
    assert.ok(r.includes(m));
  });

  it('README가 없어도 막는다', () => {
    assert.match(reason(run(impl(mk(null)))), /사용자 확인 줄이 없다/);
  });

  it('README에 확인 줄이 있으면 통과한다', () => {
    const m = mk('# 새 목업\n사용자 확인: 11-08 목록, 상세, 결과 「목록방식은 괜찮아보여」\n');
    assert.equal(run(impl(m)).out, null);
  });

  it('지시문에만 확인 줄이 있고 목업 폴더가 있으면 README 줄을 요구한다', () => {
    const m = mk('# 새 목업\n');
    assert.match(reason(run(impl(m, '사용자 확인: 11-08 목록 화면\n'))), /README\.md에 사용자 확인 줄/);
  });

  it('목업 폴더가 지시에 없으면 지시문의 확인 줄이나 없음(까닭)을 받는다', () => {
    const art = { subagent_type: 'sonnet-medium', description: '구현과 문서: 사과 멀티 판 목업 옮기기', prompt: brief(GOAL + DOC + '목업: 아티팩트 https://claude.ai/artifact/x 대로 옮긴다.\n') };
    assert.match(reason(run(art)), /확인한 표시가 없다/);
    assert.equal(run({ ...art, prompt: art.prompt + '\n사용자 확인: 11-04 판 화면 「빼고가자」\n' }).out, null);
    assert.equal(run({ ...art, prompt: art.prompt + '\n사용자 확인: 없음(사용자가 직접 그린 목업)\n' }).out, null);
  });

  it('옮긴 결과를 보는 리뷰, 판정 지시와 「」 안의 인용은 보지 않는다', () => {
    const m = mk(null);
    assert.equal(run({ ...impl(m), description: '최종 코드 리뷰: 목록 새 목업 이식' }).out, null);
    const quoted = { subagent_type: 'sonnet-medium', description: '구현과 문서: 훅 고치기', prompt: brief(GOAL + DOC + '「목업 그대로 이식」으로 맡기는 일을 막는 훅을 고친다.\n') };
    assert.equal(run(quoted).out, null);
  });

  it('결정어는 사용자 설정을 따른다', () => {
    const cfg = fs.mkdtempSync(path.join(dir, 'cfg-'));
    fs.mkdirSync(path.join(cfg, 'subagent-system'));
    fs.writeFileSync(path.join(cfg, 'subagent-system', 'config.json'), JSON.stringify({ decisionWords: ['대표'] }));
    const m = mk('대표 확인: 11-08 목록 화면 「괜찮아보여」\n');
    assert.equal(run(impl(m), { configDir: cfg }).out, null);
    assert.match(reason(run(impl(mk('사용자 확인: x\n')), { configDir: cfg })), /대표 확인 줄이 없다/);
  });
});

describe('뒤에서 돌리는 실무자 이름 막기', () => {
  const ok = { subagent_type: 'sonnet-medium', description: '문서 작성', prompt: brief(GOAL + DOC) };
  it('name과 run_in_background: true가 함께 있으면 막고 agentId로 보내라고 알린다', () => {
    const r = reason(run({ ...ok, name: 'worker-a', run_in_background: true }));
    assert.match(r, /name을 빼고/);
    assert.match(r, /agentId로 SendMessage/);
  });
  it('짧은 지시문과 haiku 정의여도 막는다', () => {
    assert.match(reason(run({ subagent_type: 'haiku-low', description: '파일 탐색과 검색', prompt: '찾아라', name: 'w', run_in_background: true })), /name을 빼고/);
  });
  it('이름만 있거나(앞에서 돌림), 뒤에서 돌리되 이름이 없거나, 팀원(team_name)이면 막지 않는다', () => {
    assert.match(reason(run({ ...ok, name: 'worker-a', run_in_background: 'true' })), /name을 빼고/);
    assert.equal(run({ ...ok, name: 'worker-a', run_in_background: 'false' }).out, null);
    assert.equal(run({ ...ok, name: 'worker-a' }).out, null);
    assert.equal(run({ ...ok, name: 'worker-a', run_in_background: false }).out, null);
    assert.equal(run({ ...ok, run_in_background: true }).out, null);
    assert.equal(run({ ...ok, name: 'mate', team_name: 't', run_in_background: true }).out, null);
  });
});

// work-bundle.js는 회사 규칙 묶음 파일이라 그 묶음이 없는 설치본 시험에서는 건너뛴다.
const WORK_SCRIPT = path.join(SUB, 'scripts', 'work-bundle.js');
describe('작업 문서가 결정 문서인 지시의 묶음 줄', { skip: !fs.existsSync(WORK_SCRIPT) }, () => {
  const WORKDOC = '# sign-up-form\n<!-- work-doc -->\n목표: 가입 단추가 한 번만 눌린다.\n끝난 기준: 시나리오 통과.\n일 종류: 그 밖(시험)\n\n## 결정\n| 결정 이름 | 정한 것 | 왜 | 버린 안 |\n|:--|:--|:--|:--|\n| 가입 단추 | 한 번만 누른다 | 「한 번만 시작」 | 전원 동의: 느림 |\n\n## 걸리는 규칙\n- R1 TIME-12\n\n## 시나리오\n- S1 새로고침하면 잇는다 (걸린 규칙: R1) | 시험: 판정(UI_WORK 「판정」)\n\n## 아직 안 정한 것\n';
  const RULES = '# 시간\n\n## TIME-12 글 이어 쓰기\n- 값: 새로고침하면 잇는다.\n';
  // 작업 문서와 규칙 문서가 든 임시 프로젝트를 만들고 묶음 파일을 엮어 경로를 돌려준다.
  function setup() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brief-bundle-'));
    fs.mkdirSync(path.join(root, 'docs', 'plan'), { recursive: true });
    fs.mkdirSync(path.join(root, 'docs', 'rules'), { recursive: true });
    const work = path.join(root, 'docs', 'plan', 'sign-up-form.md');
    fs.writeFileSync(work, WORKDOC);
    fs.writeFileSync(path.join(root, 'docs', 'rules', 'rules_time.md'), RULES);
    fs.writeFileSync(path.join(root, 'docs', 'order.md'), '# 작업 방법\n\n## 순서\n1. 규칙을 읽는다.\n');
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'work-docs.json'), JSON.stringify({ kinds: { 시험: [{ file: ['docs/order.md'], sections: ['순서'] }] } }));
    const r = spawnSync(process.execPath, [WORK_SCRIPT, '--work', work, '--root', root, '--home', path.join(root, 'home'), '--rules', path.join(root, 'docs', 'rules'), '--out', path.join(root, 'out')], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return { root, work, bundle: JSON.parse(r.stdout).path };
  }
  const ask = (work, bundleLine) => run({ ...medium, prompt: brief(GOAL + `결정 문서: ${work}\n` + (bundleLine ? `묶음: ${bundleLine}\n` : '')) });

  it('작업 문서를 결정 문서로 주고 묶음 줄이 없으면 deny하고 엮는 명령을 알린다', () => {
    const { work } = setup();
    const r = reason(ask(work, ''));
    assert.match(r, /묶음: <경로>/);
    assert.match(r, /work-bundle\.js --work /);
  });

  it('맞는 묶음 줄이 있으면 통과한다', () => {
    const { work, bundle } = setup();
    assert.equal(ask(work, bundle).out, null);
  });

  it('작업 문서가 바뀌어 묶음이 낡았으면 deny하고 바뀐 원본과 다시 엮는 명령을 알린다', () => {
    const { work, bundle } = setup();
    fs.appendFileSync(work, '- 한 줄 더\n');
    const r = reason(ask(work, bundle));
    assert.match(r, /낡았다/);
    assert.match(r, /sign-up-form/);
    assert.match(r, /work-bundle\.js --work /);
  });

  it('걸리는 규칙 원문이 바뀌어도 묶음이 낡았다고 막는다', () => {
    const { root, work, bundle } = setup();
    fs.appendFileSync(path.join(root, 'docs', 'rules', 'rules_time.md'), '- 값 하나 더: 8\n');
    assert.match(reason(ask(work, bundle)), /낡았다/);
  });

  it('묶음 줄의 파일이 없거나 다른 작업 문서의 묶음이면 deny한다', () => {
    const a = setup();
    const b = setup();
    assert.match(reason(ask(a.work, path.join(a.root, 'nope.md'))), /묶음 파일이 아니거나 없다/);
    assert.match(reason(ask(a.work, b.bundle)), /의 것인데 결정 문서는/);
  });

  it('작업 문서 표시가 없는 결정 문서나 파일이 없는 경로는 묶음 줄을 요구하지 않는다', () => {
    const { root } = setup();
    const plain = path.join(root, 'docs', 'plan', 'big.md');
    fs.writeFileSync(plain, '# 큰 결정 문서\n| 가입 단추 | 한 번만 |\n');
    assert.equal(ask(plain, '').out, null);
    // 표시를 문서 가운데 예로 보이는 문서(규칙 문서)도 작업 문서가 아니다.
    const example = path.join(root, 'docs', 'plan', 'rules.md');
    fs.writeFileSync(example, '# 규칙\n\n본문\n\n```\n<!-- work-doc -->\n```\n'.replace('본문', '가'.repeat(5) + '\n1\n2\n3'));
    assert.equal(ask(example, '').out, null);
    assert.equal(ask(path.join(root, 'docs', 'plan', 'nope.md'), '').out, null);
  });

  it('회사 규칙 묶음이 안 깔리면 이 검사도 쉰다', () => {
    const { work } = setup();
    const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'brief-bundle-cfg-'));
    fs.mkdirSync(path.join(cfg, 'subagent-system'), { recursive: true });
    fs.writeFileSync(path.join(cfg, 'subagent-system', 'bundles.lock.json'), JSON.stringify({ lockVersion: 1, installed: { routing: { options: [], parts: {} } } }));
    assert.equal(run({ ...medium, prompt: brief(GOAL + `결정 문서: ${work}\n`) }, { configDir: cfg }).out, null);
  });
});

// 큰 결정 문서(decision-doc 표시)를 절 없이 통째로 가리킨 지시는 묶음 줄이 없으면 막고, 절을 달았으면 알리기만 한다.
describe('큰 결정 문서를 가리킨 지시의 묶음 줄', { skip: !fs.existsSync(WORK_SCRIPT) }, () => {
  const BIG = '<!-- decision-doc -->\n# 개편\n\n| 결정 이름 | 정한 것 |\n|:--|:--|\n| 목록 칩 | 14px |\n';
  function bigDoc(head = BIG) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brief-big-'));
    const big = path.join(root, 'BIG.md');
    fs.writeFileSync(big, head);
    return { root, big };
  }
  const ask = (line, extra = '', opts) => run({ ...medium, prompt: brief(GOAL + line + '\n' + extra) }, opts);

  it('절 없이 통째로 가리키고 묶음 줄이 없으면 막고, 작업 문서 만들기와 엮는 명령과 출구를 알린다', () => {
    const { big } = bigDoc();
    const r = reason(ask(`결정 문서: ${big}`));
    assert.match(r, /큰 결정 문서/);
    assert.match(r, /work-bundle\.js --work <작업 문서>/);
    assert.match(r, /작업 문서/);
    assert.match(r, /묶음: 없음\(까닭\)/);
    // 다음 줄에 경로가 있는 꼴도 같다.
    assert.match(reason(run({ ...medium, prompt: brief(GOAL + `결정 문서:\n${big}\n`) })), /큰 결정 문서/);
  });

  it('절을 달았으면 막지 않고 알리기만 한다(additionalContext)', () => {
    const { big } = bigDoc();
    const r = ask(`결정 문서: ${big} 「목록 칩」`);
    assert.equal(r.out.hookSpecificOutput.permissionDecision, undefined);
    assert.match(r.out.hookSpecificOutput.additionalContext, /^지시문 점검 알림: .*묶음: <경로>/);
    assert.equal(ask(`결정 문서: ${big} §3`).out.hookSpecificOutput.permissionDecision, undefined);
  });

  it('출구 `묶음: 없음(까닭)`이나 묶음 줄이 있으면 통과한다', () => {
    const { big } = bigDoc();
    assert.equal(ask(`결정 문서: ${big}`, '묶음: 없음(읽기만 하는 점검)').out, null);
    assert.equal(ask(`결정 문서: ${big}`, '묶음: 없음()').out.hookSpecificOutput.permissionDecision, 'deny');
    const a = (() => { const w = fs.mkdtempSync(path.join(os.tmpdir(), 'brief-big2-')); return w; })();
    assert.equal(ask(`결정 문서: ${big}`, `묶음: ${a}/x.md`).out, null);
  });

  it('표시가 없는 문서, 머리 밖의 표시, 없는 파일, 상대 경로는 이 검사 밖이다', () => {
    const { root } = bigDoc();
    const plain = path.join(root, 'plain.md');
    fs.writeFileSync(plain, '# 결정\n| 목록 칩 | 14px |\n');
    assert.equal(ask(`결정 문서: ${plain}`).out, null);
    const late = path.join(root, 'late.md');
    fs.writeFileSync(late, '# 1\n2\n3\n4\n5\n6\n<!-- decision-doc -->\n');
    assert.equal(ask(`결정 문서: ${late}`).out, null);
    assert.equal(ask(`결정 문서: ${root}/nope.md`).out, null);
    assert.equal(ask('결정 문서: docs/plan/BIG.md').out, null);
  });

  it('회사 규칙 묶음이 안 깔리면 이 검사도 쉰다', () => {
    const { big } = bigDoc();
    const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'brief-big-cfg-'));
    fs.mkdirSync(path.join(cfg, 'subagent-system'), { recursive: true });
    fs.writeFileSync(path.join(cfg, 'subagent-system', 'bundles.lock.json'), JSON.stringify({ lockVersion: 1, installed: { routing: { options: [], parts: {} } } }));
    assert.equal(ask(`결정 문서: ${big}`, '', { configDir: cfg }).out, null);
  });
});
