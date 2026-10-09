import { expect, test, type Locator, type Route } from "@playwright/test";

async function geometry(word: Locator) {
  return word.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top, left: rect.left, scroll: window.scrollY, height: document.documentElement.scrollHeight };
  });
}

for (const viewport of [
  { name: "laptop", theme: "cinema", width: 1280, height: 900 },
  { name: "tablet", theme: "reader", width: 1024, height: 768 },
  { name: "phone", theme: "cinema", width: 390, height: 844 },
  { name: "small-phone", theme: "warm", width: 320, height: 640 },
]) {
  test(`${viewport.name}: long grammar badges stay readable without horizontal scrolling`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(({ theme }) => {
      localStorage.setItem("subdiver.theme", theme);
      localStorage.setItem("subdiver.settings", JSON.stringify({ apiKey: "test-only", model: "gpt-4.1-mini", targetLanguage: "Russian", learnerLevel: "B2" }));
    }, viewport);
    const partOfSpeech = "существительное (здесь: 'een zwak voor iemand hebben' — часть устойчивого выражения, означающего симпатию или привязанность к кому-либо; используется как существительное со значением 'слабость', а не как прилагательное 'слабый')";
    const lemma = "een zwak voor iemand hebben";
    await page.route("https://api.openai.com/v1/responses", async (route) => {
      await route.fulfill({ json: { output_text: JSON.stringify({
        translation: "слабость к кому-то (нежное чувство, симпатия)", lemma, partOfSpeech,
        explanation: "В этом контексте 'een zwak voor iemand hebben' — устойчивое выражение, означающее иметь тёплое, нежное чувство или симпатию к кому-либо. 'Zwak' буквально значит 'слабый', но здесь это существительное, обозначающее 'слабость'.",
        learningAdvice: { frequency: "common", register: "general", level: "B1", tip: "Это устойчивое выражение часто используется в разговорной речи для описания симпатии или привязанности." },
      }) } });
    });
    await page.goto("/");
    await page.getByLabel("Upload a book or subtitles").setInputFiles({ name: "zwak.srt", mimeType: "text/plain", buffer: Buffer.from("1\n00:00:01,000 --> 00:00:03,000\nIk heb een zwak voor je vader.\n") });
    const word = page.locator(".word-token").filter({ hasText: /^zwak$/ });
    await expect(word).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const before = await geometry(word);
    await word.click();
    const panel = page.getByRole("dialog", { name: "Translation", exact: true });
    await expect(panel).toContainText(partOfSpeech);
    await expect(panel).toHaveCSS("opacity", "1");
    const badge = panel.locator(".rt-Badge").filter({ hasText: partOfSpeech });
    expect(await badge.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await panel.locator(".lookup-panel-content").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await badge.evaluate(element => element.getBoundingClientRect().height > parseFloat(getComputedStyle(element).lineHeight) * 1.5)).toBe(true);
    expect(await geometry(word)).toEqual(before);
    await panel.getByRole("button", { name: "Ask follow-up" }).scrollIntoViewIfNeeded();
    await expect(panel.getByRole("button", { name: "Ask follow-up" })).toBeVisible();
    await panel.locator(".lookup-panel-content").evaluate(element => { element.scrollTop = 0; });
    await panel.screenshot({ path: `test-results/grammar-badge-${viewport.name}.png` });
  });
}

for (const viewport of [
  { name: "laptop", width: 1280, height: 900 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "phone", width: 390, height: 844 },
]) {
  test(`${viewport.name}: translation loading, switching, cache, closing and chat keep the passage in place`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => localStorage.setItem("subdiver.settings", JSON.stringify({ apiKey: "test-only", model: "gpt-4.1-mini", targetLanguage: "English" })));
    const pending: Route[] = [];
    await page.route("https://api.openai.com/v1/responses", (route) => { pending.push(route); });
    await page.goto("/");
    await page.getByLabel("Upload a book or subtitles").setInputFiles({
      name: "long.srt", mimeType: "text/plain",
      buffer: Buffer.from(Array.from({ length: 80 }, (_, index) => `${index + 1}\n00:00:01,000 --> 00:00:03,000\nHij belt mij op. Dit is passage ${index + 1}.\n`).join("\n")),
    });
    const rows = page.locator(".cue-row");
    await expect(rows).toHaveCount(80);
    await rows.nth(12).evaluate((element) => window.scrollBy(0, element.getBoundingClientRect().top - 180));
    const oldWord = rows.nth(12).getByRole("button", { name: "belt", exact: true });
    const newWord = rows.nth(13).getByRole("button", { name: "belt", exact: true });
    const baseline = await geometry(newWord);
    const panel = page.getByRole("dialog", { name: "Translation", exact: true });
    const reply = (text: string) => ({ json: { status: "completed", output_text: JSON.stringify({ translation: text, lemma: "opbellen", partOfSpeech: "verb", explanation: "The prefix op belongs to belt. ".repeat(80) }) } });

    await oldWord.click();
    await expect(panel.getByRole("status")).toBeVisible();
    expect(await geometry(newWord)).toEqual(baseline);
    await expect.poll(() => pending.length).toBe(1);
    await pending[0].fulfill(reply("He calls me."));
    await expect(panel).toContainText("He calls me.");
    expect(await geometry(newWord)).toEqual(baseline);

    const panelBox = (await panel.boundingBox())!;
    const mainBox = (await page.locator(".app-main").boundingBox())!;
    if (viewport.width >= 1100) {
      expect(panelBox.x).toBeGreaterThanOrEqual(mainBox.x + mainBox.width + 20);
    } else {
      expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(viewport.height);
      expect(panelBox.height).toBeLessThanOrEqual(viewport.height * 0.44 + 1);
      expect(panelBox.y).toBeGreaterThan(baseline.top + 40);
    }
    expect(await panel.locator(".lookup-panel-content").evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    await expect(oldWord).toHaveAttribute("aria-pressed", "true");
    await expect(panel).toHaveCSS("opacity", "1");
    await page.screenshot({ path: `test-results/translation-${viewport.name}.png` });

    await newWord.click();
    await expect(panel.getByRole("status")).toBeVisible();
    expect(await geometry(newWord)).toEqual(baseline);
    await expect(oldWord).toHaveAttribute("aria-pressed", "false");
    await expect(newWord).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => pending.length).toBe(2);
    await pending[1].fulfill(reply("New translation."));
    await expect(panel).toContainText("New translation.");
    expect(await geometry(newWord)).toEqual(baseline);

    await oldWord.click();
    await expect(panel).toContainText("cached");
    expect(await geometry(newWord)).toEqual(baseline);
    expect(pending).toHaveLength(2);

    await panel.getByRole("button", { name: "Ask follow-up" }).scrollIntoViewIfNeeded();
    await panel.getByRole("button", { name: "Ask follow-up" }).click();
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Close chat panel" })).toBeVisible();
    expect(await geometry(newWord)).toEqual(baseline);
    await page.getByRole("button", { name: "Close chat panel" }).click();
    await expect(panel).toContainText("He calls me.");
    expect(await geometry(newWord)).toEqual(baseline);

    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    expect(await geometry(newWord)).toEqual(baseline);

    // A long bottom panel must not make the end of the document unreachable.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await rows.last().getByRole("button", { name: "belt", exact: true }).click();
    await expect.poll(() => pending.length).toBe(3);
    await pending[2].fulfill(reply("Last translation."));
    await expect(panel).toContainText("Last translation.");
    if (viewport.width < 1100) {
      const lastRow = (await rows.last().boundingBox())!;
      expect(lastRow.y + lastRow.height).toBeLessThanOrEqual((await panel.boundingBox())!.y);
    }
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
