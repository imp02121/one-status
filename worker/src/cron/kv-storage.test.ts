import { describe, it, expect, vi, beforeEach } from "vitest";
import { storeResults } from "./kv-storage";
import { createMockEnv } from "../test-helpers";
import type { Env, HealthCheckResult, LatestStatus, HistoryEntry, DailyUptime, OverallStatus } from "../types";
import { KV_KEYS } from "../types";

describe("kv-storage", () => {
  let env: Env;
  const dateStr = "2026-03-08";

  beforeEach(() => {
    env = createMockEnv();
  });

  function makeResult(
    service: HealthCheckResult["service"],
    status: HealthCheckResult["status"] = "operational",
    overrides?: Partial<HealthCheckResult>,
  ): HealthCheckResult {
    return {
      service,
      status,
      latencyMs: 42,
      checkedAt: "2026-03-08T12:00:00.000Z",
      ...overrides,
    };
  }

  describe("storeResults (latest status)", () => {
    it("stores latest status for each service in KV", async () => {
      const results = [makeResult("api"), makeResult("dashboard")];
      await storeResults(env, results, dateStr);

      expect(env.STATUS_KV.put).toHaveBeenCalledWith(
        KV_KEYS.latest("api"),
        expect.any(String),
      );
      expect(env.STATUS_KV.put).toHaveBeenCalledWith(
        KV_KEYS.latest("dashboard"),
        expect.any(String),
      );
    });

    it("stores correct LatestStatus shape", async () => {
      const results = [makeResult("api", "degraded", { latencyMs: 150, error: "slow" })];
      await storeResults(env, results, dateStr);

      const latestCalls = vi.mocked(env.STATUS_KV.put).mock.calls.filter(
        (call) => call[0] === KV_KEYS.latest("api"),
      );
      const stored: LatestStatus = JSON.parse(latestCalls[0][1] as string);
      expect(stored.service).toBe("api");
      expect(stored.status).toBe("degraded");
      expect(stored.latencyMs).toBe(150);
      expect(stored.error).toBe("slow");
      expect(stored.checkedAt).toBeDefined();
    });
  });

  describe("appendHistory (via storeResults)", () => {
    it("appends to empty history", async () => {
      const results = [makeResult("api")];
      await storeResults(env, results, dateStr);

      const historyKey = KV_KEYS.history("api", dateStr);
      const historyCalls = vi.mocked(env.STATUS_KV.put).mock.calls.filter(
        (call) => call[0] === historyKey,
      );
      expect(historyCalls.length).toBe(1);
      const history: HistoryEntry[] = JSON.parse(historyCalls[0][1] as string);
      expect(history).toHaveLength(1);
      expect(history[0].status).toBe("operational");
      expect(history[0].latencyMs).toBe(42);
    });

    it("appends to existing history", async () => {
      const historyKey = KV_KEYS.history("api", dateStr);
      const existing: HistoryEntry[] = [
        { status: "operational", latencyMs: 30, checkedAt: "2026-03-08T11:55:00.000Z" },
      ];
      vi.mocked(env.STATUS_KV.get).mockImplementation(async (key: string) => {
        if (key === historyKey) return JSON.stringify(existing);
        return null;
      });

      await storeResults(env, [makeResult("api")], dateStr);

      const historyCalls = vi.mocked(env.STATUS_KV.put).mock.calls.filter(
        (call) => call[0] === historyKey,
      );
      const history: HistoryEntry[] = JSON.parse(historyCalls[0][1] as string);
      expect(history).toHaveLength(2);
    });

    it("trims history at MAX_HISTORY_ENTRIES (288)", async () => {
      const historyKey = KV_KEYS.history("api", dateStr);
      // Create 288 existing entries (full day)
      const existing: HistoryEntry[] = Array.from({ length: 288 }, (_, i) => ({
        status: "operational" as const,
        latencyMs: 30,
        checkedAt: `2026-03-08T${String(Math.floor(i / 12)).padStart(2, "0")}:${String((i % 12) * 5).padStart(2, "0")}:00.000Z`,
      }));
      vi.mocked(env.STATUS_KV.get).mockImplementation(async (key: string) => {
        if (key === historyKey) return JSON.stringify(existing);
        return null;
      });

      await storeResults(env, [makeResult("api")], dateStr);

      const historyCalls = vi.mocked(env.STATUS_KV.put).mock.calls.filter(
        (call) => call[0] === historyKey,
      );
      const history: HistoryEntry[] = JSON.parse(historyCalls[0][1] as string);
      // Should still be 288 (oldest removed, new one added)
      expect(history).toHaveLength(288);
      // Last entry should be the newly added one
      expect(history[history.length - 1].checkedAt).toBe("2026-03-08T12:00:00.000Z");
    });

    it("handles corrupt JSON in existing history gracefully", async () => {
      const historyKey = KV_KEYS.history("api", dateStr);
      vi.mocked(env.STATUS_KV.get).mockImplementation(async (key: string) => {
        if (key === historyKey) return "not-json{{{";
        return null;
      });

      await storeResults(env, [makeResult("api")], dateStr);

      const historyCalls = vi.mocked(env.STATUS_KV.put).mock.calls.filter(
        (call) => call[0] === historyKey,
      );
      const history: HistoryEntry[] = JSON.parse(historyCalls[0][1] as string);
      // Reset to single entry on corrupt data
      expect(history).toHaveLength(1);
    });
  });

  describe("updateDailyUptime (via storeResults)", () => {
    it("creates fresh uptime on first check of the day", async () => {
      await storeResults(env, [makeResult("api")], dateStr);

      const uptimeKey = KV_KEYS.dailyUptime("api", dateStr);
      const uptimeCalls = vi.mocked(env.STATUS_KV.put).mock.calls.filter(
        (call) => call[0] === uptimeKey,
      );
      expect(uptimeCalls.length).toBe(1);
      const uptime: DailyUptime = JSON.parse(uptimeCalls[0][1] as string);
      expect(uptime.totalChecks).toBe(1);
      expect(uptime.operationalChecks).toBe(1);
      expect(uptime.degradedChecks).toBe(0);
      expect(uptime.downChecks).toBe(0);
      expect(uptime.uptimePercent).toBe(100);
    });

    it("increments degraded counter for degraded status", async () => {
      await storeResults(env, [makeResult("api", "degraded")], dateStr);

      const uptimeKey = KV_KEYS.dailyUptime("api", dateStr);
      const uptimeCalls = vi.mocked(env.STATUS_KV.put).mock.calls.filter(
        (call) => call[0] === uptimeKey,
      );
      const uptime: DailyUptime = JSON.parse(uptimeCalls[0][1] as string);
      expect(uptime.totalChecks).toBe(1);
      expect(uptime.degradedChecks).toBe(1);
      expect(uptime.operationalChecks).toBe(0);
      expect(uptime.uptimePercent).toBe(100); // degraded counts as "up"
    });

    it("increments down counter for down status", async () => {
      await storeResults(env, [makeResult("api", "down")], dateStr);

      const uptimeKey = KV_KEYS.dailyUptime("api", dateStr);
      const uptimeCalls = vi.mocked(env.STATUS_KV.put).mock.calls.filter(
        (call) => call[0] === uptimeKey,
      );
      const uptime: DailyUptime = JSON.parse(uptimeCalls[0][1] as string);
      expect(uptime.totalChecks).toBe(1);
      expect(uptime.downChecks).toBe(1);
      expect(uptime.uptimePercent).toBe(0);
    });

    it("accumulates from existing uptime data", async () => {
      const uptimeKey = KV_KEYS.dailyUptime("api", dateStr);
      const existing: DailyUptime = {
        totalChecks: 10,
        operationalChecks: 8,
        degradedChecks: 1,
        downChecks: 1,
        uptimePercent: 90,
      };
      vi.mocked(env.STATUS_KV.get).mockImplementation(async (key: string) => {
        if (key === uptimeKey) return JSON.stringify(existing);
        return null;
      });

      await storeResults(env, [makeResult("api")], dateStr);

      const uptimeCalls = vi.mocked(env.STATUS_KV.put).mock.calls.filter(
        (call) => call[0] === uptimeKey,
      );
      const uptime: DailyUptime = JSON.parse(uptimeCalls[0][1] as string);
      expect(uptime.totalChecks).toBe(11);
      expect(uptime.operationalChecks).toBe(9);
      expect(uptime.degradedChecks).toBe(1);
      expect(uptime.downChecks).toBe(1);
      // (9 + 1) / 11 * 100 = 90.91
      expect(uptime.uptimePercent).toBe(90.91);
    });

    it("computes uptimePercent correctly: (operational + degraded) / total", async () => {
      const uptimeKey = KV_KEYS.dailyUptime("api", dateStr);
      const existing: DailyUptime = {
        totalChecks: 3,
        operationalChecks: 1,
        degradedChecks: 1,
        downChecks: 1,
        uptimePercent: 66.67,
      };
      vi.mocked(env.STATUS_KV.get).mockImplementation(async (key: string) => {
        if (key === uptimeKey) return JSON.stringify(existing);
        return null;
      });

      // Add one more down
      await storeResults(env, [makeResult("api", "down")], dateStr);

      const uptimeCalls = vi.mocked(env.STATUS_KV.put).mock.calls.filter(
        (call) => call[0] === uptimeKey,
      );
      const uptime: DailyUptime = JSON.parse(uptimeCalls[0][1] as string);
      // (1 + 1) / 4 = 50
      expect(uptime.uptimePercent).toBe(50);
    });
  });

  describe("computeOverallStatus (via storeResults)", () => {
    it("sets overall to operational when all services are operational", async () => {
      const results = [
        makeResult("api"),
        makeResult("dashboard"),
        makeResult("documentation"),
      ];
      await storeResults(env, results, dateStr);

      const overallCalls = vi.mocked(env.STATUS_KV.put).mock.calls.filter(
        (call) => call[0] === KV_KEYS.overall,
      );
      expect(overallCalls.length).toBe(1);
      const overall: OverallStatus = JSON.parse(overallCalls[0][1] as string);
      expect(overall.status).toBe("operational");
    });

    it("sets overall to degraded when any service is degraded (none down)", async () => {
      const results = [
        makeResult("api"),
        makeResult("dashboard", "degraded"),
        makeResult("documentation"),
      ];
      await storeResults(env, results, dateStr);

      const overallCalls = vi.mocked(env.STATUS_KV.put).mock.calls.filter(
        (call) => call[0] === KV_KEYS.overall,
      );
      const overall: OverallStatus = JSON.parse(overallCalls[0][1] as string);
      expect(overall.status).toBe("degraded");
    });

    it("sets overall to down when any service is down", async () => {
      const results = [
        makeResult("api"),
        makeResult("dashboard", "down"),
        makeResult("documentation"),
      ];
      await storeResults(env, results, dateStr);

      const overallCalls = vi.mocked(env.STATUS_KV.put).mock.calls.filter(
        (call) => call[0] === KV_KEYS.overall,
      );
      const overall: OverallStatus = JSON.parse(overallCalls[0][1] as string);
      expect(overall.status).toBe("down");
    });

    it("down takes priority over degraded", async () => {
      const results = [
        makeResult("api", "degraded"),
        makeResult("dashboard", "down"),
        makeResult("documentation"),
      ];
      await storeResults(env, results, dateStr);

      const overallCalls = vi.mocked(env.STATUS_KV.put).mock.calls.filter(
        (call) => call[0] === KV_KEYS.overall,
      );
      const overall: OverallStatus = JSON.parse(overallCalls[0][1] as string);
      expect(overall.status).toBe("down");
    });

    it("includes per-service statuses in overall", async () => {
      const results = [
        makeResult("api", "operational"),
        makeResult("dashboard", "degraded"),
        makeResult("documentation", "down"),
      ];
      await storeResults(env, results, dateStr);

      const overallCalls = vi.mocked(env.STATUS_KV.put).mock.calls.filter(
        (call) => call[0] === KV_KEYS.overall,
      );
      const overall: OverallStatus = JSON.parse(overallCalls[0][1] as string);
      expect(overall.services["api"]).toBe("operational");
      expect(overall.services["dashboard"]).toBe("degraded");
      expect(overall.services["documentation"]).toBe("down");
    });

    it("includes updatedAt timestamp", async () => {
      const results = [makeResult("api")];
      await storeResults(env, results, dateStr);

      const overallCalls = vi.mocked(env.STATUS_KV.put).mock.calls.filter(
        (call) => call[0] === KV_KEYS.overall,
      );
      const overall: OverallStatus = JSON.parse(overallCalls[0][1] as string);
      expect(overall.updatedAt).toBeDefined();
      expect(new Date(overall.updatedAt).getTime()).not.toBeNaN();
    });
  });
});
