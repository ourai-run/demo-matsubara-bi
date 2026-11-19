import { aiConfig } from "@/lib/server/ai";
import { ensureReady, getAll } from "@/lib/server/db";
import { failure, json } from "@/lib/server/http";

export async function GET() {
  try {
    await ensureReady();
    return json({ collections: await getAll(), model: aiConfig().model });
  } catch (e) { return failure(e); }
}
