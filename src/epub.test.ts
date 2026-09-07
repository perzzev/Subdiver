// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { parseEpubFile } from "./epub";
import { makeLookupCacheKey, makeTranscriptKey } from "./storage";

const xhtml = (body: string) => `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Page</title></head><body>${body}</body></html>`;
function book(overrides: Record<string, string> = {}) {
  const files = {
    mimetype: "application/epub+zip",
    "META-INF/container.xml": '<container><rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    "OPS/book.opf": `<package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>Een testboek</dc:title><dc:creator>Test Auteur</dc:creator></metadata><manifest>
      <item id="b" href="Text/tweede.xhtml" media-type="application/xhtml+xml"/>
      <item id="a" href="Text/eerste%20hoofdstuk.xhtml" media-type="application/xhtml+xml"/>
      <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
      <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
      </manifest><spine toc="ncx"><itemref idref="cover"/><itemref idref="a"/><itemref idref="b"/></spine></package>`,
    "OPS/toc.ncx": '<ncx><navMap><navPoint><navLabel><text>De eerste dag</text></navLabel><content src="Text/eerste%20hoofdstuk.xhtml#begin"/></navPoint></navMap></ncx>',
    "OPS/cover.xhtml": xhtml('<img src="cover.jpg"/>'),
    "OPS/Text/eerste hoofdstuk.xhtml": xhtml('<div><h1 id="begin">Eén<br/>begin</h1><p>Hij <em>belt</em> mij op. &amp; zij luistert.</p><p>De tweede alinea.</p></div>'),
    "OPS/Text/tweede.xhtml": xhtml('<p>De laatste bladzijde.</p>'),
    ...overrides,
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([path, text]) => [path, strToU8(text)]))).buffer as ArrayBuffer;
}

describe("EPUB import", () => {
  it("uses spine order, resolves encoded paths, retains paragraphs and metadata, and skips image-only covers", async () => {
    const doc = await parseEpubFile(book(), "test.epub");
    expect(doc.displayTitle).toBe("Een testboek");
    expect(doc.author).toBe("Test Auteur");
    expect(doc.chapters?.map((chapter) => chapter.title)).toEqual(["De eerste dag", "Section 2"]);
    expect(doc.cues.map((cue) => cue.text)).toEqual(["Eén begin", "Hij belt mij op. & zij luistert.", "De tweede alinea.", "De laatste bladzijde."]);
    expect(doc.cues[0].headingLevel).toBe(1);
    expect(doc.chapters?.map((chapter) => [chapter.startIndex, chapter.endIndex])).toEqual([[0, 3], [3, 4]]);
    const again = await parseEpubFile(book(), "renamed.epub");
    expect(makeTranscriptKey(doc)).toBe(makeTranscriptKey(again));
    expect(doc.cues.map((cue) => cue.id)).toEqual(again.cues.map((cue) => cue.id));
    const changed = await parseEpubFile(book({ "OPS/Text/tweede.xhtml": xhtml("<p>Iets anders.</p>") }), "test.epub");
    expect(makeTranscriptKey(changed)).not.toBe(makeTranscriptKey(doc));
  });

  it("reads EPUB 3 navigation labels", async () => {
    const doc = await parseEpubFile(book({
      "OPS/book.opf": '<package><manifest><item id="a" href="Text/tweede.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/></spine></package>',
      "OPS/nav.xhtml": '<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><a href="Text/tweede.xhtml">Het einde</a></nav></body></html>',
    }), "fallback.epub");
    expect(doc.chapters?.[0].title).toBe("Het einde");
    expect(doc.displayTitle).toBe("fallback");
  });

  it("does not import executable markup or hidden text and does not duplicate nested blocks", async () => {
    const doc = await parseEpubFile(book({
      "OPS/Text/tweede.xhtml": xhtml('<div>Vooraf<p>Een <span>woord</span>.</p><div>Slot</div></div><script>alert(1)</script><style>body{display:none}</style><p hidden="hidden">Verborgen</p><iframe src="https://example.com">Frame</iframe>'),
    }), "test.epub");
    expect(doc.cues.slice(3).map((cue) => cue.text)).toEqual(["Vooraf", "Een woord.", "Slot"]);
    expect(doc.rawText).not.toMatch(/alert|display|Verborgen|Frame/);
  });

  it("rejects encrypted chapters but allows obfuscated fonts", async () => {
    const encryption = (uri: string) => `<encryption><EncryptedData><CipherData><CipherReference URI="${uri}"/></CipherData></EncryptedData></encryption>`;
    await expect(parseEpubFile(book({ "META-INF/encryption.xml": encryption("OPS/Text/tweede.xhtml") }), "test.epub")).rejects.toThrow(/DRM/);
    await expect(parseEpubFile(book({ "META-INF/encryption.xml": encryption("OPS/font.otf") }), "test.epub")).resolves.toMatchObject({ kind: "epub" });
  });

  it("reports invalid archives, missing chapters and malformed XML", async () => {
    await expect(parseEpubFile(new ArrayBuffer(5), "broken.epub")).rejects.toThrow(/Could not open/);
    await expect(parseEpubFile(book({ "OPS/book.opf": "<broken>" }), "test.epub")).rejects.toThrow(/invalid XML/);
    await expect(parseEpubFile(book({ "OPS/book.opf": '<package><manifest/><spine><itemref idref="missing"/></spine></package>' }), "test.epub")).rejects.toThrow(/missing chapter/);
    await expect(parseEpubFile(new ArrayBuffer(31 * 1024 * 1024), "huge.epub")).rejects.toThrow(/too large/);
  });

  it("rejects an image-only book with a useful error", async () => {
    await expect(parseEpubFile(book({
      "OPS/Text/eerste hoofdstuk.xhtml": xhtml('<img src="one.png"/>'),
      "OPS/Text/tweede.xhtml": xhtml('<img src="two.png"/>'),
    }), "images.epub")).rejects.toThrow(/No readable text/);
  });
});

it("separates cached meanings by passage and lookup mode", () => {
  const key = (context: string, mode = "word") => makeLookupCacheKey("model", "English", "bank", "", context, mode);
  expect(key("Ik zit op de bank.")).not.toBe(key("Ik werk bij de bank."));
  expect(key("Een bank.")).not.toBe(key("Een bank.", "sentence"));
  expect(key("Ik zit op de bank.")).toBe(key("Ik zit op de bank."));
});
