import type { LocalVideoTrack, RemoteVideoTrack } from "livekit-client";

export type AttachableVideoTrack = LocalVideoTrack | RemoteVideoTrack;

const containerTrackMap = new WeakMap<HTMLDivElement, AttachableVideoTrack>();

function findContainerVideo(container: HTMLDivElement): HTMLVideoElement | null {
  return container.querySelector("video");
}

function isVideoAttachedToContainer(
  track: AttachableVideoTrack,
  container: HTMLDivElement,
): boolean {
  const video = findContainerVideo(container);
  if (!video) return false;
  return track.attachedElements.includes(video);
}

/**
 * Attach a LiveKit video track to a container without redundant DOM teardown.
 */
export function attachVideoToContainer(
  track: AttachableVideoTrack,
  container: HTMLDivElement,
): HTMLMediaElement {
  if (isVideoAttachedToContainer(track, container)) {
    containerTrackMap.set(container, track);
    return findContainerVideo(container)!;
  }

  for (const attachedEl of [...track.attachedElements]) {
    const parent = attachedEl.parentElement;
    if (parent instanceof HTMLDivElement && parent !== container) {
      track.detach(attachedEl);
      containerTrackMap.delete(parent);
    }
  }

  const previousTrack = containerTrackMap.get(container);
  const existingVideo = findContainerVideo(container);
  if (existingVideo) {
    if (previousTrack && previousTrack !== track) {
      previousTrack.detach(existingVideo);
    }
    container.replaceChildren();
  }

  const el = track.attach();
  el.style.width = "100%";
  el.style.height = "100%";
  el.style.objectFit = "contain";
  container.appendChild(el);
  containerTrackMap.set(container, track);
  return el;
}

export function detachVideoFromContainer(
  track: AttachableVideoTrack,
  container: HTMLDivElement,
): void {
  const video = findContainerVideo(container);
  if (video && track.attachedElements.includes(video)) {
    track.detach(video);
  }
  if (!findContainerVideo(container)) {
    containerTrackMap.delete(container);
  }
}

export function clearVideoContainer(container: HTMLDivElement): void {
  const previousTrack = containerTrackMap.get(container);
  const video = findContainerVideo(container);
  if (video && previousTrack?.attachedElements.includes(video)) {
    previousTrack.detach(video);
  } else if (video) {
    container.replaceChildren();
  } else {
    container.replaceChildren();
  }
  containerTrackMap.delete(container);
}

/** @internal Reset WeakMap state between tests. */
export function resetVideoAttachmentStateForTests(): void {
  // WeakMap cannot be cleared; tests use fresh DOM elements per case.
}
