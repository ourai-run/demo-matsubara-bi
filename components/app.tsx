"use client";
// 画面の枠：上の帯（対象月・比較の切り替え）、左のメニュー、中央の画面、右のAIパネル。
import { BASIS_LABEL } from "@/lib/analytics";
import { AppProvider, type View, useApp } from "@/lib/client";
import { USERS, ymLabel } from "@/lib/model";
import AiPanel from "./ai-panel";
import Board from "./board";
import Dashboard from "./dashboard";
import { DataView, ImportView } from "./data";
import Explore from "./explore";
import Forecast from "./forecast";
import Report from "./report";

const MENU: { view: View; label: string; hint: string }[] = [
  { view: "dashboard", label: "月次ダッシュボード", hint: "今月の数字と示唆" },
  { view: "explore", label: "切り口分析", hint: "軸を変えて見る" },
  { view: "board", label: "役員会", hint: "議論・判断・考え方" },
  { view: "report", label: "月次報告書", hint: "印刷・Excel出力" },
  { view: "forecast", label: "着地見込み・試算", hint: "年度末の見通し" },
  { view: "import", label: "データ取込", hint: "ファイルを入れる" },
  { view: "data", label: "データ一覧", hint: "明細・過去データ" },
];

function Frame() {
  const app = useApp(), { view, ym, months } = app;
  if (!app.loaded) return <div className="splash">読み込んでいます…</div>;
  if (app.error) return <div className="splash"><p>{app.error}</p><button className="btn pri" onClick={() => location.reload()}>読み込み直す</button></div>;
  const i = months.indexOf(ym), hasMonth = !!ym, shown: View = hasMonth ? view : view === "data" ? "data" : "import";
  const open = app.monthInsights.filter((x) => x.status === "open").length;
  const sample = app.datasets.some((d) => d.importId === "sample");
  return (
    <div className={`shell${app.aiOpen && hasMonth ? " with-ai" : ""}`}>
      <header className="top">
        <div className="brand"><span className="brand-mark" aria-hidden><i /><i /><i /></span><span><b>マツバラ</b> 月次業績・経営分析</span></div>
        {hasMonth && shown !== "import" && (
          <div className="top-controls">
            <div className="monthnav">
              <button aria-label="前の月" disabled={i >= months.length - 1} onClick={() => app.set({ ym: months[i + 1], focus: "" })}>◀</button>
              <select value={ym} onChange={(e) => app.set({ ym: e.target.value, focus: "" })} aria-label="対象月">{months.map((m) => <option key={m} value={m}>{ymLabel(m)}度</option>)}</select>
              <button aria-label="次の月" disabled={i <= 0} onClick={() => app.set({ ym: months[i - 1], focus: "" })}>▶</button>
            </div>
            {shown === "dashboard" && <>
              <div className="seg" role="group" aria-label="期間"><button className={app.span === "month" ? "on" : ""} onClick={() => app.set({ span: "month" })}>単月</button>
                <button className={app.span === "ytd" ? "on" : ""} onClick={() => app.set({ span: "ytd", basis: app.basis === "pm" ? "budget" : app.basis })}>年度累計</button></div>
              <div className="seg" role="group" aria-label="比較"><span className="seg-label">比較</span>
                {(["budget", "py", "pm"] as const).map((b) => <button key={b} disabled={b === "pm" && app.span === "ytd"} className={app.basis === b ? "on" : ""} onClick={() => app.set({ basis: b })}>{BASIS_LABEL[b]}</button>)}</div>
            </>}
          </div>
        )}
        <div className="top-right">
          <label className="actor">操作者<select value={app.actor} onChange={(e) => app.set({ actor: e.target.value })}>{USERS.map((u) => <option key={u.id}>{u.name}</option>)}</select></label>
          {hasMonth && <button className={`btn ai-toggle${app.aiOpen ? " on" : ""}`} onClick={() => app.set({ aiOpen: !app.aiOpen })}>AI{open > 0 && <span className="badge">{open}</span>}</button>}
        </div>
      </header>
      <nav className="side" aria-label="メニュー">
        {MENU.map((m) => (
          <button key={m.view} className={shown === m.view ? "on" : ""} disabled={!hasMonth && m.view !== "import" && m.view !== "data"} onClick={() => app.set({ view: m.view })}>
            <b>{m.label}{m.view === "board" && open > 0 && <span className="badge">{open}</span>}</b><small>{m.hint}</small>
          </button>
        ))}
        {sample && <p className="side-note">表示中の数字は<br />サンプルデータです</p>}
      </nav>
      <main className="main" id="main">
        {!hasMonth && shown === "import" && <p className="panel empty">実績データがまだありません。下の枠にファイルを入れてください。</p>}
        {shown === "dashboard" && <Dashboard />}
        {shown === "explore" && <Explore />}
        {shown === "board" && <Board />}
        {shown === "report" && <Report />}
        {shown === "forecast" && <Forecast />}
        {shown === "import" && <ImportView />}
        {shown === "data" && <DataView />}
      </main>
      {app.aiOpen && hasMonth && <AiPanel />}
      {app.busy && <div className="busy" role="status"><span className="spinner" aria-hidden />{app.busy}</div>}
      {app.toast && <div className="toast" role="alert">{app.toast}</div>}
    </div>
  );
}

export default function App() { return <AppProvider><Frame /></AppProvider>; }
