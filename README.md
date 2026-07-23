# yuque-dl — 语雀知识库下载器

[![Manifest Version](https://img.shields.io/badge/Manifest-V3-blue)]()
[![License](https://img.shields.io/badge/License-MIT-green)]()

> 一款浏览器扩展，一键将语雀知识库导出为本地 Markdown 文件（ZIP），保留目录结构和图片附件。
> A browser extension to export Yuque knowledge bases to local Markdown files in ZIP format, preserving directory structure, images, and attachments.

---

## 功能特性 / Features

### 🇨🇳 中文

- 🔍 **自动识别知识库页面** — 进入语雀知识库后，右下角自动出现下载按钮
- 📁 **保留目录结构** — 按原文目录层级组织 Markdown 文件
- 🖼️ **下载图片资源** — 自动下载文章中的图片并链接到本地路径
- 📎 **下载文件附件** — 支持下载附件
- 📊 **表格支持** — 将语雀电子表格转换为 Markdown 表格
- ⚡ **并发下载** — 3 个 Worker 并发抓取，速度更快
- 📦 **ZIP 打包** — 所有内容打包为 ZIP 文件一键下载
- ⚙️ **可配置选项** — 可忽略图片、附件，隐藏页脚，生成目录等
- 🔒 **使用当前登录会话** — 无需额外 Token

### 🇬🇧 English

- 🔍 **Auto-detect knowledge base pages** — A download button appears at the bottom-right corner
- 📁 **Preserve directory structure** — Markdown files are organized by the original TOC hierarchy
- 🖼️ **Download images** — Images in articles are downloaded and linked locally
- 📎 **Download attachments** — File attachments are supported
- 📊 **Sheet support** — Convert Yuque spreadsheets to Markdown tables
- ⚡ **Concurrent download** — 3 concurrent workers for faster fetching
- 📦 **ZIP packaging** — All content is packed into a single ZIP file
- ⚙️ **Configurable options** — Toggle images, attachments, footer, TOC, etc.
- 🔒 **Uses your current session** — No extra token required

---

## 工作原理 / How It Works

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Content Script  │────▶│  Content Script  │────▶│  Floating Button  │
│  (content.js)    │     │  Parses TOC & data  │     │  (Inject UI)      │
└──────────────┘     └──────────────┘     └──────────────┘
                                                    │
                                                    ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Service Worker │◀───│  Port (长连接)  │◀───│  User clicks   │
│  (background.js)│     │  keeps SW alive  │     │  Download btn  │
│  + JSZip        │     └──────────────┘     └──────────────┘
│  + 3 Workers    │
└───────┬───────┘
        │
        ▼
┌─────────────────────────────────────────────┐
│  For each article in TOC:                   │
│    1. Fetch Markdown via Yuque API          │
│    2. Fetch metadata via Yuque API          │
│    3. Download images → img/<uuid>/         │
│    4. Download attachments → attachments/<uuid>/     │
│    5. Fix LaTeX, code blocks, image URLs    │
│    6. Write to directory tree                  │
└─────────────────────────────────────────────┘
        │
        ▼
┌──────────────────────┐
│  Generate index.md     │
│  Pack ZIP via JSZip   │
│  Trigger browser DL   │
└──────────────────────┘
```

### 技术要点 / Technical Highlights

- **Content Script** (content.js): 解析语雀页面嵌入的 JSON 数据，提取知识库 TOC 和信息
- **Service Worker** (background.js): 通过长连接 Port 保持活跃，串联抓取、打包、下载流程
- **并发控制** (Concurrency): 使用 3 个异步 Worker 并行处理文章，提升下载效率
- **ZIP 生成**: 使用 JSZip 库在浏览器端完成打包，无需服务端参与
- **图片签名**: 通过 SHA-256 签名绕过语雀图片防盗链

---

## 安装方法 / Installation

### 开发者模式安装 / Developer Mode

1. 下载本仓库的最新 Release，或克隆代码：
   ```bash
   git clone https://github.com/locense/yuque-download.git
   ```
2. 打开 Chrome，进入 chrome://extensions
3. 打开右上角的 **开发者模式**
4. 点击 **加载已解压的扩展程序**
5. 选择本项目的根目录

---

## 使用方法 / Usage

1. 打开任意语雀知识库页面（如 https://www.yuque.com/xxx/yyy）
2. 页面右下角会出现一个 ⬇ 下载按钮
3. 点击按钮，弹出进度面板
4. 等待下载完成，浏览器会自动下载 ZIP 文件
5. 解压后即可获得本地 Markdown 文件

### 设置选项 / Options

| 选项 | 说明 | Description |
|------|------|-------------|
| 忽略图片 | 不下载文章中图片 | Skip downloading images |
| 忽略附件 | 不下载文件附件 | Skip downloading attachments |
| 文章内生成目录 | 在每篇文章前插入 TOC | Insert TOC in each article |
| 隐藏页脚 | 不添加更新时间/原文链接 | Hide update time and source link |
| 转换视频链接 | 将视频链接转为 <video> 标签 | Convert video links |

---

## 项目结构 / Project Structure

```
yuque-download/
├── manifest.json          # 插件清单
├── background.js          # Service Worker (后台)
├── content.js             # 内容脚本
├── content.css            # 内容样式
├── icons/                 # 插件图标
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── lib/
│   └── jszip.min.js       # JSZip 库
└── popup/                 # 弹出窗口
    ├── popup.html
    ├── popup.css
    └── popup.js
```

---

## 更新日志 / Changelog

### v1.1.0 (2026-07-23)

- 🐛 **修复图片下载路径问题** — 修正多层目录文章的图片相对路径，现在图片在 Markdown 中能正确显示
- 🚀 **改进图片下载策略** — 优先从 CDN 直接下载（无需认证），失败后再走签名代理，下载更可靠
- 🔗 **修复附件路径** — 附件的 Markdown 引用路径也使用正确的相对路径
- 🌐 **扩展域名权限** — 增加 *.nlark.com 和 *.yuque.com CDN 域名访问权限
- ✨ 增加 CDN 直连下载 fallback，提升下载成功率

### v1.0.0 (2026-07-22)

- 初始版本发布：一键将语雀知识库下载为本地 Markdown 文件

---

## 许可证 / License

[MIT](LICENSE)

---

*Made with ❤️ for the Yuque community*