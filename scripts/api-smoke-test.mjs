import {
  requestChat,
  summarizePage,
  translateItems
} from "../src/ai-client.js";

const settings = {
  apiKey: process.env.YIYE_API_KEY,
  baseUrl: process.env.YIYE_BASE_URL || "https://api.deepseek.com",
  model: process.env.YIYE_MODEL || "deepseek-chat"
};

if (!settings.apiKey) {
  console.error("请通过 YIYE_API_KEY 环境变量提供测试密钥。");
  process.exit(1);
}

console.log(`测试 ${settings.baseUrl} / ${settings.model}`);

const pong = await requestChat(
  settings,
  [
    { role: "system", content: "Only answer OK." },
    { role: "user", content: "Connection test" }
  ],
  { maxTokens: 256, temperature: 0 }
);
if (!/ok/i.test(pong)) throw new Error(`连通性测试返回异常：${pong}`);
console.log("✓ API 连通性");

const translations = await translateItems(
  settings,
  [
    { id: "1", text: "Artificial intelligence makes information easier to access." },
    { id: "2", text: "Keep product names such as Chrome unchanged." }
  ],
  "en",
  "zh-CN"
);
if (translations.length !== 2 || translations.some((item) => !item.text)) {
  throw new Error("翻译测试没有返回完整结果");
}
console.log(`✓ 批量翻译：${translations.map((item) => item.text).join(" / ")}`);

const summary = await summarizePage(
  settings,
  {
    title: "AI 翻译插件",
    url: "https://example.com/article",
    text: "这款浏览器插件提供全页面翻译、划词翻译和网页总结。用户可以配置兼容 OpenAI 协议的服务地址、密钥和模型。"
  },
  "zh-CN"
);
if (summary.length < 20) throw new Error("总结测试返回内容过短");
console.log(`✓ 网页总结：${summary.replace(/\s+/g, " ").slice(0, 100)}…`);
