import { expect, mock, test } from 'claude-code/testing'

const usage = (model: string) => ({
  model,
  input_tokens: 1000,
  output_tokens: 2000,
  cache_read_input_tokens: 100_000,
  cache_creation_input_tokens: 10_000,
})


test('입력창 아래 힌트 줄과 함께 메인 줄을 늘 그리고, 요청 뒤에는 에이전트별 사용량과 캐시 만료 정보를 그린다', { timeoutMs: 30_000 }, async ($, on) => {
  const clock = mock.clock(on)
  const toasts: string[] = []
  on('agent.list', () => ({ value: [{ id: 'a1', type: 'sonnet-medium', description: '문서 검수', status: 'running' as const }] }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000, percent: 38 }, rateLimits: [], cost: { usd: 1.5 } } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: { effortLevel: 'xhigh', modelSettings: { 'claude-opus-5-5': { effortLevel: 'high' } } } }) as never)
  on('session.cwd', () => ({ value: '/repo' }))
  on('process.run', (_$, e) => ({
    value: { exitCode: e.argv[0] === 'git' ? 0 : 1, stdout: 'main\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.notify', () => ({ value: { isSent: true, channel: 'terminal_bell' } }) as never)
  on('ui.render', () => null as never)
  on('model.fork', () => ({
    value: { isAnswered: true, text: 'ok', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 113_000, cache_creation_input_tokens: 0 } },
  }) as never)
  on('command.register', () => ({ value: {} }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.SessionStart', () => ({}) as never)
  let isCold = false
  on('turn.step', async function* (_$, e) {
    await clock.advance(2000)
    if (isCold) {
      return {
        turnId: e.turnId,
        index: e.index,
        answer: '',
        toolUses: [] as never,
        stopReason: 'end_turn',
        usage: { model: 'claude-sonnet-5-5', input_tokens: 1000, output_tokens: 2000, cache_read_input_tokens: 0, cache_creation_input_tokens: 111_000 },
      }
    }
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [{ id: 'u1', name: 'Read', input: {} }] as never,
      stopReason: 'end_turn',
      usage: usage(e.agentId ? 'claude-sonnet-5-5' : 'claude-opus-5-5'),
    }
  })
  const lines = async () => {
    const hint = await $.ui.mount({
      plugin: 'agent-meter',
      surface: 'terminal',
      component: 'PromptHint',
      props: { isDraft: false, isWorking: false, hint: '⏵⏵ bypass permissions on (shift+tab to cycle)' },
      viewport: { columns: 162, rows: 40 },
    } as never)
    return (await hint.findAll({ type: 'Text' })).map(t => t.text)
  }
  const has = async (re: RegExp) => expect((await lines()).filter(l => re.test(l))).toHaveLength(1)

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.classic.SessionStart({ source: 'startup', permission_mode: 'bypassPermissions' } as never)
  await clock.advance(1000)
  await has(/^⏵⏵ bypass permissions on \(shift\+tab to cycle\)$/)
  // 첫 요청 전: effort는 설정 파일의 모델별 값, 경과는 비어 있다
  await has(/^\s*main\s+opus 5\.5\s+high\s+38%\s*$/)

  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1 })) {
  }
  for await (const _ of $.turn.step({ turnId: 't2', index: 0, model: 'claude-sonnet-5-5', effort: 'low', messageCount: 1, agentId: 'a1' })) {
  }

  await clock.advance(1000)
  await has(/^total \$1\.50 \| branch main \| path \/repo$/)
  // 메인 opus: 비용 (1000*4 + 10000*8 + 100000*0.2 + 2000*20)/1e6 = 0.144
  // 만료 시 다시 쓰는 비용 113000*8/1e6 = 0.90
  await has(/^\s*main\s+opus 5\.5\s+medium\s+38%\s+0:0\d\s+59:\d\d\s+\$0\.90\s+0회\s+1\.0k\s+2\.0k\s+100\.0k\s+10\.0k\s+\$0\.14\s*$/)
  // 서브 sonnet 5분: 비용 (1000*2 + 10000*2.5 + 100000*0.1 + 2000*10)/1e6 = 0.057, 문맥 113000/1M = 11%
  await has(/^\s*문서 검수\s+sonnet 5\.5\s+low\s+11%\s+0:0\d\s+4:\d\d\s+\$0\.28\s+0회\s+1\.0k\s+2\.0k\s+100\.0k\s+10\.0k\s+\$0\.06\s*$/)

  // 실행 중 서브에이전트가 6개를 넘으면 오래된 것부터 접고 남은 수만 알린다
  for (const id of ['a2', 'a3', 'a4', 'a5', 'a6', 'a7']) {
    for await (const _ of $.turn.step({ turnId: `t-${id}`, index: 0, model: 'claude-sonnet-5-5', effort: 'low', messageCount: 1, agentId: id })) {
    }
  }
  await has(/^\+ 1 more$/)
  await has(/^\s*agent\s+model\s+effort\s+context\s.*\s비용\s*$/)
  const head = (await lines()).find(l => /^\s*agent\s+model\s/.test(l)) ?? ''
  for (const gone of ['캐시적중', '요청', 'tool calls']) expect(head).not.toContain(gone)
  for (const id of ['a2', 'a3', 'a4', 'a5', 'a6', 'a7']) {
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: `t-${id}`, agentId: id, reason: 'answer' })
  }

  await clock.advance(57 * 60_000)
  // 서브에이전트가 도는 중이라 알림 대신 메인 캐시를 연장한다: 113000*0.2 + 10*4 + 5*20 = $0.02
  expect(toasts).toEqual(['메인 캐시를 1시간 연장했습니다 $0.02'])
  // 만료 3분 전 눈금에 연장해서 지금 59분대가 남는다
  await has(/^\s*main\s+opus 5\.5\s+medium\s+38%\s+57:\d\d\s+59:\d\d\s/)
  await has(/^\s*문서 검수.*\s만료\s+\$0\.28\s/)

  // 만료 뒤 요청은 앞 문맥 113000을 다시 써서 읽기보다 113000*(2.5-0.1)/1e6 = $0.27 더 낸다
  isCold = true
  for await (const _ of $.turn.step({ turnId: 't3', index: 0, model: 'claude-sonnet-5-5', effort: 'low', messageCount: 3, agentId: 'a1' })) {
  }
  await clock.advance(1000)
  await has(/^\s*문서 검수.*\s\$0\.\d\d\s+1회 \$0\.27\s/)
  // 압축처럼 프롬프트가 절반 아래로 줄어든 요청은 만료로 세지 않는다
  isCold = false
  for await (const _ of $.turn.step({ turnId: 't4', index: 0, model: 'claude-sonnet-5-5', effort: 'low', messageCount: 4, agentId: 'a1' })) {
  }
  await clock.advance(1000)
  await has(/^\s*문서 검수.*\s1회 \$0\.27\s/)

  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't2', agentId: 'a1', reason: 'answer' })
  expect((await lines()).filter(l => l.includes('문서 검수') || l.includes('more'))).toHaveLength(0)
})

for (const [name, envEffort, settings, label] of [
  ['환경변수가 있으면 모델별 설정보다 먼저 쓴다', 'low', { modelSettings: { 'claude-opus-5-5': { effortLevel: 'high' } } }, 'low'],
  ['환경변수가 없으면 모델별 설정을 쓴다', undefined, { modelSettings: { 'claude-opus-5-5': { effortLevel: 'high' } } }, 'high'],
  ['모델별 설정이 없으면 최상위 effortLevel로 물러나지 않고 비운다', undefined, { effortLevel: 'xhigh' }, ''],
  ['설정 값이 최상위 maxEffortLevel보다 높으면 상한을 쓴다', undefined, { modelSettings: { 'claude-opus-5-5': { effortLevel: 'xhigh' } }, maxEffortLevel: 'high' }, 'high'],
] as [string, string | undefined, Record<string, unknown>, string][]) {
  test(`첫 요청 전 메인 줄의 effort는 ${name}`, { timeoutMs: 30_000 }, async ($, on) => {
    const clock = mock.clock(on)
    on('agent.list', () => ({ value: [] }))
    on('env.get', (_$, e) => ({ value: (e as { name?: string }).name === 'CLAUDE_CODE_EFFORT_LEVEL' ? envEffort : undefined }) as never)
    on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000, percent: 38 }, rateLimits: [], cost: { usd: 1.5 } } }))
    on('session.model', () => ({ value: 'claude-opus-5-5' }))
    on('settings.read', () => ({ value: settings }) as never)
    on('session.cwd', () => ({ value: '/repo' }))
    on('process.run', () => ({ value: { exitCode: 0, stdout: 'main\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
    on('ui.status', () => ({ value: undefined }))
    on('ui.render', () => null as never)
    on('command.register', () => ({ value: {} }) as never)
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('classic.SessionStart', () => ({}) as never)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    await $.classic.SessionStart({ source: 'startup', permission_mode: 'bypassPermissions' } as never)
    await clock.advance(1000)
    const texts = (await (await mountHint($)).findAll({ type: 'Text' })).map(t => t.text)
    const re = new RegExp(`^\\s*main\\s+opus 5\\.5\\s+${label ? `${label}\\s+` : ''}38%\\s*$`)
    expect(texts.filter(l => re.test(l))).toHaveLength(1)
  })
}

test('resume한 세션은 기록 파일에서 메인 줄을 되살린다', { timeoutMs: 30_000 }, async ($, on) => {
  const clock = mock.clock(on)
  await clock.set(Date.parse('2026-10-11T00:11:02Z'))
  const row = (at: string, id: string, effort: string) =>
    ['A', at, id, 'claude-opus-5-5', effort, 1000, 10000, 100000, 2000, 10000].join('\t')
  const jqOut = [
    'U\t2026-10-11T00:00:00.000Z',
    row('2026-10-11T00:00:03.000Z', 'msg1', 'high'),
    row('2026-10-11T00:00:04.000Z', 'msg1', 'high'),
    'U\t2026-10-11T00:01:00.000Z',
    row('2026-10-11T00:01:02.000Z', 'msg2', 'xhigh', 0),
  ].join('\n')
  on('agent.list', () => ({ value: [] }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000, percent: 38 }, rateLimits: [], cost: { usd: 1.5 } } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: {} }) as never)
  on('session.cwd', () => ({ value: '/repo' }))
  on('process.run', (_$, e) => ({
    value: { exitCode: 0, stdout: e.argv[0] === 'jq' ? jqOut : 'main\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('ui.status', () => ({ value: undefined }))
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.notify', () => ({ value: { isSent: true, channel: 'terminal_bell' } }) as never)
  on('ui.render', () => null as never)
  on('command.register', () => ({ value: {} }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('classic.SessionStart', () => ({}) as never)

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.classic.SessionStart({ source: 'resume', transcript_path: '/t/s.jsonl' } as never)
  await clock.advance(1000)
  const hint = await $.ui.mount({
    plugin: 'agent-meter',
    surface: 'terminal',
    component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: '' },
    viewport: { columns: 162, rows: 40 },
  } as never)
  const lines = (await hint.findAll({ type: 'Text' })).map(t => t.text)
  // msg1은 블록 두 줄을 한 번으로 세고, 경과는 첫 질문부터 잰다
  expect(
    lines.filter(l => /^\s*main\s+opus 5\.5\s+xhigh\s+38%\s+11:03\s+49:59\s+\$0\.90\s+0회\s+2\.0k\s+4\.0k\s+200\.0k\s+20\.0k\s+\$0\.29\s*$/.test(l)),
  ).toHaveLength(1)

  // 도는 서브에이전트가 없으면 자리를 비웠을 수 있어 연장하지 않고 알리기만 한다
  await clock.set(Date.parse('2026-10-11T00:57:00Z'))
  expect(toasts).toEqual(['메인 캐시가 5분 뒤 만료됩니다. 만료되면 다시 쓰는 데 $0.90'])
})

test('첫 대화 전에는 설정의 기본 권한 모드만큼 표를 왼쪽으로 당긴다', { timeoutMs: 30_000 }, async ($, on) => {
  mock.clock(on)
  on('agent.list', () => ({ value: [] }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000, percent: 0 }, rateLimits: [], cost: { usd: 0 } } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: { permissions: { defaultMode: 'bypassPermissions' } } }) as never)
  on('session.cwd', () => ({ value: '/repo' }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: 'main\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.render', () => null as never)
  on('command.register', () => ({ value: {} }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const hint = await $.ui.mount({
    plugin: 'agent-meter',
    surface: 'terminal',
    component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: '(shift+tab to cycle) · ← for agents' },
    viewport: { columns: 162, rows: 40 },
  } as never)
  const margins = (await hint.findAll({ type: 'Box' })).map(b => (b.props as { marginLeft?: number }).marginLeft)
  // ⏵⏵ bypass permissions on 24칸 + 엔진이 뒤에 붙이는 ' · ' 3칸
  expect(margins).toContain(-27)
})

test('설정에 기본 모드가 없어도 첫 대화 전에는 --dangerously-skip-permissions로 띄운 권한 모드만큼 표를 왼쪽으로 당긴다', { timeoutMs: 30_000 }, async ($, on) => {
  mock.clock(on)
  on('agent.list', () => ({ value: [] }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000, percent: 0 }, rateLimits: [], cost: { usd: 0 } } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: {} }) as never)
  on('session.cwd', () => ({ value: '/repo' }))
  on('process.run', (_$, e) => ({
    value: {
      exitCode: 0,
      stdout: e.argv[0] === 'sh' ? '/Users/me/.local/bin/claude --settings {"a": 1} --dangerously-skip-permissions -c\n' : 'main\n',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.render', () => null as never)
  on('command.register', () => ({ value: {} }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const hint = await $.ui.mount({
    plugin: 'agent-meter',
    surface: 'terminal',
    component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: '(shift+tab to cycle) · ← for agents' },
    viewport: { columns: 162, rows: 40 },
  } as never)
  const margins = (await hint.findAll({ type: 'Box' })).map(b => (b.props as { marginLeft?: number }).marginLeft)
  expect(margins).toContain(-27)
})

// 엔진은 표가 힌트 줄을 대신하는 동안 힌트 내용과 상관없이 권한 모드 표시를 왼쪽에 그린다
for (const [name, hint] of [
  ['백그라운드 셸이 있어 힌트 줄이 작업 관리 안내로 바뀌어도', '1 shell · ↓ to manage'],
  ['응답 중이라 힌트 줄이 중단 안내로 바뀌어도', 'esc to interrupt'],
] as const) {
  test(`${name} 권한 모드 표시 폭만큼 표를 왼쪽으로 당긴다`, { timeoutMs: 30_000 }, async ($, on) => {
    baseHandlers(on, { defaultMode: () => 'bypassPermissions' })
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    const margins = (await (await mountHint($, hint)).findAll({ type: 'Box' })).map(b => (b.props as { marginLeft?: number }).marginLeft)
    expect(margins).toContain(-27)
  })
}

for (const [mode, margin] of [
  ['default', -19],
  ['dontAsk', -18],
] as const) {
  test(`권한 모드가 ${mode}이면 권한 모드 표시 폭(${-margin}칸)만큼 표를 왼쪽으로 당긴다`, { timeoutMs: 30_000 }, async ($, on) => {
    baseHandlers(on, { defaultMode: () => mode })
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    const margins = (await (await mountHint($)).findAll({ type: 'Box' })).map(b => (b.props as { marginLeft?: number }).marginLeft)
    expect(margins).toContain(margin)
  })
}

const pathCases: [string, string, string, string?][] = [
  ['홈 아래 폴더는 홈 부분을 ~로 줄인다', '/Users/user/Downloads/claude-setup-kit', '~/Downloads/claude-setup-kit'],
  ['홈 자체는 ~로 그린다', '/Users/user', '~'],
  ['홈 밖 폴더는 그대로 둔다', '/repo', '/repo'],
  ['홈 이름으로 시작만 하는 다른 폴더는 줄이지 않는다', '/Users/user2/work', '/Users/user2/work'],
  ['Windows 홈 아래 폴더는 \\ 경계로 ~로 줄인다', 'C:\\Users\\user\\work', '~\\work', 'C:\\Users\\user'],
  ['Windows 홈 자체는 ~로 그린다', 'C:\\Users\\user', '~', 'C:\\Users\\user\\'],
  ['Windows 홈 이름으로 시작만 하는 다른 폴더는 줄이지 않는다', 'C:\\Users\\user2\\work', 'C:\\Users\\user2\\work', 'C:\\Users\\user'],
]
for (const [name, cwd, shown, home = '/Users/user'] of pathCases) {
  test(`첫 줄 path: ${name}`, { timeoutMs: 30_000 }, async ($, on) => {
    mock.clock(on)
    on('agent.list', () => ({ value: [] }))
    on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000, percent: 0 }, rateLimits: [], cost: { usd: 4.14 } } }))
    on('session.model', () => ({ value: 'claude-opus-5-5' }))
    on('settings.read', () => ({ value: {} }) as never)
    on('env.get', () => ({ value: home }))
    on('session.cwd', () => ({ value: cwd }))
    on('process.run', () => ({
      value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }))
    on('ui.status', () => ({ value: undefined }))
    on('ui.render', () => null as never)
    on('command.register', () => ({ value: {} }) as never)
    on('session.start', (_$, e) => ({ cwd: e.cwd }))

    await $.session.start({ cwd, surface: 'terminal', isInteractive: true })
    const hint = await $.ui.mount({
      plugin: 'agent-meter',
      surface: 'terminal',
      component: 'PromptHint',
      props: { isDraft: false, isWorking: false, hint: 'hint' },
      viewport: { columns: 162, rows: 40 },
    } as never)
    const texts = (await hint.findAll({ type: 'Text' })).map(t => t.text)
    expect(texts.filter(t => t === `total $4.14 | branch - | path ${shown}`)).toHaveLength(1)
  })
}

for (const [name, value, isWarmed] of [
  ['끈 값 0', '0', false],
  ['끈 값 false', 'false', false],
  ['끈 값 OFF(대소문자 무시)', 'OFF', false],
  ['그 밖의 값 1', '1', true],
  ['값 없음', undefined, true],
] as const) {
  test(`서브에이전트가 도는 중 AGENT_METER_KEEPALIVE가 ${name}이면 ${isWarmed ? '메인 캐시를 연장한다' : '연장 요청 없이 알림만 낸다'}`, { timeoutMs: 30_000 }, async ($, on) => {
    const clock = mock.clock(on)
    const toasts: string[] = []
    let forks = 0
    on('agent.list', () => ({ value: [{ id: 'a1', type: 'sonnet-medium', description: '문서 검수', status: 'running' as const }] }))
    on('env.get', (_$, e) => ({ value: (e as { name?: string }).name === 'AGENT_METER_KEEPALIVE' ? value : undefined }) as never)
    on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000, percent: 38 }, rateLimits: [], cost: { usd: 1.5 } } }))
    on('session.model', () => ({ value: 'claude-opus-5-5' }))
    on('settings.read', () => ({ value: {} }) as never)
    on('session.cwd', () => ({ value: '/repo' }))
    on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
    on('ui.status', () => ({ value: undefined }))
    on('ui.toast', (_$, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })
    on('ui.notify', () => ({ value: { isSent: true, channel: 'terminal_bell' } }) as never)
    on('ui.render', () => null as never)
    on('model.fork', () => {
      forks += 1
      return { value: { isAnswered: true, text: 'ok', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 113_000, cache_creation_input_tokens: 0 } } } as never
    })
    on('command.register', () => ({ value: {} }) as never)
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('turn.complete', () => ({ text: '' }))
    on('classic.SessionStart', () => ({}) as never)
    on('turn.step', async function* (_$, e) {
      await clock.advance(2000)
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [] as never, stopReason: 'end_turn', usage: usage('claude-opus-5-5') }
    })

    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    await $.classic.SessionStart({ source: 'startup', permission_mode: 'bypassPermissions' } as never)
    await clock.advance(1000)
    for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1 })) {
    }
    await clock.advance(57 * 60_000)

    expect(forks).toBe(isWarmed ? 1 : 0)
    if (isWarmed) expect(toasts).toEqual(['메인 캐시를 1시간 연장했습니다 $0.02'])
    else expect(toasts.filter(t => /^메인 캐시가 \d+분 뒤 만료됩니다/.test(t))).toHaveLength(1)
  })
}

// 메인이 5분 캐시인 세션에서 요청 하나를 보낸 직후까지 만든다. 서브에이전트가 도는지와 연장 요청의 응답을 고른다.
async function startFiveMinuteMain($: Parameters<Parameters<typeof test>[2]>[0], on: Parameters<Parameters<typeof test>[2]>[1], opts: { isAgentRunning: boolean; forkUsage?: { cache_read_input_tokens: number; cache_creation_input_tokens: number } }) {
  const clock = mock.clock(on)
  const toasts: string[] = []
  const state = { forks: 0 }
  on('agent.list', () => ({ value: opts.isAgentRunning ? [{ id: 'a1', type: 'sonnet-medium', description: '문서 검수', status: 'running' as const }] : [] }))
  on('env.get', () => ({ value: undefined }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000, percent: 38 }, rateLimits: [], cost: { usd: 1.5 } } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: {} }) as never)
  on('session.cwd', () => ({ value: '/repo' }))
  on('process.run', (_$, e) => ({
    value: { exitCode: e.argv.some(a => a.includes('ephemeral_5m')) ? 0 : 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.notify', () => ({ value: { isSent: true, channel: 'terminal_bell' } }) as never)
  on('ui.render', () => null as never)
  on('model.fork', () => {
    state.forks += 1
    const u = opts.forkUsage ?? { cache_read_input_tokens: 113_000, cache_creation_input_tokens: 0 }
    return { value: { isAnswered: true, text: 'ok', usage: { input_tokens: 10, output_tokens: 5, ...u } } } as never
  })
  on('command.register', () => ({ value: {} }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.SessionStart', () => ({}) as never)
  on('turn.step', async function* (_$, e) {
    await clock.advance(2000)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [] as never, stopReason: 'end_turn', usage: usage('claude-opus-5-5') }
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.classic.SessionStart({ source: 'startup', permission_mode: 'bypassPermissions', transcript_path: '/t/s.jsonl' } as never)
  await clock.advance(1000)
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1 })) {
  }
  const mainRow = async () => {
    const m = await mountHint($)
    return (await m.findAll({ type: 'Text' })).map(t => t.text).find(l => /^\s*main\s/.test(l)) ?? ''
  }
  return { clock, toasts, state, mainRow }
}

test('5분 캐시 메인은 응답 직후 2분이 지나도 알림도 연장도 없다', { timeoutMs: 30_000 }, async ($, on) => {
  const { clock, toasts, state, mainRow } = await startFiveMinuteMain($, on, { isAgentRunning: true })
  await clock.advance(2 * 60_000)
  expect(await mainRow()).toMatch(/\s[34]:\d\d\s/)
  expect(toasts).toEqual([])
  expect(state.forks).toBe(0)
})

test('5분 캐시 메인은 만료 1분 전에 연장하고 문구에 5분을 쓴다', { timeoutMs: 30_000 }, async ($, on) => {
  const { clock, toasts, state } = await startFiveMinuteMain($, on, { isAgentRunning: true })
  await clock.advance(4 * 60_000)
  expect(state.forks).toBe(1)
  expect(toasts).toEqual(['메인 캐시를 5분 연장했습니다 $0.02'])
})

test('5분 캐시 메인은 서브에이전트가 없으면 만료 1분 전에 연장 없이 알린다', { timeoutMs: 30_000 }, async ($, on) => {
  const { clock, toasts, state } = await startFiveMinuteMain($, on, { isAgentRunning: false })
  await clock.advance(3 * 60_000)
  expect(toasts).toEqual([])
  await clock.advance(60_000)
  expect(state.forks).toBe(0)
  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toMatch(/^메인 캐시가 1분 뒤 만료됩니다/)
})

test('연장 요청이 캐시를 읽지 못하면 그 요청의 비용을 메인 비용에 더하고 연장 대신 만료 알림을 낸다', { timeoutMs: 30_000 }, async ($, on) => {
  const { clock, toasts, state, mainRow } = await startFiveMinuteMain($, on, {
    isAgentRunning: true,
    forkUsage: { cache_read_input_tokens: 0, cache_creation_input_tokens: 113_000 },
  })
  const before = Number(/\$(\d+\.\d\d)\s*$/.exec(await mainRow())?.[1])
  await clock.advance(4 * 60_000)
  expect(state.forks).toBe(1)
  expect(toasts.filter(t => t.includes('연장했습니다'))).toEqual([])
  expect(toasts.filter(t => /^메인 캐시가 \d+분 뒤 만료됩니다/.test(t))).toHaveLength(1)
  // 113000토큰 캐시 쓰기는 $0.5 이상이다
  const after = Number(/\$(\d+\.\d\d)\s*$/.exec(await mainRow())?.[1])
  expect(after - before).toBeGreaterThan(0.5)
})

// 엔진이 /clear 뒤 상태를 비우는 것과 같은 상황을 만들려고, 상태를 직접 비우는 대신 권한 모드가 아직 없는 채로 시작한다
function baseHandlers(on: Parameters<Parameters<typeof test>[2]>[1], extra: { defaultMode?: () => string | undefined; env?: Record<string, string> } = {}) {
  const clock = mock.clock(on)
  on('agent.list', () => ({ value: [] }))
  on('env.get', (_$, e) => {
    const name = (e as { name?: string }).name ?? ''
    return { value: extra.env?.[name] } as never
  })
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000, percent: 0 }, rateLimits: [], cost: { usd: 0 } } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: extra.defaultMode?.() ? { permissions: { defaultMode: extra.defaultMode() } } : {} }) as never)
  on('session.cwd', () => ({ value: '/repo' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'main\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('ui.status', () => ({ value: undefined }))
  // 표를 그리지 않고 next(e)로 넘기면 여기까지 와서 이 표시가 그려진다
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['표시 숨김'] }) as never)
  on('command.register', () => ({ value: {} }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  return clock
}

async function mountHint($: Parameters<Parameters<typeof test>[2]>[0], hint = '(shift+tab to cycle) · ← for agents') {
  const m = await $.ui.mount({
    plugin: 'agent-meter',
    surface: 'terminal',
    component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint },
    viewport: { columns: 162, rows: 40 },
  } as never)
  return m
}

test('권한 모드 상태가 빈 값이면 다음 갱신 뒤 표를 권한 모드 표시 폭(-27)만큼 당긴다', { timeoutMs: 30_000 }, async ($, on) => {
  // 첫 갱신 때는 설정에 기본 모드가 없어 0, 그 뒤 기본 모드가 생기는 것으로 /clear 뒤 값이 비었다가 채워지는 흐름을 흉내 낸다
  let mode: string | undefined
  const clock = baseHandlers(on, { defaultMode: () => mode })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const margin = async () => (await (await mountHint($)).findAll({ type: 'Box' })).map(b => (b.props as { marginLeft?: number }).marginLeft)
  expect(await margin()).not.toContain(-27)

  mode = 'bypassPermissions'
  await clock.advance(6000)
  expect(await margin()).toContain(-27)
})

test('저장소에 숨김이 남아 있으면 상태가 비어 있어도 표를 그리지 않고, /meter로 다시 켠다', { timeoutMs: 30_000 }, async ($, on) => {
  baseHandlers(on)
  // /clear 뒤처럼 상태의 isHidden은 기본값 false인데 저장소에는 숨김이 남아 있는 경우
  mock.store(on, { isHidden: true })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect((await (await mountHint($)).findAll({ type: 'Text' })).map(t => t.text)).toEqual(['표시 숨김'])

  const result = await $.command.run({ command: 'meter', args: '' } as never)
  expect(JSON.stringify(result)).toContain('켰습니다')
  const texts = (await (await mountHint($)).findAll({ type: 'Text' })).map(t => t.text)
  expect(texts.some(t => /^\s*agent\s+model\s/.test(t))).toBe(true)
})

test('/meter로 숨기면 표가 사라진다', { timeoutMs: 30_000 }, async ($, on) => {
  baseHandlers(on)
  mock.store(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const result = await $.command.run({ command: 'meter', args: '' } as never)
  expect(JSON.stringify(result)).toContain('숨겼습니다')
  expect((await (await mountHint($)).findAll({ type: 'Text' })).map(t => t.text)).toEqual(['표시 숨김'])
})

async function headText($: Parameters<Parameters<typeof test>[2]>[0]) {
  const texts = (await (await mountHint($)).findAll({ type: 'Text' })).map(t => t.text)
  return texts.find(t => /^\s*agent\s+model\s/.test(t)) ?? ''
}

const TOKEN_HEADS = ['입력', '출력', '캐시읽기', '캐시쓰기']

for (const [name, stored, isShown] of [
  ['저장값이 없으면', undefined, true],
  ['저장값 true이면', true, true],
  ['저장값 false이면', false, false],
] as const) {
  test(`${name} 토큰 열을 ${isShown ? '그린다' : '뺀다'}`, { timeoutMs: 30_000 }, async ($, on) => {
    baseHandlers(on)
    mock.store(on, stored === undefined ? {} : { isTokensShown: stored })
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    const head = await headText($)
    for (const h of ['model', 'effort', 'context', '경과', '캐시', '재캐시', '캐시만료', '비용']) expect(head).toContain(h)
    for (const h of TOKEN_HEADS) expect(head.includes(h)).toBe(isShown)
  })
}

test('/meter tokens는 지금 보이는 상태를 뒤집고 표를 바로 다시 그리며 /meter로 표 전체를 숨겨도 저장값은 그대로다', { timeoutMs: 30_000 }, async ($, on) => {
  baseHandlers(on)
  mock.store(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  for (const h of TOKEN_HEADS) expect(await headText($)).toContain(h)

  const off = await $.command.run({ command: 'meter', args: ' tokens ' } as never)
  expect(JSON.stringify(off)).toContain('토큰 열을 숨겼습니다.')
  expect(await headText($)).not.toContain('입력')

  const on1 = await $.command.run({ command: 'meter', args: 'tokens' } as never)
  expect(JSON.stringify(on1)).toContain('토큰 열을 켰습니다.')
  for (const h of TOKEN_HEADS) expect(await headText($)).toContain(h)

  await $.command.run({ command: 'meter', args: 'tokens' } as never)
  await $.command.run({ command: 'meter', args: '' } as never)
  expect((await (await mountHint($)).findAll({ type: 'Text' })).map(t => t.text)).toEqual(['표시 숨김'])
  await $.command.run({ command: 'meter', args: '' } as never)
  expect(await headText($)).not.toContain('입력')
})

test('/meter에 모르는 인자가 오면 표와 토큰 열을 건드리지 않고 쓸 수 있는 인자를 알려 준다', { timeoutMs: 30_000 }, async ($, on) => {
  baseHandlers(on)
  mock.store(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const result = await $.command.run({ command: 'meter', args: 'foo' } as never)
  expect(JSON.stringify(result)).toContain('tokens')
  const head = await headText($)
  expect(head).toContain('agent')
  for (const h of TOKEN_HEADS) expect(head).toContain(h)
})

// 파일이 두 배 요율일 때 opus의 비용: (1000*8 + 10000*16 + 100000*0.4 + 2000*40)/1e6 = 0.288
// 내장 요율일 때: (1000*4 + 10000*8 + 100000*0.2 + 2000*20)/1e6 = 0.144
const RATES_DIR = '/cfg'
const RATES_FILE = `${RATES_DIR}/subagent-system/rates.json`
const doubledOpus = { 'claude-opus-5-5': { input: 8, write5m: 10, write1h: 16, cacheRead: 0.4, output: 40 } }

type RatesFile = { text: string; mtimeMs: number } | null

async function mainCost($: Parameters<Parameters<typeof test>[2]>[0], on: Parameters<Parameters<typeof test>[2]>[1], file: () => RatesFile, env: Record<string, string> = { CLAUDE_CONFIG_DIR: RATES_DIR }, path = RATES_FILE) {
  const clock = baseHandlers(on, { env })
  const reads: string[] = []
  on('fs.stat', (_$, e) => {
    const f = (e as { path: string }).path === path ? file() : null
    return (f ? { value: { kind: 'file', size: f.text.length, mtimeMs: f.mtimeMs, isLink: false } } : { deny: 'ENOENT' }) as never
  })
  on('fs.read', (_$, e) => {
    const f = file()
    reads.push((e as { path: string }).path)
    return (f ? { value: f.text } : { deny: 'ENOENT' }) as never
  })
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [] as never, stopReason: 'end_turn', usage: usage('claude-opus-5-5') }
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const step = async (turnId: string) => {
    for await (const _ of $.turn.step({ turnId, index: 0, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1 })) {
    }
    await clock.advance(1000)
    const texts = (await (await mountHint($)).findAll({ type: 'Text' })).map(t => t.text)
    return /\s(\$[\d.]+|\?)\s*$/.exec(texts.find(t => /^\s*main\s/.test(t)) ?? '')?.[1]
  }
  return { clock, reads, step }
}

test('요율 파일이 있으면 내장값 대신 그 값으로 비용을 계산한다', { timeoutMs: 30_000 }, async ($, on) => {
  const { step } = await mainCost($, on, () => ({ text: JSON.stringify({ _unit: '설명', ...doubledOpus }), mtimeMs: 1 }))
  expect(await step('t1')).toBe('$0.29')
})

test('요율 파일이 없으면 내장값으로 계산한다', { timeoutMs: 30_000 }, async ($, on) => {
  const { step } = await mainCost($, on, () => null)
  expect(await step('t1')).toBe('$0.14')
})

test('요율 파일이 깨졌으면 내장값으로 계산한다', { timeoutMs: 30_000 }, async ($, on) => {
  const { step } = await mainCost($, on, () => ({ text: '{ 깨진 json', mtimeMs: 1 }))
  expect(await step('t1')).toBe('$0.14')
})

test('요율 파일에 쓸 수 있는 모델이 하나도 없으면 내장값으로 계산한다', { timeoutMs: 30_000 }, async ($, on) => {
  const { step } = await mainCost($, on, () => ({ text: JSON.stringify({ 'claude-opus-5-5': { input: 8 } }), mtimeMs: 1 }))
  expect(await step('t1')).toBe('$0.14')
})

test('요율 파일에 그 모델이 없으면 비용을 모르는 것으로 두고 내장값으로 채우지 않는다', { timeoutMs: 30_000 }, async ($, on) => {
  const other = { 'claude-sonnet-5-5': { input: 2, write5m: 2.5, write1h: 4, cacheRead: 0.1, output: 10 } }
  const { step } = await mainCost($, on, () => ({ text: JSON.stringify(other), mtimeMs: 1 }))
  expect(await step('t1')).toBe('?')
})

test('CLAUDE_CONFIG_DIR이 없으면 HOME 아래 .claude의 요율 파일을 읽는다', { timeoutMs: 30_000 }, async ($, on) => {
  const { step, reads } = await mainCost($, on, () => ({ text: JSON.stringify(doubledOpus), mtimeMs: 1 }), { HOME: '/home/u/' }, '/home/u/.claude/subagent-system/rates.json')
  expect(await step('t1')).toBe('$0.29')
  expect(reads).toEqual(['/home/u/.claude/subagent-system/rates.json'])
})

test('요율 파일의 수정 시각이 그대로면 다시 읽지 않고, 바뀌면 새 값을 쓴다', { timeoutMs: 30_000 }, async ($, on) => {
  let file: RatesFile = { text: JSON.stringify(doubledOpus), mtimeMs: 1 }
  const { clock, reads, step } = await mainCost($, on, () => file)
  expect(await step('t1')).toBe('$0.29')
  await clock.advance(30_000)
  expect(reads).toHaveLength(1)

  file = { text: JSON.stringify({ 'claude-opus-5-5': { input: 4, write5m: 5, write1h: 8, cacheRead: 0.2, output: 20 } }), mtimeMs: 2 }
  await clock.advance(6000)
  expect(reads).toHaveLength(2)
  // 새 요율은 다음 요청부터 적용되어 합계가 0.288 + 0.144가 된다
  expect(await step('t2')).toBe('$0.43')
})

for (const [model, label, percentText, answeredModel = model] of [
  ['claude-sonnet-5-5', 'sonnet 5\\.5', '11%'],
  ['claude-sonnet-4-6', 'sonnet 4\\.6', '56%'],
  ['claude-sonnet-4-6[1m]', 'sonnet 4\\.6', '11%'],
  ['claude-haiku-4-5-20251001', 'haiku 4\\.5', '56%'],
  ['claude-opus-4-5', 'opus 4\\.5', '56%'],
  ['us.anthropic.claude-sonnet-4-5-20250929-v1:0', 'sonnet 4\\.5', '56%'],
  // 응답의 모델 이름에는 요청한 [1m]이 없을 수 있다
  ['claude-sonnet-4-6[1m]', 'sonnet 4\\.6', '11%', 'claude-sonnet-4-6'],
] as [string, string, string, string?][]) {
  test(`서브에이전트 문맥 사용률의 분모는 요청 ${model}에 응답 ${answeredModel}이면 ${percentText === '11%' ? '1M' : '200K'}로 센다`, { timeoutMs: 30_000 }, async ($, on) => {
    const clock = mock.clock(on)
    on('agent.list', () => ({ value: [{ id: 'a1', type: 'sonnet-medium', description: '문서 검수', status: 'running' as const }] }))
    on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000, percent: 38 }, rateLimits: [], cost: { usd: 1.5 } } }))
    on('session.model', () => ({ value: 'claude-opus-5-5' }))
    on('settings.read', () => ({ value: {} }) as never)
    on('session.cwd', () => ({ value: '/repo' }))
    on('process.run', (_$, e) => ({
      value: { exitCode: e.argv[0] === 'git' ? 0 : 1, stdout: 'main\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }))
    on('ui.status', () => ({ value: undefined }))
    on('ui.toast', () => ({ value: undefined }))
    on('ui.notify', () => ({ value: { isSent: true, channel: 'terminal_bell' } }) as never)
    on('ui.render', () => null as never)
    on('command.register', () => ({ value: {} }) as never)
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('turn.complete', () => ({ text: '' }))
    on('classic.SessionStart', () => ({}) as never)
    on('turn.step', async function* (_$, e) {
      return {
        turnId: e.turnId,
        index: e.index,
        answer: '',
        toolUses: [{ id: 'u1', name: 'Read', input: {} }] as never,
        stopReason: 'end_turn',
        usage: usage(answeredModel),
      }
    })
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    await $.classic.SessionStart({ source: 'startup', permission_mode: 'bypassPermissions' } as never)
    for await (const _ of $.turn.step({ turnId: 't1', index: 0, model, effort: 'low', messageCount: 1, agentId: 'a1' })) {
    }
    await clock.advance(1000)
    const texts = (await (await mountHint($)).findAll({ type: 'Text' })).map(t => t.text)
    // usage는 입력 1000 + 캐시 읽기 100000 + 캐시 쓰기 10000 + 출력 2000 = 113000
    expect(texts.filter(l => new RegExp(`^\\s*문서 검수\\s+${label}\\s+low\\s+${percentText}\\s`).test(l))).toHaveLength(1)
  })
}

// 1시간 캐시 메인이 요청을 하나 보낸 뒤 분 단위로 시간을 보내고 session.compact를 불러 본다.
// 압축이 막히면 { skip }, 통과하면 테스트가 맨 아래에 둔 응답(messages)이 돌아온다.
type CompactCase = {
  trigger?: string
  agentId?: string
  isAgentRunning?: boolean
  keepAlive?: string
  idleMinutes?: number
  tokens?: number
  breakdown?: { rawMaxTokens: number; autoCompactThreshold?: number } | null
}

async function compactAfterIdle($: Parameters<Parameters<typeof test>[2]>[0], on: Parameters<Parameters<typeof test>[2]>[1], c: CompactCase) {
  const clock = mock.clock(on)
  const toasts: string[] = []
  const hasTokens = 'tokens' in c ? c.tokens : 300_000
  const breakdown = 'breakdown' in c ? c.breakdown : { rawMaxTokens: 400_000, autoCompactThreshold: 380_000 }
  on('agent.list', () => ({ value: c.isAgentRunning === false ? [] : [{ id: 'a1', type: 'sonnet-medium', description: '문서 검수', status: 'running' as const }] }))
  on('env.get', (_$, e) => ({ value: (e as { name?: string }).name === 'AGENT_METER_KEEPALIVE' ? c.keepAlive : undefined }) as never)
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 1_000_000, tokens: hasTokens, percent: 30, ...(breakdown ? { breakdown } : {}) }, rateLimits: [], cost: { usd: 1.5 } },
  }) as never)
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: {} }) as never)
  on('session.cwd', () => ({ value: '/repo' }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.notify', () => ({ value: { isSent: true, channel: 'terminal_bell' } }) as never)
  on('ui.render', () => null as never)
  on('model.fork', () => ({ value: { isAnswered: true, text: 'ok', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 113_000, cache_creation_input_tokens: 0 } } }) as never)
  on('command.register', () => ({ value: {} }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.SessionStart', () => ({}) as never)
  on('turn.step', async function* (_$, e) {
    await clock.advance(2000)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [] as never, stopReason: 'end_turn', usage: usage('claude-opus-5-5') }
  })
  on('session.compact', () => ({ messages: [{ role: 'user', text: 'kept', toolUses: [] }] }) as never)

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.classic.SessionStart({ source: 'startup', permission_mode: 'bypassPermissions' } as never)
  await clock.advance(1000)
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1 })) {
  }
  await clock.advance((c.idleMinutes ?? 51) * 60_000)
  const result = await ($.session.compact as (input: unknown) => Promise<{ skip?: string }>)({ trigger: c.trigger ?? 'auto', messages: [{ role: 'user', text: 'hi', toolUses: [] }], ...(c.agentId ? { agentId: c.agentId } : {}) })
  return { result, toasts: toasts.filter(t => t.includes('유휴 압축')) }
}

for (const [name, c, isSkipped] of [
  ['메인이 51분 유휴이고 서브에이전트가 도는 중 대화가 임계 기준보다 작은 auto 압축', {}, true],
  ['같은 조건의 precompute 압축', { trigger: 'precompute' }, true],
  ['서브에이전트가 없으면', { isAgentRunning: false }, false],
  ['AGENT_METER_KEEPALIVE가 꺼져 있으면', { keepAlive: 'off' }, false],
  ['서브에이전트 자신의 압축(agentId 있음)이면', { agentId: 'a1' }, false],
  ['유휴가 50분 미만이면', { idleMinutes: 49 }, false],
  ['사람이 직접 누른 manual 압축이면', { trigger: 'manual' }, false],
  ['대화가 임계 기준의 90%에 가까우면', { tokens: 350_000 }, false],
  ['대화 크기(tokens)가 없으면', { tokens: undefined }, false],
  ['압축 기준(breakdown)을 읽을 수 없으면', { breakdown: null }, false],
] as [string, CompactCase, boolean][]) {
  test(`${name} 유휴 압축을 ${isSkipped ? '건너뛰고 알린다' : '막지 않는다'}`, { timeoutMs: 30_000 }, async ($, on) => {
    const { result, toasts } = await compactAfterIdle($, on, c)
    if (isSkipped) {
      expect(result.skip).toBeDefined()
      expect(toasts).toEqual(['서브에이전트 실행 중이라 유휴 압축을 건너뛰었습니다'])
    } else {
      expect(result.skip).toBeUndefined()
      expect(toasts).toEqual([])
    }
  })
}
