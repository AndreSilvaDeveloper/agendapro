// middleware/clientAuthMiddleware.js

function clientAuthMiddleware(req, res, next) {
  // 1. Verifica se a sessão do CLIENTE existe e tem os dados essenciais
  if (
    req.session &&
    req.session.clientLoggedIn &&
    req.session.clientId &&
    req.session.clientOrgId // Essencial para saber de qual salão ele é
  ) {
    // 2. O cliente está autenticado e a sessão é válida. Pode prosseguir.
    return next();
  }

  // 3. A sessão é inválida ou expirou.
  // Tentamos pegar o orgId da sessão (se ele existir) para
  // redirecionar o cliente para a página de login correta do salão.
  const orgId = req.session ? req.session.clientOrgId : null;

  // 4. Destrói a sessão inválida
  req.session.destroy((err) => {
    if (err) {
      console.error("Erro ao destruir sessão inválida do cliente:", err);
    }
    
    res.clearCookie('connect.sid');

    // 5. Redireciona para a página de login
    if (orgId) {
      // Se sabemos qual era o salão, mandamos para o login daquele salão
      res.redirect(`/portal/${orgId}/login?error=Sua sessão expirou. Faça login novamente.`);
    } else {
      // Se não temos ideia, mandamos para a página de login principal (do admin)
      res.redirect('/login?error=Sessão inválida.');
    }
  });
}

module.exports = clientAuthMiddleware;