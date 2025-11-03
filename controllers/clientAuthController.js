// controllers/clientAuthController.js

// --- REMOVIDO ---
// const Client = require('../models/Client');
// const Organization = require('../models/Organization');

// --- ADICIONADO ---
const db = require('../models');

/**
 * GET /portal/:orgId/registro
 * Mostra a página de registro para um cliente.
 */
exports.getRegister = async (req, res) => {
  try {
    const { orgId } = req.params;
    // ATUALIZADO: findById -> findByPk
    const organization = await db.Organization.findByPk(orgId);

    if (!organization) {
      return res.status(404).send('Salão não encontrado.');
    }

    res.render('client/register', {
      error: null,
      success: null,
      orgName: organization.name,
      orgId: organization.id // ATUALIZADO: _id -> id
    });
  } catch (err) {
    console.error('Erro ao carregar página de registro do cliente:', err);
    res.status(500).send('Erro interno do servidor.');
  }
};

/**
 * POST /portal/:orgId/registro
 * Processa o novo registro do cliente.
 */
exports.postRegister = async (req, res) => {
  const { orgId } = req.params;
  const { name, email, phone, password, passwordConfirm } = req.body;

  try {
    // ATUALIZADO: findById -> findByPk
    const organization = await db.Organization.findByPk(orgId);
    if (!organization) {
      return res.status(404).send('Salão não encontrado.');
    }
    
    // --- Validações (sem alteração) ---
    if (!name || !email || !password || !passwordConfirm) {
      return res.render('client/register', {
        error: 'Todos os campos são obrigatórios.',
        success: null,
        orgName: organization.name,
        orgId: orgId
      });
    }
    if (password !== passwordConfirm) {
      return res.render('client/register', {
        error: 'As senhas não coincidem.',
        success: null,
        orgName: organization.name,
        orgId: orgId
      });
    }
    if (password.length < 6) {
      return res.render('client/register', {
        error: 'A senha deve ter pelo menos 6 caracteres.',
        success: null,
        orgName: organization.name,
        orgId: orgId
      });
    }

    // ATUALIZADO: Client.findOne -> db.Client.findOne
    const existingClient = await db.Client.findOne({
      where: { // ATUALIZADO: Adiciona 'where'
        organizationId: orgId,
        email: email.toLowerCase()
      }
    });

    if (existingClient) {
      return res.render('client/register', {
        error: 'Este e-mail já está cadastrado neste salão.',
        success: null,
        orgName: organization.name,
        orgId: orgId
      });
    }

    // ATUALIZADO: new Client().save() -> db.Client.create()
    // O hook 'beforeCreate' no modelo vai criptografar a senha
    const newClient = await db.Client.create({
      organizationId: orgId,
      name: name,
      email: email.toLowerCase(),
      phone: phone || '',
      password: password
    });

    // --- Inicia a Sessão do Cliente ---
    req.session.clientLoggedIn = true;
    req.session.clientId = newClient.id; // ATUALIZADO: _id -> id
    req.session.clientOrgId = newClient.organizationId;
    req.session.clientName = newClient.name;

    res.redirect('/portal/minha-area'); 

  } catch (err) {
    console.error('Erro ao registrar cliente:', err);
    let errorMsg = 'Erro ao criar sua conta. Tente novamente.';
    
    // ATUALIZADO: err.code === 11000 -> err.name
    if (err.name === 'SequelizeUniqueConstraintError') {
      errorMsg = 'Este e-mail já está em uso.';
    }
    
    // ATUALIZADO: findById -> findByPk
    const org = await db.Organization.findByPk(orgId);
    res.render('client/register', {
      error: errorMsg,
      success: null,
      orgName: org ? org.name : 'Erro',
      orgId: orgId
    });
  }
};

/**
 * GET /portal/:orgId/login
 * Mostra a página de login do cliente.
 */
exports.getLogin = async (req, res) => {
  try {
    const { orgId } = req.params;
    // ATUALIZADO: findById -> findByPk
    const organization = await db.Organization.findByPk(orgId);

    if (!organization) {
      return res.status(404).send('Salão não encontrado.');
    }

    res.render('client/login', {
      error: req.query.error || null,
      success: req.query.success || null,
      orgName: organization.name,
      orgId: organization.id // ATUALIZADO: _id -> id
    });
  } catch (err) {
    console.error('Erro ao carregar página de login do cliente:', err);
    res.status(500).send('Erro interno do servidor.');
  }
};

/**
 * POST /portal/:orgId/login
 * Processa o login do cliente.
 */
exports.postLogin = async (req, res) => {
  const { orgId } = req.params;
  const { email, password } = req.body;
  let orgName = 'Erro';

  try {
    // ATUALIZADO: findById -> findByPk
    const organization = await db.Organization.findByPk(orgId);
    if (organization) {
      orgName = organization.name;
    }

    if (!email || !password) {
      return res.render('client/login', {
        error: 'E-mail e senha são obrigatórios.',
        success: null,
        orgName: orgName,
        orgId: orgId
      });
    }
    
    // ATUALIZADO: Client.findOne -> db.Client.findOne
    const client = await db.Client.findOne({
      where: { // ATUALIZADO: Adiciona 'where'
        organizationId: orgId,
        email: email.toLowerCase()
      }
    });

    if (!client) {
      return res.render('client/login', {
        error: 'E-mail ou senha inválidos.',
        success: null,
        orgName: orgName,
        orgId: orgId
      });
    }

    // ATUALIZADO: Nenhuma mudança. O método comparePassword funciona.
    const isMatch = await client.comparePassword(password);

    if (!isMatch) {
      return res.render('client/login', {
        error: 'E-mail ou senha inválidos.',
        success: null,
        orgName: orgName,
        orgId: orgId
      });
    }

    // --- Inicia a Sessão do Cliente ---
    req.session.clientLoggedIn = true;
    req.session.clientId = client.id; // ATUALIZADO: _id -> id
    req.session.clientOrgId = client.organizationId;
    req.session.clientName = client.name;

    res.redirect('/portal/minha-area');

  } catch (err) {
    console.error('Erro no login do cliente:', err);
    res.render('client/login', {
      error: 'Erro interno. Tente novamente.',
      success: null,
      orgName: orgName,
      orgId: orgId
    });
  }
};

/**
 * GET /portal/logout
 * Processa o logout do cliente.
 * (Sem alterações, não acessa o banco de dados)
 */
exports.getLogout = async (req, res) => {
  try {
    const orgId = req.session.clientOrgId;
    let redirectUrl = '/'; // URL de fallback padrão

    if (orgId) {
      // 1. Buscar a organização no banco ANTES de destruir a sessão
      const organization = await db.Organization.findByPk(orgId, {
        attributes: ['slug'] // Só precisamos da coluna 'slug'
      });

      if (organization && organization.slug) {
        // 2. Montar a URL de redirecionamento correta
        redirectUrl = `/salao/${organization.slug}`;
      } else {
        // 3. Se não achar o slug, mantém o comportamento antigo
        redirectUrl = `/portal/${orgId}/login`;
      }
    }

    // 4. Agora, destruir a sessão e redirecionar para a URL que definimos
    req.session.destroy((err) => {
      if (err) {
        console.error('Erro ao fazer logout do cliente:', err);
        // Mesmo com erro, tenta redirecionar
        return res.redirect(redirectUrl);
      }
      
      res.clearCookie('connect.sid');
      res.redirect(redirectUrl);
    });

  } catch (error) {
    console.error('Erro grave no logout do cliente:', error);
    res.redirect('/'); // Redireciona para a home em caso de erro na busca do BD
  }
};