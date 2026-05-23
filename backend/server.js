import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import pg from 'pg'
import PDFDocument from 'pdfkit'
import { create } from 'xmlbuilder2'

const { Pool } = pg
const app = express()
const PORT = process.env.PORT || 3000
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret'
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false })

app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') || true, credentials: true }))
app.use(express.json({ limit: '2mb' }))

async function q(sql, params=[]) { const r = await pool.query(sql, params); return r }
async function init() {
  await q(`CREATE TABLE IF NOT EXISTS users(id SERIAL PRIMARY KEY,nome TEXT NOT NULL,email TEXT UNIQUE NOT NULL,senha_hash TEXT NOT NULL,role TEXT DEFAULT 'admin',created_at TIMESTAMP DEFAULT NOW())`)
  await q(`CREATE TABLE IF NOT EXISTS produtos(id SERIAL PRIMARY KEY,nome TEXT NOT NULL,codigo_barras TEXT UNIQUE,preco NUMERIC(12,2) NOT NULL DEFAULT 0,custo NUMERIC(12,2) DEFAULT 0,estoque NUMERIC(12,3) NOT NULL DEFAULT 0,estoque_min NUMERIC(12,3) DEFAULT 0,ncm TEXT,cfop TEXT,unidade TEXT DEFAULT 'UN',ativo BOOLEAN DEFAULT true,created_at TIMESTAMP DEFAULT NOW())`)
  await q(`CREATE TABLE IF NOT EXISTS clientes(id SERIAL PRIMARY KEY,nome TEXT NOT NULL,documento TEXT,email TEXT,telefone TEXT,endereco TEXT,created_at TIMESTAMP DEFAULT NOW())`)
  await q(`CREATE TABLE IF NOT EXISTS vendas(id SERIAL PRIMARY KEY,cliente_id INT REFERENCES clientes(id),total NUMERIC(12,2) NOT NULL,desconto NUMERIC(12,2) DEFAULT 0,pagamento TEXT DEFAULT 'DINHEIRO',status TEXT DEFAULT 'FECHADA',fiscal_status TEXT DEFAULT 'PENDENTE',created_at TIMESTAMP DEFAULT NOW())`)
  await q(`CREATE TABLE IF NOT EXISTS venda_itens(id SERIAL PRIMARY KEY,venda_id INT REFERENCES vendas(id) ON DELETE CASCADE,produto_id INT REFERENCES produtos(id),quantidade NUMERIC(12,3) NOT NULL,preco_unitario NUMERIC(12,2) NOT NULL,subtotal NUMERIC(12,2) NOT NULL)`)
  const admin = await q('SELECT id FROM users WHERE email=$1',['admin@admin.com'])
  if (!admin.rowCount) await q('INSERT INTO users(nome,email,senha_hash) VALUES($1,$2,$3)',['Admin','admin@admin.com',bcrypt.hashSync('admin123',10)])
}

function token(user){ return jwt.sign({ id:user.id, nome:user.nome, email:user.email, role:user.role }, JWT_SECRET, { expiresIn:'8h' }) }
function auth(req,res,next){ try{ const h=req.headers.authorization||''; req.user=jwt.verify(h.replace('Bearer ',''),JWT_SECRET); next() }catch{ res.status(401).json({erro:'Faça login novamente'}) } }

app.get('/health', (_,res)=>res.json({ok:true}))
app.post('/auth/login', async (req,res)=>{ const {email,senha}=req.body; const r=await q('SELECT * FROM users WHERE email=$1',[email]); const u=r.rows[0]; if(!u||!bcrypt.compareSync(senha,u.senha_hash)) return res.status(401).json({erro:'Login inválido'}); res.json({token:token(u),user:{id:u.id,nome:u.nome,email:u.email}}) })

app.get('/dashboard', auth, async (_,res)=>{
  const [vendas,produtos,clientes,baixo] = await Promise.all([
    q(`SELECT COALESCE(SUM(total),0) total, COUNT(*) qtd FROM vendas WHERE created_at::date=CURRENT_DATE`),
    q(`SELECT COUNT(*) qtd FROM produtos WHERE ativo=true`),
    q(`SELECT COUNT(*) qtd FROM clientes`),
    q(`SELECT * FROM produtos WHERE estoque <= estoque_min AND ativo=true ORDER BY estoque ASC LIMIT 8`)
  ])
  res.json({ vendasHoje:vendas.rows[0], produtos:produtos.rows[0].qtd, clientes:clientes.rows[0].qtd, estoqueBaixo:baixo.rows })
})

app.get('/produtos', auth, async (req,res)=>{ const s=`%${req.query.q||''}%`; const r=await q('SELECT * FROM produtos WHERE ativo=true AND (nome ILIKE $1 OR codigo_barras ILIKE $1) ORDER BY id DESC',[s]); res.json(r.rows) })
app.post('/produtos', auth, async (req,res)=>{ const p=req.body; const r=await q(`INSERT INTO produtos(nome,codigo_barras,preco,custo,estoque,estoque_min,ncm,cfop,unidade) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[p.nome,p.codigo_barras||null,p.preco||0,p.custo||0,p.estoque||0,p.estoque_min||0,p.ncm||'',p.cfop||'5102',p.unidade||'UN']); res.status(201).json(r.rows[0]) })
app.put('/produtos/:id', auth, async (req,res)=>{ const p=req.body; const r=await q(`UPDATE produtos SET nome=$1,codigo_barras=$2,preco=$3,custo=$4,estoque=$5,estoque_min=$6,ncm=$7,cfop=$8,unidade=$9 WHERE id=$10 RETURNING *`,[p.nome,p.codigo_barras||null,p.preco,p.custo||0,p.estoque,p.estoque_min||0,p.ncm||'',p.cfop||'5102',p.unidade||'UN',req.params.id]); res.json(r.rows[0]) })
app.delete('/produtos/:id', auth, async (req,res)=>{ await q('UPDATE produtos SET ativo=false WHERE id=$1',[req.params.id]); res.json({ok:true}) })

app.get('/clientes', auth, async (_,res)=>{ const r=await q('SELECT * FROM clientes ORDER BY id DESC'); res.json(r.rows) })
app.post('/clientes', auth, async (req,res)=>{ const c=req.body; const r=await q('INSERT INTO clientes(nome,documento,email,telefone,endereco) VALUES($1,$2,$3,$4,$5) RETURNING *',[c.nome,c.documento||'',c.email||'',c.telefone||'',c.endereco||'']); res.status(201).json(r.rows[0]) })

app.get('/vendas', auth, async (_,res)=>{ const r=await q(`SELECT v.*, c.nome cliente FROM vendas v LEFT JOIN clientes c ON c.id=v.cliente_id ORDER BY v.id DESC LIMIT 100`); res.json(r.rows) })
app.post('/vendas', auth, async (req,res)=>{
  const client=await pool.connect()
  try{ await client.query('BEGIN'); const {cliente_id,itens,desconto=0,pagamento='DINHEIRO'}=req.body; let total=0; const calc=[]
    for(const i of itens){ const p=(await client.query('SELECT * FROM produtos WHERE id=$1 FOR UPDATE',[i.produto_id])).rows[0]; if(!p) throw new Error('Produto não encontrado'); if(Number(p.estoque)<Number(i.quantidade)) throw new Error(`Estoque insuficiente: ${p.nome}`); const sub=Number(p.preco)*Number(i.quantidade); total+=sub; calc.push({p,qtd:i.quantidade,preco:p.preco,sub}) }
    total=Math.max(0,total-Number(desconto)); const venda=(await client.query('INSERT INTO vendas(cliente_id,total,desconto,pagamento) VALUES($1,$2,$3,$4) RETURNING *',[cliente_id||null,total,desconto,pagamento])).rows[0]
    for(const i of calc){ await client.query('INSERT INTO venda_itens(venda_id,produto_id,quantidade,preco_unitario,subtotal) VALUES($1,$2,$3,$4,$5)',[venda.id,i.p.id,i.qtd,i.preco,i.sub]); await client.query('UPDATE produtos SET estoque=estoque-$1 WHERE id=$2',[i.qtd,i.p.id]) }
    await client.query('COMMIT'); res.status(201).json(venda)
  }catch(e){ await client.query('ROLLBACK'); res.status(400).json({erro:e.message}) } finally{ client.release() }
})
app.get('/vendas/:id', auth, async (req,res)=>{ const venda=(await q(`SELECT v.*, c.nome cliente,c.documento FROM vendas v LEFT JOIN clientes c ON c.id=v.cliente_id WHERE v.id=$1`,[req.params.id])).rows[0]; const itens=(await q(`SELECT vi.*,p.nome,p.ncm,p.cfop,p.unidade FROM venda_itens vi JOIN produtos p ON p.id=vi.produto_id WHERE venda_id=$1`,[req.params.id])).rows; res.json({...venda,itens}) })

app.get('/vendas/:id/xml', auth, async (req,res)=>{ const venda=(await q('SELECT * FROM vendas WHERE id=$1',[req.params.id])).rows[0]; const itens=(await q('SELECT vi.*,p.nome FROM venda_itens vi JOIN produtos p ON p.id=vi.produto_id WHERE venda_id=$1',[req.params.id])).rows; const xml=create({version:'1.0'}).ele('Venda',{id:venda.id}).ele('Empresa').txt(process.env.EMPRESA_NOME||'Minha Empresa').up().ele('Total').txt(venda.total).up().ele('Itens'); itens.forEach(i=>xml.ele('Item').ele('Produto').txt(i.nome).up().ele('Qtd').txt(i.quantidade).up().ele('Subtotal').txt(i.subtotal).up().up()); const out=xml.end({prettyPrint:true}); res.setHeader('Content-Type','application/xml'); res.send(out) })
app.get('/vendas/:id/danfe', auth, async (req,res)=>{ const venda=(await q('SELECT * FROM vendas WHERE id=$1',[req.params.id])).rows[0]; const itens=(await q('SELECT vi.*,p.nome FROM venda_itens vi JOIN produtos p ON p.id=vi.produto_id WHERE venda_id=$1',[req.params.id])).rows; const doc=new PDFDocument({margin:40}); res.setHeader('Content-Type','application/pdf'); res.setHeader('Content-Disposition',`inline; filename=danfe-venda-${req.params.id}.pdf`); doc.pipe(res); doc.fontSize(18).text('DANFE / RECIBO - PRÉVIA SEM VALOR FISCAL'); doc.moveDown().fontSize(11).text(process.env.EMPRESA_NOME||'Minha Empresa'); doc.text(`Venda: ${venda.id}`); doc.text(`Total: R$ ${Number(venda.total).toFixed(2)}`); doc.moveDown(); itens.forEach(i=>doc.text(`${i.quantidade}x ${i.nome} - R$ ${Number(i.subtotal).toFixed(2)}`)); doc.end() })

init().then(()=>app.listen(PORT,()=>console.log(`Backend em http://localhost:${PORT}`))).catch(e=>{console.error(e);process.exit(1)})
