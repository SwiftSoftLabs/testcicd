import type { MailAccountWithSecret } from "@/lib/email/accounts";

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password?: string;
  accessToken?: string;
};

export function smtpConfigFromAccount(
  account: MailAccountWithSecret,
): SmtpConfig {
  if (account.auth_method === "oauth") {
    return {
      host: account.smtp_host,
      port: Number(account.smtp_port),
      secure: Boolean(account.smtp_secure),
      username: account.username,
      accessToken: account.decryptedPassword,
    };
  }
  return {
    host: account.smtp_host,
    port: Number(account.smtp_port),
    secure: Boolean(account.smtp_secure),
    username: account.username,
    password: account.decryptedPassword,
  };
}

export type SmtpSendInput = {
  config: SmtpConfig;
  fromEmail: string;
  fromName?: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  html: string;
  replyTo?: string;
};

function nodemailerAuth(config: SmtpConfig) {
  if (config.accessToken) {
    return {
      type: "OAuth2" as const,
      user: config.username,
      accessToken: config.accessToken,
    };
  }
  if (!config.password) {
    throw new Error("SMTP password or access token required");
  }
  return {
    user: config.username,
    pass: config.password,
  };
}

export async function verifySmtpConnection(config: SmtpConfig): Promise<void> {
  const nodemailer = (await import("nodemailer")).default;
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: nodemailerAuth(config),
  });
  await transporter.verify();
}

export async function sendViaSmtp(
  input: SmtpSendInput,
): Promise<{ messageId?: string }> {
  const nodemailer = (await import("nodemailer")).default;
  const transporter = nodemailer.createTransport({
    host: input.config.host,
    port: input.config.port,
    secure: input.config.secure,
    auth: nodemailerAuth(input.config),
  });

  const info = await transporter.sendMail({
    from: input.fromName
      ? `${input.fromName} <${input.fromEmail}>`
      : input.fromEmail,
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    subject: input.subject,
    html: input.html,
    replyTo: input.replyTo,
  });

  return { messageId: info.messageId };
}
