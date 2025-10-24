// controllers/dashboardController.js
const Client = require('../models/Client');
const Appointment = require('../models/Appointment');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const isoWeek = require('dayjs/plugin/isoWeek');
const isBetween = require('dayjs/plugin/isBetween');

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isoWeek);
dayjs.extend(isBetween);

/**
 * Pega o ID da organização logada a partir da sessão.
 * Esta é a chave de segurança para o multi-salão.
 */
const getOrgId = (req) => req.session.organizationId;

exports.getDashboard = async (req, res) => {
  try {
    const organizationId = getOrgId(req); // Pega o ID do salão logado

    const hojeStart = dayjs().tz('America/Sao_Paulo').startOf('day').toDate();
    const hojeEnd = dayjs().tz('America/Sao_Paulo').endOf('day').toDate();
    const amanhaStart = dayjs().tz('America/Sao_Paulo').add(1, 'day').startOf('day').toDate();
    const amanhaEnd = dayjs().tz('America/Sao_Paulo').add(1, 'day').endOf('day').toDate();

    // Busca agendamentos de HOJE APENAS desta organização
    const rawHoje = await Appointment.find({
      organizationId: organizationId, // <-- FILTRO DE SEGURANÇA
      date: { $gte: hojeStart, $lte: hojeEnd }
    }).populate('clientId').sort('date');

    const proximosHoje = [...new Map(
      rawHoje
        .filter(a => a.clientId && ((a.services || []).length || (a.products || []).length))
        .map(a => {
          const time = dayjs(a.date).tz('America/Sao_Paulo').format('HH:mm');
          return [`${a.clientId._id}|${time}`, {
            name: a.clientId.name,
            clientId: a.clientId._id.toString(),
            time,
            service: a.services[0]?.name || '—'
          }];
        })
    ).values()];

    // Busca agendamentos de AMANHÃ APENAS desta organização
    const rawAmanha = await Appointment.find({
      organizationId: organizationId, // <-- FILTRO DE SEGURANÇA
      date: { $gte: amanhaStart, $lte: amanhaEnd }
    }).populate('clientId').sort('date');

    const proximosAmanha = [...new Map(
      rawAmanha
        .filter(a => a.clientId && ((a.services || []).length || (a.products || []).length))
        .map(a => {
          const time = dayjs(a.date).tz('America/Sao_Paulo').format('HH:mm');
          return [`${a.clientId._id}|${time}`, {
            name: a.clientId.name,
            clientId: a.clientId._id.toString(),
            time,
            service: a.services[0]?.name || '—'
          }];
        })
    ).values()];

    let receitaHoje = 0, receitaSemana = 0, receitaMes = 0;
    const ref = dayjs().tz('America/Sao_Paulo');

    // Busca TODOS os agendamentos APENAS desta organização
    const todos = await Appointment.find({ organizationId: organizationId });
    todos.forEach(a => {
      [...(a.services || []), ...(a.products || [])].forEach(item => {
        (item.payments || []).forEach(p => {
          const pago = dayjs(p.paidAt).tz('America/Sao_Paulo');
          if (pago.isSame(ref, 'day')) receitaHoje += p.amount;
          if (pago.isSame(ref, 'week')) receitaSemana += p.amount;
          if (pago.isSame(ref, 'month')) receitaMes += p.amount;
        });
      });
    });

    // Busca TODOS os clientes APENAS desta organização
    const clients = await Client.find({ organizationId: organizationId });
    clients.forEach(c => {
      (c.products || []).forEach(prod => {
        (prod.payments || []).forEach(p => {
          const pago = dayjs(p.paidAt).tz('America/Sao_Paulo');
          if (pago.isSame(ref, 'day')) receitaHoje += p.amount;
          if (pago.isSame(ref, 'week')) receitaSemana += p.amount;
          if (pago.isSame(ref, 'month')) receitaMes += p.amount;
        });
      });
    });

    res.render('dashboard', {
      proximosHoje,
      proximosAmanha,
      receitaHoje,
      receitaSemana,
      receitaMes,
      error: null // Envia null quando não há erro
    });
  } catch (err) {
    console.error("Erro ao carregar dashboard:", err);
    res.render('dashboard', {
      proximosHoje: [],
      proximosAmanha: [],
      receitaHoje: 0,
      receitaSemana: 0,
      receitaMes: 0,
      error: 'Erro ao carregar o dashboard. Tente novamente.'
    });
  }
};