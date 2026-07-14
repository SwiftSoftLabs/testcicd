import { hasValidStepUp } from "@/lib/mfa/step-up";
import { userHasMfaEnabled } from "@/lib/mfa/enabled";

export class MfaStepUpRequiredError extends Error {
  readonly status = 403;
  readonly code = "MFA_STEP_UP_REQUIRED";

  constructor() {
    super("Two-factor verification required");
    this.name = "MfaStepUpRequiredError";
  }
}

export class MfaEnrollmentRequiredError extends Error {
  readonly status = 403;
  readonly code = "MFA_ENROLLMENT_REQUIRED";

  constructor() {
    super("Two-factor authentication must be enabled to access the Vault");
    this.name = "MfaEnrollmentRequiredError";
  }
}

/**
 * Vault requires MFA: users without any MFA method enrolled must enable 2FA
 * first; enrolled users must have a valid step-up for this session.
 */
export async function requireMfaStepUp(
  request: Request,
  userId: string,
): Promise<void> {
  if (!(await userHasMfaEnabled(userId))) {
    throw new MfaEnrollmentRequiredError();
  }
  if (!hasValidStepUp(request, userId)) {
    throw new MfaStepUpRequiredError();
  }
}
