import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Claude Code가 설정 폴더를 CLAUDE_CONFIG_DIR로 옮겨 쓰면 대화 기록도 그 아래에 쌓이므로 같은 변수를 따른다.
export const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
// 대화 기록(*.jsonl)은 프로젝트마다 이 아래 폴더에 따로 쌓인다.
export const PROJECTS_ROOT = path.join(CLAUDE_DIR, 'projects');
// 기록은 프로젝트와 상관없이 한 곳에 모은다. 환경 변수는 실제 기록을 건드리지 않고 시험하려는 용도다.
export const RECORDS_DIR = process.env.SUBAGENT_RECORDS_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'records');
// 모델 배정 표가 있는 문서. 회고는 읽기만 한다. 환경 변수는 다른 표로 시험하려는 용도다.
export const GUIDE_FILE = process.env.SUBAGENT_GUIDE_FILE ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'SUBAGENT_GUIDE.md');
// 서브에이전트 정의(<정의>.md)가 있는 폴더. 환경 변수는 설치본을 건드리지 않고 시험하려는 용도다.
export const AGENTS_DIR = process.env.SUBAGENT_AGENTS_DIR ?? path.join(CLAUDE_DIR, 'agents');
// 회고 방식 설정. 기록 폴더처럼 스크립트 폴더 옆에 있어 설치 위치(CLAUDE_CONFIG_DIR 포함)를 그대로 따른다. 환경 변수는 설치본을 건드리지 않고 시험하려는 용도다.
export const CONFIG_FILE = process.env.SUBAGENT_CONFIG_FILE ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'config.json');
const HEAD_BYTES = 16384;

// Claude Code는 이 기간(일)이 지난 세션 기록을 지운다. 회고가 이 기간 안에 돌지 못하면 그 사이 정정이 사라진다.
export const DEFAULT_RETENTION_DAYS = 30;
// 기록은 프로젝트와 상관없이 모이므로 프로젝트 설정은 읽지 않는다. 공식 사용자 범위는 settings.json뿐이고 이 폴더의 settings.local.json은
// 설정 폴더가 세션의 프로젝트 .claude와 같은 폴더일 때(예: CLAUDE_CONFIG_DIR 없이 홈 폴더에서 연 세션)만 프로젝트 로컬로 읽히는데,
// 어느 쪽이 실제로 적용됐는지 알 수 없다. 둘 다 유효하면 작은 값을 써서 회고를 일찍 묻는다. 큰 값을 쓰면 실제로는 더 짧게 지워지는 기록의 정정을 놓친다.
// 정수가 아니거나 1보다 작거나 파일이 깨졌으면 그 파일의 값은 없는 것으로 보고, 둘 다 없으면 기본값을 쓴다.
export function retentionDays(dir = CLAUDE_DIR) {
  const values = [];
  for (const name of ['settings.local.json', 'settings.json']) {
    try {
      const v = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))?.cleanupPeriodDays;
      if (Number.isInteger(v) && v >= 1) values.push(v);
    } catch {
      // 없거나 깨진 설정 파일은 건너뛴다.
    }
  }
  return values.length ? Math.min(...values) : DEFAULT_RETENTION_DAYS;
}

// 워크트리 세션은 프로젝트 루트 아래 `.claude/worktrees/<이름>`에서 시작하므로 그 꼬리를 떼야 본 프로젝트와 같은 값이 된다.
// Windows 경로는 구분자가 역슬래시라 둘 다 본다.
export const projectRoot = (cwd) => cwd.replace(/[\\/]\.claude[\\/]worktrees[\\/][^\\/]+([\\/].*)?$/, '');

// 기록 파일이 CRLF로 저장돼 있어도 줄 끝에 \r이 남아 마지막 열 값이 달라지지 않게 한다.
export const LINE_BREAK = /\r?\n/;
export function splitLines(text) {
  const lines = text.split(LINE_BREAK);
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

// 세션 기록 앞부분만 읽어 cwd를 찾는다. 폴더가 많아도 파일 전체를 읽지 않기 위해서다.
// 세션 중 cd로 cwd가 바뀌므로 맨 처음 값을 쓴다. 그래야 세션이 시작한 프로젝트로 모인다.
export function sessionCwd(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(HEAD_BYTES);
    const text = buf.toString('utf8', 0, fs.readSync(fd, buf, 0, HEAD_BYTES, 0));
    for (const line of text.split(LINE_BREAK).slice(0, 20)) {
      try {
        const cwd = JSON.parse(line).cwd;
        if (typeof cwd === 'string') return cwd;
      } catch {
        // 앞부분만 읽어 마지막 줄이 잘렸을 수 있다.
      }
    }
  } catch {
    // 읽을 수 없는 파일은 건너뛴다.
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  return null;
}

export function readJsonl(file) {
  return fs
    .readFileSync(file, 'utf8')
    .split(LINE_BREAK)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

// 대화 기록 폴더가 아직 없는 컴퓨터(설정 폴더만 있고 대화를 연 적이 없음)도 정상이라 빈 목록으로 돌려준다.
export function listSessions() {
  if (!fs.existsSync(PROJECTS_ROOT)) return [];
  return fs
    .readdirSync(PROJECTS_ROOT)
    .map((d) => path.join(PROJECTS_ROOT, d))
    .filter((dir) => fs.statSync(dir).isDirectory())
    .flatMap((dir) =>
      fs
        .readdirSync(dir)
        .filter((f) => /^[0-9a-f-]{36}\.jsonl$/.test(f))
        .map((f) => {
          const file = path.join(dir, f);
          return { id: f.replace(/\.jsonl$/, ''), dir, file, mtime: fs.statSync(file).mtimeMs };
        })
    );
}

// 여러 세션의 훅이 동시에 돌아도 머리줄이 한 번만 쓰이도록 wx로 만들고, 줄은 덧붙이기만 한다.
export function appendWithHeader(file, header, lines) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(file, header + '\n', { flag: 'wx' });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
  for (const line of lines) fs.appendFileSync(file, line + '\n');
}

export function localDate(value) {
  const d = new Date(value);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const width = (text) => [...String(text)].reduce((s, ch) => s + (/[ᄀ-ᇿ㄰-㆏가-힯]/.test(ch) ? 2 : 1), 0);

// 한글을 두 칸으로 세어 열을 맞춘다. 앞 leftCols개 열은 왼쪽, 나머지는 오른쪽 정렬.
export function printTable(rows, leftCols) {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => width(r[i]))));
  for (const r of rows) {
    const cells = r.map((cell, i) => (i < leftCols ? String(cell) + ' '.repeat(widths[i] - width(cell)) : ' '.repeat(widths[i] - width(cell)) + cell));
    console.log(cells.join('  ').trimEnd());
  }
}

// 대화 기록의 모델 ID에는 `claude-opus-5-5[1m]`(문맥 창 표시)이나 `-20260101`(날짜) 꼬리가 붙을 수 있다.
// 요율표 키는 꼬리 없는 이름으로 둔다(agent-meter는 이 이름으로만 찾는다). 모델 비교도 꼬리 없는 이름으로 한다.
// 이 두 꼴만 떼고 공급자 접두사와 그 밖의 꼬리는 그대로 둔다. 요율표에 없는 모델로 찍히는 이름도 이 결과다.
export const baseModel = (model) => model.replace(/\[.*\]$/, '').replace(/-\d{8}$/, '');
