/** Authenticated-user profile, statistics, and e-mail preferences. */

import { withQuery, type HttpClient } from "./http.js";
import type {
  AuthenticatedUser,
  DocumentStatsQuery,
  DocumentStatsRow,
  NotificationPreferences,
  UpdateNotificationPreferences,
} from "./types.js";

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
  getStats(query: DocumentStatsQuery = {}): Promise<DocumentStatsRow[]> {
    return this.http.get<DocumentStatsRow[]>(withQuery("/users/self/stats", query));
  }

  /** `GET /users/self/notification-preferences` — return all nine boolean settings. */
  getNotificationPreferences(): Promise<NotificationPreferences> {
    return this.http.get<NotificationPreferences>("/users/self/notification-preferences");
  }

  /**
   * `PUT /users/self/notification-preferences` — merge one or more settings;
   * omitted keys retain their current value. Returns the complete updated map.
   */
  updateNotificationPreferences(
    preferences: UpdateNotificationPreferences,
  ): Promise<NotificationPreferences> {
    return this.http.put<NotificationPreferences>(
      "/users/self/notification-preferences",
      preferences,
    );
  }
}
