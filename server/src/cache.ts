/** 간단한 TTL 메모리 캐시. 같은 요청을 동시에 여러 번 보내지 않도록 진행 중인 Promise도 공유한다. */
export class TtlCache {
  private store = new Map<string, { at: number; value: Promise<unknown> }>();

  constructor(private ttlMs: number) {}

  get<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.store.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.value as Promise<T>;
    const value = load();
    this.store.set(key, { at: Date.now(), value });
    // 실패한 결과는 캐시하지 않는다
    value.catch(() => {
      if (this.store.get(key)?.value === value) this.store.delete(key);
    });
    return value;
  }
}
