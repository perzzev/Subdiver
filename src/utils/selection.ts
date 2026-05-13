/**
 * Build a clean selection string that contains only text from elements matching
 * `allowSelector`, even if the user dragged across siblings (such as cue
 * timestamps) that we never want to translate. Works for cross-cue selections
 * because we walk every range and skip nodes that fall outside the allow list.
 */
export function getCleanSelectionText(allowSelector: string, rejectSelector: string): string {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return "";

  const parts: string[] = [];
  for (let i = 0; i < selection.rangeCount; i += 1) {
    const range = selection.getRangeAt(i);
    if (range.collapsed) continue;
    parts.push(extractAllowedText(range, allowSelector, rejectSelector));
  }

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function extractAllowedText(range: Range, allowSelector: string, rejectSelector: string): string {
  const doc = range.commonAncestorContainer.ownerDocument;
  if (!doc) return "";

  const root: Node =
    range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer
      : (range.commonAncestorContainer.parentElement as Node);

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
  let current: Node | null = walker.nextNode();
  while (current) {
    const textNode = current as Text;
    const full = textNode.data;
    let start = 0;
    let end = full.length;
    if (textNode === range.startContainer) start = range.startOffset;
    if (textNode === range.endContainer) end = range.endOffset;
    collected.push(full.slice(start, end));
    current = walker.nextNode();
  }

  return collected.join(" ");
}
