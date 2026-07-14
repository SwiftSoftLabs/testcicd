import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findSpeakerInSameGroup,
  isBluetoothLikeAudioLabel,
  shouldUseBrowserNoiseCancellationOnly,
} from "./audioDevices";

describe("audioDevices", () => {
  it("detects common bluetooth headset labels", () => {
    assert.equal(isBluetoothLikeAudioLabel("AirPods Pro"), true);
    assert.equal(isBluetoothLikeAudioLabel("WH-1000XM5"), true);
    assert.equal(isBluetoothLikeAudioLabel("MacBook Pro Microphone"), false);
  });

  it("skips enhanced NC for bluetooth and sub-48kHz capture", () => {
    assert.equal(shouldUseBrowserNoiseCancellationOnly("AirPods Pro"), true);
    assert.equal(shouldUseBrowserNoiseCancellationOnly("USB Mic", 16000), true);
    assert.equal(shouldUseBrowserNoiseCancellationOnly("USB Mic", 48000), false);
  });

  it("pairs speaker output by shared groupId", () => {
    const devices = [
      {
        deviceId: "mic-1",
        kind: "audioinput" as const,
        label: "AirPods Pro",
        groupId: "g1",
        toJSON: () => ({}),
      },
      {
        deviceId: "spk-1",
        kind: "audiooutput" as const,
        label: "AirPods Pro",
        groupId: "g1",
        toJSON: () => ({}),
      },
    ] as MediaDeviceInfo[];

    const speaker = findSpeakerInSameGroup("mic-1", devices);
    assert.equal(speaker?.deviceId, "spk-1");
  });
});
