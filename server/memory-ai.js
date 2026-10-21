import { z } from "zod";
import { isLive } from "./ai.js";
import { structured } from "./phase-two-ai.js";
const ids = z.array(z.string()).min(1).max(30);
const conflictSchema = z.object({
  conflicts: z
    .array(
      z.object({
        summary: z.string().min(1).max(1500),
        severity: z.enum(["high", "medium", "low"]),
        evidence: z
          .array(
            z.object({
              artifact_id: z.string(),
              quote: z.string().min(1).max(800),
            }),
          )
          .min(2)
          .max(4),
      }),
    )
    .max(12),
});
const conceptSchema = z.object({
  concepts: z
    .array(
      z.object({
        key: z.string().min(1).max(80),
        name: z.string().min(1).max(120),
        description: z.string().min(1).max(1000),
        tags: z.array(z.string().min(1).max(40)).max(8),
        artifact_ids: ids,
      }),
    )
    .max(20),
  relations: z
    .array(
      z.object({
        from_key: z.string(),
        to_key: z.string(),
        type: z.enum(["refines", "contradicts", "depends_on"]),
        artifact_ids: ids,
      }),
    )
    .max(40),
});
const sourceData = (artifacts) =>
  artifacts.map((a) => ({
    id: a.id,
    title: a.title,
    type: a.type,
    tags: a.tags,
    content: a.content.slice(0, 4000),
  }));
export async function detectContradictions(topic, artifacts) {
  if (isLive())
    return structured(
      'Find potential contradictions in related sources. Distinguish temporal changes, different scopes, and explicit supersession from real inconsistency. Only flag consequential opposing assumptions. Return {"conflicts":[{"summary":"potential conflict and why it matters","severity":"high|medium|low","evidence":[{"artifact_id":"provided id","quote":"EXACT verbatim excerpt"}]}]}. Each report must cite at least two distinct sources with exact quotes. No contradictions means an empty list.',
      { topic, sources: sourceData(artifacts) },
      conflictSchema,
    );
  const conflicts = [];
  const statements = (a) =>
    a.content
      .split(/\n+|(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 12 && s.length <= 800)
      .map((quote) => {
        const lower = quote.toLowerCase(),
          negative = /\b(?:not|never|cannot|disabled)\b/.test(lower);
        const key = lower
          .replace(/\b(?:not|never)\b/g, "")
          .replace(/\bcannot\b/g, "can")
          .replace(/\bdisabled\b/g, "enabled")
          .replace(/\d+(?:\.\d+)?/g, "#")
          .replace(/[^\p{L}\p{N}# ]/gu, "")
          .replace(/\s+/g, " ")
          .trim();
        return {
          quote,
          key,
          negative,
          numbers: lower.match(/\d+(?:\.\d+)?/g)?.join(",") || "",
        };
      });
  for (let i = 0; i < artifacts.length; i++)
    for (let j = i + 1; j < artifacts.length; j++) {
      let found = false;
      for (const a of statements(artifacts[i]))
        for (const b of statements(artifacts[j]))
          if (
            !found &&
            a.key === b.key &&
            (a.negative !== b.negative || a.numbers !== b.numbers)
          ) {
            conflicts.push({
              summary: `Potential mismatch on ${topic}: these statements differ in ${a.negative !== b.negative ? "negation" : "numeric values"}. Confirm scope, dates, and whether a later decision supersedes the earlier source.`,
              severity:
                artifacts[i].type === "decision" ||
                artifacts[j].type === "decision"
                  ? "high"
                  : "medium",
              evidence: [
                { artifact_id: artifacts[i].id, quote: a.quote },
                { artifact_id: artifacts[j].id, quote: b.quote },
              ],
            });
            found = true;
          }
    }
  return { conflicts: conflicts.slice(0, 12) };
}
export async function extractConcepts(artifacts, links) {
  if (isLive())
    return structured(
      'Propose reusable concepts above documents, not one document-summary node per document. Return {"concepts":[{"key":"local-key","name":"...","description":"...","tags":["topic"],"artifact_ids":["provided id"]}],"relations":[{"from_key":"...","to_key":"...","type":"refines|contradicts|depends_on","artifact_ids":["supporting provided id"]}]}. Every node and relationship must be grounded in provided sources. Use relationships only when supported by the text or declared links. Avoid speculative links.',
      { sources: sourceData(artifacts), declared_links: links },
      conceptSchema,
    );
  const topics = new Map();
  for (const a of artifacts)
    for (const tag of (a.tags.length ? a.tags : ["general"]).slice(0, 6)) {
      const key = tag.toLowerCase();
      const sources = topics.get(key) || [];
      sources.push(a);
      topics.set(key, sources);
    }
  const concepts = [...topics]
    .slice(0, 20)
    .map(([tag, sources], i) => ({
      key: "topic-" + i,
      name: tag[0].toUpperCase() + tag.slice(1),
      description: `A topic index connecting ${sources.length} selected source${sources.length === 1 ? "" : "s"}. Open the sources to explore the underlying ideas.`,
      tags: [tag],
      artifact_ids: [...new Set(sources.map((a) => a.id))],
    }));
  // Demo mode never invents semantic relationships: only declared links create edges.
  const relations = [];
  for (const link of links) {
    const from = concepts.find((n) =>
        n.artifact_ids.includes(link.artifact_id),
      ),
      to = concepts.find((n) =>
        n.artifact_ids.includes(link.source_artifact_id),
      );
    if (
      from &&
      to &&
      from.key !== to.key &&
      ["refines", "contradicts", "depends_on"].includes(link.relation)
    )
      relations.push({
        from_key: from.key,
        to_key: to.key,
        type: link.relation,
        artifact_ids: [link.artifact_id, link.source_artifact_id],
      });
  }
  return { concepts, relations };
}
export async function cleanupAdvice(report) {
  if (isLive())
    return structured(
      'Suggest knowledge cleanup without making changes. Do not assume stale means wrong. Return {"suggestions":[{"action":"merge|review_archive|consolidate","artifact_ids":["provided id"],"reason":"...","proposed_title":"optional canonical title"}]}. Use only IDs from the supplied health signals. Keep recommendations conditional and prioritize stewards reviewing accuracy.',
      {
        duplicates: report.duplicates,
        stale: report.stale,
        topics: report.topics,
      },
      z.object({
        suggestions: z
          .array(
            z.object({
              action: z.enum(["merge", "review_archive", "consolidate"]),
              artifact_ids: ids,
              reason: z.string().min(1).max(1500),
              proposed_title: z.string().max(180).optional(),
            }),
          )
          .max(20),
      }),
    );
  return {
    suggestions: [
      ...report.duplicates
        .slice(0, 5)
        .map((d) => ({
          action: "merge",
          artifact_ids: d.artifact_ids,
          reason: d.recommendation,
          proposed_title: "Canonical overview: " + d.titles[0].slice(0, 140),
        })),
      ...report.stale
        .slice(0, 5)
        .map((a) => ({
          action: "review_archive",
          artifact_ids: [a.id],
          reason: a.recommendation,
        })),
      ...report.topics
        .filter((t) => t.coverage === "scattered")
        .slice(0, 5)
        .map((t) => ({
          action: "consolidate",
          artifact_ids: t.artifact_ids.slice(0, 30),
          reason: t.recommendation,
          proposed_title: t.tag + " — canonical overview",
        })),
    ],
  };
}
export async function impactSummary(root, affected, change, scenario) {
  if (isLive())
    return structured(
      'Analyze a hypothetical change or removal. Do not change any records. Separate declared dependencies from shared-topic heuristics. Summarize what might need review, not guaranteed breakage. Return {"summary":"human-readable analysis","affected_artifact_ids":["provided affected id"]}. Use only provided source facts and IDs.',
      {
        scenario,
        change,
        root: sourceData([root])[0],
        affected: affected.map((a) => ({
          ...sourceData([a])[0],
          reason: a.reason,
          strength: a.strength,
        })),
      },
      z.object({
        summary: z.string().min(1).max(8000),
        affected_artifact_ids: z.array(z.string()).max(30),
      }),
    );
  return {
    summary: affected.length
      ? `If you ${scenario === "remove" ? "remove" : "change"} “${root.title}”, review ${affected.length} accessible connected artifact${affected.length === 1 ? "" : "s"}. ${affected.filter((a) => a.strength === "declared").length} have a declared source-chain link. Other matches are mentions, concept connections, or shared-topic heuristics; they do not establish a dependency. Ask each steward to verify assumptions before making the change.`
      : "No affected artifacts were found in the accessible source chains, mentions, concepts, or tags. This is not a guarantee that there are no dependencies outside your visible workspace.",
    affected_artifact_ids: affected.map((a) => a.id),
  };
}
