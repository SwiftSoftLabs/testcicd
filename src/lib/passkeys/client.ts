import {
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { api } from "@/lib/api";

export async function registerPasskey(friendlyName?: string): Promise<void> {
  const options = (await api.security.passkeys.registerOptions(
    friendlyName,
  )) as PublicKeyCredentialCreationOptionsJSON;
  const attResp = await startRegistration({ optionsJSON: options });
  await api.security.passkeys.registerVerify(
    attResp as RegistrationResponseJSON,
    friendlyName,
  );
}

export async function authenticatePasskeyForStepUp(): Promise<void> {
  const options = (await api.security.passkeys.authenticateOptions()) as PublicKeyCredentialRequestOptionsJSON;
  const authResp = await startAuthentication({ optionsJSON: options });
  await api.security.passkeys.authenticateVerify(
    authResp as AuthenticationResponseJSON,
  );
}

export async function loginWithPasskey(email?: string) {
  const options = (await api.auth.passkeyLoginOptions(email)) as PublicKeyCredentialRequestOptionsJSON;
  const authResp = await startAuthentication({ optionsJSON: options });
  return api.auth.passkeyLoginVerify(authResp as AuthenticationResponseJSON) as Promise<{
    accessToken: string;
    refreshToken: string;
    user: { id: string; email: string; profile?: { name?: string; avatar_url?: string | null } };
  }>;
}
