const elements = {
  apiKey: document.querySelector("#apiKey"),
  baseUrl: document.querySelector("#baseUrl"),
  model: document.querySelector("#model"),
  sourceLanguage: document.querySelector("#sourceLanguage"),
  targetLanguage: document.querySelector("#targetLanguage"),
  selectionEnabled: document.querySelector("#selectionEnabled"),
  connectionBadge: document.querySelector("#connectionBadge"),
  modelSummary: document.querySelector("#modelSummary"),
  settingsPanel: document.querySelector("#settingsPanel"),
  status: document.querySelector("#status"),
  summaryPanel: document.querySelector("#summaryPanel"),
  summaryContent: document.querySelector("#summaryContent"),
  translatePage: document.querySelector("#translatePage"),
  restorePage: document.querySelector("#restorePage"),
  summarizePage: document.querySelector("#summarizePage"),
  swapLanguages: document.querySelector("#swapLanguages"),
  toggleApiKey: document.querySelector("#toggleApiKey"),
  copySummary: document.querySelector("#copySummary"),
  testConnection: document.querySelector("#testConnection"),
  saveSettings: document.querySelector("#saveSettings")
};

function showStatus(message, type = "") {
  elements.status.textContent = message;
  elements.status.className = `status ${type}`.trim();
}

function setButtonBusy(button, busy, busyText) {
  if (!button.dataset.defaultText) {
    button.dataset.defaultText = button.querySelector("span:last-child")?.textContent
      || button.textContent;
  }
  button.disabled = busy;
  const textNode = button.querySelector("span:last-child");
  if (textNode) {
    textNode.textContent = busy ? busyText : button.dataset.defaultText;
  } else {
    button.textContent = busy ? busyText : button.dataset.defaultText;
  }
}

function formSettings() {
  return {
    apiKey: elements.apiKey.value.trim(),
    baseUrl: elements.baseUrl.value.trim(),
    model: elements.model.value.trim(),
    sourceLanguage: elements.sourceLanguage.value,
    targetLanguage: elements.targetLanguage.value,
    selectionEnabled: elements.selectionEnabled.checked
  };
}

function renderSettings(settings) {
  elements.apiKey.value = settings.apiKey || "";
  elements.baseUrl.value = settings.baseUrl || "";
  elements.model.value = settings.model || "";
  elements.sourceLanguage.value = settings.sourceLanguage || "auto";
  elements.targetLanguage.value = settings.targetLanguage || "zh-CN";
  elements.selectionEnabled.checked = settings.selectionEnabled !== false;

  const ready = Boolean(settings.apiKey && settings.baseUrl && settings.model);
  elements.connectionBadge.textContent = ready ? "已配置" : "未配置";
  elements.connectionBadge.classList.toggle("ready", ready);
  elements.modelSummary.textContent = ready ? settings.model : "配置你的 API";
  if (!ready) elements.settingsPanel.open = true;
}

async function runtimeMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "操作失败");
  return response;
}

async function activeTabMessage(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("找不到当前标签页");
  try {
    const response = await chrome.tabs.sendMessage(tab.id, message);
    if (!response?.ok) throw new Error(response?.error || "页面操作失败");
    return response;
  } catch (error) {
    if (/Receiving end does not exist|Could not establish connection/i.test(error.message)) {
      throw new Error("此页面无法使用插件，请打开普通网页或刷新页面后重试");
    }
    throw error;
  }
}

async function init() {
  try {
    const response = await runtimeMessage({ type: "GET_SETTINGS" });
    renderSettings(response.settings);
  } catch (error) {
    showStatus(error.message, "error");
  }
}

elements.swapLanguages.addEventListener("click", () => {
  const source = elements.sourceLanguage.value;
  const target = elements.targetLanguage.value;
  elements.sourceLanguage.value = target;
  elements.targetLanguage.value = source === "auto"
    ? (target === "zh-CN" ? "en" : "zh-CN")
    : source;
  chrome.storage.local.set({
    sourceLanguage: elements.sourceLanguage.value,
    targetLanguage: elements.targetLanguage.value
  });
});

for (const select of [elements.sourceLanguage, elements.targetLanguage]) {
  select.addEventListener("change", () => {
    if (elements.sourceLanguage.value === elements.targetLanguage.value) {
      if (select === elements.sourceLanguage) {
        elements.targetLanguage.value = select.value === "zh-CN" ? "en" : "zh-CN";
      } else {
        elements.sourceLanguage.value = select.value === "zh-CN" ? "en" : "zh-CN";
      }
    }
    chrome.storage.local.set({
      sourceLanguage: elements.sourceLanguage.value,
      targetLanguage: elements.targetLanguage.value
    });
  });
}

elements.selectionEnabled.addEventListener("change", async () => {
  try {
    await runtimeMessage({
      type: "SET_SELECTION_ENABLED",
      enabled: elements.selectionEnabled.checked
    });
    showStatus(elements.selectionEnabled.checked ? "已开启划词翻译" : "已关闭划词翻译", "success");
  } catch (error) {
    showStatus(error.message, "error");
  }
});

elements.toggleApiKey.addEventListener("click", () => {
  const visible = elements.apiKey.type === "text";
  elements.apiKey.type = visible ? "password" : "text";
  elements.toggleApiKey.textContent = visible ? "显示" : "隐藏";
  elements.toggleApiKey.setAttribute("aria-label", visible ? "显示 API Key" : "隐藏 API Key");
});

elements.saveSettings.addEventListener("click", async () => {
  setButtonBusy(elements.saveSettings, true, "保存中…");
  showStatus("");
  try {
    const response = await runtimeMessage({
      type: "SAVE_SETTINGS",
      settings: formSettings()
    });
    renderSettings(response.settings);
    showStatus("设置已保存", "success");
  } catch (error) {
    showStatus(error.message, "error");
  } finally {
    setButtonBusy(elements.saveSettings, false);
  }
});

elements.testConnection.addEventListener("click", async () => {
  setButtonBusy(elements.testConnection, true, "测试中…");
  showStatus("正在连接模型…");
  try {
    await runtimeMessage({
      type: "TEST_CONNECTION",
      settings: formSettings()
    });
    showStatus("连接成功，模型可以正常响应", "success");
  } catch (error) {
    showStatus(error.message, "error");
  } finally {
    setButtonBusy(elements.testConnection, false);
  }
});

elements.translatePage.addEventListener("click", async () => {
  setButtonBusy(elements.translatePage, true, "正在翻译…");
  showStatus("正在读取网页内容…");
  try {
    const result = await activeTabMessage({
      type: "TRANSLATE_PAGE",
      sourceLanguage: elements.sourceLanguage.value,
      targetLanguage: elements.targetLanguage.value
    });
    showStatus(`翻译完成，共处理 ${result.translated} 段文字`, "success");
  } catch (error) {
    showStatus(error.message, "error");
  } finally {
    setButtonBusy(elements.translatePage, false);
  }
});

elements.restorePage.addEventListener("click", async () => {
  try {
    const result = await activeTabMessage({ type: "RESTORE_PAGE" });
    showStatus(
      result.restored ? `已还原 ${result.restored} 段文字` : "当前页面没有需要还原的内容",
      "success"
    );
  } catch (error) {
    showStatus(error.message, "error");
  }
});

elements.summarizePage.addEventListener("click", async () => {
  setButtonBusy(elements.summarizePage, true, "总结中…");
  elements.summaryPanel.hidden = false;
  elements.summaryContent.textContent = "正在读取并分析当前网页…";
  showStatus("");
  try {
    const { page } = await activeTabMessage({ type: "GET_PAGE_CONTENT" });
    if (!page.text) throw new Error("当前页面没有可总结的正文");
    const response = await runtimeMessage({
      type: "SUMMARIZE_PAGE",
      page,
      outputLanguage: elements.targetLanguage.value
    });
    elements.summaryContent.textContent = response.summary;
    showStatus("网页总结完成", "success");
  } catch (error) {
    elements.summaryContent.textContent = error.message;
    showStatus(error.message, "error");
  } finally {
    setButtonBusy(elements.summarizePage, false);
  }
});

elements.copySummary.addEventListener("click", async () => {
  const text = elements.summaryContent.textContent.trim();
  if (!text) return;
  await navigator.clipboard.writeText(text);
  elements.copySummary.textContent = "已复制";
  setTimeout(() => {
    elements.copySummary.textContent = "复制";
  }, 1200);
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "TRANSLATION_PROGRESS") return false;
  if (message.status === "translating") {
    const percent = Math.round((message.completed / message.total) * 100) || 0;
    showStatus(`正在翻译网页… ${percent}%`);
  } else if (message.status === "error") {
    showStatus(message.error || "翻译失败", "error");
  }
  return false;
});

init();
