import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractCodeFromPreNode } from "./ChatCodeBlock";

describe("extractCodeFromPreNode", () => {
  it("reads fenced code and language from a pre node", () => {
    const result = extractCodeFromPreNode({
      type: "element",
      tagName: "pre",
      children: [
        {
          type: "element",
          tagName: "code",
          properties: { className: "language-typescript" },
          children: [{ type: "text", value: "const x = 1\n" }],
        },
      ],
    });

    assert.deepEqual(result, { text: "const x = 1", language: "typescript" });
  });

  it("reads unlabeled fenced code blocks", () => {
    const result = extractCodeFromPreNode({
      type: "element",
      tagName: "pre",
      children: [
        {
          type: "element",
          tagName: "code",
          children: [{ type: "text", value: "plain block" }],
        },
      ],
    });

    assert.deepEqual(result, { text: "plain block", language: undefined });
  });

  it("returns null for non-pre nodes", () => {
    assert.equal(extractCodeFromPreNode(undefined), null);
    assert.equal(
      extractCodeFromPreNode({ type: "element", tagName: "p", children: [] }),
      null,
    );
  });
});
