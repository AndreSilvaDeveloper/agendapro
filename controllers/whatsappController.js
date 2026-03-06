const db = require('../models');
const evolutionService = require('../services/evolutionService');
const whatsappService = require('../services/whatsappService');

const WEBHOOK_BASE_URL = process.env.WEBHOOK_BASE_URL || '';
const getWebhookUrl = () => {
  if (WEBHOOK_BASE_URL) return `${WEBHOOK_BASE_URL}/webhook/evolution`;
  return null;
};

// GET /admin/whatsapp
exports.renderSettingsPage = async (req, res) => {
  try {
    const orgId = req.session.organizationId;
    const org = await db.Organization.findByPk(orgId);
    if (!org) return res.redirect('/dashboard');

    const settings = org.settings || {};
    let connectionStatus = 'disconnected';
    let qrCode = null;

    if (settings.whatsappInstanceName) {
      try {
        const status = await evolutionService.getConnectionStatus(settings.whatsappInstanceName);
        connectionStatus = status.state === 'open' ? 'connected' : status.state || 'disconnected';
      } catch (e) {
        connectionStatus = 'error';
      }
    }

    res.render('admin/whatsapp-settings', {
      orgId,
      org,
      settings,
      connectionStatus,
      qrCode,
      instanceName: settings.whatsappInstanceName || null,
      botEnabled: settings.whatsappBotEnabled || false
    });
  } catch (err) {
    console.error('[WhatsApp] Erro ao renderizar:', err);
    res.status(500).send('Erro interno');
  }
};

// POST /api/whatsapp/create-instance
exports.createInstance = async (req, res) => {
  try {
    const orgId = req.session.organizationId;
    const org = await db.Organization.findByPk(orgId);
    if (!org) return res.status(404).json({ error: 'Organizacao nao encontrada' });

    const name = evolutionService.instanceName(orgId, org.slug);

    const webhookUrl = getWebhookUrl();
    if (!webhookUrl) {
      return res.status(400).json({ error: 'WEBHOOK_BASE_URL nao configurada no .env' });
    }

    // Verifica se ja existe
    const exists = await evolutionService.instanceExists(name);
    if (exists) {
      // Ja existe, so atualiza o webhook
      await evolutionService.setWebhook(name, webhookUrl);
    } else {
      await evolutionService.createInstance(name, webhookUrl);
    }

    // Salvar no settings da org
    const newSettings = { ...org.settings, whatsappInstanceName: name };
    org.settings = newSettings;
    org.changed('settings', true);
    await org.save();

    res.json({ success: true, instanceName: name });
  } catch (err) {
    console.error('[WhatsApp] Erro ao criar instancia:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// GET /api/whatsapp/qrcode
exports.getQrCode = async (req, res) => {
  try {
    const orgId = req.session.organizationId;
    const org = await db.Organization.findByPk(orgId);
    const instanceName = org && org.settings && org.settings.whatsappInstanceName;

    if (!instanceName) {
      return res.status(400).json({ error: 'Instancia nao criada. Crie primeiro.' });
    }

    const data = await evolutionService.getQrCode(instanceName);
    res.json({
      qrcode: data.base64 || null,
      pairingCode: data.pairingCode || null,
      code: data.code || null
    });
  } catch (err) {
    console.error('[WhatsApp] Erro QR:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// GET /api/whatsapp/status
exports.getStatus = async (req, res) => {
  try {
    const orgId = req.session.organizationId;
    const org = await db.Organization.findByPk(orgId);
    const instanceName = org && org.settings && org.settings.whatsappInstanceName;

    if (!instanceName) {
      return res.json({ status: 'not_created' });
    }

    const status = await evolutionService.getConnectionStatus(instanceName);
    const connected = status.state === 'open';

    // Atualiza settings se mudou
    if (org.settings.whatsappConnected !== connected) {
      org.settings = { ...org.settings, whatsappConnected: connected };
      org.changed('settings', true);
      await org.save();
    }

    res.json({ status: connected ? 'connected' : status.state || 'disconnected' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/whatsapp/disconnect
exports.disconnect = async (req, res) => {
  try {
    const orgId = req.session.organizationId;
    const org = await db.Organization.findByPk(orgId);
    const instanceName = org && org.settings && org.settings.whatsappInstanceName;

    if (!instanceName) {
      return res.status(400).json({ error: 'Nenhuma instancia configurada' });
    }

    await evolutionService.logoutInstance(instanceName);

    org.settings = { ...org.settings, whatsappConnected: false };
    org.changed('settings', true);
    await org.save();

    res.json({ success: true });
  } catch (err) {
    console.error('[WhatsApp] Erro ao desconectar:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// POST /api/whatsapp/toggle-bot
exports.toggleBot = async (req, res) => {
  try {
    const orgId = req.session.organizationId;
    const org = await db.Organization.findByPk(orgId);
    if (!org) return res.status(404).json({ error: 'Org nao encontrada' });

    const currentState = org.settings && org.settings.whatsappBotEnabled;
    org.settings = { ...org.settings, whatsappBotEnabled: !currentState };
    org.changed('settings', true);
    await org.save();

    res.json({ success: true, botEnabled: !currentState });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/whatsapp/test
exports.testConnection = async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Informe um numero de telefone.' });

    const orgId = req.session.organizationId;
    await whatsappService.sendMessage(phone, 'Teste do AgendaPro - WhatsApp funcionando! ✅', orgId);
    res.json({ success: true, message: 'Mensagem de teste enviada!' });
  } catch (err) {
    console.error('[WhatsApp] Erro no teste:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// POST /api/send-reminder
exports.sendReminder = async (req, res) => {
  try {
    const { phone, message } = req.body;
    if (!phone || !message) {
      return res.status(400).json({ error: 'Telefone e mensagem sao obrigatorios.' });
    }

    const orgId = req.session.organizationId;
    await whatsappService.sendMessage(phone, message, orgId);
    res.json({ success: true, message: 'Mensagem enviada!' });
  } catch (err) {
    console.error('[WhatsApp] Erro ao enviar:', err.message);
    res.status(500).json({ error: err.message });
  }
};
