import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, TurnUsage } from 'claude-code'

import type { Loop, Session, Ttl } from '../types'

const loops = atom({ plugin: 'agent-meter', key: 'loops' } as const, {})
const session = atom({ plugin: 'agent-meter', key: 'session' } as const, {
  usd: null,
  contextPercent: null,
  model: '',
  effort: '',
  branch: '',
  path: '',
})
const now = atom({ plugin: 'agent-meter', key: 'now' } as const, 0)
const isHidden = atom({ plugin: 'agent-meter', key: 'isHidden' } as const, false)
// 저장소 값이 바뀌었음을 그리기에 알리는 용도라 값 자체는 쓰지 않는다
const tokensRevision = atom({ plugin: 'agent-meter', key: 'tokensRevision' } as const, 0)
const transcript = atom({ plugin: 'agent-meter', key: 'transcript' } as const, '')
const permissionMode = atom({ plugin: 'agent-meter', key: 'permissionMode' } as const, '')
const warnedAt = atom({ plugin: 'agent-meter', key: 'warnedAt' } as const, 0)

const MAIN = 'main'
const SHOWN_AGENTS = 6
const TTL_MS: Record<Ttl, number> = { '5m': 5 * 60_000, '1h': 60 * 60_000 }
// 5분 캐시에 1시간 캐시와 같은 5분, 3분을 쓰면 응답 직후부터 알림이 뜨고 연장이 2분마다 나가서 TTL의 1/5로 줄인다
const WARN_BEFORE_MS: Record<Ttl, number> = { '5m': 60_000, '1h': 5 * 60_000 }
const WARM_BEFORE_MS: Record<Ttl, number> = { '5m': 60_000, '1h': 3 * 60_000 }
const TTL_LABEL: Record<Ttl, string> = { '5m': '5분', '1h': '1시간' }
const SESSION_REFRESH_TICKS = 5
// 1시간 캐시 터미널 세션의 유휴 압축은 마지막 응답 약 54분 뒤에 나온다. 그보다 앞서 막아야 한다
const IDLE_COMPACT_GUARD_MS = 50 * 60_000
// 임계 자동 압축은 막지 않는다. 대화가 그 기준의 이 비율에 못 미칠 때만 유휴 압축을 건너뛴다
const COMPACT_LIMIT_MARGIN = 0.9

// 2026-10 Anthropic 가격표(platform.claude.com/docs/en/about-claude/pricing) 기준, 100만 토큰당 달러.
// 캐시 쓰기는 5분 1.25배, 1시간 2배. 캐시 읽기 배율은 모델마다 달라 표의 값을 그대로 옮긴다.
// 설치된 subagent-system/rates.json을 못 읽을 때만 쓰는 값이고, 읽으면 그 파일이 이 표를 대신한다.
type Rate = { input: number; write5m: number; write1h: number; read: number; output: number }
type RateTable = Record<string, Rate & { longPrompt?: Rate & { over: number } }>
const BUILTIN_RATES: RateTable = {
  'claude-fable-5-1': { input: 10, write5m: 12.5, write1h: 20, read: 0.25, output: 50 },
  'claude-opus-5-5': { input: 4, write5m: 5, write1h: 8, read: 0.2, output: 20 },
  'claude-sonnet-5-5': { input: 2, write5m: 2.5, write1h: 4, read: 0.1, output: 10 },
  'claude-haiku-5-5': {
    input: 0.1,
    write5m: 0.125,
    write1h: 0.2,
    read: 0.01,
    output: 0.5,
    // 캐시까지 더한 프롬프트가 이 길이를 넘는 요청은 모든 항목이 비싼 요율로 매겨진다
    longPrompt: { over: 100_000, input: 0.5, write5m: 0.625, write1h: 1, read: 0.05, output: 2.5 },
  },
}
let RATES = BUILTIN_RATES
let ratesMtime: number | undefined

// 회고 스크립트(claudeProjectPaths.js)와 같은 설정 폴더 규칙을 따라야 둘이 같은 요율 파일을 본다
async function ratesPath($: EngineInterface): Promise<string | null> {
  const trim = (dir: string) => dir.replace(/[\\/]+$/, '')
  const configDir = (await $.env.get('CLAUDE_CONFIG_DIR').catch(() => undefined))?.trim()
  if (configDir) return `${trim(configDir)}/subagent-system/rates.json`
  const home = (await $.env.get('HOME').catch(() => undefined)) || (await $.env.get('USERPROFILE').catch(() => undefined))
  return home ? `${trim(home)}/.claude/subagent-system/rates.json` : null
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

// 회고 스크립트 쪽 이름은 cacheRead라서 이 파일의 read로 바꿔 받는다. 꼴이 맞지 않으면 그 모델은 건너뛴다.
function toRate(r: unknown): Rate | null {
  const x = r as Record<string, unknown> | null
  if (x === null || typeof x !== 'object') return null
  const { input, write5m, write1h, cacheRead, output } = x
  if (!isNum(input) || !isNum(write5m) || !isNum(write1h) || !isNum(cacheRead) || !isNum(output)) return null
  return { input, write5m, write1h, read: cacheRead, output }
}

// 모델 이름이 `_`로 시작하는 키는 출처와 확인 날짜 같은 설명이다
function parseRates(text: string): RateTable | null {
  const data: unknown = JSON.parse(text)
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null
  const table: RateTable = {}
  for (const [model, raw] of Object.entries(data)) {
    const rate = model.startsWith('_') ? null : toRate(raw)
    if (!rate) continue
    const long = (raw as { longPrompt?: unknown }).longPrompt
    if (long === undefined) {
      table[model] = rate
      continue
    }
    const longRate = toRate(long)
    const over = (long as { over?: unknown }).over
    if (longRate && isNum(over)) table[model] = { ...rate, longPrompt: { ...longRate, over } }
  }
  return Object.keys(table).length > 0 ? table : null
}

// 파일이 없거나 깨졌으면 내장 표를 쓴다. 수정 시각이 그대로면 다시 읽지 않는다.
async function refreshRates($: EngineInterface): Promise<void> {
  const file = await ratesPath($)
  const stat = file ? await $.fs.stat(file).catch(() => undefined) : undefined
  if (!file || !stat) {
    RATES = BUILTIN_RATES
    ratesMtime = undefined
    return
  }
  if (stat.mtimeMs === ratesMtime) return
  ratesMtime = stat.mtimeMs
  const text = await $.fs.read(file).catch(() => undefined)
  let table: RateTable | null = null
  try {
    table = typeof text === 'string' ? parseRates(text) : null
  } catch {}
  RATES = table ?? BUILTIN_RATES
}

// 문맥 사용률의 분모 규칙(contextWindow)이 `[1m]` 없이 200K로 보는 모델이다.
// 모델 문자열에 키가 들어 있으면 맞는 것으로 보므로 `claude-opus-4`처럼 1M 모델과 앞부분이 겹치는 짧은 키는 쓰지 않는다.
const WINDOWS: Record<string, number> = {
  'claude-haiku-4-5': 200_000,
  'claude-sonnet-4-5': 200_000,
  'claude-sonnet-4-6': 200_000,
  'claude-opus-4-5': 200_000,
  'claude-opus-4-6': 200_000,
  'claude-opus-4-1': 200_000,
  'claude-opus-4-20250514': 200_000,
  'claude-sonnet-4-20250514': 200_000,
}
const DEFAULT_WINDOW = 1_000_000

const baseModel = (model: string) => model.replace(/\[.*\]$/, '').replace(/-\d{8}$/, '')

function rateFor(model: string, prompt: number): Rate | null {
  const base = RATES[baseModel(model)]
  if (!base) return null
  return base.longPrompt && prompt > base.longPrompt.over ? base.longPrompt : base
}

function stepCost(u: TurnUsage, ttl: Ttl): number | null {
  const prompt = u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens
  const r = rateFor(u.model, prompt)
  if (!r) return null
  const write = ttl === '1h' ? r.write1h : r.write5m
  return (
    (u.input_tokens * r.input +
      u.cache_creation_input_tokens * write +
      u.cache_read_input_tokens * r.read +
      u.output_tokens * r.output) /
    1e6
  )
}

// 만료된 뒤 다음 요청이 지금 문맥 전체를 캐시에 다시 쓰는 비용
function recacheCost(loop: Loop): number | null {
  const r = rateFor(loop.model, loop.context)
  if (!r) return null
  return (loop.context * (loop.ttl === '1h' ? r.write1h : r.write5m)) / 1e6
}

// 앞 요청 문맥의 절반도 캐시에서 읽지 못한 요청을 만료로 센다.
// 압축처럼 프롬프트 자체가 줄어든 요청은 만료가 아니라서 프롬프트 크기도 함께 본다.
function missedTokens(prevContext: number, u: TurnUsage): number {
  const prompt = u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens
  if (prevContext === 0 || prompt < prevContext / 2 || u.cache_read_input_tokens >= prevContext / 2) return 0
  return prevContext - u.cache_read_input_tokens
}

function missCost(u: TurnUsage, ttl: Ttl, missed: number): number | null {
  const r = rateFor(u.model, u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens)
  if (!r) return null
  return (missed * ((ttl === '1h' ? r.write1h : r.write5m) - r.read)) / 1e6
}

const addCost = (a: number | null | undefined, b: number | null) => (a === null || b === null ? null : (a ?? 0) + b)

function blank(id: string, at: number): Loop {
  return {
    id,
    label: id === MAIN ? 'main' : '…',
    description: '',
    model: '',
    effort: '',
    isRunning: id !== MAIN,
    // 실측으로 메인은 1시간, 서브에이전트는 5분으로 쓴다. 기록 파일에서 확인되면 덮어쓴다.
    ttl: id === MAIN ? '1h' : '5m',
    isTtlConfirmed: false,
    steps: 0,
    input: 0,
    write: 0,
    read: 0,
    output: 0,
    context: 0,
    cost: 0,
    expiries: 0,
    expiryCost: 0,
    startedAt: at,
    lastAt: at,
  }
}

function transcriptOf(mainPath: string, id: string): string {
  if (id === MAIN) return mainPath
  return `${mainPath.replace(/\.jsonl$/, '')}/subagents/agent-${id}.jsonl`
}

async function confirmTtl($: EngineInterface, id: string): Promise<void> {
  const mainPath = await read($, transcript)
  if (!mainPath) return
  const file = transcriptOf(mainPath, id)
  const has = async (ttl: Ttl) => {
    const key = ttl === '1h' ? 'ephemeral_1h_input_tokens' : 'ephemeral_5m_input_tokens'
    const r = await $.process.run(['grep', '-q', `"${key}":[1-9]`, file])
    return r.exitCode === 0
  }
  const ttl: Ttl | null = (await has('1h')) ? '1h' : (await has('5m')) ? '5m' : null
  if (ttl === null) return
  await update($, loops, all =>
    all[id] ? { ...all, [id]: { ...all[id], ttl, isTtlConfirmed: true } } : all,
  )
}

async function describe($: EngineInterface, id: string): Promise<void> {
  const agent = (await $.agent.list()).find(a => a.id === id)
  await update($, loops, all =>
    all[id]
      ? {
          ...all,
          [id]: {
            ...all[id],
            // 목록에 없는 id는 압축이나 메모리 같은 엔진 자체 작업이다
            label: agent?.type ?? '엔진 작업',
            description: agent?.description ?? '',
          },
        }
      : all,
  )
}

// 엔진은 요청을 보낼 때에야 effort를 알려 줘서, 그 전에는 설정에서 찾는다.
// 최상위 effortLevel은 모델과 설정 파일에 따라 적용 여부가 갈려 읽지 않고, 못 찾으면 비워 두었다가 첫 요청 뒤 엔진 값으로 채운다.
// 상한(maxEffortLevel)이 값보다 낮으면 엔진은 상한으로 요청을 보내므로 첫 요청 전에도 낮은 쪽을 보인다.
// 모델별 상한이 있으면 최상위 상한 대신 그것을 보고, 순서를 모르는 값(auto 등)이 끼면 견주지 않는다.
const EFFORT_ORDER = ['low', 'medium', 'high', 'xhigh', 'max']
type EffortSettings = {
  maxEffortLevel?: string
  modelSettings?: Record<string, { effortLevel?: string; maxEffortLevel?: string }>
}

function capEffort(value: string, cap: string | undefined): string {
  const rank = EFFORT_ORDER.indexOf(value)
  const capRank = cap === undefined ? -1 : EFFORT_ORDER.indexOf(cap)
  return rank >= 0 && capRank >= 0 && capRank < rank ? (cap as string) : value
}

async function settingsEffort($: EngineInterface, model: string): Promise<string> {
  const fromEnv = (await $.env.get('CLAUDE_CODE_EFFORT_LEVEL').catch(() => undefined))?.trim()
  const settings = (await $.settings.read().catch(() => ({}))) as EffortSettings
  const entry = settings.modelSettings?.[baseModel(model)]
  const value = fromEnv || entry?.effortLevel
  if (!value) return ''
  return capEffort(value, entry?.maxEffortLevel ?? settings.maxEffortLevel)
}

async function refreshSession($: EngineInterface): Promise<void> {
  // /clear와 /resume으로 세션이 끝나면 엔진이 플러그인 상태를 모두 비우고 session.start를 다시 부르지 않는다.
  // 비워진 권한 모드를 여기서 다시 채워야 표가 권한 모드 표시 폭만큼 밀리지 않는다.
  await seedPermissionMode($).catch(() => undefined)
  await refreshRates($).catch(() => undefined)
  const usage = await $.session.usage().catch(() => null)
  const model = await $.session.model().catch(() => '')
  const effort = await settingsEffort($, model)
  await update($, session, s => ({
    ...s,
    usd: usage?.cost?.usd ?? s.usd,
    contextPercent: usage?.context.percent ?? s.contextPercent,
    model: model || s.model,
    effort: effort || s.effort,
  }))
}

async function refreshBranch($: EngineInterface): Promise<void> {
  const cwd = await $.session.cwd()
  const r = await $.process.run(['git', '-C', cwd, '--no-optional-locks', 'symbolic-ref', '--short', 'HEAD'])
  const branch = r.exitCode === 0 ? r.stdout.trim() : '-'
  const home = (await $.env.get('HOME').catch(() => undefined)) || (await $.env.get('USERPROFILE').catch(() => undefined))
  await update($, session, s => ({ ...s, branch, path: tildePath(cwd, home) }))
}

// 홈 이름으로 시작만 하는 다른 폴더(/Users/user2)를 줄이지 않도록 경계를 '/'와 '\'로 확인한다
// Windows는 HOME이 없을 수 있고 구분자가 '\'다
function tildePath(cwd: string, home: string | undefined): string {
  const h = home?.replace(/[\\/]+$/, '')
  if (!h) return cwd
  if (cwd === h) return '~'
  const next = cwd.charAt(h.length)
  return cwd.startsWith(h) && (next === '/' || next === '\\') ? `~${cwd.slice(h.length)}` : cwd
}

async function record(
  $: EngineInterface,
  id: string,
  model: string,
  effort: string | number | undefined,
  u: TurnUsage,
  tookMs: number,
): Promise<void> {
  const at = await $.clock.now()
  const before = (await read($, loops))[id]
  await update($, loops, all => {
    const prev = all[id] ?? blank(id, at - tookMs)
    const cost = stepCost(u, prev.ttl)
    const missed = prev.steps > 0 ? missedTokens(prev.context, u) : 0
    return {
      ...all,
      [id]: {
        ...prev,
        model: u.model || model,
        // 응답의 모델 이름에는 요청한 `[1m]`이 없을 수 있다
        isExtended: model.includes('[1m]'),
        effort: effort === undefined ? prev.effort : String(effort),
        isRunning: id !== MAIN,
        steps: prev.steps + 1,
        input: prev.input + u.input_tokens,
        write: prev.write + u.cache_creation_input_tokens,
        read: prev.read + u.cache_read_input_tokens,
        output: prev.output + u.output_tokens,
        context:
          u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens + u.output_tokens,
        cost: prev.cost === null || cost === null ? null : prev.cost + cost,
        // 이 칸이 생기기 전 기록에는 값이 없다
        expiries: (prev.expiries ?? 0) + (missed > 0 ? 1 : 0),
        expiryCost: missed > 0 ? addCost(prev.expiryCost, missCost(u, prev.ttl, missed)) : (prev.expiryCost ?? 0),
        lastAt: at,
      },
    }
  })
  // 아래는 표를 보태는 정보라 실패해도 이번 요청의 기록은 남긴다
  if (!before && id !== MAIN) await describe($, id).catch(() => undefined)
  if (!before?.isTtlConfirmed && u.cache_creation_input_tokens > 0) {
    await confirmTtl($, id).catch(() => undefined)
  }
  await refreshSession($)
}

// resume한 세션은 엔진이 지난 요청을 다시 알려 주지 않아서 기록 파일에서 메인 줄을 되살린다.
// 기록 파일이 수백 MB까지 커져서 jq로 필요한 칸만 뽑아 온다.
const RESTORE_JQ = `fromjson? | select(.isSidechain != true) |
  if .type == "user" then "U\\t\\(.timestamp)"
  elif .type == "assistant" and .message.usage != null then
    (.message.usage) as $u |
    [ "A", .timestamp, .message.id, .message.model, (.effort // ""),
      $u.input_tokens, $u.cache_creation_input_tokens, $u.cache_read_input_tokens, $u.output_tokens,
      ($u.cache_creation.ephemeral_1h_input_tokens // 0) ] | map(tostring) | join("\\t")
  else empty end`

type Restored = {
  startAt: number
  lastAt: number
  model: string
  effort: string
  is1h: boolean
  usage: TurnUsage
}

async function restoreMain($: EngineInterface, file: string): Promise<void> {
  const r = await $.process.run(['jq', '-R', '-r', RESTORE_JQ, file])
  if (r.exitCode !== 0 || r.isStdoutTruncated) return
  // 한 응답이 내용 블록마다 줄을 따로 남겨서 메시지 id로 묶는다
  const byId = new Map<string, Restored>()
  let askedAt = 0
  for (const line of r.stdout.split('\n')) {
    const f = line.split('\t')
    const at = Date.parse(f[1] ?? '')
    if (!Number.isFinite(at)) continue
    if (f[0] === 'U') {
      askedAt = at
      continue
    }
    const [, , msgId = '', model = '', effort = ''] = f
    const [input, write, readTokens, output, write1h] = f.slice(5).map(Number)
    // 엔진이 지어낸 응답(<synthetic>)은 요청이 아니다
    if (!msgId || model.startsWith('<')) continue
    const prev = byId.get(msgId)
    byId.set(msgId, {
      startAt: prev?.startAt ?? (askedAt || at),
      lastAt: at,
      model,
      effort: effort || prev?.effort || '',
      is1h: (prev?.is1h ?? false) || (write1h ?? 0) > 0,
      usage: {
        model,
        input_tokens: input || 0,
        cache_creation_input_tokens: write || 0,
        cache_read_input_tokens: readTokens || 0,
        output_tokens: output || 0,
      } as TurnUsage,
    })
  }
  const steps = [...byId.values()]
  const last = steps.at(-1)
  if (!last) return
  const ttl: Ttl = steps.some(x => x.is1h) ? '1h' : '5m'
  const u = last.usage
  const misses = steps.slice(1).map((x, i) => {
    const p = steps[i]!.usage
    const prevContext = p.input_tokens + p.cache_creation_input_tokens + p.cache_read_input_tokens + p.output_tokens
    return { usage: x.usage, missed: missedTokens(prevContext, x.usage) }
  }).filter(x => x.missed > 0)
  const loop: Loop = {
    ...blank(MAIN, steps[0]?.startAt ?? last.startAt),
    model: last.model,
    effort: [...steps].reverse().find(x => x.effort)?.effort ?? '',
    ttl,
    isTtlConfirmed: steps.some(x => x.is1h),
    steps: steps.length,
    input: steps.reduce((sum, x) => sum + x.usage.input_tokens, 0),
    write: steps.reduce((sum, x) => sum + x.usage.cache_creation_input_tokens, 0),
    read: steps.reduce((sum, x) => sum + x.usage.cache_read_input_tokens, 0),
    output: steps.reduce((sum, x) => sum + x.usage.output_tokens, 0),
    context: u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens + u.output_tokens,
    cost: steps.reduce<number | null>((sum, x) => {
      const c = stepCost(x.usage, ttl)
      return sum === null || c === null ? null : sum + c
    }, 0),
    expiries: misses.length,
    expiryCost: misses.reduce<number | null>((sum, x) => addCost(sum, missCost(x.usage, ttl, x.missed)), 0),
    lastAt: last.lastAt,
  }
  // 되살리는 사이 새 요청이 먼저 기록됐으면 그 기록을 둔다
  await update($, loops, all => (all[MAIN] ? all : { ...all, [MAIN]: loop }))
}

// 서브에이전트를 기다리는 동안 메인 캐시가 풀리면 돌아와서 문맥 전체를 다시 쓰게 된다.
// 메인 요청을 그대로 한 번 더 보내면 캐시를 읽는 값만 내고 만료 시각이 다시 늘어난다.
// 서브에이전트가 없을 때는 자리를 비웠을 수 있어 연장하지 않고 알리기만 한다.
// 캐시를 못 읽었어도 그 요청은 캐시 쓰기 값을 냈으므로 비용은 더하고 isWarmed만 false로 돌려준다
async function warmMain($: EngineInterface, main: Loop): Promise<{ cost: number; isWarmed: boolean } | null> {
  const r = await $.model.fork({ prompt: 'Cache keep-alive ping. Reply with just: ok' })
  if (!('usage' in r)) return null
  const isWarmed = r.usage.cache_read_input_tokens > 0
  const cost = stepCost({ ...r.usage, model: main.model } as TurnUsage, main.ttl)
  const at = await $.clock.now()
  await update($, loops, all =>
    all[MAIN]
      ? {
          ...all,
          [MAIN]: {
            ...all[MAIN],
            cost: all[MAIN].cost === null || cost === null ? null : all[MAIN].cost + cost,
            // 캐시를 못 읽었으면 만료 시각이 늘었다고 볼 수 없어 기준 시각을 그대로 둔다
            lastAt: isWarmed ? at : all[MAIN].lastAt,
          },
        }
      : all,
  )
  return { cost: cost ?? 0, isWarmed }
}

const TOKENS_KEY = 'isTokensShown'

// 저장값이 없으면 보임. 설정 파일에 두지 않고 /meter tokens의 저장값만 쓰는 것은 새 세션에서도 그 상태가 이어지게 하려는 것이다.
async function isTokensShown($: EngineInterface): Promise<boolean> {
  const stored = await $.store.get(TOKENS_KEY).catch(() => undefined)
  return typeof stored === 'boolean' ? stored : true
}

// 1M 문맥을 끄는 환경변수. 켜짐 값은 Claude Code가 켜고 끄는 변수에 쓰는 1, true, yes, on이다.
async function isOneMillionDisabled($: EngineInterface): Promise<boolean> {
  const v = await $.env.get('CLAUDE_CODE_DISABLE_1M_CONTEXT').catch(() => undefined)
  return ['1', 'true', 'yes', 'on'].includes((v ?? '').trim().toLowerCase())
}

// 기본은 켬. 연장 요청은 유료라 AGENT_METER_KEEPALIVE로 끌 수 있다.
async function isKeepAliveOn($: EngineInterface): Promise<boolean> {
  const v = await $.env.get('AGENT_METER_KEEPALIVE').catch(() => undefined)
  return !['0', 'false', 'off'].includes((v ?? '').trim().toLowerCase())
}

// 서브에이전트가 도는 동안 메인 캐시를 연장하는지. 연장 요청과 유휴 압축 건너뛰기가 같은 판정을 쓴다
async function isWarmingMain($: EngineInterface): Promise<boolean> {
  const isAgentRunning = (await $.agent.list().catch(() => [])).some(a => a.status === 'running')
  return isAgentRunning && (await isKeepAliveOn($))
}

// context.window는 모델 원래 창이라 settings의 autoCompactWindow로 낮춘 기준이 반영되지 않는다.
// 낮춘 압축 창과 임계값은 breakdown에만 있어서 읽을 수 있는 기준 가운데 가장 작은 값에 견준다.
// 대화 크기나 breakdown을 읽지 못하면 기준을 알 수 없으므로 거짓으로 돌려 압축을 막지 않는다
async function isFarFromCompactLimit($: EngineInterface): Promise<boolean> {
  const context = (await $.session.usage({ breakdown: 'summary' }).catch(() => null))?.context
  const breakdown = context?.breakdown
  if (context?.tokens === undefined || !breakdown) return false
  const limits = [context.window, breakdown.rawMaxTokens, breakdown.autoCompactThreshold].filter((n): n is number => typeof n === 'number' && n > 0)
  // 기준이 하나도 없으면 Math.min()이 Infinity라 늘 참이 되므로 따로 거짓으로 돌린다
  if (limits.length === 0) return false
  return context.tokens < Math.min(...limits) * COMPACT_LIMIT_MARGIN
}

async function keepMainWarm($: EngineInterface, at: number): Promise<void> {
  const main = (await read($, loops))[MAIN]
  if (!main || main.steps === 0) return
  const left = main.lastAt + TTL_MS[main.ttl] - at
  if (left <= 0 || left > WARN_BEFORE_MS[main.ttl]) return
  if ((await read($, warnedAt)) === main.lastAt) return
  const isWarming = await isWarmingMain($)
  // 연장은 늦출 수 있는 데까지 미룬다. 그 사이 서브에이전트가 끝나 메인이 요청하면 연장할 필요가 없다.
  // 알림은 사람이 돌아올 틈을 두려고 더 일찍 낸다.
  if (isWarming && left > WARM_BEFORE_MS[main.ttl]) return
  await update($, warnedAt, () => main.lastAt)
  if (isWarming) {
    const warmed = await warmMain($, main).catch(() => null)
    if (warmed?.isWarmed) {
      $.ui.toast(`메인 캐시를 ${TTL_LABEL[main.ttl]} 연장했습니다 ${money(warmed.cost)}`)
      return
    }
  }
  const minutes = Math.ceil(left / 60_000)
  const text = `메인 캐시가 ${minutes}분 뒤 만료됩니다. 만료되면 다시 쓰는 데 ${money(recacheCost(main))}`
  $.ui.toast(text)
  await $.ui.notify(text, { title: '캐시 만료 직전' }).catch(() => undefined)
}

// 화면 칸 수: 한글과 전각 문자는 두 칸
function cells(text: string): number {
  let n = 0
  for (const ch of text) n += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1
  return n
}

type Align = 'left' | 'right' | 'center'

function fit(text: string, width: number, align: Align | boolean = 'left'): string {
  let out = ''
  for (const ch of text) {
    if (cells(out + ch) > width) {
      out = out.replace(/.$/u, '…')
      break
    }
    out += ch
  }
  const room = Math.max(0, width - cells(out))
  const side = align === true ? 'right' : align === false ? 'left' : align
  if (side === 'right') return ' '.repeat(room) + out
  if (side === 'center') return ' '.repeat(Math.floor(room / 2)) + out + ' '.repeat(Math.ceil(room / 2))
  return out + ' '.repeat(room)
}

function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

function money(v: number | null): string {
  if (v === null) return '?'
  if (v >= 10) return `$${v.toFixed(1)}`
  // Haiku처럼 싼 모델은 센트 아래에서 움직여 한 자리를 더 보인다
  return v > 0 && v < 0.01 ? `$${v.toFixed(3)}` : `$${v.toFixed(2)}`
}

function percent(v: number | null): string {
  return v === null ? '' : `${Math.round(v)}%`
}

// 모든 시간 칸을 캐시 남은 시간과 같은 시계 모양(m:ss, 한 시간 넘으면 h:mm:ss)으로 쓴다
function duration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const ss = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

// claude-opus-5-5 → opus 5.5, claude-haiku-4-5-20251001 → haiku 4.5, us.anthropic.claude-sonnet-4-5-20250929-v1:0 → sonnet 4.5
function shortModel(model: string): string {
  const m = /(?:^|[./])claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-|\[|@|:|$)/.exec(model)
  if (!m) return model
  return m[3] ? `${m[1]} ${m[2]}.${m[3]}` : `${m[1]} ${m[2]}`
}

// 먼저 맞는 규칙을 쓴다. 1M 끔 변수는 200K, `[1m]`은 1M, WINDOWS의 모델은 200K,
// `claude-`가 없어 Claude Code가 알아보지 못하는 ID(ARN, Foundry 배포 이름)는 `[1m]`이 없으면 200K, 그 밖은 1M이다.
function contextWindow(loop: Loop, isOneMillionOff: boolean): number {
  if (isOneMillionOff) return 200_000
  const model = loop.model.toLowerCase()
  if (loop.isExtended || model.includes('[1m]')) return DEFAULT_WINDOW
  const key = Object.keys(WINDOWS).find(k => model.includes(k))
  if (key) return WINDOWS[key] ?? DEFAULT_WINDOW
  return model && !model.includes('claude-') ? 200_000 : DEFAULT_WINDOW
}

function contextPercent(loop: Loop, mainPercent: number | null, isOneMillionOff: boolean): number | null {
  if (loop.id === MAIN && mainPercent !== null) return mainPercent
  if (loop.steps === 0) return null
  return (loop.context / contextWindow(loop, isOneMillionOff)) * 100
}

function cacheLeft(loop: Loop, at: number): { text: string; isWarm: boolean } {
  if (loop.steps === 0) return { text: '', isWarm: false }
  const left = loop.lastAt + TTL_MS[loop.ttl] - at
  if (left <= 0) return { text: '만료', isWarm: false }
  return { text: duration(left), isWarm: true }
}

// 첫 요청부터 잰다. 메인은 지금까지, 서브에이전트는 끝난 요청까지.
function elapsed(loop: Loop, at: number): string {
  if (loop.steps === 0) return ''
  return duration((loop.id === MAIN || loop.isRunning ? at : loop.lastAt) - loop.startedAt)
}

type Color = 'red' | 'yellow' | 'green'
type Cell = { text: string; color?: Color }
type Column = { head: string; width: number; isWideOnly?: boolean; isToken?: boolean; cell: (loop: Loop) => Cell }

function buildTable(s: Session, all: Record<string, Loop>, at: number, width: number, showTokens: boolean, isOneMillionOff: boolean) {
  // 메인 줄은 첫 요청 전에도 세션 모델로 늘 보인다
  const main: Loop = all[MAIN] ?? { ...blank(MAIN, at), model: s.model, effort: s.effort }
  const running = Object.values(all)
    // 끝난 서브에이전트는 표에서 뺀다. 이어서 일하면 다시 나온다.
    .filter(l => l.id !== MAIN && l.isRunning)
    .sort((a, b) => a.startedAt - b.startedAt)
  const agents = running.slice(-SHOWN_AGENTS)
  const loopsShown = [main, ...agents]

  const blankUntilUsed = (loop: Loop, text: string) => (loop.steps === 0 ? '' : text)
  const allColumns: Column[] = [
    { head: 'model', width: 10, cell: l => ({ text: shortModel(l.model) }) },
    { head: 'effort', width: 6, cell: l => ({ text: l.effort }) },
    {
      head: 'context',
      width: 7,
      cell: l => {
        const v = contextPercent(l, s.contextPercent, isOneMillionOff)
        return { text: percent(v), color: pctColor(v) }
      },
    },
    { head: '경과', width: 7, cell: l => ({ text: elapsed(l, at) }) },
    {
      head: '캐시',
      width: 5,
      cell: l => {
        const c = cacheLeft(l, at)
        return { text: c.text, color: c.isWarm ? 'green' : 'yellow' }
      },
    },
    { head: '재캐시', width: 6, cell: l => ({ text: blankUntilUsed(l, money(recacheCost(l))) }) },
    {
      head: '캐시만료',
      width: 10,
      cell: l => {
        const n = l.expiries ?? 0
        const text = n === 0 ? '0회' : `${n}회 ${money(l.expiryCost ?? 0)}`
        return { text: blankUntilUsed(l, text), color: n > 0 ? 'yellow' : undefined }
      },
    },
    { head: '입력', width: 6, isWideOnly: true, isToken: true, cell: l => ({ text: blankUntilUsed(l, tokens(l.input)) }) },
    { head: '출력', width: 6, isWideOnly: true, isToken: true, cell: l => ({ text: blankUntilUsed(l, tokens(l.output)) }) },
    { head: '캐시읽기', width: 8, isWideOnly: true, isToken: true, cell: l => ({ text: blankUntilUsed(l, tokens(l.read)) }) },
    { head: '캐시쓰기', width: 8, isWideOnly: true, isToken: true, cell: l => ({ text: blankUntilUsed(l, tokens(l.write)) }) },
    { head: '비용', width: 6, cell: l => ({ text: blankUntilUsed(l, money(l.cost)) }) },
  ]

  const columns = allColumns.filter(c => showTokens || !c.isToken)

  // 모델과 effort는 옆 칸에 있어서 이름 칸에는 할 일만 쓴다
  // 메인 줄은 이름을 고쳐 쓰기 전에 만든 기록에도 같은 이름이 보이게 여기서 정한다
  const names = loopsShown.map(l => (l.id === MAIN ? 'main' : l.description || l.label))
  const nameHead = 'agent'
  const nameWidth = Math.min(40, Math.max(cells(nameHead), ...names.map(n => cells(n))))
  const isWide = width >= nameWidth + 1 + columns.reduce((sum, c) => sum + c.width + 1, 0)
  const shown = columns.filter(c => isWide || !c.isWideOnly)

  const header = [fit(nameHead, nameWidth, 'center'), ...shown.map(c => fit(c.head, c.width, 'center'))].join(' ')
  const rows = loopsShown.map((loop, i) => {
    const cellsOf: Cell[] = [
      { text: fit(names[i] ?? '', nameWidth, 'center') },
      ...shown.map(c => {
        const cell = c.cell(loop)
        return { ...cell, text: fit(cell.text, c.width, 'center') }
      }),
    ]
    return { loop, cells: cellsOf }
  })

  return { header, rows, hiddenCount: running.length - agents.length }
}

function pctColor(v: number | null): Color {
  if (v !== null && v >= 80) return 'red'
  if (v !== null && v >= 30) return 'yellow'
  return 'green'
}

// 모드의 그림이 힌트 줄을 대신하면 엔진은 권한 모드 표시와 ' · '를 그 왼쪽에 따로 그리고, 모드의 그림은 그 오른쪽에서 시작한다.
// 표를 화면 왼쪽 끝에 맞추려고 그 폭만큼 당긴다.
const MODE_PILLS: Record<string, string> = {
  bypassPermissions: '⏵⏵ bypass permissions on',
  acceptEdits: '⏵⏵ accept edits on',
  plan: '⏸ plan mode on',
  auto: '⏵⏵ auto mode on',
}
const PILL_SEPARATOR = ' · '

// 첫 질문 전에 오는 훅 이벤트(SessionStart 등)에는 권한 모드가 실려 오지 않는다.
// 그래서 첫 대화 전에는 Claude Code를 띄운 명령줄 옵션, 그것이 없으면 설정의 기본 모드로 표를 당긴다.
async function seedPermissionMode($: EngineInterface): Promise<void> {
  if (await read($, permissionMode)) return
  const settings = (await $.settings.read().catch(() => ({}))) as { permissions?: { defaultMode?: string } }
  const mode = (await launchPermissionMode($).catch(() => undefined)) ?? settings.permissions?.defaultMode
  if (mode) await update($, permissionMode, v => v || mode)
}

// 플러그인이 띄운 프로세스의 부모가 Claude Code 프로세스라서, 셸의 $PPID로 그 명령줄을 읽는다.
// Claude Code처럼 --dangerously-skip-permissions를 --permission-mode보다 먼저 본다.
async function launchPermissionMode($: EngineInterface): Promise<string | undefined> {
  const r = await $.process.run(['sh', '-c', 'ps -ww -o args= -p "$PPID"'])
  if (r.exitCode !== 0) return undefined
  const args = r.stdout.trim().split(/\s+/)
  if (args.includes('--dangerously-skip-permissions')) return 'bypassPermissions'
  const i = args.indexOf('--permission-mode')
  if (i >= 0 && args[i + 1]) return args[i + 1]
  return args.find(a => a.startsWith('--permission-mode='))?.slice('--permission-mode='.length) || undefined
}

// 엔진이 /clear 뒤 상태를 비우므로 숨김 설정은 세션을 넘어 남는 $.store에 둔다
const HIDDEN_KEY = 'isHidden'

async function isMeterHidden($: EngineInterface): Promise<boolean> {
  const stored = await $.store.get(HIDDEN_KEY).catch(() => undefined)
  return typeof stored === 'boolean' ? stored : await read($, isHidden)
}

function pillOffset(mode: string, hint: string): number {
  const pill = MODE_PILLS[mode]
  if (!pill || !hint.includes('shift+tab')) return 0
  return cells(pill + PILL_SEPARATOR)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'meter',
      description: '입력창 아래 세션과 에이전트 사용량 표를 켜고 끈다. tokens를 붙이면 토큰 네 열만 켜고 끈다',
      argumentHint: '[tokens]',
    })
    let ticks = 0
    $.clock.every(1000, () => {
      ticks += 1
      void $.clock.now().then(async t => {
        await update($, now, () => t)
        await keepMainWarm($, t)
        if (ticks % SESSION_REFRESH_TICKS !== 0) return
        await refreshSession($)
        // 시작 때 한 번 읽기를 놓치거나 터미널에서 브랜치를 바꿔도 따라가게 늘 다시 읽는다
        await refreshBranch($).catch(() => undefined)
      })
    })
    $.ui.status(undefined)
    await seedPermissionMode($)
    await refreshSession($)
    await refreshBranch($).catch(() => undefined)

    return next(e)
  })

  on('command.run', { command: 'meter' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'tokens') {
      const shown = !(await isTokensShown($))
      await $.store.set(TOKENS_KEY, shown).catch(() => undefined)
      await update($, tokensRevision, n => n + 1)

      return { text: shown ? '토큰 열을 켰습니다.' : '토큰 열을 숨겼습니다.' }
    }
    if (arg !== '') return { text: '쓸 수 있는 인자는 tokens입니다. 인자 없이 쓰면 표 전체를 켜고 끕니다.' }

    const hidden = !(await isMeterHidden($))
    await $.store.set(HIDDEN_KEY, hidden).catch(() => undefined)
    await update($, isHidden, () => hidden)

    return { text: hidden ? '사용량 표를 숨겼습니다.' : '사용량 표를 켰습니다.' }
  })

  // 권한 모드는 shift+tab으로 바뀌어도 알림이 없어서, 오는 모든 훅 이벤트에서 다시 읽는다
  on('classic.*', async ($, e, next) => {
    // PreToolUse만 봉투 모양이 달라 공통 필드를 직접 꺼낸다
    const base = e as { transcript_path?: string; permission_mode?: string; agent_id?: string }
    const path = base.transcript_path
    if (path && !base.agent_id && path !== (await read($, transcript))) {
      await update($, transcript, () => path)
      // 새로 연 세션은 기록 파일이 비어 있어 되살릴 것이 없다
      if (!(await read($, loops))[MAIN]) void restoreMain($, path).catch(() => undefined)
    }
    if (base.permission_mode && base.permission_mode !== (await read($, permissionMode))) {
      await update($, permissionMode, () => base.permission_mode ?? '')
    }

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, loops, () => ({}))
      await update($, session, s => ({ ...s, usd: null, contextPercent: null }))
    }

    return next(e)
  })

  // 서브에이전트를 기다리는 동안은 mod가 캐시를 연장하므로, 그보다 먼저 오는 유휴 압축을 건너뛴다.
  // 유휴 압축이 auto와 precompute 중 어느 값으로 오는지 문서로 알 수 없어 둘 다 본다
  on('session.compact', async ($, e, next) => {
    if (e.agentId || (e.trigger !== 'auto' && e.trigger !== 'precompute')) return next(e)
    const main = (await read($, loops))[MAIN]
    if (!main || main.ttl !== '1h' || (await $.clock.now()) - main.lastAt < IDLE_COMPACT_GUARD_MS) return next(e)
    if (!(await isWarmingMain($)) || !(await isFarFromCompactLimit($))) return next(e)
    $.ui.toast('서브에이전트 실행 중이라 유휴 압축을 건너뛰었습니다')
    return { skip: '서브에이전트 실행 중이라 압축을 건너뜀' }
  })

  on('turn.step', async function* ($, e, next) {
    const startedAt = await $.clock.now()
    const result = yield* next(e)
    if (result.usage) {
      const tookMs = (await $.clock.now()) - startedAt
      await record($, e.agentId ?? MAIN, e.model, e.effort, result.usage, tookMs)
    }

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const id = e.agentId
    if (id) {
      await update($, loops, all =>
        all[id] ? { ...all, [id]: { ...all[id], isRunning: false } } : all,
      )
    } else {
      await refreshBranch($).catch(() => undefined)
    }

    return next(e)
  })

  // 입력창 아래 힌트 줄(권한 모드 표시) 자리에 그 줄과 표를 함께 그린다
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    // 상태를 먼저 읽어 숨김이 바뀔 때 다시 그려지게 구독한다
    await read($, isHidden)
    await read($, tokensRevision)
    if (await isMeterHidden($)) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    // 첫 1초 눈금 전에는 시계를 직접 읽는다
    const at = (await read($, now)) || (await $.clock.now())
    const s = await read($, session)
    const width = (e.viewport?.columns ?? 160) - 2
    const t = buildTable(s, await read($, loops), at, width, await isTokensShown($), await isOneMillionDisabled($))
    const offset = pillOffset(await read($, permissionMode), e.props.hint)

    return (
      <Box flexDirection="column">
        <Text dimColor wrap="truncate-end">
          {e.props.hint}
        </Text>
        <Box flexDirection="column" marginLeft={-offset}>
          <Text wrap="truncate-end">
            total <Text color="green">{money(s.usd)}</Text> | branch <Text color="yellow">{s.branch}</Text> | path <Text color="white">{s.path || '-'}</Text>
          </Text>
          <Text dimColor wrap="truncate-end">
            {t.header}
          </Text>
          {t.rows.map(r => {
            const isDim = !r.loop.isRunning && r.loop.id !== MAIN
            return (
              <Text key={r.loop.id} dimColor={isDim} wrap="truncate-end">
                {r.cells.map((c, i) => (
                  <Text key={String(i)} color={isDim ? undefined : c.color}>
                    {i === 0 ? c.text : ` ${c.text}`}
                  </Text>
                ))}
              </Text>
            )
          })}
          {t.hiddenCount > 0 && (
            <Text dimColor wrap="truncate-end">
              + {t.hiddenCount} more
            </Text>
          )}
        </Box>
      </Box>
    )
  })
}
