// controllers/appointmentController.js
const Appointment = require('../models/Appointment');
const Client = require('../models/Client');
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


exports.createAppointment = async (req, res) => {
  const organizationId = getOrgId(req);
  const { clientId, date, time, duration, services, products, force } = req.body;

  try {
    // Validação de segurança para garantir que o clientId existe
    if (!clientId || clientId.trim() === '') {
      console.error("Tentativa de agendamento sem clientId.");
      return res.redirect('/agendamentos-por-dia?error=Cliente não selecionado');
    }
    
    // Validação de segurança: O cliente pertence a esta organização?
    const client = await Client.findOne({ _id: clientId, organizationId: organizationId });
    if (!client) {
      console.error(`PERMISSÃO NEGADA: Tentativa de agendar para cliente (${clientId}) de outra organização.`);
      return res.redirect('/agendamentos-por-dia?error=Cliente não encontrado.');
    }

    const parsedServices = services ? JSON.parse(services) : [];
    const parsedProducts = products ? JSON.parse(products) : [];

    const start = dayjs.tz(`${date}T${time}`, 'America/Sao_Paulo').toDate();
    const dur = parseInt(duration, 10);
    const end = new Date(start.getTime() + dur * 60000);

    // Verificação de conflito APENAS DENTRO DESTA ORGANIZAÇÃO
    const conflict = await Appointment.findOne({
      organizationId: organizationId, // <-- FILTRO DE SEGURANÇA
      date: { $lt: end },
      $expr: {
        $gt: [
          { $add: ['$date', { $multiply: ['$duration', 60000] }] },
          start
        ]
      }
    });

    if (conflict && !force) {
      // O script de confirmação está correto, ele reenviará para esta mesma rota
      return res.send(`
<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Confirmar</title></head><body>
<script>
if (confirm("⚠️ Conflito de horário. Agendar mesmo assim?")) {
  const f = document.createElement('form'); f.method='POST'; f.action='/appointment';
  const data = ${JSON.stringify({ clientId, date, time, duration, services, products, force: true })};
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

    parsedServices.forEach(s => s.payments = []);
    parsedProducts.forEach(p => p.payments = []);
    
    // "Etiqueta" o novo agendamento com o ID da organização
    await Appointment.create({
      organizationId: organizationId, // <-- ETIQUETA DE SEGURANÇA
      clientId,
      date: start,
      duration: dur,
      services: parsedServices,
      products: parsedProducts
    });

    const hourFormatted = dayjs(start).tz('America/Sao_Paulo').format('HH:mm');
    res.redirect(`/agendamentos-por-dia?success=${hourFormatted}`);
  } catch (err) {
    console.error("Erro ao criar agendamento:", err);
    res.redirect(`/agendamentos-por-dia?error=Erro ao salvar agendamento.`);
  }
};

// --- Remover Serviço / Produto ---
exports.removeServiceFromAppointment = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const { id, idx } = req.params;

    // Busca o agendamento APENAS se pertencer a esta organização
    const a = await Appointment.findOne({ _id: id, organizationId: organizationId });
    if (!a) {
      return res.redirect('/clients?error=Agendamento não encontrado');
    }

    a.services.splice(idx, 1);
    await a.save();
    res.redirect(`/client/${a.clientId}`);
  } catch (err) {
    console.error("Erro ao remover serviço:", err);
    res.redirect('/clients?error=Erro ao processar solicitação.');
  }
};

// --- Cancelar Agendamento + SMS ---
exports.cancelAppointment = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const { id } = req.params;

    // Busca o agendamento APENAS se pertencer a esta organização
    const appt = await Appointment.findOne({ _id: id, organizationId: organizationId });
    if (!appt) {
      return res.status(404).send('Agendamento não encontrado.');
    }

    await Appointment.deleteOne({ _id: appt._id }); // Seguro, pois já verificamos a posse
    res.redirect(`/client/${appt.clientId}`);
  } catch (err) {
    console.error('Erro no cancelamento:', err);
    res.status(500).send('Erro ao cancelar agendamento.');
  }
};

// --- Pagamentos com Método ---
exports.payAppointmentService = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const { id, idx } = req.params;
    const { amount, method, description, paidAt } = req.body;

    // Busca o agendamento APENAS se pertencer a esta organização
    const a = await Appointment.findOne({ _id: id, organizationId: organizationId });
    if (!a) {
      return res.status(404).send('Agendamento não encontrado.');
    }

    const item = a.services[idx];
    if (!item) {
      return res.status(404).send('Serviço não encontrado.');
    }

    const val = parseFloat(amount);
    const methodLower = method.toLowerCase();

    if (isNaN(val) || val <= 0)
      return res.status(400).send("Valor inválido.");
    if (!['pix', 'dinheiro', 'cartao'].includes(methodLower)) // Padronizado
      return res.status(400).send("Método inválido.");

    const when = paidAt
      ? dayjs.tz(paidAt, dayjs.ISO_8601, 'America/Sao_Paulo').toDate()
      : new Date();

    item.payments.push({
      amount: val,
      paidAt: when,
      description: description || '',
      method: methodLower // Salva em minúsculas
    });

    a.markModified('services');
    await a.save();
    res.redirect(`/client/${a.clientId}`);
  } catch (err) {
    console.error("Erro ao pagar serviço:", err);
    res.redirect('/clients?error=Erro ao processar pagamento.');
  }
};

// --- Remover Pagamento ---
exports.removeAppointmentPayment = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const { id, sIdx, pIdx } = req.params;
    
    // Busca o agendamento APENAS se pertencer a esta organização
    const a = await Appointment.findOne({ _id: id, organizationId: organizationId });
    if (!a) {
      return res.status(404).send('Agendamento não encontrado.');
    }

    if (a.services[sIdx] && a.services[sIdx].payments[pIdx]) {
      a.services[sIdx].payments.splice(pIdx, 1);
      await a.save();
    }
    res.redirect(`/client/${a.clientId}`);
  } catch (err) {
    console.error("Erro ao remover pagamento:", err);
    res.redirect('/clients?error=Erro ao processar solicitação.');
  }
};

// --- Agenda por Dia ---
exports.getAgendaPorDia = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const { date, success, error } = req.query;

    const services = [
      { name: 'Corte', price: 30 },
      { name: 'Escova', price: 40 },
      { name: 'Progressiva', price: 120 }
    ];

    const days = [];
    if (date) {
      days.push(dayjs.tz(date, 'YYYY-MM-DD', 'America/Sao_Paulo'));
    } else {
      const today = dayjs().tz('America/Sao_Paulo');
      const monday = today.startOf('isoWeek');
      const tuesday = monday.add(1, 'day');
      for (let i = 0; i < 5; i++) {
        days.push(tuesday.add(i, 'day'));
      }
    }

    const resultsByDay = {};
    const availableByDay = {};
    days.forEach(d => {
      const key = d.format('YYYY-MM-DD');
      resultsByDay[key] = [];
      availableByDay[key] = gerarHorariosDisponiveis();
    });

    let appts;
    // Busca agendamentos APENAS desta organização
    if (date) {
      const start = days[0].startOf('day').toDate();
      const end = days[0].endOf('day').toDate();
      appts = await Appointment
        .find({ 
          organizationId: organizationId, // <-- FILTRO DE SEGURANÇA
          date: { $gte: start, $lte: end } 
        })
        .sort('date')
        .populate('clientId');
    } else {
      const weekStart = days[0].startOf('day').toDate();
      const weekEnd = days[4].endOf('day').toDate();
      appts = await Appointment
        .find({ 
          organizationId: organizationId, // <-- FILTRO DE SEGURANÇA
          date: { $gte: weekStart, $lte: weekEnd } 
        })
        .sort('date')
        .populate('clientId');
    }

    appts.forEach(a => {
      if (!a.clientId) {
        console.warn(`Agendamento ${a._id} (Org: ${organizationId}) sem cliente associado.`);
        return;
      }
      
      const d = dayjs(a.date).tz('America/Sao_Paulo');
      const key = d.format('YYYY-MM-DD');
      const time = d.format('HH:mm');
      if (!(key in resultsByDay)) return;

      resultsByDay[key].push({
        _id: a._id,
        clientId: a.clientId._id.toString(),
        clientName: a.clientId.name,
        timeFormatted: time,
        servicesNames: a.services.map(s => s.name).join(', '),
        status: a.status // <-- CORREÇÃO APLICADA AQUI
      });

      const blocos = Math.ceil((a.duration || 0) / 30);
      for (let i = 0; i < blocos; i++) {
        const slot = d.add(i * 30, 'minute').format('HH:mm');
        availableByDay[key] = availableByDay[key].filter(s => s !== slot);
      }
    });

    // Busca clientes APENAS desta organização
    const clients = await Client.find({ organizationId: organizationId }).sort({ name: 1 });

    res.render('agenda-dia', {
      date,
      days,
      resultsByDay,
      availableByDay,
      clients,
      services,
      success,
      error
    });
  } catch (err) {
    console.error("Erro ao buscar agenda:", err);
    res.render('agenda-dia', { 
      days: [], resultsByDay: {}, availableByDay: {}, clients: [], services: [], 
      error: 'Erro ao carregar a agenda.', 
      success: null, date: null 
    });
  }
};

// --- Editar Serviço / Data/Hora ---
exports.editAppointmentService = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const { id, idx } = req.params;
    const { name, price } = req.body;

    // Busca o agendamento APENAS se pertencer a esta organização
    const a = await Appointment.findOne({ _id: id, organizationId: organizationId });
    if (!a) {
      return res.status(404).send('Agendamento não encontrado.');
    }
    
    if (a.services[idx]) {
      a.services[idx].name = name;
      a.services[idx].price = parseFloat(price);
      await a.save();
    }
    res.redirect(`/client/${a.clientId}`);
  } catch (err) {
    console.error("Erro ao editar serviço:", err);
    res.redirect('/clients?error=Erro ao processar solicitação.');
  }
};

exports.editAppointmentDateTime = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const { id } = req.params;
    const { date, time } = req.body;

    // Busca o agendamento APENAS se pertencer a esta organização
    const a = await Appointment.findOne({ _id: id, organizationId: organizationId });
    if (!a) {
      return res.status(44).send('Agendamento não encontrado.');
    }

    const newDate = dayjs.tz(`${date}T${time}`, 'America/Sao_Paulo').toDate();
    a.date = newDate;
    await a.save();

    res.redirect(`/client/${a.clientId}`);
  } catch (err) {
    console.error("Erro ao editar data/hora:", err);
    res.redirect('/clients?error=Erro ao processar solicitação.');
  }
};

exports.confirmAppointment = async (req, res) => {
    try {
        const organizationId = getOrgId(req);
        const { id } = req.params;

        const appointment = await Appointment.findOneAndUpdate(
            {
                _id: id,
                organizationId: organizationId,
                status: 'pendente' // Só atualiza se estiver pendente
            },
            { status: 'confirmado' }, // Muda o status
            { new: true } // Retorna o documento atualizado (opcional)
        );

        if (!appointment) {
            // Se não encontrou (ou não estava pendente), retorna erro
            return res.redirect(`/agendamentos-por-dia?error=${encodeURIComponent('Agendamento não encontrado ou já processado.')}`);
        }

        // TODO Futuro: Enviar notificação para o cliente (Email ou WhatsApp)

        // Redireciona de volta para a data do agendamento
        const appointmentDate = dayjs(appointment.date).format('YYYY-MM-DD');
        res.redirect(`/agendamentos-por-dia?date=${appointmentDate}&success=${encodeURIComponent('Agendamento confirmado!')}`);

    } catch (err) {
        console.error("Erro ao confirmar agendamento:", err);
        res.redirect(`/agendamentos-por-dia?error=${encodeURIComponent('Erro ao confirmar o agendamento.')}`);
    }
};

/**
 * POST /admin/appointment/:id/cancel-by-admin
 * Cancela (recusa) um agendamento pendente.
 */
exports.cancelAppointmentByAdmin = async (req, res) => {
    try {
        const organizationId = getOrgId(req);
        const { id } = req.params;

        const appointment = await Appointment.findOneAndUpdate(
            {
                _id: id,
                organizationId: organizationId,
                status: 'pendente' // Só atualiza se estiver pendente
            },
            { status: 'cancelado_pelo_salao' }, // Muda o status
            { new: true }
        );

        if (!appointment) {
            return res.redirect(`/agendamentos-por-dia?error=${encodeURIComponent('Agendamento não encontrado ou já processado.')}`);
        }

        // TODO Futuro: Enviar notificação para o cliente

        const appointmentDate = dayjs(appointment.date).format('YYYY-MM-DD');
        res.redirect(`/agendamentos-por-dia?date=${appointmentDate}&success=${encodeURIComponent('Agendamento cancelado.')}`);

    } catch (err) {
        console.error("Erro ao cancelar agendamento pelo admin:", err);
        res.redirect(`/agendamentos-por-dia?error=${encodeURIComponent('Erro ao cancelar o agendamento.')}`);
    }
};