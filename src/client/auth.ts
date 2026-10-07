/**
 * Authentication endpoints.
 *
 * Most apps will use a long-lived API key minted in the Assinafy dashboard
 * and pass it via `X-Api-Key`. These endpoints exist for full-stack apps
 * that need to manage user sessions or mint keys programmatically.
 *
 * @see https://api.assinafy.com.br/v1/docs
 */

import type { HttpClient } from "./http.js";
import type {
  ApiKeyRecord,
  ChangePasswordInput,
  ConfirmTotpInput,
  EmailResult,
  LinkSocialLoginInput,
  LoginInput,
  LoginResponse,
  MfaChallenge,
  MfaMethods,
  MfaReauthInput,
  RecoveryCodes,
  RequestPasswordResetInput,
  ResetPasswordInput,
  SocialLoginInput,
  TotpEnrollment,
  VerifyMfaInput,
} from "./types.js";

export class AuthResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Email + password login. Returns a bearer access token, or an
   * {@link MfaChallenge} when the user has two-factor authentication — check
   * `"mfa_token" in result` and finish with {@link verifyMfa}.
   */
  login(input: LoginInput): Promise<LoginResponse | MfaChallenge> {
    return this.http.post<LoginResponse | MfaChallenge>("/login", input);
  }

  /**
   * Complete a two-factor login with an authenticator or recovery code. The
   * challenge is single-use and expires five minutes after login.
   */
  verifyMfa(input: VerifyMfaInput): Promise<LoginResponse> {
    return this.http.post<LoginResponse>("/authentication/mfa/verify", input);
  }

  /** Sign in or register with a Google identity token. */
  socialLogin(input: SocialLoginInput): Promise<LoginResponse> {
    return this.http.post<LoginResponse>("/authentication/social-login", input);
  }

  /** Link a social-login provider account to the authenticated user. */
  async linkSocialLogin(input: LinkSocialLoginInput): Promise<void> {
    await this.http.post<unknown>("/auth/link-social-login", input);
  }

  /**
   * Generate an API key after password confirmation. Creating one deletes and
   * replaces the user's previous key. API keys are server-side credentials and
   * must not be exposed by front-end applications.
   */
  createApiKey(password: string): Promise<ApiKeyRecord> {
    return this.http.post<ApiKeyRecord>("/users/api-keys", { password });
  }

  /** Retrieve the current masked API key, or `null` when none exists. */
  getApiKey(): Promise<ApiKeyRecord | null> {
    return this.http.get<ApiKeyRecord | null>("/users/api-keys");
  }

  /**
   * Retrieve the current masked API key as a one-item array.
   *
   * @deprecated The API exposes a single API key. Use {@link getApiKey}.
   */
  async listApiKeys(): Promise<ApiKeyRecord[]> {
    const key = await this.getApiKey();
    return key ? [key] : [];
  }

  /** Delete the current API key. */
  async deleteApiKey(): Promise<void> {
    await this.http.delete<unknown>("/users/api-keys");
  }

  /** @deprecated Use {@link deleteApiKey}. */
  async revokeApiKeys(): Promise<void> {
    await this.deleteApiKey();
  }

  /** Change the current user's password. */
  changePassword(input: ChangePasswordInput): Promise<EmailResult> {
    return this.http.put<EmailResult>("/authentication/change-password", input);
  }

  /** Trigger a password-reset email. */
  requestPasswordReset(input: RequestPasswordResetInput): Promise<EmailResult> {
    return this.http.put<EmailResult>("/authentication/request-password-reset", input);
  }

  /** Complete a password reset using the token from the reset email. */
  resetPassword(input: ResetPasswordInput): Promise<EmailResult> {
    return this.http.put<EmailResult>("/authentication/reset-password", input);
  }

  /** `GET /users/self/mfa` — enrolled two-factor methods and unused recovery-code count. */
  listMfaMethods(): Promise<MfaMethods> {
    return this.http.get<MfaMethods>("/users/self/mfa");
  }

  /**
   * `POST /users/self/mfa/totp` — start authenticator enrollment. The secret is
   * returned only here; two-factor stays off until {@link confirmTotp}.
   */
  startTotp(label?: string): Promise<TotpEnrollment> {
    return this.http.post<TotpEnrollment>("/users/self/mfa/totp", label === undefined ? {} : { label });
  }

  /**
   * `PUT /users/self/mfa/totp/confirm` — activate the enrollment and receive
   * recovery codes (shown once). Replacing a confirmed method also requires
   * `password` or `reauth_code`.
   */
  confirmTotp(input: ConfirmTotpInput): Promise<RecoveryCodes> {
    return this.http.put<RecoveryCodes>("/users/self/mfa/totp/confirm", input);
  }

  /** `POST /users/self/mfa/recovery-codes` — issue ten new codes, invalidating the old set. */
  regenerateRecoveryCodes(proof: MfaReauthInput): Promise<RecoveryCodes> {
    return this.http.post<RecoveryCodes>("/users/self/mfa/recovery-codes", proof);
  }

  /**
   * `DELETE /users/self/mfa/{methodId}` — remove a method. Removing the last
   * one also discards the recovery codes.
   */
  async deleteMfaMethod(methodId: string, proof: MfaReauthInput): Promise<{ is_mfa_enabled: boolean }> {
    const res = await this.http.request<{ is_mfa_enabled: boolean }>(
      `/users/self/mfa/${encodeURIComponent(methodId)}`,
      { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify(proof) },
    );
    return res.data;
  }
}
