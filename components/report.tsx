"use client";
// 月次業績報告書。これまでExcelで作っていた報告資料の形（科目×予算・実績・差異・前年・累計）で出し、印刷とExcel出力ができる。
import { useMemo, useState } from "react";
import { type PL, compare, derived, pl, slices, waterfall } from "@/lib/analytics";
import { useApp } from "@/lib/client";
import { dateTime, fmt, signed, tone } from "@/lib/format";
import { STATUS_LABEL, fyOf, ymLabel } from "@/lib/model";

// 列の種類：t=文字 n=数値 d=差（+/▲と色） p=率(%)
type Col = { label: string; type: "t" | "n" | "d" | "p" };
type RRow = { c: (string | number | null)[]; good: number; digits?: number };
interface RTable { title: string; unit: string; digits: number; cols: Col[]; rows: RRow[]; bold?: number[] }
const pct = (a: number, b: number) => (b ? (a / b) * 100 : null);

function buildTables(st: ReturnType<typeof useApp>["store"], ym: string): RTable[] {
  const m = slices(ym, "month", "budget"), y = slices(ym, "ytd", "budget"), py = slices(ym, "month", "py").base, ypy = slices(ym, "ytd", "py").base;
  const P = { a: pl(st, m.cur), b: pl(st, m.base), py: pl(st, py), ya: pl(st, y.cur), yb: pl(st, y.base), ypy: pl(st, ypy) };
  const head = (name: string): Col[] => [
    { label: name, type: "t" }, { label: "当月予算", type: "n" }, { label: "当月実績", type: "n" }, { label: "差異", type: "d" }, { label: "達成率", type: "p" },
    { label: "前年同月", type: "n" }, { label: "前年比", type: "p" }, { label: "累計予算", type: "n" }, { label: "累計実績", type: "n" }, { label: "差異", type: "d" }, { label: "達成率", type: "p" }, { label: "前年累計", type: "n" },
  ];
  // isRate の行（%の指標）は達成率を出さない
  const row = (name: string, f: (p: PL) => number, good = 1, digits?: number, isRate = false): RRow => {
    const v = { a: f(P.a), b: f(P.b), py: f(P.py), ya: f(P.ya), yb: f(P.yb), ypy: f(P.ypy) };
    return { good, digits, c: [name, v.b, v.a, v.a - v.b, isRate ? null : pct(v.a, v.b), P.py.has ? v.py : null, isRate || !P.py.has ? null : pct(v.a, v.py), v.yb, v.ya, v.ya - v.yb, isRate ? null : pct(v.ya, v.yb), P.ypy.has ? v.ypy : null] };
  };
  const K = (f: (p: PL) => number) => (p: PL) => f(p) / 1000;
  const by = (title: string, name: string, key: string, axis: string, good: number, scale = 1000): RTable => {
    const cm = compare(st, key, axis, m.cur, m.base), cpy = compare(st, key, axis, m.cur, py), cy = compare(st, key, axis, y.cur, y.base), cypy = compare(st, key, axis, y.cur, ypy);
    const g = (rows: typeof cm, n: string) => rows.find((r) => r.name === n);
    const rows: RRow[] = cm.map((r) => {
      const p = g(cpy, r.name), yy = g(cy, r.name), yp = g(cypy, r.name);
      return { good, c: [r.name, r.b * scale, r.a * scale, r.diff * scale, pct(r.a, r.b), p?.hasBase ? p.b * scale : null, p?.hasBase ? pct(r.a, p.b) : null, (yy?.b ?? 0) * scale, (yy?.a ?? 0) * scale, (yy?.diff ?? 0) * scale, pct(yy?.a ?? 0, yy?.b ?? 0), yp?.hasBase ? yp.b * scale : null] };
    });
    const t: (string | number | null)[] = ["合計", ...Array(11).fill(null)];
    for (const c of [1, 2, 3, 5, 7, 8, 9, 11]) t[c] = rows.some((r) => r.c[c] !== null) ? rows.reduce((s, r) => s + ((r.c[c] as number) ?? 0), 0) : null;
    t[4] = pct(t[2] as number, t[1] as number); t[6] = t[5] === null ? null : pct(t[2] as number, t[5] as number); t[10] = pct(t[8] as number, t[7] as number);
    return { title, unit: "千円", digits: 0, cols: head(name), rows: [...rows, { c: t, good }], bold: [rows.length] };
  };
  const wf = waterfall(st, m.cur, m.base);
  return [
    { title: "1．損益の概況", unit: "千円", digits: 0, cols: head("科目"), bold: [3, 6], rows: [
      row("売上高", K((p) => p.sales)), row("材料費", K((p) => p.material), -1), row("変動経費", K((p) => p.varExp), -1), row("限界利益", K((p) => p.marginal)),
      row("人件費", K((p) => p.labor), -1), row("固定費", K((p) => p.fixed), -1), row("営業利益", K((p) => p.op)),
    ] },
    { title: "2．重量・単価・生産の指標", unit: "各指標の単位", digits: 1, cols: head("指標"), rows: [
      row("販売重量（t）", (p) => p.weightKg / 1000, 1, 0), row("販売単価（円/kg）", (p) => derived(p).price), row("限界利益率（%）", (p) => derived(p).marginalRate, 1, 1, true),
      row("営業利益率（%）", (p) => derived(p).opRate, 1, 1, true), row("材料費率（%）", (p) => derived(p).matRate, -1, 1, true),
      row("kg当たり材料費（円）", (p) => derived(p).matPerKg, -1), row("kg当たり人件費（円）", (p) => derived(p).laborPerKg, -1), row("kg当たり固定費（円）", (p) => derived(p).fixedPerKg, -1),
      row("不良率（%）", (p) => derived(p).defectRate, -1, 2, true), row("鋳造歩留（%）", (p) => derived(p).yieldRate, 1, 1, true), row("人員（人）", (p) => p.headcount, 0, 0), row("残業時間（h）", (p) => p.overtimeH, -1, 0),
    ] },
    by("3．分野別売上高", "分野", "sales", "segment", 1), by("4．得意先別売上高", "得意先", "sales", "customer", 1),
    by("5．材料費の内訳", "材料", "matCost", "item", -1), by("6．経費の内訳", "科目", "expense", "account", -1), by("7．部門別人件費", "部門", "labor", "dept", -1),
    {
      title: "8．営業利益の予算差異の要因", unit: "千円", digits: 0, cols: [{ label: "要因", type: "t" }, { label: "影響額", type: "d" }, { label: "主な内訳", type: "t" }], bold: [0, wf.steps.length + 1],
      rows: [{ c: ["予算の営業利益", wf.baseOp / 1000, ""], good: 1 },
        ...wf.steps.map((s): RRow => ({ good: 1, c: [s.label, s.effect / 1000, s.drivers.slice(0, 3).map((d) => `${d.name} ${signed(d.effect / 1e6, 1)}百万円（${d.detail}）`).join("／")] })),
        { c: ["実績の営業利益", wf.curOp / 1000, ""], good: 1 }],
    },
  ];
}

function Cell({ v, col, digits, good }: { v: string | number | null; col: Col; digits: number; good: number }) {
  if (col.type === "t") return <td className="t">{v}</td>;
  if (v === null || (typeof v === "number" && !Number.isFinite(v))) return <td className="n mute">—</td>;
  if (col.type === "p") return <td className="n">{fmt(v as number, 1)}%</td>;
  if (col.type === "d") return <td className={`n ${tone(v as number, good, 0.05)}`}>{signed(v as number, digits)}</td>;
  return <td className="n">{fmt(v as number, digits)}</td>;
}

export default function Report() {
  const app = useApp(), { store: st, ym, analysis, monthInsights, actions, reports } = app;
  const report = reports.find((r) => r.ym === ym), final = report?.status === "final";
  const tables = useMemo(() => buildTables(st, ym), [st, ym]);
  // 所見は、書きかけ（この月のもの）→ 保存済み → AIの総括 の順に使う
  const [draft, setDraft] = useState<{ ym: string; text: string } | null>(null);
  const comment = draft?.ym === ym ? draft.text : report?.comment || analysis?.summary || "";
  const setComment = (text: string) => setDraft({ ym, text });
  const decided = monthInsights.filter((i) => i.status !== "open");
  const dirty = comment !== (report?.comment ?? "");
  const save = (extra: Record<string, unknown> = {}) => app.rpc("report.save", { ym, comment, actor: app.actor, ...extra });

  const exportXlsx = async () => {
    const XLSX = await import("xlsx"), wb = XLSX.utils.book_new();
    const round = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? Number(v.toFixed(d)) : v ?? "");
    for (const t of tables) {
      const aoa = [[`${ymLabel(ym)}度 ${t.title}`, `単位：${t.unit}`], t.cols.map((c) => c.label), ...t.rows.map((r) => r.c.map((v, i) => round(v, t.cols[i].type === "p" ? 1 : r.digits ?? t.digits)))];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws["!cols"] = t.cols.map((c, i) => ({ wch: i === 0 ? 26 : c.type === "t" ? 60 : 12 }));
      XLSX.utils.book_append_sheet(wb, ws, t.title.replace(/^\d+．/, "").slice(0, 28));
    }
    const notes = [["所見"], [comment], [], ["役員会での判断"], ["No.", "示唆", "判断", "理由", "判断者"], ...decided.map((i) => [i.seq, i.title, STATUS_LABEL[i.status], i.reason, i.decidedBy]),
      [], ["決定事項"], ["やること", "担当", "期限", "状態"], ...actions.filter((a) => a.ym === ym).map((a) => [a.title, a.owner, a.due, a.status === "open" ? "進行中" : a.status === "done" ? "完了" : "中止"])];
    const ws = XLSX.utils.aoa_to_sheet(notes); ws["!cols"] = [{ wch: 40 }, { wch: 50 }, { wch: 12 }, { wch: 60 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, ws, "所見・決定事項");
    XLSX.writeFile(wb, `月次業績報告書_${ymLabel(ym)}度.xlsx`);
  };

  return (
    <div className="report-wrap">
      <div className="report-tools">
        <span className={`tag ${final ? "st-action" : "st-open"}`}>{final ? `確定済み（${report!.finalizedBy}・${dateTime(report!.finalizedAt)}）` : "下書き"}</span>
        <span className="sub">これまでの月次報告資料と同じ並び（予算・実績・差異・前年・累計）で自動作成しています。</span>
        <span className="right row">
          <button className="btn" onClick={() => window.print()}>印刷・PDF保存</button>
          <button className="btn" onClick={exportXlsx}>Excelで出力</button>
          {final ? <button className="btn" onClick={() => save({ status: "draft" })}>確定を解除</button> : <button className="btn pri" onClick={() => save({ status: "final" })}>この内容で確定</button>}
        </span>
      </div>
      <div className="report">
        <header className="report-head">
          <div><h1>月次業績報告書</h1><p>{ymLabel(ym)}度（{fyOf(ym)}年度 第{((Number(ym.slice(5)) + 8) % 12) + 1}月）　株式会社マツバラ</p></div>
          <table className="stamps"><tbody><tr><th>社長</th><th>担当役員</th><th>作成</th></tr><tr><td /><td /><td>{final ? report!.finalizedBy : ""}</td></tr></tbody></table>
        </header>
        {tables.map((t) => (
          <section key={t.title} className="rsec">
            <h2>{t.title}<span>単位：{t.unit}</span></h2>
            <table className="rtbl">
              <thead><tr>{t.cols.map((c, i) => <th key={i} className={c.type === "t" ? "t" : "n"}>{c.label}</th>)}</tr></thead>
              <tbody>{t.rows.map((r, ri) => (
                <tr key={ri} className={t.bold?.includes(ri) ? "bold" : ""}>{t.cols.map((c, ci) => <Cell key={ci} v={r.c[ci]} col={c} digits={r.digits ?? t.digits} good={r.good} />)}</tr>))}</tbody>
            </table>
          </section>
        ))}
        <section className="rsec">
          <h2>9．所見{!final && <span className="noprint">AIの総括を下書きにしています。直してから確定してください。</span>}</h2>
          {final ? <p className="rcomment">{comment}</p> : <>
            <textarea className="rcomment noprint" value={comment} onChange={(e) => setComment(e.target.value)} rows={6} aria-label="所見" />
            <p className="rcomment printonly">{comment}</p>
            <div className="row noprint">
              <button className="btn" disabled={!dirty} onClick={() => save()}>所見を保存</button>
              {analysis && comment !== analysis.summary && <button className="link" onClick={() => setComment(analysis.summary)}>AIの総括に戻す</button>}
            </div></>}
        </section>
        <section className="rsec">
          <h2>10．役員会での判断と決定事項</h2>
          {decided.length === 0 ? <p className="mute">この月の示唆への判断は、まだ記録されていません。</p> : (
            <table className="rtbl">
              <thead><tr><th className="n">No.</th><th className="t">示唆</th><th className="t">判断</th><th className="t">理由・決定事項</th><th className="t">判断者</th></tr></thead>
              <tbody>{decided.map((i) => { const a = actions.find((x) => x.insightId === i.id); return (
                <tr key={i.id}><td className="n">{i.seq}</td><td className="t">{i.title}</td><td className="t nowrap">{STATUS_LABEL[i.status]}</td>
                  <td className="t">{i.reason}{a && <><br />→ {a.title}（担当 {a.owner || "未定"}／期限 {a.due || "未定"}）</>}</td><td className="t nowrap">{i.decidedBy}</td></tr>); })}</tbody>
            </table>)}
        </section>
      </div>
    </div>
  );
}
