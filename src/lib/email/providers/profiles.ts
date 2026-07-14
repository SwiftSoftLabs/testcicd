export type MailProviderType = "gmail" | "outlook" | "custom";

export type ProviderPreset = {
  providerType: MailProviderType;
  label: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
};

const GMAIL_PRESET: ProviderPreset = {
  providerType: "gmail",
  label: "Gmail",
  imapHost: "imap.gmail.com",
  imapPort: 993,
  imapSecure: true,
  smtpHost: "smtp.gmail.com",
  smtpPort: 465,
  smtpSecure: true,
};

const OUTLOOK_PRESET: ProviderPreset = {
  providerType: "outlook",
  label: "Outlook / Microsoft 365",
  imapHost: "outlook.office365.com",
  imapPort: 993,
  imapSecure: true,
  smtpHost: "smtp.office365.com",
  smtpPort: 587,
  smtpSecure: false,
};

const OUTLOOK_DOMAINS = new Set([
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "office365.com",
]);

export function resolveProviderPreset(
  emailAddress: string,
): ProviderPreset | null {
  const normalized = emailAddress.trim().toLowerCase();
  const domain = normalized.split("@")[1] || "";
  if (!domain) return null;
  if (domain === "gmail.com" || domain === "googlemail.com")
    return GMAIL_PRESET;
  if (
    OUTLOOK_DOMAINS.has(domain) ||
    domain.endsWith(".outlook.com") ||
    domain.endsWith(".onmicrosoft.com")
  ) {
    return OUTLOOK_PRESET;
  }
  return null;
}

export function providerPresetByType(
  providerType: MailProviderType,
): ProviderPreset | null {
  if (providerType === "gmail") return GMAIL_PRESET;
  if (providerType === "outlook") return OUTLOOK_PRESET;
  return null;
}
