export interface AgentHandle {
	pid: number;
	kill: () => void;
	cardId?: string;
}

const activeAgents = new Map<string, AgentHandle>();
let shuttingDown = false;

export function isShuttingDown(): boolean {
	return shuttingDown;
}

export function registerAgent(key: string, handle: AgentHandle): void {
	activeAgents.set(key, handle);
}

export function unregisterAgent(key: string): void {
	activeAgents.delete(key);
}

export function getActiveAgent(key: string): AgentHandle | undefined {
	return activeAgents.get(key);
}

export function initGracefulShutdown(
	notify: (cardId: string, message: string) => Promise<void>,
): void {
	process.on("SIGTERM", () => {
		if (shuttingDown) return;
		shuttingDown = true;
		void (async () => {
			await Promise.allSettled(
				[...activeAgents.values()]
					.filter((agent) => agent.cardId)
					.map((agent) => notify(agent.cardId!, "服务正在重启，请稍后重新发送任务。")),
			);
			for (const agent of activeAgents.values()) agent.kill();
			setTimeout(() => process.exit(0), 500);
		})();
	});
}
