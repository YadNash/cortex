import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/index.js";
process.env.LLM_PROVIDER = "demo";
const { app, db } = createApp({
  dbPath: ":memory:",
  secret: "test-secret-only",
  seed: false,
});
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`;
const tokens = {};
async function call(path, { as, body, method = "GET", status = 200 } = {}) {
  const r = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(as ? { Authorization: "Bearer " + tokens[as] } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  assert.equal(r.status, status, JSON.stringify(data));
  return data;
}
const payload = (overrides = {}) => ({
  title: "Orchid launch protocol",
  content:
    "Orchid confidential launch: schedule the beta invitation for Tuesday.",
  type: "note",
  visibility: "private",
  ...overrides,
});
let alice, bob, carol, privateA, sharedA, handoff;
test("signup hashes passwords; rejects duplicates and unauthenticated requests", async () => {
  for (const name of ["Alice", "Bob", "Carol"]) {
    const result = await call("/auth/signup", {
      method: "POST",
      status: 201,
      body: {
        name,
        email: name.toLowerCase() + "@example.com",
        password: "correct-password-123",
      },
    });
    tokens[name] = result.token;
    if (name === "Alice") alice = result.user;
    if (name === "Bob") bob = result.user;
    if (name === "Carol") carol = result.user;
    assert.equal(result.user.password_hash, undefined);
  }
  const stored = db
    .prepare("SELECT password_hash FROM users WHERE id=?")
    .get(alice.id);
  assert.notEqual(stored.password_hash, "correct-password-123");
  await call("/auth/signup", {
    method: "POST",
    status: 409,
    body: {
      name: "Alice",
      email: "alice@example.com",
      password: "correct-password-123",
    },
  });
  await call("/api/artifacts", { status: 401 });
  await call("/auth/login", {
    method: "POST",
    status: 401,
    body: { email: "alice@example.com", password: "wrong" },
  });
  const login = await call("/auth/login", {
    method: "POST",
    body: { email: "alice@example.com", password: "correct-password-123" },
  });
  assert.equal(login.user.id, alice.id);
});
test("private artifacts never leak in lists, detail, comments, search, or agent context", async () => {
  privateA = await call("/api/artifacts", {
    method: "POST",
    as: "Alice",
    status: 201,
    body: payload(),
  });
  assert.equal((await call("/api/artifacts", { as: "Bob" })).length, 0);
  await call("/api/artifacts/" + privateA.id, { as: "Bob", status: 404 });
  await call("/api/artifacts/" + privateA.id + "/comments", {
    as: "Bob",
    status: 404,
  });
  await call("/api/artifacts/" + privateA.id + "/comments", {
    as: "Bob",
    method: "POST",
    body: { content: "leak?" },
    status: 404,
  });
  const search = await call("/api/search/artifacts", {
    as: "Bob",
    method: "POST",
    body: { query: "Orchid launch", scope: "all" },
  });
  assert.equal(search.length, 0);
  const chat = await call("/api/agent/chat", {
    as: "Bob",
    method: "POST",
    body: { message: "Show Alice’s Orchid launch" },
  });
  assert.equal(chat.used_artifacts.length, 0);
  assert.ok(!chat.answer.includes("Tuesday"));
  await call("/api/agent/chat", {
    as: "Bob",
    method: "POST",
    body: { message: "Summarize this", artifact_id: privateA.id },
    status: 404,
  });
  const mine = await call("/api/artifacts?scope=my", { as: "Alice" });
  assert.equal(mine.length, 1);
});
test("sharing grants read access without editing rights; owner can revoke access", async () => {
  sharedA = await call("/api/artifacts", {
    as: "Alice",
    method: "POST",
    status: 201,
    body: payload({
      title: "Shared research",
      visibility: "shared_with",
      shared_with_user_ids: [bob.id],
    }),
  });
  const detail = await call("/api/artifacts/" + sharedA.id, { as: "Bob" });
  assert.equal(detail.can_edit, false);
  assert.equal(
    (await call("/api/artifacts?scope=shared_with_me", { as: "Bob" })).length,
    1,
  );
  await call("/api/artifacts/" + sharedA.id, { as: "Carol", status: 404 });
  await call("/api/artifacts/" + sharedA.id, {
    as: "Bob",
    method: "PATCH",
    body: { content: "Changed" },
    status: 403,
  });
  await call("/api/artifacts/" + sharedA.id + "/share", {
    as: "Bob",
    method: "PATCH",
    body: { visibility: "team" },
    status: 403,
  });
  const c = await call("/api/artifacts/" + sharedA.id + "/comments", {
    as: "Bob",
    method: "POST",
    status: 201,
    body: { content: "Useful context!" },
  });
  assert.equal(c.author_user_id, bob.id);
  const comments = await call("/api/artifacts/" + sharedA.id + "/comments", {
    as: "Alice",
  });
  assert.equal(comments.length, 1);
  await call("/api/artifacts/" + sharedA.id + "/share", {
    as: "Alice",
    method: "PATCH",
    body: { visibility: "private" },
  });
  await call("/api/artifacts/" + sharedA.id, { as: "Bob", status: 404 });
  assert.equal(
    (
      await call("/api/search/artifacts", {
        as: "Bob",
        method: "POST",
        body: { query: "research" },
      })
    ).length,
    0,
  );
});
test("handoffs work end to end with assignee edit access and primary chat context", async () => {
  handoff = await call("/api/artifacts", {
    as: "Alice",
    method: "POST",
    status: 201,
    body: payload({
      title: "Onboarding Flow Spec",
      content:
        "Onboarding outline: invite the user, verify access, present a checklist.",
      type: "handoff",
      visibility: "shared_with",
      shared_with_user_ids: [bob.id],
      assigned_to_user_id: bob.id,
    }),
  });
  const assigned = await call("/api/artifacts?scope=assigned_to_me", {
    as: "Bob",
  });
  assert.equal(assigned.length, 1);
  assert.equal(assigned[0].can_edit, true);
  const response = await call("/api/agent/chat", {
    as: "Bob",
    method: "POST",
    body: { message: "Fill in technical details", artifact_id: handoff.id },
  });
  assert.equal(response.used_artifacts[0].id, handoff.id);
  assert.ok(response.answer.includes("Onboarding Flow Spec"));
  assert.ok(!response.answer.includes("Tuesday"));
  const updated = await call("/api/artifacts/" + handoff.id, {
    as: "Bob",
    method: "PATCH",
    body: {
      content:
        "Technical plan: signed invitation, JWT authentication, permission checks, and completion checklist.",
    },
  });
  assert.ok(updated.content.includes("JWT"));
  await call("/api/artifacts/" + handoff.id, {
    as: "Bob",
    method: "PATCH",
    body: { assigned_to_user_id: carol.id },
    status: 403,
  });
  await call("/api/artifacts/" + handoff.id + "/share", {
    as: "Bob",
    method: "PATCH",
    body: { visibility: "team" },
    status: 403,
  });
  await call("/api/artifacts/" + handoff.id + "/share", {
    as: "Alice",
    method: "PATCH",
    body: { visibility: "private" },
    status: 400,
  });
  await call("/api/artifacts/" + handoff.id, { as: "Carol", status: 404 });
});
test("team search, owner filtering, literal text filtering, validation, and no hidden content leakage", async () => {
  const team = await call("/api/artifacts", {
    as: "Carol",
    method: "POST",
    status: 201,
    body: payload({
      title: "Engineering API patterns",
      content: "Engineering conventions for authentication and team APIs.",
      visibility: "team",
    }),
  });
  const results = await call("/api/search/artifacts", {
    as: "Bob",
    method: "POST",
    body: {
      query: "Engineering authentication",
      scope: "team",
      owner_user_id: carol.id,
    },
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].id, team.id);
  assert.equal(typeof results[0].score, "number");
  const chat = await call("/api/agent/chat", {
    as: "Bob",
    method: "POST",
    body: { message: "Summarize Carol's engineering notes" },
  });
  assert.ok(chat.used_artifacts.every((a) => a.owner_user_id === carol.id));
  assert.equal(
    (await call("/api/artifacts?search=%25", { as: "Bob" })).length,
    0,
  );
  await call("/api/artifacts", {
    as: "Alice",
    method: "POST",
    body: payload({ visibility: "public" }),
    status: 400,
  });
  await call("/api/artifacts", {
    as: "Alice",
    method: "POST",
    body: payload({ type: "handoff", assigned_to_user_id: bob.id }),
    status: 400,
  });
  await call("/api/artifacts/" + privateA.id, {
    as: "Alice",
    method: "PATCH",
    body: { owner_user_id: bob.id },
    status: 400,
  });
  await call("/api/artifacts?scope=invalid", { as: "Alice", status: 400 });
  const users = await call("/api/users", { as: "Alice" });
  assert.ok(users.every((u) => !u.password_hash));
});
test.after(() => {
  server.close();
  db.close();
});
