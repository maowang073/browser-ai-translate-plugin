import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const debuggerBase = process.env.YIYE_DEBUGGER_URL
  || `http://127.0.0.1:${12000 + Math.floor(Math.random() * 20000)}`;
const apiKey = process.env.YIYE_API_KEY;
const baseUrl = process.env.YIYE_BASE_URL || "https://api.deepseek.com";
const model = process.env.YIYE_MODEL || "deepseek-v4-flash";

if (!apiKey) {
  console.error("请通过 YIYE_API_KEY 环境变量提供测试密钥。");
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(root, "test", "browser-fixture.html");
const fixture = await readFile(fixturePath);
const profilePath = await mkdtemp(path.join(tmpdir(), "yiye-chrome-test-"));
const chromePath = process.env.YIYE_CHROME_PATH
  || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const browserProcess = spawn(chromePath, [
  `--remote-debugging-port=${new URL(debuggerBase).port}`,
  `--user-data-dir=${profilePath}`,
  `--disable-extensions-except=${root}`,
  `--load-extension=${root}`,
  "--no-first-run",
  "--disable-default-apps",
  "--disable-component-update",
  "--window-position=-2000,-2000",
  "about:blank"
], { stdio: "ignore" });

const server = createServer((request, response) => {
  if (request.url === "/favicon.ico") {
    response.writeHead(204).end();
    return;
  }
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(fixture);
});
await new Promise((resolve) => server.listen(32123, "127.0.0.1", resolve));

class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    });
  }

  async send(method, params = {}) {
    await this.ready;
    const id = ++this.id;
    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.socket.send(JSON.stringify({ id, method, params }));
    return promise;
  }

  close() {
    this.socket.close();
  }
}

async function createTarget(url) {
  const response = await fetch(`${debuggerBase}/json/new?${encodeURIComponent(url)}`, {
    method: "PUT"
  });
  if (!response.ok) throw new Error(`无法创建浏览器标签页：${response.status}`);
  return response.json();
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || "浏览器脚本执行失败");
  }
  return result.result.value;
}

async function waitFor(check, label, timeout = 30000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    try {
      last = await check();
      if (last) return last;
    } catch (error) {
      last = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`等待“${label}”超时${last ? `：${last}` : ""}`);
}

let fixtureCdp;
let popupCdp;
let optionsCdp;
let browserCdp;

try {
  const browserVersion = await waitFor(async () => {
    const response = await fetch(`${debuggerBase}/json/version`).catch(() => null);
    return response?.ok ? response.json() : null;
  }, "Chrome 调试端口", 15000);
  browserCdp = new Cdp(browserVersion.webSocketDebuggerUrl);

  const fixtureTarget = await createTarget("http://127.0.0.1:32123/");
  fixtureCdp = new Cdp(fixtureTarget.webSocketDebuggerUrl);
  await fixtureCdp.send("Runtime.enable");
  await waitFor(
    () => evaluate(fixtureCdp, "document.readyState === 'complete'"),
    "测试网页加载"
  );

  const extensionId = await waitFor(async () => {
    const targets = await (await fetch(`${debuggerBase}/json/list`)).json();
    const worker = targets.find((target) =>
      target.url.startsWith("chrome-extension://") && target.url.endsWith("/src/background.js")
    );
    return worker?.url.match(/^chrome-extension:\/\/([^/]+)/)?.[1];
  }, "扩展后台启动", 15000);

  const popupTarget = await createTarget(`chrome-extension://${extensionId}/src/popup.html`);
  popupCdp = new Cdp(popupTarget.webSocketDebuggerUrl);
  await popupCdp.send("Runtime.enable");
  await waitFor(
    async () => {
      const state = await evaluate(popupCdp, `({
        ready: document.readyState,
        hasForm: Boolean(document.querySelector('#apiKey')),
        href: location.href,
        title: document.title,
        body: document.body?.innerText.slice(0, 120)
      })`);
      if (state.ready === "complete" && state.hasForm) return true;
      throw new Error(JSON.stringify(state));
    },
    "popup 加载"
  );

  const settings = JSON.stringify({ apiKey, baseUrl, model });
  await evaluate(popupCdp, `(() => {
    const settings = ${settings};
    document.querySelector('#apiKey').value = settings.apiKey;
    document.querySelector('#baseUrl').value = settings.baseUrl;
    document.querySelector('#model').value = settings.model;
    document.querySelector('#sourceLanguage').value = 'en';
    document.querySelector('#targetLanguage').value = 'zh-CN';
    document.querySelector('#testConnection').click();
    return true;
  })()`);
  await waitFor(
    () => evaluate(popupCdp, "document.querySelector('#status').textContent.includes('连接成功')"),
    "popup API 连接测试",
    45000
  );
  console.log("✓ popup 配置与连接测试");

  await evaluate(popupCdp, "document.querySelector('#saveSettings').click()");
  await waitFor(
    () => evaluate(popupCdp, "document.querySelector('#status').textContent.includes('设置已保存')"),
    "保存设置"
  );
  if (process.env.YIYE_SCREENSHOT_PATH) {
    await evaluate(popupCdp, "document.querySelector('#settingsPanel').open = false");
    await popupCdp.send("Emulation.setDeviceMetricsOverride", {
      width: 420,
      height: 640,
      deviceScaleFactor: 1,
      mobile: false
    });
    const screenshot = await popupCdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true
    });
    await writeFile(process.env.YIYE_SCREENSHOT_PATH, screenshot.data, "base64");
  }

  await fixtureCdp.send("Page.bringToFront");
  await evaluate(popupCdp, "document.querySelector('#translatePage').click()");
  await waitFor(
    () => evaluate(fixtureCdp, "/[\\u4e00-\\u9fff]/.test(document.querySelector('#headline').textContent)"),
    "整页翻译",
    90000
  );
  await waitFor(
    () => evaluate(popupCdp, "document.querySelector('#status').textContent.includes('翻译完成')"),
    "翻译完成状态"
  );
  console.log("✓ 整页翻译");

  await fixtureCdp.send("Page.bringToFront");
  await evaluate(popupCdp, "document.querySelector('#restorePage').click()");
  await waitFor(
    () => evaluate(
      fixtureCdp,
      "document.querySelector('#headline').textContent.startsWith('Artificial intelligence')"
    ),
    "还原原文"
  );
  console.log("✓ 还原原文");

  await fixtureCdp.send("Page.bringToFront");
  await evaluate(popupCdp, "document.querySelector('#summarizePage').click()");
  await waitFor(
    () => evaluate(
      popupCdp,
      "document.querySelector('#summaryContent').textContent.length > 30 && !document.querySelector('#summaryContent').textContent.includes('正在')"
    ),
    "网页总结",
    60000
  );
  console.log("✓ 网页总结");

  await evaluate(fixtureCdp, `(() => {
    const node = document.querySelector('#selection').firstChild;
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.querySelector('#selection').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return true;
  })()`);
  await waitFor(
    () => evaluate(
      fixtureCdp,
      "document.querySelector('#yiye-selection-root')?.style.display === 'block'"
    ),
    "划词按钮出现"
  );
  await evaluate(
    fixtureCdp,
    "document.querySelector('#yiye-selection-root').shadowRoot.querySelector('.trigger').click()"
  );
  const selectionResult = await waitFor(
    () => evaluate(fixtureCdp, `(() => {
      const result = document.querySelector('#yiye-selection-root')?.shadowRoot.querySelector('.result');
      return result && !result.classList.contains('loading') && /[\\u4e00-\\u9fff]/.test(result.textContent)
        ? result.textContent
        : '';
    })()`),
    "划词翻译",
    60000
  );
  console.log(`✓ 划词翻译：${selectionResult.slice(0, 40)}…`);

  const optionsTarget = await createTarget(`chrome-extension://${extensionId}/src/options.html`);
  optionsCdp = new Cdp(optionsTarget.webSocketDebuggerUrl);
  await optionsCdp.send("Runtime.enable");
  await waitFor(
    () => evaluate(
      optionsCdp,
      "document.readyState === 'complete' && document.querySelector('#connectionBadge')?.textContent.includes('已连接')"
    ),
    "管理面板加载"
  );
  await waitFor(
    () => evaluate(
      optionsCdp,
      "document.querySelector('#historyList').children.length >= 2 && Number(document.querySelector('#totalTokens').textContent.replace(/,/g, '')) > 0"
    ),
    "历史与 Token 统计"
  );
  await evaluate(optionsCdp, "document.querySelector('#swapLanguages').click()");
  await evaluate(optionsCdp, "document.querySelector('#apiForm').requestSubmit()");
  await waitFor(
    () => evaluate(
      optionsCdp,
      "document.querySelector('#pageStatus').textContent.includes('配置已保存') && document.querySelector('#sourceLanguage').value === 'zh-CN' && document.querySelector('#targetLanguage').value === 'en'"
    ),
    "管理面板语言切换"
  );
  console.log("✓ 管理面板配置、语言切换、翻译历史与 Token 统计");

  if (process.env.YIYE_DASHBOARD_SCREENSHOT_PATH) {
    await optionsCdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    });
    const dashboardScreenshot = await optionsCdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true
    });
    await writeFile(
      process.env.YIYE_DASHBOARD_SCREENSHOT_PATH,
      dashboardScreenshot.data,
      "base64"
    );
  }
} finally {
  fixtureCdp?.close();
  popupCdp?.close();
  optionsCdp?.close();
  if (browserCdp) {
    await Promise.race([
      browserCdp.send("Browser.close").catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 1000))
    ]);
  }
  browserCdp?.close();
  browserProcess.kill();
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => setTimeout(resolve, 500));
  await rm(profilePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
    .catch(() => {});
}
