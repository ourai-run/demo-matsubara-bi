import { BadRequest } from "./ops.ts";
import { AiError } from "./ai.ts";

const noStore = { "Cache-Control": "no-store" };
export const json = (data: unknown, status = 200) => Response.json(data, { status, headers: noStore });

/** 他サイトからの書き込みを断る。 */
// shortcut: ログインは持たず、閲覧制限は公開先（chatgpt.site）のアクセス設定に任せる。利用者ごとの権限が要るなら認証を足す
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return request.headers.get("sec-fetch-site") !== "cross-site" && (!origin || origin === new URL(request.url).origin);
}
export async function body(request: Request, maxBytes = 6_000_000): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (raw.length > maxBytes) throw new BadRequest("送信データが大きすぎます。");
  let v: unknown;
  try { v = JSON.parse(raw); } catch { throw new BadRequest("送信データを読み取れません。"); }
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new BadRequest("送信データが正しくありません。");
  return v as Record<string, unknown>;
}
export function failure(e: unknown): Response {
  if (e instanceof BadRequest) return json({ error: e.message }, 400);
  if (e instanceof AiError) return json({ error: e.message }, 502);
  console.error("request failed", e);
  return json({ error: "処理に失敗しました。もう一度お試しください。" }, 500);
}
