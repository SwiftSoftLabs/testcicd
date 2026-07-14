import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { getWebAuthnConfig, webAuthnUserIdBytes } from "@/lib/passkeys/config";
import {
  consumeWebAuthnChallenge,
  getPasskeysForUser,
  savePasskeyCredential,
  saveWebAuthnChallenge,
} from "@/lib/passkeys/db";
import { syncMfaEnabledFlag } from "@/lib/passkeys/sync-mfa";

export async function createRegistrationOptions(
  userId: string,
  email: string,
  friendlyName?: string,
) {
  const { rpID, rpName } = getWebAuthnConfig();
  const existing = await getPasskeysForUser(userId);
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: email,
    userDisplayName: friendlyName || email,
    userID: webAuthnUserIdBytes(userId),
    attestationType: "none",
    excludeCredentials: existing.map((p) => ({ id: p.credential_id })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });
  await saveWebAuthnChallenge({
    userId,
    challenge: options.challenge,
    purpose: "registration",
  });
  return options;
}

export async function verifyRegistration(
  userId: string,
  response: RegistrationResponseJSON,
  friendlyName?: string,
): Promise<{ verified: boolean; error?: string }> {
  const { origin, rpID } = getWebAuthnConfig();
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: async (challenge) =>
      consumeWebAuthnChallenge({
        userId,
        purpose: "registration",
        challenge,
      }),
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
  });
  if (!verification.verified || !verification.registrationInfo) {
    return { verified: false, error: "Passkey verification failed" };
  }
  const { credential } = verification.registrationInfo;
  await savePasskeyCredential({
    userId,
    credentialId: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString("base64"),
    counter: credential.counter,
    deviceType: verification.registrationInfo.credentialDeviceType,
    backedUp: verification.registrationInfo.credentialBackedUp,
    transports: response.response.transports,
    friendlyName: friendlyName?.trim() || "Passkey",
  });
  await syncMfaEnabledFlag(userId);
  return { verified: true };
}
