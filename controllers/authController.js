// controllers/authController.js

// --- REMOVIDO ---
// const mongoose = require('mongoose');
// const User = require('../models/User');
// const Organization = require('../models/Organization');

// --- ADICIONADO ---
const db = require('../models'); // Importa o 'models/index.js'
const { Op } = require('sequelize'); // Importa o operador do Sequelize

const crypto = require('crypto');
const mailer = require('../utils/mailer');
const slugify = require('slugify'); // Mantido para a pré-verificação

// --- Página de Login (GET) ---
// (Sem alterações)
exports.getLogin = (req, res) => {
  res.render('login', { 
    error: req.query.error || null,
    success: req.query.success || null 
  });
};

// --- Processar o Login (POST) ---
// (Atualizado para Sequelize)
exports.postLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.render('login', { error: 'E-mail e senha são obrigatórios.', success: null });
    }
    
    // ATUALIZADO: User.findOne -> db.User.findOne({ where: ... })
    const user = await db.User.findOne({ where: { email: email.toLowerCase() } });
    
    if (!user) {
      return res.render('login', { error: 'E-mail ou senha inválidos.', success: null });
    }
    
    // O método comparePassword (User.prototype.comparePassword) funciona igual
    const isMatch = await user.comparePassword(password);
    
    if (!isMatch) {
      return res.render('login', { error: 'E-mail ou senha inválidos.', success: null });
    }
    
    // Define os dados da sessão
    req.session.loggedIn = true;
    req.session.userId = user.id; // ATUALIZADO: user._id -> user.id
    req.session.username = user.username;
    req.session.role = user.role;
    req.session.organizationId = user.organizationId;
    
    // Lógica de salvar sessão (mantida)
    req.session.save((err) => {
      if (err) {
        console.error('Erro ao salvar a sessão:', err);
        return res.render('login', { error: 'Erro interno ao salvar sua sessão.', success: null });
      }
      return res.redirect('/dashboard');
    });

  } catch (err) {
    console.error('Erro no login:', err);
    res.render('login', { error: 'Erro interno. Tente novamente.', success: null });
  }
};

// --- Página de Registro (GET) ---
// (Sem alterações)
exports.getRegister = (req, res) => {
  res.render('register', { error: null });
};

// --- Processar o Registro (POST) ---
// (Totalmente reescrito para Transações do Sequelize)
exports.postRegister = async (req, res) => {

  const { salonName, username, email, password, passwordConfirm } = req.body;

  // --- Validações (sem alterações) ---
  if (!salonName || !username || !email || !password || !passwordConfirm) {
    return res.render('register', { error: 'Todos os campos são obrigatórios.' });
  }
  if (password !== passwordConfirm) {
    return res.render('register', { error: 'As senhas não coincidem.' });
  }
  if (password.length < 6) {
     return res.render('register', { error: 'A senha deve ter pelo menos 6 caracteres.' });
  }

  // --- Pré-verificações (Atualizado) ---
  let testSlug;
  try {
    // ATUALIZADO: User.findOne -> db.User.findOne
    const existingEmail = await db.User.findOne({ where: { email: email.toLowerCase() } });
    if (existingEmail) {
        return res.render('register', { error: 'Este e-mail já está em uso.' });
    }
    
    testSlug = slugify(salonName, {
      lower: true, strict: true, remove: /[*+~.()'"!:@]/g
    });
    
    // ATUALIZADO: Organization.findOne -> db.Organization.findOne
    const existingSlug = await db.Organization.findOne({ where: { slug: testSlug } });
    if (existingSlug) {
      return res.render('register', { error: 'Este nome de salão já está em uso. Por favor, escolha outro.' });
    }
  } catch (err) {
    console.error('Erro na pré-verificação do registro:', err);
    return res.render('register', { error: 'Erro ao verificar dados. Tente novamente.' });
  }

  // --- ATUALIZADO: Transação do Sequelize ---
  // Substitui mongoose.startSession(), commitTransaction(), abortTransaction()
  try {
    // O Sequelize gerencia o 'BEGIN', 'COMMIT' e 'ROLLBACK' automaticamente
    const newUser = await db.sequelize.transaction(async (t) => {
      
      // 1. Criar a Organização
      // ATUALIZADO: new Organization().save() -> db.Organization.create()
      // Passamos o 'slug' que já verificamos. O hook do modelo não será executado
      // se o 'name' não for alterado, mas por segurança, passamos o slug verificado.
      const newOrg = await db.Organization.create({
        name: salonName,
        slug: testSlug
      }, { transaction: t }); // Passa a transação 't'

      // 2. Criar o Usuário 'owner'
      // ATUALIZADO: new User().save() -> db.User.create()
      const user = await db.User.create({
        organizationId: newOrg.id, // ATUALIZADO: newOrg._id -> newOrg.id
        username: username,
        email: email,
        password: password,
        role: 'owner'
      }, { transaction: t }); // Passa a transação 't'
      
      return user; // Retorna o usuário criado da transação
    });

    // Se a transação foi bem-sucedida:
    // 3. Loga o novo usuário
    req.session.loggedIn = true;
    req.session.userId = newUser.id; // ATUALIZADO: newUser._id -> newUser.id
    req.session.username = newUser.username;
    req.session.role = newUser.role;
    req.session.organizationId = newUser.organizationId;
    
    // Lógica de salvar sessão (mantida)
    req.session.save((err) => {
        if (err) {
            console.error('Erro ao salvar a sessão após o registro:', err);
            return res.redirect('/login?success=Conta criada com sucesso! Faça o login.');
        }
        res.redirect('/dashboard');
    });

  } catch (err) {
    // Se a transação falhou, o Sequelize já fez o ROLLBACK
    console.error('Erro no registro (transação):', err);
    
    // ATUALIZADO: Tratamento de erro do Sequelize (err.code === 11000)
    let errorMsg = 'Erro ao criar conta. Tente novamente.';
    if (err.name === 'SequelizeUniqueConstraintError') {
      const errorPath = err.errors[0].path;
      if (errorPath.includes('slug')) {
        errorMsg = 'Este nome de salão já está em uso. Tente outro.';
      } else if (errorPath.includes('email')) {
        errorMsg = 'Este e-mail já está em uso.';
      } else if (errorPath.includes('username')) {
        errorMsg = 'Este nome de usuário já está em uso para este salão.';
      }
    }
    res.render('register', { error: errorMsg });
  } 
  // ATUALIZADO: session.endSession() não é mais necessário
};

// --- Logout ---
// (Sem alterações)
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
// (Sem alterações)
exports.getRoot = (req, res) => {
  res.redirect('/dashboard');
};

// --- FUNÇÕES DE REDEFINIÇÃO DE SENHA ---
// (Atualizadas para Sequelize)
exports.getForgotPassword = (req, res) => {
  res.render('forgot-password', { error: null, success: null });
};

exports.postForgotPassword = async (req, res) => {
  try {
    const token = crypto.randomBytes(20).toString('hex');
    
    // ATUALIZADO: User.findOne -> db.User.findOne
    const user = await db.User.findOne({ where: { email: req.body.email.toLowerCase() } });
    
    if (!user) {
      return res.render('forgot-password', { 
        error: null, 
        success: 'Se um e-mail válido foi fornecido, um link de redefinição foi enviado.' 
      });
    }
    user.resetToken = token;
    user.resetTokenExpires = Date.now() + 3600000;
    
    // ATUALIZADO: user.save() funciona igual no Sequelize para instâncias
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
    
    // ATUALIZADO: User.findOne com operador '$gt' -> 'Op.gt'
    const user = await db.User.findOne({
      where: {
        resetToken: token,
        resetTokenExpires: { [Op.gt]: Date.now() } // $gt vira [Op.gt]
      }
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
    
    // ATUALIZADO: User.findOne com operador '$gt' -> 'Op.gt'
    const user = await db.User.findOne({
      where: {
        resetToken: token,
        resetTokenExpires: { [Op.gt]: Date.now() }
      }
    });
    
    if (!user) {
      return res.redirect('/login?error=Token de redefinição inválido ou expirado.');
    }
    
    user.password = password; // O hook 'beforeUpdate' do modelo vai criptografar
    user.resetToken = null; // ATUALIZADO: undefined -> null
    user.resetTokenExpires = null; // ATUALIZADO: undefined -> null
    
    await user.save(); // Salva as alterações
    
    req.session.destroy(() => {
        res.redirect('/login?success=Senha redefinida com sucesso! Você já pode entrar.');
    });
  } catch (err) {
    console.error('Erro em postReset:', err);
    res.render('reset-password', { error: 'Erro ao salvar sua nova senha.', token: token });
  }
};