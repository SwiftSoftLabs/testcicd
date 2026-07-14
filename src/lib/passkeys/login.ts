import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { getWebAuthnConfig } from "@/lib/passkeys/config";
import {
  findUserIdByEmail,
  getPasskeysForUser,
  saveWebAuthnChallenge,
} from "@/lib/passkeys/db";
import { createAuthenticationOptions } from "@/lib/passkeys/authenticate";

export async function createLoginOptions(email: string) {
  const userId = await findUserIdByEmail(email);
  if (!userId) throw new Error("No account found for this email");
  if ((await getPasskeysForUser(userId)).length === 0) {
    throw new Error("No passkeys registered for this account");
  }
  return createAuthenticationOptions(userId, "login");
}

export async function createDiscoverableLoginOptions() {
  const { rpID } = getWebAuthnConfig();
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "preferred",
  });
  await saveWebAuthnChallenge({
    userId: null,
    challenge: options.challenge,
    purpose: "login",
  });
  return options;
}
