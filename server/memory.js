import { randomUUID } from "node:crypto";
import { localVector, cosine } from "./ai.js";
import { fingerprint } from "./memory-db.js";
export const estimateTokens = (text) =>
  Math.ceil(Buffer.byteLength(text, "utf8") / 3);
export const contextPayload = (a) => ({
  id: a.id,
  title: a.title,
  owner: a.owner_name,
  type: a.type,
  content: a.content,
});
const parseDate = (value) =>
  new Date(value?.includes("T") ? value : value + "Z").getTime();
export const hasTag = (a, tag) =>
  !tag || a.tags.some((t) => t.toLowerCase() === tag.toLowerCase());
export function createMemory({ db, accessible, list, search, transaction }) {
  const canSee = (id, uid) => {
    try {
      return accessible(id, uid);
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  };
  function visibleSources(ids, uid) {
    const artifacts = ids.map((id) => canSee(id, uid));
    return artifacts.every(Boolean) ? artifacts : null;
  }
  function vocabulary(user) {
    const row = db
      .prepare("SELECT * FROM org_vocabulary WHERE org_id=?")
      .get(user.org_id);
    return {
      mappings: row ? JSON.parse(row.mappings) : [],
      hints: row ? JSON.parse(row.hints) : [],
      can_manage:
        db
          .prepare("SELECT owner_user_id FROM organizations WHERE id=?")
          .get(user.org_id)?.owner_user_id === user.id,
    };
  }
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  function replaceTerms(text, pairs) {
    if (!pairs.length) return text;
    const values = new Map(pairs.map(([from, to]) => [from.toLowerCase(), to]));
    const re = new RegExp(
      "(?<![\\p{L}\\p{N}_])(?:" +
        [...values.keys()]
          .sort((a, b) => b.length - a.length)
          .map(escape)
          .join("|") +
        ")(?![\\p{L}\\p{N}_])",
      "giu",
    );
    return text.replace(
      re,
      (match) => values.get(match.toLowerCase()) || match,
    );
  }
  const normalize = (text, v) =>
    replaceTerms(
      text,
      v.mappings.flatMap((m) =>
        [...m.synonyms, ...(m.preferred !== m.canonical ? [m.preferred] : [])]
          .filter((s) => s.toLowerCase() !== m.canonical.toLowerCase())
          .map((s) => [s, m.canonical]),
      ),
    );
  const denormalize = (text, v) =>
    replaceTerms(
      text,
      v.mappings
        .filter((m) => m.preferred !== m.canonical)
        .map((m) => [m.canonical, m.preferred]),
    );
  function resolveQuery(user, query, explicitId) {
    const available = list(user.id, "all"),
      lower = query.toLowerCase().replace(/’/g, "'");
    const id = query.match(
      /\bartifact(?:\s+ID)?\s+([a-f0-9]{8}-[a-f0-9-]{27,}|a-[a-z0-9_-]+|\d+)\b/i,
    )?.[1];
    const titleMatch = available
      .filter((a) => lower.includes(a.title.toLowerCase()))
      .sort((a, b) => b.title.length - a.title.length)[0];
    const primaryId = explicitId || id || titleMatch?.id;
    const users = db
      .prepare("SELECT id,name FROM users WHERE org_id=?")
      .all(user.org_id);
    const matches = (name) =>
      new RegExp(
        "(?:^|[^\\p{L}\\p{N}])" + escape(name.toLowerCase()) + "'s\\b",
        "u",
      ).test(lower);
    const full = users.filter((u) => matches(u.name)),
      first = users.filter((u) => matches(u.name.split(" ")[0]));
    return {
      owner:
        full.length === 1
          ? full[0].id
          : first.length === 1
            ? first[0].id
            : undefined,
      primary: primaryId ? accessible(primaryId, user.id) : null,
    };
  }
  function sourceStats(uid) {
    return new Map(
      db
        .prepare(
          `SELECT aa.artifact_id,COUNT(*) uses,SUM(CASE WHEN f.rating='helpful' THEN 1 ELSE 0 END) positive,SUM(CASE WHEN f.rating IN ('unhelpful','too_vague') THEN 1 ELSE 0 END) negative FROM answer_artifacts aa JOIN agent_answers a ON a.id=aa.answer_id LEFT JOIN answer_feedback f ON f.answer_id=a.id WHERE a.user_id=? GROUP BY aa.artifact_id`,
        )
        .all(uid)
        .map((r) => [r.artifact_id, r]),
    );
  }
  async function selectContext(
    user,
    query,
    { owner, primaryId, intent = "brainstorm", budget = 2400, tag, type } = {},
  ) {
    const vocab = vocabulary(user),
      normalized = normalize(query, vocab);
    let candidates = await search(user.id, normalized, "all", owner, 100, {
      tag,
      type,
    });
    if (primaryId && !candidates.some((a) => a.id === primaryId))
      candidates.unshift(accessible(primaryId, user.id));
    const stats = sourceStats(user.id),
      now = Date.now();
    const types = {
      decision: 1,
      spec: 0.85,
      handoff: 0.7,
      code_snippet: 0.65,
      idea: 0.45,
      note: 0.4,
      other: 0.3,
    };
    const ranked = candidates
      .map((a) => {
        const relevance = Math.max(
          0,
          Math.min(
            1,
            Number(a.score) ||
              cosine(
                localVector(normalized),
                localVector(normalize(a.title + " " + a.content, vocab)),
              ),
          ),
        );
        const freshness = Math.exp(
            -Math.max(0, now - parseDate(a.updated_at)) / 86400000 / 60,
          ),
          s = stats.get(a.id) || { uses: 0, positive: 0, negative: 0 };
        const usefulness =
            (0.8 * (Number(s.positive || 0) + 1)) /
              (Number(s.positive || 0) + Number(s.negative || 0) + 2) +
            0.2 * Math.min(1, Math.log1p(Number(s.uses) || 0) / Math.log(21)),
          intentMatch = a.intent === intent ? 1 : 0,
          typeValue = types[a.type] || 0.3;
        const score =
          0.55 * relevance +
          0.15 * freshness +
          0.15 * typeValue +
          0.1 * usefulness +
          0.05 * intentMatch;
        const tokens = estimateTokens(
          JSON.stringify(
            contextPayload({ ...a, content: a.content.slice(0, 3200) }),
          ),
        );
        return {
          a,
          score,
          density: score / Math.sqrt(Math.max(1, tokens) / 200),
          tokens,
          components: {
            relevance,
            freshness,
            type: typeValue,
            usefulness,
            intent: intentMatch,
          },
          uses: Number(s.uses),
          reasons: [
            `${Math.round(relevance * 100)}% retrieval relevance`,
            `${a.type} priority`,
            s.uses
              ? `${s.uses} prior context uses by you`
              : "No usefulness history; neutral prior",
            ...(intentMatch ? [`Matches ${intent} intent`] : []),
          ],
        };
      })
      .sort(
        (a, b) =>
          Number(b.a.id === primaryId) - Number(a.a.id === primaryId) ||
          b.density - a.density ||
          a.a.id.localeCompare(b.a.id),
      );
    const selected = [],
      debug = [];
    let tokens = estimateTokens("[]");
    for (const r of ranked) {
      const a = canSee(r.a.id, user.id);
      if (!a) continue;
      let chosen = { ...a, content: a.content.slice(0, 3200) },
        reason =
          a.id === primaryId
            ? "Explicit source pinned as primary context"
            : "Selected for value within the budget";
      const cost = (content) =>
        estimateTokens(
          JSON.stringify(
            [...selected, { ...chosen, content }].map(contextPayload),
          ),
        );
      if (selected.length >= 8) {
        debug.push({
          ...r,
          id: a.id,
          title: a.title,
          selected: false,
          reason: "Eight-source cap",
        });
        continue;
      }
      if (cost(chosen.content) > budget) {
        if (a.id !== primaryId) {
          debug.push({
            ...r,
            id: a.id,
            title: a.title,
            selected: false,
            reason: "Does not fit remaining token budget",
          });
          continue;
        }
        const points = [...chosen.content];
        let lo = 0,
          hi = points.length;
        while (lo < hi) {
          const mid = Math.ceil((lo + hi) / 2);
          if (cost(points.slice(0, mid).join("")) <= budget) lo = mid;
          else hi = mid - 1;
        }
        chosen.content = points.slice(0, lo).join("");
        if (cost(chosen.content) > budget)
          throw Object.assign(
            Error(
              "The primary source metadata exceeds this budget. Increase context_budget.",
            ),
            { status: 400 },
          );
        reason = "Primary source pinned; excerpt trimmed to fit";
      }
      selected.push(chosen);
      tokens = estimateTokens(JSON.stringify(selected.map(contextPayload)));
      debug.push({ ...r, id: a.id, title: a.title, selected: true, reason });
    }
    return {
      artifacts: selected,
      tokens,
      budget,
      normalized_query: normalized,
      candidates: debug.map(({ a, ...r }) => r),
      estimation:
        "Heuristic UTF-8 byte estimate / 3; artifact payload only, not a model tokenizer",
      weights: {
        relevance: 0.55,
        freshness: 0.15,
        type: 0.15,
        usefulness: 0.1,
        intent: 0.05,
      },
      candidate_limit: 100,
    };
  }
  function recordAnswer(user, artifacts, text, intent) {
    const id = randomUUID();
    transaction(() => {
      db.prepare("INSERT INTO agent_answers VALUES (?,?,?,?,?,?)").run(
        id,
        user.id,
        user.org_id,
        intent,
        text.trim().split(/\s+/u).length,
        new Date().toISOString(),
      );
      for (const a of artifacts)
        db.prepare("INSERT INTO answer_artifacts VALUES (?,?)").run(id, a.id);
    });
    return id;
  }
  function personalStyle(user) {
    const ratings = db
      .prepare(
        "SELECT f.rating,a.word_count FROM answer_feedback f JOIN agent_answers a ON a.id=f.answer_id WHERE f.user_id=? ORDER BY f.updated_at DESC LIMIT 20",
      )
      .all(user.id);
    return [
      ratings.some((r) => r.rating === "too_long")
        ? "Prefer brief answers, roughly 100–150 words unless the task requires more."
        : "",
      ratings.some((r) => r.rating === "too_vague")
        ? "Be concrete: include a specific example and an actionable next step."
        : "",
    ]
      .filter(Boolean)
      .join(" ");
  }
  function lineage(id, user) {
    const root = accessible(id, user.id),
      nodes = new Map([[root.id, root]]),
      edges = [],
      queue = [{ id: root.id, depth: 0 }],
      visited = new Set();
    let truncated = false;
    while (queue.length) {
      const next = queue.shift();
      if (visited.has(next.id)) continue;
      visited.add(next.id);
      const links = db
        .prepare(
          "SELECT l.*,u.name AS linked_by_name FROM artifact_links l JOIN users u ON u.id=l.created_by WHERE l.artifact_id=? ORDER BY l.created_at",
        )
        .all(next.id);
      for (const link of links) {
        const source = canSee(link.source_artifact_id, user.id);
        if (!source) continue;
        if (next.depth >= 8 || (!nodes.has(source.id) && nodes.size >= 50)) {
          truncated = true;
          continue;
        }
        nodes.set(source.id, source);
        edges.push({
          ...link,
          source_snapshot: JSON.parse(link.source_snapshot),
        });
        if (!visited.has(source.id))
          queue.push({ id: source.id, depth: next.depth + 1 });
      }
    }
    const people = (id) =>
      id
        ? db
            .prepare("SELECT id,name FROM users WHERE id=? AND org_id=?")
            .get(id, user.org_id) || null
        : null;
    return {
      artifact_id: id,
      recorded_by: people(root.owner_user_id),
      steward: people(root.steward_user_id),
      decided_by: people(root.decided_by_user_id),
      decided_at: root.decided_at,
      nodes: [...nodes.values()].map((a) => ({
        id: a.id,
        title: a.title,
        type: a.type,
        tags: a.tags,
        owner_name: a.owner_name,
        created_at: a.created_at,
      })),
      edges,
      truncated,
      scope:
        "Only source chains you can currently access; no hidden-source counts are returned.",
    };
  }
  function concepts(user, tag) {
    const raw = db
        .prepare(
          "SELECT * FROM concepts WHERE org_id=? ORDER BY created_at DESC LIMIT 500",
        )
        .all(user.org_id),
      nodes = [];
    for (const row of raw) {
      const ids = JSON.parse(row.artifact_ids),
        sources = visibleSources(ids, user.id),
        tags = JSON.parse(row.tags);
      if (
        !sources ||
        (tag && !tags.some((t) => t.toLowerCase() === tag.toLowerCase()))
      )
        continue;
      const versions = JSON.parse(row.source_versions),
        dependencies = visibleSources(Object.keys(versions), user.id);
      if (!dependencies) continue;
      nodes.push({
        ...row,
        tags,
        artifact_ids: ids,
        source_versions: versions,
        stale: dependencies.some((a) => versions[a.id] !== fingerprint(a)),
        sources: sources.map((a) => ({ id: a.id, title: a.title })),
        can_manage: row.created_by === user.id || vocabulary(user).can_manage,
      });
    }
    const ids = new Set(nodes.map((n) => n.id)),
      edges = db
        .prepare(
          "SELECT r.* FROM concept_relations r JOIN concepts c ON c.id=r.from_id WHERE c.org_id=?",
        )
        .all(user.org_id)
        .filter(
          (e) =>
            ids.has(e.from_id) &&
            ids.has(e.to_id) &&
            visibleSources(JSON.parse(e.evidence_artifact_ids), user.id),
        )
        .map((e) => ({
          ...e,
          evidence_artifact_ids: JSON.parse(e.evidence_artifact_ids),
        }));
    return { nodes, edges, limit: 500 };
  }
  function conflicts(user, tag) {
    return db
      .prepare(
        "SELECT * FROM conflict_reports WHERE org_id=? ORDER BY created_at DESC LIMIT 500",
      )
      .all(user.org_id)
      .filter((r) => !tag || r.topic.toLowerCase() === tag.toLowerCase())
      .flatMap((r) => {
        const versions = JSON.parse(r.source_versions),
          sources = visibleSources(Object.keys(versions), user.id);
        return sources
          ? [
              {
                ...r,
                evidence: JSON.parse(r.evidence),
                source_versions: versions,
                stale: sources.some((a) => versions[a.id] !== fingerprint(a)),
                sources: sources.map((a) => ({ id: a.id, title: a.title })),
                can_resolve:
                  r.created_by === user.id || vocabulary(user).can_manage,
              },
            ]
          : [];
      })
      .sort(
        (a, b) =>
          ({ high: 0, medium: 1, low: 2 })[a.severity] -
          { high: 0, medium: 1, low: 2 }[b.severity],
      );
  }
  function health(user, staleDays = 90) {
    const all = list(user.id, "all"),
      items = all.slice(0, 200),
      vectors = new Map(
        items.map((a) => [a.id, localVector(a.title + " " + a.content)]),
      ),
      duplicates = [];
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i],
          b = items[j],
          same =
            a.content.trim().replace(/\s+/g, " ").toLowerCase() ===
            b.content.trim().replace(/\s+/g, " ").toLowerCase();
        const similarity = cosine(vectors.get(a.id), vectors.get(b.id));
        if (
          same ||
          (similarity >= 0.9 &&
            a.tags.some((t) => b.tags.includes(t)) &&
            Math.min(a.content.length, b.content.length) /
              Math.max(a.content.length, b.content.length) >
              0.7)
        )
          duplicates.push({
            artifact_ids: [a.id, b.id],
            titles: [a.title, b.title],
            similarity: Math.round(similarity * 1000) / 1000,
            reason: same
              ? "Identical normalized content"
              : "Very similar word profiles and a shared tag",
            recommendation:
              "Review both sources and merge useful differences into a canonical spec.",
          });
      }
    const stale = items.flatMap((a) => {
      const viewed = db
        .prepare(
          "SELECT MAX(last_viewed_at) date FROM artifact_views WHERE artifact_id=?",
        )
        .get(a.id)?.date;
      const used = db
        .prepare(
          "SELECT MAX(x.created_at) date FROM answer_artifacts aa JOIN agent_answers x ON x.id=aa.answer_id WHERE aa.artifact_id=?",
        )
        .get(a.id)?.date;
      const last = Math.max(
        ...[a.updated_at, viewed, used].filter(Boolean).map(parseDate),
      );
      const days = Math.floor((Date.now() - last) / 86400000);
      return days >= staleDays
        ? [
            {
              id: a.id,
              title: a.title,
              days_idle: days,
              last_activity: new Date(last).toISOString(),
              recommendation:
                "Ask the steward whether this is still authoritative before archiving.",
            },
          ]
        : [];
    });
    const topics = new Map();
    for (const a of items)
      for (const tag of new Set(a.tags.map((t) => t.toLowerCase()))) {
        const group = topics.get(tag) || [];
        group.push(a);
        topics.set(tag, group);
      }
    return {
      duplicates: duplicates.slice(0, 30),
      stale: stale.sort((a, b) => b.days_idle - a.days_idle).slice(0, 40),
      topics: [...topics].map(([tag, docs]) => ({
        tag,
        count: docs.length,
        artifact_ids: docs.map((a) => a.id),
        coverage:
          docs.length >= 5
            ? "scattered"
            : docs.length === 1 && !["spec", "decision"].includes(docs[0].type)
              ? "thin"
              : "focused",
        recommendation:
          docs.length >= 5
            ? "Consider a canonical overview with links to supporting documents."
            : docs.length === 1
              ? "Check whether a newcomer has enough context to act."
              : "Keep the authoritative source clear.",
      })),
      analyzed: items.length,
      total_accessible: all.length,
      truncated: all.length > items.length,
      stale_days: staleDays,
      mode: "local-heuristics",
      note: "Similarity and topic counts are signals for human review, not automatic merge or archive decisions.",
    };
  }
  function impactSources(root, user) {
    const all = list(user.id, "all"),
      graph = concepts(user),
      affected = new Map(),
      queue = [root.id],
      seen = new Set();
    while (queue.length && seen.size < 50) {
      const id = queue.shift();
      if (seen.has(id)) continue;
      seen.add(id);
      for (const link of db
        .prepare("SELECT * FROM artifact_links WHERE source_artifact_id=?")
        .all(id)) {
        const a = canSee(link.artifact_id, user.id);
        if (!a || a.id === root.id) continue;
        const existing = affected.get(a.id);
        if (!existing)
          affected.set(a.id, {
            ...a,
            strength: "declared",
            reason: `Declared ${link.relation} link in the source chain`,
          });
        queue.push(a.id);
      }
    }
    for (const a of all) {
      if (a.id === root.id || affected.has(a.id)) continue;
      const mentioned =
        a.content.includes(root.id) ||
        (root.title.length >= 8 &&
          a.content.toLowerCase().includes(root.title.toLowerCase()));
      const shared = a.tags.filter((t) =>
        root.tags.some((rt) => rt.toLowerCase() === t.toLowerCase()),
      );
      if (mentioned || shared.length)
        affected.set(a.id, {
          ...a,
          strength: mentioned ? "mention" : "heuristic",
          reason: mentioned
            ? "Mentions the artifact ID or title"
            : `Shares topic ${shared.join(", ")}; a possible connection, not a confirmed dependency`,
        });
    }
    const roots = graph.nodes.filter((n) => n.artifact_ids.includes(root.id));
    for (const edge of graph.edges) {
      if (!roots.some((n) => n.id === edge.from_id || n.id === edge.to_id))
        continue;
      for (const node of graph.nodes.filter(
        (n) => n.id === edge.from_id || n.id === edge.to_id,
      ))
        for (const id of node.artifact_ids) {
          if (id === root.id || affected.has(id)) continue;
          const a = canSee(id, user.id);
          if (a)
            affected.set(id, {
              ...a,
              strength: "concept",
              reason: `Concept relationship: ${edge.type}`,
            });
        }
    }
    const sorted = [...affected.values()].sort(
      (a, b) =>
        ({ declared: 0, mention: 1, concept: 2, heuristic: 3 })[a.strength] -
        { declared: 0, mention: 1, concept: 2, heuristic: 3 }[b.strength],
    );
    return {
      affected: sorted.slice(0, 30),
      truncated: sorted.length > 30 || queue.length > 0,
    };
  }
  return {
    canSee,
    visibleSources,
    vocabulary,
    normalize,
    denormalize,
    resolveQuery,
    selectContext,
    recordAnswer,
    personalStyle,
    lineage,
    concepts,
    conflicts,
    health,
    impactSources,
  };
}
