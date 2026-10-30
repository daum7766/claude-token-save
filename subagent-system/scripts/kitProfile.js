// 개인용(personal)과 회사용(company)을 가르는 원본이다. kit-setup.js와 회고 스크립트가 함께 불러 쓴다.
//
// 무엇을 묻고 무엇을 바로 하는지(바로 고치기, 만들기, 애매할 때의 문턱, 물을 것 세기, 고친 근거를 남기는 곳)는 profile 하나가 정하고,
// 따로 바꾸는 설정 키가 없다. 까닭: 키를 따로 바꿀 수 있게 하면 조합이 늘어 문서의 「개인용은, 회사용은」과 동작이 회차마다 어긋났고,
// 따로 바꿀 필요가 확인된 적이 없다. 전제: 따로 바꿀 필요가 생기면 profile을 늘리지 않고 이 파일에서 한 번에 정한다.

// 설정 키로 남는 기본값이다. 이 키들은 profile이 정하는 판정이 아니라 각자 뜻이 있어 따로 바꿀 수 있다.
//   retroMode: 회고를 언제 누가 돌리나. retroWriteAllow: 사용자가 거절할 수 있는 권한 스위치. commitCheck: 커밋 메시지 검사 훅의 동작.
export const PROFILES = {
  personal: { retroMode: 'auto', retroWriteAllow: true, commitCheck: 'block' },
  company: { retroMode: 'ask', retroWriteAllow: false, commitCheck: 'off' },
};

// 예전에 설정 키였다가 profile 판정으로 합쳐진 키다. 읽지 않고, 업데이트와 set-profile이 config.json에서 지운다.
export const RETIRED_POLICY_KEYS = ['autoApplyRules', 'autoCreate', 'actThreshold', 'methodCommit'];

// profile이 없거나 모르는 값이거나 설정이 없거나 깨졌으면 회사용이다. retroMode로 profile을 짐작하지 않는다.
// 까닭: 짐작은 옛 설치와 순서가 있는 경로(update 다음 set-profile)에서 조합을 늘려 막음이 회차마다 되풀이됐고, 틀리면 묻지 않고 고치는 쪽으로 틀린다. 회사용이면 묻는 쪽으로 틀려 비용이 작다.
// 전제: profile이 없는 설치본은 업데이트 전 설치본뿐이고, kit-setup.js update가 profile을 사용자에게 고르게 한 뒤에야 진행한다.
export function profileOf(config) {
  return config && PROFILES[config.profile] ? config.profile : 'company';
}

// 사용자에게 먼저 묻고 하는지를 profile에서 낸다. 개인용은 false(바로 고치고 만들며 애매하면 하고 알림),
// 회사용은 true(고칠 것을 제안으로 모아 승인받고, 애매하면 되돌리는 비용이 거의 없는 것만 한다).
export const askFirstOf = (profile) => profile !== 'personal';
