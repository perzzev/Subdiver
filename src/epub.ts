import { strFromU8, unzipSync } from "fflate";
import type { BookChapter, SubtitleCue, TranscriptDocument } from "./types";

const MAX_ARCHIVE_BYTES = 30 * 1024 * 1024;
const MAX_TEXT_BYTES = 60 * 1024 * 1024;
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;

/** Extract text only: publisher HTML, scripts, images and styles never enter the live page. */
export async function parseEpubFile(data: ArrayBuffer, fileName: string): Promise<TranscriptDocument> {
  if (data.byteLength > MAX_ARCHIVE_BYTES) throw new Error("This EPUB is too large. Choose a book under 30 MB.");
  let totalBytes = 0;
  let files: ReturnType<typeof unzipSync>;
  try {
    files = unzipSync(new Uint8Array(data), {
      filter: (entry) => {
        // Covers and embedded fonts are not needed by the text reader.
        if (!/\.(xml|opf|ncx|xhtml|html|htm)$/i.test(entry.name)) return false;
        totalBytes += entry.originalSize;
        if (entry.originalSize > MAX_ENTRY_BYTES || totalBytes > MAX_TEXT_BYTES) {
          throw new Error("The EPUB contains too much text to import safely.");
        }
        return true;
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("too much text")) throw error;
    throw new Error("Could not open this EPUB. It may be damaged or password protected.");
  }
  const read = (path: string) => {
    if (!files[path]) throw new Error(`The EPUB is missing a required file: ${path}`);
    return strFromU8(files[path]).replace(/^\uFEFF/, "");
  };
  const container = parseXml(read("META-INF/container.xml"));
  const roots = elements(container, "rootfile");
  const rootFile = roots.find((root) => root.getAttribute("media-type") === "application/oebps-package+xml") ?? roots[0];
  const packagePath = resolvePath("", rootFile?.getAttribute("full-path") ?? "");
  const opf = parseXml(read(packagePath));
  const manifest = new Map(elements(opf, "item").map((item) => [item.getAttribute("id"), item]));
  const spine = elements(opf, "spine")[0];
  if (!spine) throw new Error("This EPUB has no reading order.");

  const encrypted = new Set<string>();
  if (files["META-INF/encryption.xml"]) {
    for (const ref of elements(parseXml(read("META-INF/encryption.xml")), "CipherReference")) {
      encrypted.add(resolvePath("", ref.getAttribute("URI") ?? ""));
    }
  }

  const titles = new Map<string, string>();
  const navItem = [...manifest.values()].find((item) => item.getAttribute("properties")?.split(/\s+/).includes("nav"));
  const ncxItem = manifest.get(spine.getAttribute("toc")) ?? [...manifest.values()].find((item) => item.getAttribute("media-type") === "application/x-dtbncx+xml");
  // EPUB 3 navigation and EPUB 2 NCX provide useful labels even when headings are absent.
  for (const item of [navItem, ncxItem]) {
    if (!item) continue;
    const path = resolvePath(packagePath, item.getAttribute("href") ?? "");
    if (!files[path]) continue;
    const nav = parseXml(read(path));
    if (item === navItem) {
      const toc = elements(nav, "nav").find((el) => (el.getAttribute("epub:type") ?? el.getAttribute("type"))?.split(/\s+/).includes("toc"));
      if (toc) for (const link of elements(toc, "a")) {
        const target = resolvePath(path, link.getAttribute("href") ?? "");
        if (!titles.has(target)) titles.set(target, cleanText(link.textContent ?? ""));
      }
    } else {
      for (const point of elements(nav, "navPoint")) {
        const src = elements(point, "content")[0]?.getAttribute("src");
        const label = elements(point, "navLabel")[0]?.textContent;
        if (src && label) {
          const target = resolvePath(path, src);
          if (!titles.has(target)) titles.set(target, cleanText(label));
        }
      }
    }
  }

  const cues: SubtitleCue[] = [];
  const chapters: BookChapter[] = [];
  for (const [spineIndex, ref] of elements(spine, "itemref").entries()) {
    if (ref.getAttribute("linear") === "no") continue;
    const item = manifest.get(ref.getAttribute("idref"));
    if (!item) throw new Error("The EPUB reading order refers to a missing chapter.");
    const mediaType = item.getAttribute("media-type");
    if (mediaType !== "application/xhtml+xml" && mediaType !== "text/html") continue;
    const path = resolvePath(packagePath, item.getAttribute("href") ?? "");
    if (encrypted.has(path)) throw new Error("This EPUB has DRM-protected text. Please upload a DRM-free EPUB.");
    const doc = mediaType === "text/html"
      ? new DOMParser().parseFromString(read(path), "text/html")
      : parseXml(read(path));
    const body = elements(doc, "body")[0];
    if (!body) continue;
    const blocks = extractBlocks(body);
    if (!blocks.length) continue;
    const chapterId = `chapter-${spineIndex}`;
    const startIndex = cues.length;
    for (const block of blocks) {
      cues.push({
        id: `epub-${spineIndex}-${cues.length - startIndex}`,
        index: cues.length + 1,
        startMs: 0,
        endMs: 0,
        text: block.text,
        rawText: block.text,
        chapterId,
        headingLevel: block.headingLevel,
      });
    }
    chapters.push({
      id: chapterId,
      title: titles.get(path) || blocks.find((block) => block.headingLevel)?.text || `Section ${chapters.length + 1}`,
      startIndex,
      endIndex: cues.length,
    });
    // Let the upload indicator paint during longer imports.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  if (!cues.length) throw new Error("No readable text found in this EPUB. Image-only books are not supported.");
  const hash = await crypto.subtle.digest("SHA-256", data);
  return {
    kind: "epub",
    contentHash: Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    fileName,
    loadedAt: Date.now(),
    displayTitle: cleanText(elements(opf, "title")[0]?.textContent ?? "") || fileName.replace(/\.epub$/i, ""),
    author: elements(opf, "creator").map((el) => cleanText(el.textContent ?? "")).filter(Boolean).join(", "),
    source: { type: "upload" },
    chapters,
    cues,
    rawText: cues.map((cue) => cue.text).join("\n\n"),
  };
}

function elements(root: Document | Element, name: string): Element[] {
  return Array.from(root.getElementsByTagNameNS("*", name));
}

function parseXml(text: string) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (elements(doc, "parsererror").length) throw new Error("This EPUB contains invalid XML or chapter markup.");
  return doc;
}

function resolvePath(base: string, href: string) {
  const clean = href.split(/[?#]/)[0];
  if (!clean || /^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(clean)) throw new Error("This EPUB contains an invalid chapter path.");
  const parts = base.split("/").slice(0, -1);
  for (const part of decodeURIComponent(clean).split("/")) {
    if (part === "..") {
      if (!parts.length) throw new Error("This EPUB contains an invalid chapter path.");
      parts.pop();
    } else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/");
}

function cleanText(text: string) {
  return text.replace(/\u00ad/g, "").replace(/\s+/g, " ").trim();
}

function extractBlocks(body: Element) {
  const result: Array<{ text: string; headingLevel?: number }> = [];
  const blockTags = new Set(["p", "div", "section", "article", "blockquote", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "tr", "figure", "figcaption", "header", "footer", "aside"]);
  const skipTags = new Set(["script", "style", "noscript", "iframe", "object", "svg", "math", "head", "nav", "audio", "video"]);
  let buffer = "";
  function flush(headingLevel?: number) {
    const text = cleanText(buffer);
    if (text) result.push({ text, headingLevel });
    buffer = "";
  }
  function walk(node: Node, headingLevel?: number) {
    if (node.nodeType === 3) { buffer += node.textContent; return; }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.localName.toLowerCase();
    if (skipTags.has(tag) || el.hasAttribute("hidden") || el.getAttribute("aria-hidden") === "true") return;
    if (tag === "br" || tag === "hr") { buffer += " "; return; }
    const block = blockTags.has(tag);
    if (block) flush(headingLevel);
    const level = /^h[1-6]$/.test(tag) ? Number(tag[1]) : headingLevel;
    for (const child of el.childNodes) walk(child, level);
    if (tag === "td" || tag === "th") buffer += " ";
    if (block) flush(level);
  }
  walk(body);
  flush();
  return result;
}
