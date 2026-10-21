import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/index.js";
import { estimateTokens } from "../server/memory.js";
process.env.LLM_PROVIDER = "demo";
const { app, db } = createApp({
  dbPath: ":memory:",
  secret: "memory-test-only",
  seed: false,
});
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`,
  tokens = {},
  users = {};
async function call(
  path,
  { as = "Alice", method = "GET", body, status = 200 } = {},
) {
  const r = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(tokens[as] ? { Authorization: "Bearer " + tokens[as] } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  assert.equal(r.status, status, JSON.stringify(data));
  return data;
}
async function artifact(title, extra = {}) {
  return call("/api/artifacts", {
    method: "POST",
    status: 201,
    body: {
      title,
      content: "The pricing architecture uses an auditable source of truth.",
      type: "spec",
      visibility: "team",
      tags: ["pricing"],
      ...extra,
    },
  });
}
let source, decision, privateSource, sharedReport;
test("memory migration assigns organization, intent, stewardship, and decision attribution", async () => {
  for (const name of ["Alice", "Bob", "Outsider"]) {
    const r = await call("/auth/signup", {
      as: "none",
      method: "POST",
      status: 201,
      body: {
        name,
        email: name + "@memory.test",
        password: "a-memory-password",
      },
    });
    tokens[name] = r.token;
    users[name] = r.user;
    assert.equal(r.user.org_id, "org-studio");
  }
  db.prepare(
    "INSERT INTO organizations(id,name,owner_user_id) VALUES ('org-other','Other team',?)",
  ).run(users.Outsider.id);
  db.prepare("UPDATE users SET org_id='org-other' WHERE id=?").run(
    users.Outsider.id,
  );
  source = await artifact("Pricing research", {
    content: "Customers prefer predictable pricing with no surprise fees.",
    tags: ["pricing", "research"],
  });
  decision = await artifact("Pricing decision", {
    type: "decision",
    content: "We decided to use predictable pricing.",
  });
  assert.equal(decision.intent, "decide");
  assert.equal(decision.steward_user_id, users.Alice.id);
  assert.equal(decision.decided_by_user_id, users.Alice.id);
  assert.ok(decision.decided_at);
  await call("/api/artifacts/" + source.id, { as: "Outsider", status: 404 });
  assert.equal((await call("/api/artifacts", { as: "Outsider" })).length, 0);
  assert.ok(
    !(await call("/api/users", { as: "Alice" })).some(
      (u) => u.id === users.Outsider.id,
    ),
  );
  await call("/api/artifacts", {
    method: "POST",
    status: 400,
    body: {
      title: "No cross-org grant",
      content: "Do not grant this.",
      type: "note",
      visibility: "shared_with",
      shared_with_user_ids: [users.Outsider.id],
    },
  });
});
test("lineage preserves source snapshots, orders history, prevents cycles, and filters hidden source chains", async () => {
  const link = await call("/api/artifacts/" + decision.id + "/links", {
    method: "POST",
    status: 201,
    body: { source_artifact_id: source.id, relation: "supports" },
  });
  assert.equal(link.edges[0].source_snapshot.content, source.content);
  await call("/api/artifacts/" + source.id, {
    method: "PATCH",
    body: { content: "Edited source, original evidence must survive." },
  });
  const pinned = await call("/api/artifacts/" + decision.id + "/lineage");
  assert.equal(pinned.edges[0].source_snapshot.content, source.content);
  await call("/api/artifacts/" + source.id + "/links", {
    method: "POST",
    status: 400,
    body: { source_artifact_id: decision.id },
  });
  privateSource = await artifact("Private pricing rationale", {
    visibility: "private",
    content: "Private customer interview evidence.",
  });
  await call("/api/artifacts/" + decision.id + "/links", {
    method: "POST",
    status: 201,
    body: { source_artifact_id: privateSource.id },
  });
  const bob = await call("/api/artifacts/" + decision.id + "/lineage", {
    as: "Bob",
  });
  assert.equal(bob.edges.length, 1);
  assert.ok(!JSON.stringify(bob).includes(privateSource.id));
  assert.ok(!JSON.stringify(bob).includes("Private customer"));
  await call("/api/artifacts/" + decision.id + "/memory", {
    method: "PATCH",
    body: { steward_user_id: users.Bob.id, decided_at: "2025-01-01T00:00:00Z" },
  });
  await call("/api/artifacts/" + decision.id + "/memory", {
    as: "Bob",
    method: "PATCH",
    body: { intent: "review" },
    status: 403,
  });
  const history = await call("/api/history?tag=pricing", { as: "Bob" });
  assert.equal(history.decisions[0].id, decision.id);
  assert.equal(history.decisions[0].lineage.steward.name, "Bob");
  assert.ok(!JSON.stringify(history).includes(privateSource.id));
  await call("/api/artifacts/" + decision.id + "/memory", {
    method: "PATCH",
    body: { steward_user_id: users.Outsider.id },
    status: 400,
  });
});
test("decision extraction accepts only accessible sources and creates provenance atomically", async () => {
  const before = db.prepare("SELECT count(*) n FROM artifacts").get().n;
  await call("/api/decisions/extract", {
    as: "Bob",
    method: "POST",
    body: {
      source_text: "We agreed to use predictable pricing.",
      source_artifact_ids: [privateSource.id],
    },
    status: 404,
  });
  assert.equal(db.prepare("SELECT count(*) n FROM artifacts").get().n, before);
  const result = await call("/api/decisions/extract", {
    method: "POST",
    status: 201,
    body: {
      source_text: "We agreed to document pricing assumptions.",
      source_artifact_ids: [source.id],
    },
  });
  const lineage = await call("/api/artifacts/" + result.id + "/lineage");
  assert.equal(lineage.edges[0].source_artifact_id, source.id);
});
test("conflicts contain exact evidence, are idempotent, and become stale when sources change", async () => {
  const a = await artifact("Price specification", {
    content: "The monthly price is 10 USD.",
    tags: ["rates"],
  });
  const b = await artifact("Price decision", {
    type: "decision",
    content: "The monthly price is 20 USD.",
    tags: ["rates"],
  });
  let result = await call("/api/conflicts/detect", {
    method: "POST",
    body: { tag: "rates" },
  });
  assert.equal(result.reports.length, 1);
  assert.equal(result.reports[0].severity, "high");
  assert.ok(
    result.reports[0].evidence.every((e) =>
      [a.content, b.content].includes(e.quote),
    ),
  );
  const id = result.reports[0].id;
  result = await call("/api/conflicts/detect", {
    method: "POST",
    body: { tag: "rates" },
  });
  assert.equal(result.reports.length, 1);
  assert.equal(result.reports[0].id, id);
  await call("/api/artifacts/" + b.id, {
    method: "PATCH",
    body: { content: "The monthly price is 25 USD." },
  });
  assert.equal((await call("/api/conflicts?tag=rates")).reports[0].stale, true);
  await call("/api/conflicts/" + id, {
    method: "PATCH",
    body: { status: "resolved" },
  });
  assert.equal((await call("/api/conflicts?tag=rates")).reports.length, 0);
});
test("derived conflicts and concepts disappear when ANY input source becomes inaccessible", async () => {
  const a = await artifact("Enabled policy", {
    content: "The feature is enabled.",
    tags: ["access-policy"],
  });
  const b = await artifact("Disabled policy", {
    content: "The feature is not enabled.",
    tags: ["access-policy"],
    visibility: "shared_with",
    shared_with_user_ids: [users.Bob.id],
  });
  const scan = await call("/api/conflicts/detect", {
    method: "POST",
    body: { tag: "access-policy" },
  });
  sharedReport = scan.reports[0];
  assert.ok(sharedReport);
  const graph = await call("/api/concepts/extract", {
    method: "POST",
    status: 201,
    body: { artifact_ids: [a.id, b.id] },
  });
  assert.ok(graph.nodes.length);
  assert.ok(
    (await call("/api/concepts?tag=access-policy", { as: "Bob" })).nodes.length,
  );
  await call("/api/artifacts/" + b.id + "/share", {
    method: "PATCH",
    body: { visibility: "private" },
  });
  assert.equal(
    (await call("/api/conflicts?tag=access-policy", { as: "Bob" })).reports
      .length,
    0,
  );
  assert.equal(
    (await call("/api/concepts?tag=access-policy", { as: "Bob" })).nodes.length,
    0,
  );
  await call("/api/conflicts/" + sharedReport.id, {
    as: "Bob",
    method: "PATCH",
    body: { status: "resolved" },
    status: 404,
  });
  await call("/api/concepts/extract", {
    as: "Bob",
    method: "POST",
    body: { artifact_ids: [b.id] },
    status: 404,
  });
});
test("context debugger and chat use the same budgeted ranking and pin large primary sources", async () => {
  const big = await artifact("Long authoritative specification", {
    content: "Subscriptions must have predictable pricing. ".repeat(180),
    intent: "specify",
  });
  const q = "Summarize artifact " + big.id;
  const debug = await call(
    "/api/agent/context-debug?" +
      new URLSearchParams({ query: q, intent: "review", budget_tokens: "360" }),
  );
  assert.ok(debug.tokens <= 360);
  assert.equal(debug.artifacts[0].id, big.id);
  assert.ok(debug.artifacts[0].excerpt.length < big.content.length);
  assert.ok(debug.candidates[0].reasons.length);
  assert.equal(debug.artifacts[0].type, "spec");
  const chat = await call("/api/agent/chat", {
    method: "POST",
    body: { message: q, intent: "review", context_budget: 360 },
  });
  assert.ok(chat.answer_id);
  assert.equal(chat.context_tokens, debug.tokens);
  assert.deepEqual(
    chat.used_artifacts.map((a) => a.id),
    debug.artifacts.map((a) => a.id),
  );
  const count = db.prepare("SELECT count(*) n FROM agent_answers").get().n;
  await call("/api/agent/context-debug?query=pricing");
  assert.equal(
    db.prepare("SELECT count(*) n FROM agent_answers").get().n,
    count,
  );
  assert.ok(
    !JSON.stringify(
      await call("/api/agent/context-debug?query=pricing", { as: "Bob" }),
    ).includes(privateSource.id),
  );
  assert.ok(estimateTokens("文".repeat(100)) >= 100);
  await call("/api/agent/context-debug?query=test&budget_tokens=10", {
    status: 400,
  });
});
test("answer feedback is owned, replaces prior ratings, and influences style and usefulness", async () => {
  const answer = await call("/api/agent/chat", {
    method: "POST",
    body: { message: "Summarize pricing decisions", intent: "decide" },
  });
  await call("/api/agent/feedback", {
    as: "Bob",
    method: "POST",
    body: { answer_id: answer.answer_id, rating: "helpful" },
    status: 404,
  });
  await call("/api/agent/feedback", {
    method: "POST",
    body: { answer_id: answer.answer_id, rating: "too_long" },
  });
  await call("/api/agent/feedback", {
    method: "POST",
    body: { answer_id: answer.answer_id, rating: "too_vague" },
  });
  assert.equal(
    db
      .prepare("SELECT count(*) n FROM answer_feedback WHERE answer_id=?")
      .get(answer.answer_id).n,
    1,
  );
  const preferences = await call("/api/team/preferences");
  assert.ok(preferences.style_hint.includes("concrete"));
  assert.ok(preferences.often_used_artifacts.length);
  assert.ok(
    !(
      await call("/api/team/preferences", { as: "Bob" })
    ).often_used_artifacts.some((a) => a.artifact_id === privateSource.id),
  );
  await call("/api/agent/feedback", {
    method: "POST",
    body: { answer_id: answer.answer_id, rating: "helpful" },
  });
  const debug = await call("/api/agent/context-debug?query=pricing");
  assert.ok(debug.candidates.some((c) => c.components.usefulness > 0.5));
});
test("team vocabulary is owner-managed, normalizes whole terms only, and never rewrites stored artifacts", async () => {
  const vocabulary = {
    mappings: [
      {
        canonical: "subscription",
        preferred: "plan",
        synonyms: ["membership"],
      },
    ],
    hints: ["Favor small reversible changes."],
  };
  await call("/api/team/vocabulary", {
    as: "Bob",
    method: "PUT",
    body: vocabulary,
    status: 403,
  });
  await call("/api/team/vocabulary", { method: "PUT", body: vocabulary });
  const debug = await call(
    "/api/agent/context-debug?query=" +
      encodeURIComponent("membership membershipness"),
  );
  assert.equal(debug.normalized_query, "subscription membershipness");
  const a = await artifact("Subscription overview", {
    content: "A subscription has a predictable price.",
    tags: ["terminology"],
  });
  const chat = await call("/api/agent/chat", {
    method: "POST",
    body: { message: "Use subscription overview", artifact_id: a.id },
  });
  assert.match(chat.answer.toLowerCase(), /plan/);
  assert.equal((await call("/api/artifacts/" + a.id)).content, a.content);
  await call("/api/team/vocabulary", {
    method: "PUT",
    body: {
      mappings: [
        ...vocabulary.mappings,
        {
          canonical: "different",
          preferred: "other",
          synonyms: ["membership"],
        },
      ],
    },
    status: 409,
  });
  await call("/api/team/vocabulary", {
    method: "PUT",
    status: 409,
    body: { mappings: [vocabulary.mappings[0], vocabulary.mappings[0]] },
  });
  assert.equal(
    (await call("/api/team/vocabulary", { as: "Outsider" })).mappings.length,
    0,
  );
});
test("knowledge health detects duplicates and real inactivity; impact distinguishes declared and heuristic links", async () => {
  const content =
    "The canonical billing process verifies account ownership and then issues one invoice.";
  const a = await artifact("Billing one", { content, tags: ["billing"] }),
    b = await artifact("Billing two", { content, tags: ["billing"] });
  const old = await artifact("Idle draft", { tags: ["old-notes"] });
  db.prepare(
    "UPDATE artifacts SET created_at='2024-01-01T00:00:00Z',updated_at='2024-01-01T00:00:00Z' WHERE id=?",
  ).run(old.id);
  let health = await call("/api/knowledge/health");
  assert.ok(
    health.duplicates.some(
      (d) => d.artifact_ids.includes(a.id) && d.artifact_ids.includes(b.id),
    ),
  );
  assert.ok(health.stale.some((s) => s.id === old.id));
  await call("/api/artifacts/" + old.id);
  health = await call("/api/knowledge/health");
  assert.ok(!health.stale.some((s) => s.id === old.id));
  const advice = await call("/api/knowledge/health/recommendations", {
    method: "POST",
    body: {},
  });
  assert.equal(advice.applied, false);
  assert.ok(advice.suggestions.some((s) => s.action === "merge"));
  const impact = await call("/api/artifacts/" + source.id + "/impact", {
    as: "Bob",
    method: "POST",
    body: { scenario: "remove" },
  });
  assert.equal(impact.applied, false);
  assert.ok(
    impact.affected.some(
      (a) => a.id === decision.id && a.strength === "declared",
    ),
  );
  assert.ok(!JSON.stringify(impact).includes(privateSource.id));
  await call("/api/artifacts/" + privateSource.id + "/impact", {
    as: "Bob",
    method: "POST",
    body: {},
    status: 404,
  });
  await call("/api/artifacts/" + old.id + "/memory", {
    method: "PATCH",
    body: { status: "archived" },
  });
  assert.ok(!(await call("/api/artifacts")).some((a) => a.id === old.id));
});
test("intent filters and organization isolation apply consistently across new tools", async () => {
  assert.ok(
    (await call("/api/artifacts?intent=decide")).every(
      (a) => a.intent === "decide",
    ),
  );
  assert.ok(
    (
      await call("/api/search/artifacts", {
        method: "POST",
        body: { query: "pricing", intent: "decide" },
      })
    ).every((a) => a.intent === "decide"),
  );
  const outsider = await call("/api/history", { as: "Outsider" });
  assert.equal(outsider.decisions.length, 0);
  assert.equal(
    (await call("/api/concepts", { as: "Outsider" })).nodes.length,
    0,
  );
  assert.equal(
    (await call("/api/conflicts", { as: "Outsider" })).reports.length,
    0,
  );
  assert.equal(
    (await call("/api/knowledge/health", { as: "Outsider" })).analyzed,
    0,
  );
  assert.equal((await call("/api/activity", { as: "Outsider" })).length, 0);
});
test("live memory operations reject hallucinated evidence/references without partial writes; chat gets org and intent hints", async () => {
  const original = global.fetch,
    oldKey = process.env.CORTEX_AI_API_KEY;
  let output = {},
    prompts = [];
  global.fetch = async (url, options) => {
    if (!String(url).startsWith("https://api.openai.com/"))
      return original(url, options);
    const body = JSON.parse(options.body);
    if (String(url).endsWith("/embeddings"))
      return new Response(
        JSON.stringify({ data: [{ embedding: [1, 0, 0] }] }),
        { status: 200 },
      );
    prompts.push(body);
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content:
                typeof output === "string" ? output : JSON.stringify(output),
            },
          },
        ],
      }),
      { status: 200 },
    );
  };
  process.env.LLM_PROVIDER = "openai";
  process.env.CORTEX_AI_API_KEY = "mock-provider-test-only";
  try {
    const reports = db
      .prepare("SELECT count(*) n FROM conflict_reports")
      .get().n;
    output = {
      conflicts: [
        {
          summary: "Unsupported claim",
          severity: "high",
          evidence: [
            { artifact_id: source.id, quote: "An invented quote." },
            { artifact_id: decision.id, quote: "Another invented quote." },
          ],
        },
      ],
    };
    await call("/api/conflicts/detect", {
      method: "POST",
      body: { tag: "rates" },
      status: 502,
    });
    assert.equal(
      db.prepare("SELECT count(*) n FROM conflict_reports").get().n,
      reports,
    );
    const nodes = db.prepare("SELECT count(*) n FROM concepts").get().n;
    output = {
      concepts: [
        {
          key: "made-up",
          name: "Imagined concept",
          description: "Not grounded.",
          tags: ["pricing"],
          artifact_ids: ["not-a-source"],
        },
      ],
      relations: [],
    };
    await call("/api/concepts/extract", {
      method: "POST",
      body: { artifact_ids: [source.id] },
      status: 502,
    });
    assert.equal(db.prepare("SELECT count(*) n FROM concepts").get().n, nodes);
    output = {
      concepts: [
        {
          key: "one",
          name: "Same concept",
          description: "First",
          tags: [],
          artifact_ids: [source.id],
        },
        {
          key: "two",
          name: "same concept",
          description: "Second",
          tags: [],
          artifact_ids: [source.id],
        },
      ],
      relations: [
        {
          from_key: "one",
          to_key: "two",
          type: "refines",
          artifact_ids: [source.id],
        },
      ],
    };
    await call("/api/concepts/extract", {
      method: "POST",
      body: { artifact_ids: [source.id] },
      status: 502,
    });
    assert.equal(db.prepare("SELECT count(*) n FROM concepts").get().n, nodes);
    output = {
      summary: "Imagined impact",
      affected_artifact_ids: ["not-a-source"],
    };
    await call("/api/artifacts/" + source.id + "/impact", {
      method: "POST",
      body: {},
      status: 502,
    });
    output = "A subscription needs a clear owner.";
    prompts = [];
    const chat = await call("/api/agent/chat", {
      method: "POST",
      body: {
        message: "Review our membership",
        artifact_id: source.id,
        intent: "review",
        context_budget: 400,
      },
    });
    assert.ok(chat.answer.includes("plan"));
    assert.ok(chat.context_tokens <= 400);
    assert.ok(prompts[0].messages[0].content.includes("Review strengths"));
    assert.ok(
      prompts[0].messages[0].content.includes(
        "Favor small reversible changes.",
      ),
    );
    assert.equal(
      JSON.parse(prompts[0].messages.at(-1).content).message,
      "Review our subscription",
    );
  } finally {
    global.fetch = original;
    process.env.LLM_PROVIDER = "demo";
    if (oldKey === undefined) delete process.env.CORTEX_AI_API_KEY;
    else process.env.CORTEX_AI_API_KEY = oldKey;
  }
});
test("fresh demo fixtures receive stewardship and type-appropriate intent after migration", () => {
  const seeded = createApp({
    dbPath: ":memory:",
    secret: "seed-check-only",
    seed: true,
  });
  try {
    const spec = seeded.db
      .prepare(
        "SELECT intent,steward_user_id,owner_user_id FROM artifacts WHERE id='a-api'",
      )
      .get();
    assert.equal(spec.intent, "specify");
    assert.equal(spec.steward_user_id, spec.owner_user_id);
    assert.equal(
      seeded.db
        .prepare("SELECT intent FROM artifacts WHERE id='a-onboarding'")
        .get().intent,
      "handoff",
    );
  } finally {
    seeded.db.close();
  }
});
test.after(() => {
  server.close();
  db.close();
});
