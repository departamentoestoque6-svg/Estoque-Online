// server.js - VERSÃO COMPLETA com Gestão de Fornecedores

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

const createTables = async () => {
  const queryText = `
    CREATE TABLE IF NOT EXISTS fornecedores (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS estoque (
      id SERIAL PRIMARY KEY,
      produto TEXT NOT NULL,
      fornecedor_id INTEGER REFERENCES fornecedores(id) ON DELETE SET NULL,
      pacotes INTEGER DEFAULT 0,
      unidadesAvulsas INTEGER DEFAULT 0,
      totalUnidades INTEGER DEFAULT 0,
      custoPorPacote REAL DEFAULT 0,
      estoqueMinimo INTEGER DEFAULT 0,
      ultimaEntrada DATE
    );
    CREATE TABLE IF NOT EXISTS saidas (
      id SERIAL PRIMARY KEY,
      data DATE NOT NULL,
      produtoId INTEGER NOT NULL REFERENCES estoque(id) ON DELETE CASCADE,
      produtoNome TEXT NOT NULL,
      totalUnidades INTEGER NOT NULL,
      custoTotal REAL NOT NULL,
      destino TEXT
    );
  `;
  try {
    await pool.query(queryText);
    console.log('Tabelas verificadas/criadas com sucesso.');
  } catch (err) {
    console.error('Erro ao criar tabelas:', err);
  }
};

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- ROTAS DA API ---

app.get('/api/dashboard/stats', async (req, res) => { /* ...código da rota... */ });
app.get('/api/alertas/estoque-baixo', async (req, res) => { /* ...código da rota... */ });

app.get('/api/estoque', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT e.*, f.nome AS fornecedor_nome 
      FROM estoque e
      LEFT JOIN fornecedores f ON e.fornecedor_id = f.id
      ORDER BY e.produto
    `);
    res.json({ data: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/saidas', async (req, res) => { /* ...código da rota... */ });

app.post('/api/estoque', async (req, res) => {
    const { produto, fornecedor_id, pacotes, unidadesAvulsas, custoPorPacote, estoqueMinimo, ultimaEntrada } = req.body;
    let totalUnidadesAdicionadas;
    const tipo = produto.toLowerCase().includes('rolo') ? 'rolo' : 'cartela';
    
    if (tipo === 'rolo') {
        totalUnidadesAdicionadas = pacotes;
    } else {
        totalUnidadesAdicionadas = (pacotes * 5000) + unidadesAvulsas;
    }

    try {
        const selectRes = await pool.query('SELECT * FROM estoque WHERE produto = $1 AND (fornecedor_id = $2 OR (fornecedor_id IS NULL AND $2 IS NULL))', [produto, fornecedor_id || null]);
        
        if (selectRes.rows.length > 0) {
            const item = selectRes.rows[0];
            const novoTotalUnidades = item.totalunidades + totalUnidadesAdicionadas;
            const novosPacotes = Math.floor(novoTotalUnidades / (tipo === 'rolo' ? 1 : 5000));
            const novasUnidadesAvulsas = tipo === 'rolo' ? 0 : novoTotalUnidades % 5000;
            
            await pool.query(
                'UPDATE estoque SET pacotes = $1, unidadesavulsas = $2, totalunidades = $3, custoporpacote = $4, estoqueminimo = $5, ultimaentrada = $6 WHERE id = $7',
                [novosPacotes, novasUnidadesAvulsas, novoTotalUnidades, custoPorPacote, estoqueMinimo, ultimaEntrada, item.id]
            );
        } else {
            await pool.query(
                'INSERT INTO estoque (produto, fornecedor_id, pacotes, unidadesavulsas, totalunidades, custoporpacote, estoqueminimo, ultimaentrada) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
                [produto, fornecedor_id || null, pacotes, unidadesAvulsas, totalUnidadesAdicionadas, custoPorPacote, estoqueMinimo, ultimaEntrada]
            );
        }
        res.status(201).json({ message: 'Estoque atualizado!' });
    } catch (err) {
        console.error('!!! ERRO na rota POST /api/estoque:', err);
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/estoque/:id', async (req, res) => { /* ...código da rota... */ });
app.delete('/api/estoque/:id', async (req, res) => { /* ...código da rota... */ });
app.post('/api/saidas', async (req, res) => { /* ...código da rota... */ });

// --- NOVAS ROTAS PARA FORNECEDORES ---
app.get('/api/fornecedores', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM fornecedores ORDER BY nome');
    res.json({ data: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/fornecedores', async (req, res) => {
  try {
    const { nome } = req.body;
    if (!nome) { return res.status(400).json({error: 'O nome do fornecedor é obrigatório.'}); }
    const result = await pool.query('INSERT INTO fornecedores (nome) VALUES ($1) RETURNING *', [nome]);
    res.status(201).json({ data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/fornecedores/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM fornecedores WHERE id = $1', [id]);
        res.status(200).json({ message: 'Fornecedor deletado com sucesso!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  createTables();
});