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
import { ConfigurationError } from "./errors.js";
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

  /** List endpoints, oldest first, optionally filtered by exact URL. Scope `account:read`. */
  async listEndpoints(accountId: string, query: { url?: string } = {}): Promise<WebhookEndpoint[]> {
    return this.http.get<WebhookEndpoint[]>(withQuery(paths.endpoints(accountId), { url: query.url }));
  }

  /**
   * Register an endpoint. Past the plan's limit (1, or 3 on paid plans) the API
   * answers `403`; a `url` another endpoint already uses answers `400`. With
   * `signing_enabled: true` a secret is generated and returned as `secret`.
   * Store it securely: OAuth cannot retrieve it later. Scope `webhooks:write`.
   */
  async createEndpoint(accountId: string, input: CreateWebhookEndpointInput): Promise<WebhookEndpoint> {
    return this.http.post<WebhookEndpoint>(paths.endpoints(accountId), endpointFields(input));
  }

  /** Get one endpoint. Scope `account:read`. */
  getEndpoint(accountId: string, endpointId: string): Promise<WebhookEndpoint> {
    return this.http.get<WebhookEndpoint>(paths.endpoint(accountId, endpointId));
  }

  /**
   * Change only the fields sent. Turning `signing_enabled` on keeps an
   * existing secret or creates one; turning it off discards the secret. A
   * request that turns signing on returns `secret`; store it securely.
   * Scope `webhooks:write`.
   */
  async updateEndpoint(
    accountId: string,
    endpointId: string,
    input: UpdateWebhookEndpointInput,
  ): Promise<WebhookEndpoint> {
    return this.http.put<WebhookEndpoint>(paths.endpoint(accountId, endpointId), endpointFields(input));
  }

  /** Delete an endpoint and free its slot. Scope `webhooks:write`. */
  async deleteEndpoint(accountId: string, endpointId: string): Promise<void> {
    await this.http.delete<unknown>(paths.endpoint(accountId, endpointId));
  }

  /**
   * `DELETE /accounts/{accountId}/webhooks/endpoints?url=...` — delete by the
   * exact registered URL and free its slot. Scope `webhooks:write`; `404`
   * when the workspace has no matching URL. Resolves on success.
   */
  async deleteEndpointByUrl(accountId: string, url: string): Promise<void> {
    if (typeof url !== "string" || !url.trim()) {
      throw new ConfigurationError("deleteEndpointByUrl requires the registered endpoint URL");
    }
    await this.http.delete<unknown>(withQuery(paths.endpoints(accountId), { url }));
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
   * disabled. Requires the `webhooks:write` OAuth scope when using OAuth.
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
  async updateSubscription(accountId: string, input: WebhookSubscriptionInput): Promise<WebhookSubscription> {
    const { events, is_active, url, email } = input;
    return this.http.put<WebhookSubscription>(paths.subscription(accountId), { events, is_active, url, email });
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

function endpointFields(input: UpdateWebhookEndpointInput): UpdateWebhookEndpointInput {
  const { url, email, events, name, is_active, signing_enabled } = input;
  return { url, email, events, name, is_active, signing_enabled };
}
