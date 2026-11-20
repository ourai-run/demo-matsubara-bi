import { ensureReady } from "@/lib/server/db";
import { body, failure, json, sameOrigin } from "@/lib/server/http";
import { OPS } from "@/lib/server/ops";

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return json({ error: "このサイト以外からの操作はできません。" }, 403);
    const { op, args } = await body(request);
    const handler = typeof op === "string" && Object.hasOwn(OPS, op) ? OPS[op] : null;
    if (!handler) return json({ error: "操作が見つかりません。" }, 404);
    await ensureReady();
    return json(await handler((args ?? {}) as Record<string, unknown>));
  } catch (e) { return failure(e); }
}
