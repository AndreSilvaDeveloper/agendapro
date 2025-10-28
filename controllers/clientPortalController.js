// controllers/clientPortalController.js

const Appointment = require('../models/Appointment');
const Client = require('../models/Client');
const Organization = require('../models/Organization');
const Service = require('../models/Service');
const Staff = require('../models/Staff');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

// --- NOVO: Fuso horário padrão para ser usado em todo o controller ---
const tz = 'America/Sao_Paulo';

/**
 * Pega os IDs essenciais da sessão do cliente.
 * O middleware (clientAuthMiddleware) já garantiu que eles existem.
 */
const getClientSession = (req) => {
  return {
    clientId: req.session.clientId,
    organizationId: req.session.clientOrgId,
    clientName: req.session.clientName
  };
};

/**
 * GET /portal/minha-area
 * (Função MODIFICADA para buscar e exibir notificações)
 */
exports.getMinhaArea = async (req, res) => {
  try {
    const { clientId, organizationId, clientName } = getClientSession(req);

    // =================================================================
    // ===       INÍCIO DA NOVA LÓGICA DE NOTIFICAÇÃO (GEMINI)       ===
    // =================================================================

    // 1. (NOVO) Buscar agendamentos que o cliente ainda não viu
    const unseenAppts = await Appointment.find({
      clientId: clientId,
      organizationId: organizationId,
      clientNotified: false
    });

    const notifications = [];
    if (unseenAppts.length > 0) {
      unseenAppts.forEach(appt => {
        const apptDate = dayjs(appt.date).tz(tz).format('DD/MM/YYYY');
        const apptTime = dayjs(appt.date).tz(tz).format('HH:mm');
        let message = '';
        let type = '';

        if (appt.status === 'confirmado') {
          message = `Seu agendamento (${apptDate} às ${apptTime}) foi CONFIRMADO.`;
          type = 'confirmado';
        } else if (appt.status === 'cancelado_pelo_salao') {
          message = `Seu agendamento (${apptDate} às ${apptTime}) foi CANCELADO pelo salão.`;
          type = 'cancelado';
        }

        if (message) {
          notifications.push({ message, type });
        }
      });

      // 2. (NOVO) Marcar notificações como vistas (em segundo plano)
      const idsToUpdate = unseenAppts.map(a => a._id);
      Appointment.updateMany(
        { _id: { $in: idsToUpdate } },
        { $set: { clientNotified: true } }
      ).exec(); // .exec() "fire-and-forget"
    }

    // =================================================================
    // ===        FIM DA NOVA LÓGICA DE NOTIFICAÇÃO (GEMINI)         ===
    // =================================================================


    // 1. Buscar a organização
    const organization = await Organization.findById(organizationId);
    if (!organization) {
      return res.redirect('/portal/logout');
    }

    // 2. Buscar todos os agendamentos (lógica original)
    const todosAgendamentos = await Appointment.find({
      clientId: clientId,
      organizationId: organizationId
    })
    .sort({ date: -1 })
    .populate('staffId', 'name');

    const agora = dayjs().tz(tz);
    const proximos = [];
    const historico = [];

    // 3. Separar agendamentos (lógica original)
    todosAgendamentos.forEach(appt => {
      const apptData = {
        _id: appt._id,
        date: dayjs(appt.date).tz(tz).format('DD/MM/YYYY'),
        time: dayjs(appt.date).tz(tz).format('HH:mm'),
        status: appt.status,
        services: appt.services.map(s => s.name).join(', '),
        staffName: appt.staffId ? appt.staffId.name : 'Qualquer Profissional',
        total: appt.services.reduce((sum, s) => sum + s.price, 0),
        cancellationReason: null
      };
      if (appt.status === 'cancelado_pelo_salao') {
          apptData.cancellationReason = appt.cancellationReason;
      }
      if (appt.status === 'concluido' || appt.status.startsWith('cancelado_')) {
        historico.push(apptData);
      } 
      else if (dayjs(appt.date).tz(tz).isAfter(agora.subtract(1, 'hour'))) { 
        proximos.push(apptData);
      } 
      else {
        historico.push(apptData);
      }
    });

    // 4. Buscar produtos (lógica original)
    const clientData = await Client.findById(clientId).select('products');
    const produtosPendentes = [];
    const historicoProdutos = [];
    if (clientData.products && clientData.products.length > 0) {
      clientData.products.forEach(p => {
        const totalPaid = (p.payments || []).reduce((sum, pay) => sum + pay.amount, 0);
        const isPending = totalPaid < p.price;
        const formattedProduct = {
          name: p.name,
          price: p.price,
          addedAt: p.addedAt ? dayjs(p.addedAt).tz(tz).format('DD/MM/YYYY') : dayjs(p._id.getTimestamp()).tz(tz).format('DD/MM/YYYY'), 
          totalPaid: totalPaid
        };
        if (isPending) {
          produtosPendentes.push(formattedProduct);
        } else {
          historicoProdutos.push(formattedProduct);
        }
      });
    }

    // 5. Renderizar (MODIFICADO para incluir notifications e req.flash)
    res.render('client/dashboard', {
      clientName: clientName,
      orgName: organization.name,
      proximosAgendamentos: proximos.reverse(),
      historicoAgendamentos: historico,
      produtosPendentes: produtosPendentes,     
      historicoProdutos: historicoProdutos,   
      notifications: notifications, // <-- AQUI! Passa as novas notificações
      error: req.flash('error')[0] || req.query.error || null, // <-- CORRIGIDO!
      success: req.flash('success')[0] || req.query.success || null // <-- CORRIGIDO!
    });

  } catch (err) {
    console.error('Erro ao carregar /minha-area do cliente:', err);
    res.status(500).send('Erro interno do servidor.');
  }
};

/**
 * GET /portal/agendar
 * (Seu código original - Sem alterações)
 * Esta função continua servindo a página estática. O JavaScript que
 * adicionaremos depois irá torná-la dinâmica.
 */
exports.getNovoAgendamento = async (req, res) => {
  try {
    const { organizationId, clientName } = getClientSession(req);
    const organization = await Organization.findById(organizationId);
    if (!organization) {
      return res.redirect('/portal/logout');
    }

    const services = await Service.find({
      organizationId: organizationId,
      isActive: true
    }).sort({ name: 1 });

    const staff = await Staff.find({
      organizationId: organizationId,
      isActive: true
    }).sort({ name: 1 });

    res.render('client/agendar', {
      clientName: clientName,
      orgName: organization.name,
      services: services,
      staff: staff,
      error: req.flash('error')[0] || req.query.error || null, // --- MODIFICADO: Para suportar req.flash
      success: req.flash('success')[0] || req.query.success || null
    });

  } catch (err) {
    console.error('Erro ao carregar página de agendamento:', err);
    res.redirect('/portal/minha-area?error=Erro ao carregar página de agendamento.');
  }
};

/**
 * POST /portal/agendar
 * Processa a solicitação de um novo agendamento.
 * (Função REFORÇADA com as novas validações de segurança)
 */
exports.postNovoAgendamento = async (req, res) => {
  try {
    const { clientId, organizationId } = getClientSession(req);
    const { serviceId, staffId, date, time } = req.body;

    // 1. Validação básica de entrada
    if (!serviceId || !date || !time) {
      req.flash('error', 'Serviço, data e hora são obrigatórios.');
      return res.redirect('/portal/agendar');
    }

    // 2. Buscar o serviço (para segurança e para pegar duração)
    const service = await Service.findOne({
      _id: serviceId,
      organizationId: organizationId
    });

    if (!service) {
      req.flash('error', 'Serviço não encontrado.');
      return res.redirect('/portal/agendar');
    }
    const duration = service.duration;
    
    // 3. Define as datas e horas exatas
    const start = dayjs.tz(`${date}T${time}`, 'YYYY-MM-DDTHH:mm', tz);
    const end = start.add(duration, 'minute');

    // 4. --- VALIDAÇÃO REFORÇADA (SE UM PROFISSIONAL FOI ESCOLHIDO) ---
    if (staffId) {
      const staffMember = await Staff.findOne({
        _id: staffId,
        organizationId: organizationId,
        isActive: true
      });

      // 4a. Validação de Segurança: O profissional existe?
      if (!staffMember) {
        req.flash('error', 'Profissional não encontrado.');
        return res.redirect('/portal/agendar');
      }

      // 4b. REGRA 1: O profissional faz este serviço?
      if (!staffMember.services.includes(serviceId)) {
        req.flash('error', 'O profissional selecionado não realiza este serviço.');
        return res.redirect('/portal/agendar');
      }

      // 4c. REGRA 2: O profissional trabalha neste dia e horário?
      const dayName = start.format('dddd').toLowerCase(); // 'monday', 'tuesday', etc.
      const workSchedule = staffMember.workingHours.get(dayName);

      if (!workSchedule || workSchedule.isOff) {
        req.flash('error', 'O profissional não atende neste dia da semana.');
        return res.redirect('/portal/agendar');
      }
      
      const openingTime = dayjs.tz(`${date}T${workSchedule.startTime}`, 'YYYY-MM-DDTHH:mm', tz);
      const closingTime = dayjs.tz(`${date}T${workSchedule.endTime}`, 'YYYY-MM-DDTHH:mm', tz);

      if (start.isBefore(openingTime) || end.isAfter(closingTime)) {
        req.flash('error', 'O horário solicitado está fora do expediente do profissional.');
        return res.redirect('/portal/agendar');
      }

      // 4d. REGRA 3: Verificação de Conflito (Sua lógica original, que está correta e robusta)
      const conflict = await Appointment.findOne({
        organizationId: organizationId,
        staffId: staffId,
        status: { $in: ['pendente', 'confirmado'] },
        date: { $lt: end.toDate() }, // Começa antes do fim do novo
        $expr: {
          $gt: [
            { $add: ['$date', { $multiply: ['$duration', 60000] }] }, // Fim do existente
            start.toDate() // é depois do início do novo
          ]
        }
      });
      
      if (conflict) {
        req.flash('error', 'Este profissional já possui um agendamento neste horário.');
        return res.redirect('/portal/agendar');
      }
    }
    // (Se 'staffId' for nulo, as validações 4b, 4c, 4d são puladas
    // e o agendamento fica pendente para o admin alocar.)

    // 5. Criar o agendamento (Lógica original mantida)
    const newAppointment = new Appointment({
      organizationId: organizationId,
      clientId: clientId,
      staffId: staffId || null,
      date: start.toDate(),
      duration: duration,
      status: 'pendente', // Sempre 'pendente' quando criado pelo cliente
      
      // (NOVA ALTERAÇÃO) - Quando o CLIENTE cria, ele não precisa ser
      // notificado, então o default 'true' já funciona.
      // MAS, se o status for 'pendente', vamos garantir que
      // o cliente não seja notificado sobre "pendente".
      clientNotified: true, 

      services: [{
        serviceId: service._id,
        name: service.name,
        price: service.price,
        payments: []
      }],
      products: []
    });

    await newAppointment.save();

    // 6. Redirecionar para o dashboard com sucesso
    // --- MODIFICADO: Usando req.flash para a msg de sucesso ---
    req.flash('success', 'Agendamento solicitado! Aguarde a confirmação do salão.');
    res.redirect('/portal/minha-area');

  } catch (err) {
    console.error('Erro ao salvar agendamento do cliente:', err);
    req.flash('error', 'Erro ao salvar seu agendamento. Tente novamente.');
    res.redirect('/portal/agendar');
  }
};

// ===================================================================
// --- NOVO: API PARA AGENDAMENTO DINÂMICO ---
// ===================================================================

/**
 * API GET /api/portal/staff-by-service/:serviceId
 * Rota da API para buscar profissionais que realizam um serviço específico.
 * Chamada pelo JavaScript do frontend.
 */
exports.getStaffByService = async (req, res) => {
  try {
    const { serviceId } = req.params;
    const { organizationId } = getClientSession(req);

    const staffList = await Staff.find({
      organizationId: organizationId,
      services: serviceId, // Filtra mágicamente!
      isActive: true
    }).select('name _id'); // Envia apenas o necessário

    res.status(200).json(staffList);

  } catch (err) {
    console.error('API Error: getStaffByService', err);
    res.status(500).json({ error: 'Erro ao buscar profissionais.' });
  }
};

/**
 * API GET /api/portal/available-times
 * Rota da API para buscar horários disponíveis de um profissional em uma data.
 * Query: ?serviceId=...&staffId=...&date=YYYY-MM-DD
 * Chamada pelo JavaScript do frontend.
 */
exports.getAvailableTimes = async (req, res) => {
  try {
    const { serviceId, staffId, date } = req.query;
    const { organizationId } = getClientSession(req);

    // 1. Validação de entrada
    if (!serviceId || !staffId || !date) {
      return res.status(400).json({ error: 'Parâmetros inválidos.' });
    }

    // 2. Busca de dados essenciais em paralelo
    const [service, staffMember] = await Promise.all([
      Service.findById(serviceId).select('duration'),
      Staff.findById(staffId).select('workingHours')
    ]);

    if (!service || !staffMember) {
      return res.status(404).json({ error: 'Serviço ou profissional não encontrado.' });
    }

    // 3. Verifica o horário de trabalho do profissional
    const targetDay = dayjs.tz(date, 'YYYY-MM-DD', tz);
    const dayName = targetDay.format('dddd').toLowerCase(); // 'monday', 'tuesday'...
    const workSchedule = staffMember.workingHours.get(dayName);

    // Se o profissional não trabalha ou está de folga (isOff)
    if (!workSchedule || workSchedule.isOff) {
      return res.status(200).json([]); // Retorna vazio, não é um erro
    }

    // 4. Pega os agendamentos existentes
    const startOfDay = targetDay.startOf('day').toDate();
    const endOfDay = targetDay.endOf('day').toDate();

    const existingAppointments = await Appointment.find({
      organizationId: organizationId,
      staffId: staffId,
      status: { $in: ['pendente', 'confirmado'] }, // Conflita com pendentes e confirmados
      date: { $gte: startOfDay, $lte: endOfDay }
    }).select('date duration');

    // 5. Gera os "slots" disponíveis
    const serviceDuration = service.duration;
    const slotInterval = 30; // O intervalo de início (ex: 08:00, 08:30, 09:00)
    const availableSlots = [];

    const openingTime = dayjs.tz(`${date}T${workSchedule.startTime}`, 'YYYY-MM-DDTHH:mm', tz);
    const closingTime = dayjs.tz(`${date}T${workSchedule.endTime}`, 'YYYY-MM-DDTHH:mm', tz);

    let currentSlot = openingTime;

    while (currentSlot.isBefore(closingTime)) {
      const slotEnd = currentSlot.add(serviceDuration, 'minute');

      // Não pode terminar o serviço depois do fim do expediente
      if (slotEnd.isAfter(closingTime)) {
        break;
      }

      // Verifica colisão com agendamentos existentes
      let isBooked = false;
      for (const appt of existingAppointments) {
        const apptStart = dayjs(appt.date); // Já está em UTC, dayjs lida com isso
        const apptEnd = apptStart.add(appt.duration, 'minute');

        // Lógica de colisão: (StartA < EndB) && (EndA > StartB)
        if (currentSlot.isBefore(apptEnd) && slotEnd.isAfter(apptStart)) {
          isBooked = true;
          break;
        }
      }

      if (!isBooked) {
        availableSlots.push(currentSlot.format('HH:mm'));
      }

      // Avança para o próximo slot de *início*
      currentSlot = currentSlot.add(slotInterval, 'minute');
    }

    // 6. Retorna os horários livres
    res.status(200).json(availableSlots);

  } catch (err) {
    console.error('API Error: getAvailableTimes', err);
    res.status(500).json({ error: 'Erro ao buscar horários.' });
  }
};