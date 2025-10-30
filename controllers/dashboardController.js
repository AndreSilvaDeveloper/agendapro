// controllers/dashboardController.js

// --- REMOVIDO ---
// const Client = require('../models/Client');
// const Appointment = require('../models/Appointment');
// const Organization = require('../models/Organization');

// --- ADICIONADO ---
const db = require('../models');
const { Op } = require('sequelize'); // Importa os Operadores

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
      pendingAppointments
    ] = await Promise.all([
      // 1. Busca a organização (ATUALIZADO)
      db.Organization.findByPk(organizationId, { raw: true }), // raw: true equivale ao lean()

      // 2. Busca agendamentos de HOJE (ATUALIZADO)
      db.Appointment.findAll({
        where: {
          organizationId: organizationId,
          date: { [Op.between]: [hojeStart, hojeEnd] } // $gte/$lte -> Op.between
        },
        // ATUALIZADO: populate('clientId') -> include
        include: [
          { model: db.Client, attributes: ['id', 'name'] },
          { model: db.AppointmentService, attributes: ['name'] }, // P/ "service: ..."
          { model: db.AppointmentProduct, attributes: ['name'] } // P/ "service: ..."
        ],
        order: [['date', 'ASC']] // sort('date') -> order
      }),

      // 3. Busca agendamentos de AMANHÃ (ATUALIZADO)
      db.Appointment.findAll({
        where: {
          organizationId: organizationId,
          date: { [Op.between]: [amanhaStart, amanhaEnd] }
        },
        include: [
          { model: db.Client, attributes: ['id', 'name'] },
          { model: db.AppointmentService, attributes: ['name'] },
          { model: db.AppointmentProduct, attributes: ['name'] }
        ],
        order: [['date', 'ASC']]
      }),

      // 4. Busca TODOS os agendamentos (para receita) (ATUALIZADO)
      db.Appointment.findAll({ 
        where: { organizationId: organizationId },
        // Inclui os serviços/produtos E seus respectivos pagamentos
        include: [
          { 
            model: db.AppointmentService, 
            include: [db.AppointmentPayment] // Aninhado
          },
          { 
            model: db.AppointmentProduct, 
            include: [db.AppointmentPayment] // Aninhado
          }
        ]
      }),

      // 5. Busca TODOS os clientes (para receita) (ATUALIZADO)
      db.Client.findAll({ 
        where: { organizationId: organizationId },
        // Inclui os produtos de varejo E seus respectivos pagamentos
        include: [
          { 
            model: db.Product, 
            include: [db.Payment] // Aninhado
          }
        ]
      }),

      // 6. Busca todos os pendentes para o alerta (ATUALIZADO)
      db.Appointment.findAll({
        where: {
          organizationId: organizationId,
          status: 'pendente'
        },
        // ATUALIZADO: populate('clientId', 'name') / populate('staffId', 'name')
        include: [
          { model: db.Client, attributes: ['id', 'name'] },
          { model: db.Staff, attributes: ['id', 'name'] }
        ],
        order: [['date', 'ASC']]
        // Não usamos raw: true aqui, passamos as instâncias do Sequelize
      })
    ]);

    if (!organization) {
      console.warn(`Organização ${organizationId} não encontrada na busca. Deslogando...`);
      req.session.destroy();
      return res.redirect('/login');
    }

    // Processa agendamentos de HOJE (ATUALIZADO)
    const proximosHoje = [...new Map(
      rawHoje
        // ATUALIZADO: a.clientId -> a.Client
        // ATUALIZADO: a.services -> a.AppointmentServices
        // ATUALIZADO: a.products -> a.AppointmentProducts
        .filter(a => a.Client && ((a.AppointmentServices || []).length || (a.AppointmentProducts || []).length))
        .map(a => {
          const time = dayjs(a.date).tz('America/Sao_Paulo').format('HH:mm');
          // ATUALIZADO: a.clientId._id -> a.Client.id
          // ATUALIZADO: a.clientId.name -> a.Client.name
          // ATUALIZADO: a.services[0]?.name -> a.AppointmentServices[0]?.name
          const serviceName = (a.AppointmentServices && a.AppointmentServices[0]?.name) || 
                              (a.AppointmentProducts && a.AppointmentProducts[0]?.name) || 
                              '—';
          return [`${a.Client.id}|${time}`, {
            name: a.Client.name,
            clientId: a.Client.id.toString(),
            time,
            service: serviceName
          }];
        })
    ).values()];

    // Processa agendamentos de AMANHÃ (ATUALIZADO - lógica idêntica)
    const proximosAmanha = [...new Map(
      rawAmanha
        .filter(a => a.Client && ((a.AppointmentServices || []).length || (a.AppointmentProducts || []).length))
        .map(a => {
          const time = dayjs(a.date).tz('America/Sao_Paulo').format('HH:mm');
          const serviceName = (a.AppointmentServices && a.AppointmentServices[0]?.name) || 
                              (a.AppointmentProducts && a.AppointmentProducts[0]?.name) || 
                              '—';
          return [`${a.Client.id}|${time}`, {
            name: a.Client.name,
            clientId: a.Client.id.toString(),
            time,
            service: serviceName
          }];
        })
    ).values()];

    // Calcula Receitas (ATUALIZADO)
    let receitaHoje = 0, receitaSemana = 0, receitaMes = 0;
    
    // Itera sobre agendamentos
    todosAgendamentos.forEach(a => {
      // ATUALIZADO: a.services -> a.AppointmentServices, a.products -> a.AppointmentProducts
      const items = [
        ...(a.AppointmentServices || []), 
        ...(a.AppointmentProducts || [])
      ];
      items.forEach(item => {
        // ATUALIZADO: item.payments -> item.AppointmentPayments
        (item.AppointmentPayments || []).forEach(p => {
          const pago = dayjs(p.paidAt).tz('America/Sao_Paulo');
          if (pago.isSame(ref, 'day')) receitaHoje += parseFloat(p.amount);
          if (pago.isSame(ref, 'week')) receitaSemana += parseFloat(p.amount);
          if (pago.isSame(ref, 'month')) receitaMes += parseFloat(p.amount);
        });
      });
    });

    // Itera sobre clientes (para vendas de varejo)
    todosClientes.forEach(c => {
      // ATUALIZADO: c.products -> c.Products
      (c.Products || []).forEach(prod => {
        // ATUALIZADO: prod.payments -> prod.Payments
        (prod.Payments || []).forEach(p => {
          const pago = dayjs(p.paidAt).tz('America/Sao_Paulo');
          if (pago.isSame(ref, 'day')) receitaHoje += parseFloat(p.amount);
          if (pago.isSame(ref, 'week')) receitaSemana += parseFloat(p.amount);
          if (pago.isSame(ref, 'month')) receitaMes += parseFloat(p.amount);
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
      pendingAppointments: pendingAppointments, // Passa as instâncias direto
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
      pendingAppointments: [],
      error: 'Erro ao carregar o dashboard. Tente novamente.'
    });
  }
};