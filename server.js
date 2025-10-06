// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração da conexão com o PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Função para criar as tabelas se não existirem
const createTables = async () => {
  const queryText = `
    CREATE TABLE IF NOT EXISTS estoque (
      id SERIAL PRIMARY KEY,
      produto TEXT NOT NULL,
      fornecedor TEXT,
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
      produtoId INTEGER NOT NULL,
      produtoNome TEXT NOT NULL,
      totalUnidades INTEGER NOT NULL,
      custoTotal REAL NOT NULL,
      destino TEXT,
      FOREIGN KEY (produtoId) REFERENCES estoque (id) ON DELETE CASCADE
    );
  `;
  try {
    await pool.query(queryText);
    console.log('Tabelas verificadas/criadas com sucesso.');
  } catch (err) {
    console.error('Erro ao criar tabelas:', err);
  }
};

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // Serve o front-end

// --- ROTAS DA API ---

app.get('/api/estoque', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM estoque ORDER BY produto');
    res.json({ data: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/estoque', async (req, res) => {
    const { produto, fornecedor, pacotes, unidadesAvulsas, custoPorPacote, estoqueMinimo, ultimaEntrada } = req.body;
    const totalUnidadesAdicionadas = (pacotes * 5000) + unidadesAvulsas;

    try {
        const selectRes = await pool.query('SELECT * FROM estoque WHERE produto = $1 AND fornecedor = $2', [produto, fornecedor]);

        if (selectRes.rows.length > 0) { // Item existe, vamos atualizar
            const item = selectRes.rows[0];
            const novoTotalUnidades = item.totalunidades + totalUnidadesAdicionadas;
            const novosPacotes = Math.floor(novoTotalUnidades / 5000);
            const novasUnidadesAvulsas = novoTotalUnidades % 5000;

            await pool.query(
                'UPDATE estoque SET pacotes = $1, unidadesavulsas = $2, totalunidades = $3, custoporpacote = $4, estoqueminimo = $5, ultimaentrada = $6 WHERE id = $7',
                [novosPacotes, novasUnidadesAvulsas, novoTotalUnidades, custoPorPacote, estoqueMinimo, ultimaEntrada, item.id]
            );
        } else { // Item não existe, vamos inserir
            await pool.query(
                'INSERT INTO estoque (produto, fornecedor, pacotes, unidadesavulsas, totalunidades, custoporpacote, estoqueminimo, ultimaentrada) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
                [produto, fornecedor, pacotes, unidadesAvulsas, totalUnidadesAdicionadas, custoPorPacote, estoqueMinimo, ultimaEntrada]
            );
        }
        res.status(201).json({ message: 'Estoque atualizado com sucesso!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Adicione aqui as outras rotas (PUT e DELETE de estoque, POST e GET de saidas) adaptadas para 'pool.query'

// Iniciar o servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  createTables();
});