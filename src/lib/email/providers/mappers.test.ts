import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  gmailFolderFromLabels,
  mapGmailMessageToSyncInput,
  mapGraphMessageToSyncInput,
  shouldGmailFullBackfill,
  shouldGraphDeltaReset,
} from "@/lib/email/providers/mappers";

describe("gmail mappers", () => {
  it("maps inbox metadata to sync input", () => {
    const mapped = mapGmailMessageToSyncInput({
      id: "abc123",
      threadId: "thread-1",
      labelIds: ["INBOX", "UNREAD"],
      snippet: "Hello from Gmail",
      internalDate: String(Date.parse("2026-06-01T10:00:00.000Z")),
      payload: {
        headers: [
          { name: "Message-ID", value: "<msg-1@example.com>" },
          { name: "From", value: "Sender <sender@example.com>" },
          { name: "To", value: "recipient@example.com" },
          { name: "Subject", value: "Test subject" },
        ],
      },
    });

    assert.ok(mapped);
    assert.equal(mapped.externalMessageId, "<msg-1@example.com>");
    assert.equal(mapped.providerMessageId, "abc123");
    assert.equal(mapped.folder, "inbox");
    assert.equal(mapped.isRead, false);
    assert.equal(mapped.textBody, "Hello from Gmail");
  });

  it("detects folder from labels", () => {
    assert.equal(gmailFolderFromLabels(["SENT"]), "sent");
    assert.equal(gmailFolderFromLabels(["DRAFT"]), "drafts");
    assert.equal(gmailFolderFromLabels(["CATEGORY_PROMOTIONS"]), null);
  });
});

describe("graph mappers", () => {
  it("maps inbox message to sync input", () => {
    const mapped = mapGraphMessageToSyncInput(
      {
        id: "graph-1",
        conversationId: "conv-1",
        internetMessageId: "<graph@example.com>",
        subject: "Graph subject",
        bodyPreview: "Preview text",
        from: {
          emailAddress: { name: "Graph User", address: "graph@example.com" },
        },
        toRecipients: [
          { emailAddress: { address: "to@example.com" } },
        ],
        receivedDateTime: "2026-06-02T12:00:00.000Z",
        isRead: true,
        flag: { flagStatus: "flagged" },
        isDraft: false,
      },
      "inbox",
    );

    assert.ok(mapped);
    assert.equal(mapped.externalMessageId, "<graph@example.com>");
    assert.equal(mapped.providerMessageId, "graph-1");
    assert.equal(mapped.isStarred, true);
    assert.equal(mapped.textBody, "Preview text");
  });

  it("returns null for removed delta entries", () => {
    const mapped = mapGraphMessageToSyncInput(
      { id: "deleted-1", "@removed": { reason: "deleted" } },
      "inbox",
    );
    assert.equal(mapped, null);
  });
});

describe("cursor fallback helpers", () => {
  it("detects expired Gmail history cursor", () => {
    assert.equal(
      shouldGmailFullBackfill({ status: 404, message: "historyId not found" }),
      true,
    );
    assert.equal(shouldGmailFullBackfill({ status: 500 }), false);
  });

  it("detects expired Graph delta cursor", () => {
    assert.equal(shouldGraphDeltaReset({ status: 410 }), true);
    assert.equal(shouldGraphDeltaReset({ status: 404 }), false);
  });
});
