import type { MailAccountWithSecret } from "@/lib/email/accounts";
import { gmailApiProvider } from "@/lib/email/providers/gmailApi";
import { graphApiProvider } from "@/lib/email/providers/graphApi";
import { imapProvider } from "@/lib/email/providers/imapProvider";
import type { MailProvider } from "@/lib/email/providers/types";

export function resolveMailProvider(
  account: MailAccountWithSecret,
): MailProvider {
  if (account.provider_type === "gmail" && account.auth_method === "oauth") {
    return gmailApiProvider;
  }
  if (account.provider_type === "outlook" && account.auth_method === "oauth") {
    return graphApiProvider;
  }
  return imapProvider;
}
