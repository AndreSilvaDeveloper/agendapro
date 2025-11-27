// controllers/dashboardController.js

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
      // 1. Busca a organização
      db.Organization.findByPk(organizationId, { raw: true }),

      // 2. Busca agendamentos de HOJE
      db.Appointment.findAll({
        where: {
          organizationId: organizationId,
          date: { [Op.between]: [hojeStart, hojeEnd] }
        },
        include: [
          { model: db.Client, attributes: ['id', 'name', 'phone'] }, // Adicionado phone por garantia
          { model: db.AppointmentService, attributes: ['name'] },
          { model: db.AppointmentProduct, attributes: ['name'] }
        ],
        order: [['date', 'ASC']]
      }),

      // 3. Busca agendamentos de AMANHÃ
      db.Appointment.findAll({
        where: {
          organizationId: organizationId,
          date: { [Op.between]: [amanhaStart, amanhaEnd] }
        },
        include: [
          { model: db.Client, attributes: ['id', 'name', 'phone'] },
          { model: db.AppointmentService, attributes: ['name'] },
          { model: db.AppointmentProduct, attributes: ['name'] }
        ],
        order: [['date', 'ASC']]
      }),

      // 4. Busca TODOS os agendamentos (para receita)
      db.Appointment.findAll({ 
        where: { organizationId: organizationId },
        include: [
          { 
            model: db.AppointmentService, 
            include: [db.AppointmentPayment]
          },
          { 
            model: db.AppointmentProduct, 
            include: [db.AppointmentPayment]
          }
        ]
      }),

      // 5. Busca TODOS os clientes (para receita)
      db.Client.findAll({ 
        where: { organizationId: organizationId },
        include: [
          { 
            model: db.Product, 
            include: [db.Payment]
          }
        ]
      }),

      // 6. Busca todos os pendentes para o alerta (AQUI ESTAVA O ERRO)
      db.Appointment.findAll({
        where: {
          organizationId: organizationId,
          status: 'pendente'
        },
        include: [
          // CORREÇÃO: Adicionado 'phone' aqui!
          { model: db.Client, attributes: ['id', 'name', 'phone'] }, 
          { model: db.Staff, attributes: ['id', 'name'] },
          { model: db.AppointmentService, attributes: ['name'] },
          { model: db.AppointmentProduct, attributes: ['name'] }
        ],
        order: [['date', 'ASC']]
      })
    ]);

    if (!organization) {
      console.warn(`Organização ${organizationId} não encontrada na busca. Deslogando...`);
      req.session.destroy();
      return res.redirect('/login');
    }

    // Processa agendamentos de HOJE
    const proximosHoje = [...new Map(
      rawHoje
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

    // Processa agendamentos de AMANHÃ
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

    // Calcula Receitas
    let receitaHoje = 0, receitaSemana = 0, receitaMes = 0;
    
    todosAgendamentos.forEach(a => {
      const items = [
        ...(a.AppointmentServices || []), 
        ...(a.AppointmentProducts || [])
      ];
      items.forEach(item => {
        (item.AppointmentPayments || []).forEach(p => {
          const pago = dayjs(p.paidAt).tz('America/Sao_Paulo');
          if (pago.isSame(ref, 'day')) receitaHoje += parseFloat(p.amount);
          if (pago.isSame(ref, 'week')) receitaSemana += parseFloat(p.amount);
          if (pago.isSame(ref, 'month')) receitaMes += parseFloat(p.amount);
        });
      });
    });

    todosClientes.forEach(c => {
      (c.Products || []).forEach(prod => {
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
      pendingAppointments: pendingAppointments,
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