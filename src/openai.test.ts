import { afterEach, describe, expect, it, vi } from "vitest";
import { requestFollowUp, requestLookup, WORD_PARTS_GUIDANCE } from "./openai";
import type { LookupRequest } from "./types";

const request: LookupRequest = {
  model: "gpt-4.1-mini", targetLanguage: "Russian", targetText: "belt",
  cueText: "Hij belt mij op.", cueId: "one", cueStartMs: 0, cueEndMs: 1000, mode: "word",
};
const result = { translation: "звонит", lemma: "opbellen", partOfSpeech: "глагол", explanation: "Отделяемый глагол." };
function reply(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status }); }
afterEach(() => vi.unstubAllGlobals());

describe("structured lookups", () => {
  it.each(["word", "sentence", "selection"] as const)("keeps personal instructions and adds word-parts guidance only for clicked words: %s", async (mode) => {
    const fetch = vi.fn().mockResolvedValue(reply({ output_text: JSON.stringify(result) }));
    vi.stubGlobal("fetch", fetch);
    await requestLookup("test-key", { ...request, mode }, { customPrompt: "Always explain in simple Russian." });
    const input = JSON.parse(fetch.mock.calls[0][1].body).input as string;
    expect(input).toContain("Always explain in simple Russian.");
    expect(input.includes(WORD_PARTS_GUIDANCE)).toBe(mode === "word");
  });
  it("requests a strict schema and reads raw Responses message content", async () => {
    const fetch = vi.fn().mockResolvedValue(reply({ status: "completed", output: [
      { type: "reasoning", summary: [] },
      { type: "message", content: [{ type: "output_text", text: JSON.stringify(result) }] },
    ] }));
    vi.stubGlobal("fetch", fetch);
    await expect(requestLookup("test-key", request)).resolves.toEqual(result);
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.text.format).toMatchObject({ type: "json_schema", strict: true, schema: {
      additionalProperties: false, required: ["translation", "lemma", "partOfSpeech", "explanation"],
    } });
    expect(body).not.toHaveProperty("reasoning");
    expect(body.store).toBe(false);
  });

  it("skips reasoning on the former default", async () => {
    const fetch = vi.fn().mockResolvedValue(reply({ output_text: JSON.stringify(result) }));
    vi.stubGlobal("fetch", fetch);
    await requestLookup("test-key", { ...request, model: "gpt-5.5" });
    expect(JSON.parse(fetch.mock.calls[0][1].body).reasoning).toEqual({ effort: "none" });
  });

  it("retries truncation once with a higher output budget", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(reply({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output_text: '{"translation":' }))
      .mockResolvedValueOnce(reply({ output_text: JSON.stringify(result) }));
    vi.stubGlobal("fetch", fetch);
    await expect(requestLookup("test-key", request)).resolves.toEqual(result);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[1][1].body).max_output_tokens).toBeGreaterThan(JSON.parse(fetch.mock.calls[0][1].body).max_output_tokens);
  });

  it("stops after a second truncation and does not change models", async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(reply({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } })));
    vi.stubGlobal("fetch", fetch);
    await expect(requestLookup("test-key", request)).rejects.toThrow(/response limit/);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.every((call) => JSON.parse(call[1].body).model === request.model)).toBe(true);
  });

  it.each([null, [], { ...result, translation: { value: "wrong" } }, { ...result, translation: " " }, { ...result, explanation: [] }, { ...result, lemma: 42 }])("rejects invalid fields: %j", async (invalid) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({ output_text: JSON.stringify(invalid) })));
    await expect(requestLookup("test-key", request)).rejects.toThrow(/invalid lookup format/);
  });

  it.each([
    [{ output: [{ content: [{ type: "refusal", refusal: "Cannot help." }] }] }, 200, /declined/],
    [{ status: "incomplete", incomplete_details: { reason: "content_filter" } }, 200, /could not complete/],
    [{ status: "failed", error: { message: "Failed generation" } }, 200, /Failed generation/],
    [{ error: { message: "Rate limited" } }, 429, /Rate limited/],
    [{ error: { message: "Invalid key" } }, 401, /Invalid key/],
  ] as const)("reports API errors without retries", async (data, status, message) => {
    const fetch = vi.fn().mockResolvedValue(reply(data, status));
    vi.stubGlobal("fetch", fetch);
    await expect(requestLookup("test-key", request)).rejects.toThrow(message);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not mistake an HTML transport error for model JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>gateway error</html>", { status: 502 })));
    await expect(requestLookup("test-key", request)).rejects.toThrow(/unreadable response \(HTTP 502\)/);
  });

  it("propagates abort and never retries cancelled requests", async () => {
    const controller = new AbortController();
    const fetch = vi.fn().mockImplementation((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));
    vi.stubGlobal("fetch", fetch);
    const pending = requestLookup("test-key", request, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps follow-up answers plain text", async () => {
    const fetch = vi.fn().mockResolvedValue(reply({ output: [{ content: [{ type: "output_text", text: "Opbellen is separable." }] }] }));
    vi.stubGlobal("fetch", fetch);
    await expect(requestFollowUp("test-key", request, [], "Why op?")).resolves.toBe("Opbellen is separable.");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).not.toHaveProperty("text");
  });
});
