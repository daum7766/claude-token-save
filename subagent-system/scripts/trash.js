// 파일과 폴더를 영구 삭제하지 않고 운영체제의 휴지통으로 옮긴다. `node trash.js <경로>…`
// 왜: 지운 뒤 문제가 생겨도 되돌릴 수 있게 하려는 것이다. 안전장치 묶음의 deleteToTrash를 켜면 rm-guard가 rm 대신 이 스크립트를 쓰게 한다.
// 전제:
//  - macOS는 /usr/bin/trash, 없으면 Finder(osascript). Linux와 그 밖은 gio trash, 없거나 실패하면 freedesktop 휴지통 폴더(~/.local/share/Trash)에 옮기고 .trashinfo를 적는다. Windows는 PowerShell로 휴지통에 보낸다.
//  - 휴지통에 못 보내면 그 경로는 지우지 않고 실패로 끝낸다(영구 삭제로 넘어가지 않는다). 옮긴 뒤 경로가 남아 있어도 실패다.
//  - freedesktop 폴더로는 같은 디스크 안에서만 옮긴다. 다른 디스크면 실패다(복사 뒤 지우기는 하다 끊기면 반쪽이 남는다).
//  - Windows의 네트워크 경로는 휴지통이 없어 API가 영구 삭제하므로 보내지 않고 실패로 끝낸다.
//  - 종료 코드: 모두 옮김 0, 하나라도 못 옮김 1, 인자 없음 2.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MAC_TRASH = '/usr/bin/trash';
const FINDER_SCRIPT = ['-e', 'on run argv', '-e', 'tell application "Finder" to delete (POSIX file (item 1 of argv) as alias)', '-e', 'end run'];
const WIN_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  'Add-Type -AssemblyName Microsoft.VisualBasic',
  '$p = $env:KIT_TRASH_PATH',
  '$root = [System.IO.Path]::GetPathRoot($p)',
  "if ($root.StartsWith('\\\\') -or ([System.IO.DriveInfo]::new($root).DriveType -eq 'Network')) { throw 'network path has no recycle bin' }",
  "if (Test-Path -LiteralPath $p -PathType Container) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, 'OnlyErrorDialogs', 'SendToRecycleBin') }",
  "else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin') }",
].join('; ');

const lexists = (p) => {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
};
const defaultRun = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 60000, ...opts });
const ok = (r) => !r.error && r.status === 0;
const why = (r) => (r.error ? r.error.message : String(r.stderr || '').trim() || `종료 코드 ${r.status}`);

const z = (n) => String(n).padStart(2, '0');
const localStamp = (d) => `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;

// freedesktop 휴지통 규격: files/<이름>에 옮기고 info/<이름>.trashinfo에 원래 경로와 지운 때를 적는다. 이름이 겹치면 .2, .3을 붙인다.
function freedesktopTrash(abs, { trashHome, now }) {
  const files = path.join(trashHome, 'files');
  const info = path.join(trashHome, 'info');
  fs.mkdirSync(files, { recursive: true, mode: 0o700 });
  fs.mkdirSync(info, { recursive: true, mode: 0o700 });
  const base = path.basename(abs);
  for (let n = 1; ; n += 1) {
    const name = n === 1 ? base : `${base}.${n}`;
    const infoFile = path.join(info, `${name}.trashinfo`);
    let fd;
    try {
      fd = fs.openSync(infoFile, 'wx', 0o600);
    } catch (e) {
      if (e.code === 'EEXIST') continue;
      throw e;
    }
    try {
      if (lexists(path.join(files, name))) {
        fs.closeSync(fd);
        fs.unlinkSync(infoFile);
        continue;
      }
      fs.writeSync(fd, `[Trash Info]\nPath=${abs.split('/').map(encodeURIComponent).join('/')}\nDeletionDate=${localStamp(now)}\n`);
      fs.closeSync(fd);
      fs.renameSync(abs, path.join(files, name));
      return;
    } catch (e) {
      try {
        fs.unlinkSync(infoFile);
      } catch {
        // 적다 만 기록이 없으면 그만이다
      }
      throw e.code === 'EXDEV' ? new Error('다른 디스크라 휴지통 폴더로 옮기지 못함') : e;
    }
  }
}

// 경로마다 휴지통으로 옮기고 [{ path, ok, error? }]를 돌려준다. deps는 시험이 운영체제, 명령, 휴지통 폴더를 바꿔 끼우는 자리다.
export function trashPaths(paths, deps = {}) {
  const platform = deps.platform ?? process.platform;
  const run = deps.run ?? defaultRun;
  const exists = deps.exists ?? lexists;
  const trashHome = deps.trashHome ?? path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'Trash');
  const now = deps.now ?? new Date();
  return paths.map((p) => {
    const abs = path.resolve(p);
    if (!exists(abs)) return { path: p, ok: false, error: '없는 경로' };
    let error = null;
    try {
      if (platform === 'darwin') {
        if (exists(MAC_TRASH)) {
          const r = run(MAC_TRASH, [abs]);
          if (!ok(r)) error = why(r);
        } else if (fs.lstatSync(abs).isSymbolicLink()) error = 'Finder는 링크 대신 링크가 가리키는 곳을 옮겨 링크는 옮기지 않음';
        else {
          const r = run('osascript', [...FINDER_SCRIPT, abs]);
          if (!ok(r)) error = why(r);
        }
      } else if (platform === 'win32') {
        const opts = { env: { ...process.env, KIT_TRASH_PATH: abs } };
        let r = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WIN_SCRIPT], opts);
        if (r.error?.code === 'ENOENT') r = run('pwsh', ['-NoProfile', '-NonInteractive', '-Command', WIN_SCRIPT], opts);
        if (!ok(r)) error = why(r);
      } else {
        const r = run('gio', ['trash', abs]);
        if (!ok(r) && exists(abs)) freedesktopTrash(abs, { trashHome, now });
      }
    } catch (e) {
      error = e.message;
    }
    if (!error && exists(abs)) error = '옮긴 뒤에도 경로가 남아 있음';
    return error ? { path: p, ok: false, error } : { path: p, ok: true };
  });
}

function main(args) {
  if (!args.length) {
    process.stderr.write('사용법: node trash.js <경로>…\n');
    return 2;
  }
  const results = trashPaths(args);
  for (const r of results) {
    if (r.ok) process.stdout.write(`휴지통으로 옮김: ${r.path}\n`);
    else process.stderr.write(`옮기지 못함(지우지 않음): ${r.path}: ${r.error}\n`);
  }
  return results.every((r) => r.ok) ? 0 : 1;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) process.exit(main(process.argv.slice(2)));
