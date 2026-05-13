import { describe, expect, it } from "vitest";
import { formatTimestamp, getWordAtPoint, parseSubtitleFile, tokenizeCueText } from "./subtitles";

describe("parseSubtitleFile", () => {
  it("parses WebVTT cues", () => {
    const cues = parseSubtitleFile(`WEBVTT

1
00:00:02.210 --> 00:00:06.090
Onze Amerikaanse clienten
doen graag zaken.
`);

    expect(cues).toHaveLength(1);
    expect(cues[0]).toMatchObject({
      index: 1,
      startMs: 2210,
      endMs: 6090,
      text: "Onze Amerikaanse clienten doen graag zaken.",
    });
  });

  it("parses SRT cues", () => {
    const cues = parseSubtitleFile(`1
00:00:01,000 --> 00:00:02,500
Hallo daar.
`);

    expect(cues).toHaveLength(1);
    expect(cues[0].text).toBe("Hallo daar.");
  });

  it("throws for empty input", () => {
    expect(() => parseSubtitleFile("")).toThrow(/No subtitle cues/);
  });
});

describe("formatTimestamp", () => {
  it("formats short timestamps", () => {
    expect(formatTimestamp(62140)).toBe("1:02.14");
  });

  it("formats hour timestamps", () => {
    expect(formatTimestamp(3_723_450)).toBe("1:02:03.45");
  });
});

describe("getWordAtPoint", () => {
  it("extracts Dutch words with apostrophes and hyphens", () => {
    expect(getWordAtPoint("Wil-ie fuseren?", 2)).toBe("Wil-ie");
  });
});

describe("tokenizeCueText", () => {
  it("splits words from punctuation and spaces", () => {
    expect(tokenizeCueText("Wil-ie fuseren?").map((token) => `${token.kind}:${token.text}`)).toEqual([
      "word:Wil-ie",
      "text: ",
      "word:fuseren",
      "text:?",
    ]);
  });
});
