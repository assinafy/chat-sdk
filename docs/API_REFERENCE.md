# Assinafy Chat SDK API reference

This is the reference for the public surface of `@assinafy/chat-sdk`.
It is based on the production OpenAPI document downloaded from
[`https://api.assinafy.com.br/v1/docs/openapi.json`](https://api.assinafy.com.br/v1/docs/openapi.json)
on 2026-08-20 (SHA-256
`44da834c27173a3739d491fdacbb48decf9a170bd776a1c4edb4d0d4b108c22f`).
The complete 89-operation REST inventory is in [API coverage](./API_COVERAGE.md).

The client exposes 96 resource methods: one for each of the 89 documented REST
operations, plus seven clearly labeled convenience or compatibility methods.

## Runtime and imports

Use Node.js 24 LTS for server applications and the examples in this repository.
The focused client entry point is also suitable for modern browser runtimes that
provide `fetch`, `Blob`, `FormData`, `Headers`, `Response`, and `URLSearchParams`:

```ts
import { AssinafyClient, ApiError } from "@assinafy/chat-sdk/client";

const client = new AssinafyClient({
  apiKey: process.env.ASSINAFY_API_KEY,
  accountId: process.env.ASSINAFY_ACCOUNT_ID,
  baseUrl: "https://sandbox.assinafy.com.br/v1",
});
```

The package root also exports chat, card, adapter, state, and client primitives,
but imports Node's cryptography module for webhook verification. Browser bundles
that only need the REST client should import `@assinafy/chat-sdk/client`.

## Conventions

### Authentication labels

| Label | Wire credential |
| --- | --- |
| `account` | Either `X-Api-Key: …` or `Authorization: Bearer …`, as declared by the operation |
| `bearer` | `Authorization: Bearer …`; the API needs a logged-in user's context |
| `signer code` | `signer-access-code=…` query parameter; do not log or persist the URL |
| `public` | No API credential |

`AssinafyClient` sends one configured account credential. Passing both `apiKey`
and `accessToken` throws `ConfigurationError`. Public and signer-code methods may
be called with an unauthenticated client.

### Unwrapped JSON, pagination, raw responses, and `void`

For JSON endpoints, the transport removes the server envelope:

```json
{
  "status": 200,
  "message": "Success",
  "data": { "id": "resource-id" }
}
```

The method returns only `{ "id": "resource-id" }`; a valid envelope with no
`data` resolves `undefined`. Paginated methods return the following SDK object,
assembled from the unwrapped array and `X-Pagination-*` headers:

```json
{
  "data": [{ "id": "resource-id" }],
  "pagination": {
    "currentPage": 1,
    "pageCount": 1,
    "perPage": 20,
    "totalCount": 1
  }
}
```

Download methods return the native `Response` without parsing its body:

```ts
const response = await client.documents.download(documentId, "certificated");
const bytes = new Uint8Array(await response.arrayBuffer());
```

The body is unparsed, but transport behavior is unchanged: a non-2xx download
throws `ApiError` before a `Response` is returned.

Document artifact names have canonical completions `original`, `certificated`,
`certificate-page`, `pades`, and `bundle`; the type remains forward-compatible
with new server-defined strings. Thumbnails and individual pages have dedicated
methods.

Methods documented as `void` consume a successful response and resolve with
`undefined`, regardless of whether the server used `200`, `202`, or `204`.

### Errors, retries, and metadata

Every non-2xx response throws `ApiError`. Its public fields are `status`, `body`,
`path`, and `method`; signer access codes in `path` are redacted. Network errors,
`408`, `425`, `429`, and selected `5xx` responses may be retried according to
`maxRetries` and `retryBaseDelayMs`, but only for safe `GET`, `HEAD`, and
`OPTIONS` requests. Mutating requests are never retried by the transport. Use
`onRateLimit` to receive parsed `X-Rate-Limit-*` metadata.

```ts
try {
  await client.documents.remove(documentId);
} catch (error) {
  if (error instanceof ApiError) {
    console.error(error.status, error.method, error.path, error.body);
  }
  throw error;
}
```

| Error class | Added fields / use |
| --- | --- |
| `AssinafyError` | Base class for SDK-defined errors |
| `ConfigurationError` | Invalid client URL, credential combination, or transport configuration |
| `ApiError` | `status`, parsed `body`, redacted `path`, and uppercase `method` |
| `NotImplementedError` | Unsupported adapter `adapter` and `operation` |
| `WebhookSignatureError` | Invalid or stale webhook signature |

For a typical API failure, `ApiError.body` preserves the server's complete error
envelope rather than unwrapping it:

```json
{
  "status": 400,
  "message": "The request payload is invalid",
  "data": null
}
```

Non-JSON error bodies are exposed as text; an unreadable body is `undefined`.

## Resource method index

Each row links its request and unwrapped SDK response to a complete representative
payload below. “Path/query only” means there is no HTTP request body. Identifiers
such as `accountId`, `documentId`, `assignmentId`, `signerId`, and `fieldId` are
method arguments substituted into the displayed path.

All resource classes are exported for advanced composition and accept a single
`HttpClient` constructor argument. Most applications should use the instances
created by `AssinafyClient`.

### Accounts

| SDK method | HTTP operation | Auth | Request | Unwrapped SDK response |
| --- | --- | --- | --- | --- |
| <a id="accounts-list"></a>`accounts.list()` | `GET /accounts` | account | path/query only | [`Account[]`](#account-response) |
| <a id="accounts-create"></a>`accounts.create(input)` | `POST /accounts` | account | [`CreateAccountInput`](#create-account-request) | [`Account`](#account-response) |
| <a id="accounts-get"></a>`accounts.get(accountId)` | `GET /accounts/{accountId}` | account | path/query only | [`Account`](#account-response) |
| <a id="accounts-update"></a>`accounts.update(accountId, input)` | `PUT /accounts/{accountId}` | account | [`UpdateAccountInput`](#update-account-request) | [`Account`](#account-response) |
| <a id="accounts-remove"></a>`accounts.remove(accountId, options?)` | `DELETE /accounts/{accountId}` | account | [`DeleteAccountInput`](#delete-account-request) | [`void`](#unwrapped-json-pagination-raw-responses-and-void) |
| <a id="accounts-get-theme"></a>`accounts.getTheme(accountId)` | `GET /accounts/{accountId}/theme` | account | path/query only | [`AccountTheme`](#account-theme-response) |
| <a id="accounts-get-stats"></a>`accounts.getStats(accountId, query?)` | `GET /accounts/{accountId}/stats` | account | [`DocumentStatsQuery`](#document-stats-query) | [`DocumentStatsRow[]`](#document-stats-response) |
| <a id="accounts-download-logo"></a>`accounts.downloadLogo(accountId)` | `GET /accounts/{accountId}/logo` | account | path/query only | native [`Response`](#unwrapped-json-pagination-raw-responses-and-void) |
| <a id="accounts-upload-logo"></a>`accounts.uploadLogo(accountId, input)` | `POST /accounts/{accountId}/logo` | account | [`multipart/form-data`](#logo-upload-request) | [`void`](#unwrapped-json-pagination-raw-responses-and-void) |
| <a id="accounts-delete-logo"></a>`accounts.deleteLogo(accountId)` | `DELETE /accounts/{accountId}/logo` | account | path/query only | [`void`](#unwrapped-json-pagination-raw-responses-and-void) |

### Authentication

| SDK method | HTTP operation | Auth | Request | Unwrapped SDK response |
| --- | --- | --- | --- | --- |
| <a id="auth-login"></a>`auth.login(input)` | `POST /login` | public | [`LoginInput`](#login-request) | [`LoginResponse`](#login-response) |
| <a id="auth-social-login"></a>`auth.socialLogin(input)` | `POST /authentication/social-login` | public | [`SocialLoginInput`](#social-login-request) | [`LoginResponse`](#login-response) |
| <a id="auth-link-social-login"></a>`auth.linkSocialLogin(input)` | `POST /auth/link-social-login` | account | [`LinkSocialLoginInput`](#link-social-login-request) | [`void`](#unwrapped-json-pagination-raw-responses-and-void) |
| <a id="auth-create-api-key"></a>`auth.createApiKey(password)` | `POST /users/api-keys` | account | [`{ password }`](#api-key-create-request) | [`ApiKeyRecord`](#api-key-response) |
| <a id="auth-get-api-key"></a>`auth.getApiKey()` | `GET /users/api-keys` | account | path/query only | [`ApiKeyRecord \| null`](#api-key-response) |
| <a id="auth-list-api-keys"></a>`auth.listApiKeys()` | SDK convenience over `GET /users/api-keys` | account | path/query only | [`ApiKeyRecord[]`](#api-key-response) |
| <a id="auth-delete-api-key"></a>`auth.deleteApiKey()` | `DELETE /users/api-keys` | account | path/query only | [`void`](#unwrapped-json-pagination-raw-responses-and-void) |
| <a id="auth-revoke-api-keys"></a>`auth.revokeApiKeys()` | deprecated alias of `deleteApiKey()` | account | path/query only | [`void`](#unwrapped-json-pagination-raw-responses-and-void) |
| <a id="auth-change-password"></a>`auth.changePassword(input)` | `PUT /authentication/change-password` | account | [`ChangePasswordInput`](#change-password-request) | [`EmailResult`](#email-result-response) |
| <a id="auth-request-password-reset"></a>`auth.requestPasswordReset(input)` | `PUT /authentication/request-password-reset` | public | [`RequestPasswordResetInput`](#password-reset-requests) | [`EmailResult`](#email-result-response) |
| <a id="auth-reset-password"></a>`auth.resetPassword(input)` | `PUT /authentication/reset-password` | public | [`ResetPasswordInput`](#password-reset-requests) | [`EmailResult`](#email-result-response) |

The production provider enum currently contains only `google`. Do not send
`apple` unless a target deployment explicitly documents support for it.

### Users

| SDK method | HTTP operation | Auth | Request | Unwrapped SDK response |
| --- | --- | --- | --- | --- |
| <a id="users-get-current"></a>`users.getCurrent()` | `GET /users/self` | account | path/query only | [`AuthenticatedUser`](#authenticated-user-response) |
| <a id="users-get-stats"></a>`users.getStats(query?)` | `GET /users/self/stats` | account | [`DocumentStatsQuery`](#document-stats-query) | [`DocumentStatsRow[]`](#document-stats-response) |
| <a id="users-get-notification-preferences"></a>`users.getNotificationPreferences()` | `GET /users/self/notification-preferences` | account | path/query only | [`NotificationPreferences`](#notification-preferences) |
| <a id="users-update-notification-preferences"></a>`users.updateNotificationPreferences(preferences)` | `PUT /users/self/notification-preferences` | account | [`UpdateNotificationPreferences`](#notification-preferences) | [`NotificationPreferences`](#notification-preferences) |

### Signers

| SDK method | HTTP operation | Auth | Request | Unwrapped SDK response |
| --- | --- | --- | --- | --- |
| <a id="signers-list"></a>`signers.list(accountId, query?)` | `GET /accounts/{accountId}/signers` | account | [`ListSignersQuery`](#signer-list-query) | [`Page<Signer>`](#signer-response) |
| <a id="signers-iterate"></a>`signers.iterate(accountId, query?)` | SDK paginator over signer list | account | [`ListSignersQuery`](#signer-list-query) | `AsyncIterableIterator<Signer>`; each item is [`Signer`](#signer-response) |
| <a id="signers-create"></a>`signers.create(accountId, input)` | `POST /accounts/{accountId}/signers` | account | [`CreateSignerInput`](#create-signer-request) | [`Signer`](#signer-response) |
| <a id="signers-get"></a>`signers.get(accountId, signerId)` | `GET /accounts/{accountId}/signers/{signerId}` | account | path/query only | [`Signer`](#signer-response) |
| <a id="signers-update"></a>`signers.update(accountId, signerId, input)` | `PUT /accounts/{accountId}/signers/{signerId}` | account | [`UpdateSignerInput`](#update-signer-request) | [`Signer`](#signer-response) |
| <a id="signers-remove"></a>`signers.remove(accountId, signerId)` | `DELETE /accounts/{accountId}/signers/{signerId}` | account | path/query only | [`void`](#unwrapped-json-pagination-raw-responses-and-void) |
| <a id="signers-confirm-data-for-document"></a>`signers.confirmDataForDocument(documentId, accessCode, input)` | `PUT /documents/{documentId}/signers/confirm-data` | signer code | [`SignerSelfConfirmDataInput`](#confirm-signer-data-request) | [`Signer`](#signer-response) |

### Documents

| SDK method | HTTP operation | Auth | Request | Unwrapped SDK response |
| --- | --- | --- | --- | --- |
| <a id="documents-statuses"></a>`documents.statuses()` | `GET /documents/statuses` | account | path/query only | [`DocumentStatus[]`](#document-status-response) |
| <a id="documents-list"></a>`documents.list(accountId, query?)` | `GET /accounts/{accountId}/documents` | account | [`ListDocumentsQuery`](#document-list-query) | [`Page<Document>`](#document-response) |
| <a id="documents-search"></a>`documents.search(accountId, query?)` | `GET /accounts/{accountId}/documents/search` | account | [`SearchDocumentsQuery`](#document-search-query) | [`Page<Document>`](#document-response) |
| <a id="documents-iterate"></a>`documents.iterate(accountId, query?)` | SDK paginator over document list | account | [`ListDocumentsQuery`](#document-list-query) | `AsyncIterableIterator<Document>`; each item is [`Document`](#document-response) |
| <a id="documents-upload"></a>`documents.upload(accountId, input)` | `POST /accounts/{accountId}/documents` | account | [`multipart/form-data`](#document-upload-request) | [`Document`](#document-response) |
| <a id="documents-get"></a>`documents.get(documentId)` | `GET /documents/{documentId}` | account | path/query only | [`Document`](#document-response) |
| <a id="documents-rename"></a>`documents.rename(documentId, name)` | `PATCH /documents/{documentId}` | account | [`{ name }`](#rename-document-request) | [`Document`](#document-response) |
| <a id="documents-remove"></a>`documents.remove(documentId)` | `DELETE /documents/{documentId}` | account | path/query only | [`void`](#unwrapped-json-pagination-raw-responses-and-void) |
| <a id="documents-download"></a>`documents.download(documentId, artifactName)` | `GET /documents/{documentId}/download/{artifactName}` | account | path/query only | native [`Response`](#unwrapped-json-pagination-raw-responses-and-void) |
| <a id="documents-thumbnail"></a>`documents.thumbnail(documentId)` | `GET /documents/{documentId}/thumbnail` | account | path/query only | native [`Response`](#unwrapped-json-pagination-raw-responses-and-void) |
| <a id="documents-download-page"></a>`documents.downloadPage(documentId, pageId)` | `GET /documents/{documentId}/pages/{pageId}/download` | account | path/query only | native [`Response`](#unwrapped-json-pagination-raw-responses-and-void) |
| <a id="documents-activities"></a>`documents.activities(documentId)` | `GET /documents/{documentId}/activities` | account | path/query only | [`DocumentActivity[]`](#document-activity-response) |
| <a id="documents-verify"></a>`documents.verify(signatureHash)` | `GET /documents/{documentSignatureHash}/verify` | public | path/query only | [`DocumentVerificationResult`](#document-verification-response) |
| <a id="documents-public-get"></a>`documents.publicGet(documentId)` | `GET /public/documents/{documentId}` | public | path/query only | production [`Document`](#document-response); compatibility [`PublicDocument`](#public-document-compatibility-response) |
| <a id="documents-send-public-token"></a>`documents.sendPublicToken(documentId, input)` | `PUT /public/documents/{documentId}/send-token` | public | canonical [`{ email }`](#send-public-token-request) | [`SendPublicTokenResult \| undefined`](#send-public-token-response) |

### Tags

Document-tag operations take tag **IDs**, not tag names.

| SDK method | HTTP operation | Auth | Request | Unwrapped SDK response |
| --- | --- | --- | --- | --- |
| <a id="tags-list"></a>`tags.list(accountId, query?)` | `GET /accounts/{accountId}/tags` | account | [`ListTagsQuery`](#tag-list-query) | [`Page<Tag>`](#tag-response) |
| <a id="tags-create"></a>`tags.create(accountId, input)` | `POST /accounts/{accountId}/tags` | account | [`CreateTagInput`](#create-tag-request) | [`Tag`](#tag-response) |
| <a id="tags-update"></a>`tags.update(accountId, tagId, input)` | `PUT /accounts/{accountId}/tags/{tagId}` | account | [`UpdateTagInput`](#update-tag-request) | [`Tag`](#tag-response) |
| <a id="tags-remove"></a>`tags.remove(accountId, tagId, options?)` | `DELETE /accounts/{accountId}/tags/{tagId}` | account | query [`force`](#delete-tag-request) | [`DeleteTagResult`](#tag-mutation-responses) |
| <a id="tags-list-for-document"></a>`tags.listForDocument(accountId, documentId)` | `GET /accounts/{accountId}/documents/{documentId}/tags` | account | path/query only | [`Tag[]`](#tag-response) |
| <a id="tags-set-for-document"></a>`tags.setForDocument(accountId, documentId, tagIds)` | `PUT /accounts/{accountId}/documents/{documentId}/tags` | account | [`{ tags: tagIds }`](#document-tags-request) | [`Tag[]`](#tag-response) |
| <a id="tags-add-to-document"></a>`tags.addToDocument(accountId, documentId, tagIds)` | `POST /accounts/{accountId}/documents/{documentId}/tags` | account | [`{ tags: tagIds }`](#document-tags-request) | [`Tag[]`](#tag-response) |
| <a id="tags-remove-from-document"></a>`tags.removeFromDocument(accountId, documentId, tagId)` | `DELETE /accounts/{accountId}/documents/{documentId}/tags/{tagId}` | account | path/query only | [`DetachTagResult`](#tag-mutation-responses) |

### Templates

| SDK method | HTTP operation | Auth | Request | Unwrapped SDK response |
| --- | --- | --- | --- | --- |
| <a id="templates-list"></a>`templates.list(accountId, query?)` | `GET /accounts/{accountId}/templates` | account | [`ListTemplatesQuery`](#template-list-query) | [`Page<Template>`](#template-response) |
| <a id="templates-get"></a>`templates.get(accountId, templateId)` | live compatibility route; absent from current OpenAPI | account | path/query only | [`Template`](#template-response) |
| <a id="templates-instantiate"></a>`templates.instantiate(accountId, templateId, input)` | `POST /accounts/{accountId}/templates/{templateId}/documents` | account | [`CreateDocumentFromTemplateInput`](#instantiate-template-request) | [`Document`](#document-response) |
| <a id="templates-estimate-cost"></a>`templates.estimateCost(accountId, templateId, input)` | `POST /accounts/{accountId}/templates/{templateId}/documents/estimate-cost` | account | [`{ signers }`](#estimate-template-cost-request) | [`CostEstimate`](#cost-estimate-response) |

### Assignments

| SDK method | HTTP operation | Auth | Request | Unwrapped SDK response |
| --- | --- | --- | --- | --- |
| <a id="assignments-list"></a>`assignments.list(query?)` | `GET /assignments` | account in OpenAPI; see [sandbox note](#verified-sandbox-differences) | [`ListAssignmentsQuery`](#assignment-list-query) | [`Page<Assignment>`](#assignment-response) |
| <a id="assignments-create"></a>`assignments.create(documentId, input)` | `POST /documents/{documentId}/assignments` | account | [`CreateAssignmentInput`](#create-assignment-request) | [`Assignment`](#assignment-response) |
| <a id="assignments-estimate-cost"></a>`assignments.estimateCost(documentId, input)` | `POST /documents/{documentId}/assignments/estimate-cost` | account | [`EstimateAssignmentCostInput`](#estimate-assignment-cost-request) | [`CostEstimate`](#cost-estimate-response) |
| <a id="assignments-resend-to-signer"></a>`assignments.resendToSigner(documentId, assignmentId, signerId)` | `PUT /documents/{documentId}/assignments/{assignmentId}/signers/{signerId}/resend` | account | path/query only | [`ResendNotificationResult`](#resend-response) |
| <a id="assignments-estimate-resend-cost"></a>`assignments.estimateResendCost(documentId, assignmentId, signerId)` | `POST /documents/{documentId}/assignments/{assignmentId}/signers/{signerId}/estimate-resend-cost` | account | path/query only | [`CostEstimate`](#cost-estimate-response) |
| <a id="assignments-reset-expiration"></a>`assignments.resetExpiration(documentId, assignmentId, expiresAt)` | `PUT /documents/{documentId}/assignments/{assignmentId}/reset-expiration` | account | [`{ expires_at }`](#reset-expiration-request) | [`Assignment`](#assignment-response) |
| <a id="assignments-sign"></a>`assignments.sign(documentId, assignmentId, accessCode, entries)` | compatibility alias of `signature.sign()` | signer code | [`SignFieldEntry[]`](#sign-assignment-request) | [`void`](#unwrapped-json-pagination-raw-responses-and-void) |
| <a id="assignments-decline"></a>`assignments.decline(documentId, assignmentId, accessCode, declineReason)` | compatibility alias of `signature.decline()` | signer code | [`{ decline_reason }`](#decline-request) | [`void`](#unwrapped-json-pagination-raw-responses-and-void) |
| <a id="assignments-whatsapp-notifications"></a>`assignments.whatsappNotifications(documentId, assignmentId)` | `GET /documents/{documentId}/assignments/{assignmentId}/whatsapp-notifications` | account | path/query only | [`WhatsAppNotification[]`](#whatsapp-notification-response) |

### Fields

| SDK method | HTTP operation | Auth | Request | Unwrapped SDK response |
| --- | --- | --- | --- | --- |
| <a id="fields-create"></a>`fields.create(accountId, input)` | `POST /accounts/{accountId}/fields` | account | [`CreateFieldInput`](#create-field-request) | [`FieldDefinition`](#field-response) |
| <a id="fields-list"></a>`fields.list(accountId, query?)` | `GET /accounts/{accountId}/fields` | account | [`ListFieldsQuery`](#field-list-query) | [`Page<FieldDefinition>`](#field-response) |
| <a id="fields-get"></a>`fields.get(accountId, fieldId)` | `GET /accounts/{accountId}/fields/{fieldId}` | account | path/query only | [`FieldDefinition`](#field-response) |
| <a id="fields-update"></a>`fields.update(accountId, fieldId, input)` | `PUT /accounts/{accountId}/fields/{fieldId}` | account | [`UpdateFieldInput`](#update-field-request) | [`FieldDefinition`](#field-response) |
| <a id="fields-remove"></a>`fields.remove(accountId, fieldId)` | `DELETE /accounts/{accountId}/fields/{fieldId}` | account | path/query only | [`void`](#unwrapped-json-pagination-raw-responses-and-void) |
| <a id="fields-validate"></a>`fields.validate(accountId, fieldId, value, options?)` | `POST /accounts/{accountId}/fields/{fieldId}/validate` | account; optional signer code extension | [`{ value }`](#validate-field-request) | [`FieldValidationResult`](#field-validation-response) |
| <a id="fields-validate-multiple"></a>`fields.validateMultiple(accountId, entries, options?)` | `POST /accounts/{accountId}/fields/validate-multiple` | account; optional signer code extension | [`ValidateFieldEntry[]`](#validate-multiple-fields-request) | [`FieldValidationResult[]`](#field-validation-response) |
| <a id="fields-list-types"></a>`fields.listTypes()` | `GET /field-types` | account | path/query only | [`FieldType[]`](#field-type-response) |

### Signer-facing signature flow

All signer-code examples use a placeholder. Treat the real value as a secret.

| SDK method | HTTP operation | Auth | Request | Unwrapped SDK response |
| --- | --- | --- | --- | --- |
| <a id="signature-self"></a>`signature.self(accessCode)` | `GET /signers/self` | signer code | path/query only | [`SignerSelf`](#signer-self-response) |
| <a id="signature-accept-terms"></a>`signature.acceptTerms(accessCode)` | `PUT /signers/accept-terms` | signer code | path/query only | [`void`](#unwrapped-json-pagination-raw-responses-and-void) |
| <a id="signature-verify"></a>`signature.verify(accessCode, verificationCode)` | `POST /verify` | signer code | [`verification-code`](#verify-otp-request) | [`void`](#unwrapped-json-pagination-raw-responses-and-void) |
| <a id="signature-upload"></a>`signature.upload(accessCode, type: SignatureType \| undefined, image, contentType?, reuse?)` | `POST /signature` | signer code | [raw image + query](#signature-upload-request) | [`void`](#unwrapped-json-pagination-raw-responses-and-void) |
| <a id="signature-download"></a>`signature.download(accessCode, type)` | `GET /signature/{signatureType}` | signer code | path/query only | native [`Response`](#unwrapped-json-pagination-raw-responses-and-void) |
| <a id="signature-sign-context"></a>`signature.signContext(accessCode, options?)` | `GET /sign` | signer code | [`has_accepted_terms`](#sign-context-query) | [`Document`](#document-response) |
| <a id="signature-current-document"></a>`signature.currentDocument(signerId, accessCode)` | `GET /signers/{signerId}/document` | signer code | path/query only | [`Document`](#document-response) |
| <a id="signature-list-documents"></a>`signature.listDocuments(signerId, accessCode, query?)` | `GET /signers/{signerId}/documents` | signer code | [`ListSignerDocumentsQuery`](#document-list-query) | [`Page<Document>`](#document-response) |
| <a id="signature-search-documents"></a>`signature.searchDocuments(signerId, accessCode, search?)` | `GET /signers/{signerId}/documents/search` | signer code | [`search`](#signer-document-search-query) | [`Page<Document>`](#document-response) |
| <a id="signature-sign"></a>`signature.sign(documentId, assignmentId, accessCode, entries)` | `POST /documents/{documentId}/assignments/{assignmentId}` | signer code | [`SignFieldEntry[]`](#sign-assignment-request) | [`void`](#unwrapped-json-pagination-raw-responses-and-void) |
| <a id="signature-decline"></a>`signature.decline(documentId, assignmentId, accessCode, declineReason)` | `PUT /documents/{documentId}/assignments/{assignmentId}/reject` | signer code | [`{ decline_reason }`](#decline-request) | [`void`](#unwrapped-json-pagination-raw-responses-and-void) |
| <a id="signature-sign-multiple"></a>`signature.signMultiple(accessCode, documentIds)` | `PUT /signers/documents/sign-multiple` | signer code | [`{ document_ids }`](#multiple-document-action-requests) | [`void`](#unwrapped-json-pagination-raw-responses-and-void) |
| <a id="signature-decline-multiple"></a>`signature.declineMultiple(accessCode, documentIds, declineReason)` | `PUT /signers/documents/decline-multiple` | signer code | [`{ document_ids, decline_reason }`](#multiple-document-action-requests) | [`void`](#unwrapped-json-pagination-raw-responses-and-void) |
| <a id="signature-download-document"></a>`signature.downloadDocument(signerId, documentId, artifactName, accessCode?)` | `GET /signers/{signerId}/documents/{documentId}/download/{artifactName}` | public; optional signer-code compatibility | path/query only | native [`Response`](#unwrapped-json-pagination-raw-responses-and-void) |

### Webhooks

| SDK method | HTTP operation | Auth | Request | Unwrapped SDK response |
| --- | --- | --- | --- | --- |
| <a id="webhooks-get-subscription"></a>`webhooks.getSubscription(accountId)` | `GET /accounts/{accountId}/webhooks/subscriptions` | account | path/query only | [`WebhookSubscription \| null`](#webhook-subscription-response) |
| <a id="webhooks-update-subscription"></a>`webhooks.updateSubscription(accountId, input)` | `PUT /accounts/{accountId}/webhooks/subscriptions` | account | [`WebhookSubscriptionInput`](#webhook-subscription-request) | [`WebhookSubscription`](#webhook-subscription-response) |
| <a id="webhooks-inactivate"></a>`webhooks.inactivate(accountId)` | `PUT /accounts/{accountId}/webhooks/inactivate` | account | path/query only | [`WebhookSubscription`](#webhook-subscription-response) |
| <a id="webhooks-list-event-types"></a>`webhooks.listEventTypes()` | `GET /webhooks/event-types` | account | path/query only | [`WebhookEventTypeInfo[]`](#webhook-event-type-response) |
| <a id="webhooks-list-dispatches"></a>`webhooks.listDispatches(accountId, query?)` | `GET /accounts/{accountId}/webhooks` | account | [`ListWebhookDispatchesQuery`](#webhook-dispatch-list-query) | [`Page<WebhookDispatch>`](#webhook-dispatch-response) |
| <a id="webhooks-retry-dispatch"></a>`webhooks.retryDispatch(accountId, dispatchId)` | `POST /accounts/{accountId}/webhooks/{historyId}/retry` | account | path/query only | [`WebhookDispatch`](#webhook-dispatch-response) |

## Request and response payloads

Examples use placeholder identifiers and secrets. Optional properties are shown
so consumers can see the complete SDK type; a deployment may omit optional
response properties rather than returning them as `null`.

### Account payloads

#### Create account request

```json
{
  "name": "Acme Brasil",
  "notification_sender_type": "Account"
}
```

`notification_sender_type` is optional and accepts `"User"` or `"Account"`.
The current sandbox rejects that optional field during account creation; see
[verified sandbox differences](#verified-sandbox-differences).

#### Update account request

```json
{
  "name": "Acme Brasil Ltda.",
  "notification_sender_type": "User"
}
```

Both fields are optional; send at least the field that should change.

#### Delete account request

```json
{
  "force": true
}
```

The body is omitted when `options.force` is `undefined`.

#### Account response

```json
{
  "resource": "account",
  "id": "acc_01J00000000000000000000000",
  "name": "Acme Brasil",
  "primary_color": "#164E63",
  "secondary_color": "#22D3EE",
  "notification_sender_type": "Account",
  "roles": ["Owner"],
  "is_delete_allowed": true,
  "created_at": "2026-08-20T14:30:00Z"
}
```

#### Account theme response

```json
{
  "account_name": "Acme Brasil",
  "primary_color": "#164E63",
  "secondary_color": "#22D3EE",
  "logo": "https://api.assinafy.com.br/files/account-logo.png"
}
```

Colors and `logo` may be `null`.

#### Document stats query

Monthly totals (the default):

```json
{
  "granularity": "monthly"
}
```

Daily totals for one month:

```json
{
  "granularity": "daily",
  "month": "2026-08"
}
```

The SDK encodes these as query parameters. A daily query requires `month` in
`YYYY-MM` form.

#### Document stats response

```json
[
  {
    "period": "2026-08",
    "documents_uploaded": 24,
    "documents_sent": 20,
    "signature_requests": 32,
    "signature_requests_email": 28,
    "signature_requests_whatsapp": 4,
    "signature_requests_viewed": 29,
    "signature_requests_completed": 26,
    "documents_certified": 17
  }
]
```

#### Logo upload request

Wire representation:

```text
Content-Type: multipart/form-data; boundary=generated-by-runtime

file: binary image bytes; filename="logo.png"; Content-Type=image/png
```

SDK input:

```ts
import { readFile } from "node:fs/promises";

await client.accounts.uploadLogo(accountId, {
  filename: "logo.png",
  body: await readFile("logo.png"),
  contentType: "image/png",
});
```

### Authentication and user payloads

#### Login request

```json
{
  "email": "owner@example.com",
  "password": "correct horse battery staple"
}
```

#### Social login request

```json
{
  "provider": "google",
  "token": "google-id-token",
  "has_accepted_terms": true
}
```

The SDK also types `token` as a provider-specific object for compatibility, but
the production schema's provider enum is currently `google`.

#### Link social login request

```json
{
  "provider": "google",
  "token": "google-id-token"
}
```

#### Login response

```json
{
  "access_token": "bearer-token",
  "user": {
    "id": "usr_01J00000000000000000000000",
    "name": "Aline Costa",
    "email": "owner@example.com",
    "telephone": "+5511999999999",
    "government_id": "12345678909",
    "is_email_verified": true,
    "has_accepted_terms": true,
    "created_at": "2026-08-20T14:30:00Z",
    "to_be_deleted_at": null
  },
  "accounts": [
    {
      "id": "acc_01J00000000000000000000000",
      "name": "Acme Brasil",
      "roles": ["Owner"],
      "is_delete_allowed": true,
      "created_at": "2026-08-20T14:30:00Z"
    }
  ],
  "expires_at": "2026-08-21T14:30:00Z"
}
```

`expires_at` is an older-deployment compatibility field and may be omitted.

#### API key create request

```json
{
  "password": "current-account-password"
}
```

#### API key response

```json
{
  "api_key": "assinafy-key-or-masked-value"
}
```

`api_key` itself may be `null`, and `getApiKey()` may return `null` when the
user has no record. `listApiKeys()` converts a missing record to `[]` and an
existing record to a one-element array; it does not make a different HTTP
request.

#### Change password request

```json
{
  "email": "owner@example.com",
  "password": "current-password",
  "new_password": "new-password"
}
```

#### Password reset requests

Request an email:

```json
{
  "email": "owner@example.com"
}
```

Complete the reset:

```json
{
  "email": "owner@example.com",
  "token": "reset-token-from-email",
  "new_password": "new-password"
}
```

`token` is optional in the SDK type because some deployments recover it from
request context.

#### Email result response

All three password-management methods return the email address from the
unwrapped response:

```json
{
  "email": "owner@example.com"
}
```

#### Authenticated user response

```json
{
  "id": "usr_01J00000000000000000000000",
  "name": "Aline Costa",
  "email": "owner@example.com",
  "telephone": "+5511999999999",
  "government_id": "12345678909",
  "is_email_verified": true,
  "has_accepted_terms": true,
  "created_at": "2026-08-20T14:30:00Z",
  "to_be_deleted_at": null
}
```

#### Notification preferences

The update request may contain any non-empty subset. The response always
contains the complete map:

```json
{
  "DocumentCompleted": true,
  "SignerDeclined": true,
  "DocumentCancelled": true,
  "DocumentAboutToExpire": true,
  "DocumentExpired": true,
  "DocumentExpirationReset": true,
  "DocumentProcessingFailed": true,
  "TemplateProcessingFailed": true,
  "SignerWhatsappFailed": true
}
```

### Signer payloads

#### Signer list query

SDK object and corresponding query string:

```json
{
  "search": "aline",
  "sort": "full_name",
  "page": 1,
  "perPage": 20
}
```

```text
?search=aline&sort=-created_at&page=1&per-page=20
```

`sort` is retained as a live compatibility extension; it is not described by
the current production operation schema.

#### Create signer request

```json
{
  "full_name": "Aline Costa",
  "email": "signer@example.com",
  "whatsapp_phone_number": "+5511999999999"
}
```

Only `full_name` is required by the SDK type. Provide at least one reachable
notification destination before assigning the signer.

#### Update signer request

```json
{
  "full_name": "Aline de Costa",
  "email": "signer@example.com",
  "whatsapp_phone_number": "+5511988888888",
  "government_id": "12345678909"
}
```

All fields are optional. The API normalizes `government_id` to digits.

#### Confirm signer data request

Canonical production fields:

```json
{
  "full_name": "Aline Costa",
  "email": "signer@example.com",
  "government_id": "12345678909"
}
```

The SDK retains `whatsapp_phone_number` and `has_accepted_terms` for older live
deployments. Use `signature.acceptTerms()` for the current contract.

#### Signer response

```json
{
  "resource": "signer",
  "id": "sig_01J00000000000000000000000",
  "full_name": "Aline Costa",
  "email": "signer@example.com",
  "whatsapp_phone_number": "+5511999999999",
  "government_id": "12345678909",
  "has_accepted_terms": true,
  "has_signature": true,
  "has_initial": true,
  "completed": false,
  "notification_history": [
    {
      "event": "signature_request",
      "status": "sent",
      "error_code": null,
      "error_message": null,
      "sent_at": "2026-08-20T14:32:00Z",
      "failed_at": null
    }
  ],
  "verification_method": "Email",
  "notification_methods": ["Email"],
  "step": 1,
  "notified": true
}
```

Assignment-facing signer fields such as `completed` and
`notification_history` may be `null`. Each history entry contains `event`, a
`sent`/`failed` status, nullable error details, and nullable sent/failed
timestamps as shown above.

#### Signer self response

```json
{
  "resource": "signer",
  "id": "sig_01J00000000000000000000000",
  "full_name": "Aline Costa",
  "email": "signer@example.com",
  "whatsapp_phone_number": "+5511999999999",
  "government_id": "12345678909",
  "has_accepted_terms": true,
  "has_signature": true,
  "has_initial": true,
  "is_signature_reusable": true,
  "completed": false,
  "notification_history": [],
  "verification_method": "Email",
  "notification_methods": ["Email"],
  "step": 1,
  "notified": true
}
```

### Document payloads

#### Document status response

```json
[
  { "code": "uploading", "deletable": false },
  { "code": "uploaded", "deletable": true },
  { "code": "metadata_processing", "deletable": false },
  { "code": "metadata_ready", "deletable": true },
  { "code": "expired", "deletable": true },
  { "code": "certificating", "deletable": false },
  { "code": "certificated", "deletable": false },
  { "code": "rejected_by_signer", "deletable": true },
  { "code": "pending_signature", "deletable": false },
  { "code": "rejected_by_user", "deletable": true },
  { "code": "failed", "deletable": true }
]
```

Treat this endpoint as authoritative for current codes and deletion rules; the
API may add statuses.

#### Document list query

```json
{
  "status": ["pending_signature", "certificated"],
  "method": "virtual",
  "search": "contract",
  "tags": ["tag_01J00000000000000000000000"],
  "sort": "updated_at",
  "page": 1,
  "perPage": 20
}
```

The SDK joins array-valued `status` and `tags` with commas and encodes
`perPage` as `per-page`. The published sort fields are `name` and `updated_at`.

#### Document search query

```json
{
  "search": "contract",
  "status": ["pending_signature", "certificated"],
  "page": 1,
  "perPage": 20
}
```

Search responses are compact `Document` objects and may omit expanded pages and
assignment data.

#### Document upload request

Canonical production wire representation:

```text
Content-Type: multipart/form-data; boundary=generated-by-runtime

file: binary document bytes; filename="contract.pdf"; Content-Type=application/pdf
```

SDK input:

```ts
import { readFile } from "node:fs/promises";

await client.documents.upload(accountId, {
  filename: "contract.pdf",
  body: await readFile("contract.pdf"),
  contentType: "application/pdf",
});
```

The SDK can additionally append each `tags` value as a `tags[]` multipart
field. That field is a [live compatibility extension](#live-compatibility-extensions),
not part of the current production upload schema.

#### Rename document request

```json
{
  "name": "signed-services-contract.pdf"
}
```

#### Document response

This example contains every stable property represented by the SDK, including
the nested assignment, item, page, signer, summary, and signing URL objects:

```json
{
  "resource": "document",
  "id": "doc_01J00000000000000000000000",
  "account_id": "acc_01J00000000000000000000000",
  "template_id": null,
  "name": "contract.pdf",
  "status": "pending_signature",
  "artifacts": {
    "original": "https://api.assinafy.com.br/files/original.pdf",
    "thumbnail": "https://api.assinafy.com.br/files/thumbnail.png",
    "certificated": "https://api.assinafy.com.br/files/certificated.pdf",
    "certificate-page": "https://api.assinafy.com.br/files/certificate-page.pdf",
    "pades": "https://api.assinafy.com.br/files/pades.pdf",
    "bundle": "https://api.assinafy.com.br/files/bundle.zip"
  },
  "is_closed": false,
  "signing_url": "https://app.assinafy.com.br/sign/doc_01J00000000000000000000000",
  "decline_reason": null,
  "declined_by": null,
  "tags": [
    {
      "resource": "tag",
      "id": "tag_01J00000000000000000000000",
      "name": "Legal",
      "color": "2563EB",
      "created_at": "2026-08-20T14:30:00Z",
      "updated_at": "2026-08-20T14:30:00Z"
    }
  ],
  "created_at": "2026-08-20T14:30:00Z",
  "updated_at": "2026-08-20T14:31:00Z",
  "current_signer": {
    "id": "sig_01J00000000000000000000000",
    "full_name": "Aline Costa",
    "email": "signer@example.com",
    "has_accepted_terms": true,
    "completed": false
  },
  "pages": [
    {
      "id": "pag_01J00000000000000000000000",
      "number": 1,
      "height": 1651,
      "width": 1275,
      "download_url": "https://api.assinafy.com.br/files/page-1.png"
    }
  ],
  "assignment": {
    "resource": "assignment",
    "id": "asn_01J00000000000000000000000",
    "document_id": "doc_01J00000000000000000000000",
    "sender_email": "owner@example.com",
    "method": "collect",
    "status": "pending",
    "expiration": "2026-09-20T23:59:59Z",
    "expires_at": "2026-09-20T23:59:59Z",
    "message": "Please sign by Friday.",
    "signers": [
      {
        "id": "sig_01J00000000000000000000000",
        "full_name": "Aline Costa",
        "email": "signer@example.com",
        "whatsapp_phone_number": "+5511999999999",
        "government_id": "12345678909",
        "has_accepted_terms": true,
        "has_signature": true,
        "has_initial": true,
        "completed": false,
        "notification_history": [],
        "verification_method": "Email",
        "notification_methods": ["Email"],
        "step": 1,
        "notified": true
      }
    ],
    "copy_receivers": [
      {
        "id": "sig_01J00000000000000000000001",
        "full_name": "Copy Recipient",
        "email": "copy@example.com",
        "has_accepted_terms": false
      }
    ],
    "items": [
      {
        "id": "itm_01J00000000000000000000000",
        "page": {
          "id": "pag_01J00000000000000000000000",
          "number": 1,
          "height": 1651,
          "width": 1275,
          "download_url": "https://api.assinafy.com.br/files/page-1.png"
        },
        "signer": {
          "id": "sig_01J00000000000000000000000",
          "full_name": "Aline Costa",
          "email": "signer@example.com",
          "has_accepted_terms": true
        },
        "field": {
          "id": "fld_01J00000000000000000000000",
          "name": "Approval note",
          "type": "text",
          "is_active": true
        },
        "display_settings": {
          "left": 120,
          "top": 300,
          "width": 260,
          "height": 48,
          "fontSize": 16,
          "fontFamily": "Arial",
          "backgroundColor": "#FFFFFF"
        },
        "value": "Approved",
        "completed": false
      }
    ],
    "summary": {
      "signer_count": 1,
      "completed_count": 0,
      "signers": [
        {
          "id": "sig_01J00000000000000000000000",
          "full_name": "Aline Costa",
          "email": "signer@example.com",
          "whatsapp_phone_number": "+5511999999999",
          "has_accepted_terms": true,
          "completed": false
        }
      ]
    },
    "signing_urls": [
      {
        "signer_id": "sig_01J00000000000000000000000",
        "url": "https://app.assinafy.com.br/sign/access-code"
      }
    ],
    "completed_at": null,
    "created_at": "2026-08-20T14:31:00Z",
    "updated_at": "2026-08-20T14:31:00Z"
  }
}
```

List/search responses commonly omit `pages`, `current_signer`, and expanded
`assignment`; `documents.get()` is the detail operation. Artifact keys and
activity-specific properties can grow without an SDK release.

#### Document activity response

```json
[
  {
    "id": 4812,
    "event": "signer_viewed_document",
    "type": "SignerViewedDocument",
    "message": "Aline Costa viewed contract.pdf",
    "payload": {
      "document_id": "doc_01J00000000000000000000000",
      "signer_id": "sig_01J00000000000000000000000"
    },
    "origin": { "ip": "203.0.113.10" },
    "actor": { "id": "sig_01J00000000000000000000000", "type": "signer" },
    "metadata": { "user_agent": "Example Browser" },
    "created_at": "2026-08-20T15:00:00Z"
  }
]
```

Activity fields are event-dependent. Unknown fields remain available on the raw
object.

#### Document verification response

```json
{
  "hash": "sha256-signature-hash",
  "id": "doc_01J00000000000000000000000",
  "status": "certificated",
  "page_count": 3,
  "signer_count": 2,
  "completed_count": 2,
  "completed_at": "2026-08-20T16:00:00Z",
  "verified_at": "2026-08-20T16:05:00Z",
  "is_valid": true,
  "message": "Document signature is valid"
}
```

For an unknown/invalid hash, `id`, `status`, counts, and completion time may be
`null`; inspect `is_valid` and `message`.

#### Public document compatibility response

The production OpenAPI response is the full [`Document`](#document-response).
Older deployments may instead return this compact shape, retained in the SDK's
return union:

```json
{
  "resource": "document",
  "id": "doc_01J00000000000000000000000",
  "name": "contract.pdf",
  "page_count": 3,
  "created_by": "Aline Costa"
}
```

#### Send public token request

Canonical production body:

```json
{
  "email": "signer@example.com"
}
```

#### Send public token response

The production operation returns a success envelope without `data`, so the SDK
normally resolves `undefined`. It preserves older deployment payloads as an
optional `SendPublicTokenResult` and gives names to observed fields:

```json
{
  "document": {
    "id": "doc_01J00000000000000000000000",
    "name": "contract.pdf",
    "page_count": 3,
    "created_by": "Aline Costa"
  },
  "channel": "email",
  "recipient": "signer@example.com"
}
```

Do not require those optional response fields.

### Tag payloads

#### Tag list query

```json
{
  "search": "legal",
  "sort": "name",
  "page": 1,
  "perPage": 20
}
```

The string overload `tags.list(accountId, "legal")` is shorthand for
`{ search: "legal" }`. `sort` and pagination are retained live compatibility
parameters beyond the current production operation schema.

#### Create tag request

```json
{
  "name": "Legal",
  "color": "#2563EB"
}
```

`color` is optional and may be `null`.

#### Update tag request

```json
{
  "name": "Legal review",
  "color": "#1D4ED8"
}
```

Both fields are optional.

#### Delete tag request

The SDK places `force` in the query string, not the body:

```text
?force=true
```

#### Document tags request

Both replace (`PUT`) and add (`POST`) use canonical tag IDs:

```json
{
  "tags": [
    "tag_01J00000000000000000000000",
    "tag_01J00000000000000000000001"
  ]
}
```

The current sandbox instead interprets every supplied string as a tag name,
including strings that are production tag IDs; see
[verified sandbox differences](#verified-sandbox-differences).

#### Tag response

```json
{
  "resource": "tag",
  "id": "tag_01J00000000000000000000000",
  "name": "Legal",
  "color": "2563EB",
  "created_at": "2026-08-20T14:30:00Z",
  "updated_at": "2026-08-20T14:35:00Z"
}
```

List methods wrap an array of these objects in the SDK pagination object.
Document-tag mutations return an unwrapped array of these objects.
Responses normalize colors to six hexadecimal characters without a leading
`#`; create requests accept either form.

#### Tag mutation responses

Tag deletion:

```json
{
  "deleted": true
}
```

Removing one tag from a document:

```json
{
  "detached": true
}
```

### Template payloads

#### Template list query

```json
{
  "status": "ready",
  "search": "NDA",
  "tags": ["tag_01J00000000000000000000000"],
  "sort": "-created_at",
  "page": 1,
  "perPage": 20
}
```

The current production schema documents `search`, `page`, and `per-page`.
`status`, `tags`, and `sort` are retained live compatibility parameters.

#### Template response

```json
{
  "resource": "template",
  "id": "tpl_01J00000000000000000000000",
  "name": "Mutual NDA",
  "document_name": "NDA - {{signer}}.pdf",
  "message": "Please review and sign.",
  "status": "ready",
  "pages": [
    {
      "id": "tpg_01J00000000000000000000000",
      "number": 1,
      "height": 1651,
      "width": 1275,
      "download_url": "https://api.assinafy.com.br/files/template-page-1.png",
      "fields": [
        {
          "id": "tfd_01J00000000000000000000000",
          "field_id": "fld_01J00000000000000000000000",
          "role_id": "rol_01J00000000000000000000000",
          "name": "Signature",
          "label": "Signer signature",
          "type": "signature",
          "display_settings": {
            "left": 120,
            "top": 1000,
            "width": 300,
            "height": 80,
            "fontSize": 16
          },
          "is_required": true,
          "created_at": "2026-08-20T14:30:00Z",
          "updated_at": "2026-08-20T14:35:00Z"
        }
      ]
    }
  ],
  "roles": [
    {
      "id": "rol_01J00000000000000000000000",
      "name": "Contractor",
      "assignment_type": "Signer",
      "created_at": "2026-08-20T14:30:00Z",
      "updated_at": "2026-08-20T14:35:00Z"
    }
  ],
  "tags": [
    {
      "id": "tag_01J00000000000000000000000",
      "name": "Legal",
      "color": "2563EB"
    }
  ],
  "default_document_tags": [
    {
      "id": "tag_01J00000000000000000000000",
      "name": "Legal"
    }
  ],
  "created_at": "2026-08-20T14:30:00Z",
  "updated_at": "2026-08-20T14:35:00Z"
}
```

List responses may omit the detail-only page, field, role, and default-tag
properties.

#### Instantiate template request

```json
{
  "signers": [
    {
      "role_id": "rol_01J00000000000000000000000",
      "id": "sig_01J00000000000000000000000",
      "step": 1,
      "verification_method": "Email",
      "notification_methods": ["Email"]
    }
  ],
  "editor_fields": [
    {
      "field_id": "fld_01J00000000000000000000001",
      "value": "Purchase order 1234"
    }
  ],
  "name": "NDA - Aline Costa.pdf",
  "message": "Please review and sign.",
  "expires_at": "2026-09-20T23:59:59Z",
  "tags": ["tag_01J00000000000000000000000"]
}
```

`signers` is required. Each signer needs the template `role_id` and an existing
signer `id`. The SDK still declares `full_name`, `email`, and
`whatsapp_phone_number` on this nested object for source compatibility, but the
current operation requires `id`.

#### Estimate template cost request

```json
{
  "signers": [
    {
      "role_id": "rol_01J00000000000000000000000",
      "verification_method": "Email",
      "notification_methods": ["Email"]
    }
  ]
}
```

Passing the signer array directly is an SDK shorthand; the wire body is always
the object above.

#### Cost estimate response

```json
{
  "documents": 1,
  "credits": 2,
  "needs_extra_document": false,
  "extra_document_cost": 0,
  "total_credits": 2,
  "breakdown": [
    {
      "code": "email_signature_request",
      "name": "Email signature request",
      "cost": 2,
      "quantity": 1,
      "unit_cost": 2
    }
  ],
  "document_balance": 90,
  "credit_balance": 100,
  "has_sufficient_resources": true,
  "blocking_reason": null,
  "message": null,
  "total": 2,
  "currency": "BRL"
}
```

The shared response type covers both assignment and template estimation. Some
deployments return only the balance-oriented fields or only `total`/`currency`.
The older exported `ResendCostEstimate` type is retained for source
compatibility with deployments that returned `total`, `breakdown`,
`credit_balance`, and `has_sufficient_credits`; new code should use
`CostEstimate`, which is the return type of `estimateResendCost()`.

### Assignment payloads

#### Assignment list query

```json
{
  "page": 1,
  "perPage": 20
}
```

The SDK encodes `perPage` as `per-page`.

#### Create assignment request

Virtual signature request:

```json
{
  "method": "virtual",
  "signers": [
    {
      "id": "sig_01J00000000000000000000000",
      "step": 1,
      "verification_method": "Email",
      "notification_methods": ["Email"]
    }
  ],
  "message": "Please sign by Friday.",
  "expires_at": "2026-09-20T23:59:59Z",
  "copy_receivers": ["copy@example.com"]
}
```

Collect assignment with a positioned field:

```json
{
  "method": "collect",
  "signers": [
    {
      "id": "sig_01J00000000000000000000000",
      "step": 1,
      "verification_method": "Email",
      "notification_methods": ["Email"]
    }
  ],
  "entries": [
    {
      "page_id": "pag_01J00000000000000000000000",
      "fields": [
        {
          "signer_id": "sig_01J00000000000000000000000",
          "field_id": "fld_01J00000000000000000000000",
          "display_settings": {
            "left": 120,
            "top": 300,
            "width": 260,
            "height": 48,
            "fontSize": 16,
            "fontFamily": "Arial",
            "backgroundColor": "#FFFFFF"
          }
        }
      ]
    }
  ],
  "message": "Complete the field and sign.",
  "expires_at": "2026-09-20T23:59:59Z",
  "copy_receivers": []
}
```

SDK-only input aliases `signerIds`, `signer_ids`, and `expiration` are normalized
to `signers: [{ id }]` and `expires_at` before the request is sent.

#### Estimate assignment cost request

```json
{
  "method": "virtual",
  "signers": [
    {
      "verification_method": "Email",
      "notification_methods": ["Email"]
    }
  ],
  "entries": []
}
```

An existing signer `id` is not required for an estimate, though older
deployments accept one. The SDK normalizes `signerIds` and `signer_ids` aliases
as it does for assignment creation.

#### Reset expiration request

```json
{
  "expires_at": "2026-09-20T23:59:59Z"
}
```

#### Sign assignment request

The body itself is an array, not an object:

```json
[
  {
    "itemId": "itm_01J00000000000000000000000",
    "fieldId": "fld_01J00000000000000000000000",
    "pageId": "pag_01J00000000000000000000000",
    "value": "Approved"
  }
]
```

For virtual assignments without collect fields, send `[]`.

#### Decline request

```json
{
  "decline_reason": "Terms were not accepted"
}
```

#### Multiple document action requests

Sign:

```json
{
  "document_ids": [
    "doc_01J00000000000000000000000",
    "doc_01J00000000000000000000001"
  ]
}
```

Decline:

```json
{
  "document_ids": [
    "doc_01J00000000000000000000000",
    "doc_01J00000000000000000000001"
  ],
  "decline_reason": "Terms were not accepted"
}
```

#### Assignment response

```json
{
  "resource": "assignment",
  "id": "asn_01J00000000000000000000000",
  "document_id": "doc_01J00000000000000000000000",
  "sender_email": "owner@example.com",
  "method": "virtual",
  "status": "pending",
  "expiration": "2026-09-20T23:59:59Z",
  "expires_at": "2026-09-20T23:59:59Z",
  "message": "Please sign by Friday.",
  "signers": [
    {
      "id": "sig_01J00000000000000000000000",
      "full_name": "Aline Costa",
      "email": "signer@example.com",
      "whatsapp_phone_number": "+5511999999999",
      "government_id": "12345678909",
      "has_accepted_terms": true,
      "has_signature": true,
      "has_initial": true,
      "completed": false,
      "notification_history": [],
      "verification_method": "Email",
      "notification_methods": ["Email"],
      "step": 1,
      "notified": true
    }
  ],
  "copy_receivers": [],
  "items": [],
  "summary": {
    "signer_count": 1,
    "completed_count": 0,
    "signers": [
      {
        "id": "sig_01J00000000000000000000000",
        "full_name": "Aline Costa",
        "email": "signer@example.com",
        "whatsapp_phone_number": "+5511999999999",
        "has_accepted_terms": true,
        "completed": false
      }
    ]
  },
  "signing_urls": [
    {
      "signer_id": "sig_01J00000000000000000000000",
      "url": "https://app.assinafy.com.br/sign/access-code"
    }
  ],
  "completed_at": null,
  "created_at": "2026-08-20T14:31:00Z",
  "updated_at": "2026-08-20T14:31:00Z"
}
```

#### Resend response

```json
{
  "is_sent": true,
  "document_id": "doc_01J00000000000000000000000",
  "signer_id": "sig_01J00000000000000000000000"
}
```

#### WhatsApp notification response

```json
[
  {
    "sent_at": 1787238000,
    "header": "Signature requested",
    "body": "Please sign contract.pdf",
    "buttons": [
      {
        "text": "Open document",
        "url": "https://app.assinafy.com.br/sign/access-code"
      }
    ],
    "phone_number": "+5511999999999",
    "signer_id": "sig_01J00000000000000000000000"
  }
]
```

### Field payloads

#### Field list query

```json
{
  "include_inactive": true,
  "include_standard": true,
  "search": "approval",
  "sort": "name",
  "page": 1,
  "perPage": 20
}
```

The SDK encodes `perPage` as `per-page`. `search`, `sort`, and pagination are
live compatibility parameters beyond the current operation schema.

#### Create field request

```json
{
  "type": "text",
  "name": "Approval code",
  "regex": "^[A-Z]{3}-[0-9]{3}$",
  "is_required": true
}
```

`regex` and `is_required` are optional. The SDK retains `is_active` on this
input for source compatibility, but the current create operation does not
document it.

#### Update field request

Canonical production fields:

```json
{
  "name": "Approval reference",
  "regex": "^[A-Z]{3}-[0-9]{4}$",
  "is_active": true
}
```

The SDK retains `type` and `is_required` for older deployments; the current
update operation does not document changing them.

#### Validate field request

```json
{
  "value": "ABC-123"
}
```

`value` is deliberately typed `unknown`: its representation depends on the
field type.

#### Validate multiple fields request

The body itself is an array:

```json
[
  {
    "field_id": "fld_01J00000000000000000000000",
    "value": "ABC-123"
  },
  {
    "field_id": "fld_01J00000000000000000000001",
    "value": true
  }
]
```

#### Field response

```json
{
  "resource": "field",
  "id": "fld_01J00000000000000000000000",
  "name": "Approval code",
  "type": "text",
  "regex": "^[A-Z]{3}-[0-9]{3}$",
  "is_pre_defined": false,
  "is_active": true,
  "is_required": true,
  "is_standard": false,
  "is_read_only": false,
  "is_visible": true
}
```

#### Field validation response

Single-field result:

```json
{
  "field_id": "fld_01J00000000000000000000000",
  "type": "text",
  "success": true,
  "error_message": ""
}
```

Multiple validation returns an array of the same shape, in request order.

#### Field type response

```json
[
  {
    "type": "text",
    "name": "Text"
  },
  {
    "type": "signature",
    "name": "Signature"
  }
]
```

Use the returned catalog rather than hard-coding a closed enum.

### Signer-flow payloads

#### Verify OTP request

The wire key is hyphenated:

```json
{
  "verification-code": "123456"
}
```

#### Signature upload request

The production request body is raw PNG bytes, not JSON or multipart data.
The `type` query is optional:

```text
POST /signature?signer-access-code=REDACTED&reuse=false
Content-Type: image/png

<binary image bytes>
```

Pass `undefined` as the SDK's second argument to omit `type`; when supplied,
it is usually `signature` or `initial`. `reuse=true` asks the service to reuse
the signer's saved image. Explicit image types and non-PNG `contentType` values
remain available as [live compatibility extensions](#live-compatibility-extensions).

#### Sign context query

```json
{
  "hasAcceptedTerms": true
}
```

The SDK encodes this property as `has_accepted_terms=true` alongside the signer
access code.

#### Signer document search query

```json
{
  "search": "contract"
}
```

The SDK encodes it as `search=contract` alongside the signer access code.

### Webhook payloads

#### Webhook subscription request

```json
{
  "events": [
    "document_uploaded",
    "signer_signed_document",
    "document_processing_failed"
  ],
  "is_active": true,
  "url": "https://example.com/webhooks/assinafy",
  "email": "webhooks@example.com"
}
```

Known event IDs are typed, while new event strings remain forward-compatible.

#### Webhook subscription response

```json
{
  "id": "whs_01J00000000000000000000000",
  "events": [
    "document_uploaded",
    "signer_signed_document",
    "document_processing_failed"
  ],
  "is_active": true,
  "url": "https://example.com/webhooks/assinafy",
  "email": "webhooks@example.com",
  "created_at": "2026-08-20T14:30:00Z",
  "updated_at": "2026-08-20T14:35:00Z"
}
```

`getSubscription()` returns `null` when no subscription exists. Existing,
incompletely configured records can contain `null` for `url`, `email`, or
`updated_at`.

#### Webhook event type response

```json
[
  {
    "id": "document_uploaded",
    "description": "A document was uploaded"
  },
  {
    "id": "signer_signed_document",
    "description": "A signer completed a document"
  }
]
```

#### Webhook dispatch list query

```json
{
  "event": "signer_signed_document",
  "delivered": false,
  "from": 1787184000,
  "to": 1787270399,
  "page": 1,
  "perPage": 20
}
```

`from` and `to` are Unix timestamps. The SDK encodes `perPage` as `per-page`.

#### Webhook dispatch response

```json
{
  "resource": "webhook_dispatch",
  "id": "whd_01J00000000000000000000000",
  "event": "signer_signed_document",
  "activity_id": 4812,
  "endpoint": "https://example.com/webhooks/assinafy",
  "payload": {
    "document_id": "doc_01J00000000000000000000000",
    "signer_id": "sig_01J00000000000000000000000"
  },
  "delivered": true,
  "http_status": 200,
  "response_body": "ok",
  "error": null,
  "created_at": "2026-08-20T15:00:00Z",
  "updated_at": "2026-08-20T15:00:01Z"
}
```

For an unsuccessful or not-yet-attempted dispatch, `endpoint`, `payload`,
`http_status`, `response_body`, and `error` may be `null` as represented by the
SDK type.

## Low-level client API

Most applications should use `AssinafyClient`. The transport remains public for
custom or newly published endpoints.

### `AssinafyClient`

| Member | Contract |
| --- | --- |
| `new AssinafyClient(options?)` | Builds all resource properties. `apiKey` and `accessToken` are mutually exclusive; production is the default base URL. |
| `AssinafyClient.fromEnv(env?)` | Reads `ASSINAFY_API_KEY`, `ASSINAFY_ACCESS_TOKEN`, `ASSINAFY_BASE_URL`, and `ASSINAFY_ACCOUNT_ID`; returns an unauthenticated client if neither credential exists. |
| `accountId` | The optional default account ID supplied by the caller. Resource methods still take explicit account IDs. |
| `http` | Configured `HttpClient` instance for advanced calls. |
| `accounts`, `assignments`, `auth`, `documents`, `fields`, `signature`, `signers`, `tags`, `templates`, `users`, `webhooks` | Stateless resource instances documented above. |

Complete constructor example:

```ts
const client = new AssinafyClient({
  baseUrl: "https://api.assinafy.com.br/v1",
  apiKey: "api-key",
  accountId: "acc_01J00000000000000000000000",
  maxRetries: 2,
  retryBaseDelayMs: 250,
  userAgent: "acme-signing-service/1.0.0",
  fetch: globalThis.fetch,
  onRateLimit(limit) {
    console.log(limit.limit, limit.remaining, limit.resetSeconds);
  },
});
```

### `HttpClient`

```ts
const http = new HttpClient({
  baseUrl: "https://sandbox.assinafy.com.br/v1",
  auth: { kind: "apiKey", apiKey: "api-key" },
  maxRetries: 2,
  retryBaseDelayMs: 250,
});
```

| Method | Request | Return |
| --- | --- | --- |
| `get<T>(path, init?)` | `GET`; no automatic body | unwrapped `Promise<T>` |
| `post<T>(path, body?, init?)` | JSON `POST` unless `init` supplies a specialized body | unwrapped `Promise<T>` |
| `put<T>(path, body?, init?)` | JSON `PUT` unless `init` supplies a specialized body | unwrapped `Promise<T>` |
| `patch<T>(path, body?, init?)` | JSON `PATCH` unless `init` supplies a specialized body | unwrapped `Promise<T>` |
| `delete<T>(path, init?)` | `DELETE` | unwrapped `Promise<T>` |
| `getPage<T>(path, init?)` | paginated `GET` | `Promise<Page<T>>` |
| `request<T>(path, init?)` | parsed request with metadata | `Promise<{ data, status, rateLimit?, pagination?, headers }>` |
| `rawRequest(path, init?)` | unparsed request, used for binary artifacts | native `Promise<Response>` |

Absolute URLs are accepted only when their origin exactly matches `baseUrl`.
Redirects are refused—even if `RequestInit.redirect` requests following—so a
custom authentication header cannot cross origins through a redirect.
`withQuery(path, values)` serializes defined scalar/array values using
`URLSearchParams`:

```ts
const path = withQuery("/accounts", { page: 2, "per-page": 50 });
// /accounts?page=2&per-page=50
```

## Chat orchestration API

Import these symbols from `@assinafy/chat-sdk`.

### `Chat`

```ts
const chat = new Chat({
  userName: "Assinafy Bot",
  adapters: { memory },
  state: new MemoryStateAdapter(),
  client,
  defaultAdapter: "memory",
});
```

Only `userName` and a non-empty `adapters` object are required. State defaults
to a process-local `MemoryStateAdapter`; the default adapter is the first entry.

| Method | Input | Result / behavior |
| --- | --- | --- |
| `whenReady()` | none | `Promise<void>` after every adapter has initialized |
| `onNewMention(handler)` | `(thread, message) => …` | Registers handler; returns `this` |
| `onSubscribedMessage(handler)` | `(thread, message) => …` | Registers handler; returns `this` |
| `onNewMessage(pattern, handler)` | `RegExp`, message handler | Registers handler; returns `this` |
| `onAction(handler)` | `(thread, action) => …` | Registers handler; returns `this` |
| `onCommand(name, handler)` | command string or `RegExp` | Registers `/name` and `!name`, or the supplied pattern; returns `this` |
| `onFallback(handler)` | message handler | Sets the unmatched-message handler; returns `this` |
| `openThread(recipient, adapterName?)` | platform recipient and optional adapter | Opens a DM and returns `Promise<Thread>` |
| `thread(adapterName, threadId)` | adapter key and platform thread ID | Synchronous `Thread` reference |
| `post(adapterName, threadId, body)` | [`MessageBody`](#message-and-action-payloads) | `Promise<void>` after posting |
| `processMessage(adapter, message)` | adapter and [`IncomingMessage`](#message-and-action-payloads) | Dispatches one message; `Promise<void>` |
| `processAction(adapter, action)` | adapter and [`IncomingAction`](#message-and-action-payloads) | Dispatches one action; `Promise<void>` |
| `disconnect()` | none | Calls every optional adapter teardown; rejects with the first teardown error after all settle |

Message dispatch priority is command, matching `onNewMessage` patterns,
subscribed-thread handlers, mention handlers, then fallback. All matching
`onNewMessage`, subscribed, mention, or action handlers run in registration
order; command and fallback dispatch stop after their selected handler path.

### `Thread`

Handlers receive a `Thread`; applications can also construct one with its
`id`, `adapter`, `state`, and optional `originatingMessage`.

| Method | Input | Result |
| --- | --- | --- |
| `post(body)` | string, card, or structured message | `Promise<SentMessage>` |
| `subscribe()` | none | `Promise<void>` |
| `unsubscribe()` | none | `Promise<void>` |
| `isSubscribed()` | none | `Promise<boolean>` |
| `get<T>(key)` | string key | `Promise<T \| undefined>` |
| `set<T>(key, value)` | string key and serializable/backend-supported value | `Promise<void>` |
| `delete(key)` | string key | `Promise<void>` |

### Message and action payloads

`IncomingMessage` is a runtime object; `sentAt` is a `Date`, not an ISO string:

```ts
const message: IncomingMessage = {
  id: "msg-123",
  threadId: "thread-456",
  text: "Please show document status",
  author: {
    id: "user-789",
    displayName: "Aline Costa",
    email: "aline@example.com",
    metadata: { tenant: "acme" },
  },
  from: {
    id: "user-789",
    displayName: "Aline Costa",
    email: "aline@example.com",
    metadata: { tenant: "acme" },
  },
  isMention: true,
  mentionsBot: true,
  attachments: [
    {
      filename: "contract.pdf",
      contentType: "application/pdf",
      url: "https://example.com/contract.pdf",
      size: 42812,
    },
  ],
  sentAt: new Date("2026-08-20T15:00:00Z"),
  raw: { provider_specific: true },
};
```

`from` and `mentionsBot` are deprecated aliases populated with the same values
as `author` and `isMention`.

```ts
const action: IncomingAction = {
  id: "action-123",
  threadId: "thread-456",
  actionId: "approve",
  value: "doc_01J00000000000000000000000",
  author: { id: "user-789", displayName: "Aline Costa" },
  from: { id: "user-789", displayName: "Aline Costa" },
  sentAt: new Date("2026-08-20T15:01:00Z"),
  raw: { provider_specific: true },
};
```

Structured outgoing request and adapter response:

```ts
const outgoing: OutgoingMessage = {
  text: "Contract is ready",
  card: Card({ title: "Contract", children: [Text("Ready to sign")] }),
  fallbackText: "Contract is ready to sign",
  attachments: [
    {
      filename: "contract.pdf",
      contentType: "application/pdf",
      url: "https://example.com/contract.pdf",
    },
  ],
};

const sent: SentMessage = {
  id: "platform-message-id",
  threadId: "platform-thread-id",
};
```

## Adapter API

### `ChatAdapter` and `BaseAdapter`

Custom adapters implement `name`, `postMessage()`, and `openDM()`. `BaseAdapter`
stores the `ChatHandle` in `initialize()` and supplies default implementations
of `editMessage`, `deleteMessage`, `addReaction`, `removeReaction`, and
`startTyping` that throw `NotImplementedError`. Override only supported
operations. `disconnect()` is optional.

| Helper | Input | Result |
| --- | --- | --- |
| `unsupported(adapter, operation, reason?)` | three strings | throws `NotImplementedError`; return type `never` |
| `buildIncomingMessage(input)` | canonical message fields | complete `IncomingMessage`, including compatibility aliases |
| `buildIncomingAction(input)` | canonical action fields | complete `IncomingAction`, including `from` alias |
| `verifyWebhookSignature(options)` | secret, raw body, signature, optional timestamp/tolerance/algorithm/encoding/payload builder | literal `true`, or throws `WebhookSignatureError` |
| `isValidWebhookSignature(options)` | same options | boolean; converts every verification failure to `false` |

Signature verification options, with every property shown:

```ts
const valid = verifyWebhookSignature({
  secret: process.env.WEBHOOK_SECRET!,
  body: rawRequestBody,
  signature: request.headers.get("x-signature")!,
  timestamp: request.headers.get("x-timestamp")!,
  toleranceSeconds: 300,
  algorithm: "sha256",
  encoding: "hex",
  buildPayload: (timestamp, body) => `${timestamp}.${String(body)}`,
});
// valid === true
```

Do not parse or reserialize the body before verification. Empty secrets,
malformed signatures, length mismatches, digest mismatches, invalid timestamps,
and timestamps outside the tolerance fail closed. Hex and base64 digests are
supported, as are short algorithm prefixes such as `v0=` and `sha256=`.

### Memory adapter

`createMemoryAdapter({ name? })` returns a `MemoryAdapter`. `InMemoryAdapter` is
a deprecated class alias.

| Member | Input | Result / behavior |
| --- | --- | --- |
| `initialize(chat)` | `ChatHandle` | wires inbound listeners to the chat dispatcher |
| `postMessage(threadId, message)` | thread ID and `OutgoingMessage` | stores and returns `Promise<SentMessage>` |
| `openDM(recipient)` | recipient string | stable `Promise<string>` thread ID for that recipient |
| `editMessage(threadId, messageId, message)` | identifiers and replacement message | updates captured message; rejects unknown IDs |
| `deleteMessage(threadId, messageId)` | identifiers | removes captured message; unknown IDs are a no-op |
| `addReaction`, `removeReaction`, `startTyping` | interface arguments | no-op promises in memory |
| `onMessage(handler)` | inbound message listener | unsubscribe function |
| `onAction(handler)` | inbound action listener | unsubscribe function |
| `receive(input)` | text plus optional author/thread/mention/attachments | synthesized `Promise<IncomingMessage>` after listeners finish |
| `receiveAction(input)` | action ID/thread plus optional value/author | synthesized `Promise<IncomingAction>` after listeners finish |
| `outbox` | read-only array | captured `RecordedOutgoing[]` |
| `sentCount` | getter | number of captured messages |
| `lastSent` | getter | latest `RecordedOutgoing \| undefined` |
| `reset()` | none | clears outbox and remembered DM threads |

Complete `receive()` input:

```ts
await memory.receive({
  text: "/status doc_01J00000000000000000000000",
  author: {
    id: "user-789",
    displayName: "Aline Costa",
    email: "aline@example.com",
    metadata: { tenant: "acme" },
  },
  threadId: "thread-456",
  isMention: true,
  attachments: [
    {
      filename: "notes.txt",
      contentType: "text/plain",
      url: "https://example.com/notes.txt",
      size: 120,
    },
  ],
});
```

## State API

Every `ChatState` implementation provides the following asynchronous methods:

| Method | Result |
| --- | --- |
| `subscribe(threadId, adapter?)` | `Promise<void>` |
| `unsubscribe(threadId, adapter?)` | `Promise<void>` |
| `isSubscribed(threadId, adapter?)` | `Promise<boolean>` |
| `getThreadValue<T>(threadId, key)` | `Promise<T \| undefined>` |
| `setThreadValue<T>(threadId, key, value)` | `Promise<void>` |
| `deleteThreadValue(threadId, key)` | `Promise<void>` |
| `listSubscriptions(adapter?)` | `Promise<ThreadSubscription[]>` |

A subscription row is `{ threadId, adapter?, subscribedAt: Date }`.
`MemoryStateAdapter` implements this contract in process memory;
`InMemoryState` is its deprecated alias. Use a durable shared implementation for
multi-process production deployments.

## Card API

All builders return plain JSON-serializable tagged objects. Capitalized names
are canonical; lowercase names are exact aliases. `CardText` aliases `Text`.

| Builder | Input | Returned discriminator | Lowercase alias |
| --- | --- | --- | --- |
| `Card(input)` | `title?`, `subtitle?`, `children`, `accentColor?` | `type: "card"` | `card` |
| `Text(content, { markdown? }?)` | text and optional markdown hint | `type: "text"` | `text` |
| `Heading(level, content)` | level `1 \| 2 \| 3`, text | `type: "heading"` | `heading` |
| `Divider()` | none | `type: "divider"` | `divider` |
| `Section(input)` | `label?`, `children` | `type: "section"` | `section` |
| `Fields(entries)` | `{ label, value }[]` | `type: "fields"` | `fields` |
| `LinkButton(input)` | `label`, `url`, `style?` | `type: "link-button"` | `linkButton` |
| `Button(input)` | `id`, `label`, `value?`, `style?`, `actionType?`, `callbackUrl?` | `type: "button"` | `button` |
| `Actions(children)` | action/link buttons | `type: "actions"` | `actions` |
| `Image(input)` | `url`, `alt?` | `type: "image"` | `image` |
| `Table(input)` | `headers`, `rows`, `align?` | `type: "table"` | `table` |
| `Select(input)` | `id`, `label?`, `placeholder?`, `options` | `type: "select"` | `select` |
| `RadioSelect(input)` | `id`, `label?`, `options` | `type: "radio-select"` | `radioSelect` |
| `Option(input)` | `{ label, value }` | returns input unchanged | `option` |
| `DocumentPreview(input)` | `documentId`, `name`, `status`, `thumbnailUrl?`, `signingUrl?` | `type: "document-preview"` | `documentPreview` |
| `SignerStatus(signers)` | `{ name, email?, completed }[]` | `type: "signer-status"` | `signerStatus` |
| `Children(...items)` | elements plus nullable/false conditionals | filtered `CardElement[]` | `children` |

`isCard(value)` is the type guard for `type === "card"`. `renderText(card)`,
`renderMarkdown(card)`, and `renderHtml(card)` return strings; the HTML renderer
escapes values. Adapters may choose which primitives and styling hints they can
represent.

Complete card payload using every primitive:

```json
{
  "type": "card",
  "title": "Document ready",
  "subtitle": "Review and sign",
  "accentColor": "#2563EB",
  "children": [
    { "type": "heading", "level": 2, "content": "Contract.pdf" },
    { "type": "text", "content": "Please review the contract.", "markdown": false },
    {
      "type": "section",
      "label": "Details",
      "children": [{ "type": "divider" }]
    },
    {
      "type": "fields",
      "fields": [{ "label": "Status", "value": "Pending signature" }]
    },
    {
      "type": "actions",
      "children": [
        {
          "type": "link-button",
          "label": "Open",
          "url": "https://app.assinafy.com.br/sign/access-code",
          "style": "primary"
        },
        {
          "type": "button",
          "id": "decline",
          "label": "Decline",
          "value": "doc_01J00000000000000000000000",
          "style": "danger",
          "actionType": "document",
          "callbackUrl": "https://example.com/actions"
        }
      ]
    },
    { "type": "image", "url": "https://example.com/thumbnail.png", "alt": "Page one" },
    {
      "type": "table",
      "headers": ["Signer", "Status"],
      "rows": [["Aline Costa", "Pending"]],
      "align": ["left", "center"]
    },
    {
      "type": "select",
      "id": "assignee",
      "label": "Assignee",
      "placeholder": "Choose a signer",
      "options": [{ "label": "Aline Costa", "value": "signer-id" }]
    },
    {
      "type": "radio-select",
      "id": "method",
      "label": "Method",
      "options": [{ "label": "Virtual", "value": "virtual" }]
    },
    {
      "type": "document-preview",
      "documentId": "doc_01J00000000000000000000000",
      "name": "Contract.pdf",
      "status": "pending_signature",
      "thumbnailUrl": "https://example.com/thumbnail.png",
      "signingUrl": "https://app.assinafy.com.br/sign/access-code"
    },
    {
      "type": "signer-status",
      "signers": [
        { "name": "Aline Costa", "email": "aline@example.com", "completed": false }
      ]
    }
  ]
}
```

## AI helper API

The AI subpath has no model-provider dependency. `createChatTools(client,
options?)` returns provider-neutral `ChatTool[]`; each descriptor contains
`name`, `description`, identical `input_schema` and `parameters` JSON Schemas,
and an `execute(args)` method that validates the input before calling the client.

`options.accountId` overrides `client.accountId`. Without either default, every
account-scoped tool requires `accountId`. `include` and `exclude` filter stable
tool names. `runTool(tools, name, args)` finds and executes a tool or throws for
an unknown name. Validation failures throw before any API request.

The full 36-tool catalog follows. Braces show canonical argument keys; keys
suffixed `?` are optional. Compatibility alternatives are listed immediately
below the table. Results link to the same unwrapped payloads as the resource
methods.

| Tool | Input object | Result |
| --- | --- | --- |
| `list_signers` | `{ accountId?, search?, page?, perPage? }` | [`Page<Signer>`](#signer-response) |
| `create_signer` | `{ accountId?, full_name, email?, whatsapp_phone_number? }` | [`Signer`](#signer-response) |
| `get_signer` | `{ accountId?, signerId }` | [`Signer`](#signer-response) |
| `update_signer` | `{ accountId?, signerId, full_name?, email?, whatsapp_phone_number?, government_id? }` | [`Signer`](#signer-response) |
| `delete_signer` | `{ accountId?, signerId }` | `{ "ok": true }` |
| `list_documents` | `{ accountId?, status?, search?, method?, tags?, sort?, page?, perPage? }` | [`Page<Document>`](#document-response) |
| `get_document` | `{ documentId }` | [`Document`](#document-response) |
| `delete_document` | `{ documentId }` | `{ "ok": true }` |
| `document_activities` | `{ documentId }` | [`DocumentActivity[]`](#document-activity-response) |
| `rename_document` | `{ documentId, name }` | [`Document`](#document-response) |
| `search_documents` | `{ accountId?, search?, status?, page?, perPage? }` | [`Page<Document>`](#document-response) |
| `list_document_statuses` | `{}` | [`DocumentStatus[]`](#document-status-response) |
| `create_assignment` | `{ documentId, method, signers? / signer_ids? / signerIds?, entries?, message?, expires_at?, copy_receivers? }` | [`Assignment`](#assignment-response) |
| `estimate_assignment_cost` | `{ documentId, method?, signers?, signer_ids?, entries? }` | [`CostEstimate`](#cost-estimate-response) |
| `list_templates` | `{ accountId?, search?, page?, perPage? }` | [`Page<Template>`](#template-response) |
| `instantiate_template` | `{ accountId?, templateId, name?, message?, signers, tags?, editor_fields?, expires_at? }` | [`Document`](#document-response) |
| `list_tags` | `{ accountId?, search? }` | [`Page<Tag>`](#tag-response) |
| `create_tag` | `{ accountId?, name, color? }` | [`Tag`](#tag-response) |
| `tag_document` | `{ accountId?, documentId, tagIds }` | [`Tag[]`](#tag-response) |
| `list_fields` | `{ accountId?, include_inactive?, include_standard? }` | [`Page<FieldDefinition>`](#field-response) |
| `create_field` | `{ accountId?, type, name, regex?, is_required? }` | [`FieldDefinition`](#field-response) |
| `get_field` | `{ accountId?, fieldId }` | [`FieldDefinition`](#field-response) |
| `update_field` | `{ accountId?, fieldId, name?, regex?, is_active? }` | [`FieldDefinition`](#field-response) |
| `delete_field` | `{ accountId?, fieldId }` | `{ "ok": true }` |
| `validate_field` | `{ accountId?, fieldId, value, accessCode? }` | [`FieldValidationResult`](#field-validation-response) |
| `validate_fields` | `{ accountId?, entries, accessCode? }` | [`FieldValidationResult[]`](#field-validation-response) |
| `list_field_types` | `{}` | [`FieldType[]`](#field-type-response) |
| `get_webhook_subscription` | `{ accountId? }` | [`WebhookSubscription \| null`](#webhook-subscription-response) |
| `update_webhook_subscription` | `{ accountId?, events, is_active, url, email }` | [`WebhookSubscription`](#webhook-subscription-response) |
| `inactivate_webhook_subscription` | `{ accountId? }` | [`WebhookSubscription`](#webhook-subscription-response) |
| `list_webhook_event_types` | `{}` | [`WebhookEventTypeInfo[]`](#webhook-event-type-response) |
| `list_webhook_dispatches` | `{ accountId?, event?, delivered?, from?, to?, page?, perPage? }` | [`Page<WebhookDispatch>`](#webhook-dispatch-response) |
| `retry_webhook_dispatch` | `{ accountId?, dispatchId }` | [`WebhookDispatch`](#webhook-dispatch-response) |
| `send_public_token` | `{ documentId, email }` | [`SendPublicTokenResult \| undefined`](#send-public-token-response) |
| `verify_document` | `{ signatureHash }` | [`DocumentVerificationResult`](#document-verification-response) |
| `list_accounts` | `{}` | [`Account[]`](#account-response) |

The current `send_public_token` schema also accepts legacy `{ documentId,
recipient, channel }`, and `tag_document` accepts legacy `tags`; both are
compatibility branches. Provider adapters should use `{ documentId, email }`
and `{ documentId, tagIds }` for current production.

`toAiMessages(history, botUserId?)` converts normalized inbound messages to
`{ role, content, name? }` objects, adds attachment summaries, and marks messages
from `botUserId` as `assistant`. Display names are sanitized to
`[a-zA-Z0-9_-]`; an empty result omits `name`. The complete neutral message
shape is:

```json
{
  "role": "user",
  "content": "Please show the contract.\n\nAttachments:\n- contract.pdf (application/pdf): https://example.com/contract.pdf",
  "tool_call_id": "optional-tool-call-id",
  "name": "Aline_Costa"
}
```

`defaultSystemPrompt(botName?)` returns a provider-neutral string instructing
the model to use tools, explain failures, and confirm destructive actions. The
native-fetch Anthropic loop in
[`examples/ai-bot.ts`](https://github.com/assinafy/chat-sdk/blob/main/examples/ai-bot.ts)
shows the full tool-call/result
cycle without adding an LLM SDK dependency.

## Live compatibility extensions

The entries in this section are deliberately separate from the 89-operation
production contract. They remain available because they have existed on live
or older sandbox deployments; they should not be assumed portable unless the
target environment has been tested.

| Extension | SDK behavior | Production OpenAPI position |
| --- | --- | --- |
| Template detail | `templates.get(accountId, templateId)` calls `GET /accounts/{accountId}/templates/{templateId}`. | Route absent from the 2026-08-20 snapshot. |
| Upload tags | `documents.upload(..., { tags })` emits repeated multipart `tags[]`. | Upload schema contains only `file`. |
| Legacy token recipient | `sendPublicToken()` accepts `{ recipient, channel }`; when canonical `{ email }` receives `400` or `422`, it retries once as `{ recipient: email, channel: "email" }`. | Canonical body is `{ email }`. |
| Compact public document | `publicGet()` accepts a compact `PublicDocument` response. | Published response is the full `Document`. |
| Tag names | Document-tag methods pass strings unchanged; older deployments may accept names and create missing tags. | Canonical values are tag IDs. |
| Signature upload variants | `signature.upload()` can send an explicit `type` and a non-PNG `contentType`. | Published `type` is optional and the request body is `image/png`. |
| Expanded list filters | Signer lists can send `sort`; signer-document lists can send `status`/`method`/`search`/`sort`/`tags`; tag lists can send `sort`/pagination; template lists can send `status`/`tags`/`sort`; field lists can send `search`/`sort`/pagination. | These parameters are absent from their current operation schemas. |
| Field signer code | Field validation can append `signer-access-code`. | Published operations declare account authentication only. |
| Signer artifact code | `signature.downloadDocument()` appends `signer-access-code` when its optional `accessCode` argument is supplied. | Published download operation is public. |
| Older input aliases | Assignment `signerIds`/`signer_ids`/`expiration`, template-estimate array input, template `editor_fields` object maps, and several deprecated type properties are normalized or retained. | Canonical payload examples above should be preferred. |

SDK-only conveniences are not extra endpoints: `documents.iterate()` and
`signers.iterate()` page lazily; `auth.listApiKeys()` adapts one key to an array;
`auth.revokeApiKeys()` aliases `deleteApiKey()`; and `assignments.sign()` /
`assignments.decline()` call the same two signer operations as the corresponding
`signature` methods.

## Verified sandbox differences

These results were reproduced against `https://sandbox.assinafy.com.br/v1` on
2026-08-20. They describe sandbox behavior, not a change to the production
OpenAPI contract.

| Operation | Production contract | Verified sandbox result | Compatibility guidance |
| --- | --- | --- | --- |
| `POST /accounts` | `{ name, notification_sender_type? }` | A body containing `notification_sender_type` was rejected; `{ name }` succeeded. | Omit the optional field when creating a sandbox account; update it separately only after testing. |
| `PUT /public/documents/{documentId}/send-token` | `{ email }` | Canonical body returned `400` requiring `channel`. | The SDK retries that `400`/`422` once with exactly `{ recipient: email, channel: "email" }`. |
| Document tag `PUT`/`POST` | `{ tags: [tagId] }` | Every string was interpreted as a tag name; passing an existing ID created a tag whose name was that ID. | Keep production code on IDs. Sandbox-only live tests use names to avoid creating ID-named tags. |
| `GET /assignments` with API key | Bearer or API key | Returned `400` because no logged-in “current account” context was available. | Use a bearer session; with an API key, inspect the assignment expanded by `documents.get(documentId)`. |
| `GET /accounts/{accountId}/stats` | Published operation | Returned `404`. | Keep the SDK method; skip or explicitly expect `404` in sandbox until the deployment catches up. |
| `GET /users/self/stats` | Published operation | Returned `404`. | Same as account stats. |
| User notification-preference `GET`/`PUT` | Published operations | Returned `404`. | Keep the SDK methods; gate sandbox live checks on route availability. |
| `GET /accounts/{accountId}/webhooks/subscriptions` on a new account | The response can contain nullable destination fields. | Returned a default record with empty events and `null` URL/email rather than `null` data. | Treat either `null` or a typed subscription record as an unconfigured subscription. |

The sandbox can lag production or retain legacy request variants. Code intended
for production should use the canonical payloads in this reference and isolate
any compatibility fallback behind a deployment-specific test.
