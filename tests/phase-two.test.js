import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, hashPassword, checkPassword } from "../server/db.js";
import { createApp } from "../server/index.js";
process.env.LLM_PROVIDER = "demo";
const { app, db } = createApp({
  dbPath: ":memory:",
  secret: "phase-two-test-only",
  seed: false,
});
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`;
const tokens = {},
  users = {};
async function call(
  path,
  { as = "Alice", method = "GET", body, status = 200 } = {},
) {
  const res = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(tokens[as] ? { Authorization: "Bearer " + tokens[as] } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json();
  assert.equal(res.status, status, JSON.stringify(data));
  return data;
}
async function artifact(title, visibility = "team", extra = {}) {
  return call("/api/artifacts", {
    method: "POST",
    status: 201,
    body: {
      title,
      content:
        "Architecture overview: shared context uses permission checks before retrieval.",
      type: "spec",
      visibility,
      tags: ["architecture", "getting-started"],
      ...extra,
    },
  });
}
let privateArtifact, shared, team;
test("roles persist, validate, and stay scoped to the authenticated user", async () => {
  for (const name of ["Alice", "Bob"]) {
    const r = await call("/auth/signup", {
      as: "none",
      method: "POST",
      status: 201,
      body: {
        name,
        email: name + "@example.com",
        password: "phase-two-password",
      },
    });
    tokens[name] = r.token;
    users[name] = r.user;
    assert.equal(r.user.role, "other");
  }
  const updated = await call("/api/me", {
    method: "PATCH",
    body: { role: "engineer" },
  });
  assert.equal(updated.role, "engineer");
  assert.equal((await call("/api/me")).role, "engineer");
  assert.equal((await call("/api/me", { as: "Bob" })).role, "other");
  await call("/api/me", {
    method: "PATCH",
    body: { role: "admin" },
    status: 400,
  });
  await call("/api/me", {
    method: "PATCH",
    body: { role: "pm", id: users.Bob.id },
    status: 400,
  });
  await call("/api/onboarding/plan", {
    as: "none",
    method: "POST",
    body: {},
    status: 401,
  });
});
test("onboarding uses role, prioritizes onboarding sources, and excludes inaccessible artifacts", async () => {
  privateArtifact = await artifact("Private architecture secret", "private");
  shared = await artifact("Shared process primer", "shared_with", {
    shared_with_user_ids: [users.Bob.id],
  });
  team = await artifact("Team architecture overview");
  const plan = await call("/api/onboarding/plan", {
    as: "Bob",
    method: "POST",
    body: { role: "designer" },
  });
  assert.equal(plan.role, "designer");
  assert.equal(plan.steps.length, 2);
  assert.ok(plan.steps.every((s) => s.artifact_ids.length));
  assert.ok(!JSON.stringify(plan).includes(privateArtifact.id));
  assert.ok(!JSON.stringify(plan).includes("Private architecture secret"));
  const own = await call("/api/onboarding/plan", { method: "POST", body: {} });
  assert.equal(own.role, "engineer");
  assert.ok(own.steps.length >= 3);
  assert.ok(own.steps.some((s) => s.description.includes("technical")));
});
test("decision extraction creates searchable decision artifacts with explicit visibility; no decisions means no write", async () => {
  const before = db.prepare("SELECT count(*) n FROM artifacts").get().n;
  await call("/api/decisions/extract", {
    method: "POST",
    body: {
      source_text: "TODO: investigate databases. Could we try something else?",
    },
    status: 422,
  });
  assert.equal(db.prepare("SELECT count(*) n FROM artifacts").get().n, before);
  const result = await call("/api/decisions/extract", {
    method: "POST",
    status: 201,
    body: {
      title: "Invitation decisions",
      source_text:
        "Decision: We will use single-use invitation tokens.\nWe agreed to expire tokens after seven days.\nTODO: Sam will draft a document.",
    },
  });
  assert.equal(result.type, "decision");
  assert.equal(result.visibility, "team");
  assert.equal(result.decisions.length, 2);
  assert.ok(result.tags.includes("decision"));
  assert.ok(!result.content.includes("Sam will"));
  const matches = await call("/api/search/artifacts", {
    as: "Bob",
    method: "POST",
    body: { query: "single-use invitation", scope: "team" },
  });
  assert.ok(matches.some((a) => a.id === result.id));
  const privateDecision = await call("/api/decisions/extract", {
    method: "POST",
    status: 201,
    body: {
      source_text: "We decided to keep the launch date private.",
      visibility: "private",
    },
  });
  await call("/api/artifacts/" + privateDecision.id, {
    as: "Bob",
    status: 404,
  });
  await call("/api/decisions/extract", {
    method: "POST",
    body: { source_text: "Short", visibility: "team" },
    status: 400,
  });
});
test("three persona reviews enforce access and do not modify the artifact", async () => {
  await call("/api/agent/review-artifact", {
    as: "Bob",
    method: "POST",
    body: { artifact_id: privateArtifact.id },
    status: 404,
  });
  const before = (await call("/api/artifacts/" + team.id)).content;
  const result = await call("/api/agent/review-artifact", {
    as: "Bob",
    method: "POST",
    body: { artifact_id: team.id },
  });
  assert.deepEqual(
    result.reviews.map((r) => r.role),
    ["architect", "product", "dev"],
  );
  assert.ok(result.reviews.every((r) => r.text.includes("Demo review")));
  assert.equal((await call("/api/artifacts/" + team.id)).content, before);
});
test("activity records the real editor and commenter, honors limit, and hides revoked sources", async () => {
  const handoff = await artifact("A context handoff", "shared_with", {
    type: "handoff",
    shared_with_user_ids: [users.Bob.id],
    assigned_to_user_id: users.Bob.id,
  });
  await call("/api/artifacts/" + handoff.id, {
    as: "Bob",
    method: "PATCH",
    body: { content: "Revised engineering plan with edge cases." },
  });
  await call("/api/artifacts/" + shared.id + "/comments", {
    as: "Bob",
    method: "POST",
    status: 201,
    body: { content: "A useful starting point." },
  });
  let events = await call("/api/activity", { as: "Bob" });
  assert.ok(
    events.some(
      (e) =>
        e.type === "artifact_updated" &&
        e.actor_user_id === users.Bob.id &&
        e.artifact_id === handoff.id,
    ),
  );
  assert.ok(
    events.some(
      (e) =>
        e.type === "artifact_commented" && e.actor_user_id === users.Bob.id,
    ),
  );
  assert.ok(!events.some((e) => e.artifact_id === privateArtifact.id));
  await call("/api/artifacts/" + shared.id + "/share", {
    method: "PATCH",
    body: { visibility: "private" },
  });
  events = await call("/api/activity", { as: "Bob" });
  assert.ok(!events.some((e) => e.artifact_id === shared.id));
  assert.equal((await call("/api/activity?limit=1", { as: "Bob" })).length, 1);
  await call("/api/activity?limit=0", { status: 400 });
  await call("/api/activity?limit=101", { status: 400 });
});
test("artifact IDs, exact titles, and full-name possessives pin or restrict chat sources", async () => {
  const r = await call("/api/agent/chat", {
    as: "Bob",
    method: "POST",
    body: { message: `Summarize artifact ${team.id}` },
  });
  assert.equal(r.used_artifacts[0].id, team.id);
  const byTitle = await call("/api/agent/chat", {
    as: "Bob",
    method: "POST",
    body: { message: "Summarize “Team architecture overview”" },
  });
  assert.equal(byTitle.used_artifacts[0].id, team.id);
  await call("/api/agent/chat", {
    as: "Bob",
    method: "POST",
    body: { message: `Summarize artifact ${privateArtifact.id}` },
    status: 404,
  });
  const full = await call("/api/agent/chat", {
    as: "Bob",
    method: "POST",
    body: { message: "Summarize Alice’s recent work" },
  });
  assert.ok(
    full.used_artifacts.every((a) => a.owner_user_id === users.Alice.id),
  );
});
test("existing databases migrate safely and activity backfill is repeatable", () => {
  const dir = mkdtempSync(join(tmpdir(), "cortex-migration-"));
  const path = join(dir, "old.sqlite");
  try {
    const legacy = new DatabaseSync(path);
    legacy.exec(
      "CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,email TEXT UNIQUE,password_hash TEXT,created_at TEXT,updated_at TEXT)",
    );
    const password = hashPassword("old-password-retained");
    legacy
      .prepare("INSERT INTO users VALUES (?,?,?,?,?,?)")
      .run(
        "old-user",
        "Old User",
        "old@example.com",
        password,
        "2026-01-01",
        "2026-01-01",
      );
    legacy.close();
    let migrated = openDb(path);
    assert.equal(
      migrated.prepare("SELECT role FROM users").get().role,
      "other",
    );
    assert.ok(
      checkPassword(
        "old-password-retained",
        migrated.prepare("SELECT password_hash FROM users").get().password_hash,
      ),
    );
    migrated.prepare("UPDATE users SET role='designer'").run();
    migrated
      .prepare(
        "INSERT INTO artifacts (id,owner_user_id,title,content,type,visibility) VALUES ('legacy-artifact','old-user','Keep me','Important content','note','private')",
      )
      .run();
    migrated.close();
    migrated = openDb(path);
    assert.equal(
      migrated.prepare("SELECT count(*) n FROM activity").get().n,
      1,
    );
    migrated.close();
    migrated = openDb(path);
    assert.equal(
      migrated.prepare("SELECT count(*) n FROM activity").get().n,
      1,
    );
    assert.equal(
      migrated.prepare("SELECT role FROM users").get().role,
      "designer",
    );
    assert.equal(
      migrated.prepare("SELECT content FROM artifacts").get().content,
      "Important content",
    );
    migrated.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test.after(() => {
  server.close();
  db.close();
});
