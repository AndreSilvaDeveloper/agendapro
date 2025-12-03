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

  console.log(`[Org ${orgId}] Criando cliente (Modo de Estabilidade - QR Code)...`);

  const client = new Client({
    authStrategy,
    // NÃO usamos webVersionCache para evitar incompatibilidade
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', // Crítico para evitar crash de memória
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    },
    // Finge ser um Chrome normal para evitar bloqueio "Detached Frame"
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36'
  });

  client.on('qr', (qr) => {
    console.log(`[Org ${orgId}] >> QR CODE GERADO << (Escaneie agora)`);
    if (io) io.emit(`qr-${orgId}`, qr);
  });

  client.on('authenticated', () => {
    console.log(`[Org ${orgId}] Autenticado!`);
    if (io) io.emit(`status-${orgId}`, { status: 'AUTHENTICATED' });
  });

  client.on('ready', () => {
    console.log(`[Org ${orgId}] Sistema Pronto!`);
    if (io) io.emit(`status-${orgId}`, { status: 'CONNECTED' });
  });

  client.on('disconnected', (reason) => {
    console.log(`[Org ${orgId}] Desconectado: ${reason}`);
    if (io) io.emit(`status-${orgId}`, { status: 'DISCONNECTED' });
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

// --- MUDANÇA IMPORTANTE AQUI ---
// Esta função agora NÃO tenta se comunicar com o WhatsApp para evitar o crash.
// Ela força o usuário a usar o QR Code, que é o método estável.
const requestPairingCode = async (orgId, phoneNumber) => {
    const client = await getClient(orgId);
    
    // Se o navegador não estiver rodando, nem tenta
    if (!client.pupBrowser) {
        throw new Error('O sistema ainda está iniciando. Aguarde o QR Code aparecer.');
    }

    // Retorna erro proposital para não quebrar o servidor
    console.log(`[Org ${orgId}] Bloqueando tentativa de Pairing Code para evitar crash.`);
    throw new Error('Devido a instabilidades do WhatsApp, esta função está temporariamente desativada. Por favor, use a opção de ESCANEAR O QR CODE.');
};

const logoutClient = async (orgId) => {
  if (!sessions.has(orgId)) return false;
  const client = sessions.get(orgId);
  try {
    await client.logout();
    await client.destroy();
  } catch (error) {
    console.error('Erro logout:', error);
  } finally {
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