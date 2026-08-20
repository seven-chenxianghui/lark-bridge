/**
 * 群话题上下文：从飞书拉取当前 thread 消息，注入 Agent prompt。
 * 仅服务当前 Group Topic Only 入口，不读取其它群的聊天记录。
 */

export type FeishuMessageLike = {
	message_id?: string;
	msg_type?: string;
	create_time?: string; // unix seconds string
	deleted?: boolean;
	sender?: {
		id?: string;
		id_type?: string;
		sender_type?: string;
		sender_name?: string;
	};
	body?: { content?: string };
	mentions?: Array<{ key?: string; name?: string }>;
};

export type ThreadContextOptions = {
	chatId: string;
	threadId: string;
	currentMessageId?: string;
	/** 最多纳入条数（含根消息），默认 30 */
	maxMessages?: number;
	/** 格式化后最大字符，默认 6000 */
	maxChars?: number;
};

type ListClient = {
	im: {
		message: {
			list: (payload: {
				params: {
					container_id_type: string;
					container_id: string;
					sort_type?: string;
					page_size?: number;
					page_token?: string;
				};
			}) => Promise<{
				data?: {
					items?: FeishuMessageLike[];
					has_more?: boolean;
					page_token?: string;
				};
			}>;
		};
	};
};

export function isolationBanner(chatId: string, threadId?: string): string {
	const thread = threadId ? ` · thread_id=${threadId}` : "";
	return [
		`[飞书会话隔离] chat_id=${chatId}${thread}`,
		"本请求只服务当前群/话题，禁止读取其它群的聊天记录。",
		"上下文不足时，以本 prompt 注入的当前话题消息为准，不要用其它会话内容顶替。",
	].join("\n");
}

export function extractMessageText(msg: FeishuMessageLike): string {
	const raw = msg.body?.content ?? "";
	if (!raw) return "";
	try {
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		if (typeof parsed.text === "string") return applyMentions(parsed.text, msg.mentions);
		if (parsed.title || parsed.content) {
			// interactive / post compact
			if (Array.isArray(parsed.content)) return postToText(parsed.content);
			return `[${msg.msg_type ?? "card"}]`;
		}
		return raw.slice(0, 500);
	} catch {
		return raw.slice(0, 500);
	}
}

function applyMentions(
	text: string,
	mentions?: Array<{ key?: string; name?: string }>,
): string {
	let out = text;
	for (const m of mentions ?? []) {
		if (m.key && m.name) out = out.split(m.key).join(`@${m.name}`);
	}
	return out;
}

function postToText(content: unknown): string {
	const parts: string[] = [];
	const walk = (node: unknown): void => {
		if (!node) return;
		if (Array.isArray(node)) {
			for (const n of node) walk(n);
			return;
		}
		if (typeof node !== "object") return;
		const o = node as Record<string, unknown>;
		if (typeof o.text === "string") parts.push(o.text);
		if (o.content) walk(o.content);
	};
	walk(content);
	return parts.join("").trim() || "[post]";
}

export function formatCreateTime(createTime?: string): string {
	if (!createTime) return "?";
	const sec = Number(createTime);
	if (!Number.isFinite(sec) || sec <= 0) return createTime;
	const d = new Date(sec * 1000);
	const hh = String(d.getHours()).padStart(2, "0");
	const mm = String(d.getMinutes()).padStart(2, "0");
	return `${hh}:${mm}`;
}

export function senderLabel(msg: FeishuMessageLike): string {
	const s = msg.sender;
	if (!s) return "?";
	if (s.sender_name) return s.sender_name;
	if (s.sender_type === "app") return "Bot";
	return (s.id ?? "?").slice(0, 12);
}

/** 纯函数：把飞书消息列表格式化成 prompt 块（便于单测） */
export function formatThreadContextBlock(
	messages: FeishuMessageLike[],
	opts: ThreadContextOptions,
): string {
	const maxMessages = opts.maxMessages ?? 30;
	const maxChars = opts.maxChars ?? 6000;
	const lines: string[] = [];
	lines.push(isolationBanner(opts.chatId, opts.threadId));
	lines.push("");
	lines.push("[当前飞书群话题消息]");

	const usable = messages
		.filter((m) => !m.deleted)
		.filter((m) => m.message_id !== opts.currentMessageId)
		.slice(-maxMessages);

	if (usable.length === 0) {
		lines.push("（话题内暂无其它可读消息；仅依据当前用户请求）");
	} else {
		for (const m of usable) {
			const text = extractMessageText(m).replace(/\s+/g, " ").trim();
			if (!text) continue;
			const clipped = text.length > 400 ? `${text.slice(0, 400)}…` : text;
			lines.push(`[${formatCreateTime(m.create_time)}] ${senderLabel(m)}: ${clipped}`);
		}
	}

	lines.push("");
	lines.push("[当前用户请求]");
	let block = lines.join("\n");
	if (block.length > maxChars) {
		block = `${block.slice(0, maxChars)}\n…(话题上下文已截断)`;
	}
	return block;
}

export async function fetchThreadMessages(
	client: ListClient,
	threadId: string,
	pageSize = 50,
): Promise<FeishuMessageLike[]> {
	const items: FeishuMessageLike[] = [];
	let pageToken: string | undefined;
	for (let i = 0; i < 3; i++) {
		const res = await client.im.message.list({
			params: {
				container_id_type: "thread",
				container_id: threadId,
				sort_type: "ByCreateTimeAsc",
				page_size: pageSize,
				...(pageToken ? { page_token: pageToken } : {}),
			},
		});
		const batch = res.data?.items ?? [];
		items.push(...batch);
		if (!res.data?.has_more || !res.data.page_token) break;
		pageToken = res.data.page_token;
	}
	return items;
}

export async function buildThreadContextPrefix(
	client: ListClient,
	opts: ThreadContextOptions,
): Promise<string | undefined> {
	try {
		const items = await fetchThreadMessages(client, opts.threadId);
		return formatThreadContextBlock(items, opts);
	} catch (e) {
		console.warn("[thread-context] 拉取话题消息失败:", e);
		return isolationBanner(opts.chatId, opts.threadId) + "\n\n[当前用户请求]";
	}
}
