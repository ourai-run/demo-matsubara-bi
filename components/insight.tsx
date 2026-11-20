"use client";
// 示唆1件の表示・議論・判断。右のAIパネルと役員会の画面で同じものを使う。
import { useState } from "react";
import { anchorLabel } from "@/lib/analytics";
import { useApp } from "@/lib/client";
import { dateTime } from "@/lib/format";
import { type Insight, type InsightStatus, type Policy, POLICY_KIND_LABEL, SEVERITY_LABEL, STATUS_LABEL, USERS, ymLabel } from "@/lib/model";

const CHOICES: { status: InsightStatus; hint: string }[] = [
  { status: "action", hint: "担当と期限を決めて動く" },
  { status: "watch", hint: "来月も数字を見て判断する" },
  { status: "dismiss", hint: "この指摘は不要（理由をAIが学ぶ）" },
  { status: "other", hint: "AIの提案とは違う対応をとる" },
];

/** 判断から取り出した「考え方」の案。人が確かめてから覚えさせる。 */
export function PolicyProposal({ policy }: { policy: Policy }) {
  const { rpc } = useApp();
  const [rule, setRule] = useState(policy.rule);
  return (
    <div className="learn">
      <div className="learn-head">AIはこの判断を次のように受け取りました<span className="tag">{POLICY_KIND_LABEL[policy.kind]}</span></div>
      <textarea value={rule} onChange={(e) => setRule(e.target.value)} rows={3} aria-label="考え方の内容" />
      <p className="hint">この内容で覚えると、来月以降の示唆に反映されます。違っていれば直してください。</p>
      <div className="row">
        <button className="btn pri" onClick={() => rpc("policy.save", { id: policy.id, rule, status: "active" })}>この考え方で覚える</button>
        <button className="btn" onClick={() => rpc("policy.delete", { id: policy.id })}>覚えない</button>
      </div>
    </div>
  );
}

function Decision({ ins }: { ins: Insight }) {
  const { rpc, actor, actions, busy } = useApp();
  const action = actions.find((a) => a.insightId === ins.id);
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<InsightStatus>(ins.status === "open" ? "action" : ins.status);
  const [reason, setReason] = useState(ins.reason);
  const [title, setTitle] = useState(action?.title ?? ins.proposal);
  const [owner, setOwner] = useState(action?.owner ?? "");
  const [due, setDue] = useState(action?.due ?? "");
  const saving = busy.startsWith("判断");
  const save = async () => {
    const r = await rpc("insight.decide", { id: ins.id, status, reason, actor, action: { title, owner, due } }, "判断を記録し、考え方を整理しています…");
    if (!r.error) setEditing(false);
  };
  if (ins.status !== "open" && !editing) return (
    <div className={`decided st-${ins.status}`}>
      <div className="decided-head"><span className={`tag st-${ins.status}`}>{STATUS_LABEL[ins.status]}</span><span className="who">{ins.decidedBy}・{dateTime(ins.decidedAt)}</span>
        <button className="link" onClick={() => setEditing(true)}>判断を変更</button></div>
      {ins.reason && <p className="reason">{ins.reason}</p>}
      {action && <p className="act">決定事項：{action.title}<br /><span className="who">担当 {action.owner || "未定"}／期限 {action.due || "未定"}</span></p>}
    </div>
  );
  return (
    <div className="decide">
      <div className="choices" role="radiogroup" aria-label="判断">
        {CHOICES.map((c) => (
          <button type="button" key={c.status} role="radio" aria-checked={status === c.status} className={`choice st-${c.status}${status === c.status ? " on" : ""}`} onClick={() => setStatus(c.status)}>
            <b>{STATUS_LABEL[c.status]}</b><span>{c.hint}</span>
          </button>
        ))}
      </div>
      <label className="field"><span>判断の理由</span>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="役員の発言をそのまま書いてください。AIが来月以降の見方として学びます。" /></label>
      {status === "action" && (
        <div className="action-fields">
          <label className="field wide"><span>やること</span><textarea value={title} onChange={(e) => setTitle(e.target.value)} rows={2} /></label>
          <label className="field"><span>担当</span>
            <select value={owner} onChange={(e) => setOwner(e.target.value)}><option value="">未定</option>{USERS.map((u) => <option key={u.id}>{u.name}</option>)}</select></label>
          <label className="field"><span>期限</span><input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
        </div>
      )}
      <div className="row">
        <button className="btn pri" disabled={saving} onClick={save}>{saving ? "記録しています…" : `判断を記録（${actor}）`}</button>
        {editing && <button className="btn" onClick={() => setEditing(false)}>やめる</button>}
      </div>
    </div>
  );
}

export function InsightDetail({ ins, wide }: { ins: Insight; wide?: boolean }) {
  const { comments, policies, rpc, actor, set, view } = useApp();
  const [body, setBody] = useState("");
  const thread = comments.filter((c) => c.insightId === ins.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const used = policies.filter((p) => ins.policyIds.includes(p.id));
  const learned = policies.filter((p) => p.sourceInsightId === ins.id);
  const showOnChart = () => {
    set({ view: "dashboard", focus: ins.id });
    setTimeout(() => document.querySelector(`.pin[data-ins="${ins.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }), view === "dashboard" ? 0 : 150);
  };
  const post = async () => { if (body.trim() && !(await rpc("insight.comment", { insightId: ins.id, body, actor })).error) setBody(""); };
  return (
    <article className={`insight sev-${ins.severity}${wide ? " wide" : ""}`} id={`ins-${ins.id}`}>
      <div className="ins-main">
        <header>
          <span className={`pin sev-${ins.severity}`}>{ins.seq}</span>
          <div><h3>{ins.title}</h3>
            <p className="ins-meta"><span className={`tag sev-${ins.severity}`}>{SEVERITY_LABEL[ins.severity]}</span>{anchorLabel(ins.anchor)}
              <button className="link" onClick={showOnChart}>図で見る</button></p></div>
        </header>
        <dl>
          <dt>状況</dt><dd>{ins.situation}</dd>
          <dt>要因</dt><dd>{ins.cause}</dd>
          <dt>提案</dt><dd>{ins.proposal}</dd>
          <dt>論点</dt><dd className="question">{ins.question}</dd>
        </dl>
        {ins.evidence.length > 0 && <table className="evidence"><tbody>{ins.evidence.map((e, i) => <tr key={i}><th>{e.label}</th><td>{e.value}</td></tr>)}</tbody></table>}
        {used.length > 0 && <div className="used"><b>この示唆に使った役員会の考え方</b>{used.map((p) => <p key={p.id}>{p.rule}<span className="who">（{p.sourceYm ? ymLabel(p.sourceYm) + "の役員会" : "手入力"}）</span></p>)}</div>}
      </div>
      <div className="ins-side">
        <h4>議論</h4>
        {thread.map((c) => <div className="comment" key={c.id}><b>{c.actor}</b><span className="who">{dateTime(c.createdAt)}</span><p>{c.body}</p></div>)}
        <div className="comment-form">
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder="発言・補足を記録" aria-label="発言を記録" />
          <button className="btn" disabled={!body.trim()} onClick={post}>記録（{actor}）</button>
        </div>
        <h4>判断</h4>
        <Decision ins={ins} key={ins.status + ins.decidedAt} />
        {learned.filter((p) => p.status === "proposed").map((p) => <PolicyProposal key={p.id} policy={p} />)}
        {learned.filter((p) => p.status === "active").map((p) => <div className="learned" key={p.id}><b>この判断から覚えた考え方</b><p>{p.rule}</p></div>)}
      </div>
    </article>
  );
}
