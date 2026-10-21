import { migrateMemory, defaultIntent } from "./memory-db.js";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  randomUUID,
  scryptSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}
export function checkPassword(password, hash) {
  const [salt, key] = hash.split(":");
  return timingSafeEqual(
    Buffer.from(key, "hex"),
    scryptSync(password, salt, 64),
  );
}
export function openDb(path) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL, content TEXT NOT NULL, type TEXT NOT NULL, visibility TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', assigned_to_user_id TEXT REFERENCES users(id), created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS artifact_permissions (id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id), access_level TEXT NOT NULL DEFAULT 'read', created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(artifact_id,user_id));
    CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE, author_type TEXT NOT NULL DEFAULT 'user', author_user_id TEXT NOT NULL REFERENCES users(id), content TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS embeddings (artifact_id TEXT PRIMARY KEY REFERENCES artifacts(id) ON DELETE CASCADE, owner_user_id TEXT NOT NULL, visibility TEXT NOT NULL, model TEXT NOT NULL, vector TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS artifact_owner ON artifacts(owner_user_id);
    CREATE INDEX IF NOT EXISTS permission_user ON artifact_permissions(user_id, artifact_id);
  `);
  if (
    !db
      .prepare("PRAGMA table_info(users)")
      .all()
      .some((c) => c.name === "role")
  ) {
    db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'other'");
  }
  db.exec(`CREATE TABLE IF NOT EXISTS activity (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    actor_user_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS activity_recent ON activity(created_at DESC);`);
  migrateMemory(db);
  backfillActivity(db);
  return db;
}
export function recordActivity(db, type, artifactId, actorId, eventId) {
  db.prepare(
    "INSERT INTO activity (id,type,artifact_id,actor_user_id,created_at) VALUES (?,?,?,?,?)",
  ).run(
    eventId ||
      (type === "artifact_created" ? "created:" + artifactId : randomUUID()),
    type,
    artifactId,
    actorId,
    new Date().toISOString(),
  );
}
export function backfillActivity(db) {
  db.exec(`INSERT OR IGNORE INTO activity SELECT 'created:' || id, 'artifact_created', id, owner_user_id, created_at FROM artifacts;
    INSERT OR IGNORE INTO activity SELECT 'comment:' || id, 'artifact_commented', artifact_id, author_user_id, created_at FROM comments;`);
}
export function seedDemo(db, vector) {
  if (db.prepare("SELECT count(*) AS n FROM users").get().n) return;
  const users = [
    ["demo-alex", "Alex Morgan", "alex@cortex.demo"],
    ["demo-jamie", "Jamie Chen", "jamie@cortex.demo"],
    ["demo-sarah", "Sarah Park", "sarah@cortex.demo"],
    ["demo-sam", "Sam Rivera", "sam@cortex.demo"],
  ];
  const password = hashPassword("CortexDemo2026!");
  users.forEach((u) =>
    db
      .prepare(
        "INSERT INTO users (id,name,email,password_hash) VALUES (?,?,?,?)",
      )
      .run(...u, password),
  );
  for (const [id, role] of [
    ["demo-alex", "pm"],
    ["demo-jamie", "pm"],
    ["demo-sarah", "designer"],
    ["demo-sam", "engineer"],
  ]) {
    db.prepare("UPDATE users SET role=? WHERE id=?").run(role, id);
  }
  const rows = [
    [
      "a-onboarding",
      "demo-jamie",
      "A warmer welcome: onboarding v2",
      "Our onboarding should feel like a conversation, not a checklist.\n\nThe goal\nHelp new teammates get to their first meaningful contribution within three days.\n\nThe experience\n1. A personal welcome from their team lead.\n2. A curated set of team artifacts: our principles, product direction, and active projects.\n3. A buddy introduction and a small first task.\n\nSuccess metrics\nTime to first contribution, day-seven confidence, and buddy feedback.\n\nNext step\nAlex will outline the technical details for invitations, workspace access, and the welcome checklist.",
      "handoff",
      "shared_with",
      ["onboarding", "product"],
      "demo-alex",
      -1,
    ],
    [
      "a-brand",
      "demo-sarah",
      "The way we sound",
      "Cortex is a thoughtful teammate: warm, direct, and quietly confident.\n\nOur voice\nSay what you mean. Choose everyday words. Make space for curiosity.\n\nWriting principles\n• Be helpful before being clever.\n• Use short sentences with a human rhythm.\n• Celebrate progress without overdoing it.\n\nExamples\nInstead of “Leverage your knowledge ecosystem,” say “Put your team’s knowledge to work.”",
      "spec",
      "team",
      ["brand", "design"],
      null,
      -2,
    ],
    [
      "a-product",
      "demo-alex",
      "A home for our collective thinking",
      "What if the best ideas didn’t disappear into chat threads?\n\nCortex connects personal AI assistants through a shared, permissioned memory. Every note, idea, spec, and handoff can become useful context for the next person.\n\nOur north star\nMake the team smarter together, without making private thinking public.\n\nMVP priorities\n1. A delightful personal AI chat.\n2. Simple, transparent artifact sharing.\n3. Handoffs that carry context with them.",
      "idea",
      "team",
      ["strategy", "product"],
      null,
      -3,
    ],
    [
      "a-api",
      "demo-sam",
      "API conventions & patterns",
      "All protected endpoints require a Bearer token.\n\nResponse conventions\nReturn useful errors with a message field. Use 401 for unauthenticated requests and 404 for inaccessible artifacts.\n\nPermissions\nEvery list, detail fetch, search, and agent context lookup applies the same visibility rules. Handoff assignees may edit the content of artifacts they can access. Only owners can change sharing.\n\nSearch\nFilter by permissions before ranking results. Never include inaccessible text in model prompts.",
      "code_snippet",
      "team",
      ["engineering", "api"],
      null,
      -4,
    ],
    [
      "a-notes",
      "demo-alex",
      "Little things worth exploring",
      "A place for the ideas that aren’t quite ready yet.\n\n• Could the agent suggest a useful teammate when an idea gets stuck?\n• A weekly digest of what the team learned.\n• Let handoffs feel like passing a notebook, with a clear next step.\n\nKeep this private while the ideas take shape.",
      "note",
      "private",
      ["personal", "exploration"],
      null,
      -5,
    ],
    [
      "a-research",
      "demo-jamie",
      "What we heard in discovery",
      "Five interviews, one recurring theme: people know the answer exists somewhere, but not where.\n\nKey observations\n• Knowledge is scattered across documents, chat, and people’s heads.\n• Teams want to share selectively.\n• A good handoff needs the why, not just the what.\n\nOpportunity\nBring relevant context into the moment someone needs it. Make the source and its owner visible.",
      "note",
      "team",
      ["research", "discovery"],
      null,
      -6,
    ],
  ];
  for (const [
    id,
    owner,
    title,
    content,
    type,
    visibility,
    tags,
    assigned,
    days,
  ] of rows) {
    const date = new Date(Date.now() + days * 86400000).toISOString();
    db.prepare(
      "INSERT INTO artifacts (id,owner_user_id,title,content,type,visibility,tags,assigned_to_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      owner,
      title,
      content,
      type,
      visibility,
      JSON.stringify(tags),
      assigned,
      date,
      date,
    );
    db.prepare(
      "UPDATE artifacts SET intent=?,steward_user_id=? WHERE id=?",
    ).run(defaultIntent(type), owner, id);
    db.prepare("INSERT INTO embeddings VALUES (?,?,?,?,?)").run(
      id,
      owner,
      visibility,
      "local-v1",
      JSON.stringify(vector(title + " " + content)),
    );
  }
  db.prepare(
    "INSERT INTO artifact_permissions (id,artifact_id,user_id) VALUES (?,?,?)",
  ).run(randomUUID(), "a-onboarding", "demo-alex");
  db.prepare(
    "INSERT INTO comments (id,artifact_id,author_user_id,content) VALUES (?,?,?,?)",
  ).run(
    randomUUID(),
    "a-onboarding",
    "demo-jamie",
    "The outline is ready for your technical perspective, Alex. Especially curious about how we make invitations feel effortless.",
  );
}
