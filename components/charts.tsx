"use client";
// グラフと、グラフ上に置く示唆の番号（ピン）。SVGは自前で描き、番号を正確な位置に重ねる。
import { type ReactNode } from "react";
import { type Waterfall } from "@/lib/analytics";
import { useApp } from "@/lib/client";
import { fmt, signed } from "@/lib/format";
import { type Insight, SEVERITY_LABEL, STATUS_LABEL } from "@/lib/model";

/** 同じ示唆を指す番号とメモを、マウスを載せたときに一緒に光らせる。 */
const hot = (id: string, on: boolean) => document.querySelectorAll(`[data-ins="${id}"]`).forEach((el) => el.classList.toggle("hot", on));

export function Pin({ ins }: { ins: Insight }) {
  const { openInsight, focus } = useApp();
  return (
    <button type="button" className={`pin sev-${ins.severity}${focus === ins.id ? " on" : ""}`} data-ins={ins.id}
      title={`示唆${ins.seq}：${ins.title}`} aria-label={`示唆${ins.seq}：${ins.title}`}
      onMouseEnter={() => hot(ins.id, true)} onMouseLeave={() => hot(ins.id, false)} onClick={(e) => { e.stopPropagation(); openInsight(ins.id); }}>
      {ins.seq}
    </button>
  );
}
/** その場所（anchor）に付いている示唆の番号。 */
export function Pins({ anchor }: { anchor: string }) {
  const { monthInsights } = useApp();
  const list = monthInsights.filter((i) => i.anchor === anchor);
  return list.length ? <span className="pins" data-anchor={anchor}>{list.map((i) => <Pin key={i.id} ins={i} />)}</span> : null;
}
/** グラフの横に並べる示唆メモ。番号でグラフ上の位置とつながる。 */
export function Notes({ prefixes, extra = [] }: { prefixes: string[]; extra?: Insight[] }) {
  const { monthInsights, openInsight, focus } = useApp();
  const list = monthInsights.filter((i) => extra.includes(i) || prefixes.some((p) => i.anchor.startsWith(p)));
  if (!list.length) return null;
  return (
    <aside className="notes" aria-label="この図についての示唆">
      {list.map((i) => (
        <button type="button" key={i.id} className={`note sev-${i.severity}${focus === i.id ? " on" : ""}`} data-ins={i.id}
          onMouseEnter={() => hot(i.id, true)} onMouseLeave={() => hot(i.id, false)} onClick={() => openInsight(i.id)}>
          <span className="note-head"><span className={`pin sev-${i.severity}`}>{i.seq}</span><b>{i.title}</b></span>
          <span className="note-body">{i.situation}</span>
          <span className="note-prop"><i>提案</i>{i.proposal}</span>
          <span className="note-foot"><span className={`tag sev-${i.severity}`}>{SEVERITY_LABEL[i.severity]}</span><span className={`tag st-${i.status}`}>{STATUS_LABEL[i.status]}</span></span>
        </button>
      ))}
    </aside>
  );
}

function niceTicks(min: number, max: number, n = 4) {
  if (min === max) { min -= 1; max += 1; }
  const raw = (max - min) / n, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw)!;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v / step) * step);
  return { lo, hi, ticks, digits: step < 1 ? (step < 0.1 ? 2 : 1) : 0 };
}

/** 営業利益の差異分解。基準→各要因→当期。棒を押すと内訳が切り替わる。 */
export function WaterfallChart({ wf, baseLabel, selected, onSelect, linked }: {
  wf: Waterfall; baseLabel: string; selected: string; onSelect: (key: string) => void;
  linked?: Map<string, Insight[]>; // 要因の内訳（得意先・材料など）に付いた示唆。その要因の棒にも番号を出す
}) {
  const W = 780, H = 310, top = 62, bottom = 46, n = wf.steps.length + 2, slot = W / n, bw = slot * 0.6;
  const M = (v: number) => v / 1e6;
  const steps = wf.steps.reduce<{ key: string; anchor: string; label: string; from: number; to: number; kind: string; text: string }[]>((list, s) => {
    const from = list.length ? list[list.length - 1].to : M(wf.baseOp);
    return [...list, { key: s.key, anchor: s.anchor, label: s.label, from, to: from + M(s.effect), kind: s.effect >= 0 ? "pos" : "neg", text: signed(M(s.effect), 1) }];
  }, []);
  const bars = [
    { key: "", anchor: "", label: baseLabel, from: 0, to: M(wf.baseOp), kind: "total", text: fmt(M(wf.baseOp), 1) }, ...steps,
    { key: "", anchor: "", label: "実績", from: 0, to: M(wf.curOp), kind: "total cur", text: fmt(M(wf.curOp), 1) },
  ];
  const { lo, hi, ticks } = niceTicks(Math.min(0, ...bars.flatMap((b) => [b.from, b.to])), Math.max(0, ...bars.flatMap((b) => [b.from, b.to])));
  const y = (v: number) => top + ((hi - v) / (hi - lo)) * (H - top - bottom);
  return (
    <div className="chart wf" style={{ aspectRatio: `${W}/${H}` }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="営業利益の差異分解">
        {ticks.map((t) => <g key={t}><line x1={0} x2={W} y1={y(t)} y2={y(t)} className={t === 0 ? "zero" : "grid"} /><text x={2} y={y(t) - 3} className="tick">{fmt(t)}</text></g>)}
        {bars.map((b, i) => {
          const x = i * slot + (slot - bw) / 2, y0 = y(Math.max(b.from, b.to)), h = Math.max(2, Math.abs(y(b.from) - y(b.to)));
          const sel = b.key && b.key === selected;
          return (
            <g key={i} className={`wf-bar ${b.kind}${sel ? " sel" : ""}${b.key ? " click" : ""}`} onClick={() => b.key && onSelect(b.key)}>
              {b.key && <rect x={i * slot + 2} y={8} width={slot - 4} height={H - 10} className="hit" rx={4} />}
              <rect x={x} y={y0} width={bw} height={h} rx={2} className="bar" />
              {i < bars.length - 1 && <line x1={x + bw} x2={(i + 1) * slot + (slot - bw) / 2} y1={y(b.to)} y2={y(b.to)} className="link" />}
              <text x={x + bw / 2} y={y0 - 6} className="val">{b.text}</text>
              <text x={x + bw / 2} y={H - 26} className="lab">{b.label}</text>
              <text x={x + bw / 2} y={H - 10} className={b.key ? "sub" : "tick lab"}>{!b.key ? "営業利益" : sel ? "▲内訳を表示中" : "内訳を見る"}</text>
            </g>
          );
        })}
      </svg>
      {bars.map((b, i) => (
        b.anchor && <span key={i} className="pin-at" style={{ left: `${((i * slot + slot / 2) / W) * 100}%`, top: `${((y(Math.max(b.from, b.to)) - 52) / H) * 100}%` }}>
          <Pins anchor={b.anchor} />{linked?.get(b.key)?.map((ins) => <Pin key={ins.id} ins={ins} />)}</span>
      ))}
    </div>
  );
}

export interface Series { name: string; values: (number | null)[]; color: string; dash?: boolean }
/** 月次の推移。棒（実績）と折れ線（予算・前年など）。zero=false にすると目盛りを値の幅に合わせる。 */
export function TrendChart({ labels, bars, lines = [], unit, digits = 0, zero = true, width = 920, height = 230, pin, soft }: {
  labels: string[]; bars?: Series; lines?: Series[]; unit: string; digits?: number; zero?: boolean; pin?: ReactNode;
  width?: number; height?: number; // 描く大きさ（表示幅に近い値にすると文字が読みやすい）
  soft?: boolean[]; // true の棒は薄く描く（見込みの月）。指定しなければ最新の棒だけ濃くする
}) {
  const W = width, H = height, left = 46, right = 14, top = 22, bottom = 26;
  const all = [...(bars?.values ?? []), ...lines.flatMap((l) => l.values)].filter((v): v is number => v !== null && Number.isFinite(v));
  if (!all.length) return <p className="empty">表示できるデータがありません。</p>;
  const pad = zero ? 0 : (Math.max(...all) - Math.min(...all)) * 0.15 || 1;
  const { lo, hi, ticks, digits: td } = niceTicks(zero ? Math.min(0, ...all) : Math.min(...all) - pad, zero ? Math.max(0, ...all) : Math.max(...all) + pad);
  const slot = (W - left - right) / labels.length, x = (i: number) => left + slot * (i + 0.5), y = (v: number) => top + ((hi - v) / (hi - lo)) * (H - top - bottom);
  const lastBar = bars ? bars.values.findLastIndex((v) => v !== null) : -1;
  return (
    <div className="chart">
      <div className="legend">
        {bars && <span><i style={{ background: bars.color }} />{bars.name}</span>}
        {lines.map((l) => <span key={l.name}><i className={l.dash ? "ln dash" : "ln"} style={{ borderColor: l.color }} />{l.name}</span>)}
        <span className="unit">単位：{unit}</span>
      </div>
      <div style={{ position: "relative", aspectRatio: `${W}/${H}` }}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="月次の推移">
          {ticks.map((t) => <g key={t}><line x1={left} x2={W - right} y1={y(t)} y2={y(t)} className={t === 0 ? "zero" : "grid"} /><text x={left - 6} y={y(t) + 4} className="tick end">{fmt(t, td)}</text></g>)}
          {labels.map((l, i) => <text key={i} x={x(i)} y={H - 8} className="lab">{l}</text>)}
          {bars?.values.map((v, i) => v === null ? null : (
            <rect key={i} x={x(i) - slot * 0.3} width={slot * 0.6} y={y(Math.max(0, v))} height={Math.max(1, Math.abs(y(v) - y(0)))} fill={v < 0 ? "var(--neg)" : bars.color} rx={2} opacity={soft ? (soft[i] ? 0.4 : 1) : i === lastBar ? 1 : 0.62}>
              <title>{`${labels[i]} ${bars.name} ${fmt(v, digits)}${unit}`}</title>
            </rect>
          ))}
          {lines.map((l) => (
            <g key={l.name}>
              <polyline fill="none" stroke={l.color} strokeWidth={2} strokeDasharray={l.dash ? "5 4" : undefined}
                points={l.values.map((v, i) => (v === null ? "" : `${x(i)},${y(v)}`)).filter(Boolean).join(" ")} />
              {l.values.map((v, i) => v === null ? null : <circle key={i} cx={x(i)} cy={y(v)} r={l.dash ? 2 : 3} fill={l.color}><title>{`${labels[i]} ${l.name} ${fmt(v, digits)}${unit}`}</title></circle>)}
            </g>
          ))}
          {lastBar >= 0 && <text x={x(lastBar)} y={y(Math.max(0, bars!.values[lastBar]!)) - 6} className="val">{fmt(bars!.values[lastBar]!, digits)}</text>}
        </svg>
        {pin && lastBar >= 0 && <span className="pin-at" style={{ left: `${(x(lastBar) / W) * 100}%`, top: `${((y(Math.max(0, bars!.values[lastBar]!)) - 46) / H) * 100}%` }}>{pin}</span>}
      </div>
    </div>
  );
}

/** 小さな折れ線（直近の動き）。 */
export function Spark({ values, bad }: { values: number[]; bad?: boolean }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values), hi = Math.max(...values), W = 72, H = 22;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * (W - 6) + 3},${H - 3 - ((v - lo) / (hi - lo || 1)) * (H - 6)}`);
  const [lx, ly] = pts[pts.length - 1].split(",");
  return <svg className="spark" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden><polyline points={pts.join(" ")} fill="none" stroke="var(--ink3)" strokeWidth={1.5} /><circle cx={lx} cy={ly} r={2.5} fill={bad ? "var(--neg)" : "var(--navy)"} /></svg>;
}

/** 差の大きさを中心線から左右に伸びる棒で示す。 */
export function DiffBar({ value, max, tone }: { value: number; max: number; tone: string }) {
  const w = max ? Math.min(50, (Math.abs(value) / max) * 50) : 0;
  return <span className="diffbar" aria-hidden><i className={tone} style={value >= 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }} /></span>;
}
/** 当期を棒、基準を縦線で示す。 */
export function Bullet({ value, base, max }: { value: number; base: number; max: number }) {
  const p = (v: number) => `${max ? Math.max(0, Math.min(100, (v / max) * 100)) : 0}%`;
  return <span className="bullet" aria-hidden><i style={{ width: p(value) }} />{base > 0 && <b style={{ left: p(base) }} />}</span>;
}
