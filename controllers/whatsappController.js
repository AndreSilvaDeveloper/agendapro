const whatsappService = require('../services/whatsappService');


// Função auxiliar robusta para pegar o usuário
const getCurrentUser = (req) => {
    // Tenta pegar do passport (req.user) ou da sessão manual (req.session)
    if (req.session && req.session.loggedIn) {
        return {
            id: req.session.userId,
            username: req.session.username,
            role: req.session.role,
            organizationId: req.session.organizationId
        };
    }
    return req.user || null;
};

// Função auxiliar para encontrar o ID da Organização
const getOrgId = (user) => {
    if (!user) return null;
    return user.organizationId || user.OrganizationId || user.org_id || (user.Organization && user.Organization.id);
};

// Rota: GET /admin/whatsapp/status
exports.getStatus = async (req, res) => {
    const user = getCurrentUser(req);
    if (!user) return res.status(401).json({ error: 'Não autorizado' });

    const orgId = getOrgId(user);
    if (!orgId) return res.status(400).json({ error: 'Usuário sem organização vinculada' });

    const status = whatsappService.getStatus(orgId);
    res.json({ status });
};

// Rota: POST /admin/whatsapp/connect
exports.connect = async (req, res) => {
    const user = getCurrentUser(req);
    if (!user) return res.status(401).json({ error: 'Não autorizado' });

    const orgId = getOrgId(user);
    if (!orgId) return res.status(400).json({ error: 'Usuário sem organização vinculada' });
    
    console.log(`Iniciando conexão para Org ID: ${orgId}`);
    whatsappService.getClient(orgId); 
    
    res.json({ message: 'Inicializando conexão... Aguarde o QR Code.' });
};

// Rota: POST /admin/whatsapp/logout
exports.logout = async (req, res) => {
    const user = getCurrentUser(req);
    if (!user) return res.status(401).json({ error: 'Não autorizado' });

    const orgId = getOrgId(user);
    await whatsappService.logoutClient(orgId);
    
    res.json({ message: 'Desconectado com sucesso.' });
};

// Renderiza a página de configuração
exports.renderSettingsPage = (req, res) => {
    const user = getCurrentUser(req);

    if (!user) {
        return res.redirect('/login');
    }

    const orgId = getOrgId(user);

    if (!orgId) {
        return res.status(500).send(`
            <h1>Erro de Dados</h1>
            <p>O usuário logado não possui um ID de Organização válido na sessão.</p>
            <a href="/dashboard">Voltar</a>
        `);
    }

    res.render('admin/whatsapp-settings', {
        user: user,
        orgId: orgId, // IMPORTANTE: Passando o ID para a view usar
        pageTitle: 'Configuração do WhatsApp'
    });
};

// Função de envio
exports.sendReminder = async (req, res) => {
    try {
        const user = getCurrentUser(req);
        if (!user) return res.status(401).json({ error: 'Sessão expirada' });

        const { phone, message } = req.body;
        const orgId = user.organizationId;

        if (!orgId) return res.status(400).json({ error: 'Organização inválida' });

        // Recupera a sessão
        const client = await whatsappService.getClient(orgId);

        // Verifica status
        const status = whatsappService.getStatus(orgId);
        if (status !== 'CONNECTED') {
            return res.status(400).json({ 
                error: 'WhatsApp desconectado. Vá em Menu > WhatsApp para conectar.' 
            });
        }

        // 1. Limpeza básica do número (deixa só números)
        let formattedPhone = phone.replace(/\D/g, ''); 

        // 2. Garante que tem o 55 (Brasil)
        if (!formattedPhone.startsWith('55')) {
            formattedPhone = '55' + formattedPhone;
        }

        // 3. A MÁGICA: Verifica se o número existe e pega o ID correto (com ou sem 9)
        // Isso retorna o objeto do contato ou null se não existir
        const contact = await client.getNumberId(formattedPhone);

        if (!contact) {
            // Se não achou, tenta adicionar o 9 (caso o usuário tenha digitado sem)
            // ou remover o 9 (caso tenha digitado com) para tentar achar.
            // Mas geralmente, se o número é válido, o getNumberId acha.
            return res.status(404).json({ error: 'Número não possui WhatsApp válido.' });
        }

        // 4. Envia para o ID serializado correto (contact._serialized)
        // O _serialized é o ID interno real (ex: 553299998888@c.us)
        await client.sendMessage(contact._serialized, message);

        return res.json({ success: true, message: 'Mensagem enviada e validada!' });

    } catch (error) {
        console.error('[WhatsApp] Erro ao enviar:', error);
        return res.status(500).json({ error: 'Erro interno ao processar envio.' });
    }
};