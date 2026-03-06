const db = require('../models');

exports.getSettings = async (req, res) => {
  try {
    const organizationId = req.session.organizationId;
    const organization = await db.Organization.findByPk(organizationId);

    if (!organization) {
      req.flash('error_msg', 'Organizacao nao encontrada.');
      return res.redirect('/dashboard');
    }

    res.render('admin/configuracoes', {
      organization: organization.toJSON(),
      settings: organization.settings
    });
  } catch (err) {
    console.error('Erro ao carregar configuracoes:', err);
    req.flash('error_msg', 'Erro ao carregar configuracoes.');
    res.redirect('/dashboard');
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const organizationId = req.session.organizationId;
    const { theme, whatsappTemplate, showGallery, showOperatingHours, showAddress, automaticReminders } = req.body;

    const organization = await db.Organization.findByPk(organizationId);
    if (!organization) {
      req.flash('error_msg', 'Organizacao nao encontrada.');
      return res.redirect('/dashboard');
    }

    let currentSettings = organization.settings || {};

    currentSettings.theme = (theme === 'dark') ? 'dark' : 'light';
    currentSettings.showGallery = (showGallery === 'on');
    currentSettings.showOperatingHours = (showOperatingHours === 'on');
    currentSettings.showAddress = (showAddress === 'on');
    currentSettings.automaticReminders = (automaticReminders === 'on');

    if (typeof whatsappTemplate !== 'undefined') {
      currentSettings.whatsappTemplate = whatsappTemplate.trim() || null;
    }

    organization.settings = currentSettings;
    organization.changed('settings', true);
    await organization.save();

    req.flash('success_msg', 'Configuracoes salvas com sucesso!');
    res.redirect('/admin/configuracoes');
  } catch (err) {
    console.error('Erro ao salvar configuracoes:', err);
    req.flash('error_msg', 'Erro ao salvar configuracoes.');
    res.redirect('/admin/configuracoes');
  }
};
