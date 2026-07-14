import { Track, type RemoteVideoTrack } from "livekit-client";

export type RemoteVideoTrackSet = {
  camera?: RemoteVideoTrack;
  screenShare?: RemoteVideoTrack;
};

export type RemoteTrackSlot = keyof RemoteVideoTrackSet;

export function remoteTrackSlotForSource(
  source: Track.Source,
): RemoteTrackSlot | null {
  if (source === Track.Source.ScreenShare) return "screenShare";
  if (source === Track.Source.Camera) return "camera";
  return null;
}

export function getPresenterTrack(
  tracks: RemoteVideoTrackSet | undefined,
): RemoteVideoTrack | undefined {
  if (!tracks) return undefined;
  return tracks.screenShare ?? tracks.camera;
}

/** Camera for sidebar/grid tiles; presenter stage uses getPresenterTrack. */
export function getRemoteTileTrack(
  tracks: RemoteVideoTrackSet | undefined,
  opts: { isPresenterSidebar: boolean },
): RemoteVideoTrack | undefined {
  if (!tracks) return undefined;
  if (opts.isPresenterSidebar) return tracks.camera;
  return tracks.camera ?? tracks.screenShare;
}

export function setRemoteTrackSlot(
  map: Map<string, RemoteVideoTrackSet>,
  identity: string,
  slot: RemoteTrackSlot,
  track: RemoteVideoTrack,
): RemoteVideoTrackSet {
  const prev = map.get(identity) ?? {};
  const next = { ...prev, [slot]: track };
  map.set(identity, next);
  return next;
}

export function deleteRemoteTrackSlot(
  map: Map<string, RemoteVideoTrackSet>,
  identity: string,
  slot: RemoteTrackSlot,
): RemoteVideoTrackSet | undefined {
  const prev = map.get(identity);
  if (!prev) return undefined;
  const next = { ...prev };
  delete next[slot];
  if (!next.camera && !next.screenShare) {
    map.delete(identity);
    return undefined;
  }
  map.set(identity, next);
  return next;
}

export function detachAllRemoteTracks(
  map: Map<string, RemoteVideoTrackSet>,
): void {
  for (const tracks of map.values()) {
    tracks.camera?.detach();
    tracks.screenShare?.detach();
  }
  map.clear();
}
