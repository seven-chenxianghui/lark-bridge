import { describe, expect, test } from "bun:test";
import { parseAuthorizationCardAction, parseTaskCardAction } from "../src/card-actions.ts";

describe("task card actions", () => {
	test("parses a callback from a Feishu card", () => {
		expect(parseTaskCardAction({
			context: { open_message_id: "om_1" },
			action: { value: { action: "stop", topicKey: "omt_1" } },
		})).toEqual({ action: "stop", topicKey: "omt_1", messageId: "om_1" });
	});

	test("accepts plan approval actions", () => {
		expect(parseTaskCardAction({
			context: { open_message_id: "om_plan" },
			action: { value: { action: "approve-plan", topicKey: "omt_plan" } },
		})?.action).toBe("approve-plan");
	});

	test("rejects incomplete or unknown actions", () => {
		expect(parseTaskCardAction({ action: { value: { action: "delete", topicKey: "omt_1" } } })).toBeUndefined();
		expect(parseTaskCardAction({ context: { open_message_id: "om_2" }, action: { value: { action: "guide", topicKey: "omt_2" } } })).toBeUndefined();
		expect(parseTaskCardAction({ context: { open_message_id: "om_3" }, action: { value: { action: "context", topicKey: "omt_3" } } })).toBeUndefined();
		expect(parseTaskCardAction(null)).toBeUndefined();
	});
});

describe("authorization card actions", () => {
	test("includes the applicant and the operator identity", () => {
		expect(parseAuthorizationCardAction({
			operator: { open_id: "ou_owner" },
			context: { open_message_id: "om_card" },
			action: { value: { action: "approve-access", applicantOpenId: "ou_guest" } },
		})).toEqual({ action: "approve-access", applicantOpenId: "ou_guest", messageId: "om_card", operatorOpenId: "ou_owner" });
	});

	test("rejects callbacks without an operator identity", () => {
		expect(parseAuthorizationCardAction({
			context: { open_message_id: "om_card" },
			action: { value: { action: "approve-access", applicantOpenId: "ou_guest" } },
		})).toBeUndefined();
	});
});
