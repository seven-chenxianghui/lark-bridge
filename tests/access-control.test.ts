import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAccessControlRepo } from "../src/access-control.ts";

describe("access control", () => {
	test("keeps the owner authorized and persists approval decisions", () => {
		const dir = mkdtempSync(join(tmpdir(), "seven-access-"));
		try {
			const repo = createAccessControlRepo(dir, "ou_owner");
			expect(repo.isAuthorized("ou_owner")).toBeTrue();
			expect(repo.request("ou_guest", "om_request", "帮我检查项目")).toBe("created");
			expect(repo.request("ou_guest", "om_request", "重复申请")).toBe("pending");
			expect(repo.decide("ou_guest", true)?.messageId).toBe("om_request");
			expect(repo.isAuthorized("ou_guest")).toBeTrue();
			repo.close();

			const reopened = createAccessControlRepo(dir);
			expect(reopened.ownerOpenId()).toBe("ou_owner");
			expect(reopened.isAuthorized("ou_guest")).toBeTrue();
			reopened.close();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("allows a rejected user to request again", () => {
		const dir = mkdtempSync(join(tmpdir(), "seven-access-reject-"));
		try {
			const repo = createAccessControlRepo(dir, "ou_owner");
			repo.request("ou_guest", "om_1", "第一次");
			expect(repo.decide("ou_guest", false)?.openId).toBe("ou_guest");
			expect(repo.isAuthorized("ou_guest")).toBeFalse();
			expect(repo.request("ou_guest", "om_2", "再次申请")).toBe("created");
			repo.close();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
