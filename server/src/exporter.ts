import type { ExportStatus } from "@jusik/shared";
import { writeExcel } from "./excel";
import { syncSheets, type SheetsConfig } from "./sheets";
import type { Table } from "./tables";

/**
 * 1차: 로컬 엑셀 파일, 2차: 구글 스프레드시트(설정된 경우).
 * 변경이 잦아도 부담이 없도록 요청을 모아(debounce) 한 번에 쓰고, 엑셀이 실패해도 시트 동기화는 계속 시도한다.
 */
export class Exporter {
  status: ExportStatus;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private again = false;

  constructor(
    private opts: { excelPath: string; sheets: SheetsConfig | null; build: () => Table[]; debounceMs?: number },
  ) {
    this.status = {
      excel: { path: opts.excelPath, at: null, ok: null, error: null },
      sheets: { configured: opts.sheets != null, at: null, ok: null, error: null, rows: null },
    };
  }

  /** 변경이 생겼음을 알린다(곧 내보낸다) */
  request() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.opts.debounceMs ?? 3000);
  }

  /** 지금 바로 내보낸다. 이미 진행 중이면 끝난 뒤 한 번 더 실행한다. */
  flush(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.run().finally(() => {
      this.running = null;
      if (this.again) {
        this.again = false;
        void this.flush();
      }
    });
    return this.running;
  }

  private async run() {
    const tables = this.opts.build();
    const now = () => new Date().toISOString();
    try {
      await writeExcel(tables, this.opts.excelPath);
      this.status.excel = { ...this.status.excel, at: now(), ok: true, error: null };
    } catch (e) {
      this.status.excel = { ...this.status.excel, at: now(), ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    if (this.opts.sheets) {
      try {
        const r = await syncSheets(tables, this.opts.sheets);
        this.status.sheets = { configured: true, at: now(), ok: true, error: null, rows: r.rows };
      } catch (e) {
        this.status.sheets = { configured: true, at: now(), ok: false, error: e instanceof Error ? e.message : String(e), rows: null };
      }
    }
  }
}
