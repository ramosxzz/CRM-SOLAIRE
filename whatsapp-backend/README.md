# Solaire WhatsApp Backend

Backend de disparo usado pelo CRM em `https://solaire.raminhos6899.workers.dev`.

## Endpoints usados pelo CRM

- `GET /health`
- `GET /api/whatsapp/sessions`
- `POST /api/whatsapp/start`
- `POST /api/whatsapp/send-batch`
- `POST /api/whatsapp/logout/:id`
- `DELETE /api/whatsapp/session/:id`

## Subir no Portainer

1. Crie uma nova stack no Portainer.
2. Use o conteudo de `docker-compose.yml`.
3. Suba a stack.
4. Aponte o proxy/dominio `https://api.solairesolar.com.br` para a porta `3001` desse container.
5. Teste:

```bash
curl https://api.solairesolar.com.br/health
```

Resposta esperada:

```json
{"ok":true,"service":"solaire-whatsapp-backend","sessions":0}
```

## Importante

O volume `solaire_whatsapp_data` guarda as sessoes do WhatsApp. Se esse volume for apagado, os vendedores precisam escanear o QR Code de novo.
