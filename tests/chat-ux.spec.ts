import { expect, test, type Page } from "@playwright/test";
import { strToU8, zipSync } from "fflate";

async function openBook(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("subdiver.theme", "cinema");
    localStorage.setItem("subdiver.settings", JSON.stringify({ apiKey: "test-only", model: "gpt-4.1-mini", targetLanguage: "Russian" }));
  });
  await page.route("https://api.openai.com/v1/responses", route => {
    const question = (route.request().postDataJSON().input as string).includes("Question:");
    return route.fulfill({ json: { output_text: question ? "Ответ на вопрос о слове." : JSON.stringify({ translation: "перевод", lemma: "neerleggen", partOfSpeech: "глагол", explanation: "Пояснение перевода." }) } });
  });
  const files = {
    mimetype: "application/epub+zip",
    "META-INF/container.xml": '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>',
    "book.opf": '<package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>UX boek</dc:title></metadata><manifest><item id="a" href="one.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/></spine></package>',
    "one.xhtml": `<html><body>${Array.from({ length: 45 }, (_, i) => `<p>Hij heeft het boek neergelegd. Ze zullen het brutaal vinden. Dit is passage ${i}.</p>`).join("")}</body></html>`,
  };
  await page.goto("./");
  await page.getByLabel("Upload a book or subtitles").setInputFiles({ name: "ux.epub", mimeType: "application/epub+zip", buffer: Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([path, value]) => [path, strToU8(value)])))) });
  await expect(page.locator(".cue-row")).toHaveCount(40);
  await page.evaluate(() => document.fonts.ready);
}

for (const width of [1280, 1024]) {
  test(`${width}: clicking a new word replaces chat with translation and preserves the thread`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openBook(page);
    await page.getByRole("button", { name: "brutaal", exact: true }).first().click();
    await page.getByRole("button", { name: "Ask follow-up" }).click();
    await page.getByRole("textbox").fill("Что это значит?");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.locator(".message.assistant")).toContainText("Ответ на вопрос");
    await page.getByRole("textbox").fill("Ещё один вопрос");
    const word = page.getByRole("button", { name: "neergelegd", exact: true }).first();
    const before = await word.boundingBox();
    await word.click();
    const translation = page.getByRole("dialog", { name: "Translation", exact: true });
    await expect(translation).toContainText("neergelegd");
    await expect(translation).toContainText("перевод");
    await expect(page.getByRole("button", { name: "Close chat panel" })).toBeHidden();
    expect(await word.boundingBox()).toEqual(before);
    await page.getByRole("button", { name: /^Book chat/ }).click();
    await expect(page.locator(".message.user")).toHaveText("Что это значит?");
    await expect(page.getByRole("textbox")).toHaveValue("Ещё один вопрос");
  });
}

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`${viewport.width}: chat handles long subjects, drafts, thread switching and Escape`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openBook(page);
    const paragraph = page.locator(".cue-text").first();
    // A multi-paragraph selection produces a long chat subject.
    await paragraph.evaluate(element => {
      const end = document.querySelectorAll(".cue-text")[12];
      const range = document.createRange();
      range.setStart(element, 0);
      range.setEnd(end, end.childNodes.length);
      window.getSelection()?.addRange(range);
    });
    await paragraph.dispatchEvent("mouseup");
    await page.getByRole("button", { name: "Ask follow-up" }).click();
    const panel = page.locator(".side-panel.open");
    const send = panel.getByRole("button", { name: "Send", exact: true });
    const composer = page.getByRole("textbox");
    await expect(composer).toBeFocused();
    const box = (await send.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await panel.locator(".chat-subhead").evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    await composer.fill("Первый вопрос");
    await send.click();
    await expect(panel.locator(".message.assistant")).toContainText("Ответ на вопрос");
    await composer.fill("Черновик длинной ветки");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Close chat panel" })).toBeHidden();
    await expect(page.getByRole("button", { name: /^Book chat/ })).toBeFocused();
    await page.getByRole("button", { name: "brutaal", exact: true }).first().click();
    await page.getByRole("button", { name: "Ask follow-up" }).click();
    await expect(composer).toHaveValue("");
    await composer.fill("Второй вопрос");
    await send.click();
    await expect(panel.locator(".message.assistant")).toContainText("Ответ на вопрос");
    await composer.fill("Черновик brutaal");
    const firstThread = page.getByRole("tab", { name: /^Hij heeft/ });
    await firstThread.click();
    await expect(composer).toHaveValue("Черновик длинной ветки");
    await firstThread.press("Home");
    await expect(page.getByRole("tab", { name: /^brutaal/ })).toBeFocused();
    await expect(composer).toHaveValue("Черновик brutaal");
    await page.screenshot({ path: `test-results/chat-ux-${viewport.width}.png` });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Translation", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Translation", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: /^Book chat/ }).click();
    await page.getByTitle("Jump back to that passage").click();
    await expect(page.getByRole("button", { name: "Close chat panel" })).toBeHidden();
    await expect(page.locator(".cue-row").first()).toBeInViewport();
  });
}
