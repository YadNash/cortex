import React, { useEffect, useState } from "react";
import {
  BookOpen,
  ArrowUpRight,
  ArrowRight,
  Check,
  CheckCheck,
  Circle,
  RefreshCw,
  Loader2,
  Sparkles,
  FileText,
  MessageSquare,
  Layers3,
  GitBranch,
  ShieldCheck,
  Sun,
  Moon,
  Monitor,
  Users,
  LockKeyhole,
} from "lucide-react";
export const roleOptions = [
  ["engineer", "Engineer"],
  ["pm", "Product manager"],
  ["designer", "Designer"],
  ["other", "Other / exploring"],
];
const roleLabel = (role) =>
  roleOptions.find(([v]) => v === role)?.[1] || "Your role";
function Busy() {
  return <Loader2 size={17} className="spin" />;
}
function ErrorNote({ message }) {
  return message ? (
    <div className="form-error" role="alert">
      {message}
    </div>
  ) : null;
}
export function useTheme() {
  const [preference, setPreference] = useState(() => {
    const saved = localStorage.getItem("cortex.theme");
    return ["light", "dark", "system"].includes(saved) ? saved : "system";
  });
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const dark = preference === "dark" || (preference === "system" && systemDark);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    localStorage.setItem("cortex.theme", preference);
  }, [preference, dark]);
  return { preference, setPreference, dark };
}
export function ThemeToggle({ theme, className = "" }) {
  return (
    <button
      className={`icon-button theme-toggle ${className}`}
      aria-label={theme.dark ? "Switch to light mode" : "Switch to dark mode"}
      title={theme.dark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => theme.setPreference(theme.dark ? "light" : "dark")}
    >
      {theme.dark ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}
export function ProfileSettings({ user, setUser, api, theme, health }) {
  const [role, setRole] = useState(user.role || "other"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setSaved(false);
    setError("");
    try {
      setUser(await api("/api/me", { method: "PATCH", body: { role } }));
      setSaved(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="eyebrow">MAKE YOURSELF AT HOME</div>
      <h2>Your little corner.</h2>
      <p className="modal-description">
        A thinking partner that meets you where you are.
      </p>
      <div className="phase-profile">
        <span>
          {user.name
            .split(" ")
            .map((w) => w[0])
            .slice(0, 2)
            .join("")}
        </span>
        <div>
          <strong>{user.name}</strong>
          <small>{user.email}</small>
        </div>
      </div>
      <form onSubmit={save}>
        <label className="field">
          Your role
          <select
            aria-label="Your role"
            value={role}
            onChange={(e) => {
              setRole(e.target.value);
              setSaved(false);
            }}
          >
            {roleOptions.map(([v, l]) => (
              <option value={v} key={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <p className="field-help">
          Shapes your onboarding path and your agent’s perspective.
        </p>
        <ErrorNote message={error} />
        <div className="role-save-row">
          <button
            className="button primary"
            disabled={busy || role === user.role}
          >
            {busy ? <Busy /> : <Check size={14} />}Save role
          </button>
          {saved && (
            <span role="status">
              <CheckCheck size={14} />
              All set.
            </span>
          )}
        </div>
      </form>
      <div className="settings-divider" />
      <h3 className="settings-subheading">Set the mood</h3>
      <p className="field-help">
        A brighter day or a quieter evening. Make this space yours.
      </p>
      <div className="theme-options" role="group" aria-label="Appearance">
        {[
          ["light", Sun, "Light"],
          ["dark", Moon, "Dark"],
          ["system", Monitor, "System"],
        ].map(([v, Icon, label]) => (
          <button
            key={v}
            aria-pressed={theme.preference === v}
            className={theme.preference === v ? "selected" : ""}
            onClick={() => theme.setPreference(v)}
          >
            <Icon size={18} />
            {label}
            {theme.preference === v && <Check size={12} />}
          </button>
        ))}
      </div>
      <div className="settings-divider" />
      <div className="settings-status">
        <span className="status-dot" />
        <strong>
          {health?.mode === "openai"
            ? "Live AI connected"
            : "Exploring in demo mode"}
        </strong>
      </div>
      <p className="modal-description">
        {health?.mode === "openai"
          ? "Your role shapes live chat and onboarding. Reviewers offer three distinct perspectives on the same artifact."
          : "All sharing, artifacts, and activity work locally. Onboarding uses role-specific templates; decision extraction looks for explicit cues; reviews are labeled persona checklists."}
      </p>
      <div className="form-note">
        <ShieldCheck size={16} />
        Every source, plan, and review respects your access. Private thinking
        stays private.
      </div>
    </>
  );
}
export function OnboardingView({ api, user, openArtifact }) {
  const [role, setRole] = useState(user.role || "other"),
    [plan, setPlan] = useState(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  const key = `cortex.onboarding.${user.id}.${role}`;
  const [completed, setCompleted] = useState(() => {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      setCompleted(Array.isArray(value) ? value : []);
    } catch {
      setCompleted([]);
    }
  }, [key]);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError("");
    setPlan(null);
    api("/api/onboarding/plan", { method: "POST", body: { role } })
      .then((p) => {
        if (active) setPlan(p);
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
  }, [role, revision]);
  const stepKey = (s) => s.title + "|" + s.artifact_ids.join(",");
  const done =
    plan?.steps.filter((s) => completed.includes(stepKey(s))).length || 0;
  function toggle(step) {
    const id = stepKey(step);
    setCompleted((previous) => {
      const next = previous.includes(id)
        ? previous.filter((x) => x !== id)
        : [...previous, id];
      localStorage.setItem(key, JSON.stringify(next));
      return next;
    });
  }
  return (
    <section className="phase-view onboarding-view">
      <div className="phase-eyebrow">
        <BookOpen size={14} />A WARMER WAY IN
      </div>
      <div className="phase-heading-row">
        <div>
          <h1>
            Find your <em>footing.</em>
          </h1>
          <p>A personal path through what your team already knows.</p>
        </div>
        <div className="path-controls">
          <label className="role-select">
            <span>Your perspective</span>
            <select
              aria-label="Onboarding role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              {roleOptions.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => setRevision((v) => v + 1)}
          >
            <RefreshCw size={14} />
            Regenerate
          </button>
        </div>
      </div>
      <ErrorNote message={error} />
      {error && (
        <button
          className="button secondary"
          onClick={() => setRevision((v) => v + 1)}
        >
          Try again
        </button>
      )}
      {busy ? (
        <div className="phase-loading">
          <span className="phase-loading-icon">
            <Sparkles size={26} />
          </span>
          <Busy />
          <h2>Connecting your starting points.</h2>
          <p>
            Finding the knowledge you can use, through a{" "}
            {roleLabel(role).toLowerCase()}’s lens.
          </p>
        </div>
      ) : (
        plan && (
          <>
            <div className="path-summary">
              <span className="path-summary-icon">
                <GitBranch size={22} />
              </span>
              <div>
                <strong>Your {roleLabel(plan.role).toLowerCase()} path</strong>
                <span>
                  {plan.steps.length} starting points · Built from your
                  accessible workspace
                </span>
              </div>
              <span className="path-progress-label">
                {done} of {plan.steps.length} complete
              </span>
              <div className="path-progress">
                <span
                  style={{
                    width:
                      (plan.steps.length
                        ? (done / plan.steps.length) * 100
                        : 0) + "%",
                  }}
                />
              </div>
            </div>
            {plan.mode === "demo" && (
              <div className="mode-note">
                <Sparkles size={13} />
                Demo path · role-specific reading prompts. Connect live AI for a
                generated step-by-step guide.
              </div>
            )}
            {!plan.steps.length ? (
              <div className="empty-state">
                <BookOpen size={28} />
                <h2>Every path starts somewhere.</h2>
                <p>
                  Create or share a few artifacts, then regenerate your guide.
                </p>
              </div>
            ) : (
              <div className="path-steps">
                {plan.steps.map((step, i) => {
                  const checked = completed.includes(stepKey(step));
                  return (
                    <article
                      key={stepKey(step)}
                      className={`path-step ${checked ? "completed" : ""}`}
                    >
                      <div className="path-step-rail">
                        <button
                          aria-label={`Mark step ${i + 1} ${checked ? "incomplete" : "complete"}`}
                          aria-pressed={checked}
                          onClick={() => toggle(step)}
                        >
                          {checked ? (
                            <Check size={19} />
                          ) : (
                            <span>{String(i + 1).padStart(2, "0")}</span>
                          )}
                        </button>
                        <span />
                      </div>
                      <div className="path-step-body">
                        <span className="step-eyebrow">
                          {checked
                            ? "A LITTLE MORE GROUNDED"
                            : `YOUR NEXT STEP · ${String(i + 1).padStart(2, "0")}`}
                        </span>
                        <h2>{step.title}</h2>
                        <p>{step.description}</p>
                        <div className="step-sources">
                          {step.artifact_ids.map((id) => {
                            const a = plan.artifacts.find((a) => a.id === id);
                            return (
                              a && (
                                <button
                                  key={id}
                                  onClick={() => openArtifact(id)}
                                >
                                  <FileText size={13} />
                                  {a.title}
                                  <ArrowUpRight size={12} />
                                </button>
                              )
                            );
                          })}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
            {plan.steps.length > 0 && done === plan.steps.length && (
              <div className="path-finished">
                <CheckCheck size={23} />
                <div>
                  <h3>A little more at home.</h3>
                  <p>
                    You’ve made your way through this path. Bring your questions
                    to your agent or a teammate.
                  </p>
                </div>
              </div>
            )}
          </>
        )
      )}
      <div className="phase-footer">
        <LockKeyhole size={12} />
        Only knowledge you have access to. Progress stays in this browser.
      </div>
    </section>
  );
}
const eventCopy = {
  artifact_created: "created",
  artifact_updated: "updated",
  artifact_commented: "commented on",
};
export function ActivityView({ api, openArtifact }) {
  const [events, setEvents] = useState([]),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [limit, setLimit] = useState(20);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError("");
    api("/api/activity?limit=" + limit)
      .then((data) => {
        if (active) setEvents(data);
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
  }, [revision, limit]);
  const dateOf = (date) => new Date(date.includes("T") ? date : date + "Z");
  return (
    <section className="phase-view activity-view">
      <div className="phase-eyebrow">
        <GitBranch size={14} />
        THE SHARED BRAIN, IN MOTION
      </div>
      <div className="phase-heading-row">
        <div>
          <h1>
            Good thinking <em>travels.</em>
          </h1>
          <p>The latest ideas, updates, and conversations in your orbit.</p>
        </div>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => setRevision((v) => v + 1)}
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>
      <div className="activity-permission">
        <ShieldCheck size={15} />A view of what’s changing — filtered to what
        you can see.
      </div>
      <ErrorNote message={error} />
      {busy ? (
        <div className="loading-state">
          <Busy />
          Gathering the latest thinking…
        </div>
      ) : events.length ? (
        <div className="activity-timeline">
          {events.map((event, i) => {
            const date = dateOf(event.created_at),
              previous = i > 0 ? dateOf(events[i - 1].created_at) : null;
            const Icon =
              event.type === "artifact_commented"
                ? MessageSquare
                : event.type === "artifact_updated"
                  ? RefreshCw
                  : FileText;
            return (
              <React.Fragment key={event.id}>
                {(!previous ||
                  date.toDateString() !== previous.toDateString()) && (
                  <div className="activity-date">
                    {date.toDateString() === new Date().toDateString()
                      ? "Today"
                      : date.toLocaleDateString(undefined, {
                          month: "long",
                          day: "numeric",
                          year: "numeric",
                        })}
                  </div>
                )}
                <button
                  className="activity-event"
                  onClick={() => openArtifact(event.artifact_id)}
                >
                  <span className={`activity-avatar event-${event.type}`}>
                    <Icon size={17} />
                  </span>
                  <span className="activity-event-text">
                    <span>
                      <strong>{event.actor_name}</strong>{" "}
                      {eventCopy[event.type]} an artifact
                    </span>
                    <span className="activity-artifact">
                      <Layers3 size={13} />
                      {event.artifact_title}
                      <ArrowUpRight size={12} />
                    </span>
                  </span>
                  <time dateTime={event.created_at}>
                    {date.toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </time>
                </button>
              </React.Fragment>
            );
          })}
        </div>
      ) : (
        !error && (
          <div className="empty-state">
            <GitBranch size={30} />
            <h2>A quiet beginning.</h2>
            <p>Create an artifact or add a comment. The story starts there.</p>
          </div>
        )
      )}
      {!busy && events.length >= limit && limit < 100 && (
        <button
          className="button secondary activity-more"
          onClick={() => setLimit((v) => Math.min(v + 20, 100))}
        >
          A little further back <ArrowRight size={14} />
        </button>
      )}
      <div className="phase-footer">
        <LockKeyhole size={12} />
        Visibility is checked when you load this feed and open a source.
      </div>
    </section>
  );
}
export function DecisionCapture({ api, onCreated, artifacts = [] }) {
  const [sources, setSources] = useState([]);
  const [notes, setNotes] = useState(""),
    [title, setTitle] = useState(""),
    [visibility, setVisibility] = useState("team"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function extract(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      onCreated(
        await api("/api/decisions/extract", {
          method: "POST",
          body: {
            source_text: notes,
            source_artifact_ids: sources,
            ...(title.trim() ? { title: title.trim() } : {}),
            visibility,
          },
        }),
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={extract}>
      <div className="eyebrow">FROM CONVERSATION TO CLARITY</div>
      <h2>Keep what was decided.</h2>
      <p className="modal-description">
        Give the decisions a place to live. Paste your meeting notes or a
        conversation below.
      </p>
      <ErrorNote message={error} />
      <label className="field">
        A name for this conversation <span className="optional">optional</span>
        <input
          value={title}
          maxLength={180}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Monday’s product sync"
        />
      </label>
      <label className="field">
        Meeting notes or transcript
        <textarea
          required
          minLength={10}
          maxLength={30000}
          rows={9}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={
            "What came up? What did the team agree on?\n\nDecision: We will use single-use invitations.\nWe agreed to start with a seven-day onboarding checklist."
          }
        />
      </label>
      {artifacts.length > 0 && (
        <details className="concept-extractor">
          <summary>Link reference artifacts</summary>
          <p className="field-help">
            Selected sources inform extraction and become versioned provenance
            links. Extracted text uses the sharing scope below.
          </p>
          <div className="concept-source-picker">
            {artifacts.map((a) => (
              <label key={a.id}>
                <input
                  type="checkbox"
                  checked={sources.includes(a.id)}
                  disabled={!sources.includes(a.id) && sources.length >= 12}
                  onChange={(e) =>
                    setSources((v) =>
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
        </details>
      )}
      <label className="field">
        Where should the decisions live?
        <select
          value={visibility}
          onChange={(e) => setVisibility(e.target.value)}
        >
          <option value="team">Team — everyone in this workspace</option>
          <option value="private">Private — only me</option>
        </select>
      </label>
      <div className="form-note">
        {visibility === "team" ? (
          <Users size={16} />
        ) : (
          <LockKeyhole size={16} />
        )}
        <span>
          {visibility === "team"
            ? "Extracting will save a decision artifact visible to your whole team."
            : "Extracting will save a private decision artifact."}{" "}
          Only the extracted decisions are saved; the full transcript isn’t
          stored.
        </span>
      </div>
      <p className="field-help">
        Demo mode recognizes lines beginning “Decision:”, “We agreed”, or “We
        decided”. Live AI extracts durable decisions and rationale.
      </p>
      <div className="form-actions">
        <button
          className="button primary"
          disabled={busy || notes.trim().length < 10}
        >
          {busy ? <Busy /> : <Sparkles size={15} />}{" "}
          {busy ? "Finding the decisions…" : "Extract decisions"}
        </button>
      </div>
    </form>
  );
}
export function ReviewPanel({ api, artifactId, renderText }) {
  const [result, setResult] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function review() {
    setBusy(true);
    setError("");
    try {
      setResult(
        await api("/api/agent/review-artifact", {
          method: "POST",
          body: { artifact_id: artifactId },
        }),
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const persona = {
    architect: [Layers3, "The architect", "Structure & the long view"],
    product: [Users, "The product thinker", "Clarity & user value"],
    dev: [GitBranch, "The engineer", "Edge cases & next steps"],
  };
  return (
    <section className="review-section">
      <div className="review-heading">
        <div>
          <span className="eyebrow">THREE LENSES. ONE GOOD THOUGHT.</span>
          <h3>A little more perspective.</h3>
        </div>
        <button className="button secondary" onClick={review} disabled={busy}>
          {busy ? <Busy /> : <Sparkles size={14} />}{" "}
          {busy ? "Reviewing…" : result ? "Review again" : "Multi-Agent Review"}
        </button>
      </div>
      <ErrorNote message={error} />
      {busy && (
        <p className="review-pending" role="status">
          Architecture, product, and engineering are taking a look. This may
          take a moment.
        </p>
      )}
      {result && (
        <>
          <div className="mode-note">
            {result.mode === "demo"
              ? "Demo panel · persona checklists, not content-specific AI analysis."
              : "Three AI personas independently reviewed this artifact. Treat feedback as suggestions to evaluate."}
          </div>
          <div className="review-panels">
            {result.reviews.map((r) => {
              const [Icon, label, focus] = persona[r.role];
              return (
                <details
                  className={`review-card reviewer-${r.role}`}
                  key={r.role}
                  open
                >
                  <summary>
                    <span className="review-icon">
                      <Icon size={17} />
                    </span>
                    <span>
                      <strong>{label}</strong>
                      <small>{focus}</small>
                    </span>
                    <span className="review-expand">+</span>
                  </summary>
                  <div className="review-copy">{renderText(r.text)}</div>
                </details>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
