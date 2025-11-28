// services/whatsappService.js
'use strict';

const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');

// Sessões já prontas: { '1': Client, '2': Client }
const sessions = new Map();

// Promessas de inicialização em andamento (para evitar 2 Chrome no mesmo profile)
const sessionPromises = new Map();

let io; // Instância do Socket.IO (recebida do app.js)

// --------------------------------------------------
// Inicialização com Socket.IO (chamado em app.js)
// --------------------------------------------------
const init = (socketIoInstance) => {
  io = socketIoInstance;
};

// --------------------------------------------------
// Função interna que cria o client (sem inicializar)
// --------------------------------------------------
const createClient = (orgId) => {
  const baseSessionPath = process.env.WA_SESSION_PATH
    ? path.resolve(process.env.WA_SESSION_PATH)
    : path.resolve(__dirname, '..', '.wwebjs_auth');

  const authStrategy = new LocalAuth({
    clientId: `session-${orgId}`,
    dataPath: baseSessionPath
  });

  // Se estiver no Render, usamos o binário indicado pela env.
  // Em dev local, normalmente NÃO define PUPPETEER_EXECUTABLE_PATH
  // e o whatsapp-web.js usa o Chromium/Chrome padrão.
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;

  const client = new Client({
    authStrategy,
    puppeteer: {
      headless: true,
      executablePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu'
      ].filter(Boolean)
    }
  });

  // ----------------- Eventos -----------------

  // QR Code recebido
  client.on('qr', (qr) => {
    console.log(`QR Code gerado para Org ${orgId}`);
    if (io) io.emit(`qr-${orgId}`, qr);
  });

  // Autenticado
  client.on('authenticated', () => {
    console.log(`Org ${orgId} autenticada`);
    if (io) io.emit(`status-${orgId}`, { status: 'AUTHENTICATED' });
  });

  // Pronto
  client.on('ready', () => {
    console.log(`WhatsApp da Org ${orgId} está pronto!`);
    if (io) io.emit(`status-${orgId}`, { status: 'CONNECTED' });
  });

  // Desconectado (celular/deslogou)
  client.on('disconnected', (reason) => {
    console.log(`Org ${orgId} desconectada:`, reason);
    if (io) io.emit(`status-${orgId}`, { status: 'DISCONNECTED' });
    destroyClient(orgId);
  });

  return client;
};

// --------------------------------------------------
// getClient com trava de concorrência
// --------------------------------------------------
const getClient = async (orgId) => {
  // 1) Já tem sessão pronta na memória
  if (sessions.has(orgId)) {
    return sessions.get(orgId);
  }

  // 2) Já tem inicialização em andamento → reaproveita a mesma Promise
  if (sessionPromises.has(orgId)) {
    return sessionPromises.get(orgId);
  }

  // 3) Cria uma nova Promise de inicialização e guarda em sessionPromises
  const initPromise = (async () => {
    console.log(`Iniciando nova sessão WhatsApp para Org: ${orgId}`);

    const client = createClient(orgId);

    try {
      await client.initialize();
      sessions.set(orgId, client);
      return client;
    } catch (err) {
      console.error(`Erro ao iniciar sessão ${orgId}:`, err);
      // Se deu erro, garante que não fica nada pendurado
      try {
        await client.destroy();
      } catch (e) { /* ignora */ }
      throw err;
    }
  })();

  sessionPromises.set(orgId, initPromise);

  try {
    const client = await initPromise;
    return client;
  } finally {
    // Remove a promise da fila (com sucesso ou erro)
    const current = sessionPromises.get(orgId);
    if (current === initPromise) {
      sessionPromises.delete(orgId);
    }
  }
};

// --------------------------------------------------
// Logout manual (via painel)
// --------------------------------------------------
const logoutClient = async (orgId) => {
  if (!sessions.has(orgId)) return false;

  const client = sessions.get(orgId);
  try {
    await client.logout();  // Sai do WhatsApp Web
    await client.destroy(); // Fecha o navegador
  } catch (error) {
    console.error('Erro ao fazer logout:', error);
  } finally {
    sessions.delete(orgId);
    sessionPromises.delete(orgId);
    if (io) io.emit(`status-${orgId}`, { status: 'DISCONNECTED' });
  }

  return true;
};

// --------------------------------------------------
// Destruir cliente sem logout (ex: restart de servidor)
// --------------------------------------------------
const destroyClient = async (orgId) => {
  if (!sessions.has(orgId)) return;

  const client = sessions.get(orgId);
  try {
    await client.destroy();
  } catch (e) {
    // ignora
  } finally {
    sessions.delete(orgId);
    sessionPromises.delete(orgId);
  }
};

// --------------------------------------------------
// Status simples (para exibir no painel)
// --------------------------------------------------
const getStatus = (orgId) => {
  if (sessions.has(orgId)) {
    const client = sessions.get(orgId);
    // Se já tem info, consideramos conectado
    if (client.info) return 'CONNECTED';
    return 'INITIALIZING';
  }

  if (sessionPromises.has(orgId)) {
    return 'INITIALIZING';
  }

  return 'DISCONNECTED';
};

module.exports = {
  init,
  getClient,
  logoutClient,
  getStatus,
  destroyClient
};
