import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Candle, Fundamentals, Market, Quote, StockInfo } from "@jusik/shared";
import type { MarketDataProvider } from "./provider";
import { findStock, searchStocks } from "./stocks";

/**
 * 한국투자증권 Open API (https://apiportal.koreainvestment.com) 시세 조회 제공자.
 * 조회 전용이며 주문 API는 호출하지 않는다.
 */
export interface KisConfig {
  appKey: string;
  appSecret: string;
  baseUrl: string;
  minIntervalMs: number;
  tokenFile?: string;
}

interface TokenCache {
  baseUrl: string;
  appKey: string;
  token: string;
  /** epoch ms */
  expiresAt: number;
}

const num = (v: unknown): number | undefined => {
  if (v == null || v === "") return undefined;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
};

const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
const dash = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

export class KisProvider implements MarketDataProvider {
  readonly name = "kis";
  readonly sample = false;
  private token: TokenCache | null = null;
  private tokenPromise: Promise<string> | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private lastCall = 0;

  constructor(private cfg: KisConfig) {
    const f = cfg.tokenFile;
    if (f && existsSync(f)) {
      try {
        const t = JSON.parse(readFileSync(f, "utf8")) as TokenCache;
        if (t.baseUrl === cfg.baseUrl && t.appKey === cfg.appKey) this.token = t;
      } catch {
        /* 무시하고 새로 발급 */
      }
    }
  }

  async search(q: string) {
    return searchStocks(q);
  }

  async getInfo(code: string): Promise<StockInfo | undefined> {
    return findStock(code);
  }

  async getQuote(code: string): Promise<Quote> {
    const o = await this.get("/uapi/domestic-stock/v1/quotations/inquire-price", "FHKST01010100", {
      FID_COND_MRKT_DIV_CODE: "J",
      FID_INPUT_ISCD: code,
    });
    const out = o.output as Record<string, string>;
    const falling = out.prdy_vrss_sign === "4" || out.prdy_vrss_sign === "5";
    const sign = falling ? -1 : 1;
    return {
      code,
      price: num(out.stck_prpr) ?? 0,
      change: sign * Math.abs(num(out.prdy_vrss) ?? 0),
      changePct: sign * Math.abs(num(out.prdy_ctrt) ?? 0),
      volume: num(out.acml_vol),
      marketCap: num(out.hts_avls),
    };
  }

  async getCandles(code: string, count: number): Promise<Candle[]> {
    return this.pagedDaily(
      "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice",
      "FHKST03010100",
      { FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: code, FID_PERIOD_DIV_CODE: "D", FID_ORG_ADJ_PRC: "0" /* 수정주가 반영 */ },
      (r) => ({ close: r.stck_clpr, open: r.stck_oprc, high: r.stck_hgpr, low: r.stck_lwpr, volume: r.acml_vol }),
      count,
    );
  }

  /** 업종(지수) 일봉. 0001=코스피, 1001=코스닥 */
  async getIndexCandles(market: Market, count: number): Promise<Candle[]> {
    return this.pagedDaily(
      "/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice",
      "FHKUP03500100",
      { FID_COND_MRKT_DIV_CODE: "U", FID_INPUT_ISCD: market === "KOSPI" ? "0001" : "1001", FID_PERIOD_DIV_CODE: "D" },
      (r) => ({ close: r.bstp_nmix_prpr, open: r.bstp_nmix_oprc, high: r.bstp_nmix_hgpr, low: r.bstp_nmix_lwpr, volume: r.acml_vol }),
      count,
    );
  }

  /** 1회 호출당 최대 100봉이라 구간을 나눠 과거로 거슬러 올라가며 일봉을 모은다 */
  private async pagedDaily(
    path: string,
    trId: string,
    params: Record<string, string>,
    pick: (row: Record<string, string>) => Record<"close" | "open" | "high" | "low" | "volume", string | undefined>,
    count: number,
  ): Promise<Candle[]> {
    const byDate = new Map<string, Candle>();
    let end = new Date();
    for (let guard = 0; guard < 20 && byDate.size < count; guard++) {
      const start = new Date(end);
      start.setUTCDate(start.getUTCDate() - 140);
      const o = await this.get(path, trId, { ...params, FID_INPUT_DATE_1: ymd(start), FID_INPUT_DATE_2: ymd(end) });
      const rows = ((o.output2 as Record<string, string>[] | undefined) ?? []).filter((r) => r.stck_bsop_date);
      if (rows.length === 0) break;
      let oldest = rows[0]!.stck_bsop_date!;
      for (const r of rows) {
        const v = pick(r);
        const close = num(v.close);
        if (close == null) continue;
        byDate.set(r.stck_bsop_date!, {
          date: dash(r.stck_bsop_date!),
          open: num(v.open) ?? close,
          high: num(v.high) ?? close,
          low: num(v.low) ?? close,
          close,
          volume: num(v.volume) ?? 0,
        });
        if (r.stck_bsop_date! < oldest) oldest = r.stck_bsop_date!;
      }
      end = new Date(Date.UTC(+oldest.slice(0, 4), +oldest.slice(4, 6) - 1, +oldest.slice(6, 8) - 1));
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-count);
  }

  async getFundamentals(code: string): Promise<Fundamentals> {
    const f: Fundamentals = {};
    const q = await this.get("/uapi/domestic-stock/v1/quotations/inquire-price", "FHKST01010100", {
      FID_COND_MRKT_DIV_CODE: "J",
      FID_INPUT_ISCD: code,
    });
    const out = q.output as Record<string, string>;
    f.per = num(out.per);
    f.pbr = num(out.pbr);
    f.eps = num(out.eps);
    f.bps = num(out.bps);
    if (f.eps != null && f.bps) f.roe = Math.round((f.eps / f.bps) * 1000) / 10;

    // 재무비율(연간). 일부 종목/계정에서 비어 있을 수 있어 실패해도 위 값은 돌려준다
    try {
      const r = await this.get("/uapi/domestic-stock/v1/finance/financial-ratio", "FHKST66430300", {
        FID_DIV_CLS_CODE: "0",
        fid_cond_mrkt_div_code: "J",
        fid_input_iscd: code,
      });
      const rows = (r.output as Record<string, string>[] | undefined) ?? [];
      const latest = [...rows].sort((a, b) => (b.stac_yymm ?? "").localeCompare(a.stac_yymm ?? ""))[0];
      if (latest) {
        f.revenueGrowth = num(latest.grs);
        f.opIncomeGrowth = num(latest.bsop_prfi_inrt);
        f.debtRatio = num(latest.lblt_rate);
        f.reserveRatio = num(latest.rsrv_rate);
        const roe = num(latest.roe_val);
        if (roe != null) f.roe = roe;
      }
    } catch {
      /* best effort */
    }
    // 안정성 비율(유동비율). 응답 필드가 계정마다 비어 있을 수 있어 best effort
    try {
      const r = await this.get("/uapi/domestic-stock/v1/finance/stability-ratio", "FHKST66430600", {
        FID_DIV_CLS_CODE: "0",
        fid_cond_mrkt_div_code: "J",
        fid_input_iscd: code,
      });
      const rows = (r.output as Record<string, string>[] | undefined) ?? [];
      const latest = [...rows].sort((a, b) => (b.stac_yymm ?? "").localeCompare(a.stac_yymm ?? ""))[0];
      if (latest) {
        f.currentRatio = num(latest.crnt_rate);
        f.debtRatio ??= num(latest.lblt_rate);
      }
    } catch {
      /* best effort */
    }
    return f;
  }

  // ---- 내부 ----

  private async accessToken(force = false): Promise<string> {
    if (!force && this.token && this.token.expiresAt - Date.now() > 5 * 60_000) return this.token.token;
    // 동시 호출이 토큰을 여러 번 발급하지 않도록(발급은 분당 1회 제한) 공유한다
    this.tokenPromise ??= this.issueToken().finally(() => (this.tokenPromise = null));
    return this.tokenPromise;
  }

  private async issueToken(): Promise<string> {
    const res = await fetch(`${this.cfg.baseUrl}/oauth2/tokenP`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant_type: "client_credentials", appkey: this.cfg.appKey, appsecret: this.cfg.appSecret }),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
    if (!res.ok || !body.access_token) {
      throw new Error(`KIS 토큰 발급 실패 (${res.status}): ${body.error_description ?? "알 수 없는 오류"}`);
    }
    this.token = {
      baseUrl: this.cfg.baseUrl,
      appKey: this.cfg.appKey,
      token: body.access_token,
      expiresAt: Date.now() + (body.expires_in ?? 86_400) * 1000,
    };
    if (this.cfg.tokenFile) {
      try {
        writeFileSync(this.cfg.tokenFile, JSON.stringify(this.token), { mode: 0o600 });
      } catch {
        /* 캐시 저장 실패는 치명적이지 않다 */
      }
    }
    return body.access_token;
  }

  /** 호출 간격을 지키며 직렬로 실행한다 */
  private throttled<T>(fn: () => Promise<T>): Promise<T> {
    const run = async () => {
      const wait = this.lastCall + this.cfg.minIntervalMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      try {
        return await fn();
      } finally {
        this.lastCall = Date.now();
      }
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => undefined);
    return p;
  }

  private async get(path: string, trId: string, params: Record<string, string>, retried = false): Promise<Record<string, unknown>> {
    const token = await this.accessToken(retried);
    const url = `${this.cfg.baseUrl}${path}?${new URLSearchParams(params)}`;
    const res = await this.throttled(() =>
      fetch(url, {
        headers: {
          "content-type": "application/json; charset=utf-8",
          authorization: `Bearer ${token}`,
          appkey: this.cfg.appKey,
          appsecret: this.cfg.appSecret,
          tr_id: trId,
          custtype: "P",
        },
      }),
    );
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const msgCd = String(body.msg_cd ?? "");
    // 토큰 만료(EGW00123) 또는 유효하지 않은 토큰(EGW00121)이면 한 번만 재발급 후 재시도
    if (!retried && (msgCd === "EGW00123" || msgCd === "EGW00121")) return this.get(path, trId, params, true);
    if (!res.ok || (body.rt_cd !== undefined && body.rt_cd !== "0")) {
      throw new Error(`KIS 요청 실패 [${trId}] ${msgCd} ${String(body.msg1 ?? res.status)}`);
    }
    return body;
  }
}
