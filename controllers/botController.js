const db = require('../models');
const { Op } = require('sequelize');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const customParseFormat = require('dayjs/plugin/customParseFormat');

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

const tz = 'America/Sao_Paulo';

const BOT_API_KEY = process.env.BOT_API_KEY || 'agendapro-bot-secret';

// Middleware de autenticacao da API do bot
const authenticateBot = (req, res, next) => {
  const key = req.headers['x-api-key'];
  if (key !== BOT_API_KEY) {
    return res.status(401).json({ error: 'API key invalida' });
  }
  next();
};

// Busca organizacao pela instancia do WhatsApp
const findOrgByInstance = async (instanceName) => {
  if (!instanceName) return null;
  const orgs = await db.Organization.findAll();
  return orgs.find(o => o.settings && o.settings.whatsappInstanceName === instanceName);
};

// Formata telefone: remove tudo que nao e digito
const cleanPhone = (phone) => {
  let p = phone.replace(/\D/g, '');
  if (p.startsWith('55') && p.length > 11) p = p.substring(2);
  return p;
};

// Busca ou cria sessao
const getSession = async (phone, orgId) => {
  const [session] = await db.BotSession.findOrCreate({
    where: { phone, organizationId: orgId },
    defaults: { state: 'menu', data: {} }
  });
  // Reset se inativo por mais de 30min
  const diff = Date.now() - new Date(session.lastActivity).getTime();
  if (diff > 30 * 60 * 1000 && session.state !== 'menu' && session.state !== 'awaiting_name') {
    session.state = 'menu';
    session.data = {};
  }
  session.lastActivity = new Date();
  return session;
};

// ========================================
// PROCESSADOR PRINCIPAL DE MENSAGENS
// ========================================
exports.processMessage = [authenticateBot, async (req, res) => {
  try {
    const { phone, message } = req.body;
    if (!phone || !message) {
      return res.status(400).json({ error: 'phone e message sao obrigatorios' });
    }

    const cleanedPhone = cleanPhone(phone);
    const instanceName = req.body.instanceName || null;
    let orgId = req.body.orgId || null;

    // Busca org pela instancia (modo SaaS)
    if (!orgId && instanceName) {
      const org = await findOrgByInstance(instanceName);
      if (!org) {
        return res.status(404).json({ error: 'Organizacao nao encontrada para esta instancia' });
      }
      // Verificar se o bot esta ativo
      if (!org.settings || !org.settings.whatsappBotEnabled) {
        return res.json({ response: null, skip: true });
      }
      orgId = org.id;
    }

    if (!orgId) {
      orgId = parseInt(process.env.BOT_DEFAULT_ORG_ID) || 1;
    }

    const text = message.trim().toLowerCase();

    const session = await getSession(cleanedPhone, orgId);

    // Comando global de voltar ao menu
    if (text === '0' || text === 'menu' || text === 'voltar' || text === 'sair') {
      session.state = 'menu';
      session.data = {};
      await session.save();
      const response = await buildMenu(cleanedPhone, orgId);
      return res.json({ response });
    }

    let response;

    switch (session.state) {
      case 'menu':
        response = await handleMenu(text, session, cleanedPhone, orgId);
        break;
      case 'awaiting_name':
        response = await handleAwaitingName(text, session, cleanedPhone, orgId);
        break;
      case 'select_service':
        response = await handleSelectService(text, session, orgId);
        break;
      case 'select_staff':
        response = await handleSelectStaff(text, session, orgId);
        break;
      case 'select_date':
        response = await handleSelectDate(text, session, orgId);
        break;
      case 'select_time':
        response = await handleSelectTime(text, session, orgId);
        break;
      case 'confirm_appointment':
        response = await handleConfirmAppointment(text, session, orgId);
        break;
      case 'select_cancel':
        response = await handleSelectCancel(text, session, orgId);
        break;
      default:
        session.state = 'menu';
        session.data = {};
        await session.save();
        response = await buildMenu(cleanedPhone, orgId);
    }

    await session.save();
    return res.json({ response });

  } catch (err) {
    console.error('[Bot] Erro:', err);
    return res.status(500).json({ error: 'Erro interno do bot' });
  }
}];

// ========================================
// MENU PRINCIPAL
// ========================================
const buildMenu = async (phone, orgId) => {
  const org = await db.Organization.findByPk(orgId);
  const orgName = org ? org.name : 'nosso salao';

  const client = await db.Client.findOne({
    where: { phone: { [Op.or]: [phone, `55${phone}`, phone.replace(/^55/, '')] }, organizationId: orgId }
  });

  if (!client) {
    return `Ola! Bem-vindo(a) ao *${orgName}*! 👋\n\nNao encontrei seu cadastro. Qual e o seu *nome completo*?`;
  }

  return `Ola, *${client.name}*! 😊\nBem-vindo(a) ao *${orgName}*!\n\nComo posso te ajudar?\n\n*1* - 📅 Agendar horario\n*2* - 📋 Meus agendamentos\n*3* - ❌ Cancelar agendamento\n\n_Digite o numero da opcao desejada_\n_Digite *0* a qualquer momento para voltar ao menu_`;
};

const handleMenu = async (text, session, phone, orgId) => {
  const client = await db.Client.findOne({
    where: { phone: { [Op.or]: [phone, `55${phone}`, phone.replace(/^55/, '')] }, organizationId: orgId }
  });

  if (!client) {
    session.state = 'awaiting_name';
    return `Ola! Bem-vindo(a)! 👋\n\nNao encontrei seu cadastro. Qual e o seu *nome completo*?`;
  }

  session.data = { ...session.data, clientId: client.id };

  switch (text) {
    case '1':
      return await startScheduling(session, orgId);
    case '2':
      return await listAppointments(client, orgId);
    case '3':
      return await startCancellation(session, client, orgId);
    default:
      return `Opcao invalida. Digite *1*, *2* ou *3*.\n\n*1* - 📅 Agendar horario\n*2* - 📋 Meus agendamentos\n*3* - ❌ Cancelar agendamento`;
  }
};

// ========================================
// CADASTRO
// ========================================
const handleAwaitingName = async (text, session, phone, orgId) => {
  const name = text.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  if (name.length < 3) {
    return 'Por favor, digite seu nome completo (minimo 3 caracteres).';
  }

  const client = await db.Client.create({
    name,
    phone,
    organizationId: orgId
  });

  session.state = 'menu';
  session.data = { clientId: client.id };
  await session.save();

  const org = await db.Organization.findByPk(orgId);
  const orgName = org ? org.name : 'nosso salao';

  return `Pronto, *${name}*! Cadastro realizado com sucesso! ✅\n\nBem-vindo(a) ao *${orgName}*!\n\nComo posso te ajudar?\n\n*1* - 📅 Agendar horario\n*2* - 📋 Meus agendamentos\n*3* - ❌ Cancelar agendamento\n\n_Digite o numero da opcao desejada_`;
};

// ========================================
// AGENDAR - Passo 1: Selecionar Servico
// ========================================
const startScheduling = async (session, orgId) => {
  const services = await db.Service.findAll({
    where: { organizationId: orgId, isActive: true },
    order: [['name', 'ASC']]
  });

  if (services.length === 0) {
    session.state = 'menu';
    return 'Desculpe, nao ha servicos disponiveis no momento. Digite *0* para voltar ao menu.';
  }

  session.state = 'select_service';
  session.data = { ...session.data, services: services.map(s => ({ id: s.id, name: s.name, price: parseFloat(s.price), duration: s.duration })) };

  let msg = `📋 *Nossos servicos:*\n\n`;
  services.forEach((s, i) => {
    msg += `*${i + 1}* - ${s.name} (R$ ${parseFloat(s.price).toFixed(2)} - ${s.duration}min)\n`;
  });
  msg += `\n_Digite o numero do servico desejado_`;
  return msg;
};

const handleSelectService = async (text, session, orgId) => {
  const idx = parseInt(text) - 1;
  const services = session.data.services || [];

  if (isNaN(idx) || idx < 0 || idx >= services.length) {
    return `Opcao invalida. Digite um numero de *1* a *${services.length}*.`;
  }

  const selected = services[idx];
  session.data = { ...session.data, serviceId: selected.id, serviceName: selected.name, duration: selected.duration };

  // Buscar profissionais que fazem esse servico
  const staffList = await db.Staff.findAll({
    where: { organizationId: orgId, isActive: true },
    include: [{
      model: db.Service,
      where: { id: selected.id },
      attributes: []
    }],
    attributes: ['id', 'name']
  });

  if (staffList.length === 0) {
    session.state = 'menu';
    session.data = {};
    return 'Desculpe, nao ha profissionais disponiveis para este servico. Digite *0* para voltar ao menu.';
  }

  session.state = 'select_staff';
  session.data = { ...session.data, staffList: staffList.map(s => ({ id: s.id, name: s.name })) };

  let msg = `👤 *Profissionais para ${selected.name}:*\n\n`;
  staffList.forEach((s, i) => {
    msg += `*${i + 1}* - ${s.name}\n`;
  });
  msg += `\n_Digite o numero do profissional_`;
  return msg;
};

// ========================================
// AGENDAR - Passo 2: Selecionar Profissional
// ========================================
const handleSelectStaff = async (text, session, orgId) => {
  const idx = parseInt(text) - 1;
  const staffList = session.data.staffList || [];

  if (isNaN(idx) || idx < 0 || idx >= staffList.length) {
    return `Opcao invalida. Digite um numero de *1* a *${staffList.length}*.`;
  }

  const selected = staffList[idx];
  session.data = { ...session.data, staffId: selected.id, staffName: selected.name };

  return await showAvailableDates(session, orgId);
};

// ========================================
// AGENDAR - Passo 3: Selecionar Data
// ========================================
const showAvailableDates = async (session, orgId) => {
  const staff = await db.Staff.findByPk(session.data.staffId, { attributes: ['workingHours'] });
  if (!staff || !staff.workingHours) {
    session.state = 'menu';
    session.data = {};
    return 'Profissional sem horarios configurados. Digite *0* para voltar ao menu.';
  }

  const today = dayjs().tz(tz);
  const dates = [];

  // Proximos 14 dias
  for (let i = 0; i < 14 && dates.length < 7; i++) {
    const d = today.add(i, 'day');
    const dayName = d.format('dddd').toLowerCase();
    const schedule = staff.workingHours[dayName];
    if (schedule && !schedule.isOff) {
      dates.push({
        date: d.format('YYYY-MM-DD'),
        display: d.format('DD/MM (dddd)')
      });
    }
  }

  if (dates.length === 0) {
    session.state = 'menu';
    session.data = {};
    return 'Nao ha datas disponiveis nos proximos dias. Digite *0* para voltar ao menu.';
  }

  session.state = 'select_date';
  session.data = { ...session.data, dates };

  let msg = `📅 *Datas disponiveis:*\n\n`;
  dates.forEach((d, i) => {
    msg += `*${i + 1}* - ${d.display}\n`;
  });
  msg += `\n_Digite o numero da data desejada_`;
  return msg;
};

const handleSelectDate = async (text, session, orgId) => {
  const idx = parseInt(text) - 1;
  const dates = session.data.dates || [];

  if (isNaN(idx) || idx < 0 || idx >= dates.length) {
    return `Opcao invalida. Digite um numero de *1* a *${dates.length}*.`;
  }

  const selected = dates[idx];
  session.data = { ...session.data, selectedDate: selected.date, dateDisplay: selected.display };

  return await showAvailableTimes(session, orgId);
};

// ========================================
// AGENDAR - Passo 4: Selecionar Horario
// ========================================
const showAvailableTimes = async (session, orgId) => {
  const { staffId, selectedDate, duration } = session.data;

  const [service, staff] = await Promise.all([
    db.Service.findByPk(session.data.serviceId, { attributes: ['duration'] }),
    db.Staff.findByPk(staffId, { attributes: ['workingHours'] })
  ]);

  if (!service || !staff || !staff.workingHours) {
    session.state = 'menu';
    return 'Erro ao buscar horarios. Digite *0* para voltar ao menu.';
  }

  const targetDay = dayjs.tz(selectedDate, 'YYYY-MM-DD', tz);
  const dayName = targetDay.format('dddd').toLowerCase();
  const workSchedule = staff.workingHours[dayName];

  if (!workSchedule || workSchedule.isOff) {
    session.state = 'menu';
    return 'Profissional nao atende neste dia. Digite *0* para voltar ao menu.';
  }

  // Buscar agendamentos existentes
  const startOfDay = targetDay.startOf('day').toDate();
  const endOfDay = targetDay.endOf('day').toDate();

  const existing = await db.Appointment.findAll({
    where: {
      organizationId: orgId,
      staffId,
      status: { [Op.in]: ['pendente', 'confirmado'] },
      date: { [Op.between]: [startOfDay, endOfDay] }
    },
    attributes: ['date', 'duration']
  });

  const serviceDuration = service.duration || 60;
  const slotInterval = 30;
  const slots = [];
  const now = dayjs().tz(tz);

  const generateSlots = (startStr, endStr) => {
    if (!startStr || !endStr) return;
    const startTime = dayjs.tz(`${selectedDate}T${startStr}`, 'YYYY-MM-DDTHH:mm', tz);
    const endTime = dayjs.tz(`${selectedDate}T${endStr}`, 'YYYY-MM-DDTHH:mm', tz);
    let current = startTime;

    while (current.isBefore(endTime)) {
      const slotEnd = current.add(serviceDuration, 'minute');
      if (slotEnd.isAfter(endTime)) break;

      let isBooked = false;
      for (const appt of existing) {
        const apptStart = dayjs(appt.date).tz(tz);
        const apptEnd = apptStart.add(appt.duration, 'minute');
        if (current.isBefore(apptEnd) && slotEnd.isAfter(apptStart)) {
          isBooked = true;
          break;
        }
      }

      const isPast = targetDay.isSame(now, 'day') && current.isBefore(now);

      if (!isBooked && !isPast) {
        slots.push(current.format('HH:mm'));
      }

      current = current.add(slotInterval, 'minute');
    }
  };

  generateSlots(workSchedule.startTime1 || workSchedule.startTime, workSchedule.endTime1 || workSchedule.endTime);
  if (workSchedule.startTime2 && workSchedule.endTime2) {
    generateSlots(workSchedule.startTime2, workSchedule.endTime2);
  }

  const uniqueSlots = [...new Set(slots)].sort();

  if (uniqueSlots.length === 0) {
    return `Nao ha horarios disponiveis em ${session.data.dateDisplay}.\n\nDigite outro numero de data ou *0* para voltar ao menu.`;
  }

  session.state = 'select_time';
  session.data = { ...session.data, times: uniqueSlots };

  let msg = `⏰ *Horarios disponiveis em ${session.data.dateDisplay}:*\n\n`;
  uniqueSlots.forEach((t, i) => {
    msg += `*${i + 1}* - ${t}\n`;
  });
  msg += `\n_Digite o numero do horario desejado_`;
  return msg;
};

const handleSelectTime = async (text, session, orgId) => {
  const idx = parseInt(text) - 1;
  const times = session.data.times || [];

  if (isNaN(idx) || idx < 0 || idx >= times.length) {
    return `Opcao invalida. Digite um numero de *1* a *${times.length}*.`;
  }

  const selectedTime = times[idx];
  session.data = { ...session.data, selectedTime };

  session.state = 'confirm_appointment';

  return `📋 *Resumo do agendamento:*\n\n` +
    `📌 Servico: *${session.data.serviceName}*\n` +
    `👤 Profissional: *${session.data.staffName}*\n` +
    `📅 Data: *${session.data.dateDisplay}*\n` +
    `⏰ Horario: *${selectedTime}*\n\n` +
    `Confirma o agendamento?\n*1* - ✅ Sim, confirmar\n*2* - ❌ Nao, cancelar\n`;
};

// ========================================
// AGENDAR - Passo 5: Confirmar
// ========================================
const handleConfirmAppointment = async (text, session, orgId) => {
  if (text === '2' || text === 'nao' || text === 'n') {
    session.state = 'menu';
    session.data = {};
    return 'Agendamento cancelado. Digite *0* para voltar ao menu.';
  }

  if (text !== '1' && text !== 'sim' && text !== 's') {
    return 'Digite *1* para confirmar ou *2* para cancelar.';
  }

  const { clientId, serviceId, serviceName, staffId, selectedDate, selectedTime, duration } = session.data;

  const service = await db.Service.findByPk(serviceId);
  if (!service) {
    session.state = 'menu';
    session.data = {};
    return 'Servico nao encontrado. Digite *0* para voltar ao menu.';
  }

  const start = dayjs.tz(`${selectedDate}T${selectedTime}`, 'YYYY-MM-DDTHH:mm', tz);

  // Verificar conflito
  const serviceDuration = service.duration || 60;
  const end = start.add(serviceDuration, 'minute');

  const conflict = await db.Appointment.findOne({
    where: {
      organizationId: orgId,
      staffId,
      status: { [Op.in]: ['pendente', 'confirmado'] },
      date: { [Op.lt]: end.toDate() },
      [Op.and]: db.sequelize.literal(`"date" + ("duration" * interval '1 minute') > '${start.toISOString()}'`)
    }
  });

  if (conflict) {
    session.state = 'menu';
    session.data = {};
    return 'Ops! Esse horario acabou de ser ocupado. 😔\nDigite *1* para tentar agendar novamente.';
  }

  // Criar agendamento
  await db.sequelize.transaction(async (t) => {
    const newAppt = await db.Appointment.create({
      organizationId: orgId,
      clientId,
      staffId,
      date: start.toDate(),
      duration: serviceDuration,
      status: 'pendente',
      clientNotified: true
    }, { transaction: t });

    await db.AppointmentService.create({
      appointmentId: newAppt.id,
      serviceId: service.id,
      name: service.name,
      price: service.price
    }, { transaction: t });
  });

  session.state = 'menu';
  session.data = { clientId };

  return `✅ *Agendamento realizado com sucesso!*\n\n` +
    `📌 ${serviceName}\n` +
    `👤 ${session.data.staffName || 'Profissional'}\n` +
    `📅 ${session.data.dateDisplay}\n` +
    `⏰ ${selectedTime}\n\n` +
    `Aguarde a confirmacao do salao.\n\n_Digite *0* para voltar ao menu_`;
};

// ========================================
// MEUS AGENDAMENTOS
// ========================================
const listAppointments = async (client, orgId) => {
  const now = dayjs().tz(tz);

  const appointments = await db.Appointment.findAll({
    where: {
      clientId: client.id,
      organizationId: orgId,
      status: { [Op.in]: ['pendente', 'confirmado'] },
      date: { [Op.gte]: now.subtract(1, 'hour').toDate() }
    },
    order: [['date', 'ASC']],
    include: [
      { model: db.Staff, attributes: ['name'] },
      { model: db.AppointmentService, attributes: ['name', 'price'] }
    ]
  });

  if (appointments.length === 0) {
    return `Voce nao tem agendamentos proximos. 📭\n\n_Digite *0* para voltar ao menu_`;
  }

  let msg = `📋 *Seus proximos agendamentos:*\n\n`;
  appointments.forEach((appt, i) => {
    const d = dayjs(appt.date).tz(tz);
    const services = (appt.AppointmentServices || []).map(s => s.name).join(', ');
    const staffName = appt.Staff ? appt.Staff.name : 'A definir';
    const statusEmoji = appt.status === 'confirmado' ? '✅' : '⏳';

    msg += `*${i + 1}.* ${statusEmoji} ${d.format('DD/MM/YYYY')} as ${d.format('HH:mm')}\n`;
    msg += `   📌 ${services}\n`;
    msg += `   👤 ${staffName}\n\n`;
  });

  msg += `_Digite *0* para voltar ao menu_`;
  return msg;
};

// ========================================
// CANCELAR AGENDAMENTO
// ========================================
const startCancellation = async (session, client, orgId) => {
  const now = dayjs().tz(tz);

  const appointments = await db.Appointment.findAll({
    where: {
      clientId: client.id,
      organizationId: orgId,
      status: { [Op.in]: ['pendente', 'confirmado'] },
      date: { [Op.gte]: now.toDate() }
    },
    order: [['date', 'ASC']],
    include: [
      { model: db.Staff, attributes: ['name'] },
      { model: db.AppointmentService, attributes: ['name'] }
    ]
  });

  if (appointments.length === 0) {
    return `Voce nao tem agendamentos para cancelar. 📭\n\n_Digite *0* para voltar ao menu_`;
  }

  session.state = 'select_cancel';
  session.data = { ...session.data, cancelList: appointments.map(a => ({ id: a.id })) };

  let msg = `❌ *Qual agendamento deseja cancelar?*\n\n`;
  appointments.forEach((appt, i) => {
    const d = dayjs(appt.date).tz(tz);
    const services = (appt.AppointmentServices || []).map(s => s.name).join(', ');
    const staffName = appt.Staff ? appt.Staff.name : 'A definir';

    msg += `*${i + 1}* - ${d.format('DD/MM/YYYY')} as ${d.format('HH:mm')} | ${services} | ${staffName}\n`;
  });
  msg += `\n_Digite o numero do agendamento para cancelar_`;
  return msg;
};

const handleSelectCancel = async (text, session, orgId) => {
  const idx = parseInt(text) - 1;
  const cancelList = session.data.cancelList || [];

  if (isNaN(idx) || idx < 0 || idx >= cancelList.length) {
    return `Opcao invalida. Digite um numero de *1* a *${cancelList.length}*.`;
  }

  const apptId = cancelList[idx].id;

  const appt = await db.Appointment.findOne({
    where: { id: apptId, organizationId: orgId },
    include: [{ model: db.AppointmentService, attributes: ['name'] }]
  });

  if (!appt) {
    session.state = 'menu';
    session.data = {};
    return 'Agendamento nao encontrado. Digite *0* para voltar ao menu.';
  }

  appt.status = 'cancelado_pelo_cliente';
  appt.cancellationReason = 'Cancelado pelo WhatsApp';
  await appt.save();

  session.state = 'menu';
  session.data = { clientId: session.data.clientId };

  const d = dayjs(appt.date).tz(tz);
  const services = (appt.AppointmentServices || []).map(s => s.name).join(', ');

  return `✅ Agendamento cancelado com sucesso!\n\n` +
    `📌 ${services}\n` +
    `📅 ${d.format('DD/MM/YYYY')} as ${d.format('HH:mm')}\n\n` +
    `_Digite *0* para voltar ao menu_`;
};

module.exports = exports;
