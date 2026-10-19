(() => {
  const originalText = new WeakMap();
  const translatedNodes = new Set();
  let isTranslating = false;
  let selectionEnabled = true;
  let selectionText = "";
  let selectionHost;
  let selectionRoot;

  function isEligibleTextNode(node) {
    const text = node.nodeValue?.trim();
    const parent = node.parentElement;
    if (!text || text.length < 2 || !parent) return false;
    if (!/[\p{L}\p{Script=Han}]/u.test(text)) return false;
    if (parent.closest(
      "script, style, noscript, template, textarea, input, select, option, code, pre, svg, canvas, [contenteditable='true'], [aria-hidden='true']"
    )) return false;
    if (selectionHost && selectionHost.contains(parent)) return false;
    const style = getComputedStyle(parent);
    return style.display !== "none"
      && style.visibility !== "hidden"
      && Number(style.opacity) !== 0
      && parent.getClientRects().length > 0;
  }

  function collectTextNodes() {
    const nodes = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => isEligibleTextNode(node)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT
      }
    );

    while (walker.nextNode() && nodes.length < 1500) {
      nodes.push(walker.currentNode);
    }
    return nodes;
  }

  function createBatches(nodes) {
    const batches = [];
    let current = [];
    let size = 0;

    for (const node of nodes) {
      const text = originalText.get(node) ?? node.nodeValue.trim();
      const itemSize = text.length;
      if (current.length && (current.length >= 35 || size + itemSize > 3200)) {
        batches.push(current);
        current = [];
        size = 0;
      }
      current.push({ node, text });
      size += itemSize;
    }
    if (current.length) batches.push(current);
    return batches;
  }

  async function sendRuntimeMessage(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) {
      throw new Error(response?.error || "插件后台没有响应");
    }
    return response;
  }

  function notifyProgress(payload) {
    chrome.runtime.sendMessage({
      type: "TRANSLATION_PROGRESS",
      ...payload
    }).catch(() => {});
  }

  function restorePage() {
    let restored = 0;
    for (const node of translatedNodes) {
      if (node.isConnected && originalText.has(node)) {
        node.nodeValue = originalText.get(node);
        restored += 1;
      }
    }
    translatedNodes.clear();
    notifyProgress({ status: "restored", completed: restored, total: restored });
    return restored;
  }

  async function translatePage(sourceLanguage, targetLanguage) {
    if (isTranslating) throw new Error("页面正在翻译，请稍候");
    isTranslating = true;

    if (translatedNodes.size) restorePage();
    const nodes = collectTextNodes();
    if (!nodes.length) {
      isTranslating = false;
      throw new Error("当前页面没有可翻译的文本");
    }

    const batches = createBatches(nodes);
    let completed = 0;
    notifyProgress({ status: "translating", completed, total: nodes.length });

    try {
      for (const batch of batches) {
        const items = batch.map((entry, index) => ({
          id: `${completed + index}`,
          text: entry.text
        }));
        const response = await sendRuntimeMessage({
          type: "TRANSLATE_BATCH",
          items,
          sourceLanguage,
          targetLanguage
        });

        const translations = new Map(
          response.translations.map((item) => [String(item.id), item.text])
        );
        batch.forEach((entry, index) => {
          if (!originalText.has(entry.node)) {
            originalText.set(entry.node, entry.node.nodeValue);
          }
          const translated = translations.get(String(completed + index));
          if (translated) {
            const leading = entry.node.nodeValue.match(/^\s*/)?.[0] || "";
            const trailing = entry.node.nodeValue.match(/\s*$/)?.[0] || "";
            entry.node.nodeValue = `${leading}${translated}${trailing}`;
            translatedNodes.add(entry.node);
          }
        });

        completed += batch.length;
        notifyProgress({ status: "translating", completed, total: nodes.length });
      }
      notifyProgress({ status: "done", completed, total: nodes.length });
      return { translated: completed, batches: batches.length };
    } catch (error) {
      restorePage();
      notifyProgress({
        status: "error",
        completed,
        total: nodes.length,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    } finally {
      isTranslating = false;
    }
  }

  function getPageContent() {
    const title = document.title.trim();
    const raw = document.body?.innerText || "";
    const text = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line, index, lines) => line !== lines[index - 1])
      .join("\n")
      .slice(0, 40000);
    return { title, url: location.href, text };
  }

  function ensureSelectionUi() {
    if (selectionHost) return;
    selectionHost = document.createElement("div");
    selectionHost.id = "yiye-selection-root";
    Object.assign(selectionHost.style, {
      position: "fixed",
      inset: "0 auto auto 0",
      zIndex: "2147483647",
      display: "none",
      pointerEvents: "none"
    });
    selectionRoot = selectionHost.attachShadow({ mode: "open" });
    selectionRoot.innerHTML = `
      <style>
        :host { all: initial; }
        .wrap {
          width: 288px;
          color: #172035;
          font-family: "Microsoft YaHei UI", "PingFang SC", sans-serif;
          pointer-events: auto;
          filter: drop-shadow(0 12px 30px rgba(31, 54, 104, .2));
        }
        button { font: inherit; }
        .trigger {
          width: 34px; height: 34px; border: 0; border-radius: 11px;
          display: grid; place-items: center; cursor: pointer;
          color: white; background: #3156d9;
          box-shadow: inset 0 0 0 1px rgba(255,255,255,.18);
          font-weight: 700; font-size: 14px;
        }
        .trigger:hover { background: #2447c1; }
        .panel {
          display: none; overflow: hidden; border-radius: 14px;
          background: #fff; border: 1px solid #dfe5f4;
        }
        .panel.open { display: block; }
        .head {
          display: flex; align-items: center; justify-content: space-between;
          padding: 10px 12px; background: #f4f7ff; color: #5e6982;
          font-size: 12px;
        }
        .close {
          border: 0; background: transparent; color: #66718b;
          cursor: pointer; padding: 1px 4px; font-size: 18px; line-height: 1;
        }
        .result {
          margin: 0; padding: 13px 14px 15px; max-height: 180px;
          overflow: auto; white-space: pre-wrap; font-size: 14px;
          line-height: 1.65; user-select: text;
        }
        .loading { color: #6b7690; }
      </style>
      <div class="wrap">
        <button class="trigger" type="button" aria-label="翻译选中文本">译</button>
        <section class="panel" aria-live="polite">
          <div class="head"><span>译页 · 划词翻译</span><button class="close" aria-label="关闭">×</button></div>
          <p class="result"></p>
        </section>
      </div>
    `;
    document.documentElement.appendChild(selectionHost);

    selectionRoot.querySelector(".trigger").addEventListener("click", async (event) => {
      event.stopPropagation();
      const trigger = selectionRoot.querySelector(".trigger");
      const panel = selectionRoot.querySelector(".panel");
      const result = selectionRoot.querySelector(".result");
      trigger.style.display = "none";
      panel.classList.add("open");
      result.classList.add("loading");
      result.textContent = "正在翻译…";

      try {
        const response = await sendRuntimeMessage({
          type: "TRANSLATE_BATCH",
          items: [{ id: "selection", text: selectionText }]
        });
        result.textContent = response.translations[0]?.text || "没有获得译文";
        result.classList.remove("loading");
      } catch (error) {
        result.textContent = error instanceof Error ? error.message : String(error);
        result.classList.remove("loading");
      }
    });

    selectionRoot.querySelector(".close").addEventListener("click", hideSelectionUi);
  }

  function showSelectionUi(rect, text) {
    ensureSelectionUi();
    selectionText = text;
    const width = 288;
    const left = Math.min(
      Math.max(8, rect.left + rect.width / 2 - 17),
      window.innerWidth - width - 8
    );
    const top = Math.min(rect.bottom + 8, window.innerHeight - 230);
    selectionHost.style.left = `${left}px`;
    selectionHost.style.top = `${Math.max(8, top)}px`;
    selectionHost.style.display = "block";
    selectionRoot.querySelector(".trigger").style.display = "grid";
    selectionRoot.querySelector(".panel").classList.remove("open");
  }

  function hideSelectionUi() {
    if (selectionHost) selectionHost.style.display = "none";
    selectionText = "";
  }

  document.addEventListener("mouseup", (event) => {
    if (!selectionEnabled || selectionHost?.contains(event.target)) return;
    setTimeout(() => {
      const selection = window.getSelection();
      const text = selection?.toString().trim();
      if (!text || text.length < 2 || text.length > 3000 || selection.rangeCount === 0) {
        hideSelectionUi();
        return;
      }
      showSelectionUi(selection.getRangeAt(0).getBoundingClientRect(), text);
    }, 0);
  });

  document.addEventListener("mousedown", (event) => {
    if (selectionHost && !selectionHost.contains(event.target)) hideSelectionUi();
  });
  window.addEventListener("scroll", hideSelectionUi, { passive: true });

  chrome.storage.local.get(["selectionEnabled"]).then((value) => {
    selectionEnabled = value.selectionEnabled !== false;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.selectionEnabled) {
      selectionEnabled = changes.selectionEnabled.newValue !== false;
      if (!selectionEnabled) hideSelectionUi();
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "TRANSLATE_PAGE") {
      translatePage(message.sourceLanguage, message.targetLanguage)
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((error) => sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        }));
      return true;
    }

    if (message?.type === "RESTORE_PAGE") {
      sendResponse({ ok: true, restored: restorePage() });
      return false;
    }

    if (message?.type === "GET_PAGE_CONTENT") {
      sendResponse({ ok: true, page: getPageContent() });
      return false;
    }

    if (message?.type === "PING") {
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });
})();
