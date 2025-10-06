// server.js - Versão com as funcionalidades DELETAR e EDITAR

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
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// NOVA ROTA PARA EDITAR UM ITEM (MÉTODO PUT)
app.put('/api/estoque/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { fornecedor, pacotes, unidadesavulsas, custoporpacote, estoqueminimo } = req.body;
    
    // Recalcula o total de unidades com base nos dados recebidos
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
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});


app.delete('/api/estoque/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const deleteQuery = 'DELETE FROM estoque WHERE id = $1';
    
    const result = await pool.query(deleteQuery, [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Item não encontrado para deletar.' });
    }

    res.status(200).json({ message: 'Item deletado com sucesso!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});


app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  createTables();
});