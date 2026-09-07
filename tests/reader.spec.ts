import { expect, test } from "@playwright/test";
import { strToU8, zipSync } from "fflate";

function makeBook() {
  const files = {
    mimetype: "application/epub+zip",
    "META-INF/container.xml": '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>',
    "book.opf": '<package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>Een kleine reis</dc:title><dc:creator>Test Auteur</dc:creator></metadata><manifest><item id="a" href="one.xhtml" media-type="application/xhtml+xml"/><item id="b" href="two.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>',
    "one.xhtml": `<html><body><h1>De eerste dag</h1>${Array.from({length: 85}, (_, index) => `<p>Hij belt mij op. Dit is alinea ${index + 1}.</p>`).join("")}</body></html>`,
    "two.xhtml": '<html><body><h1>De tweede dag</h1><p>Wij lezen samen een boek.</p></body></html>',
  };
  return { name: "reis.epub", mimeType: "application/epub+zip", buffer: Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([path, text]) => [path, strToU8(text)])))) };
}

test("EPUB words, sentences, selections, chat, pagination and progress survive reopening", async ({ page }) => {
  const prompts: string[] = [];
  await page.addInitScript(() => localStorage.setItem("subdiver.settings", JSON.stringify({ apiKey: "test-only", model: "test-model", targetLanguage: "English", persistApiKey: true })));
  await page.route("https://api.openai.com/v1/responses", async (route) => {
    const prompt = route.request().postDataJSON().input as string;
    prompts.push(prompt);
    const reply = prompt.includes("Question:") ? "Opbellen is a separable verb." : JSON.stringify({ translation: "He calls me.", lemma: "opbellen", explanation: "The prefix op belongs to belt." });
    await route.fulfill({ json: { output_text: reply } });
  });
  await page.goto("/");
  await page.getByLabel("Upload a book or subtitles").setInputFiles(makeBook());
  await expect(page.getByRole("heading", { name: "Een kleine reis" })).toBeVisible();
  await expect(page.locator(".cue-time")).toHaveCount(0);
  await expect(page.locator(".cue-row")).toHaveCount(40);
  await page.locator(".word-token").filter({ hasText: /^belt$/ }).first().click();
  await expect(page.getByRole("dialog", { name: "Translation" })).toContainText("He calls me.");
  expect(prompts.at(-1)).toContain("Passage context: Hij belt mij op. Dit is alinea 1.");
  await page.getByRole("button", { name: "Close translation" }).click();
  await page.locator(".word-token").filter({ hasText: /^belt$/ }).first().click({ modifiers: ["Alt"] });
  await expect(page.getByRole("dialog", { name: "Translation" })).toContainText("sentence");
  expect(prompts.at(-1)).toContain("Selected sentence: Hij belt mij op.");
  await page.getByRole("button", { name: "Close translation" }).click();
  const paragraph = page.locator(".cue-text").nth(1);
  await paragraph.evaluate((element) => {
    const words = element.querySelectorAll(".word-token");
    const range = document.createRange();
    range.setStart(words[0].firstChild!, 0);
    range.setEnd(words[1].firstChild!, 4);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  });
  await paragraph.dispatchEvent("mouseup");
  await expect(page.getByRole("dialog", { name: "Translation" })).toContainText("selection");
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.getByRole("button", { name: "Ask follow-up" }).click();
  await page.getByRole("textbox").fill("Why op?");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.locator(".message.assistant")).toContainText("separable verb");
  await page.getByRole("button", { name: "Close chat panel" }).click();
  await page.getByRole("button", { name: "Close translation" }).click();
  await page.locator(".word-token").filter({ hasText: /^mij$/ }).first().click();
  await expect(page.getByRole("dialog", { name: "Translation" })).toContainText("He calls me.");
  await page.getByRole("button", { name: "Ask follow-up" }).click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(page.locator(".message")).toHaveCount(0);
  await page.getByRole("textbox").fill("What is mij?");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.locator(".message.assistant")).toContainText("separable verb");
  expect(prompts.at(-1)).not.toContain("Why op?");
  await page.getByRole("tab", { name: /^Hij belt/ }).click();
  await expect(page.locator(".message.user")).toHaveText("Why op?");
  await page.getByRole("button", { name: "Close chat panel" }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.locator(".chapter-navigation")).toContainText("Section 2 of 3");
  await expect(page.locator(".cue-row").first()).toContainText("alinea 40");
  await page.locator(".cue-row").nth(4).scrollIntoViewIfNeeded();
  await expect.poll(() => page.evaluate(() => Object.values(JSON.parse(localStorage.getItem("subdiver.progressMap") ?? "{}"))[0] as { cueIndex: number })).toMatchObject({ cueIndex: expect.any(Number) });
  await page.getByRole("button", { name: "Back to library" }).click();
  await expect(page.getByRole("region", { name: "Your library" })).toContainText("Een kleine reis");
  await page.reload();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator(".chapter-navigation")).toContainText("Section 2 of 3");
  await page.getByRole("button", { name: "Book chat" }).click();
  await expect(page.locator(".message.assistant")).toContainText("separable verb");
  await expect(page.getByRole("tab")).toHaveCount(2);
  // A saved chat reference can reopen a passage on another section.
  await page.getByTitle("Jump back to that passage").click();
  await expect(page.locator(".chapter-navigation")).toContainText("Section 1 of 3");
  await page.getByRole("button", { name: "Close chat panel" }).click();
  await page.getByLabel("Chapter", { exact: true }).selectOption("1");
  await expect(page.locator(".transcript")).toContainText("Wij lezen samen een boek.");
  await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(page.locator(".chapter-navigation")).toContainText("Section 3 of 3");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("subtitle uploads still show timestamps and invalid EPUBs show an error", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Upload a book or subtitles").setInputFiles({ name: "bad.epub", mimeType: "application/epub+zip", buffer: Buffer.from("not a book") });
  await expect(page.getByText(/Could not open this EPUB/)).toBeVisible();
  await page.getByLabel("Upload a book or subtitles").setInputFiles({ name: "test.srt", mimeType: "text/plain", buffer: Buffer.from("1\n00:00:01,000 --> 00:00:03,000\nHallo daar.\n") });
  await expect(page.locator(".cue-time")).toHaveText("0:01.00");
  await expect(page.getByRole("button", { name: "Episode chat" })).toBeVisible();
});

test("EPUB drag and drop opens a book", async ({ page }) => {
  await page.goto("/");
  const fixture = makeBook();
  const transfer = await page.evaluateHandle(({ bytes, name }) => {
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array(bytes)], name, { type: "application/epub+zip" }));
    return data;
  }, { bytes: Array.from(fixture.buffer), name: fixture.name });
  await page.locator(".dropzone").dispatchEvent("drop", { dataTransfer: transfer });
  await expect(page.getByRole("heading", { name: "Een kleine reis" })).toBeVisible();
});

test("local sample book renders on desktop and mobile", async ({ page }) => {
  test.skip(!process.env.EPUB_SAMPLE, "Set EPUB_SAMPLE to a local book for manual acceptance testing.");
  await page.goto("/");
  await page.getByLabel("Upload a book or subtitles").setInputFiles(process.env.EPUB_SAMPLE!);
  await expect(page.locator(".reader-title")).not.toBeEmpty();
  await page.getByLabel("Chapter", { exact: true }).selectOption({ index: 1 });
  await expect(page.locator(".cue-row").first()).toBeVisible();
  await expect(page.locator(".cue-row")).toHaveCount(40);
  await page.screenshot({ path: "test-results/book-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/book-mobile.png" });
  console.log(await page.locator(".reader-strip").innerText());
});
