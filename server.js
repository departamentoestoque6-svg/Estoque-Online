// server.js - VERSÃO 100% LIMPA E CORRIGIDA (Bug "createTables" + Bug "Embalagem")

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sgMail = require('@sendgrid/mail');

const app = express();
const PORT = process.env.PORT || 3000;

// --- CONFIGURAÇÕES ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Configura o SendGrid
sgMail.setApiKey(process.env.SENDGRID_API_KEY);
const emailRemetente = process.env.EMAIL_REMETENTE;

// --- CRIAÇÃO DE TABELAS ---
const createTables = async () => {
  // 1. Lista de todas as queries de criação
  const queries = [
    `CREATE TABLE IF NOT EXISTS fornecedores ( id SERIAL PRIMARY KEY, nome TEXT NOT NULL UNIQUE );`,
    `CREATE TABLE IF NOT EXISTS categorias (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL UNIQUE,
      tipo_unidade VARCHAR(50) NOT NULL DEFAULT 'cartela'
    );`,
    `CREATE TABLE IF NOT EXISTS estoque (
      id SERIAL PRIMARY KEY,
      produto TEXT NOT NULL,
      fornecedor_id INTEGER REFERENCES fornecedores(id) ON DELETE SET NULL,
      categoria_id INTEGER REFERENCES categorias(id) ON DELETE SET NULL,
      pacotes INTEGER DEFAULT 0,
      unidadesAvulsas INTEGER DEFAULT 0,
      totalUnidades INTEGER DEFAULT 0,
      custoPorPacote REAL DEFAULT 0,
      estoqueMinimo INTEGER DEFAULT 0,
      ultimaEntrada DATE,
      UNIQUE(produto, fornecedor_id)
    );`,
    `CREATE TABLE IF NOT EXISTS saidas ( id SERIAL PRIMARY KEY, data DATE NOT NULL, produtoId INTEGER NOT NULL REFERENCES estoque(id) ON DELETE CASCADE, produtoNome TEXT NOT NULL, totalUnidades INTEGER NOT NULL, custoTotal REAL NOT NULL, destino TEXT );`,
    `CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      senha TEXT NOT NULL,
      receber_alertas BOOLEAN DEFAULT false
    );`,
    `CREATE TABLE IF NOT EXISTS uso_producao (
      id SERIAL PRIMARY KEY,
      estoque_id INTEGER NOT NULL REFERENCES estoque(id) ON DELETE CASCADE,
      produto_nome TEXT NOT NULL,
      data_inicio DATE NOT NULL,
      data_fim DATE,
      etiquetas_impressas INTEGER,
      status VARCHAR(50) NOT NULL DEFAULT 'Em Uso'
    );`
  ];

  try {
    // 2. Executa cada query de criação, UMA POR UMA (CORREÇÃO DO ERRO 42601)
    for (const query of queries) {
      await pool.query(query);
    }
    console.log('Verificação inicial de tabelas concluída.');

    // 3. RODA A LÓGICA DE MIGRAÇÃO (para colunas)
    try {
        await pool.query('SELECT categoria_id FROM estoque LIMIT 1');
    } catch (e) {
        if (e.code === '42703') { // 42703 = undefined_column
            console.log('Detectada estrutura antiga (sem categoria_id). Limpando e recriando tabelas...');
            // Se a estrutura é antiga, temos que dropar na ordem certa
            await pool.query('DROP TABLE IF EXISTS saidas;');
            await pool.query('DROP TABLE IF EXISTS uso_producao;');
            await pool.query('DROP TABLE IF EXISTS estoque;');
            await pool.query('DROP TABLE IF EXISTS categorias;');
            await pool.query('DROP TABLE IF EXISTS fornecedores;');
            
            // E recriar tudo
            for (const query of queries) {
                await pool.query(query);
            }
            console.log('Tabelas recriadas com sucesso.');
        }
    }
    try {
        await pool.query('SELECT receber_alertas FROM usuarios LIMIT 1');
    } catch (e) {
        if (e.code === '42703') { // Coluna não existe
            console.log('Adicionando coluna "receber_alertas" na tabela usuarios.');
            await pool.query('ALTER TABLE usuarios ADD COLUMN receber_alertas BOOLEAN DEFAULT false');
        }
    }
    console.log('Tabelas verificadas/criadas com sucesso.');
  } catch (err) { console.error('Erro ao criar tabelas:', err); }
};

// --- MIDDLEWARES ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const protegerRota = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) {
        console.log('Acesso negado: Sem token.');
        return res.sendStatus(401);
    }
    const jwtSecret = process.env.JWT_SECRET || 'seu-segredo-super-secreto-aqui-12345';
    jwt.verify(token, jwtSecret, (err, user) => {
        if (err) {
            console.log('Acesso negado: Token inválido ou expirado.');
            return res.sendStatus(403);
        }
        req.user = user;
        next();
    });
};

// --- ROTAS PÚBLICAS (Login/Registro) ---
app.post('/api/usuarios/registrar', async (req, res) => {
    try {
        const { email, senha } = req.body;
        if (!email || !senha) { return res.status(400).json({ error: 'Email e senha são obrigatórios.' }); }
        const userCountRes = await pool.query("SELECT COUNT(*) FROM usuarios");
        if (userCountRes.rows[0].count > 0) {
            return res.status(403).json({ error: 'Novos registros estão desativados.' });
        }
        const hashedPassword = await bcrypt.hash(senha, 10);
        const newUser = await pool.query("INSERT INTO usuarios (email, senha) VALUES ($1, $2) RETURNING id, email", [email, hashedPassword]);
        res.status(201).json(newUser.rows[0]);
    } catch (err) { res.status(500).json({ error: 'Email já pode estar em uso ou outro erro ocorreu.' }); }
});

app.post('/api/usuarios/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    const userRes = await pool.query("SELECT * FROM usuarios WHERE email = $1", [email]);
    if (userRes.rows.length === 0) { return res.status(400).json({ error: 'Email ou senha inválidos.' }); }
    const user = userRes.rows[0];
    const senhaValida = await bcrypt.compare(senha, user.senha);
    if (!senhaValida) { return res.status(400).json({ error: 'Email ou senha inválidos.' }); }
    const jwtSecret = process.env.JWT_SECRET || 'seu-segredo-super-secreto-aqui-12345';
    const accessToken = jwt.sign({ id: user.id, email: user.email }, jwtSecret, { expiresIn: '1d' });
    res.json({ accessToken: accessToken });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- ROTAS DA PÁGINA ---
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.get('/app', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- ROTAS PROTEGIDAS DE USUÁRIO ---
app.put('/api/usuarios/alterar-senha', protegerRota, async (req, res) => {
    const { senhaAtual, novaSenha } = req.body;
    const userId = req.user.id; 
    if (!senhaAtual || !novaSenha) { return res.status(400).json({ error: 'Todos os campos são obrigatórios.' }); }
    try {
        const userRes = await pool.query('SELECT senha FROM usuarios WHERE id = $1', [userId]);
        if (userRes.rows.length === 0) { return res.status(404).json({ error: 'Usuário não encontrado.' }); }
        const hashSenhaAtual = userRes.rows[0].senha;
        const senhaValida = await bcrypt.compare(senhaAtual, hashSenhaAtual);
        if (!senhaValida) { return res.status(401).json({ error: 'A senha atual está incorreta.' }); }
        const hashNovaSenha = await bcrypt.hash(novaSenha, 10);
        await pool.query('UPDATE usuarios SET senha = $1 WHERE id = $2', [hashNovaSenha, userId]);
        res.status(200).json({ message: 'Senha alterada com sucesso!' });
    } catch (err) {
        console.error("Erro ao alterar senha:", err);
        res.status(500).json({ error: 'Erro interno ao alterar a senha.' });
    }
});
app.get('/api/usuarios/preferencias', protegerRota, async (req, res) => {
    const userId = req.user.id;
    try {
        const result = await pool.query('SELECT receber_alertas FROM usuarios WHERE id = $1', [userId]);
        if (result.rows.length === 0) { return res.status(404).json({ error: 'Usuário não encontrado.' }); }
        res.json({ receber_alertas: result.rows[0].receber_alertas });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao buscar preferências.' });
    }
});
app.put('/api/usuarios/preferencias', protegerRota, async (req, res) => {
    const userId = req.user.id;
    const { receber_alertas } = req.body;
    try {
        await pool.query('UPDATE usuarios SET receber_alertas = $1 WHERE id = $2', [receber_alertas, userId]);
        res.status(200).json({ message: 'Preferências atualizadas com sucesso!' });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao salvar preferências.' });
    }
});

// --- FUNÇÃO E ROTA DE VERIFICAÇÃO DE ALERTAS ---
async function enviarEmailAlerta(para, assunto, textoHtml) {
    if (!emailRemetente || !process.env.SENDGRID_API_KEY) {
        console.error("ERRO: SENDGRID_API_KEY ou EMAIL_REMETENTE não definidos. Email não pode ser enviado.");
        throw new Error("Serviço de email não configurado.");
    }
    const msg = {
        to: para,
        from: emailRemetente,
        subject: assunto,
        html: textoHtml,
    };
    try {
        await sgMail.send(msg);
        console.log(`Email enviado com sucesso para ${para}`);
        return true;
    } catch (error) {
        console.error('Erro ao enviar email pelo SendGrid:', error);
        if (error.response) {
            console.error(error.response.body);
        }
        throw error;
    }
}

async function verificarEEnviarAlertas() {
    try {
        console.log('Iniciando verificação de estoque crítico...');
        const itensRes = await pool.query('SELECT produto, totalunidades FROM estoque WHERE totalunidades <= estoqueminimo AND estoqueminimo > 0');
        const itensCriticos = itensRes.rows;

        if (itensCriticos.length === 0) {
            console.log('Nenhum item crítico encontrado.');
            return { message: 'Nenhum item crítico encontrado. Emails não enviados.' };
        }

        let listaHtml = '<ul>';
        itensCriticos.forEach(item => {
            listaHtml += `<li><b>${item.produto}:</b> ${item.totalunidades} unidades restantes.</li>`;
        });
        listaHtml += '</ul>';
        const corpoHtml = `<h2>Alerta de Estoque Crítico</h2><p>Os seguintes itens do seu estoque estão acabando:</p>${listaHtml}<p>Por favor, acesse o sistema para tomar uma providência.</p>`;

        const usuariosRes = await pool.query('SELECT email FROM usuarios WHERE receber_alertas = true');
        const destinatarios = usuariosRes.rows.map(u => u.email);

        if (destinatarios.length === 0) {
            console.log('Itens críticos encontrados, mas nenhum usuário optou por receber alertas.');
            return { message: 'Itens críticos encontrados, mas nenhum usuário optou por receber alertas.' };
        }

        await enviarEmailAlerta(destinatarios, 'Alerta de Estoque Crítico', corpoHtml);
        return { message: `Alertas de estoque crítico enviados para ${destinatarios.length} usuário(s).` };
    } catch (err) {
        console.error("Erro na verificação de alertas:", err);
        throw err;
    }
}

app.post('/api/estoque/verificar-alertas', protegerRota, async (req, res) => {
    try {
        const resultado = await verificarEEnviarAlertas();
        res.status(200).json(resultado);
    } catch (err) {
        res.status(500).json({ error: 'Erro ao verificar alertas.' });
    }
});

app.get('/api/cron/verificar-alertas/:secret', async (req, res) => {
    const { secret } = req.params;
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
        console.log("CRON JOB falhou: CRON_SECRET não está definido no ambiente.");
        return res.status(500).json({ error: 'Serviço de cron não configurado.' });
    }
    if (secret !== cronSecret) {
        console.log("CRON JOB falhou: Segredo inválido.");
        return res.status(401).json({ error: 'Não autorizado.' });
    }
    try {
        const resultado = await verificarEEnviarAlertas();
        res.status(200).json(resultado);
    } catch (err) {
        res.status(500).json({ error: 'Erro ao executar verificação de alertas.' });
    }
});


// --- OUTRAS ROTAS DA API (PROTEGIDAS) ---
app.get('/api/dashboard/stats', protegerRota, async (req, res) => {
  try {
    const totalItensQuery = 'SELECT SUM(e.totalunidades) AS total_itens FROM estoque e';
    const valorTotalQuery = `
        SELECT SUM(
            CASE 
                WHEN c.tipo_unidade = 'rolo' OR c.tipo_unidade = 'embalagem' THEN e.totalunidades * e.custoporpacote
                ELSE (e.totalunidades / 5000.0) * e.custoporpacote 
            END
        ) AS valor_total 
        FROM estoque e
        LEFT JOIN categorias c ON e.categoria_id = c.id
    `;
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
    const pagina = parseInt(req.query.pagina || 1);
    const limite = parseInt(req.query.limite || 20); 
    const offset = (pagina - 1) * limite;
    const dadosQuery = `
      SELECT e.*, f.nome AS fornecedor_nome, c.nome AS categoria_nome, c.tipo_unidade
      FROM estoque e 
      LEFT JOIN fornecedores f ON e.fornecedor_id = f.id
      LEFT JOIN categorias c ON e.categoria_id = c.id
      ORDER BY e.produto
      LIMIT $1 OFFSET $2
    `;
    const dadosRes = await pool.query(dadosQuery, [limite, offset]);
    const totalQuery = 'SELECT COUNT(*) AS total_itens FROM estoque';
    const totalRes = await pool.query(totalQuery);
    const totalItens = parseInt(totalRes.rows[0].total_itens);
    const totalPaginas = Math.ceil(totalItens / limite);
    res.json({ 
        data: dadosRes.rows,
        meta: { paginaAtual: pagina, totalPaginas: totalPaginas, totalItens: totalItens }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/saidas', protegerRota, async (req, res) => {
  try {
    const pagina = parseInt(req.query.pagina || 1);
    const limite = 20;
    const offset = (pagina - 1) * limite;
    const dadosRes = await pool.query('SELECT * FROM saidas ORDER BY data DESC LIMIT $1 OFFSET $2', [limite, offset]);
    const totalRes = await pool.query('SELECT COUNT(*) AS total_itens FROM saidas');
    const totalItens = parseInt(totalRes.rows[0].total_itens);
    const totalPaginas = Math.ceil(totalItens / limite);
    res.json({ 
        data: dadosRes.rows,
        meta: { paginaAtual: pagina, totalPaginas: totalPaginas, totalItens: totalItens }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/estoque', protegerRota, async (req, res) => {
    const { produto, fornecedor_id, categoria_id, pacotes, unidadesAvulsas, custoPorPacote, estoqueMinimo, ultimaEntrada } = req.body;
    try {
        const catRes = await pool.query('SELECT tipo_unidade FROM categorias WHERE id = $1', [categoria_id]);
        if (catRes.rows.length === 0) return res.status(400).json({ error: 'Categoria não encontrada.' });
        const tipo = catRes.rows[0].tipo_unidade;
        
        const totalUnidadesAdicionadas = (tipo === 'rolo' || tipo === 'embalagem') ? pacotes : (pacotes * 5000) + unidadesAvulsas;
        
        const selectRes = await pool.query('SELECT * FROM estoque WHERE produto = $1 AND (fornecedor_id = $2 OR (fornecedor_id IS NULL AND $2 IS NULL))', [produto, fornecedor_id || null]);
        if (selectRes.rows.length > 0) {
            const item = selectRes.rows[0];
            const novoTotalUnidades = item.totalunidades + totalUnidadesAdicionadas;
            const novosPacotes = (tipo === 'rolo' || tipo === 'embalagem') ? novoTotalUnidades : Math.floor(novoTotalUnidades / 5000);
            const novasUnidadesAvulsas = (tipo === 'rolo' || tipo === 'embalagem') ? 0 : novoTotalUnidades % 5000;
            await pool.query(
                'UPDATE estoque SET pacotes = $1, unidadesavulsas = $2, totalunidades = $3, custoporpacote = $4, estoqueminimo = $5, ultimaentrada = $6, categoria_id = $7 WHERE id = $8',
                [novosPacotes, novasUnidadesAvulsas, novoTotalUnidades, custoPorPacote, estoqueMinimo, ultimaEntrada, categoria_id, item.id]
            );
        } else {
            const novosPacotes = (tipo === 'rolo' || tipo === 'embalagem') ? totalUnidadesAdicionadas : pacotes;
            const novasUnidadesAvulsas = (tipo === 'rolo' || tipo === 'embalagem') ? 0 : unidadesAvulsas;
            await pool.query(
                'INSERT INTO estoque (produto, fornecedor_id, categoria_id, pacotes, unidadesavulsas, totalunidades, custoporpacote, estoqueminimo, ultimaentrada) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
                [produto, fornecedor_id || null, categoria_id, novosPacotes, novasUnidadesAvulsas, totalUnidadesAdicionadas, custoPorPacote, estoqueMinimo, ultimaEntrada]
            );
        }
        res.status(201).json({ message: 'Estoque atualizado!' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.put('/api/estoque/:id', protegerRota, async (req, res) => {
  try {
    const { id } = req.params;
    const { fornecedor_id, categoria_id, pacotes, unidadesavulsas, custoporpacote, estoqueminimo } = req.body;
    const catRes = await pool.query('SELECT tipo_unidade FROM categorias WHERE id = $1', [categoria_id]);
    if (catRes.rows.length === 0) return res.status(400).json({ error: 'Categoria não encontrada.' });
    const tipo = catRes.rows[0].tipo_unidade;
    
    const totalunidades = (tipo === 'rolo' || tipo === 'embalagem') ? pacotes : (pacotes * 5000) + unidadesavulsas;
    const pacotesCorrigido = (tipo === 'rolo' || tipo === 'embalagem') ? totalunidades : pacotes;
    const unidadesCorrigido = (tipo === 'rolo' || tipo === 'embalagem') ? 0 : unidadesavulsas;
    
    const updateQuery = `UPDATE estoque SET fornecedor_id = $1, pacotes = $2, unidadesavulsas = $3, totalunidades = $4, custoporpacote = $5, estoqueminimo = $6, categoria_id = $7 WHERE id = $8`;
    const result = await pool.query(updateQuery, [fornecedor_id, pacotesCorrigido, unidadesCorrigido, totalunidades, custoporpacote, estoqueminimo, categoria_id, id]);
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
    
    const estoqueRes = await client.query('SELECT e.*, c.tipo_unidade FROM estoque e LEFT JOIN categorias c ON e.categoria_id = c.id WHERE e.id = $1 FOR UPDATE OF e', [produtoId]);
    
    if (estoqueRes.rows.length === 0) { throw new Error('Produto não encontrado no estoque.'); }
    const item = estoqueRes.rows[0];
    if (item.totalunidades < totalUnidades) { throw new Error('Estoque insuficiente para esta saída.'); }
    
    const tipo = item.tipo_unidade;
    const novoTotalUnidades = item.totalunidades - totalUnidades;
    
    const novosPacotes = (tipo === 'rolo' || tipo === 'embalagem') ? novoTotalUnidades : Math.floor(novoTotalUnidades / 5000);
    const novasUnidadesAvulsas = (tipo === 'rolo' || tipo === 'embalagem') ? 0 : novoTotalUnidades % 5000;
    const custoDaSaida = (tipo === 'rolo' || tipo === 'embalagem') ? totalUnidades * item.custoporpacote : (totalUnidades / 5000) * item.custoporpacote;
    
    await client.query('UPDATE estoque SET totalunidades = $1, pacotes = $2, unidadesavulsas = $3 WHERE id = $4', [novoTotalUnidades, novosPacotes, novasUnidadesAvulsas, produtoId]);
    await client.query('INSERT INTO saidas (data, produtoid, produtonome, totalunidades, custototal, destino) VALUES ($1, $2, $3, $4, $5, $6)', [data, produtoId, item.produto, totalUnidades, custoDaSaida, destino]);
    
    await client.query('COMMIT');
    res.status(201).json({ message: 'Saída registrada com sucesso!' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error("Erro ao registrar saída:", err);
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.get('/api/fornecedores', protegerRota, async (req, res) => {
  try {
    const pagina = parseInt(req.query.pagina || 1);
    const limite = 20;
    const offset = (pagina - 1) * limite;
    const dadosRes = await pool.query('SELECT * FROM fornecedores ORDER BY nome LIMIT $1 OFFSET $2', [limite, offset]);
    const totalRes = await pool.query('SELECT COUNT(*) AS total_itens FROM fornecedores');
    const totalItens = parseInt(totalRes.rows[0].total_itens);
    const totalPaginas = Math.ceil(totalItens / limite);
    res.json({ 
        data: dadosRes.rows,
        meta: { paginaAtual: pagina, totalPaginas: totalPaginas, totalItens: totalItens }
    });
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
app.put('/api/fornecedores/:id', protegerRota, async (req, res) => {
    try {
        const { id } = req.params;
        const { nome } = req.body;
        if (!nome) { return res.status(400).json({ error: 'O nome é obrigatório.' }); }
        const result = await pool.query('UPDATE fornecedores SET nome = $1 WHERE id = $2 RETURNING *', [nome, id]);
        if (result.rowCount === 0) { return res.status(404).json({ error: 'Fornecedor não encontrado.' }); }
        res.status(200).json({ message: 'Fornecedor atualizado com sucesso!', data: result.rows[0] });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/categorias', protegerRota, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM categorias ORDER BY nome');
        res.json({ data: result.rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/categorias', protegerRota, async (req, res) => {
    try {
        const { nome, tipo_unidade } = req.body;
        if (!nome || !tipo_unidade) { return res.status(400).json({ error: 'Nome e Tipo de Unidade são obrigatórios.' }); }
        const result = await pool.query('INSERT INTO categorias (nome, tipo_unidade) VALUES ($1, $2) RETURNING *', [nome, tipo_unidade]);
        res.status(201).json({ data: result.rows[0] });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.put('/api/categorias/:id', protegerRota, async (req, res) => {
    try {
        const { id } = req.params;
        const { nome, tipo_unidade } = req.body;
        if (!nome || !tipo_unidade) { return res.status(400).json({ error: 'Nome e Tipo de Unidade são obrigatórios.' }); }
        const result = await pool.query('UPDATE categorias SET nome = $1, tipo_unidade = $2 WHERE id = $3 RETURNING *', [nome, tipo_unidade, id]);
        if (result.rowCount === 0) { return res.status(404).json({ error: 'Categoria não encontrada.' }); }
        res.status(200).json({ message: 'Categoria atualizada com sucesso!', data: result.rows[0] });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.delete('/api/categorias/:id', protegerRota, async (req, res) => {
    try {
        const { id } = req.params;
        const uso = await pool.query('SELECT 1 FROM estoque WHERE categoria_id = $1 LIMIT 1', [id]);
        if (uso.rows.length > 0) {
            return res.status(400).json({ error: 'Não é possível excluir: Categoria está em uso por um item de estoque.' });
        }
        await pool.query('DELETE FROM categorias WHERE id = $1', [id]);
        res.status(200).json({ message: 'Categoria deletada com sucesso!' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/relatorios/valor-por-produto', protegerRota, async (req, res) => {
  try {
    const query = `
      SELECT e.produto, e.totalunidades, c.tipo_unidade, e.custoporpacote,
        CASE
          WHEN c.tipo_unidade = 'rolo' OR c.tipo_unidade = 'embalagem' THEN e.totalunidades * e.custoporpacote
          ELSE (e.totalunidades / 5000.0) * e.custoporpacote
        END AS valor_total
      FROM estoque e
      LEFT JOIN categorias c ON e.categoria_id = c.id
      WHERE e.totalunidades > 0 ORDER BY e.produto;
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
            LEFT JOIN estoque e ON up.estoque_id = e.id
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
        const estoqueRes = await client.query('SELECT e.*, c.tipo_unidade FROM estoque e LEFT JOIN categorias c ON e.categoria_id = c.id WHERE e.id = $1 FOR UPDATE OF e', [estoque_id]);
        if (estoqueRes.rows.length === 0) throw new Error('Produto não encontrado no estoque.');
        const item = estoqueRes.rows[0];
        if (item.totalunidades < 1) throw new Error('Estoque insuficiente para iniciar o uso.');
        const novoTotalUnidades = item.totalunidades - 1;
        
        const novosPacotes = (item.tipo_unidade === 'rolo' || item.tipo_unidade === 'embalagem') ? novoTotalUnidades : Math.floor(novoTotalUnidades / 5000);
        
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
        const query = `SELECT up.id, up.data_inicio, e.produto AS produto_nome FROM uso_producao up LEFT JOIN estoque e ON up.estoque_id = e.id WHERE up.status = 'Em Uso' ORDER BY up.data_inicio ASC`;
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

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  createTables();
});