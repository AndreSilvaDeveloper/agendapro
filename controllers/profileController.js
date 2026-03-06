// controllers/profileController.js
const db = require('../models');
const bcrypt = require('bcrypt');

// GET /admin/perfil
exports.getProfile = async (req, res) => {
  try {
    const user = await db.User.findByPk(req.session.userId, {
      attributes: ['id', 'username', 'email', 'phone', 'role', 'createdAt']
    });

    if (!user) {
      req.flash('error_msg', 'Usuario nao encontrado.');
      return res.redirect('/dashboard');
    }

    res.render('admin/perfil', {
      activePage: 'perfil',
      pageTitle: 'Meu Perfil',
      user: user.toJSON()
    });
  } catch (err) {
    console.error('Erro ao carregar perfil:', err);
    req.flash('error_msg', 'Erro ao carregar perfil.');
    res.redirect('/dashboard');
  }
};

// POST /admin/perfil - Atualizar dados pessoais
exports.updateProfile = async (req, res) => {
  try {
    const { username, email, phone } = req.body;
    const userId = req.session.userId;

    const user = await db.User.findByPk(userId);
    if (!user) {
      req.flash('error_msg', 'Usuario nao encontrado.');
      return res.redirect('/admin/perfil');
    }

    // Verifica se email ja esta em uso por outro usuario
    if (email && email.toLowerCase().trim() !== user.email) {
      const existing = await db.User.findOne({
        where: { email: email.toLowerCase().trim(), id: { [require('sequelize').Op.ne]: userId } }
      });
      if (existing) {
        req.flash('error_msg', 'Este e-mail ja esta em uso por outra conta.');
        return res.redirect('/admin/perfil');
      }
    }

    await user.update({
      username: username ? username.trim() : user.username,
      email: email ? email.toLowerCase().trim() : user.email,
      phone: phone ? phone.replace(/\D/g, '') : null
    });

    // Atualiza nome na sessao
    req.session.username = user.username;

    req.flash('success_msg', 'Perfil atualizado com sucesso!');
    res.redirect('/admin/perfil');
  } catch (err) {
    console.error('Erro ao atualizar perfil:', err);
    req.flash('error_msg', 'Erro ao atualizar perfil.');
    res.redirect('/admin/perfil');
  }
};

// POST /admin/perfil/senha - Trocar senha
exports.updatePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const userId = req.session.userId;

    if (!currentPassword || !newPassword || !confirmPassword) {
      req.flash('error_msg', 'Preencha todos os campos de senha.');
      return res.redirect('/admin/perfil');
    }

    if (newPassword.length < 6) {
      req.flash('error_msg', 'A nova senha deve ter pelo menos 6 caracteres.');
      return res.redirect('/admin/perfil');
    }

    if (newPassword !== confirmPassword) {
      req.flash('error_msg', 'As senhas nao conferem.');
      return res.redirect('/admin/perfil');
    }

    const user = await db.User.findByPk(userId);
    if (!user) {
      req.flash('error_msg', 'Usuario nao encontrado.');
      return res.redirect('/admin/perfil');
    }

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      req.flash('error_msg', 'Senha atual incorreta.');
      return res.redirect('/admin/perfil');
    }

    user.password = newPassword;
    await user.save();

    req.flash('success_msg', 'Senha alterada com sucesso!');
    res.redirect('/admin/perfil');
  } catch (err) {
    console.error('Erro ao trocar senha:', err);
    req.flash('error_msg', 'Erro ao trocar senha.');
    res.redirect('/admin/perfil');
  }
};
