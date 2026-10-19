import {
  DEFAULT_SETTINGS,
  requestChatDetailed,
  summarizePageDetailed,
  translateItemsDetailed,
  validateSettings
} from "./ai-client.js";
import {
  EMPTY_USAGE_STATS,
  addUsage,
  appendHistory,
  createHistoryEntry
} from "./data-store.js";

const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS);
let storageQueue = Promise.resolve();

function updateStoredData(callback) {
  const operation = storageQueue.then(callback);
  storageQueue = operation.catch(() => {});
  return operation;
}

async function getSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEYS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

async function saveSettings(input) {
  const next = {};
  for (const key of SETTINGS_KEYS) {
    if (Object.hasOwn(input, key)) {
      next[key] = input[key];
    }
  }
  const merged = { ...(await getSettings()), ...next };
  validateSettings(merged);
  await chrome.storage.local.set(next);
  return merged;
}

async function recordUsage(usage, operation) {
  await updateStoredData(async () => {
    const stored = await chrome.storage.local.get(["usageStats"]);
    await chrome.storage.local.set({
      usageStats: addUsage(stored.usageStats, usage, operation)
    });
  });
}

async function recordHistory(input) {
  const entry = createHistoryEntry(input);
  await updateStoredData(async () => {
    const stored = await chrome.storage.local.get(["translationHistory"]);
    await chrome.storage.local.set({
      translationHistory: appendHistory(stored.translationHistory, entry)
    });
  });
  return entry;
}

async function getDashboardData() {
  await storageQueue;
  const stored = await chrome.storage.local.get(["translationHistory", "usageStats"]);
  return {
    settings: await getSettings(),
    history: Array.isArray(stored.translationHistory) ? stored.translationHistory : [],
    usageStats: { ...EMPTY_USAGE_STATS, ...(stored.usageStats || {}) }
  };
}

async function handleMessage(message) {
  switch (message?.type) {
    case "GET_SETTINGS":
      return { ok: true, settings: await getSettings() };

    case "GET_DASHBOARD_DATA":
      return { ok: true, ...(await getDashboardData()) };

    case "SAVE_SETTINGS":
      return { ok: true, settings: await saveSettings(message.settings || {}) };

    case "SET_SELECTION_ENABLED":
      await chrome.storage.local.set({ selectionEnabled: Boolean(message.enabled) });
      return { ok: true };

    case "TEST_CONNECTION": {
      const settings = { ...(await getSettings()), ...(message.settings || {}) };
      const result = await requestChatDetailed(
        settings,
        [
          { role: "system", content: "你是 API 连通性测试助手，只回复 OK。" },
          { role: "user", content: "回复 OK" }
        ],
        { maxTokens: 256, temperature: 0 }
      );
      await recordUsage(result.usage, "connection");
      return { ok: true, answer: result.content };
    }

    case "TRANSLATE_BATCH": {
      const settings = await getSettings();
      const sourceLanguage = message.sourceLanguage || settings.sourceLanguage;
      const targetLanguage = message.targetLanguage || settings.targetLanguage;
      const result = await translateItemsDetailed(
        settings,
        message.items || [],
        sourceLanguage,
        targetLanguage
      );
      await recordUsage(result.usage, "translation");
      if (message.historyContext) {
        await recordHistory({
          ...message.historyContext,
          sourceLanguage,
          targetLanguage,
          sourceText: (message.items || []).map((item) => item.text).join(" "),
          translatedText: result.translations.map((item) => item.text).join(" "),
          segmentCount: message.items?.length || 1
        });
      }
      return { ok: true, translations: result.translations };
    }

    case "SUMMARIZE_PAGE": {
      const settings = await getSettings();
      const result = await summarizePageDetailed(
        settings,
        message.page,
        message.outputLanguage || settings.targetLanguage
      );
      await recordUsage(result.usage, "summary");
      return { ok: true, summary: result.summary };
    }

    case "RECORD_HISTORY":
      return { ok: true, entry: await recordHistory(message.entry || {}) };

    case "CLEAR_HISTORY":
      await updateStoredData(() => chrome.storage.local.set({ translationHistory: [] }));
      return { ok: true };

    case "RESET_USAGE":
      await updateStoredData(() => chrome.storage.local.set({ usageStats: { ...EMPTY_USAGE_STATS } }));
      return { ok: true };

    default:
      throw new Error("未知操作");
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(SETTINGS_KEYS);
  const missing = Object.fromEntries(
    Object.entries(DEFAULT_SETTINGS).filter(([key]) => stored[key] === undefined)
  );
  if (Object.keys(missing).length) {
    await chrome.storage.local.set(missing);
  }
  const data = await chrome.storage.local.get(["translationHistory", "usageStats"]);
  await chrome.storage.local.set({
    translationHistory: Array.isArray(data.translationHistory) ? data.translationHistory : [],
    usageStats: { ...EMPTY_USAGE_STATS, ...(data.usageStats || {}) }
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "TRANSLATION_PROGRESS") {
    return false;
  }

  handleMessage(message)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    });
  return true;
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "translate-page") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const settings = await getSettings();
  chrome.tabs.sendMessage(tab.id, {
    type: "TRANSLATE_PAGE",
    sourceLanguage: settings.sourceLanguage,
    targetLanguage: settings.targetLanguage
  }).catch(() => {});
});
