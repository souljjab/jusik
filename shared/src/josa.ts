/**
 * 한국어 조사 고르기: 앞 낱말의 마지막 글자에 받침이 있는지로 고른다.
 * josa("중립", "으로/로") → "중립으로", josa("공격", "으로/로") → "공격으로", josa("방어", "으로/로") → "방어로"
 * "으로/로"는 ㄹ 받침이면 "로"를 쓴다. 한글이 아닌 글자로 끝나면 두 번째(받침 없음) 형태를 쓴다.
 */
export function josa(word: string, pair: "으로/로" | "을/를" | "은/는" | "이/가" | "과/와" | "아/야" | "이에요/예요"): string {
  const [withBatchim, without] = pair.split("/") as [string, string];
  const last = word.trim().at(-1) ?? "";
  const code = last.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return word + without;
  const jong = code % 28;
  if (jong === 0) return word + without;
  if (pair === "으로/로" && jong === 8) return word + without; // ㄹ 받침: "서울로"
  return word + withBatchim;
}
