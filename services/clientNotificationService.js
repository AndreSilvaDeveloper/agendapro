// services/clientNotificationService.js
// Notifica clientes via WhatsApp (suporta LID e telefone)

const db = require('../models');
const evolutionService = require('./evolutionService');
const { Op } = require('sequelize');

// Envia mensagem para o cliente via WhatsApp
// Tenta primeiro pelo contactId (LID) salvo na sessao, depois pelo telefone
const notifyClient = async (clientId, organizationId, message) => {
  if (!clientId || !organizationId) return;

  try {
    const org = await db.Organization.findByPk(organizationId);
    if (!org || !org.settings || !org.settings.whatsappInstanceName) return;

    const instanceName = org.settings.whatsappInstanceName;
    if (!org.settings.whatsappConnected) return;

    // 1. Buscar sessao do cliente para encontrar o contactId (LID)
    const session = await db.BotSession.findOne({
      where: {
        organizationId,
        [Op.or]: [
          db.sequelize.literal(`"data"->>'clientId' = '${clientId}'`),
          db.sequelize.literal(`("data"->'clientId')::text = '${clientId}'`)
        ]
      }
    });

    if (session) {
      await evolutionService.sendText(instanceName, session.phone, message);
      console.log('[Notify] Enviado para cliente via contactId:', session.phone);
      return true;
    }

    // 2. Fallback: enviar pelo telefone do cliente
    const client = await db.Client.findByPk(clientId, { attributes: ['phone'] });
    if (client && client.phone) {
      const whatsappService = require('./whatsappService');
      await whatsappService.sendMessage(client.phone, message, organizationId);
      console.log('[Notify] Enviado para cliente via telefone:', client.phone);
      return true;
    }

    console.log('[Notify] Cliente', clientId, 'sem sessao e sem telefone. Nao notificado.');
    return false;
  } catch (e) {
    console.error('[Notify] Erro ao notificar cliente:', e.message);
    return false;
  }
};

module.exports = { notifyClient };
