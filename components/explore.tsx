"use client";
// 切り口分析。指標・軸・比較・期間を選ぶだけで集計を切り替える。行を押すとその値で絞り込んで次の軸へ進む。
import { useMemo } from "react";
import { AXES, BASIS_LABEL, type Basis, MEASURES, compare, measure, measureOf, members, slices } from "@/lib/analytics";
import { type ExploreSpec, useApp } from "@/lib/client";
import { fmt, signed, tone } from "@/lib/format";
import { type Kind, ymAdd, ymLabel, ymRange, ymShort } from "@/lib/model";
import { Bullet, DiffBar, TrendChart } from "./charts";

const PRESETS: { label: string; spec: Partial<ExploreSpec> }[] = [
  { label: "得意先別の売上", spec: { measure: "sales", axis: "customer", span: "month" } },
  { label: "分野別の売上（年度累計）", spec: { measure: "sales", axis: "segment", span: "ytd" } },
  { label: "得意先別の販売単価", spec: { measure: "price", axis: "customer", span: "month" } },
  { label: "品目群別の販売重量", spec: { measure: "weight", axis: "product", span: "month" } },
  { label: "販売単価の推移（分野別）", spec: { measure: "price", axis: "segment", span: "trend" } },
  { label: "ライン別の不良率の推移", spec: { measure: "defectRate", axis: "line", span: "trend" } },
  { label: "材料単価の推移", spec: { measure: "matPrice", axis: "item", span: "trend" } },
  { label: "科目別の経費", spec: { measure: "expense", axis: "account", span: "month" } },
  { label: "部門別の残業時間", spec: { measure: "overtime", axis: "dept", span: "month" } },
  { label: "kg当たり材料費の推移", spec: { measure: "matPerKg", axis: "", span: "trend" } },
  { label: "営業利益の推移", spec: { measure: "op", axis: "", span: "trend" } },
];
const GROUPS: [string, (k: Kind | "pl") => boolean][] = [
  ["売上", (k) => k === "sales"], ["生産", (k) => k === "production"], ["材料", (k) => k === "material"],
  ["経費・人件費", (k) => k === "expense" || k === "labor"], ["損益・kg当たり", (k) => k === "pl"],
];
const COLORS = ["#1d3d78", "#c77700", "#1a7f4b", "#7a4fa3", "#c70020", "#3d8fb5", "#8a6d3b", "#5f6b7a"];

export default function Explore() {
  const { store: st, ym, explore: spec, set } = useApp();
  const m = measureOf(spec.measure), axis = m.axes.includes(spec.axis) ? spec.axis : "";
  const up = (p: Partial<ExploreSpec>) => set({ explore: { ...spec, ...p, title: undefined } });
  const basis: Basis = spec.span === "ytd" && spec.basis === "pm" ? "budget" : spec.basis;
  const filters = useMemo(() => Object.fromEntries(Object.entries(spec.filters).filter(([k, v]) => m.axes.includes(k) && v.length)), [spec.filters, m]);
  const bl = BASIS_LABEL[basis];

  const table = useMemo(() => {
    if (spec.span === "trend") return null;
    const { cur, base } = slices(ym, spec.span, basis);
    return compare(st, m.key, axis, cur, base, filters);
  }, [st, ym, spec.span, basis, m, axis, filters]);
  const trend = useMemo(() => {
    if (spec.span !== "trend") return null;
    const months = ymRange(ymAdd(ym, -23), ym).filter((x) => measure(st, m, { sc: "actual", yms: [x] }, "", filters).size > 0 || m.kind === "pl");
    const per = months.map((x) => ({ a: measure(st, m, { sc: "actual", yms: [x] }, axis, filters), b: measure(st, m, { sc: "budget", yms: [x] }, axis, filters) }));
    const last = per[per.length - 1]?.a ?? new Map<string, number>();
    const names = [...last.keys()].sort((x, y) => Math.abs(last.get(y) ?? 0) - Math.abs(last.get(x) ?? 0));
    return { months, per, names };
  }, [st, ym, spec.span, m, axis, filters]);

  const drill = (name: string) => {
    if (!axis) return;
    const next = m.axes.find((a) => a !== axis && !filters[a]);
    up({ filters: { ...spec.filters, [axis]: [name] }, axis: next ?? axis });
  };
  const max = table ? Math.max(...table.map((r) => Math.max(Math.abs(r.a), Math.abs(r.b))), 1e-9) : 0;
  const maxDiff = table ? Math.max(...table.map((r) => Math.abs(r.diff)), 1e-9) : 0;
  const additive = !m.den && !m.calc;

  return (
    <div className="explore">
      <section className="panel">
        <div className="panel-head"><h2>切り口分析</h2><span className="sub">見たい数字と分け方を選ぶと、すぐに集計が切り替わります。表の行を押すと、その値に絞ってさらに分けられます。</span></div>
        <div className="presets"><span className="lbl">よく使う切り口</span>{PRESETS.map((p) => <button key={p.label} className="chip" onClick={() => set({ explore: { ...spec, basis, filters: {}, ...p.spec } as ExploreSpec })}>{p.label}</button>)}</div>
        <div className="controls">
          <label className="field"><span>見る数字</span>
            <select value={m.key} onChange={(e) => up({ measure: e.target.value })}>
              {GROUPS.map(([g, f]) => <optgroup key={g} label={g}>{MEASURES.filter((x) => f(x.kind)).map((x) => <option key={x.key} value={x.key}>{x.label}（{x.unit}）</option>)}</optgroup>)}
            </select></label>
          <div className="field"><span>分け方</span>
            <div className="seg">{m.axes.length === 0 ? <span className="mute">この数字は全社合計のみ</span> : <>
              <button className={!axis ? "on" : ""} onClick={() => up({ axis: "" })}>合計</button>
              {m.axes.map((a) => <button key={a} className={axis === a ? "on" : ""} onClick={() => up({ axis: a })}>{AXES[a]}</button>)}</>}</div></div>
          <div className="field"><span>期間</span>
            <div className="seg">{([["month", "単月"], ["ytd", "年度累計"], ["trend", "推移（24か月）"]] as const).map(([k, l]) => <button key={k} className={spec.span === k ? "on" : ""} onClick={() => up({ span: k })}>{l}</button>)}</div></div>
          {spec.span !== "trend" && <div className="field"><span>比較</span>
            <div className="seg">{(["budget", "py", "pm"] as const).map((b) => <button key={b} disabled={b === "pm" && spec.span === "ytd"} className={basis === b ? "on" : ""} onClick={() => up({ basis: b })}>{BASIS_LABEL[b]}</button>)}</div></div>}
        </div>
        {m.axes.length > 0 && (
          <div className="filters"><span className="lbl">絞り込み</span>
            {m.axes.map((a) => (
              <select key={a} value={filters[a]?.[0] ?? ""} className={filters[a] ? "on" : ""} aria-label={`${AXES[a]}で絞り込み`}
                onChange={(e) => up({ filters: { ...spec.filters, [a]: e.target.value ? [e.target.value] : [] } })}>
                <option value="">{AXES[a]}：すべて</option>{members(st, m.kind as Kind, a).sort().map((v) => <option key={v}>{v}</option>)}
              </select>
            ))}
            {Object.keys(filters).length > 0 && <button className="link" onClick={() => up({ filters: {} })}>絞り込みを解除</button>}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head"><h2>{spec.title ?? `${axis ? AXES[axis] + "別の" : ""}${m.label}`}</h2>
          <span className="sub">{spec.span === "trend" ? `${ymLabel(trend!.months[0] ?? ym)}〜${ymLabel(ym)}` : spec.span === "ytd" ? `年度累計（〜${ymLabel(ym)}）・${bl}比` : `${ymLabel(ym)}度・${bl}比`}・単位 {m.unit}
            {Object.entries(filters).map(([k, v]) => `・${AXES[k]}＝${v.join("、")}`)}</span></div>
        {table && (table.length === 0 ? <p className="empty">この条件のデータはありません。</p> : (
          <table className="tbl">
            <thead><tr><th>{axis ? AXES[axis] : "全社"}</th><th className="n">実績</th><th className="n">{bl}</th><th className="barcol wide">実績（棒）と{bl}（線）</th><th className="n">差</th><th className="n">{bl}比</th><th className="barcol" /></tr></thead>
            <tbody>{table.map((r) => (
              <tr key={r.name} className={axis ? "click" : ""} onClick={() => drill(r.name)} title={axis ? "押すと、この値で絞り込みます" : undefined}>
                <th>{r.name || "合計"}</th><td className="n">{fmt(r.a, m.digits)}</td><td className="n mute">{r.hasBase ? fmt(r.b, m.digits) : "—"}</td>
                <td className="barcol wide"><Bullet value={r.a} base={r.b} max={max} /></td>
                <td className={`n ${tone(r.diff, m.good)}`}>{r.hasBase ? signed(r.diff, m.digits) : "—"}</td><td className="n">{r.hasBase && m.unit !== "%" ? fmt(r.rate, 1) + "%" : "—"}</td>
                <td className="barcol"><DiffBar value={r.diff} max={maxDiff} tone={tone(r.diff, m.good)} /></td>
              </tr>))}</tbody>
            {additive && axis && table.length > 1 && (() => { const a = table.reduce((s, r) => s + r.a, 0), b = table.reduce((s, r) => s + r.b, 0); return (
              <tfoot><tr><th>合計</th><td className="n">{fmt(a, m.digits)}</td><td className="n mute">{fmt(b, m.digits)}</td><td /><td className={`n ${tone(a - b, m.good)}`}>{signed(a - b, m.digits)}</td><td className="n">{b ? fmt((a / b) * 100, 1) + "%" : "—"}</td><td /></tr></tfoot>); })()}
          </table>
        ))}
        {trend && (trend.names.length === 0 ? <p className="empty">この条件のデータはありません。</p> : <>
          <TrendChart labels={trend.months.map(ymShort)} unit={m.unit} digits={m.digits} zero={additive} height={300}
            lines={axis
              ? trend.names.slice(0, 8).map((name, i) => ({ name, color: COLORS[i], values: trend.per.map((p) => p.a.get(name) ?? null) }))
              : [{ name: "実績", color: COLORS[0], values: trend.per.map((p) => p.a.get("") ?? null) }, { name: "予算", color: COLORS[1], dash: true, values: trend.per.map((p) => p.b.get("") ?? null) }]} />
          <div className="scroll-x"><table className="tbl compact">
            <thead><tr><th>{axis ? AXES[axis] : ""}</th>{trend.months.map((x) => <th key={x} className="n">{ymShort(x)}</th>)}</tr></thead>
            <tbody>
              {(axis ? trend.names : [""]).map((name) => <tr key={name} className={axis ? "click" : ""} onClick={() => drill(name)}><th className="nowrap">{name || "実績"}</th>{trend.per.map((p, i) => <td key={i} className="n">{p.a.has(name) ? fmt(p.a.get(name)!, m.digits) : "—"}</td>)}</tr>)}
              {!axis && <tr><th>予算</th>{trend.per.map((p, i) => <td key={i} className="n mute">{p.b.has("") ? fmt(p.b.get("")!, m.digits) : "—"}</td>)}</tr>}
            </tbody>
          </table></div>
        </>)}
      </section>
    </div>
  );
}
