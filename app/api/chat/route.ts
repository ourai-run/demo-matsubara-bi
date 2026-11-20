import { type ActionItem, type ChatMessage, type Dataset, type Insight, type Policy, STATUS_LABEL, USERS } from "@/lib/model";
import { factPack, toStore } from "@/lib/analytics";
import { AiError, CHAT_SYSTEM, CHAT_TOOLS, openai } from "@/lib/server/ai";
import { type Doc, apply, ensureReady, list } from "@/lib/server/db";
import { body, failure, json, sameOrigin } from "@/lib/server/http";
import { BadRequest, queryData } from "@/lib/server/ops";

type Item = { type?: string; call_id?: string; name?: string; arguments?: string };

/** OpenAI（Responses API）のストリームを読み、文章は onText へ流し、出力項目（道具の呼び出しなど）をまとめて返す。 */
async function readStream(res: Response, onText: (t: string) => void) {
  const reader = res.body!.getReader(), decoder = new TextDecoder(), items: Item[] = [];
  let buf = "", content = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      let ev: { type?: string; delta?: string; item?: Item };
      try { ev = JSON.parse(line.slice(6)); } catch { continue; }
      if (ev.type === "response.output_text.delta" && ev.delta) { content += ev.delta; onText(ev.delta); }
      else if (ev.type === "response.output_item.done" && ev.item) items.push(ev.item);
      else if (ev.type === "response.failed" || ev.type === "response.incomplete" || ev.type === "error") { console.error("chat stream", line.slice(0, 400)); throw new AiError("AIの回答が途中で止まりました。もう一度お試しください。"); }
    }
  }
  return { content, items };
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return json({ error: "このサイト以外からの操作はできません。" }, 403);
    const a = await body(request, 20_000);
    const ym = typeof a.ym === "string" && /^\d{4}-\d{2}$/.test(a.ym) ? a.ym : "";
    const question = typeof a.message === "string" ? a.message.trim().slice(0, 2000) : "";
    if (!ym || !question) throw new BadRequest("質問を入力してください。");
    const actor = USERS.find((u) => u.name === a.actor)?.name ?? USERS[0].name;
    const screen = typeof a.screen === "string" ? a.screen.slice(0, 300) : "";
    await ensureReady();

    const st = toStore(await list<Dataset>("dataset"));
    const { pack } = factPack(st, ym);
    const policies = (await list<Policy>("policy")).filter((p) => p.status === "active").map((p) => ({ id: p.id, kind: p.kind, rule: p.rule }));
    const insights = (await list<Insight>("insight")).filter((i) => i.ym === ym).sort((x, y) => x.seq - y.seq)
      .map((i) => ({ number: i.seq, anchor: i.anchor, title: i.title, situation: i.situation, cause: i.cause, proposal: i.proposal, status: STATUS_LABEL[i.status], reason: i.reason }));
    const actions = (await list<ActionItem>("action")).filter((x) => x.status === "open").map((x) => ({ decided_in: x.ym, title: x.title, owner: x.owner, due: x.due }));
    const history = (await list<ChatMessage>("chat")).filter((m) => m.ym === ym && m.actor === actor).sort((x, y) => x.createdAt.localeCompare(y.createdAt)).slice(-10);
    const input: unknown[] = [
      { role: "developer", content: JSON.stringify({ target_month: ym, asked_by: actor, screen, data: pack, policies, insights, open_actions: actions }) },
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: question },
    ];

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (o: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(o)}\n\n`));
        let answer = "";
        const views: unknown[] = [];
        try {
          for (let round = 0; round < 6; round++) {
            // store:false＝OpenAI側に会話を残さない。その代わり、考えた経過（暗号化済み）を受け取って次の呼び出しへ渡す
            const { content, items } = await readStream(await openai({ instructions: CHAT_SYSTEM, input, tools: CHAT_TOOLS, stream: true, store: false, include: ["reasoning.encrypted_content"], reasoning: { effort: "low" } }, "responses"), (t) => send({ t: "delta", v: t }));
            answer += content;
            const calls = items.filter((i) => i.type === "function_call");
            if (!calls.length) break;
            input.push(...items);
            for (const c of calls) {
              let out: unknown;
              try {
                const args = JSON.parse(c.arguments || "{}");
                if (c.name === "show_view") { views.push(args); send({ t: "view", v: args }); out = { ok: true, note: "利用者の画面に、この切り口を開くボタンを表示した" }; }
                else out = queryData(st, args);
              } catch { out = { error: "引数を読み取れませんでした" }; }
              input.push({ type: "function_call_output", call_id: c.call_id, output: JSON.stringify(out) });
            }
          }
          const at = Date.now(), id = () => `chat_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
          const docs: Doc[] = [
            { id: id(), ym, role: "user", content: question, actor, createdAt: new Date(at).toISOString() },
            { id: id(), ym, role: "assistant", content: answer, actor, views, createdAt: new Date(at + 1).toISOString() },
          ];
          send({ t: "done", patch: await apply({ put: { chat: docs } }) });
        } catch (e) {
          if (!(e instanceof AiError)) console.error("chat failed", e);
          send({ t: "error", v: e instanceof AiError ? e.message : "回答の途中で失敗しました。もう一度お試しください。" });
        }
        controller.close();
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
  } catch (e) { return failure(e); }
}
