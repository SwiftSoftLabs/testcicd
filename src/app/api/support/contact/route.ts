import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@insforge/sdk";
import { INSFORGE_ANON_KEY, INSFORGE_URL } from "@/lib/insforge/config";

const ContactSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  subject: z.string().min(1).max(200),
  message: z.string().min(10).max(5000),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = ContactSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { name, email, subject, message } = parsed.data;
  const from = process.env.INSFORGE_EMAIL_FROM;

  if (!from) {
    return NextResponse.json(
      { error: "Email service not configured" },
      { status: 500 },
    );
  }

  const insforge = createClient({ baseUrl: INSFORGE_URL, anonKey: INSFORGE_ANON_KEY });

  const html = `
    <p><strong>From:</strong> ${name} (${email})</p>
    <p><strong>Subject:</strong> ${subject}</p>
    <hr />
    <p>${message.replace(/\n/g, "<br />")}</p>
  `;

  const { error } = await insforge.emails.send({
    from,
    to: "zohan@swiftsoftlabs.com",
    subject: `[OneWork Support] ${subject}`,
    html,
    replyTo: email,
  });

  if (error) {
    return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
