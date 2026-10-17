export type Ttl = '5m' | '1h'

export type Loop = {
  id: string
  /** 메인은 'main', 서브에이전트는 정의 이름(agent type) */
  label: string
  description: string
  model: string
  /** 마지막 요청을 `[1m]` 모델로 보냈는지. 이 칸이 생기기 전 기록에는 없다 */
  isExtended?: boolean
  effort: string
  isRunning: boolean
  ttl: Ttl
  /** 기록 파일의 캐시 쓰기에서 확인했는지, 아직 기본값인지 */
  isTtlConfirmed: boolean
  steps: number
  input: number
  write: number
  read: number
  output: number
  /** 마지막 요청이 본 문맥 크기(입력+캐시 쓰기+캐시 읽기+출력) */
  context: number
  /** 단가표에 없는 모델이 섞이면 null */
  cost: number | null
  /** 앞 요청 문맥을 캐시에서 읽지 못하고 다시 쓴 요청 수 */
  expiries: number
  /** 그 요청들이 캐시를 읽었다면 내지 않았을 돈, 단가표에 없는 모델이 섞이면 null */
  expiryCost: number | null
  /** 첫 요청을 보낸 시각 */
  startedAt: number
  lastAt: number
}

/** 상태 표시줄에서 옮겨 온 세션 정보 */
export type Session = {
  usd: number | null
  /** 메인 문맥 사용률, Claude Code 집계 */
  contextPercent: number | null
  model: string
  /** 첫 요청 전 메인 줄에 보일 effort, 환경변수나 설정 파일 값 */
  effort: string
  branch: string
  /** 현재 작업 폴더, 홈은 ~로 줄인 값. 아직 모르면 빈 문자열 */
  path: string
}

declare module 'claude-code' {
  interface PluginState {
    'agent-meter': {
      loops: Record<string, Loop>
      session: Session
      now: number
      isHidden: boolean
      /** 토큰 열 저장값이 바뀔 때 그리기를 다시 하게 하는 번호 */
      tokensRevision: number
      transcript: string
      permissionMode: string
      /** 만료 직전 연장이나 알림을 마친 메인 캐시의 마지막 요청 시각 */
      warnedAt: number
    }
  }
}
