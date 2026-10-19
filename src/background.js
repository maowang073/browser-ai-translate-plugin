import {
  DEFAULT_SETTINGS,
  requestChat,
  summarizePage,
  translateItems,
  validateSettings
} from "./ai-client.js";

const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS);

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

async function handleMessage(message) {
  switch (message?.type) {
    case "GET_SETTINGS":
      return { ok: true, settings: await getSettings() };

    case "SAVE_SETTINGS":
      return { ok: true, settings: await saveSettings(message.settings || {}) };

    case "SET_SELECTION_ENABLED":
      await chrome.storage.local.set({ selectionEnabled: Boolean(message.enabled) });
      return { ok: true };

    case "TEST_CONNECTION": {
      const settings = { ...(await getSettings()), ...(message.settings || {}) };
      const answer = await requestChat(
        settings,
        [
          { role: "system", content: "你是 API 连通性测试助手，只回复 OK。" },
          { role: "user", content: "回复 OK" }
        ],
        { maxTokens: 256, temperature: 0 }
      );
      return { ok: true, answer };
    }

    case "TRANSLATE_BATCH": {
      const settings = await getSettings();
      const translations = await translateItems(
        settings,
        message.items || [],
        message.sourceLanguage || settings.sourceLanguage,
        message.targetLanguage || settings.targetLanguage
      );
      return { ok: true, translations };
    }

    case "SUMMARIZE_PAGE": {
      const settings = await getSettings();
      const summary = await summarizePage(
        settings,
        message.page,
        message.outputLanguage || settings.targetLanguage
      );
      return { ok: true, summary };
    }

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
