const $ = (selector) => document.querySelector(selector);
const elements = {
  todayLabel: $("#todayLabel"),
  connectionBadge: $("#connectionBadge"),
  pageStatus: $("#pageStatus"),
  apiForm: $("#apiForm"),
  apiKey: $("#apiKey"),
  baseUrl: $("#baseUrl"),
  model: $("#model"),
  toggleApiKey: $("#toggleApiKey"),
  sourceLanguage: $("#sourceLanguage"),
  targetLanguage: $("#targetLanguage"),
  sourcePreview: $("#sourcePreview"),
  targetPreview: $("#targetPreview"),
  swapLanguages: $("#swapLanguages"),
  testConnection: $("#testConnection"),
  saveSettings: $("#saveSettings"),
  totalTokens: $("#totalTokens"),
  promptTokens: $("#promptTokens"),
  completionTokens: $("#completionTokens"),
  requestCount: $("#requestCount"),
  translationTokens: $("#translationTokens"),
  summaryTokens: $("#summaryTokens"),
  connectionTokens: $("#connectionTokens"),
  usageChart: $("#usageChart"),
  resetUsage: $("#resetUsage"),
  historyList: $("#historyList"),
  historyEmpty: $("#historyEmpty"),
  historyCount: $("#historyCount"),
  historySearch: $("#historySearch"),
  historyFilter: $("#historyFilter"),
  clearHistory: $("#clearHistory"),
  openPopupHelp: $("#openPopupHelp")
};

const LANGUAGE_NAMES = {
  auto: "自动识别",
  "zh-CN": "简体中文",
  en: "English"
};

let dashboardData = {
  settings: {},
  history: [],
  usageStats: {}
};
let statusTimer;
let reloadTimer;

async function runtimeMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "操作失败");
  return response;
}

function showStatus(message, type = "") {
  clearTimeout(statusTimer);
  elements.pageStatus.textContent = message;
  elements.pageStatus.className = `page-status visible ${type}`.trim();
  statusTimer = setTimeout(() => {
    elements.pageStatus.classList.remove("visible");
  }, 2800);
}

function setBusy(button, busy, busyText) {
  if (!button.dataset.text) button.dataset.text = button.textContent;
  button.disabled = busy;
  button.textContent = busy ? busyText : button.dataset.text;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("zh-CN");
}

function formSettings() {
  return {
    apiKey: elements.apiKey.value.trim(),
    baseUrl: elements.baseUrl.value.trim(),
    model: elements.model.value.trim(),
    sourceLanguage: elements.sourceLanguage.value,
    targetLanguage: elements.targetLanguage.value
  };
}

function renderSettings(settings) {
  elements.apiKey.value = settings.apiKey || "";
  elements.baseUrl.value = settings.baseUrl || "";
  elements.model.value = settings.model || "";
  elements.sourceLanguage.value = settings.sourceLanguage || "auto";
  elements.targetLanguage.value = settings.targetLanguage || "zh-CN";
  const ready = Boolean(settings.apiKey && settings.baseUrl && settings.model);
  elements.connectionBadge.textContent = ready ? `已连接 · ${settings.model}` : "未配置";
  elements.connectionBadge.classList.toggle("ready", ready);
  renderLanguagePreview();
}

function renderLanguagePreview() {
  elements.sourcePreview.textContent = LANGUAGE_NAMES[elements.sourceLanguage.value];
  elements.targetPreview.textContent = LANGUAGE_NAMES[elements.targetLanguage.value];
}

function recentDateKeys(days = 7) {
  return Array.from({ length: days }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (days - index - 1));
    return date.toISOString().slice(0, 10);
  });
}

function renderUsage(stats) {
  elements.totalTokens.textContent = formatNumber(stats.totalTokens);
  elements.promptTokens.textContent = formatNumber(stats.promptTokens);
  elements.completionTokens.textContent = formatNumber(stats.completionTokens);
  elements.requestCount.textContent = `${formatNumber(stats.requests)} 次 API 请求`;
  elements.translationTokens.textContent = formatNumber(stats.byOperation?.translation?.totalTokens);
  elements.summaryTokens.textContent = formatNumber(stats.byOperation?.summary?.totalTokens);
  elements.connectionTokens.textContent = formatNumber(stats.byOperation?.connection?.totalTokens);

  const keys = recentDateKeys();
  const values = keys.map((key) => Number(stats.daily?.[key]?.totalTokens || 0));
  const maximum = Math.max(...values, 1);
  elements.usageChart.replaceChildren();

  keys.forEach((key, index) => {
    const date = new Date(`${key}T00:00:00`);
    const day = document.createElement("div");
    day.className = `chart-day ${index === keys.length - 1 ? "today" : ""}`.trim();
    day.title = `${key}：${formatNumber(values[index])} Token`;
    const bar = document.createElement("i");
    bar.className = "chart-bar";
    bar.style.height = `${Math.max(3, Math.round((values[index] / maximum) * 100))}%`;
    const label = document.createElement("span");
    label.textContent = index === keys.length - 1
      ? "今天"
      : date.toLocaleDateString("zh-CN", { weekday: "short" }).replace("周", "");
    day.append(bar, label);
    elements.usageChart.append(day);
  });
}

function historyMatches(entry) {
  const filter = elements.historyFilter.value;
  const query = elements.historySearch.value.trim().toLocaleLowerCase();
  if (filter !== "all" && entry.kind !== filter) return false;
  if (!query) return true;
  return [entry.title, entry.sourceText, entry.translatedText]
    .some((value) => String(value || "").toLocaleLowerCase().includes(query));
}

function createHistoryItem(entry) {
  const item = document.createElement("article");
  item.className = "history-item";

  const kind = document.createElement("span");
  kind.className = `history-kind ${entry.kind}`;
  kind.textContent = entry.kind === "selection" ? "划" : "页";

  const meta = document.createElement("div");
  meta.className = "history-meta";
  const title = document.createElement("strong");
  title.textContent = entry.title || "未命名网页";
  title.title = entry.title || "";
  const time = document.createElement("small");
  time.textContent = new Date(entry.createdAt).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
  meta.append(title, time);

  const text = document.createElement("div");
  text.className = "history-text";
  const source = document.createElement("p");
  source.textContent = entry.sourceText || "未保存原文预览";
  source.title = entry.sourceText || "";
  const translated = document.createElement("p");
  translated.textContent = entry.translatedText || "未保存译文预览";
  translated.title = entry.translatedText || "";
  text.append(source, translated);

  const language = document.createElement("div");
  language.className = "history-language";
  const pair = document.createElement("strong");
  pair.textContent = `${LANGUAGE_NAMES[entry.sourceLanguage] || entry.sourceLanguage} → ${LANGUAGE_NAMES[entry.targetLanguage] || entry.targetLanguage}`;
  const count = document.createElement("span");
  count.textContent = entry.kind === "page" ? `${entry.segmentCount || 0} 段` : "划词";
  language.append(pair, count);

  item.append(kind, meta, text, language);
  return item;
}

function renderHistory() {
  const history = dashboardData.history || [];
  const visible = history.filter(historyMatches);
  elements.historyList.replaceChildren(...visible.map(createHistoryItem));
  elements.historyEmpty.hidden = visible.length > 0;
  elements.historyCount.textContent = history.length
    ? visible.length === history.length
      ? `共 ${history.length} 条记录`
      : `显示 ${visible.length} / ${history.length} 条记录`
    : "还没有翻译记录";
}

async function loadDashboard() {
  const response = await runtimeMessage({ type: "GET_DASHBOARD_DATA" });
  dashboardData = response;
  renderSettings(response.settings);
  renderUsage(response.usageStats);
  renderHistory();
}

elements.apiForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setBusy(elements.saveSettings, true, "保存中…");
  try {
    const response = await runtimeMessage({
      type: "SAVE_SETTINGS",
      settings: formSettings()
    });
    dashboardData.settings = response.settings;
    renderSettings(response.settings);
    showStatus("API 与语言配置已保存", "success");
  } catch (error) {
    showStatus(error.message, "error");
  } finally {
    setBusy(elements.saveSettings, false);
  }
});

elements.testConnection.addEventListener("click", async () => {
  setBusy(elements.testConnection, true, "测试中…");
  try {
    await runtimeMessage({ type: "TEST_CONNECTION", settings: formSettings() });
    const response = await runtimeMessage({ type: "GET_DASHBOARD_DATA" });
    dashboardData.usageStats = response.usageStats;
    renderUsage(response.usageStats);
    showStatus("连接成功，模型可以正常响应", "success");
  } catch (error) {
    showStatus(error.message, "error");
  } finally {
    setBusy(elements.testConnection, false);
  }
});

elements.toggleApiKey.addEventListener("click", () => {
  const visible = elements.apiKey.type === "text";
  elements.apiKey.type = visible ? "password" : "text";
  elements.toggleApiKey.textContent = visible ? "显示" : "隐藏";
});

elements.swapLanguages.addEventListener("click", () => {
  const source = elements.sourceLanguage.value;
  const target = elements.targetLanguage.value;
  elements.sourceLanguage.value = target;
  elements.targetLanguage.value = source === "auto"
    ? (target === "zh-CN" ? "en" : "zh-CN")
    : source;
  renderLanguagePreview();
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
    renderLanguagePreview();
  });
}

elements.historySearch.addEventListener("input", renderHistory);
elements.historyFilter.addEventListener("change", renderHistory);

elements.clearHistory.addEventListener("click", async () => {
  if (!dashboardData.history.length) return;
  if (!confirm("确定清空全部翻译历史吗？此操作无法撤销。")) return;
  await runtimeMessage({ type: "CLEAR_HISTORY" });
  dashboardData.history = [];
  renderHistory();
  showStatus("翻译历史已清空", "success");
});

elements.resetUsage.addEventListener("click", async () => {
  if (!confirm("确定重置全部 Token 统计吗？")) return;
  await runtimeMessage({ type: "RESET_USAGE" });
  await loadDashboard();
  showStatus("Token 统计已重置", "success");
});

elements.openPopupHelp.addEventListener("click", () => {
  document.querySelector("#settings").scrollIntoView({ behavior: "smooth" });
  showStatus("保存配置后，在任意网页点击工具栏中的译页图标即可使用");
});

const sections = [...document.querySelectorAll("main > section[id]")];
const navLinks = [...document.querySelectorAll(".sidebar nav a")];
const observer = new IntersectionObserver((entries) => {
  const visible = entries
    .filter((entry) => entry.isIntersecting)
    .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
  if (!visible) return;
  navLinks.forEach((link) => {
    link.classList.toggle("active", link.hash === `#${visible.target.id}`);
  });
}, { rootMargin: "-20% 0px -65%", threshold: [0, .2, .5] });
sections.forEach((section) => observer.observe(section));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.usageStats) {
    dashboardData.usageStats = changes.usageStats.newValue || {};
    renderUsage(dashboardData.usageStats);
  }
  if (changes.translationHistory) {
    dashboardData.history = changes.translationHistory.newValue || [];
    renderHistory();
  }
  if (!["apiKey", "baseUrl", "model", "sourceLanguage", "targetLanguage"]
    .some((key) => changes[key])) return;
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => loadDashboard().catch(() => {}), 120);
});

elements.todayLabel.textContent = new Date().toLocaleDateString("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "long"
});

loadDashboard().catch((error) => showStatus(error.message, "error"));
