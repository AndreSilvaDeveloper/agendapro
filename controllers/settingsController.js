// controllers/settingsController.js

const db = require('../models');

/**
 * GET /admin/configuracoes
 * Mostra a página de configurações da organização ATUALMENTE LOGADA.
 * Acessível pelo 'owner' ou 'superadmin' personificado.
 */
exports.getSettings = async (req, res) => {
  try {
    // O ID da organização vem da SESSÃO
    // (seja do 'owner' ou do 'superadmin' personificado)
    const organizationId = req.session.organizationId;

    const organization = await db.Organization.findByPk(organizationId);

    if (!organization) {
      // req.flash('error', 'Organização não encontrada.');
      return res.redirect('/dashboard');
    }

    res.render('admin/configuracoes', {
      organization: organization.toJSON(),
      // 'settings' já vem com os defaults que definimos no modelo
      settings: organization.settings 
    });
  } catch (err) {
    console.error('Erro ao carregar configurações:', err);
    // req.flash('error', 'Erro ao carregar a página de configurações.');
    res.redirect('/dashboard');
  }
};

/**
 * POST /admin/configuracoes
 * Atualiza as configurações da organização.
 */
exports.updateSettings = async (req, res) => {
  try {
    const organizationId = req.session.organizationId;
    const { theme, showGallery, showOperatingHours, showAddress } = req.body;

    const organization = await db.Organization.findByPk(organizationId);
    if (!organization) {
      // req.flash('error', 'Organização não encontrada.');
      return res.redirect('/dashboard');
    }

    // Pega as configurações atuais para não sobrescrever outras
    let currentSettings = organization.settings || {};

    // --- Meta 2: Tema ---
    currentSettings.theme = (theme === 'dark') ? 'dark' : 'light';
    
    // --- Meta 1: Feature Flags ---
    // O valor de um checkbox não enviado é 'undefined'.
    // Usamos '== "on"' para converter para true/false.
    currentSettings.showGallery = (showGallery === 'on');
    currentSettings.showOperatingHours = (showOperatingHours === 'on');
    currentSettings.showAddress = (showAddress === 'on');

    // Atualiza o campo 'settings' no banco
    organization.settings = currentSettings;
    await organization.save();

    // req.flash('success', 'Configurações salvas com sucesso!');
    res.redirect('/admin/configuracoes');

  } catch (err) {
    console.error('Erro ao salvar configurações:', err);
    // req.flash('error', 'Erro ao salvar as configurações.');
    res.redirect('/admin/configuracoes');
  }
};