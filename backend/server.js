require('dotenv').config()
const express = require('express')
const cors = require('cors')
const { z } = require('zod')
const db = require('./db')
const FiscalService = require('./services/fiscalService')

const app = express()
app.use(cors())
app.use(express.json())

const produtoSchema = z.object({ nome: z.string().min(2), preco: z.number().positive(), estoque: z.number().nonnegative(), ncm: z.string().optional().default(''), cfop: z.string().optional().default(''), unidade: z.string().optional().default('UN') })
const clienteSchema = z.object({ nome: z.string().min(2), documento: z.string().optional().default(''), email: z.string().optional().default(''), telefone: z.string().optional().default('') })
const vendaSchema = z.object({ cliente_id: z.number().int().nullable().optional(), itens: z.array(z.object({ produto_id: z.number().int(), quantidade: z.number().positive() })).min(1) })

function validate(schema, body) {
  const parsed = schema.safeParse(body)
  if (!parsed.success) throw Object.assign(new Error(parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')), { status: 400 })
  return parsed.data
}

function vendaCompleta(id) {
  const venda = db.prepare('SELECT * FROM vendas WHERE id = ?').get(id)
  if (!venda) return null
  const cliente = venda.cliente_id ? db.prepare('SELECT * FROM clientes WHERE id = ?').get(venda.cliente_id) : null
  const itens = db.prepare(`SELECT vi.*, p.nome, p.ncm, p.cfop, p.unidade FROM venda_itens vi JOIN produtos p ON p.id = vi.produto_id WHERE vi.venda_id = ?`).all(id)
  return { ...venda, cliente, itens }
}

app.get('/health', (_, res) => res.json({ ok: true }))

app.post('/produtos', (req, res, next) => { try { const data = validate(produtoSchema, req.body); const r = db.prepare('INSERT INTO produtos (nome, preco, estoque, ncm, cfop, unidade) VALUES (@nome,@preco,@estoque,@ncm,@cfop,@unidade)').run(data); res.status(201).json({ id: r.lastInsertRowid, ...data }) } catch(e){ next(e) } })
app.get('/produtos', (_, res) => res.json(db.prepare('SELECT * FROM produtos ORDER BY id DESC').all()))
app.delete('/produtos/:id', (req, res) => { db.prepare('DELETE FROM produtos WHERE id=?').run(req.params.id); res.json({ ok:true }) })

app.post('/clientes', (req, res, next) => { try { const data = validate(clienteSchema, req.body); const r = db.prepare('INSERT INTO clientes (nome, documento, email, telefone) VALUES (@nome,@documento,@email,@telefone)').run(data); res.status(201).json({ id: r.lastInsertRowid, ...data }) } catch(e){ next(e) } })
app.get('/clientes', (_, res) => res.json(db.prepare('SELECT * FROM clientes ORDER BY id DESC').all()))

app.post('/vendas', (req, res, next) => {
  try {
    const trx = db.transaction((body) => {
      const data = validate(vendaSchema, body)
      let total = 0
      const itens = data.itens.map(item => {
        const p = db.prepare('SELECT * FROM produtos WHERE id=?').get(item.produto_id)
        if (!p) throw Object.assign(new Error('Produto não encontrado'), { status: 404 })
        if (p.estoque < item.quantidade) throw Object.assign(new Error(`Estoque insuficiente: ${p.nome}`), { status: 400 })
        const subtotal = Number((p.preco * item.quantidade).toFixed(2))
        total += subtotal
        return { p, quantidade: item.quantidade, subtotal }
      })
      total = Number(total.toFixed(2))
      const venda = db.prepare('INSERT INTO vendas (cliente_id,total) VALUES (?,?)').run(data.cliente_id || null, total)
      for (const i of itens) {
        db.prepare('INSERT INTO venda_itens (venda_id, produto_id, quantidade, preco_unitario, subtotal) VALUES (?,?,?,?,?)').run(venda.lastInsertRowid, i.p.id, i.quantidade, i.p.preco, i.subtotal)
        db.prepare('UPDATE produtos SET estoque = estoque - ? WHERE id = ?').run(i.quantidade, i.p.id)
      }
      return vendaCompleta(venda.lastInsertRowid)
    })
    res.status(201).json(trx(req.body))
  } catch(e){ next(e) }
})
app.get('/vendas', (_, res) => res.json(db.prepare('SELECT * FROM vendas ORDER BY id DESC').all()))
app.get('/vendas/:id', (req,res)=>{ const v = vendaCompleta(req.params.id); if(!v) return res.status(404).json({erro:'Venda não encontrada'}); res.json(v) })

app.post('/vendas/:id/emitir/:tipo', async (req, res, next) => {
  try {
    const tipo = String(req.params.tipo).toUpperCase()
    if (!['NFE','NFCE','NFSE'].includes(tipo)) return res.status(400).json({ erro: 'Use NFE, NFCE ou NFSE' })
    const venda = vendaCompleta(req.params.id)
    if (!venda) return res.status(404).json({ erro: 'Venda não encontrada' })
    const fiscal = await FiscalService.emitir(tipo, venda)
    db.prepare('UPDATE vendas SET fiscal_tipo=?, fiscal_status=?, fiscal_chave=?, fiscal_protocolo=? WHERE id=?').run(tipo, fiscal.status || 'ENVIADA', fiscal.chave || null, fiscal.protocolo || null, venda.id)
    res.json({ venda: vendaCompleta(venda.id), fiscal })
  } catch(e){ next(e) }
})

app.use((err, req, res, next) => { console.error(err); res.status(err.status || 500).json({ erro: err.message || 'Erro interno' }) })

const port = process.env.PORT || 3000
app.listen(port, () => console.log(`Backend em http://localhost:${port}`))
