function decode(buf: ArrayBuffer, enc: "utf-8" | "euc-kr" | "auto"): string {
  if (enc !== "auto") return new TextDecoder(enc).decode(buf);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("euc-kr").decode(buf);
  }
}

export class HttpError extends Error {
  constructor(public status: number, public url: string, message?: string) {
    super(message ?? `HTTP ${status} — ${url}`);
  }
}

export interface HttpOptions {
  /** 요청 사이 최소 간격(ms). 사이트 부담을 줄이기 위해 직렬로 보낸다 */
  minIntervalMs?: number;
  userAgent?: string;
  timeoutMs?: number;
  /** 429/5xx 재시도 횟수 */
  retries?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export interface GetOptions {
  /** auto: UTF-8로 먼저 해석하고 깨지면 EUC-KR(네이버 금융 일부 페이지) */
  encoding?: "utf-8" | "euc-kr" | "auto";
  headers?: Record<string, string>;
}

export interface Http {
  get(url: string, opt?: GetOptions): Promise<string>;
  /** 응답 헤더까지 필요할 때(쿠키 등) */
  getResponse(url: string, opt?: GetOptions): Promise<{ status: number; headers: Headers; text: string }>;
}

/** 직렬 큐 + 최소 간격 + 429/5xx 지수 백오프를 가진 아주 단순한 HTTP 클라이언트 */
export function createHttp(o: HttpOptions = {}): Http {
  const minInterval = o.minIntervalMs ?? 500;
  const retries = o.retries ?? 2;
  const doFetch = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const ua = o.userAgent ?? "jusik-personal-tool/0.1 (personal, low-rate)";
  let chain: Promise<unknown> = Promise.resolve();
  let last = 0;

  const once = async (url: string, opt: GetOptions) => {
    const wait = last + minInterval - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? 15_000);
    try {
      let res: Response;
      try {
        res = await doFetch(url, { headers: { "user-agent": ua, accept: "*/*", ...opt.headers }, signal: ctl.signal });
      } catch (e) {
        const cause = (e as { cause?: { code?: string; message?: string } }).cause;
        const why = ctl.signal.aborted ? "시간 초과" : (cause?.code ?? cause?.message ?? (e instanceof Error ? e.message : String(e)));
        throw new Error(`접속 실패(${new URL(url).host}): ${why} — 네트워크가 막혀 있거나 사이트가 응답하지 않아요`);
      }
      const buf = await res.arrayBuffer();
      const text = decode(buf, opt.encoding ?? "utf-8");
      return { status: res.status, headers: res.headers, text };
    } finally {
      clearTimeout(timer);
    }
  };

  const run = async (url: string, opt: GetOptions) => {
    for (let attempt = 0; ; attempt++) {
      const r = await once(url, opt);
      const retryable = r.status === 429 || r.status >= 500;
      if (!retryable || attempt >= retries) return r;
      await sleep(1000 * 2 ** attempt);
    }
  };

  const getResponse = (url: string, opt: GetOptions = {}) => {
    const p = chain.then(() => run(url, opt));
    chain = p.catch(() => undefined);
    return p;
  };

  return {
    getResponse,
    async get(url, opt) {
      const r = await getResponse(url, opt);
      if (r.status < 200 || r.status >= 300) throw new HttpError(r.status, url);
      return r.text;
    },
  };
}
