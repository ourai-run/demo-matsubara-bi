// D1 への保存。records 表に collection＋id＋JSON で持つ。
import { env } from "cloudflare:workers";
import initSql from "../../drizzle/0000_init.sql?raw";
import { type Dataset, dsKey } from "../model.ts";
import { sampleDatasets } from "../sample.ts";
import seedState from "../seed-state.json";

export type Doc = { id: string; ym?: string } & Record<string, unknown>;
/** 変更の結果。サーバーはこれを返し、画面は手元の状態に重ねる。 */
export interface Patch { put?: Record<string, Doc[]>; del?: Record<string, string[]> }

function d1(): D1Database {
  const db = (env as unknown as { DB?: D1Database }).DB;
  if (!db) throw new Error("データベース（D1 の DB）が設定されていません。");
  return db;
}
const now = () => new Date().toISOString();
async function batch(stmts: D1PreparedStatement[]) {
  for (let i = 0; i < stmts.length; i += 40) await d1().batch(stmts.slice(i, i + 40));
}

// shortcut: 全データを1回で読み込む（月次データ・利用者5名ほどなら数百件）。明細が数万行を超えるなら月ごとの取得に分ける
export async function getAll(): Promise<Record<string, Doc[]>> {
  const { results } = await d1().prepare("SELECT collection, data FROM records").all<{ collection: string; data: string }>();
  const out: Record<string, Doc[]> = {};
  for (const r of results) (out[r.collection] ??= []).push(JSON.parse(r.data));
  return out;
}
export async function list<T>(collection: string): Promise<T[]> {
  const { results } = await d1().prepare("SELECT data FROM records WHERE collection = ?").bind(collection).all<{ data: string }>();
  return results.map((r) => JSON.parse(r.data));
}
export async function get<T>(collection: string, id: string): Promise<T | null> {
  const r = await d1().prepare("SELECT data FROM records WHERE collection = ? AND id = ?").bind(collection, id).first<{ data: string }>();
  return r ? JSON.parse(r.data) : null;
}
export async function apply(patch: Patch): Promise<Patch> {
  const db = d1(), stmts: D1PreparedStatement[] = [];
  for (const [c, ids] of Object.entries(patch.del ?? {})) for (const id of ids) stmts.push(db.prepare("DELETE FROM records WHERE collection = ? AND id = ?").bind(c, id));
  for (const [c, docs] of Object.entries(patch.put ?? {})) for (const d of docs) {
    stmts.push(db.prepare("INSERT OR REPLACE INTO records (collection, id, ym, data, updated_at) VALUES (?, ?, ?, ?, ?)").bind(c, d.id, d.ym ?? "", JSON.stringify(d), now()));
  }
  await batch(stmts);
  return patch;
}

export const datasetDoc = (d: Dataset): Doc => ({ id: dsKey(d.kind, d.scenario, d.ym), ...d, importId: d.importId ?? "sample" });

/** サンプルデータを入れ直す（今あるデータはすべて消える）。 */
export async function seed() {
  await d1().prepare("DELETE FROM records").run();
  await apply({ put: { ...(seedState as unknown as Record<string, Doc[]>), dataset: sampleDatasets().map(datasetDoc), meta: [{ id: "seeded", at: now() }] } });
}

let ready: Promise<void> | null = null;
/** 表が無ければ作り（ローカル開発用。公開環境は drizzle のマイグレーションが先に当たる）、空ならサンプルを入れる。 */
export const ensureReady = () => (ready ??= init().catch((e) => { ready = null; throw e; }));
async function init() {
  let seeded = false;
  try {
    seeded = !!(await d1().prepare("SELECT id FROM records WHERE collection = 'meta' AND id = 'seeded'").first());
  } catch (e) {
    if (!String((e as Error)?.message ?? e).includes("no such table")) throw e;
    for (const sql of initSql.split("--> statement-breakpoint")) await d1().prepare(sql).run();
  }
  if (!seeded) await seed();
}
