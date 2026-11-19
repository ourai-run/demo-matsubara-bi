// 計算と取込の要所の確認。npm test で実行。
import test from "node:test";
import assert from "node:assert/strict";
import { closedMonths, factPack, pl, slices, toStore, waterfall } from "../lib/analytics.ts";
import { KIND_ORDER, dsKey } from "../lib/model.ts";
import { alignNames, decodeCsv, interpret, parseCsv, parseNum, parseYm } from "../lib/parse.ts";
import { SAMPLE_ACTUAL_TO, SAMPLE_NEXT, generateMonth, sampleDatasets } from "../lib/sample.ts";
import { sampleFiles, toCsv } from "../lib/sample-files.ts";

const ds = sampleDatasets(), st = toStore(ds), months = closedMonths(ds);

test("サンプルデータ：実績は最終月まで5種類そろい、年度末まで予算がある", () => {
  assert.equal(months[0], SAMPLE_ACTUAL_TO);
  assert.equal(months.length, 31); // 2024年4月〜2026年10月
  for (const k of KIND_ORDER) { assert.ok(st.has(dsKey(k, "budget", "2027-03")), k); assert.ok(!st.has(dsKey(k, "actual", SAMPLE_NEXT)), k); }
});

test("営業利益の差異分解：どの月・期間・比較でも、要因の合計が営業利益の差と一致する", () => {
  let checked = 0;
  for (const ym of months) for (const span of ["month", "ytd"] as const) for (const basis of ["budget", "py", "pm"] as const) {
    const { cur, base } = slices(ym, span, basis);
    if (base.yms.some((y) => KIND_ORDER.some((k) => !st.has(dsKey(k, base.sc, y))))) continue;
    const wf = waterfall(st, cur, base), sum = wf.steps.reduce((a, s) => a + s.effect, 0);
    assert.ok(Math.abs(wf.baseOp + sum - wf.curOp) < 1, `${ym} ${span} ${basis}: ${wf.baseOp} + ${sum} != ${wf.curOp}`);
    assert.ok(Math.abs(wf.curOp - pl(st, cur).op) < 1 && Math.abs(wf.baseOp - pl(st, base).op) < 1);
    checked++;
  }
  assert.ok(checked > 150, `checked ${checked}`);
});

test("AIに渡す数値：置き場所(anchor)に重複がなく、1回の呼び出しに収まる大きさ", () => {
  const { pack, anchors } = factPack(st, SAMPLE_ACTUAL_TO);
  assert.equal(new Set(anchors).size, anchors.length);
  assert.ok(anchors.includes("mat:鋼屑") && anchors.includes("line:FCMX"));
  assert.ok(JSON.stringify(pack).length < 60_000);
});

test("年月の読み取り", () => {
  for (const [v, want] of [["2026年11月", "2026-11"], ["2026/11", "2026-11"], ["売上_202611.xlsx", "2026-11"], ["jinkenhi_R8.11.xlsx", "2026-11"], ["令和8年4月度", "2026-04"],
    ["２０２６年１月", "2026-01"], ["2026-11-30", "2026-11"], ["合計", ""], ["12345678", ""]] as const) assert.equal(parseYm(v), want, v);
  assert.equal(parseYm(new Date(2026, 10, 1)), "2026-11");
  assert.equal(parseYm(46327), "2026-11"); // Excelの日付の通し番号（2026/11/1）
});

test("数字の読み取り", () => {
  assert.equal(parseNum("1,234,500"), 1234500); assert.equal(parseNum("▲1,200"), -1200); assert.equal(parseNum("(300)"), -300);
  assert.equal(parseNum("¥5,000円"), 5000); assert.equal(parseNum("１２３"), 123); assert.equal(parseNum(""), 0); assert.ok(Number.isNaN(parseNum("未定")));
});

test("取込用サンプルファイル：5つとも種類・年月を見分け、元の数字どおりに読める", () => {
  const want = generateMonth(SAMPLE_NEXT, "actual");
  for (const f of sampleFiles(SAMPLE_NEXT)) {
    const table = f.name.endsWith(".csv") ? parseCsv(toCsv(f.table).replace(/^﻿/, "")) : f.table;
    const p = interpret(f.name, "Sheet1", table);
    assert.ok(!p.error, f.name + p.error); assert.equal(p.kind, f.kind, f.name);
    const rows = p.months[`actual|${SAMPLE_NEXT}`];
    assert.equal(rows.length, want[f.kind].length, f.name); // 合計の行は入らない
    const key = { sales: "amount", production: "goodKg", material: "amount", expense: "amount", labor: "amount" }[f.kind];
    const sum = (list: Record<string, string | number>[]) => list.reduce((a, r) => a + Number(r[key]), 0);
    assert.ok(Math.abs(sum(rows) - sum(want[f.kind])) < 1, `${f.name}: ${sum(rows)} != ${sum(want[f.kind])}`); // t・千円からの換算も含めて一致
  }
});

test("取込：予算と実績が混ざった表を分け、読めない行と合計の行は入れない", () => {
  const p = interpret("経費.csv", "", [["年月", "予実", "部門", "勘定科目", "金額(千円)"],
    ["2026/12", "予算", "関工場 鋳造", "修繕費", "9,000"], ["2026/12", "実績", "関工場 鋳造", "修繕費", "9,500"], ["2026/12", "実績", "関工場 鋳造", "電力費", "未定"], ["合計", "", "", "", "18,500"]]);
  assert.equal(p.kind, "expense");
  assert.deepEqual(Object.keys(p.months).sort(), ["actual|2026-12", "budget|2026-12"]);
  assert.equal(p.months["actual|2026-12"].length, 1); assert.equal(p.months["actual|2026-12"][0].amount, 9_500_000);
  assert.ok(p.warnings.some((w) => w.includes("数字として読めない")));
  assert.equal(interpret("メモ.csv", "", [["品名", "備考"], ["a", "b"]]).kind, null); // 見分けられない表は種類なし（画面側でAIに列を見分けてもらう）
});

test("取込：AIが見分けた列の対応で読む。見出しに単位（トン・千円）があれば換算する", () => {
  const p = interpret("shukka_list.xlsx", "", [["計上年月", "相手先", "マーケット", "アイテム", "出荷トン数", "請求額（千円）"], ["2026/12", "エクセディ", "自動車", "クラッチ部品", 310.5, 84200]],
    { mapping: { kind: "sales", columns: { customer: "相手先", segment: "マーケット", product: "アイテム", weightKg: "出荷トン数", amount: "請求額（千円）" }, ymColumn: "計上年月" } });
  const r = p.months["actual|2026-12"][0];
  assert.equal(r.weightKg, 310_500); assert.equal(r.amount, 84_200_000); assert.equal(r.customer, "エクセディ");
});

test("名称の表記ゆれ：全角・半角だけが違う名称は取込済みの表記にそろえる", () => {
  const rows = [{ item: "中子(シェル砂)" }, { item: "ｺｰｸｽ" }, { item: "新材料" }];
  alignNames(rows, "item", ["中子（シェル砂）", "コークス"]);
  assert.deepEqual(rows.map((r) => r.item), ["中子（シェル砂）", "コークス", "新材料"]);
});

test("CSV：Shift_JIS と、引用符・改行入りのセルを読める", () => {
  assert.equal(decodeCsv(new Uint8Array([0x94, 0x84, 0x8f, 0xe3]).buffer), "売上");
  assert.equal(decodeCsv(new TextEncoder().encode("売上").buffer as ArrayBuffer), "売上");
  assert.deepEqual(parseCsv('a,"b,1","c\n""d"""\r\ne,f,g\r\n'), [["a", "b,1", 'c\n"d"'], ["e", "f", "g"]]);
});
