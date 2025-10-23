// server.js - VERSÃO 100% COMPLETA E CORRIGIDA (sem login)

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Inicialização da IA do Google
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const createTables = async () => {
  const queryText = `
    CREATE TABLE IF NOT EXISTS fornecedores ( id SERIAL PRIMARY KEY, nome TEXT NOT NULL UNIQUE );
    CREATE TABLE IF NOT EXISTS estoque ( id SERIAL PRIMARY KEY, produto TEXT NOT NULL, fornecedor_id INTEGER REFERENCES fornecedores(id) ON DELETE SET NULL, pacotes INTEGER DEFAULT 0, unidadesAvulsas INTEGER DEFAULT 0, totalUnidades INTEGER DEFAULT 0, custoPorPacote REAL DEFAULT 0, estoqueMinimo INTEGER DEFAULT 0, ultimaEntrada DATE );
    CREATE TABLE IF NOT EXISTS saidas ( id SERIAL PRIMARY KEY, data DATE NOT NULL, produtoId INTEGER NOT NULL REFERENCES estoque(id) ON DELETE CASCADE, produtoNome TEXT NOT NULL, totalUnidades INTEGER NOT NULL, custoTotal REAL NOT NULL, destino TEXT );
    CREATE TABLE IF NOT EXISTS uso_producao (
      id SERIAL PRIMARY KEY,
      estoque_id INTEGER NOT NULL REFERENCES estoque(id) ON DELETE CASCADE,
      produto_nome TEXT NOT NULL,
      data_inicio DATE NOT NULL,
      data_fim DATE,
      etiquetas_impressas INTEGER,
      status VARCHAR(50) NOT NULL DEFAULT 'Em Uso'
    );
  `;
  try {
    await pool.query(queryText);
    console.log('Tabelas verificadas/criadas com sucesso.');
  } catch (err) { console.error('Erro ao criar tabelas:', err); }
};

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- MIDDLEWARE DE AUTENTICAÇÃO ---
const protegerRota = (req, res, next) => {
    next(); // Proteção desativada
};

// --- ROTAS DA API ---
app.get('/api/dashboard/stats', protegerRota, async (req, res) => {
  try {
    const totalItensQuery = 'SELECT SUM(totalunidades) AS total_itens FROM estoque';
    const valorTotalQuery = 'SELECT SUM(CASE WHEN produto ILIKE \'%rolo%\' THEN totalunidades * custoporpacote ELSE (totalunidades / 5000.0) * custoporpacote END) AS valor_total FROM estoque';
    const itensCriticosQuery = 'SELECT COUNT(*) AS itens_criticos FROM estoque WHERE totalunidades <= estoqueminimo AND estoqueminimo > 0';
    const [totalItensRes, valorTotalRes, itensCriticosRes] = await Promise.all([ pool.query(totalItensQuery), pool.query(valorTotalQuery), pool.query(itensCriticosQuery) ]);
    const stats = { totalItens: totalItensRes.rows[0].total_itens || 0, valorTotal: valorTotalRes.rows[0].valor_total || 0, itensCriticos: itensCriticosRes.rows[0].itens_criticos || 0 };
    res.json(stats);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/alertas/estoque-baixo', protegerRota, async (req, res) => {
  try {
    const query = 'SELECT produto, totalunidades, estoqueminimo FROM estoque WHERE totalunidades <= estoqueminimo AND estoqueminimo > 0';
    const result = await pool.query(query);
    res.json({ data: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/estoque', protegerRota, async (req, res) => {
  try {
    const result = await pool.query(`SELECT e.*, f.nome AS fornecedor_nome FROM estoque e LEFT JOIN fornecedores f ON e.fornecedor_id = f.id ORDER BY e.produto`);
    res.json({ data: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/saidas', protegerRota, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM saidas ORDER BY data DESC');
    res.json({ data: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/estoque', protegerRota, async (req, res) => {
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
app.put('/api/estoque/:id', protegerRota, async (req, res) => {
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
app.delete('/api/estoque/:id', protegerRota, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM estoque WHERE id = $1', [id]);
    if (result.rowCount === 0) { return res.status(404).json({ error: 'Item não encontrado para deletar.' }); }
    res.status(200).json({ message: 'Item deletado com sucesso!' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/saidas', protegerRota, async (req, res) => {
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
app.get('/api/fornecedores', protegerRota, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM fornecedores ORDER BY nome');
    res.json({ data: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/fornecedores', protegerRota, async (req, res) => {
  try {
    const { nome } = req.body;
    if (!nome) { return res.status(400).json({error: 'O nome do fornecedor é obrigatório.'}); }
    const result = await pool.query('INSERT INTO fornecedores (nome) VALUES ($1) RETURNING *', [nome]);
    res.status(201).json({ data: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.delete('/api/fornecedores/:id', protegerRota, async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM fornecedores WHERE id = $1', [id]);
        res.status(200).json({ message: 'Fornecedor deletado com sucesso!' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/relatorios/valor-por-produto', protegerRota, async (req, res) => {
  try {
    const query = `
      SELECT produto, totalunidades,
        CASE
          WHEN produto ILIKE '%rolo%' THEN totalunidades * custoporpacote
          ELSE (totalunidades / 5000.0) * custoporpacote
        END AS valor_total
      FROM estoque WHERE totalunidades > 0 ORDER BY produto;
    `;
    const result = await pool.query(query);
    res.json({ data: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/relatorios/saidas-por-periodo', protegerRota, async (req, res) => {
    const { de, ate } = req.query;
    if (!de || !ate) { return res.status(400).json({ error: 'As datas de início e fim são obrigatórias.' }); }
    try {
        const query = 'SELECT * FROM saidas WHERE data >= $1 AND data <= $2 ORDER BY data DESC';
        const result = await pool.query(query, [de, ate]);
        res.json({ data: result.rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/relatorios/historico-uso', protegerRota, async (req, res) => {
    try {
        const query = `
            SELECT up.produto_nome, up.data_inicio, up.data_fim, up.etiquetas_impressas, e.custoporpacote
            FROM uso_producao up
            JOIN estoque e ON up.estoque_id = e.id
            WHERE up.status = 'Finalizado' ORDER BY up.data_fim DESC;
        `;
        const result = await pool.query(query);
        const calcularDiasUteis = (inicio, fim) => {
            let dias = 0; let dataAtual = new Date(inicio); const dataFim = new Date(fim);
            while (dataAtual <= dataFim) {
                const diaDaSemana = dataAtual.getUTCDay();
                if (diaDaSemana !== 0) { dias++; }
                dataAtual.setUTCDate(dataAtual.getUTCDate() + 1);
            }
            return dias > 0 ? dias : 1;
        };
        const relatorioProcessado = result.rows.map(item => {
            const diasUteis = calcularDiasUteis(item.data_inicio, item.data_fim);
            const custoTotalDoRolo = item.custoporpacote;
            const custoPorDia = custoTotalDoRolo / diasUteis;
            const mediaEtiquetasPorDia = item.etiquetas_impressas ? item.etiquetas_impressas / diasUteis : null;
            return { ...item, dias_uteis: diasUteis, custo_dia: custoPorDia, media_etiquetas_dia: mediaEtiquetasPorDia };
        });
        res.json({ data: relatorioProcessado });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/producao/iniciar', protegerRota, async (req, res) => {
    const { estoque_id, data_inicio } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const estoqueRes = await client.query('SELECT * FROM estoque WHERE id = $1 FOR UPDATE', [estoque_id]);
        if (estoqueRes.rows.length === 0) throw new Error('Produto não encontrado no estoque.');
        const item = estoqueRes.rows[0];
        if (item.totalunidades < 1) throw new Error('Estoque insuficiente para iniciar o uso.');
        const novoTotalUnidades = item.totalunidades - 1;
        const novosPacotes = item.produto.toLowerCase().includes('rolo') ? novoTotalUnidades : Math.floor(novoTotalUnidades / 5000);
        await client.query('UPDATE estoque SET totalunidades = $1, pacotes = $2 WHERE id = $3', [novoTotalUnidades, novosPacotes, estoque_id]);
        const usoRes = await client.query(
            'INSERT INTO uso_producao (estoque_id, produto_nome, data_inicio, status) VALUES ($1, $2, $3, $4) RETURNING *',
            [estoque_id, item.produto, data_inicio, 'Em Uso']
        );
        await client.query('COMMIT');
        res.status(201).json({ data: usoRes.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: err.message });
    } finally {
        client.release();
    }
});
app.get('/api/producao/em-uso', protegerRota, async (req, res) => {
    try {
        const query = `SELECT up.id, up.data_inicio, e.produto AS produto_nome FROM uso_producao up JOIN estoque e ON up.estoque_id = e.id WHERE up.status = 'Em Uso' ORDER BY up.data_inicio ASC`;
        const result = await pool.query(query);
        res.json({ data: result.rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.put('/api/producao/finalizar/:id', protegerRota, async (req, res) => {
    const { id } = req.params;
    const { data_fim, etiquetas_impressas } = req.body;
    if (!data_fim) return res.status(400).json({ error: 'Data de finalização é obrigatória.' });
    try {
        const updateQuery = `UPDATE uso_producao SET data_fim = $1, etiquetas_impressas = $2, status = 'Finalizado' WHERE id = $3 RETURNING *`;
        const result = await pool.query(updateQuery, [data_fim, etiquetas_impressas || null, id]);
        if (result.rowCount === 0) { return res.status(404).json({ error: 'Registro de uso não encontrado.' }); }
        res.status(200).json({ data: result.rows[0] });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/ai/analise', protegerRota, async (req, res) => {
    const { pergunta } = req.body;
    if (!pergunta) { return res.status(400).json({ error: 'Nenhuma pergunta foi fornecida.' }); }
    try {
        const estoqueRes = await pool.query('SELECT e.produto, e.totalunidades, f.nome AS fornecedor_nome FROM estoque e LEFT JOIN fornecedores f ON e.fornecedor_id = f.id');
        const saidasRes = await pool.query('SELECT produtonome, totalunidades, data, destino FROM saidas ORDER BY data DESC LIMIT 100');
        const producaoRes = await pool.query('SELECT produto_nome, data_inicio, data_fim, etiquetas_impressas FROM uso_producao WHERE status = \'Finalizado\' ORDER BY data_fim DESC LIMIT 100');
        const estoqueAtual = estoqueRes.rows;
        const ultimasSaidas = saidasRes.rows;
        const historicoProducao = producaoRes.rows;
        const prompt = `
            Você é um assistente de análise de dados de um sistema de controle de estoque.
            Responda à pergunta do usuário de forma direta e concisa, baseando-se exclusivamente nos dados fornecidos abaixo.
            Não invente informações. Se os dados não permitirem responder, diga "Não tenho informações suficientes para responder a essa pergunta.".
            Hoje é ${new Date().toLocaleDateString('pt-BR')}.
            PERGUNTA DO USUÁRIO: "${pergunta}"
            DADOS DISPONÍVEIS:
            Estoque Atual (JSON): ${JSON.stringify(estoqueAtual)}
            Últimas 100 Saídas/Consumo (JSON): ${JSON.stringify(ultimasSaidas)}
            Últimos 100 Registros de Produção Finalizados (JSON): ${JSON.stringify(historicoProducao)}
            Sua Resposta:
        `;
        const model = genAI.getGenerativeModel("gemini-pro");
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        res.json({ resposta: text });
    } catch (err) {
        console.error("Erro na rota da IA:", err);
        res.status(500).json({ error: 'Ocorreu um erro ao processar sua pergunta com a IA.' });
    }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  createTables();
});