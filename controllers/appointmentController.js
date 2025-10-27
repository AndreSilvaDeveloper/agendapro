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
      // status: 'confirmado' // O default já é 'confirmado'
    });

    const hourFormatted = dayjs(start).tz('America/Sao_Paulo').format('HH:mm');
    res.redirect(`/agendamentos-por-dia?success=${hourFormatted}`);
  } catch (err) {
    console.error("Erro ao criar agendamento:", err);
    res.redirect(`/agendamentos-por-dia?error=${encodeURIComponent('Erro ao salvar agendamento.')}`);
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
    res.redirect(`/client/${a.clientId}?success=${encodeURIComponent('Serviço removido.')}`); // Adiciona mensagem de sucesso
  } catch (err) {
    console.error("Erro ao remover serviço:", err);
    // Tenta obter clientId do erro ou da requisição para redirecionar
    const clientId = req.params.clientId || (err.appointment ? err.appointment.clientId : '');
    res.redirect(`/client/${clientId}?error=${encodeURIComponent('Erro ao remover serviço.')}`);
  }
};


// --- Cancelar Agendamento (pela página 'client.ejs') ---
exports.cancelAppointment = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const { id } = req.params;
    const { cancellationReason } = req.body; // Pega a razão do body

    // Validação da razão
    if (!cancellationReason || cancellationReason.trim() === '') {
        const appt = await Appointment.findById(id).select('clientId');
        const clientId = appt ? appt.clientId : '';
        return res.redirect(`/client/${clientId}?error=${encodeURIComponent('O motivo do cancelamento é obrigatório.')}`);
    }

    // Busca e atualiza o agendamento em um só passo
    const appt = await Appointment.findOneAndUpdate(
      { _id: id, organizationId: organizationId }, // Filtro de segurança
      {
        status: 'cancelado_pelo_salao',  // Novo status
        cancellationReason: cancellationReason // Salva o motivo
      },
      { new: true } // Retorna o documento atualizado
    );

    if (!appt) {
      // Tenta encontrar o cliente para redirecionar mesmo se o agendamento não for encontrado/atualizado
      const clientAppt = await Appointment.findById(id).select('clientId');
      const clientId = clientAppt ? clientAppt.clientId : '';
      return res.redirect(`/client/${clientId}?error=${encodeURIComponent('Agendamento não encontrado ou já foi cancelado.')}`);
    }

    // TODO Futuro: Enviar notificação para o cliente com o appt.cancellationReason

    // Redireciona de volta para a página do cliente com sucesso
    res.redirect(`/client/${appt.clientId}?success=${encodeURIComponent('Agendamento cancelado com sucesso.')}`);
  } catch (err) {
    console.error('Erro no cancelamento:', err);
    const appt = await Appointment.findById(req.params.id).select('clientId');
    const clientId = appt ? appt.clientId : '';
    res.redirect(`/client/${clientId}?error=${encodeURIComponent('Erro ao cancelar agendamento.')}`);
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
      return res.redirect('/clients?error=Agendamento não encontrado'); // Redireciona para lista geral se não achar agendamento
    }

    const item = a.services[idx];
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

    item.payments.push({
      amount: val,
      paidAt: when,
      description: description || '',
      method: methodLower
    });

    a.markModified('services'); // Importante para salvar subdocumentos modificados
    await a.save();
    res.redirect(`/client/${a.clientId}?success=${encodeURIComponent('Pagamento registrado.')}`);
  } catch (err) {
    console.error("Erro ao pagar serviço:", err);
     // Tenta obter clientId do erro ou da requisição para redirecionar
    const clientId = req.params.clientId || (err.appointment ? err.appointment.clientId : '');
    res.redirect(`/client/${clientId}?error=${encodeURIComponent('Erro ao processar pagamento.')}`);
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
      return res.redirect('/clients?error=Agendamento não encontrado');
    }

    if (a.services[sIdx] && a.services[sIdx].payments[pIdx]) {
      a.services[sIdx].payments.splice(pIdx, 1);
      a.markModified('services'); // Importante
      await a.save();
      res.redirect(`/client/${a.clientId}?success=${encodeURIComponent('Pagamento removido.')}`);
    } else {
        res.redirect(`/client/${a.clientId}?error=${encodeURIComponent('Pagamento não encontrado para remoção.')}`);
    }
  } catch (err) {
    console.error("Erro ao remover pagamento:", err);
    // Tenta obter clientId do erro ou da requisição para redirecionar
    const clientId = req.params.clientId || (err.appointment ? err.appointment.clientId : '');
    res.redirect(`/client/${clientId}?error=${encodeURIComponent('Erro ao remover pagamento.')}`);
  }
};

// --- Agenda por Dia ---
exports.getAgendaPorDia = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const { date, success, error } = req.query;

    const services = [ // Pode vir do DB se preferir
      { name: 'Corte', price: 30 },
      { name: 'Escova', price: 40 },
      { name: 'Progressiva', price: 120 }
    ];

    const days = [];
    const targetDate = date ? dayjs.tz(date, 'YYYY-MM-DD', 'America/Sao_Paulo') : dayjs().tz('America/Sao_Paulo');
    
    // Mostra Terça a Sábado da semana da data alvo
    let currentDay = targetDate.startOf('isoWeek').add(1, 'day'); // Começa na Terça
    if (currentDay.day() === 0) currentDay = currentDay.add(2, 'day'); // Pula Domingo/Segunda se a semana começar neles
    else if (currentDay.day() === 1) currentDay = currentDay.add(1, 'day'); // Pula Segunda

    for (let i = 0; i < 5; i++) { // Terça, Quarta, Quinta, Sexta, Sábado
        days.push(currentDay.add(i, 'day'));
    }

    const resultsByDay = {};
    const availableByDay = {};
    days.forEach(d => {
      const key = d.format('YYYY-MM-DD');
      resultsByDay[key] = [];
      availableByDay[key] = gerarHorariosDisponiveis();
    });

    // Busca agendamentos da semana inteira mostrada
    const weekStart = days[0].startOf('day').toDate();
    const weekEnd = days[days.length - 1].endOf('day').toDate(); // Usa o último dia calculado

    const appts = await Appointment
      .find({
        organizationId: organizationId, // <-- FILTRO DE SEGURANÇA
        date: { $gte: weekStart, $lte: weekEnd },
        status: { $ne: 'cancelado_pelo_salao' } // Não busca cancelados
      })
      .sort('date')
      .populate('clientId', 'name'); // Só popula o nome

    appts.forEach(a => {
      if (!a.clientId) {
        console.warn(`Agendamento ${a._id} (Org: ${organizationId}) sem cliente associado.`);
        return;
      }

      const d = dayjs(a.date).tz('America/Sao_Paulo');
      const key = d.format('YYYY-MM-DD');
      const time = d.format('HH:mm');
      if (!(key in resultsByDay)) return; // Segurança caso a data não esteja nos 'days'

      resultsByDay[key].push({
        _id: a._id,
        clientId: a.clientId._id.toString(),
        clientName: a.clientId.name,
        timeFormatted: time,
        servicesNames: a.services.map(s => s.name).join(', '),
        status: a.status
      });

      // Remove horários ocupados
      const blocos = Math.ceil((a.duration || 0) / 30);
      for (let i = 0; i < blocos; i++) {
        const slot = d.add(i * 30, 'minute').format('HH:mm');
        if (availableByDay[key]) { // Verifica se a chave existe
           availableByDay[key] = availableByDay[key].filter(s => s !== slot);
        }
      }
    });

    // Busca clientes APENAS desta organização
    const clients = await Client.find({ organizationId: organizationId }).select('name').sort({ name: 1 });

    res.render('agenda-dia', {
      date: targetDate.format('YYYY-MM-DD'), // Passa a data alvo formatada
      days,
      resultsByDay,
      availableByDay,
      clients,
      services, // Para o modal, se usar
      success,
      error
    });
  } catch (err) {
    console.error("Erro ao buscar agenda:", err);
    res.render('agenda-dia', {
      days: [], resultsByDay: {}, availableByDay: {}, clients: [], services: [],
      error: 'Erro ao carregar a agenda.',
      success: null, date: dayjs().tz('America/Sao_Paulo').format('YYYY-MM-DD')
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
        return res.redirect('/clients?error=Agendamento não encontrado');
    }

    if (a.services[idx]) {
      a.services[idx].name = name;
      a.services[idx].price = parseFloat(price);
      a.markModified('services'); // Importante
      await a.save();
      res.redirect(`/client/${a.clientId}?success=${encodeURIComponent('Serviço atualizado.')}`);
    } else {
        res.redirect(`/client/${a.clientId}?error=${encodeURIComponent('Serviço não encontrado para editar.')}`);
    }
  } catch (err) {
    console.error("Erro ao editar serviço:", err);
     // Tenta obter clientId do erro ou da requisição para redirecionar
    const clientId = req.params.clientId || (err.appointment ? err.appointment.clientId : '');
    res.redirect(`/client/${clientId}?error=${encodeURIComponent('Erro ao editar serviço.')}`);
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
      return res.redirect('/clients?error=Agendamento não encontrado');
    }

    const newDate = dayjs.tz(`${date}T${time}`, 'America/Sao_Paulo').toDate();
    // TODO: Adicionar verificação de conflito aqui seria ideal
    a.date = newDate;
    await a.save();

    res.redirect(`/client/${a.clientId}?success=${encodeURIComponent('Data/Hora atualizada.')}`);
  } catch (err) {
    console.error("Erro ao editar data/hora:", err);
    // Tenta obter clientId do erro ou da requisição para redirecionar
    const clientId = req.params.clientId || (err.appointment ? err.appointment.clientId : '');
    res.redirect(`/client/${clientId}?error=${encodeURIComponent('Erro ao editar data/hora.')}`);
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

// =================================
// ===     NOVA ALTERAÇÃO AQUI     ===
// =================================
/**
 * POST /admin/appointment/:id/cancel-by-admin
 * Cancela (recusa) um agendamento pendente (pela página 'agenda-dia.ejs').
 */
exports.cancelAppointmentByAdmin = async (req, res) => {
    try {
        const organizationId = getOrgId(req);
        const { id } = req.params;
        const { cancellationReason } = req.body;

        // 1. Busca primeiro para pegar a data ANTES de validar
        const appointmentToCancel = await Appointment.findOne({ _id: id, organizationId: organizationId }).select('date');

        // Se não encontrar o agendamento
        if (!appointmentToCancel) {
             return res.redirect(`/agendamentos-por-dia?error=${encodeURIComponent('Agendamento não encontrado.')}`);
        }
        
        // Pega a data formatada para usar nos redirecionamentos
        const appointmentDate = dayjs(appointmentToCancel.date).format('YYYY-MM-DD');

        // 2. Validação da razão
        if (!cancellationReason || cancellationReason.trim() === '') {
            return res.redirect(`/agendamentos-por-dia?date=${appointmentDate}&error=${encodeURIComponent('O motivo do cancelamento é obrigatório.')}`);
        }

        // 3. Agora sim, atualiza
        const updatedAppointment = await Appointment.findOneAndUpdate(
            {
                _id: id,
                organizationId: organizationId
                // Não precisa mais filtrar por status, pode cancelar qualquer um
            },
            {
                status: 'cancelado_pelo_salao', // Muda o status
                cancellationReason: cancellationReason // Salva o motivo
            },
            { new: true } // Retorna o doc atualizado (útil para logs, etc)
        );

        // Se a atualização falhou por algum motivo (improvável depois do findOne)
        if (!updatedAppointment) {
            return res.redirect(`/agendamentos-por-dia?date=${appointmentDate}&error=${encodeURIComponent('Erro ao atualizar o agendamento.')}`);
        }

        // TODO Futuro: Enviar notificação para o cliente

        res.redirect(`/agendamentos-por-dia?date=${appointmentDate}&success=${encodeURIComponent('Agendamento cancelado.')}`);

    } catch (err) {
        console.error("Erro ao cancelar agendamento pelo admin:", err);
        // Em caso de erro GERAL, redireciona sem a data para evitar mais erros
        res.redirect(`/agendamentos-por-dia?error=${encodeURIComponent('Erro ao cancelar o agendamento.')}`);
    }
};