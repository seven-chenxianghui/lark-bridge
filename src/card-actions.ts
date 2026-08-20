export type TaskCardAction = {
	action: "stop" | "reset" | "approve-plan" | "discard-plan";
	topicKey: string;
	messageId: string;
};

export type AuthorizationCardAction = {
	action: "approve-access" | "reject-access";
	applicantOpenId: string;
	messageId: string;
	operatorOpenId: string;
};

export function parseAuthorizationCardAction(data: unknown): AuthorizationCardAction | undefined {
	if (!data || typeof data !== "object") return undefined;
	const event = data as Record<string, unknown>;
	const context = event.context as Record<string, unknown> | undefined;
	const action = event.action as Record<string, unknown> | undefined;
	const value = action?.value as Record<string, unknown> | undefined;
	const operator = event.operator as Record<string, unknown> | undefined;
	const kind = String(value?.action || "");
	const applicantOpenId = String(value?.applicantOpenId || "");
	const messageId = String(context?.open_message_id || event.open_message_id || "");
	const operatorOpenId = String(operator?.open_id || "");
	if (!messageId || !applicantOpenId || !operatorOpenId || !["approve-access", "reject-access"].includes(kind)) return undefined;
	return { action: kind as AuthorizationCardAction["action"], applicantOpenId, messageId, operatorOpenId };
}

export function parseTaskCardAction(data: unknown): TaskCardAction | undefined {
	if (!data || typeof data !== "object") return undefined;
	const event = data as Record<string, unknown>;
	const context = event.context as Record<string, unknown> | undefined;
	const action = event.action as Record<string, unknown> | undefined;
	const value = action?.value as Record<string, unknown> | undefined;
	const kind = String(value?.action || "");
	const topicKey = String(value?.topicKey || "");
	const messageId = String(context?.open_message_id || event.open_message_id || "");
	if (!messageId || !topicKey || !["stop", "reset", "approve-plan", "discard-plan"].includes(kind)) return undefined;
	return { action: kind as TaskCardAction["action"], topicKey, messageId };
}
