import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import pg from 'pg'
import PDFDocument from 'pdfkit'
import { create } from 'xmlbuilder2'
import axios from 'axios'

const { Pool } = pg
const app = express()
const PORT = process.env.PORT || 3000
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret'
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false })

app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') || true, credentials: true }))
app.use(express.json({ limit: '10mb' }))

async function q(sql, params = []) { const r = await pool.query(sql, params); return r }
function money(v){ return Number(v || 0).toFixed(2) }
function role(...allowed){ return (req,res,next)=> allowed.includes(req.user.role) ? next() : res.status(403).json({erro:'Sem permissão'}) }
function token(user){ return jwt.sign({ id:user.id, nome:user.nome, email:user.email, role:user.role }, JWT_SECRET, { expiresIn:'10h' }) }
function auth(req,res,next){ try{ const h=req.headers.authorization||''; const raw=h.replace('Bearer ','')||req.query.token||''; req.user=jwt.verify(raw,JWT_SECRET); next() }catch{ res.status(401).json({erro:'Faça login novamente'}) } }

async function init(){
  await q(`CREATE TABLE IF NOT EXISTS users(id SERIAL PRIMARY KEY,nome TEXT NOT NULL,email TEXT UNIQUE NOT NULL,senha_hash TEXT NOT NULL,role TEXT DEFAULT 'admin',ativo BOOLEAN DEFAULT true,created_at TIMESTAMP DEFAULT NOW())`)
  await q(`CREATE TABLE IF NOT EXISTS produtos(id SERIAL PRIMARY KEY,nome TEXT NOT NULL,codigo_barras TEXT UNIQUE,preco NUMERIC(12,2) NOT NULL DEFAULT 0,custo NUMERIC(12,2) DEFAULT 0,estoque NUMERIC(12,3) NOT NULL DEFAULT 0,estoque_min NUMERIC(12,3) DEFAULT 0,ncm TEXT,cfop TEXT,unidade TEXT DEFAULT 'UN',ativo BOOLEAN DEFAULT true,created_at TIMESTAMP DEFAULT NOW())`)
  await q(`CREATE TABLE IF NOT EXISTS clientes(id SERIAL PRIMARY KEY,nome TEXT NOT NULL,documento TEXT,email TEXT,telefone TEXT,endereco TEXT,created_at TIMESTAMP DEFAULT NOW())`)
  await q(`CREATE TABLE IF NOT EXISTS vendas(id SERIAL PRIMARY KEY,cliente_id INT REFERENCES clientes(id),usuario_id INT REFERENCES users(id),total NUMERIC(12,2) NOT NULL,desconto NUMERIC(12,2) DEFAULT 0,pagamento TEXT DEFAULT 'DINHEIRO',status TEXT DEFAULT 'FECHADA',fiscal_status TEXT DEFAULT 'PENDENTE',fiscal_chave TEXT,fiscal_protocolo TEXT,created_at TIMESTAMP DEFAULT NOW())`)
  await q(`CREATE TABLE IF NOT EXISTS venda_itens(id SERIAL PRIMARY KEY,venda_id INT REFERENCES vendas(id) ON DELETE CASCADE,produto_id INT REFERENCES produtos(id),quantidade NUMERIC(12,3) NOT NULL,preco_unitario NUMERIC(12,2) NOT NULL,subtotal NUMERIC(12,2) NOT NULL)`)
  await q(`CREATE TABLE IF NOT EXISTS caixa_movimentos(id SERIAL PRIMARY KEY,tipo TEXT NOT NULL,descricao TEXT,valor NUMERIC(12,2) NOT NULL,forma TEXT DEFAULT 'DINHEIRO',venda_id INT REFERENCES vendas(id),usuario_id INT REFERENCES users(id),created_at TIMESTAMP DEFAULT NOW())`)
  await q(`CREATE TABLE IF NOT EXISTS backups(id SERIAL PRIMARY KEY,nome TEXT,conteudo JSONB,created_at TIMESTAMP DEFAULT NOW())`)
  const admin = await q('SELECT id FROM users WHERE email=$1',['admin@admin.com'])
  if(!admin.rowCount) await q('INSERT INTO users(nome,email,senha_hash,role) VALUES($1,$2,$3,$4)',['Admin','admin@admin.com',bcrypt.hashSync('admin123',10),'admin'])
}

app.get('/health', (_,res)=>res.json({ok:true,service:'ERP Fiscal Pro'}))
app.post('/auth/login', async (req,res)=>{ const {email,senha}=req.body; const r=await q('SELECT * FROM users WHERE email=$1 AND ativo=true',[email]); const u=r.rows[0]; if(!u||!bcrypt.compareSync(senha,u.senha_hash)) return res.status(401).json({erro:'Login inválido'}); res.json({token:token(u),user:{id:u.id,nome:u.nome,email:u.email,role:u.role}}) })

app.use(auth)

app.get('/dashboard', async (_,res)=>{
  const [vendas,produtos,clientes,baixo,chart,fluxo] = await Promise.all([
    q(`SELECT COALESCE(SUM(total),0) total, COUNT(*) qtd FROM vendas WHERE created_at::date=CURRENT_DATE`),
    q(`SELECT COUNT(*) qtd FROM produtos WHERE ativo=true`),
    q(`SELECT COUNT(*) qtd FROM clientes`),
    q(`SELECT * FROM produtos WHERE estoque <= estoque_min AND ativo=true ORDER BY estoque ASC LIMIT 8`),
    q(`SELECT to_char(created_at::date,'DD/MM') dia, COALESCE(SUM(total),0) total FROM vendas WHERE created_at >= CURRENT_DATE - INTERVAL '6 days' GROUP BY created_at::date ORDER BY created_at::date`),
    q(`SELECT tipo, COALESCE(SUM(valor),0) total FROM caixa_movimentos WHERE created_at::date=CURRENT_DATE GROUP BY tipo`)
  ])
  res.json({vendasHoje:vendas.rows[0],produtos:produtos.rows[0].qtd,clientes:clientes.rows[0].qtd,estoqueBaixo:baixo.rows,graficoVendas:chart.rows,fluxo:fluxo.rows})
})

app.get('/usuarios', role('admin'), async (_,res)=>res.json((await q('SELECT id,nome,email,role,ativo,created_at FROM users ORDER BY id DESC')).rows))
app.post('/usuarios', role('admin'), async (req,res)=>{ const u=req.body; const r=await q('INSERT INTO users(nome,email,senha_hash,role) VALUES($1,$2,$3,$4) RETURNING id,nome,email,role,ativo',[u.nome,u.email,bcrypt.hashSync(u.senha||'123456',10),u.role||'caixa']); res.status(201).json(r.rows[0]) })
app.put('/usuarios/:id', role('admin'), async (req,res)=>{ const u=req.body; const params=[u.nome,u.email,u.role||'caixa',u.ativo!==false,req.params.id]; const r=await q('UPDATE users SET nome=$1,email=$2,role=$3,ativo=$4 WHERE id=$5 RETURNING id,nome,email,role,ativo',params); if(u.senha) await q('UPDATE users SET senha_hash=$1 WHERE id=$2',[bcrypt.hashSync(u.senha,10),req.params.id]); res.json(r.rows[0]) })
app.delete('/usuarios/:id', role('admin'), async (req,res)=>{ await q('UPDATE users SET ativo=false WHERE id=$1',[req.params.id]); res.json({ok:true}) })

app.get('/produtos', async (req,res)=>{ const s=`%${req.query.q||''}%`; res.json((await q('SELECT * FROM produtos WHERE ativo=true AND (nome ILIKE $1 OR codigo_barras ILIKE $1) ORDER BY id DESC',[s])).rows) })
app.post('/produtos', role('admin','gerente'), async (req,res)=>{ const p=req.body; const r=await q(`INSERT INTO produtos(nome,codigo_barras,preco,custo,estoque,estoque_min,ncm,cfop,unidade) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[p.nome,p.codigo_barras||null,p.preco||0,p.custo||0,p.estoque||0,p.estoque_min||0,p.ncm||'',p.cfop||'5102',p.unidade||'UN']); res.status(201).json(r.rows[0]) })
app.put('/produtos/:id', role('admin','gerente'), async (req,res)=>{ const p=req.body; const r=await q(`UPDATE produtos SET nome=$1,codigo_barras=$2,preco=$3,custo=$4,estoque=$5,estoque_min=$6,ncm=$7,cfop=$8,unidade=$9 WHERE id=$10 RETURNING *`,[p.nome,p.codigo_barras||null,p.preco||0,p.custo||0,p.estoque||0,p.estoque_min||0,p.ncm||'',p.cfop||'5102',p.unidade||'UN',req.params.id]); res.json(r.rows[0]) })
app.delete('/produtos/:id', role('admin','gerente'), async (req,res)=>{ await q('UPDATE produtos SET ativo=false WHERE id=$1',[req.params.id]); res.json({ok:true}) })

app.get('/clientes', async (_,res)=>res.json((await q('SELECT * FROM clientes ORDER BY id DESC')).rows))
app.post('/clientes', async (req,res)=>{ const c=req.body; const r=await q('INSERT INTO clientes(nome,documento,email,telefone,endereco) VALUES($1,$2,$3,$4,$5) RETURNING *',[c.nome,c.documento||'',c.email||'',c.telefone||'',c.endereco||'']); res.status(201).json(r.rows[0]) })
app.put('/clientes/:id', async (req,res)=>{ const c=req.body; const r=await q('UPDATE clientes SET nome=$1,documento=$2,email=$3,telefone=$4,endereco=$5 WHERE id=$6 RETURNING *',[c.nome,c.documento||'',c.email||'',c.telefone||'',c.endereco||'',req.params.id]); res.json(r.rows[0]) })
app.delete('/clientes/:id', role('admin','gerente'), async (req,res)=>{ await q('DELETE FROM clientes WHERE id=$1',[req.params.id]); res.json({ok:true}) })

app.get('/vendas', async (_,res)=>res.json((await q(`SELECT v.*, c.nome cliente, u.nome operador FROM vendas v LEFT JOIN clientes c ON c.id=v.cliente_id LEFT JOIN users u ON u.id=v.usuario_id ORDER BY v.id DESC LIMIT 200`)).rows))
app.post('/vendas', async (req,res)=>{
  const client=await pool.connect()
  try{ await client.query('BEGIN'); const {cliente_id,itens,desconto=0,pagamento='DINHEIRO'}=req.body; let total=0; const calc=[]
    for(const i of itens){ const p=(await client.query('SELECT * FROM produtos WHERE id=$1 AND ativo=true FOR UPDATE',[i.produto_id])).rows[0]; if(!p) throw new Error('Produto não encontrado'); if(Number(p.estoque)<Number(i.quantidade)) throw new Error(`Estoque insuficiente: ${p.nome}`); const sub=Number(p.preco)*Number(i.quantidade); total+=sub; calc.push({p,qtd:i.quantidade,preco:p.preco,sub}) }
    total=Math.max(0,total-Number(desconto)); const venda=(await client.query('INSERT INTO vendas(cliente_id,usuario_id,total,desconto,pagamento) VALUES($1,$2,$3,$4,$5) RETURNING *',[cliente_id||null,req.user.id,total,desconto,pagamento])).rows[0]
    for(const i of calc){ await client.query('INSERT INTO venda_itens(venda_id,produto_id,quantidade,preco_unitario,subtotal) VALUES($1,$2,$3,$4,$5)',[venda.id,i.p.id,i.qtd,i.preco,i.sub]); await client.query('UPDATE produtos SET estoque=estoque-$1 WHERE id=$2',[i.qtd,i.p.id]) }
    await client.query('INSERT INTO caixa_movimentos(tipo,descricao,valor,forma,venda_id,usuario_id) VALUES($1,$2,$3,$4,$5,$6)',['ENTRADA',`Venda ${venda.id}`,total,pagamento,venda.id,req.user.id])
    await client.query('COMMIT'); res.status(201).json(venda)
  }catch(e){ await client.query('ROLLBACK'); res.status(400).json({erro:e.message}) } finally{ client.release() }
})
app.get('/vendas/:id', async (req,res)=>{ const venda=(await q(`SELECT v.*, c.nome cliente,c.documento FROM vendas v LEFT JOIN clientes c ON c.id=v.cliente_id WHERE v.id=$1`,[req.params.id])).rows[0]; const itens=(await q(`SELECT vi.*,p.nome,p.ncm,p.cfop,p.unidade FROM venda_itens vi JOIN produtos p ON p.id=vi.produto_id WHERE venda_id=$1`,[req.params.id])).rows; res.json({...venda,itens}) })

app.get('/caixa', async (req,res)=>{ const data=req.query.data||'CURRENT_DATE'; const r=await q(`SELECT * FROM caixa_movimentos WHERE created_at::date=${data==='CURRENT_DATE'?'CURRENT_DATE':'$1'} ORDER BY id DESC`, data==='CURRENT_DATE'?[]:[data]); const resumo=await q(`SELECT tipo, forma, COALESCE(SUM(valor),0) total FROM caixa_movimentos WHERE created_at::date=${data==='CURRENT_DATE'?'CURRENT_DATE':'$1'} GROUP BY tipo,forma`, data==='CURRENT_DATE'?[]:[data]); res.json({movimentos:r.rows,resumo:resumo.rows}) })
app.post('/caixa/movimento', async (req,res)=>{ const m=req.body; const r=await q('INSERT INTO caixa_movimentos(tipo,descricao,valor,forma,usuario_id) VALUES($1,$2,$3,$4,$5) RETURNING *',[m.tipo,m.descricao,m.valor,m.forma||'DINHEIRO',req.user.id]); res.status(201).json(r.rows[0]) })

app.get('/vendas/:id/xml', async (req,res)=>{ const venda=(await q('SELECT * FROM vendas WHERE id=$1',[req.params.id])).rows[0]; const itens=(await q('SELECT vi.*,p.nome,p.ncm,p.cfop,p.unidade FROM venda_itens vi JOIN produtos p ON p.id=vi.produto_id WHERE venda_id=$1',[req.params.id])).rows; const xml=create({version:'1.0'}).ele('NFePrevia',{semValorFiscal:'true'}).ele('Empresa').txt(process.env.EMPRESA_NOME||'Minha Empresa').up().ele('Venda').ele('Numero').txt(venda.id).up().ele('Total').txt(venda.total).up().ele('Itens'); itens.forEach(i=>xml.ele('Item').ele('Produto').txt(i.nome).up().ele('NCM').txt(i.ncm||'').up().ele('CFOP').txt(i.cfop||'').up().ele('Qtd').txt(i.quantidade).up().ele('Subtotal').txt(i.subtotal).up().up()); const out=xml.end({prettyPrint:true}); res.setHeader('Content-Type','application/xml'); res.setHeader('Content-Disposition',`attachment; filename=venda-${req.params.id}.xml`); res.send(out) })
app.get('/vendas/:id/danfe', async (req,res)=>{ const venda=(await q('SELECT * FROM vendas WHERE id=$1',[req.params.id])).rows[0]; const itens=(await q('SELECT vi.*,p.nome FROM venda_itens vi JOIN produtos p ON p.id=vi.produto_id WHERE venda_id=$1',[req.params.id])).rows; const doc=new PDFDocument({margin:40}); res.setHeader('Content-Type','application/pdf'); res.setHeader('Content-Disposition',`inline; filename=danfe-venda-${req.params.id}.pdf`); doc.pipe(res); doc.fontSize(18).text('DANFE / NFC-e - PRÉVIA SEM VALOR FISCAL'); doc.fontSize(9).text('A emissão oficial depende de certificado/CSC e autorização SEFAZ.'); doc.moveDown().fontSize(12).text(process.env.EMPRESA_NOME||'Minha Empresa'); doc.text(process.env.EMPRESA_CNPJ||'CNPJ'); doc.text(process.env.EMPRESA_ENDERECO||'Endereço'); doc.moveDown().text(`Venda: ${venda.id}`); doc.text(`Pagamento: ${venda.pagamento}`); doc.text(`Total: R$ ${money(venda.total)}`); doc.moveDown(); itens.forEach(i=>doc.text(`${i.quantidade}x ${i.nome} - R$ ${money(i.subtotal)}`)); doc.end() })

app.post('/vendas/:id/emitir-fiscal', role('admin','gerente'), async (req,res)=>{ const venda=(await q('SELECT * FROM vendas WHERE id=$1',[req.params.id])).rows[0]; if(!process.env.FISCAL_API_URL) return res.status(400).json({erro:'Configure FISCAL_API_URL e FISCAL_API_TOKEN para emissão real'}); const itens=(await q('SELECT vi.*,p.nome,p.ncm,p.cfop,p.unidade FROM venda_itens vi JOIN produtos p ON p.id=vi.produto_id WHERE venda_id=$1',[req.params.id])).rows; const payload={tipo:req.body.tipo||'NFCE',ambiente:process.env.FISCAL_AMBIENTE||'homologacao',empresa:{nome:process.env.EMPRESA_NOME,cnpj:process.env.EMPRESA_CNPJ,ie:process.env.EMPRESA_IE,endereco:process.env.EMPRESA_ENDERECO},venda,itens}; const r=await axios.post(process.env.FISCAL_API_URL,payload,{headers:{Authorization:`Bearer ${process.env.FISCAL_API_TOKEN}`}}); await q('UPDATE vendas SET fiscal_status=$1,fiscal_chave=$2,fiscal_protocolo=$3 WHERE id=$4',[r.data.status||'ENVIADA',r.data.chave||null,r.data.protocolo||null,req.params.id]); res.json(r.data) })

app.get('/backup', role('admin'), async (_,res)=>{ const tables=['users','produtos','clientes','vendas','venda_itens','caixa_movimentos']; const data={created_at:new Date().toISOString()}; for(const t of tables){ data[t]=(await q(`SELECT * FROM ${t}`)).rows } await q('INSERT INTO backups(nome,conteudo) VALUES($1,$2)',['backup-manual',data]); res.setHeader('Content-Type','application/json'); res.setHeader('Content-Disposition','attachment; filename=backup-erp.json'); res.send(JSON.stringify(data,null,2)) })

init().then(()=>app.listen(PORT,()=>console.log(`Backend em http://localhost:${PORT}`))).catch(e=>{console.error(e);process.exit(1)})
