import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUp,
  ArrowUpRight,
  ArrowRight,
  Plus,
  Search,
  MessageSquare,
  Layers3,
  Users,
  Sparkles,
  ChevronDown,
  ChevronRight,
  X,
  Check,
  LockKeyhole,
  Globe2,
  FileText,
  Lightbulb,
  Code2,
  Send,
  MoreHorizontal,
  LogOut,
  Settings2,
  PanelLeftClose,
  PanelLeft,
  Loader2,
  Copy,
  Bookmark,
  Compass,
  SlidersHorizontal,
  CornerDownLeft,
  CircleHelp,
} from "lucide-react";
import "./styles.css";
const icons = {
  note: FileText,
  idea: Lightbulb,
  spec: Layers3,
  code_snippet: Code2,
  handoff: ArrowUpRight,
  other: FileText,
};
const typeName = {
  note: "Note",
  idea: "Idea",
  spec: "Specification",
  code_snippet: "Code snippet",
  handoff: "Handoff",
  other: "Other",
};
const scopes = [
  ["all", "All artifacts"],
  ["my", "My artifacts"],
  ["shared_with_me", "Shared with me"],
  ["team", "Team library"],
  ["assigned_to_me", "Assigned to me"],
];
const initials = (name) =>
  (name || "?")
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("");
const relative = (date) => {
  const d = Math.max(
    0,
    Math.floor(
      (Date.now() - new Date(date.includes("T") ? date : date + "Z")) /
        86400000,
    ),
  );
  return d === 0 ? "Today" : d === 1 ? "Yesterday" : `${d} days ago`;
};
function Logo({ small = false }) {
  return (
    <span className={`brand ${small ? "small" : ""}`}>
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <g fill="none" stroke="currentColor" strokeWidth="2.3">
          <ellipse
            cx="20"
            cy="20"
            rx="15"
            ry="7"
            transform="rotate(-45 20 20)"
          />
          <ellipse
            cx="20"
            cy="20"
            rx="15"
            ry="7"
            transform="rotate(45 20 20)"
          />
        </g>
        <circle cx="20" cy="20" r="3" fill="currentColor" />
      </svg>
      {!small && (
        <span>
          cortex<span className="brand-dot">.</span>
        </span>
      )}
    </span>
  );
}
function IconButton({ label, children, ...props }) {
  return (
    <button className="icon-button" title={label} aria-label={label} {...props}>
      {children}
    </button>
  );
}
function Avatar({ name, size = "normal" }) {
  return (
    <span className={`avatar ${size} color-${(name || "").charCodeAt(0) % 4}`}>
      {initials(name)}
    </span>
  );
}
function Spinner() {
  return <Loader2 size={18} className="spin" />;
}
function Visibility({ value }) {
  const Icon =
    value === "private" ? LockKeyhole : value === "team" ? Globe2 : Users;
  return (
    <span className={`visibility ${value}`}>
      <Icon size={12} />
      {value === "private" ? "Only you" : value === "team" ? "Team" : "Shared"}
    </span>
  );
}
function App() {
  const [token, setToken] = useState(localStorage.getItem("cortex.token"));
  const [user, setUser] = useState(null),
    [users, setUsers] = useState([]),
    [health, setHealth] = useState(null),
    [boot, setBoot] = useState(true);
  const [page, setPage] = useState("chat"),
    [scope, setScope] = useState("all"),
    [artifacts, setArtifacts] = useState([]),
    [workspaceArtifacts, setWorkspaceArtifacts] = useState([]),
    [listBusy, setListBusy] = useState(false),
    [query, setQuery] = useState(""),
    [search, setSearch] = useState("");
  const [modal, setModal] = useState(null),
    [detail, setDetail] = useState(null),
    [toast, setToast] = useState(""),
    [error, setError] = useState(""),
    [mobile, setMobile] = useState(false),
    [context, setContext] = useState(true),
    [refresh, setRefresh] = useState(0);
  const [messages, setMessages] = useState([]),
    [input, setInput] = useState(""),
    [chatBusy, setChatBusy] = useState(false),
    [primary, setPrimary] = useState(null),
    [dropdown, setDropdown] = useState(false);
  const endRef = useRef(null),
    composeRef = useRef(null);
  async function api(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 401 && token) {
        localStorage.removeItem("cortex.token");
        setToken(null);
        setUser(null);
      }
      throw Error(data.message || "Something went wrong.");
    }
    return data;
  }
  function notify(msg) {
    setToast(msg);
  }
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() =>
        setError("Can’t reach Cortex. Check that the API is running."),
      );
  }, []);
  useEffect(() => {
    let active = true;
    setBoot(true);
    if (!token) {
      setBoot(false);
      return;
    }
    Promise.all([api("/api/me"), api("/api/users")])
      .then(([u, us]) => {
        if (active) {
          setUser(u);
          setUsers(us);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBoot(false);
      });
    return () => {
      active = false;
    };
  }, [token]);
  useEffect(() => {
    if (!user) return;
    let active = true;
    api("/api/artifacts?scope=all")
      .then((a) => {
        if (active) setWorkspaceArtifacts(a);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [user, refresh]);
  useEffect(() => {
    const t = setTimeout(() => setSearch(query), 300);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => {
    if (!user) return;
    let active = true;
    setListBusy(true);
    const task = search.trim()
      ? api("/api/search/artifacts", {
          method: "POST",
          body: { query: search, scope: page === "chat" ? "all" : scope },
        })
      : api("/api/artifacts?scope=" + (page === "chat" ? "all" : scope));
    task
      .then((a) => {
        if (active) setArtifacts(a);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setListBusy(false);
      });
    return () => {
      active = false;
    };
  }, [user, page, scope, search, refresh]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, chatBusy]);
  function authenticated(data) {
    localStorage.setItem("cortex.token", data.token);
    setToken(data.token);
    setArtifacts([]);
    setWorkspaceArtifacts([]);
    setMessages([]);
    setPage("chat");
    setDetail(null);
    setError("");
  }
  function navigate(next, filter = "all") {
    setPage(next);
    setScope(filter);
    setQuery("");
    setDetail(null);
    setMobile(false);
  }
  async function openArtifact(id) {
    setError("");
    try {
      setDetail(await api("/api/artifacts/" + id));
    } catch (e) {
      setError(e.message);
    }
  }
  async function send(text = input, artifactId = primary?.id) {
    if (!text.trim() || chatBusy) return;
    const message = text.trim();
    const history = messages
      .slice(-10)
      .map((m) => ({ role: m.role, content: m.content }));
    setMessages((v) => [...v, { role: "user", content: message }]);
    setInput("");
    setError("");
    setChatBusy(true);
    try {
      const r = await api("/api/agent/chat", {
        method: "POST",
        body: {
          message,
          history,
          ...(artifactId ? { artifact_id: artifactId } : {}),
        },
      });
      setMessages((v) => [
        ...v,
        { role: "assistant", content: r.answer, sources: r.used_artifacts },
      ]);
    } catch (e) {
      setMessages((v) => [...v, { role: "error", content: e.message }]);
    } finally {
      setChatBusy(false);
    }
  }
  function openInChat(a) {
    setDetail(null);
    setPage("chat");
    setPrimary(a);
    send(
      `Use “${a.title}” as the main context. Summarize it and suggest next steps.`,
      a.id,
    );
  }
  function saved(a) {
    setModal(null);
    setRefresh((v) => v + 1);
    if (detail?.id === a.id) setDetail(a);
    notify("Saved. A little more context for your team.");
  }
  const assigned = workspaceArtifacts.filter(
    (a) => a.assigned_to_user_id === user?.id,
  ).length;
  if (boot)
    return (
      <div className="boot">
        <Logo />
        <Spinner />
      </div>
    );
  if (!user) return <Auth api={api} health={health} onAuth={authenticated} />;
  return (
    <div className="app-shell">
      {mobile && (
        <div className="sidebar-backdrop" onClick={() => setMobile(false)} />
      )}
      <aside className={`sidebar ${mobile ? "is-open" : ""}`}>
        <a
          className="logo-link"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("chat");
          }}
        >
          <Logo />
        </a>
        <button
          className="workspace-switch"
          onClick={() => setModal({ kind: "team" })}
        >
          <span className="workspace-icon">
            S<span>✳</span>
          </span>
          <span>
            Studio workspace<small>Good things, together.</small>
          </span>
          <ChevronDown size={14} />
        </button>
        <div className="nav-label">YOUR WORKSPACE</div>
        <nav>
          <button
            className={`nav-item ${page === "chat" ? "active" : ""}`}
            onClick={() => navigate("chat")}
          >
            <MessageSquare size={18} />
            <span>My Agent</span>
            <span className="nav-spark">✧</span>
          </button>
          <button
            className={`nav-item ${page === "artifacts" ? "active" : ""}`}
            onClick={() => navigate("artifacts")}
          >
            <Layers3 size={18} />
            <span>Artifacts</span>
            <span className="nav-count">{workspaceArtifacts.length}</span>
          </button>
          <button
            className="nav-item"
            onClick={() => setModal({ kind: "team" })}
          >
            <Users size={18} />
            <span>Team</span>
          </button>
        </nav>
        <div className="sidebar-rule" />
        <div className="nav-label collection-label">
          YOUR COLLECTIONS{" "}
          <IconButton
            label="Create artifact"
            onClick={() => setModal({ kind: "create" })}
          >
            <Plus size={14} />
          </IconButton>
        </div>
        <button
          className="collection"
          onClick={() => navigate("artifacts", "my")}
        >
          <span className="collection-dot lilac" />
          My thinking
          <span>
            <LockKeyhole size={12} />
          </span>
        </button>
        <button
          className="collection"
          onClick={() => navigate("artifacts", "team")}
        >
          <span className="collection-dot mint" />
          Team knowledge
        </button>
        <button
          className="collection"
          onClick={() => navigate("artifacts", "assigned_to_me")}
        >
          <span className="collection-dot peach" />
          Handoffs to me
          {assigned > 0 && <span className="handoff-count">{assigned}</span>}
        </button>
        <div className="sidebar-bottom">
          <div className="knowledge-card">
            <div className="knowledge-symbol">
              <Sparkles size={19} />
              <span className="tiny-star">✦</span>
            </div>
            <p>
              Great minds don’t
              <br />
              think alone.
            </p>
            <span>
              Your team’s knowledge.
              <br />A little more connected.
            </span>
            <button onClick={() => setModal({ kind: "about" })}>
              Meet your second brain <ArrowUpRight size={14} />
            </button>
          </div>
          <button
            className="help-link"
            onClick={() => setModal({ kind: "about" })}
          >
            <CircleHelp size={16} />A little help & inspiration
            <ArrowUpRight size={13} />
          </button>
          <button className="profile" onClick={() => setDropdown(!dropdown)}>
            <Avatar name={user.name} />
            <span>
              {user.name}
              <small>Personal account</small>
            </span>
            <MoreHorizontal size={18} />
          </button>
          {dropdown && (
            <div className="profile-menu">
              <button
                onClick={() => {
                  setDropdown(false);
                  setModal({ kind: "settings" });
                }}
              >
                <Settings2 size={16} />
                Settings & AI
              </button>
              <button
                onClick={() => {
                  localStorage.removeItem("cortex.token");
                  setToken(null);
                  setUser(null);
                  setMessages([]);
                  setDropdown(false);
                }}
              >
                <LogOut size={16} />
                Sign out
              </button>
            </div>
          )}
        </div>
      </aside>
      <main className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <IconButton
              label="Open navigation"
              className="icon-button mobile-toggle"
              onClick={() => setMobile(true)}
            >
              <PanelLeft size={19} />
            </IconButton>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{page === "chat" ? "My Agent" : "Artifacts"}</strong>
          </div>
          <div className="topbar-actions">
            <span className="private-label">
              <LockKeyhole size={12} />
              {page === "chat"
                ? "Your private thinking space"
                : "Shared knowledge, thoughtfully"}
            </span>
            <span className="header-divider" />
            <IconButton
              label="Team members"
              onClick={() => setModal({ kind: "team" })}
            >
              <Users size={17} />
            </IconButton>
            <Avatar name={user.name} size="small" />
          </div>
        </header>
        {error && (
          <div className="global-error" role="alert">
            {error}
            <IconButton label="Dismiss error" onClick={() => setError("")}>
              <X size={15} />
            </IconButton>
          </div>
        )}
        {page === "chat" ? (
          <div className={`chat-layout ${context ? "" : "no-context"}`}>
            <section className="chat-main">
              <div className="section-bar">
                <div>
                  <span className="agent-status" />
                  My Agent<span className="subtle">A mind by your side</span>
                </div>
                <div className="section-tools">
                  <IconButton
                    label="New conversation"
                    disabled={chatBusy}
                    onClick={() => {
                      setMessages([]);
                      setPrimary(null);
                      setInput("");
                      notify("A fresh page. What’s on your mind?");
                    }}
                  >
                    <Plus size={17} />
                  </IconButton>
                  <IconButton
                    label={
                      context ? "Hide context panel" : "Show context panel"
                    }
                    onClick={() => setContext(!context)}
                  >
                    <PanelLeftClose size={17} />
                  </IconButton>
                </div>
              </div>
              <div
                className={`chat-scroll ${messages.length ? "has-messages" : ""}`}
              >
                {!messages.length ? (
                  <div className="welcome">
                    <div className="welcome-orbit">
                      <Logo small />
                      <span className="orbit-spark one">✦</span>
                      <span className="orbit-spark two">✧</span>
                      <span className="orbit-dot" />
                    </div>
                    <div className="eyebrow">A LITTLE SPACE TO THINK BIG</div>
                    <h1>
                      Good things start
                      <br />
                      with a <em>thought.</em>
                    </h1>
                    <p>
                      Hey {user.name.split(" ")[0]}. Bring your half-formed
                      ideas, big questions,
                      <br className="desktop-break" /> and everything in
                      between. Let’s make something of them.
                    </p>
                    <div className="prompt-grid">
                      {[
                        [
                          Sparkles,
                          "Connect the dots",
                          "Find the bigger picture",
                          "What connects our product direction and discovery research?",
                          "lavender",
                        ],
                        [
                          FileText,
                          "Make room for an idea",
                          "From a spark to a starting point",
                          "Help me explore our product direction and suggest a next step.",
                          "sand",
                        ],
                        [
                          ArrowUpRight,
                          "Pass the baton",
                          "Great handoffs start here",
                          "Draft an outline for the onboarding flow and a handoff with technical next steps.",
                          "sage",
                        ],
                        [
                          Compass,
                          "Get up to speed",
                          "Your team, on the same page",
                          "Catch me up on the team’s recent artifacts.",
                          "rose",
                        ],
                      ].map(([Icon, title, desc, prompt, color]) => (
                        <button
                          className={`prompt-card ${color}`}
                          key={title}
                          onClick={() => send(prompt)}
                        >
                          <span className="prompt-icon">
                            <Icon size={19} />
                          </span>
                          <span className="prompt-title">{title}</span>
                          <span className="prompt-description">{desc}</span>
                          <ArrowUpRight size={16} className="prompt-arrow" />
                        </button>
                      ))}
                    </div>
                    <span className="welcome-footnote">
                      <Layers3 size={13} />
                      Your thinking, with your team’s knowledge in reach.
                    </span>
                  </div>
                ) : (
                  <div className="messages">
                    {messages.map((m, i) => (
                      <div className={`message ${m.role}`} key={i}>
                        {m.role === "user" ? (
                          <Avatar name={user.name} />
                        ) : (
                          <span className="message-logo">
                            <Logo small />
                          </span>
                        )}
                        <div className="message-body">
                          <div className="message-name">
                            {m.role === "user"
                              ? user.name.split(" ")[0]
                              : m.role === "error"
                                ? "Couldn’t complete that request"
                                : "Cortex"}
                            <span>
                              {m.role === "assistant"
                                ? "Your thinking partner"
                                : ""}
                            </span>
                          </div>
                          <RichText text={m.content} />
                          {m.sources?.length > 0 && (
                            <div className="message-sources">
                              <span>
                                <Layers3 size={12} />
                                Drawn from your workspace
                              </span>
                              {m.sources.map((a) => (
                                <button
                                  key={a.id}
                                  onClick={() => openArtifact(a.id)}
                                >
                                  <FileText size={12} />
                                  {a.title}
                                  <ArrowUpRight size={11} />
                                </button>
                              ))}
                            </div>
                          )}
                          {m.role === "assistant" && (
                            <div className="message-actions">
                              <button
                                onClick={() =>
                                  setModal({
                                    kind: "create",
                                    initial: {
                                      content: m.content,
                                      title: "",
                                      type: "note",
                                      visibility: "private",
                                    },
                                  })
                                }
                              >
                                <Bookmark size={14} />
                                Save as artifact
                              </button>
                              <IconButton
                                label="Copy response"
                                onClick={async () => {
                                  try {
                                    await navigator.clipboard.writeText(
                                      m.content,
                                    );
                                    notify("Copied to clipboard.");
                                  } catch {
                                    notify(
                                      "Clipboard unavailable. Select the response to copy.",
                                    );
                                  }
                                }}
                              >
                                <Copy size={14} />
                              </IconButton>
                            </div>
                          )}
                          {m.role === "error" && (
                            <button
                              className="text-button"
                              onClick={() => {
                                const prev = messages
                                  .slice(0, i)
                                  .reverse()
                                  .find((x) => x.role === "user");
                                if (prev) send(prev.content);
                              }}
                            >
                              Try again <ArrowRight size={13} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    {chatBusy && (
                      <div className="message assistant">
                        <span className="message-logo">
                          <Logo small />
                        </span>
                        <div className="thinking">
                          <span />
                          <span />
                          <span /> Connecting a few dots
                        </div>
                      </div>
                    )}
                    <div ref={endRef} />
                  </div>
                )}
              </div>
              <div className="composer-area">
                {primary && (
                  <div className="primary-context">
                    <FileText size={13} />
                    <span>In focus: {primary.title}</span>
                    <IconButton
                      label="Remove primary context"
                      onClick={() => setPrimary(null)}
                    >
                      <X size={13} />
                    </IconButton>
                  </div>
                )}
                <form
                  className="composer"
                  onSubmit={(e) => {
                    e.preventDefault();
                    send();
                  }}
                >
                  <textarea
                    ref={composeRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        !e.shiftKey &&
                        !e.nativeEvent.isComposing
                      ) {
                        e.preventDefault();
                        send();
                      }
                    }}
                    placeholder="What’s on your mind?"
                    rows={2}
                    aria-label="Message your agent"
                    maxLength={8000}
                  />
                  <div className="composer-bottom">
                    <button
                      type="button"
                      className="context-add"
                      onClick={() => {
                        navigate("artifacts");
                        notify(
                          "Open an artifact and choose “Open in chat” to add context.",
                        );
                      }}
                    >
                      <Plus size={17} />
                      <span>Add context</span>
                    </button>
                    <div>
                      <span className="model-label">
                        <span className="model-dot" />
                        {health?.mode === "openai"
                          ? "Connected AI"
                          : "Cortex demo"}
                      </span>
                      <button
                        className="send-button"
                        type="submit"
                        disabled={!input.trim() || chatBusy}
                        aria-label="Send message"
                      >
                        {chatBusy ? <Spinner /> : <ArrowUp size={19} />}
                      </button>
                    </div>
                  </div>
                </form>
                <div className="composer-caption">
                  <span>
                    <LockKeyhole size={11} />
                    Only uses knowledge you have access to.
                  </span>
                  <span>
                    Enter to send <CornerDownLeft size={11} />
                  </span>
                </div>
              </div>
            </section>
            {context && (
              <aside className="context-panel">
                <div className="context-title">
                  <span>
                    <Layers3 size={16} />A little context
                  </span>
                  <span className="live-pill">
                    <span />
                    LIVE
                  </span>
                </div>
                <p className="context-intro">
                  Good thinking has good company.
                  <br />
                  Here’s what’s in your orbit.
                </p>
                <div className="context-section-heading">
                  YOUR WORKSPACE <span>{artifacts.length} artifacts</span>
                </div>
                <div className="workspace-stats">
                  <button onClick={() => navigate("artifacts", "my")}>
                    <span className="stat-icon lilac">
                      <LockKeyhole size={15} />
                    </span>
                    <span>Yours to explore</span>
                    <strong>
                      {
                        artifacts.filter((a) => a.owner_user_id === user.id)
                          .length
                      }
                    </strong>
                  </button>
                  <button onClick={() => navigate("artifacts", "team")}>
                    <span className="stat-icon sage">
                      <Users size={15} />
                    </span>
                    <span>Shared thinking</span>
                    <strong>
                      {
                        artifacts.filter((a) => a.visibility !== "private")
                          .length
                      }
                    </strong>
                  </button>
                </div>
                <div className="context-rule" />
                <div className="context-section-heading">
                  RECENTLY IN THE MIX{" "}
                  <button onClick={() => navigate("artifacts")}>
                    View all <ArrowUpRight size={12} />
                  </button>
                </div>
                <div className="recent-artifacts">
                  {listBusy ? (
                    <Spinner />
                  ) : (
                    artifacts.slice(0, 3).map((a) => {
                      const Icon = icons[a.type];
                      return (
                        <button
                          key={a.id}
                          className="recent-artifact"
                          onClick={() => openArtifact(a.id)}
                        >
                          <span className={`file-icon ${a.type}`}>
                            <Icon size={16} />
                          </span>
                          <span>
                            <strong>{a.title}</strong>
                            <small>
                              {a.owner_user_id === user.id
                                ? "You"
                                : a.owner_name.split(" ")[0]}
                              <span>·</span>
                              {relative(a.updated_at)}
                            </small>
                          </span>
                          <ArrowUpRight className="recent-arrow" size={13} />
                        </button>
                      );
                    })
                  )}
                  {!listBusy && !artifacts.length && (
                    <p className="empty-mini">
                      A fresh workspace. Add your first artifact.
                    </p>
                  )}
                </div>
                <button
                  className="create-context"
                  onClick={() => setModal({ kind: "create" })}
                >
                  <Plus size={14} />
                  Add a thought to the mix
                </button>
                <div className="context-note">
                  <span className="note-star">✳</span>
                  <p>
                    One small thought.
                    <br />
                    <em>A world of possibility.</em>
                  </p>
                  <span>
                    Save what matters. Share what helps.
                    <br />
                    Let the next idea find its way.
                  </span>
                  <svg viewBox="0 0 200 70" fill="none" aria-hidden="true">
                    <path
                      d="M15 57C50 15 100 80 120 32S170 3 180 25M105 42c25 10 53 0 61-22M164 20l2 9m0-9-9 2"
                      stroke="currentColor"
                      strokeWidth="1.3"
                    />
                  </svg>
                </div>
                <div className="context-footer">
                  <span className="status-dot" />
                  Permission-aware. Always.
                </div>
              </aside>
            )}
          </div>
        ) : (
          <section className="library">
            <div className="library-heading">
              <div className="eyebrow">THINKING THAT STAYS WITH YOU</div>
              <div className="library-title-row">
                <div>
                  <h1>
                    A home for <em>good ideas.</em>
                  </h1>
                  <p>A little less scattered. A lot more connected.</p>
                </div>
                <button
                  className="button primary"
                  onClick={() => setModal({ kind: "create" })}
                >
                  <Plus size={16} />
                  New artifact
                </button>
              </div>
            </div>
            <div className="library-toolbar">
              <div className="tabs">
                {scopes.map(([key, label]) => (
                  <button
                    key={key}
                    className={scope === key ? "selected" : ""}
                    onClick={() => setScope(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="search-field">
                <Search size={16} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Find a little context…"
                  aria-label="Search artifacts"
                />
                {query && (
                  <IconButton label="Clear search" onClick={() => setQuery("")}>
                    <X size={13} />
                  </IconButton>
                )}
              </label>
            </div>
            <div className="library-results-heading">
              <span>
                {artifacts.length}{" "}
                {artifacts.length === 1 ? "artifact" : "artifacts"}
                {search ? " matching your search" : ""}
              </span>
              <span>
                {search
                  ? health?.mode === "openai"
                    ? "Semantic relevance"
                    : "Demo keyword similarity"
                  : "Recently updated"}
                <SlidersHorizontal size={13} />
              </span>
            </div>
            {listBusy ? (
              <div className="loading-state">
                <Spinner />
                Finding your context…
              </div>
            ) : artifacts.length ? (
              <div className="artifact-grid">
                {artifacts.map((a) => (
                  <ArtifactCard
                    key={a.id}
                    a={a}
                    user={user}
                    onClick={() => openArtifact(a.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <span className="empty-symbol">
                  <Layers3 size={28} />
                </span>
                <h2>
                  {search
                    ? "No thoughts found just yet."
                    : "A little room for something good."}
                </h2>
                <p>
                  {search
                    ? "Try another search, or explore a different collection."
                    : "Save your first artifact. An idea, a note, a starting point."}
                </p>
                <button
                  className="button primary"
                  onClick={() =>
                    search ? setQuery("") : setModal({ kind: "create" })
                  }
                >
                  {search ? "Clear search" : "Create an artifact"}
                  <Plus size={15} />
                </button>
              </div>
            )}
            <div className="library-footnote">
              <LockKeyhole size={12} />
              Your private artifacts stay private. Shared thinking goes only
              where you choose.
            </div>
          </section>
        )}
      </main>
      {detail && !modal && (
        <Detail
          key={detail.id}
          artifact={detail}
          user={user}
          api={api}
          onClose={() => setDetail(null)}
          onEdit={() => setModal({ kind: "edit", initial: detail })}
          onShare={() => setModal({ kind: "share", initial: detail })}
          onChat={() => openInChat(detail)}
        />
      )}
      {modal && (
        <Modal
          onClose={() => setModal(null)}
          wide={["create", "edit"].includes(modal.kind)}
        >
          {["create", "edit", "share"].includes(modal.kind) ? (
            <ArtifactForm
              kind={modal.kind}
              initial={modal.initial}
              users={users}
              user={user}
              api={api}
              onSave={saved}
              onCancel={() => setModal(null)}
            />
          ) : modal.kind === "team" ? (
            <>
              <div className="eyebrow">BETTER, TOGETHER</div>
              <h2>The minds behind the mix.</h2>
              <p className="modal-description">
                One workspace. A whole world of perspectives.
              </p>
              <div className="team-list">
                {users.map((u) => (
                  <div className="team-member" key={u.id}>
                    <Avatar name={u.name} />
                    <div>
                      <strong>
                        {u.name}
                        {u.id === user.id && (
                          <span className="you-label">you</span>
                        )}
                      </strong>
                      <small>{u.email}</small>
                    </div>
                    <span className="member-role">Teammate</span>
                  </div>
                ))}
              </div>
              <div className="form-note">
                <Users size={16} />
                New teammates can join using “Create an account” on the sign-in
                screen. This MVP uses one shared workspace.
              </div>
            </>
          ) : modal.kind === "settings" ? (
            <>
              <div className="eyebrow">MAKE YOURSELF AT HOME</div>
              <h2>Your little corner.</h2>
              <div className="settings-profile">
                <Avatar name={user.name} />
                <div>
                  <strong>{user.name}</strong>
                  <p>{user.email}</p>
                </div>
              </div>
              <div className="settings-status">
                <span className="status-dot" />
                <strong>
                  {health?.mode === "openai"
                    ? "OpenAI is connected"
                    : "You’re exploring demo mode"}
                </strong>
              </div>
              <p className="modal-description">
                {health?.mode === "openai"
                  ? "Chat uses live AI and semantic embeddings. Cortex only sends artifacts you can access."
                  : "Demo chat quotes your saved artifacts with a fixed next-step suggestion. Search uses local keyword similarity. Your data, sharing, and handoffs work fully."}
              </p>
              <div className="form-note">
                <Settings2 size={18} />
                For live AI, set LLM_PROVIDER=openai and CORTEX_AI_API_KEY in
                the server environment, then restart the API. Keep keys on the
                server.
              </div>
            </>
          ) : (
            <>
              <div className="about-logo">
                <Logo />
              </div>
              <div className="eyebrow">YOUR TEAM’S SECOND BRAIN</div>
              <h2>Great minds don’t think alone.</h2>
              <p className="modal-description">
                Cortex gives your team’s thinking a place to live — and your
                personal AI a little more perspective.
              </p>
              <div className="about-steps">
                <div>
                  <span>01</span>
                  <div>
                    <strong>Think out loud.</strong>
                    <p>
                      Bring a question to My Agent. Your private conversation
                      starts there.
                    </p>
                  </div>
                </div>
                <div>
                  <span>02</span>
                  <div>
                    <strong>Keep the good bits.</strong>
                    <p>
                      Save useful responses as notes, ideas, specs, or handoffs.
                    </p>
                  </div>
                </div>
                <div>
                  <span>03</span>
                  <div>
                    <strong>Let ideas travel.</strong>
                    <p>
                      Share with a teammate or your whole team. Assigned
                      handoffs carry the context forward.
                    </p>
                  </div>
                </div>
              </div>
              <div className="form-note">
                <LockKeyhole size={17} />
                Private means private. Every search, source, and conversation
                respects your artifact permissions.
              </div>
            </>
          )}
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
        </div>
      )}
    </div>
  );
}
function RichText({ text }) {
  return (
    <div className="rich-text">
      {text.split("\n").map((line, i) =>
        line.startsWith("### ") ? (
          <h3 key={i}>{line.slice(4)}</h3>
        ) : line.startsWith("## ") ? (
          <h3 key={i}>{line.slice(3)}</h3>
        ) : line.startsWith("# ") ? (
          <h3 key={i}>{line.slice(2)}</h3>
        ) : line.startsWith("_") && line.endsWith("_") ? (
          <p key={i} className="demo-disclosure">
            {line.slice(1, -1)}
          </p>
        ) : line ? (
          <p key={i}>
            {line
              .split(/(\*\*.*?\*\*)/g)
              .map((part, j) =>
                part.startsWith("**") ? (
                  <strong key={j}>{part.slice(2, -2)}</strong>
                ) : (
                  part
                ),
              )}
          </p>
        ) : (
          <div key={i} className="text-break" />
        ),
      )}
    </div>
  );
}
function ArtifactCard({ a, user, onClick }) {
  const Icon = icons[a.type];
  return (
    <button className={`artifact-card artifact-${a.type}`} onClick={onClick}>
      <div className="artifact-card-top">
        <span className={`file-icon ${a.type}`}>
          <Icon size={19} />
        </span>
        <Visibility value={a.visibility} />
      </div>
      <span className="artifact-type">{typeName[a.type]}</span>
      <h2>{a.title}</h2>
      <p>{a.content.replace(/\n/g, " ").slice(0, 150)}</p>
      <div className="artifact-tags">
        {a.tags.slice(0, 3).map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
      {a.assigned_to_name && (
        <div className="assigned-label">
          <ArrowUpRight size={13} />
          With{" "}
          {a.assigned_to_user_id === user.id
            ? "you"
            : a.assigned_to_name.split(" ")[0]}{" "}
          for the next step
        </div>
      )}
      <div className="artifact-card-footer">
        <span>
          <Avatar name={a.owner_name} size="tiny" />
          {a.owner_user_id === user.id ? "You" : a.owner_name.split(" ")[0]}
        </span>
        <span>
          {relative(a.updated_at)}
          <ArrowUpRight size={13} />
        </span>
      </div>
    </button>
  );
}
function Modal({ children, onClose, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.focus();
    const handler = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const items = [
          ...ref.current.querySelectorAll(
            'button,input,textarea,select,[tabindex="0"]',
          ),
        ].filter((el) => !el.disabled);
        const first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        ref={ref}
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Cortex workspace dialog"
        tabIndex={-1}
      >
        <IconButton
          label="Close dialog"
          onClick={onClose}
          className="icon-button modal-close"
        >
          <X size={20} />
        </IconButton>
        {children}
      </section>
    </div>
  );
}
function ArtifactForm({
  kind,
  initial = {},
  users,
  user,
  api,
  onSave,
  onCancel,
}) {
  const [form, setForm] = useState({
    title: "",
    content: "",
    type: "note",
    visibility: "private",
    tags: [],
    shared_with_user_ids: initial.shared_with?.map((u) => u.user_id) || [],
    assigned_to_user_id: null,
    ...initial,
  });
  const [tags, setTags] = useState((initial.tags || []).join(", ")),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const sharing = kind === "share",
    editing = kind === "edit",
    owner = !editing || initial.owner_user_id === user.id;
  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }
  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const body = sharing
        ? {
            visibility: form.visibility,
            shared_with_user_ids: form.shared_with_user_ids,
          }
        : editing
          ? {
              title: form.title,
              content: form.content,
              type: form.type,
              tags: tags
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean),
              assigned_to_user_id:
                form.type === "handoff" ? form.assigned_to_user_id : null,
            }
          : {
              title: form.title,
              content: form.content,
              type: form.type,
              visibility: form.visibility,
              tags: tags
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean),
              shared_with_user_ids: form.shared_with_user_ids,
              assigned_to_user_id:
                form.type === "handoff" ? form.assigned_to_user_id : null,
            };
      const data = await api(
        "/api/artifacts" +
          (editing || sharing ? "/" + initial.id : "") +
          (sharing ? "/share" : ""),
        { method: editing || sharing ? "PATCH" : "POST", body },
      );
      onSave(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <div className="eyebrow">
        {sharing
          ? "GIVE YOUR THINKING SOME COMPANY"
          : editing
            ? "GOOD IDEAS KEEP GROWING"
            : "A THOUGHT WORTH KEEPING"}
      </div>
      <h2>
        {sharing
          ? "Let the right minds in."
          : editing
            ? "A little more refined."
            : "Add something to the mix."}
      </h2>
      <p className="modal-description">
        {sharing
          ? `Choose who can access “${initial.title}”.`
          : "Notes, ideas, and handoffs. A home for whatever comes next."}
      </p>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      {!sharing && (
        <>
          <label className="field">
            Give it a name
            <input
              required
              maxLength={180}
              placeholder="A little context goes a long way…"
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
            />
          </label>
          <label className="field">
            The thinking behind it
            <textarea
              required
              maxLength={24000}
              rows={7}
              placeholder="Make room for your idea."
              value={form.content}
              onChange={(e) => set("content", e.target.value)}
            />
          </label>
          <div className="field-row">
            <label className="field">
              Kind of thought
              <select
                value={form.type}
                disabled={!owner}
                onChange={(e) => set("type", e.target.value)}
              >
                {Object.entries(typeName).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Tags <span className="optional">optional</span>
              <input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="product, inspiration"
                maxLength={400}
              />
            </label>
          </div>
        </>
      )}
      {!editing && (
        <>
          <label className="field">
            Who’s in the loop?
            <select
              value={form.visibility}
              onChange={(e) => set("visibility", e.target.value)}
            >
              <option value="private">Only me — private thinking</option>
              <option value="shared_with">
                Specific teammates — a smaller circle
              </option>
              <option value="team">The whole team — shared knowledge</option>
            </select>
          </label>
          {form.visibility === "shared_with" && (
            <div className="share-users">
              {users
                .filter((u) => u.id !== user.id)
                .map((u) => (
                  <label key={u.id}>
                    <input
                      type="checkbox"
                      checked={form.shared_with_user_ids.includes(u.id)}
                      onChange={(e) =>
                        set(
                          "shared_with_user_ids",
                          e.target.checked
                            ? [...form.shared_with_user_ids, u.id]
                            : form.shared_with_user_ids.filter(
                                (id) => id !== u.id,
                              ),
                        )
                      }
                    />
                    <Avatar name={u.name} size="tiny" />
                    {u.name}
                  </label>
                ))}
            </div>
          )}
        </>
      )}
      {form.type === "handoff" && !sharing && (
        <label className="field">
          Pass the baton to
          <select
            disabled={!owner}
            value={form.assigned_to_user_id || ""}
            onChange={(e) => {
              const id = e.target.value || null;
              setForm((f) => ({
                ...f,
                assigned_to_user_id: id,
                ...(!editing && id && id !== user.id
                  ? {
                      visibility:
                        f.visibility === "private"
                          ? "shared_with"
                          : f.visibility,
                      shared_with_user_ids: [
                        ...new Set([...f.shared_with_user_ids, id]),
                      ],
                    }
                  : {}),
              }));
            }}
          >
            <option value="">No assignee yet</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
                {u.id === user.id ? " (you)" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="form-note">
        <LockKeyhole size={14} />
        {editing
          ? "Content changes update the context your teammates can use."
          : form.visibility === "private"
            ? "A private thought. Just for you and your agent."
            : form.visibility === "team"
              ? "Every person in this workspace can read and use this artifact."
              : "Only you and the teammates you choose can access this artifact."}
      </div>
      <div className="form-actions">
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button className="button primary" disabled={busy}>
          {busy ? <Spinner /> : <Check size={15} />}{" "}
          {sharing
            ? "Update sharing"
            : editing
              ? "Save changes"
              : "Save artifact"}
        </button>
      </div>
    </form>
  );
}
function Detail({ artifact: a, user, api, onClose, onEdit, onShare, onChat }) {
  const [comments, setComments] = useState([]),
    [comment, setComment] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const Icon = icons[a.type];
  useEffect(() => {
    api("/api/artifacts/" + a.id + "/comments")
      .then(setComments)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [a.id]);
  async function add(e) {
    e.preventDefault();
    if (!comment.trim()) return;
    setBusy(true);
    setError("");
    try {
      const c = await api("/api/artifacts/" + a.id + "/comments", {
        method: "POST",
        body: { content: comment },
      });
      setComments((v) => [...v, c]);
      setComment("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal wide onClose={onClose}>
      <div className="detail-top">
        <span className={`file-icon ${a.type}`}>
          <Icon size={20} />
        </span>
        <span className="artifact-type">{typeName[a.type]}</span>
        <Visibility value={a.visibility} />
      </div>
      <h2 className="detail-title">{a.title}</h2>
      <div className="detail-meta">
        <Avatar name={a.owner_name} size="tiny" />
        {a.owner_name}
        <span>·</span>Updated {relative(a.updated_at)}
      </div>
      <div className="detail-tags">
        {a.tags.map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
      {a.assigned_to_name && (
        <div className="handoff-banner">
          <ArrowUpRight size={18} />
          <span>
            A next step for{" "}
            <strong>
              {a.assigned_to_user_id === user.id ? "you" : a.assigned_to_name}
            </strong>
            <small>The assignee can edit this handoff’s content.</small>
          </span>
        </div>
      )}
      <div className="detail-content">
        <RichText text={a.content} />
      </div>
      <div className="detail-access">
        <Visibility value={a.visibility} />
        <span>
          {a.visibility === "private"
            ? "Visible only to you."
            : a.visibility === "team"
              ? "Visible to all team members."
              : "Shared with " +
                (a.shared_with.map((p) => p.name).join(", ") ||
                  "no teammates yet") +
                "."}
        </span>
      </div>
      <div className="detail-actions">
        <button className="button primary" onClick={onChat}>
          <MessageSquare size={15} />
          Open in chat
          <ArrowUpRight size={13} />
        </button>
        {a.can_edit && (
          <button className="button secondary" onClick={onEdit}>
            Edit artifact
          </button>
        )}
        {a.can_share && (
          <button className="button secondary" onClick={onShare}>
            <Users size={14} />
            Sharing
          </button>
        )}
      </div>
      <section className="comments">
        <h3>
          Around this thought <span>{comments.length}</span>
        </h3>
        {loading ? (
          <Spinner />
        ) : (
          comments.map((c) => (
            <div className="comment" key={c.id}>
              <Avatar name={c.author_name} size="tiny" />
              <div>
                <strong>
                  {c.author_name}
                  <small>{relative(c.created_at)}</small>
                </strong>
                <p>{c.content}</p>
              </div>
            </div>
          ))
        )}
        {!loading && !comments.length && (
          <p className="no-comments">
            A little perspective? Start the conversation.
          </p>
        )}
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <form onSubmit={add} className="comment-form">
          <textarea
            aria-label="Add a comment"
            placeholder="Add your perspective…"
            maxLength={5000}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
          />
          <button className="button primary" disabled={!comment.trim() || busy}>
            {busy ? <Spinner /> : <Send size={14} />}Add comment
          </button>
        </form>
      </section>
    </Modal>
  );
}
function Auth({ api, health, onAuth }) {
  const [signup, setSignup] = useState(false),
    [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function login(e, demo) {
    e?.preventDefault();
    setBusy(true);
    setError("");
    try {
      onAuth(
        await api(signup && !demo ? "/auth/signup" : "/auth/login", {
          method: "POST",
          body: demo
            ? { email: demo, password: "CortexDemo2026!" }
            : { name, email, password },
        }),
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <div className="auth-story">
        <Logo />
        <div className="auth-story-main">
          <div className="eyebrow">A LITTLE MORE CONNECTED</div>
          <h1>
            Great minds
            <br />
            don’t think
            <br />
            <em>alone.</em>
          </h1>
          <p>
            A home for your team’s knowledge.
            <br />A little space for your next big thought.
          </p>
          <div className="auth-orbits">
            <span />
            <span />
            <span />
            <Logo small />
          </div>
        </div>
        <span className="auth-tagline">
          <span className="status-dot" />
          Your team’s second brain.
        </span>
      </div>
      <section className="auth-form-section">
        <div className="auth-form">
          <div className="eyebrow">YOUR THOUGHTS BELONG HERE</div>
          <h2>
            {signup ? "A fresh perspective." : "Welcome to your headspace."}
          </h2>
          <p>
            {signup
              ? "A little introduction, then let’s get thinking."
              : "Good to have you here. Let’s connect a few dots."}
          </p>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <form onSubmit={login}>
            {signup && (
              <label className="field">
                Your name
                <input
                  required
                  minLength={2}
                  maxLength={80}
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Alex Morgan"
                />
              </label>
            )}
            <label className="field">
              Email address
              <input
                required
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@yourteam.com"
              />
            </label>
            <label className="field">
              Password
              <input
                required
                type="password"
                autoComplete={signup ? "new-password" : "current-password"}
                minLength={signup ? 10 : 1}
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={
                  signup ? "At least 10 characters" : "Your password"
                }
              />
            </label>
            <button className="button primary auth-submit" disabled={busy}>
              {busy ? (
                <Spinner />
              ) : signup ? (
                "Create your account"
              ) : (
                "Step inside"
              )}
              <ArrowRight size={16} />
            </button>
          </form>
          <p className="auth-switch">
            {signup ? "Already part of the thinking?" : "New around here?"}{" "}
            <button
              onClick={() => {
                setSignup(!signup);
                setError("");
              }}
            >
              {signup ? "Sign in" : "Create an account"}
            </button>
          </p>
          {health?.demo && (
            <>
              <div className="auth-divider">
                <span>OR TAKE A LOOK AROUND</span>
              </div>
              <div className="demo-accounts">
                <p>
                  A real workspace, with a little example thinking.
                  <br />
                  Choose a perspective to explore:
                </p>
                <div>
                  {[
                    ["Alex Morgan", "alex"],
                    ["Jamie Chen", "jamie"],
                  ].map(([n, id]) => (
                    <button
                      key={id}
                      disabled={busy}
                      onClick={() => login(null, id + "@cortex.demo")}
                    >
                      <Avatar name={n} />
                      <span>
                        Explore as {n.split(" ")[0]}
                        <small>
                          {id === "alex"
                            ? "Product & possibilities"
                            : "Research & handoffs"}
                        </small>
                      </span>
                      <ArrowUpRight size={15} />
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
          <div className="auth-privacy">
            <LockKeyhole size={12} />A private space. A shared possibility.
          </div>
        </div>
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
