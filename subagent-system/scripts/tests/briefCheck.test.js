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
});
