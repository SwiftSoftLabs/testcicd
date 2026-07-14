import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  pickPresenceLeaderTabId,
  pruneStaleTabs,
  resolveAggregatePresenceStatus,
  type TabPresenceRecord,
} from "./tab-coordinator";
import { PRESENCE_IDLE_AWAY_MS } from "./constants";

const NOW = 1_700_000_000_000;

function tab(
  id: string,
  visible: boolean,
  lastActivityAt: number,
  heartbeatAt = NOW,
): TabPresenceRecord {
  return { tabId: id, visible, lastActivityAt, heartbeatAt };
}

describe("resolveAggregatePresenceStatus", () => {
  it("returns offline when no tabs are registered", () => {
    assert.equal(resolveAggregatePresenceStatus([], NOW), "offline");
  });

  it("returns away when every tab is hidden", () => {
    const status = resolveAggregatePresenceStatus(
      [tab("a", false, NOW), tab("b", false, NOW)],
      NOW,
    );
    assert.equal(status, "away");
  });

  it("returns online when any tab is visible and recently active", () => {
    const status = resolveAggregatePresenceStatus(
      [
        tab("a", false, NOW - 60_000),
        tab("b", true, NOW - 30_000),
      ],
      NOW,
    );
    assert.equal(status, "online");
  });

  it("returns away when visible tab exceeded idle timeout", () => {
    const status = resolveAggregatePresenceStatus(
      [tab("a", true, NOW - PRESENCE_IDLE_AWAY_MS - 1)],
      NOW,
    );
    assert.equal(status, "away");
  });
});

describe("pickPresenceLeaderTabId", () => {
  it("prefers a visible tab with the latest activity", () => {
    const leader = pickPresenceLeaderTabId([
      tab("hidden", false, NOW),
      tab("active", true, NOW - 5_000),
      tab("other", true, NOW - 60_000),
    ]);
    assert.equal(leader, "active");
  });

  it("falls back to hidden tabs when none are visible", () => {
    const leader = pickPresenceLeaderTabId([
      tab("b", false, NOW - 10_000),
      tab("a", false, NOW),
    ]);
    assert.equal(leader, "a");
  });
});

describe("pruneStaleTabs", () => {
  it("removes tabs with expired heartbeats", () => {
    const pruned = pruneStaleTabs(
      {
        fresh: tab("fresh", true, NOW, NOW),
        stale: tab("stale", true, NOW, NOW - 60_000),
      },
      NOW,
      45_000,
    );
    assert.deepEqual(Object.keys(pruned), ["fresh"]);
  });
});
