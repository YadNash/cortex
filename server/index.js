import express from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { randomUUID, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, hashPassword, checkPassword, seedDemo } from "./db.js";
import { localVector, embed, cosine, answer, isLive } from "./ai.js";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (existsSync(resolve(root, ".env")))
  process.loadEnvFile(resolve(root, ".env"));
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email });
const types = ["note", "idea", "spec", "code_snippet", "handoff", "other"];
const visibility = z.enum(["private", "shared_with", "team"]);
const fields = {
  title: z.string().trim().min(1).max(180),
  content: z.string().trim().min(1).max(24000),
  type: z.enum(types),
  tags: z.array(z.string().trim().min(1).max(40)).max(12),
  assigned_to_user_id: z.string().max(100).nullable(),
};
const createSchema = z.object({
  ...fields,
  visibility,
  tags: fields.tags.default([]),
  assigned_to_user_id: fields.assigned_to_user_id.default(null),
  shared_with_user_ids: z.array(z.string().max(100)).max(100).default([]),
});
const accessSQL = `(a.owner_user_id = ? OR a.visibility = 'team' OR (a.visibility = 'shared_with' AND EXISTS (SELECT 1 FROM artifact_permissions p WHERE p.artifact_id = a.id AND p.user_id = ?)))`;
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
    res.status(201).json({ user: publicUser(u), token: token(u) });
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
  app.get("/api/users", (_, res) =>
    res.json(db.prepare("SELECT id,name,email FROM users ORDER BY name").all()),
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
      .get(id, uid, uid);
    if (!a)
      throw Object.assign(Error("This artifact isn’t available to you."), {
        status: 404,
      });
    return serialize(a, uid);
  }
  function list(uid, scope, owner, search) {
    let sql = `SELECT a.*,u.name AS owner_name,assignee.name AS assigned_to_name FROM artifacts a JOIN users u ON a.owner_user_id=u.id LEFT JOIN users assignee ON a.assigned_to_user_id=assignee.id WHERE ${accessSQL}`;
    const params = [uid, uid];
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
      })
      .parse(req.query);
    res.json(list(req.user.id, q.scope, q.owner_user_id, q.search));
  });
  function ensureUsers(ids) {
    for (const id of ids)
      if (!db.prepare("SELECT id FROM users WHERE id=?").get(id))
        throw Object.assign(
          Error("One of the selected teammates no longer exists."),
          { status: 400 },
        );
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
  app.post("/api/artifacts", async (req, res) => {
    const input = createSchema.parse(req.body),
      a = { id: randomUUID(), owner_user_id: req.user.id, ...input };
    ensureUsers([
      ...input.shared_with_user_ids,
      ...(a.assigned_to_user_id ? [a.assigned_to_user_id] : []),
    ]);
    validateAssignment(a, input.shared_with_user_ids);
    const vector = await embed(a.title + " " + a.content);
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
      storeVector(a, vector);
    });
    res.status(201).json(accessible(a.id, req.user.id));
  });
  app.get("/api/artifacts/:id", (req, res) =>
    res.json(accessible(req.params.id, req.user.id)),
  );
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
    ensureUsers(merged.assigned_to_user_id ? [merged.assigned_to_user_id] : []);
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
      storeVector(merged, vector);
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
    ensureUsers(input.shared_with_user_ids);
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
    db.prepare(
      "INSERT INTO comments (id,artifact_id,author_user_id,content) VALUES (?,?,?,?)",
    ).run(id, req.params.id, req.user.id, content);
    res.status(201).json({
      id,
      content,
      author_name: req.user.name,
      author_user_id: req.user.id,
      created_at: new Date().toISOString(),
    });
  });
  async function search(uid, query, scope, owner) {
    const candidates = list(uid, scope, owner);
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
      .slice(0, 8);
  }
  app.post("/api/search/artifacts", async (req, res) => {
    const q = z
      .object({
        query: z.string().trim().min(1).max(1000),
        scope: scopeSchema.default("all"),
        owner_user_id: z.string().optional(),
      })
      .parse(req.body);
    res.json(await search(req.user.id, q.query, q.scope, q.owner_user_id));
  });
  app.post("/api/agent/chat", async (req, res) => {
    const q = z
      .object({
        message: z.string().trim().min(1).max(8000),
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
    const primary = q.artifact_id
      ? accessible(q.artifact_id, req.user.id)
      : null;
    let owner;
    const users = db.prepare("SELECT id,name FROM users").all();
    for (const u of users) {
      const first = u.name.split(" ")[0].toLowerCase();
      if (
        q.message.toLowerCase().includes(first + "'s") ||
        q.message.toLowerCase().includes(first + "’s")
      ) {
        owner = u.id;
        break;
      }
    }
    let artifacts = await search(req.user.id, q.message, "all", owner);
    if (primary)
      artifacts = [primary, ...artifacts.filter((a) => a.id !== primary.id)];
    artifacts = artifacts.slice(0, 5).map((a) => accessible(a.id, req.user.id));
    const response = await answer(q.message, artifacts, q.history);
    for (const a of artifacts) accessible(a.id, req.user.id);
    res.json({
      answer: response,
      used_artifacts: artifacts.map((a) => ({
        id: a.id,
        title: a.title,
        owner_user_id: a.owner_user_id,
        owner_name: a.owner_name,
      })),
      mode: isLive() ? "openai" : "demo",
    });
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
