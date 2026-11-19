"use client";
// 画面全体で共有する状態。サーバーの全データを最初に1回読み、操作の結果（patch）を重ねていく。
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  type ActionItem, type Analysis, type ChatMessage, type Comment, type Dataset, type ImportLog, type Insight, type Policy, type Report, USERS,
} from "./model.ts";
import { type Basis, type Filters, type Span, type Store, closedMonths, toStore } from "./analytics.ts";

export type View = "dashboard" | "explore" | "board" | "report" | "forecast" | "import" | "data";
export interface ExploreSpec { measure: string; axis: string; span: Span | "trend"; basis: Basis; filters: Filters; title?: string }
type Doc = { id: string } & Record<string, unknown>;
type Patch = { put?: Record<string, Doc[]>; del?: Record<string, string[]> };
export interface OpResult { patch?: Patch; result?: unknown; aiError?: string; reload?: boolean; error?: string }
export type ChatDoc = ChatMessage & { views?: ExploreSpec[] };

interface Ui { view: View; ym: string; span: Span; basis: Basis; actor: string; aiOpen: boolean; aiTab: "insights" | "chat"; focus: string; explore: ExploreSpec }
export interface App extends Ui {
  loaded: boolean; error: string; model: string; busy: string; toast: string;
  store: Store; datasets: Dataset[]; months: string[];
  insights: Insight[]; analyses: Analysis[]; comments: Comment[]; actions: ActionItem[]; policies: Policy[]; reports: Report[];
  imports: ImportLog[]; chats: ChatDoc[]; minutes: { id: string; ym: string; text: string; actor: string; createdAt: string }[];
  monthInsights: Insight[]; analysis?: Analysis;
  set: (p: Partial<Ui>) => void;
  rpc: (op: string, args: Record<string, unknown>, busy?: string) => Promise<OpResult>;
  merge: (p?: Patch) => void; say: (msg: string) => void; reload: () => Promise<void>;
  openInsight: (id: string) => void; openExplore: (spec: Partial<ExploreSpec>) => void;
}
const Ctx = createContext<App | null>(null);
export const useApp = () => useContext(Ctx)!;

const VIEWS: View[] = ["dashboard", "explore", "board", "report", "forecast", "import", "data"];
const EXPLORE0: ExploreSpec = { measure: "sales", axis: "customer", span: "month", basis: "budget", filters: {} };
const NONE: Doc[] = [];
async function fetchState() {
  try {
    const res = await fetch("/api/state", { cache: "no-store" });
    const j = (await res.json()) as { collections: Record<string, Doc[]>; model: string; error?: string };
    if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
    return { col: j.collections, meta: { loaded: true, error: "", model: j.model } };
  } catch (e) { return { col: {}, meta: { loaded: true, error: e instanceof Error ? e.message : "読み込みに失敗しました。", model: "" } }; }
}
const stored = (k: string) => { try { return localStorage.getItem(k) ?? ""; } catch { return ""; } };

export function AppProvider({ children }: { children: ReactNode }) {
  const [col, setCol] = useState<Record<string, Doc[]>>({});
  const [meta, setMeta] = useState({ loaded: false, error: "", model: "" });
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");
  const [ui, setUi] = useState<Ui>({ view: "dashboard", ym: "", span: "month", basis: "budget", actor: USERS[0].name, aiOpen: true, aiTab: "insights", focus: "", explore: EXPLORE0 });
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const say = useCallback((msg: string) => { setToast(msg); clearTimeout(timer.current); timer.current = setTimeout(() => setToast(""), 6000); }, []);
  const merge = useCallback((p?: Patch) => {
    if (!p) return;
    setCol((c) => {
      const next = { ...c };
      for (const [k, ids] of Object.entries(p.del ?? {})) if (ids.length) next[k] = (next[k] ?? []).filter((d) => !ids.includes(d.id));
      for (const [k, docs] of Object.entries(p.put ?? {})) {
        const byId = new Map((next[k] ?? []).map((d) => [d.id, d]));
        for (const d of docs) byId.set(d.id, d);
        next[k] = [...byId.values()];
      }
      return next;
    });
  }, []);
  const reload = useCallback(async () => {
    const r = await fetchState();
    setCol(r.col); setMeta(r.meta);
  }, []);
  const rpc = useCallback(async (op: string, args: Record<string, unknown>, label = ""): Promise<OpResult> => {
    if (label) setBusy(label);
    try {
      const res = await fetch("/api/rpc", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op, args }) });
      const j = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as OpResult;
      if (j.error) { say(j.error); return j; }
      merge(j.patch);
      if (j.aiError) say(j.aiError);
      if (j.reload) await reload();
      return j;
    } catch { const error = "通信に失敗しました。接続を確認して、もう一度お試しください。"; say(error); return { error }; }
    finally { if (label) setBusy(""); }
  }, [merge, reload, say]);

  useEffect(() => {
    fetchState().then((r) => { // 最初の読み込み。URLと前回の操作者もここで画面に反映する
      const q = new URLSearchParams(location.search), v = q.get("v") as View;
      setCol(r.col); setMeta(r.meta);
      setUi((u) => ({ ...u, view: VIEWS.includes(v) ? v : u.view, ym: q.get("ym") ?? "", actor: USERS.find((x) => x.name === stored("actor"))?.name ?? u.actor, aiOpen: window.innerWidth >= 1280 }));
    });
  }, []);

  const datasets = (col.dataset ?? NONE) as unknown as Dataset[];
  const store = useMemo(() => toStore(datasets), [datasets]);
  const months = useMemo(() => closedMonths(datasets), [datasets]);
  const ym = months.includes(ui.ym) ? ui.ym : months[0] ?? "";
  useEffect(() => {
    if (!meta.loaded || !ym) return;
    history.replaceState(null, "", `?v=${ui.view}&ym=${ym}`);
  }, [meta.loaded, ui.view, ym]);

  const set = useCallback((p: Partial<Ui>) => {
    if (p.actor) try { localStorage.setItem("actor", p.actor); } catch { /* 保存できなくても動かす */ }
    setUi((u) => ({ ...u, ...p }));
  }, []);
  const insights = (col.insight ?? NONE) as unknown as Insight[], analyses = (col.analysis ?? []) as unknown as Analysis[];
  const app: App = {
    ...ui, ym, ...meta, busy, toast, store, datasets, months, insights, analyses,
    comments: (col.comment ?? []) as unknown as Comment[], actions: (col.action ?? []) as unknown as ActionItem[],
    policies: (col.policy ?? []) as unknown as Policy[], reports: (col.report ?? []) as unknown as Report[],
    imports: (col.import ?? []) as unknown as ImportLog[], chats: (col.chat ?? []) as unknown as ChatDoc[], minutes: (col.minutes ?? []) as unknown as App["minutes"],
    monthInsights: useMemo(() => insights.filter((i) => i.ym === ym).sort((a, b) => a.seq - b.seq), [insights, ym]),
    analysis: analyses.find((a) => a.ym === ym),
    set, rpc, merge, say, reload,
    openInsight: (id) => set({ focus: id, aiOpen: true, aiTab: "insights" }),
    openExplore: (spec) => set({ view: "explore", explore: { ...EXPLORE0, ...spec, filters: spec.filters ?? {} } }),
  };
  return <Ctx.Provider value={app}>{children}</Ctx.Provider>;
}
