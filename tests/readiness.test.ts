import { describe, expect, test } from "bun:test";
import { parseBridgeConfig, validateBridgeConfig } from "../scripts/check-readiness.ts";

describe("deployment readiness", () => {
	test("parses bridge config without exposing unrelated lines", () => {
		expect(parseBridgeConfig(`
			# bridge
			FEISHU_APP_ID=cli_123
			FEISHU_APP_SECRET="secret"
			FEISHU_OWNER_OPEN_ID=ou_owner
		`)).toEqual({ appId: "cli_123", appSecret: "secret", ownerOpenId: "ou_owner" });
	});

	test("reports missing required app credentials but keeps owner optional for migration", () => {
		expect(validateBridgeConfig({ appId: "", appSecret: "", ownerOpenId: "" }))
			.toEqual(["FEISHU_APP_ID", "FEISHU_APP_SECRET"]);
		expect(validateBridgeConfig({ appId: "cli_123", appSecret: "secret", ownerOpenId: "" }))
			.toEqual([]);
	});
});
