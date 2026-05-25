import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { Pool } from 'pg'
import PDFDocument from 'pdfkit'
import { create } from 'xmlbuilder2'

const app = express()
const PORT = process.env.PORT || 3000
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret'
const ORIGIN = process.env.CORS_ORIGIN || '*'

app.use(cors({ origin: ORIGIN === '*' ? true : ORIGIN, credentials: true }))
app.use(express.json({ limit: '10mb' }))

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL?.includes('render.com') ? { rejectUnauthorized: false } : false })
const q = (text, params=[]) => pool.query(text, params)

async function init(){
  await q(`CREATE TABLE IF NOT EXISTS usuarios(id SERIAL PRIMARY KEY,nome TEXT NOT NULL,email TEXT UNIQUE NOT NULL,senha TEXT NOT NULL,perfil TEXT DEFAULT 'admin',ativo BOOLEAN DEFAULT true,criado_em TIMESTAMP DEFAULT NOW())`)
  await q(`CREATE TABLE IF NOT EXISTS produtos(id SERIAL PRIMARY KEY,nome TEXT NOT NULL,codigo TEXT UNIQUE,preco NUMERIC(12,2) DEFAULT 0,custo NUMERIC(12,2) DEFAULT 0,estoque NUMERIC(12,3) DEFAULT 0,estoque_min NUMERIC(12,3) DEFAULT 0,ncm TEXT,cfop TEXT DEFAULT '5102',unidade TEXT DEFAULT 'UN',ativo BOOLEAN DEFAULT true,criado_em TIMESTAMP DEFAULT NOW())`)
  await q(`CREATE TABLE IF NOT EXISTS clientes(id SERIAL PRIMARY KEY,nome TEXT NOT NULL,documento TEXT,email TEXT,telefone TEXT,endereco TEXT,ativo BOOLEAN DEFAULT true,criado_em TIMESTAMP DEFAULT NOW())`)
  await q(`CREATE TABLE IF NOT EXISTS vendas(id SERIAL PRIMARY KEY,cliente_id INTEGER REFERENCES clientes(id),usuario_id INTEGER REFERENCES usuarios(id),total NUMERIC(12,2) NOT NULL,pagamento TEXT DEFAULT 'PIX',status TEXT DEFAULT 'FECHADA',criado_em TIMESTAMP DEFAULT NOW())`)
  await q(`CREATE TABLE IF NOT EXISTS venda_itens(id SERIAL PRIMARY KEY,venda_id INTEGER REFERENCES vendas(id) ON DELETE CASCADE,produto_id INTEGER REFERENCES produtos(id),nome TEXT,quantidade NUMERIC(12,3),preco NUMERIC(12,2),subtotal NUMERIC(12,2))`)
  await q(`CREATE TABLE IF NOT EXISTS caixa_movimentos(id SERIAL PRIMARY KEY,tipo TEXT NOT NULL,descricao TEXT,valor NUMERIC(12,2) NOT NULL,venda_id INTEGER REFERENCES vendas(id),criado_em TIMESTAMP DEFAULT NOW())`)
  const exists = await q(`SELECT id FROM usuarios WHERE email=$1`, ['admin@admin.com'])
  if(!exists.rows.length){ await q(`INSERT INTO usuarios(nome,email,senha,perfil) VALUES($1,$2,$3,$4)`, ['Administrador','admin@admin.com', bcrypt.hashSync('admin123', 10), 'admin']) }
}
init().catch(e=>console.error('INIT ERROR', e))

function auth(req,res,next){
  const token = (req.headers.authorization||'').replace('Bearer ', '')
  if(!token) return res.status(401).json({erro:'Token ausente'})
  try{ req.user = jwt.verify(token, JWT_SECRET); next() }catch{ res.status(401).json({erro:'Token inválido'}) }
}
function admin(req,res,next){ if(req.user?.perfil !== 'admin') return res.status(403).json({erro:'Sem permissão'}); next() }
const num = v => Number(String(v ?? 0).replace(',', '.')) || 0

app.get('/', (_,res)=>res.json({ok:true,app:'ERP Fiscal Pro API v3'}))
app.post('/login', async (req,res)=>{
  const {email, senha} = req.body
  const r = await q(`SELECT * FROM usuarios WHERE email=$1 AND ativo=true`, [email])
  const u = r.rows[0]
  if(!u || !bcrypt.compareSync(senha||'', u.senha)) return res.status(401).json({erro:'Login inválido'})
  const token = jwt.sign({id:u.id,nome:u.nome,email:u.email,perfil:u.perfil}, JWT_SECRET, {expiresIn:'12h'})
  res.json({token, usuario:{id:u.id,nome:u.nome,email:u.email,perfil:u.perfil}})
})

app.get('/dashboard', auth, async (_,res)=>{
  const [vendas, qtdVendas, produtos, clientes, baixo, serie, fluxo] = await Promise.all([
    q(`SELECT COALESCE(SUM(total),0) total FROM vendas WHERE DATE(criado_em)=CURRENT_DATE`),
    q(`SELECT COUNT(*) qtd FROM vendas WHERE DATE(criado_em)=CURRENT_DATE`),
    q(`SELECT COUNT(*) qtd FROM produtos WHERE ativo=true`),
    q(`SELECT COUNT(*) qtd FROM clientes WHERE ativo=true`),
    q(`SELECT id,nome,estoque,unidade FROM produtos WHERE ativo=true AND estoque<=estoque_min ORDER BY estoque ASC LIMIT 8`),
    q(`SELECT TO_CHAR(DATE(criado_em),'DD/MM') dia, SUM(total)::float total FROM vendas WHERE criado_em > NOW() - INTERVAL '7 days' GROUP BY DATE(criado_em) ORDER BY DATE(criado_em)`),
    q(`SELECT tipo, COALESCE(SUM(valor),0)::float total FROM caixa_movimentos WHERE DATE(criado_em)=CURRENT_DATE GROUP BY tipo`)
  ])
  res.json({vendasHoje:Number(vendas.rows[0].total),qtdVendas:Number(qtdVendas.rows[0].qtd),produtos:Number(produtos.rows[0].qtd),clientes:Number(clientes.rows[0].qtd),baixo:baixo.rows,serie:serie.rows,fluxo:fluxo.rows})
})

app.get('/produtos', auth, async (req,res)=>{ const s=`%${req.query.search||''}%`; const r=await q(`SELECT * FROM produtos WHERE ativo=true AND (nome ILIKE $1 OR codigo ILIKE $1) ORDER BY id DESC`,[s]); res.json(r.rows) })
app.post('/produtos', auth, async (req,res)=>{ const p=req.body; const r=await q(`INSERT INTO produtos(nome,codigo,preco,custo,estoque,estoque_min,ncm,cfop,unidade) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[p.nome,p.codigo,num(p.preco),num(p.custo),num(p.estoque),num(p.estoque_min),p.ncm,p.cfop||'5102',p.unidade||'UN']); res.json(r.rows[0]) })
app.put('/produtos/:id', auth, async (req,res)=>{ const p=req.body; const r=await q(`UPDATE produtos SET nome=$1,codigo=$2,preco=$3,custo=$4,estoque=$5,estoque_min=$6,ncm=$7,cfop=$8,unidade=$9 WHERE id=$10 RETURNING *`,[p.nome,p.codigo,num(p.preco),num(p.custo),num(p.estoque),num(p.estoque_min),p.ncm,p.cfop||'5102',p.unidade||'UN',req.params.id]); res.json(r.rows[0]) })
app.delete('/produtos/:id', auth, async (req,res)=>{ await q(`UPDATE produtos SET ativo=false WHERE id=$1`,[req.params.id]); res.json({ok:true}) })

app.get('/clientes', auth, async (req,res)=>{ const s=`%${req.query.search||''}%`; const r=await q(`SELECT * FROM clientes WHERE ativo=true AND (nome ILIKE $1 OR COALESCE(documento,'') ILIKE $1) ORDER BY id DESC`,[s]); res.json(r.rows) })
app.post('/clientes', auth, async (req,res)=>{ const c=req.body; const r=await q(`INSERT INTO clientes(nome,documento,email,telefone,endereco) VALUES($1,$2,$3,$4,$5) RETURNING *`,[c.nome,c.documento,c.email,c.telefone,c.endereco]); res.json(r.rows[0]) })
app.put('/clientes/:id', auth, async (req,res)=>{ const c=req.body; const r=await q(`UPDATE clientes SET nome=$1,documento=$2,email=$3,telefone=$4,endereco=$5 WHERE id=$6 RETURNING *`,[c.nome,c.documento,c.email,c.telefone,c.endereco,req.params.id]); res.json(r.rows[0]) })
app.delete('/clientes/:id', auth, async (req,res)=>{ await q(`UPDATE clientes SET ativo=false WHERE id=$1`,[req.params.id]); res.json({ok:true}) })

app.post('/vendas', auth, async (req,res)=>{
  const client = await pool.connect()
  try{
    await client.query('BEGIN')
    const itens = req.body.itens || []
    if(!itens.length) throw new Error('Carrinho vazio')
    let total = 0, calc=[]
    for(const it of itens){
      const pr = await client.query(`SELECT * FROM produtos WHERE id=$1 AND ativo=true FOR UPDATE`, [it.produto_id])
      const p = pr.rows[0]; if(!p) throw new Error('Produto não encontrado')
      if(Number(p.estoque) < Number(it.quantidade)) throw new Error(`Estoque insuficiente: ${p.nome}`)
      const subtotal = Number(p.preco) * Number(it.quantidade); total += subtotal; calc.push({p,qtd:Number(it.quantidade),subtotal})
    }
    const vr = await client.query(`INSERT INTO vendas(cliente_id,usuario_id,total,pagamento) VALUES($1,$2,$3,$4) RETURNING *`, [req.body.cliente_id||null, req.user.id, total, req.body.pagamento||'PIX'])
    const venda = vr.rows[0]
    for(const it of calc){
      await client.query(`INSERT INTO venda_itens(venda_id,produto_id,nome,quantidade,preco,subtotal) VALUES($1,$2,$3,$4,$5,$6)`, [venda.id,it.p.id,it.p.nome,it.qtd,it.p.preco,it.subtotal])
      await client.query(`UPDATE produtos SET estoque=estoque-$1 WHERE id=$2`, [it.qtd,it.p.id])
    }
    await client.query(`INSERT INTO caixa_movimentos(tipo,descricao,valor,venda_id) VALUES('ENTRADA',$1,$2,$3)`, [`Venda #${venda.id}`, total, venda.id])
    await client.query('COMMIT')
    res.json(venda)
  }catch(e){ await client.query('ROLLBACK'); res.status(400).json({erro:e.message}) } finally{ client.release() }
})
app.get('/vendas', auth, async (_,res)=>{ const r=await q(`SELECT v.*, c.nome cliente FROM vendas v LEFT JOIN clientes c ON c.id=v.cliente_id ORDER BY v.id DESC LIMIT 100`); res.json(r.rows) })
app.get('/vendas/:id/itens', auth, async (req,res)=>{ const r=await q(`SELECT * FROM venda_itens WHERE venda_id=$1`,[req.params.id]); res.json(r.rows) })

app.get('/usuarios', auth, admin, async (_,res)=>{ const r=await q(`SELECT id,nome,email,perfil,ativo,criado_em FROM usuarios ORDER BY id DESC`); res.json(r.rows) })
app.post('/usuarios', auth, admin, async (req,res)=>{ const u=req.body; const r=await q(`INSERT INTO usuarios(nome,email,senha,perfil) VALUES($1,$2,$3,$4) RETURNING id,nome,email,perfil,ativo`,[u.nome,u.email,bcrypt.hashSync(u.senha||'123456',10),u.perfil||'operador']); res.json(r.rows[0]) })
app.put('/usuarios/:id', auth, admin, async (req,res)=>{ const u=req.body; const r=await q(`UPDATE usuarios SET nome=$1,email=$2,perfil=$3,ativo=$4 WHERE id=$5 RETURNING id,nome,email,perfil,ativo`,[u.nome,u.email,u.perfil,!!u.ativo,req.params.id]); res.json(r.rows[0]) })
app.delete('/usuarios/:id', auth, admin, async (req,res)=>{ await q(`UPDATE usuarios SET ativo=false WHERE id=$1`,[req.params.id]); res.json({ok:true}) })

app.get('/caixa', auth, async (_,res)=>{ const r=await q(`SELECT * FROM caixa_movimentos ORDER BY id DESC LIMIT 200`); res.json(r.rows) })
app.post('/caixa', auth, async (req,res)=>{ const m=req.body; const r=await q(`INSERT INTO caixa_movimentos(tipo,descricao,valor) VALUES($1,$2,$3) RETURNING *`,[m.tipo,m.descricao,num(m.valor)]); res.json(r.rows[0]) })
app.get('/backup', auth, admin, async (_,res)=>{ const data={produtos:(await q('SELECT * FROM produtos')).rows,clientes:(await q('SELECT * FROM clientes')).rows,vendas:(await q('SELECT * FROM vendas')).rows,itens:(await q('SELECT * FROM venda_itens')).rows,gerado_em:new Date().toISOString()}; res.setHeader('Content-Disposition','attachment; filename="backup-erp.json"'); res.json(data) })
app.get('/vendas/:id/xml', auth, async (req,res)=>{ const venda=(await q('SELECT * FROM vendas WHERE id=$1',[req.params.id])).rows[0]; const itens=(await q('SELECT * FROM venda_itens WHERE venda_id=$1',[req.params.id])).rows; const xml=create({version:'1.0'}).ele('NFCeMock').ele('emitente').ele('cnpj').txt(process.env.EMPRESA_CNPJ||'').up().up().ele('venda').att('id',venda.id).ele('total').txt(venda.total).up().ele('itens'); itens.forEach(i=>xml.ele('item').ele('nome').txt(i.nome).up().ele('qtd').txt(i.quantidade).up().ele('valor').txt(i.subtotal).up().up()); const out=xml.end({prettyPrint:true}); res.setHeader('Content-Type','application/xml'); res.setHeader('Content-Disposition',`attachment; filename="venda-${req.params.id}.xml"`); res.send(out) })
app.get('/vendas/:id/danfe', auth, async (req,res)=>{ const venda=(await q('SELECT * FROM vendas WHERE id=$1',[req.params.id])).rows[0]; const itens=(await q('SELECT * FROM venda_itens WHERE venda_id=$1',[req.params.id])).rows; const doc=new PDFDocument({margin:40}); res.setHeader('Content-Type','application/pdf'); res.setHeader('Content-Disposition',`inline; filename="danfe-${req.params.id}.pdf"`); doc.pipe(res); doc.fontSize(18).text(process.env.EMPRESA_NOME||'ERP Fiscal Pro'); doc.fontSize(12).text(`CNPJ: ${process.env.EMPRESA_CNPJ||''}`); doc.moveDown().fontSize(16).text(`DANFE / NFC-e Mock - Venda #${venda.id}`); itens.forEach(i=>doc.fontSize(11).text(`${i.quantidade}x ${i.nome} - R$ ${Number(i.subtotal).toFixed(2)}`)); doc.moveDown().fontSize(16).text(`TOTAL: R$ ${Number(venda.total).toFixed(2)}`); doc.end() })

app.listen(PORT, ()=>console.log(`Backend em http://localhost:${PORT}`))
