// controllers/appointmentController.js
// --- REMOVIDO ---
// const Appointment = require('../models/Appointment');
// const Client = require('../models/Client');

// --- ADICIONADO ---
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
  // ... (código original sem alteração) ...
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

// --- Criar Agendamento (TOTALMENTE REESCRITO) ---
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
    // *** Aqui garantimos que date/time são válidos ***
    const startDayjs = dayjs.tz(`${date}T${time}`, 'America/Sao_Paulo');
    if (!startDayjs.isValid()) {
      console.error('[createAppointment] Data/hora inválidas recebidas:', { date, time, body: req.body });
      return res.redirect(
        `/agendamentos-por-dia?error=${encodeURIComponent('Data ou hora do agendamento inválida.')}`
      );
    }
    const start = startDayjs.toDate();

    // 5. Normalização da duração (pensando nos "outros fronts")
    // *** aceita vários nomes e protege contra NaN ***
    const rawDuration =
      req.body.duration ??
      req.body.totalDuration ??   // caso algum front mande assim
      req.body.duracao ??         // outro nome possível
      null;

    let dur = parseInt(rawDuration, 10);

    if (Number.isNaN(dur) || dur <= 0) {
      // Aqui você escolhe a política:
      //  - ou dá erro amigável
      //  - ou cai num padrão (ex: 30min) para manter compatibilidade
      console.warn('[createAppointment] Duração inválida, caindo para 30 minutos.', {
        rawDuration,
        body: {
          clientId,
          date,
          time,
          staffId
        }
      });
      dur = 30; // *** se preferir obrigar, troque por um redirect com erro ***
      // return res.redirect(`/agendamentos-por-dia?error=${encodeURIComponent('Duração inválida.')}`);
    }

    const endDayjs = startDayjs.add(dur, 'minute');
    if (!endDayjs.isValid()) {
      console.error('[createAppointment] endDayjs inválido mesmo após normalizar duração.', {
        start: start,
        dur
      });
      return res.redirect(
        `/agendamentos-por-dia?error=${encodeURIComponent('Erro ao calcular horário final do agendamento.')}`
      );
    }
    const end = endDayjs.toDate();

    // 6. Verificação de conflito (sem mais 'Invalid date')
    // Lógica: (appt.start < new.end) AND (appt.end > new.start)
    // appt.end = date + duration * 1min
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

    if (conflict && !force) {
      const data = { clientId, date, time, duration: dur, services, products, force: true, staffId };
      return res.send(`
<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Confirmar</title></head><body>
<script>
if (confirm("⚠️ Conflito de horário para este profissional. Agendar mesmo assim?")) {
  const f = document.createElement('form'); f.method='POST'; f.action='/appointment';
  const data = ${JSON.stringify(data)};
  for (const k in data) {
    const i=document.createElement('input'); i.type='hidden'; i.name=k;
    i.value=typeof data[k]==='string'?data[k]:JSON.stringify(data[k]);
    f.appendChild(i);
  }
  document.body.appendChild(f);
  f.submit();
} else history.back();
</script></body></html>`);
    }

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
    // ATENÇÃO: 'id' é o ID do Agendamento, 'idx' DEVE SER o ID do AppointmentService
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
    // ATUALIZADO: a.services.splice -> db.AppointmentService.destroy
    // A cláusula 'where' garante que só deletamos o item (idx)
    // se ele pertencer ao agendamento (id)
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

    // 1. Busca o agendamento primeiro
    const appt = await db.Appointment.findOne({ 
      where: { id: id, organizationId: organizationId } 
    });

    if (!appt) {
      return res.redirect(`/clients?error=${encodeURIComponent('Agendamento não encontrado.')}`);
    }
    
    // Validação da razão
    if (!cancellationReason || cancellationReason.trim() === '') {
        return res.redirect(`/client/${appt.clientId}?error=${encodeURIComponent('O motivo do cancelamento é obrigatório.')}`);
    }

    // 2. Atualiza a instância
    // ATUALIZADO: findOneAndUpdate -> instance.update()
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
    // ATENÇÃO: 'id' é o ID do Agendamento, 'idx' DEVE SER o ID do AppointmentService
    const { id, idx } = req.params;
    const { amount, method, description, paidAt } = req.body;

    // 1. Busca o agendamento para checar posse e pegar clientId
    const a = await db.Appointment.findOne({ 
      where: { id: id, organizationId: organizationId },
      attributes: ['clientId']
    });
    if (!a) {
      return res.redirect('/clients?error=Agendamento não encontrado');
    }

    // 2. Verifica se o Serviço do Agendamento existe
    const item = await db.AppointmentService.findOne({
      where: { id: idx, appointmentId: id }
    });
    if (!item) {
        return res.redirect(`/client/${a.clientId}?error=${encodeURIComponent('Serviço não encontrado no agendamento.')}`);
    }

    // Validações (sem alteração)
    const val = parseFloat(amount);
    const methodLower = method.toLowerCase();
    if (isNaN(val) || val <= 0)
      return res.redirect(`/client/${a.clientId}?error=${encodeURIComponent('Valor de pagamento inválido.')}`);
    if (!['pix', 'dinheiro', 'cartao'].includes(methodLower))
      return res.redirect(`/client/${a.clientId}?error=${encodeURIComponent('Método de pagamento inválido.')}`);
    const when = paidAt
      ? dayjs.tz(paidAt, dayjs.ISO_8601, 'America/Sao_Paulo').toDate()
      : new Date();

    // 3. Cria o Pagamento do Agendamento
    // ATUALIZADO: item.payments.push -> db.AppointmentPayment.create
    await db.AppointmentPayment.create({
      amount: val,
      paidAt: when,
      description: description || '',
      method: methodLower,
      appointmentServiceId: idx // Linka o pagamento ao serviço do agendamento
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
    // ATENÇÃO: 'id'=Appt, 'sIdx'=ApptService, 'pIdx'=ApptPayment
    const { id, sIdx, pIdx } = req.params;

    // 1. Busca o agendamento para checar posse e pegar clientId
    const a = await db.Appointment.findOne({ 
      where: { id: id, organizationId: organizationId },
      attributes: ['clientId']
    });
    if (!a) {
      return res.redirect('/clients?error=Agendamento não encontrado');
    }

    // 2. Destrói o Pagamento
    // ATUALIZADO: a.services[...].payments.splice -> db.AppointmentPayment.destroy
    // A cláusula 'where' garante que só deletamos o pagamento (pIdx)
    // se ele pertencer ao serviço (sIdx)
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

    // ... (lógica de 'services', 'days', 'targetDate' sem alteração) ...
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
    // Fim da lógica inalterada

    // ATUALIZADO: Busca de dados com 'include'
    // --- MUDANÇA 1: Adicionado 'pendingAppointments' à desestruturação ---
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

      // --- MUDANÇA 2: Adicionada a query para o alerta de pendentes ---
      db.Appointment.findAll({
        where: {
          organizationId: organizationId,
          status: 'pendente'
        },
        include: [
          { model: db.Client, attributes: ['id', 'name'] },
          { model: db.Staff, attributes: ['id', 'name'] }, // <-- A CHAVE DO PROBLEMA
          { model: db.AppointmentService, attributes: ['name'] },
          { model: db.AppointmentProduct, attributes: ['name'] }
        ],
        order: [['date', 'ASC']]
      })
      // --- FIM DA MUDANÇA 2 ---
    ]);
    
    // Processamento dos agendamentos (ATUALIZADO)
    appts.forEach(a => {
      // ATUALIZADO: a.clientId -> a.Client
      if (!a.Client) {
        console.warn(`Agendamento ${a.id} (Org: ${organizationId}) sem cliente associado.`);
        return;
      }

      const d = dayjs(a.date).tz('America/Sao_Paulo');
      const key = d.format('YYYY-MM-DD');
      const time = d.format('HH:mm');
      if (!(key in resultsByDay)) return;

      resultsByDay[key].push({
        id: a.id, // ATUALIZADO: _id -> id
        clientId: a.Client.id, // ATUALIZADO
        clientName: a.Client.name, // ATUALIZADO
        staffName: a.Staff ? a.Staff.name : 'N/D', // ATUALIZADO
        timeFormatted: time,
        // ATUALIZADO: a.services -> a.AppointmentServices
        servicesNames: (a.AppointmentServices || []).map(s => s.name).join(', '),
        status: a.status,
        // (Campos adicionados para o modal de edição)
        staffId: a.staffId,
        date: d.format('YYYY-MM-DD')
      });

      // Lógica de remoção de horários (sem alteração)
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
      services: dbServices, // ATUALIZADO: Passa serviços do DB
      staff: staff, // Passa equipe do DB
      // --- MUDANÇA 3: Passa a variável para a view ---
      pendingAppointments: pendingAppointments,
      // --- FIM DA MUDANÇA 3 ---
      success,
      error
    });
  } catch (err) {
    console.error("Erro ao buscar agenda:", err);
    res.render('agenda-dia', {
      days: [], resultsByDay: {}, availableByDay: {}, clients: [], services: [], staff: [],
      // --- MUDANÇA 4: Adiciona a variável no erro ---
      pendingAppointments: [],
      // --- FIM DA MUDANÇA 4 ---
      error: 'Erro ao carregar a agenda.',
      success: null, date: dayjs().tz('America/Sao_Paulo').format('YYYY-MM-DD')
    });
  }
};

// --- Editar Serviço / Data/Hora (ATUALIZADO) ---
exports.editAppointmentService = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    // ATENÇÃO: 'id'=Appt, 'idx'=ApptService
    const { id, idx } = req.params;
    const { name, price } = req.body;

    // 1. Busca o agendamento para checar posse e pegar clientId
    const a = await db.Appointment.findOne({ 
      where: { id: id, organizationId: organizationId },
      attributes: ['clientId']
    });
    if (!a) {
        return res.redirect('/clients?error=Agendamento não encontrado');
    }

    // 2. Atualiza o serviço do agendamento
    // ATUALIZADO: a.services[idx] -> db.AppointmentService.update
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

    // ATUALIZADO: findOne -> findOne
    const a = await db.Appointment.findOne({ 
      where: { id: id, organizationId: organizationId }
    });
    if (!a) {
      return res.redirect('/clients?error=Agendamento não encontrado');
    }

    const newDate = dayjs.tz(`${date}T${time}`, 'America/Sao_Paulo').toDate();
    // TODO: Adicionar verificação de conflito aqui
    
    // ATUALIZADO: a.save() -> a.update()
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

        // ATUALIZADO: findOneAndUpdate -> findOne + update
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
        
        // Atualiza a instância
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

        // 1. Busca primeiro (ATUALIZADO)
        const appt = await db.Appointment.findOne({ 
          where: { id: id, organizationId: organizationId }
        });

        if (!appt) {
             return res.redirect(`/agendamentos-por-dia?error=${encodeURIComponent('Agendamento não encontrado.')}`);
        }
        
        const appointmentDate = dayjs(appt.date).format('YYYY-MM-DD');

        // 2. Validação
        if (!cancellationReason || cancellationReason.trim() === '') {
            return res.redirect(`/agendamentos-por-dia?date=${appointmentDate}&error=${encodeURIComponent('O motivo do cancelamento é obrigatório.')}`);
        }

        // 3. Atualiza (ATUALIZADO)
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