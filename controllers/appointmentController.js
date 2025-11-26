// controllers/appointmentController.js

const db = require('../models');
const { Op } = require('sequelize');

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

// Função helper (sem alteração - não acessa DB)
function gerarHorariosDisponiveis(inicio = '07:00', fim = '20:00') {
  const slots = [];
  const [hInicio, mInicio] = inicio.split(':').map(Number);
  const [hFim, mFim] = fim.split(':').map(Number);
  const start = dayjs().hour(hInicio).minute(mInicio).second(0);
  const end = dayjs().hour(hFim).minute(mFim).second(0);
  let atual = start.clone();
  while (atual.isBefore(end)) {
    slots.push(atual.format('HH:mm'));
    atual = atual.add(30, 'minute');
  }
  return slots;
}

// --- Criar Agendamento (CORRIGIDO PARA MOBILE) ---
exports.createAppointment = async (req, res) => {
  const organizationId = getOrgId(req);
  const { clientId, date, time, services, products, force, staffId } = req.body;

  let transaction;
  try {
    // 1. Validação básica de cliente
    if (!clientId || String(clientId).trim() === '') {
      return res.redirect('/agendamentos-por-dia?error=Cliente não selecionado');
    }

    // 2. Garante que o cliente existe nessa organização
    const client = await db.Client.findOne({
      where: { id: clientId, organizationId: organizationId }
    });
    if (!client) {
      return res.redirect('/agendamentos-por-dia?error=Cliente não encontrado.');
    }

    // 3. Parse de serviços / produtos
    const parsedServices = services ? JSON.parse(services) : [];
    const parsedProducts = products ? JSON.parse(products) : [];

    // 4. Montagem segura do START
    const startDayjs = dayjs.tz(`${date}T${time}`, 'America/Sao_Paulo');
    if (!startDayjs.isValid()) {
      console.error('[createAppointment] Data/hora inválidas recebidas:', { date, time, body: req.body });
      return res.redirect(
        `/agendamentos-por-dia?error=${encodeURIComponent('Data ou hora do agendamento inválida.')}`
      );
    }
    const start = startDayjs.toDate();

    // 5. Normalização da duração
    const rawDuration =
      req.body.duration ??
      req.body.totalDuration ??
      req.body.duracao ??
      null;

    let dur = parseInt(rawDuration, 10);

    if (Number.isNaN(dur) || dur <= 0) {
      console.warn('[createAppointment] Duração inválida, caindo para 30 minutos.', { rawDuration });
      dur = 30; 
    }

    const endDayjs = startDayjs.add(dur, 'minute');
    if (!endDayjs.isValid()) {
      return res.redirect(
        `/agendamentos-por-dia?error=${encodeURIComponent('Erro ao calcular horário final do agendamento.')}`
      );
    }
    const end = endDayjs.toDate();

    // 6. Verificação de conflito
    const conflict = await db.Appointment.findOne({
      where: {
        organizationId: organizationId,
        staffId: staffId,
        date: { [Op.lt]: end }, // appt.start < new.end
        [Op.and]: db.sequelize.literal(
          `"date" + ("duration" * interval '1 minute') > ${db.sequelize.escape(start)}`
        ) // appt.end > new.start
      }
    });

    // --- AQUI ESTÁ A CORREÇÃO PARA O MOBILE ---
    // Em vez de enviar um script com confirm(), enviamos uma página HTML completa
    if (conflict && !force) {
      const data = { clientId, date, time, duration: dur, services, products, force: true, staffId };
      
      // Gera inputs hidden para reenvio seguro dos dados
      const hiddenInputs = Object.keys(data).map(key => {
        const val = typeof data[key] === 'object' ? JSON.stringify(data[key]) : data[key];
        // Escapa aspas duplas para não quebrar o HTML
        const safeVal = String(val).replace(/"/g, '&quot;');
        return `<input type="hidden" name="${key}" value="${safeVal}">`;
      }).join('');

      return res.send(`
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Conflito de Horário</title>
          <script src="https://cdn.tailwindcss.com"></script>
          <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
        </head>
        <body class="bg-gray-100 flex items-center justify-center min-h-screen p-4">
          <div class="bg-white rounded-2xl shadow-xl max-w-sm w-full overflow-hidden">
            <div class="bg-yellow-500 p-6 text-center">
              <div class="mx-auto w-16 h-16 bg-white rounded-full flex items-center justify-center mb-3 shadow-sm">
                 <i class="fas fa-exclamation-triangle text-3xl text-yellow-600"></i>
              </div>
              <h2 class="text-white text-xl font-bold">Conflito de Horário!</h2>
            </div>
            
            <div class="p-6 text-center">
              <p class="text-gray-600 mb-6">
                Este profissional já possui um agendamento que coincide com este horário.
              </p>
              
              <form method="POST" action="/appointment" class="flex flex-col gap-3">
                ${hiddenInputs}
                
                <button type="submit" class="w-full bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-3 px-4 rounded-xl transition-colors flex items-center justify-center shadow-md">
                  <i class="fas fa-check-circle mr-2"></i> Agendar Mesmo Assim
                </button>
                
                <button type="button" onclick="history.back()" class="w-full bg-gray-200 hover:bg-gray-300 text-gray-700 font-semibold py-3 px-4 rounded-xl transition-colors">
                  Cancelar
                </button>
              </form>
            </div>
          </div>
        </body>
        </html>
      `);
    }
    // ------------------------------------------

    // 7. Criação do agendamento + subitens em transação
    await db.sequelize.transaction(async (t) => {
      const newAppt = await db.Appointment.create(
        {
          organizationId: organizationId,
          clientId,
          staffId,
          date: start,
          duration: dur,
          status: 'confirmado'
        },
        { transaction: t }
      );

      if (parsedServices && parsedServices.length > 0) {
        const apptServices = parsedServices.map((s) => ({
          name: s.name,
          price: s.price,
          serviceId: s.serviceId || null,
          appointmentId: newAppt.id
        }));
        await db.AppointmentService.bulkCreate(apptServices, { transaction: t });
      }

      if (parsedProducts && parsedProducts.length > 0) {
        const apptProducts = parsedProducts.map((p) => ({
          name: p.name,
          price: p.price,
          appointmentId: newAppt.id
        }));
        await db.AppointmentProduct.bulkCreate(apptProducts, { transaction: t });
      }
    });

    const hourFormatted = dayjs(start).tz('America/Sao_Paulo').format('HH:mm');
    res.redirect(`/agendamentos-por-dia?success=${hourFormatted}`);
  } catch (err) {
    console.error('Erro ao criar agendamento:', err);
    res.redirect(
      `/agendamentos-por-dia?error=${encodeURIComponent('Erro ao salvar agendamento.')}`
    );
  }
};


// --- Remover Serviço / Produto (ATUALIZADO) ---
exports.removeServiceFromAppointment = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const { id, idx } = req.params; 

    // 1. Busca o agendamento para checar posse e pegar clientId
    const a = await db.Appointment.findOne({ 
      where: { id: id, organizationId: organizationId },
      attributes: ['clientId'] // Só precisamos do clientId
    });
    if (!a) {
      return res.redirect('/clients?error=Agendamento não encontrado');
    }

    // 2. Destrói o serviço do agendamento
    const affectedRows = await db.AppointmentService.destroy({
      where: {
        id: idx,
        appointmentId: id
      }
    });

    if (affectedRows === 0) {
      return res.redirect(`/client/${a.clientId}?error=${encodeURIComponent('Serviço não encontrado.')}`);
    }

    res.redirect(`/client/${a.clientId}?success=${encodeURIComponent('Serviço removido.')}`);
  } catch (err) {
    console.error("Erro ao remover serviço:", err);
    res.redirect(`/clients?error=${encodeURIComponent('Erro ao remover serviço.')}`);
  }
};


// --- Cancelar Agendamento (ATUALIZADO) ---
exports.cancelAppointment = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const { id } = req.params;
    const { cancellationReason } = req.body;

    const appt = await db.Appointment.findOne({ 
      where: { id: id, organizationId: organizationId } 
    });

    if (!appt) {
      return res.redirect(`/clients?error=${encodeURIComponent('Agendamento não encontrado.')}`);
    }
    
    if (!cancellationReason || cancellationReason.trim() === '') {
        return res.redirect(`/client/${appt.clientId}?error=${encodeURIComponent('O motivo do cancelamento é obrigatório.')}`);
    }

    await appt.update({
      status: 'cancelado_pelo_salao',
      cancellationReason: cancellationReason,
      clientNotified: false
    });

    res.redirect(`/client/${appt.clientId}?success=${encodeURIComponent('Agendamento cancelado com sucesso.')}`);
  } catch (err) {
    console.error('Erro no cancelamento:', err);
    res.redirect(`/clients?error=${encodeURIComponent('Erro ao cancelar agendamento.')}`);
  }
};


// --- Pagamentos com Método (ATUALIZADO) ---
exports.payAppointmentService = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const { id, idx } = req.params;
    const { amount, method, description, paidAt } = req.body;

    const a = await db.Appointment.findOne({ 
      where: { id: id, organizationId: organizationId },
      attributes: ['clientId']
    });
    if (!a) {
      return res.redirect('/clients?error=Agendamento não encontrado');
    }

    const item = await db.AppointmentService.findOne({
      where: { id: idx, appointmentId: id }
    });
    if (!item) {
        return res.redirect(`/client/${a.clientId}?error=${encodeURIComponent('Serviço não encontrado no agendamento.')}`);
    }

    const val = parseFloat(amount);
    const methodLower = method.toLowerCase();
    if (isNaN(val) || val <= 0)
      return res.redirect(`/client/${a.clientId}?error=${encodeURIComponent('Valor de pagamento inválido.')}`);
    if (!['pix', 'dinheiro', 'cartao'].includes(methodLower))
      return res.redirect(`/client/${a.clientId}?error=${encodeURIComponent('Método de pagamento inválido.')}`);
    const when = paidAt
      ? dayjs.tz(paidAt, dayjs.ISO_8601, 'America/Sao_Paulo').toDate()
      : new Date();

    await db.AppointmentPayment.create({
      amount: val,
      paidAt: when,
      description: description || '',
      method: methodLower,
      appointmentServiceId: idx
    });

    res.redirect(`/client/${a.clientId}?success=${encodeURIComponent('Pagamento registrado.')}`);
  } catch (err) {
    console.error("Erro ao pagar serviço:", err);
    res.redirect(`/clients?error=${encodeURIComponent('Erro ao processar pagamento.')}`);
  }
};

// --- Remover Pagamento (ATUALIZADO) ---
exports.removeAppointmentPayment = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const { id, sIdx, pIdx } = req.params;

    const a = await db.Appointment.findOne({ 
      where: { id: id, organizationId: organizationId },
      attributes: ['clientId']
    });
    if (!a) {
      return res.redirect('/clients?error=Agendamento não encontrado');
    }

    const affectedRows = await db.AppointmentPayment.destroy({
      where: {
        id: pIdx,
        appointmentServiceId: sIdx
      }
    });

    if (affectedRows === 0) {
      return res.redirect(`/client/${a.clientId}?error=${encodeURIComponent('Pagamento não encontrado para remoção.')}`);
    }
    
    res.redirect(`/client/${a.clientId}?success=${encodeURIComponent('Pagamento removido.')}`);
  } catch (err) {
    console.error("Erro ao remover pagamento:", err);
    res.redirect(`/clients?error=${encodeURIComponent('Erro ao remover pagamento.')}`);
  }
};

// --- Agenda por Dia (ATUALIZADO) ---
exports.getAgendaPorDia = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const { date, success, error } = req.query;

    const services = []; // Buscaremos do DB
    const days = [];
    const targetDate = date ? dayjs.tz(date, 'YYYY-MM-DD', 'America/Sao_Paulo') : dayjs().tz('America/Sao_Paulo');
    let currentDay = targetDate.startOf('isoWeek').add(1, 'day'); // Terça
    if (currentDay.day() === 0) currentDay = currentDay.add(2, 'day');
    else if (currentDay.day() === 1) currentDay = currentDay.add(1, 'day');
    for (let i = 0; i < 5; i++) { days.push(currentDay.add(i, 'day')); }
    const resultsByDay = {};
    const availableByDay = {};
    days.forEach(d => {
      const key = d.format('YYYY-MM-DD');
      resultsByDay[key] = [];
      availableByDay[key] = gerarHorariosDisponiveis();
    });
    const weekStart = days[0].startOf('day').toDate();
    const weekEnd = days[days.length - 1].endOf('day').toDate();

    const [appts, clients, dbServices, staff, pendingAppointments] = await Promise.all([
      db.Appointment.findAll({
        where: {
          organizationId: organizationId,
          date: { [Op.between]: [weekStart, weekEnd] },
          status: { [Op.ne]: 'cancelado_pelo_salao' }
        },
        order: [['date', 'ASC']],
        include: [
          { model: db.Client, attributes: ['id', 'name'] },
          { model: db.Staff, attributes: ['id', 'name'] },
          { model: db.AppointmentService, attributes: ['name'] }
        ]
      }),
      db.Client.findAll({ 
        where: { organizationId: organizationId }, 
        attributes: ['id', 'name'], 
        order: [['name', 'ASC']] 
      }),
      db.Service.findAll({
        where: { organizationId: organizationId, isActive: true },
        attributes: ['id', 'name', 'price', 'duration']
      }),
      db.Staff.findAll({
        where: { organizationId: organizationId, isActive: true },
        attributes: ['id', 'name']
      }),

      db.Appointment.findAll({
        where: {
          organizationId: organizationId,
          status: 'pendente'
        },
        include: [
          { model: db.Client, attributes: ['id', 'name'] },
          { model: db.Staff, attributes: ['id', 'name'] }, 
          { model: db.AppointmentService, attributes: ['name'] },
          { model: db.AppointmentProduct, attributes: ['name'] }
        ],
        order: [['date', 'ASC']]
      })
    ]);
    
    appts.forEach(a => {
      if (!a.Client) {
        return;
      }

      const d = dayjs(a.date).tz('America/Sao_Paulo');
      const key = d.format('YYYY-MM-DD');
      const time = d.format('HH:mm');
      if (!(key in resultsByDay)) return;

      resultsByDay[key].push({
        id: a.id, 
        clientId: a.Client.id, 
        clientName: a.Client.name, 
        staffName: a.Staff ? a.Staff.name : 'N/D', 
        timeFormatted: time,
        servicesNames: (a.AppointmentServices || []).map(s => s.name).join(', '),
        status: a.status,
        staffId: a.staffId,
        date: d.format('YYYY-MM-DD')
      });

      const blocos = Math.ceil((a.duration || 0) / 30);
      for (let i = 0; i < blocos; i++) {
        const slot = d.add(i * 30, 'minute').format('HH:mm');
        if (availableByDay[key]) {
           availableByDay[key] = availableByDay[key].filter(s => s !== slot);
        }
      }
    });

    res.render('agenda-dia', {
      date: targetDate.format('YYYY-MM-DD'),
      days,
      resultsByDay,
      availableByDay,
      clients,
      services: dbServices,
      staff: staff, 
      pendingAppointments: pendingAppointments,
      success,
      error
    });
  } catch (err) {
    console.error("Erro ao buscar agenda:", err);
    res.render('agenda-dia', {
      days: [], resultsByDay: {}, availableByDay: {}, clients: [], services: [], staff: [],
      pendingAppointments: [],
      error: 'Erro ao carregar a agenda.',
      success: null, date: dayjs().tz('America/Sao_Paulo').format('YYYY-MM-DD')
    });
  }
};

// --- Editar Serviço / Data/Hora (ATUALIZADO) ---
exports.editAppointmentService = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const { id, idx } = req.params;
    const { name, price } = req.body;

    const a = await db.Appointment.findOne({ 
      where: { id: id, organizationId: organizationId },
      attributes: ['clientId']
    });
    if (!a) {
        return res.redirect('/clients?error=Agendamento não encontrado');
    }

    const [affectedRows] = await db.AppointmentService.update(
      { name, price: parseFloat(price) },
      { where: { id: idx, appointmentId: id } }
    );

    if (affectedRows === 0) {
      return res.redirect(`/client/${a.clientId}?error=${encodeURIComponent('Serviço não encontrado para editar.')}`);
    }
    
    res.redirect(`/client/${a.clientId}?success=${encodeURIComponent('Serviço atualizado.')}`);
  } catch (err) {
    console.error("Erro ao editar serviço:", err);
    res.redirect(`/clients?error=${encodeURIComponent('Erro ao editar serviço.')}`);
  }
};

exports.editAppointmentDateTime = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const { id } = req.params;
    const { date, time } = req.body;

    const a = await db.Appointment.findOne({ 
      where: { id: id, organizationId: organizationId }
    });
    if (!a) {
      return res.redirect('/clients?error=Agendamento não encontrado');
    }

    const newDate = dayjs.tz(`${date}T${time}`, 'America/Sao_Paulo').toDate();
    
    await a.update({ date: newDate });

    res.redirect(`/client/${a.clientId}?success=${encodeURIComponent('Data/Hora atualizada.')}`);
  } catch (err)
 {
    console.error("Erro ao editar data/hora:", err);
    res.redirect(`/client/${a.clientId}?error=${encodeURIComponent('Erro ao editar data/hora.')}`);
  }
};

// --- Confirmação e Cancelamento pelo Admin (ATUALIZADO) ---
exports.confirmAppointment = async (req, res) => {
    try {
        const organizationId = getOrgId(req);
        const { id } = req.params;

        const appt = await db.Appointment.findOne({
            where: {
                id: id,
                organizationId: organizationId,
                status: 'pendente'
            }
        });

        if (!appt) {
            return res.redirect(`/agendamentos-por-dia?error=${encodeURIComponent('Agendamento não encontrado ou já processado.')}`);
        }
        
        await appt.update({ 
            status: 'confirmado',
            clientNotified: false
        });

        const appointmentDate = dayjs(appt.date).format('YYYY-MM-DD');
        res.redirect(`/agendamentos-por-dia?date=${appointmentDate}&success=${encodeURIComponent('Agendamento confirmado!')}`);

    } catch (err) {
        console.error("Erro ao confirmar agendamento:", err);
        res.redirect(`/agendamentos-por-dia?error=${encodeURIComponent('Erro ao confirmar o agendamento.')}`);
    }
};

exports.cancelAppointmentByAdmin = async (req, res) => {
    try {
        const organizationId = getOrgId(req);
        const { id } = req.params;
        const { cancellationReason } = req.body;

        const appt = await db.Appointment.findOne({ 
          where: { id: id, organizationId: organizationId }
        });

        if (!appt) {
             return res.redirect(`/agendamentos-por-dia?error=${encodeURIComponent('Agendamento não encontrado.')}`);
        }
        
        const appointmentDate = dayjs(appt.date).format('YYYY-MM-DD');

        if (!cancellationReason || cancellationReason.trim() === '') {
            return res.redirect(`/agendamentos-por-dia?date=${appointmentDate}&error=${encodeURIComponent('O motivo do cancelamento é obrigatório.')}`);
        }

        await appt.update({
            status: 'cancelado_pelo_salao',
            cancellationReason: cancellationReason,
            clientNotified: false
        });

        res.redirect(`/agendamentos-por-dia?date=${appointmentDate}&success=${encodeURIComponent('Agendamento cancelado.')}`);

    } catch (err) {
        console.error("Erro ao cancelar agendamento pelo admin:", err);
        res.redirect(`/agendamentos-por-dia?error=${encodeURIComponent('Erro ao cancelar o agendamento.')}`);
    }
};