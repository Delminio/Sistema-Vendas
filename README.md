# ERP Fiscal

Sistema desktop com Electron + React + Node.js + SQLite.

## Rodar

```bash
npm install
cp .env.example .env
npm run dev
```

## Emissão fiscal

Por padrão está em `FISCAL_PROVIDER=mock`, ou seja, simula NF-e, NFC-e e NFS-e.

Para emissão real, contrate um provedor fiscal e configure `.env`:

```env
FISCAL_PROVIDER=api
FISCAL_API_URL=https://api.seuprovedor.com
FISCAL_API_TOKEN=SEU_TOKEN
```

O arquivo principal de integração fica em:

```txt
backend/services/fiscalService.js
```

## Tipos suportados

- NF-e: `/vendas/:id/emitir/NFE`
- NFC-e: `/vendas/:id/emitir/NFCE`
- NFS-e: `/vendas/:id/emitir/NFSE`

## Observação importante

NF-e, NFC-e e NFS-e reais precisam de certificado, dados fiscais corretos, regime tributário, NCM, CFOP, CST/CSOSN, alíquotas e autorização SEFAZ/Prefeitura. Este projeto deixa a estrutura pronta para plugar no provedor fiscal.
