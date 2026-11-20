// サンプルデータ。鋳造業の数字のつながり（重量→溶解量→材料・電力・残業）を保ったまま、
// 2024年4月〜の予算と実績を毎回同じ値で作る。得意先名・ライン名は会社サイトの公開情報、数字はすべて架空。
import { type Dataset, type Kind, type Row, type Scenario, KIND_ORDER, fyOf, ymRange } from "./model.ts";

export const SAMPLE_FROM = "2024-04";
export const SAMPLE_ACTUAL_TO = "2026-10"; // 初期データに入れる実績の最終月
export const SAMPLE_NEXT = "2026-11"; // 取込用サンプルファイルとして配る月
export const SAMPLE_BUDGET_TO = "2027-03";

function rnd(key: string) { // −1〜1 の決まった乱数
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}
const tOf = (ym: string) => (Number(ym.slice(0, 4)) - 2024) * 12 + Number(ym.slice(5)) - 4; // 2024-04 = 0
const lerp = (knots: [number, number][], t: number) => {
  if (t <= knots[0][0]) return knots[0][1];
  for (let i = 1; i < knots.length; i++) {
    const [t1, v1] = knots[i], [t0, v0] = knots[i - 1];
    if (t <= t1) return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
  }
  return knots[knots.length - 1][1];
};

// 市況（円/kg、電力は円/kWh）。2026年7月から鋼屑が上がり続ける。
const MARKET: Record<string, { actual: [number, number][]; budget: Record<number, number> }> = {
  scrap: { actual: [[0, 45.5], [6, 46.5], [12, 47], [18, 48], [24, 49], [26, 50], [27, 53], [28, 54], [29, 55], [30, 56.5], [31, 58]], budget: { 2024: 46, 2025: 47, 2026: 50 } },
  pig: { actual: [[0, 80], [12, 82], [24, 84], [27, 86], [30, 88], [31, 88.5]], budget: { 2024: 80, 2025: 82, 2026: 84 } },
  coke: { actual: [[0, 90], [12, 92.5], [24, 94.5], [27, 96.5], [30, 99], [31, 100]], budget: { 2024: 90, 2025: 92, 2026: 94 } },
  elec: { actual: [[0, 19], [12, 19.6], [24, 20.2], [27, 21.3], [30, 21.6], [31, 21.4]], budget: { 2024: 19, 2025: 19.5, 2026: 20 } },
};
const market = (name: string, ym: string, sc: Scenario) =>
  sc === "budget" ? MARKET[name].budget[fyOf(ym)] : lerp(MARKET[name].actual, tOf(ym)) * (1 + rnd(name + ym) * 0.006);

// 得意先×品目群。t=基準の月間重量(トン)、price=円/kg、slide=材料価格スライド制（四半期ごとに単価改定）
const GROUPS = [
  { customer: "エクセディ", segment: "自動車", product: "クラッチ部品", process: "鋳放し", t: 310, price: 265, unitKg: 1.4, slide: true },
  { customer: "アイシン高丘", segment: "自動車", product: "EGR部品", process: "加工品", t: 150, price: 420, unitKg: 0.28, slide: true },
  { customer: "アイシン高丘", segment: "自動車", product: "排気系部品", process: "鋳放し", t: 90, price: 330, unitKg: 0.55, slide: true },
  { customer: "曙ブレーキ工業", segment: "自動車", product: "ブレーキ部品", process: "鋳放し", t: 210, price: 285, unitKg: 0.9, slide: true },
  { customer: "フコク", segment: "自動車", product: "ダンパー部品", process: "鋳放し", t: 120, price: 300, unitKg: 0.7, slide: true },
  { customer: "ヨシワ工業", segment: "自動車", product: "足回り部品", process: "鋳放し", t: 95, price: 290, unitKg: 1.3, slide: true },
  { customer: "三菱電機", segment: "空調", product: "スクロール部品", process: "加工品", t: 180, price: 395, unitKg: 0.42, slide: false },
  { customer: "三菱電機", segment: "空調", product: "フレーム・軸受部品", process: "鋳放し", t: 60, price: 340, unitKg: 0.8, slide: false },
  { customer: "三菱重工サーマルシステムズ", segment: "空調", product: "スクロール部品", process: "鋳放し", t: 110, price: 405, unitKg: 0.45, slide: false },
  { customer: "川崎重工業", segment: "油圧・建機", product: "油圧ポンプ部品", process: "加工品", t: 105, price: 380, unitKg: 1.9, slide: false },
  { customer: "川崎重工業", segment: "油圧・建機", product: "バルブ部品", process: "加工品", t: 45, price: 410, unitKg: 0.9, slide: false },
  { customer: "クボタ", segment: "農機", product: "トラクタ部品", process: "鋳放し", t: 95, price: 310, unitKg: 2.4, slide: false },
  { customer: "クボタ", segment: "農機", product: "エンジン部品", process: "鋳放し", t: 55, price: 325, unitKg: 1.5, slide: false },
  { customer: "その他得意先", segment: "水道・ポンプ", product: "水道ポンプ部品", process: "鋳放し", t: 40, price: 350, unitKg: 1.8, slide: false },
  { customer: "その他得意先", segment: "産業機械・その他", product: "インサート部品ほか", process: "鋳放し", t: 35, price: 360, unitKg: 0.25, slide: false },
];
// 月ごとの季節の波（1月〜12月）。空調は夏前に作り込み、農機は冬が繁忙期、8月は盆休み。
const SEASON: Record<string, number[]> = {
  自動車: [0.93, 1.02, 1.06, 0.98, 0.94, 1.03, 1.04, 0.84, 1.03, 1.05, 1.04, 0.98],
  空調: [1.1, 1.15, 1.2, 1.18, 1.1, 1.02, 0.9, 0.74, 0.8, 0.84, 0.92, 1.02],
  "油圧・建機": [0.97, 1.0, 1.05, 1.0, 0.96, 1.02, 1.02, 0.88, 1.02, 1.03, 1.02, 1.0],
  農機: [1.12, 1.15, 1.12, 1.0, 0.92, 0.9, 0.88, 0.8, 0.92, 1.0, 1.08, 1.14],
  other: [0.96, 1.0, 1.04, 1.0, 0.96, 1.02, 1.02, 0.86, 1.02, 1.04, 1.02, 1.0],
};
const WORKDAYS = [19, 20, 22, 21, 19, 22, 22, 18, 21, 22, 20, 21];
const GROWTH: Record<number, Record<string, number>> = {
  2024: { other: 0.97 }, 2025: { other: 1.0 },
  2026: { 自動車: 1.02, 空調: 1.06, "油圧・建機": 1.0, 農機: 1.04, other: 1.02 },
};
// 実績だけに起きた出来事（重量への倍率）。キーは 得意先・分野・品目群 のどれか。
const EVENTS: Record<string, Record<string, number>> = {
  "2025-02": { 自動車: 0.94 }, "2025-07": { 空調: 1.05 }, "2025-11": { 農機: 1.06 }, "2026-01": { "油圧・建機": 0.95 },
  "2026-04": { 空調: 1.04 }, "2026-05": { 空調: 1.07 }, "2026-06": { 空調: 1.09, エクセディ: 0.98 },
  "2026-07": { 空調: 1.09, "油圧・建機": 0.95 }, "2026-08": { 空調: 1.02, "油圧・建機": 0.93 },
  "2026-09": { エクセディ: 0.95, 曙ブレーキ工業: 0.94, 空調: 0.93, "油圧・建機": 0.9 },
  "2026-10": { エクセディ: 0.91, 曙ブレーキ工業: 1.02, EGR部品: 1.06, 空調: 0.94, "油圧・建機": 0.88, 農機: 1.04 },
  "2026-11": { エクセディ: 0.96, EGR部品: 1.07, 空調: 0.9, "油圧・建機": 0.9, 農機: 1.08 },
};
const PRICE_PLAN: Record<number, number> = { 2024: 0.985, 2025: 1.0, 2026: 1.015 };

const LINES = [
  { line: "FCMX", share: 0.36, defect: 3.0, yieldR: 0.64, tph: 3.6 },
  { line: "AMF-V", share: 0.28, defect: 3.3, yieldR: 0.62, tph: 2.9 },
  { line: "SM-60V 1号", share: 0.18, defect: 3.7, yieldR: 0.58, tph: 1.7 },
  { line: "SM-60V 2号", share: 0.18, defect: 3.7, yieldR: 0.58, tph: 1.7 },
];
// 2026年9月にFCMXの造型機が故障。SM-60V 2号は6月から不良がじわじわ増える。
const DEFECT_EVENTS: Record<string, Record<string, number>> = {
  FCMX: { "2026-09": 5.4, "2026-10": 4.2, "2026-11": 3.3 },
  "SM-60V 2号": { "2026-06": 3.9, "2026-07": 4.0, "2026-08": 4.2, "2026-09": 4.3, "2026-10": 4.5, "2026-11": 4.7 },
};
const FCMX_TROUBLE: Record<string, { share: number; tph: number; days: number }> = {
  "2026-09": { share: 0.3, tph: 0.9, days: -4 }, "2026-10": { share: 0.34, tph: 0.96, days: 0 },
};

const MATERIALS: { item: string; category: string; per: "metal" | "melt" | "good"; ratio: number; price: number | string }[] = [
  { item: "鋼屑", category: "主材料", per: "metal", ratio: 0.61, price: "scrap" },
  { item: "銑鉄", category: "主材料", per: "metal", ratio: 0.31, price: "pig" },
  { item: "合金鉄", category: "主材料", per: "melt", ratio: 0.011, price: 268 },
  { item: "加炭材", category: "主材料", per: "melt", ratio: 0.007, price: 150 },
  { item: "球状化剤・接種剤", category: "主材料", per: "melt", ratio: 0.0035, price: 520 },
  { item: "コークス", category: "燃料", per: "melt", ratio: 0.118, price: "coke" },
  { item: "鋳物砂・粘結材", category: "副資材", per: "melt", ratio: 0.042, price: 58 },
  { item: "中子（シェル砂）", category: "副資材", per: "good", ratio: 0.045, price: 135 },
  { item: "石灰石・その他副資材", category: "副資材", per: "melt", ratio: 0.028, price: 22 },
];

const LABOR = [
  { dept: "関工場 鋳造", head: 60, base: 600_000, ot: 1400 },
  { dept: "関工場 仕上・検査", head: 38, base: 460_000, ot: 700 },
  { dept: "大平工場 加工・検査", head: 44, base: 550_000, ot: 800 },
  { dept: "技術・品質保証", head: 18, base: 680_000, ot: 250 },
  { dept: "営業・生産管理", head: 14, base: 660_000, ot: 180 },
  { dept: "総務・管理", head: 12, base: 1_280_000, ot: 90 },
];
const WAGE: Record<number, number> = { 2024: 0.965, 2025: 1.0, 2026: 1.03 };
const OT_RATE = 2900;

const r0 = (n: number) => Math.round(n);
const r3 = (n: number) => Math.round(n / 1000) * 1000;

/** 1か月分の5種類のデータを作る。 */
export function generateMonth(ym: string, sc: Scenario): Record<Kind, Row[]> {
  const fy = fyOf(ym), mi = Number(ym.slice(5)) - 1, act = sc === "actual";
  const n = (key: string, amp: number) => (act ? 1 + rnd(key + ym) * amp : 1);
  const ev = EVENTS[ym] ?? {};

  // --- 売上 ---
  const quarter = Math.floor(((mi + 9) % 12) / 3); // 4-6月=0
  const slideAdj = fy === 2026 ? [0, 0, 0.028, 0.045][quarter] : 0;
  const sales: Row[] = GROUPS.map((g) => {
    const season = (SEASON[g.segment] ?? SEASON.other)[mi];
    const growth = GROWTH[fy][g.segment] ?? GROWTH[fy].other;
    const event = act ? (ev[g.customer] ?? 1) * (ev[g.segment] ?? 1) * (ev[g.product] ?? 1) : 1;
    const weightKg = r0(g.t * 1000 * season * growth * event * n(g.customer + g.product, 0.025));
    const plan = PRICE_PLAN[fy];
    // スライド制のない得意先は、2026年度の値上げ（予算+1.5%）が+0.4%しか通っていない
    const factor = !act ? plan : g.slide ? plan * (1 + slideAdj) : fy === 2026 ? 1.004 : plan;
    const price = g.price * factor * n("p" + g.customer + g.product, 0.005);
    return { customer: g.customer, segment: g.segment, product: g.product, process: g.process, qty: r0(weightKg / g.unitKg), weightKg, amount: r3(weightKg * price) };
  });
  const soldKg = sales.reduce((s, r) => s + (r.weightKg as number), 0);
  const machinedKg = sales.filter((r) => r.process === "加工品").reduce((s, r) => s + (r.weightKg as number), 0);

  // --- 生産（関工場の造型ライン） ---
  const goodTotal = soldKg * n("inv", 0.012);
  const trouble = act ? FCMX_TROUBLE[ym] : undefined;
  const fcmxShare = trouble?.share ?? LINES[0].share;
  const production: Row[] = LINES.map((l) => {
    const share = l.line === "FCMX" ? fcmxShare : (l.share * (1 - fcmxShare)) / (1 - LINES[0].share);
    const goodKg = r0(goodTotal * share * n("g" + l.line, 0.01));
    const rate = act ? DEFECT_EVENTS[l.line]?.[ym] ?? l.defect + 0.1 + rnd("d" + l.line + ym) * 0.3 : l.defect;
    const defectKg = r0((goodKg * rate) / (100 - rate));
    const meltKg = r0((goodKg + defectKg) / l.yieldR / n("y" + l.line, 0.008));
    const t = l.line === "FCMX" && trouble ? trouble : undefined;
    const hours = r0(goodKg / 1000 / (l.tph * (t?.tph ?? 1) * n("h" + l.line, 0.02)));
    return { line: l.line, days: WORKDAYS[mi] + (t?.days ?? 0), hours, meltKg, goodKg, defectKg };
  });
  const meltKg = production.reduce((s, r) => s + (r.meltKg as number), 0);
  const goodKg = production.reduce((s, r) => s + (r.goodKg as number), 0);

  // --- 材料（不良は社内で再溶解するので、不良が増えると溶解量・コークス・砂が増える） ---
  const metalKg = goodKg + meltKg * 0.03;
  const material: Row[] = MATERIALS.map((m) => {
    const baseKg = m.per === "metal" ? metalKg : m.per === "melt" ? meltKg : goodKg;
    const qtyKg = r0(baseKg * m.ratio * n("q" + m.item, 0.012));
    const price = typeof m.price === "string" ? market(m.price, ym, sc) : m.price * (1 + (fy - 2025) * 0.02) * n("mp" + m.item, 0.01);
    return { item: m.item, category: m.category, qtyKg, amount: r3(qtyKg * price) };
  });

  // --- 経費 ---
  const elec = market("elec", ym, sc), goodT = goodKg / 1000, machT = machinedKg / 1000;
  const outsource = act ? ({ "2026-09": 1.15, "2026-10": 1.08 } as Record<string, number>)[ym] ?? 1 : 1; // FCMX停止分の外注振替
  const repair = act ? ({ "2026-09": 9_000_000, "2026-10": 6_000_000, "2026-11": 1_000_000 } as Record<string, number>)[ym] ?? 0 : 0;
  const dep = fy === 2026 ? 2_000_000 : fy === 2024 ? -1_500_000 : 0;
  const cost = 1 + (fy - 2025) * 0.015;
  const E = (dept: string, account: string, cls: string, amount: number, amp = 0.02) =>
    ({ dept, account, cls, amount: r3(amount * n(dept + account, amp)) });
  const expense: Row[] = [
    E("関工場", "電力費", "変動", (goodT * 640 + (meltKg / 1000) * 60 + 180_000) * elec, 0.01),
    E("大平工場", "電力費", "変動", (machT * 220 + 60_000) * elec, 0.01),
    E("本社・管理", "電力費", "変動", 15_000 * elec, 0.01),
    E("関工場", "外注加工費", "変動", goodT * 9_500 * cost * outsource),
    E("大平工場", "外注加工費", "変動", machT * 55_000 * cost),
    E("関工場", "消耗工具費", "変動", goodT * 5_200 * cost, 0.04),
    E("大平工場", "消耗工具費", "変動", machT * 11_000 * cost, 0.04),
    E("大平工場", "荷造運賃", "変動", (soldKg / 1000) * 8_300 * cost),
    E("関工場", "減価償却費", "固定", 34_000_000 + dep, 0),
    E("大平工場", "減価償却費", "固定", 11_000_000, 0),
    E("本社・管理", "減価償却費", "固定", 1_500_000, 0),
    E("関工場", "修繕費", "固定", 12_000_000 * cost + repair, 0.12),
    E("大平工場", "修繕費", "固定", 3_500_000 * cost, 0.12),
    E("本社・管理", "修繕費", "固定", 300_000, 0.12),
    E("関工場", "賃借料", "固定", 2_500_000, 0),
    E("大平工場", "賃借料", "固定", 2_000_000, 0),
    E("本社・管理", "賃借料", "固定", 1_500_000, 0),
    E("関工場", "租税公課・保険料", "固定", 4_500_000, 0.01),
    E("大平工場", "租税公課・保険料", "固定", 2_000_000, 0.01),
    E("本社・管理", "租税公課・保険料", "固定", 1_500_000, 0.01),
    E("関工場", "産廃処理費", "固定", (meltKg / 1000) * 2_300 * cost, 0.03),
    E("大平工場", "産廃処理費", "固定", 500_000 * cost, 0.03),
    E("本社・管理", "研究開発費", "固定", 5_000_000 * cost, 0.06),
    E("関工場", "その他経費", "固定", 14_000_000 * cost, 0.04),
    E("大平工場", "その他経費", "固定", 7_000_000 * cost, 0.04),
    E("本社・管理", "その他経費", "固定", 25_000_000 * cost, 0.04),
  ];

  // --- 人件費・勤怠（鋳造は採用未達、故障後は残業と検査の応援が増える） ---
  const load = soldKg / 1000 / 1700;
  const labor: Row[] = LABOR.map((l) => {
    let head = l.head + (fy === 2024 ? -1 : 0), ot = l.ot * (0.4 + 0.6 * load) * n("ot" + l.dept, 0.05);
    if (l.dept === "関工場 鋳造") {
      if (fy === 2026) head = act ? (ym >= "2026-10" ? 61 : 60) : 63;
      if (act) ot *= ({ "2026-09": 1.35, "2026-10": 1.45, "2026-11": 1.15 } as Record<string, number>)[ym] ?? 1;
    }
    if (l.dept === "関工場 仕上・検査" && act) {
      head += ({ "2026-09": 1, "2026-10": 2, "2026-11": 2 } as Record<string, number>)[ym] ?? 0;
      ot *= ({ "2026-09": 1.2, "2026-10": 1.25, "2026-11": 1.1 } as Record<string, number>)[ym] ?? 1;
    }
    const overtimeH = r0(ot);
    return { dept: l.dept, headcount: head, overtimeH, amount: r3(head * l.base * WAGE[fy] + overtimeH * OT_RATE * WAGE[fy]) };
  });

  return { sales, production, material, expense, labor };
}

/** 初期データ一式（予算は年度末まで、実績は actualTo まで）。 */
export function sampleDatasets(actualTo = SAMPLE_ACTUAL_TO): Dataset[] {
  const out: Dataset[] = [];
  for (const ym of ymRange(SAMPLE_FROM, SAMPLE_BUDGET_TO)) {
    for (const scenario of ["budget", "actual"] as Scenario[]) {
      if (scenario === "actual" && ym > actualTo) continue;
      const month = generateMonth(ym, scenario);
      for (const kind of KIND_ORDER) out.push({ kind, scenario, ym, rows: month[kind] });
    }
  }
  return out;
}
