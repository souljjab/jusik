import { describe, expect, it } from "vitest";
import { parseQty } from "../src/ui/Controls";

describe("수량 입력", () => {
  it("빈 칸은 null(지운 뒤 새로 칠 수 있게), 숫자 아닌 글자는 뺀다", () => {
    expect(parseQty("")).toBeNull();
    expect(parseQty("1,5")).toBe(15);
    expect(parseQty("5주")).toBe(5);
  });
});
