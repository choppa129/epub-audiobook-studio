# SoundLeaf 声页

一个纯前端的 EPUB → 有声书网页工具。EPUB 在浏览器本地解析，用户使用自己的 OpenAI-compatible TTS API Key 生成分章节 MP3。

## 功能

- 本地解析 EPUB 目录、书名、作者与正文
- 选择需要生成的章节并预览提取文本
- 支持自定义 API 地址、模型、声音与朗读指令
- 长章节自动分段并顺序生成
- 试听、下载单章 MP3，或打包下载 ZIP
- API Key 只放在 `sessionStorage`，关闭标签页后清除
- 响应式中文界面，可直接部署至 GitHub Pages

## 本地运行

由于浏览器模块与文件安全策略，请用任意静态服务器打开，而不是直接双击 `index.html`：

```bash
npx serve .
```

## GitHub Pages

仓库内已包含 Pages workflow。推送到 `main` 后，在仓库 **Settings → Pages → Build and deployment** 中选择 **GitHub Actions**。

> 私有仓库是否支持 Pages 取决于 GitHub 账户套餐。即使源仓库是私有的，Pages 站点通常仍可能公开访问；请在 GitHub 的 Pages 设置中确认访问权限。

## 隐私与限制

- EPUB 内容只在本地浏览器读取；被选中的正文片段会直接发送到用户配置的 TTS 服务。
- 静态网页无法替用户安全保管共享 API Key，因此每位用户都必须填写自己的 Key。
- 第一版输出分章节 MP3/ZIP。带章节元数据的 M4B 需要浏览器端转码，计划后续实现。
- 请仅转换你拥有或获授权使用的内容。

## License

MIT
