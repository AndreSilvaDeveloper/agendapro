'use strict';

const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');

const sessions = new Map();
const sessionPromises = new Map();
let io;

const init = (socketIoInstance) => {
  io = socketIoInstance;
};

const createClient = (orgId) => {
  const baseSessionPath = process.env.WA_SESSION_PATH
    ? path.resolve(process.env.WA_SESSION_PATH)
    : path.resolve(__dirname, '..', '.wwebjs_auth');

  const authStrategy = new LocalAuth({
    clientId: `session-${orgId}`,
    dataPath: baseSessionPath
  });

  console.log(`[Org ${orgId}] Criando cliente (MODO ULTRA LEVE - RENDER)...`);

  const client = new Client({
    authStrategy,
    // Aumenta o timeout de autenticação para 60s (ajuda na lentidão da Render)
    authTimeoutMs: 60000, 
    
    puppeteer: {
      headless: true,
      args: [
        // Argumentos Essenciais para Docker/Linux
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', // Crítico para memória
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        
        // --- OTIMIZAÇÕES DE MEMÓRIA (O PULO DO GATO) ---
        '--disable-features=IsolateOrigins,site-per-process', // Economiza MUITA RAM
        '--disable-extensions',
        '--disable-component-update',
        '--disable-default-apps',
        '--mute-audio',
        '--no-default-browser-check',
        '--disable-infobars',
        '--disable-web-security', // Reduz processamento extra
        '--disable-site-isolation-trials'
      ]
    },
    // User Agent fixo para evitar bloqueio
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36'
  });

  client.on('qr', (qr) => {
    console.log(`[Org ${orgId}] >> QR CODE PRONTO <<`);
    if (io) io.emit(`qr-${orgId}`, qr);
  });

  // Mostra progresso do carregamento para você saber que não travou
  client.on('loading_screen', (percent, message) => {
    console.log(`[Org ${orgId}] Carregando Chats: ${percent}% - ${message}`);
  });

  client.on('authenticated', () => {
    console.log(`[Org ${orgId}] Autenticado! Baixando mensagens...`);
    if (io) io.emit(`status-${orgId}`, { status: 'AUTHENTICATED' });
  });

  client.on('ready', () => {
    console.log(`[Org ${orgId}] >>> SISTEMA ESTÁVEL E PRONTO <<<`);
    if (io) io.emit(`status-${orgId}`, { status: 'CONNECTED' });
  });

  client.on('disconnected', (reason) => {
    console.log(`[Org ${orgId}] Desconectado: ${reason}`);
    if (io) io.emit(`status-${orgId}`, { status: 'DISCONNECTED' });
    // Destrói para limpar memória
    destroyClient(orgId);
  });

  return client;
};

const getClient = async (orgId) => {
  if (sessions.has(orgId)) return sessions.get(orgId);
  if (sessionPromises.has(orgId)) return sessionPromises.get(orgId);

  const initPromise = (async () => {
    console.log(`[Org ${orgId}] Inicializando...`);
    const client = createClient(orgId);

    try {
      await client.initialize();
      sessions.set(orgId, client);
      return client;
    } catch (err) {
      console.error(`[Org ${orgId}] Erro ao iniciar:`, err.message);
      try { await client.destroy(); } catch (e) {}
      throw err;
    }
  })();

  sessionPromises.set(orgId, initPromise);

  try {
    const client = await initPromise;
    return client;
  } finally {
    if (sessionPromises.get(orgId) === initPromise) {
      sessionPromises.delete(orgId);
    }
  }
};

const requestPairingCode = async (orgId, phoneNumber) => {
    const client = await getClient(orgId);
    if (!client.pupBrowser) throw new Error('Sistema iniciando...');
    console.log(`[Org ${orgId}] Bloqueio de segurança: Use QR Code.`);
    throw new Error('Por favor, use o QR CODE para estabilidade.');
};

const logoutClient = async (orgId) => {
  if (!sessions.has(orgId)) return false;
  const client = sessions.get(orgId);
  try {
    await client.logout();
    await client.destroy();
  } catch (error) { console.error('Erro logout:', error); }
  finally {
    sessions.delete(orgId);
    sessionPromises.delete(orgId);
    if (io) io.emit(`status-${orgId}`, { status: 'DISCONNECTED' });
  }
  return true;
};

const destroyClient = async (orgId) => {
  if (!sessions.has(orgId)) return;
  const client = sessions.get(orgId);
  try { await client.destroy(); } catch (e) {}
  finally {
    sessions.delete(orgId);
    sessionPromises.delete(orgId);
  }
};

const getStatus = (orgId) => {
  if (sessions.has(orgId)) return sessions.get(orgId).info ? 'CONNECTED' : 'INITIALIZING';
  if (sessionPromises.has(orgId)) return 'INITIALIZING';
  return 'DISCONNECTED';
};

module.exports = { init, getClient, logoutClient, getStatus, destroyClient, requestPairingCode };