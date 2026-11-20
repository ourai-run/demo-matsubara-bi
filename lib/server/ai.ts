// OpenAI API の呼び出しと、AIへの指示文。数字の計算は analytics.ts 側で済ませ、AIには読み解きだけをさせる。
import { env } from "cloudflare:workers";
import { KINDS, KIND_ORDER } from "../model.ts";
import { AXES, MEASURES } from "../analytics.ts";

export function aiConfig() {
  const e = env as unknown as Record<string, string | undefined>;
  return { key: e.OPENAI_API_KEY || "sk-not-set", model: e.OPENAI_MODEL || "gpt-6.2-sol", base: e.OPENAI_BASE_URL || "https://api.openai.com/v1" };
}
export class AiError extends Error {}

export async function openai(body: Record<string, unknown>, path = "chat/completions"): Promise<Response> {
  const { key, model, base } = aiConfig();
  let res: Response;
  try {
    res = await fetch(`${base}/${path}`, {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, ...body }),
    });
  } catch { throw new AiError("AIに接続できませんでした。少し待ってからもう一度お試しください。"); }
  if (res.ok) return res;
  const detail = (await res.text()).slice(0, 300);
  console.error("OpenAI error", res.status, detail);
  throw new AiError(res.status === 401 || res.status === 403 ? "AIに接続できません。OPENAI_API_KEY の設定を確認してください。"
    : res.status === 429 ? "AIの利用が混み合っています。少し待ってからもう一度お試しください。" : `AIの呼び出しに失敗しました（${res.status}）。`);
}

const obj = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const str = { type: "string" }, arr = (items: unknown) => ({ type: "array", items });
const en = (values: readonly string[]) => ({ type: "string", enum: values });

export async function askJson<T>(system: string, user: unknown, name: string, schema: unknown): Promise<T> {
  const res = await openai({
    messages: [{ role: "system", content: system }, { role: "user", content: typeof user === "string" ? user : JSON.stringify(user) }],
    response_format: { type: "json_schema", json_schema: { name, strict: true, schema } },
  });
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  try { return JSON.parse(json.choices?.[0]?.message?.content ?? "") as T; }
  catch { throw new AiError("AIの回答を読み取れませんでした。もう一度お試しください。"); }
}

const COMPANY = "株式会社マツバラ（岐阜県関市。小物の鋳鉄鋳物の専業メーカー。関工場でキュポラ溶解と自動造型ライン〔FCMX・AMF-V・SM-60V〕による鋳造、大平工場で加工・検査・出荷。自動車・空調・油圧建機・農機向け。3月決算）";

// ---- 月次の示唆 ----
export const INSIGHT_SYSTEM = `あなたは${COMPANY}の月次業績報告を担当する経営企画アナリストです。
役員会に出す「示唆」を作ります。読み手は社長・役員で、鋳造の現場と数字に詳しい人たちです。

# 守ること
- 数字は渡された data にあるものだけを使う。差や比率は、渡された2つの数字から出せる単純なものに限る。
- 「なぜ予算とずれたか」は op_variance_vs_budget（営業利益の差異分解。合計は営業利益の差と一致している）の金額の大きい順に説明する。
- 1件の示唆は1つの論点に絞る。全体で4〜7件。利益への影響が大きいもの、放置すると広がるもの、良い動きで続けたいものを優先する。
- 示唆ごとに anchor（ダッシュボード上の場所）を1つ選ぶ。その論点を最もよく表す場所にする（例：鋼屑の値上がり→mat:鋼屑、特定の得意先の数量減→cust:その得意先、ライン別の不良→line:そのライン、単価転嫁の全体像→wf:price）。同じ anchor を2件に使わない。
- situation（状況）は何が起きているかを数字で2文以内。cause（要因）は数字から言える原因を2文以内。数字だけでは断定できないことは「〜の可能性があります」と書き、何を確認すれば分かるかを添える。
- proposal（提案）は誰が・何を・いつまでに、を1〜2文で。question（論点）は役員会で決めてほしいことを1つ、問いの形で。
- evidence は根拠の数字を2〜4個。label は何の数字か、value は単位つきの値（比較があれば「予算 50.0 → 実績 56.6 円/kg」のように）。
- 現場の言葉（歩留、不良率、スライド、鋼屑、注湯など）を使い、短く言い切る。です・ます調。「〜と考えられます」を続けない。
- severity: bad=対応が必要 / warn=注意して見る / good=良い動き / info=参考。

# 役員会の考え方（policies）
過去の役員会の判断から学んだ、この会社の見方です。必ず従います。
- 「指摘しない条件(suppress)」や基準(threshold)に当てはまって取り上げない事象は insights に入れず、suppressed に何を・どの考え方で控えたかを、確かめた数字つきで書く。
- suppressed に書くのは、考え方が無ければ示唆にしていたはずの目立つ事象だけ（多くても5件）。影響がごく小さい差異や、基準と無関係にもともと取り上げない項目は書かない。
- 「指摘する基準(threshold)」「重視する点(focus)」は優先度と取り上げ方に反映する。「前提(context)」は説明で踏まえる。
- 示唆に使った考え方の id は policy_ids に入れる。使っていなければ空。

# 過去の判断と決定事項（past_decisions, open_actions）
- open_actions（役員会で「対応する」と決めて進行中のこと）は、今月の数字に効果が出ているかを確かめ、関係する示唆の situation か cause で触れる。
- 過去に「静観」「問題なし」とされた事象は、数字が悪化していない限り繰り返さない。

# summary
今月の総括を3〜4文。1文目は結論（売上高と営業利益が予算に対してどうだったか）。続けて主な要因を金額つきで。最後に年度の着地見込みを1文。`;

export const insightSchema = (anchors: string[]) => obj({
  summary: str,
  insights: arr(obj({
    anchor: en(anchors), severity: en(["bad", "warn", "good", "info"]), title: str, situation: str, cause: str, proposal: str, question: str,
    evidence: arr(obj({ label: str, value: str })), policy_ids: arr(str),
  })),
  suppressed: arr(obj({ anchor: en(anchors), topic: str, reason: str, policy_id: str })),
});

// ---- 役員会の判断から考え方を学ぶ ----
export const POLICY_SYSTEM = `${COMPANY}の役員会で、AIが出した示唆に対して役員が判断を下しました。
この判断から、来月以降の示唆出しに使える「この会社の見方・判断基準」を取り出します。

- 今回限りの事情への対応は判断基準にしない。来月以降も繰り返し使える一般的なルールだけを取り出す。無ければ空の配列を返す。
- 1つの判断から多くても1個。既存の考え方（existing）と同じ趣旨なら出さない。
- rule は1〜2文。「何が・どの範囲なら・どう扱うか」を具体的に書く。役員の言葉と数字の目安はなるべく残す。
- kind: suppress=こういう場合は指摘しない / threshold=この基準を超えたら指摘する / focus=この点を重視して取り上げる / context=前提として知っておく事情
- scope: 関係する場所の anchor（例 seg:空調、line:FCMX、acct:修繕費）。全体に関わるなら all。`;
export const policySchema = obj({ policies: arr(obj({ rule: str, kind: en(["suppress", "threshold", "focus", "context"]), scope: str })) });

// ---- 議事メモから判断を読み取る ----
export const MINUTES_SYSTEM = `${COMPANY}の役員会の議事メモ（発言の書き起こしや箇条書き）から、今月の各示唆に対する判断を読み取ります。

- 示唆ごとに、status（action=対応する / watch=静観する / dismiss=問題なし / other=別の判断）、reason（そう判断した理由。役員の発言の要旨をなるべくそのまま）、speaker（判断した人の役職）を出す。
- 「対応する」の場合は、やること(action_title)・担当の役職(action_owner)・期限(action_due: YYYY-MM-DD。メモに無ければ空文字)も出す。それ以外は3つとも空文字。
- メモで触れられていない示唆は出さない。推測で埋めない。
- どの示唆にも当てはまらない決定事項や宿題は others に1件ずつ入れる。`;
export const minutesSchema = (ids: string[]) => obj({
  items: arr(obj({ insight_id: en(ids), status: en(["action", "watch", "dismiss", "other"]), reason: str, speaker: str, action_title: str, action_owner: str, action_due: str })),
  others: arr(str),
});

// ---- 列の見分け（見出しが決まった形でないファイル用） ----
export const COLUMNS_SYSTEM = `部署から届いた表の見出しと先頭の数行を見て、どの種類のデータか、各項目がどの列にあるかを判定します。
種類と項目は次のとおり。\n${KIND_ORDER.map((k) => `- ${k}（${KINDS[k].label}）: ${KINDS[k].fields.map((f) => `${f.key}=${f.label}${f.unit ? `(${f.unit})` : ""}`).join("、")}`).join("\n")}
- kind はいちばん合う種類。どれにも合わなければ unknown。
- mapping は、項目(field)ごとに対応する列の見出し(column)をそのままの文字で。対応する列が無い項目は出さない。
- ym_column は年月が入っている列の見出し（無ければ空文字）。scenario_column は予算・実績の区別が入っている列の見出し（無ければ空文字）。
- unit_note は、金額が千円単位・重量がトン単位など、円・kg 以外の単位らしいときにその旨を書く（そうでなければ空文字）。`;
export const columnsSchema = obj({
  kind: en([...KIND_ORDER, "unknown"]), ym_column: str, scenario_column: str,
  mapping: arr(obj({ field: str, column: str })), unit_note: str,
});

// ---- チャット ----
export const CHAT_SYSTEM = `あなたは${COMPANY}の経営分析アシスタントです。月次業績ダッシュボードの横で、役員・担当者の質問に答えます。

- まず結論を1〜2文。そのあと根拠の数字を箇条書きで。全体で10行以内を目安にする。
- 数字は data と、道具 query_data の結果にあるものだけを使う。data に無い切り口（別の月、得意先ごとの月次推移など）は query_data で取ってから答える。
- 「なぜ予算とずれたか」は op_variance_vs_budget の金額の大きい順に説明する。
- 役員会の考え方（policies）と、これまでの判断（insights の status・reason）を踏まえる。
- 画面で見たほうが早い内容は show_view で切り口分析の画面を用意し、文章でも要点を答える。
- データに無いことは「データにありません」と答える。金額は百万円、重量はt、単価は円/kg で書く。
- 見出し記号（#）や表は使わず、短い文と「・」の箇条書きで書く。です・ます調。`;

// 道具つきの会話は Responses API（/responses）で呼ぶ。既定のモデルは chat/completions では道具を使えないため。
const measureKeys = MEASURES.map((m) => m.key), axisKeys = Object.keys(AXES);
const measureHelp = MEASURES.map((m) => `${m.key}=${m.label}(${m.unit})${m.axes.length ? `[軸:${m.axes.join("/")}]` : "[軸なし]"}`).join("、");
const filterSchema = arr(obj({ axis: en(axisKeys), values: arr(str) }));
export const CHAT_TOOLS = [
  {
    type: "function", name: "query_data", strict: true,
    description: `蓄積データを集計する。指標: ${measureHelp}。軸: ${Object.entries(AXES).map(([k, v]) => `${k}=${v}`).join("、")}。by_month=true で月ごとの推移を返す。`,
    parameters: obj({ measure: en(measureKeys), axis: en(["", ...axisKeys]), from: { type: "string", description: "YYYY-MM" }, to: { type: "string", description: "YYYY-MM" }, by_month: { type: "boolean" }, filters: filterSchema }),
  },
  {
    type: "function", name: "show_view", strict: true,
    description: "切り口分析の画面を、指定した指標・軸・比較・期間で用意する（利用者がボタンで開ける）。span=trend は実績の24か月推移で、軸を指定すると予算は表示されない。",
    parameters: obj({ measure: en(measureKeys), axis: en(["", ...axisKeys]), basis: en(["budget", "py", "pm"]), span: en(["month", "ytd", "trend"]), filters: filterSchema, title: str }),
  },
];
