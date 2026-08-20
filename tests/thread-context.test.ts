import { describe, expect, test } from "bun:test";
import {
	extractMessageText,
	formatThreadContextBlock,
	isolationBanner,
	type FeishuMessageLike,
} from "../src/thread-context.ts";

describe("thread-context isolation", () => {
	test("isolation banner restricts access to the current topic", () => {
		const b = isolationBanner("oc_abc", "omt_1");
		expect(b).toContain("chat_id=oc_abc");
		expect(b).toContain("当前群/话题");
		expect(b).toContain("其它群");
		expect(b).toContain("禁止");
	});

	test("formatThreadContextBlock uses current thread only and skips current message", () => {
		const messages: FeishuMessageLike[] = [
			{
				message_id: "om_root",
				create_time: String(Math.floor(new Date("2026-07-27T15:09:00Z").getTime() / 1000)),
				sender: { sender_name: "杨展航", sender_type: "user" },
				body: {
					content: JSON.stringify({
						text: "@_user_1 能不能自己搭一套前端",
					}),
				},
				mentions: [{ key: "@_user_1", name: "陈颖" }],
			},
			{
				message_id: "om_cur",
				create_time: String(Math.floor(new Date("2026-07-27T15:18:00Z").getTime() / 1000)),
				sender: { sender_name: "杨展航", sender_type: "user" },
				body: { content: JSON.stringify({ text: "查看下对话的上下文" }) },
			},
		];
		const block = formatThreadContextBlock(messages, {
			chatId: "oc_bridge",
			threadId: "omt_t",
			currentMessageId: "om_cur",
		});
		expect(block).toContain("oc_bridge");
		expect(block).toContain("@陈颖 能不能自己搭一套前端");
		expect(block).not.toContain("查看下对话的上下文");
		expect(block).not.toContain("老化测试");
		expect(block).toContain("[当前用户请求]");
	});

	test("extractMessageText resolves mentions", () => {
		const text = extractMessageText({
			body: { content: JSON.stringify({ text: "hi @_user_1" }) },
			mentions: [{ key: "@_user_1", name: "Bot" }],
		});
		expect(text).toBe("hi @Bot");
	});
});
