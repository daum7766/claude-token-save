// 시험이 도는 자리가 키트 원본인지, 일부 묶음만 깐 설치본인지 알려 주는 도우미.
// 왜: 설치본에는 키트 정의(bundles/)가 없고 안 깐 묶음의 파일도 없다. 그 파일을 읽는 시험이 실패로 보이지 않고 건너뛰기로 보이게 한다.
// 전제: 이 파일은 바닥 조각의 tests/fixtures에 있어 모든 설치에 놓인다. 키는 설정 폴더 기준 설치 키(subagent-system/…, hooks/…)다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 키트 원본이면 저장소 뿌리, 설치본이면 설정 폴더.
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
export const IS_KIT_SOURCE = fs.existsSync(path.join(ROOT, 'bundles', 'base', 'bundle.json'));
export const NOT_KIT_SOURCE = IS_KIT_SOURCE ? false : '설치본 배치라 키트 원본(bundles/)이 없음';

// 키가 이 자리에 있는지. agents, rules, skills는 키트 원본에서는 subagent-system 아래에 있다.
export function hasFile(key) {
  const rel = key.split('/');
  if (fs.existsSync(path.join(ROOT, ...rel))) return true;
  return IS_KIT_SOURCE && ['agents', 'rules', 'skills'].includes(rel[0]) && fs.existsSync(path.join(ROOT, 'subagent-system', ...rel));
}

// 필요한 파일이 모두 있으면 false, 아니면 건너뛰기 까닭(skip 옵션에 그대로 넣는다).
export function missingFiles(...keys) {
  const missing = keys.filter((k) => !hasFile(k));
  return missing.length === 0 ? false : `설치본에 ${missing.join(', ')}가 없음(안 깐 묶음의 파일)`;
}

// 이 묶음이 키트 원본에 모두 있으면 false, 아니면 건너뛰기 까닭. 묶음 일부만 내보낸 공개판 원본에서 빠진 묶음을 가리키는 시험을 가린다.
// 설치본 배치는 NOT_KIT_SOURCE 쪽이 가리므로 여기서는 키트 원본일 때만 판정한다.
// 묶음 일부만 든 키트(공개판처럼 bundles/omitted.json이 있는 트리)이면 건너뛸 까닭, 온전한 키트 원본이면 false.
// 「모든 묶음」을 보는 시험이 묶음 이름을 하나하나 적지 않게 하려는 것이다(묶음이 늘 때마다 목록을 고쳐야 했다).
export function partialKit() {
  if (!IS_KIT_SOURCE) return false;
  return fs.existsSync(path.join(ROOT, 'bundles', 'omitted.json')) ? '묶음 일부만 든 키트' : false;
}

export function missingBundles(...names) {
  if (!IS_KIT_SOURCE) return false;
  const missing = names.filter((n) => !fs.existsSync(path.join(ROOT, 'bundles', n, 'bundle.json')));
  return missing.length === 0 ? false : `${missing.join(', ')} 묶음이 키트 원본에 없음`;
}
