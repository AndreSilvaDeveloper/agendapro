// middleware/authMiddleware.js

function authMiddleware(req, res, next) {
  // Verifica não apenas se o usuário está logado,
  // mas se a sessão contém os dados essenciais para o aplicativo funcionar.
  if (
    req.session && 
    req.session.loggedIn && 
    req.session.userId && 
    req.session.organizationId 
  ) {
    // O usuário está autenticado e tem uma organização. Pode prosseguir.
    return next();
  }
  
  // Se qualquer uma das chaves estiver faltando, destrói a sessão inválida
  // e redireciona para o login.
  req.session.destroy((err) => {
    if (err) {
      console.error("Erro ao destruir sessão inválida:", err);
    }
    // Adiciona um erro na URL para que o usuário saiba por que foi deslogado
    res.redirect('/login?error=Sua sessão expirou. Por favor, entre novamente.');
  });
}

module.exports = authMiddleware;