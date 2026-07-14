import type { EmailMessage } from "@/types";
import { api } from "@/lib/api";
import {
  defaultMailboxListLimit,
  readMailboxListCache,
  writeMailboxListCache,
} from "@/lib/email/mailboxSessionCache";

export function isDemoMailboxProject(
  projectId: string | null | undefined,
): projectId is string {
  void projectId;
  return false;
}

export { bustMailboxListCache } from "@/lib/email/mailboxSessionCache";

export async function fetchMailboxList(
  folderType: string,
  opts?: { bust?: boolean },
): Promise<EmailMessage[]> {
  if (!opts?.bust) {
    const cached = readMailboxListCache(folderType);
    if (cached) return cached;
  }
  const limit = defaultMailboxListLimit();
  const data = (await api.email.getAll(folderType, limit)) as EmailMessage[];
  writeMailboxListCache(folderType, data);
  return data;
}

export async function fetchMailboxMessage(
  messageId: string,
  opts?: { hydrateBody?: boolean },
): Promise<EmailMessage | null> {
  try {
    return (await api.email.getById(messageId, {
      hydrateBody: opts?.hydrateBody === true,
    })) as EmailMessage;
  } catch {
    return null;
  }
}
