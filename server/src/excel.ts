import { mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import ExcelJS from "exceljs";
import type { Table } from "./tables";

/** 표 목록을 xlsx 파일로 쓴다. 임시 파일에 쓴 뒤 교체해서, 쓰는 도중 실패해도 기존 파일이 깨지지 않는다. */
export async function writeExcel(tables: Table[], file: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "jusik";
  wb.created = new Date();
  for (const t of tables) {
    const ws = wb.addWorksheet(t.name, { views: [{ state: "frozen", ySplit: 1 }] });
    ws.addRow(t.headers);
    t.rows.forEach((r) => ws.addRow(r));
    const head = ws.getRow(1);
    head.font = { bold: true };
    head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
    t.headers.forEach((h, i) => {
      const col = ws.getColumn(i + 1);
      let w = Math.min(60, Math.max(8, h.length * 2));
      for (const r of t.rows.slice(0, 200)) {
        const v = r[i];
        w = Math.max(w, Math.min(60, String(v ?? "").length + 2));
      }
      col.width = w;
      col.eachCell({ includeEmpty: false }, (cell, rowNumber) => {
        if (rowNumber > 1 && typeof cell.value === "number") cell.numFmt = Number.isInteger(cell.value) ? "#,##0" : "#,##0.00";
      });
    });
    if (t.rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: t.headers.length } };
  }
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await wb.xlsx.writeFile(tmp);
  try {
    renameSync(tmp, file);
  } catch (e) {
    rmSync(tmp, { force: true });
    // 엑셀에서 파일을 열어 두면 Windows에서 교체가 실패한다
    throw new Error(`엑셀 파일을 저장하지 못했어요. 파일이 열려 있다면 닫아 주세요: ${e instanceof Error ? e.message : e}`);
  }
}
