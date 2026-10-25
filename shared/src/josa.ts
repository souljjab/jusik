/** 숫자를 읽을 때 마지막 소리의 받침(종성 번호): 0 영·십·백·천(받침), 1 일(ㄹ), 3 삼, 6 육, 7 칠(ㄹ), 8 팔(ㄹ), 2·4·5·9는 없음 */
const DIGIT_JONG = [21, 8, 0, 16, 0, 0, 1, 8, 8, 0];

/**
 * 한국어 조사 고르기: 앞 낱말의 마지막 글자에 받침이 있는지로 고른다.
 * josa("중립", "으로/로") → "중립으로", josa("공격", "으로/로") → "공격으로", josa("방어", "으로/로") → "방어로"
 * "으로/로"는 ㄹ 받침이면 "로"를 쓴다. 숫자로 끝나면 읽는 소리로 고른다("2026-10은", "3을").
 * 그 밖에 한글이 아닌 글자로 끝나면 두 번째(받침 없음) 형태를 쓴다.
 */
export function josa(word: string, pair: "으로/로" | "을/를" | "은/는" | "이/가" | "과/와" | "아/야" | "이에요/예요"): string {
  const [withBatchim, without] = pair.split("/") as [string, string];
  const last = word.trim().at(-1) ?? "";
  const code = last.charCodeAt(0) - 0xac00;
  const digit = /\d/.test(last) ? DIGIT_JONG[Number(last)]! : null;
  if (digit == null && (code < 0 || code > 11171)) return word + without;
  const jong = digit ?? code % 28;
  if (jong === 0) return word + without;
  if (pair === "으로/로" && jong === 8) return word + without; // ㄹ 받침: "서울로"
  return word + withBatchim;
}
