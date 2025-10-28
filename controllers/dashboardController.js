// controllers/dashboardController.js
const Client = require('../models/Client');
const Appointment = require('../models/Appointment');
const Organization = require('../models/Organization');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const isoWeek = require('dayjs/plugin/isoWeek');
const isBetween = require('dayjs/plugin/isBetween');

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isoWeek);
dayjs.extend(isBetween);

const getOrgId = (req) => req.session.organizationId;

exports.getDashboard = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const ref = dayjs().tz('America/Sao_Paulo');

    const hojeStart = ref.startOf('day').toDate();
    const hojeEnd = ref.endOf('day').toDate();
    const amanhaStart = ref.add(1, 'day').startOf('day').toDate();
    const amanhaEnd = ref.add(1, 'day').endOf('day').toDate();

    const [
      organization,
      rawHoje,
      rawAmanha,
      todosAgendamentos,
      todosClientes,
      // Busca de agendamentos pendentes
      pendingAppointments
    ] = await Promise.all([
      // 1. Busca a organização
      Organization.findById(organizationId).lean(),

      // 2. Busca agendamentos de HOJE
      Appointment.find({
        organizationId: organizationId,
        date: { $gte: hojeStart, $lte: hojeEnd }
      }).populate('clientId').sort('date'),

      // 3. Busca agendamentos de AMANHÃ
      Appointment.find({
        organizationId: organizationId,
        date: { $gte: amanhaStart, $lte: amanhaEnd }
      }).populate('clientId').sort('date'),

      // 4. Busca TODOS os agendamentos (para receita)
      Appointment.find({ organizationId: organizationId }),

      // 5. Busca TODOS os clientes (para receita)
      Client.find({ organizationId: organizationId }),

      // 6. Busca todos os pendentes para o alerta
      Appointment.find({
        organizationId: organizationId,
        status: 'pendente' // A chave da sua solicitação
      })
      .populate('clientId', 'name')  // Pega o nome do cliente
      .populate('staffId', 'name')   // Pega o nome do profissional
      .sort({ date: 1 })             // Mostra os mais antigos primeiro
      .lean() // .lean() para performance
    ]);

    if (!organization) {
      console.warn(`Organização ${organizationId} não encontrada na busca. Deslogando...`);
      req.session.destroy();
      return res.redirect('/login');
    }

    // Processa agendamentos de HOJE
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

    // Processa agendamentos de AMANHÃ
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

    // Calcula Receitas
    let receitaHoje = 0, receitaSemana = 0, receitaMes = 0;
    todosAgendamentos.forEach(a => {
      [...(a.services || []), ...(a.products || [])].forEach(item => {
        (item.payments || []).forEach(p => {
          const pago = dayjs(p.paidAt).tz('America/Sao_Paulo');
          if (pago.isSame(ref, 'day')) receitaHoje += p.amount;
          if (pago.isSame(ref, 'week')) receitaSemana += p.amount;
          if (pago.isSame(ref, 'month')) receitaMes += p.amount;
        });
      });
    });
    todosClientes.forEach(c => {
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
      org: organization,
      proximosHoje,
      proximosAmanha,
      receitaHoje,
      receitaSemana,
      receitaMes,
      pendingAppointments: pendingAppointments, // Envia os pendentes para o EJS
      error: null
    });

  } catch (err) {
    console.error("Erro ao carregar dashboard:", err);
    res.render('dashboard', {
      org: null,
      proximosHoje: [],
      proximosAmanha: [],
      receitaHoje: 0,
      receitaSemana: 0,
      receitaMes: 0,
      pendingAppointments: [], // Envia array vazio em caso de erro
      error: 'Erro ao carregar o dashboard. Tente novamente.'
    });
  }
};