export type SteeringQueue = ReturnType<typeof createSteeringQueue>;

export function createSteeringQueue() {
	const queued = new Map<string, string[]>();

	return {
		enqueue(topicKey: string, instruction: string): void {
			const instructions = queued.get(topicKey) || [];
			instructions.push(instruction.trim());
			queued.set(topicKey, instructions);
		},
		has(topicKey: string): boolean {
			return Boolean(queued.get(topicKey)?.length);
		},
		consume(topicKey: string): string | undefined {
			const instructions = queued.get(topicKey);
			if (!instructions?.length) return undefined;
			queued.delete(topicKey);
			return instructions.join("\n\n");
		},
		clear(topicKey: string): void {
			queued.delete(topicKey);
		},
	};
}
