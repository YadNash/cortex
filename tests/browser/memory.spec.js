import { test, expect } from "@playwright/test";
test("organizational memory journey: lineage, intent, feedback, conflicts, concepts, context, vocabulary and impact", async ({
  page,
  request,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const auth = await request.post("/auth/login", {
    data: { email: "alex@cortex.demo", password: "CortexDemo2026!" },
  });
  const { token } = await auth.json();
  const headers = { Authorization: "Bearer " + token };
  async function create(data) {
    const r = await request.post("/api/artifacts", {
      headers,
      data: {
        visibility: "team",
        tags: ["pricing-browser"],
        type: "spec",
        ...data,
      },
    });
    expect(r.status()).toBe(201);
    return r.json();
  }
  const source = await create({
    title: "Pricing research browser",
    content: "The monthly price is 10 USD.",
    type: "note",
  });
  const decision = await create({
    title: "Pricing policy browser",
    content: "The monthly price is 20 USD.",
    type: "decision",
  });
  await create({
    title: "Duplicate guide one",
    content:
      "A canonical billing process validates account ownership before issuing an invoice.",
    tags: ["billing-duplicates"],
  });
  await create({
    title: "Duplicate guide two",
    content:
      "A canonical billing process validates account ownership before issuing an invoice.",
    tags: ["billing-duplicates"],
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Explore as Alex" }).click();
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await page.getByRole("button", { name: /^Artifacts/ }).click();
  await page
    .getByRole("heading", { name: decision.title, exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  await dialog.getByText("Curate sources & ownership", { exact: true }).click();
  await dialog.getByLabel("Link a source").selectOption(source.id);
  await dialog
    .getByRole("button", { name: "Link source", exact: true })
    .click();
  await expect(
    dialog.getByText("Source linked. Its current version is preserved."),
  ).toBeVisible();
  await dialog.getByLabel("Knowledge steward").selectOption("demo-jamie");
  await dialog.getByRole("button", { name: "Save ownership" }).click();
  await expect(dialog.locator(".provenance-grid")).toContainText("Jamie Chen");
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: /^My Agent/ }).click();
  await page.getByLabel("Agent intent").selectOption("review");
  await page
    .getByRole("textbox", { name: "Message your agent" })
    .fill("Review Pricing policy browser");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.getByRole("button", { name: "Helpful", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Helpful", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "Save as artifact", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Artifact workflow intent")).toHaveValue(
    "review",
  );
  await dialog.getByLabel("Give it a name").fill("Pricing review browser");
  await dialog
    .getByRole("button", { name: "Save artifact", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: /^Knowledge/ }).click();
  await page.getByLabel("Knowledge topic tag").fill("pricing-browser");
  await page.getByRole("button", { name: "Explore topic" }).click();
  await expect(
    page.getByRole("button", { name: decision.title, exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Conflicts", exact: true }).click();
  await page.getByRole("button", { name: "Check for conflicts" }).click();
  await expect(page.locator(".conflict-card").first()).toBeVisible();
  await expect(page.locator(".conflict-card").first()).toContainText(
    "high impact",
  );
  await expect(page.locator(".conflict-card").first()).toContainText("10 USD");
  await page.getByRole("tab", { name: "Idea map", exact: true }).click();
  await page
    .getByText("Propose concepts from artifacts", { exact: true })
    .click();
  await page.getByRole("checkbox", { name: source.title, exact: true }).check();
  await page
    .getByRole("checkbox", { name: decision.title, exact: true })
    .check();
  await page
    .getByRole("button", { name: "Extract concepts", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Pricing-browser", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("tab", { name: "Knowledge health", exact: true })
    .click();
  await page.getByRole("button", { name: "Suggest cleanup" }).click();
  await expect(
    page.getByRole("heading", { name: "A few considered next steps." }),
  ).toBeVisible();
  await expect(page.locator(".cleanup-advice")).toContainText(
    "Canonical overview",
  );
  await page.getByRole("tab", { name: "Context lab", exact: true }).click();
  await page
    .getByLabel("The question", { exact: true })
    .fill("Summarize Pricing policy browser");
  await page.getByLabel("Artifact token budget").fill("320");
  await page.getByRole("button", { name: "Explain context selection" }).click();
  await expect(page.locator(".budget-summary")).toContainText("/ 320");
  await expect(
    page.locator(".context-candidate.selected").first(),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/cortex-memory-context.png",
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Team profile", exact: true }).click();
  await page.getByRole("button", { name: "Add a term", exact: true }).click();
  await page
    .getByLabel("Canonical term 1", { exact: true })
    .fill("subscription");
  await page.getByLabel("Preferred term 1", { exact: true }).fill("plan");
  await page.getByLabel("Synonyms 1", { exact: true }).fill("membership");
  await page.getByRole("button", { name: "Save team vocabulary" }).click();
  await expect(
    page.getByText("Team vocabulary saved.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Decision memory", exact: true }).click();
  await page.getByRole("button", { name: decision.title, exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Explore impact" }).click();
  await dialog
    .getByLabel("The change you’re considering")
    .fill("Change the price from 20 USD to 30 USD.");
  await dialog
    .getByRole("button", { name: "Analyze impact", exact: true })
    .click();
  await expect(dialog.locator(".impact-result")).toBeVisible();
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await expect
    .poll(async () => {
      const box = await page.locator(".sidebar").boundingBox();
      return box.x + box.width;
    })
    .toBeLessThanOrEqual(1);
  await page.screenshot({
    path: "test-results/cortex-memory-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
