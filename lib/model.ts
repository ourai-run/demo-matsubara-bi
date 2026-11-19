// データの形と、画面・取込・AI が共通で使う定義。

export type Kind = "sales" | "production" | "material" | "expense" | "labor";
export type Scenario = "actual" | "budget";
export type Row = Record<string, string | number>;
export interface Dataset { kind: Kind; scenario: Scenario; ym: string; rows: Row[]; importId?: string }

export interface Field { key: string; label: string; type: "dim" | "num"; unit?: string; aliases: string[]; optional?: boolean }

/** 部署から届くファイルの種類。fields の並びがそのままサンプルファイルの列になる。 */
export const KINDS: Record<Kind, { label: string; from: string; fields: Field[] }> = {
  sales: {
    label: "売上実績", from: "営業・生産管理",
    fields: [
      { key: "customer", label: "得意先", type: "dim", aliases: ["得意先名", "顧客", "顧客名", "納入先"] },
      { key: "segment", label: "分野", type: "dim", aliases: ["製品分野", "事業分野", "用途"] },
      { key: "product", label: "品目群", type: "dim", aliases: ["製品群", "品目", "製品名", "品名"] },
      { key: "process", label: "区分", type: "dim", aliases: ["工程区分", "加工区分"], optional: true },
      { key: "qty", label: "数量", type: "num", unit: "個", aliases: ["個数", "出荷数量", "売上数量"], optional: true },
      { key: "weightKg", label: "重量", type: "num", unit: "kg", aliases: ["出荷重量", "売上重量", "重量kg", "重量(kg)"] },
      { key: "amount", label: "売上金額", type: "num", unit: "円", aliases: ["金額", "売上高", "売上"] },
    ],
  },
  production: {
    label: "生産実績", from: "関工場 製造",
    fields: [
      { key: "line", label: "ライン", type: "dim", aliases: ["造型ライン", "ライン名", "設備"] },
      { key: "days", label: "稼働日数", type: "num", unit: "日", aliases: ["稼働日"], optional: true },
      { key: "hours", label: "稼働時間", type: "num", unit: "h", aliases: ["稼動時間", "運転時間"] },
      { key: "meltKg", label: "注湯重量", type: "num", unit: "kg", aliases: ["溶解重量", "注湯量", "溶解量"] },
      { key: "goodKg", label: "良品重量", type: "num", unit: "kg", aliases: ["良品", "良品量", "生産重量"] },
      { key: "defectKg", label: "不良重量", type: "num", unit: "kg", aliases: ["不良", "不良量", "廃却重量"] },
    ],
  },
  material: {
    label: "材料使用実績", from: "購買・資材",
    fields: [
      { key: "item", label: "材料名", type: "dim", aliases: ["材料", "品名", "原材料"] },
      { key: "category", label: "材料区分", type: "dim", aliases: ["区分", "種別"], optional: true },
      { key: "qtyKg", label: "使用量", type: "num", unit: "kg", aliases: ["数量", "使用重量", "購入量", "使用量kg", "使用量(kg)"] },
      { key: "amount", label: "材料費", type: "num", unit: "円", aliases: ["金額", "使用金額", "購入金額"] },
    ],
  },
  expense: {
    label: "経費実績", from: "経理",
    fields: [
      { key: "dept", label: "部門", type: "dim", aliases: ["部署", "工場", "部門名"] },
      { key: "account", label: "科目", type: "dim", aliases: ["勘定科目", "費目", "科目名"] },
      { key: "cls", label: "固変区分", type: "dim", aliases: ["変動固定", "固定変動", "区分"], optional: true },
      { key: "amount", label: "金額", type: "num", unit: "円", aliases: ["経費", "発生額", "実績額"] },
    ],
  },
  labor: {
    label: "人件費・勤怠", from: "総務",
    fields: [
      { key: "dept", label: "部門", type: "dim", aliases: ["部署", "部門名", "職場"] },
      { key: "headcount", label: "人員", type: "num", unit: "人", aliases: ["人数", "在籍人員", "在籍"] },
      { key: "overtimeH", label: "残業時間", type: "num", unit: "h", aliases: ["時間外", "時間外労働", "残業"] },
      { key: "amount", label: "人件費", type: "num", unit: "円", aliases: ["金額", "労務費", "人件費計"] },
    ],
  },
};
export const KIND_ORDER: Kind[] = ["sales", "production", "material", "expense", "labor"];

/** 変動費として扱う経費科目（固変区分の列が無いファイル用の既定）。 */
export const VARIABLE_ACCOUNTS = ["電力費", "外注加工費", "消耗工具費", "荷造運賃"];

export const USERS = [
  { id: "soumu", name: "総務課長", role: "担当" },
  { id: "president", name: "社長", role: "役員" },
  { id: "chairman", name: "会長", role: "役員" },
  { id: "dir-mfg", name: "取締役（製造）", role: "役員" },
  { id: "dir-sales", name: "取締役（営業）", role: "役員" },
  { id: "dir-admin", name: "取締役（管理）", role: "役員" },
  { id: "auditor", name: "監査役", role: "役員" },
] as const;

// ---- 年月の扱い（3月決算：4月〜翌3月） ----
export const ymAdd = (ym: string, n: number) => {
  const t = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5)) - 1 + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};
export const ymRange = (from: string, to: string) => {
  const out: string[] = [];
  for (let ym = from; ym <= to; ym = ymAdd(ym, 1)) out.push(ym);
  return out;
};
export const fyOf = (ym: string) => Number(ym.slice(0, 4)) - (Number(ym.slice(5)) < 4 ? 1 : 0);
export const fyStart = (ym: string) => `${fyOf(ym)}-04`;
export const fyEnd = (ym: string) => `${fyOf(ym) + 1}-03`;
export const ymLabel = (ym: string) => `${ym.slice(0, 4)}年${Number(ym.slice(5))}月`;
export const ymShort = (ym: string) => `${ym.slice(2, 4)}/${Number(ym.slice(5))}`;
export const dsKey = (kind: Kind, scenario: Scenario, ym: string) => `${kind}|${scenario}|${ym}`;

// ---- 示唆・役員会・学習 ----
export type Severity = "bad" | "warn" | "good" | "info";
export type InsightStatus = "open" | "action" | "watch" | "dismiss" | "other";
export interface Insight {
  id: string; ym: string; seq: number; severity: Severity; anchor: string;
  title: string; situation: string; cause: string; proposal: string; question: string;
  evidence: { label: string; value: string }[]; policyIds: string[];
  status: InsightStatus; reason: string; decidedBy: string; decidedAt: string; createdAt: string;
}
export interface Analysis {
  ym: string; summary: string; suppressed: { anchor: string; topic: string; reason: string; policyId: string }[];
  model: string; createdAt: string; actor: string;
}
export interface Comment { id: string; insightId: string; actor: string; body: string; createdAt: string }
export interface ActionItem {
  id: string; insightId: string; ym: string; title: string; owner: string; due: string;
  status: "open" | "done" | "dropped"; note: string; createdAt: string; updatedAt: string;
}
export interface Policy {
  id: string; rule: string; kind: "suppress" | "threshold" | "focus" | "context"; scope: string;
  status: "proposed" | "active" | "off"; sourceInsightId: string; sourceYm: string; actor: string; createdAt: string;
}
export interface Report { ym: string; status: "draft" | "final"; comment: string; finalizedBy: string; finalizedAt: string; updatedAt: string }
export interface ImportLog {
  id: string; fileName: string; kind: Kind; scenario: Scenario; months: string[]; rowCount: number;
  warnings: string[]; actor: string; createdAt: string;
}
export interface ChatMessage { id: string; ym: string; role: "user" | "assistant"; content: string; actor: string; createdAt: string }

export const STATUS_LABEL: Record<InsightStatus, string> = {
  open: "未判断", action: "対応する", watch: "静観する", dismiss: "問題なし", other: "別の判断",
};
export const SEVERITY_LABEL: Record<Severity, string> = { bad: "要対応", warn: "注意", good: "良い動き", info: "参考" };
export const POLICY_KIND_LABEL: Record<Policy["kind"], string> = {
  suppress: "指摘しない条件", threshold: "指摘する基準", focus: "重視する点", context: "前提として知っておくこと",
};
