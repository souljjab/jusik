/** 첫 실행 안내(재설계 중 자리표시). 끝나면 onDone을 부른다 */
export default function Onboarding({ onDone }: { onDone: () => void }) {
  void onDone;
  return null;
}
