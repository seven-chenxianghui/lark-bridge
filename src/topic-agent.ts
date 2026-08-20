export const MAX_TOPIC_PARALLEL = 3;

export function getTopicKey(
	chatType: string,
	threadId: string | undefined,
	senderOpenId?: string,
): string | undefined {
	if (chatType === "group") return threadId;
	if ((chatType === "p2p" || chatType === "private") && senderOpenId) {
		return `p2p:${senderOpenId}`;
	}
	return undefined;
}

type Waiter = { topicKey: string; resolve: () => void };
const activeTopics = new Set<string>();
const waiters: Waiter[] = [];

function drain(): void {
	for (let i = 0; i < waiters.length && activeTopics.size < MAX_TOPIC_PARALLEL;) {
		const waiter = waiters[i];
		if (activeTopics.has(waiter.topicKey)) {
			i++;
			continue;
		}
		waiters.splice(i, 1);
		activeTopics.add(waiter.topicKey);
		waiter.resolve();
	}
}

export async function acquireTopicParallelSlot(topicKey: string): Promise<() => void> {
	if (activeTopics.has(topicKey) || activeTopics.size >= MAX_TOPIC_PARALLEL) {
		await new Promise<void>((resolve) => waiters.push({ topicKey, resolve }));
	} else {
		activeTopics.add(topicKey);
	}

	let released = false;
	return () => {
		if (released) return;
		released = true;
		activeTopics.delete(topicKey);
		drain();
	};
}

export function topicLockKey(topicKey: string): string {
	return `topic:${topicKey}`;
}

export function __resetTopicParallelSlotsForTests(): void {
	activeTopics.clear();
	waiters.length = 0;
}
