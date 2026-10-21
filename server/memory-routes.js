import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { isLive } from "./ai.js";
import { intents, fingerprint } from "./memory-db.js";
import { recordActivity } from "./db.js";
import { hasTag } from "./memory.js";
import {
  detectContradictions,
  extractConcepts,
  cleanupAdvice,
  impactSummary,
} from "./memory-ai.js";
const tagSchema = z.string().trim().min(1).max(40).optional();
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fail = (message, status = 400) => {
  throw Object.assign(Error(message), { status });
};
export function registerMemoryRoutes({
  app,
  db,
  accessible,
  list,
  transaction,
  memory,
}) {
  function own(id, user) {
    const a = accessible(id, user.id);
    if (a.owner_user_id !== user.id)
      fail("Only the artifact owner can curate its memory metadata.", 403);
    return a;
  }
  function teammate(id, user) {
    const u = db
      .prepare("SELECT id FROM users WHERE id=? AND org_id=?")
      .get(id, user.org_id);
    if (!u) fail("Choose a teammate in your organization.");
    return u;
  }
  function recheck(artifacts, user) {
    for (const a of artifacts) accessible(a.id, user.id);
  }
  app.get("/api/artifacts/:id/lineage", (req, res) =>
    res.json(memory.lineage(req.params.id, req.user)),
  );
  app.post("/api/artifacts/:id/links", (req, res) => {
    const body = z
        .object({
          source_artifact_id: z.string().min(1),
          relation: z
            .enum([
              "supports",
              "depends_on",
              "refines",
              "supersedes",
              "contradicts",
            ])
            .default("supports"),
        })
        .parse(req.body),
      root = own(req.params.id, req.user),
      source = accessible(body.source_artifact_id, req.user.id);
    if (root.id === source.id) fail("An artifact cannot be its own source.");
    const queue = [source.id],
      seen = new Set();
    while (queue.length) {
      const id = queue.shift();
      if (id === root.id)
        fail("This link would create a cycle in the source chain.");
      if (seen.has(id)) continue;
      seen.add(id);
      if (seen.size > 200)
        fail("This source chain is too large to validate safely.");
      for (const link of db
        .prepare(
          "SELECT source_artifact_id FROM artifact_links WHERE artifact_id=?",
        )
        .all(id))
        queue.push(link.source_artifact_id);
    }
    const snapshot = JSON.stringify({
      title: source.title,
      content: source.content,
      updated_at: source.updated_at,
    });
    transaction(() => {
      const result = db
        .prepare("INSERT OR IGNORE INTO artifact_links VALUES (?,?,?,?,?,?,?)")
        .run(
          randomUUID(),
          root.id,
          source.id,
          body.relation,
          snapshot,
          req.user.id,
          new Date().toISOString(),
        );
      if (result.changes)
        recordActivity(db, "artifact_updated", root.id, req.user.id);
    });
    res.status(201).json(memory.lineage(root.id, req.user));
  });
  app.delete("/api/artifacts/:id/links/:linkId", (req, res) => {
    own(req.params.id, req.user);
    transaction(() => {
      const result = db
        .prepare("DELETE FROM artifact_links WHERE id=? AND artifact_id=?")
        .run(req.params.linkId, req.params.id);
      if (!result.changes) fail("Source link not found.", 404);
      recordActivity(db, "artifact_updated", req.params.id, req.user.id);
    });
    res.json({ removed: true });
  });
  app.patch("/api/artifacts/:id/memory", (req, res) => {
    const input = z
        .object({
          steward_user_id: z.string().optional(),
          decided_by_user_id: z.string().optional(),
          decided_at: z.string().datetime({ offset: true }).optional(),
          intent: z.enum(intents).optional(),
          status: z.enum(["active", "archived"]).optional(),
        })
        .strict()
        .parse(req.body),
      a = own(req.params.id, req.user);
    for (const id of [input.steward_user_id, input.decided_by_user_id].filter(
      Boolean,
    ))
      teammate(id, req.user);
    if (a.type !== "decision" && (input.decided_by_user_id || input.decided_at))
      fail("Decision attribution applies to decision artifacts.");
    const merged = { ...a, ...input };
    transaction(() => {
      db.prepare(
        "UPDATE artifacts SET steward_user_id=?,decided_by_user_id=?,decided_at=?,intent=?,status=?,updated_at=? WHERE id=?",
      ).run(
        merged.steward_user_id,
        merged.decided_by_user_id,
        merged.decided_at,
        merged.intent,
        merged.status,
        new Date().toISOString(),
        a.id,
      );
      recordActivity(db, "artifact_updated", a.id, req.user.id);
    });
    res.json(accessible(a.id, req.user.id));
  });
  app.get("/api/history", (req, res) => {
    const { tag } = z.object({ tag: tagSchema }).parse(req.query);
    const all = list(req.user.id, "all", undefined, undefined, {
      includeArchived: true,
    })
      .filter((a) => a.type === "decision" && hasTag(a, tag))
      .sort(
        (a, b) =>
          Date.parse(a.decided_at || a.created_at) -
          Date.parse(b.decided_at || b.created_at),
      );
    res.json({
      tag: tag || null,
      decisions: all
        .slice(-50)
        .map((a) => ({ ...a, lineage: memory.lineage(a.id, req.user) })),
      truncated: all.length > 50,
    });
  });
  app.get("/api/agent/context-debug", async (req, res) => {
    const q = z
      .object({
        query: z.string().trim().min(1).max(1000),
        intent: z.enum(intents).default("brainstorm"),
        budget_tokens: z.coerce.number().int().min(256).max(8000).default(2400),
        artifact_id: z.string().optional(),
        tag: tagSchema,
        type: z
          .enum([
            "note",
            "idea",
            "spec",
            "decision",
            "handoff",
            "other",
            "code_snippet",
          ])
          .optional(),
      })
      .parse(req.query);
    const { owner, primary } = memory.resolveQuery(
        req.user,
        q.query,
        q.artifact_id,
      ),
      result = await memory.selectContext(req.user, q.query, {
        owner,
        primaryId: primary?.id,
        intent: q.intent,
        budget: q.budget_tokens,
        tag: q.tag,
        type: q.type,
      });
    res.json({
      ...result,
      artifacts: result.artifacts.map((a) => ({
        id: a.id,
        title: a.title,
        type: a.type,
        intent: a.intent,
        excerpt: a.content,
      })),
      side_effects:
        "Does not record answer usage or feedback. Live mode may refresh embeddings.",
    });
  });
  app.post("/api/agent/feedback", (req, res) => {
    const input = z
      .object({
        answer_id: z.string().min(1),
        rating: z.enum(["helpful", "unhelpful", "too_long", "too_vague"]),
      })
      .parse(req.body);
    if (
      !db
        .prepare(
          "SELECT id FROM agent_answers WHERE id=? AND user_id=? AND org_id=?",
        )
        .get(input.answer_id, req.user.id, req.user.org_id)
    )
      fail("Answer not found.", 404);
    db.prepare(
      "INSERT INTO answer_feedback VALUES (?,?,?,?) ON CONFLICT(answer_id) DO UPDATE SET rating=excluded.rating,updated_at=excluded.updated_at",
    ).run(input.answer_id, req.user.id, input.rating, new Date().toISOString());
    res.json({ answer_id: input.answer_id, rating: input.rating, saved: true });
  });
  app.get("/api/team/preferences", (req, res) => {
    const visible = list(req.user.id, "all"),
      ids = new Set(visible.map((a) => a.id));
    const lengths = db
      .prepare(
        "SELECT a.word_count,f.rating FROM agent_answers a JOIN answer_feedback f ON f.answer_id=a.id WHERE a.org_id=?",
      )
      .all(req.user.org_id);
    const preferred = lengths
        .filter((r) => r.rating === "helpful" || r.rating === "too_long")
        .map((r) =>
          r.rating === "too_long"
            ? Math.max(60, Math.round(r.word_count * 0.6))
            : r.word_count,
        )
        .sort((a, b) => a - b),
      mid = Math.floor(preferred.length / 2);
    const median = preferred.length
      ? preferred.length % 2
        ? preferred[mid]
        : (preferred[mid - 1] + preferred[mid]) / 2
      : 150;
    const stats = db
      .prepare(
        "SELECT aa.artifact_id,COUNT(*) uses FROM answer_artifacts aa JOIN agent_answers a ON a.id=aa.answer_id WHERE a.org_id=? GROUP BY aa.artifact_id ORDER BY uses DESC",
      )
      .all(req.user.org_id)
      .filter((r) => ids.has(r.artifact_id))
      .slice(0, 8)
      .map((r) => ({
        ...r,
        title: visible.find((a) => a.id === r.artifact_id).title,
      }));
    const tags = new Map();
    for (const a of visible)
      for (const t of a.tags) tags.set(t, (tags.get(t) || 0) + 1);
    res.json({
      median_preferred_answer_words: median,
      feedback_count: lengths.length,
      common_tags: [...tags]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([tag, count]) => ({ tag, count })),
      often_used_artifacts: stats,
      style_hint: memory.personalStyle(req.user),
      scope:
        "Preference lengths aggregate within your organization; tags and artifact titles are restricted to your current access.",
    });
  });
  app.get("/api/team/vocabulary", (req, res) =>
    res.json(memory.vocabulary(req.user)),
  );
  app.put("/api/team/vocabulary", (req, res) => {
    if (!memory.vocabulary(req.user).can_manage)
      fail("Only the organization owner can change team terminology.", 403);
    const term = z.string().trim().min(2).max(60);
    const body = z
      .object({
        mappings: z
          .array(
            z.object({
              canonical: term,
              preferred: term,
              synonyms: z.array(term).max(12),
            }),
          )
          .max(40),
        hints: z.array(z.string().trim().min(1).max(200)).max(8).default([]),
      })
      .strict()
      .parse(req.body);
    if (
      new Set(body.mappings.map((m) => m.canonical.toLowerCase())).size !==
      body.mappings.length
    )
      fail("Each canonical term needs one mapping row.", 409);
    const owners = new Map();
    for (const m of body.mappings)
      for (const word of [m.canonical, m.preferred, ...m.synonyms]) {
        const key = word.toLowerCase();
        if (owners.has(key) && owners.get(key) !== m.canonical.toLowerCase())
          fail("A term cannot belong to more than one canonical concept.", 409);
        owners.set(key, m.canonical.toLowerCase());
      }
    db.prepare(
      "INSERT INTO org_vocabulary VALUES (?,?,?,?,?) ON CONFLICT(org_id) DO UPDATE SET mappings=excluded.mappings,hints=excluded.hints,updated_by=excluded.updated_by,updated_at=excluded.updated_at",
    ).run(
      req.user.org_id,
      JSON.stringify(body.mappings),
      JSON.stringify(body.hints),
      req.user.id,
      new Date().toISOString(),
    );
    res.json(memory.vocabulary(req.user));
  });
  app.get("/api/organization", (req, res) =>
    res.json({
      ...db
        .prepare("SELECT id,name,owner_user_id FROM organizations WHERE id=?")
        .get(req.user.org_id),
      shared_spaces: "Design only; cross-organization access is not enabled.",
    }),
  );
  app.get("/api/conflicts", (req, res) => {
    const q = z
      .object({
        tag: tagSchema,
        status: z.enum(["open", "resolved", "all"]).default("open"),
      })
      .parse(req.query);
    res.json({
      reports: memory
        .conflicts(req.user, q.tag)
        .filter((r) => q.status === "all" || r.status === q.status),
      mode: isLive() ? "openai" : "demo",
    });
  });
  app.post("/api/conflicts/detect", async (req, res) => {
    const { tag } = z.object({ tag: tagSchema }).parse(req.body || {}),
      all = list(req.user.id, "all").filter((a) => hasTag(a, tag)),
      groups = new Map();
    for (const a of all)
      for (const topic of tag ? [tag] : a.tags.map((t) => t.toLowerCase())) {
        const group = groups.get(topic) || [];
        group.push(a);
        groups.set(topic, group);
      }
    const eligible = [...groups]
        .filter(([, sources]) => sources.length >= 2)
        .sort((a, b) => b[1].length - a[1].length),
      selected = eligible.slice(0, 6),
      prepared = [],
      analyzed = [];
    for (const [topic, group] of selected) {
      const sources = group.slice(0, 8);
      analyzed.push(...sources);
      recheck(sources, req.user);
      const result = await detectContradictions(topic, sources);
      recheck(sources, req.user);
      for (const report of result.conflicts) {
        const ids = new Set(report.evidence.map((e) => e.artifact_id));
        if (
          ids.size < 2 ||
          report.evidence.some(
            (e) =>
              !sources.some(
                (a) => a.id === e.artifact_id && a.content.includes(e.quote),
              ),
          )
        )
          fail(
            "The AI returned unsupported conflict evidence. No reports were saved.",
            502,
          );
        const versions = Object.fromEntries(
          sources.map((a) => [a.id, fingerprint(a)]),
        );
        prepared.push({
          ...report,
          topic,
          versions,
          signature: hash([
            req.user.org_id,
            topic,
            Object.entries(versions).sort(),
            [...report.evidence].sort((a, b) =>
              (a.artifact_id + a.quote).localeCompare(b.artifact_id + b.quote),
            ),
          ]),
        });
      }
    }
    recheck(analyzed, req.user);
    // All model calls finish and validate before any report is persisted.
    transaction(() => {
      for (const r of prepared)
        db.prepare(
          "INSERT OR IGNORE INTO conflict_reports(id,org_id,topic,severity,summary,evidence,source_versions,signature,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        ).run(
          randomUUID(),
          req.user.org_id,
          r.topic,
          r.severity,
          r.summary,
          JSON.stringify(r.evidence),
          JSON.stringify(r.versions),
          r.signature,
          req.user.id,
          new Date().toISOString(),
        );
    });
    res.json({
      reports: memory
        .conflicts(req.user, tag)
        .filter((r) => r.status === "open"),
      analyzed_topics: selected.length,
      eligible_topics: eligible.length,
      max_sources_per_topic: 8,
      truncated:
        eligible.length > 6 ||
        selected.some(([, sources]) => sources.length > 8),
      mode: isLive() ? "openai" : "demo",
      note: "Potential contradictions need human review. Demo mode detects only matching sentence structures with opposing negation or numeric values.",
    });
  });
  app.patch("/api/conflicts/:id", (req, res) => {
    const { status } = z
      .object({ status: z.enum(["open", "resolved"]) })
      .parse(req.body);
    const report = memory
      .conflicts(req.user)
      .find((r) => r.id === req.params.id);
    if (!report) fail("Conflict report not found.", 404);
    if (!report.can_resolve)
      fail(
        "Only its creator or the organization owner can change report status.",
        403,
      );
    db.prepare("UPDATE conflict_reports SET status=? WHERE id=?").run(
      status,
      report.id,
    );
    res.json({ ...report, status });
  });
  app.get("/api/concepts", (req, res) => {
    const { tag } = z.object({ tag: tagSchema }).parse(req.query);
    res.json({
      ...memory.concepts(req.user, tag),
      mode: isLive() ? "openai" : "demo",
    });
  });
  app.post("/api/concepts/extract", async (req, res) => {
    const { artifact_ids } = z
      .object({ artifact_ids: z.array(z.string().min(1)).min(1).max(12) })
      .parse(req.body);
    const sources = [...new Set(artifact_ids)].map((id) =>
        accessible(id, req.user.id),
      ),
      ids = new Set(sources.map((a) => a.id));
    const links = db
      .prepare(
        "SELECT artifact_id,source_artifact_id,relation FROM artifact_links",
      )
      .all()
      .filter((l) => ids.has(l.artifact_id) && ids.has(l.source_artifact_id));
    const result = await extractConcepts(sources, links),
      keys = new Set(result.concepts.map((c) => c.key));
    if (
      keys.size !== result.concepts.length ||
      new Set(result.concepts.map((n) => n.name.trim().toLowerCase())).size !==
        result.concepts.length ||
      result.concepts.some((n) => n.artifact_ids.some((id) => !ids.has(id))) ||
      result.relations.some(
        (e) =>
          !keys.has(e.from_key) ||
          !keys.has(e.to_key) ||
          e.from_key === e.to_key ||
          e.artifact_ids.some((id) => !ids.has(id)),
      )
    )
      fail(
        "The AI returned unsupported concept references. No graph was saved.",
        502,
      );
    recheck(sources, req.user);
    const versions = Object.fromEntries(
        sources.map((a) => [a.id, fingerprint(a)]),
      ),
      saved = new Map();
    transaction(() => {
      for (const n of result.concepts) {
        const signature = hash([
            req.user.org_id,
            n.name.toLowerCase(),
            versions,
          ]),
          id = randomUUID();
        db.prepare(
          "INSERT OR IGNORE INTO concepts VALUES (?,?,?,?,?,?,?,?,?,?)",
        ).run(
          id,
          req.user.org_id,
          n.name,
          n.description,
          JSON.stringify(n.tags),
          JSON.stringify([...new Set(n.artifact_ids)]),
          JSON.stringify(versions),
          signature,
          req.user.id,
          new Date().toISOString(),
        );
        saved.set(
          n.key,
          db.prepare("SELECT id FROM concepts WHERE signature=?").get(signature)
            .id,
        );
      }
      for (const edge of result.relations)
        db.prepare(
          "INSERT OR IGNORE INTO concept_relations VALUES (?,?,?,?,?)",
        ).run(
          randomUUID(),
          saved.get(edge.from_key),
          saved.get(edge.to_key),
          edge.type,
          JSON.stringify(edge.artifact_ids),
        );
    });
    res.status(201).json({
      ...memory.concepts(req.user),
      mode: isLive() ? "openai" : "demo",
      note: isLive()
        ? "Proposed concepts; verify against the source documents."
        : "Demo builds a tag-based topic index; only declared links become relationships.",
    });
  });
  app.get("/api/knowledge/health", (req, res) => {
    const { stale_days } = z
      .object({
        stale_days: z.coerce.number().int().min(30).max(3650).default(90),
      })
      .parse(req.query);
    res.json(memory.health(req.user, stale_days));
  });
  app.post("/api/knowledge/health/recommendations", async (req, res) => {
    const sources = list(req.user.id, "all"),
      report = memory.health(req.user),
      result = await cleanupAdvice(report);
    if (
      result.suggestions.some((s) =>
        s.artifact_ids.some((id) => !sources.some((a) => a.id === id)),
      )
    )
      fail("The AI returned an unavailable cleanup source.", 502);
    recheck(sources, req.user);
    res.json({ ...result, mode: isLive() ? "openai" : "demo", applied: false });
  });
  app.post("/api/artifacts/:id/impact", async (req, res) => {
    const { change, scenario } = z
        .object({
          change: z
            .string()
            .trim()
            .max(2000)
            .default("Explore the impact of changing this source."),
          scenario: z.enum(["change", "remove"]).default("change"),
        })
        .parse(req.body || {}),
      root = accessible(req.params.id, req.user.id),
      { affected, truncated } = memory.impactSources(root, req.user),
      result = await impactSummary(root, affected, change, scenario);
    if (
      result.affected_artifact_ids.some(
        (id) => !affected.some((a) => a.id === id),
      )
    )
      fail("The AI returned unsupported impact references.", 502);
    recheck([root, ...affected], req.user);
    res.json({
      artifact_id: root.id,
      ...result,
      affected: affected.map((a) => ({
        id: a.id,
        title: a.title,
        type: a.type,
        reason: a.reason,
        strength: a.strength,
      })),
      truncated,
      mode: isLive() ? "openai" : "demo",
      applied: false,
    });
  });
}
