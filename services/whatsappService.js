const { Client, LocalAuth } = require('whatsapp-web.js');

// Armazena as sessões ativas: { 'org_1': Client, 'org_2': Client }
const sessions = new Map();
let io; // Instância do Socket.IO

const init = (socketIoInstance) => {
    io = socketIoInstance;
};

// Função para iniciar ou recuperar uma sessão específica
const getClient = async (orgId) => {
    // Se já existe uma sessão para essa organização, retorna ela
    if (sessions.has(orgId)) {
        return sessions.get(orgId);
    }

    // Se não existe, cria uma nova
    console.log(`Iniciando nova sessão WhatsApp para Org: ${orgId}`);


    const sessionPath = process.env.WA_SESSION_PATH 
        ? process.env.WA_SESSION_PATH 
        : './.wwebjs_auth';

    
    const client = new Client({
        authStrategy: new LocalAuth({ 
            clientId: `session-${orgId}`,
            dataPath: process.env.WA_SESSION_PATH || './.wwebjs_auth'
        }),
        puppeteer: {
        // O caminho vem do Docker. Se não achar, usa o padrão do sistema.
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable',
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage', // <--- ESSE É O MAIS IMPORTANTE PARA DOCKER
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process', 
            '--disable-gpu'
        ]
    }
});

    // Configurar Eventos do Cliente
    
    // 1. QR Code recebido
    client.on('qr', (qr) => {
        console.log(`QR Code gerado para Org ${orgId}`);
        // Emite o QR Code apenas para o navegador que estiver "ouvindo" o canal dessa org
        if (io) io.emit(`qr-${orgId}`, qr); 
    });

    // 2. Cliente Pronto
    client.on('ready', () => {
        console.log(`WhatsApp da Org ${orgId} está pronto!`);
        if (io) io.emit(`status-${orgId}`, { status: 'CONNECTED' });
    });

    // 3. Autenticado
    client.on('authenticated', () => {
        console.log(`Org ${orgId} autenticada`);
        if (io) io.emit(`status-${orgId}`, { status: 'AUTHENTICATED' });
    });

    // 4. Desconectado (pelo celular)
    client.on('disconnected', (reason) => {
        console.log(`Org ${orgId} desconectada:`, reason);
        if (io) io.emit(`status-${orgId}`, { status: 'DISCONNECTED' });
        // Remove da memória e destroi o cliente para liberar RAM
        destroyClient(orgId);
    });

    // Inicializa
    try {
        await client.initialize();
        sessions.set(orgId, client); // Salva na memória
        return client;
    } catch (err) {
        console.error(`Erro ao iniciar sessão ${orgId}:`, err);
        return null;
    }
};

// Função para desconectar/logout manualmente
const logoutClient = async (orgId) => {
    if (sessions.has(orgId)) {
        const client = sessions.get(orgId);
        try {
            await client.logout(); // Sai do WhatsApp Web
            await client.destroy(); // Fecha o navegador
            sessions.delete(orgId); // Remove da lista
            if (io) io.emit(`status-${orgId}`, { status: 'DISCONNECTED' });
            return true;
        } catch (error) {
            console.error('Erro ao fazer logout:', error);
            // Mesmo com erro, tentamos destruir
            sessions.delete(orgId);
            return false;
        }
    }
    return false;
};

// Função auxiliar para destruir sem logout (ex: reiniciar server)
const destroyClient = async (orgId) => {
    if (sessions.has(orgId)) {
        const client = sessions.get(orgId);
        try {
            await client.destroy();
        } catch (e) {}
        sessions.delete(orgId);
    }
};

// Verifica status atual
const getStatus = (orgId) => {
    if (sessions.has(orgId)) {
        const client = sessions.get(orgId);
        // info e state podem não estar disponíveis imediatamente, verificação básica
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