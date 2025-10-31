// server.js - VERSÃO COMPLETA REVISADA

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sgMail = require('@sendgrid/mail');
const { stringify } = require('csv-stringify');

const app = express();
const PORT = process.env.PORT || 3000;

// --- CONFIGURAÇÕES ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Configura SendGrid
sgMail.setApiKey(process.env.SENDGRID_API_KEY);
const emailRemetente = process.env.EMAIL_REMETENTE;

// --- MIDDLEWARES ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const protegerRota = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);

  const jwtSecret = process.env.JWT_SECRET || 'seu-segredo-super-secreto-aqui-12345';
  jwt.verify(token, jwtSecret, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// --- FUNÇÃO HELPER DE DATA ---
const formatarDataParaCSV = (data) => {
  if (!data) return '';
  const d = new Date(data);
  const dia = String(d.getUTCDate()).padStart(2, '0');
  const mes = String(d.getUTCMonth() + 1).padStart(2, '0');
  const ano = d.getUTCFullYear();
  return `${dia}/${mes}/${ano}`;
};

// --- FUNÇÕES DE EMAIL ---
async function enviarEmailAlerta(para, assunto, textoHtml) {
  if (!emailRemetente || !process.env.SENDGRID_API_KEY) {
    throw new Error("Serviço de email não configurado.");
  }

  for (const destinatario of para) {
    const msg = { to: destinatario, from: emailRemetente, subject: assunto, html: textoHtml };
    try {
      await sgMail.send(msg);
      console.log(`Email enviado para ${destinatario}`);
    } catch (error) {
      console.error(`Erro ao enviar email para ${destinatario}:`, error.response?.body || error);
    }
  }
}

// --- CRIAÇÃO DE TABELAS ---
const createTables = async () => {
  const queries = [
    `CREATE TABLE IF NOT EXISTS "fornecedores" (
      "id" SERIAL PRIMARY KEY,
      "nome" TEXT NOT NULL UNIQUE
    );`,
    `CREATE TABLE IF NOT EXISTS "categorias" (
      "id" SERIAL PRIMARY KEY,
      "nome" TEXT NOT NULL UNIQUE,
      "tipoUnidade" VARCHAR(50) NOT NULL DEFAULT 'cartela'
    );`,
    `CREATE TABLE IF NOT EXISTS "estoque" (
      "id" SERIAL PRIMARY KEY,
      "produto" TEXT NOT NULL,
      "fornecedorId" INTEGER REFERENCES "fornecedores"("id") ON DELETE SET NULL,
      "categoriaId" INTEGER REFERENCES "categorias"("id") ON DELETE SET NULL,
      "pacotes" INTEGER DEFAULT 0,
      "unidadesAvulsas" INTEGER DEFAULT 0,
      "totalUnidades" INTEGER DEFAULT 0,
      "custoPorPacote" REAL DEFAULT 0,
      "estoqueMinimo" INTEGER DEFAULT 0,
      "ultimaEntrada" DATE,
      UNIQUE("produto", "fornecedorId")
    );`,
    `CREATE TABLE IF NOT EXISTS "saidas" (
      "id" SERIAL PRIMARY KEY,
      "data" DATE NOT NULL,
      "produtoId" INTEGER NOT NULL REFERENCES "estoque"("id") ON DELETE CASCADE,
      "produtoNome" TEXT NOT NULL,
      "totalUnidades" INTEGER NOT NULL,
      "custoTotal" REAL NOT NULL,
      "destino" TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS "usuarios" (
      "id" SERIAL PRIMARY KEY,
      "email" TEXT NOT NULL UNIQUE,
      "senha" TEXT NOT NULL,
      "receberAlertas" BOOLEAN DEFAULT false
    );`,
    `CREATE TABLE IF NOT EXISTS "usoProducao" (
      "id" SERIAL PRIMARY KEY,
      "estoqueId" INTEGER NOT NULL REFERENCES "estoque"("id") ON DELETE CASCADE,
      "produtoNome" TEXT NOT NULL,
      "dataInicio" DATE NOT NULL,
      "dataFim" DATE,
      "etiquetasImpressas" INTEGER,
      "status" VARCHAR(50) NOT NULL DEFAULT 'Em Uso'
    );`
  ];

  try {
    for (const query of queries) {
      await pool.query(query);
    }
    console.log('Tabelas verificadas/criadas com sucesso.');
  } catch (err) {
    console.error('Erro ao criar tabelas:', err);
  }
};

// --- ROTAS ---

// ---------- USUÁRIOS ----------
app.post('/api/usuarios/register', async (req, res) => {
  const { email, senha, receberAlertas } = req.body;
  if (!email || !senha) return res.status(400).json({ error: 'Email e senha são obrigatórios' });

  const senhaHash = await bcrypt.hash(senha, 10);
  try {
    const { rows } = await pool.query(
      `INSERT INTO "usuarios" (email, senha, receberAlertas) VALUES ($1, $2, $3) RETURNING *`,
      [email, senhaHash, receberAlertas || false]
    );
    res.json({ usuario: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/usuarios/login', async (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha) return res.status(400).json({ error: 'Email e senha são obrigatórios' });

  try {
    const { rows } = await pool.query(`SELECT * FROM "usuarios" WHERE email=$1`, [email]);
    const usuario = rows[0];
    if (!usuario) return res.status(401).json({ error: 'Usuário não encontrado' });

    const senhaValida = await bcrypt.compare(senha, usuario.senha);
    if (!senhaValida) return res.status(401).json({ error: 'Senha inválida' });

    const token = jwt.sign({ id: usuario.id, email: usuario.email }, process.env.JWT_SECRET || 'seu-segredo-super-secreto-aqui-12345', { expiresIn: '8h' });
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- FORNECEDORES ----------
app.get('/api/fornecedores', protegerRota, async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM "fornecedores" ORDER BY nome`);
  res.json(rows);
});

app.post('/api/fornecedores', protegerRota, async (req, res) => {
  const { nome } = req.body;
  if (!nome) return res.status(400).json({ error: 'Nome obrigatório' });
  try {
    const { rows } = await pool.query(`INSERT INTO "fornecedores" (nome) VALUES ($1) RETURNING *`, [nome]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- CATEGORIAS ----------
app.get('/api/categorias', protegerRota, async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM "categorias" ORDER BY nome`);
  res.json(rows);
});

app.post('/api/categorias', protegerRota, async (req, res) => {
  const { nome, tipoUnidade } = req.body;
  if (!nome) return res.status(400).json({ error: 'Nome obrigatório' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO "categorias" (nome, tipoUnidade) VALUES ($1, $2) RETURNING *`,
      [nome, tipoUnidade || 'cartela']
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- ESTOQUE ----------
app.get('/api/estoque', protegerRota, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT e.*, c.nome AS "categoriaNome", f.nome AS "fornecedorNome", c.tipoUnidade
     FROM "estoque" e
     LEFT JOIN "categorias" c ON e."categoriaId"=c.id
     LEFT JOIN "fornecedores" f ON e."fornecedorId"=f.id
     ORDER BY e.produto`
  );
  res.json(rows);
});

app.post('/api/estoque', protegerRota, async (req, res) => {
  const { produto, fornecedorId, categoriaId, pacotes, unidadesAvulsas, custoPorPacote, estoqueMinimo, ultimaEntrada } = req.body;
  if (!produto) return res.status(400).json({ error: 'Produto obrigatório' });
  try {
    const totalUnidades = (pacotes || 0) * 5000 + (unidadesAvulsas || 0);
    const { rows } = await pool.query(
      `INSERT INTO "estoque" (produto, fornecedorId, categoriaId, pacotes, unidadesAvulsas, totalUnidades, custoPorPacote, estoqueMinimo, ultimaEntrada)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [produto, fornecedorId, categoriaId, pacotes || 0, unidadesAvulsas || 0, totalUnidades, custoPorPacote || 0, estoqueMinimo || 0, ultimaEntrada || null]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- SAÍDAS ----------
app.post('/api/saidas', protegerRota, async (req, res) => {
  const { produtoId, totalUnidades, destino } = req.body;
  if (!produtoId || !totalUnidades) return res.status(400).json({ error: 'Campos obrigatórios' });

  try {
    const { rows } = await pool.query(`SELECT * FROM "estoque" WHERE id=$1`, [produtoId]);
    const produto = rows[0];
    if (!produto) return res.status(404).json({ error: 'Produto não encontrado' });

    const novoTotal = (produto.totalUnidades || 0) - totalUnidades;
    await pool.query(`UPDATE "estoque" SET totalUnidades=$1 WHERE id=$2`, [novoTotal, produtoId]);

    const custoTotal = totalUnidades * (produto.custoPorPacote || 0); 
    const insertSaida = await pool.query(
      `INSERT INTO "saidas" (data, produtoId, produtoNome, totalUnidades, custoTotal, destino) VALUES (NOW(),$1,$2,$3,$4,$5) RETURNING *`,
      [produtoId, produto.produto, totalUnidades, custoTotal, destino || null]
    );

    res.json(insertSaida.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- USO PRODUÇÃO ----------
app.post('/api/usoProducao', protegerRota, async (req, res) => {
  const { estoqueId, produtoNome, dataInicio, etiquetasImpressas } = req.body;
  if (!estoqueId || !produtoNome || !dataInicio) return res.status(400).json({ error: 'Campos obrigatórios' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO "usoProducao" (estoqueId, produtoNome, dataInicio, etiquetasImpressas) VALUES ($1,$2,$3,$4) RETURNING *`,
      [estoqueId, produtoNome, dataInicio, etiquetasImpressas || 0]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- EXPORTAÇÃO CSV ----------
app.get('/api/exportar/estoque_atual_csv', protegerRota, async (req, res) => {
  try {
    const query = `
      SELECT e.*, c.nome AS "categoriaNome", c.tipoUnidade, f.nome AS "fornecedorNome"
      FROM "estoque" e
      LEFT JOIN "categorias" c ON e."categoriaId" = c.id
      LEFT JOIN "fornecedores" f ON e."fornecedorId" = f.id
      ORDER BY e.produto
    `;
    const { rows } = await pool.query(query);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment;filename=posicao_estoque_atual.csv');

    const stringifier = stringify({ header: true, columns: [
      { key: 'status', header: 'Status' },
      { key: 'produto', header: 'Produto' },
      { key: 'categoriaNome', header: 'Categoria' },
      { key: 'fornecedorNome', header: 'Fornecedor' },
      { key: 'totalUnidades', header: 'Total (unidades)' },
      { key: 'custoPorPacote', header: 'Custo por Pacote/Rolo (R$)' },
      { key: 'valorTotal', header: 'Valor Total em Estoque (R$)' },
      { key: 'estoqueMinimo', header: 'Estoque Minimo (unidades)' },
      { key: 'ultimaEntrada', header: 'Ultima Entrada' }
    ]});

    stringifier.pipe(res);

    for (const item of rows) {
      let status = 'OK';
      if (item.estoqueMinimo > 0 && item.totalUnidades <= item.estoqueMinimo) status = 'CRITICO';
      else if (item.tipoUnidade === 'cartela' && item.totalUnidades < 5000 && item.totalUnidades > 0) status = 'BAIXO';

      const custo = parseFloat(item.custoPorPacote) || 0;
      const total = parseInt(item.totalUnidades) || 0;
      let valorTotal = (item.tipoUnidade === 'rolo' || item.tipoUnidade === 'embalagem') ? total * custo : (total / 5000.0) * custo;

      stringifier.write({
        status,
        produto: item.produto || '',
        categoriaNome: item.categoriaNome || '-',
        fornecedorNome: item.fornecedorNome || '-',
        totalUnidades: total,
        custoPorPacote: custo.toFixed(2),
        valorTotal: valorTotal.toFixed(2),
        estoqueMinimo: item.estoqueMinimo || 0,
        ultimaEntrada: formatarDataParaCSV(item.ultimaEntrada)
      });
    }

    stringifier.end();

  } catch (err) {
    console.error('Erro ao gerar CSV:', err);
    res.status(500).json({ error: 'Erro interno ao gerar relatório CSV.' });
  }
});

// --- INICIALIZAÇÃO ---
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  createTables();
});
