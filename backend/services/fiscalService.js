const axios = require('axios')

class FiscalService {
  static montarPayload(tipo, venda) {
    return {
      ambiente: process.env.FISCAL_AMBIENTE || 'homologacao',
      tipo,
      empresa: {
        cnpj: process.env.EMPRESA_CNPJ,
        ie: process.env.EMPRESA_IE,
        im: process.env.EMPRESA_IM,
        razao_social: process.env.EMPRESA_RAZAO_SOCIAL,
        uf: process.env.EMPRESA_UF,
        municipio: process.env.EMPRESA_MUNICIPIO
      },
      venda: {
        id: venda.id,
        total: venda.total,
        cliente: venda.cliente,
        itens: venda.itens
      }
    }
  }

  static async emitir(tipo, venda) {
    const payload = this.montarPayload(tipo, venda)

    if ((process.env.FISCAL_PROVIDER || 'mock') === 'mock') {
      return {
        status: 'AUTORIZADA_MOCK',
        tipo,
        chave: `${tipo}-MOCK-${Date.now()}-${venda.id}`,
        protocolo: `PROTOCOLO-MOCK-${Date.now()}`,
        mensagem: 'Nota simulada. Configure um provedor fiscal real para transmitir para SEFAZ/Prefeitura.',
        payload
      }
    }

    const urlByType = {
      NFE: `${process.env.FISCAL_API_URL}/nfe`,
      NFCE: `${process.env.FISCAL_API_URL}/nfce`,
      NFSE: `${process.env.FISCAL_API_URL}/nfse`
    }

    const response = await axios.post(urlByType[tipo], payload, {
      headers: {
        Authorization: `Bearer ${process.env.FISCAL_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    })

    return response.data
  }
}

module.exports = FiscalService
