"use client";
// データ取込（ファイルを入れるだけ）と、蓄積データの一覧。
import { useMemo, useRef, useState } from "react";
import { members } from "@/lib/analytics";
import { useApp } from "@/lib/client";
import { dateTime, fmt } from "@/lib/format";
import { type Kind, type Row, type Scenario, KINDS, KIND_ORDER, dsKey, ymAdd, ymLabel, ymRange, ymShort } from "@/lib/model";
import { type Mapping, type Part, alignNames, interpret, readTables, splitByScenario } from "@/lib/parse";
import { SAMPLE_NEXT } from "@/lib/sample";
import { downloadSample, sampleFiles, saveBlob, toCsv } from "@/lib/sample-files";

type Item = Part & { id: number; state: "confirm" | "saving" | "done" | "error"; done: string[]; table: Parameters<typeof interpret>[2] };
const SC: Record<Scenario, string> = { actual: "実績", budget: "予算" };
const monthsOf = (p: Part) => [...new Set(Object.keys(p.months).map((k) => k.split("|")[1]))].sort();

export function ImportView() {
  const app = useApp(), { store: st, datasets, imports } = app;
  const [items, setItems] = useState<Item[]>([]);
  const [over, setOver] = useState(false);
  const [ready, setReady] = useState("");
  const input = useRef<HTMLInputElement>(null), seq = useRef(0);
  const patch = (id: number, p: Partial<Item>) => setItems((list) => list.map((x) => (x.id === id ? { ...x, ...p } : x)));

  /** 取込済みの値と見比べて、表記だけが違う名称はそろえ、気づいた点を足す。 */
  const check = (p: Part): string[] => {
    if (!p.kind) return [];
    const notes: string[] = [];
    for (const f of KINDS[p.kind].fields.filter((x) => x.type === "dim")) {
      const known = new Set(members(st, p.kind, f.key));
      if (!known.size) continue;
      alignNames(Object.values(p.months).flat(), f.key, [...known]);
      const fresh = [...new Set(Object.values(p.months).flat().map((r) => String(r[f.key] ?? "")).filter((v) => v && !known.has(v)))];
      if (fresh.length) notes.push(`これまでに無い${f.label}：${fresh.slice(0, 5).join("、")}${fresh.length > 5 ? " ほか" : ""}（表記の違いでないかご確認ください）`);
    }
    return notes;
  };
  const replaces = (p: Part) => Object.keys(p.months).filter((k) => { const [sc, ym] = k.split("|"); return st.has(dsKey(p.kind!, sc as Scenario, ym)); }).map((k) => ymLabel(k.split("|")[1]));

  const save = async (it: Item) => {
    patch(it.id, { state: "saving" });
    for (const part of splitByScenario(it)) {
      const r = await app.rpc("import.save", { fileName: it.fileName + (it.sheet ? `（${it.sheet}）` : ""), kind: it.kind, scenario: part.scenario, months: part.months, warnings: it.warnings, actor: app.actor });
      if (r.error) return patch(it.id, { state: "error", error: r.error });
    }
    patch(it.id, { state: "done" });
    return true;
  };

  const handle = async (files: File[]) => {
    setReady("");
    const added: Item[] = [];
    for (const file of files) {
      let tables: Awaited<ReturnType<typeof readTables>>;
      try { tables = await readTables(file); }
      catch { added.push({ ...interpret(file.name, "", []), id: ++seq.current, state: "error", done: [], table: [], error: "ファイルを開けませんでした。Excel（.xlsx / .xls）か CSV を入れてください。" }); continue; }
      for (const t of tables) {
        let p = interpret(file.name, t.sheet, t.table);
        if (!p.kind && p.headers.length) { // 見出しが決まった形でない表は、AIに列を見分けてもらう
          const r = await app.rpc("columns.map", { fileName: file.name, headers: p.headers, samples: p.sample }, "見出しが見慣れない形のため、AIが列を見分けています…");
          const m = r.result as { kind: Kind | "unknown"; ym_column: string; scenario_column: string; mapping: { field: string; column: string }[]; unit_note: string } | undefined;
          if (m && m.kind !== "unknown") {
            const mapping: Mapping = { kind: m.kind, columns: Object.fromEntries(m.mapping.map((x) => [x.field, x.column])), ymColumn: m.ym_column || undefined, scenarioColumn: m.scenario_column || undefined };
            p = interpret(file.name, t.sheet, t.table, { mapping });
            if (m.unit_note) p.warnings.push(`AIの注記：${m.unit_note}`);
          }
        }
        if (!p.error) p.warnings.push(...check(p));
        added.push({ ...p, id: ++seq.current, state: p.error ? "error" : "confirm", done: [], table: t.table });
      }
    }
    setItems((list) => [...added, ...list]);
    // 置き換えにならず、AIの列判定も使っていないものは、そのまま取り込む
    const saved: Item[] = [];
    for (const it of added) if (it.state === "confirm" && it.mappedBy === "見出し" && replaces(it).length === 0 && (await save(it))) saved.push(it);
    afterSave(saved);
  };
  /** 取込で実績が5種類そろった月ができたら、その月を開いてAI分析まで進める。 */
  const afterSave = async (saved: Item[]) => {
    const keys = new Set(saved.flatMap((it) => Object.keys(it.months).map((k) => `${it.kind}|${k}`)));
    const fresh = [...new Set(saved.flatMap(monthsOf))].sort().reverse()
      .find((ym) => !app.months.includes(ym) && KIND_ORDER.every((k) => keys.has(dsKey(k, "actual", ym)) || st.has(dsKey(k, "actual", ym))));
    if (!fresh) return;
    app.set({ ym: fresh });
    setReady(fresh);
    if (!app.analyses.some((a) => a.ym === fresh)) {
      await app.rpc("insights.generate", { ym: fresh, actor: app.actor }, `${ymLabel(fresh)}度のデータがそろいました。AIが数字を読んでいます…（1分ほどかかります）`);
    }
  };
  const confirmSave = async (it: Item) => { if (await save(it)) afterSave([it]); };
  const retryWithMonth = (it: Item, ym: string) => {
    const p = interpret(it.fileName, it.sheet, it.table, { fallbackYm: ym });
    patch(it.id, { ...p, state: p.error ? "error" : "confirm", warnings: [...p.warnings, ...(p.error ? [] : check(p))] });
  };

  const grid = useMemo(() => {
    const latest = datasets.filter((d) => d.scenario === "actual").map((d) => d.ym).sort().pop() ?? SAMPLE_NEXT;
    return ymRange(ymAdd(latest, -10), ymAdd(latest, 1)).reverse();
  }, [datasets]);
  const samples = useMemo(() => sampleFiles(SAMPLE_NEXT), []);
  const history = [...imports].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const pickMonths = ymRange(ymAdd(grid[0], -12), grid[0]).reverse();

  return (
    <div className="import">
      <section className="panel">
        <div className="panel-head"><h2>データ取込</h2><span className="sub">各部署から届いたExcel・CSVをそのまま入れてください。種類・年月・予算と実績の別は自動で見分けます</span></div>
        <div className={`drop${over ? " over" : ""}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); handle([...e.dataTransfer.files]); }}>
          <p className="drop-title">ここにファイルをドラッグ</p>
          <p>売上実績・生産実績・材料使用実績・経費実績・人件費勤怠・年度予算。複数まとめて入れられます。</p>
          <button className="btn pri" onClick={() => input.current?.click()}>ファイルを選ぶ</button>
          <input ref={input} type="file" multiple hidden accept=".xlsx,.xls,.xlsm,.csv,.tsv,.txt" onChange={(e) => { handle([...(e.target.files ?? [])]); e.target.value = ""; }} />
        </div>
        {ready && <p className="okline">{ymLabel(ready)}度の5種類のデータがそろいました。<button className="btn pri" onClick={() => app.set({ view: "dashboard", ym: ready })}>ダッシュボードで見る</button></p>}
        {items.map((it) => { const rep = it.kind && it.state === "confirm" ? replaces(it) : []; return (
          <div key={it.id} className={`imp-item ${it.state}`}>
            <div className="imp-head">
              <b>{it.fileName}{it.sheet && `（${it.sheet}）`}</b>
              {it.kind && <span className="tag">{KINDS[it.kind].label}</span>}
              {it.kind && <span className="sub">{[...new Set(Object.keys(it.months).map((k) => SC[k.split("|")[0] as Scenario]))].join("・")}／{monthsOf(it).map(ymLabel).join("、").slice(0, 60)}／{Object.values(it.months).reduce((s, r) => s + r.length, 0)}行</span>}
              <span className={`tag right ${it.state === "done" ? "st-action" : it.state === "error" ? "sev-bad" : "st-open"}`}>{{ confirm: "確認待ち", saving: "取込中…", done: "取込済み", error: "取り込めません" }[it.state]}</span>
            </div>
            {it.error && <p className="neg">{it.error}</p>}
            {it.error.includes("年月") && <p>対象の月を選ぶ：<select defaultValue="" onChange={(e) => e.target.value && retryWithMonth(it, e.target.value)} aria-label="対象の月"><option value="">選んでください</option>{pickMonths.map((m) => <option key={m} value={m}>{ymLabel(m)}</option>)}</select></p>}
            {it.kind && it.mappedBy === "AI" && <p className="hint">見出しが決まった形でないため、AIが列を見分けました：{KINDS[it.kind].fields.filter((f) => it.columns[f.key]).map((f) => `${f.label}←「${it.columns[f.key]}」`).join("、")}</p>}
            {it.warnings.map((w, i) => <p key={i} className="warnline">{w}</p>)}
            {rep.length > 0 && <p className="warnline">取込済みの {rep.slice(0, 6).join("、")}{rep.length > 6 ? " ほか" : ""} を、このファイルの内容で置き換えます。</p>}
            {it.state === "confirm" && <div className="row"><button className="btn pri" disabled={!!app.busy} onClick={() => confirmSave(it)}>{rep.length ? "置き換えて取り込む" : "この内容で取り込む"}</button><button className="link" onClick={() => setItems(items.filter((x) => x.id !== it.id))}>やめる</button></div>}
            {it.kind && it.state !== "done" && it.sample.length > 0 && (
              <div className="scroll-x"><table className="tbl compact preview"><thead><tr>{it.headers.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
                <tbody>{it.sample.slice(0, 3).map((r, i) => <tr key={i}>{it.headers.map((_, c) => <td key={c}>{r[c]}</td>)}</tr>)}</tbody></table></div>)}
          </div>); })}
      </section>

      <section className="panel">
        <div className="panel-head"><h2>取込状況</h2><span className="sub">実績は5種類そろうと、その月のダッシュボードと報告書が作られます</span></div>
        <table className="tbl status">
          <thead><tr><th>月</th>{KIND_ORDER.map((k) => <th key={k}>{KINDS[k].label}<small>{KINDS[k].from}</small></th>)}<th>予算</th></tr></thead>
          <tbody>{grid.map((ym) => { const have = KIND_ORDER.map((k) => st.get(dsKey(k, "actual", ym))); const n = have.filter(Boolean).length; return (
            <tr key={ym} className={n === 0 ? "none" : ""}><th>{ymLabel(ym)}{n > 0 && n < 5 && <span className="tag sev-warn">あと{5 - n}種類</span>}{n === 0 && <span className="tag">未着手</span>}</th>
              {have.map((rows, i) => <td key={i} className={rows ? "ok" : "ng"}>{rows ? `✓ ${rows.length}行` : "未取込"}</td>)}
              <td className={KIND_ORDER.every((k) => st.has(dsKey(k, "budget", ym))) ? "ok" : "ng"}>{KIND_ORDER.every((k) => st.has(dsKey(k, "budget", ym))) ? "✓" : "未取込"}</td></tr>); })}</tbody>
        </table>
      </section>

      <section className="panel">
        <div className="panel-head"><h2>サンプルファイル（{ymLabel(SAMPLE_NEXT)}度）</h2><span className="sub">取込を試すためのファイル。ダウンロードして、上の枠に入れてください</span></div>
        <table className="tbl"><tbody>{samples.map((f) => (
          <tr key={f.name}><th>{f.name}</th><td>{KINDS[f.kind].label}（{KINDS[f.kind].from}）</td><td className="mute">{f.note}</td><td><button className="btn" onClick={() => downloadSample(f)}>ダウンロード</button></td></tr>))}</tbody></table>
      </section>

      <section className="panel">
        <div className="panel-head"><h2>取込履歴</h2>
          <button className="link right" onClick={() => confirm("取り込んだデータ・判断・考え方をすべて消して、最初のサンプルデータに戻します。よろしいですか？") && app.rpc("reset", {}, "サンプルデータに戻しています…")}>サンプルデータに戻す</button></div>
        {history.length === 0 ? <p className="empty">まだ取り込んだファイルはありません（いま入っているのは初期のサンプルデータです）。</p> : (
          <table className="tbl">
            <thead><tr><th>日時</th><th>ファイル</th><th>種類</th><th>対象月</th><th className="n">行数</th><th>取込者</th><th>注意</th><th /></tr></thead>
            <tbody>{history.map((h) => (
              <tr key={h.id}><td className="nowrap">{dateTime(h.createdAt)}</td><th>{h.fileName}</th><td className="nowrap">{KINDS[h.kind].label}（{SC[h.scenario]}）</td>
                <td>{h.months.length > 3 ? `${ymShort(h.months[0])}〜${ymShort(h.months[h.months.length - 1])}` : h.months.map(ymShort).join("、")}</td><td className="n">{fmt(h.rowCount)}</td><td className="nowrap">{h.actor}</td>
                <td className="mute">{h.warnings.join(" ")}</td><td><button className="link" onClick={() => confirm(`「${h.fileName}」で取り込んだデータを取り消しますか？`) && app.rpc("import.delete", { id: h.id })}>取り消す</button></td></tr>))}</tbody>
          </table>)}
      </section>
    </div>
  );
}

export function DataView() {
  const { store: st, datasets, ym } = useApp();
  const [kind, setKind] = useState<Kind>("sales");
  const [sc, setSc] = useState<Scenario>("actual");
  const all = useMemo(() => [...new Set(datasets.map((d) => d.ym))].sort().reverse(), [datasets]);
  const [from, setFrom] = useState(""), [to, setTo] = useState(""), [q, setQ] = useState("");
  const f = from || ym, t = to || ym, fields = KINDS[kind].fields;
  const rows = useMemo(() => {
    const out: (Row & { ym: string })[] = [];
    for (const m of ymRange(f <= t ? f : t, f <= t ? t : f)) for (const r of st.get(dsKey(kind, sc, m)) ?? []) out.push({ ...r, ym: m });
    const key = q.trim().toLowerCase();
    return key ? out.filter((r) => fields.some((x) => x.type === "dim" && String(r[x.key] ?? "").toLowerCase().includes(key))) : out;
  }, [st, kind, sc, f, t, q, fields]);
  const sum = (key: string) => rows.reduce((s, r) => s + Number(r[key] ?? 0), 0);
  const download = () => saveBlob(`${KINDS[kind].label}_${SC[sc]}_${f}_${t}.csv`, toCsv([["年月", ...fields.map((x) => x.label + (x.unit ? `(${x.unit})` : ""))], ...rows.map((r) => [r.ym.replace("-", "/"), ...fields.map((x) => r[x.key] ?? "")])]), "text/csv;charset=utf-8");
  return (
    <section className="panel">
      <div className="panel-head"><h2>データ一覧</h2><span className="sub">取り込んだ明細をそのまま確認できます。過去の月もここから参照します</span></div>
      <div className="controls">
        <div className="field"><span>種類</span><div className="seg">{KIND_ORDER.map((k) => <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{KINDS[k].label}</button>)}</div></div>
        <div className="field"><span>区分</span><div className="seg">{(["actual", "budget"] as const).map((s) => <button key={s} className={sc === s ? "on" : ""} onClick={() => setSc(s)}>{SC[s]}</button>)}</div></div>
        <label className="field"><span>期間</span><span className="row"><select value={f} onChange={(e) => setFrom(e.target.value)}>{all.map((m) => <option key={m} value={m}>{ymLabel(m)}</option>)}</select>〜
          <select value={t} onChange={(e) => setTo(e.target.value)}>{all.map((m) => <option key={m} value={m}>{ymLabel(m)}</option>)}</select></span></label>
        <label className="field"><span>検索</span><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="得意先・科目・部門など" /></label>
        <div className="field"><span>&nbsp;</span><button className="btn" disabled={!rows.length} onClick={download}>CSVで保存</button></div>
      </div>
      {rows.length === 0 ? <p className="empty">この条件のデータはありません。</p> : (
        <div className="scroll-x tall"><table className="tbl compact sticky">
          <thead><tr><th>年月</th>{fields.map((x) => <th key={x.key} className={x.type === "num" ? "n" : ""}>{x.label}{x.unit && <small>（{x.unit}）</small>}</th>)}</tr></thead>
          <tbody>{rows.slice(0, 1000).map((r, i) => <tr key={i}><td className="nowrap">{ymLabel(r.ym)}</td>{fields.map((x) => <td key={x.key} className={x.type === "num" ? "n" : ""}>{x.type === "num" ? fmt(Number(r[x.key] ?? 0)) : r[x.key]}</td>)}</tr>)}</tbody>
          <tfoot><tr><th>合計（{fmt(rows.length)}行）</th>{fields.map((x) => <td key={x.key} className="n">{x.type === "num" && x.key !== "days" ? fmt(sum(x.key)) : ""}</td>)}</tr></tfoot>
        </table></div>)}
      {rows.length > 1000 && <p className="cap">先頭の1,000行を表示しています。すべての行は「CSVで保存」で取り出せます。</p>}
    </section>
  );
}
