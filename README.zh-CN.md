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

> 当前公开 Demo 已部署通过完整 CI 与 Pages 门禁的 v0.7.0 版本；v0.7.1
> 的双语 Project Tracker 正在等待自己的发布门禁。

## 适合谁

RubricTrail 面向需要根据作业说明和评分标准安排工作的学生。它不会替你写作业、
虚构评分项或预测分数，而是帮助你确认：要做什么、为什么要做、还缺少什么依据。

## 两分钟体验

1. 打开 Demo，选择虚构的 LumaLane 示例。
2. 依次查看 **作业说明 → 评分标准 → 计划 → 自检 → 进度**。
3. 也可以上传可信的 TXT、DOCX、文本型 PDF、PNG、JPG/JPEG 或 WebP，或粘贴作业说明与评分标准。
4. 核对识别出的截止日期、字数、引用格式和每个评分项后再创建项目。

## v0.7.1：Project Tracker、来源定位与本地 ICS

v0.7.1 正式版本把日历从计划页中的次级展示提升为项目级 **Project
Tracker（项目追踪）**，可在作业说明、评分标准、计划、自检和进度五个工作流页面中
打开。它显示下一目标、截止日期、未完成/受阻/逾期任务数量、已有的月历与周任务清单，
并保留浏览器本地 `.ics` 导出。“在任务列表中打开”会关闭追踪面板、回到计划页并聚焦
准确的任务。追踪面板是临时界面状态，不会加入项目导航、备份或项目保存数据；v0.7.1
已通过自己的 main/Pages 门禁，公开 Demo 当前服务合并后的 v0.7.1。完整的 CI、Pages
和公网 smoke 证据见[验证报告](./docs/TEST_REPORT.md)。

计划页仍专注于每周学习时数、计划深度、重新排程、依赖关系和任务完成。日历日期是目标
完成日期，不是预约时段；导入 `.ics` 后，外部日历服务可能保存作业元数据。

## v0.7.0：来源定位编辑、日历与本地 ICS

v0.7.0 增加创建项目后的来源定位增删改、计划日历，以及浏览器本地 `.ics`
导出。日历显示目标完成日期，不是预约时段。导入 `.ics` 后，外部日历服务可能保存
作业元数据。

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
- 图片文字使用浏览器本地的 English + 简体中文 OCR 识别；OCR worker、运行核心和语言数据只从 RubricTrail 同源加载，不使用云端 OCR 或视觉 API。
- 公开静态 Demo 不包含 Live AI API 路由，也不需要 OpenAI Key。
- 原始文件、图片像素和完整上传/OCR/粘贴文本不会写入 `localStorage`。
- 项目会保存确认后的字段、简短依据摘录、草稿、自检和进度。
- 下载的备份包含这些项目数据，未加密、未签名，请妥善保管。
- 只处理你信任的文件；本地解析器不是恶意文档沙箱。

## 图片 OCR 边界

- 支持 PNG、JPG/JPEG 和 WebP 中清晰的英文、简体中文印刷文字，也可尽力识别中英混排。
- OCR 可能出错；识别出的字段和“根据 OCR 生成”的短摘录都会提示你与原图核对。
- 不保证识别手写字、公式、图表、复杂表格、低清照片或其他文字系统。
- 中文 OCR 只表示可以识别图片文字，不代表中文作业字段分析已经完全优化。
- 扫描版 PDF 暂不进行 OCR；可将相关页面导出为受支持图片，或粘贴文字。
- 图片按每边 16,384 像素及 20,000,000 解码像素限制；这些限制可降低资源风险，但不是恶意图片沙箱。

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
