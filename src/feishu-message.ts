export type FeishuFile = { key: string; name: string };
export type ParsedMessage = { text: string; imageKeys: string[]; files: FeishuFile[] };

export function parseFeishuMessage(messageType: string, content: string): ParsedMessage {
	try {
		const value = JSON.parse(content) as Record<string, unknown>;
		if (messageType === "text") return { text: String(value.text || ""), imageKeys: [], files: [] };
		if (messageType === "image") {
			const key = String(value.image_key || "");
			return { text: "", imageKeys: key ? [key] : [], files: [] };
		}
		if (messageType === "file") {
			const key = String(value.file_key || "");
			return { text: "", imageKeys: [], files: key ? [{ key, name: String(value.file_name || "attachment") }] : [] };
		}
		if (messageType === "post") {
			const parts: string[] = [];
			const imageKeys: string[] = [];
			const files: FeishuFile[] = [];
			const walk = (node: unknown): void => {
				if (Array.isArray(node)) return void node.forEach(walk);
				if (!node || typeof node !== "object") return;
				const item = node as Record<string, unknown>;
				if (typeof item.text === "string") parts.push(item.text);
				if (typeof item.image_key === "string") imageKeys.push(item.image_key);
				if (typeof item.file_key === "string") files.push({
					key: item.file_key,
					name: typeof item.file_name === "string" ? item.file_name : "attachment",
				});
				for (const child of Object.values(item)) walk(child);
			};
			walk(value);
			return {
				text: parts.join(" ").trim(),
				imageKeys: [...new Set(imageKeys)].slice(0, 4),
				files: [...new Map(files.map((file) => [file.key, file])).values()].slice(0, 4),
			};
		}
	} catch {}
	return { text: "", imageKeys: [], files: [] };
}
