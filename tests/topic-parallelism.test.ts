import { describe, expect, test, beforeEach } from "bun:test";
import {
	acquireTopicParallelSlot,
	__resetTopicParallelSlotsForTests,
	MAX_TOPIC_PARALLEL,
} from "../src/topic-agent.ts";

describe("Topic Parallelism", () => {
	beforeEach(() => {
		__resetTopicParallelSlotsForTests();
	});

	test("same topic serializes: second waits until first releases", async () => {
		const release1 = await acquireTopicParallelSlot("t1");
		let secondAcquired = false;
		const p2 = acquireTopicParallelSlot("t1").then((release) => {
			secondAcquired = true;
			return release;
		});
		await Promise.resolve();
		expect(secondAcquired).toBe(false);
		release1();
		const release2 = await p2;
		expect(secondAcquired).toBe(true);
		release2();
	});

	test("up to MAX_TOPIC_PARALLEL distinct topics run concurrently", async () => {
		const releases = [];
		for (let i = 0; i < MAX_TOPIC_PARALLEL; i++) {
			releases.push(await acquireTopicParallelSlot(`t${i}`));
		}
		let fourth = false;
		const p4 = acquireTopicParallelSlot("t-extra").then((r) => {
			fourth = true;
			return r;
		});
		await Bun.sleep(20);
		expect(fourth).toBe(false);
		releases[0]();
		const r4 = await p4;
		expect(fourth).toBe(true);
		r4();
		for (const r of releases.slice(1)) r();
	});
});
