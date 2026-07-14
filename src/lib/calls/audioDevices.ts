import { ENHANCED_NOISE_CAPTURE_SAMPLE_RATE } from "@/lib/calls/microphoneAudioConfig";

export type CallMediaDevice = {
  deviceId: string;
  label: string;
  groupId: string;
};

const BLUETOOTH_AUDIO_LABEL =
  /bluetooth|airpods?|beats|hands[- ]?free|headset|earbuds?|buds|wh-|hfp|a2dp|galaxy buds|pixel buds|powerbeats|soundcore|jabra|sony wh|bose qc|plantronics|poly/i;

export function isBluetoothLikeAudioLabel(label: string): boolean {
  return BLUETOOTH_AUDIO_LABEL.test(label.trim());
}

/** HFP / Bluetooth mics often run below 48 kHz — WASM NC causes demon voice. */
export function shouldUseBrowserNoiseCancellationOnly(
  microphoneLabel: string,
  sampleRate?: number,
): boolean {
  if (isBluetoothLikeAudioLabel(microphoneLabel)) return true;
  if (
    sampleRate != null &&
    sampleRate > 0 &&
    sampleRate < ENHANCED_NOISE_CAPTURE_SAMPLE_RATE
  ) {
    return true;
  }
  return false;
}

export function supportsAudioOutputSelection(): boolean {
  return (
    typeof HTMLMediaElement !== "undefined" &&
    "setSinkId" in HTMLMediaElement.prototype
  );
}

function toCallDevice(
  device: MediaDeviceInfo,
  fallbackPrefix: string,
  index: number,
): CallMediaDevice {
  return {
    deviceId: device.deviceId,
    label: device.label || `${fallbackPrefix} ${index + 1}`,
    groupId: device.groupId,
  };
}

export async function enumerateCallMediaDevices(): Promise<{
  microphones: CallMediaDevice[];
  cameras: CallMediaDevice[];
  speakers: CallMediaDevice[];
}> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const microphones: CallMediaDevice[] = [];
  const cameras: CallMediaDevice[] = [];
  const speakers: CallMediaDevice[] = [];

  for (const device of devices) {
    if (device.kind === "audioinput") {
      microphones.push(toCallDevice(device, "Microphone", microphones.length));
    } else if (device.kind === "videoinput") {
      cameras.push(toCallDevice(device, "Camera", cameras.length));
    } else if (device.kind === "audiooutput") {
      speakers.push(toCallDevice(device, "Speaker", speakers.length));
    }
  }

  return { microphones, cameras, speakers };
}

export async function resolveMicrophoneLabel(
  microphoneDeviceId?: string,
): Promise<string> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  if (microphoneDeviceId) {
    const match = devices.find(
      (device) =>
        device.kind === "audioinput" && device.deviceId === microphoneDeviceId,
    );
    if (match?.label) return match.label;
  }
  return devices.find((device) => device.kind === "audioinput")?.label ?? "";
}

/** Headsets share the same groupId for mic + speaker (e.g. AirPods, BT headsets). */
export function findSpeakerInSameGroup(
  microphoneDeviceId: string,
  devices: MediaDeviceInfo[],
): CallMediaDevice | null {
  const mic = devices.find(
    (device) =>
      device.kind === "audioinput" && device.deviceId === microphoneDeviceId,
  );
  if (!mic?.groupId) return null;

  const speaker = devices.find(
    (device) =>
      device.kind === "audiooutput" && device.groupId === mic.groupId,
  );
  if (!speaker?.deviceId) return null;

  return {
    deviceId: speaker.deviceId,
    label: speaker.label || "Headphones",
    groupId: speaker.groupId,
  };
}

export function findSpeakerByDeviceId(
  speakerDeviceId: string,
  devices: MediaDeviceInfo[],
): CallMediaDevice | null {
  const speaker = devices.find(
    (device) =>
      device.kind === "audiooutput" && device.deviceId === speakerDeviceId,
  );
  if (!speaker?.deviceId) return null;
  return {
    deviceId: speaker.deviceId,
    label: speaker.label || "Speaker",
    groupId: speaker.groupId,
  };
}
