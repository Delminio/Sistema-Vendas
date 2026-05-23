import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import axios from 'axios'
import './style.css'

const api = axios.create({ baseURL: 'http://localhost:3000' })

function App() {
  const [produtos, setProdutos] = useState([])
  const [clientes, setClientes] = useState([])
  const [vendas, setVendas] = useState([])
  const [clienteId, setClienteId] = useState('')
  const [carrinho, setCarrinho] = useState([])
  const [msg, setMsg] = useState('')

  const [produto, setProduto] = useState({ nome: '', preco: '', estoque: '', ncm: '', cfop: '5102', unidade: 'UN' })
  const [cliente, setCliente] = useState({ nome: '', documento: '', email: '', telefone: '' })

  async function carregar() {
    const [p, c, v] = await Promise.all([api.get('/produtos'), api.get('/clientes'), api.get('/vendas')])
    setProdutos(p.data); setClientes(c.data); setVendas(v.data)
  }
  useEffect(() => { carregar() }, [])

  const total = useMemo(() => carrinho.reduce((s, i) => s + i.preco * i.quantidade, 0), [carrinho])

  async function salvarProduto(e) {
    e.preventDefault(); setMsg('')
    await api.post('/produtos', { ...produto, preco: Number(produto.preco), estoque: Number(produto.estoque) })
    setProduto({ nome: '', preco: '', estoque: '', ncm: '', cfop: '5102', unidade: 'UN' })
    await carregar()
  }

  async function salvarCliente(e) {
    e.preventDefault(); setMsg('')
    await api.post('/clientes', cliente)
    setCliente({ nome: '', documento: '', email: '', telefone: '' })
    await carregar()
  }

  function adicionarCarrinho(p) {
    setCarrinho(old => {
      const item = old.find(i => i.id === p.id)
      if (item) return old.map(i => i.id === p.id ? { ...i, quantidade: i.quantidade + 1 } : i)
      return [...old, { ...p, quantidade: 1 }]
    })
  }

  async function fecharVenda() {
    if (carrinho.length === 0) return setMsg('Adicione produto na venda.')
    const venda = await api.post('/vendas', { cliente_id: clienteId ? Number(clienteId) : null, itens: carrinho.map(i => ({ produto_id: i.id, quantidade: i.quantidade })) })
    setCarrinho([]); setClienteId('')
    setMsg(`Venda ${venda.data.id} criada.`)
    await carregar()
  }

  async function emitir(vendaId, tipo) {
    setMsg('Emitindo...')
    const r = await api.post(`/vendas/${vendaId}/emitir/${tipo}`)
    setMsg(`${tipo}: ${r.data.fiscal.status} - ${r.data.fiscal.chave || ''}`)
    await carregar()
  }

  return <main>
    <header><h1>ERP Fiscal</h1><p>Vendas + NF-e + NFC-e + NFS-e</p></header>
    {msg && <div className="msg">{msg}</div>}

    <section className="grid">
      <div className="card">
        <h2>Produto</h2>
        <form onSubmit={salvarProduto}>
          <input placeholder="Nome" value={produto.nome} onChange={e=>setProduto({...produto,nome:e.target.value})} />
          <input placeholder="Preço" type="number" step="0.01" value={produto.preco} onChange={e=>setProduto({...produto,preco:e.target.value})} />
          <input placeholder="Estoque" type="number" step="0.01" value={produto.estoque} onChange={e=>setProduto({...produto,estoque:e.target.value})} />
          <input placeholder="NCM" value={produto.ncm} onChange={e=>setProduto({...produto,ncm:e.target.value})} />
          <input placeholder="CFOP" value={produto.cfop} onChange={e=>setProduto({...produto,cfop:e.target.value})} />
          <button>Cadastrar produto</button>
        </form>
      </div>

      <div className="card">
        <h2>Cliente</h2>
        <form onSubmit={salvarCliente}>
          <input placeholder="Nome" value={cliente.nome} onChange={e=>setCliente({...cliente,nome:e.target.value})} />
          <input placeholder="CPF/CNPJ" value={cliente.documento} onChange={e=>setCliente({...cliente,documento:e.target.value})} />
          <input placeholder="Email" value={cliente.email} onChange={e=>setCliente({...cliente,email:e.target.value})} />
          <input placeholder="Telefone" value={cliente.telefone} onChange={e=>setCliente({...cliente,telefone:e.target.value})} />
          <button>Cadastrar cliente</button>
        </form>
      </div>
    </section>

    <section className="card">
      <h2>Nova venda</h2>
      <select value={clienteId} onChange={e=>setClienteId(e.target.value)}>
        <option value="">Consumidor não identificado</option>
        {clientes.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
      </select>
      <div className="produtos">
        {produtos.map(p => <button key={p.id} onClick={()=>adicionarCarrinho(p)}>{p.nome}<br/>R$ {Number(p.preco).toFixed(2)} | Est. {p.estoque}</button>)}
      </div>
      <h3>Carrinho</h3>
      {carrinho.map(i => <p key={i.id}>{i.nome} x {i.quantidade} = R$ {(i.preco*i.quantidade).toFixed(2)}</p>)}
      <h3>Total: R$ {total.toFixed(2)}</h3>
      <button onClick={fecharVenda}>Fechar venda</button>
    </section>

    <section className="card">
      <h2>Vendas</h2>
      <table><thead><tr><th>ID</th><th>Total</th><th>Fiscal</th><th>Ações</th></tr></thead><tbody>
        {vendas.map(v => <tr key={v.id}><td>{v.id}</td><td>R$ {Number(v.total).toFixed(2)}</td><td>{v.fiscal_tipo || '-'} / {v.fiscal_status}</td><td>
          <button onClick={()=>emitir(v.id,'NFE')}>NF-e</button>
          <button onClick={()=>emitir(v.id,'NFCE')}>NFC-e</button>
          <button onClick={()=>emitir(v.id,'NFSE')}>NFS-e</button>
        </td></tr>)}
      </tbody></table>
    </section>
  </main>
}

createRoot(document.getElementById('root')).render(<App />)
