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

> v0.8.1 已正式发布。annotated tag 对应精确版本
> `39eedac6a04a0b955184e26a7148ccb21efb742d`，并已发布
> [GitHub Release](https://github.com/Sion612/rubrictrail/releases/tag/v0.8.1)。
> 该版本的 [final main CI](https://github.com/Sion612/rubrictrail/actions/runs/32644021633)
> 与 [final Pages 部署](https://github.com/Sion612/rubrictrail/actions/runs/32644355890)
> 均已通过；这些发布事实绑定于标签，不会因默认分支以后继续前进而失效。

仓库当前保存的桌面与移动截图只是历史作业工作区参考，早于 v0.8 **我的作业**
Dashboard 和 v0.8.1 日期语义，不代表当前视觉或全浏览器认证。当前功能与响应式证据见
[验证报告](./docs/TEST_REPORT.md)，历史截图范围见
[视觉 QA 报告](./docs/VISUAL_QA_REPORT.md)。

## 适合谁

RubricTrail 面向需要根据作业说明和评分标准安排工作的学生。它不会替你写作业、
虚构评分项或预测分数，而是帮助你确认：要做什么、为什么要做、还缺少什么依据。

## 两分钟体验

1. 当前公开 v0.8.1 Demo 首页显示 **我的作业**，并可新建虚构的 LumaLane 示例。
2. 依次查看 **作业说明 → 评分标准 → 计划 → 自检 → 进度**。
3. 可使用醒目的 **新建作业** 上传可信的 TXT、DOCX、文本型 PDF、
   PNG、JPG/JPEG 或 WebP，粘贴作业说明与评分标准，或把单项目备份恢复为新作业。
4. 核对识别出的截止日期、字数、引用格式和每个评分项后再创建作业。

## v0.8.1：实时日历状态

v0.8.1 把“生成行动计划时采用的稳定日期”和“用于实时状态的浏览器本地日期”明确分开。
**今天** 会随浏览器本地日历日期前进，Calendar、Project Tracker、Dashboard 与
**接下来** 也使用同一临时日期判断未完成目标是否逾期。已有任务目标日期不会随时间自动
滑动：虚构示例使用固定示例基线；上传项目则把既有持久化格式已支持的创建瞬时归一为稳定
UTC 日历日期。历史版本从未保存原始创建时区。

v0.8.1 已正式发布；最终 tagged SHA 为
`39eedac6a04a0b955184e26a7148ccb21efb742d`。首次 main 失败、仅测试修正、
最终 exact-main CI、exact-SHA Pages、annotated tag 与 Release 证据见
[验证报告](./docs/TEST_REPORT.md)。Chromium 自动化是回归证据，不代表 Firefox、
Safari 或其他浏览器已获得认证。

## v0.8.0：多作业工作区

v0.8.0 把 **我的作业** 设为产品首页。每张作业卡显示真实截止日期、完成进度、
下一目标以及受阻/逾期数量；跨作业的 **接下来** 只从各作业已有的行动计划中派生，
不会另存一套任务，也不会虚构日期。

每个作业仍独立保留原有五个阶段、Project Tracker、Calendar、本地 `.ics`、草稿、
来源定位和单项目备份。Dashboard 不是第六个工作流阶段；本版本不增加手动任务、
全局 Calendar、提醒、账户或云同步。

有效的 v0.7.1 单项目数据会通过带日志和读回校验的迁移成为一个工作区作业。
旧数据会保留到用户明确清理，以便发现仍打开的旧版本标签页产生的写入冲突。
每个作业使用独立的本地记录；权威写入仍必须取得 Web Lock，冲突时不会自动猜测赢家。
v0.8.0 已通过 PR exact-head、合并后 main、exact-SHA Pages 与独立公网验证，随后于
2026 年 8 月 20 日发布 annotated tag 和
[GitHub Release](https://github.com/Sion612/rubrictrail/releases/tag/v0.8.0)。完整远端、
公网与证据边界见[验证报告](./docs/TEST_REPORT.md)。

## v0.7.1：Project Tracker、来源定位与本地 ICS

v0.7.1 正式版本把日历从计划页中的次级展示提升为项目级 **Project
Tracker（项目追踪）**，可在作业说明、评分标准、计划、自检和进度五个工作流页面中
打开。它显示下一目标、截止日期、未完成/受阻/逾期任务数量、已有的月历与周任务清单，
并保留浏览器本地 `.ics` 导出。“在任务列表中打开”会关闭追踪面板、回到计划页并聚焦
准确的任务。追踪面板是临时界面状态，不会加入项目导航、备份或项目保存数据；v0.7.1
已通过自己的 main/Pages 门禁，相关 CI、Pages 和公网 smoke 证据仍见
[验证报告](./docs/TEST_REPORT.md)。当前公开 Demo 已跟随上文经过验证的 v0.8.1 产品版本。

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
- 下载的备份只包含选中的一个作业及这些项目数据，未加密、未签名，请妥善保管；
  v0.8.0 没有整个工作区备份。
- 浏览器容量因环境而异。64/80/96/100 是产品的整理建议、警告、增长阻止和单代
  硬上限，不是 `localStorage` 容量保证。
- 旧版标签页可能重写兼容数据；v0.8.0 会显示冲突并要求明确选择，但无法阻止已经
  运行的旧代码尝试写入。
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
