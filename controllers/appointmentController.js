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
  const { clientId, date, time, duration, services, products, force, staffId } = req.body; // Adicionado staffId

  let transaction;
  try {
    // Validações
    if (!clientId || clientId.trim() === '') {
      return res.redirect('/agendamentos-por-dia?error=Cliente não selecionado');
    }
    // ATUALIZADO: Validação do Cliente
    const client = await db.Client.findOne({ where: { id: clientId, organizationId: organizationId } });
    if (!client) {
      return res.redirect('/agendamentos-por-dia?error=Cliente não encontrado.');
    }
    // TODO: Adicionar validação do Staff (db.Staff.findOne) se staffId for obrigatório

    const parsedServices = services ? JSON.parse(services) : [];
    const parsedProducts = products ? JSON.parse(products) : [];

    const start = dayjs.tz(`${date}T${time}`, 'America/Sao_Paulo').toDate();
    const dur = parseInt(duration, 10);
    const end = new Date(start.getTime() + dur * 60000);

    // ATUALIZADO: Verificação de conflito (com SQL nativo do Postgres)
    // Lógica: (appt.start < new.end) AND (appt.end > new.start)
    const conflict = await db.Appointment.findOne({
      where: {
        organizationId: organizationId,
        staffId: staffId, // Verifica conflito PARA O PROFISSIONAL
        date: { [Op.lt]: end }, // appt.start < new.end
        // appt.end > new.start
        [Op.and]: db.sequelize.literal(`"date" + ("duration" * interval '1 minute') > :start`)
      },
      replacements: { start: start } // 'replacements' para evitar SQL injection
    });

    if (conflict && !force) {
      // Script de confirmação (sem alteração, mas precisa passar staffId)
      const data = { clientId, date, time, duration, services, products, force: true, staffId };
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
    
    // ATUALIZADO: Criação com Transação
    // Substitui Appointment.create() com subdocumentos
    await db.sequelize.transaction(async (t) => {
      // 1. Cria o Agendamento principal
      const newAppt = await db.Appointment.create({
        organizationId: organizationId,
        clientId,
        staffId, // Salva o profissional
        date: start,
        duration: dur,
        status: 'confirmado' // O admin cria como 'confirmado'
      }, { transaction: t });

      // 2. Cria os Serviços do Agendamento (se houver)
      if (parsedServices && parsedServices.length > 0) {
        const apptServices = parsedServices.map(s => ({
          name: s.name,
          price: s.price,
          serviceId: s.serviceId || null, // Link para o catálogo (opcional)
          appointmentId: newAppt.id // Link para o agendamento
        }));
        await db.AppointmentService.bulkCreate(apptServices, { transaction: t });
      }

      // 3. Cria os Produtos do Agendamento (se houver)
      if (parsedProducts && parsedProducts.length > 0) {
        const apptProducts = parsedProducts.map(p => ({
          name: p.name,
          price: p.price,
          appointmentId: newAppt.id // Link para o agendamento
        }));
        await db.AppointmentProduct.bulkCreate(apptProducts, { transaction: t });
      }
    });
    
    const hourFormatted = dayjs(start).tz('America/Sao_Paulo').format('HH:mm');
    res.redirect(`/agendamentos-por-dia?success=${hourFormatted}`);
  } catch (err) {
    console.error("Erro ao criar agendamento:", err);
    res.redirect(`/agendamentos-por-dia?error=${encodeURIComponent('Erro ao salvar agendamento.')}`);
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
    const [appts, clients, dbServices, staff] = await Promise.all([
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
      })
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
        _id: a.id, // ATUALIZADO: _id -> id
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
      success,
      error
    });
  } catch (err) {
    console.error("Erro ao buscar agenda:", err);
    res.render('agenda-dia', {
      days: [], resultsByDay: {}, availableByDay: {}, clients: [], services: [], staff: [],
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
  } catch (err) {
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