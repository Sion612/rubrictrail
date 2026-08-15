# RubricTrail

[English](./README.md) · **简体中文**

**把作业要求变成一份有据可查的计划。**

RubricTrail 是一个本地优先的作业规划工具。它把作业说明和评分标准连接到：

- 已确认的要求；
- 可执行的工作计划；
- 每项评分标准对应的原文依据；
- 草稿自检和最终提交检查。

**[打开公开浏览器 Demo](https://sion612.github.io/rubrictrail/)** — 无需注册、API Key
或付费服务。选中的文件内容、文件名和项目状态保留在浏览器中；GitHub Pages
仍会像普通网站托管服务一样接收页面和静态资源请求信息。

> 当前公开 Demo 已部署通过完整 CI 与 Pages 门禁的 v0.6.0 双语版本。

## 适合谁

RubricTrail 面向需要根据作业说明和评分标准安排工作的学生。它不会替你写作业、
虚构评分项或预测分数，而是帮助你确认：要做什么、为什么要做、还缺少什么依据。

## 两分钟体验

1. 打开 Demo，选择虚构的 LumaLane 示例。
2. 依次查看 **作业说明 → 评分标准 → 计划 → 自检 → 进度**。
3. 也可以上传可信的 TXT、DOCX 或文本型 PDF，或粘贴作业说明与评分标准。
4. 核对识别出的截止日期、字数、引用格式和每个评分项后再创建项目。

## v0.6.0 双语范围

v0.6.0 支持在同一个网址切换 English / 简体中文，并把语言偏好单独保存在
`rubrictrail.preferences.v1`。切换语言不会重开项目，也不会改写项目数据。

语言切换只影响产品界面：

- 会本地化导航、按钮、错误、提示、日期和数字；
- 不会翻译你上传或粘贴的原文；
- 不会翻译项目名称、课程名称、评分项、依据摘录或草稿；
- 自动字段识别仍以英文作业材料为主，中文材料必须逐项对照原文确认。

当前使用单一网址，没有独立 `/zh-CN` 页面、中文 SSR 或 `hreflang` 页面。

## 隐私与安全边界

- 文件在浏览器本地解析，不会发送到 RubricTrail 的服务器。
- 公开静态 Demo 不包含 Live AI API 路由，也不需要 OpenAI Key。
- 原始文件和完整上传/粘贴文本不会写入 `localStorage`。
- 项目会保存确认后的字段、简短依据摘录、草稿、自检和进度。
- 下载的备份包含这些项目数据，未加密、未签名，请妥善保管。
- 只处理你信任的文件；本地解析器不是恶意文档沙箱。

完整限制请阅读 [已知限制](./docs/KNOWN_LIMITATIONS.md) 和
[安全说明](./SECURITY.md)。

## 本地运行

需要 Node.js 24 或更高版本，以及 pnpm 11.9.0。

```bash
git clone https://github.com/Sion612/rubrictrail.git
cd rubrictrail
corepack enable
corepack prepare pnpm@11.9.0 --activate
pnpm install --frozen-lockfile
pnpm dev
```

验证代码：

```bash
pnpm check
PAGES_BASE_PATH=/rubrictrail pnpm build:demo
pnpm audit:demo
```

更完整的架构、测试、解析上限和自托管说明请查看
[英文 README](./README.md)。

## 参与贡献

- [贡献指南](./CONTRIBUTING.md)
- [适合首次贡献的问题](https://github.com/Sion612/rubrictrail/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22good%20first%20issue%22)
- [全部 Issues](https://github.com/Sion612/rubrictrail/issues)

请不要在 Issue、截图、日志或测试文件中提交真实学生姓名、作业材料、备份或
浏览器存储内容。使用仓库提供的虚构示例复现问题。

## 许可证

[Apache-2.0](./LICENSE)
