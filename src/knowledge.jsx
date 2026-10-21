import React, { useEffect, useState } from "react";
import {
  History,
  GitBranch,
  AlertTriangle,
  Network,
  HeartPulse,
  SlidersHorizontal,
  Users,
  Search,
  Sparkles,
  RefreshCw,
  ArrowUpRight,
  Plus,
  X,
  Check,
  Loader2,
  Link2,
  ShieldCheck,
  ThumbsUp,
  ThumbsDown,
  Clock3,
  ArrowRight,
  FileText,
} from "lucide-react";
export const intentOptions = [
  ["brainstorm", "Brainstorm"],
  ["specify", "Specify"],
  ["review", "Review"],
  ["decide", "Decide"],
  ["plan", "Plan"],
  ["handoff", "Handoff"],
];
const date = (s) =>
  s
    ? new Date(s.includes("T") ? s : s + "Z").toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "Not recorded";
function Busy() {
  return <Loader2 size={16} className="spin" />;
}
function ErrorNote({ text }) {
  return text ? (
    <div className="form-error" role="alert">
      {text}
    </div>
  ) : null;
}
function Empty({ title, children }) {
  return (
    <div className="knowledge-empty">
      <GitBranch size={25} />
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}
function SourceButton({ id, title, open }) {
  return (
    <button className="source-chip" onClick={() => open(id)}>
      <FileText size={12} />
      {title}
      <ArrowUpRight size={11} />
    </button>
  );
}
function useLoad(api, path, version = 0) {
  const [data, setData] = useState(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError("");
    api(path)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [path, version]);
  return { data, busy, error, setData };
}
export function AnswerFeedback({ api, answerId }) {
  const [rating, setRating] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function rate(value) {
    setBusy(true);
    setError("");
    try {
      await api("/api/agent/feedback", {
        method: "POST",
        body: { answer_id: answerId, rating: value },
      });
      setRating(value);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="answer-feedback">
      <div role="group" aria-label="Feedback for this answer">
        {[
          ["helpful", ThumbsUp, "Helpful"],
          ["unhelpful", ThumbsDown, "Not helpful"],
          ["too_long", SlidersHorizontal, "Too long"],
          ["too_vague", Search, "Too vague"],
        ].map(([v, Icon, label]) => (
          <button
            key={v}
            aria-pressed={rating === v}
            disabled={busy}
            className={rating === v ? "selected" : ""}
            onClick={() => rate(v)}
          >
            <Icon size={12} />
            <span>{label}</span>
          </button>
        ))}
        {busy && <Busy />}
        {rating && !busy && (
          <span className="feedback-saved" role="status">
            <Check size={11} />
            Noted
          </span>
        )}
      </div>
      <ErrorNote text={error} />
    </div>
  );
}
function Chain({ lineage, open }) {
  return (
    <div className="source-chain">
      {lineage.nodes
        .filter((n) => n.id !== lineage.artifact_id)
        .map((n) => (
          <SourceButton key={n.id} id={n.id} title={n.title} open={open} />
        ))}
      {!lineage.edges.length && (
        <span className="field-help">No accessible source links recorded.</span>
      )}
      {lineage.edges.length > 0 && (
        <details className="evidence-details">
          <summary>
            Source versions & evidence <span>{lineage.edges.length}</span>
          </summary>
          {lineage.edges.map((e) => (
            <div className="snapshot" key={e.id}>
              <span className="memory-label">
                {e.relation.replace("_", " ")} · Linked by {e.linked_by_name} ·{" "}
                {date(e.created_at)}
              </span>
              <strong>{e.source_snapshot.title}</strong>
              <small>
                Source version: {date(e.source_snapshot.updated_at)}
              </small>
              <p>{e.source_snapshot.content}</p>
            </div>
          ))}
        </details>
      )}
      {lineage.truncated && (
        <p className="mode-note">
          This chain reached its depth or size limit. Open a source to continue.
        </p>
      )}
    </div>
  );
}
export function MemoryPanel({
  api,
  artifact,
  users,
  available,
  open,
  onUpdated,
}) {
  const [version, setVersion] = useState(0),
    { data, busy, error } = useLoad(
      api,
      "/api/artifacts/" + artifact.id + "/lineage",
      version,
    );
  const [source, setSource] = useState(""),
    [relation, setRelation] = useState("supports"),
    [steward, setSteward] = useState(
      artifact.steward_user_id || artifact.owner_user_id,
    ),
    [decider, setDecider] = useState(
      artifact.decided_by_user_id || artifact.owner_user_id,
    ),
    [working, setWorking] = useState(false),
    [message, setMessage] = useState(""),
    [localError, setError] = useState("");
  async function link(e) {
    e.preventDefault();
    setWorking(true);
    setError("");
    try {
      await api("/api/artifacts/" + artifact.id + "/links", {
        method: "POST",
        body: { source_artifact_id: source, relation },
      });
      setSource("");
      setVersion((v) => v + 1);
      setMessage("Source linked. Its current version is preserved.");
    } catch (e) {
      setError(e.message);
    } finally {
      setWorking(false);
    }
  }
  async function update(e) {
    e.preventDefault();
    setWorking(true);
    setError("");
    try {
      const a = await api("/api/artifacts/" + artifact.id + "/memory", {
        method: "PATCH",
        body: {
          steward_user_id: steward,
          ...(artifact.type === "decision"
            ? { decided_by_user_id: decider }
            : {}),
        },
      });
      setVersion((v) => v + 1);
      onUpdated(a);
      setMessage("Ownership updated.");
    } catch (e) {
      setError(e.message);
    } finally {
      setWorking(false);
    }
  }
  async function unlink(id) {
    setWorking(true);
    setError("");
    try {
      await api("/api/artifacts/" + artifact.id + "/links/" + id, {
        method: "DELETE",
      });
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setWorking(false);
    }
  }
  return (
    <section className="memory-panel">
      <div className="memory-panel-heading">
        <History size={17} />
        <div>
          <span className="eyebrow">THE THINKING BEHIND THE THOUGHT</span>
          <h3>
            {artifact.type === "decision"
              ? "Who, when, and why."
              : "Ownership & source lineage"}
          </h3>
        </div>
      </div>
      <ErrorNote text={error || localError} />
      {busy && !data ? (
        <Busy />
      ) : (
        data && (
          <>
            <div className="provenance-grid">
              <div>
                <span>Recorded by</span>
                <strong>{data.recorded_by?.name || artifact.owner_name}</strong>
              </div>
              <div>
                <span>Knowledge steward</span>
                <strong>{data.steward?.name || "Not assigned"}</strong>
              </div>
              {artifact.type === "decision" && (
                <>
                  <div>
                    <span>Declared decision maker</span>
                    <strong>{data.decided_by?.name || "Not recorded"}</strong>
                  </div>
                  <div>
                    <span>Decision date</span>
                    <strong>{date(data.decided_at)}</strong>
                  </div>
                </>
              )}
            </div>
            {artifact.type === "decision" && (
              <p className="field-help">
                Attribution is declared by the owner; meeting speakers are not
                inferred automatically.
              </p>
            )}
            <Chain lineage={data} open={open} />
            {artifact.can_share && (
              <details className="memory-curation">
                <summary>Curate sources & ownership</summary>
                <form onSubmit={link}>
                  <label className="field">
                    Link a source
                    <select
                      required
                      value={source}
                      onChange={(e) => setSource(e.target.value)}
                    >
                      <option value="">Choose an accessible artifact</option>
                      {available
                        .filter((a) => a.id !== artifact.id)
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.title}
                          </option>
                        ))}
                    </select>
                  </label>
                  <div className="field-row">
                    <label className="field">
                      Relationship
                      <select
                        value={relation}
                        onChange={(e) => setRelation(e.target.value)}
                      >
                        {[
                          "supports",
                          "depends_on",
                          "refines",
                          "supersedes",
                          "contradicts",
                        ].map((r) => (
                          <option key={r} value={r}>
                            {r.replace("_", " ")}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="button secondary link-source-button"
                      disabled={!source || working}
                    >
                      <Link2 size={13} />
                      Link source
                    </button>
                  </div>
                </form>
                <p className="field-help">
                  A source link preserves its current text. Each viewer must
                  still have access to that source.
                </p>
                {data.edges
                  .filter((e) => e.artifact_id === artifact.id)
                  .map((e) => (
                    <div className="editable-link" key={e.id}>
                      <span>{e.source_snapshot.title}</span>
                      <button
                        className="icon-button"
                        aria-label={"Remove source " + e.source_snapshot.title}
                        disabled={working}
                        onClick={() => unlink(e.id)}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                <form onSubmit={update}>
                  <div className="field-row">
                    <label className="field">
                      Knowledge steward
                      <select
                        value={steward}
                        onChange={(e) => setSteward(e.target.value)}
                      >
                        {users.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {artifact.type === "decision" && (
                      <label className="field">
                        Declared decision maker
                        <select
                          value={decider}
                          onChange={(e) => setDecider(e.target.value)}
                        >
                          {users.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                  <button className="button secondary" disabled={working}>
                    <Check size={13} />
                    Save ownership
                  </button>
                </form>
              </details>
            )}
          </>
        )
      )}
      {message && (
        <p className="inline-success" role="status">
          <Check size={13} />
          {message}
        </p>
      )}
    </section>
  );
}
export function ImpactPanel({ api, artifact, open }) {
  const [expanded, setExpanded] = useState(false),
    [scenario, setScenario] = useState("change"),
    [change, setChange] = useState(""),
    [result, setResult] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function run(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      setResult(
        await api("/api/artifacts/" + artifact.id + "/impact", {
          method: "POST",
          body: { scenario, change },
        }),
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="impact-panel">
      <div className="review-heading">
        <div>
          <span className="eyebrow">LOOK BEFORE YOU LEAP</span>
          <h3>What ripples from here?</h3>
        </div>
        <button
          className="button secondary"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          <GitBranch size={14} />
          Explore impact
        </button>
      </div>
      {expanded && (
        <>
          <form onSubmit={run}>
            <label className="field">
              What if I…
              <select
                value={scenario}
                onChange={(e) => setScenario(e.target.value)}
              >
                <option value="change">Change this artifact</option>
                <option value="remove">Remove this artifact</option>
              </select>
            </label>
            <label className="field">
              The change you’re considering
              <textarea
                rows={2}
                maxLength={2000}
                placeholder="For example, change our invitation expiry from 7 days to 3."
                value={change}
                onChange={(e) => setChange(e.target.value)}
              />
            </label>
            <button className="button primary" disabled={busy}>
              {busy ? <Busy /> : <Sparkles size={14} />}Analyze impact
            </button>
          </form>
          <ErrorNote text={error} />
          {result && (
            <div className="impact-result">
              <p>{result.summary}</p>
              {result.affected.map((a) => (
                <div className="impact-source" key={a.id}>
                  <SourceButton id={a.id} title={a.title} open={open} />
                  <span className={`evidence-strength ${a.strength}`}>
                    {a.strength}
                  </span>
                  <small>{a.reason}</small>
                </div>
              ))}
              <div className="mode-note">
                {result.mode === "demo"
                  ? "Demo uses declared links, mentions, and topic heuristics."
                  : "AI analysis grounded in your accessible connections."}{" "}
                No artifacts were changed.
                {result.truncated ? " Result limit reached." : ""}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
export function KnowledgeView({ api, artifacts, openArtifact }) {
  const [tab, setTab] = useState("history"),
    [tag, setTag] = useState(""),
    [filter, setFilter] = useState("");
  const tabs = [
    ["history", History, "Decision memory"],
    ["conflicts", AlertTriangle, "Conflicts"],
    ["concepts", Network, "Idea map"],
    ["health", HeartPulse, "Knowledge health"],
    ["context", SlidersHorizontal, "Context lab"],
    ["team", Users, "Team profile"],
  ];
  return (
    <section className="phase-view knowledge-view">
      <div className="phase-eyebrow">
        <Network size={14} />A MEMORY WITH A LITTLE MORE MEANING
      </div>
      <div className="phase-heading-row">
        <div>
          <h1>
            Know the <em>why.</em>
          </h1>
          <p>
            The decisions, connections, and context that help your team move
            thoughtfully.
          </p>
        </div>
      </div>
      <div
        className="knowledge-tabs"
        role="tablist"
        aria-label="Knowledge tools"
      >
        {tabs.map(([v, Icon, label]) => (
          <button
            role="tab"
            aria-selected={tab === v}
            key={v}
            onClick={() => setTab(v)}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>
      {["history", "conflicts", "concepts"].includes(tab) && (
        <form
          className="topic-filter"
          onSubmit={(e) => {
            e.preventDefault();
            setFilter(tag.trim());
          }}
        >
          <label>
            <Search size={14} />
            <input
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              maxLength={40}
              placeholder="A topic, like pricing or onboarding"
              aria-label="Knowledge topic tag"
            />
          </label>
          <button className="button secondary">
            Explore topic <ArrowRight size={13} />
          </button>
          {filter && (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setFilter("");
                setTag("");
              }}
            >
              Clear
            </button>
          )}
        </form>
      )}
      <div role="tabpanel">
        {tab === "history" ? (
          <HistoryView api={api} tag={filter} open={openArtifact} />
        ) : tab === "conflicts" ? (
          <ConflictsView api={api} tag={filter} open={openArtifact} />
        ) : tab === "concepts" ? (
          <ConceptsView
            api={api}
            tag={filter}
            artifacts={artifacts}
            open={openArtifact}
          />
        ) : tab === "health" ? (
          <HealthView api={api} artifacts={artifacts} open={openArtifact} />
        ) : tab === "context" ? (
          <ContextLab api={api} open={openArtifact} />
        ) : (
          <TeamProfile api={api} open={openArtifact} />
        )}
      </div>
      <div className="phase-footer">
        <ShieldCheck size={13} />
        Your accessible knowledge. Human judgment stays in the loop.
      </div>
    </section>
  );
}
function HistoryView({ api, tag, open }) {
  const { data, busy, error } = useLoad(
    api,
    "/api/history" + (tag ? "?tag=" + encodeURIComponent(tag) : ""),
  );
  return (
    <>
      <div className="knowledge-section-title">
        <h2>The story behind the decisions.</h2>
        <span>Oldest → newest</span>
      </div>
      <ErrorNote text={error} />
      {busy ? (
        <Busy />
      ) : data?.decisions.length ? (
        <div className="decision-timeline">
          {data.decisions.map((a) => (
            <article className="knowledge-card decision-memory-card" key={a.id}>
              <div className="memory-label">
                <Clock3 size={12} />
                {date(a.decided_at || a.created_at)}
                <span>{a.status}</span>
              </div>
              <button className="knowledge-title" onClick={() => open(a.id)}>
                {a.title}
                <ArrowUpRight size={15} />
              </button>
              <div className="decision-owners">
                <span>
                  Decision maker:{" "}
                  <strong>
                    {a.lineage.decided_by?.name || "Not declared"}
                  </strong>
                </span>
                <span>
                  Steward: {a.lineage.steward?.name || "Not assigned"}
                </span>
              </div>
              <p className="decision-excerpt">{a.content.slice(0, 300)}</p>
              <Chain lineage={a.lineage} open={open} />
            </article>
          ))}
        </div>
      ) : (
        !error && (
          <Empty title="A story waiting to be recorded.">
            Save a decision artifact and link the sources behind it. Filter by a
            tag to follow a topic over time.
          </Empty>
        )
      )}
    </>
  );
}
function ConflictsView({ api, tag, open }) {
  const [version, setVersion] = useState(0),
    { data, busy, error } = useLoad(
      api,
      "/api/conflicts" + (tag ? "?tag=" + encodeURIComponent(tag) : ""),
      version,
    ),
    [running, setRunning] = useState(false),
    [localError, setError] = useState(""),
    [note, setNote] = useState("");
  async function scan() {
    setRunning(true);
    setError("");
    try {
      const r = await api("/api/conflicts/detect", {
        method: "POST",
        body: tag ? { tag } : {},
      });
      setNote(
        `${r.analyzed_topics} topics checked${r.truncated ? " · sample limit reached" : ""}. ${r.note}`,
      );
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  }
  async function resolve(id) {
    try {
      await api("/api/conflicts/" + id, {
        method: "PATCH",
        body: { status: "resolved" },
      });
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <>
      <div className="knowledge-section-title">
        <div>
          <h2>Make room for a second look.</h2>
          <p>Potential inconsistencies, with the evidence beside them.</p>
        </div>
        <button className="button primary" disabled={running} onClick={scan}>
          {running ? <Busy /> : <Sparkles size={14} />}Check for conflicts
        </button>
      </div>
      <ErrorNote text={error || localError} />
      {note && <p className="mode-note">{note}</p>}
      {busy ? (
        <Busy />
      ) : data?.reports.length ? (
        <div className="knowledge-stack">
          {data.reports.map((r) => (
            <article className="knowledge-card conflict-card" key={r.id}>
              <div className="report-meta">
                <span className={"severity " + r.severity}>
                  {r.severity} impact
                </span>
                <span>{r.topic}</span>
                {r.stale && (
                  <span className="stale-label">
                    Sources changed · check again
                  </span>
                )}
              </div>
              <h3>{r.summary}</h3>
              {r.evidence.map((e, i) => (
                <blockquote key={i}>
                  <p>“{e.quote}”</p>
                  <SourceButton
                    id={e.artifact_id}
                    title={
                      r.sources.find((s) => s.id === e.artifact_id)?.title ||
                      "Source"
                    }
                    open={open}
                  />
                </blockquote>
              ))}
              {r.can_resolve && (
                <button
                  className="button secondary"
                  onClick={() => resolve(r.id)}
                >
                  <Check size={13} />
                  Mark reviewed & resolved
                </button>
              )}
            </article>
          ))}
        </div>
      ) : (
        !error && (
          <Empty title="Nothing flagged here yet.">
            Run an on-demand check to look for conflicting assumptions. An empty
            result does not prove consistency.
          </Empty>
        )
      )}
    </>
  );
}
function ConceptsView({ api, tag, artifacts, open }) {
  const [version, setVersion] = useState(0),
    { data, busy, error } = useLoad(
      api,
      "/api/concepts" + (tag ? "?tag=" + encodeURIComponent(tag) : ""),
      version,
    ),
    [selected, setSelected] = useState([]),
    [running, setRunning] = useState(false),
    [localError, setError] = useState(""),
    [note, setNote] = useState("");
  async function extract() {
    setRunning(true);
    setError("");
    try {
      const r = await api("/api/concepts/extract", {
        method: "POST",
        body: { artifact_ids: selected },
      });
      setNote(r.note);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  }
  return (
    <>
      <div className="knowledge-section-title">
        <div>
          <h2>Follow the ideas above the documents.</h2>
          <p>Source-backed concepts and the relationships between them.</p>
        </div>
      </div>
      <details className="concept-extractor">
        <summary>
          <Plus size={14} />
          Propose concepts from artifacts
        </summary>
        <p className="field-help">
          Choose up to 12 sources. Private inputs keep derived concepts
          restricted to people who can access every input.
        </p>
        <div className="concept-source-picker">
          {artifacts.map((a) => (
            <label key={a.id}>
              <input
                type="checkbox"
                checked={selected.includes(a.id)}
                disabled={!selected.includes(a.id) && selected.length >= 12}
                onChange={(e) =>
                  setSelected((v) =>
                    e.target.checked
                      ? [...v, a.id]
                      : v.filter((id) => id !== a.id),
                  )
                }
              />
              {a.title}
            </label>
          ))}
        </div>
        <button
          className="button primary"
          disabled={!selected.length || running}
          onClick={extract}
        >
          {running ? <Busy /> : <Network size={14} />}Extract concepts
        </button>
      </details>
      <ErrorNote text={error || localError} />
      {note && <p className="mode-note">{note}</p>}
      {busy ? (
        <Busy />
      ) : data?.nodes.length ? (
        <>
          <div className="concept-grid">
            {data.nodes.map((n) => (
              <article className="knowledge-card concept-node" key={n.id}>
                <span className="concept-node-icon">
                  <Network size={19} />
                </span>
                <h3>{n.name}</h3>
                <p>{n.description}</p>
                {n.stale && (
                  <span className="stale-label">Sources have changed</span>
                )}
                <div className="concept-tags">
                  {n.tags.map((t) => (
                    <span key={t}>{t}</span>
                  ))}
                </div>
                <div className="step-sources">
                  {n.sources.map((s) => (
                    <SourceButton key={s.id} {...s} open={open} />
                  ))}
                </div>
              </article>
            ))}
          </div>
          {data.edges.length > 0 && (
            <div className="concept-relationships">
              <h3>How the ideas connect</h3>
              {data.edges.map((e) => (
                <div key={e.id}>
                  <span>
                    {data.nodes.find((n) => n.id === e.from_id)?.name}
                  </span>
                  <span className="relationship-verb">
                    {e.type.replace("_", " ")} <ArrowRight size={12} />
                  </span>
                  <span>{data.nodes.find((n) => n.id === e.to_id)?.name}</span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        !error && (
          <Empty title="Every idea has a few connections.">
            Select artifacts to build a source-backed idea map. Demo mode builds
            a topic index from tags and declared links.
          </Empty>
        )
      )}
    </>
  );
}
function HealthView({ api, artifacts, open }) {
  const { data, busy, error } = useLoad(api, "/api/knowledge/health"),
    [advice, setAdvice] = useState(null),
    [running, setRunning] = useState(false),
    [localError, setError] = useState("");
  async function recommend() {
    setRunning(true);
    setError("");
    try {
      setAdvice(
        await api("/api/knowledge/health/recommendations", {
          method: "POST",
          body: {},
        }),
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  }
  const title = (id) =>
    artifacts.find((a) => a.id === id)?.title || "Open source";
  return (
    <>
      <div className="knowledge-section-title">
        <div>
          <h2>A little care for the shared brain.</h2>
          <p>
            Signals for review. Nothing gets merged or archived automatically.
          </p>
        </div>
        <button
          className="button primary"
          disabled={running || busy}
          onClick={recommend}
        >
          {running ? <Busy /> : <Sparkles size={14} />}Suggest cleanup
        </button>
      </div>
      <ErrorNote text={error || localError} />
      {busy ? (
        <Busy />
      ) : (
        data && (
          <>
            <div className="health-stats">
              <div>
                <strong>{data.duplicates.length}</strong>
                <span>Possible duplicate pairs</span>
              </div>
              <div>
                <strong>{data.stale.length}</strong>
                <span>Idle for {data.stale_days}+ days</span>
              </div>
              <div>
                <strong>
                  {data.topics.filter((t) => t.coverage === "scattered").length}
                </strong>
                <span>Scattered topics</span>
              </div>
            </div>
            <p className="mode-note">
              {data.analyzed} accessible artifacts checked
              {data.truncated ? " · sample limit reached" : ""}. Similarity is a
              local word-profile heuristic; idle time includes updates, views,
              and context use.
            </p>
            {advice && (
              <div className="cleanup-advice">
                <h3>A few considered next steps.</h3>
                {advice.suggestions.length ? (
                  advice.suggestions.map((s, i) => (
                    <article className="knowledge-card" key={i}>
                      <span className="memory-label">
                        {s.action.replace("_", " ")}
                      </span>
                      <h3>
                        {s.proposed_title ||
                          "Review with the knowledge steward"}
                      </h3>
                      <p>{s.reason}</p>
                      <div className="step-sources">
                        {s.artifact_ids.map((id) => (
                          <SourceButton
                            key={id}
                            id={id}
                            title={title(id)}
                            open={open}
                          />
                        ))}
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="field-help">
                    No cleanup suggestions from the current signals.
                  </p>
                )}
              </div>
            )}
            <div className="health-columns">
              <div>
                <h3>Worth comparing</h3>
                {data.duplicates.length ? (
                  data.duplicates.map((d, i) => (
                    <div className="health-item" key={i}>
                      <span className="memory-label">
                        {Math.round(d.similarity * 100)}% similarity
                      </span>
                      {d.artifact_ids.map((id, j) => (
                        <SourceButton
                          key={id}
                          id={id}
                          title={d.titles[j]}
                          open={open}
                        />
                      ))}
                    </div>
                  ))
                ) : (
                  <p className="field-help">No strong duplicate signals.</p>
                )}
              </div>
              <div>
                <h3>Ready for a check-in</h3>
                {data.stale.length ? (
                  data.stale.map((a) => (
                    <div className="health-item" key={a.id}>
                      <SourceButton id={a.id} title={a.title} open={open} />
                      <small>
                        {a.days_idle} days without recorded activity
                      </small>
                    </div>
                  ))
                ) : (
                  <p className="field-help">
                    No artifacts meet the idle-time threshold.
                  </p>
                )}
              </div>
            </div>
            <h3 className="knowledge-subheading">A view across topics</h3>
            <div className="topic-health-list">
              {data.topics.map((t) => (
                <div key={t.tag}>
                  <strong>{t.tag}</strong>
                  <span>{t.count} sources</span>
                  <span className={"coverage " + t.coverage}>{t.coverage}</span>
                  <small>{t.recommendation}</small>
                </div>
              ))}
            </div>
          </>
        )
      )}
    </>
  );
}
function ContextLab({ api, open }) {
  const [query, setQuery] = useState(""),
    [intent, setIntent] = useState("plan"),
    [budget, setBudget] = useState(2400),
    [result, setResult] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function run(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      setResult(
        await api(
          "/api/agent/context-debug?" +
            new URLSearchParams({ query, intent, budget_tokens: budget }),
        ),
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="knowledge-section-title">
        <div>
          <h2>A smaller context. A better fit.</h2>
          <p>
            See what your agent would select, what it would leave out, and why.
          </p>
        </div>
      </div>
      <form className="context-lab-form" onSubmit={run}>
        <label className="field">
          The question
          <input
            required
            maxLength={1000}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="What shaped our pricing decisions?"
          />
        </label>
        <div className="field-row">
          <label className="field">
            Intent
            <select value={intent} onChange={(e) => setIntent(e.target.value)}>
              {intentOptions.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Artifact token budget
            <input
              type="number"
              min={256}
              max={8000}
              step={1}
              value={budget}
              onChange={(e) => setBudget(Number(e.target.value))}
            />
          </label>
        </div>
        <button className="button primary" disabled={busy}>
          {busy ? <Busy /> : <SlidersHorizontal size={14} />}Explain context
          selection
        </button>
      </form>
      <ErrorNote text={error} />
      {result && (
        <div className="context-debug-result">
          <div className="budget-summary">
            <span>
              <strong>{result.tokens}</strong> / {result.budget} estimated
              tokens
            </span>
            <div>
              <span
                style={{
                  width:
                    Math.min(100, (result.tokens / result.budget) * 100) + "%",
                }}
              />
            </div>
          </div>
          <p className="mode-note">
            {result.estimation}. Up to 100 retrieval candidates and 8 selected
            sources. History and the system/user messages have separate limits.
          </p>
          <p className="normalized-query">
            <span>Normalized question</span>
            {result.normalized_query}
          </p>
          {result.candidates.map((c) => (
            <article
              className={`knowledge-card context-candidate ${c.selected ? "selected" : ""}`}
              key={c.id}
            >
              <div className="context-candidate-heading">
                <SourceButton id={c.id} title={c.title} open={open} />
                <span>{c.selected ? "Selected" : "Left out"}</span>
              </div>
              <p>{c.reason}</p>
              <div className="score-grid">
                {Object.entries(c.components).map(([k, v]) => (
                  <div key={k}>
                    <span>{k}</span>
                    <strong>{Math.round(v * 100)}%</strong>
                  </div>
                ))}
              </div>
              <small>
                Weighted value {c.score.toFixed(3)} · Value per budget{" "}
                {c.density.toFixed(3)} · {c.tokens} estimated source tokens
              </small>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
function TeamProfile({ api, open }) {
  const [version, setVersion] = useState(0),
    { data, busy, error } = useLoad(api, "/api/team/preferences", version),
    v = useLoad(api, "/api/team/vocabulary", version),
    org = useLoad(api, "/api/organization"),
    [mappings, setMappings] = useState([]),
    [hints, setHints] = useState(""),
    [saving, setSaving] = useState(false),
    [localError, setError] = useState(""),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    if (v.data) {
      setMappings(
        v.data.mappings.map((m) => ({ ...m, synonyms: m.synonyms.join(", ") })),
      );
      setHints(v.data.hints.join("\n"));
    }
  }, [v.data]);
  function change(i, key, value) {
    setMappings((rows) =>
      rows.map((r, j) => (j === i ? { ...r, [key]: value } : r)),
    );
    setSaved(false);
  }
  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api("/api/team/vocabulary", {
        method: "PUT",
        body: {
          mappings: mappings
            .filter(
              (m) =>
                m.canonical.trim() || m.preferred.trim() || m.synonyms.trim(),
            )
            .map((m) => ({
              ...m,
              synonyms: m.synonyms
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean),
            })),
          hints: hints
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
        },
      });
      setSaved(true);
      setVersion((n) => n + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <div className="knowledge-section-title">
        <div>
          <h2>A shared language. A personal touch.</h2>
          <p>
            Team signals and terminology that make your agent feel more at home.
          </p>
        </div>
      </div>
      <ErrorNote text={error || v.error || localError} />
      {busy ? (
        <Busy />
      ) : (
        data && (
          <>
            <div className="health-stats">
              <div>
                <strong>
                  {Math.round(data.median_preferred_answer_words)}
                </strong>
                <span>Preferred answer words · estimate</span>
              </div>
              <div>
                <strong>{data.feedback_count}</strong>
                <span>Answer feedback signals</span>
              </div>
              <div>
                <strong>{data.common_tags.length}</strong>
                <span>Visible recurring topics</span>
              </div>
            </div>
            <p className="field-help">
              Length preferences are inferred from feedback, with a 150-word
              default. Artifact usefulness is a weak signal, not a claim of
              correctness.
            </p>
            <div className="concept-tags">
              {data.common_tags.map((t) => (
                <span key={t.tag}>
                  {t.tag} · {t.count}
                </span>
              ))}
            </div>
            <div className="team-used-sources">
              {data.often_used_artifacts.map((a) => (
                <div key={a.artifact_id}>
                  <SourceButton
                    id={a.artifact_id}
                    title={a.title}
                    open={open}
                  />
                  <small>{a.uses} context selections</small>
                </div>
              ))}
            </div>
          </>
        )
      )}
      <div className="vocabulary-editor">
        <h3>Our words for things.</h3>
        <p className="field-help">
          Synonyms normalize into a canonical term before retrieval. Answers use
          your preferred term. Stored artifacts are never rewritten.
        </p>
        {!v.data?.can_manage && (
          <p className="mode-note">
            <ShieldCheck size={13} />
            Only the organization owner can edit this shared terminology.
          </p>
        )}
        <form onSubmit={save}>
          <fieldset disabled={!v.data?.can_manage || saving}>
            {mappings.map((m, i) => (
              <div className="vocabulary-row" key={i}>
                <label className="field">
                  Canonical term
                  <input
                    aria-label={"Canonical term " + (i + 1)}
                    minLength={2}
                    maxLength={60}
                    value={m.canonical}
                    onChange={(e) => change(i, "canonical", e.target.value)}
                    placeholder="subscription"
                  />
                </label>
                <label className="field">
                  Preferred term
                  <input
                    aria-label={"Preferred term " + (i + 1)}
                    minLength={2}
                    maxLength={60}
                    value={m.preferred}
                    onChange={(e) => change(i, "preferred", e.target.value)}
                    placeholder="plan"
                  />
                </label>
                <label className="field">
                  Synonyms
                  <input
                    aria-label={"Synonyms " + (i + 1)}
                    value={m.synonyms}
                    onChange={(e) => change(i, "synonyms", e.target.value)}
                    placeholder="membership, package"
                  />
                </label>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={"Remove term " + (i + 1)}
                  onClick={() =>
                    setMappings((rows) => rows.filter((_, j) => j !== i))
                  }
                >
                  <X size={13} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="button secondary"
              disabled={mappings.length >= 40}
              onClick={() =>
                setMappings((rows) => [
                  ...rows,
                  { canonical: "", preferred: "", synonyms: "" },
                ])
              }
            >
              <Plus size={13} />
              Add a term
            </button>
            <label className="field">
              Known team patterns{" "}
              <span className="optional">one per line, optional</span>
              <textarea
                rows={3}
                maxLength={1600}
                value={hints}
                onChange={(e) => {
                  setHints(e.target.value);
                  setSaved(false);
                }}
                placeholder="We favor small, reversible product experiments."
              />
            </label>
            <button className="button primary">
              {saving ? <Busy /> : <Check size={13} />}Save team vocabulary
            </button>
          </fieldset>
        </form>
        {saved && (
          <p className="inline-success" role="status">
            <Check size={13} />
            Team vocabulary saved.
          </p>
        )}
      </div>
      <div className="organization-note">
        <Users size={17} />
        <div>
          <strong>{org.data?.name || "Your organization"}</strong>
          <p>
            Artifacts now have organization ownership. Shared spaces across
            organizations are designed, but cross-organization sharing is not
            enabled yet.
          </p>
        </div>
      </div>
    </>
  );
}
