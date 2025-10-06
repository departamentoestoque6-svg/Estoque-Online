// server.js - VERSÃO COMPLETA E FINAL (com Dashboard, Adicionar, Visualizar, Editar e Deletar)

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
app.use(express.static(path.join(__dirname, 'public')));

// --- ROTAS DA API ---

// ROTA PARA AS ESTATÍSTICAS DO DASHBOARD
app.get('/api/dashboard/stats', async (req, res) => {
  console.log('>>> ROTA GET /api/dashboard/stats ACESSADA');
  try {
    const totalItensQuery = 'SELECT SUM(totalunidades) AS total_itens FROM estoque';
    const valorTotalQuery = 'SELECT SUM(totalunidades * custoporpacote / 5000) AS valor_total FROM estoque';
    const itensCriticosQuery = 'SELECT COUNT(*) AS itens_criticos FROM estoque WHERE totalunidades <= estoqueminimo AND estoqueminimo > 0';

    const [totalItensRes, valorTotalRes, itensCriticosRes] = await Promise.all([
      pool.query(totalItensQuery),
      pool.query(valorTotalQuery),
      pool.query(itensCriticosQuery)
    ]);

    const stats = {
      totalItens: totalItensRes.rows[0].total_itens || 0,
      valorTotal: valorTotalRes.rows[0].valor_total || 0,
      itensCriticos: itensCriticosRes.rows[0].itens_criticos || 0,
    };
    console.log('>>> SUCESSO na busca das estatísticas do dashboard.');
    res.json(stats);
  } catch (err) {
    console.error('!!! ERRO na rota de stats do dashboard:', err);
    res.status(500).json({ error: err.message });
  }
});

// ROTA PARA BUSCAR TODO O ESTOQUE
app.get('/api/estoque', async (req, res) => {
  console.log('>>> ROTA GET /api/estoque ACESSADA');
  try {
    const result = await pool.query('SELECT * FROM estoque ORDER BY produto');
    console.log('>>> SUCESSO na busca do estoque.');
    res.json({ data: result.rows });
  } catch (err) {
    console.error('!!! ERRO na rota GET /api/estoque:', err);
    res.status(500).json({ error: err.message });
  }
});

// ROTA PARA BUSCAR TODAS AS SAÍDAS
app.get('/api/saidas', async (req, res) => {
  console.log('>>> ROTA GET /api/saidas ACESSADA');
  try {
    const result = await pool.query('SELECT * FROM saidas ORDER BY data DESC');
    console.log('>>> SUCESSO na busca das saídas.');
    res.json({ data: result.rows });
  } catch (err) {
    console.error('!!! ERRO na rota GET /api/saidas:', err);
    res.status(500).json({ error: err.message });
  }
});

// ROTA PARA ADICIONAR/ATUALIZAR UM ITEM
app.post('/api/estoque', async (req, res) => {
    console.log('>>> ROTA POST /api/estoque ACESSADA');
    const { produto, fornecedor, pacotes, unidadesAvulsas, custoPorPacote, estoqueMinimo, ultimaEntrada } = req.body;
    const totalUnidadesAdicionadas = (pacotes * 5000) + unidadesAvulsas;
    
    try {
        const selectRes = await pool.query('SELECT * FROM estoque WHERE produto = $1 AND (fornecedor = $2 OR (fornecedor IS NULL AND $2 IS NULL))', [produto, fornecedor || null]);
        
        if (selectRes.rows.length > 0) {
            const item = selectRes.rows[0];
            const novoTotalUnidades = item.totalunidades + totalUnidadesAdicionadas;
            const novosPacotes = Math.floor(novoTotalUnidades / 5000);
            const novasUnidadesAvulsas = novoTotalUnidades % 5000;
            
            await pool.query(
                'UPDATE estoque SET pacotes = $1, unidadesavulsas = $2, totalunidades = $3, custoporpacote = $4, estoqueminimo = $5, ultimaentrada = $6 WHERE id = $7',
                [novosPacotes, novasUnidadesAvulsas, novoTotalUnidades, custoPorPacote, estoqueMinimo, ultimaEntrada, item.id]
            );
        } else {
            await pool.query(
                'INSERT INTO estoque (produto, fornecedor, pacotes, unidadesavulsas, totalunidades, custoporpacote, estoqueminimo, ultimaentrada) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
                [produto, fornecedor || null, pacotes, unidadesAvulsas, totalUnidadesAdicionadas, custoPorPacote, estoqueMinimo, ultimaEntrada]
            );
        }
        res.status(201).json({ message: 'Estoque atualizado!' });
    } catch (err) {
        console.error('!!! ERRO na rota POST /api/estoque:', err);
        res.status(500).json({ error: err.message });
    }
});

// ROTA PARA EDITAR UM ITEM
app.put('/api/estoque/:id', async (req, res) => {
    console.log(`>>> ROTA PUT /api/estoque/${req.params.id} ACESSADA`);
  try {
    const { id } = req.params;
    const { fornecedor, pacotes, unidadesavulsas, custoporpacote, estoqueminimo } = req.body;
    
    const totalunidades = (pacotes * 5000) + unidadesavulsas;

    const updateQuery = `
      UPDATE estoque 
      SET fornecedor = $1, pacotes = $2, unidadesavulsas = $3, totalunidades = $4, custoporpacote = $5, estoqueminimo = $6
      WHERE id = $7
    `;
    
    const result = await pool.query(updateQuery, [fornecedor, pacotes, unidadesavulsas, totalunidades, custoporpacote, estoqueminimo, id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Item não encontrado para editar.' });
    }

    res.status(200).json({ message: 'Item atualizado com sucesso!' });
  } catch (err) {
    console.error(`!!! ERRO na rota PUT /api/estoque/${req.params.id}:`, err);
    res.status(500).json({ error: err.message });
  }
});

// ROTA PARA DELETAR UM ITEM
app.delete('/api/estoque/:id', async (req, res) => {
    console.log(`>>> ROTA DELETE /api/estoque/${req.params.id} ACESSADA`);
  try {
    const { id } = req.params;
    const deleteQuery = 'DELETE FROM estoque WHERE id = $1';
    
    const result = await pool.query(deleteQuery, [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Item não encontrado para deletar.' });
    }

    res.status(200).json({ message: 'Item deletado com sucesso!' });
  } catch (err) {
    console.error(`!!! ERRO na rota DELETE /api/estoque/${req.params.id}:`, err);
    res.status(500).json({ error: err.message });
  }
});

// ROTA PARA REGISTRAR UMA SAÍDA
app.post('/api/saidas', async (req, res) => {
  console.log('>>> ROTA POST /api/saidas ACESSADA');
  const { data, produtoId, totalUnidades, destino } = req.body;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const estoqueRes = await client.query('SELECT * FROM estoque WHERE id = $1 FOR UPDATE', [produtoId]);

    if (estoqueRes.rows.length === 0) { throw new Error('Produto não encontrado no estoque.'); }
    const item = estoqueRes.rows[0];

    if (item.totalunidades < totalUnidades) { throw new Error('Estoque insuficiente para esta saída.'); }

    const novoTotalUnidades = item.totalunidades - totalUnidades;
    const novosPacotes = Math.floor(novoTotalUnidades / 5000);
    const novasUnidadesAvulsas = novoTotalUnidades % 5000;
    const custoDaSaida = (totalUnidades / 5000) * item.custoporpacote;

    await client.query(
      'UPDATE estoque SET totalunidades = $1, pacotes = $2, unidadesavulsas = $3 WHERE id = $4',
      [novoTotalUnidades, novosPacotes, novasUnidadesAvulsas, produtoId]
    );

    await client.query(
      'INSERT INTO saidas (data, produtoid, produtonome, totalunidades, custototal, destino) VALUES ($1, $2, $3, $4, $5, $6)',
      [data, produtoId, item.produto, totalUnidades, custoDaSaida, destino]
    );

    await client.query('COMMIT');
    res.status(201).json({ message: 'Saída registrada com sucesso!' });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('!!! ERRO na rota POST /api/saidas:', err);
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});


app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  createTables();
});