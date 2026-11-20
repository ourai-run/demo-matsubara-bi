// 画面からの操作（/api/rpc）。入力はここで確かめてから保存する。
import {
  type ActionItem, type Analysis, type ChatMessage, type Comment, type Dataset, type ImportLog, type Insight, type InsightStatus,
  type Kind, type Policy, type Report, type Row, type Scenario, KINDS, STATUS_LABEL, USERS, dsKey, ymAdd, ymRange,
} from "../model.ts";
import { AXES, type Filters, type Store, factPack, measure, measureOf, toStore } from "../analytics.ts";
import * as ai from "./ai.ts";
import { type Doc, type Patch, apply, datasetDoc, get, list, seed } from "./db.ts";

export class BadRequest extends Error {}
export interface OpResult { patch?: Patch; result?: unknown; aiError?: string; reload?: boolean }

const uid = (p: string) => `${p}_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
const now = () => new Date().toISOString();
const text = (v: unknown, max = 4000) => {
  if (typeof v !== "string") throw new BadRequest("入力が正しくありません。");
  return v.trim().slice(0, max);
};
const optText = (v: unknown, max = 4000) => (v === undefined || v === null ? "" : text(v, max));
const ymOk = (v: unknown) => {
  if (typeof v !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) throw new BadRequest("年月が正しくありません。");
  return v;
};
const oneOf = <T extends string>(v: unknown, values: readonly T[], what: string): T => {
  if (!values.includes(v as T)) throw new BadRequest(`${what}が正しくありません。`);
  return v as T;
};
const actorOf = (v: unknown) => USERS.find((u) => u.name === v)?.name ?? USERS[0].name;
const need = <T>(v: T | null, what: string): T => {
  if (!v) throw new BadRequest(`${what}が見つかりません。画面を読み込み直してください。`);
  return v;
};
const doc = (d: object) => d as Doc;

/** 取込行を、その種類で決まっている項目だけに整える。 */
function cleanRows(kind: Kind, rows: unknown): Row[] {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 5000) throw new BadRequest("行数が正しくありません（1〜5,000行）。");
  return rows.map((r, i) => {
    if (!r || typeof r !== "object") throw new BadRequest(`${i + 1}行目が正しくありません。`);
    const out: Row = {};
    for (const f of KINDS[kind].fields) {
      const v = (r as Record<string, unknown>)[f.key];
      if (f.type === "num") {
        const n = v === undefined || v === "" ? 0 : Number(v);
        if (!Number.isFinite(n)) throw new BadRequest(`${i + 1}行目の「${f.label}」が数字ではありません。`);
        out[f.key] = n;
      } else if (v !== undefined && v !== "") out[f.key] = String(v).trim().slice(0, 80);
      else if (!f.optional) throw new BadRequest(`${i + 1}行目の「${f.label}」が空です。`);
    }
    return out;
  });
}

const loadStore = async () => toStore(await list<Dataset>("dataset"));

async function generateInsights(ym: string, actor: string): Promise<OpResult> {
  const st = await loadStore();
  if (!st.has(dsKey("sales", "actual", ym))) throw new BadRequest("この月の売上実績がまだ取り込まれていません。");
  const { pack, anchors } = factPack(st, ym);
  const policies = (await list<Policy>("policy")).filter((p) => p.status === "active");
  const insights = await list<Insight>("insight");
  const past = insights.filter((i) => i.ym < ym && i.ym >= ymAdd(ym, -6) && i.status !== "open")
    .map((i) => ({ ym: i.ym, anchor: i.anchor, title: i.title, decision: STATUS_LABEL[i.status], reason: i.reason }));
  const actions = (await list<ActionItem>("action")).filter((a) => a.status === "open" && a.ym < ym)
    .map((a) => ({ decided_in: a.ym, title: a.title, owner: a.owner, due: a.due, note: a.note }));
  const out = await ai.askJson<{
    summary: string;
    insights: (Pick<Insight, "anchor" | "severity" | "title" | "situation" | "cause" | "proposal" | "question" | "evidence"> & { policy_ids: string[] })[];
    suppressed: { anchor: string; topic: string; reason: string; policy_id: string }[];
  }>(ai.INSIGHT_SYSTEM, {
    data: pack,
    policies: policies.map((p) => ({ id: p.id, kind: p.kind, scope: p.scope, rule: p.rule })),
    past_decisions: past, open_actions: actions,
  }, "monthly_insights", ai.insightSchema(anchors));

  // 役員会ですでに判断した示唆は残し、未判断のものだけ作り直す
  const mine = insights.filter((i) => i.ym === ym), keep = mine.filter((i) => i.status !== "open").sort((a, b) => a.seq - b.seq);
  const dropped = mine.filter((i) => i.status === "open").map((i) => i.id);
  const policyIds = new Set(policies.map((p) => p.id));
  const fresh: Insight[] = out.insights.filter((x) => !keep.some((k) => k.anchor === x.anchor)).slice(0, 8).map(({ policy_ids, ...x }) => ({
    ...x, id: uid("ins"), ym, seq: 0, policyIds: policy_ids.filter((id) => policyIds.has(id)),
    status: "open", reason: "", decidedBy: "", decidedAt: "", createdAt: now(),
  }));
  const rank = { bad: 0, warn: 1, good: 2, info: 3 };
  fresh.sort((a, b) => rank[a.severity] - rank[b.severity]);
  const all = [...keep, ...fresh].map((i, n) => ({ ...i, seq: n + 1 }));
  const analysis: Analysis & { id: string } = {
    id: ym, ym, summary: out.summary, suppressed: out.suppressed.filter((s) => policyIds.has(s.policy_id)).map((s) => ({ anchor: s.anchor, topic: s.topic, reason: s.reason, policyId: s.policy_id })),
    model: ai.aiConfig().model, createdAt: now(), actor,
  };
  const comments = (await list<Comment>("comment")).filter((c) => dropped.includes(c.insightId)).map((c) => c.id);
  return { patch: await apply({ del: { insight: dropped, comment: comments }, put: { insight: all.map(doc), analysis: [doc(analysis)] } }) };
}

/** 判断と議論から、来月以降に使える考え方を取り出して「提案」として保存する。 */
async function learnPolicy(insight: Insight, actor: string): Promise<Doc[]> {
  const comments = (await list<Comment>("comment")).filter((c) => c.insightId === insight.id).map((c) => `${c.actor}: ${c.body}`);
  const existing = (await list<Policy>("policy")).filter((p) => p.status !== "off").map((p) => p.rule);
  const out = await ai.askJson<{ policies: Pick<Policy, "rule" | "kind" | "scope">[] }>(ai.POLICY_SYSTEM, {
    insight: { ym: insight.ym, anchor: insight.anchor, title: insight.title, situation: insight.situation, cause: insight.cause, proposal: insight.proposal },
    decision: { status: STATUS_LABEL[insight.status], reason: insight.reason, decided_by: insight.decidedBy }, discussion: comments, existing,
  }, "learned_policies", ai.policySchema);
  return out.policies.slice(0, 1).map((p) => doc({
    id: uid("pol"), rule: p.rule.slice(0, 400), kind: p.kind, scope: p.scope.slice(0, 80), status: "proposed",
    sourceInsightId: insight.id, sourceYm: insight.ym, actor, createdAt: now(),
  } satisfies Policy));
}

async function decide(a: Record<string, unknown>): Promise<OpResult> {
  const insight = need(await get<Insight>("insight", text(a.id, 40)), "示唆");
  const status = oneOf<InsightStatus>(a.status, ["open", "action", "watch", "dismiss", "other"], "判断");
  const actor = actorOf(a.actor);
  const next: Insight = { ...insight, status, reason: optText(a.reason, 1000), decidedBy: status === "open" ? "" : actor, decidedAt: status === "open" ? "" : now() };
  const patch: Patch = { put: { insight: [doc(next)] }, del: {} };
  const actionId = `act_${insight.id}`, act = (a.action ?? {}) as Record<string, unknown>;
  if (status === "action") {
    const prev = await get<ActionItem>("action", actionId);
    patch.put!.action = [doc({
      id: actionId, insightId: insight.id, ym: insight.ym, title: optText(act.title, 200) || insight.proposal.slice(0, 200), owner: optText(act.owner, 40), due: optText(act.due, 10),
      status: prev?.status ?? "open", note: prev?.note ?? "", createdAt: prev?.createdAt ?? now(), updatedAt: now(),
    } satisfies ActionItem)];
  } else patch.del!.action = [actionId];
  await apply(patch);
  if (status === "open" || !next.reason || a.learn === false) return { patch };
  try {
    const proposed = await learnPolicy(next, actor);
    if (proposed.length) { await apply({ put: { policy: proposed } }); patch.put!.policy = proposed; }
    return { patch };
  } catch (e) {
    if (!(e instanceof ai.AiError)) throw e;
    return { patch, aiError: e.message }; // 判断そのものは保存済み
  }
}

/** チャットの道具：蓄積データの集計。 */
export function queryData(st: Store, a: { measure: string; axis: string; from: string; to: string; by_month: boolean; filters: { axis: string; values: string[] }[] }) {
  const m = measureOf(a.measure), axis = m.axes.includes(a.axis) ? a.axis : "";
  const filters: Filters = Object.fromEntries((a.filters ?? []).map((f) => [f.axis, f.values]));
  const ok = (v: string) => /^\d{4}-\d{2}$/.test(v);
  if (!ok(a.from) || !ok(a.to) || a.from > a.to) return { error: "from / to は YYYY-MM で、from <= to にしてください。" };
  const yms = ymRange(a.from, a.to).slice(-36), r = (v: number | undefined) => (v === undefined ? null : Number(v.toFixed(m.digits)));
  const table = (period: string[], label: Record<string, string>) => {
    const A = measure(st, m, { sc: "actual", yms: period }, axis, filters), B = measure(st, m, { sc: "budget", yms: period }, axis, filters);
    return [...new Set([...A.keys(), ...B.keys()])].map((k) => ({ ...label, ...(axis ? { [AXES[axis]]: k } : {}), actual: r(A.get(k)), budget: r(B.get(k)) }));
  };
  const rows = a.by_month ? yms.flatMap((ym) => table([ym], { ym })) : table(yms, {});
  return { measure: m.label, unit: m.unit, period: `${yms[0]}〜${yms[yms.length - 1]}`, note: "actual が null の月は実績が未取込", rows: rows.slice(0, 400) };
}

export const OPS: Record<string, (a: Record<string, unknown>) => Promise<OpResult>> = {
  async "import.save"(a) {
    const kind = oneOf<Kind>(a.kind, Object.keys(KINDS) as Kind[], "データの種類");
    const scenario = oneOf<Scenario>(a.scenario, ["actual", "budget"], "予算・実績の区分");
    const months = Object.entries((a.months ?? {}) as Record<string, unknown>);
    if (!months.length || months.length > 36) throw new BadRequest("取り込む月が正しくありません（1〜36か月）。");
    const id = uid("imp");
    const datasets = months.map(([ym, rows]) => datasetDoc({ kind, scenario, ym: ymOk(ym), rows: cleanRows(kind, rows), importId: id }));
    const log: ImportLog = {
      id, fileName: text(a.fileName, 200), kind, scenario, months: months.map(([ym]) => ym).sort(),
      rowCount: datasets.reduce((s, d) => s + (d.rows as Row[]).length, 0),
      warnings: Array.isArray(a.warnings) ? a.warnings.slice(0, 20).map((w) => String(w).slice(0, 200)) : [], actor: actorOf(a.actor), createdAt: now(),
    };
    return { patch: await apply({ put: { dataset: datasets, import: [doc(log)] } }) };
  },
  async "import.delete"(a) {
    const id = text(a.id, 40);
    const ids = (await list<Dataset & { id: string }>("dataset")).filter((d) => d.importId === id).map((d) => d.id);
    return { patch: await apply({ del: { dataset: ids, import: [id] } }) };
  },
  "insights.generate": (a) => generateInsights(ymOk(a.ym), actorOf(a.actor)),
  "insight.decide": decide,
  async "insight.comment"(a) {
    const insight = need(await get<Insight>("insight", text(a.insightId, 40)), "示唆");
    const c: Comment = { id: uid("cmt"), insightId: insight.id, actor: actorOf(a.actor), body: text(a.body, 1000), createdAt: now() };
    if (!c.body) throw new BadRequest("発言の内容を入力してください。");
    return { patch: await apply({ put: { comment: [doc(c)] } }) };
  },
  async "minutes.parse"(a) {
    const ym = ymOk(a.ym), memo = text(a.text, 20000);
    if (memo.length < 10) throw new BadRequest("議事メモを入力してください。");
    const insights = (await list<Insight>("insight")).filter((i) => i.ym === ym).sort((x, y) => x.seq - y.seq);
    if (!insights.length) throw new BadRequest("この月の示唆がありません。先にAI分析を実行してください。");
    const result = await ai.askJson(ai.MINUTES_SYSTEM, {
      insights: insights.map((i) => ({ insight_id: i.id, number: i.seq, title: i.title, situation: i.situation, proposal: i.proposal })),
      officers: USERS.map((u) => u.name), today: now().slice(0, 10), minutes: memo,
    }, "minutes", ai.minutesSchema(insights.map((i) => i.id)));
    const patch = await apply({ put: { minutes: [{ id: ym, ym, text: memo, actor: actorOf(a.actor), createdAt: now() }] } });
    return { patch, result };
  },
  async "policy.save"(a) {
    const prev = a.id ? await get<Policy>("policy", text(a.id, 40)) : null;
    const p: Policy = {
      id: prev?.id ?? uid("pol"), rule: text(a.rule ?? prev?.rule, 400),
      kind: oneOf(a.kind ?? prev?.kind ?? "context", ["suppress", "threshold", "focus", "context"] as const, "種類"),
      scope: optText(a.scope ?? prev?.scope, 80) || "all", status: oneOf(a.status ?? prev?.status ?? "active", ["proposed", "active", "off"] as const, "状態"),
      sourceInsightId: prev?.sourceInsightId ?? "", sourceYm: prev?.sourceYm ?? "", actor: prev?.actor ?? actorOf(a.actor), createdAt: prev?.createdAt ?? now(),
    };
    if (!p.rule) throw new BadRequest("考え方の内容を入力してください。");
    return { patch: await apply({ put: { policy: [doc(p)] } }) };
  },
  "policy.delete": async (a) => ({ patch: await apply({ del: { policy: [text(a.id, 40)] } }) }),
  async "action.save"(a) {
    const prev = need(await get<ActionItem>("action", text(a.id, 60)), "決定事項");
    const next: ActionItem = {
      ...prev, title: optText(a.title ?? prev.title, 200), owner: optText(a.owner ?? prev.owner, 40), due: optText(a.due ?? prev.due, 10),
      note: optText(a.note ?? prev.note, 500), status: oneOf(a.status ?? prev.status, ["open", "done", "dropped"] as const, "状態"), updatedAt: now(),
    };
    return { patch: await apply({ put: { action: [doc(next)] } }) };
  },
  async "report.save"(a) {
    const ym = ymOk(a.ym), prev = await get<Report>("report", ym), actor = actorOf(a.actor);
    const status = oneOf(a.status ?? prev?.status ?? "draft", ["draft", "final"] as const, "状態");
    const next: Report & { id: string } = {
      id: ym, ym, status, comment: a.comment === undefined ? prev?.comment ?? "" : text(a.comment, 4000),
      finalizedBy: status === "final" ? prev?.finalizedBy || actor : "", finalizedAt: status === "final" ? prev?.finalizedAt || now() : "", updatedAt: now(),
    };
    return { patch: await apply({ put: { report: [doc(next)] } }) };
  },
  async "columns.map"(a) {
    const headers = Array.isArray(a.headers) ? a.headers.slice(0, 60).map((h) => String(h).slice(0, 60)) : [];
    const samples = Array.isArray(a.samples) ? a.samples.slice(0, 5).map((r) => (Array.isArray(r) ? r.slice(0, 60).map((c) => String(c).slice(0, 60)) : [])) : [];
    if (!headers.length) throw new BadRequest("見出しがありません。");
    return { result: await ai.askJson(ai.COLUMNS_SYSTEM, { file_name: optText(a.fileName, 200), headers, sample_rows: samples }, "columns", ai.columnsSchema) };
  },
  async "chat.clear"(a) {
    const ym = ymOk(a.ym), actor = actorOf(a.actor);
    const ids = (await list<ChatMessage>("chat")).filter((m) => m.ym === ym && m.actor === actor).map((m) => m.id);
    return { patch: await apply({ del: { chat: ids } }) };
  },
  async reset() { await seed(); return { reload: true }; },
};
