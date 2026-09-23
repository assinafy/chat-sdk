# @assinafy/chat-sdk

*Português · [Read in English](README.en.md)*

[![CI](https://github.com/assinafy/chat-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/assinafy/chat-sdk/actions/workflows/ci.yml)
[![CodeQL](https://github.com/assinafy/chat-sdk/actions/workflows/codeql.yml/badge.svg)](https://github.com/assinafy/chat-sdk/actions/workflows/codeql.yml)
[![npm version](https://img.shields.io/npm/v/@assinafy/chat-sdk.svg)](https://www.npmjs.com/package/@assinafy/chat-sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

SDK TypeScript para a API de assinatura de documentos Assinafy v1 — plataforma
brasileira de assinatura eletrônica — e para construir fluxos de assinatura
conversacionais sobre ela.

Este documento foi escrito para ser lido de ponta a ponta. Começa pelo conteúdo
do pacote, instala e configura o SDK, cobre as duas formas de autenticação, faz
a primeira requisição, explica como respostas e erros se comportam, percorre o
ciclo de vida completo da assinatura de documentos e só então passa às camadas
de chat, cards e IA. Cada seção assume a anterior.

---

## 1. O que há no pacote

O SDK é um pacote com duas metades que podem ser usadas de forma independente.

**O cliente da API** cobre a API REST Assinafy v1: **93 operações em 71
caminhos**, agrupadas em doze recursos — contas, autenticação, OAuth, usuários,
signatários, documentos, tags, templates, assignments, campos, o fluxo de
assinatura do signatário e webhooks. Toda operação é tipada, e o transporte
cuida da autenticação, do envelope de resposta, da paginação, dos metadados de
rate limit, dos retries e do mapeamento de erros.

**A camada de chat** transforma essas operações em fluxos conversacionais: um
orquestrador `Chat` que roteia mensagens de entrada para handlers, uma visão
`Thread` entregue a cada handler, um contrato de adapter para conectar
plataformas de mensagem, um contrato de estado plugável para assinaturas e
armazenamento por thread, um sistema declarativo de cards com renderizadores de
texto, Markdown e HTML, e 36 descritores de ferramenta neutros de provedor para
tool calling de LLM.

Dois documentos de referência acompanham este e vão mais fundo:

- **[Referência da API](./docs/API_REFERENCE.md)** — todo método público com seu
  modo de autenticação, payloads completos de requisição e resposta, as
  superfícies de chat, card, adapter e estado, e o catálogo completo de
  ferramentas de IA.
- **[Índice de operações](./docs/API_COVERAGE.md)** — as 93 operações publicadas
  mapeadas ao método do SDK, mais os pontos em que a superfície HTTP do SDK vai
  além do documento publicado.

O contrato upstream com autoridade é a
[documentação oficial da API Assinafy](https://api.assinafy.com.br/v1/docs).

---

## 2. Requisitos e escopo de runtime

Aplicações de servidor e os exemplos deste repositório têm como alvo o
**Node.js 24 LTS**, que é o que o campo `engines` do pacote exige e o que a CI
roda.

Nem todo ponto de entrada precisa de Node. O pacote publica subcaminhos
focados, para que um bundle de browser ou edge possa trazer apenas o cliente
REST:

| Import | Conteúdo | Roda em |
| --- | --- | --- |
| `@assinafy/chat-sdk/client` | Cliente REST Assinafy v1 e OAuth | Node 24, Bun, Deno e browsers com as APIs Fetch padrão |
| `@assinafy/chat-sdk/cards` | Tipos, builders e renderizadores de card | Qualquer runtime JavaScript |
| `@assinafy/chat-sdk/state` | Contrato de estado e implementação em memória | Qualquer runtime JavaScript |
| `@assinafy/chat-sdk/ai` | Descritores de ferramenta e helpers de mensagem | Qualquer runtime JavaScript |
| `@assinafy/chat-sdk/adapters` | Contratos de adapter, adapter em memória, verificação HMAC | Node.js — a verificação de webhook importa `node:crypto` |
| `@assinafy/chat-sdk` | Tudo acima | Node.js, porque a raiz reexporta os helpers de webhook |

A regra prática: se um bundle só conversa com a API, importe
`@assinafy/chat-sdk/client` e nada mais. Tanto ES modules quanto CommonJS são
publicados, com declarações de tipo para cada um. O pacote não tem nenhuma
dependência de runtime.

---

## 3. Instalação

Pelo npm:

```bash
npm install @assinafy/chat-sdk
```

Todo release também é publicado no GitHub Packages. Para instalar de lá, aponte
o escopo `@assinafy` para aquele registry em um `.npmrc` local do projeto:

```ini
@assinafy:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Depois instale normalmente — o mapeamento de escopo faz o roteamento:

```bash
npm install @assinafy/chat-sdk
```

---

## 4. Configuração e autenticação

O cliente autentica com uma chave de API de vida longa enviada como
`X-Api-Key`, ou com um token de acesso bearer — obtido de `auth.login()` ou um
token de acesso OAuth. Os dois são mutuamente exclusivos; passar ambos lança
`ConfigurationError`.

```ts
import { AssinafyClient } from "@assinafy/chat-sdk/client";

new AssinafyClient({ apiKey: "chave-de-api" });
new AssinafyClient({ accessToken: "token-bearer" });
```

Uma chave de API age sobre a **sua própria** conta. Se, em vez disso, seu
produto é conectado por outras pessoas às **contas delas**, use OAuth — é a
próxima seção.

`AssinafyClient.fromEnv()` lê as mesmas configurações do ambiente, que é o que
os exemplos e a suíte de testes usam:

| Variável | Padrão | Propósito |
| --- | --- | --- |
| `ASSINAFY_API_KEY` | nenhum | Chave de API, enviada como `X-Api-Key` |
| `ASSINAFY_ACCESS_TOKEN` | nenhum | Token bearer, usado no lugar da chave de API |
| `ASSINAFY_BASE_URL` | `https://api.assinafy.com.br/v1` | Use `https://sandbox.assinafy.com.br/v1` para o sandbox |
| `ASSINAFY_ACCOUNT_ID` | nenhum | ID de conta padrão, legível de volta em `client.accountId` |

Construir sem credencial nenhuma é **deliberado e suportado**: um cliente não
autenticado é o que você usa para `auth.login()`, para verificação pública de
documento, para os endpoints do signatário que autenticam com um código de
acesso, e para todo o fluxo OAuth.

Além das credenciais, o construtor aceita configurações de transporte — um
`fetch` customizado, `maxRetries`, `retryBaseDelayMs`, sobrescrita de
`userAgent` e um observador `onRateLimit`. Todos são opcionais e todos são
repassados ao `HttpClient` subjacente.

Nunca comite credenciais. Use uma conta de sandbox dedicada para
desenvolvimento e rotacione qualquer chave exposta.

---

## 5. Conectando contas de terceiros com OAuth

A seção 4 cobre automatizar a **sua própria** conta. Quando seu produto é
instalado por *outras pessoas* nas contas *delas*, elas não devem entregar uma
chave de API a você: use OAuth, e elas aprovam um conjunto específico de
permissões que podem revogar a qualquer momento.

| | Chave de API | OAuth |
| --- | --- | --- |
| Age sobre | Sua própria conta | A conta de outra pessoa, com a permissão dela |
| Pode fazer | Tudo o que sua conta pode | Só os escopos aprovados |
| A pessoa pode desligar | Não | Sim, a qualquer momento |
| Escolha quando | Você automatiza a sua conta | Outras pessoas conectam seu produto às contas delas |

Registre a aplicação em **Configurações → Aplicações OAuth**. Você recebe um
`client_id` e — para uma aplicação *confidencial*, cujo código roda num
servidor seu — um `client_secret` exibido **uma única vez**. Uma aplicação
*pública* (mobile, single-page) não recebe segredo e autentica só com PKCE. As
URIs de redirecionamento precisam ser `https://` e são comparadas caractere a
caractere.

Dois hosts participam de propósito: a tela de consentimento fica em
`auth.assinafy.com.br` e só recebe um navegador, enquanto os endpoints de
token, revogação e userinfo ficam em `api.assinafy.com.br` e só são chamados de
servidor para servidor. Ambos vêm da descoberta automática, então nada fica
fixo no código.

### O ciclo completo

```ts
import { AssinafyClient, OAuthError } from "@assinafy/chat-sdk/client";

// Nenhuma credencial é necessária — os endpoints OAuth autenticam a aplicação.
const client = new AssinafyClient();

// 1. Antes de redirecionar: gere o par PKCE e o state, e monte a URL de consentimento.
const request = await client.oauth.createAuthorizationUrl({
  clientId: process.env.ASSINAFY_CLIENT_ID!,
  redirectUri: "https://meuapp.example/oauth/callback",
  scopes: ["documents:read", "documents:write", "offline_access"],
});
session.oauth = request;          // guarde o objeto inteiro: o codeVerifier é necessário depois
response.redirect(request.url);   // navegação de página inteira, não fetch()
```

```ts
// 2. Em https://meuapp.example/oauth/callback — valida state e iss por você, e
//    transforma um consentimento recusado em OAuthError("access_denied").
const { code } = client.oauth.readAuthorizationCallback(query, session.oauth);

// 3. Troque o código. Ele é de uso único e expira 60 segundos após o
//    redirecionamento, então faça isso imediatamente.
const tokens = await client.oauth.exchangeCode({
  code,
  codeVerifier: session.oauth.codeVerifier,
  redirectUri: "https://meuapp.example/oauth/callback",
  clientId: process.env.ASSINAFY_CLIENT_ID!,
  clientSecret: process.env.ASSINAFY_CLIENT_SECRET, // omita numa aplicação pública
});

// 4. O token cobre exatamente uma conta. Pergunte qual e guarde o id dela.
const conectado = new AssinafyClient({ accessToken: tokens.access_token });
const [conta] = await conectado.accounts.list();
```

A partir daqui `conectado` é um cliente comum: todo recurso deste README
funciona igual, limitado aos escopos que a pessoa aprovou.

### Mantendo a conexão e desconectando

```ts
const renovado = await client.oauth.refreshToken({
  refreshToken: armazenado.refresh_token!,
  clientId: process.env.ASSINAFY_CLIENT_ID!,
  clientSecret: process.env.ASSINAFY_CLIENT_SECRET,
});
await salvar(renovado.refresh_token);   // antes de qualquer outro uso da resposta

await client.oauth.revokeToken({
  token: armazenado.refresh_token!,
  tokenTypeHint: "refresh_token",
  clientId: process.env.ASSINAFY_CLIENT_ID!,
  clientSecret: process.env.ASSINAFY_CLIENT_SECRET,
});
```

Quatro regras decidem se uma integração OAuth é confiável:

- **Uma conexão é uma conta.** Qualquer outra conta responde `403`, mesmo uma da
  qual a mesma pessoa participa. Um cliente com várias contas conecta cada uma
  separadamente.
- **Tokens de acesso duram uma hora; refresh tokens rotacionam.** Cada refresh
  devolve um novo refresh token e aposenta o anterior. Um refresh token
  reapresentado é indistinguível de um roubado, então o servidor encerra a
  conexão inteira. Persista o novo token **antes** de qualquer outro uso da
  resposta, trate um timeout como "pode ter funcionado" e releia o token
  armazenado, e nunca rode dois refreshes ao mesmo tempo para uma conexão.
- **A conexão expira 30 dias após a aprovação**, por mais que seja renovada.
  Planeje a reconexão.
- **Peça o mínimo.** A pessoa aprova tudo o que você pediu ou nada;
  `offline_access` é o que dá o refresh token, e `openid` o `id_token`. Leia o
  `scope` da resposta em vez de assumir.

### Escopos

| Escopo | Concede |
| --- | --- |
| `documents:read` | Ler documentos, signatários e situação de assinatura |
| `documents:write` | Criar documentos e enviá-los para assinatura — consome créditos de notificação |
| `templates:read` / `templates:write` | Ler / gerenciar templates |
| `account:read` | Ler o nome e as configurações da conta |
| `webhooks:write` | Configurar e desativar a assinatura de webhooks da conta |
| `openid`, `profile`, `email` | Identificar a pessoa; `oauth.getUserInfo()` devolve os claims |
| `offline_access` | Receber um refresh token |

Cobrança, membros da conta, credenciais e administração da plataforma nunca
ficam disponíveis a uma aplicação, qualquer que seja o escopo.

### Erros

`OAuthError` estende `ApiError` e acrescenta `error`, `errorDescription` e —
para uma permissão faltante — `scope`:

```ts
try {
  await conectado.documents.upload(accountId, arquivo);
} catch (error) {
  if (error instanceof OAuthError && error.error === "insufficient_scope") {
    // error.scope nomeia a permissão com a qual reconectar.
  }
}
```

`access_denied` significa que a pessoa recusou; `invalid_grant` significa um
código ou refresh token expirado, reapresentado ou divergente, e exige uma nova
autorização; `invalid_client` significa credenciais de aplicação erradas. Um
token de acesso expirado responde `401` comum — renove e, se falhar, peça a
reconexão.

O [`examples/oauth-connect.ts`](https://github.com/assinafy/chat-sdk/blob/main/examples/oauth-connect.ts)
traz o fluxo inteiro como um servidor `node:http` executável.

> **Disponibilidade.** O OAuth é servido pelo host de produção. O sandbox não o
> expõe, então desenvolva a parte OAuth da integração contra produção, usando
> uma conta de teste dedicada.

---

## 6. A primeira requisição

Todo método de recurso recebe os identificadores de que precisa como argumentos
explícitos, de modo que o próprio cliente permanece sem estado:

```ts
import { AssinafyClient, ApiError } from "@assinafy/chat-sdk/client";

const accountId = process.env.ASSINAFY_ACCOUNT_ID;
if (!accountId) throw new Error("ASSINAFY_ACCOUNT_ID é obrigatório");
const apiKey = process.env.ASSINAFY_API_KEY;
if (!apiKey) throw new Error("ASSINAFY_API_KEY é obrigatório");

const client = new AssinafyClient({
  apiKey,
  accountId,
  baseUrl: "https://sandbox.assinafy.com.br/v1", // omita para produção
});

try {
  const { data: documentos, pagination } = await client.documents.list(accountId, {
    status: "pending_signature",
    perPage: 20,
  });
  console.log(documentos, pagination);
} catch (error) {
  if (error instanceof ApiError) {
    console.error(error.status, error.method, error.path, error.body);
  }
  throw error;
}
```

O `{ data, pagination }` desestruturado e o ramo `ApiError` são consequências
de como o transporte funciona, que é a próxima seção.

---

## 7. Como respostas, paginação, downloads e erros se comportam

Entender estes quatro comportamentos torna o resto do SDK previsível, porque
todo método de recurso os herda.

### Respostas vêm desembrulhadas

A Assinafy envolve respostas JSON em um envelope:

```json
{ "status": 200, "message": "Success", "data": { "id": "id-do-recurso" } }
```

O transporte o remove. Um método de recurso devolve `data` diretamente — aqui,
`{ "id": "id-do-recurso" }`. Um envelope válido sem `data`, e qualquer `204`,
resolvem para `undefined`; os métodos documentados como `void` são exatamente
esses.

Os endpoints OAuth e os documentos `.well-known` são a exceção deliberada: eles
respondem JSON plano, sem envelope, para que bibliotecas OAuth padrão
funcionem. O transporte reconhece a diferença e repassa o objeto intacto.

### Listas são paginadas

Métodos que devolvem uma coleção devolvem tanto os itens quanto os metadados de
paginação lidos dos cabeçalhos `X-Pagination-*`:

```json
{
  "data": [{ "id": "id-do-recurso" }],
  "pagination": { "currentPage": 1, "pageCount": 1, "perPage": 20, "totalCount": 1 }
}
```

`page` precisa ser um inteiro positivo e `perPage` precisa estar entre 1 e 100;
o SDK rejeita valores fora desses limites antes de enviar a requisição, e
codifica `perPage` como o `per-page` da API. Quando você escreveria um laço de
paginação, `documents.iterate()` e `signers.iterate()` são iteradores
assíncronos que percorrem todas as páginas:

```ts
for await (const documento of client.documents.iterate(accountId, { status: "certificated" })) {
  console.log(documento.name);
}
```

### Downloads devolvem a resposta crua

Métodos de artefato devolvem o `Response` nativo, para que você faça stream,
buffer ou pipe conforme a situação exigir:

```ts
const response = await client.documents.download(documentId, "original");
const bytes = new Uint8Array(await response.arrayBuffer());
```

Só o corpo bem-sucedido fica sem parse. Um download que falha continua lançando
`ApiError` antes de qualquer `Response` ser devolvido. Os nomes canônicos de
artefato são `original`, `certificated`, `certificate-page`, `pades` e
`bundle`; miniaturas e imagens de página individuais têm métodos próprios.

### Erros são tipados, e só requisições seguras têm retry

Toda resposta não-2xx lança `ApiError`, carregando `status`, o `body` já
parseado, o `path` requisitado e o `method`. Códigos de acesso de signatário
que apareçam no caminho são redigidos antes de o erro ser construído.

| Classe de erro | Quando é lançada |
| --- | --- |
| `AssinafyError` | Classe base de todo erro que o SDK define |
| `ConfigurationError` | Base URL, combinação de credenciais, configuração de transporte ou argumento de requisição inválido |
| `ApiError` | Qualquer resposta não-2xx da API |
| `OAuthError` | Um `ApiError` cuja resposta trouxe um código de erro OAuth — acrescenta `error`, `errorDescription` e `scope` |
| `NotImplementedError` | Um adapter recebeu uma operação que sua plataforma não suporta |
| `WebhookSignatureError` | Assinatura de webhook inválida ou fora da janela de replay |

Falhas de rede, `408`, `425`, `429` e alguns `5xx` são repetidos com backoff
exponencial, respeitando um `Retry-After` do servidor quando existir. Os
retries valem **apenas** para `GET`, `HEAD` e `OPTIONS`. Requisições que mutam
nunca são repetidas, porque a API não publica contrato de chave de idempotência
e um retry silencioso poderia criar uma solicitação de assinatura duplicada.
Abortar via `RequestInit.signal` cancela também uma espera de retry em curso.

Passe `onRateLimit` para observar os metadados `X-Rate-Limit-*` conforme
chegam; uma exceção lançada por esse observador é engolida, para que nunca
transforme uma requisição bem-sucedida em falha.

---

## 8. O ciclo de vida da assinatura de documentos

Com o transporte entendido, este é o fluxo em torno do qual a API foi
construída. Um documento normalmente passa por estas etapas:

1. Criar ou reutilizar os registros de signatário.
2. Enviar um PDF — no máximo 25 MB e 2.000 páginas.
3. Esperar o processamento de metadados quando o fluxo precisar de coordenadas
   de página.
4. Estimar o custo do assignment e confirmar que a conta tem os recursos.
5. Criar o assignment, o que dispara notificação e assinatura.
6. Acompanhar o progresso por webhook ou por polling limitado.
7. Baixar o artefato certificado quando o status for `certificated`.

O exemplo abaixo é o fluxo completo de assinatura virtual, com polling por
clareza. Fluxos em produção devem preferir uma inscrição de webhook, coberta
mais adiante.

```ts
import { readFile } from "node:fs/promises";
import { AssinafyClient } from "@assinafy/chat-sdk/client";

const client = AssinafyClient.fromEnv();
const accountId = client.accountId;
if (!accountId) throw new Error("ASSINAFY_ACCOUNT_ID é obrigatório");
if (!process.env.ASSINAFY_API_KEY && !process.env.ASSINAFY_ACCESS_TOKEN) {
  throw new Error("ASSINAFY_API_KEY ou ASSINAFY_ACCESS_TOKEN é obrigatório");
}

// 1. Signatários são registros no escopo da conta, reutilizáveis entre documentos.
const signatario = await client.signers.create(accountId, {
  full_name: "Aline Costa",
  email: "signatario@example.test",
});

// 2. Upload. `body` aceita Blob, ArrayBuffer ou Uint8Array — um Buffer do Node
//    é um Uint8Array, então a saída de `readFile` funciona direto.
const documento = await client.documents.upload(accountId, {
  filename: "contrato.pdf",
  body: await readFile("contrato.pdf"),
  contentType: "application/pdf",
});

// 3. O processamento de metadados renderiza as imagens e atribui ids de página.
async function aguardarStatus(
  documentId: string,
  aceitos: ReadonlySet<string>,
  timeoutMs = 120_000,
) {
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    const atual = await client.documents.get(documentId);
    if (aceitos.has(atual.status)) return atual;
    if (["failed", "expired", "rejected_by_signer", "rejected_by_user"].includes(atual.status)) {
      throw new Error(`Documento entrou em status terminal: ${atual.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("Tempo esgotado aguardando o status do documento");
}

await aguardarStatus(documento.id, new Set(["metadata_ready"]));

// 4. Calcule o preço antes de se comprometer.
const estimativa = await client.assignments.estimateCost(documento.id, {
  method: "virtual",
  signers: [{ verification_method: "Email", notification_methods: ["Email"] }],
});
if (estimativa.has_sufficient_resources === false) {
  throw new Error(estimativa.message ?? estimativa.blocking_reason ?? "Recursos insuficientes");
}

// 5. Criar o assignment envia as notificações.
const assignment = await client.assignments.create(documento.id, {
  method: "virtual",
  signers: [
    {
      id: signatario.id,
      verification_method: "Email",
      notification_methods: ["Email"],
      step: 1,
    },
  ],
  message: "Por favor, assine até sexta-feira.",
});

console.log(`Assignment criado: ${assignment.id}`);

// 6 e 7. O signatário completa o link entregue pela Assinafy; em produção,
// retome a partir de um webhook, ou mantenha o polling limitado mostrado aqui.
await aguardarStatus(documento.id, new Set(["certificated"]));
const certificado = await client.documents.download(documento.id, "certificated");
const bytes = new Uint8Array(await certificado.arrayBuffer());
console.log(`Baixados ${bytes.byteLength} bytes certificados`);
```

Signatários que compartilham um `step` assinam em paralelo; um passo só é
ativado quando todos os signatários do anterior assinaram. `verification_method`
seleciona como o signatário comprova identidade e `notification_methods`
seleciona os canais usados para alcançá-lo — o assunto da próxima subseção.

### Métodos de verificação do signatário

Definidos por signatário ao criar o assignment. O método de verificação e o de
notificação são **acoplados**: envie um, os dois ou nenhum — o lado que faltar é
inferido. Sem nenhum dos dois, ambos assumem `Email`.

| Método | Como funciona | Notificação | Custo por signatário |
| --- | --- | --- | --- |
| `Email` *(padrão)* | Código de uso único (OTP) por e-mail, exigido antes de assinar | `Email` | Gratuito |
| `Whatsapp` | Código de uso único (OTP) por WhatsApp | `Whatsapp` (obrigatória) | 0,45 crédito, só em planos pagos |
| `DigitalCertificate` | O signatário assina com o **próprio certificado ICP-Brasil — A1** (arquivo) ou **A3** (token/cartão) — pela extensão de navegador Web PKI, gerando uma assinatura **PAdES qualificada** | `Email` **ou** `Whatsapp` | 2 créditos |

Apenas um método de notificação por signatário. O certificado digital exige
ainda o recurso habilitado na conta (planos Standard e Pro), CPF ou CNPJ em
`government_id`, e que o signatário esteja **sozinho no seu passo**. Um CPF
exige o certificado daquela pessoa; um CNPJ exige o e-CNPJ daquela empresa.

Signatários por certificado digital não completam pelo endpoint comum de
assinatura — ele responde `400`. A assinatura deles vem de um handshake de dois
passos com a extensão Web PKI (`/v1/signers/certificate/start` + `/complete`),
rotas **somente de produção** que o SDK deliberadamente não embrulha, já que
dependem da extensão no navegador do signatário.

### Assignments de coleta posicionam campos na página

`method: "virtual"` pede ao signatário que assine o documento como está.
`method: "collect"` pede também que ele preencha campos nomeados, e por isso
exige que o documento chegue a `metadata_ready` antes: cada posicionamento
referencia um id de página real e é posicionado em pixels sobre a imagem de
página de 150 DPI da Assinafy, medido a partir do canto superior esquerdo.

```ts
const pronto = await client.documents.get(documento.id);
const pagina = pronto.pages![0]!;

await client.assignments.create(documento.id, {
  method: "collect",
  signers: [{ id: signatario.id }],
  entries: [
    {
      page_id: pagina.id,
      fields: [
        {
          signer_id: signatario.id,
          field_id: definicaoDeCampo.id,
          display_settings: { left: 69, top: 282, width: 421, height: 40, fontSize: 12 },
        },
      ],
    },
  ],
});
```

As definições de campo em si são no escopo da conta e reutilizáveis — crie-as
com `client.fields.create()`, liste os tipos disponíveis com
`client.fields.listTypes()` e valide valores antes do envio com
`client.fields.validate()` ou `validateMultiple()`.

### Templates dispensam o upload

Quando o mesmo documento é enviado repetidamente, um template transforma todas
as etapas 2 a 5 em uma única chamada. Templates definem papéis em vez de
signatários, e instanciar um deles vincula um signatário concreto a cada papel:

```ts
const { data: templates } = await client.templates.list(accountId, { perPage: 10 });
const template = await client.templates.get(accountId, templates[0]!.id);
const papel = template.roles![0]!;

const criado = await client.templates.instantiate(accountId, template.id, {
  name: "nda-acme.pdf",
  signers: [{ role_id: papel.id, id: signatario.id }],
});
```

`client.templates.estimateCost()` precifica uma instanciação do mesmo modo que
`assignments.estimateCost()` precifica um assignment direto.

### Tags organizam documentos

Tags são rótulos coloridos no nível da conta, anexados a documentos por id:

```ts
const tag = await client.tags.create(accountId, { name: "Jurídico", color: "#2563EB" });

await client.tags.setForDocument(accountId, documento.id, [tag.id]);   // substitui
await client.tags.addToDocument(accountId, documento.id, [tag.id]);    // acrescenta
await client.tags.removeFromDocument(accountId, documento.id, tag.id); // remove uma
```

`documents.list()` aceita um filtro `tags` e devolve apenas documentos que
carregam **todas** as tags listadas.

### Webhooks substituem o polling

Uma conta tem uma inscrição de webhook. Aponte-a para seu endpoint, liste os
eventos que interessam, e a Assinafy entrega cada um:

```ts
await client.webhooks.updateSubscription(accountId, {
  events: ["document_ready", "signer_signed_document", "document_processing_failed"],
  is_active: true,
  url: "https://example.com/hooks/assinafy",
  email: "ops@example.test",
});
```

`client.webhooks.listEventTypes()` enumera todo evento suportado com sua
descrição. Quando uma entrega falha, `listDispatches()` mostra o histórico de
tentativas com o status HTTP e o corpo da resposta, e `retryDispatch()` reenvia
uma. `inactivate()` interrompe a entrega preservando a URL e a seleção de
eventos — a API não expõe exclusão real de uma inscrição.

Verifique cada entrega antes de confiar nela. O SDK traz as primitivas de HMAC,
de modo que um adapter só escreve o parsing de cabeçalho da sua plataforma:

```ts
import { verifyWebhookSignature } from "@assinafy/chat-sdk/adapters";

verifyWebhookSignature({
  secret: process.env.WEBHOOK_SECRET!,
  body: corpoCruDaRequisicao,   // os bytes crus, antes do parse de JSON
  signature: request.headers["x-signature"] as string,
  timestamp: request.headers["x-timestamp"] as string, // habilita proteção contra replay
});
```

Ela lança `WebhookSignatureError` em divergência, assinatura malformada,
segredo ausente ou timestamp fora da janela de tolerância — cinco minutos por
padrão. `isValidWebhookSignature()` é a mesma checagem devolvendo um booleano. A
assinatura precisa ser calculada sobre o corpo cru: fazer parse e re-serializar
o JSON antes muda os bytes e quebra a verificação.

### O fluxo do signatário

Tudo acima é o lado do titular da conta. Os signatários autenticam com um
`signer-access-code` que a Assinafy entregou fora de banda, e nunca com uma
chave de API — então essas chamadas usam um cliente não autenticado:

```ts
const publicClient = new AssinafyClient({ baseUrl: "https://sandbox.assinafy.com.br/v1" });

const eu = await publicClient.signature.self(accessCode);
await publicClient.signature.verify(accessCode, otpDoEmail);
const contexto = await publicClient.signature.signContext(accessCode);
await publicClient.signature.sign(documentId, assignmentId, accessCode, entries);
```

`SignatureResource` cobre o fluxo inteiro: buscar o próprio registro do
signatário, aceitar termos, verificar o código de uso único, enviar imagem de
assinatura ou rubrica, recuperar o contexto de assinatura, listar e buscar os
documentos do signatário, baixar artefatos, e assinar ou recusar — um documento
por vez ou vários de uma vez. Signatários por certificado digital precisam
confirmar seus dados e aceitar os termos antes de pedir o contexto de
assinatura, o que `client.signers.confirmDataForDocument()` faz numa chamada só.

Documentos também podem ser liberados sem código algum:
`client.documents.publicGet()` busca um resumo público,
`client.documents.verify()` valida um hash de assinatura sem credencial, e
`client.documents.sendPublicToken()` pede à Assinafy que entregue um novo token
de acesso:

```ts
await publicClient.documents.sendPublicToken(documentId, { email: "signatario@example.test" });
```

Essa requisição é enviada exatamente uma vez e nunca repetida, porque pode
disparar um e-mail ou uma mensagem de WhatsApp.

### Trate códigos de acesso como credenciais

Um código de acesso de signatário, e qualquer URL que o contenha, é uma
credencial bearer para aquele documento. Mantenha ambos fora de logs, analytics,
mensagens de exceção, controle de versão e qualquer armazenamento visível ao
cliente que a interface de assinatura não exija. Envie-os apenas por HTTPS,
evite colocá-los em URLs de redirecionamento de terceiros, defina um
`Referrer-Policy` restritivo como `no-referrer` nas páginas voltadas ao
signatário, e redija query strings antes de registrar caminhos de requisição. O
SDK já os redige de `ApiError.path`, mas só sua aplicação controla o resto.
Sempre que possível, deixe a Assinafy entregar os links de assinatura pelos
canais de notificação configurados em vez de manipular os códigos você mesmo.

---

## 9. Construindo um fluxo de chat

A camada de chat embrulha o mesmo cliente em formato conversacional. Quatro
peças se encaixam:

- **`Chat`** recebe eventos normalizados e os roteia para seus handlers.
- **Um adapter** conecta o `Chat` a uma plataforma de mensagens e normaliza os
  payloads dela. O pacote traz um adapter em memória; adapters de produção
  implementam o mesmo contrato `ChatAdapter`.
- **`Thread`** é o handle por conversa que todo handler recebe.
- **Um backend de estado** guarda as inscrições de thread e dados chave/valor
  por thread. A implementação em memória vem incluída; backends Redis ou
  Postgres implementam o mesmo contrato `ChatState`.

```ts
import {
  AssinafyClient,
  Card,
  Chat,
  DocumentPreview,
  MemoryStateAdapter,
  createMemoryAdapter,
} from "@assinafy/chat-sdk";

const client = AssinafyClient.fromEnv();
if (!process.env.ASSINAFY_API_KEY && !process.env.ASSINAFY_ACCESS_TOKEN) {
  throw new Error("ASSINAFY_API_KEY ou ASSINAFY_ACCESS_TOKEN é obrigatório");
}

const memory = createMemoryAdapter();
const chat = new Chat({
  userName: "Assinafy Bot",
  adapters: { memory },
  state: new MemoryStateAdapter(),
  client,
});

chat.onCommand("status", async (thread, message) => {
  const documentId = message.text.replace(/^[/!]status\s*/i, "").trim();
  const documento = await client.documents.get(documentId);
  await thread.post(
    Card({
      title: "Situação do documento",
      children: [
        DocumentPreview({
          documentId: documento.id,
          name: documento.name,
          status: documento.status,
          signingUrl: documento.signing_url ?? undefined,
        }),
      ],
    }),
  );
});

await memory.receive({ text: "/status doc_01J00000000000000000000000", isMention: true });
console.log(memory.lastSent);
```

Uma mensagem de entrada é oferecida aos handlers registrados numa ordem fixa de
prioridade, e a primeira categoria que casar vence: comandos de barra
(`onCommand`), depois casamentos por regex (`onNewMessage`), depois follow-ups
em uma thread inscrita (`onSubscribedMessage`), depois menções explícitas
(`onNewMention`) e, por fim, o catch-all (`onFallback`). Cliques de botão e
eventos semelhantes vão para `onAction`.

É a terceira regra que faz conversas de vários turnos funcionarem. Chamar
`thread.subscribe()` marca a thread como uma que o bot está acompanhando, de
modo que as mensagens seguintes chegam a `onSubscribedMessage` sem precisar de
outra menção. `thread.get()`, `set()` e `delete()` guardam dados por thread — o
documento em que a pessoa está trabalhando, por exemplo — pelo mesmo backend de
estado.

### Cards renderizam em qualquer lugar

Um card é uma estrutura JSON simples, não marcação de plataforma, então a mesma
mensagem pode ser entregue a uma plataforma de chat que renderiza blocos ricos,
a um e-mail que precisa de HTML e a uma CLI que precisa de texto puro. Quinze
tipos de elemento estão disponíveis: `card`, `text`, `heading`, `divider`,
`section`, `fields`, `link-button`, `button`, `actions`, `image`, `table`,
`select`, `radio-select`, `document-preview` e `signer-status`. Os dois últimos
são conveniências específicas da Assinafy.

```ts
import {
  Card, Heading, Text, Divider, Actions, LinkButton, Button,
  renderText, renderMarkdown, renderHtml,
} from "@assinafy/chat-sdk/cards";

const mensagem = Card({
  title: "Documento enviado",
  children: [
    Heading(2, "contrato.pdf"),
    Text("Enviado para signatario@example.test para assinatura."),
    Divider(),
    Actions([
      LinkButton({ label: "Abrir", url: signingUrl }),
      Button({ id: "lembrar", label: "Lembrar", style: "secondary" }),
    ]),
  ],
});

renderText(mensagem);     // SMS, e-mail simples, CLI
renderMarkdown(mensagem); // plataformas de chat com Markdown
renderHtml(mensagem);     // e-mail HTML, visualizações web
```

Os builders são exportados tanto com nomes capitalizados (`Card`, `Text`)
quanto com apelidos minúsculos (`card`, `text`). Um adapter que suporte
mensagens ricas nativas pode percorrer as mesmas primitivas para emitir o
próprio formato em vez de usar estes renderizadores. O renderizador HTML escapa
todo texto e restringe `href` e `src` a `http`, `https`, `mailto` e `tel`, de
modo que uma URL hostil no nome de um documento não vire execução de script.

---

## 10. Dirigindo a API a partir de um LLM

`createChatTools(client)` devolve 36 descritores de ferramenta neutros de
provedor — as operações de leitura e escrita de que um assistente
conversacional realmente precisa. Cada descritor carrega um `name`, uma
`description`, um JSON Schema exposto tanto como `input_schema` (nome do campo
na Anthropic) quanto como `parameters` (na OpenAI), e um `execute()` que valida
seus argumentos antes de chamar o cliente.

```ts
import { createChatTools, runTool } from "@assinafy/chat-sdk/ai";

const tools = createChatTools(client, {
  include: ["list_documents", "get_document", "document_activities"],
});

const resultado = await runTool(tools, "list_documents", { status: "pending_signature" });
```

As opções `include` e `exclude` controlam a superfície que o modelo enxerga, e
é assim que se mantém um assistente somente-leitura. Argumentos vindos de um
modelo são entrada não confiável, então `execute()` os valida contra o schema —
tipos, enums, limites, campos obrigatórios e os formatos `email`, `uri` e
`date-time` — antes de qualquer requisição. Definir `accountId` no cliente, ou
em `createChatTools`, permite que o modelo o omita em toda chamada.

O SDK nunca importa um pacote de provedor de LLM e nunca roda o laço de
ferramentas por conta própria; sua aplicação mantém o controle da conversa. O
exemplo [`examples/ai-bot.ts`](https://github.com/assinafy/chat-sdk/blob/main/examples/ai-bot.ts)
mostra um laço completo de tool call contra a Anthropic usando apenas o `fetch`
embutido do Node.

---

## 11. Exemplos

Os exemplos importam o código-fonte do repositório diretamente e têm seus tipos
verificados na CI por `tsconfig.examples.json`:

- [`examples/basic-bot.ts`](https://github.com/assinafy/chat-sdk/blob/main/examples/basic-bot.ts)
  — um bot `/status` em memória, a menor ligação completa.
- [`examples/live-cli.ts`](https://github.com/assinafy/chat-sdk/blob/main/examples/live-cli.ts)
  — um REPL `/docs` e `/status` sobre o sandbox, que valida credenciais antes de
  iniciar.
- [`examples/ai-bot.ts`](https://github.com/assinafy/chat-sdk/blob/main/examples/ai-bot.ts)
  — o laço de tool call com a Anthropic descrito acima.
- [`examples/oauth-connect.ts`](https://github.com/assinafy/chat-sdk/blob/main/examples/oauth-connect.ts)
  — o ciclo OAuth completo sobre `node:http`: consentimento, callback, troca do
  código, uma chamada autenticada, renovação e revogação.

Rode um deles com as dependências de desenvolvimento do repositório instaladas:

```bash
ASSINAFY_API_KEY=... \
ASSINAFY_ACCOUNT_ID=... \
ASSINAFY_BASE_URL=https://sandbox.assinafy.com.br/v1 \
npx tsx examples/live-cli.ts
```

`examples/ai-bot.ts` lê ainda `ANTHROPIC_API_KEY` e, opcionalmente,
`ANTHROPIC_MODEL` para sobrescrever seu padrão `claude-sonnet-5`.
`examples/oauth-connect.ts` lê `ASSINAFY_CLIENT_ID`, `ASSINAFY_REDIRECT_URI` e,
opcionalmente, `ASSINAFY_CLIENT_SECRET`, e precisa de um túnel https porque
`http://localhost` não pode ser registrado como URI de redirecionamento.

---

## 12. Desenvolvimento e verificação

Um comando roda tudo o que a CI roda — verificação de tipos do código-fonte,
dos testes e dos exemplos; lint; testes unitários com limites de cobertura; o
build; e um smoke test que carrega a saída ES module e CommonJS de cada ponto
de entrada e confere que as exportações batem:

```bash
npm run verify
```

A suíte ao vivo é separada porque conversa com a rede. Ela tem duas metades: a
suíte de sandbox, que precisa de credenciais e se pula sozinha sem elas, e uma
suíte de contrato sem credenciais, que lê o documento OpenAPI de produção e os
endpoints públicos de descoberta OAuth.

```bash
npm run test:integration
```

A metade de sandbox cria e apaga recursos descartáveis — signatários,
documentos, campos, tags e uma conta temporária — e exercita CRUD de conta,
upload de logo e mutação de webhook. Rode-a apenas contra uma conta de sandbox
dedicada, nunca produção; a suíte recusa qualquer base URL que não seja o host
de sandbox.

Dois testes ficam atrás de `ASSINAFY_TEST_NOTIFICATIONS=1` porque fazem a
Assinafy enviar notificações reais: instanciação de template e o caminho feliz
completo de assinatura. Habilitá-los exige também
`ASSINAFY_TEST_EMAIL_PRIMARY` e `ASSINAFY_TEST_EMAIL_SECONDARY`.

| Variável | Padrão | Propósito |
| --- | --- | --- |
| `ASSINAFY_TEST_NOTIFICATIONS` | `0` | Defina `1` apenas para uma execução que pode enviar notificações no sandbox |
| `ASSINAFY_TEST_EMAIL_PRIMARY` | nenhum | Primeiro destinatário; obrigatório só quando as notificações estão habilitadas |
| `ASSINAFY_TEST_EMAIL_SECONDARY` | nenhum | Segundo destinatário; mesma condição |

Testes unitários e a verificação de tipos dos exemplos não precisam de rede nem
de credenciais.

A CI roda verificação de tipos, lint, testes unitários e empacotamento em todo push e
pull request. Tags de release repetem a verificação e publicam o mesmo artefato
no npm com procedência OIDC e no GitHub Packages.

---

## Licença

MIT — veja [LICENSE](./LICENSE).
