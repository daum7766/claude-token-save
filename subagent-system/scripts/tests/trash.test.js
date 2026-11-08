// 무엇: 휴지통 스크립트(trash.js)가 운영체제마다 맞는 길로 옮기고, 못 옮기면 지우지 않고 실패로 끝내는지 본다.
// 왜: 이 스크립트가 실패를 성공으로 알리거나 영구 삭제로 넘어가면 휴지통 설정을 켠 사용자가 되돌릴 수 없는 삭제를 겪는다.
// 전제: 실제 휴지통을 건드리지 않는다. 명령은 대역(run)으로, freedesktop 휴지통은 임시 폴더로 바꿔 끼운다.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { trashPaths } from '../trash.js';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'trash.js');
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'trash-')));
const touch = (dir, name) => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, 'x');
  return p;
};
const enoent = () => ({ error: Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }) });
// 명령 대역: 부른 것을 적고, moved가 참이면 대상을 지워 옮긴 것처럼 한다.
const fakeRun = (result, { moved = true } = {}) => {
  const calls = [];
  const run = (cmd, args, opts) => {
    calls.push({ cmd, args, env: opts?.env });
    const r = typeof result === 'function' ? result(cmd) : result;
    if (moved && r.status === 0) fs.rmSync(opts?.env?.KIT_TRASH_PATH ?? args[args.length - 1], { recursive: true, force: true });
    return r;
  };
  return { run, calls };
};
const realExists = (p) => {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
};

describe('trash.js', () => {
  it('gio가 없으면 freedesktop 휴지통 폴더로 옮기고 원래 경로와 지운 때를 적으며, 이름이 겹치면 번호를 붙인다', () => {
    const dir = tmp();
    const home = path.join(dir, 'Trash');
    const now = new Date(2026, 0, 2, 3, 4, 5);
    const a = touch(dir, 'a b.txt');
    const [r1] = trashPaths([a], { platform: 'linux', run: () => enoent(), trashHome: home, now });
    touch(dir, 'a b.txt');
    const [r2] = trashPaths([a], { platform: 'linux', run: () => enoent(), trashHome: home, now });
    assert.deepEqual([r1.ok, r2.ok, fs.existsSync(a)], [true, true, false]);
    assert.deepEqual(fs.readdirSync(path.join(home, 'files')).sort(), ['a b.txt', 'a b.txt.2']);
    const info = fs.readFileSync(path.join(home, 'info', 'a b.txt.trashinfo'), 'utf8');
    assert.equal(info, `[Trash Info]\nPath=${a.split('/').map(encodeURIComponent).join('/')}\nDeletionDate=2026-01-02T03:04:05\n`);
  });

  it('gio가 옮기면 휴지통 폴더는 쓰지 않는다', () => {
    const dir = tmp();
    const a = touch(dir, 'a');
    const { run, calls } = fakeRun({ status: 0 });
    const [r] = trashPaths([a], { platform: 'linux', run, trashHome: path.join(dir, 'Trash') });
    assert.equal(r.ok, true);
    assert.deepEqual(calls.map((c) => [c.cmd, ...c.args]), [['gio', 'trash', a]]);
    assert.equal(fs.existsSync(path.join(dir, 'Trash')), false);
  });

  it('휴지통 폴더로도 못 옮기면 원본을 지우지 않고 실패로 알린다', () => {
    const dir = tmp();
    const a = touch(dir, 'a');
    const blocker = touch(dir, 'not-a-dir');
    const [r] = trashPaths([a], { platform: 'linux', run: () => ({ status: 1, stderr: 'no trash' }), trashHome: path.join(blocker, 'Trash') });
    assert.equal(r.ok, false);
    assert.equal(fs.existsSync(a), true);
  });

  it('macOS는 /usr/bin/trash가 있으면 그것을 쓰고, 실패하거나 옮긴 뒤에도 경로가 남으면 실패로 알린다', () => {
    const dir = tmp();
    const exists = (p) => p === '/usr/bin/trash' || realExists(p);
    const a = touch(dir, 'a');
    const good = fakeRun({ status: 0 });
    assert.equal(trashPaths([a], { platform: 'darwin', run: good.run, exists })[0].ok, true);
    assert.deepEqual(good.calls.map((c) => [c.cmd, ...c.args]), [['/usr/bin/trash', a]]);
    const b = touch(dir, 'b');
    assert.equal(trashPaths([b], { platform: 'darwin', run: fakeRun({ status: 5, stderr: 'err' }).run, exists })[0].ok, false);
    const stuck = trashPaths([b], { platform: 'darwin', run: fakeRun({ status: 0 }, { moved: false }).run, exists })[0];
    assert.deepEqual([stuck.ok, stuck.error, fs.existsSync(b)], [false, '옮긴 뒤에도 경로가 남아 있음', true]);
  });

  it('macOS에 /usr/bin/trash가 없으면 Finder로 옮기고, 링크는 가리키는 곳이 옮겨지므로 옮기지 않는다', () => {
    const dir = tmp();
    const exists = (p) => p !== '/usr/bin/trash' && realExists(p);
    const a = touch(dir, 'a');
    const { run, calls } = fakeRun({ status: 0 });
    assert.equal(trashPaths([a], { platform: 'darwin', run, exists })[0].ok, true);
    assert.equal(calls[0].cmd, 'osascript');
    assert.equal(calls[0].args[calls[0].args.length - 1], a);
    const link = path.join(dir, 'link');
    fs.symlinkSync(touch(dir, 'target'), link);
    assert.equal(trashPaths([link], { platform: 'darwin', run, exists })[0].ok, false);
    assert.equal(calls.length, 1);
  });

  it('Windows는 PowerShell에 경로를 넘겨 휴지통으로 보내고, powershell.exe가 없으면 pwsh를 쓴다', () => {
    const dir = tmp();
    const a = touch(dir, 'a');
    const { run, calls } = fakeRun((cmd) => (cmd === 'powershell.exe' ? enoent() : { status: 0 }));
    assert.equal(trashPaths([a], { platform: 'win32', run })[0].ok, true);
    assert.deepEqual(calls.map((c) => c.cmd), ['powershell.exe', 'pwsh']);
    assert.equal(calls[1].env.KIT_TRASH_PATH, a);
    assert.match(calls[1].args.join(' '), /SendToRecycleBin/);
  });

  it('없는 경로는 명령을 부르지 않고 실패로 알리며, 명령줄은 하나라도 못 옮기면 1, 인자가 없으면 2로 끝난다', () => {
    const { run, calls } = fakeRun({ status: 0 });
    assert.deepEqual(trashPaths(['/nonexistent/x'], { platform: 'linux', run }), [{ path: '/nonexistent/x', ok: false, error: '없는 경로' }]);
    assert.equal(calls.length, 0);
    assert.equal(spawnSync(process.execPath, [SCRIPT, '/nonexistent/x'], { encoding: 'utf8' }).status, 1);
    assert.equal(spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' }).status, 2);
  });
});
