import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  expandBareFenceAtCursor,
  isBareOpeningFence,
  normalizeBareFencesToMarkdown,
} from "./fencedMarkdown";

describe("expandBareFenceAtCursor", () => {
  it("expands a newly typed bare fence to ```markdown", () => {
    const text = "```";
    const result = expandBareFenceAtCursor(text, 3, "``");
    assert.ok(result);
    assert.equal(result.text, "```markdown\n");
    assert.equal(result.cursor, "```markdown\n".length);
  });

  it("does not re-expand when the user deletes markdown from an existing fence", () => {
    const text = "```";
    const result = expandBareFenceAtCursor(text, 3, "```markdown");
    assert.equal(result, null);
  });

  it("does not re-expand when the user deletes a language tag from a named fence", () => {
    const text = "```";
    const result = expandBareFenceAtCursor(text, 3, "```python");
    assert.equal(result, null);
  });

  it("still defaults bare fences to markdown on send", () => {
    assert.equal(normalizeBareFencesToMarkdown("```\nhello\n```"), "```markdown\nhello\n```");
  });
});

describe("isBareOpeningFence", () => {
  it("matches only an unlabeled fence", () => {
    assert.equal(isBareOpeningFence("```"), true);
    assert.equal(isBareOpeningFence("```markdown"), false);
    assert.equal(isBareOpeningFence("```python"), false);
  });
});
