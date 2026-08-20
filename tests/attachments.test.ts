import { describe, expect, test } from "bun:test";
import { safeAttachmentName } from "../src/attachments.ts";

describe("attachment names", () => {
	test("removes path traversal and Windows-reserved names", () => {
		expect(safeAttachmentName("../../report.pdf")).toBe("report.pdf");
		expect(safeAttachmentName("..\\..\\CON.txt")).toBe("_CON.txt");
	});
});
