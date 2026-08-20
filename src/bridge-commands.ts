export const NO_THREAD_REPLY = "请在群话题里 @我，然后重新发送消息。";
export const RESET_REPLY = "已重置当前会话，下一条消息会创建新的 Codex Session。";

export type InboundGateResult =
	| { action: "allow"; topicKey: string }
	| { action: "reject"; reason: "no_thread" | "unsupported_chat"; reply: string };

export function p2pTopicKey(openId: string): string {
	return `p2p:${openId}`;
}

export function gateInboundMessage(
	chatType: string,
	threadId?: string,
	options?: { senderOpenId?: string; ownerOpenId?: string },
): InboundGateResult {
	if (chatType === "p2p" || chatType === "private") {
		if (options?.senderOpenId && options.senderOpenId === options.ownerOpenId) {
			return { action: "allow", topicKey: p2pTopicKey(options.senderOpenId) };
		}
		return { action: "reject", reason: "unsupported_chat", reply: "私聊仅限管理员使用，请到群聊话题中 @机器人。" };
	}
	if (chatType === "group" && threadId) return { action: "allow", topicKey: threadId };
	if (chatType === "group") return { action: "reject", reason: "no_thread", reply: NO_THREAD_REPLY };
	return { action: "reject", reason: "unsupported_chat", reply: "不支持该会话类型。" };
}

export type BridgeCommand =
	| { kind: "help" }
	| { kind: "reset" }
	| { kind: "status" }
	| { kind: "stop" }
	| { kind: "memorySearch"; query: string }
	| { kind: "plan"; prompt: string }
	| { kind: "schedule"; duration: string; prompt: string }
	| { kind: "scheduleList" }
	| { kind: "scheduleCancel"; id: string }
	| { kind: "unknown"; cmd: string }
	| { kind: "message" };

export function parseBridgeCommand(text: string): BridgeCommand {
	const value = text.trim();
	if (!value.startsWith("/")) return { kind: "message" };
	if (/^\/(help|帮助)(\s|$)/i.test(value)) return { kind: "help" };
	if (/^\/(new|新对话|reset)(\s|$)/i.test(value)) return { kind: "reset" };
	if (/^\/(status|状态)(\s|$)/i.test(value)) return { kind: "status" };
	if (/^\/(stop|终止|停止)(\s|$)/i.test(value)) return { kind: "stop" };
	const plan = value.match(/^\/(?:plan|计划)\s+([\s\S]+)$/i);
	const memory = value.match(/^\/(?:memory|记忆)(?:\s+([\s\S]+))?$/i);
	if (memory) return { kind: "memorySearch", query: memory[1]?.trim() || "" };
	if (plan) return { kind: "plan", prompt: plan[1].trim() };
	if (/^\/(定时列表|schedule-list)(\s|$)/i.test(value)) return { kind: "scheduleList" };
	const cancel = value.match(/^\/(?:取消定时|schedule-cancel)\s+(\S+)\s*$/i);
	if (cancel) return { kind: "scheduleCancel", id: cancel[1] };
	const schedule = value.match(/^\/(?:定时|schedule)\s+(\S+)\s+([\s\S]+)$/i);
	if (schedule) return { kind: "schedule", duration: schedule[1], prompt: schedule[2].trim() };
	return { kind: "unknown", cmd: value.split(/\s/)[0] };
}

export function bridgeHelpText(): string {
	return [
		"**可用指令**",
		"- `/help` `/帮助`：显示帮助",
		"- `/new` `/新对话` `/reset`：重置当前会话",
		"- `/status` `/状态`：查看当前任务状态",
		"- `/stop` `/终止`：终止当前任务",
		"- `/plan <任务>` `/计划 <任务>`：先只读分析，批准后再执行",
		"- `/定时 30m 检查项目`：每 30 分钟执行任务（支持 m/h/d）",
		"- `/定时列表`：查看当前话题的定时任务",
		"- `/取消定时 <id>`：删除定时任务",
		"- `/memory <关键词>` `/记忆 <关键词>`：查询当前话题的 SQLite 记忆",
		"",
		"管理员可直接私聊；其他用户请在群聊话题中 @机器人发送文字、图片或文件。",
	].join("\n");
}

export function unknownSlashReply(cmd: string): string {
	return `未知指令 \`${cmd}\`，发送 \`/help\` 查看可用指令。`;
}
