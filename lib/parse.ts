// 部署から届いた表（Excel / CSV）を読み、種類・年月・予実を見分けて行データにする。
// 表の読み取り（interpret）は Node でも動く。ファイルを開く部分（readTables）だけブラウザ用。
import { type Kind, type Row, type Scenario, KINDS, KIND_ORDER } from "./model.ts";

export type Cell = string | number | Date | null | undefined;
export interface Mapping { kind: Kind; columns: Record<string, string>; ymColumn?: string; scenarioColumn?: string }
export interface Part {
  fileName: string; sheet: string; kind: Kind | null; scenario: Scenario; months: Record<string, Row[]>;
  warnings: string[]; error: string; headers: string[]; sample: string[][]; mappedBy: "見出し" | "AI";
  columns: Record<string, string>; // 項目 → 実際に使った列の見出し
}

const norm = (v: unknown) => String(v ?? "").normalize("NFKC").replace(/[\s　]/g, "").replace(/[（(［\[].*?[）)\]］]/g, "").toLowerCase();
const YM_HEADS = ["年月", "対象月", "対象年月", "月度", "年月度", "計上月", "月"].map(norm);
const SC_HEADS = ["予実区分", "予実", "予算実績区分", "予算実績"].map(norm);

/** 年月を YYYY-MM に。Excelの日付・「2026年11月」「2026/11」「202611」「令和8年11月」「R8.11」に対応。 */
export function parseYm(v: Cell): string {
  const out = (y: number, m: number) => (y >= 2000 && y <= 2100 && m >= 1 && m <= 12 ? `${y}-${String(m).padStart(2, "0")}` : "");
  if (v instanceof Date) return out(v.getFullYear(), v.getMonth() + 1);
  if (typeof v === "number" && v > 30000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 86400000)); return out(d.getUTCFullYear(), d.getUTCMonth() + 1); }
  const s = String(v ?? "").normalize("NFKC");
  let m = s.match(/(20\d{2})\s*[\/\-年.]\s*(\d{1,2})/) ?? s.match(/(?<!\d)(20\d{2})(0[1-9]|1[0-2])(?!\d)/);
  if (m) return out(Number(m[1]), Number(m[2]));
  m = s.match(/(?:令和|R)\s*(\d{1,2})\s*[年.\/]\s*(\d{1,2})/i);
  return m ? out(2018 + Number(m[1]), Number(m[2])) : "";
}
export function parseNum(v: Cell): number {
  if (typeof v === "number") return v;
  const s = String(v ?? "").normalize("NFKC").replace(/[,\s¥円]/g, "").replace(/^[▲△]/, "-").replace(/^\((.*)\)$/, "-$1");
  return s === "" || s === "-" ? 0 : Number(s);
}
/** 見出しに書かれた単位（「(千円)」「(t)」「出荷トン数」など）から、円・kg へ直す倍率を決める。 */
function unitFactor(header: string, unit?: string) {
  const h = String(header).normalize("NFKC"), u = h.match(/[(\[](.*?)[)\]]/)?.[1] ?? "";
  if (unit === "円") return /百万円/.test(h) ? 1e6 : /千円/.test(h) ? 1e3 : /万円/.test(h) ? 1e4 : 1;
  if (unit === "kg") return /^(t|ton)$/i.test(u) || /トン/.test(h) ? 1e3 : 1;
  return 1;
}

/** 見出しから種類と列の対応を決める。必須の項目がすべて見つかった種類のうち、いちばん多く一致したもの。 */
export function detect(headers: string[]): Mapping | null {
  const hs = headers.map(norm);
  let best: Mapping | null = null, bestScore = 0;
  for (const kind of KIND_ORDER) {
    const columns: Record<string, string> = {}, used = new Set<number>();
    for (const pass of [0, 1]) for (const f of KINDS[kind].fields) {
      if (columns[f.key]) continue;
      const names = pass === 0 ? [norm(f.label)] : f.aliases.map(norm);
      const i = hs.findIndex((h, n) => !used.has(n) && names.includes(h));
      if (i >= 0) { columns[f.key] = headers[i]; used.add(i); }
    }
    const complete = KINDS[kind].fields.every((f) => f.optional || columns[f.key]);
    const score = Object.keys(columns).length;
    if (complete && score > bestScore) { best = { kind, columns }; bestScore = score; }
  }
  return best;
}

/** 表の中から見出しの行を探す（上に表題や空行があってもよい）。 */
function findHeaderRow(table: Cell[][]) {
  const known = new Set([...YM_HEADS, ...SC_HEADS, ...KIND_ORDER.flatMap((k) => KINDS[k].fields.flatMap((f) => [norm(f.label), ...f.aliases.map(norm)]))]);
  let best = -1, bestHits = 1;
  table.slice(0, 20).forEach((row, i) => {
    const hits = row.filter((c) => known.has(norm(c))).length;
    if (hits > bestHits) { best = i; bestHits = hits; }
  });
  if (best >= 0) return best;
  return table.findIndex((row) => row.filter((c) => typeof c === "string" && c.trim()).length >= 3); // 知らない見出しばかりの表はAIに回す
}

/** 1枚の表を読み取る。mapping を渡すと見出しの自動判定の代わりにそれを使う（AIの判定結果）。fallbackYm は年月が表にもファイル名にも無いときの指定。 */
export function interpret(fileName: string, sheet: string, table: Cell[][], opts: { mapping?: Mapping; fallbackYm?: string } = {}): Part {
  const part: Part = { fileName, sheet, kind: null, scenario: "actual", months: {}, warnings: [], error: "", headers: [], sample: [], mappedBy: opts.mapping ? "AI" : "見出し", columns: {} };
  const hi = findHeaderRow(table);
  if (hi < 0) return { ...part, error: "見出しの行が見つかりません。" };
  const headers = table[hi].map((c) => String(c ?? "").trim());
  const body = table.slice(hi + 1).filter((r) => r.some((c) => c !== "" && c !== null && c !== undefined));
  part.headers = headers.filter(Boolean);
  part.sample = body.slice(0, 5).map((r) => headers.map((_, i) => (r[i] instanceof Date ? parseYm(r[i]) : String(r[i] ?? ""))));
  const map = opts.mapping ?? detect(headers);
  if (!map) return { ...part, error: "見出しから種類を判定できませんでした。" };
  part.kind = map.kind; part.columns = map.columns;
  const col = (name?: string) => (name ? headers.indexOf(name) : -1);
  const hs = headers.map(norm);
  const ymCol = map.ymColumn ? col(map.ymColumn) : hs.findIndex((h) => YM_HEADS.includes(h));
  const scCol = map.scenarioColumn ? col(map.scenarioColumn) : hs.findIndex((h) => SC_HEADS.includes(h));
  const fileYm = parseYm(fileName) || parseYm(sheet) || parseYm(table.slice(0, hi).flat().find((c) => parseYm(c)) ?? "") || opts.fallbackYm || "";
  const fileScenario: Scenario = /予算|計画/.test(fileName + sheet) ? "budget" : "actual";
  const fields = KINDS[map.kind].fields.filter((f) => map.columns[f.key]).map((f) => ({ ...f, i: col(map.columns[f.key]), k: unitFactor(map.columns[f.key], f.unit) }));
  const firstDim = fields.find((f) => f.type === "dim");
  const scenarios = new Set<Scenario>();
  let badNum = 0, noYm = 0;
  for (const r of body) {
    if (firstDim && /^(合計|総合計|総計|小計|計)$/.test(norm(r[firstDim.i]))) continue;
    const ym = ymCol >= 0 ? parseYm(r[ymCol]) : fileYm;
    if (!ym) { noYm++; continue; }
    const sc: Scenario = scCol >= 0 ? (/予算|計画/.test(String(r[scCol])) ? "budget" : "actual") : fileScenario;
    const row: Row = {};
    let ok = true;
    for (const f of fields) {
      if (f.type === "dim") { const s = String(r[f.i] ?? "").normalize("NFKC").trim(); if (s) row[f.key] = s; else if (!f.optional) ok = false; }
      else { const n = parseNum(r[f.i]) * f.k; if (Number.isFinite(n)) row[f.key] = n; else { badNum++; ok = false; } }
    }
    if (!ok) continue;
    scenarios.add(sc);
    (part.months[`${sc}|${ym}`] ??= []).push(row);
  }
  if (noYm && !Object.keys(part.months).length) return { ...part, error: "年月が分かりません。表に「年月」の列を入れるか、ファイル名に「2026年11月」のように年月を入れてください。" };
  if (!Object.keys(part.months).length) return { ...part, error: "取り込める行がありません。" };
  if (badNum) part.warnings.push(`数字として読めないセルが ${badNum} 件あり、その行は取り込みません。`);
  if (noYm) part.warnings.push(`年月が読めない行が ${noYm} 行あり、取り込みません。`);
  for (const f of fields) if (f.k !== 1) part.warnings.push(`「${map.columns[f.key]}」は${f.unit === "円" ? "円" : "kg"}に換算しました（×${f.k.toLocaleString()}）。`);
  if (scenarios.size > 1) part.warnings.push("予算と実績の両方が入っています。それぞれに分けて取り込みます。");
  part.scenario = scenarios.has("actual") ? "actual" : "budget";
  return part;
}
/** 全角・半角や空白だけが違う名称を、取込済みの表記にそろえる（例：「中子(シェル砂)」→「中子（シェル砂）」）。 */
export function alignNames(rows: Row[], key: string, known: string[]) {
  const k = (v: string) => v.normalize("NFKC").replace(/\s/g, "");
  const canon = new Map(known.map((n) => [k(n), n]));
  for (const r of rows) { const c = canon.get(k(String(r[key] ?? ""))); if (c) r[key] = c; }
}
/** Part の months（"actual|2026-11" 形式のキー）を、予実ごとに分ける。 */
export function splitByScenario(part: Part): { scenario: Scenario; months: Record<string, Row[]> }[] {
  const out: Record<string, Record<string, Row[]>> = {};
  for (const [k, rows] of Object.entries(part.months)) { const [sc, ym] = k.split("|"); (out[sc] ??= {})[ym] = rows; }
  return Object.entries(out).map(([scenario, months]) => ({ scenario: scenario as Scenario, months }));
}

/** CSVの文字列を表にする（引用符・改行入りのセルに対応）。 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  const src = text.replace(/^﻿/, ""), sep = (src.split("\n")[0].match(/\t/g)?.length ?? 0) > (src.split("\n")[0].match(/,/g)?.length ?? 0) ? "\t" : ",";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) { if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c; }
    else if (c === '"') quoted = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && src[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
/** CSVのバイト列を文字に。UTF-8として読めなければ Shift_JIS（Excelの既定）で読む。 */
export function decodeCsv(buf: ArrayBuffer): string {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); }
  catch { return new TextDecoder("shift_jis").decode(buf); }
}

/** ブラウザでファイルを開き、シートごとの表にする。 */
export async function readTables(file: File): Promise<{ sheet: string; table: Cell[][] }[]> {
  const buf = await file.arrayBuffer();
  if (/\.(csv|tsv|txt)$/i.test(file.name)) return [{ sheet: "", table: parseCsv(decodeCsv(buf)) }];
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buf, { cellDates: true });
  return wb.SheetNames.map((sheet) => ({ sheet, table: XLSX.utils.sheet_to_json<Cell[]>(wb.Sheets[sheet], { header: 1, raw: true, defval: "" }) }))
    .filter((t) => t.table.length > 1);
}
