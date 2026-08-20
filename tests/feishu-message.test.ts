import { describe, expect, test } from "bun:test";
import { parseFeishuMessage } from "../src/feishu-message.ts";

describe("Feishu message parser", () => {
	test("reads direct images", () => {
		expect(parseFeishuMessage("image", JSON.stringify({ image_key: "img_1" })))
			.toEqual({ text: "", imageKeys: ["img_1"], files: [] });
	});

	test("reads direct files", () => {
		expect(parseFeishuMessage("file", JSON.stringify({ file_key: "file_1", file_name: "report.pdf" })))
			.toEqual({ text: "", imageKeys: [], files: [{ key: "file_1", name: "report.pdf" }] });
	});

	test("reads text and images from posts", () => {
		const content = JSON.stringify({ content: [[{ tag: "text", text: "分析" }, { tag: "img", image_key: "img_2" }]] });
		expect(parseFeishuMessage("post", content)).toEqual({ text: "分析", imageKeys: ["img_2"], files: [] });
	});
});
