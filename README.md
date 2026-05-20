# CRM Solaire

CRM operacional da Solaire Energia Solar para gestao comercial, engenharia, leads, disparos via WhatsApp e acompanhamento interno.

## Visao Geral

O projeto concentra a operacao diaria em uma interface web unica, com areas separadas para gestor, vendedores, engenharia e ferramentas administrativas. A aplicacao principal roda como site estatico/Worker e conversa com Supabase e com um backend separado para conexao do WhatsApp.

## Principais Recursos

- Kanban de leads por etapa comercial.
- Area do gestor com visao geral da operacao.
- Area de vendedores com carteira, notificacoes e acoes rapidas.
- Area de engenharia para acompanhamento de projetos.
- Central de WhatsApp com QR Code, sessoes e disparos.
- Aba DEV para diagnostico tecnico dos disparos.
- Bloco de notas interno para vendedor, gestor e engenharia.
- Filtro e classificacao de leads, incluindo numeros invalidos.
- Worker Cloudflare para servir o CRM e fazer proxy do backend WhatsApp.

## Estrutura

```text
.
├── index.html                         # Aplicacao principal do CRM
├── worker.js                          # Worker Cloudflare e proxy do backend
├── wrangler.toml                      # Configuracao de deploy Cloudflare
├── sw.js                              # Service worker
├── manifest.webmanifest               # Manifest PWA
├── supabase-push-subscriptions.sql    # Estrutura SQL de notificacoes
└── whatsapp-backend/
    ├── server.js                      # API WhatsApp/Baileys
    ├── package.json
    ├── Dockerfile
    └── docker-compose.yml
```

## Requisitos

- Node.js 20 ou superior.
- Conta Cloudflare com Wrangler configurado.
- Projeto Supabase configurado.
- Servidor Docker para o backend WhatsApp.

## Rodando o CRM

Instale dependencias:

```bash
npm install
```

Para deploy no Cloudflare Workers/Pages com assets:

```bash
npx wrangler deploy
```

As variaveis publicas usadas pelo Worker ficam em `wrangler.toml`:

- `SUPABASE_URL`
- `VAPID_PUBLIC_KEY`
- `VAPID_SUBJECT`
- `WHATSAPP_BACKEND_URL`

Chaves privadas e tokens nao devem ser commitados. Use secrets do Cloudflare/Supabase quando necessario.

## Secrets

Configure chaves sensiveis fora do Git:

Cloudflare Worker:

- `SUPABASE_SERVICE_ROLE_KEY`
- `VAPID_PRIVATE_KEY`

## Backend WhatsApp

O backend fica em `whatsapp-backend/` e expoe endpoints como:

- `GET /health`
- `GET /api/whatsapp/sessions`
- `POST /api/whatsapp/start`
- `POST /api/whatsapp/send-batch`
- `POST /api/whatsapp/logout/:id`
- `DELETE /api/whatsapp/session/:id`

Para rodar via Docker Compose:

```bash
cd whatsapp-backend
docker compose up -d
```

Por padrao, o backend sobe na porta `3001`.

## Deploy Recomendado

1. Publique o CRM pelo Wrangler.
2. Suba o backend WhatsApp no servidor Docker/Umbrel.
3. Aponte um Cloudflare Tunnel para o backend.
4. Configure `WHATSAPP_BACKEND_URL` para o dominio publico do backend.
5. No CRM, conecte a sessao WhatsApp lendo o QR Code.

## Observacoes de Dados

Arquivos CSV/XLSX de leads foram ignorados de proposito no Git. Eles podem conter nomes, telefones e informacoes comerciais. Mantenha essas bases fora do repositorio e importe apenas em ambientes controlados.
