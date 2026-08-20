import { basename } from "node:path";

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

export function safeAttachmentName(input: string): string {
	let name = basename(input.trim().replace(/\\/g, "/"))
		.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
		.replace(/[. ]+$/g, "")
		.slice(0, 120);
	if (!name) name = "attachment";
	if (WINDOWS_RESERVED.test(name)) name = `_${name}`;
	return name;
}
