/**
 * Build a clean selection string that contains only text from elements matching
 * `allowSelector`, even if the user dragged across siblings (such as cue
 * timestamps) that we never want to translate. Works for cross-cue selections
 * because we walk every range and skip nodes that fall outside the allow list.
 */
export function getCleanSelectionText(allowSelector: string, rejectSelector: string): string {
  return getCleanSelection(allowSelector, rejectSelector).text;
}

/** Snapshot the selected text and the full passages it crosses before clearing the range. */
export function getCleanSelection(allowSelector: string, rejectSelector: string): { text: string; context: string } {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return { text: "", context: "" };

  const parts: string[] = [];
  const containers = new Set<Element>();
  for (let i = 0; i < selection.rangeCount; i += 1) {
    const range = selection.getRangeAt(i);
    if (range.collapsed) continue;
    const extracted = extractAllowedText(range, allowSelector, rejectSelector);
    parts.push(extracted.text);
    extracted.containers.forEach((container) => containers.add(container));
  }

  const context = Array.from(containers, (container) => {
    const range = container.ownerDocument.createRange();
    range.selectNodeContents(container);
    return extractAllowedText(range, allowSelector, rejectSelector).text;
  });
  return { text: normalize(parts.join(" ")), context: normalize(context.join(" ")) };
}

function normalize(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function extractAllowedText(range: Range, allowSelector: string, rejectSelector: string) {
  const containers = new Set<Element>();
  const doc = range.startContainer.nodeType === Node.DOCUMENT_NODE
    ? range.startContainer as Document
    : range.startContainer.ownerDocument;
  if (!doc) return { text: "", containers };

  const root: Node =
    range.commonAncestorContainer.nodeType === Node.TEXT_NODE
      ? range.commonAncestorContainer.parentElement!
      : range.commonAncestorContainer;

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node) {
      if (!range.intersectsNode(node)) return NodeFilter.FILTER_REJECT;
      const parent = (node as Text).parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest(rejectSelector)) return NodeFilter.FILTER_REJECT;
      if (!parent.closest(allowSelector)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const collected: string[] = [];
  let previousContainer: Element | null = null;
  let current: Node | null = walker.nextNode();
  while (current) {
    const textNode = current as Text;
    const full = textNode.data;
    let start = 0;
    let end = full.length;
    if (textNode === range.startContainer) start = range.startOffset;
    if (textNode === range.endContainer) end = range.endOffset;
    const selected = full.slice(start, end);
    const container = textNode.parentElement!.closest(allowSelector)!;
    if (selected) {
      // Word tokens are separate spans. Joining every text node with a space
      // changes punctuation; add a separator only between different passages.
      if (previousContainer && previousContainer !== container) collected.push(" ");
      collected.push(selected);
      containers.add(container);
      previousContainer = container;
    }
    current = walker.nextNode();
  }

  return { text: collected.join(""), containers };
}
