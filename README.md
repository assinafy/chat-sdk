# @assinafy/chat-sdk

*Português · [Read in English](README.en.md)*

[![CI](https://github.com/assinafy/chat-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/assinafy/chat-sdk/actions/workflows/ci.yml)
[![CodeQL](https://github.com/assinafy/chat-sdk/actions/workflows/codeql.yml/badge.svg)](https://github.com/assinafy/chat-sdk/actions/workflows/codeql.yml)
[![npm version](https://img.shields.io/npm/v/@assinafy/chat-sdk.svg)](https://www.npmjs.com/package/@assinafy/chat-sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

SDK TypeScript para a API de assinatura de documentos Assinafy v1 — plataforma brasileira de
assinatura eletrônica — e para construir fluxos de assinatura conversacionais sobre ela.

> **Referência completa em inglês.** Este documento cobre o conteúdo do pacote, instalação,
> autenticação e as camadas principais. O guia completo, escrito para ser lido de ponta a ponta, está
> em **[README.en.md](README.en.md)**.

## 1. O que há no pacote

O SDK é um pacote com duas metades que podem ser usadas de forma independente.

**O cliente da API** cobre a API REST Assinafy v1: **89 operações em 67 caminhos**, agrupadas em onze
recursos — contas, autenticação, usuários, signatários, documentos, tags, templates, assignments,
campos, o fluxo de assinatura do signatário e webhooks. Toda operação é tipada, e o transporte cuida
da autenticação, do envelope de resposta, da paginação, dos metadados de rate limit, dos retries e do
mapeamento de erros.

**A camada de chat** transforma essas operações em fluxos conversacionais: um orquestrador `Chat` que
roteia mensagens de entrada para handlers, uma visão `Thread` entregue a cada handler, um contrato de
adapter para conectar plataformas de mensagem, um contrato de estado plugável para assinaturas e
armazenamento por thread, um sistema declarativo de cards com renderizadores de texto, Markdown e
HTML, e 36 descritores de ferramenta neutros de provedor para tool calling de LLM.

Dois documentos de referência acompanham este e vão mais fundo:

- **[Referência da API](./docs/API_REFERENCE.md)** — todo método público com seu modo de
  autenticação, payloads completos de requisição e resposta, as superfícies de chat, card, adapter e
  estado, e o catálogo completo de ferramentas de IA.
- **[Índice de operações](./docs/API_COVERAGE.md)** — as 89 operações publicadas mapeadas ao método
  do SDK, mais os pontos em que a superfície HTTP do SDK vai além do documento publicado.

O contrato upstream com autoridade é a
[documentação oficial da API Assinafy](https://api.assinafy.com.br/v1/docs).

## 2. Requisitos e escopo de runtime

Aplicações de servidor e os exemplos deste repositório têm como alvo o **Node.js 24 LTS**, que é o
que o campo `engines` do pacote exige e o que a CI roda.

Nem todo ponto de entrada precisa de Node. O pacote publica subcaminhos focados, para que um bundle
de browser ou edge possa trazer apenas o cliente REST:

| Import | Conteúdo | Roda em |
| --- | --- | --- |
| `@assinafy/chat-sdk/client` | Cliente REST Assinafy v1 | Node 24, Bun, Deno e browsers com as APIs Fetch padrão |
| `@assinafy/chat-sdk/cards` | Tipos, builders e renderizadores de card | Qualquer runtime JavaScript |
| `@assinafy/chat-sdk/state` | Contrato de estado e implementação em memória | Qualquer runtime JavaScript |
| `@assinafy/chat-sdk/ai` | Descritores de ferramenta e helpers de mensagem | Qualquer runtime JavaScript |
| `@assinafy/chat-sdk/adapters` | Contratos de adapter, adapter em memória, verificação HMAC | Node.js — a verificação de webhook importa `node:crypto` |
| `@assinafy/chat-sdk` | Tudo acima | Node.js, porque a raiz reexporta os helpers de webhook |

A regra prática: se um bundle só conversa com a API, importe `@assinafy/chat-sdk/client` e nada mais.
Tanto ES modules quanto CommonJS são publicados, com declarações de tipo para cada um.

## 3. Instalação

Pelo npm:

```bash
npm install @assinafy/chat-sdk
```

Todo release também é publicado no GitHub Packages. Para instalar de lá, aponte o escopo `@assinafy`
para aquele registry em um `.npmrc` local do projeto:

```ini
@assinafy:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Depois instale normalmente — o mapeamento de escopo faz o roteamento.

## 4. Configuração e autenticação

O cliente autentica com uma chave de API de vida longa enviada como `X-Api-Key`, ou com um token de
acesso bearer obtido de `auth.login()`. Os dois são mutuamente exclusivos — passar ambos lança
`ConfigurationError`.

```ts
import { AssinafyClient } from "@assinafy/chat-sdk/client";

new AssinafyClient({ apiKey: "chave-de-api" });
new AssinafyClient({ accessToken: "token-bearer" });
```

`AssinafyClient.fromEnv()` lê as mesmas configurações do ambiente, que é o que os exemplos e a suíte
de testes usam:

| Variável | Padrão | Propósito |
| --- | --- | --- |
| `ASSINAFY_API_KEY` | nenhum | Chave de API, enviada como `X-Api-Key` |
| `ASSINAFY_ACCESS_TOKEN` | nenhum | Token bearer, usado no lugar da chave de API |
| `ASSINAFY_BASE_URL` | `https://api.assinafy.com.br/v1` | Use `https://sandbox.assinafy.com.br/v1` para o sandbox |
| `ASSINAFY_ACCOUNT_ID` | nenhum | ID de conta padrão, legível de volta em `client.accountId` |

Construir sem credencial nenhuma é **deliberado e suportado**: um cliente não autenticado é o que
você usa para `auth.login()`, verificação pública de documento, e os endpoints do signatário que
autenticam com um código de acesso de signatário.

Além das credenciais, o construtor aceita configurações de transporte — um `fetch` customizado,
`maxRetries`, `retryBaseDelayMs`, sobrescrita de `userAgent` e um observador `onRateLimit`. Todos são
opcionais e todos são repassados ao `HttpClient` subjacente.

Nunca comite credenciais. Use uma conta de sandbox dedicada para desenvolvimento e rotacione qualquer
chave exposta.

## Métodos de verificação do signatário

Definidos por signatário ao criar o assignment. O método de verificação e o de notificação são
**acoplados**: envie um, os dois ou nenhum — o lado que faltar é inferido. Sem nenhum dos dois, ambos
assumem `Email`.

| Método | Como funciona | Custo por signatário |
| --- | --- | --- |
| `Email` *(padrão)* | Código de uso único (OTP) por e-mail, exigido antes de assinar | Gratuito |
| `Whatsapp` | Código de uso único (OTP) por WhatsApp | Verificação gratuita; notificação 0,45 crédito, só em planos pagos |
| `DigitalCertificate` | O signatário assina com o **próprio certificado ICP-Brasil (A1/A3)**, pela extensão de navegador Web PKI, gerando uma assinatura **PAdES qualificada** | 2 créditos |

Combinações permitidas: `Email` → notifica por `Email`; `Whatsapp` → notifica por `Whatsapp`;
`DigitalCertificate` → notifica por `Email` **ou** `Whatsapp`. Apenas um método de notificação por
signatário.

O certificado digital exige o recurso na conta (planos Standard e Pro), CPF ou CNPJ em
`government_id`, e que o signatário esteja **sozinho no seu passo**. Signatários por certificado não
completam pelo endpoint comum de assinatura: a assinatura deles vem de um handshake de dois passos
com a extensão Web PKI (`/v1/signers/certificate/start` + `/complete`), rotas **somente de
produção** — o sandbox não as expõe.

## Trate códigos de acesso como credenciais

Os endpoints do signatário autenticam com um `signer-access-code` por signatário. Ele chega ao
signatário apenas na notificação enviada pela API, e dá acesso ao documento daquela pessoa — trate-o
com o mesmo cuidado de uma credencial: não registre em log, não persista além do necessário, e não o
encaminhe para fora do fluxo de assinatura.

## Trilha de atividades e artefatos

As atividades de um documento devolvem todos os eventos registrados, cada um com um snapshot do
`payload` do evento e a `origin` da requisição (`ip`, `user-agent`).

| Artefato | Conteúdo |
| --- | --- |
| `original` | O PDF enviado, como recebido |
| `certificated` | O documento assinado, com a certificação da plataforma |
| `certificate-page` | Apenas a página de certificação |
| `pades` | Assinaturas ICP-Brasil dos signatários + caixa de certificação — só existe em documentos que tiveram signatários por certificado digital |
| `bundle` | Zip com `original`, `certificated` e `certificate-page`, mais o `pades` quando houver |

## Documentação

- **[README.en.md](README.en.md)** — guia completo, em inglês
- [docs/API_REFERENCE.md](./docs/API_REFERENCE.md) — referência por método
- [docs/API_COVERAGE.md](./docs/API_COVERAGE.md) — índice de operações
- [Documentação da API](https://api.assinafy.com.br/v1/docs)

## Licença

Distribuído sob a licença [MIT](LICENSE).
