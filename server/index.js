import express from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { randomUUID, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  openDb,
  hashPassword,
  checkPassword,
  seedDemo,
  recordActivity,
  backfillActivity,
} from "./db.js";
import { localVector, embed, cosine, answer, isLive } from "./ai.js";
import { initializeOrgOwners, defaultIntent, intents } from "./memory-db.js";
import { createMemory } from "./memory.js";
import { registerMemoryRoutes } from "./memory-routes.js";
import { registerPhaseTwo } from "./phase-two.js";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (existsSync(resolve(root, ".env")))
  process.loadEnvFile(resolve(root, ".env"));
const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role || "other",
  org_id: u.org_id,
});
const types = [
  "note",
  "idea",
  "spec",
  "code_snippet",
  "handoff",
  "other",
  "decision",
];
const visibility = z.enum(["private", "shared_with", "team"]);
const fields = {
  title: z.string().trim().min(1).max(180),
  content: z.string().trim().min(1).max(24000),
  type: z.enum(types),
  intent: z.enum(intents).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(12),
  assigned_to_user_id: z.string().max(100).nullable(),
};
const createSchema = z.object({
  ...fields,
  visibility,
  tags: fields.tags.default([]),
  assigned_to_user_id: fields.assigned_to_user_id.default(null),
  shared_with_user_ids: z.array(z.string().max(100)).max(100).default([]),
  source_artifact_ids: z.array(z.string().min(1)).max(12).default([]),
});
const accessSQL = `(a.org_id=(SELECT org_id FROM users WHERE id=?) AND (a.owner_user_id=? OR a.visibility='team' OR (a.visibility='shared_with' AND EXISTS (SELECT 1 FROM artifact_permissions p WHERE p.artifact_id=a.id AND p.user_id=?))))`;
export function createApp({
  dbPath = resolve(root, "data/cortex.sqlite"),
  secret,
  seed = process.env.SEED_DEMO === "true" ||
    (process.env.NODE_ENV !== "production" &&
      process.env.SEED_DEMO !== "false"),
} = {}) {
  const db = openDb(dbPath);
  if (!secret) {
    if (process.env.JWT_SECRET) secret = process.env.JWT_SECRET;
    else if (dbPath === ":memory:") secret = randomBytes(48).toString("hex");
    else {
      const keyPath = resolve(dirname(dbPath), ".jwt-secret");
      mkdirSync(dirname(keyPath), { recursive: true });
      if (!existsSync(keyPath))
        writeFileSync(keyPath, randomBytes(48).toString("hex"), {
          mode: 0o600,
        });
      secret = readFileSync(keyPath, "utf8");
    }
  }
  if (seed) seedDemo(db, localVector);
  backfillActivity(db);
  initializeOrgOwners(db);
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "128kb" }));
  app.use((req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Referrer-Policy", "same-origin");
    next();
  });
  const token = (u) =>
    jwt.sign({ sub: u.id }, secret, { expiresIn: "7d", algorithm: "HS256" });
  const auth = (req, res, next) => {
    try {
      const t = req.headers.authorization?.split(" ");
      if (t?.[0] !== "Bearer") throw Error();
      const payload = jwt.verify(t[1], secret, { algorithms: ["HS256"] });
      req.user = db.prepare("SELECT * FROM users WHERE id=?").get(payload.sub);
      if (!req.user) throw Error();
      next();
    } catch {
      res.status(401).json({ message: "Please sign in to continue." });
    }
  };
  const attempts = new Map();
  const rateLimit = (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    const state = attempts.get(key);
    if (attempts.size > 10000) attempts.clear();
    if (!state || now - state.since > 60000)
      attempts.set(key, { since: now, count: 1 });
    else if (++state.count > 30)
      return res
        .status(429)
        .json({ message: "Too many attempts. Try again in a minute." });
    next();
  };
  app.get("/api/health", (_, res) =>
    res.json({ status: "ok", mode: isLive() ? "openai" : "demo", demo: seed }),
  );
  app.post("/auth/signup", rateLimit, (req, res) => {
    const input = z
      .object({
        name: z.string().trim().min(2).max(80),
        email: z.string().trim().email().max(200),
        password: z.string().min(10).max(128),
      })
      .parse(req.body);
    input.email = input.email.toLowerCase();
    if (db.prepare("SELECT id FROM users WHERE email=?").get(input.email))
      return res
        .status(409)
        .json({ message: "An account with that email already exists." });
    const u = { id: randomUUID(), ...input };
    db.prepare(
      "INSERT INTO users (id,name,email,password_hash) VALUES (?,?,?,?)",
    ).run(u.id, u.name, u.email, hashPassword(input.password));
    initializeOrgOwners(db);
    const createdUser = db.prepare("SELECT * FROM users WHERE id=?").get(u.id);
    res.status(201).json({ user: publicUser(createdUser), token: token(u) });
  });
  app.post("/auth/login", rateLimit, (req, res) => {
    const input = z
      .object({
        email: z.string().trim().email().max(200),
        password: z.string().min(1).max(128),
      })
      .parse(req.body);
    const u = db
      .prepare("SELECT * FROM users WHERE email=?")
      .get(input.email.toLowerCase());
    if (!u || !checkPassword(input.password, u.password_hash))
      return res
        .status(401)
        .json({ message: "That email and password don’t match." });
    res.json({ user: publicUser(u), token: token(u) });
  });
  app.use("/api", auth);
  app.get("/api/me", (req, res) => res.json(publicUser(req.user)));
  app.get("/api/users", (req, res) =>
    res.json(
      db
        .prepare(
          "SELECT id,name,email,role FROM users WHERE org_id=? ORDER BY name",
        )
        .all(req.user.org_id),
    ),
  );
  function serialize(a, uid) {
    const permissions = db
      .prepare(
        "SELECT p.user_id,p.access_level,u.name FROM artifact_permissions p JOIN users u ON u.id=p.user_id WHERE artifact_id=?",
      )
      .all(a.id);
    return {
      ...a,
      tags: JSON.parse(a.tags),
      shared_with: permissions,
      can_edit:
        a.owner_user_id === uid ||
        (a.type === "handoff" && a.assigned_to_user_id === uid) ||
        permissions.some(
          (p) => p.user_id === uid && p.access_level === "write",
        ),
      can_share: a.owner_user_id === uid,
    };
  }
  function accessible(id, uid) {
    const a = db
      .prepare(
        `SELECT a.*,u.name AS owner_name, assignee.name AS assigned_to_name FROM artifacts a JOIN users u ON a.owner_user_id=u.id LEFT JOIN users assignee ON a.assigned_to_user_id=assignee.id WHERE a.id=? AND ${accessSQL}`,
      )
      .get(id, uid, uid, uid);
    if (!a)
      throw Object.assign(Error("This artifact isn’t available to you."), {
        status: 404,
      });
    return serialize(a, uid);
  }
  function list(uid, scope, owner, search, filters = {}) {
    let sql = `SELECT a.*,u.name AS owner_name,assignee.name AS assigned_to_name FROM artifacts a JOIN users u ON a.owner_user_id=u.id LEFT JOIN users assignee ON a.assigned_to_user_id=assignee.id WHERE ${accessSQL}`;
    const params = [uid, uid, uid];
    if (!filters.includeArchived) sql += " AND a.status='active'";
    if (filters.intent) {
      sql += " AND a.intent=?";
      params.push(filters.intent);
    }
    if (filters.type) {
      sql += " AND a.type=?";
      params.push(filters.type);
    }
    if (filters.tag) {
      sql +=
        " AND EXISTS(SELECT 1 FROM json_each(a.tags) WHERE lower(value)=lower(?))";
      params.push(filters.tag);
    }
    if (scope === "my") {
      sql += " AND a.owner_user_id=?";
      params.push(uid);
    }
    if (scope === "team") sql += " AND a.visibility='team'";
    if (scope === "shared_with_me") {
      sql +=
        " AND a.visibility='shared_with' AND EXISTS(SELECT 1 FROM artifact_permissions p WHERE p.artifact_id=a.id AND p.user_id=?)";
      params.push(uid);
    }
    if (scope === "assigned_to_me") {
      sql += " AND a.assigned_to_user_id=?";
      params.push(uid);
    }
    if (owner) {
      sql += " AND a.owner_user_id=?";
      params.push(owner);
    }
    if (search) {
      sql +=
        " AND (a.title LIKE ? ESCAPE '\\' OR a.content LIKE ? ESCAPE '\\')";
      const pattern = "%" + search.replace(/[\\%_]/g, "\\$&") + "%";
      params.push(pattern, pattern);
    }
    sql += " ORDER BY a.updated_at DESC";
    return db
      .prepare(sql)
      .all(...params)
      .map((a) => serialize(a, uid));
  }
  const scopeSchema = z.enum([
    "all",
    "my",
    "shared_with_me",
    "team",
    "assigned_to_me",
  ]);
  app.get("/api/artifacts", (req, res) => {
    const q = z
      .object({
        scope: scopeSchema.default("all"),
        owner_user_id: z.string().optional(),
        search: z.string().max(200).optional(),
        intent: z.enum(intents).optional(),
        type: z.enum(types).optional(),
        tag: z.string().max(40).optional(),
      })
      .parse(req.query);
    res.json(list(req.user.id, q.scope, q.owner_user_id, q.search, q));
  });
  function ensureUsers(ids, org) {
    for (const id of ids) {
      if (
        org &&
        db.prepare("SELECT org_id FROM users WHERE id=?").get(id)?.org_id !==
          org
      )
        throw Object.assign(Error("Choose teammates in your organization."), {
          status: 400,
        });
      if (!db.prepare("SELECT id FROM users WHERE id=?").get(id))
        throw Object.assign(
          Error("One of the selected teammates no longer exists."),
          { status: 400 },
        );
    }
  }
  function validateAssignment(a, shared) {
    if (a.assigned_to_user_id && a.type !== "handoff")
      throw Object.assign(Error("Only handoffs can have an assignee."), {
        status: 400,
      });
    if (
      a.assigned_to_user_id &&
      a.assigned_to_user_id !== a.owner_user_id &&
      (a.visibility === "private" ||
        (a.visibility === "shared_with" &&
          !shared.includes(a.assigned_to_user_id)))
    )
      throw Object.assign(
        Error("Share the handoff with its assignee so they can access it."),
        { status: 400 },
      );
  }
  function storeVector(a, e) {
    db.prepare("INSERT OR REPLACE INTO embeddings VALUES (?,?,?,?,?)").run(
      a.id,
      a.owner_user_id,
      a.visibility,
      e.model,
      JSON.stringify(e.vector),
    );
  }
  function transaction(fn) {
    db.exec("BEGIN");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  async function createArtifact(userId, body) {
    const input = createSchema.parse(body),
      a = { id: randomUUID(), owner_user_id: userId, ...input };
    ensureUsers([
      ...input.shared_with_user_ids,
      ...(a.assigned_to_user_id ? [a.assigned_to_user_id] : []),
    ]);
    const organization = db
      .prepare("SELECT org_id FROM users WHERE id=?")
      .get(userId).org_id;
    for (const id of [
      ...input.shared_with_user_ids,
      ...(a.assigned_to_user_id ? [a.assigned_to_user_id] : []),
    ]) {
      if (
        db.prepare("SELECT org_id FROM users WHERE id=?").get(id)?.org_id !==
        organization
      )
        throw Object.assign(Error("Choose teammates in your organization."), {
          status: 400,
        });
    }
    a.intent = input.intent || defaultIntent(a.type);
    validateAssignment(a, input.shared_with_user_ids);
    const sources = [...new Set(input.source_artifact_ids)].map((id) =>
      accessible(id, userId),
    );
    const vector = await embed(a.title + " " + a.content);
    for (const source of sources) accessible(source.id, userId);
    transaction(() => {
      db.prepare(
        "INSERT INTO artifacts (id,owner_user_id,title,content,type,visibility,tags,assigned_to_user_id) VALUES (?,?,?,?,?,?,?,?)",
      ).run(
        a.id,
        a.owner_user_id,
        a.title,
        a.content,
        a.type,
        a.visibility,
        JSON.stringify(a.tags),
        a.assigned_to_user_id,
      );
      if (a.visibility === "shared_with")
        for (const uid of new Set(input.shared_with_user_ids))
          db.prepare(
            "INSERT INTO artifact_permissions (id,artifact_id,user_id) VALUES (?,?,?)",
          ).run(randomUUID(), a.id, uid);
      db.prepare(
        "UPDATE artifacts SET org_id=?,intent=?,steward_user_id=?,decided_by_user_id=?,decided_at=? WHERE id=?",
      ).run(
        organization,
        a.intent,
        userId,
        a.type === "decision" ? userId : null,
        a.type === "decision" ? new Date().toISOString() : null,
        a.id,
      );
      for (const source of sources) {
        const current = accessible(source.id, userId);
        db.prepare("INSERT INTO artifact_links VALUES (?,?,?,?,?,?,?)").run(
          randomUUID(),
          a.id,
          source.id,
          "supports",
          JSON.stringify({
            title: current.title,
            content: current.content,
            updated_at: current.updated_at,
          }),
          userId,
          new Date().toISOString(),
        );
      }
      storeVector(a, vector);
      recordActivity(db, "artifact_created", a.id, userId);
    });
    return accessible(a.id, userId);
  }
  app.post("/api/artifacts", async (req, res) => {
    res.status(201).json(await createArtifact(req.user.id, req.body));
  });
  app.get("/api/artifacts/:id", (req, res) => {
    const a = accessible(req.params.id, req.user.id);
    db.prepare(
      "INSERT INTO artifact_views VALUES (?,?,?) ON CONFLICT(artifact_id,user_id) DO UPDATE SET last_viewed_at=excluded.last_viewed_at",
    ).run(a.id, req.user.id, new Date().toISOString());
    res.json(a);
  });
  app.patch("/api/artifacts/:id", async (req, res) => {
    const input = z.object(fields).partial().strict().parse(req.body),
      a = accessible(req.params.id, req.user.id);
    if (!a.can_edit)
      return res.status(403).json({
        message: "Only the owner or handoff assignee can edit this artifact.",
      });
    if (
      a.owner_user_id !== req.user.id &&
      ((input.assigned_to_user_id !== undefined &&
        input.assigned_to_user_id !== a.assigned_to_user_id) ||
        (input.type !== undefined && input.type !== a.type))
    )
      return res
        .status(403)
        .json({ message: "Only the owner can change the type or assignment." });
    let merged = { ...a, ...input };
    ensureUsers(
      merged.assigned_to_user_id ? [merged.assigned_to_user_id] : [],
      a.org_id,
    );
    validateAssignment(
      merged,
      a.shared_with.map((p) => p.user_id),
    );
    const vector = await embed(merged.title + " " + merged.content);
    // Provider calls yield: check permissions again before committing.
    const current = accessible(a.id, req.user.id);
    if (!current.can_edit)
      return res.status(403).json({ message: "Your edit access has changed." });
    if (current.updated_at !== a.updated_at)
      return res.status(409).json({
        message:
          "This artifact changed while you were editing. Reopen it and try again.",
      });
    merged = { ...current, ...input };
    validateAssignment(
      merged,
      current.shared_with.map((p) => p.user_id),
    );
    transaction(() => {
      db.prepare(
        "UPDATE artifacts SET title=?,content=?,type=?,tags=?,assigned_to_user_id=?,updated_at=? WHERE id=?",
      ).run(
        merged.title,
        merged.content,
        merged.type,
        JSON.stringify(merged.tags),
        merged.assigned_to_user_id,
        new Date().toISOString(),
        a.id,
      );
      db.prepare("UPDATE artifacts SET intent=? WHERE id=?").run(
        merged.intent,
        a.id,
      );
      storeVector(merged, vector);
      recordActivity(db, "artifact_updated", a.id, req.user.id);
    });
    res.json(accessible(a.id, req.user.id));
  });
  app.patch("/api/artifacts/:id/share", (req, res) => {
    const input = z
        .object({
          visibility,
          shared_with_user_ids: z.array(z.string()).max(100).default([]),
        })
        .parse(req.body),
      a = accessible(req.params.id, req.user.id);
    if (!a.can_share)
      return res
        .status(403)
        .json({ message: "Only the owner can change sharing." });
    ensureUsers(input.shared_with_user_ids, a.org_id);
    validateAssignment(
      { ...a, visibility: input.visibility },
      input.shared_with_user_ids,
    );
    transaction(() => {
      db.prepare(
        "UPDATE artifacts SET visibility=?,updated_at=? WHERE id=?",
      ).run(input.visibility, new Date().toISOString(), a.id);
      db.prepare("DELETE FROM artifact_permissions WHERE artifact_id=?").run(
        a.id,
      );
      if (input.visibility === "shared_with")
        for (const uid of new Set(input.shared_with_user_ids))
          db.prepare(
            "INSERT INTO artifact_permissions (id,artifact_id,user_id) VALUES (?,?,?)",
          ).run(randomUUID(), a.id, uid);
      db.prepare("UPDATE embeddings SET visibility=? WHERE artifact_id=?").run(
        input.visibility,
        a.id,
      );
      recordActivity(db, "artifact_updated", a.id, req.user.id);
    });
    res.json(accessible(a.id, req.user.id));
  });
  app.get("/api/artifacts/:id/comments", (req, res) => {
    accessible(req.params.id, req.user.id);
    res.json(
      db
        .prepare(
          "SELECT c.*,u.name AS author_name FROM comments c JOIN users u ON u.id=c.author_user_id WHERE artifact_id=? ORDER BY c.created_at,c.rowid",
        )
        .all(req.params.id),
    );
  });
  app.post("/api/artifacts/:id/comments", (req, res) => {
    accessible(req.params.id, req.user.id);
    const { content } = z
      .object({ content: z.string().trim().min(1).max(5000) })
      .parse(req.body);
    const id = randomUUID();
    transaction(() => {
      db.prepare(
        "INSERT INTO comments (id,artifact_id,author_user_id,content) VALUES (?,?,?,?)",
      ).run(id, req.params.id, req.user.id, content);
      recordActivity(
        db,
        "artifact_commented",
        req.params.id,
        req.user.id,
        "comment:" + id,
      );
    });
    res.status(201).json({
      id,
      content,
      author_name: req.user.name,
      author_user_id: req.user.id,
      created_at: new Date().toISOString(),
    });
  });
  async function search(uid, query, scope, owner, limit = 8, filters = {}) {
    const candidates = list(uid, scope, owner, undefined, filters);
    if (!candidates.length) return [];
    const q = await embed(query);
    const ranked = [];
    for (const a of candidates) {
      let stored = db
        .prepare("SELECT model,vector FROM embeddings WHERE artifact_id=?")
        .get(a.id);
      if (!stored || stored.model !== q.model) {
        const e = await embed(a.title + " " + a.content);
        storeVector(a, e);
        stored = { model: e.model, vector: JSON.stringify(e.vector) };
      }
      const score = cosine(q.vector, JSON.parse(stored.vector));
      ranked.push({ ...a, score, snippet: a.content.slice(0, 220) });
    }
    // Recheck after asynchronous model calls so revoked permissions cannot leak.
    return ranked
      .filter((a) => {
        try {
          accessible(a.id, uid);
          return true;
        } catch {
          return false;
        }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
  app.post("/api/search/artifacts", async (req, res) => {
    const q = z
      .object({
        query: z.string().trim().min(1).max(1000),
        scope: scopeSchema.default("all"),
        intent: z.enum(intents).optional(),
        type: z.enum(types).optional(),
        tag: z.string().max(40).optional(),
        owner_user_id: z.string().optional(),
      })
      .parse(req.body);
    res.json(
      await search(req.user.id, q.query, q.scope, q.owner_user_id, 8, q),
    );
  });
  const memory = createMemory({ db, accessible, list, search, transaction });
  registerMemoryRoutes({
    app,
    db,
    accessible,
    list,
    search,
    transaction,
    memory,
  });
  app.post("/api/agent/chat", async (req, res) => {
    const q = z
      .object({
        message: z.string().trim().min(1).max(8000),
        intent: z.enum(intents).default("brainstorm"),
        context_budget: z.number().int().min(256).max(8000).default(2400),
        artifact_id: z.string().optional(),
        history: z
          .array(
            z.object({
              role: z.enum(["user", "assistant"]),
              content: z.string().max(16000),
            }),
          )
          .max(12)
          .default([]),
      })
      .parse(req.body);
    const { owner, primary } = memory.resolveQuery(
      req.user,
      q.message,
      q.artifact_id,
    );
    const vocabulary = memory.vocabulary(req.user);
    const normalized = memory.normalize(q.message, vocabulary);
    const selection = await memory.selectContext(req.user, normalized, {
      owner,
      primaryId: primary?.id,
      intent: q.intent,
      budget: q.context_budget,
    });
    const artifacts = selection.artifacts.map((a) => ({
      ...accessible(a.id, req.user.id),
      content: a.content,
    }));
    const history = q.history
      .slice(-6)
      .map((h) => ({ ...h, content: h.content.slice(0, 3000) }));
    const response = memory.denormalize(
      await answer(normalized, artifacts, history, req.user.role, {
        intent: q.intent,
        style: memory.personalStyle(req.user),
        vocabulary,
      }),
      vocabulary,
    );
    for (const a of artifacts) accessible(a.id, req.user.id);
    const answerId = memory.recordAnswer(
      req.user,
      artifacts,
      response,
      q.intent,
    );
    res.json({
      answer: response,
      answer_id: answerId,
      intent: q.intent,
      context_budget: selection.budget,
      context_tokens: selection.tokens,
      used_artifacts: artifacts.map((a) => ({
        id: a.id,
        title: a.title,
        owner_user_id: a.owner_user_id,
        owner_name: a.owner_name,
      })),
      mode: isLive() ? "openai" : "demo",
    });
  });
  registerPhaseTwo({
    app,
    db,
    accessible,
    list,
    search,
    createArtifact,
    publicUser,
    accessSQL,
  });
  if (process.env.NODE_ENV === "production") {
    app.use(express.static(resolve(root, "dist")));
    app.get("/{*path}", (req, res, next) => {
      if (req.path.startsWith("/api") || req.path.startsWith("/auth"))
        return next();
      res.sendFile(resolve(root, "dist/index.html"));
    });
  }
  app.use((req, res) =>
    res.status(404).json({ message: "This endpoint does not exist." }),
  );
  app.use((err, req, res, next) => {
    if (err instanceof z.ZodError)
      return res.status(400).json({
        message: err.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      });
    if (err.type === "entity.parse.failed")
      return res.status(400).json({ message: "Invalid JSON." });
    if (err.type === "entity.too.large")
      return res.status(413).json({ message: "Request is too large." });
    if (!err.status) console.error(err.message);
    res.status(err.status || 500).json({
      message: err.status
        ? err.message
        : "Something went wrong. Please try again.",
    });
  });
  return { app, db };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { app } = createApp();
  const port = process.env.PORT || 3001;
  app.listen(port, "0.0.0.0", () =>
    console.log(
      `Cortex API listening on ${port} (${isLive() ? "OpenAI" : "local demo"} mode)`,
    ),
  );
}
