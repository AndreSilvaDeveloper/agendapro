// controllers/webhookEvolutionController.js
// Recebe mensagens da Evolution API e processa com Gemini AI

const db = require('../models');
const evolutionService = require('../services/evolutionService');
const geminiService = require('../services/geminiService');
const { notifyClient } = require('../services/clientNotificationService');
const { Op } = require('sequelize');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const customParseFormat = require('dayjs/plugin/customParseFormat');

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

const tz = 'America/Sao_Paulo';

// Busca telefone real de um contato LID via API da Evolution
const fetchPhoneByLid = async (instanceName, lidJid) => {
  try {
    const url = `${evolutionService.EVOLUTION_API_URL}/chat/findMessages/${instanceName}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': process.env.EVOLUTION_API_KEY },
      body: JSON.stringify({ where: { key: { remoteJid: lidJid } }, limit: 1 })
    });
    if (!res.ok) return null;
    const data = await res.json();
    const records = data.messages?.records || data.records || [];
    if (records.length > 0) {
      const altJid = records[0].key?.remoteJidAlt || '';
      if (altJid.includes('@s.whatsapp.net')) {
        return altJid.replace('@s.whatsapp.net', '');
      }
    }
    return null;
  } catch { return null; }
};

// Cache para evitar processar mensagens duplicadas
const processedMessages = new Map();
const DEDUP_TTL = 60000; // 60 segundos

// ========================================
// WEBHOOK - Recebe mensagens da Evolution API
// ========================================
exports.handleIncoming = async (req, res) => {
  res.json({ success: true });

  try {
    const body = req.body;
    console.log('[WebhookEvolution] Recebido evento:', body.event || 'sem evento');

    // Deduplicar mensagens pelo messageId
    const messageId = body.data && body.data.key && body.data.key.id;
    if (messageId) {
      if (processedMessages.has(messageId)) {
        console.log('[WebhookEvolution] Mensagem duplicada ignorada:', messageId);
        return;
      }
      processedMessages.set(messageId, Date.now());
      // Limpar cache antigo
      if (processedMessages.size > 100) {
        const now = Date.now();
        for (const [id, ts] of processedMessages) {
          if (now - ts > DEDUP_TTL) processedMessages.delete(id);
        }
      }
    }

    const instanceName = body.instance && (body.instance.instanceName || body.instance);
    if (!instanceName) { console.log('[WebhookEvolution] Sem instanceName'); return; }

    const data = body.data;
    if (!data) { console.log('[WebhookEvolution] Sem data'); return; }
    if (!data.message) { console.log('[WebhookEvolution] Sem data.message, keys:', Object.keys(data)); return; }

    const key = data.key || {};
    if (key.fromMe) { console.log('[WebhookEvolution] fromMe, ignorando'); return; }

    // Identificar remetente
    let remoteJid = key.remoteJid || '';

    // Se for grupo ou vazio, ignorar
    if (!remoteJid || remoteJid.includes('@g.us')) {
      console.log('[WebhookEvolution] Grupo ou vazio:', remoteJid);
      return;
    }

    // contactId = identificador unico da conversa (LID ou phone)
    // Usado para sessao do bot - cada contato tem um ID unico
    const contactId = remoteJid;

    // Tentar extrair telefone real
    let phoneFromJid = null;
    if (remoteJid.includes('@s.whatsapp.net')) {
      phoneFromJid = remoteJid.replace('@s.whatsapp.net', '');
    }

    const isLid = remoteJid.includes('@lid');
    if (isLid) {
      // Tentar pegar telefone real de remoteJidAlt (disponível em algumas versões)
      const altJid = key.remoteJidAlt || '';
      if (altJid.includes('@s.whatsapp.net')) {
        phoneFromJid = altJid.replace('@s.whatsapp.net', '');
        console.log('[WebhookEvolution] LID -> telefone via remoteJidAlt:', phoneFromJid);
      } else {
        // Fallback: buscar na API de mensagens pelo LID
        try {
          const contactData = await fetchPhoneByLid(instanceName, remoteJid);
          if (contactData) {
            phoneFromJid = contactData;
            console.log('[WebhookEvolution] LID -> telefone via API:', phoneFromJid);
          } else {
            console.log('[WebhookEvolution] LID detectado, telefone não disponível');
          }
        } catch (e) {
          console.log('[WebhookEvolution] LID erro ao buscar telefone:', e.message);
        }
      }
    }

    let message = '';
    if (data.message.conversation) {
      message = data.message.conversation;
    } else if (data.message.extendedTextMessage) {
      message = data.message.extendedTextMessage.text;
    } else if (data.message.imageMessage && data.message.imageMessage.caption) {
      message = data.message.imageMessage.caption;
    }
    if (!message) { console.log('[WebhookEvolution] Sem texto na msg. Tipo:', data.messageType || Object.keys(data.message)); return; }

    const pushName = data.pushName || '';
    console.log('[WebhookEvolution] ContactId:', contactId, '| Msg:', message, '| Instance:', instanceName, '| PushName:', pushName);

    // Buscar organizacao pela instancia
    const org = await db.Organization.findOne({
      where: db.sequelize.literal(`"settings"->>'whatsappInstanceName' = '${instanceName.replace(/'/g, "''")}'`)
    });
    if (!org) { console.log('[WebhookEvolution] Org nao encontrada para instancia:', instanceName); return; }
    if (!org.settings || !org.settings.whatsappBotEnabled) { console.log('[WebhookEvolution] Bot desativado'); return; }

    // Verificar se é comando de staff (aceitar/recusar agendamento)
    const staffResponse = await handleStaffCommand(message, phoneFromJid, contactId, org, instanceName);
    if (staffResponse) {
      await evolutionService.sendText(instanceName, remoteJid, staffResponse);
      console.log('[WebhookEvolution] Resposta staff enviada para', contactId);
      return;
    }

    // Processar com IA - passa contactId como identificador e phoneFromJid se disponivel
    const response = await processWithAI(contactId, phoneFromJid, message, org, instanceName, pushName);
    if (!response) return;

    // Enviar resposta para o remoteJid original (suporta LID e formato normal)
    await evolutionService.sendText(instanceName, remoteJid, response);
    console.log('[WebhookEvolution] Resposta enviada para', contactId);

  } catch (err) {
    console.error('[WebhookEvolution] Erro:', err.message);
  }
};

// ========================================
// PROCESSADOR COM GEMINI AI
// ========================================

// ========================================
// COMANDOS DO STAFF (aceitar/recusar agendamento via WhatsApp)
// ========================================
const handleStaffCommand = async (message, phoneFromJid, contactId, org, instanceName) => {
  const msg = message.trim().toLowerCase();

  // Formato com ID: "aceitar 5", "confirmar 5", "recusar 5"
  // Formato sem ID: "aceitar", "aceita", "aceito", "sim", "recusar", "recuso", "nao"
  const acceptWithId = msg.match(/^(?:aceitar|confirmar|aceito|aceita)\s+(\d+)$/);
  const rejectWithId = msg.match(/^(?:recusar|rejeitar|negar|recuso|recusa)\s+(\d+)$/);
  const acceptNoId = /^(?:aceitar|confirmar|aceito|aceita)$/.test(msg);
  const rejectNoId = /^(?:recusar|rejeitar|negar|recuso|recusa)$/.test(msg);

  if (!acceptWithId && !rejectWithId && !acceptNoId && !rejectNoId) return null;

  let apptId = null;
  let isAccept = false;

  if (acceptWithId) {
    apptId = parseInt(acceptWithId[1]);
    isAccept = true;
  } else if (rejectWithId) {
    apptId = parseInt(rejectWithId[1]);
    isAccept = false;
  } else {
    // Sem ID — buscar o agendamento pendente mais recente da org
    isAccept = acceptNoId;
  }

  // Buscar o agendamento pendente
  let appt;
  if (apptId) {
    appt = await db.Appointment.findOne({
      where: { id: apptId, organizationId: org.id, status: 'pendente' },
      include: [
        { model: db.Staff, attributes: ['id', 'name'] },
        { model: db.Client, attributes: ['id', 'name', 'phone'] },
        { model: db.AppointmentService, attributes: ['name'] }
      ]
    });
  } else {
    // Buscar o agendamento pendente mais recente
    appt = await db.Appointment.findOne({
      where: { organizationId: org.id, status: 'pendente' },
      order: [['createdAt', 'DESC']],
      include: [
        { model: db.Staff, attributes: ['id', 'name'] },
        { model: db.Client, attributes: ['id', 'name', 'phone'] },
        { model: db.AppointmentService, attributes: ['name'] }
      ]
    });
    if (appt) apptId = appt.id;
  }

  if (!appt) {
    return `❌ Agendamento #${apptId} não encontrado ou já foi processado.`;
  }

  const staff = appt.Staff;
  const d = dayjs(appt.date).tz(tz);
  const serviceNames = (appt.AppointmentServices || []).map(s => s.name).join(', ');
  const clientName = appt.Client ? appt.Client.name : 'Cliente';

  if (isAccept) {
    await appt.update({ status: 'confirmado', clientNotified: false });
    console.log('[Staff] Agendamento', apptId, 'confirmado por', staff.name);

    // Notificar cliente via WhatsApp
    await notifyClient(appt.clientId, org.id,
      `✅ *Agendamento Confirmado!*\n\n` +
      `Oi, ${clientName}! Seu agendamento foi confirmado:\n\n` +
      `📋 ${serviceNames}\n` +
      `👩 ${staff.name}\n` +
      `📅 ${d.format('DD/MM/YYYY')} às ${d.format('HH:mm')}\n\n` +
      `Te esperamos! 😊`
    );

    return `✅ Agendamento #${apptId} *confirmado*!\n\n` +
      `👤 ${clientName}\n📋 ${serviceNames}\n📅 ${d.format('DD/MM/YYYY')} às ${d.format('HH:mm')}\n\n` +
      `O cliente já foi notificado.`;
  } else {
    // Recusar - cancelar o agendamento
    await appt.update({ status: 'cancelado', cancellationReason: `Recusado por ${staff.name} via WhatsApp` });
    console.log('[Staff] Agendamento', apptId, 'recusado por', staff.name);

    // Notificar cliente via WhatsApp
    await notifyClient(appt.clientId, org.id,
      `😔 *Agendamento não confirmado*\n\n` +
      `Oi, ${clientName}. Infelizmente não foi possível confirmar seu agendamento:\n\n` +
      `📋 ${serviceNames}\n📅 ${d.format('DD/MM/YYYY')} às ${d.format('HH:mm')}\n\n` +
      `Que tal escolher outro horário? É só me mandar uma mensagem! 😊`
    );

    return `❌ Agendamento #${apptId} *recusado*.\n\n` +
      `👤 ${clientName}\n📋 ${serviceNames}\n📅 ${d.format('DD/MM/YYYY')} às ${d.format('HH:mm')}\n\n` +
      `O cliente foi notificado.`;
  }
};


// Normaliza telefone para formato padrao (com 55)
const normalizePhone = (phone) => {
  if (!phone) return null;
  let p = phone.replace(/\D/g, '');
  if (!p.startsWith('55') && p.length <= 11) p = '55' + p;
  return p;
};

// Busca cliente por telefone (tenta com e sem 55)
const findClientByPhone = async (phone, orgId) => {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  const withoutCountry = normalized.startsWith('55') ? normalized.substring(2) : normalized;

  return await db.Client.findOne({
    where: {
      organizationId: orgId,
      [Op.or]: [
        { phone: normalized },
        { phone: withoutCountry }
      ]
    }
  });
};

// Busca cliente pelo contactId (LID ou JID) salvo na sessao
const findClientBySession = async (session, orgId) => {
  if (session.data && session.data.clientId) {
    return await db.Client.findOne({
      where: { id: session.data.clientId, organizationId: orgId }
    });
  }
  return null;
};

// Fluxo de cadastro de novo cliente pelo WhatsApp
const handleRegistration = async (session, message, orgId, orgName, pushName) => {
  const step = session.data.registrationStep;
  const msg = message.trim();
  // Telefone capturado automaticamente (pode ser do JID ou null se LID)
  const autoPhone = session.data.autoPhone || null;

  if (step === 'ask_name') {
    if (msg.length < 2) {
      return 'Me diz seu nome completo, por favor 😊';
    }
    const client = await db.Client.create({
      name: msg,
      phone: autoPhone,
      organizationId: orgId
    });
    console.log('[Bot] Novo cliente cadastrado:', client.id, client.name, client.phone || 'sem telefone');
    session.data = { history: [], clientId: client.id };
    session.changed('data', true);
    await session.save();
    const firstName = msg.split(' ')[0];
    return `Prazer, ${firstName}! Tudo pronto por aqui ✅\n\nMe conta, o que você precisa hoje?`;
  }

  if (step === 'confirm_name') {
    const lower = msg.toLowerCase();
    if (lower === 'sim' || lower === 's') {
      const name = session.data.suggestedName;
      const client = await db.Client.create({
        name,
        phone: autoPhone,
        organizationId: orgId
      });
      console.log('[Bot] Novo cliente cadastrado:', client.id, client.name, client.phone || 'sem telefone');
      session.data = { history: [], clientId: client.id };
      session.changed('data', true);
      await session.save();
      const firstName = name.split(' ')[0];
      return `Prazer, ${firstName}! Tudo pronto por aqui ✅\n\nMe conta, o que você precisa hoje?`;
    }
    // Quer digitar outro nome
    session.data = { ...session.data, registrationStep: 'ask_name' };
    delete session.data.suggestedName;
    session.changed('data', true);
    await session.save();
    return 'Sem problemas! Me diz seu nome completo então 😊';
  }

  // Estado desconhecido - resetar
  session.data = { ...session.data, registrationStep: 'ask_name' };
  session.changed('data', true);
  await session.save();
  return 'Me diz seu nome completo, por favor 😊';
};

const processWithAI = async (contactId, phoneFromJid, message, org, instanceName, pushName) => {
  const orgId = org.id;

  console.log('[Bot] ContactId:', contactId, '| PhoneFromJid:', phoneFromJid || 'N/A');

  // Sessao por contactId (LID ou JID - unico por contato)
  const [session] = await db.BotSession.findOrCreate({
    where: { phone: contactId, organizationId: orgId },
    defaults: { state: 'active', data: { history: [] } }
  });

  // Reset se inativa por mais de 1 hora
  const diff = Date.now() - new Date(session.lastActivity).getTime();
  if (diff > 60 * 60 * 1000) {
    session.data = { history: [] };
  }
  session.lastActivity = new Date();

  // Buscar cliente: primeiro pela sessao (clientId salvo), depois por telefone do JID
  let client = await findClientBySession(session, orgId);
  if (!client && phoneFromJid) {
    client = await findClientByPhone(phoneFromJid, orgId);
    if (client) {
      session.data = { ...session.data, clientId: client.id };
    }
  }

  // Fluxo de cadastro para novos clientes
  if (!client) {
    // Salvar telefone capturado automaticamente do JID (se disponivel)
    if (phoneFromJid && !session.data.autoPhone) {
      session.data = { ...session.data, autoPhone: normalizePhone(phoneFromJid) };
      session.changed('data', true);
      await session.save();
    }

    if (session.data.registrationStep) {
      return await handleRegistration(session, message, orgId, org.name, pushName);
    }

    // Iniciar fluxo de cadastro
    const suggestedName = (pushName && pushName.length >= 2 && !/^[\p{Emoji}]+$/u.test(pushName)) ? pushName : null;
    if (suggestedName) {
      session.data = { ...session.data, registrationStep: 'confirm_name', suggestedName };
      session.changed('data', true);
      await session.save();
      return `Oi! Tudo bem? 😊 Sou a Lia, do *${org.name}*!\n\nSeu nome é *${suggestedName}*? Responde *sim* ou me diz seu nome completo.`;
    }

    session.data = { ...session.data, registrationStep: 'ask_name' };
    session.changed('data', true);
    await session.save();
    return `Oi! Tudo bem? 😊 Sou a Lia, do *${org.name}*!\n\nMe diz seu nome completo pra eu te cadastrar aqui.`;
  }

  // Cliente encontrado - limpar dados de registro se houver
  if (session.data.registrationStep) {
    delete session.data.registrationStep;
    delete session.data.suggestedName;
    delete session.data.clientName;
    delete session.data.clientPhone;
  }

  session.data = { ...session.data, clientId: client.id };

  // Historico da conversa (limitar para nao estourar contexto)
  let history = session.data.history || [];
  if (history.length > 20) {
    history = history.slice(-20);
  }

  // Validar historico: Gemini exige que comece com role 'user'
  // Remover entradas iniciais que nao sejam 'user' (ex: function call/response orfaos)
  while (history.length > 0 && history[0].role !== 'user') {
    history.shift();
  }
  // Se o historico ficou invalido (roles alternados incorretos), resetar
  if (history.length > 0) {
    const valid = history.every((h, i) => {
      if (i === 0) return h.role === 'user';
      return true; // Gemini aceita qualquer sequencia apos o primeiro 'user'
    });
    if (!valid) history = [];
  }

  // Funcao que executa as ferramentas do Gemini
  const executeTool = async (toolName, args) => {
    switch (toolName) {
      case 'listar_servicos':
        return await toolListarServicos(orgId);
      case 'listar_profissionais':
        return await toolListarProfissionais(orgId, args.serviceId);
      case 'ver_datas_disponiveis':
        return await toolVerDatas(args.staffId);
      case 'ver_horarios_disponiveis':
        return await toolVerHorarios(orgId, args.staffId, args.serviceId, args.date);
      case 'criar_agendamento':
        return await toolCriarAgendamento(orgId, client.id, args.serviceId, args.staffId, args.date, args.time);
      case 'meus_agendamentos':
        return await toolMeusAgendamentos(client.id, orgId);
      case 'cancelar_agendamento':
        return await toolCancelarAgendamento(args.appointmentId, orgId);
      default:
        return { error: 'Ferramenta desconhecida' };
    }
  };

  try {
    const result = await geminiService.chat(history, message, org, client.name, executeTool);

    // Salvar historico atualizado (limitar tamanho para caber no JSONB)
    let newHistory = result.history || [];
    // Manter apenas as ultimas mensagens para nao estourar
    if (newHistory.length > 30) {
      newHistory = newHistory.slice(-30);
    }
    // Simplificar historico para salvar no DB
    const simplifiedHistory = newHistory.map(h => ({
      role: h.role,
      parts: h.parts.map(p => {
        if (p.text) return { text: p.text };
        if (p.functionCall) return { functionCall: { name: p.functionCall.name, args: p.functionCall.args } };
        if (p.functionResponse) return { functionResponse: { name: p.functionResponse.name, response: p.functionResponse.response } };
        return p;
      })
    }));

    session.data = { ...session.data, history: simplifiedHistory };
    session.changed('data', true);
    await session.save();

    return result.text;

  } catch (err) {
    console.error('[Gemini] Erro:', err.message);
    return 'Desculpe, estou com dificuldades no momento. Tente novamente em alguns instantes. 😊';
  }
};

// ========================================
// FERRAMENTAS (Tools) para o Gemini
// ========================================

const toolListarServicos = async (orgId) => {
  const services = await db.Service.findAll({
    where: { organizationId: orgId, isActive: true },
    order: [['name', 'ASC']],
    attributes: ['id', 'name', 'price', 'duration', 'description']
  });

  return {
    servicos: services.map(s => ({
      id: s.id,
      nome: s.name,
      preco: parseFloat(s.price),
      duracao_minutos: s.duration,
      descricao: s.description || ''
    }))
  };
};

const toolListarProfissionais = async (orgId, serviceId) => {
  const staffList = await db.Staff.findAll({
    where: { organizationId: orgId, isActive: true },
    include: [{ model: db.Service, where: { id: serviceId }, attributes: [] }],
    attributes: ['id', 'name']
  });

  return {
    profissionais: staffList.map(s => ({ id: s.id, nome: s.name }))
  };
};

const toolVerDatas = async (staffId) => {
  const staff = await db.Staff.findByPk(staffId, { attributes: ['workingHours'] });
  if (!staff || !staff.workingHours) return { error: 'Profissional sem horarios configurados' };

  const today = dayjs().tz(tz);
  const dates = [];

  for (let i = 0; i < 14 && dates.length < 7; i++) {
    const d = today.add(i, 'day');
    const dayName = d.format('dddd').toLowerCase();
    const schedule = staff.workingHours[dayName];
    if (schedule && !schedule.isOff) {
      dates.push({
        data: d.format('YYYY-MM-DD'),
        dia_semana: d.format('dddd'),
        formatado: d.format('DD/MM/YYYY (dddd)')
      });
    }
  }

  return { datas_disponiveis: dates };
};

const toolVerHorarios = async (orgId, staffId, serviceId, date) => {
  const [service, staff] = await Promise.all([
    db.Service.findByPk(serviceId, { attributes: ['duration'] }),
    db.Staff.findByPk(staffId, { attributes: ['workingHours'] })
  ]);

  if (!service || !staff || !staff.workingHours) return { error: 'Dados nao encontrados' };

  const targetDay = dayjs.tz(date, 'YYYY-MM-DD', tz);
  const dayName = targetDay.format('dddd').toLowerCase();
  const workSchedule = staff.workingHours[dayName];

  if (!workSchedule || workSchedule.isOff) return { horarios: [], mensagem: 'Profissional nao atende neste dia' };

  const startOfDay = targetDay.startOf('day').toDate();
  const endOfDay = targetDay.endOf('day').toDate();

  const existing = await db.Appointment.findAll({
    where: {
      organizationId: orgId, staffId,
      status: { [Op.in]: ['pendente', 'confirmado'] },
      date: { [Op.between]: [startOfDay, endOfDay] }
    },
    attributes: ['date', 'duration']
  });

  const serviceDuration = service.duration || 60;
  const slots = [];
  const now = dayjs().tz(tz);

  const generateSlots = (startStr, endStr) => {
    if (!startStr || !endStr) return;
    const startTime = dayjs.tz(`${date}T${startStr}`, 'YYYY-MM-DDTHH:mm', tz);
    const endTime = dayjs.tz(`${date}T${endStr}`, 'YYYY-MM-DDTHH:mm', tz);
    let current = startTime;

    while (current.isBefore(endTime)) {
      const slotEnd = current.add(serviceDuration, 'minute');
      if (slotEnd.isAfter(endTime)) break;

      let isBooked = false;
      for (const appt of existing) {
        const apptStart = dayjs(appt.date).tz(tz);
        const apptEnd = apptStart.add(appt.duration, 'minute');
        if (current.isBefore(apptEnd) && slotEnd.isAfter(apptStart)) { isBooked = true; break; }
      }

      const isPast = targetDay.isSame(now, 'day') && current.isBefore(now);
      if (!isBooked && !isPast) slots.push(current.format('HH:mm'));

      current = current.add(30, 'minute');
    }
  };

  generateSlots(workSchedule.startTime1 || workSchedule.startTime, workSchedule.endTime1 || workSchedule.endTime);
  if (workSchedule.startTime2 && workSchedule.endTime2) {
    generateSlots(workSchedule.startTime2, workSchedule.endTime2);
  }

  return { horarios: [...new Set(slots)].sort(), data: date };
};

const toolCriarAgendamento = async (orgId, clientId, serviceId, staffId, date, time) => {
  const service = await db.Service.findByPk(serviceId);
  if (!service) return { error: 'Servico nao encontrado' };

  const start = dayjs.tz(`${date}T${time}`, 'YYYY-MM-DDTHH:mm', tz);
  if (!start.isValid()) return { error: 'Data ou horario invalido' };

  const serviceDuration = service.duration || 60;
  const end = start.add(serviceDuration, 'minute');

  // Verificar conflito
  const conflict = await db.Appointment.findOne({
    where: {
      organizationId: orgId, staffId,
      status: { [Op.in]: ['pendente', 'confirmado'] },
      date: { [Op.lt]: end.toDate() },
      [Op.and]: db.sequelize.literal(`"date" + ("duration" * interval '1 minute') > '${start.toISOString()}'`)
    }
  });

  if (conflict) return { error: 'Horario ja esta ocupado. Escolha outro horario.' };

  const newAppt = await db.sequelize.transaction(async (t) => {
    const appt = await db.Appointment.create({
      organizationId: orgId, clientId, staffId,
      date: start.toDate(),
      duration: serviceDuration,
      status: 'pendente',
      clientNotified: true
    }, { transaction: t });

    await db.AppointmentService.create({
      appointmentId: appt.id,
      serviceId: service.id,
      name: service.name,
      price: service.price
    }, { transaction: t });

    return appt;
  });

  const staff = await db.Staff.findByPk(staffId, { attributes: ['name', 'phone'] });
  const client = await db.Client.findByPk(clientId, { attributes: ['name'] });

  // Notificar profissional via WhatsApp sobre novo agendamento pendente
  try {
    if (staff && staff.phone) {
      const org = await db.Organization.findByPk(orgId);
      if (org) {
        const whatsappService = require('../services/whatsappService');
        if (whatsappService.isConfigured(org)) {
          const msg = `🔔 *Novo Agendamento #${newAppt.id}*\n\n` +
            `👤 ${client ? client.name : 'Cliente'}\n` +
            `📋 ${service.name}\n` +
            `📅 ${start.format('DD/MM/YYYY')} às ${start.format('HH:mm')}\n\n` +
            `Para confirmar, responda:\n` +
            `✅ *aceitar ${newAppt.id}*\n` +
            `❌ *recusar ${newAppt.id}*`;
          await whatsappService.sendMessage(staff.phone, msg, orgId);
          console.log('[Bot] Notificação enviada para profissional:', staff.name);
        }
      }
    }
  } catch (notifErr) {
    console.error('[Bot] Erro ao notificar profissional:', notifErr.message);
  }

  return {
    sucesso: true,
    agendamento: {
      id: newAppt.id,
      servico: service.name,
      profissional: staff ? staff.name : 'N/A',
      data: start.format('DD/MM/YYYY'),
      horario: start.format('HH:mm'),
      status: 'pendente',
      mensagem: 'Agendamento criado! Aguarde a confirmacao do profissional.'
    }
  };
};

const toolMeusAgendamentos = async (clientId, orgId) => {
  const now = dayjs().tz(tz);

  const appointments = await db.Appointment.findAll({
    where: {
      clientId, organizationId: orgId,
      status: { [Op.in]: ['pendente', 'confirmado'] },
      date: { [Op.gte]: now.subtract(1, 'hour').toDate() }
    },
    order: [['date', 'ASC']],
    include: [
      { model: db.Staff, attributes: ['name'] },
      { model: db.AppointmentService, attributes: ['name', 'price'] }
    ]
  });

  return {
    agendamentos: appointments.map(appt => {
      const d = dayjs(appt.date).tz(tz);
      return {
        id: appt.id,
        data: d.format('DD/MM/YYYY'),
        horario: d.format('HH:mm'),
        servicos: (appt.AppointmentServices || []).map(s => s.name).join(', '),
        profissional: appt.Staff ? appt.Staff.name : 'A definir',
        status: appt.status === 'confirmado' ? 'Confirmado' : 'Pendente'
      };
    })
  };
};

const toolCancelarAgendamento = async (appointmentId, orgId) => {
  const appt = await db.Appointment.findOne({
    where: { id: appointmentId, organizationId: orgId },
    include: [{ model: db.AppointmentService, attributes: ['name'] }]
  });

  if (!appt) return { error: 'Agendamento nao encontrado' };
  if (appt.status === 'cancelado_pelo_cliente') return { error: 'Agendamento ja esta cancelado' };

  appt.status = 'cancelado_pelo_cliente';
  appt.cancellationReason = 'Cancelado pelo WhatsApp';
  await appt.save();

  const d = dayjs(appt.date).tz(tz);
  return {
    sucesso: true,
    cancelado: {
      servicos: (appt.AppointmentServices || []).map(s => s.name).join(', '),
      data: d.format('DD/MM/YYYY'),
      horario: d.format('HH:mm')
    }
  };
};
