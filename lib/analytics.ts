// 集計・差異分解・着地見込み。画面とAI（サーバー）で同じ計算を使う。数字はここで確定させ、AIには計算させない。
import {
  type Dataset, type Kind, type Row, type Scenario, VARIABLE_ACCOUNTS,
  dsKey, fyEnd, fyStart, ymAdd, ymRange, ymShort,
} from "./model.ts";

export type Store = Map<string, Row[]>;
export const toStore = (ds: Dataset[]): Store => new Map(ds.map((d) => [dsKey(d.kind, d.scenario, d.ym), d.rows]));
export interface Slice { sc: Scenario; yms: string[] }
export type Basis = "budget" | "py" | "pm";
export type Span = "month" | "ytd";
export const BASIS_LABEL: Record<Basis, string> = { budget: "予算", py: "前年", pm: "前月" };

const N = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
const S = (v: unknown) => String(v ?? "");
export const rowsOf = (st: Store, kind: Kind, s: Slice) => s.yms.flatMap((ym) => st.get(dsKey(kind, s.sc, ym)) ?? []);
const total = (rows: Row[], key: string) => rows.reduce((s, r) => s + N(r[key]), 0);
export const isVariable = (r: Row) => (r.cls ? r.cls === "変動" : VARIABLE_ACCOUNTS.includes(S(r.account)));
const groupSum = (rows: Row[], keyOf: (r: Row) => string, fields: string[]) => {
  const m = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const k = keyOf(r), o = m.get(k) ?? Object.fromEntries(fields.map((f) => [f, 0]));
    for (const f of fields) o[f] += N(r[f]);
    m.set(k, o);
  }
  return m;
};

export function slices(ym: string, span: Span, basis: Basis): { cur: Slice; base: Slice } {
  const yms = span === "ytd" ? ymRange(fyStart(ym), ym) : [ym];
  const cur: Slice = { sc: "actual", yms };
  if (basis === "budget") return { cur, base: { sc: "budget", yms } };
  if (basis === "py") return { cur, base: { sc: "actual", yms: yms.map((m) => ymAdd(m, -12)) } };
  return { cur, base: { sc: "actual", yms: [ymAdd(ym, -1)] } };
}

// ---- 損益（管理会計：売上−材料費−変動経費=限界利益、−人件費−固定経費=営業利益） ----
export interface PL {
  has: boolean; sales: number; weightKg: number; qty: number; material: number; varExp: number; marginal: number;
  labor: number; fixed: number; op: number; goodKg: number; defectKg: number; meltKg: number; hours: number; days: number;
  headcount: number; overtimeH: number;
}
export function pl(st: Store, s: Slice): PL {
  const sales = rowsOf(st, "sales", s), prod = rowsOf(st, "production", s), exp = rowsOf(st, "expense", s), lab = rowsOf(st, "labor", s);
  const months = Math.max(1, s.yms.filter((ym) => st.has(dsKey("labor", s.sc, ym))).length);
  const p = {
    has: sales.length > 0, sales: total(sales, "amount"), weightKg: total(sales, "weightKg"), qty: total(sales, "qty"),
    material: total(rowsOf(st, "material", s), "amount"),
    varExp: total(exp.filter(isVariable), "amount"), fixed: total(exp.filter((r) => !isVariable(r)), "amount"),
    labor: total(lab, "amount"), headcount: total(lab, "headcount") / months, overtimeH: total(lab, "overtimeH"),
    goodKg: total(prod, "goodKg"), defectKg: total(prod, "defectKg"), meltKg: total(prod, "meltKg"), hours: total(prod, "hours"),
    days: s.yms.reduce((a, ym) => a + Math.max(0, ...(st.get(dsKey("production", s.sc, ym)) ?? []).map((r) => N(r.days))), 0),
  };
  const marginal = p.sales - p.material - p.varExp;
  return { ...p, marginal, op: marginal - p.labor - p.fixed };
}
export const ratio = (a: number, b: number) => (b ? a / b : 0);
/** 損益から派生する指標（率・kg当たり）。 */
export const derived = (p: PL) => ({
  price: ratio(p.sales, p.weightKg), opRate: ratio(p.op, p.sales) * 100, marginalRate: ratio(p.marginal, p.sales) * 100,
  matRate: ratio(p.material, p.sales) * 100, laborRate: ratio(p.labor, p.sales) * 100,
  defectRate: ratio(p.defectKg, p.goodKg + p.defectKg) * 100, yieldRate: ratio(p.goodKg, p.meltKg) * 100,
  tph: ratio(p.goodKg / 1000, p.hours), tpd: ratio(p.weightKg / 1000, p.days),
  matPerKg: ratio(p.material, p.weightKg), varPerKg: ratio(p.varExp, p.weightKg), laborPerKg: ratio(p.labor, p.weightKg),
  fixedPerKg: ratio(p.fixed, p.weightKg), opPerKg: ratio(p.op, p.weightKg), otPerHead: ratio(p.overtimeH, p.headcount),
});

// ---- 営業利益の差異分解（基準→当月）。各段の合計は必ず営業利益の差に一致する ----
export interface Driver { anchor: string; name: string; effect: number; detail: string }
export interface WfStep { key: string; anchor: string; label: string; hint: string; effect: number; drivers: Driver[] }
export interface Waterfall { baseOp: number; curOp: number; steps: WfStep[] }
const t1 = (kg: number) => (kg / 1000).toFixed(1) + "t";
const yen1 = (v: number) => v.toFixed(1) + "円/kg";
const man = (v: number) => (v / 10000).toFixed(0) + "万円";

export function waterfall(st: Store, cur: Slice, base: Slice): Waterfall {
  const a = pl(st, cur), b = pl(st, base);
  const wRatio = ratio(a.weightKg, b.weightKg); // 重量の伸び。変動する費用はこの分だけ増減して当然とみなす
  const marginB = ratio(b.sales - b.material - b.varExp, b.weightKg), priceB = ratio(b.sales, b.weightKg);
  const top = (ds: Driver[]) => ds.filter((d) => Math.abs(d.effect) >= 1).sort((x, y) => Math.abs(y.effect) - Math.abs(x.effect));

  const gKey = (r: Row) => `${S(r.customer)}\t${S(r.product)}`;
  const ga = groupSum(rowsOf(st, "sales", cur), gKey, ["weightKg", "amount"]), gb = groupSum(rowsOf(st, "sales", base), gKey, ["weightKg", "amount"]);
  const vol: Driver[] = [], mix: Driver[] = [], price: Driver[] = [];
  for (const k of new Set([...ga.keys(), ...gb.keys()])) {
    const A = ga.get(k) ?? { weightKg: 0, amount: 0 }, B = gb.get(k) ?? { weightKg: 0, amount: 0 };
    const [customer, product] = k.split("\t"), name = `${customer} ${product}`, anchor = `cust:${customer}`;
    const pa = ratio(A.amount, A.weightKg), pb = B.weightKg ? B.amount / B.weightKg : pa, dW = A.weightKg - B.weightKg;
    vol.push({ anchor, name, effect: dW * marginB, detail: `重量 ${t1(B.weightKg)}→${t1(A.weightKg)}` });
    mix.push({ anchor, name, effect: dW * (pb - priceB), detail: `単価 ${yen1(pb)}（平均 ${yen1(priceB)}）の品目が ${dW >= 0 ? "+" : ""}${t1(dW)}` });
    price.push({ anchor, name, effect: A.weightKg * (pa - pb), detail: `単価 ${yen1(pb)}→${yen1(pa)}` });
  }

  const ma = groupSum(rowsOf(st, "material", cur), (r) => S(r.item), ["qtyKg", "amount"]), mb = groupSum(rowsOf(st, "material", base), (r) => S(r.item), ["qtyKg", "amount"]);
  const matPrice: Driver[] = [], matUse: Driver[] = [];
  for (const item of new Set([...ma.keys(), ...mb.keys()])) {
    const A = ma.get(item) ?? { qtyKg: 0, amount: 0 }, B = mb.get(item) ?? { qtyKg: 0, amount: 0 };
    const pa = ratio(A.amount, A.qtyKg), pb = B.qtyKg ? B.amount / B.qtyKg : pa, flexQ = B.qtyKg * wRatio;
    matPrice.push({ anchor: `mat:${item}`, name: item, effect: -A.qtyKg * (pa - pb), detail: `単価 ${yen1(pb)}→${yen1(pa)}` });
    matUse.push({ anchor: `mat:${item}`, name: item, effect: -(A.qtyKg - flexQ) * pb, detail: `使用量 重量見合い ${t1(flexQ)}→実際 ${t1(A.qtyKg)}` });
  }

  const byAcct = (s: Slice, variable: boolean) => groupSum(rowsOf(st, "expense", s).filter((r) => isVariable(r) === variable), (r) => S(r.account), ["amount"]);
  const diff = (A: Map<string, Record<string, number>>, B: Map<string, Record<string, number>>, f: string, k: number, anchor: string, flexed: boolean): Driver[] =>
    [...new Set([...A.keys(), ...B.keys()])].map((name) => {
      const av = A.get(name)?.[f] ?? 0, bv = (B.get(name)?.[f] ?? 0) * k;
      return { anchor: `${anchor}:${name}`, name, effect: -(av - bv), detail: `${flexed ? "重量見合い " : ""}${man(bv)}→${man(av)}` };
    });
  const varD = diff(byAcct(cur, true), byAcct(base, true), "amount", wRatio, "acct", true);
  const fixD = diff(byAcct(cur, false), byAcct(base, false), "amount", 1, "acct", false);
  const labD = diff(groupSum(rowsOf(st, "labor", cur), (r) => S(r.dept), ["amount"]), groupSum(rowsOf(st, "labor", base), (r) => S(r.dept), ["amount"]), "amount", 1, "dept", false);

  const step = (key: string, label: string, hint: string, ds: Driver[]): WfStep =>
    ({ key, anchor: `wf:${key}`, label, hint, effect: ds.reduce((s, d) => s + d.effect, 0), drivers: top(ds) });
  return {
    baseOp: b.op, curOp: a.op,
    steps: [
      step("volume", "販売数量差", "売れた重量の増減（限界利益ベース）", vol),
      step("mix", "品目構成差", "単価の高い品目・低い品目の割合の変化", mix),
      step("price", "販売単価差", "同じ品目の円/kgの変化（価格改定・スライド）", price),
      step("matprice", "材料価格差", "鋼屑・銑鉄・コークスなどの単価の変化", matPrice),
      step("matusage", "材料使用量差", "重量の割に材料を多く・少なく使った分（不良・歩留）", matUse),
      step("varcost", "変動経費差", "電力・外注・工具・運賃が重量の割に増減した分", varD),
      step("labor", "人件費差", "人員・残業の増減", labD),
      step("fixed", "固定費差", "修繕・償却などの増減", fixD),
    ],
  };
}

// ---- 切り口分析（指標 × 軸） ----
export interface Measure {
  key: string; label: string; kind: Kind | "pl"; unit: string; digits: number; good: 1 | -1 | 0; axes: string[];
  num: (r: Row) => number; den?: (r: Row) => number; mul: number; stock?: boolean; calc?: (p: PL) => number;
}
export const AXES: Record<string, string> = {
  segment: "分野", customer: "得意先", product: "品目群", process: "区分", line: "ライン", item: "材料", category: "材料区分",
  account: "科目", dept: "部門", cls: "固変区分",
};
const SALES_AX = ["segment", "customer", "product", "process"], EXP_AX = ["account", "dept", "cls"];
const plm = (key: string, label: string, unit: string, digits: number, good: 1 | -1 | 0, calc: (p: PL) => number): Measure =>
  ({ key, label, kind: "pl", unit, digits, good, axes: [], num: () => 0, mul: 1, calc });
export const MEASURES: Measure[] = [
  { key: "sales", label: "売上高", kind: "sales", unit: "百万円", digits: 1, good: 1, axes: SALES_AX, num: (r) => N(r.amount), mul: 1e-6 },
  { key: "weight", label: "販売重量", kind: "sales", unit: "t", digits: 0, good: 1, axes: SALES_AX, num: (r) => N(r.weightKg), mul: 1e-3 },
  { key: "price", label: "販売単価", kind: "sales", unit: "円/kg", digits: 1, good: 1, axes: SALES_AX, num: (r) => N(r.amount), den: (r) => N(r.weightKg), mul: 1 },
  { key: "qty", label: "販売数量", kind: "sales", unit: "千個", digits: 0, good: 1, axes: SALES_AX, num: (r) => N(r.qty), mul: 1e-3 },
  { key: "good", label: "良品重量", kind: "production", unit: "t", digits: 0, good: 1, axes: ["line"], num: (r) => N(r.goodKg), mul: 1e-3 },
  { key: "defectRate", label: "不良率", kind: "production", unit: "%", digits: 2, good: -1, axes: ["line"], num: (r) => N(r.defectKg), den: (r) => N(r.goodKg) + N(r.defectKg), mul: 100 },
  { key: "yieldRate", label: "鋳造歩留", kind: "production", unit: "%", digits: 1, good: 1, axes: ["line"], num: (r) => N(r.goodKg), den: (r) => N(r.meltKg), mul: 100 },
  { key: "tph", label: "時間当たり良品", kind: "production", unit: "t/h", digits: 2, good: 1, axes: ["line"], num: (r) => N(r.goodKg) / 1000, den: (r) => N(r.hours), mul: 1 },
  { key: "hours", label: "稼働時間", kind: "production", unit: "h", digits: 0, good: 0, axes: ["line"], num: (r) => N(r.hours), mul: 1 },
  { key: "matCost", label: "材料費", kind: "material", unit: "百万円", digits: 1, good: -1, axes: ["item", "category"], num: (r) => N(r.amount), mul: 1e-6 },
  { key: "matPrice", label: "材料単価", kind: "material", unit: "円/kg", digits: 1, good: -1, axes: ["item", "category"], num: (r) => N(r.amount), den: (r) => N(r.qtyKg), mul: 1 },
  { key: "matQty", label: "材料使用量", kind: "material", unit: "t", digits: 0, good: 0, axes: ["item", "category"], num: (r) => N(r.qtyKg), mul: 1e-3 },
  { key: "expense", label: "経費", kind: "expense", unit: "百万円", digits: 1, good: -1, axes: EXP_AX, num: (r) => N(r.amount), mul: 1e-6 },
  { key: "labor", label: "人件費", kind: "labor", unit: "百万円", digits: 1, good: -1, axes: ["dept"], num: (r) => N(r.amount), mul: 1e-6 },
  { key: "overtime", label: "残業時間", kind: "labor", unit: "h", digits: 0, good: -1, axes: ["dept"], num: (r) => N(r.overtimeH), mul: 1 },
  { key: "otPerHead", label: "一人当たり残業", kind: "labor", unit: "h/人", digits: 1, good: -1, axes: ["dept"], num: (r) => N(r.overtimeH), den: (r) => N(r.headcount), mul: 1 },
  { key: "headcount", label: "人員", kind: "labor", unit: "人", digits: 0, good: 0, axes: ["dept"], num: (r) => N(r.headcount), mul: 1, stock: true },
  plm("op", "営業利益", "百万円", 1, 1, (p) => p.op / 1e6),
  plm("marginal", "限界利益", "百万円", 1, 1, (p) => p.marginal / 1e6),
  plm("opRate", "営業利益率", "%", 1, 1, (p) => derived(p).opRate),
  plm("matRate", "材料費率", "%", 1, -1, (p) => derived(p).matRate),
  plm("matPerKg", "kg当たり材料費", "円/kg", 1, -1, (p) => derived(p).matPerKg),
  plm("varPerKg", "kg当たり変動経費", "円/kg", 1, -1, (p) => derived(p).varPerKg),
  plm("laborPerKg", "kg当たり人件費", "円/kg", 1, -1, (p) => derived(p).laborPerKg),
  plm("fixedPerKg", "kg当たり固定費", "円/kg", 1, -1, (p) => derived(p).fixedPerKg),
  plm("opPerKg", "kg当たり営業利益", "円/kg", 1, 1, (p) => derived(p).opPerKg),
  plm("tpd", "稼働日当たり販売重量", "t/日", 1, 1, (p) => derived(p).tpd),
];
export const measureOf = (key: string) => MEASURES.find((m) => m.key === key) ?? MEASURES[0];
export type Filters = Record<string, string[]>;

/** 指標を軸のメンバー別に集計する。軸なしは "" の1件。 */
export function measure(st: Store, m: Measure, s: Slice, axis = "", filters: Filters = {}): Map<string, number> {
  if (m.kind === "pl") return new Map([["", m.calc!(pl(st, s))]]);
  const months = m.stock ? Math.max(1, s.yms.filter((ym) => st.has(dsKey(m.kind as Kind, s.sc, ym))).length) : 1;
  const acc = new Map<string, [number, number]>();
  for (const r of rowsOf(st, m.kind, s)) {
    if (Object.entries(filters).some(([k, vs]) => vs.length && k in r && !vs.includes(S(r[k])))) continue;
    const k = axis ? S(r[axis]) : "", o = acc.get(k) ?? [0, 0];
    o[0] += m.num(r); o[1] += m.den ? m.den(r) : 0;
    acc.set(k, o);
  }
  return new Map([...acc].map(([k, [n, d]]) => [k, (m.den ? ratio(n, d) : n / months) * m.mul]));
}
export const members = (st: Store, kind: Kind, axis: string) => {
  const set = new Set<string>();
  for (const [k, rows] of st) if (k.startsWith(kind + "|")) for (const r of rows) if (r[axis] !== undefined) set.add(S(r[axis]));
  return [...set];
};

// ---- 年度の着地見込み（残りの月は直近3か月の傾向が続くと仮定）と試算 ----
export interface Adj { weight: number; price: number; material: number; varExp: number; labor: number; fixed: number }
export const ADJ0: Adj = { weight: 0, price: 0, material: 0, varExp: 0, labor: 0, fixed: 0 };
export function landing(st: Store, ym: string, adj: Adj = ADJ0) {
  const recent = ymRange(ymAdd(ym, -2), ym), ra = pl(st, { sc: "actual", yms: recent }), rb = pl(st, { sc: "budget", yms: recent });
  const k = {
    weight: ratio(ra.weightKg, rb.weightKg) || 1, price: ratio(ratio(ra.sales, ra.weightKg), ratio(rb.sales, rb.weightKg)) || 1,
    matPerKg: ratio(ra.material, ra.weightKg), varPerKg: ratio(ra.varExp, ra.weightKg),
    labor: ratio(ra.labor, rb.labor) || 1, fixed: ratio(ra.fixed, rb.fixed) || 1,
  };
  const months = ymRange(fyStart(ym), fyEnd(ym)).map((m) => {
    const b = pl(st, { sc: "budget", yms: [m] });
    if (m <= ym) { const a = pl(st, { sc: "actual", yms: [m] }); return { ym: m, actual: true, sales: a.sales, op: a.op, weightKg: a.weightKg, budgetSales: b.sales, budgetOp: b.op }; }
    const weightKg = b.weightKg * k.weight * (1 + adj.weight / 100);
    const sales = weightKg * ratio(b.sales, b.weightKg) * k.price * (1 + adj.price / 100);
    const cost = weightKg * (k.matPerKg * (1 + adj.material / 100) + k.varPerKg * (1 + adj.varExp / 100))
      + b.labor * k.labor * (1 + adj.labor / 100) + b.fixed * k.fixed * (1 + adj.fixed / 100);
    return { ym: m, actual: false, sales, op: sales - cost, weightKg, budgetSales: b.sales, budgetOp: b.op };
  });
  const sum = (f: (m: (typeof months)[number]) => number) => months.reduce((s, m) => s + f(m), 0);
  return { months, k, sales: sum((m) => m.sales), op: sum((m) => m.op), budgetSales: sum((m) => m.budgetSales), budgetOp: sum((m) => m.budgetOp) };
}

/** 実績が5種類そろっている月（新しい順）。 */
export function closedMonths(ds: { kind: Kind; scenario: Scenario; ym: string }[]) {
  const count = new Map<string, number>();
  for (const d of ds) if (d.scenario === "actual") count.set(d.ym, (count.get(d.ym) ?? 0) + 1);
  return [...count].filter(([, n]) => n >= 5).map(([ym]) => ym).sort().reverse();
}

// ---- AIに渡す数値一式。金額=百万円、重量=t、単価=円/kg、率=% ----
const M = (v: number) => Math.round(v / 1e5) / 10;
const R1 = (v: number) => Math.round(v * 10) / 10;
const R2 = (v: number) => Math.round(v * 100) / 100;
export function factPack(st: Store, ym: string) {
  const one = (sc: Scenario, m: string): Slice => ({ sc, yms: [m] });
  const ytd = ymRange(fyStart(ym), ym);
  const S4 = { a: one("actual", ym), b: one("budget", ym), py: one("actual", ymAdd(ym, -12)), pm: one("actual", ymAdd(ym, -1)) };
  const Y = { a: { sc: "actual", yms: ytd } as Slice, b: { sc: "budget", yms: ytd } as Slice, py: { sc: "actual", yms: ytd.map((m) => ymAdd(m, -12)) } as Slice };
  const P = { a: pl(st, S4.a), b: pl(st, S4.b), py: pl(st, S4.py), pm: pl(st, S4.pm), ya: pl(st, Y.a), yb: pl(st, Y.b), ypy: pl(st, Y.py) };
  const line = (item: string, f: (p: PL) => number) => ({
    item, actual: f(P.a), budget: f(P.b), vs_budget: R1(f(P.a) - f(P.b)), prev_year: f(P.py), prev_month: f(P.pm),
    ytd_actual: f(P.ya), ytd_budget: f(P.yb), ytd_vs_budget: R1(f(P.ya) - f(P.yb)), ytd_prev_year: f(P.ypy),
  });
  const D = (p: PL) => derived(p);
  const wf = (cur: Slice, base: Slice, nDrivers: number) => {
    const w = waterfall(st, cur, base);
    return {
      base_op: M(w.baseOp), actual_op: M(w.curOp),
      steps: w.steps.map((s) => ({
        anchor: s.anchor, label: s.label, effect: M(s.effect),
        drivers: s.drivers.slice(0, nDrivers).filter((d) => Math.abs(d.effect) >= 2e5).map((d) => ({ anchor: d.anchor, name: d.name, effect: M(d.effect), detail: d.detail })),
      })),
    };
  };
  const by = (key: string, axis: string, fmt: (v: number) => number, anchor: string, withYtd = false) => {
    const m = measureOf(key), get = (s: Slice) => measure(st, m, s, axis);
    const a = get(S4.a), b = get(S4.b), py = get(S4.py), pm = get(S4.pm), ya = withYtd ? get(Y.a) : null, yb = withYtd ? get(Y.b) : null;
    return [...new Set([...a.keys(), ...b.keys()])].map((name) => ({
      anchor: `${anchor}:${name}`, name, actual: fmt(a.get(name) ?? 0), budget: fmt(b.get(name) ?? 0), prev_year: fmt(py.get(name) ?? 0), prev_month: fmt(pm.get(name) ?? 0),
      ...(ya && yb ? { ytd_actual: fmt(ya.get(name) ?? 0), ytd_budget: fmt(yb.get(name) ?? 0) } : {}),
    }));
  };
  const merge = (lists: Record<string, ReturnType<typeof by>>) => {
    const out = new Map<string, { anchor: string; name: string } & Record<string, unknown>>();
    for (const [label, list] of Object.entries(lists)) for (const { anchor, name, ...v } of list) out.set(anchor, { ...(out.get(anchor) ?? { anchor, name }), [label]: v });
    return [...out.values()];
  };
  const months13 = ymRange(ymAdd(ym, -12), ym);
  const lineTrend = (name: string) => months13.slice(-6).map((m) => R2(measure(st, measureOf("defectRate"), one("actual", m), "line").get(name) ?? 0));
  const land = landing(st, ym);
  const kpi = (label: string, f: (p: PL) => number, anchor?: string) => ({ ...(anchor ? { anchor } : {}), ...line(label, f) });
  const pack = {
    period: ym, note: "金額は百万円、重量はt、単価は円/kg、率は%。3月決算（年度は4月〜翌3月）。ytd は年度累計。",
    workdays: { actual: P.a.days, budget: P.b.days, prev_year: P.py.days, prev_month: P.pm.days },
    pl: [
      line("売上高", (p) => M(p.sales)), line("材料費", (p) => M(p.material)), line("変動経費（電力・外注・工具・運賃）", (p) => M(p.varExp)),
      line("限界利益", (p) => M(p.marginal)), line("人件費", (p) => M(p.labor)), line("固定費", (p) => M(p.fixed)), line("営業利益", (p) => M(p.op)),
    ],
    kpi: [
      kpi("売上高", (p) => M(p.sales), "kpi:sales"), kpi("営業利益", (p) => M(p.op), "kpi:op"),
      kpi("販売重量(t)", (p) => R1(p.weightKg / 1000), "kpi:weight"), kpi("販売単価(円/kg)", (p) => R1(D(p).price), "kpi:price"),
      kpi("材料費率(%)", (p) => R1(D(p).matRate), "kpi:matrate"), kpi("不良率(%)", (p) => R2(D(p).defectRate), "kpi:defect"),
      kpi("残業時間(h)", (p) => Math.round(p.overtimeH), "kpi:overtime"),
      kpi("営業利益率(%)", (p) => R1(D(p).opRate)), kpi("限界利益率(%)", (p) => R1(D(p).marginalRate)), kpi("鋳造歩留(%)", (p) => R1(D(p).yieldRate)),
      kpi("稼働日当たり販売重量(t/日)", (p) => R1(D(p).tpd)), kpi("人員(人)", (p) => Math.round(p.headcount)),
      kpi("kg当たり材料費(円/kg)", (p) => R1(D(p).matPerKg)), kpi("kg当たり変動経費(円/kg)", (p) => R1(D(p).varPerKg)),
      kpi("kg当たり人件費(円/kg)", (p) => R1(D(p).laborPerKg)), kpi("kg当たり固定費(円/kg)", (p) => R1(D(p).fixedPerKg)),
    ],
    landing: { anchor: "kpi:landing", fy_op_forecast: M(land.op), fy_op_budget: M(land.budgetOp), fy_sales_forecast: M(land.sales), fy_sales_budget: M(land.budgetSales), assumption: "残りの月は直近3か月の予算達成率・kg当たり費用が続くと仮定" },
    op_variance_vs_budget: wf(S4.a, S4.b, 6),
    op_variance_vs_prev_year: wf(S4.a, S4.py, 2),
    op_variance_vs_prev_month: wf(S4.a, S4.pm, 2),
    op_variance_ytd_vs_budget: wf(Y.a, Y.b, 3),
    segments: merge({ sales: by("sales", "segment", R1, "seg", true), weight_t: by("weight", "segment", R1, "seg", true), price: by("price", "segment", R1, "seg") }),
    customers: merge({ sales: by("sales", "customer", R1, "cust", true), weight_t: by("weight", "customer", R1, "cust"), price: by("price", "customer", R1, "cust") }),
    lines: merge({ good_t: by("good", "line", R1, "line"), defect_rate: by("defectRate", "line", R2, "line"), t_per_hour: by("tph", "line", R2, "line"), hours: by("hours", "line", R1, "line") })
      .map((l) => ({ ...l, defect_rate_last6m: lineTrend(l.name) })),
    materials: merge({ price: by("matPrice", "item", R1, "mat"), qty_t: by("matQty", "item", R1, "mat"), cost: by("matCost", "item", R1, "mat") }),
    expenses: merge({ amount: by("expense", "account", R1, "acct", true) }).map((e) => ({
      ...e, last3m: months13.slice(-3).map((m) => ({ ym: m, actual: R1(measure(st, measureOf("expense"), one("actual", m), "account").get(e.name) ?? 0), budget: R1(measure(st, measureOf("expense"), one("budget", m), "account").get(e.name) ?? 0) })),
    })),
    labor: merge({ cost: by("labor", "dept", R1, "dept"), overtime_h: by("overtime", "dept", Math.round, "dept"), headcount: by("headcount", "dept", Math.round, "dept") }),
    trend_13m: months13.map((m) => {
      const a = pl(st, one("actual", m)), b = pl(st, one("budget", m)), d = D(a);
      return { ym: m, sales: M(a.sales), sales_budget: M(b.sales), op: M(a.op), op_budget: M(b.op), weight_t: Math.round(a.weightKg / 1000), workdays: a.days, price: R1(d.price), mat_rate: R1(d.matRate), defect_rate: R2(d.defectRate),
        scrap_price: R1(measure(st, measureOf("matPrice"), one("actual", m), "item").get("鋼屑") ?? 0) };
    }),
  };
  const anchors = [
    ...pack.kpi.flatMap((k) => ("anchor" in k ? [k.anchor as string] : [])), "kpi:landing", ...pack.op_variance_vs_budget.steps.map((s) => s.anchor),
    ...[pack.segments, pack.customers, pack.lines, pack.materials, pack.expenses, pack.labor].flatMap((l) => l.map((x) => x.anchor)), "trend:sales", "trend:op",
  ];
  return { pack, anchors };
}

/** アンカー（示唆を付ける場所）の表示名。 */
export function anchorLabel(anchor: string) {
  const [type, name] = [anchor.slice(0, anchor.indexOf(":")), anchor.slice(anchor.indexOf(":") + 1)];
  const KPI: Record<string, string> = { sales: "売上高", op: "営業利益", weight: "販売重量", price: "販売単価", matrate: "材料費率", defect: "不良率", overtime: "残業時間", landing: "年度着地見込み" };
  const WF: Record<string, string> = { volume: "販売数量差", mix: "品目構成差", price: "販売単価差", matprice: "材料価格差", matusage: "材料使用量差", varcost: "変動経費差", labor: "人件費差", fixed: "固定費差" };
  if (type === "kpi") return KPI[name] ?? name;
  if (type === "wf") return "利益差異：" + (WF[name] ?? name);
  if (type === "trend") return name === "op" ? "営業利益の推移" : "売上高の推移";
  return ({ seg: "分野", cust: "得意先", line: "ライン", mat: "材料", acct: "科目", dept: "部門" }[type] ?? type) + "：" + name;
}
export const trendLabel = ymShort;

/** 当期と基準を軸のメンバーごとに並べる（当期の大きい順）。 */
export function compare(st: Store, key: string, axis: string, cur: Slice, base: Slice, filters: Filters = {}) {
  const m = measureOf(key), A = measure(st, m, cur, axis, filters), B = measure(st, m, base, axis, filters);
  return [...new Set([...A.keys(), ...B.keys()])]
    .map((name) => { const a = A.get(name) ?? 0, b = B.get(name) ?? 0; return { name, a, b, diff: a - b, rate: b ? (a / b) * 100 : NaN, hasBase: B.has(name) }; })
    .sort((x, y) => y.a - x.a);
}
