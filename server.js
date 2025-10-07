// server.js - VERSÃO 100% COMPLETA com Relatórios

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const createTables = async () => {
  const queryText = `
    CREATE TABLE IF NOT EXISTS fornecedores ( id SERIAL PRIMARY KEY, nome TEXT NOT NULL UNIQUE );
    CREATE TABLE IF NOT EXISTS estoque ( id SERIAL PRIMARY KEY, produto TEXT NOT NULL, fornecedor_id INTEGER REFERENCES fornecedores(id) ON DELETE SET NULL, pacotes INTEGER DEFAULT 0, unidadesAvulsas INTEGER DEFAULT 0, totalUnidades INTEGER DEFAULT 0, custoPorPacote REAL DEFAULT 0, estoqueMinimo INTEGER DEFAULT 0, ultimaEntrada DATE );
    CREATE TABLE IF NOT EXISTS saidas ( id SERIAL PRIMARY KEY, data DATE NOT NULL, produtoId INTEGER NOT NULL REFERENCES estoque(id) ON DELETE CASCADE, produtoNome TEXT NOT NULL, totalUnidades INTEGER NOT NULL, custoTotal REAL NOT NULL, destino TEXT );
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

app.get('/api/dashboard/stats', async (req, res) => {
  try {
    const totalItensQuery = 'SELECT SUM(totalunidades) AS total_itens FROM estoque';
    const valorTotalQuery = 'SELECT SUM(CASE WHEN produto ILIKE \'%rolo%\' THEN totalunidades * custoporpacote ELSE (totalunidades / 5000.0) * custoporpacote END) AS valor_total FROM estoque';
    const itensCriticosQuery = 'SELECT COUNT(*) AS itens_criticos FROM estoque WHERE totalunidades <= estoqueminimo AND estoqueminimo > 0';
    const [totalItensRes, valorTotalRes, itensCriticosRes] = await Promise.all([
      pool.query(totalItensQuery), pool.query(valorTotalQuery), pool.query(itensCriticosQuery)
    ]);
    const stats = {
      totalItens: totalItensRes.rows[0].total_itens || 0,
      valorTotal: valorTotalRes.rows[0].valor_total || 0,
      itensCriticos: itensCriticosRes.rows[0].itens_criticos || 0,
    };
    res.json(stats);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/alertas/estoque-baixo', async (req, res) => {
  try {
    const query = 'SELECT produto, totalunidades, estoqueminimo FROM estoque WHERE totalunidades <= estoqueminimo AND estoqueminimo > 0';
    const result = await pool.query(query);
    res.json({ data: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/estoque', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT e.*, f.nome AS fornecedor_nome 
      FROM estoque e
      LEFT JOIN fornecedores f ON e.fornecedor_id = f.id
      ORDER BY e.produto
    `);
    res.json({ data: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/saidas', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM saidas ORDER BY data DESC');
    res.json({ data: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/estoque', async (req, res) => {
    const { produto, fornecedor_id, pacotes, unidadesAvulsas, custoPorPacote, estoqueMinimo, ultimaEntrada } = req.body;
    const tipo = produto.toLowerCase().includes('rolo') ? 'rolo' : 'cartela';
    const totalUnidadesAdicionadas = tipo === 'rolo' ? pacotes : (pacotes * 5000) + unidadesAvulsas;
    try {
        const selectRes = await pool.query('SELECT * FROM estoque WHERE produto = $1 AND (fornecedor_id = $2 OR (fornecedor_id IS NULL AND $2 IS NULL))', [produto, fornecedor_id || null]);
        if (selectRes.rows.length > 0) {
            const item = selectRes.rows[0];
            const novoTotalUnidades = item.totalunidades + totalUnidadesAdicionadas;
            const novosPacotes = tipo === 'rolo' ? novoTotalUnidades : Math.floor(novoTotalUnidades / 5000);
            const novasUnidadesAvulsas = tipo === 'rolo' ? 0 : novoTotalUnidades % 5000;
            await pool.query('UPDATE estoque SET pacotes = $1, unidadesavulsas = $2, totalunidades = $3, custoporpacote = $4, estoqueminimo = $5, ultimaentrada = $6 WHERE id = $7', [novosPacotes, novasUnidadesAvulsas, novoTotalUnidades, custoPorPacote, estoqueMinimo, ultimaEntrada, item.id]);
        } else {
            const novosPacotes = tipo === 'rolo' ? totalUnidadesAdicionadas : pacotes;
            await pool.query('INSERT INTO estoque (produto, fornecedor_id, pacotes, unidadesavulsas, totalunidades, custoporpacote, estoqueminimo, ultimaentrada) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [produto, fornecedor_id || null, novosPacotes, unidadesAvulsas, totalUnidadesAdicionadas, custoPorPacote, estoqueMinimo, ultimaEntrada]);
        }
        res.status(201).json({ message: 'Estoque atualizado!' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/estoque/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { fornecedor_id, pacotes, unidadesavulsas, custoporpacote, estoqueminimo } = req.body;
    const itemInfo = await pool.query('SELECT produto FROM estoque WHERE id = $1', [id]);
    if (itemInfo.rows.length === 0) { return res.status(404).json({ error: 'Item não encontrado para editar.' }); }
    const tipo = itemInfo.rows[0].produto.toLowerCase().includes('rolo') ? 'rolo' : 'cartela';
    const totalunidades = tipo === 'rolo' ? pacotes : (pacotes * 5000) + unidadesavulsas;
    const updateQuery = `UPDATE estoque SET fornecedor_id = $1, pacotes = $2, unidadesavulsas = $3, totalunidades = $4, custoporpacote = $5, estoqueminimo = $6 WHERE id = $7`;
    const result = await pool.query(updateQuery, [fornecedor_id, pacotes, unidadesavulsas, totalunidades, custoporpacote, estoqueminimo, id]);
    if (result.rowCount === 0) { return res.status(404).json({ error: 'Item não encontrado para editar.' }); }
    res.status(200).json({ message: 'Item atualizado com sucesso!' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/estoque/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM estoque WHERE id = $1', [id]);
    if (result.rowCount === 0) { return res.status(404).json({ error: 'Item não encontrado para deletar.' }); }
    res.status(200).json({ message: 'Item deletado com sucesso!' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/saidas', async (req, res) => {
  const { data, produtoId, totalUnidades, destino } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const estoqueRes = await client.query('SELECT * FROM estoque WHERE id = $1 FOR UPDATE', [produtoId]);
    if (estoqueRes.rows.length === 0) { throw new Error('Produto não encontrado no estoque.'); }
    const item = estoqueRes.rows[0];
    if (item.totalunidades < totalUnidades) { throw new Error('Estoque insuficiente para esta saída.'); }
    const tipo = item.produto.toLowerCase().includes('rolo') ? 'rolo' : 'cartela';
    const novoTotalUnidades = item.totalunidades - totalUnidades;
    const novosPacotes = tipo === 'rolo' ? novoTotalUnidades : Math.floor(novoTotalUnidades / 5000);
    const novasUnidadesAvulsas = tipo === 'rolo' ? 0 : novoTotalUnidades % 5000;
    const custoDaSaida = tipo === 'rolo' ? totalUnidades * item.custoporpacote : (totalUnidades / 5000) * item.custoporpacote;
    await client.query('UPDATE estoque SET totalunidades = $1, pacotes = $2, unidadesavulsas = $3 WHERE id = $4', [novoTotalUnidades, novosPacotes, novasUnidadesAvulsas, produtoId]);
    await client.query('INSERT INTO saidas (data, produtoid, produtonome, totalunidades, custototal, destino) VALUES ($1, $2, $3, $4, $5, $6)', [data, produtoId, item.produto, totalUnidades, custoDaSaida, destino]);
    await client.query('COMMIT');
    res.status(201).json({ message: 'Saída registrada com sucesso!' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.get('/api/fornecedores', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM fornecedores ORDER BY nome');
    res.json({ data: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/fornecedores', async (req, res) => {
  try {
    const { nome } = req.body;
    if (!nome) { return res.status(400).json({error: 'O nome do fornecedor é obrigatório.'}); }
    const result = await pool.query('INSERT INTO fornecedores (nome) VALUES ($1) RETURNING *', [nome]);
    res.status(201).json({ data: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/fornecedores/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM fornecedores WHERE id = $1', [id]);
        res.status(200).json({ message: 'Fornecedor deletado com sucesso!' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/relatorios/valor-por-produto', async (req, res) => {
  try {
    const query = `
      SELECT 
        produto, 
        totalunidades,
        CASE
          WHEN produto ILIKE '%rolo%' THEN totalunidades * custoporpacote
          ELSE (totalunidades / 5000.0) * custoporpacote
        END AS valor_total
      FROM estoque
      WHERE totalunidades > 0
      ORDER BY produto;
    `;
    const result = await pool.query(query);
    res.json({ data: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/relatorios/saidas-por-periodo', async (req, res) => {
    const { de, ate } = req.query;
    if (!de || !ate) { return res.status(400).json({ error: 'As datas de início e fim são obrigatórias.' }); }
    try {
        const query = 'SELECT * FROM saidas WHERE data >= $1 AND data <= $2 ORDER BY data DESC';
        const result = await pool.query(query, [de, ate]);
        res.json({ data: result.rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  createTables();
});