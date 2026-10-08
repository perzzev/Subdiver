import { expect, test, type Page } from "@playwright/test";

async function chooseLevel(page: Page, level: string) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Your Dutch level (CEFR)").selectOption(level);
  await page.getByRole("button", { name: "Done", exact: true }).click();
}

for (const [device, viewport] of Object.entries({ laptop: { width: 1280, height: 900 }, phone: { width: 390, height: 844 } })) {
  test(`${device}: learning hints follow the saved level, word scope and cache`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      if (!localStorage.getItem("subdiver.settings")) localStorage.setItem("subdiver.settings", JSON.stringify({ apiKey: "test-only", model: "gpt-4.1-mini", targetLanguage: "Russian" }));
    });
    const requests: string[] = [];
    await page.route("https://api.openai.com/v1/responses", async (route) => {
      const body = route.request().postDataJSON();
      requests.push(body.input);
      const enabled = Boolean(body.text.format.schema.properties.learningAdvice);
      const tip = enabled && body.input.includes("Selected text: afspraak\n") ? "Частое слово для встреч и записи к врачу." : "";
      const rare = body.input.includes("Selected text: Mitsgaders\n");
      const technical = body.input.includes("Selected text: eigenvector\n");
      const learningAdvice = { frequency: rare ? "uncommon" : "common", register: rare ? "archaic" : technical ? "specialist" : "general", level: "A2", tip: rare || technical ? "Even the model wants you to learn this!" : tip };
      await route.fulfill({ json: { output_text: JSON.stringify({ translation: "Перевод в контексте", lemma: "", partOfSpeech: "", explanation: "Объяснение.", ...(enabled ? { learningAdvice } : {}) }) } });
    });
    await page.goto("/");
    await page.getByLabel("Upload a book or subtitles").setInputFiles({ name: "learning.srt", mimeType: "text/plain", buffer: Buffer.from("1\n00:00:01,000 --> 00:00:03,000\nDe afspraak is morgen.\n\n2\n00:00:04,000 --> 00:00:06,000\nMitsgaders is een verouderd woord.\n\n3\n00:00:07,000 --> 00:00:09,000\nDe eigenvector hoort bij deze matrix.\n") });
    const word = page.locator(".word-token").filter({ hasText: /^afspraak$/ });
    const panel = page.getByRole("dialog", { name: "Translation" });
    await word.click();
    await expect(panel).toContainText("Перевод в контексте");
    await expect(page.locator(".lookup-learning-tip")).toHaveCount(0);
    await chooseLevel(page, "B2");
    await expect(panel).toHaveCount(0);
    await word.click();
    await expect(page.locator(".lookup-learning-tip")).toContainText("Worth knowing at B2");
    await expect(panel).toHaveCSS("opacity", "1");
    await page.screenshot({ path: `test-results/learning-tip-${device}.png` });
    await chooseLevel(page, "A1");
    await word.click();
    await expect(panel).toContainText("Перевод в контексте");
    await expect(page.locator(".lookup-learning-tip")).toHaveCount(0);
    expect(requests).toHaveLength(3);
    await chooseLevel(page, "B2");
    await word.click();
    await expect(page.locator(".lookup-learning-tip")).toContainText("B2");
    await expect(panel).toContainText("cached");
    expect(requests).toHaveLength(3);
    for (const rareWord of [/^Mitsgaders$/, /^eigenvector$/]) {
      await page.locator(".word-token").filter({ hasText: rareWord }).click();
      await expect(panel).toContainText("Перевод в контексте");
      await expect(page.locator(".lookup-learning-tip")).toHaveCount(0);
    }
    await page.getByRole("button", { name: "Translate this sentence" }).first().click();
    await expect(panel).toContainText("sentence");
    await expect(panel).toContainText("Перевод в контексте");
    await expect(page.locator(".lookup-learning-tip")).toHaveCount(0);
    await word.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
    });
    await word.dispatchEvent("mouseup");
    await expect(panel).toContainText("selection");
    await expect(page.locator(".lookup-learning-tip")).toContainText("B2");
    await page.reload();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByLabel("Your Dutch level (CEFR)")).toHaveValue("B2");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    // Turn hints off and reuse the original translation without showing an old hint.
    await chooseLevel(page, "");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await word.click();
    await expect(panel).toContainText("cached");
    await expect(page.locator(".lookup-learning-tip")).toHaveCount(0);
  });
}
