/**
 * Webhook subscription and delivery-history resource.
 *
 * These endpoints manage the account-level webhook destination, inspect the
 * supported event catalog, list delivery attempts, and retry a failed dispatch.
 *
 * @see https://api.assinafy.com.br/v1/docs
 */

import { withQuery, type HttpClient } from "./http.js";
import type {
  ListWebhookDispatchesQuery,
  Page,
  WebhookDispatch,
  WebhookEventTypeInfo,
  WebhookSubscription,
  WebhookSubscriptionInput,
} from "./types.js";

const paths = {
  subscription: (accountId: string) =>
    `/accounts/${encodeURIComponent(accountId)}/webhooks/subscriptions`,
  inactivate: (accountId: string) =>
    `/accounts/${encodeURIComponent(accountId)}/webhooks/inactivate`,
  eventTypes: () => "/webhooks/event-types",
  dispatches: (accountId: string) => `/accounts/${encodeURIComponent(accountId)}/webhooks`,
  retry: (accountId: string, dispatchId: string) =>
    `/accounts/${encodeURIComponent(accountId)}/webhooks/${encodeURIComponent(dispatchId)}/retry`,
};

/** Account-scoped webhook endpoints. */
export class WebhooksResource {
  constructor(private readonly http: HttpClient) {}

  /** Get the current webhook subscription, or `null` when none exists. */
  getSubscription(accountId: string): Promise<WebhookSubscription | null> {
    return this.http.get<WebhookSubscription | null>(paths.subscription(accountId));
  }

  /** Create or replace the current webhook subscription. */
  updateSubscription(accountId: string, input: WebhookSubscriptionInput): Promise<WebhookSubscription> {
    return this.http.put<WebhookSubscription>(paths.subscription(accountId), input);
  }

  /**
   * Inactivate the subscription without deleting its URL/event settings.
   *
   * The API does not expose a true DELETE for the subscription — inactivate is
   * the canonical way to stop deliveries.
   */
  inactivate(accountId: string): Promise<WebhookSubscription> {
    return this.http.put<WebhookSubscription>(paths.inactivate(accountId));
  }

  /** List event types supported by webhook subscriptions. */
  listEventTypes(): Promise<WebhookEventTypeInfo[]> {
    return this.http.get<WebhookEventTypeInfo[]>(paths.eventTypes());
  }

  /** List webhook delivery attempts for an account. */
  listDispatches(accountId: string, query: ListWebhookDispatchesQuery = {}): Promise<Page<WebhookDispatch>> {
    return this.http.getPage<WebhookDispatch>(
      withQuery(paths.dispatches(accountId), {
        event: query.event,
        delivered: query.delivered,
        from: query.from,
        to: query.to,
        page: query.page,
        "per-page": query.perPage,
      }),
    );
  }

  /** Retry a previous webhook delivery attempt. */
  retryDispatch(accountId: string, dispatchId: string): Promise<WebhookDispatch> {
    return this.http.post<WebhookDispatch>(paths.retry(accountId, dispatchId));
  }
}
