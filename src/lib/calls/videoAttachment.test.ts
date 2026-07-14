import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  attachVideoToContainer,
  clearVideoContainer,
  detachVideoFromContainer,
  type AttachableVideoTrack,
} from "./videoAttachment";

type MockElement = {
  tagName: string;
  dataset: Record<string, string>;
  style: Record<string, string>;
  children: MockElement[];
  parentElement: MockElement | null;
  remove: () => void;
  querySelector: (sel: string) => MockElement | null;
  querySelectorAll: (sel: string) => MockElement[];
  appendChild: (child: MockElement) => void;
  replaceChildren: (...nodes: MockElement[]) => void;
};

function createMockDocument() {
  const makeEl = (tagName: string): MockElement => {
    const el: MockElement = {
      tagName: tagName.toUpperCase(),
      dataset: {},
      style: {},
      children: [],
      parentElement: null,
      remove() {
        if (this.parentElement) {
          this.parentElement.children = this.parentElement.children.filter(
            (c) => c !== this,
          );
          this.parentElement = null;
        }
      },
      querySelector(sel: string) {
        if (sel === "video") {
          return this.children.find((c) => c.tagName === "VIDEO") ?? null;
        }
        return null;
      },
      querySelectorAll(sel: string) {
        if (sel === "video") {
          return this.children.filter((c) => c.tagName === "VIDEO");
        }
        return [];
      },
      appendChild(child: MockElement) {
        child.parentElement = this;
        this.children.push(child);
      },
      replaceChildren(...nodes: MockElement[]) {
        for (const child of this.children) child.parentElement = null;
        this.children = [];
        for (const node of nodes) this.appendChild(node);
      },
    };
    return el;
  };

  return {
    createElement(tag: string) {
      return makeEl(tag);
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).document = createMockDocument();

function mockTrack(id: string): AttachableVideoTrack {
  const attached: HTMLMediaElement[] = [];
  return {
    attachedElements: attached,
    attach() {
      const video = document.createElement("video") as unknown as HTMLMediaElement;
      (video as unknown as MockElement).dataset.trackId = id;
      attached.push(video);
      return video;
    },
    detach(el: HTMLMediaElement) {
      const idx = attached.indexOf(el);
      if (idx >= 0) attached.splice(idx, 1);
      (el as unknown as MockElement).remove();
    },
  } as unknown as AttachableVideoTrack;
}

describe("attachVideoToContainer", () => {
  it("attaches track video to container", () => {
    const container = document.createElement("div") as unknown as HTMLDivElement;
    const track = mockTrack("a");
    const el = attachVideoToContainer(track, container);
    assert.equal(container.querySelector("video"), el);
    assert.equal(track.attachedElements.length, 1);
  });

  it("is idempotent when same track is already attached", () => {
    const container = document.createElement("div") as unknown as HTMLDivElement;
    const track = mockTrack("a");
    const first = attachVideoToContainer(track, container);
    const second = attachVideoToContainer(track, container);
    assert.equal(first, second);
    assert.equal(container.querySelectorAll("video").length, 1);
    assert.equal(track.attachedElements.length, 1);
  });

  it("swaps tracks without leaving multiple videos", () => {
    const container = document.createElement("div") as unknown as HTMLDivElement;
    const trackA = mockTrack("a");
    const trackB = mockTrack("b");
    attachVideoToContainer(trackA, container);
    attachVideoToContainer(trackB, container);
    assert.equal(container.querySelectorAll("video").length, 1);
    assert.equal(trackA.attachedElements.length, 0);
    assert.equal(trackB.attachedElements.length, 1);
    assert.equal(
      (container.querySelector("video") as HTMLVideoElement).dataset.trackId,
      "b",
    );
  });
});

describe("detachVideoFromContainer", () => {
  it("detaches track from container", () => {
    const container = document.createElement("div") as unknown as HTMLDivElement;
    const track = mockTrack("a");
    attachVideoToContainer(track, container);
    detachVideoFromContainer(track, container);
    assert.equal(container.querySelector("video"), null);
    assert.equal(track.attachedElements.length, 0);
  });
});

describe("clearVideoContainer", () => {
  it("removes video and detaches mapped track", () => {
    const container = document.createElement("div") as unknown as HTMLDivElement;
    const track = mockTrack("a");
    attachVideoToContainer(track, container);
    clearVideoContainer(container);
    assert.equal(container.querySelector("video"), null);
    assert.equal(track.attachedElements.length, 0);
  });
});
