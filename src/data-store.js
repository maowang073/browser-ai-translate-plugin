export const EMPTY_USAGE_STATS = Object.freeze({
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  requests: 0,
  byOperation: {},
  daily: {}
});

function toCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.round(count) : 0;
}

export function normalizeUsage(usage = {}) {
  const promptTokens = toCount(usage.prompt_tokens ?? usage.promptTokens);
  const completionTokens = toCount(usage.completion_tokens ?? usage.completionTokens);
  return {
    promptTokens,
    completionTokens,
    totalTokens: toCount(usage.total_tokens ?? usage.totalTokens)
      || promptTokens + completionTokens
  };
}

function addCounters(current = {}, usage) {
  return {
    promptTokens: toCount(current.promptTokens) + usage.promptTokens,
    completionTokens: toCount(current.completionTokens) + usage.completionTokens,
    totalTokens: toCount(current.totalTokens) + usage.totalTokens,
    requests: toCount(current.requests) + 1
  };
}

export function addUsage(stats, rawUsage, operation, timestamp = Date.now()) {
  const current = { ...EMPTY_USAGE_STATS, ...(stats || {}) };
  const usage = normalizeUsage(rawUsage);
  const day = new Date(timestamp).toISOString().slice(0, 10);
  const byOperation = { ...(current.byOperation || {}) };
  const daily = { ...(current.daily || {}) };

  byOperation[operation] = addCounters(byOperation[operation], usage);
  daily[day] = addCounters(daily[day], usage);

  const recentDays = Object.keys(daily).sort().slice(-30);
  const trimmedDaily = Object.fromEntries(recentDays.map((key) => [key, daily[key]]));

  return {
    ...addCounters(current, usage),
    byOperation,
    daily: trimmedDaily
  };
}

function cleanText(value, maxLength) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function createHistoryEntry(input, timestamp = Date.now()) {
  const kind = input.kind === "selection" ? "selection" : "page";
  return {
    id: `${timestamp}-${Math.random().toString(36).slice(2, 9)}`,
    kind,
    title: cleanText(input.title, 180) || "未命名网页",
    url: cleanText(input.url, 1500),
    sourceLanguage: cleanText(input.sourceLanguage, 20) || "auto",
    targetLanguage: cleanText(input.targetLanguage, 20) || "zh-CN",
    sourceText: cleanText(input.sourceText, 1200),
    translatedText: cleanText(input.translatedText, 1200),
    segmentCount: toCount(input.segmentCount) || 1,
    createdAt: timestamp
  };
}

export function appendHistory(history, entry, limit = 200) {
  return [entry, ...(Array.isArray(history) ? history : [])].slice(0, limit);
}
