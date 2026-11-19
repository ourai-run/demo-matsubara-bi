"use client";
// 右側のAIパネル。今月の示唆の一覧・詳細と、数字についての質問（チャット）。
import { useEffect, useRef, useState } from "react";
import { type Basis, type Filters, AXES, measureOf } from "@/lib/analytics";
import { type ChatDoc, type ExploreSpec, useApp } from "@/lib/client";
import { SEVERITY_LABEL, STATUS_LABEL, ymLabel } from "@/lib/model";
import { InsightDetail } from "./insight";

const SUGGEST = ["今月はどうだった？", "営業利益が予算とずれた理由は？", "前年の同じ月と比べて何が変わった？", "得意先別の販売単価の推移を見せて", "来月に向けて気をつけることは？"];
const VIEW_NAME: Record<string, string> = { dashboard: "月次ダッシュボード", explore: "切り口分析", board: "役員会", report: "月次報告書", forecast: "着地見込み・試算", import: "データ取込", data: "データ一覧" };
type RawView = { measure: string; axis: string; basis: Basis; span: ExploreSpec["span"]; filters: { axis: string; values: string[] }[]; title: string };
const toSpec = (v: RawView): ExploreSpec => ({
  measure: v.measure, axis: v.axis, basis: v.basis, span: v.span, title: v.title,
  filters: Object.fromEntries((v.filters ?? []).map((f) => [f.axis, f.values])) as Filters,
});

function ViewButtons({ views }: { views: RawView[] }) {
  const { openExplore } = useApp();
  return <>{views.map((v, i) => <button key={i} className="btn view-btn" onClick={() => openExplore(toSpec(v))}>▶ {v.title || `${v.axis ? AXES[v.axis] + "別の" : ""}${measureOf(v.measure).label}`} を開く</button>)}</>;
}

function Chat() {
  const app = useApp(), { ym, actor, chats } = app;
  const [input, setInput] = useState("");
  const [live, setLive] = useState<{ q: string; a: string; views: RawView[] } | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const list = chats.filter((m) => m.ym === ym && m.actor === actor).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [list.length, live?.a]);

  const ask = async (q: string) => {
    if (!q.trim() || live) return;
    setInput(""); setLive({ q, a: "", views: [] });
    const screen = `${VIEW_NAME[app.view]}（${app.span === "ytd" ? "年度累計" : "単月"}、比較=${app.basis}）`;
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ym, actor, message: q, screen }) });
      if (!res.ok || !res.body) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || "回答を取得できませんでした。");
      const reader = res.body.getReader(), decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const events = buf.split("\n\n");
        buf = events.pop() ?? "";
        for (const ev of events) {
          if (!ev.startsWith("data: ")) continue;
          const e = JSON.parse(ev.slice(6)) as { t: string; v?: unknown; patch?: Parameters<typeof app.merge>[0] };
          if (e.t === "delta") setLive((l) => l && { ...l, a: l.a + (e.v as string) });
          else if (e.t === "view") setLive((l) => l && { ...l, views: [...l.views, e.v as RawView] });
          else if (e.t === "done") app.merge(e.patch);
          else if (e.t === "error") app.say(e.v as string);
        }
      }
    } catch (e) { app.say(e instanceof Error ? e.message : "回答を取得できませんでした。"); }
    setLive(null);
  };
  const bubble = (m: Pick<ChatDoc, "role" | "content"> & { views?: unknown[] }, key: string) => (
    <div key={key} className={`msg ${m.role}`}>
      <div className="msg-body">{m.content.replace(/\*\*/g, "") || <span className="typing">数字を確認しています…</span>}</div>
      {m.role === "assistant" && m.views && m.views.length > 0 && <ViewButtons views={m.views as RawView[]} />}
    </div>
  );
  return (
    <div className="chat">
      <div className="chat-log">
        {list.length === 0 && !live && (
          <div className="chat-empty">
            <p>{ymLabel(ym)}度の数字について、質問に答えます。別の月や、得意先ごとの推移なども蓄積データから調べます。</p>
            {SUGGEST.map((s) => <button key={s} className="chip" onClick={() => ask(s)}>{s}</button>)}
          </div>
        )}
        {list.map((m) => bubble(m, m.id))}
        {live && <>{bubble({ role: "user", content: live.q }, "lq")}{bubble({ role: "assistant", content: live.a, views: live.views }, "la")}</>}
        <div ref={end} />
      </div>
      <form className="chat-form" onSubmit={(e) => { e.preventDefault(); ask(input); }}>
        <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2} placeholder="例）なぜ材料費率が上がった？" aria-label="AIへの質問"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); ask(input); } }} />
        <div className="row"><button className="btn pri" disabled={!input.trim() || !!live}>{live ? "回答中…" : "質問する"}</button>
          {list.length > 0 && !live && <button type="button" className="link" onClick={() => app.rpc("chat.clear", { ym, actor })}>履歴を消す</button>}</div>
      </form>
    </div>
  );
}

export default function AiPanel() {
  const app = useApp(), { monthInsights, focus, aiTab, ym, analysis } = app;
  const cur = monthInsights.find((i) => i.id === focus);
  return (
    <aside className="ai" aria-label="AIパネル">
      <div className="ai-tabs" role="tablist">
        <button role="tab" aria-selected={aiTab === "insights"} className={aiTab === "insights" ? "on" : ""} onClick={() => app.set({ aiTab: "insights" })}>今月の示唆 {monthInsights.length}</button>
        <button role="tab" aria-selected={aiTab === "chat"} className={aiTab === "chat" ? "on" : ""} onClick={() => app.set({ aiTab: "chat" })}>AIに質問</button>
        <button className="ai-close" onClick={() => app.set({ aiOpen: false })} aria-label="AIパネルを閉じる">×</button>
      </div>
      {aiTab === "chat" ? <Chat key={ym + app.actor} /> : (
        <div className="ai-body">
          {cur ? <><button className="link back" onClick={() => app.set({ focus: "" })}>← 示唆の一覧へ</button><InsightDetail ins={cur} key={cur.id} /></> : <>
            {monthInsights.length === 0 && <p className="empty">{analysis ? "この月の示唆はありません。" : "まだAI分析をしていません。月次ダッシュボードの「AI分析を実行」から始めてください。"}</p>}
            {monthInsights.map((i) => (
              <button key={i.id} className={`ins-row sev-${i.severity}`} onClick={() => app.openInsight(i.id)}>
                <span className={`pin sev-${i.severity}`}>{i.seq}</span>
                <span className="ins-row-text"><b>{i.title}</b><span><span className={`tag sev-${i.severity}`}>{SEVERITY_LABEL[i.severity]}</span><span className={`tag st-${i.status}`}>{STATUS_LABEL[i.status]}</span></span></span>
              </button>
            ))}
            {monthInsights.length > 0 && <p className="hint">番号は、ダッシュボードの図や表に付いている番号と同じです。押すと詳しい内容を表示し、議論と判断を記録できます。</p>}
          </>}
        </div>
      )}
    </aside>
  );
}
