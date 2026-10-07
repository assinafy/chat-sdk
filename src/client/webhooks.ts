/**
 * Webhook subscription and delivery-history resource.
 *
 * An account has 1 webhook endpoint, or up to 3 on paid plans. Each endpoint
 * has its own URL, events and optional Standard Webhooks signing secret
 * (verify deliveries with `verifyStandardWebhook`). The `subscription` and
 * `inactivate` operations act on the account's oldest endpoint.
 *
 * @see https://api.assinafy.com.br/v1/docs
 */

import { withQuery, type HttpClient } from "./http.js";
import { pageQuery } from "./internal.js";
import type {
  CreateWebhookEndpointInput,
  ListWebhookDispatchesQuery,
  Page,
  UpdateWebhookEndpointInput,
  WebhookDispatch,
  WebhookEndpoint,
  WebhookEndpointSecret,
  WebhookEventTypeInfo,
  WebhookSubscription,
  WebhookSubscriptionInput,
} from "./types.js";

const paths = {
  endpoints: (accountId: string) => `/accounts/${encodeURIComponent(accountId)}/webhooks/endpoints`,
  endpoint: (accountId: string, endpointId: string) =>
    `${paths.endpoints(accountId)}/${encodeURIComponent(endpointId)}`,
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

  /** List the account's webhook endpoints, oldest first. Scope `account:read`. */
  listEndpoints(accountId: string): Promise<WebhookEndpoint[]> {
    return this.http.get<WebhookEndpoint[]>(paths.endpoints(accountId));
  }

  /**
   * Register an endpoint. Past the plan's limit (1, or 3 on paid plans) the API
   * answers `403`; a `url` another endpoint already uses answers `400`. With
   * `signing_enabled: true` a secret is generated — read it with
   * {@link getEndpointSecret}. Scope `webhooks:write`.
   */
  createEndpoint(accountId: string, input: CreateWebhookEndpointInput): Promise<WebhookEndpoint> {
    return this.http.post<WebhookEndpoint>(paths.endpoints(accountId), input);
  }

  /** Get one endpoint. Scope `account:read`. */
  getEndpoint(accountId: string, endpointId: string): Promise<WebhookEndpoint> {
    return this.http.get<WebhookEndpoint>(paths.endpoint(accountId, endpointId));
  }

  /**
   * Change only the fields sent. Turning `signing_enabled` on keeps an
   * existing secret or creates one; turning it off discards the secret.
   * Scope `webhooks:write`.
   */
  updateEndpoint(
    accountId: string,
    endpointId: string,
    input: UpdateWebhookEndpointInput,
  ): Promise<WebhookEndpoint> {
    return this.http.put<WebhookEndpoint>(paths.endpoint(accountId, endpointId), input);
  }

  /** Delete an endpoint and free its slot. Scope `webhooks:write`. */
  async deleteEndpoint(accountId: string, endpointId: string): Promise<void> {
    await this.http.delete<unknown>(paths.endpoint(accountId, endpointId));
  }

  /**
   * Read the endpoint's signing secret (`whsec_…`). `400` when signing is
   * disabled. Not available to OAuth applications — use an API key.
   */
  getEndpointSecret(accountId: string, endpointId: string): Promise<WebhookEndpointSecret> {
    return this.http.get<WebhookEndpointSecret>(`${paths.endpoint(accountId, endpointId)}/secret`);
  }

  /**
   * Replace the signing secret. The old one stops working immediately, so
   * deploy the new secret to the receiver right away. `400` when signing is
   * disabled. Not available to OAuth applications.
   */
  rotateEndpointSecret(accountId: string, endpointId: string): Promise<WebhookEndpointSecret> {
    return this.http.post<WebhookEndpointSecret>(`${paths.endpoint(accountId, endpointId)}/secret/rotate`);
  }

  /**
   * Get the account's oldest webhook endpoint as a subscription, or `null`
   * when none exists. Prefer {@link listEndpoints} on multi-endpoint accounts.
   */
  getSubscription(accountId: string): Promise<WebhookSubscription | null> {
    return this.http.get<WebhookSubscription | null>(paths.subscription(accountId));
  }

  /** Update the account's oldest webhook endpoint, creating it when none exists. */
  updateSubscription(accountId: string, input: WebhookSubscriptionInput): Promise<WebhookSubscription> {
    return this.http.put<WebhookSubscription>(paths.subscription(accountId), input);
  }

  /**
   * Deactivate the account's oldest endpoint without deleting it; other
   * endpoints are unaffected. Use {@link deleteEndpoint} to remove one.
   */
  inactivate(accountId: string): Promise<WebhookSubscription> {
    return this.http.put<WebhookSubscription>(paths.inactivate(accountId));
  }

  /** List event types supported by webhook subscriptions. */
  listEventTypes(): Promise<WebhookEventTypeInfo[]> {
    return this.http.get<WebhookEventTypeInfo[]>(paths.eventTypes());
  }

  /** List webhook delivery attempts for an account. */
  async listDispatches(accountId: string, query: ListWebhookDispatchesQuery = {}): Promise<Page<WebhookDispatch>> {
    return this.http.getPage<WebhookDispatch>(
      withQuery(paths.dispatches(accountId), {
        endpoint_id: query.endpoint_id,
        event: query.event,
        delivered: query.delivered,
        from: query.from,
        to: query.to,
        ...pageQuery(query.page, query.perPage),
      }),
    );
  }

  /** Retry a previous webhook delivery attempt. */
  retryDispatch(accountId: string, dispatchId: string): Promise<WebhookDispatch> {
    return this.http.post<WebhookDispatch>(paths.retry(accountId, dispatchId));
  }
}
