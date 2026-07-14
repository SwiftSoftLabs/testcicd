export type Presence = "online" | "away" | "offline" | "invited";

export const PRESENCE_DND_LABEL = "Do not disturb";
export const PRESENCE_OFFLINE_LABEL = "Offline";

/** Maps DB/workspace_presence status to member-list UI label. */
export function presenceDbToMemberStatus(
  dbStatus: string,
  isManual = false,
): string {
  switch (dbStatus) {
    case "online":
      return "Active";
    case "away":
      return "Away";
    case "invited":
      return "Invited";
    case "offline":
      return isManual ? PRESENCE_DND_LABEL : PRESENCE_OFFLINE_LABEL;
    default:
      return PRESENCE_OFFLINE_LABEL;
  }
}

export function presenceLabelForMemberStatus(ui: string): string {
  switch (ui) {
    case "Active":
      return "Online";
    case "Away":
      return "Away";
    case PRESENCE_DND_LABEL:
      return PRESENCE_DND_LABEL;
    default:
      return PRESENCE_OFFLINE_LABEL;
  }
}

export function presenceFromMemberStatus(ui: string): Presence {
  switch (ui) {
    case "Active":
    case "online":
      return "online";
    case "Away":
    case "away":
      return "away";
    case "Invited":
    case "invited":
      return "invited";
    case PRESENCE_DND_LABEL:
    case PRESENCE_OFFLINE_LABEL:
    case "Offline":
    case "offline":
    default:
      return "offline";
  }
}
