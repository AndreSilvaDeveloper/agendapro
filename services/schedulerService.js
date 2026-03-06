const cron = require('node-cron');
const { Op } = require('sequelize');
const sequelize = require('../db');
const { Appointment, Client, Organization } = require('../models');
const whatsappService = require('./whatsappService');

const checkAndSendReminders = async () => {
    console.log('[Cron] Verificando agendamentos para lembretes...');

    try {
        const now = new Date();
        const future = new Date(now.getTime() + 25 * 60 * 60 * 1000);

        const appointments = await Appointment.findAll({
            where: {
                date: { [Op.between]: [now, future] },
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
                    where: sequelize.where(
                        sequelize.cast(sequelize.fn('coalesce', sequelize.literal("\"Organization\".\"settings\"->>'automaticReminders'"), 'true'), 'text'),
                        'true'
                    )
                }
            ]
        });

        for (const appt of appointments) {
            const org = appt.Organization;

            // Verificar se org tem WhatsApp configurado e conectado
            if (!org.settings || !org.settings.whatsappInstanceName || !org.settings.whatsappConnected) {
                continue;
            }

            const apptDateTime = new Date(appt.date);
            const diffMs = apptDateTime - now;
            const diffHours = diffMs / (1000 * 60 * 60);

            let messageType = null;

            if (!appt.reminder24hSent && diffHours > 23 && diffHours <= 25) {
                messageType = '24h';
            }

            if (!appt.reminder3hSent && diffHours > 1.5 && diffHours <= 4) {
                messageType = '3h';
            }

            if (messageType) {
                await sendReminder(appt, org, messageType);
            }
        }

    } catch (error) {
        console.error('[Cron] Erro no processamento:', error.message);
    }
};

const sendReminder = async (appt, org, type) => {
    try {
        const clientName = appt.Client ? appt.Client.name : 'Cliente';
        let template = (org.settings && org.settings.whatsappTemplate) || null;

        if (!template) {
            if (type === '24h') {
                template = 'Ola *{cliente}*! Passando para lembrar do seu agendamento amanha no *{empresa}* as {hora}.';
            } else {
                template = 'Ola *{cliente}*! Seu horario no *{empresa}* e daqui a pouco, as {hora}. Estamos te esperando!';
            }
        }

        const apptDate = new Date(appt.date);
        const dateFormatted = apptDate.toLocaleDateString('pt-BR');
        const timeFormatted = apptDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

        let message = template
            .replace(/{cliente}/g, clientName)
            .replace(/{empresa}/g, org.name)
            .replace(/{data}/g, dateFormatted)
            .replace(/{hora}/g, timeFormatted)
            .replace(/{servico}/g, 'seus servicos');

        if (!appt.Client || !appt.Client.phone) return;

        await whatsappService.sendMessage(appt.Client.phone, message, org.id);
        console.log(`[Cron] Lembrete ${type} enviado para ${clientName}`);

        if (type === '24h') appt.reminder24hSent = true;
        if (type === '3h') appt.reminder3hSent = true;
        await appt.save();

        // Pausa anti-ban
        await new Promise(r => setTimeout(r, 2000));

    } catch (err) {
        console.error(`[Cron] Erro ao enviar:`, err.message);
    }
};

// ========================================
// ALERTAS DE VENCIMENTO DE ASSINATURA
// ========================================
const checkSubscriptionAlerts = async () => {
    console.log('[Cron] Verificando assinaturas proximas do vencimento...');

    try {
        const { Subscription, Plan, User } = require('../models');
        const now = new Date();

        // Busca assinaturas ativas/trial com vencimento proximo
        const subscriptions = await Subscription.findAll({
            where: {
                status: { [Op.in]: ['active', 'trial'] },
                currentPeriodEnd: { [Op.ne]: null }
            },
            include: [
                { model: Organization, attributes: ['id', 'name', 'settings'] },
                { model: Plan, attributes: ['name', 'price'] }
            ]
        });

        for (const sub of subscriptions) {
            if (!sub.Organization || !sub.Plan) continue;
            if (parseFloat(sub.Plan.price) === 0) continue; // Plano gratuito

            const endDate = new Date(sub.currentPeriodEnd);
            const diffMs = endDate - now;
            const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

            // Alertas em 7, 3, 1 e 0 (no dia) dias antes
            const alertDays = [7, 3, 1, 0];
            if (!alertDays.includes(diffDays)) continue;

            const org = sub.Organization;
            if (!org.settings || !org.settings.whatsappInstanceName || !org.settings.whatsappConnected) continue;

            // Busca owner da org (com telefone)
            const owner = await User.findOne({
                where: { organizationId: org.id, role: 'owner' },
                attributes: ['id', 'username', 'email', 'phone']
            });
            if (!owner) continue;

            // Tenta enviar pelo whatsapp da org
            let msg = '';
            if (diffDays === 7) {
                msg = `*AgendaPro - Aviso de Vencimento*\n\n` +
                    `Ola! Sua assinatura do plano *${sub.Plan.name}* vence em *7 dias* (${endDate.toLocaleDateString('pt-BR')}).\n\n` +
                    `Para evitar o bloqueio do sistema, realize o pagamento antes do vencimento.\n\n` +
                    `Acesse: /admin/assinatura`;
            } else if (diffDays === 3) {
                msg = `*AgendaPro - Assinatura Vencendo*\n\n` +
                    `Atencao! Faltam apenas *3 dias* para o vencimento do seu plano *${sub.Plan.name}* (${endDate.toLocaleDateString('pt-BR')}).\n\n` +
                    `Seu acesso sera bloqueado automaticamente apos o vencimento.\n\n` +
                    `Pague agora: /admin/assinatura`;
            } else if (diffDays === 1) {
                msg = `*AgendaPro - URGENTE*\n\n` +
                    `Sua assinatura *${sub.Plan.name}* vence *AMANHA* (${endDate.toLocaleDateString('pt-BR')})!\n\n` +
                    `Se nao pagar, seu acesso ao sistema sera bloqueado automaticamente.\n\n` +
                    `Pague agora: /admin/assinatura`;
            } else if (diffDays === 0) {
                msg = `*AgendaPro - ULTIMO AVISO*\n\n` +
                    `Sua fatura do plano *${sub.Plan.name}* vence *HOJE* (${endDate.toLocaleDateString('pt-BR')})!\n\n` +
                    `Se nao pagar, seu acesso ao sistema sera bloqueado automaticamente.\n\n` +
                    `Pague agora: /admin/assinatura`;
            }

            const ownerPhone = owner.phone || null;
            if (msg && ownerPhone) {
                try {
                    await whatsappService.sendMessage(ownerPhone, msg, org.id);
                    console.log(`[Cron] Alerta ${diffDays}d enviado para ${owner.username} (${ownerPhone})`);
                } catch (e) {
                    console.error(`[Cron] Erro ao enviar alerta para ${org.name}:`, e.message);
                }
            }

            // Tambem envia por email se tiver mailer configurado
            try {
                const mailer = require('../utils/mailer');
                if (owner.email && mailer.sendGenericEmail) {
                    await mailer.sendGenericEmail(
                        owner.email,
                        `AgendaPro - Sua assinatura vence em ${diffDays} dia(s)`,
                        msg.replace(/\*/g, '').replace(/\n/g, '<br>')
                    );
                }
            } catch (e) {
                // mailer pode nao ter sendGenericEmail, ignora
            }
        }

        // Verifica trials expirados e bloqueia
        const expiredTrials = await Subscription.findAll({
            where: {
                status: 'trial',
                trialEndsAt: { [Op.lt]: now }
            },
            include: [{ model: Plan, attributes: ['price'] }]
        });

        for (const sub of expiredTrials) {
            if (sub.Plan && parseFloat(sub.Plan.price) === 0) continue;
            await sub.update({ status: 'expired' });
            await User.update(
                { isBlocked: true },
                { where: { organizationId: sub.organizationId } }
            );
            console.log(`[Cron] Trial expirado -> org ${sub.organizationId} bloqueada`);
        }

    } catch (error) {
        console.error('[Cron] Erro ao verificar assinaturas:', error.message);
    }
};

const init = () => {
    // Lembretes de agendamento - a cada hora
    cron.schedule('0 * * * *', () => {
        checkAndSendReminders();
    });

    // Alertas de vencimento de assinatura - todo dia as 9h
    cron.schedule('0 9 * * *', () => {
        checkSubscriptionAlerts();
    });

    console.log('[Cron] Robo de Lembretes (24h e 3h) Iniciado.');
    console.log('[Cron] Verificacao de assinaturas (diaria 9h) Iniciada.');
};

module.exports = { init, checkSubscriptionAlerts };
