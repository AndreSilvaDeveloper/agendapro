// middleware/authMiddleware.js

/**
 * Middleware principal de autenticação.
 * Garante que um usuário esteja logado.
 * * - Para usuários normais (owner, staff), exige organizationId.
 * - Para 'superadmin', NÃO exige organizationId.
 */
function isAuthenticated(req, res, next) {
  // Verifica se a sessão existe e se o usuário está logado
  if (!req.session || !req.session.loggedIn || !req.session.userId) {
    return failAuth(req, res, 'Sua sessão expirou. Por favor, entre novamente.');
  }

  // --- MUDANÇA ESSENCIAL AQUI ---
  // Se for superadmin, ele está autenticado e pode prosseguir
  // IMEDIATAMENTE, sem verificar organizationId.
  if (req.session.role === 'superadmin') {
    res.locals.isSuperAdmin = true; // Disponibiliza para as views
    // Passa a sessão original do superadmin, se ela existir
    res.locals.originalAdminSession = req.session.originalAdminSession || null;
    return next();
  }
  // --- FIM DA MUDANÇA ---

  // Se for um usuário normal (owner/staff), DEVE ter um organizationId
  if (!req.session.organizationId) {
    return failAuth(req, res, 'Sua conta não está vinculada a uma organização.');
  }

  // Se chegou até aqui, é um usuário normal (owner/staff)
  // com uma sessão válida.
  res.locals.isSuperAdmin = false;
  return next();
}

/**
 * Middleware de autorização: Apenas Superadmin.
 * * Uso: Para rotas do painel "Master" que gerenciam TODAS as organizações.
 */
function isSuperAdmin(req, res, next) {
  // `isAuthenticated` já deve ter rodado antes, 
  // mas fazemos uma verificação completa por segurança.
  if (req.session && req.session.loggedIn && req.session.role === 'superadmin') {
    res.locals.isSuperAdmin = true; // Disponibiliza para as views
    return next();
  }

  // Se não for superadmin, mesmo que esteja logado, ele não tem permissão.
  // req.flash('error', 'Acesso não autorizado.'); // Descomente se usar connect-flash
  return res.redirect('/dashboard'); // Redireciona para o dashboard normal dele
}

/**
 * Middleware de autorização: Owner OU Superadmin.
 * * Uso: Para rotas "sensíveis" da organização (ex: configurações, exclusão),
 * que tanto o Dono quanto o Superadmin (personificado) podem acessar.
 */
function isOwnerOrSuperAdmin(req, res, next) {
  // `isAuthenticated` já deve ter rodado.
  if (req.session && req.session.loggedIn) {
    const role = req.session.role;
    
    if (role === 'owner' || role === 'superadmin') {
      return next();
    }
  }

  // Se for 'staff' ou qualquer outro, não tem permissão.
  // req.flash('error', 'Você não tem permissão para acessar esta página.');
  return res.redirect('/dashboard');
}

/**
 * Middleware de autorização: Apenas Owner.
 * * Uso: Para rotas que SÓ o dono da organização pode ver,
 * e nem mesmo o superadmin deve acessar (ex: dados de faturamento).
 */
function isOwner(req, res, next) {
  if (req.session && req.session.loggedIn && req.session.role === 'owner') {
    return next();
  }

  // req.flash('error', 'Acesso restrito aos proprietários da organização.');
  return res.redirect('/dashboard');
}


// --- Função Auxiliar ---

/**
 * Destrói uma sessão inválida e redireciona para o login com uma mensagem de erro.
 */
function failAuth(req, res, errorMessage) {
  req.session.destroy((err) => {
    if (err) {
      console.error("Erro ao destruir sessão inválida:", err);
    }
    // Usa flash messages se você tiver o connect-flash
    // req.flash('error', errorMessage);
    
    // Ou envia pela URL como você estava fazendo
    const errorQuery = encodeURIComponent(errorMessage);
    res.redirect(`/login?error=${errorQuery}`);
  });
}

// Exporta todos os middlewares
module.exports = {
  isAuthenticated,
  isSuperAdmin,
  isOwnerOrSuperAdmin,
  isOwner
};