// services/whatsappService.js
// Envia mensagens WhatsApp via Evolution API (multi-tenant)

const db = require('../models');
const evolutionService = require('./evolutionService');

const sendMessage = async (phone, message, organizationId) => {
  const org = await db.Organization.findByPk(organizationId);
  if (!org) throw new Error('Organizacao nao encontrada');

  const instanceName = org.settings && org.settings.whatsappInstanceName;
  if (!instanceName) throw new Error('WhatsApp nao configurado para esta organizacao');

  let formattedPhone = phone.replace(/\D/g, '');
  if (!formattedPhone.startsWith('55')) {
    formattedPhone = '55' + formattedPhone;
  }

  // Envia direto pela Evolution API (sem passar pelo n8n)
  return await evolutionService.sendText(instanceName, formattedPhone, message);
};

const isConfigured = (org) => {
  if (!org) return false;
  return !!(org.settings && org.settings.whatsappInstanceName && org.settings.whatsappConnected);
};

module.exports = {
  sendMessage,
  isConfigured
};
