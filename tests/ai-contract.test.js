import test from "node:test";
import assert from "node:assert/strict";
import { answer } from "../server/ai.js";
import {
  onboardingPlan,
  extractDecisions,
  reviewArtifact,
} from "../server/phase-two-ai.js";
const originalFetch = global.fetch;
const source = {
  id: "source-id",
  title: "Architecture guide",
  content: "The API checks access before retrieval.",
  type: "spec",
  tags: ["architecture"],
  owner_name: "Alice",
};
const calls = [];
function modelResponse(content) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
test("live AI adapter contracts use validated JSON, role hints, source metadata, and independent review prompts", async (t) => {
  process.env.LLM_PROVIDER = "openai";
  process.env.CORTEX_AI_API_KEY = "not-a-real-key-test-only";
  try {
    await t.test(
      "onboarding requests structured role-aware steps",
      async () => {
        calls.length = 0;
        global.fetch = async (url, options) => {
          assert.equal(url, "https://api.openai.com/v1/chat/completions");
          calls.push(JSON.parse(options.body));
          return modelResponse(
            JSON.stringify({
              steps: [
                {
                  title: "Read the architecture",
                  description: "Read the guide and map one boundary.",
                  artifact_ids: ["source-id"],
                },
              ],
            }),
          );
        };
        const result = await onboardingPlan("engineer", [source]);
        assert.equal(result.steps[0].artifact_ids[0], source.id);
        assert.equal(calls[0].response_format.type, "json_object");
        assert.match(calls[0].messages[0].content, /engineer/);
        assert.equal(
          JSON.parse(calls[0].messages[1].content).artifacts[0].id,
          source.id,
        );
      },
    );
    await t.test(
      "decision JSON is validated and malformed model output fails clearly",
      async () => {
        global.fetch = async () =>
          modelResponse(
            JSON.stringify({
              decisions: [
                {
                  statement: "Use SQLite.",
                  rationale: "A single service is enough for the MVP.",
                  tags: ["database"],
                },
              ],
            }),
          );
        assert.equal(
          (await extractDecisions("We decided to use SQLite.")).decisions[0]
            .tags[0],
          "database",
        );
        global.fetch = async () => modelResponse("This is not JSON.");
        await assert.rejects(
          () => extractDecisions("Meeting notes"),
          (e) => e.status === 502,
        );
        global.fetch = async () =>
          modelResponse(
            JSON.stringify({
              steps: [
                {
                  title: "Missing artifact reference",
                  description: "Read something",
                },
              ],
            }),
          );
        await assert.rejects(
          () => onboardingPlan("pm", [source]),
          (e) => e.status === 502,
        );
      },
    );
    await t.test(
      "review sends full content to three distinct personas without changing the artifact",
      async () => {
        calls.length = 0;
        global.fetch = async (url, options) => {
          calls.push(JSON.parse(options.body));
          return modelResponse(
            "### Strengths\nClear access boundary.\n### Risks\nTest permission revocation.\n### Suggestions\nAdd a regression case.",
          );
        };
        const reviews = await reviewArtifact(source);
        assert.equal(calls.length, 3);
        assert.deepEqual(
          reviews.map((r) => r.role),
          ["architect", "product", "dev"],
        );
        assert.equal(new Set(calls.map((c) => c.messages[0].content)).size, 3);
        assert.ok(
          calls.every(
            (c) => JSON.parse(c.messages[1].content).content === source.content,
          ),
        );
      },
    );
    await t.test(
      "chat applies role tone and reports provider failures rather than silently using demo mode",
      async () => {
        calls.length = 0;
        global.fetch = async (url, options) => {
          calls.push(JSON.parse(options.body));
          return modelResponse("Read Architecture guide by Alice.");
        };
        await answer("What should I build?", [source], [], "designer");
        assert.match(calls[0].messages[0].content, /Optimize for a designer/);
        assert.equal(
          JSON.parse(calls[0].messages[1].content).relevant_artifacts[0].owner,
          "Alice",
        );
        global.fetch = async () => new Response("{}", { status: 429 });
        await assert.rejects(
          () => reviewArtifact(source),
          (e) => e.status === 502 && e.message.includes("429"),
        );
      },
    );
  } finally {
    global.fetch = originalFetch;
    delete process.env.CORTEX_AI_API_KEY;
    process.env.LLM_PROVIDER = "demo";
  }
});
