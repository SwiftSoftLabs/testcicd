import type { MailAccountWithSecret } from "@/lib/email/accounts";
import { buildStoredContent } from "@/lib/email/contentMeta";
import { resolveMailProvider } from "@/lib/email/providers/registry";
import type {
  MessageFlagChanges,
  MessageRef,
} from "@/lib/email/providers/types";

export type HydrateMailboxBodyInput = {
  providerMessageId: string | null;
  externalUid: number | null;
  folder: string;
  htmlBody: string;
};

export async function hydrateMailboxMessageBody(
  account: MailAccountWithSecret,
  input: HydrateMailboxBodyInput,
): Promise<{ htmlBody: string; textBody: string } | null> {
  if (input.htmlBody?.trim()) return null;

  const ref: MessageRef = {
    providerMessageId: input.providerMessageId,
    externalUid: input.externalUid,
    folder: input.folder,
  };

  if (!ref.providerMessageId && !ref.externalUid) return null;

  const provider = resolveMailProvider(account);
  const fullBody = await provider.fetchBody(account, ref);
  if (!fullBody) return null;

  const storedContent = buildStoredContent(fullBody.htmlBody, {
    attachments: (fullBody.attachments ?? []).map((attachment) => ({
      name: attachment.name,
      size: attachment.size,
      type: attachment.type,
      icsContent: attachment.icsContent,
    })),
  });

  return {
    htmlBody: storedContent,
    textBody: fullBody.textBody || "",
  };
}

export async function pushMailboxFlagChangesViaProvider(
  account: MailAccountWithSecret,
  message: {
    provider_message_id: string | null;
    external_uid: number | null;
    folder: string;
  },
  patchData: Record<string, unknown>,
): Promise<void> {
  const flagChanges: MessageFlagChanges = {};
  if (typeof patchData.is_read === "boolean")
    flagChanges.isRead = patchData.is_read;
  if (typeof patchData.is_starred === "boolean")
    flagChanges.isStarred = patchData.is_starred;
  if (!Object.keys(flagChanges).length) return;

  const ref: MessageRef = {
    providerMessageId: message.provider_message_id,
    externalUid: message.external_uid,
    folder: message.folder,
  };
  if (!ref.providerMessageId && !ref.externalUid) return;

  const provider = resolveMailProvider(account);
  await provider.updateFlags(account, ref, flagChanges);
}
