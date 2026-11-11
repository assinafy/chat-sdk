# @assinafy/chat-sdk

*Português · [Read in English](README.en.md)*

[![CI](https://github.com/assinafy/chat-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/assinafy/chat-sdk/actions/workflows/ci.yml)
[![CodeQL](https://github.com/assinafy/chat-sdk/actions/workflows/codeql.yml/badge.svg)](https://github.com/assinafy/chat-sdk/actions/workflows/codeql.yml)
[![npm version](https://img.shields.io/npm/v/@assinafy/chat-sdk.svg)](https://www.npmjs.com/package/@assinafy/chat-sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

SDK TypeScript manual e sem dependências de runtime para as 147 operações da API Assinafy v1, OAuth 2.1, fluxos de assinatura, chat, cards e ferramentas de LLM.

- [Referência completa: métodos e payloads](docs/API_REFERENCE.md)
- [Mapa das 147 operações](docs/API_COVERAGE.md)
- [Documentação oficial da Assinafy](https://api.assinafy.com.br/v1/docs)

## Instalação e runtime

```bash
npm install @assinafy/chat-sdk
```

Node.js 24+ é suportado; desenvolvimento e release usam Node 26 LTS. O pacote publica ESM, CommonJS e tipos. `client`, `cards`, `state` e `ai` também rodam em browsers modernos, Bun e Deno; `adapters` e a raiz exigem Node por causa da verificação HMAC com `node:crypto`.

```ts
import { AssinafyClient } from "@assinafy/chat-sdk/client";

const client = new AssinafyClient({
  apiKey: process.env.ASSINAFY_API_KEY,
  accountId: process.env.ASSINAFY_ACCOUNT_ID,
  baseUrl: "https://sandbox.assinafy.com.br/v1", // omita para produção
});
```

Use `apiKey` para a sua conta ou `accessToken` para login/OAuth, nunca ambos. `AssinafyClient.fromEnv()` lê `ASSINAFY_API_KEY`, `ASSINAFY_ACCESS_TOKEN`, `ASSINAFY_ACCOUNT_ID` e `ASSINAFY_BASE_URL`. Métodos públicos omitem a credencial configurada; métodos do signatário enviam somente `signer-access-code`.

## Transporte

O SDK remove o envelope `{ status, message, data }`. Listas devolvem `{ data, pagination }`; downloads devolvem `Response`. `ApiError` preserva status, corpo, método, caminho redigido, rate limit e `Retry-After`. Somente `GET`, `HEAD` e `OPTIONS` repetem falhas transitórias; mutações nunca são repetidas.

```ts
const { data, pagination } = await client.documents.list(accountId, {
  status: "pending_signature",
  perPage: 20,
});
const pdf = await client.documents.download(documentId, "certificated");
```

## Fluxo completo de assinatura

1. Crie ou reutilize signatários.
2. Envie o arquivo (até 25 MB e 2.000 páginas).
3. Aguarde `metadata_ready` quando precisar de páginas/campos.
4. Estime custo e recursos.
5. Crie o assignment; isso inicia notificações e assinatura.
6. Acompanhe por webhook ou polling limitado.
7. Baixe `certificated`, `certificate-page`, `pades` ou `bundle` quando concluir.

```ts
const signer = await client.signers.create(accountId, {
  full_name: "Signatário",
  email: "signer@example.test",
});
const document = await client.documents.upload(accountId, {
  filename: "contrato.pdf",
  body: pdfBytes,
});
const estimate = await client.assignments.estimateCost(document.id, {
  method: "virtual",
  signers: [{ verification_method: "Email", notification_methods: ["Email"] }],
});
if (!estimate.has_sufficient_resources) throw new Error(estimate.message ?? "Recursos insuficientes");
const assignment = await client.assignments.create(document.id, {
  method: "virtual",
  signers: [{ id: signer.id, verification_method: "Email", notification_methods: ["Email"] }],
});
```

| Verificação | Notificação | Requisitos principais |
| --- | --- | --- |
| `Email` | `Email` | OTP por e-mail; padrão e sem custo |
| `Whatsapp` | `Whatsapp` | telefone E.164; plano com WhatsApp |
| `DigitalCertificate` | `Email` ou `Whatsapp` | ICP-Brasil A1/A3, CPF/CNPJ, assignment `virtual`, signatário sozinho na etapa e Web PKI |
| `IdDocumentFaceMatchBasic` | `Email` ou `Whatsapp` | CPF, recurso biométrico habilitado e consentimento explícito |

Cada signatário aceita exatamente uma notificação. Verificação e notificação são acopladas: envie ambas, uma delas para inferir a outra, ou nenhuma para usar Email. Certificado digital produz PAdES e não conclui pelo endpoint comum de assinatura.

No fluxo biométrico, leia `signature.getIdentityVerification(accessCode)`, obtenha consentimento e chame `startIdentityVerification(accessCode, { consent: true })` somente quando `can_start`. Preserve a URL inteira e seu fragmento; não registre nem armazene no browser. Após `InReview`, o signatário pode assinar, mas a certificação aguarda o titular:

```ts
const review = await client.assignments.getSignerIdentityReview(documentId, assignmentId, signerId);
await client.assignments.downloadSignerIdentityReviewImage(documentId, assignmentId, signerId, review.images[0]!);
await client.assignments.reviewSignerIdentity(documentId, assignmentId, signerId, { decision: "Approved" });
```

Evidências são `no-store`, deixam de existir após a decisão e não devem ir para ferramentas de LLM. Rejeição cancela o documento e notifica os participantes.

O signatário usa o código entregue fora de banda:

```ts
const self = await client.signature.self(accessCode); // verifique verification_method antes do OTP
await client.signature.verify(accessCode, otp);
await client.signers.confirmDataForDocument(documentId, accessCode, { has_accepted_terms: true });
await client.signature.signContext(accessCode);
await client.signature.sign(documentId, assignment.id, accessCode, []); // assignments "collect" enviam SignFieldEntry[]
```

`signContext` e `currentDocument` retornam `SigningDocument`; códigos fechados omitem artefatos e dados da conta. Verifique `is_signer_access_closed` e campos opcionais antes de usá-los. Links em `signing_urls` podem ser nulos para WhatsApp e assinatura incorporada.

Trate códigos, links de assinatura e URLs biométricas como credenciais bearer. Mantenha-os fora de logs, analytics, exceções, repositórios e redirects; use HTTPS e `Referrer-Policy: no-referrer`.

## OAuth 2.1 para marketplace

OAuth é para agir nas contas de terceiros; chave de API é para a sua conta. OAuth está disponível em produção. Aplicações públicas/mobile usam PKCE sem segredo; aplicações confidenciais guardam `client_secret` somente no servidor.

```ts
const publicClient = new AssinafyClient();
const request = await publicClient.oauth.createAuthorizationUrl({
  clientId,
  redirectUri: "https://app.example.test/oauth/callback",
  scopes: ["documents:read", "documents:write", "offline_access"],
});
session.oauth = request;
redirect(request.url);

const { code } = publicClient.oauth.readAuthorizationCallback(callbackQuery, session.oauth);
const tokens = await publicClient.oauth.exchangeCode({
  code,
  codeVerifier: session.oauth.codeVerifier,
  redirectUri: session.oauth.redirectUri,
  clientId,
  clientSecret,
});
const connected = new AssinafyClient({ accessToken: tokens.access_token });
const [connectedAccount] = await connected.accounts.list();
```

Cada conexão cobre uma conta. Valide `state` e `iss`; o SDK faz isso em `readAuthorizationCallback`. Códigos duram 60 segundos. Tokens de acesso duram uma hora. `offline_access` entrega refresh token, que dura 30 dias sem uso e rotaciona a cada refresh.

Envie cada refresh token uma única vez e use um lock por conexão. Persista o novo token antes de qualquer outro uso. Timeout, conexão caída, `5xx` ou resposta de erro podem ocorrer depois da rotação: se o armazenamento não contém token mais novo, marque a conexão como inutilizável e reconecte. Ao desconectar, bloqueie refreshes, revogue o token mais recente e apague o estado local.

```ts
const renewed = await publicClient.oauth.refreshToken({ refreshToken, clientId, clientSecret });
await saveTokens(renewed);
await publicClient.oauth.revokeToken({
  token: renewed.refresh_token!, tokenTypeHint: "refresh_token", clientId, clientSecret,
});
```

Produção exige sessões vinculadas ao usuário, tentativas com expiração/uso único, tokens criptografados, lock distribuído, proteção CSRF, HTML seguro, escopos mínimos e validação de `id_token`. Veja [`examples/oauth-connect.ts`](examples/oauth-connect.ts).

## Webhooks, contratos e templates

Prefira webhooks a polling. Cada endpoint pode usar Standard Webhooks; valide o corpo cru com `verifyStandardWebhook`, rejeite timestamps antigos e deduplique por `webhook-id`. Guarde o segredo retornado ao criar, ativar ou rotacionar.

Contratos usam `client.contracts`: envie o documento, defina os termos, vincule aditivos e execute a assinatura normal. A certificação aplica deltas em ordem; envie `updated_at` para rejeitar escrita obsoleta. Templates exigem todas as roles `Signer`; `Editor` usa `editor_fields` e `CopyReceiver` é opcional.

Envelopes agrupam documentos com `client.envelopes`: estime, crie com `max_total_credits` e uma chave de idempotência, acompanhe cada documento e baixe o ZIP. Criar envia convites. Em assinatura incorporada, registre a origem com `client.embedded`, marque o signatário `embedded: true` e crie uma sessão de cinco minutos no servidor. Entregue a URL completa ao iframe; valide origem e janela de `postMessage`. Troque cada token uma única vez. [Payloads e fluxo](docs/API_REFERENCE.md#embedded-signing).

`accounts.get(accountId, { expand: "signing_features" })` informa os recursos habilitados. `accounts.getUsage`, políticas de notificação e preferências push não aceitam OAuth de terceiros. `signature.getTheme`/`downloadLogo` usam somente o código do signatário; `sendCertifiedCopy` envia ao contato original. `rotateEndpointSecret(..., { keep_previous: true })` mantém ambas as assinaturas por 24 horas.

## Chat, cards e LLM

`Chat` roteia comando → regex → thread inscrita → menção → fallback. `Thread` publica mensagens e guarda estado. `MemoryStateAdapter` serve testes/processo único; produção multi-instância deve implementar `ChatState` em Redis/Postgres. Cards renderizam texto, Markdown e HTML; o HTML escapa conteúdo e bloqueia esquemas de URL perigosos.

`createChatTools(client)` cria 41 ferramentas validadas por JSON Schema. Restrinja com `include`/`exclude`, confirme ações destrutivas e não exponha segredos, biometria ou decisão de identidade ao modelo. Veja [`examples/ai-bot.ts`](examples/ai-bot.ts).

## Desenvolvimento

```bash
npm ci
npm run verify
npm run test:integration
```

`verify` roda tipos, lint, exemplo OAuth local, 90/90/90/75 de cobertura, build ESM/CJS e smoke do pacote. A suíte sandbox precisa de `ASSINAFY_API_KEY` e `ASSINAFY_ACCOUNT_ID`; testes que notificam exigem `ASSINAFY_TEST_NOTIFICATIONS=1`. Provas de produção são opt-in e usam credenciais separadas. OTP real, biometria e A1/A3 exigem destinatários consentidos e hardware/arquivos Web PKI.

## Licença

MIT — veja [LICENSE](LICENSE).
