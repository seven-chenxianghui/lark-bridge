import { describe, expect, test } from "bun:test";
import { createSteeringQueue } from "../src/steering.js";

describe("steering queue", () => {
	test("combines pending instructions and consumes them once", () => {
		const queue = createSteeringQueue();
		queue.enqueue("topic", "先别改接口");
		queue.enqueue("topic", "补充单元测试");
		expect(queue.has("topic")).toBe(true);
		expect(queue.consume("topic")).toBe("先别改接口\n\n补充单元测试");
		expect(queue.consume("topic")).toBeUndefined();
	});

	test("isolates topics and supports clearing", () => {
		const queue = createSteeringQueue();
		queue.enqueue("one", "a");
		queue.enqueue("two", "b");
		queue.clear("one");
		expect(queue.has("one")).toBe(false);
		expect(queue.consume("two")).toBe("b");
	});
});
