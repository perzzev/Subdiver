// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { getCleanSelection } from "./utils/selection";

const read = () => getCleanSelection(".cue-text", ".cue-time, .cue-sentence-marker");
function fixture() {
  document.body.innerHTML = '<div><div class="cue-row"><span class="cue-time">00:01</span><div class="cue-text"><button class="cue-sentence-marker">¶</button><span>Hij</span><span> belt mij op. </span><button class="cue-sentence-marker">¶</button><span>Ik lees een boek.</span></div></div><div class="cue-row"><span class="cue-time">00:04</span><div class="cue-text"><button class="cue-sentence-marker">¶</button><span>Wij lezen samen.</span></div></div></div>';
  return document.querySelectorAll(".cue-text");
}
function select(range: Range) {
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
}
afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = "";
});

describe("reader selection", () => {
  it("keeps every sentence and its punctuation within a passage", () => {
    const passages = fixture();
    const range = document.createRange();
    range.selectNodeContents(passages[0]);
    select(range);
    expect(read()).toEqual({ text: "Hij belt mij op. Ik lees een boek.", context: "Hij belt mij op. Ik lees een boek." });
  });

  it.each(["body", "document"] as const)("includes multiple passages, without timestamps or sentence controls: %s", (root) => {
    fixture();
    const range = document.createRange();
    range.selectNodeContents(root === "body" ? document.body : document);
    select(range);
    expect(read()).toEqual({ text: "Hij belt mij op. Ik lees een boek. Wij lezen samen.", context: "Hij belt mij op. Ik lees een boek. Wij lezen samen." });
  });

  it.each([false, true])("clips the selection at both ends and keeps context across passages (backwards: %s)", (backwards) => {
    const passages = fixture();
    const start = passages[0].querySelectorAll("span")[1].firstChild!;
    const end = passages[1].querySelector("span")!.firstChild!;
    window.getSelection()!.setBaseAndExtent(backwards ? end : start, backwards ? 9 : 1, backwards ? start : end, backwards ? 1 : 9);
    expect(read()).toEqual({ text: "belt mij op. Ik lees een boek. Wij lezen", context: "Hij belt mij op. Ik lees een boek. Wij lezen samen." });
  });

  it("does not select adjacent text when the range ends at an element boundary", () => {
    const passages = fixture();
    const range = document.createRange();
    range.setStart(passages[0], 1);
    range.setEnd(passages[0], 3);
    select(range);
    expect(read().text).toBe("Hij belt mij op.");
  });

  it("ignores collapsed selections and selections outside the reader", () => {
    fixture();
    const range = document.createRange();
    range.selectNodeContents(document.querySelector(".cue-time")!);
    select(range);
    expect(read()).toEqual({ text: "", context: "" });
    range.collapse(true);
    select(range);
    expect(read()).toEqual({ text: "", context: "" });
  });
});
