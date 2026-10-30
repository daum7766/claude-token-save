// 무엇: 키트 문서가 가리키는 것이 실제로 있는지 본다(`docs/TESTING.md` 「문서 계약 시험」).
//   (1) 문서의 백틱 `--플래그`가 키트 스크립트와 훅에 있다. 스크립트 이름이 같은 백틱 안에 있으면 그 스크립트에서 찾는다.
//   (2) APPLY_GUIDE 「개인용과 회사용」 표의 첫 칸 `(키)`가 kit-setup.js나 kitProfile.js에 있다.
//   (3) 문서의 백틱 `이름.js`가 scripts/나 hooks/에 있다.
//   (4) `<문서> 「<절>」` 꼴 가리킴이 그 문서의 제목에 있다. 문서 이름은 README가 아닌 키트 문서 이름이거나 GUIDE, RETRO 같은 줄임말이다.
//   (5) kit-setup.js가 JSON으로 내는 최상위 키(report.X, gitAsk.X 가운데 camelCase)가 APPLY_GUIDE에 나온다.
//       스크립트가 알려 주는데 문서가 받지 않으면 Claude가 사용자에게 전하지 못한다.
//   (6) 설정 조합: 무엇을 묻고 바로 하는지는 profile 하나가 정하고 따로 바꾸는 키가 없다(kitProfile.js). 그 판정이던 옛 키 넷(RETIRED_POLICY_KEYS)의 이름이
//       키트 문서(CHANGES 제외)와 코드(kitProfile.js 제외)에 없다. 따로 바꾸는 키(retroWriteAllow, commitCheck)를 말하는 줄이
//       「개인용(`키` …)」, 「`키`(개인용)」, 「`값`(회사용)」 꼴로 profile 말을 키 값 자리에 쓰지 않는다.
//       APPLY_GUIDE 「개인용과 회사용」 표의 키 집합이 kitProfile.js PROFILES의 키 집합과 같다.
//   (7) 절차 나열: RETRO 「회고 단계」 5번이 할 일로 든 `--플래그`와 「…」도 합니다 꼴의 「절」을 「회고 서브에이전트가 하는 일」 1번이 빠뜨리지 않는다.
// 왜: 본격 점검의 도구 호출 절반이 "문서가 가리키는 플래그, 절, 키가 있는가"를 하나씩 대조하는 일이었고,
//   앞 회차들도 "없는 것을 가리킴" 막음을 냈다. 기계가 전부 보게 해 점검이 읽는 일만 하게 한다.
// 범위와 까닭: 거짓 경보가 없게 확실히 뽑히는 꼴만 본다.
//   - 보지 않는 것: 출력 줄 이름(「…」는 강조에도 쓰여 뽑으면 거짓 경보가 난다), 줄임말 뒤에 괄호로 절을 적은 TEST_SCENARIOS의 가리킴,
//     바깥 도구(git, claude 등)와 Claude Code 설정 키, 문서끼리 겹치는 문장.
//   - (6)은 줄 안의 꼴만 보고 문장 뜻은 보지 않는다. 표 줄(`|`로 시작)과 CHANGES는 보지 않는다(표는 기본값을 적는 자리다). 「(회사용 기본)」처럼 기본값임을 밝힌 말은 통과한다.
//     (7)은 5번의 `--플래그`와 「…」도 합니다 꼴로 든 문서 제목만 보고, 그 밖의 말이 빠진 것은 보지 않는다.
//   - 키트 원본에서만 돈다. 설치본에는 APPLY_GUIDE, README, rules/가 없다.
// 전제: 새 문서나 새 바깥 도구 플래그를 문서에 쓰면 아래 목록에 이름을 더한다(더하는 쪽이 실제로 있는 것인지 보게 하려는 것이다).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO = path.resolve(SUB, '..');
const SKIP = fs.existsSync(path.join(SUB, 'rules')) ? false : '설치본 배치(키트 원본에서만 시험)';

const read = (f) => fs.readFileSync(f, 'utf8');
const listFiles = (dir, ext) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(ext)).map((f) => path.join(dir, f)) : []);

// 문서: 키트 문서 전부(CHANGES는 이력이라 뺀다). 스킬 문서와 규칙 문서, README, 키트 관리용 CLAUDE.md를 포함한다.
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  if (e.isDirectory()) return ['scripts', 'node_modules', '.kit-base'].includes(e.name) ? [] : walk(p);
  return e.name.endsWith('.md') ? [p] : [];
});
const DOCS = [...walk(SUB), path.join(REPO, 'README.md'), path.join(REPO, 'CLAUDE.md')]
  .filter((f) => fs.existsSync(f) && path.basename(f) !== 'CHANGES.md');

const SCRIPT_DIRS = [path.join(SUB, 'scripts'), path.join(SUB, 'hooks')];
const SCRIPT_FILES = SCRIPT_DIRS.flatMap((d) => listFiles(d, '.js'));
const scriptText = new Map(SCRIPT_FILES.map((f) => [path.basename(f), read(f)]));
const ALL_SCRIPT_TEXT = [...scriptText.values()].join('\n');
// 설치 문서는 `<kit-setup>`으로 kit-setup.js를 줄여 쓴다.
const ALIAS_SCRIPT = { '<kit-setup>': 'kit-setup.js' };

const spansOf = (text) => [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
const rel = (f) => path.relative(REPO, f);

// 바깥 도구가 받는 플래그(키트 스크립트에 없다). 문서에 새로 쓰면 여기에 더한다.
const OUTSIDE_FLAGS = new Set(['--help', '--test', '--test-reporter', '--settings', '--json', '--local', '--marketplace', '--values-stdin', '--continue', '--config', '--debug', '--get', '--unset']);
// 바깥 도구(git, claude)의 플래그를 설명하는 문서라, 키트 스크립트 이름이 함께 없는 플래그는 보지 않는다.
const EXTERNAL_DOC = (f) => /skills\/git-work\//.test(f.split(path.sep).join('/')) || path.basename(f) === 'BACKGROUND.md';

describe('TESTING 「문서 계약 시험」: 키트 문서가 가리키는 스크립트 플래그', { skip: SKIP }, () => {
  it('백틱 안의 --플래그는 키트 스크립트나 훅에 있고, 스크립트 이름이 함께 있으면 그 스크립트에 있다', () => {
    const missing = [];
    for (const f of DOCS) {
      for (const span of spansOf(read(f))) {
        const flags = [...span.matchAll(/(?<![\w-])(--[a-z][a-z0-9-]*)/g)].map((m) => m[1]);
        if (!flags.length) continue;
        const named = [...span.matchAll(/([\w-]+\.js)\b/g)].map((m) => m[1]).filter((n) => scriptText.has(n));
        const alias = Object.entries(ALIAS_SCRIPT).find(([k]) => span.includes(k));
        if (alias) named.push(alias[1]);
        for (const flag of flags) {
          if (OUTSIDE_FLAGS.has(flag) || (EXTERNAL_DOC(f) && !named.length)) continue;
          const pool = named.length ? named.map((n) => scriptText.get(n)).join('\n') : ALL_SCRIPT_TEXT;
          if (!pool.includes(`'${flag}'`) && !pool.includes(`${flag} `) && !pool.includes(`${flag}\n`) && !pool.includes(`${flag}'`) && !pool.includes(`${flag}<`) && !pool.includes(`${flag}]`) && !pool.includes(`${flag}=`)) {
            missing.push(`${rel(f)}: ${flag}${named.length ? ` (${named.join(', ')})` : ''}`);
          }
        }
      }
    }
    assert.deepEqual([...new Set(missing)], []);
  });
});

describe('TESTING 「문서 계약 시험」: 키트 문서가 가리키는 설정 키와 스크립트', { skip: SKIP }, () => {
  it('APPLY_GUIDE 「개인용과 회사용」 표의 첫 칸 (키)는 kit-setup.js나 kitProfile.js에 있다', () => {
    const text = read(path.join(SUB, 'APPLY_GUIDE.md'));
    const section = text.slice(text.indexOf('## 개인용과 회사용'));
    const keys = [...section.matchAll(/^\| [^|]*\(`([a-zA-Z]+)`[^|]*\) \|/gm)].map((m) => m[1]);
    assert.ok(keys.length >= 3, `표에서 키를 ${keys.length}개만 뽑았다`);
    const setup = scriptText.get('kit-setup.js') + scriptText.get('kitProfile.js');
    assert.deepEqual(keys.filter((k) => !setup.includes(k)), []);
  });

  it('백틱 안의 이름.js는 scripts나 hooks에 있다', () => {
    const missing = [];
    for (const f of DOCS) {
      for (const span of spansOf(read(f))) {
        for (const m of span.matchAll(/(?<![\w./<-])((?:[\w-]+\/)*[\w-]+\.js)\b/g)) {
          const name = path.basename(m[1]);
          // 프로젝트 쪽 예시(tool.js 같은 가상 이름)가 아니라 키트 스크립트 이름 꼴만 본다: 하이픈이 든 이름이나 scripts/hooks 경로.
          if (!/-/.test(name) && !/(^|\/)(scripts|hooks)\//.test(m[1])) continue;
          if (!scriptText.has(name)) missing.push(`${rel(f)}: ${m[1]}`);
        }
      }
    }
    assert.deepEqual([...new Set(missing)], []);
  });

  it('kit-setup.js가 JSON으로 내는 camelCase 키는 APPLY_GUIDE에 나온다', () => {
    const setup = scriptText.get('kit-setup.js');
    const keys = new Set([...setup.matchAll(/\b(?:report|out(?:\.gitAsk)?)\.([a-z]+[A-Z][A-Za-z]*)\s*=[^=]/g)].map((m) => m[1]));
    assert.ok(keys.has('keptCommitAsks') && keys.has('conflictFiles'), `뽑힌 키: ${[...keys].join(', ')}`);
    const guide = read(path.join(SUB, 'APPLY_GUIDE.md'));
    // 사용자에게 전할 값이 아니라 점검이나 되돌리기에만 쓰는 값. 새 키가 여기 없고 문서에도 없으면 문서가 받을지 먼저 정한다.
    const INTERNAL = new Set(['baseFrom', 'legacyZones', 'hooksRemoved', 'settingsBackup']);
    assert.deepEqual([...keys].filter((k) => !INTERNAL.has(k) && !guide.includes(k)), []);
  });
});

describe('TESTING 「문서 계약 시험」: 키트 문서 안의 「절 이름」 가리킴', { skip: SKIP }, () => {
  // 사용자 CLAUDE.md나 프로젝트 CLAUDE.md를 가리키는 「올릴 것」 같은 말과 섞이지 않게 docs/와 APPLY_GUIDE, BACKGROUND만 이름으로 받는다.
  const NAMES = new Map();
  for (const f of DOCS.filter((x) => x.includes(`${path.sep}docs${path.sep}`) || ['APPLY_GUIDE.md', 'BACKGROUND.md'].includes(path.basename(x)))) NAMES.set(path.basename(f, '.md'), f);
  const ALIASES = { GUIDE: 'SUBAGENT_GUIDE', SITUATIONS: 'SUBAGENT_SITUATIONS', CHECKLIST: 'SUBAGENT_BRIEF_CHECKLIST' };
  const headingsOf = (f) => read(f).split('\n').filter((l) => /^#{2,4} /.test(l)).map((l) => l.replace(/^#+ /, '').trim());

  it('<문서> 「<절>」 꼴의 절은 그 문서의 제목에 있다', () => {
    const names = [...NAMES.keys(), ...Object.keys(ALIASES)].sort((a, b) => b.length - a.length);
    const re = new RegExp(`(?<![A-Za-z_])(${names.join('|')})(?:\\.md)?\`?(?:의|와)?\\s*「([^」]+)」`, 'g');
    const missing = [];
    let checked = 0;
    for (const f of DOCS) {
      const text = read(f).replace(/```[\s\S]*?```/g, '');
      for (const m of text.matchAll(re)) {
        const doc = NAMES.get(ALIASES[m[1]] ?? m[1]);
        if (!doc) continue;
        const heading = m[2];
        checked++;
        if (!headingsOf(doc).some((h) => h.includes(heading))) missing.push(`${rel(f)}: ${m[1]} 「${heading}」`);
      }
    }
    assert.ok(checked >= 40, `가리킴을 ${checked}개만 뽑았다`);
    assert.deepEqual([...new Set(missing)], []);
  });
});

describe('TESTING 「문서 계약 시험」: 설정 조합과 절차 나열', { skip: SKIP }, () => {
  // 따로 바꾸는 키만 본다. 무엇을 묻는지는 profile 하나가 정하므로 그 판정이던 옛 키는 아래 첫 시험이 문서와 코드에서 막는다.
  const KEYS = ['retroWriteAllow', 'commitCheck'];
  const VALUES = ['block', 'off'];
  const keyAlt = KEYS.join('|');
  const valueAlt = VALUES.join('|');
  const BT = '`';
  const TAILS = [
    new RegExp('(개인용|회사용)\\s*\\(\\s*' + BT + '(' + keyAlt + ')' + BT),
    new RegExp(BT + '(' + keyAlt + ')' + BT + '[^\\n`]{0,12}\\((개인용|회사용)\\)'),
    new RegExp(BT + '(' + valueAlt + ')' + BT + '\\s*\\((개인용|회사용)\\)'),
  ];
  const RETIRED = ['autoApplyRules', 'autoCreate', 'actThreshold', 'methodCommit'];

  it('profile이 정하는 옛 판정 키 넷의 이름은 키트 문서(CHANGES 제외)와 코드(kitProfile.js 제외)에 없다', () => {
    const found = [];
    for (const f of DOCS) {
      read(f).split('\n').forEach((line, i) => {
        for (const k of RETIRED) if (line.includes(k)) found.push(`${rel(f)}:${i + 1}: ${k}`);
      });
    }
    for (const [name, text] of scriptText) {
      if (name === 'kitProfile.js') continue;
      for (const k of RETIRED) if (text.includes(k)) found.push(`${name}: ${k}`);
    }
    assert.deepEqual(found, []);
    const profile = read(path.join(SUB, 'scripts', 'kitProfile.js'));
    for (const k of RETIRED) assert.ok(profile.includes(`'${k}'`), `kitProfile.js의 RETIRED_POLICY_KEYS에 ${k}가 없다`);
  });

  it('따로 바꾸는 키가 걸린 판정은 개인용, 회사용 꼬리로 키 값을 대신 말하지 않는다', () => {
    const bad = [];
    for (const f of DOCS) {
      read(f).split('\n').forEach((line, i) => {
        if (line.trimStart().startsWith('|')) return;
        if (TAILS.some((re) => re.test(line))) bad.push(`${rel(f)}:${i + 1}: ${line.trim().slice(0, 80)}`);
      });
    }
    assert.deepEqual(bad, []);
    assert.match(read(path.join(SUB, 'docs', 'RETRO.md')), /`profile`\(개인용, 회사용\) 하나가 정하고 따로 바꾸는 설정 키가 없으며/);
  });

  it('APPLY_GUIDE 「개인용과 회사용」 표의 키는 kitProfile.js PROFILES의 키와 같다', () => {
    const setup = read(path.join(SUB, 'scripts', 'kitProfile.js'));
    const keysOf = (name) => {
      const m = setup.match(new RegExp(`^\\s*${name}: \\{([^}]*)\\}`, 'm'));
      assert.ok(m, `PROFILES.${name}을 못 찾았다`);
      return [...m[1].matchAll(/([a-zA-Z]+):/g)].map((x) => x[1]).sort();
    };
    const personal = keysOf('personal');
    assert.deepEqual(keysOf('company'), personal);
    const text = read(path.join(SUB, 'APPLY_GUIDE.md'));
    const section = text.slice(text.indexOf('## 개인용과 회사용'));
    const tableKeys = [...section.matchAll(/^\| [^|]*\(`([a-zA-Z]+)`[^|]*\) \|/gm)].map((m) => m[1]);
    // git 확인 창(permissions.ask)과 충돌 파일 줄은 설정 키가 아닌 행이라 (키) 꼴이 없어 뽑히지 않는다.
    assert.deepEqual([...new Set(tableKeys)].sort(), personal);
    for (const k of RETIRED) assert.equal(personal.includes(k), false, `PROFILES에 옛 판정 키 ${k}가 있다`);
  });

  it('RETRO 「회고 단계」 5번이 이름으로 든 --플래그와 「절」은 서브에이전트 순서 1번에도 있다', () => {
    const text = read(path.join(SUB, 'docs', 'RETRO.md'));
    const from = text.indexOf('\n5. 반복과 고침 기록과 문서를 보고');
    const to = text.indexOf('\n6. 회고 출력의', from);
    assert.ok(from > 0 && to > from, '5번 범위를 못 찾았다');
    const step5 = text.slice(from, to);
    const headings = new Set(text.split('\n').filter((l) => /^#{2,4} /.test(l)).map((l) => l.replace(/^#+ /, '').trim()));
    // 「절」은 「…」도 합니다 꼴로 할 일로 든 것만 센다(「…」에 있습니다 같은 가리킴은 뺀다).
    const todo = [...step5.matchAll(/「([^」]+)」(?:와 「([^」]+)」)?도 합니다/g)].flatMap((m) => [m[1], m[2]]).filter((h) => h && headings.has(h));
    const names = [...[...step5.matchAll(/(?<![\w-])(--[a-z][a-z0-9-]*)/g)].map((m) => m[1]), ...todo];
    assert.ok(names.includes('--repeats') && names.includes('승인 창 보기') && names.includes('규칙 점검'), `뽑힌 이름: ${names.join(', ')}`);
    const subFrom = text.indexOf('### 회고 서브에이전트가 하는 일');
    const subStep1 = text.slice(subFrom, text.indexOf('\n2. 결과를 아래', subFrom));
    assert.ok(subFrom > 0 && subStep1.length > 100, '서브에이전트 순서 1번을 못 찾았다');
    assert.deepEqual([...new Set(names)].filter((n) => !subStep1.includes(n)), []);
  });
});
