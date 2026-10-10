import { describe, expect, it } from "vitest";
import { buildMacroSnapshot, MACRO_RELEASE_LAG_DAYS } from "@jusik/shared";
import { HttpError, type Http } from "../src/http";
import {
  ISM_PARAMS, ISM_URL, IsmSource, ismMonthUrl, ismReleaseDate, latestReleasedIsmMonth, manualIsm, MockIsmSource, parseIsmPmi,
  sampleIsmProxySeries, sampleIsmValue, shiftMonth,
} from "../src/ism";

/*
 * 아래 HTML은 ISM 보고서 페이지 문구를 흉내 낸 가짜 조각이다(숫자도 지어낸 값).
 * 외부 접속이 막힌 환경이라 실제 응답과 대조하지 못했다(미검증).
 */
const HEADLINE_PAGE = `<!DOCTYPE html><html><head><title>ISM Report On Business</title><script>var x = "Manufacturing PMI at 99%";</script></head>
<body><h1>Manufacturing PMI<sup>&reg;</sup> at 47.2%; September 2024 Manufacturing ISM<sup>&reg;</sup> Report On Business<sup>&reg;</sup></h1>
<p>The Manufacturing PMI&reg; registered 47.2 percent in September, matching the reading recorded in August.</p></body></html>`;

const TITLE_AND_SENTENCE = `<div class="report"><h2>September 2024 Manufacturing ISM® Report On Business®</h2>
<p>Economic activity in the manufacturing sector contracted in September for the sixth consecutive month.</p>
<p>“The Manufacturing PMI® registered 48.7 percent in September, up 1.5 percentage points from the 47.2 percent recorded in August.”</p></div>`;

const MONTH_FIRST = `<h2>August 2024 Manufacturing ISM® Report On Business®</h2>
<p>The August Manufacturing PMI® registered 47.2&nbsp;percent, up 0.4 percentage point from the 46.8 percent recorded in July.</p>`;

const TITLE_AFTER = `<p>The Manufacturing PMI® registered 51.3 percent in March.</p><footer>Manufacturing ISM® Report On Business® - March 2024</footer>`;

const NO_TITLE_WITH_DATE = `<p>FOR RELEASE: October 1, 2024</p><p>The Manufacturing PMI® registered 47.2&#37; in September.</p>`;

describe("parseIsmPmi", () => {
  it("reads the headline form (value and report month on one line), ignoring scripts and entities", () => {
    expect(parseIsmPmi(HEADLINE_PAGE)).toEqual({ value: 47.2, month: "2024-09" });
    expect(parseIsmPmi("<p>Manufacturing PMI® at 50.3%; December 2023 Manufacturing ISM® Report On Business®</p>")).toEqual({ value: 50.3, month: "2023-12" });
  });

  it("reads the report title month plus the body sentence", () => {
    expect(parseIsmPmi(TITLE_AND_SENTENCE)).toEqual({ value: 48.7, month: "2024-09" });
    expect(parseIsmPmi(MONTH_FIRST)).toEqual({ value: 47.2, month: "2024-08" });
    expect(parseIsmPmi(TITLE_AFTER)).toEqual({ value: 51.3, month: "2024-03" });
  });

  it("finds the year from the release date when no report title is present", () => {
    expect(parseIsmPmi(NO_TITLE_WITH_DATE)).toEqual({ value: 47.2, month: "2024-09" });
    // 12월분은 다음 해 1월 발표
    expect(parseIsmPmi("<p>January 3, 2025</p><p>The Manufacturing PMI® registered 49.3 percent in December.</p>")).toEqual({ value: 49.3, month: "2024-12" });
  });

  it("skips sentences about another month and keeps looking", () => {
    const html = `<h2>September 2024 Manufacturing ISM® Report On Business®</h2>
      <p>In August, the Manufacturing PMI® registered 47.2 percent in August.</p>
      <p>The Manufacturing PMI® registered 47.9 percent in September.</p>`;
    expect(parseIsmPmi(html)).toEqual({ value: 47.9, month: "2024-09" });
  });

  it("ignores services / non-manufacturing PMI", () => {
    expect(parseIsmPmi("<h1>Services PMI® at 54.9%; September 2024 Services ISM® Report On Business®</h1>")).toBeNull();
    expect(parseIsmPmi("<h2>September 2024 Manufacturing ISM® Report On Business®</h2><p>The Non-Manufacturing PMI® registered 54.9 percent in September.</p>")).toBeNull();
  });

  it("rejects values outside 20–80 instead of guessing", () => {
    expect(parseIsmPmi("<h1>Manufacturing PMI® at 95.0%; September 2024 Manufacturing ISM® Report On Business®</h1>")).toBeNull();
    expect(parseIsmPmi("<h2>September 2024 Manufacturing ISM® Report On Business®</h2><p>The Manufacturing PMI® registered 12.5 percent in September.</p>")).toBeNull();
    expect(ISM_PARAMS.minValue).toBe(20);
    expect(ISM_PARAMS.maxValue).toBe(80);
  });

  it("returns null when the value or month cannot be pinned down", () => {
    // 달을 알 수 없음
    expect(parseIsmPmi("<p>The Manufacturing PMI® registered 48.7 percent.</p>")).toBeNull();
    // 달은 있지만 연도를 알 수 없음
    expect(parseIsmPmi("<p>The Manufacturing PMI® registered 48.7 percent in September.</p>")).toBeNull();
    // 변화폭(0.5)만 있고 수준값이 없는 문장
    expect(parseIsmPmi("<h2>September 2024 Manufacturing ISM® Report On Business®</h2><p>The Manufacturing PMI® fell 0.5 percentage point.</p>")).toBeNull();
    // 표 형태(퍼센트 표시 없음)는 읽지 않는다
    expect(parseIsmPmi("<h2>September 2024 Manufacturing ISM® Report On Business®</h2><table><tr><td>Manufacturing PMI®</td><td>47.2</td><td>47.2</td></tr></table>")).toBeNull();
  });

  it("returns null for garbage", () => {
    expect(parseIsmPmi("")).toBeNull();
    expect(parseIsmPmi("<html><body>Access denied</body></html>")).toBeNull();
    expect(parseIsmPmi("<html><title>Just a moment...</title><body>Checking your browser</body></html>")).toBeNull();
    expect(parseIsmPmi("Manufacturing PMI")).toBeNull();
    expect(parseIsmPmi('{"error":"not found"}')).toBeNull();
  });
});

describe("ISM release calendar", () => {
  it("estimates the release as the first US business day of the next month", () => {
    expect(ismReleaseDate("2024-09")).toBe("2024-10-01"); // 화요일
    expect(ismReleaseDate("2024-02")).toBe("2024-03-01"); // 금요일
    expect(ismReleaseDate("2024-05")).toBe("2024-06-03"); // 6/1 토요일 → 월요일
    expect(ismReleaseDate("2025-02")).toBe("2025-03-03"); // 3/1 토요일 → 월요일
  });

  it("skips Labor Day and uses the second business day in January", () => {
    expect(ismReleaseDate("2024-08")).toBe("2024-09-03"); // 9/2 노동절
    expect(ismReleaseDate("2025-08")).toBe("2025-09-02"); // 9/1 노동절
    expect(ismReleaseDate("2024-12")).toBe("2025-01-03"); // 1/1 휴일, 1/2 첫 영업일 → 둘째 영업일
    expect(ismReleaseDate("2023-12")).toBe("2024-01-03");
    expect(ismReleaseDate("2022-12")).toBe("2023-01-04"); // 1/1 일요일 → 1/2 대체 휴일
  });

  it("rejects malformed months", () => {
    expect(ismReleaseDate("2024-13")).toBeNull();
    expect(ismReleaseDate("2024-9")).toBeNull();
    expect(ismReleaseDate("abc")).toBeNull();
  });

  it("finds the latest released month for a given day", () => {
    expect(latestReleasedIsmMonth("2024-10-01")).toBe("2024-09");
    expect(latestReleasedIsmMonth("2024-09-30")).toBe("2024-08");
    expect(latestReleasedIsmMonth("2024-09-02")).toBe("2024-07"); // 노동절이라 8월분은 9/3
    expect(latestReleasedIsmMonth("2024-09-03")).toBe("2024-08");
    expect(latestReleasedIsmMonth("2025-01-02")).toBe("2024-11");
    expect(latestReleasedIsmMonth("2025-01-03")).toBe("2024-12");
  });

  it("shifts months across year boundaries", () => {
    expect(shiftMonth("2024-01", -1)).toBe("2023-12");
    expect(shiftMonth("2024-12", 1)).toBe("2025-01");
    expect(shiftMonth("2024-03", -15)).toBe("2022-12");
  });

  it("builds month page URLs", () => {
    expect(ismMonthUrl("2024-09")).toBe(`${ISM_URL}september/`);
    expect(ismMonthUrl("2025-01")).toBe(`${ISM_URL}january/`);
    expect(ismMonthUrl("2025-1")).toBeNull();
  });
});

describe("manualIsm", () => {
  it("dates a manual value at the estimated release date", () => {
    expect(manualIsm({ value: 47.2, month: "2024-09" }, "2024-10-10")).toEqual({ reading: { value: 47.2, month: "2024-09", date: "2024-10-01", source: "수동" } });
  });
  it("uses today when the estimated release is later than today (the user already knows it)", () => {
    expect(manualIsm({ value: 49.3, month: "2024-12" }, "2025-01-02")).toEqual({ reading: { value: 49.3, month: "2024-12", date: "2025-01-02", source: "수동" } });
  });
  it("rejects malformed, out-of-range and unfinished months", () => {
    expect(manualIsm({ value: 47.2, month: "2024-9" }, "2024-10-10")).toHaveProperty("error");
    expect(manualIsm({ value: 47.2, month: "" }, "2024-10-10")).toHaveProperty("error");
    expect(manualIsm({ value: 85, month: "2024-09" }, "2024-10-10")).toHaveProperty("error");
    expect(manualIsm({ value: Number.NaN, month: "2024-09" }, "2024-10-10")).toHaveProperty("error");
    expect(manualIsm({ value: 50, month: "2024-10" }, "2024-10-10")).toHaveProperty("error"); // 이번 달은 아직 안 끝남
    expect(manualIsm({ value: 50, month: "2024-11" }, "2024-10-10")).toHaveProperty("error");
  });
});

/** URL → 본문(또는 상태 코드·예외). 없으면 404 */
function fakeHttp(routes: Record<string, string | number | Error>): Http & { calls: string[] } {
  const calls: string[] = [];
  const getResponse = async (url: string) => {
    calls.push(url);
    const r = routes[url];
    if (r instanceof Error) throw r;
    if (r == null) return { status: 404, headers: new Headers(), text: "" };
    if (typeof r === "number") return { status: r, headers: new Headers(), text: "<html>error</html>" };
    return { status: 200, headers: new Headers(), text: r };
  };
  return {
    calls,
    getResponse,
    async get(url) {
      const r = await getResponse(url);
      if (r.status < 200 || r.status >= 300) throw new HttpError(r.status, url);
      return r.text;
    },
  };
}

const page = (value: number, monthName: string, year: number) =>
  `<h1>Manufacturing PMI® at ${value}%; ${monthName} ${year} Manufacturing ISM® Report On Business®</h1>`;
const at = (iso: string) => Date.parse(iso);

describe("IsmSource", () => {
  it("reads the latest report page, dates it and caches it", async () => {
    let now = at("2024-10-10T00:00:00Z");
    const http = fakeHttp({ [ISM_URL]: page(47.2, "September", 2024) });
    const src = new IsmSource(http, { ttlMs: 1000, now: () => now });
    const [a, b] = await Promise.all([src.getLatest(), src.getLatest()]); // 동시 요청은 한 번만
    expect(a).toEqual({ value: 47.2, month: "2024-09", date: "2024-10-01", source: "ISM" });
    expect(b).toEqual(a);
    expect(src.lastError).toBeNull();
    expect(http.calls).toEqual([ISM_URL]);
    now += 999;
    await src.getLatest();
    expect(http.calls).toHaveLength(1);
    now += 1;
    await src.getLatest();
    expect(http.calls).toHaveLength(2);
  });

  it("falls back to the month page when the latest page fails", async () => {
    const http = fakeHttp({ [ISM_URL]: 503, [`${ISM_URL}september/`]: TITLE_AND_SENTENCE });
    const src = new IsmSource(http, { now: () => at("2024-10-10T00:00:00Z") });
    expect(await src.getLatest()).toEqual({ value: 48.7, month: "2024-09", date: "2024-10-01", source: "ISM" });
    expect(http.calls).toEqual([ISM_URL, `${ISM_URL}september/`]);
    expect(src.lastError).toBeNull();
  });

  it("checks the month page when the latest page still shows an older month", async () => {
    const http = fakeHttp({ [ISM_URL]: page(47.2, "August", 2024), [`${ISM_URL}september/`]: page(47.9, "September", 2024) });
    const src = new IsmSource(http, { now: () => at("2024-10-02T00:00:00Z") });
    expect(await src.getLatest()).toMatchObject({ value: 47.9, month: "2024-09" });

    // 달별 페이지가 아직 작년 보고서면 쓰지 않고 최신 페이지의 (이전 달) 값을 쓴다
    const stale = fakeHttp({ [ISM_URL]: page(47.2, "August", 2024), [`${ISM_URL}september/`]: page(49.0, "September", 2023) });
    const s2 = new IsmSource(stale, { now: () => at("2024-10-02T00:00:00Z") });
    expect(await s2.getLatest()).toMatchObject({ value: 47.2, month: "2024-08", date: "2024-09-03" });
    expect(s2.lastError).toBeNull();
  });

  it("never throws: failures go to lastError, retried after failTtlMs", async () => {
    let now = at("2024-10-10T00:00:00Z");
    const http = fakeHttp({ [ISM_URL]: new Error("접속 실패(www.ismworld.org): ENOTFOUND") });
    const src = new IsmSource(http, { now: () => now, failTtlMs: 100, ttlMs: 10_000 });
    expect(await src.getLatest()).toBeNull();
    expect(src.lastError).toContain("ENOTFOUND");
    expect(src.lastError).toContain("2024-09 보고서: HTTP 404");
    expect(http.calls).toHaveLength(2);
    now += 50;
    await src.getLatest();
    expect(http.calls).toHaveLength(2);
    now += 50;
    await src.getLatest();
    expect(http.calls).toHaveLength(4);
  });

  it("reports unrecognized pages and pages for an unfinished month", async () => {
    const garbage = new IsmSource(fakeHttp({ [ISM_URL]: "<html>Just a moment...</html>" }), { now: () => at("2024-10-10T00:00:00Z") });
    expect(await garbage.getLatest()).toBeNull();
    expect(garbage.lastError).toContain("PMI 값을 찾지 못했어요");

    const future = new IsmSource(fakeHttp({ [ISM_URL]: page(50.1, "October", 2024) }), { now: () => at("2024-10-10T00:00:00Z") });
    expect(await future.getLatest()).toBeNull();
    expect(future.lastError).toContain("아직 끝나지 않은 달(2024-10)");
  });

  it("serves the last good value during an outage and keeps the newest one", async () => {
    let now = at("2024-10-10T00:00:00Z");
    const routes: Record<string, string | number | Error> = { [ISM_URL]: page(47.2, "September", 2024) };
    const src = new IsmSource(fakeHttp(routes), { now: () => now, ttlMs: 1000, failTtlMs: 1000 });
    expect((await src.getLatest())?.value).toBe(47.2);
    routes[ISM_URL] = 500;
    now += 1000;
    expect(await src.getLatest()).toMatchObject({ value: 47.2, month: "2024-09" });
    expect(src.lastError).toContain("HTTP 500");
    // 사이트가 잠깐 이전 달을 보여 줘도 이미 아는 더 새 값을 돌려준다
    routes[ISM_URL] = page(47.0, "August", 2024);
    now += 1000;
    expect(await src.getLatest()).toMatchObject({ value: 47.2, month: "2024-09" });
    expect(src.lastError).toBeNull();
  });

  it("estimated release later than today is clamped to today", async () => {
    // 1/2에 12월분이 이미 나왔다면(추정 발표일 1/3보다 이르면) 오늘 날짜로 둔다
    const src = new IsmSource(fakeHttp({ [ISM_URL]: page(49.3, "December", 2024) }), { now: () => at("2025-01-02T20:00:00Z") });
    expect(await src.getLatest()).toEqual({ value: 49.3, month: "2024-12", date: "2025-01-02", source: "ISM" });
  });
});

describe("sample mode (PROVIDER=mock)", () => {
  it("MockIsmSource is deterministic, labeled sample and only returns released months", async () => {
    const now = () => at("2024-10-10T00:00:00Z");
    const a = await new MockIsmSource(now).getLatest();
    const b = await new MockIsmSource(now).getLatest();
    expect(new MockIsmSource(now).sample).toBe(true);
    expect(a).toEqual(b);
    expect(a.month).toBe("2024-09");
    expect(a.date).toBe("2024-10-01");
    expect(a.value).toBe(sampleIsmValue("2024-09"));
    expect((await new MockIsmSource(() => at("2024-09-30T00:00:00Z")).getLatest()).month).toBe("2024-08");
    for (const m of ["2020-01", "2023-06", "2024-12", "2026-03"]) {
      const v = sampleIsmValue(m);
      expect(v).toBeGreaterThanOrEqual(44);
      expect(v).toBeLessThanOrEqual(56);
      expect(sampleIsmValue(m)).toBe(v);
    }
  });

  it("sample regional Fed series respect the release lag and feed buildMacroSnapshot", () => {
    const now = at("2024-10-10T00:00:00Z");
    const s = sampleIsmProxySeries(now);
    expect(sampleIsmProxySeries(now)).toEqual(s);
    const philly = s.GACDFSA066MSFRBPHI!, empire = s.GACDINA066MSFRBNY!;
    expect(philly.length).toBeGreaterThan(20);
    // 10/10 기준: 필라델피아(지연 21일) 10월분은 아직, 9월분까지. 엠파이어(지연 20일)도 같다
    expect(philly.at(-1)?.date).toBe("2024-09-01");
    expect(empire.at(-1)?.date).toBe("2024-09-01");
    for (const id of ["GACDFSA066MSFRBPHI", "GACDINA066MSFRBNY"] as const)
      for (const p of s[id]!) {
        expect(Number.isFinite(p.value)).toBe(true);
        expect(Date.parse(p.date) + MACRO_RELEASE_LAG_DAYS[id] * 86_400_000).toBeLessThanOrEqual(now);
      }
    const snap = buildMacroSnapshot(s);
    expect(snap.ismProxy?.philly?.date).toBe("2024-09-01");
    expect(snap.ismProxy?.empire?.date).toBe("2024-09-01");
  });
});
