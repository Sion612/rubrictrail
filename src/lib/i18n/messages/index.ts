import { commonEn } from "@/lib/i18n/messages/common.en";
import { commonZhCN } from "@/lib/i18n/messages/common.zh-CN";

export const enMessages = {
  ...commonEn,
} as const;

export type MessageKey = keyof typeof enMessages;

export const zhCNMessages = {
  ...commonZhCN,
} satisfies Record<MessageKey, string>;
