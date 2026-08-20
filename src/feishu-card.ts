export type CardElement = Record<string, unknown>;

export type CardHeader = {
	title?: string;
	subtitle?: string;
	color?: string;
	status?: string;
	statusColor?: string;
};

export type CardButton = {
	text: string;
	action?: "stop" | "reset" | "approve-plan" | "discard-plan" | "approve-access" | "reject-access";
	topicKey?: string;
	value?: Record<string, string>;
	type?: "default" | "primary" | "danger";
};

function buttonElement(button: CardButton): CardElement {
	return {
		tag: "button",
		text: { tag: "plain_text", content: button.text },
		type: button.type || "default",
		width: "fill",
		...(button.action ? {
			behaviors: [{
				type: "callback",
				value: { action: button.action, topicKey: button.topicKey, ...button.value },
			}],
		} : {}),
		...(button.action === "reset" ? {
			confirm: {
				title: { tag: "plain_text", content: "新建会话" },
				text: { tag: "plain_text", content: "清除当前话题的 Codex Session 和聊天记忆？" },
			},
		} : {}),
		...(button.action === "approve-plan" ? {
			confirm: {
				title: { tag: "plain_text", content: "批准执行" },
				text: { tag: "plain_text", content: "允许本机 Codex 按此方案修改项目并运行自动验收？" },
			},
		} : {}),
		...(button.action === "approve-access" ? {
			confirm: {
				title: { tag: "plain_text", content: "批准使用权限" },
				text: { tag: "plain_text", content: "批准后，该用户可以在群聊话题中调用本机 Codex。" },
			},
		} : {}),
	};
}

function buttonElements(buttons: CardButton[]): CardElement[] {
	// Each command occupies a full row on narrow and desktop Feishu clients.
	return buttons.map((button) => ({
		tag: "column_set",
		flex_mode: "stretch",
		columns: [{
			tag: "column",
			width: "weighted",
			weight: 1,
			elements: [buttonElement(button)],
		}],
	}));
}

export function buildCard(
	markdown: string,
	header?: CardHeader,
	buttons: CardButton[] = [],
	elements: CardElement[] = [],
): string {
	const bodyElements = elements.length ? elements : [{ tag: "markdown", content: markdown }];
	const card: Record<string, unknown> = {
		schema: "2.0",
		config: {
			width_mode: "fill",
			enable_forward: true,
			update_multi: true,
		},
		body: { elements: [...bodyElements, ...buttonElements(buttons)] },
	};
	if (header) {
		card.header = {
			template: header.color || "blue",
			...(header.title ? { title: { tag: "plain_text", content: header.title } } : {}),
			...(header.subtitle ? { subtitle: { tag: "lark_md", content: header.subtitle } } : {}),
			...(header.status ? {
				text_tag_list: [{
					tag: "text_tag",
					text: { tag: "plain_text", content: header.status },
					color: header.statusColor || header.color || "blue",
				}],
			} : {}),
		};
	}
	return JSON.stringify(card);
}
