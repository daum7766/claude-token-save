#!/usr/bin/env node
// agent-meter mod를 설정 폴더의 mods에 넣고 settings.json에 등록한다
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import readline from 'node:readline'
import { spawnSync } from 'node:child_process'

// 항목 하나를 비교용 절대경로로 만든다. 대소문자는 Windows에서만 무시한다
export function normalizeDir(entry, home, pathMod = path, isWin = process.platform === 'win32') {
  let p = entry
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) p = home + p.slice(1)
  p = pathMod.resolve(p)
  return isWin ? p.toLowerCase() : p
}

// 기존 항목은 원래 글자 그대로 두고, 같은 폴더가 없을 때만 dir을 뒤에 더한다
export function addPluginDir(current, dir, { home = os.homedir(), pathMod = path, isWin = process.platform === 'win32' } = {}) {
  const entries = (current || '').split(pathMod.delimiter).filter(Boolean)
  const target = normalizeDir(dir, home, pathMod, isWin)
  const exists = entries.some(e => normalizeDir(e, home, pathMod, isWin) === target)
  if (!exists) entries.push(dir)
  return { value: entries.join(pathMod.delimiter), added: !exists }
}

const KNOWN_ARGS = ['--keepalive', '--no-keepalive']

export const USAGE = '사용법: install-agent-meter.mjs [--keepalive | --no-keepalive] (keep-alive 켬 또는 끔. 정하지 않으면 터미널에서는 묻고 아니면 기존 값을 둡니다)'

// 오타가 난 인자로 그냥 설치하지 않도록 모르는 인자를 가려낸다. 도움말 인자가 있으면 설치하지 않고 쓰는 법만 보이게 한다
export function checkArgs(argv) {
  return {
    help: argv.some(a => a === '--help' || a === '-h'),
    unknown: argv.filter(a => !KNOWN_ARGS.includes(a) && a !== '--help' && a !== '-h'),
  }
}

// mod(register.tsx의 isKeepAliveOn)가 끈 것으로 읽는 값과 같은 규칙이다. 키가 있기만 해서는 끈 것이 아니다
export function isOffValue(v) {
  return ['0', 'false', 'off'].includes(String(v ?? '').trim().toLowerCase())
}

// 'on'과 'off'는 인자로 정한 값, undefined는 정하지 않음(묻거나 기존 값을 둔다)
export function parseKeepAliveArg(argv) {
  const off = argv.includes('--no-keepalive')
  const on = argv.includes('--keepalive')
  if (off && on) throw new Error('--keepalive와 --no-keepalive는 함께 쓸 수 없습니다.')
  return off ? 'off' : on ? 'on' : undefined
}

// y로 시작하면 켜고 n으로 시작하면 끈다. 답이 비면 지금 상태(current)를 둔다. 다시 깔며 Enter만 쳐서 꺼 둔 것이 켜지지 않게 하려는 것이다. 그 밖의 답은 다시 묻는다
export function parseKeepAliveAnswer(answer, current = 'on') {
  const a = answer.trim().toLowerCase()
  if (a === '') return current
  if (a.startsWith('y')) return 'on'
  if (a.startsWith('n')) return 'off'
  return undefined
}

// 끄면 키를 넣고, 켜면 키를 지운다(기본이 켬). 정하지 않았으면 그대로 둔다
export function applyKeepAliveChoice(env, choice) {
  if (choice === 'off') env.AGENT_METER_KEEPALIVE = '0'
  else if (choice === 'on') delete env.AGENT_METER_KEEPALIVE
}

// 질문 여럿을 readline 하나로 묻는다. Ctrl-D로 입력이 닫히면 남은 질문은 건너뛰고 기존 값을 두는 것으로 마친다
async function askChoices(questions) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const answers = {}
  try {
    for (const { key, prompt, parse } of questions) {
      for (;;) {
        const answer = await new Promise(resolve => {
          rl.once('close', () => resolve(null))
          rl.question(prompt, resolve)
        })
        if (answer === null) {
          console.log()
          return answers
        }
        const choice = parse(answer)
        if (choice) {
          answers[key] = choice
          break
        }
        console.log('y 또는 n으로 답하세요.')
      }
    }
    return answers
  } finally {
    rl.close()
  }
}

function stamp(d = new Date()) {
  const z = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`
}

function hasCommand(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'ignore' })
  return !r.error && r.status === 0
}

function jqHint() {
  if (process.platform === 'darwin') return 'brew install jq'
  if (process.platform === 'win32') return 'winget install jqlang.jq'
  return '배포판 패키지 관리자로 설치(예: sudo apt install jq, sudo dnf install jq)'
}

function fail(msg) {
  console.error(msg)
  process.exit(1)
}

// 깨진 파일이면 아무것도 바꾸지 않고 멈춘다. 질문을 기다리는 동안 다른 세션이 고친 것을 잃지 않도록 쓰기 직전에 한 번 더 부른다
function readSettings(settingsPath) {
  const text = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath, 'utf8').replace(/^\uFEFF/, '').trim() : ''
  let settings
  try {
    settings = JSON.parse(text || '{}')
  } catch (e) {
    fail(`settings.json이 올바른 JSON이 아니라 멈춥니다(${e.message}). 파일을 고친 뒤 다시 실행하세요: ${settingsPath}`)
  }
  if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
    fail(`settings.json 최상위가 객체가 아니라 멈춥니다: ${settingsPath}`)
  }
  if (settings.env === undefined) settings.env = {}
  if (settings.env === null || typeof settings.env !== 'object' || Array.isArray(settings.env)) {
    fail(`settings.json의 env가 객체가 아니라 멈춥니다: ${settingsPath}`)
  }
  return settings
}

// Claude Code가 mod를 읽을 때 만드는 타입 파일과 개발용 파일은 견주지 않는다
const IGNORED_IN_MOD = rel => rel === 'tsconfig.json' || rel === 'tests' || rel.startsWith(`tests${path.sep}`) || rel.startsWith(path.join('.claude-plugin', 'types')) || path.basename(rel) === '.DS_Store'

function modFiles(dir) {
  const out = new Map()
  const walk = sub => {
    for (const ent of fs.readdirSync(path.join(dir, sub), { withFileTypes: true })) {
      const rel = path.join(sub, ent.name)
      if (IGNORED_IN_MOD(rel)) continue
      if (ent.isDirectory()) walk(rel)
      else out.set(rel, fs.readFileSync(path.join(dir, rel)))
    }
  }
  walk('')
  return out
}

// 손으로 고친 파일이 있으면 지우지 않고 백업으로 옮기려고 견준다
export function modDiffers(a, b) {
  const fa = modFiles(a)
  const fb = modFiles(b)
  if (fa.size !== fb.size) return true
  for (const [rel, buf] of fa) if (!fb.has(rel) || !buf.equals(fb.get(rel))) return true
  return false
}

function uniquePath(base) {
  let p = base
  for (let i = 1; fs.existsSync(p); i++) p = `${base}-${i}`
  return p
}

async function main() {
  const { help, unknown } = checkArgs(process.argv.slice(2))
  if (help) {
    console.log(USAGE)
    process.exit(0)
  }
  if (unknown.length > 0) fail(`모르는 인자라 설치하지 않습니다: ${unknown.map(a => JSON.stringify(a)).join(' ')}\n${USAGE}`)

  if (Number(process.versions.node.split('.')[0]) < 18) {
    fail(`node 18 이상이 필요합니다(지금 ${process.versions.node}). https://nodejs.org 에서 새 버전을 설치한 뒤 다시 실행하세요.`)
  }

  if (process.platform === 'win32' && !hasCommand('git', ['--version'])) {
    fail('Windows에서는 Git for Windows가 필요합니다. https://git-scm.com/download/win 에서 설치한 뒤 다시 실행하세요.')
  }

  let keepAliveChoice
  try {
    keepAliveChoice = parseKeepAliveArg(process.argv.slice(2))
  } catch (e) {
    fail(e.message)
  }

  const here = path.dirname(fileURLToPath(import.meta.url))
  const configDir = path.resolve(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'))
  const modsDir = path.join(configDir, 'mods')
  const dest = path.join(modsDir, 'agent-meter')

  // settings.json이 심볼릭 링크면 링크를 일반 파일로 바꾸지 않도록 실제 대상에 쓴다
  let settingsPath = path.join(configDir, 'settings.json')
  try {
    settingsPath = fs.realpathSync(settingsPath)
  } catch {}

  // 아무것도 바꾸기 전에 settings.json이 깨졌는지 보고, keep-alive의 지금 상태를 읽어 질문의 기본값으로 쓴다
  const current = isOffValue(readSettings(settingsPath).env.AGENT_METER_KEEPALIVE) ? 'off' : 'on'

  // 질문은 무엇이든 바꾸기 전에 한다. 답을 기다리다 Ctrl-C로 멈춰도 반쯤 바뀐 상태가 남지 않는다
  if (process.stdin.isTTY && keepAliveChoice === undefined) {
    const answers = await askChoices([
      {
        key: 'keepAlive',
        prompt: `keep-alive(서브에이전트가 도는 동안 메인 캐시가 곧 만료되면 요청을 한 번 더 보내 연장하는 기능, 이 요청도 비용이 듭니다)를 켤까요? 지금은 ${current === 'on' ? '켬' : '끔'}입니다. ${current === 'on' ? '[Y/n]' : '[y/N]'} `,
        parse: a => parseKeepAliveAnswer(a, current),
      },
    ])
    keepAliveChoice = answers.keepAlive
  }

  // 새 mod를 옆 폴더에 다 복사한 뒤 맞바꾼다. 복사가 중간에 실패해도 기존 mod는 그대로 남는다
  fs.mkdirSync(modsDir, { recursive: true })
  const src = path.join(here, 'agent-meter')
  const staging = `${dest}.tmp-${process.pid}`
  // 시험 파일과 tsconfig.json은 개발용이라 설치본에 두지 않는다. agent-meter 바로 아래의 것만 뺀다
  const devOnly = new Set(['tests', 'tsconfig.json'])
  try {
    fs.rmSync(staging, { recursive: true, force: true })
    fs.cpSync(src, staging, { recursive: true, filter: from => !devOnly.has(path.relative(src, from)) && path.basename(from) !== '.DS_Store' })
    if (fs.existsSync(dest)) {
      if (modDiffers(staging, dest)) {
        // 손으로 고친 파일이 있을 수 있어 지우지 않는다. mods 밖에 두어 Claude Code가 mod로 읽지 않게 한다
        const modBackup = uniquePath(path.join(configDir, `agent-meter-backup-${stamp()}`))
        fs.renameSync(dest, modBackup)
        console.log(`기존 mod가 이 키트와 달라 옮겨 두었습니다: ${modBackup}`)
      } else {
        fs.rmSync(dest, { recursive: true, force: true, maxRetries: 3 })
      }
    }
    fs.renameSync(staging, dest)
  } catch (e) {
    fs.rmSync(staging, { recursive: true, force: true })
    fail(`mod를 놓지 못해 멈춥니다(${e.message}). settings.json은 바꾸지 않았습니다.`)
  }
  console.log(`복사: ${dest}`)

  // 읽고 고치고 쓰기를 여기서 이어 한다. 위에서 묻는 동안 다른 세션이 settings.json을 고쳤어도 그 변경을 지키려는 것이다
  const hasSettings = fs.existsSync(settingsPath)
  const settings = readSettings(settingsPath)
  if (hasSettings) {
    // 같은 초에 두 번 돌려도 이전 백업을 덮어쓰지 않도록 번호를 붙인다
    const backup = uniquePath(`${settingsPath}.bak-agent-meter-${stamp()}`)
    fs.copyFileSync(settingsPath, backup)
    console.log(`백업: ${backup}`)
  }

  const { value } = addPluginDir(settings.env.CLAUDE_CODE_PLUGIN_DIRS, dest)
  settings.env.CLAUDE_CODE_PLUGIN_DIRS = value
  applyKeepAliveChoice(settings.env, keepAliveChoice)

  const tmp = `${settingsPath}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n', 'utf8')
  // 새로 만든 임시 파일은 umask 권한(보통 0644)이라, env에 토큰을 둔 0600 파일이 남에게 열리지 않도록 원래 권한으로 맞춘다
  if (hasSettings) {
    try {
      fs.chmodSync(tmp, fs.statSync(settingsPath).mode & 0o7777)
    } catch {}
  }
  fs.renameSync(tmp, settingsPath)
  console.log(`settings.json 등록(${settingsPath}): ${value}`)

  const keepAliveState = keepAliveChoice === 'off' ? '끔' : keepAliveChoice === 'on' ? '켬' : `기존 값 유지(${isOffValue(settings.env.AGENT_METER_KEEPALIVE) ? '끔' : '켬'})`
  console.log(`keep-alive: ${keepAliveState}`)
  console.log('Claude Code 안에서 /meter로 표 전체를, /meter tokens로 토큰 열만 켜고 끕니다. keep-alive는 settings.json의 env에서 AGENT_METER_KEEPALIVE를 "0"(끔)으로 두거나 지웁니다(켬). 설치를 다시 돌리며 --no-keepalive, --keepalive를 줘도 됩니다.')
  console.log('끝. Claude Code를 새로 열면 입력창 아래에 사용량 표가 보입니다.')
  if (settings.statusLine !== undefined) {
    console.log('참고: settings.json에 statusLine이 있어 agent-meter 표와 모델, effort, 문맥, 비용, 브랜치, 경로가 겹칠 수 있습니다. 정리하려면 Claude에게 statusLine 스크립트를 보여 주고 겹치는 항목을 짚어 달라고 하세요.')
  }
  if (!hasCommand('jq', ['--version'])) {
    console.log(`참고: jq가 없어 resume한 세션의 지난 사용량 되살리기만 빠집니다(${jqHint()}).`)
  }
}

// 심볼릭 링크 경로로 실행해도 직접 실행으로 보도록 양쪽을 실제 경로로 비교한다
const isEntry = (() => {
  try {
    return process.argv[1] !== undefined && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
})()
if (isEntry) await main()
