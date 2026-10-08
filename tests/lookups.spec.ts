import { expect, test, type Page, type Route } from "@playwright/test";

const translation = (text: string) => ({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ translation: text, lemma: "opbellen", partOfSpeech: "verb", explanation: "In context." }) }] }] });
async function openReader(page: Page, ignoreAbort = false) {
  await page.addInitScript(({ ignoreAbort }) => {
    localStorage.setItem("subdiver.settings", JSON.stringify({ apiKey: "test-only", model: "gpt-4.1-mini", targetLanguage: "English" }));
    if (ignoreAbort) {
      // Even if transport ignores abort or has already completed, stale results
      // must not affect the UI. Exercise that path deliberately.
      const originalFetch = window.fetch;
      window.fetch = (input, init) => originalFetch(input, String(input).includes("api.openai.com/v1/responses") ? { ...init, signal: undefined } : init);
    }
  }, { ignoreAbort });
  await page.goto("/");
  await page.getByLabel("Upload a book or subtitles").setInputFiles({ name: "lookups.srt", mimeType: "text/plain", buffer: Buffer.from("1\n00:00:01,000 --> 00:00:03,000\nHij belt mij op. Ik lees een boek.\n\n2\n00:00:04,000 --> 00:00:06,000\nWij lezen samen.\n") });
}

for (const outcome of ["success", "error"] as const) {
  for (const destination of ["new request", "cached request", "closed card"] as const) {
    test(`obsolete ${outcome} cannot replace ${destination}`, async ({ page }) => {
      let oldRoute: Route | undefined;
      await page.route("https://api.openai.com/v1/responses", async (route) => {
        const prompt = route.request().postDataJSON().input as string;
        if (prompt.includes("Selected text: belt\n")) { oldRoute = route; return; }
        await route.fulfill({ json: translation("Current translation") });
      });
      await openReader(page, true);
      const sentence = page.getByRole("button", { name: "Translate this sentence" }).nth(1);
      if (destination === "cached request") {
        await sentence.click();
        await expect(page.getByRole("dialog", { name: "Translation" })).toContainText("Current translation");
        await page.getByRole("button", { name: "Close translation" }).click();
      }
      await page.locator(".word-token").filter({ hasText: /^belt$/ }).click();
      await expect.poll(() => Boolean(oldRoute)).toBe(true);
      if (destination === "closed card") {
        await page.getByRole("button", { name: "Close translation" }).click();
      } else {
        await sentence.click();
        await expect(page.getByRole("dialog", { name: "Translation" })).toContainText("Current translation");
        if (destination === "cached request") await expect(page.getByRole("dialog", { name: "Translation" })).toContainText("cached");
      }
      const response = page.waitForResponse((res) => res.url().includes("api.openai.com/v1/responses"));
      await oldRoute!.fulfill(outcome === "success" ? { json: translation("Obsolete translation") } : { status: 500, json: { error: { message: "Obsolete error" } } });
      await (await response).finished();
      if (destination === "closed card") {
        await expect(page.getByRole("dialog", { name: "Translation" })).toHaveCount(0);
      } else {
        await expect(page.getByRole("dialog", { name: "Translation" })).toContainText("Current translation");
        await expect(page.getByRole("dialog", { name: "Translation" })).not.toContainText("Obsolete");
      }
    });
  }
}

test("selection clears and subsequent sentence and word clicks use the current target", async ({ page }) => {
  const prompts: string[] = [];
  await page.route("https://api.openai.com/v1/responses", async (route) => {
    prompts.push(route.request().postDataJSON().input);
    await route.fulfill({ json: translation("Current translation") });
  });
  await openReader(page);
  const word = page.locator(".word-token").filter({ hasText: /^belt$/ });
  await word.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  });
  await word.dispatchEvent("mouseup");
  // The trailing click of selecting text must not issue another word request.
  await word.dispatchEvent("click");
  await expect(page.getByRole("dialog", { name: "Translation" })).toContainText("selection");
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe("");
  await page.getByRole("button", { name: "Translate this sentence" }).nth(0).click();
  await expect(page.getByRole("dialog", { name: "Translation" })).toContainText("sentence");
  await expect.poll(() => prompts.at(-1)).toContain("Selected sentence: Hij belt mij op.");
  await page.getByRole("button", { name: "Translate this sentence" }).nth(1).click();
  await expect(page.getByRole("dialog", { name: "Translation" })).toContainText("Ik lees een boek.");
  await expect.poll(() => prompts.at(-1)).toContain("Selected sentence: Ik lees een boek.");
  await page.locator(".word-token").filter({ hasText: /^Wij$/ }).click();
  await expect(page.getByRole("dialog", { name: "Translation" })).toContainText("word");
  await expect.poll(() => prompts.at(-1)).toContain("Selected text: Wij\n");
  expect(prompts).toHaveLength(4);
});

for (const gesture of ["same passage", "multiple passages", "backwards"] as const) {
  test(`dragging across multiple sentences translates the entire selection once: ${gesture}`, async ({ page }) => {
    const crossesPassages = gesture !== "same passage";
    const selected = `Hij belt mij op. Ik lees een boek.${crossesPassages ? " Wij lezen samen." : ""}`;
    const translated = `He calls me. I read a book.${crossesPassages ? " We read together." : ""}`;
    const prompts: string[] = [];
    await page.route("https://api.openai.com/v1/responses", async (route) => {
      prompts.push(route.request().postDataJSON().input);
      await route.fulfill({ json: translation(translated) });
    });
    await openReader(page);
    const first = await page.locator(".word-token").filter({ hasText: /^Hij$/ }).boundingBox();
    const last = await page.locator(".word-token").filter({ hasText: crossesPassages ? /^samen$/ : /^boek$/ }).boundingBox();
    const start = { x: first!.x - 1, y: first!.y + first!.height / 2 };
    const end = { x: last!.x + last!.width + 8, y: last!.y + last!.height / 2 };
    const [from, to] = gesture === "backwards" ? [end, start] : [start, end];
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 20 });
    await page.mouse.up();
    const panel = page.getByRole("dialog", { name: "Translation" });
    await expect(panel).toContainText(translated);
    await expect(panel).toContainText(selected);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain(`Selected text: ${selected}\n`);
    expect(prompts[0]).toContain(`Surrounding passage: ${selected}\n`);
    expect(prompts[0]).not.toContain("00:");
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe("");
  });
}

test("changing targets and closing the card abort the previous HTTP requests", async ({ page }) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch;
    (window as typeof window & { aborts: number }).aborts = 0;
    window.fetch = (input, init) => {
      if (String(input).includes("api.openai.com/v1/responses")) {
        init?.signal?.addEventListener("abort", () => { (window as typeof window & { aborts: number }).aborts += 1; });
      }
      return originalFetch(input, init);
    };
  });
  const pendingRoutes: Route[] = [];
  await page.route("https://api.openai.com/v1/responses", (route) => { pendingRoutes.push(route); });
  await openReader(page);
  await page.locator(".word-token").filter({ hasText: /^belt$/ }).click();
  await expect.poll(() => pendingRoutes.length).toBe(1);
  await page.getByRole("button", { name: "Translate this sentence" }).nth(1).click();
  await expect.poll(() => pendingRoutes.length).toBe(2);
  await expect.poll(() => page.evaluate(() => (window as typeof window & { aborts: number }).aborts)).toBe(1);
  await page.getByRole("button", { name: "Close translation" }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { aborts: number }).aborts)).toBe(2);
  await expect(page.getByRole("dialog", { name: "Translation" })).toHaveCount(0);
  for (const route of pendingRoutes) await route.abort().catch(() => {});
});

test("settings compare uncached word and sentence lookups across four models", async ({ page }) => {
  const calls: Array<{ model: string; text: { format: { strict: boolean } }; reasoning?: { effort: string } }> = [];
  await page.route("https://api.openai.com/v1/responses", async (route) => {
    calls.push(route.request().postDataJSON());
    await route.fulfill({ json: translation("Comparison translation") });
  });
  await openReader(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Compare speed", exact: true }).click();
  await expect(page.getByRole("button", { name: "Compare speed", exact: true })).toBeEnabled();
  expect(calls.map((call) => call.model)).toEqual(["gpt-4.1-mini", "gpt-4.1-mini", "gpt-4o-mini", "gpt-4o-mini", "gpt-4.1-nano", "gpt-4.1-nano", "gpt-5.5", "gpt-5.5"]);
  expect(calls.every((call) => call.text.format.strict)).toBe(true);
  expect(calls[6].reasoning?.effort).toBe("none");
  await expect(page.getByText(/word: .*Comparison translation/)).toHaveCount(4);
  await expect(page.getByText(/sentence: .*Comparison translation/)).toHaveCount(4);
  await page.getByRole("button", { name: "Use gpt-4.1-nano", exact: true }).click();
  await expect(page.locator(".model-input input")).toHaveValue("gpt-4.1-nano");
  await page.screenshot({ path: "test-results/model-comparison-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.getByRole("dialog", { name: "Settings", exact: true }).evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: "test-results/model-comparison-mobile.png" });
});
