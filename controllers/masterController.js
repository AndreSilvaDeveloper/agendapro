// controllers/masterController.js

const db = require('../models');

/**
 * GET /master
 * Mostra o dashboard principal do SuperAdmin com a lista de todas
 * as organizações.
 */
exports.getDashboard = async (req, res) => {
  try {
    // Busca todas as organizações no banco
    const organizations = await db.Organization.findAll({
      order: [['name', 'ASC']],
      // Opcional: incluir o usuário 'owner' de cada
      include: [{
        model: db.User,
        as: 'Users',
        where: { role: 'owner' },
        // --- MUDANÇA: Puxa o ID e o status de bloqueio para a view ---
        attributes: ['id', 'username', 'email', 'isBlocked'],
        required: false // Usa LEFT JOIN para não quebrar se uma org não tiver owner
      }]
    });

    res.render('master/dashboard', {
      organizations: organizations.map(org => org.toJSON()),
      // Passa a sessão original do superadmin, se ela existir
      originalAdminSession: req.session.originalAdminSession || null
    });
  } catch (err) {
    console.error('Erro ao buscar organizações:', err);
    // req.flash('error', 'Erro ao carregar o painel master.');
    res.redirect('/login');
  }
};

/**
 * GET /master/impersonate/:orgId
 * Permite ao SuperAdmin "personificar" (logar como)
 * o usuário 'owner' de uma organização específica.
 */
exports.impersonate = async (req, res) => {
  try {
    const { orgId } = req.params;

    // 1. Busca o usuário 'owner' da organização alvo
    const owner = await db.User.findOne({
      where: {
        organizationId: orgId,
        role: 'owner'
      }
    });

    if (!owner) {
      // req.flash('error', 'Organização não encontrada ou não possui um "owner".');
      return res.redirect('/master');
    }

    // --- MUDANÇA: Impede personificação de conta bloqueada ---
    if (owner.isBlocked) {
      // req.flash('error', 'Não é possível personificar um usuário bloqueado. Desbloqueie-o primeiro.');
      return res.redirect('/master');
    }
    // --- FIM DA MUDANÇA ---

    // 2. Salva a sessão ATUAL (superadmin) em um backup
    // Isso é o "pulo do gato" para poder voltar depois
    req.session.originalAdminSession = {
      userId: req.session.userId,
      username: req.session.username,
      role: req.session.role,
    };

    // 3. "Loga" como o usuário owner
    // Sobrescreve a sessão atual com os dados do 'owner'
    req.session.loggedIn = true;
    req.session.userId = owner.id;
    req.session.username = owner.username;
    req.session.role = owner.role;
    req.session.organizationId = owner.organizationId; // O ID da org que ele está personificando

    // 4. Salva a sessão e redireciona para o dashboard *normal*
    req.session.save((err) => {
      if (err) {
        console.error('Erro ao salvar sessão de personificação:', err);
        return res.redirect('/master');
      }
      // Agora você está logado como o 'owner' da Org ID X
      // e será enviado para o dashboard normal daquela org.
      res.redirect('/dashboard');
    });

  } catch (err) {
    console.error('Erro ao personificar organização:', err);
    // req.flash('error', 'Erro interno ao tentar personificar.');
    res.redirect('/master');
  }
};

/**
 * GET /master/stop-impersonation
 * Restaura a sessão original do SuperAdmin e "desloga"
 * da conta da organização.
 */
exports.stopImpersonation = (req, res) => {
  try {
    // 1. Verifica se existe uma sessão de backup
    if (!req.session.originalAdminSession) {
      // req.flash('error', 'Você não está personificando nenhuma conta.');
      return res.redirect('/dashboard'); // Vai para o dashboard normal
    }

    // 2. Pega os dados do admin de volta
    const adminSession = req.session.originalAdminSession;

    // 3. Restaura a sessão do superadmin
    req.session.loggedIn = true;
    req.session.userId = adminSession.userId;
    req.session.username = adminSession.username;
    req.session.role = adminSession.role;
    req.session.organizationId = null; // Superadmin não tem orgId

    // 4. Limpa o backup
    req.session.originalAdminSession = null;

    // 5. Salva a sessão e redireciona para o painel master
    req.session.save((err) => {
      if (err) {
        console.error('Erro ao parar personificação:', err);
        return res.redirect('/');
      }
      res.redirect('/master'); // De volta ao painel de controle master
    });

  } catch (err) {
    console.error('Erro ao parar personificação:', err);
    res.redirect('/login');
  }
};

// ===============================================
// === NOVAS FUNÇÕES DE BLOQUEIO / DESBLOQUEIO ===
// ===============================================

/**
 * POST /master/user/:userId/block
 * Bloqueia um usuário específico.
 * (Rota a ser criada em /routes/master.js)
 */
exports.blockUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await db.User.findByPk(userId);
    
    if (!user) {
      // req.flash('error', 'Usuário não encontrado.');
      return res.redirect('/master');
    }
    
    // Medida de segurança: Impede que o superadmin se bloqueie
    // ou que outros superadmins sejam bloqueados por esta rota.
    if (user.role === 'superadmin') {
      // req.flash('error', 'Super-administradores não podem ser bloqueados.');
      return res.redirect('/master');
    }

    user.isBlocked = true;
    await user.save();
    
    // req.flash('success', `Usuário ${user.username} bloqueado com sucesso.`);
    res.redirect('/master');

  } catch (err) {
    console.error('Erro ao bloquear usuário:', err);
    // req.flash('error', 'Erro interno ao tentar bloquear usuário.');
    res.redirect('/master');
  }
};

/**
 * POST /master/user/:userId/unblock
 * Desbloqueia um usuário específico.
 * (Rota a ser criada em /routes/master.js)
 */
exports.unblockUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await db.User.findByPk(userId);
    
    if (!user) {
      // req.flash('error', 'Usuário não encontrado.');
      return res.redirect('/master');
    }

    user.isBlocked = false;
    await user.save();
    
    // req.flash('success', `Usuário ${user.username} desbloqueado com sucesso.`);
    res.redirect('/master');

  } catch (err) {
    console.error('Erro ao desbloquear usuário:', err);
    // req.flash('error', 'Erro interno ao tentar desbloquear usuário.');
    res.redirect('/master');
  }
};