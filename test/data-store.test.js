import test from "node:test";
import assert from "node:assert/strict";
import {
  addUsage,
  appendHistory,
  createHistoryEntry,
  normalizeUsage
} from "../src/data-store.js";

test("normalizes OpenAI usage fields", () => {
  assert.deepEqual(
    normalizeUsage({ prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 }),
    { promptTokens: 120, completionTokens: 30, totalTokens: 150 }
  );
});

test("aggregates token usage by operation and day", () => {
  const first = addUsage(
    undefined,
    { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    "translation",
    Date.UTC(2026, 9, 19)
  );
  const second = addUsage(
    first,
    { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
    "summary",
    Date.UTC(2026, 9, 19)
  );

  assert.equal(second.totalTokens, 160);
  assert.equal(second.requests, 2);
  assert.equal(second.byOperation.translation.totalTokens, 120);
  assert.equal(second.byOperation.summary.totalTokens, 40);
  assert.equal(second.daily["2026-10-19"].requests, 2);
});

test("sanitizes and limits translation history", () => {
  const entry = createHistoryEntry({
    kind: "selection",
    title: "  Test   page ",
    sourceLanguage: "en",
    targetLanguage: "zh-CN",
    sourceText: "Hello\nworld",
    translatedText: "你好 世界"
  }, 1234);

  assert.equal(entry.kind, "selection");
  assert.equal(entry.title, "Test page");
  assert.equal(entry.sourceText, "Hello world");
  assert.equal(appendHistory([{ id: "old" }], entry, 1).length, 1);
  assert.equal(appendHistory([{ id: "old" }], entry, 1)[0].id, entry.id);
});
