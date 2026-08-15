import { commonEn } from "@/lib/i18n/messages/common.en";

export const commonZhCN = {
  "app.loading": "正在加载 RubricTrail",
  "app.metadata.title": "RubricTrail — 从作业要求到原文依据",
  "app.metadata.description": "一款本地优先、连接评分标准与原文依据的作业规划工具。",
  "language.label": "界面语言",
  "language.english": "English",
  "language.chinese": "简体中文",
  "language.changed": "界面语言已切换为{language}。",
  "language.saveFailed":
    "界面语言已在此标签页切换，但 RubricTrail 无法记住你的选择。",
  "common.close": "关闭",
  "common.cancel": "取消",
  "common.continue": "继续",
  "common.back": "返回",
  "common.confirm": "确认",
  "common.save": "保存",
  "common.loading": "正在加载…",
  "common.notAvailable": "暂无",
  "common.words": "{count} 字",
  "common.files": "{count} 个文件",
} satisfies Record<keyof typeof commonEn, string>;
