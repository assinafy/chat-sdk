/** Authenticated-user profile, statistics, and e-mail preferences. */

import { withQuery, type HttpClient } from "./http.js";
import type {
  AuthenticatedUser,
  DocumentStatsQuery,
  DocumentStatsRow,
  NotificationPreferences,
  UpdateNotificationPreferences,
} from "./types.js";

/** The authenticated user's profile, statistics and notification preferences (`client.users`). */
export class UsersResource {
  constructor(private readonly http: HttpClient) {}

  /** `GET /users/self` — return the authenticated user's complete profile. */
  async getCurrent(): Promise<AuthenticatedUser> {
    const result = await this.http.get<AuthenticatedUser | { user: AuthenticatedUser }>("/users/self");
    return "user" in result ? result.user : result;
  }

  /**
   * `GET /users/self/stats` — return zero-filled document KPIs across every
   * account. Omit the query for 12 monthly rows; daily requires `month`.
   */
  async getStats(query: DocumentStatsQuery = {}): Promise<DocumentStatsRow[]> {
    const { granularity, month } = query;
    return this.http.get<DocumentStatsRow[]>(withQuery("/users/self/stats", { granularity, month }));
  }

  /** `GET /users/self/notification-preferences` — return all thirteen boolean settings. */
  getNotificationPreferences(): Promise<NotificationPreferences> {
    return this.http.get<NotificationPreferences>("/users/self/notification-preferences");
  }

  /**
   * `PUT /users/self/notification-preferences` — merge one or more settings;
   * omitted keys retain their current value. Returns the complete updated map.
   */
  async updateNotificationPreferences(
    preferences: UpdateNotificationPreferences,
  ): Promise<NotificationPreferences> {
    const {
      DocumentCompleted, SignerDeclined, DocumentCancelled, DocumentAboutToExpire,
      DocumentExpired, DocumentExpirationReset, DocumentProcessingFailed,
      TemplateProcessingFailed, SignerWhatsappFailed, ContractRenewalNotice,
      ContractExpiring, ContractExpired, ContractRenewed,
    } = preferences;
    return this.http.put<NotificationPreferences>("/users/self/notification-preferences", {
      DocumentCompleted, SignerDeclined, DocumentCancelled, DocumentAboutToExpire,
      DocumentExpired, DocumentExpirationReset, DocumentProcessingFailed,
      TemplateProcessingFailed, SignerWhatsappFailed, ContractRenewalNotice,
      ContractExpiring, ContractExpired, ContractRenewed,
    });
  }
}
