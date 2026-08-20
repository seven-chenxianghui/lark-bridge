import { describe, expect, test } from "bun:test";
import { buildCard } from "../src/feishu-card.ts";

describe("Feishu Card JSON 2.0", () => {
	test("uses the v2 envelope, subtitle, status tag and callback behavior", () => {
		const card = JSON.parse(buildCard(
			"fallback",
			{ title: "Codex Remote", subtitle: "Work · `abc123`", status: "执行中", color: "blue" },
			[{ text: "停止当前任务", action: "stop", topicKey: "topic-1", type: "danger" }],
			[{ tag: "markdown", content: "实时输出" }],
		));
		expect(card.schema).toBe("2.0");
		expect(card.config.width_mode).toBe("fill");
		expect(card.elements).toBeUndefined();
		expect(card.header.subtitle.content).toContain("abc123");
		expect(card.header.text_tag_list[0].text.content).toBe("执行中");
		expect(card.body.elements[0].content).toBe("实时输出");
		const button = card.body.elements[1].columns[0].elements[0];
		expect(button.width).toBe("fill");
		expect(button.behaviors[0]).toEqual({ type: "callback", value: { action: "stop", topicKey: "topic-1" } });
	});

	test("adds confirmation to plan approval", () => {
		const card = JSON.parse(buildCard("plan", undefined, [
			{ text: "批准执行", action: "approve-plan", topicKey: "topic-1", type: "primary" },
		]));
		const button = card.body.elements[1].columns[0].elements[0];
		expect(button.behaviors[0].value.action).toBe("approve-plan");
		expect(button.confirm.title.content).toBe("批准执行");
	});
});
