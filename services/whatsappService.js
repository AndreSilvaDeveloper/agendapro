// services/whatsappService.js
const { Client, LocalAuth } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');

// Armazena as sessões ativas: { '1': Client, '2': Client }
const sessions = new Map();
let io; // Instância do Socket.IO

// Inicializa o serviço com a instância do Socket.IO
const init = (socketIoInstance) => {
    io = socketIoInstance;
};

// Função auxiliar para destruir um client sem logout (ex: erro, restart do servidor)
const destroyClient = async (orgId) => {
    if (sessions.has(orgId)) {
        const client = sessions.get(orgId);
        try {
            await client.destroy();
        } catch (e) {
            console.error(`Erro ao destruir client da Org ${orgId}:`, e.message || e);
        }
        sessions.delete(orgId);
    }
};

// Função para iniciar ou recuperar uma sessão específica
const getClient = async (orgId) => {
    // Se já existe uma sessão para essa organização, retorna ela
    if (sessions.has(orgId)) {
        return sessions.get(orgId);
    }

    console.log(`Iniciando nova sessão WhatsApp para Org: ${orgId}`);

    const sessionPath = process.env.WA_SESSION_PATH
        ? process.env.WA_SESSION_PATH
        : './.wwebjs_auth';

    // Configura Puppeteer:
    // - Em ambiente com PUPPETEER_EXECUTABLE_PATH (Docker/Render), usa Chrome externo
    // - Localmente, usa o Chromium baixado pelo Puppeteer
    const useExternalChrome = !!process.env.PUPPETEER_EXECUTABLE_PATH;

    const puppeteerConfig = {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    };

    if (useExternalChrome) {
        puppeteerConfig.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    const client = new Client({
        authStrategy: new LocalAuth({
            clientId: `session-${orgId}`,
            dataPath: sessionPath
        }),
        puppeteer: puppeteerConfig
    });

    // 1. QR Code recebido
    client.on('qr', (qr) => {
        console.log(`QR Code gerado para Org ${orgId}`);
        if (io) io.emit(`qr-${orgId}`, qr);
    });

    // 2. Cliente pronto
    client.on('ready', () => {
        console.log(`WhatsApp da Org ${orgId} está pronto!`);
        if (io) io.emit(`status-${orgId}`, { status: 'CONNECTED' });
    });

    // 3. Autenticado
    client.on('authenticated', () => {
        console.log(`Org ${orgId} autenticada`);
        if (io) io.emit(`status-${orgId}`, { status: 'AUTHENTICATED' });
    });

    // 4. Desconectado (pelo celular ou logout)
    client.on('disconnected', (reason) => {
        console.log(`Org ${orgId} desconectada:`, reason);

        // Se foi logout explícito, apagamos a pasta daquela sessão
        if (reason === 'LOGOUT') {
            const sessionDir = path.join(sessionPath, `session-${orgId}`);
            try {
                fs.rmSync(sessionDir, { recursive: true, force: true });
                console.log(`Sessão da Org ${orgId} apagada em disco após LOGOUT (${sessionDir}).`);
            } catch (e) {
                console.error(`Erro ao remover pasta de sessão da Org ${orgId}:`, e.message || e);
            }
        }

        if (io) {
            io.emit(`status-${orgId}`, {
                status: 'DISCONNECTED',
                reason
            });
        }
        destroyClient(orgId);
    });

    // 5. Erro geral no client (inclui erros de Puppeteer/Frame)
    client.on('error', (err) => {
        console.error(`Erro no client WhatsApp da Org ${orgId}:`, err);
        if (io) {
            io.emit(`status-${orgId}`, {
                status: 'ERROR',
                error: err.message || String(err)
            });
        }
        destroyClient(orgId);
    });

    // Inicializa o client
    try {
        await client.initialize();
        sessions.set(orgId, client);
        return client;
    } catch (err) {
        console.error(`Erro ao iniciar sessão ${orgId}:`, err);
        if (io) {
            io.emit(`status-${orgId}`, {
                status: 'ERROR_INIT',
                error: err.message || String(err)
            });
        }
        await destroyClient(orgId);
        return null;
    }
};

// Função para desconectar/logout manualmente
const logoutClient = async (orgId) => {
    if (sessions.has(orgId)) {
        const client = sessions.get(orgId);
        try {
            await client.logout();   // Sai do WhatsApp Web
            await client.destroy();  // Fecha o navegador
            sessions.delete(orgId);
            if (io) io.emit(`status-${orgId}`, { status: 'DISCONNECTED' });
            return true;
        } catch (error) {
            console.error('Erro ao fazer logout:', error);
            sessions.delete(orgId);
            return false;
        }
    }
    return false;
};

// Verifica status atual da sessão em memória
const getStatus = (orgId) => {
    if (sessions.has(orgId)) {
        const client = sessions.get(orgId);
        if (client.info) return 'CONNECTED';
        return 'INITIALIZING';
    }
    return 'DISCONNECTED';
};

module.exports = {
    init,
    getClient,
    logoutClient,
    getStatus
};
