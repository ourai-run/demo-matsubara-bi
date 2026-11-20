"use client";
// 年度の着地見込みと試算。残りの月の前提（重量・単価・材料・経費）を動かして、年度の営業利益がどう変わるかを見る。
import { useMemo, useState } from "react";
import { ADJ0, type Adj, landing } from "@/lib/analytics";
import { useApp } from "@/lib/client";
import { fmt, mil, milSigned, signed, tone } from "@/lib/format";
import { fyOf, ymLabel, ymShort } from "@/lib/model";
import { TrendChart } from "./charts";

const SLIDERS: { key: keyof Adj; label: string; hint: string; good: number }[] = [
  { key: "weight", label: "販売重量", hint: "受注の増減", good: 1 },
  { key: "price", label: "販売単価", hint: "価格改定・スライドの反映", good: 1 },
  { key: "material", label: "kg当たり材料費", hint: "鋼屑・銑鉄・コークスの市況、歩留", good: -1 },
  { key: "varExp", label: "kg当たり変動経費", hint: "電力単価・外注・運賃", good: -1 },
  { key: "labor", label: "人件費", hint: "人員・残業", good: -1 },
  { key: "fixed", label: "固定費", hint: "修繕・償却など", good: -1 },
];
const PRESETS: { label: string; adj: Partial<Adj> }[] = [
  { label: "鋼屑がさらに1割上がる", adj: { material: 3.5 } },
  { label: "全得意先に1%の値上げが通る", adj: { price: 1 } },
  { label: "自動車向けが5%減る", adj: { weight: -3 } },
  { label: "受注が予算並みに戻る", adj: { weight: 2 } },
  { label: "電力単価が1割上がる", adj: { varExp: 3.3 } },
  { label: "残業と修繕を抑える", adj: { labor: -1.5, fixed: -2 } },
];

export default function Forecast() {
  const { store: st, ym } = useApp();
  const [adj, setAdj] = useState<Adj>(ADJ0);
  const base = useMemo(() => landing(st, ym), [st, ym]);
  const sim = useMemo(() => landing(st, ym, adj), [st, ym, adj]);
  const changed = Object.values(adj).some((v) => v !== 0), rest = sim.months.filter((m) => !m.actual).length;
  const k = base.k;
  return (
    <div className="forecast">
      <section className="panel">
        <div className="panel-head"><h2>{fyOf(ym)}年度の着地見込み</h2><span className="sub">{ymLabel(ym)}までは実績、残り{rest}か月は見込み。百万円</span></div>
        <div className="tiles three">
          <div className="tile"><div className="tile-label">年度予算（営業利益）</div><div className="tile-value">{mil(base.budgetOp)}<small>百万円</small></div><div className="tile-sub"><span>売上高 {mil(base.budgetSales)}</span></div></div>
          <div className="tile"><div className="tile-label">いまの傾向が続いた場合</div><div className="tile-value">{mil(base.op)}<small>百万円</small></div>
            <div className={`tile-diff ${tone(base.op - base.budgetOp, 1)}`}>予算比 {milSigned(base.op - base.budgetOp)}</div><div className="tile-sub"><span>売上高 {mil(base.sales)}</span></div></div>
          <div className={`tile${changed ? " hl" : ""}`}><div className="tile-label">前提を変えた場合（試算）</div><div className="tile-value">{mil(sim.op)}<small>百万円</small></div>
            <div className={`tile-diff ${tone(sim.op - base.op, 1)}`}>いまの見込み比 {milSigned(sim.op - base.op)}／予算比 {milSigned(sim.op - sim.budgetOp)}</div><div className="tile-sub"><span>売上高 {mil(sim.sales)}</span></div></div>
        </div>
        <p className="cap">見込みの前提：残りの月は、直近3か月の実績の傾向（販売重量は予算の {fmt(k.weight * 100, 1)}%、販売単価は予算の {fmt(k.price * 100, 1)}%、材料費 {fmt(k.matPerKg, 1)}円/kg、変動経費 {fmt(k.varPerKg, 1)}円/kg、人件費は予算の {fmt(k.labor * 100, 1)}%、固定費は予算の {fmt(k.fixed * 100, 1)}%）が続くとして計算しています。</p>
      </section>

      <section className="panel">
        <div className="panel-head"><h2>前提を変えて試算する</h2><span className="sub">残り{rest}か月について、いまの見込みからの増減（%）を動かします</span>
          {changed && <button className="btn right" onClick={() => setAdj(ADJ0)}>元に戻す</button>}</div>
        <div className="presets"><span className="lbl">よくある想定</span>{PRESETS.map((p) => <button key={p.label} className="chip" onClick={() => setAdj({ ...ADJ0, ...p.adj })}>{p.label}</button>)}</div>
        <div className="sliders">
          {SLIDERS.map((s) => (
            <label key={s.key} className="slider">
              <span className="slider-label"><b>{s.label}</b><small>{s.hint}</small></span>
              <input type="range" min={-15} max={15} step={0.5} value={adj[s.key]} onChange={(e) => setAdj({ ...adj, [s.key]: Number(e.target.value) })} />
              <span className={`slider-val ${tone(adj[s.key], s.good)}`}>{signed(adj[s.key], 1)}%</span>
            </label>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h2>月ごとの営業利益</h2><span className="sub">濃い棒は実績、薄い棒は{changed ? "試算" : "見込み"}</span></div>
        <TrendChart labels={sim.months.map((m) => ymShort(m.ym))} unit="百万円" digits={1} height={260} soft={sim.months.map((m) => !m.actual)}
          bars={{ name: changed ? "実績・試算" : "実績・見込み", color: "var(--navy)", values: sim.months.map((m) => m.op / 1e6) }}
          lines={[{ name: "予算", color: "var(--warn)", values: sim.months.map((m) => m.budgetOp / 1e6) },
            ...(changed ? [{ name: "いまの見込み", color: "var(--ink3)", dash: true, values: base.months.map((m) => (m.actual ? null : m.op / 1e6)) }] : [])]} />
        <div className="scroll-x"><table className="tbl compact">
          <thead><tr><th />{sim.months.map((m) => <th key={m.ym} className="n">{ymShort(m.ym)}{m.actual ? "" : "＊"}</th>)}<th className="n">年度計</th></tr></thead>
          <tbody>
            <tr><th>売上高</th>{sim.months.map((m) => <td key={m.ym} className={`n${m.actual ? "" : " mute"}`}>{mil(m.sales)}</td>)}<td className="n"><b>{mil(sim.sales)}</b></td></tr>
            <tr><th>売上高（予算）</th>{sim.months.map((m) => <td key={m.ym} className="n mute">{mil(m.budgetSales)}</td>)}<td className="n">{mil(sim.budgetSales)}</td></tr>
            <tr><th>営業利益</th>{sim.months.map((m) => <td key={m.ym} className={`n${m.actual ? "" : " mute"}`}>{mil(m.op)}</td>)}<td className="n"><b>{mil(sim.op)}</b></td></tr>
            <tr><th>営業利益（予算）</th>{sim.months.map((m) => <td key={m.ym} className="n mute">{mil(m.budgetOp)}</td>)}<td className="n">{mil(sim.budgetOp)}</td></tr>
            <tr><th>販売重量 t</th>{sim.months.map((m) => <td key={m.ym} className={`n${m.actual ? "" : " mute"}`}>{fmt(m.weightKg / 1000)}</td>)}<td className="n">{fmt(sim.months.reduce((s, m) => s + m.weightKg, 0) / 1000)}</td></tr>
          </tbody>
        </table></div>
        <p className="cap">＊は見込みの月。</p>
      </section>
    </div>
  );
}
