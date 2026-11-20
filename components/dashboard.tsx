"use client";
// 月次ダッシュボード。数字の横に、AIの示唆を「どの数字についてか」が分かる位置（番号）で置く。
import { useMemo, useState } from "react";
import { BASIS_LABEL, type PL, type Slice, compare, derived, landing, measure, measureOf, pl, slices, waterfall } from "@/lib/analytics";
import { type ExploreSpec, useApp } from "@/lib/client";
import { dateTime, fmt, mil, milSigned, rate, signed, tone } from "@/lib/format";
import { type Insight, KIND_ORDER, KINDS, dsKey, fyOf, ymAdd, ymLabel, ymRange, ymShort } from "@/lib/model";
import { DiffBar, Notes, Pins, Spark, TrendChart, WaterfallChart } from "./charts";

type CmpRow = ReturnType<typeof compare>[number];

function Section({ title, sub, more, notes, extra, children }: { title: string; sub?: string; more?: { label: string; spec: Partial<ExploreSpec> }; notes?: string[]; extra?: Insight[]; children: React.ReactNode }) {
  const { openExplore } = useApp();
  return (
    <section className="panel">
      <div className="panel-head"><h2>{title}</h2>{sub && <span className="sub">{sub}</span>}
        {more && <button className="link right" onClick={() => openExplore(more.spec)}>{more.label} →</button>}</div>
      <div className="panel-body"><div className="panel-main">{children}</div>{notes && <Notes prefixes={notes} extra={extra} />}</div>
    </section>
  );
}

/** 名前｜当期｜基準｜差｜率｜棒 の表。 */
function Cmp({ head, rows, baseLabel, digits = 1, good, anchor, unit }: { head: string; rows: CmpRow[]; baseLabel: string; digits?: number; good: number; anchor: string; unit: string }) {
  const max = Math.max(...rows.map((r) => Math.abs(r.diff)), 1e-9);
  const sum = rows.reduce((s, r) => ({ a: s.a + r.a, b: s.b + r.b }), { a: 0, b: 0 });
  return (
    <table className="tbl">
      <thead><tr><th>{head}</th><th className="n">実績</th><th className="n">{baseLabel}</th><th className="n">差</th><th className="n">{baseLabel}比</th><th className="barcol" /></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name}>
            <th>{r.name}<Pins anchor={`${anchor}:${r.name}`} /></th>
            <td className="n">{fmt(r.a, digits)}</td><td className="n mute">{r.hasBase ? fmt(r.b, digits) : "—"}</td>
            <td className={`n ${tone(r.diff, good)}`}>{r.hasBase ? signed(r.diff, digits) : "—"}</td>
            <td className="n">{r.hasBase ? fmt(r.rate, 1) + "%" : "—"}</td>
            <td className="barcol"><DiffBar value={r.diff} max={max} tone={tone(r.diff, good)} /></td>
          </tr>
        ))}
      </tbody>
      <tfoot><tr><th>合計</th><td className="n">{fmt(sum.a, digits)}</td><td className="n mute">{fmt(sum.b, digits)}</td><td className={`n ${tone(sum.a - sum.b, good)}`}>{signed(sum.a - sum.b, digits)}</td><td className="n">{fmt(rate(sum.a, sum.b), 1)}%</td><td className="unit">{unit}</td></tr></tfoot>
    </table>
  );
}

/** 販売重量と営業利益の関係（月ごとの点）。重量が損益分岐を超えると利益が出る構造を見る。 */
function WeightProfit({ points, bepT }: { points: { ym: string; t: number; op: number; cur: boolean }[]; bepT: number }) {
  const W = 440, H = 230, l = 44, r = 24, t = 12, b = 30; // r は右端の目盛り（1,950t など）が切れない幅
  const xs = points.map((p) => p.t), ys = points.map((p) => p.op);
  const x0 = Math.floor(Math.min(...xs, bepT) / 100) * 100 - 50, x1 = Math.ceil(Math.max(...xs) / 100) * 100 + 50;
  const y0 = Math.floor(Math.min(...ys, 0) / 20) * 20, y1 = Math.ceil(Math.max(...ys) / 20) * 20;
  const x = (v: number) => l + ((v - x0) / (x1 - x0)) * (W - l - r), y = (v: number) => t + ((y1 - v) / (y1 - y0)) * (H - t - b);
  return (
    <div className="chart"><svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="販売重量と営業利益の関係">
      {[y0, 0, y1].map((v) => <g key={v}><line x1={l} x2={W - r} y1={y(v)} y2={y(v)} className={v === 0 ? "zero" : "grid"} /><text x={l - 6} y={y(v) + 4} className="tick end">{fmt(v)}</text></g>)}
      {[x0, x1].map((v) => <text key={v} x={x(v)} y={H - 10} className="lab">{fmt(v)}t</text>)}
      {bepT > x0 && bepT < x1 && <g><line x1={x(bepT)} x2={x(bepT)} y1={t} y2={H - b} className="bep" /><text x={x(bepT) + 4} y={t + 10} className="tick">損益分岐 {fmt(bepT)}t</text></g>}
      {points.map((p) => <circle key={p.ym} cx={x(p.t)} cy={y(p.op)} r={p.cur ? 6 : 3.5} className={p.cur ? "dot cur" : fyOf(p.ym) === fyOf(points[points.length - 1].ym) ? "dot fy" : "dot"}><title>{`${ymLabel(p.ym)} ${fmt(p.t)}t 営業利益${fmt(p.op, 1)}百万円`}</title></circle>)}
      <text x={(l + W - r) / 2} y={H - 10} className="tick lab">販売重量 →</text><text x={l} y={t + 2} className="tick">↑営業利益（百万円）</text>
    </svg></div>
  );
}

export default function Dashboard() {
  const app = useApp(), { store: st, ym, span, basis, analysis, monthInsights } = app;
  const [step, setStep] = useState("");
  const [showSup, setShowSup] = useState(false);
  const d = useMemo(() => {
    const { cur, base } = slices(ym, span, basis);
    const other = (["budget", "py", "pm"] as const).filter((b) => b !== basis && !(b === "pm" && span === "ytd")).map((b) => ({ b, p: pl(st, slices(ym, span, b).base) }));
    const wf = waterfall(st, cur, base), months = ymRange(ymAdd(ym, -12), ym);
    const one = (sc: "actual" | "budget", m: string): Slice => ({ sc, yms: [m] });
    const series = (key: string, axis: string, name: string) => months.map((m) => measure(st, measureOf(key), one("actual", m), axis).get(name) ?? 0);
    const A = pl(st, cur), bep = (A.labor + A.fixed) / ((A.marginal / A.weightKg) || 1) / 1000 / cur.yms.length;
    return {
      cur, base, A, B: pl(st, base), other, wf, months, series, land: landing(st, ym), bep,
      mp: months.map((m) => ({ ym: m, a: pl(st, one("actual", m)), b: pl(st, one("budget", m)), py: pl(st, one("actual", ymAdd(m, -12))) })),
      scatter: ymRange(ymAdd(ym, -23), ym).map((m) => ({ ym: m, p: pl(st, one("actual", m)) })).filter((x) => x.p.has).map((x) => ({ ym: x.ym, t: x.p.weightKg / 1000, op: x.p.op / 1e6, cur: x.ym === ym })),
      missing: KIND_ORDER.filter((k) => !st.has(dsKey(k, "actual", ym))),
    };
  }, [st, ym, span, basis]);
  const { cur, base, A, B, wf } = d, bl = BASIS_LABEL[basis], dA = derived(A), dB = derived(B);
  const sel = wf.steps.find((s) => s.key === step) ?? [...wf.steps].sort((a, b) => a.effect - b.effect)[0];
  const C = (key: string, axis: string) => compare(st, key, axis, cur, base);
  // 得意先・材料・科目に付いた示唆を、それが主な内訳になっている要因の棒にもつなぐ（影響がいちばん大きい要因1つ）
  const linked = useMemo(() => {
    const map = new Map<string, Insight[]>();
    for (const ins of monthInsights) {
      let best = { key: "", v: 0 };
      for (const s of wf.steps) {
        const v = Math.abs(s.drivers.find((x) => x.anchor === ins.anchor)?.effect ?? 0);
        if (v > best.v && v >= Math.abs(s.effect) * 0.3) best = { key: s.key, v };
      }
      if (best.key) map.set(best.key, [...(map.get(best.key) ?? []), ins]);
    }
    return map;
  }, [monthInsights, wf]);
  const analyze = () => app.rpc("insights.generate", { ym, actor: app.actor }, "AIが今月の数字を読んでいます…（1分ほどかかります）");
  const open = monthInsights.filter((i) => i.status === "open").length;

  const tiles: { label: string; anchor: string; unit: string; digits: number; good: number; f: (p: PL) => number; note?: (p: PL) => string }[] = [
    { label: "売上高", anchor: "kpi:sales", unit: "百万円", digits: 1, good: 1, f: (p) => p.sales / 1e6 },
    { label: "営業利益", anchor: "kpi:op", unit: "百万円", digits: 1, good: 1, f: (p) => p.op / 1e6, note: (p) => `利益率 ${fmt(derived(p).opRate, 1)}%` },
    { label: "販売重量", anchor: "kpi:weight", unit: "t", digits: 0, good: 1, f: (p) => p.weightKg / 1000 },
    { label: "販売単価", anchor: "kpi:price", unit: "円/kg", digits: 1, good: 1, f: (p) => derived(p).price },
    { label: "材料費率", anchor: "kpi:matrate", unit: "%", digits: 1, good: -1, f: (p) => derived(p).matRate },
    { label: "不良率", anchor: "kpi:defect", unit: "%", digits: 2, good: -1, f: (p) => derived(p).defectRate },
    { label: "残業時間", anchor: "kpi:overtime", unit: "h", digits: 0, good: -1, f: (p) => p.overtimeH, note: (p) => `1人当たり ${fmt(derived(p).otPerHead, 1)}h` },
  ];
  const perKg = [
    { label: "材料費", cls: "c-mat", f: (p: PL) => derived(p).matPerKg }, { label: "変動経費", cls: "c-var", f: (p: PL) => derived(p).varPerKg },
    { label: "人件費", cls: "c-lab", f: (p: PL) => derived(p).laborPerKg }, { label: "固定費", cls: "c-fix", f: (p: PL) => derived(p).fixedPerKg },
    { label: "営業利益", cls: "c-op", f: (p: PL) => derived(p).opPerKg },
  ];
  const lines = C("good", "line"), defect = C("defectRate", "line"), tph = C("tph", "line"), hours = C("hours", "line");
  const mats = C("matCost", "item"), matPrice = C("matPrice", "item"), matQty = C("matQty", "item");
  const labor = C("labor", "dept"), heads = C("headcount", "dept"), ot = C("overtime", "dept");
  const find = (rows: CmpRow[], name: string) => rows.find((r) => r.name === name);
  const period = span === "ytd" ? `${fyOf(ym)}年度累計（4月〜${Number(ym.slice(5))}月）` : `${ymLabel(ym)}度`;

  return (
    <div className="dash">
      <section className="panel summary">
        <div className="panel-head"><h2>{ymLabel(ym)}度の総括</h2>
          {analysis && <span className="sub">AI分析 {dateTime(analysis.createdAt)}・示唆 {monthInsights.length}件（未判断 {open}件）</span>}
          <button className="btn right" disabled={!!app.busy} onClick={analyze}>{analysis ? "AI分析をやり直す" : "AI分析を実行"}</button></div>
        {d.missing.length > 0 && <p className="warnline">この月は {d.missing.map((k) => KINDS[k].label).join("・")} が未取込です。数字は取込済みの分だけで計算しています。</p>}
        {analysis ? <p className="summary-text">{analysis.summary}</p> : <p className="empty">この月はまだAI分析をしていません。「AI分析を実行」を押すと、予算とのずれの要因と示唆が各グラフの横に表示されます。</p>}
        {analysis && analysis.suppressed.length > 0 && (
          <div className="suppressed">
            <button className="link" onClick={() => setShowSup(!showSup)}>{showSup ? "▼" : "▶"} 役員会の考え方に沿って、指摘を控えた項目 {analysis.suppressed.length}件</button>
            {showSup && <ul>{analysis.suppressed.map((s, i) => <li key={i}><b>{s.topic}</b>：{s.reason}<span className="who">（考え方：{app.policies.find((p) => p.id === s.policyId)?.rule ?? "—"}）</span></li>)}</ul>}
          </div>
        )}
      </section>

      <div className="tiles">
        {tiles.map((t) => {
          const a = t.f(A), b = t.f(B), ins = monthInsights.find((i) => i.anchor === t.anchor);
          return (
            <div className="tile" key={t.anchor}>
              <div className="tile-label">{t.label}<Pins anchor={t.anchor} /></div>
              <div className="tile-value">{fmt(a, t.digits)}<small>{t.unit}</small></div>
              <div className={`tile-diff ${B.has ? tone(a - b, t.good) : ""}`}>{B.has ? <>{bl}比 {signed(a - b, t.digits)}{t.unit !== "%" && <>（{fmt(rate(a, b), 1)}%）</>}</> : `${bl}のデータなし`}</div>
              <div className="tile-sub">{d.other.filter((o) => o.p.has).map((o) => <span key={o.b}>{BASIS_LABEL[o.b]}比 {signed(a - t.f(o.p), t.digits)}</span>)}</div>
              {(ins || t.note) && <div className="tile-note">{ins ? ins.title : t.note!(A)}</div>}
            </div>
          );
        })}
        <div className="tile">
          <div className="tile-label">年度着地見込み（営業利益）<Pins anchor="kpi:landing" /></div>
          <div className="tile-value">{mil(d.land.op)}<small>百万円</small></div>
          <div className={`tile-diff ${tone(d.land.op - d.land.budgetOp, 1)}`}>年度予算比 {milSigned(d.land.op - d.land.budgetOp)}（{fmt(rate(d.land.op, d.land.budgetOp), 1)}%）</div>
          <div className="tile-sub"><span>年度予算 {mil(d.land.budgetOp)}</span></div>
          <div className="tile-note"><button className="link" onClick={() => app.set({ view: "forecast" })}>前提を変えて試算する →</button></div>
        </div>
      </div>

      {!B.has ? <p className="panel empty">{bl}のデータが無いため、比較は表示できません。上の「比較」を切り替えてください。</p> : <>
        <Section title={`営業利益は${bl}とどこでずれたか`} sub={`${period}・百万円。左の${bl}から右の実績まで、要因ごとの増減。合計は営業利益の差 ${milSigned(wf.curOp - wf.baseOp)} に一致`} notes={["wf:"]} extra={[...linked.values()].flat()}>
          <WaterfallChart wf={wf} baseLabel={bl} selected={sel.key} onSelect={setStep} linked={linked} />
          <div className="drivers">
            <div className="drivers-head"><b>{sel.label} {milSigned(sel.effect)} 百万円の内訳</b><span className="sub">{sel.hint}</span></div>
            <table className="tbl compact"><tbody>
              {sel.drivers.slice(0, 6).map((x, i) => (
                <tr key={i}><th>{x.name}<Pins anchor={x.anchor} /></th><td className={`n ${tone(x.effect, 1)}`}>{milSigned(x.effect)}</td><td className="mute">{x.detail}</td></tr>
              ))}
              {sel.drivers.length === 0 && <tr><td className="mute">影響の大きい内訳はありません。</td></tr>}
            </tbody></table>
          </div>
        </Section>

        <Section title="売上高" sub={`${period}・百万円`} notes={["seg:", "cust:"]} more={{ label: "品目群・区分でも見る", spec: { measure: "sales", axis: "product", basis, span } }}>
          <div className="two">
            <Cmp head="分野" rows={C("sales", "segment")} baseLabel={bl} good={1} anchor="seg" unit="百万円" />
            <Cmp head="得意先" rows={C("sales", "customer")} baseLabel={bl} good={1} anchor="cust" unit="百万円" />
          </div>
        </Section>

        <Section title="重量当たりの採算" sub={`${period}・販売重量1kg当たりの円。売れた重量に対して、どの費用がどれだけ掛かったか`} more={{ label: "kg当たりの推移を見る", spec: { measure: "matPerKg", axis: "", span: "trend", basis } }}>
          <div className="two">
            <div>
              {[{ name: "実績", p: A, dp: dA }, { name: bl, p: B, dp: dB }].map((x) => (
                <div className="stackrow" key={x.name}>
                  <span className="stack-name">{x.name}<br /><small>{fmt(x.dp.price, 1)}円/kg</small></span>
                  <span className="stack">{perKg.map((k) => { const v = k.f(x.p); return v > 0 ? <i key={k.label} className={k.cls} style={{ flexGrow: v }} title={`${k.label} ${fmt(v, 1)}円/kg`}>{v / x.dp.price > 0.07 ? fmt(v, 0) : ""}</i> : null; })}</span>
                </div>
              ))}
              <div className="legend">{perKg.map((k) => <span key={k.label}><i className={k.cls} />{k.label}</span>)}</div>
              <table className="tbl compact">
                <thead><tr><th>1kg当たり</th><th className="n">実績</th><th className="n">{bl}</th><th className="n">差</th></tr></thead>
                <tbody>
                  <tr><th>販売単価</th><td className="n">{fmt(dA.price, 1)}</td><td className="n mute">{fmt(dB.price, 1)}</td><td className={`n ${tone(dA.price - dB.price, 1)}`}>{signed(dA.price - dB.price, 1)}</td></tr>
                  {perKg.map((k) => { const a = k.f(A), b = k.f(B), good = k.label === "営業利益" ? 1 : -1; return <tr key={k.label}><th>{k.label}</th><td className="n">{fmt(a, 1)}</td><td className="n mute">{fmt(b, 1)}</td><td className={`n ${tone(a - b, good)}`}>{signed(a - b, 1)}</td></tr>; })}
                </tbody>
              </table>
            </div>
            <div>
              <WeightProfit points={d.scatter} bepT={d.bep} />
              <p className="cap">点は月ごとの実績（直近24か月、濃い点が今年度、大きい点が{ymLabel(ym)}）。{span === "month" ? "今月" : "累計平均"}の単価と費用の水準では、月 <b>{fmt(d.bep)}t</b> を売ると損益がゼロになります（販売重量 {fmt(A.weightKg / 1000 / cur.yms.length)}t、余裕 {fmt((1 - d.bep / (A.weightKg / 1000 / cur.yms.length)) * 100, 1)}%）。</p>
            </div>
          </div>
        </Section>

        <Section title="生産ライン（関工場）" sub={`${period}`} notes={["line:"]} more={{ label: "不良率の推移を見る", spec: { measure: "defectRate", axis: "line", span: "trend", basis } }}>
          <table className="tbl">
            <thead><tr><th>ライン</th><th className="n">良品重量 t</th><th className="n">{bl}</th><th className="n">不良率 %</th><th className="n">{bl}</th><th className="n">差</th><th>直近13か月</th><th className="n">時間当たり t/h</th><th className="n">{bl}</th><th className="n">稼働時間 h</th></tr></thead>
            <tbody>{lines.map((r) => { const df = find(defect, r.name)!, tp = find(tph, r.name)!, hr = find(hours, r.name)!; return (
              <tr key={r.name}><th>{r.name}<Pins anchor={`line:${r.name}`} /></th><td className="n">{fmt(r.a)}</td><td className="n mute">{fmt(r.b)}</td>
                <td className="n">{fmt(df.a, 2)}</td><td className="n mute">{fmt(df.b, 2)}</td><td className={`n ${tone(df.diff, -1, 0.05)}`}>{signed(df.diff, 2)}</td>
                <td><Spark values={d.series("defectRate", "line", r.name)} bad={df.diff > 0.3} /></td>
                <td className="n">{fmt(tp.a, 2)}</td><td className="n mute">{fmt(tp.b, 2)}</td><td className="n">{fmt(hr.a)}</td></tr>); })}</tbody>
          </table>
        </Section>

        <Section title="材料" sub={`${period}・材料費は百万円`} notes={["mat:"]} more={{ label: "材料単価の推移を見る", spec: { measure: "matPrice", axis: "item", span: "trend", basis } }}>
          <table className="tbl">
            <thead><tr><th>材料</th><th className="n">単価 円/kg</th><th className="n">{bl}</th><th className="n">差</th><th>直近13か月</th><th className="n">使用量 t</th><th className="n">{bl}</th><th className="n">材料費</th><th className="n">{bl}</th><th className="n">差</th></tr></thead>
            <tbody>{mats.map((r) => { const p = find(matPrice, r.name)!, q = find(matQty, r.name)!; return (
              <tr key={r.name}><th>{r.name}<Pins anchor={`mat:${r.name}`} /></th><td className="n">{fmt(p.a, 1)}</td><td className="n mute">{fmt(p.b, 1)}</td><td className={`n ${tone(p.diff, -1, 0.05)}`}>{signed(p.diff, 1)}</td>
                <td><Spark values={d.series("matPrice", "item", r.name)} bad={p.rate > 103} /></td>
                <td className="n">{fmt(q.a)}</td><td className="n mute">{fmt(q.b)}</td><td className="n">{fmt(r.a, 1)}</td><td className="n mute">{fmt(r.b, 1)}</td><td className={`n ${tone(r.diff, -1, 0.05)}`}>{signed(r.diff, 1)}</td></tr>); })}</tbody>
          </table>
        </Section>

        <Section title="経費・人件費" sub={`${period}・百万円`} notes={["acct:", "dept:"]} more={{ label: "部門別に経費を見る", spec: { measure: "expense", axis: "dept", basis, span } }}>
          <div className="two">
            <Cmp head="経費科目" rows={C("expense", "account")} baseLabel={bl} good={-1} anchor="acct" unit="百万円" />
            <table className="tbl">
              <thead><tr><th>部門</th><th className="n">人員</th><th className="n">{bl}</th><th className="n">残業 h</th><th className="n">{bl}</th><th className="n">人件費</th><th className="n">{bl}</th><th className="n">差</th></tr></thead>
              <tbody>{labor.map((r) => { const h = find(heads, r.name)!, o = find(ot, r.name)!; return (
                <tr key={r.name}><th>{r.name}<Pins anchor={`dept:${r.name}`} /></th><td className="n">{fmt(h.a)}</td><td className="n mute">{fmt(h.b)}</td>
                  <td className={`n ${tone(o.diff, -1, o.b * 0.1)}`}>{fmt(o.a)}</td><td className="n mute">{fmt(o.b)}</td><td className="n">{fmt(r.a, 1)}</td><td className="n mute">{fmt(r.b, 1)}</td><td className={`n ${tone(r.diff, -1, 0.05)}`}>{signed(r.diff, 1)}</td></tr>); })}</tbody>
            </table>
          </div>
        </Section>
      </>}

      <Section title="月次の推移" sub={`${ymLabel(d.months[0])}〜${ymLabel(ym)}`} notes={["trend:"]} more={{ label: "ほかの指標の推移を見る", spec: { measure: "price", axis: "", span: "trend", basis } }}>
        <div className="two">
          <div><h3 className="chart-title">売上高</h3>
            <TrendChart labels={d.months.map(ymShort)} unit="百万円" digits={1} width={560} height={250} pin={<Pins anchor="trend:sales" />}
              bars={{ name: "実績", color: "var(--navy)", values: d.mp.map((m) => (m.a.has ? m.a.sales / 1e6 : null)) }}
              lines={[{ name: "予算", color: "var(--warn)", values: d.mp.map((m) => (m.b.has ? m.b.sales / 1e6 : null)) }, { name: "前年", color: "var(--ink3)", dash: true, values: d.mp.map((m) => (m.py.has ? m.py.sales / 1e6 : null)) }]} /></div>
          <div><h3 className="chart-title">営業利益</h3>
            <TrendChart labels={d.months.map(ymShort)} unit="百万円" digits={1} width={560} height={250} pin={<Pins anchor="trend:op" />}
              bars={{ name: "実績", color: "var(--navy)", values: d.mp.map((m) => (m.a.has ? m.a.op / 1e6 : null)) }}
              lines={[{ name: "予算", color: "var(--warn)", values: d.mp.map((m) => (m.b.has ? m.b.op / 1e6 : null)) }, { name: "前年", color: "var(--ink3)", dash: true, values: d.mp.map((m) => (m.py.has ? m.py.op / 1e6 : null)) }]} /></div>
        </div>
      </Section>
    </div>
  );
}
