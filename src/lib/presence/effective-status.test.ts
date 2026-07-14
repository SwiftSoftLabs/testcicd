import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildEffectivePresenceStatusSql } from "./effective-status";
import {
  PRESENCE_STALE_AWAY_SECONDS,
  PRESENCE_STALE_OFFLINE_SECONDS,
} from "./constants";

describe("buildEffectivePresenceStatusSql", () => {
  it("includes invited and manual branches", () => {
    const sql = buildEffectivePresenceStatusSql();
    assert.match(sql, /WHEN p\.status = 'invited' THEN 'invited'/);
    assert.match(sql, /WHEN wp\.is_manual THEN wp\.status/);
  });

  it("uses stale away and offline intervals from constants", () => {
    const sql = buildEffectivePresenceStatusSql();
    assert.match(
      sql,
      new RegExp(
        `INTERVAL '${PRESENCE_STALE_OFFLINE_SECONDS} seconds'`,
      ),
    );
    assert.match(
      sql,
      new RegExp(`INTERVAL '${PRESENCE_STALE_AWAY_SECONDS} seconds'`),
    );
  });

  it("supports custom table aliases", () => {
    const sql = buildEffectivePresenceStatusSql("profiles", "presence");
    assert.match(sql, /profiles\.status/);
    assert.match(sql, /presence\.is_manual/);
  });
});
