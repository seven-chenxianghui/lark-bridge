import { describe, expect, test } from "bun:test";
import {
	bridgeHelpText,
	formatContext,
	gateInboundMessage,
	parseBridgeCommand,
	p2pTopicKey,
} from "../src/bridge-commands.ts";
import { getTopicKey } from "../src/topic-agent.ts";

describe("inbound gate", () => {
	test("rejects private chats", () => {
		expect(gateInboundMessage("p2p", undefined, { senderOpenId: "ou_a" }).action).toBe("reject");
		expect(p2pTopicKey("ou_b")).toBe("p2p:ou_b");
		expect(getTopicKey("private", undefined, "ou_a")).toBe("p2p:ou_a");
	});

	test("accepts group topics and rejects unthreaded groups", () => {
		expect(gateInboundMessage("group", "omt_1"))
			.toEqual({ action: "allow", topicKey: "omt_1" });
		expect(gateInboundMessage("group").action).toBe("reject");
	});
});

describe("bridge commands", () => {
	test("parses supported commands", () => {
		expect(parseBridgeCommand("/help")).toEqual({ kind: "help" });
		expect(parseBridgeCommand("/新对话")).toEqual({ kind: "reset" });
		expect(parseBridgeCommand("/context")).toEqual({ kind: "context" });
		expect(parseBridgeCommand("/memory 项目检查")).toEqual({ kind: "memorySearch", query: "项目检查" });
		expect(parseBridgeCommand("/记忆")).toEqual({ kind: "memorySearch", query: "" });
		expect(parseBridgeCommand("/状态")).toEqual({ kind: "status" });
		expect(parseBridgeCommand("/终止")).toEqual({ kind: "stop" });
		expect(parseBridgeCommand("/计划 重构登录模块")).toEqual({ kind: "plan", prompt: "重构登录模块" });
		expect(parseBridgeCommand("/定时 30m 检查项目")).toEqual({ kind: "schedule", duration: "30m", prompt: "检查项目" });
		expect(parseBridgeCommand("/定时列表")).toEqual({ kind: "scheduleList" });
		expect(parseBridgeCommand("/取消定时 abcd1234")).toEqual({ kind: "scheduleCancel", id: "abcd1234" });
		expect(parseBridgeCommand("开发这个功能")).toEqual({ kind: "message" });
		expect(parseBridgeCommand("/other")).toEqual({ kind: "unknown", cmd: "/other" });
	});

	test("help and context only expose the minimal surface", () => {
		const help = bridgeHelpText();
		expect(help).toContain("/help");
		expect(help).toContain("/reset");
		expect(help).toContain("/status");
		expect(help).toContain("/memory");
		expect(help).toContain("/定时");
		expect(help).not.toContain("心跳");
		expect(formatContext("omt_1", "session_1")).toContain("session_1");
	});
});
