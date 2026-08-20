# Assinafy API coverage

This matrix maps the production OpenAPI document to the public TypeScript client. Paths include the `/v1` prefix even though SDK resource methods use a `baseUrl` that already contains it.

## Snapshot

| Item | Value |
| --- | --- |
| Source | [`https://api.assinafy.com.br/v1/docs/openapi.json`](https://api.assinafy.com.br/v1/docs/openapi.json) |
| Checked | 2026-08-20 |
| OpenAPI | 3.0.0 |
| API document version | 1.0.0 |
| Paths | 67 |
| Operations | 89 |
| SHA-256 | `44da834c27173a3739d491fdacbb48decf9a170bd776a1c4edb4d0d4b108c22f` |

The SDK inventory was checked against the current `src/client` source on the same date. It includes `accounts.getStats` and the wired `users` resource. All 89 published operations have a public SDK method.

Authentication labels reproduce the OpenAPI `security` declaration:

- **Bearer / API key** — either `Authorization: Bearer …` or `X-Api-Key: …`.
- **Signer access code** — the signer access code required by the signing flow.
- **Public** — the OpenAPI operation has an empty security declaration.

Status meanings:

- **Covered** — a public SDK resource method targets the published operation.
- **Missing** — the operation is published but has no public SDK method.
- **Unpublished** — an SDK method targets a route absent from this OpenAPI snapshot; these are listed separately and are not part of the 89-operation total.

Coverage records route availability, not proof that every request variant succeeded against a particular live account. Request and response contracts belong in `API_REFERENCE.md`; sandbox verification belongs in the test record.

## Summary

| OpenAPI tag | Operations | Covered | Missing |
| --- | ---: | ---: | ---: |
| Accounts | 10 | 10 | 0 |
| Assignments | 7 | 7 | 0 |
| Authentication | 9 | 9 | 0 |
| Documents | 18 | 18 | 0 |
| Fields | 8 | 8 | 0 |
| Signers | 5 | 5 | 0 |
| Signing | 17 | 17 | 0 |
| Tags | 4 | 4 | 0 |
| Templates | 1 | 1 | 0 |
| Users | 4 | 4 | 0 |
| Webhooks | 6 | 6 | 0 |
| **Total** | **89** | **89** | **0** |

## Published operations

### Accounts

| Method | Path | SDK method | Request | SDK response | Auth | Status |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/v1/accounts/{accountId}` | `client.accounts.get` | [Request](API_REFERENCE.md#accounts-get) | [Unwrapped response](API_REFERENCE.md#accounts-get) | Bearer / API key | Covered |
| PUT | `/v1/accounts/{accountId}` | `client.accounts.update` | [Request](API_REFERENCE.md#accounts-update) | [Unwrapped response](API_REFERENCE.md#accounts-update) | Bearer / API key | Covered |
| DELETE | `/v1/accounts/{accountId}` | `client.accounts.remove` | [Request](API_REFERENCE.md#accounts-remove) | [Unwrapped response](API_REFERENCE.md#accounts-remove) | Bearer / API key | Covered |
| GET | `/v1/accounts/{accountId}/theme` | `client.accounts.getTheme` | [Request](API_REFERENCE.md#accounts-get-theme) | [Unwrapped response](API_REFERENCE.md#accounts-get-theme) | Bearer / API key | Covered |
| GET | `/v1/accounts/{accountId}/logo` | `client.accounts.downloadLogo` | [Request](API_REFERENCE.md#accounts-download-logo) | [Raw response](API_REFERENCE.md#accounts-download-logo) | Bearer / API key | Covered |
| POST | `/v1/accounts/{accountId}/logo` | `client.accounts.uploadLogo` | [Request](API_REFERENCE.md#accounts-upload-logo) | [Unwrapped response](API_REFERENCE.md#accounts-upload-logo) | Bearer / API key | Covered |
| DELETE | `/v1/accounts/{accountId}/logo` | `client.accounts.deleteLogo` | [Request](API_REFERENCE.md#accounts-delete-logo) | [Unwrapped response](API_REFERENCE.md#accounts-delete-logo) | Bearer / API key | Covered |
| GET | `/v1/accounts` | `client.accounts.list` | [Request](API_REFERENCE.md#accounts-list) | [Unwrapped response](API_REFERENCE.md#accounts-list) | Bearer / API key | Covered |
| POST | `/v1/accounts` | `client.accounts.create` | [Request](API_REFERENCE.md#accounts-create) | [Unwrapped response](API_REFERENCE.md#accounts-create) | Bearer / API key | Covered |
| GET | `/v1/accounts/{accountId}/stats` | `client.accounts.getStats` | [Request](API_REFERENCE.md#accounts-get-stats) | [Unwrapped response](API_REFERENCE.md#accounts-get-stats) | Bearer / API key | Covered |

### Assignments

| Method | Path | SDK method | Request | SDK response | Auth | Status |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/v1/assignments` | `client.assignments.list` | [Request](API_REFERENCE.md#assignments-list) | [Unwrapped response](API_REFERENCE.md#assignments-list) | Bearer / API key | Covered |
| POST | `/v1/documents/{documentId}/assignments` | `client.assignments.create` | [Request](API_REFERENCE.md#assignments-create) | [Unwrapped response](API_REFERENCE.md#assignments-create) | Bearer / API key | Covered |
| POST | `/v1/documents/{documentId}/assignments/estimate-cost` | `client.assignments.estimateCost` | [Request](API_REFERENCE.md#assignments-estimate-cost) | [Unwrapped response](API_REFERENCE.md#assignments-estimate-cost) | Bearer / API key | Covered |
| PUT | `/v1/documents/{documentId}/assignments/{assignmentId}/signers/{signerId}/resend` | `client.assignments.resendToSigner` | [Request](API_REFERENCE.md#assignments-resend-to-signer) | [Unwrapped response](API_REFERENCE.md#assignments-resend-to-signer) | Bearer / API key | Covered |
| POST | `/v1/documents/{documentId}/assignments/{assignmentId}/signers/{signerId}/estimate-resend-cost` | `client.assignments.estimateResendCost` | [Request](API_REFERENCE.md#assignments-estimate-resend-cost) | [Unwrapped response](API_REFERENCE.md#assignments-estimate-resend-cost) | Bearer / API key | Covered |
| PUT | `/v1/documents/{documentId}/assignments/{assignmentId}/reset-expiration` | `client.assignments.resetExpiration` | [Request](API_REFERENCE.md#assignments-reset-expiration) | [Unwrapped response](API_REFERENCE.md#assignments-reset-expiration) | Bearer / API key | Covered |
| GET | `/v1/documents/{documentId}/assignments/{assignmentId}/whatsapp-notifications` | `client.assignments.whatsappNotifications` | [Request](API_REFERENCE.md#assignments-whatsapp-notifications) | [Unwrapped response](API_REFERENCE.md#assignments-whatsapp-notifications) | Bearer / API key | Covered |

### Authentication

| Method | Path | SDK method | Request | SDK response | Auth | Status |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/v1/login` | `client.auth.login` | [Request](API_REFERENCE.md#auth-login) | [Unwrapped response](API_REFERENCE.md#auth-login) | Public | Covered |
| PUT | `/v1/authentication/request-password-reset` | `client.auth.requestPasswordReset` | [Request](API_REFERENCE.md#auth-request-password-reset) | [Unwrapped response](API_REFERENCE.md#auth-request-password-reset) | Public | Covered |
| PUT | `/v1/authentication/reset-password` | `client.auth.resetPassword` | [Request](API_REFERENCE.md#auth-reset-password) | [Unwrapped response](API_REFERENCE.md#auth-reset-password) | Public | Covered |
| PUT | `/v1/authentication/change-password` | `client.auth.changePassword` | [Request](API_REFERENCE.md#auth-change-password) | [Unwrapped response](API_REFERENCE.md#auth-change-password) | Bearer / API key | Covered |
| POST | `/v1/authentication/social-login` | `client.auth.socialLogin` | [Request](API_REFERENCE.md#auth-social-login) | [Unwrapped response](API_REFERENCE.md#auth-social-login) | Public | Covered |
| POST | `/v1/auth/link-social-login` | `client.auth.linkSocialLogin` | [Request](API_REFERENCE.md#auth-link-social-login) | [Unwrapped response](API_REFERENCE.md#auth-link-social-login) | Bearer / API key | Covered |
| GET | `/v1/users/api-keys` | `client.auth.getApiKey` | [Request](API_REFERENCE.md#auth-get-api-key) | [Unwrapped response](API_REFERENCE.md#auth-get-api-key) | Bearer / API key | Covered |
| POST | `/v1/users/api-keys` | `client.auth.createApiKey` | [Request](API_REFERENCE.md#auth-create-api-key) | [Unwrapped response](API_REFERENCE.md#auth-create-api-key) | Bearer / API key | Covered |
| DELETE | `/v1/users/api-keys` | `client.auth.deleteApiKey` | [Request](API_REFERENCE.md#auth-delete-api-key) | [Unwrapped response](API_REFERENCE.md#auth-delete-api-key) | Bearer / API key | Covered |

### Documents

| Method | Path | SDK method | Request | SDK response | Auth | Status |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/v1/documents/{documentId}/activities` | `client.documents.activities` | [Request](API_REFERENCE.md#documents-activities) | [Unwrapped response](API_REFERENCE.md#documents-activities) | Bearer / API key | Covered |
| GET | `/v1/accounts/{accountId}/documents` | `client.documents.list` | [Request](API_REFERENCE.md#documents-list) | [Unwrapped response](API_REFERENCE.md#documents-list) | Bearer / API key | Covered |
| POST | `/v1/accounts/{accountId}/documents` | `client.documents.upload` | [Request](API_REFERENCE.md#documents-upload) | [Unwrapped response](API_REFERENCE.md#documents-upload) | Bearer / API key | Covered |
| GET | `/v1/accounts/{accountId}/documents/search` | `client.documents.search` | [Request](API_REFERENCE.md#documents-search) | [Unwrapped response](API_REFERENCE.md#documents-search) | Bearer / API key | Covered |
| GET | `/v1/documents/statuses` | `client.documents.statuses` | [Request](API_REFERENCE.md#documents-statuses) | [Unwrapped response](API_REFERENCE.md#documents-statuses) | Bearer / API key | Covered |
| GET | `/v1/documents/{documentId}` | `client.documents.get` | [Request](API_REFERENCE.md#documents-get) | [Unwrapped response](API_REFERENCE.md#documents-get) | Bearer / API key | Covered |
| DELETE | `/v1/documents/{documentId}` | `client.documents.remove` | [Request](API_REFERENCE.md#documents-remove) | [Unwrapped response](API_REFERENCE.md#documents-remove) | Bearer / API key | Covered |
| PATCH | `/v1/documents/{documentId}` | `client.documents.rename` | [Request](API_REFERENCE.md#documents-rename) | [Unwrapped response](API_REFERENCE.md#documents-rename) | Bearer / API key | Covered |
| GET | `/v1/documents/{documentId}/download/{artifactName}` | `client.documents.download` | [Request](API_REFERENCE.md#documents-download) | [Raw response](API_REFERENCE.md#documents-download) | Bearer / API key | Covered |
| GET | `/v1/documents/{documentSignatureHash}/verify` | `client.documents.verify` | [Request](API_REFERENCE.md#documents-verify) | [Unwrapped response](API_REFERENCE.md#documents-verify) | Public | Covered |
| GET | `/v1/accounts/{accountId}/documents/{documentId}/tags` | `client.tags.listForDocument` | [Request](API_REFERENCE.md#tags-list-for-document) | [Unwrapped response](API_REFERENCE.md#tags-list-for-document) | Bearer / API key | Covered |
| PUT | `/v1/accounts/{accountId}/documents/{documentId}/tags` | `client.tags.setForDocument` | [Request](API_REFERENCE.md#tags-set-for-document) | [Unwrapped response](API_REFERENCE.md#tags-set-for-document) | Bearer / API key | Covered |
| POST | `/v1/accounts/{accountId}/documents/{documentId}/tags` | `client.tags.addToDocument` | [Request](API_REFERENCE.md#tags-add-to-document) | [Unwrapped response](API_REFERENCE.md#tags-add-to-document) | Bearer / API key | Covered |
| DELETE | `/v1/accounts/{accountId}/documents/{documentId}/tags/{tagId}` | `client.tags.removeFromDocument` | [Request](API_REFERENCE.md#tags-remove-from-document) | [Unwrapped response](API_REFERENCE.md#tags-remove-from-document) | Bearer / API key | Covered |
| GET | `/v1/documents/{documentId}/thumbnail` | `client.documents.thumbnail` | [Request](API_REFERENCE.md#documents-thumbnail) | [Raw response](API_REFERENCE.md#documents-thumbnail) | Bearer / API key | Covered |
| GET | `/v1/documents/{documentId}/pages/{pageId}/download` | `client.documents.downloadPage` | [Request](API_REFERENCE.md#documents-download-page) | [Raw response](API_REFERENCE.md#documents-download-page) | Bearer / API key | Covered |
| POST | `/v1/accounts/{accountId}/templates/{templateId}/documents` | `client.templates.instantiate` | [Request](API_REFERENCE.md#templates-instantiate) | [Unwrapped response](API_REFERENCE.md#templates-instantiate) | Bearer / API key | Covered |
| POST | `/v1/accounts/{accountId}/templates/{templateId}/documents/estimate-cost` | `client.templates.estimateCost` | [Request](API_REFERENCE.md#templates-estimate-cost) | [Unwrapped response](API_REFERENCE.md#templates-estimate-cost) | Bearer / API key | Covered |

### Fields

| Method | Path | SDK method | Request | SDK response | Auth | Status |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/v1/accounts/{accountId}/fields` | `client.fields.list` | [Request](API_REFERENCE.md#fields-list) | [Unwrapped response](API_REFERENCE.md#fields-list) | Bearer / API key | Covered |
| POST | `/v1/accounts/{accountId}/fields` | `client.fields.create` | [Request](API_REFERENCE.md#fields-create) | [Unwrapped response](API_REFERENCE.md#fields-create) | Bearer / API key | Covered |
| GET | `/v1/accounts/{accountId}/fields/{fieldId}` | `client.fields.get` | [Request](API_REFERENCE.md#fields-get) | [Unwrapped response](API_REFERENCE.md#fields-get) | Bearer / API key | Covered |
| PUT | `/v1/accounts/{accountId}/fields/{fieldId}` | `client.fields.update` | [Request](API_REFERENCE.md#fields-update) | [Unwrapped response](API_REFERENCE.md#fields-update) | Bearer / API key | Covered |
| DELETE | `/v1/accounts/{accountId}/fields/{fieldId}` | `client.fields.remove` | [Request](API_REFERENCE.md#fields-remove) | [Unwrapped response](API_REFERENCE.md#fields-remove) | Bearer / API key | Covered |
| POST | `/v1/accounts/{accountId}/fields/{fieldId}/validate` | `client.fields.validate` | [Request](API_REFERENCE.md#fields-validate) | [Unwrapped response](API_REFERENCE.md#fields-validate) | Bearer / API key | Covered |
| POST | `/v1/accounts/{accountId}/fields/validate-multiple` | `client.fields.validateMultiple` | [Request](API_REFERENCE.md#fields-validate-multiple) | [Unwrapped response](API_REFERENCE.md#fields-validate-multiple) | Bearer / API key | Covered |
| GET | `/v1/field-types` | `client.fields.listTypes` | [Request](API_REFERENCE.md#fields-list-types) | [Unwrapped response](API_REFERENCE.md#fields-list-types) | Bearer / API key | Covered |

### Signers

| Method | Path | SDK method | Request | SDK response | Auth | Status |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/v1/accounts/{accountId}/signers` | `client.signers.list` | [Request](API_REFERENCE.md#signers-list) | [Unwrapped response](API_REFERENCE.md#signers-list) | Bearer / API key | Covered |
| POST | `/v1/accounts/{accountId}/signers` | `client.signers.create` | [Request](API_REFERENCE.md#signers-create) | [Unwrapped response](API_REFERENCE.md#signers-create) | Bearer / API key | Covered |
| GET | `/v1/accounts/{accountId}/signers/{signerId}` | `client.signers.get` | [Request](API_REFERENCE.md#signers-get) | [Unwrapped response](API_REFERENCE.md#signers-get) | Bearer / API key | Covered |
| PUT | `/v1/accounts/{accountId}/signers/{signerId}` | `client.signers.update` | [Request](API_REFERENCE.md#signers-update) | [Unwrapped response](API_REFERENCE.md#signers-update) | Bearer / API key | Covered |
| DELETE | `/v1/accounts/{accountId}/signers/{signerId}` | `client.signers.remove` | [Request](API_REFERENCE.md#signers-remove) | [Unwrapped response](API_REFERENCE.md#signers-remove) | Bearer / API key | Covered |

### Signing

| Method | Path | SDK method | Request | SDK response | Auth | Status |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/v1/public/documents/{documentId}` | `client.documents.publicGet` | [Request](API_REFERENCE.md#documents-public-get) | [Unwrapped response](API_REFERENCE.md#documents-public-get) | Public | Covered |
| PUT | `/v1/public/documents/{documentId}/send-token` | `client.documents.sendPublicToken` | [Request](API_REFERENCE.md#documents-send-public-token) | [Unwrapped response](API_REFERENCE.md#documents-send-public-token) | Public | Covered |
| GET | `/v1/signers/self` | `client.signature.self` | [Request](API_REFERENCE.md#signature-self) | [Unwrapped response](API_REFERENCE.md#signature-self) | Signer access code | Covered |
| GET | `/v1/signers/{signerId}/document` | `client.signature.currentDocument` | [Request](API_REFERENCE.md#signature-current-document) | [Unwrapped response](API_REFERENCE.md#signature-current-document) | Signer access code | Covered |
| GET | `/v1/sign` | `client.signature.signContext` | [Request](API_REFERENCE.md#signature-sign-context) | [Unwrapped response](API_REFERENCE.md#signature-sign-context) | Signer access code | Covered |
| POST | `/v1/documents/{documentId}/assignments/{assignmentId}` | `client.signature.sign` | [Request](API_REFERENCE.md#signature-sign) | [Unwrapped response](API_REFERENCE.md#signature-sign) | Signer access code | Covered |
| PUT | `/v1/documents/{documentId}/assignments/{assignmentId}/reject` | `client.signature.decline` | [Request](API_REFERENCE.md#signature-decline) | [Unwrapped response](API_REFERENCE.md#signature-decline) | Signer access code | Covered |
| PUT | `/v1/signers/documents/sign-multiple` | `client.signature.signMultiple` | [Request](API_REFERENCE.md#signature-sign-multiple) | [Unwrapped response](API_REFERENCE.md#signature-sign-multiple) | Signer access code | Covered |
| PUT | `/v1/signers/documents/decline-multiple` | `client.signature.declineMultiple` | [Request](API_REFERENCE.md#signature-decline-multiple) | [Unwrapped response](API_REFERENCE.md#signature-decline-multiple) | Signer access code | Covered |
| POST | `/v1/verify` | `client.signature.verify` | [Request](API_REFERENCE.md#signature-verify) | [Unwrapped response](API_REFERENCE.md#signature-verify) | Signer access code | Covered |
| PUT | `/v1/documents/{documentId}/signers/confirm-data` | `client.signers.confirmDataForDocument` | [Request](API_REFERENCE.md#signers-confirm-data-for-document) | [Unwrapped response](API_REFERENCE.md#signers-confirm-data-for-document) | Signer access code | Covered |
| PUT | `/v1/signers/accept-terms` | `client.signature.acceptTerms` | [Request](API_REFERENCE.md#signature-accept-terms) | [Unwrapped response](API_REFERENCE.md#signature-accept-terms) | Signer access code | Covered |
| POST | `/v1/signature` | `client.signature.upload` | [Request](API_REFERENCE.md#signature-upload) | [Unwrapped response](API_REFERENCE.md#signature-upload) | Signer access code | Covered |
| GET | `/v1/signature/{signatureType}` | `client.signature.download` | [Request](API_REFERENCE.md#signature-download) | [Raw response](API_REFERENCE.md#signature-download) | Signer access code | Covered |
| GET | `/v1/signers/{signerId}/documents` | `client.signature.listDocuments` | [Request](API_REFERENCE.md#signature-list-documents) | [Unwrapped response](API_REFERENCE.md#signature-list-documents) | Signer access code | Covered |
| GET | `/v1/signers/{signerId}/documents/search` | `client.signature.searchDocuments` | [Request](API_REFERENCE.md#signature-search-documents) | [Unwrapped response](API_REFERENCE.md#signature-search-documents) | Signer access code | Covered |
| GET | `/v1/signers/{signerId}/documents/{documentId}/download/{artifactName}` | `client.signature.downloadDocument` | [Request](API_REFERENCE.md#signature-download-document) | [Raw response](API_REFERENCE.md#signature-download-document) | Public | Covered |

### Tags

| Method | Path | SDK method | Request | SDK response | Auth | Status |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/v1/accounts/{accountId}/tags` | `client.tags.list` | [Request](API_REFERENCE.md#tags-list) | [Unwrapped response](API_REFERENCE.md#tags-list) | Bearer / API key | Covered |
| POST | `/v1/accounts/{accountId}/tags` | `client.tags.create` | [Request](API_REFERENCE.md#tags-create) | [Unwrapped response](API_REFERENCE.md#tags-create) | Bearer / API key | Covered |
| PUT | `/v1/accounts/{accountId}/tags/{tagId}` | `client.tags.update` | [Request](API_REFERENCE.md#tags-update) | [Unwrapped response](API_REFERENCE.md#tags-update) | Bearer / API key | Covered |
| DELETE | `/v1/accounts/{accountId}/tags/{tagId}` | `client.tags.remove` | [Request](API_REFERENCE.md#tags-remove) | [Unwrapped response](API_REFERENCE.md#tags-remove) | Bearer / API key | Covered |

### Templates

| Method | Path | SDK method | Request | SDK response | Auth | Status |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/v1/accounts/{accountId}/templates` | `client.templates.list` | [Request](API_REFERENCE.md#templates-list) | [Unwrapped response](API_REFERENCE.md#templates-list) | Bearer / API key | Covered |

### Users

| Method | Path | SDK method | Request | SDK response | Auth | Status |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/v1/users/self/notification-preferences` | `client.users.getNotificationPreferences` | [Request](API_REFERENCE.md#users-get-notification-preferences) | [Unwrapped response](API_REFERENCE.md#users-get-notification-preferences) | Bearer / API key | Covered |
| PUT | `/v1/users/self/notification-preferences` | `client.users.updateNotificationPreferences` | [Request](API_REFERENCE.md#users-update-notification-preferences) | [Unwrapped response](API_REFERENCE.md#users-update-notification-preferences) | Bearer / API key | Covered |
| GET | `/v1/users/self/stats` | `client.users.getStats` | [Request](API_REFERENCE.md#users-get-stats) | [Unwrapped response](API_REFERENCE.md#users-get-stats) | Bearer / API key | Covered |
| GET | `/v1/users/self` | `client.users.getCurrent` | [Request](API_REFERENCE.md#users-get-current) | [Unwrapped response](API_REFERENCE.md#users-get-current) | Bearer / API key | Covered |

### Webhooks

| Method | Path | SDK method | Request | SDK response | Auth | Status |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/v1/accounts/{accountId}/webhooks/subscriptions` | `client.webhooks.getSubscription` | [Request](API_REFERENCE.md#webhooks-get-subscription) | [Unwrapped response](API_REFERENCE.md#webhooks-get-subscription) | Bearer / API key | Covered |
| PUT | `/v1/accounts/{accountId}/webhooks/subscriptions` | `client.webhooks.updateSubscription` | [Request](API_REFERENCE.md#webhooks-update-subscription) | [Unwrapped response](API_REFERENCE.md#webhooks-update-subscription) | Bearer / API key | Covered |
| PUT | `/v1/accounts/{accountId}/webhooks/inactivate` | `client.webhooks.inactivate` | [Request](API_REFERENCE.md#webhooks-inactivate) | [Unwrapped response](API_REFERENCE.md#webhooks-inactivate) | Bearer / API key | Covered |
| GET | `/v1/webhooks/event-types` | `client.webhooks.listEventTypes` | [Request](API_REFERENCE.md#webhooks-list-event-types) | [Unwrapped response](API_REFERENCE.md#webhooks-list-event-types) | Bearer / API key | Covered |
| GET | `/v1/accounts/{accountId}/webhooks` | `client.webhooks.listDispatches` | [Request](API_REFERENCE.md#webhooks-list-dispatches) | [Unwrapped response](API_REFERENCE.md#webhooks-list-dispatches) | Bearer / API key | Covered |
| POST | `/v1/accounts/{accountId}/webhooks/{historyId}/retry` | `client.webhooks.retryDispatch` | [Request](API_REFERENCE.md#webhooks-retry-dispatch) | [Unwrapped response](API_REFERENCE.md#webhooks-retry-dispatch) | Bearer / API key | Covered |

## Live compatibility extensions

- **Unpublished:** `GET /v1/accounts/{accountId}/templates/{templateId}` is exposed as `client.templates.get`, but the route is absent from the production snapshot. Treat it as a live compatibility extension until it is published or removed after live verification.
- `client.documents.upload` can send multipart `tags[]`; that upload field is absent from the published request schema.
- `client.documents.sendPublicToken` accepts the published `{ email }` body and the legacy `{ recipient, channel }` body used by older sandbox deployments. A canonical request that receives `400` or `422` is retried once with the legacy e-mail shape.

These extensions are excluded from the 89-operation total.
The [API reference](API_REFERENCE.md#live-compatibility-extensions) lists the
complete compatibility surface, including query extensions and response unions.

## SDK conveniences

These methods add no HTTP operations:

- `client.documents.iterate` and `client.signers.iterate` page through their corresponding list operations.
- `client.auth.listApiKeys` adapts the single-key response to an array; `client.auth.revokeApiKeys` aliases `deleteApiKey`.
- `client.assignments.sign` and `client.assignments.decline` are alternate facades for the corresponding signing operations.
- Assignment signer-id aliases and template estimate array input are normalized locally before the published request is sent.
