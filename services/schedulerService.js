// services/schedulerService.js
const cron = require('node-cron');
const { Op } = require('sequelize');
const { Appointment, Client, Organization } = require('../models');
const whatsappService = require('./whatsappService');

// Função auxiliar para criar objeto Date a partir de string "YYYY-MM-DD" e "HH:MM"
const createDateObj = (dateStr, timeStr) => {
    const [year, month, day] = dateStr.split('-');
    const [hours, minutes] = timeStr.split(':');
    // Importante: O mês no JS começa em 0 (janeiro é 0)
    return new Date(year, month - 1, day, hours, minutes);
};

const checkAndSendReminders = async () => {
    console.log('⏰ [Cron] Verificando agendamentos (24h e 3h)...');

    try {
        // Pega data de hoje e amanhã (para cobrir o intervalo de 24h)
        const today = new Date();
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);

        const todayStr = today.toISOString().split('T')[0];
        const tomorrowStr = tomorrow.toISOString().split('T')[0];

        // Busca agendamentos de HOJE e AMANHÃ que não estejam cancelados
        // E que a organização tenha ativado os lembretes
        const appointments = await Appointment.findAll({
            where: {
                date: { [Op.in]: [todayStr, tomorrowStr] },
               status: { 
                    [Op.notIn]: ['cancelado_pelo_cliente', 'cancelado_pelo_salao', 'concluido'] 
                },
                
                [Op.or]: [
                    { reminder24hSent: false },
                    { reminder3hSent: false }
                ]
            },
            include: [
                { model: Client },
                { 
                    model: Organization,
                    where: { 'settings.automaticReminders': true } 
                }
            ]
        });

        const now = new Date();

        for (const appt of appointments) {
            const org = appt.Organization;
            
            // Verifica conexão do WhatsApp
            const status = whatsappService.getStatus(org.id);
            if (status !== 'CONNECTED') continue;

            const wpClient = await whatsappService.getClient(org.id);
            
            // Calcula o tempo até o agendamento
            const apptDateTime = createDateObj(appt.date, appt.time);
            const diffMs = apptDateTime - now; // Diferença em milissegundos
            const diffHours = diffMs / (1000 * 60 * 60); // Diferença em horas

            let messageType = null;

            // --- LÓGICA DO LEMBRETE DE 24 HORAS ---
            // Envia se faltar entre 23h e 25h, e ainda não foi enviado
            if (!appt.reminder24hSent && diffHours > 23 && diffHours <= 25) {
                messageType = '24h';
            }

            // --- LÓGICA DO LEMBRETE DE 3 HORAS ---
            // Envia se faltar entre 2h e 4h, e ainda não foi enviado
            // (Damos uma margem porque o cron roda de hora em hora)
            if (!appt.reminder3hSent && diffHours > 1.5 && diffHours <= 4) {
                messageType = '3h';
            }

            if (messageType) {
                await sendWhatsApp(wpClient, appt, org, messageType);
            }
        }

    } catch (error) {
        console.error('🔥 [Cron] Erro no processamento:', error);
    }
};

const sendWhatsApp = async (client, appt, org, type) => {
    try {
        const clientName = appt.Client ? appt.Client.name : 'Cliente';
        let template = org.settings.whatsappTemplate;

        // Se não tiver template personalizado, usa um padrão dependendo do tipo
        if (!template) {
            if (type === '24h') {
                template = "Olá *{cliente}*! Passando para lembrar do seu agendamento amanhã no *{empresa}* às {hora}.";
            } else {
                template = "Olá *{cliente}*! Seu horário no *{empresa}* é daqui a pouco, às {hora}. Estamos te esperando!";
            }
        }

        // Formata a data para PT-BR
        const dateFormatted = appt.date.split('-').reverse().join('/');

        let message = template
            .replace(/{cliente}/g, clientName)
            .replace(/{empresa}/g, org.name)
            .replace(/{data}/g, dateFormatted)
            .replace(/{hora}/g, appt.time)
            .replace(/{servico}/g, 'seus serviços');

        // Formata telefone
        let phone = appt.Client.phone.replace(/\D/g, '');
        if (phone.length >= 10 && phone.length <= 11) phone = '55' + phone;

        const contact = await client.getNumberId(phone);
        if (contact) {
            await client.sendMessage(contact._serialized, message);
            console.log(`✅ [Cron] Lembrete ${type} enviado para ${clientName}`);

            // Atualiza o banco para não enviar de novo
            if (type === '24h') appt.reminder24hSent = true;
            if (type === '3h') appt.reminder3hSent = true;
            await appt.save();
        }
        
        // Pausa anti-ban
        await new Promise(r => setTimeout(r, 3000));

    } catch (err) {
        console.error(`❌ [Cron] Erro ao enviar:`, err.message);
    }
};

const init = () => {
    // Roda a cada 60 minutos (No minuto 0 de cada hora)
    // Ex: 08:00, 09:00, 10:00...
    cron.schedule('0 * * * *', () => {
        checkAndSendReminders();
    });
    
    console.log('🚀 Robô de Lembretes (24h e 3h) Iniciado.');
    
    // (Opcional) Executar imediatamente ao ligar o servidor para testar
    // checkAndSendReminders(); 
};

module.exports = { init };