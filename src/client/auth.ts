/**
 * Authentication endpoints.
 *
 * Most apps will use a long-lived API key minted in the Assinafy dashboard
 * and pass it via `X-Api-Key`. These endpoints exist for full-stack apps
 * that need to manage user sessions or mint keys programmatically.
 *
 * @see https://api.assinafy.com.br/v1/docs
 */

import { HttpClient } from "./http.js";
import type {
  ApiKeyRecord,
  ChangePasswordInput,
  LinkSocialLoginInput,
  LoginInput,
  LoginResponse,
  RequestPasswordResetInput,
  ResetPasswordInput,
  SocialLoginInput,
} from "./types.js";

export class AuthResource {
  constructor(private readonly http: HttpClient) {}

  /** Email + password login. Returns a bearer access token. */
  login(input: LoginInput): Promise<LoginResponse> {
    return this.http.post<LoginResponse>("/login", input);
  }

  /** Sign in / register via a social provider (Google, Apple, …). */
  socialLogin(input: SocialLoginInput): Promise<LoginResponse> {
    return this.http.post<LoginResponse>("/authentication/social-login", input);
  }

  /** Link a social-login provider account to the authenticated user. */
  async linkSocialLogin(input: LinkSocialLoginInput): Promise<void> {
    await this.http.post<unknown>("/auth/link-social-login", input);
  }

  /** Mint a new API key. Requires the current password to confirm. */
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
  async changePassword(input: ChangePasswordInput): Promise<void> {
    await this.http.put<unknown>("/authentication/change-password", input);
  }

  /** Trigger a password-reset email. */
  async requestPasswordReset(input: RequestPasswordResetInput): Promise<void> {
    await this.http.put<unknown>("/authentication/request-password-reset", input);
  }

  /** Complete a password reset using the token from the reset email. */
  async resetPassword(input: ResetPasswordInput): Promise<void> {
    await this.http.put<unknown>("/authentication/reset-password", input);
  }
}
