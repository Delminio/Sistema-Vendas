# ERP Fiscal Pro

Sistema web + desktop com login, dashboard, estoque, PDV, leitor de código de barras por teclado, DANFE PDF prévia, XML prévio e base para emissão fiscal real depois.

## Login inicial

Email: `admin@admin.com`  
Senha: `admin123`

## Rodar local

Precisa de PostgreSQL. Crie um `.env` a partir do `.env.example`.

```bash
npm install
npm run dev
```

Acesse `http://localhost:5173`.

## Deploy Render

1. Crie um Blueprint ou Web Service no Render.
2. Use o `render.yaml`.
3. Configure `DATABASE_URL`, `JWT_SECRET` e `CORS_ORIGIN`.
4. Depois que o backend subir, copie a URL da API.

## Deploy Vercel

Configure a variável:

```env
VITE_API_URL=https://sua-api-render.onrender.com
```

Build command:

```bash
npm run build
```

Output:

```bash
dist
```

## Nota fiscal real

A emissão real de NF-e, NFC-e e NFS-e ficou preparada para a última etapa. O sistema agora gera apenas XML e DANFE/recibo sem valor fiscal.
