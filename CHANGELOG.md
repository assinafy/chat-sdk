# Changelog

All notable changes to `@assinafy/chat-sdk` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.4.1] - 2026-10-11

### Added

- `client.signature.listDocumentsAsWorkspace(signerId, query?)` and
  `client.signature.searchDocumentsAsWorkspace(signerId, search?)` read a
  signer's documents with the workspace's API key or bearer token.
- `ApiError.rateLimit` (`X-Rate-Limit-Limit`, `-Remaining`, `-Reset`) and
  `ApiError.retryAfterSeconds` (`Retry-After`, sent with `429 Too Many
  Requests`) on failed requests.
- `assignments.resetExpiration(documentId, assignmentId, null)` removes an
  assignment's expiration.
- `government_id` on `CreateSignerInput`.

### Changed

- `documents.sendPublicToken(documentId, input)` sends
  `{ "channel": "email", "recipient": "<signer email>" }`; both are required,
  `email` is the only channel, and the result type is the
  `{ document, channel, recipient }` payload. The deprecated `{ email }` input
  is sent in that form. The `send_public_token` AI tool takes
  `{ documentId, recipient }`.
- `assignments.estimateCost` sends only the priced signer settings
  (`verification_method`, `notification_methods`); signer ids are not sent.
  `signers` is required for `virtual` and `entries` for `collect`.
- Requests carry only the fields each operation defines:
  - `documents.upload` sends the `file` part only; the deprecated `tags` input
    is ignored (attach tags with `tags.addToDocument`).
  - `fields.create` sends `name`, `type`, `regex`, `is_required`;
    `fields.update` sends `name`, `regex`, `is_active`.
  - `templates.instantiate` sends the published signer and `editor_fields`
    shapes; a keyed `editor_fields` object is converted to the array form.
  - `templates.list` no longer sends `status` or `tags`;
    `signature.listDocuments` no longer sends `status`, `method` or `tags`.
  - `signers.confirmDataForDocument` sends `full_name`, `email` and
    `government_id`; `has_accepted_terms: true` accepts the terms through the
    accept-terms operation right after the confirmation.

### Security

- Every method that takes a signer access code rejects a missing or blank code
  with `ConfigurationError` before sending, and sends the code as the only
  credential: the client's API key or bearer token is no longer attached to
  signer-facing requests.
- `fields.validate` and `fields.validateMultiple` use the workspace's
  credentials only and reject `options.accessCode` instead of validating with
  the workspace's credentials in its place. The `validate_field` and
  `validate_fields` AI tools no longer take an access code.
