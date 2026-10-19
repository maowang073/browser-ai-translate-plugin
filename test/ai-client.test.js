import test from "node:test";
import assert from "node:assert/strict";
import {
  createChatEndpoint,
  extractJson,
  normalizeBaseUrl,
  parseTranslations,
  requestChat
} from "../src/ai-client.js";

test("normalizes OpenAI-compatible base URLs", () => {
  assert.equal(normalizeBaseUrl(" https://api.deepseek.com/ "), "https://api.deepseek.com");
  assert.equal(
    normalizeBaseUrl("https://example.com/v1/chat/completions"),
    "https://example.com/v1"
  );
  assert.equal(
    createChatEndpoint("https://example.com/v1/"),
    "https://example.com/v1/chat/completions"
  );
});

test("extracts JSON from fenced model output", () => {
  assert.deepEqual(
    extractJson('```json\n{"translations":[{"id":"1","text":"你好"}]}\n```'),
    { translations: [{ id: "1", text: "你好" }] }
  );
});

test("maps translation results by id and preserves missing rows", () => {
  const source = [
    { id: "a", text: "Hello" },
    { id: "b", text: "World" }
  ];
  assert.deepEqual(
    parseTranslations('{"translations":[{"id":"b","text":"世界"},{"id":"a","text":"你好"}]}', source),
    [
      { id: "a", text: "你好" },
      { id: "b", text: "世界" }
    ]
  );
  assert.deepEqual(
    parseTranslations('{"translations":[{"id":"a","text":"你好"}]}', source),
    [
      { id: "a", text: "你好" },
      { id: "b", text: "World" }
    ]
  );
});

test("sends a compatible chat completions request", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return new Response(JSON.stringify({
      choices: [{ message: { content: "OK" } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const result = await requestChat(
    {
      apiKey: "test-key",
      baseUrl: "https://api.example.com/v1/",
      model: "test-model"
    },
    [{ role: "user", content: "ping" }]
  );

  assert.equal(result, "OK");
  assert.equal(captured.url, "https://api.example.com/v1/chat/completions");
  assert.equal(captured.options.headers.Authorization, "Bearer test-key");
  assert.equal(JSON.parse(captured.options.body).model, "test-model");
});

test("surfaces API error messages", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: { message: "invalid model" } }),
    { status: 400, headers: { "Content-Type": "application/json" } }
  );

  await assert.rejects(
    () => requestChat(
      { apiKey: "test-key", baseUrl: "https://api.example.com", model: "bad" },
      [{ role: "user", content: "ping" }]
    ),
    /API 请求失败 \(400\)：invalid model/
  );
});
