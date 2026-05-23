const Database = require('better-sqlite3')
const db = new Database('erp-fiscal.db')

db.exec(`
CREATE TABLE IF NOT EXISTS clientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  documento TEXT,
  email TEXT,
  telefone TEXT,
  criado_em TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS produtos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  preco REAL NOT NULL,
  estoque REAL NOT NULL DEFAULT 0,
  ncm TEXT,
  cfop TEXT,
  unidade TEXT DEFAULT 'UN',
  criado_em TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vendas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER,
  total REAL NOT NULL,
  status TEXT DEFAULT 'FECHADA',
  fiscal_tipo TEXT,
  fiscal_status TEXT DEFAULT 'NAO_EMITIDA',
  fiscal_chave TEXT,
  fiscal_protocolo TEXT,
  criado_em TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS venda_itens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venda_id INTEGER NOT NULL,
  produto_id INTEGER NOT NULL,
  quantidade REAL NOT NULL,
  preco_unitario REAL NOT NULL,
  subtotal REAL NOT NULL
);
`)

module.exports = db
