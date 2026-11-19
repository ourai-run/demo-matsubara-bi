// 取込を試すためのサンプルファイル（各部署から届く想定の形）。見出しの書き方・単位・形式をわざとばらつかせてある。
import { type Kind, type Row, ymLabel } from "./model.ts";
import { generateMonth } from "./sample.ts";

export interface SampleFile { kind: Kind; name: string; note: string; table: (string | number)[][] }

export function sampleFiles(ym: string): SampleFile[] {
  const d = generateMonth(ym, "actual"), label = ymLabel(ym), slash = ym.replace("-", "/");
  const rows = (list: Row[], f: (r: Row) => (string | number)[]) => list.map(f);
  return [
    { kind: "sales", name: `売上実績_${label}.xlsx`, note: "Excel。上に表題の行、年月の列あり",
      table: [[`売上実績表　${label}度`], [], ["年月", "得意先名", "分野", "品目群", "区分", "数量", "重量(kg)", "売上金額"],
        ...rows(d.sales, (r) => [slash, r.customer, r.segment, r.product, r.process, r.qty, r.weightKg, r.amount])] },
    { kind: "production", name: `生産実績_${label}.csv`, note: "CSV。年月はファイル名から読み取り",
      table: [["造型ライン", "稼働日数", "稼働時間", "注湯重量", "良品重量", "不良重量"], ...rows(d.production, (r) => [r.line, r.days, r.hours, r.meltKg, r.goodKg, r.defectKg])] },
    { kind: "material", name: `材料使用実績_${label}.xlsx`, note: "Excel。使用量はトン、金額は千円（自動で換算）",
      table: [["材料名", "材料区分", "使用量(t)", "材料費(千円)"], ...rows(d.material, (r) => [r.item, r.category, Number(r.qtyKg) / 1000, Number(r.amount) / 1000])] },
    { kind: "expense", name: `経費実績_${label}.csv`, note: "CSV。合計の行つき（取込時に除外）",
      table: [["部門", "勘定科目", "固変区分", "金額"], ...rows(d.expense, (r) => [r.dept, r.account, r.cls, r.amount]), ["合計", "", "", d.expense.reduce((s, r) => s + Number(r.amount), 0)]] },
    { kind: "labor", name: `人件費勤怠_${label}.xlsx`, note: "Excel。見出しが「部署・人数・時間外」",
      table: [["部署", "人数", "時間外", "人件費"], ...rows(d.labor, (r) => [r.dept, r.headcount, r.overtimeH, r.amount])] },
  ];
}

const csvCell = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
export const toCsv = (table: (string | number)[][]) => "﻿" + table.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

export function saveBlob(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type })), a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function downloadSample(f: SampleFile) {
  if (f.name.endsWith(".csv")) return saveBlob(f.name, toCsv(f.table), "text/csv;charset=utf-8");
  const XLSX = await import("xlsx"), wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(f.table), "Sheet1");
  XLSX.writeFile(wb, f.name);
}
