import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { getWebAuthnConfig } from "@/lib/passkeys/config";
import {
  consumeWebAuthnChallenge,
  getPasskeyByCredentialId,
  getPasskeysForUser,
  saveWebAuthnChallenge,
  updatePasskeyCounter,
} from "@/lib/passkeys/db";

export async function createAuthenticationOptions(
  userId: string,
  purpose: "authentication" | "login",
) {
  const { rpID } = getWebAuthnConfig();
  const passkeys = await getPasskeysForUser(userId);
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "preferred",
    allowCredentials: passkeys.map((p) => ({ id: p.credential_id })),
  });
  await saveWebAuthnChallenge({
    userId,
    challenge: options.challenge,
    purpose,
  });
  return options;
}

export async function verifyAuthentication(
  userId: string,
  response: AuthenticationResponseJSON,
  purpose: "authentication" | "login",
): Promise<{ verified: boolean; error?: string }> {
  const stored = await getPasskeyByCredentialId(response.id);
  if (!stored || stored.user_id !== userId) {
    return { verified: false, error: "Unknown passkey" };
  }
  const { origin, rpID } = getWebAuthnConfig();
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: async (challenge) =>
      consumeWebAuthnChallenge({ userId, purpose, challenge }),
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
    credential: {
      id: stored.credential_id,
      publicKey: Buffer.from(stored.public_key, "base64"),
      counter: Number(stored.counter),
    },
  });
  if (!verification.verified) {
    return { verified: false, error: "Passkey verification failed" };
  }
  await updatePasskeyCounter(
    stored.credential_id,
    verification.authenticationInfo.newCounter,
  );
  return { verified: true };
}

export async function verifyLoginAuthentication(
  response: AuthenticationResponseJSON,
): Promise<{ verified: boolean; userId?: string; error?: string }> {
  const stored = await getPasskeyByCredentialId(response.id);
  if (!stored) return { verified: false, error: "Unknown passkey" };
  const userId = stored.user_id;
  const { origin, rpID } = getWebAuthnConfig();
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: async (challenge) => {
      if (
        await consumeWebAuthnChallenge({
          userId,
          purpose: "login",
          challenge,
        })
      ) {
        return true;
      }
      return consumeWebAuthnChallenge({
        userId: null,
        purpose: "login",
        challenge,
      });
    },
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
    credential: {
      id: stored.credential_id,
      publicKey: Buffer.from(stored.public_key, "base64"),
      counter: Number(stored.counter),
    },
  });
  if (!verification.verified) {
    return { verified: false, error: "Passkey verification failed" };
  }
  await updatePasskeyCounter(
    stored.credential_id,
    verification.authenticationInfo.newCounter,
  );
  return { verified: true, userId };
}
