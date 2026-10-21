import { test, expect } from "@playwright/test";
test("Phase 2: role, onboarding progress, decisions, review, feed, and persistent dark mode", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Explore as Alex" }).click();
  await expect(
    page.getByRole("heading", { name: "Good things start with a thought." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page
    .getByRole("button", { name: /Alex Morgan Personal account/ })
    .click();
  await page.getByRole("button", { name: "Settings & AI" }).click();
  let dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Your role", { exact: true })
    .selectOption("engineer");
  await dialog.getByRole("button", { name: "Save role" }).click();
  await expect(dialog.getByRole("status")).toContainText("All set.");
  await dialog.getByRole("button", { name: "System", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "System", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("button", { name: "Dark", exact: true }).click();
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: /^Onboarding/ }).click();
  await expect(
    page.getByText("Your engineer path", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Mark step 1 complete", exact: true })
    .click();
  await expect(page.getByText(/1 of \d+ complete/)).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Good things start with a thought." }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Onboarding/ }).click();
  await expect(
    page.getByRole("button", { name: "Mark step 1 incomplete", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({
    path: "test-results/cortex-dark-onboarding.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "My Agent", exact: false })
    .first()
    .click();
  await page.getByRole("button", { name: "Capture decisions" }).click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("A name for this conversation")
    .fill("Phase 2 launch decisions");
  await dialog
    .getByLabel("Meeting notes or transcript")
    .fill(
      "Decision: We will use single-use invitation tokens.\nWe agreed to expire invitations after seven days.\nTODO: Sam will write a draft.",
    );
  await dialog
    .getByRole("button", { name: "Extract decisions", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", {
      name: "Phase 2 launch decisions",
      exact: true,
    }),
  ).toBeVisible();
  await expect(dialog.getByText("Visible to all team members.")).toBeVisible();
  await dialog.getByRole("button", { name: "Multi-Agent Review" }).click();
  await expect(
    dialog.getByText("The architect", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText("The product thinker", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText("The engineer", { exact: true })).toBeVisible();
  await expect(dialog.locator(".review-card")).toHaveCount(3);
  await page.screenshot({
    path: "test-results/cortex-dark-review.png",
    fullPage: true,
  });
  await dialog
    .getByRole("textbox", { name: "Add a comment" })
    .fill("The expiry decision is ready for engineering.");
  await dialog
    .getByRole("button", { name: "Add comment", exact: true })
    .click();
  await expect(
    dialog.getByText("The expiry decision is ready for engineering.", {
      exact: true,
    }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Good thinking travels." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: /Alex Morgan commented on an artifact.*Phase 2 launch decisions/,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: /Alex Morgan created an artifact.*Phase 2 launch decisions/,
    })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("heading", { name: "Phase 2 launch decisions", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close dialog" })
    .click();
  await page.getByRole("button", { name: /^Artifacts/ }).click();
  await page
    .getByRole("textbox", { name: "Search artifacts" })
    .fill("single-use invitation");
  await expect(
    page.getByRole("heading", {
      name: "Phase 2 launch decisions",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.screenshot({
    path: "test-results/cortex-light-library.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: /^Onboarding/ }).click();
  await expect(
    page.getByRole("heading", { name: "Find your footing." }),
  ).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await expect
    .poll(async () => {
      const b = await page.locator(".sidebar").boundingBox();
      return b.x + b.width;
    })
    .toBeLessThanOrEqual(1);
  await page.screenshot({
    path: "test-results/cortex-dark-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("theme follows the operating system until the user chooses an override", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await page.emulateMedia({ colorScheme: "light" });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
