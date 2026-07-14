import { createClient } from "@insforge/sdk";
import { INSFORGE_ANON_KEY, INSFORGE_URL } from "@/lib/insforge/config";
import { sendViaSmtp, smtpConfigFromAccount } from "@/lib/email/providers/smtp";
import { resolveMailProvider } from "@/lib/email/providers/registry";
import { MailAccountWithSecret } from "@/lib/email/accounts";

export type DeliveryResult =
  | { status: "sent"; providerMessageId?: string; attemptedAt: string }
  | { status: "failed"; error: string; attemptedAt: string };

export type DeliveryInput = {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
  mailbox?: MailAccountWithSecret | null;
};

const INSFORGE_EMAIL_FROM = process.env.INSFORGE_EMAIL_FROM?.trim();

export async function sendExternalEmail(
  input: DeliveryInput,
): Promise<DeliveryResult> {
  const attemptedAt = new Date().toISOString();
  const to = input.to.filter(Boolean);
  const cc = (input.cc || []).filter(Boolean);
  const bcc = (input.bcc || []).filter(Boolean);

  if (!to.length) {
    return {
      status: "failed",
      error: "Missing primary recipient email",
      attemptedAt,
    };
  }

  try {
    if (input.mailbox) {
      const mailbox = input.mailbox;
      if (
        mailbox.auth_method === "oauth" &&
        (mailbox.provider_type === "gmail" ||
          mailbox.provider_type === "outlook")
      ) {
        const provider = resolveMailProvider(mailbox);
        const nativeResult = await provider.send(mailbox, {
          to,
          cc: cc.length ? cc : undefined,
          bcc: bcc.length ? bcc : undefined,
          subject: input.subject,
          html: input.html,
          replyTo: input.replyTo,
        });
        return {
          status: "sent",
          providerMessageId: nativeResult.messageId,
          attemptedAt,
        };
      }

      const smtpResult = await sendViaSmtp({
        config: smtpConfigFromAccount(mailbox),
        fromEmail: mailbox.email_address,
        fromName: input.from,
        to,
        cc: cc.length ? cc : undefined,
        bcc: bcc.length ? bcc : undefined,
        subject: input.subject,
        html: input.html,
        replyTo: input.replyTo,
      });
      return {
        status: "sent",
        providerMessageId: smtpResult.messageId,
        attemptedAt,
      };
    }

    const insforge = createClient({
      baseUrl: INSFORGE_URL,
      anonKey: INSFORGE_ANON_KEY,
    });

    const { data, error } = await insforge.emails.send({
      to,
      cc: cc.length ? cc : undefined,
      bcc: bcc.length ? bcc : undefined,
      subject: input.subject,
      html: input.html,
      from: input.from || INSFORGE_EMAIL_FROM,
      replyTo: input.replyTo,
    });

    if (error) {
      return {
        status: "failed",
        error: error.message || "InsForge email send failed",
        attemptedAt,
      };
    }

    const providerMessageId =
      data &&
      typeof data === "object" &&
      "id" in data &&
      typeof data.id === "string"
        ? data.id
        : undefined;

    return { status: "sent", providerMessageId, attemptedAt };
  } catch (error) {
    return {
      status: "failed",
      error:
        error instanceof Error ? error.message : "Unexpected delivery error",
      attemptedAt,
    };
  }
}
