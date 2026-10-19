# 译页 · AI 网页翻译

一款基于 Chrome Manifest V3 的 AI 翻译扩展。使用你自己的 OpenAI 兼容服务，在网页中完成整页翻译、划词翻译和内容总结。

## 功能

- 中英互译，支持自动识别原文语言
- 保留页面结构的整页翻译，可一键还原原文
- 选中文字后通过浮动按钮快速翻译
- 提炼当前网页摘要和关键要点
- 自定义 API Key、Base URL 和模型名称
- 独立管理面板，可修改默认语言并查看翻译历史
- 基于服务端真实 `usage` 数据统计 Token 消耗
- 配置仅保存在浏览器本地存储

## 安装

1. 在 Chrome 地址栏打开 `chrome://extensions/`。
2. 开启右上角的“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本项目根目录。
5. 打开任意普通网页，点击工具栏中的“译页”图标。

首次使用时，在 popup 底部展开“模型设置”，填写：

- API Key：你的服务密钥
- Base URL：例如 `https://api.openai.com/v1` 或 `https://api.deepseek.com`
- 模型：服务商提供的模型名称

点击“测试连接”，成功后保存设置。Chrome 内置页、扩展商店等受浏览器保护的页面不允许内容脚本运行。

点击 popup 底部的“打开管理面板”，可以集中管理 API 和默认语言、浏览最近 200 条翻译记录，并查看近 30 天的 Token 统计。

## 本地检查

需要 Node.js 18 或更高版本。

```bash
npm test
npm run check
```

API 冒烟测试通过环境变量读取凭据，不会把密钥写入项目：

```powershell
$env:YIYE_API_KEY = "你的密钥"
$env:YIYE_BASE_URL = "https://api.deepseek.com"
$env:YIYE_MODEL = "你的模型"
npm run test:api
```

## 权限说明

- `storage`：在本地保存服务配置和使用偏好。
- `activeTab`：从 popup 操作当前标签页。
- `<all_urls>`：让后台服务向用户填写的 API 地址发起请求，并在普通网页中启用翻译。

请只使用可信的 API 服务。API Key 会随翻译请求直接发送到你配置的服务地址。
