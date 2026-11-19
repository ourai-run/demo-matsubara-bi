"use client";
// 役員会。示唆ごとに議論と判断を記録し、判断の理由からAIが「考え方」を学ぶ。決定事項のフォローと、覚えた考え方の管理もここで行う。
import { useEffect, useRef, useState } from "react";
import { anchorLabel } from "@/lib/analytics";
import { useApp } from "@/lib/client";
import { type InsightStatus, type Policy, POLICY_KIND_LABEL, STATUS_LABEL, USERS, ymLabel } from "@/lib/model";
import { InsightDetail, PolicyProposal } from "./insight";

interface MinuteItem { insight_id: string; status: InsightStatus; reason: string; speaker: string; action_title: string; action_owner: string; action_due: string }
type Recognition = { lang: string; continuous: boolean; onresult: (e: { resultIndex: number; results: { 0: { transcript: string } }[] }) => void; onend: () => void; start: () => void; stop: () => void };

function Minutes() {
  const app = useApp(), { ym, monthInsights, minutes } = app;
  const [text, setText] = useState(minutes.find((m) => m.ym === ym)?.text ?? "");
  const [items, setItems] = useState<MinuteItem[] | null>(null);
  const [others, setOthers] = useState<string[]>([]);
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const canListen = "SpeechRecognition" in window || "webkitSpeechRecognition" in window; // この画面は読み込み後（ブラウザ上）でしか描かれない
  useEffect(() => () => rec.current?.stop(), []);
  const listen = () => {
    if (listening) return rec.current?.stop();
    const w = window as unknown as Record<string, new () => Recognition>;
    const r = new (w.SpeechRecognition ?? w.webkitSpeechRecognition)();
    r.lang = "ja-JP"; r.continuous = true;
    r.onresult = (e) => { let s = ""; for (let i = e.resultIndex; i < e.results.length; i++) s += e.results[i][0].transcript; setText((t) => (t ? t + "\n" : "") + s); };
    r.onend = () => setListening(false);
    rec.current = r; r.start(); setListening(true);
  };
  const read = async () => {
    const r = await app.rpc("minutes.parse", { ym, text, actor: app.actor }, "議事メモを読んでいます…");
    const out = r.result as { items: MinuteItem[]; others: string[] } | undefined;
    if (out) { setItems(out.items); setOthers(out.others); }
  };
  const applyOne = async (it: MinuteItem, n = "") => {
    const actor = USERS.find((u) => u.name === it.speaker)?.name ?? app.actor;
    const r = await app.rpc("insight.decide", { id: it.insight_id, status: it.status, reason: it.reason, actor, action: { title: it.action_title, owner: it.action_owner, due: it.action_due } }, `判断を記録し、考え方を整理しています…${n}`);
    if (!r.error) setItems((list) => list?.filter((x) => x !== it) ?? null);
    return !r.error;
  };
  const applyAll = async () => { const list = items ?? []; for (let i = 0; i < list.length; i++) if (!(await applyOne(list[i], `（${i + 1}/${list.length}）`))) break; };
  return (
    <div className="minutes">
      <p className="hint">会議の書き起こしやメモをそのまま貼ってください。どの示唆に対する発言かをAIが読み取り、判断の案を作ります。内容を確かめてから反映します。</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} aria-label="議事メモ"
        placeholder={"例）\n社長：鋼屑の件は、スライドのない得意先への値上げ交渉を急ごう。営業で11月末までに。\n取締役（製造）：SM-60V 2号の不良はまだ金額が小さいので、来月まで様子を見たい。"} />
      <div className="row">
        <button className="btn pri" disabled={text.trim().length < 10 || !!app.busy} onClick={read}>判断を読み取る</button>
        {canListen && <button className={`btn${listening ? " rec" : ""}`} onClick={listen}>{listening ? "■ 聞き取りを止める" : "🎤 会議の音声を聞き取る"}</button>}
      </div>
      {items && (
        <div className="minute-items">
          <div className="row"><b>読み取った判断 {items.length}件</b>{items.length > 1 && <button className="btn pri" disabled={!!app.busy} onClick={applyAll}>すべて反映</button>}</div>
          {items.length === 0 && <p className="mute">反映できる判断はありません。</p>}
          {items.map((it, i) => { const ins = monthInsights.find((x) => x.id === it.insight_id); return (
            <div className="minute-item" key={i}>
              <div><span className={`pin sev-${ins?.severity}`}>{ins?.seq}</span><b>{ins?.title}</b><span className={`tag st-${it.status}`}>{STATUS_LABEL[it.status]}</span><span className="who">{it.speaker}</span></div>
              <p>{it.reason}</p>
              {it.action_title && <p className="act">決定事項：{it.action_title}<span className="who">（担当 {it.action_owner || "未定"}／期限 {it.action_due || "未定"}）</span></p>}
              <div className="row"><button className="btn" disabled={!!app.busy} onClick={() => applyOne(it)}>この判断を反映</button><button className="link" onClick={() => setItems(items.filter((x) => x !== it))}>反映しない</button></div>
            </div>); })}
          {others.length > 0 && <div className="minute-others"><b>示唆とは別の決定・宿題（記録のみ）</b><ul>{others.map((o, i) => <li key={i}>{o}</li>)}</ul></div>}
        </div>
      )}
    </div>
  );
}

function PolicyRow({ p }: { p: Policy }) {
  const { rpc, insights } = useApp();
  const [edit, setEdit] = useState(false);
  const [rule, setRule] = useState(p.rule);
  const src = insights.find((i) => i.id === p.sourceInsightId);
  return (
    <tr className={p.status === "off" ? "off" : ""}>
      <td><span className="tag">{POLICY_KIND_LABEL[p.kind]}</span></td>
      <td>{edit ? <textarea value={rule} onChange={(e) => setRule(e.target.value)} rows={3} aria-label="考え方の内容" /> : p.rule}
        <div className="who">{p.sourceYm ? `${ymLabel(p.sourceYm)}の役員会${src ? `「${src.title}」への判断（${src.decidedBy}）` : ""}から` : `${p.actor}が登録`}{p.scope !== "all" && `・対象：${anchorLabel(p.scope)}`}</div></td>
      <td className="nowrap">
        {edit ? <><button className="btn pri" onClick={async () => { if (!(await rpc("policy.save", { id: p.id, rule })).error) setEdit(false); }}>保存</button> <button className="link" onClick={() => { setRule(p.rule); setEdit(false); }}>やめる</button></>
          : <><label className="switch"><input type="checkbox" checked={p.status === "active"} onChange={(e) => rpc("policy.save", { id: p.id, status: e.target.checked ? "active" : "off" })} />{p.status === "active" ? "使う" : "使わない"}</label>
            <button className="link" onClick={() => setEdit(true)}>直す</button>
            <button className="link" onClick={() => confirm("この考え方を削除しますか？") && rpc("policy.delete", { id: p.id })}>削除</button></>}
      </td>
    </tr>
  );
}

export default function Board() {
  const app = useApp(), { ym, monthInsights, actions, policies } = app;
  const [showMinutes, setShowMinutes] = useState(false);
  const [adding, setAdding] = useState(false);
  const [rule, setRule] = useState("");
  const [kind, setKind] = useState<Policy["kind"]>("context");
  const count = (s: InsightStatus) => monthInsights.filter((i) => i.status === s).length;
  const orphan = policies.filter((p) => p.status === "proposed" && !monthInsights.some((i) => i.id === p.sourceInsightId));
  const known = policies.filter((p) => p.status !== "proposed").sort((a, b) => (a.sourceYm || "9").localeCompare(b.sourceYm || "9") || a.createdAt.localeCompare(b.createdAt));
  const list = [...actions].sort((a, b) => (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1) || b.ym.localeCompare(a.ym));
  const overdue = (due: string) => due && due < new Date().toISOString().slice(0, 10);
  return (
    <div className="board">
      <section className="panel">
        <div className="panel-head"><h2>{ymLabel(ym)}度 役員会</h2>
          <span className="sub">示唆 {monthInsights.length}件：未判断 {count("open")}・対応する {count("action")}・静観する {count("watch")}・問題なし {count("dismiss")}・別の判断 {count("other")}</span>
          <button className="btn right" onClick={() => setShowMinutes(!showMinutes)}>{showMinutes ? "議事メモを閉じる" : "議事メモから判断を読み取る"}</button></div>
        {showMinutes && <Minutes key={ym} />}
        {monthInsights.length === 0 && <p className="empty">この月の示唆はまだありません。月次ダッシュボードで「AI分析を実行」を押してください。</p>}
      </section>
      {monthInsights.map((i) => <InsightDetail key={i.id} ins={i} wide />)}

      <section className="panel">
        <div className="panel-head"><h2>決定事項のフォロー</h2><span className="sub">役員会で「対応する」と決めたこと。進み具合は翌月のAI分析でも確認されます</span></div>
        {list.length === 0 ? <p className="empty">決定事項はまだありません。</p> : (
          <table className="tbl">
            <thead><tr><th>決定月</th><th>やること</th><th>担当</th><th>期限</th><th>状態</th><th>メモ</th></tr></thead>
            <tbody>{list.map((a) => (
              <tr key={a.id} className={a.status !== "open" ? "off" : ""}>
                <td className="nowrap">{ymLabel(a.ym)}</td><td>{a.title}</td><td className="nowrap">{a.owner || "未定"}</td>
                <td className={`nowrap ${a.status === "open" && overdue(a.due) ? "neg" : ""}`}>{a.due || "未定"}{a.status === "open" && overdue(a.due) && "（超過）"}</td>
                <td><select value={a.status} aria-label="状態" onChange={(e) => app.rpc("action.save", { id: a.id, status: e.target.value })}><option value="open">進行中</option><option value="done">完了</option><option value="dropped">中止</option></select></td>
                <td><input key={a.note} defaultValue={a.note} placeholder="進み具合を記録" aria-label="メモ" onBlur={(e) => e.target.value !== a.note && app.rpc("action.save", { id: a.id, note: e.target.value })} /></td>
              </tr>))}</tbody>
          </table>)}
      </section>

      <section className="panel">
        <div className="panel-head"><h2>AIが覚えた役員会の考え方</h2><span className="sub">役員会の判断から学んだ見方。毎月のAI分析はこれに従って示唆を出します（{policies.filter((p) => p.status === "active").length}件を使用中）</span>
          <button className="btn right" onClick={() => setAdding(!adding)}>考え方を追加</button></div>
        {adding && (
          <div className="add-policy">
            <select value={kind} onChange={(e) => setKind(e.target.value as Policy["kind"])} aria-label="種類">{Object.entries(POLICY_KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <textarea value={rule} onChange={(e) => setRule(e.target.value)} rows={2} placeholder="例）営業利益への影響が月2百万円未満の差異は、個別には取り上げない。" aria-label="考え方の内容" />
            <button className="btn pri" disabled={!rule.trim()} onClick={async () => { if (!(await app.rpc("policy.save", { rule, kind, status: "active", actor: app.actor })).error) { setRule(""); setAdding(false); } }}>登録</button>
          </div>)}
        {orphan.map((p) => <PolicyProposal key={p.id} policy={p} />)}
        {known.length === 0 ? <p className="empty">まだありません。示唆に判断と理由を記録すると、AIがここに考え方を提案します。</p> : (
          <table className="tbl policies"><thead><tr><th>種類</th><th>内容と出どころ</th><th /></tr></thead><tbody>{known.map((p) => <PolicyRow key={p.id + p.rule} p={p} />)}</tbody></table>)}
      </section>
    </div>
  );
}
