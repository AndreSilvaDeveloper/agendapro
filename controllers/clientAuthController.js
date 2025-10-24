// controllers/clientAuthController.js

const Client = require('../models/Client');
const Organization = require('../models/Organization');

/**
 * GET /portal/:orgId/registro
 * Mostra a página de registro para um cliente de um salão específico.
 */
exports.getRegister = async (req, res) => {
  try {
    const { orgId } = req.params;
    const organization = await Organization.findById(orgId);

    if (!organization) {
      return res.status(404).send('Salão não encontrado.');
    }

    // Renderiza uma nova view (que criaremos depois)
    res.render('client/register', {
      error: null,
      orgName: organization.name,
      orgId: organization._id
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
    const organization = await Organization.findById(orgId);
    if (!organization) {
      return res.status(404).send('Salão não encontrado.');
    }
    
    // --- Validações ---
    if (!name || !email || !password || !passwordConfirm) {
      return res.render('client/register', {
        error: 'Todos os campos são obrigatórios.',
        orgName: organization.name,
        orgId: orgId
      });
    }
    if (password !== passwordConfirm) {
      return res.render('client/register', {
        error: 'As senhas não coincidem.',
        orgName: organization.name,
        orgId: orgId
      });
    }
    if (password.length < 6) {
      return res.render('client/register', {
        error: 'A senha deve ter pelo menos 6 caracteres.',
        orgName: organization.name,
        orgId: orgId
      });
    }

    // Verifica se o e-mail já está em uso NESTE salão
    const existingClient = await Client.findOne({
      organizationId: orgId,
      email: email.toLowerCase()
    });

    if (existingClient) {
      return res.render('client/register', {
        error: 'Este e-mail já está cadastrado neste salão.',
        orgName: organization.name,
        orgId: orgId
      });
    }

    // Cria o novo cliente
    // O hook 'pre-save' no models/Client.js vai criptografar a senha
    const newClient = new Client({
      organizationId: orgId,
      name: name,
      email: email.toLowerCase(),
      phone: phone || '',
      password: password
    });

    await newClient.save();

    // --- Inicia a Sessão do Cliente ---
    // Note que a sessão do cliente é separada da sessão do admin
    req.session.clientLoggedIn = true;
    req.session.clientId = newClient._id;
    req.session.clientOrgId = newClient.organizationId;
    req.session.clientName = newClient.name;

    // Redireciona para a área logada do cliente (que criaremos)
    res.redirect('/portal/minha-area'); 

  } catch (err) {
    console.error('Erro ao registrar cliente:', err);
    let errorMsg = 'Erro ao criar sua conta. Tente novamente.';
    if (err.code === 11000) {
      errorMsg = 'Este e-mail já está em uso.';
    }
    
    // Tenta recarregar a página com o erro
    const org = await Organization.findById(orgId);
    res.render('client/register', {
      error: errorMsg,
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
    const organization = await Organization.findById(orgId);

    if (!organization) {
      return res.status(404).send('Salão não encontrado.');
    }

    // Renderiza uma nova view (que criaremos depois)
    res.render('client/login', {
      error: req.query.error || null,
      success: req.query.success || null,
      orgName: organization.name,
      orgId: organization._id
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
  let orgName = 'Erro'; // Fallback

  try {
    const organization = await Organization.findById(orgId);
    if (organization) {
      orgName = organization.name;
    }

    if (!email || !password) {
      return res.render('client/login', {
        error: 'E-mail e senha são obrigatórios.',
        orgName: orgName,
        orgId: orgId
      });
    }
    
    // Procura o cliente pelo e-mail DENTRO do salão específico
    const client = await Client.findOne({
      organizationId: orgId,
      email: email.toLowerCase()
    });

    if (!client) {
      return res.render('client/login', {
        error: 'E-mail ou senha inválidos.',
        orgName: orgName,
        orgId: orgId
      });
    }

    // Usa o método 'comparePassword' que adicionamos ao modelo
    const isMatch = await client.comparePassword(password);

    if (!isMatch) {
      return res.render('client/login', {
        error: 'E-mail ou senha inválidos.',
        orgName: orgName,
        orgId: orgId
      });
    }

    // --- Inicia a Sessão do Cliente ---
    req.session.clientLoggedIn = true;
    req.session.clientId = client._id;
    req.session.clientOrgId = client.organizationId;
    req.session.clientName = client.name;

    // Redireciona para a área logada do cliente
    res.redirect('/portal/minha-area');

  } catch (err) {
    console.error('Erro no login do cliente:', err);
    res.render('client/login', {
      error: 'Erro interno. Tente novamente.',
      orgName: orgName,
      orgId: orgId
    });
  }
};

/**
 * GET /portal/logout
 * Processa o logout do cliente.
 */
exports.getLogout = (req, res) => {
  const orgId = req.session.clientOrgId; // Pega o orgId antes de destruir a sessão
  
  req.session.destroy((err) => {
    if (err) {
      console.error('Erro ao fazer logout do cliente:', err);
      return res.redirect('/'); // Redireciona para a home em caso de erro
    }
    
    // Limpa o cookie e redireciona para a página de login daquele salão
    res.clearCookie('connect.sid');
    if (orgId) {
      res.redirect(`/portal/${orgId}/login`);
    } else {
      res.redirect('/'); // Fallback
    }
  });
};