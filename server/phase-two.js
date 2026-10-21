import { z } from "zod";
import { isLive } from "./ai.js";
import {
  onboardingPlan,
  extractDecisions,
  reviewArtifact,
} from "./phase-two-ai.js";
const roles = z.enum(["engineer", "pm", "designer", "other"]);
export function registerPhaseTwo({
  app,
  db,
  accessible,
  list,
  search,
  createArtifact,
  publicUser,
  accessSQL,
}) {
  app.patch("/api/me", (req, res) => {
    const { role } = z.object({ role: roles }).strict().parse(req.body);
    db.prepare("UPDATE users SET role=?,updated_at=? WHERE id=?").run(
      role,
      new Date().toISOString(),
      req.user.id,
    );
    res.json(
      publicUser(db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id)),
    );
  });
  app.get("/api/activity", (req, res) => {
    const { limit } = z
      .object({ limit: z.coerce.number().int().min(1).max(100).default(20) })
      .parse(req.query);
    res.json(
      db
        .prepare(
          `SELECT v.*,a.title AS artifact_title,a.type AS artifact_type,u.name AS actor_name FROM activity v JOIN artifacts a ON a.id=v.artifact_id JOIN users u ON u.id=v.actor_user_id WHERE ${accessSQL} ORDER BY julianday(v.created_at) DESC,v.rowid DESC LIMIT ?`,
        )
        .all(req.user.id, req.user.id, limit),
    );
  });
  app.post("/api/onboarding/plan", async (req, res) => {
    const { role } = z.object({ role: roles.optional() }).parse(req.body || {});
    const chosenRole = role || req.user.role || "other";
    const ranked = await search(
      req.user.id,
      `${chosenRole} getting started onboarding architecture overview process decisions`,
      "all",
    );
    const rank = new Map(
      ranked.map((a, i) => [a.id, (ranked.length - i) / ranked.length]),
    );
    const roleTopics = {
      engineer: /engineering|api|code|architecture|technical/i,
      pm: /product|strategy|research|process|decision/i,
      designer: /design|brand|experience|flow|accessibility/i,
      other: /intro|overview|onboard/i,
    };
    const candidates = list(req.user.id, "all")
      .map((a) => ({
        a,
        priority:
          (rank.get(a.id) || 0) +
          (a.type === "decision" ? 3 : 0) +
          (/intro|overview|architecture|onboard|getting.started|process/i.test(
            a.title + " " + a.tags.join(" "),
          )
            ? 4
            : 0) +
          (roleTopics[chosenRole].test(
            a.title + " " + a.type + " " + a.tags.join(" "),
          )
            ? 2
            : 0),
      }))
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 15)
      .map((x) => x.a);
    const result = await onboardingPlan(chosenRole, candidates);
    const allowed = new Set(candidates.map((a) => a.id));
    if (result.steps.some((s) => s.artifact_ids.some((id) => !allowed.has(id))))
      throw Object.assign(
        Error(
          "The AI referenced an unavailable source. Generate the plan again.",
        ),
        { status: 502 },
      );
    for (const a of candidates) accessible(a.id, req.user.id);
    res.json({
      role: chosenRole,
      steps: result.steps,
      artifacts: candidates.map((a) => ({
        id: a.id,
        title: a.title,
        type: a.type,
        owner_name: a.owner_name,
      })),
      mode: isLive() ? "openai" : "demo",
    });
  });
  app.post("/api/decisions/extract", async (req, res) => {
    const input = z
      .object({
        source_text: z.string().trim().min(10).max(30000),
        title: z.string().trim().min(1).max(180).optional(),
        visibility: z.enum(["private", "team"]).default("team"),
      })
      .parse(req.body);
    const { decisions } = await extractDecisions(input.source_text);
    if (!decisions.length)
      return res
        .status(422)
        .json({
          message:
            "No explicit decisions found. Include what was agreed or decided; tasks and open questions alone are not decisions.",
        });
    const content = decisions
      .map(
        (d, i) =>
          `### ${i + 1}. ${d.statement}\n• Rationale: ${d.rationale}\n• Areas: ${d.tags.join(", ") || "General"}`,
      )
      .join("\n\n");
    const artifact = await createArtifact(req.user.id, {
      title:
        input.title ||
        "Decisions from " + new Date().toISOString().slice(0, 10),
      content,
      type: "decision",
      visibility: input.visibility,
      tags: [
        ...new Set(["decision", ...decisions.flatMap((d) => d.tags)]),
      ].slice(0, 12),
    });
    res
      .status(201)
      .json({ ...artifact, decisions, mode: isLive() ? "openai" : "demo" });
  });
  app.post("/api/agent/review-artifact", async (req, res) => {
    const { artifact_id } = z
      .object({ artifact_id: z.string().min(1).max(100) })
      .parse(req.body);
    const artifact = accessible(artifact_id, req.user.id);
    const reviews = await reviewArtifact(artifact);
    accessible(artifact_id, req.user.id);
    res.json({ artifact_id, reviews, mode: isLive() ? "openai" : "demo" });
  });
}
