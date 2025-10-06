// server.js - Versão com a funcionalidade REGISTRAR SAÍDA

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

const createTables = async () => { /* ... O código para criar tabelas continua o mesmo ... */ };

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- ROTAS DA API ---

app.get('/api/estoque', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM estoque ORDER BY produto');
    res.json({ data: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/saidas', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM saidas ORDER BY data DESC');
    res.json({ data: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/estoque', async (req, res) => {
    // ... o código para adicionar/atualizar estoque continua o mesmo ...
});

app.put('/api/estoque/:id', async (req, res) => {
    // ... o código para editar estoque continua o mesmo ...
});

app.delete('/api/estoque/:id', async (req, res) => {
    // ... o código para deletar estoque continua o mesmo ...
});

// NOVA ROTA PARA REGISTRAR UMA SAÍDA
app.post('/api/saidas', async (req, res) => {
  const { data, produtoId, totalUnidades, destino } = req.body;
  const client = await pool.connect(); // Pega uma conexão do pool para fazer a transação

  try {
    // INICIA A TRANSAÇÃO
    await client.query('BEGIN');

    // 1. Busca o item no estoque e o "tranca" para evitar que outra pessoa o altere ao mesmo tempo
    const estoqueRes = await client.query('SELECT * FROM estoque WHERE id = $1 FOR UPDATE', [produtoId]);

    if (estoqueRes.rows.length === 0) {
      throw new Error('Produto não encontrado no estoque.');
    }
    const item = estoqueRes.rows[0];

    // 2. Verifica se há estoque suficiente
    if (item.totalunidades < totalUnidades) {
      throw new Error('Estoque insuficiente para esta saída.');
    }

    // 3. Calcula o novo total e o custo da saída
    const novoTotalUnidades = item.totalunidades - totalUnidades;
    const novosPacotes = Math.floor(novoTotalUnidades / 5000);
    const novasUnidadesAvulsas = novoTotalUnidades % 5000;
    const custoDaSaida = (totalUnidades / 5000) * item.custoporpacote;

    // 4. Atualiza a tabela de estoque
    await client.query(
      'UPDATE estoque SET totalunidades = $1, pacotes = $2, unidadesavulsas = $3 WHERE id = $4',
      [novoTotalUnidades, novosPacotes, novasUnidadesAvulsas, produtoId]
    );

    // 5. Insere o registro na tabela de saídas
    await client.query(
      'INSERT INTO saidas (data, produtoid, produtonome, totalunidades, custototal, destino) VALUES ($1, $2, $3, $4, $5, $6)',
      [data, produtoId, item.produto, totalUnidades, custoDaSaida, destino]
    );

    // FINALIZA A TRANSAÇÃO (confirma todas as operações)
    await client.query('COMMIT');
    res.status(201).json({ message: 'Saída registrada com sucesso!' });

  } catch (err) {
    // SE DER QUALQUER ERRO, DESFAZ TUDO O QUE FOI FEITO NA TRANSAÇÃO
    await client.query('ROLLBACK');
    console.error('Erro na transação de saída:', err);
    res.status(400).json({ error: err.message }); // Usamos 400 para erros de lógica (ex: estoque insuficiente)
  } finally {
    // Libera a conexão de volta para o pool
    client.release();
  }
});


app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  // A função createTables precisa ser chamada aqui para garantir que as tabelas existam
  createTables(); 
});