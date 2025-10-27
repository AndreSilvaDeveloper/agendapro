// controllers/authController.js

const mongoose = require('mongoose');
const User = require('../models/User');
const Organization = require('../models/Organization');
const crypto = require('crypto');
const mailer = require('../utils/mailer');
const slugify = require('slugify'); 

// --- Página de Login (GET) ---
exports.getLogin = (req, res) => {
  res.render('login', { 
    error: req.query.error || null,
    success: req.query.success || null 
  });
};

// --- Processar o Login (POST) ---
// (MODIFICADO para prevenir "race condition")
exports.postLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.render('login', { error: 'E-mail e senha são obrigatórios.', success: null });
    }
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.render('login', { error: 'E-mail ou senha inválidos.', success: null });
    }
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.render('login', { error: 'E-mail ou senha inválidos.', success: null });
    }
    
    // Define os dados da sessão
    req.session.loggedIn = true;
    req.session.userId = user._id;
    req.session.username = user.username;
    req.session.role = user.role;
    req.session.organizationId = user.organizationId;
    
    // --- CORREÇÃO AQUI ---
    // Força a sessão a salvar no banco ANTES de redirecionar.
    // Isso previne a "condição de corrida" (race condition).
    req.session.save((err) => {
      if (err) {
        // Se houver um erro ao salvar a sessão, lide com ele
        console.error('Erro ao salvar a sessão:', err);
        return res.render('login', { error: 'Erro interno ao salvar sua sessão.', success: null });
      }
      // Agora que a sessão está salva, podemos redirecionar com segurança.
      return res.redirect('/dashboard');
    });
    // --- FIM DA CORREÇÃO ---

  } catch (err) {
    console.error('Erro no login:', err);
    res.render('login', { error: 'Erro interno. Tente novamente.', success: null });
  }
};

// --- Página de Registro (GET) ---
exports.getRegister = (req, res) => {
  res.render('register', { error: null });
};

// --- Processar o Registro (POST) ---
// (MODIFICADO para prevenir "race condition")
exports.postRegister = async (req, res) => {

  const { salonName, username, email, password, passwordConfirm } = req.body;

  // --- Validações ---
  if (!salonName || !username || !email || !password || !passwordConfirm) {
    return res.render('register', { error: 'Todos os campos são obrigatórios.' });
  }
  if (password !== passwordConfirm) {
    return res.render('register', { error: 'As senhas não coincidem.' });
  }
  if (password.length < 6) {
     return res.render('register', { error: 'A senha deve ter pelo menos 6 caracteres.' });
  }

  // --- Pré-verificações ---
  try {
    const existingEmail = await User.findOne({ email: email.toLowerCase() });
    if (existingEmail) {
        return res.render('register', { error: 'Este e-mail já está em uso.' });
    }
    const testSlug = slugify(salonName, {
      lower: true, strict: true, remove: /[*+~.()'"!:@]/g
    });
    const existingSlug = await Organization.findOne({ slug: testSlug });
    if (existingSlug) {
      return res.render('register', { error: 'Este nome de salão já está em uso. Por favor, escolha outro.' });
    }
  } catch (err) {
    console.error('Erro na pré-verificação do registro:', err);
    return res.render('register', { error: 'Erro ao verificar dados. Tente novamente.' });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const generatedSlug = slugify(salonName, {
        lower: true, strict: true, remove: /[*+~.()'"!:@]/g
    });
    const org = new Organization({
      name: salonName,
      slug: generatedSlug
    });
    const newOrg = await org.save({ session });

    const user = new User({
      organizationId: newOrg._id,
      username: username,
      email: email,
      password: password,
      role: 'owner'
    });
    const newUser = await user.save({ session });

    await session.commitTransaction();

    // 8. Loga o novo usuário
    req.session.loggedIn = true;
    req.session.userId = newUser._id;
    req.session.username = newUser.username;
    req.session.role = newUser.role;
    req.session.organizationId = newUser.organizationId;
    
    // --- CORREÇÃO AQUI (mesmo problema do login) ---
    // Força a sessão a salvar antes de redirecionar.
    req.session.save((err) => {
        if (err) {
            console.error('Erro ao salvar a sessão após o registro:', err);
            // Mesmo que o registro tenha funcionado, o login automático falhou.
            // Melhor enviá-lo para a página de login para tentar logar manualmente.
            return res.redirect('/login?success=Conta criada com sucesso! Faça o login.');
        }
        // Sessão salva, redireciona para o dashboard
        res.redirect('/dashboard');
    });
    // --- FIM DA CORREÇÃO ---

  } catch (err) {
    await session.abortTransaction();
    console.error('Erro no registro (transação):', err);
    let errorMsg = 'Erro ao criar conta. Tente novamente.';
    if (err.code === 11000 && err.keyPattern) {
      if (err.keyPattern.slug) {
        errorMsg = 'Este nome de salão já está em uso. Tente outro.';
      } else if (err.keyPattern.email) {
        errorMsg = 'Este e-mail já está em uso.';
      } else if (err.keyPattern['organizationId'] && err.keyPattern['username']) {
        errorMsg = 'Este nome de usuário já está em uso para este salão.';
      } else {
        errorMsg = 'Ocorreu um erro de duplicidade. Verifique os campos.';
      }
    }
    res.render('register', { error: errorMsg });
  } finally {
    session.endSession();
  }
};

// --- Logout ---
exports.getLogout = (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Erro ao fazer logout:', err);
      return res.redirect('/login');
    }
    res.clearCookie('connect.sid');
    res.redirect('/login');
  });
};

// --- Rota Raiz ---
exports.getRoot = (req, res) => {
  res.redirect('/dashboard');
};

// --- FUNÇÕES DE REDEFINIÇÃO DE SENHA ---
// (Sem alterações)
exports.getForgotPassword = (req, res) => {
  res.render('forgot-password', { error: null, success: null });
};

exports.postForgotPassword = async (req, res) => {
  try {
    const token = crypto.randomBytes(20).toString('hex');
    const user = await User.findOne({ email: req.body.email.toLowerCase() });
    if (!user) {
      return res.render('forgot-password', { 
        error: null, 
        success: 'Se um e-mail válido foi fornecido, um link de redefinição foi enviado.' 
      });
    }
    user.resetToken = token;
    user.resetTokenExpires = Date.now() + 3600000;
    await user.save();
    await mailer.sendPasswordResetEmail(user.email, token, req.headers.host);
    return res.render('forgot-password', { 
      error: null, 
      success: 'Se um e-mail válido foi fornecido, um link de redefinição foi enviado.' 
    });
  } catch (err) {
    console.error('Erro em postForgotPassword:', err);
    res.render('forgot-password', { 
      error: 'Erro ao processar sua solicitação. Tente novamente.', 
      success: null 
    });
  }
};

exports.getReset = async (req, res) => {
  try {
    const { token } = req.params;
    const user = await User.findOne({
      resetToken: token,
      resetTokenExpires: { $gt: Date.now() }
    });
    if (!user) {
      return res.redirect('/login?error=Token de redefinição inválido ou expirado.');
    }
    res.render('reset-password', { error: null, token: token });
  } catch (err) {
    console.error('Erro em getReset:', err);
    res.redirect('/login?error=Erro ao processar o token.');
  }
};

exports.postReset = async (req, res) => {
  try {
    const { token } = req.params;
    const { password, passwordConfirm } = req.body;
    if (password !== passwordConfirm) {
      return res.render('reset-password', { error: 'As senhas não coincidem.', token: token });
    }
    if (password.length < 6) {
       return res.render('reset-password', { error: 'A senha deve ter pelo menos 6 caracteres.', token: token });
    }
    const user = await User.findOne({
      resetToken: token,
      resetTokenExpires: { $gt: Date.now() }
    });
    if (!user) {
      return res.redirect('/login?error=Token de redefinição inválido ou expirado.');
    }
    user.password = password;
    user.resetToken = undefined;
    user.resetTokenExpires = undefined;
    await user.save();
    req.session.destroy(() => {
        res.redirect('/login?success=Senha redefinida com sucesso! Você já pode entrar.');
    });
  } catch (err) {
    console.error('Erro em postReset:', err);
    res.render('reset-password', { error: 'Erro ao salvar sua nova senha.', token: token });
  }
};