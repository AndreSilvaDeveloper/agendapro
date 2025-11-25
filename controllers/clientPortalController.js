// controllers/clientPortalController.js
// --- REMOVIDO ---
// const Appointment = require('../models/Appointment');
// const Client = require('../models/Client');
// const Organization = require('../models/Organization');
// const Service = require('../models/Service');
// const Staff = require('../models/Staff');

// --- ADICIONADO ---
const db = require('../models');
const { Op } = require('sequelize');

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

const tz = 'America/Sao_Paulo';

const getClientSession = (req) => {
  return {
    clientId: req.session.clientId,
    organizationId: req.session.clientOrgId,
    clientName: req.session.clientName
  };
};

/**
 * GET /portal/minha-area
 * (Função ATUALIZADA para Sequelize)
 */
exports.getMinhaArea = async (req, res) => {
  try {
    const { clientId, organizationId, clientName } = getClientSession(req);

    // --- LÓGICA DE NOTIFICAÇÃO (ATUALIZADA) ---
    // 1. (ATUALIZADO) Buscar agendamentos que o cliente ainda não viu
    const unseenAppts = await db.Appointment.findAll({
      where: {
        clientId: clientId,
        organizationId: organizationId,
        clientNotified: false
      }
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

      // 2. (ATUALIZADO) Marcar notificações como vistas
      const idsToUpdate = unseenAppts.map(a => a.id);
      db.Appointment.update(
        { clientNotified: true },
        { where: { id: { [Op.in]: idsToUpdate } } }
      ); // "fire-and-forget"
    }
    // --- FIM DA LÓGICA DE NOTIFICAÇÃO ---


    // 1. (ATUALIZADO) Buscar a organização
    const organization = await db.Organization.findByPk(organizationId);
    if (!organization) {
      return res.redirect('/portal/logout');
    }

    // 2. (ATUALIZADO) Buscar todos os agendamentos (com includes)
    const todosAgendamentos = await db.Appointment.findAll({
      where: {
        clientId: clientId,
        organizationId: organizationId
      },
      order: [['date', 'DESC']],
      include: [
        { model: db.Staff, attributes: ['name'] },
        { model: db.AppointmentService, attributes: ['name', 'price'] }
      ]
    });

    const agora = dayjs().tz(tz);
    const proximos = [];
    const historico = [];

    // 3. (ATUALIZADO) Separar agendamentos
    todosAgendamentos.forEach(appt => {
      const apptData = {
        _id: appt.id, // ATUALIZADO: _id -> id
        date: dayjs(appt.date).tz(tz).format('DD/MM/YYYY'),
        time: dayjs(appt.date).tz(tz).format('HH:mm'),
        status: appt.status,
        // ATUALIZADO: appt.services -> appt.AppointmentServices
        services: (appt.AppointmentServices || []).map(s => s.name).join(', '),
        // ATUALIZADO: appt.staffId -> appt.Staff
        staffName: appt.Staff ? appt.Staff.name : 'Qualquer Profissional',
        // ATUALIZADO: appt.services.reduce -> appt.AppointmentServices.reduce
        total: (appt.AppointmentServices || []).reduce((sum, s) => sum + parseFloat(s.price), 0),
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

    // 4. (ATUALIZADO) Buscar produtos (com includes)
    const clientData = await db.Client.findByPk(clientId, {
      include: [{
        model: db.Product,
        include: [db.Payment]
      }]
    });
    
    const produtosPendentes = [];
    const historicoProdutos = [];
    // ATUALIZADO: clientData.products -> clientData.Products
    if (clientData.Products && clientData.Products.length > 0) {
      clientData.Products.forEach(p => {
        // ATUALIZADO: p.payments -> p.Payments
        const totalPaid = (p.Payments || []).reduce((sum, pay) => sum + parseFloat(pay.amount), 0);
        const isPending = totalPaid < parseFloat(p.price);
        const formattedProduct = {
          name: p.name,
          price: parseFloat(p.price),
          addedAt: p.addedAt ? dayjs(p.addedAt).tz(tz).format('DD/MM/YYYY') : dayjs(p.createdAt).tz(tz).format('DD/MM/YYYY'), 
          totalPaid: totalPaid
        };
        if (isPending) {
          produtosPendentes.push(formattedProduct);
        } else {
          historicoProdutos.push(formattedProduct);
        }
      });
    }

    // 5. Renderizar (sem alteração de lógica)
    res.render('client/dashboard', {
      clientName: clientName,
      orgName: organization.name,
      proximosAgendamentos: proximos.reverse(),
      historicoAgendamentos: historico,
      produtosPendentes: produtosPendentes,     
      historicoProdutos: historicoProdutos,   
      notifications: notifications,
      error: req.flash('error')[0] || req.query.error || null,
      success: req.flash('success')[0] || req.query.success || null
    });

  } catch (err) {
    console.error('Erro ao carregar /minha-area do cliente:', err);
    res.status(500).send('Erro interno do servidor.');
  }
};

/**
 * GET /portal/agendar
 * (ATUALIZADO)
 */
exports.getNovoAgendamento = async (req, res) => {
  try {
    const { organizationId, clientName } = getClientSession(req);
    // ATUALIZADO: Organization.findById -> db.Organization.findByPk
    const organization = await db.Organization.findByPk(organizationId);
    if (!organization) {
      return res.redirect('/portal/logout');
    }

    // ATUALIZADO: Service.find() -> db.Service.findAll()
    const services = await db.Service.findAll({
      where: {
        organizationId: organizationId,
        isActive: true
      },
      order: [['name', 'ASC']]
    });

    // ATUALIZADO: Staff.find() -> db.Staff.findAll()
    const staff = await db.Staff.findAll({
      where: {
        organizationId: organizationId,
        isActive: true
      },
      order: [['name', 'ASC']]
    });

    res.render('client/agendar', {
      clientName: clientName,
      orgName: organization.name,
      services: services,
      staff: staff,
      error: req.flash('error')[0] || req.query.error || null,
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
 * (ATUALIZADO)
 */
exports.postNovoAgendamento = async (req, res) => {
  try {
    const { clientId, organizationId } = getClientSession(req);
    const { serviceId, staffId, date, time } = req.body;

    if (!serviceId || !date || !time) {
      req.flash('error', 'Serviço, data e hora são obrigatórios.');
      return res.redirect('/portal/agendar');
    }

    // 2. (ATUALIZADO) Buscar o serviço
    const service = await db.Service.findOne({
      where: {
        id: serviceId,
        organizationId: organizationId
      }
    });

    if (!service) {
      req.flash('error', 'Serviço não encontrado.');
      return res.redirect('/portal/agendar');
    }
    const duration = service.duration;
    
    const start = dayjs.tz(`${date}T${time}`, 'YYYY-MM-DDTHH:mm', tz);
    const end = start.add(duration, 'minute');

    if (staffId) {
      // 4a. (ATUALIZADO) Validação de Segurança: O profissional existe?
      const staffMember = await db.Staff.findOne({
        where: {
          id: staffId,
          organizationId: organizationId,
          isActive: true
        }
      });

      if (!staffMember) {
        req.flash('error', 'Profissional não encontrado.');
        return res.redirect('/portal/agendar');
      }

      // 4b. (ATUALIZADO) REGRA 1: O profissional faz este serviço?
      // Usamos o método M2M do Sequelize para verificar
      const staffServices = await staffMember.getServices({ where: { id: serviceId } });
      if (staffServices.length === 0) {
        req.flash('error', 'O profissional selecionado não realiza este serviço.');
        return res.redirect('/portal/agendar');
      }

      // 4c. (ATUALIZADO) REGRA 2: O profissional trabalha? (JSONB)
      const dayName = start.format('dddd').toLowerCase();
      // ATUALIZADO: staffMember.workingHours.get(dayName) -> staffMember.workingHours[dayName]
      const workSchedule = staffMember.workingHours[dayName]; 

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

      // 4d. (ATUALIZADO) REGRA 3: Verificação de Conflito (SQL)
      const conflict = await db.Appointment.findOne({
        where: {
          organizationId: organizationId,
          staffId: staffId,
          status: { [Op.in]: ['pendente', 'confirmado'] },
          date: { [Op.lt]: end.toDate() },
          [Op.and]: db.sequelize.literal(`"date" + ("duration" * interval '1 minute') > :start`)
        },
        replacements: { start: start.toDate() }
      });
      
      if (conflict) {
        req.flash('error', 'Este profissional já possui um agendamento neste horário.');
        return res.redirect('/portal/agendar');
      }
    }

    // 5. (ATUALIZADO) Criar o agendamento (com Transação)
    await db.sequelize.transaction(async (t) => {
      // 5a. Cria o Agendamento principal
      const newAppointment = await db.Appointment.create({
        organizationId: organizationId,
        clientId: clientId,
        staffId: staffId || null,
        date: start.toDate(),
        duration: duration,
        status: 'pendente',
        clientNotified: true, // Cliente que cria já "viu" (não notificar sobre 'pendente')
      }, { transaction: t });

      // 5b. Cria o Serviço do Agendamento
      await db.AppointmentService.create({
        appointmentId: newAppointment.id,
        serviceId: service.id,
        name: service.name,
        price: service.price
      }, { transaction: t });
    });

    req.flash('success', 'Agendamento solicitado! Aguarde a confirmação do salão.');
    res.redirect('/portal/minha-area');

  } catch (err) {
    console.error('Erro ao salvar agendamento do cliente:', err);
    req.flash('error', 'Erro ao salvar seu agendamento. Tente novamente.');
    res.redirect('/portal/agendar');
  }
};

// --- API PARA AGENDAMENTO DINÂMICO (ATUALIZADO) ---

/**
 * API GET /api/portal/staff-by-service/:serviceId
 * (ATUALIZADO)
 */
exports.getStaffByService = async (req, res) => {
  try {
    const { serviceId } = req.params;
    const { organizationId } = getClientSession(req);

    // ATUALIZADO: Staff.find({ services: ... }) -> db.Staff.findAll({ include: ... })
    // Isso busca Staff que TEM um Serviço associado com o ID
    const staffList = await db.Staff.findAll({
      where: {
        organizationId: organizationId,
        isActive: true
      },
      include: [{
        model: db.Service,
        where: { id: serviceId },
        attributes: [] // Não precisamos dos dados do serviço, só da junção
      }],
      attributes: ['name', 'id'] // ATUALIZADO: _id -> id
    });

    res.status(200).json(staffList);

  } catch (err) {
    console.error('API Error: getStaffByService', err);
    res.status(500).json({ error: 'Erro ao buscar profissionais.' });
  }
};

/**
 * API GET /api/portal/available-times
 * (CORRIGIDO PARA SUPORTAR 2 TURNOS/ALMOÇO)
 */
exports.getAvailableTimes = async (req, res) => {
  try {
    const { serviceId, staffId, date } = req.query;
    const { organizationId } = getClientSession(req);

    if (!serviceId || !staffId || !date) {
      return res.status(400).json({ error: 'Parâmetros inválidos.' });
    }

    // 1. Busca os dados
    const [service, staffMember] = await Promise.all([
      db.Service.findByPk(serviceId, { attributes: ['duration'] }),
      db.Staff.findByPk(staffId, { attributes: ['workingHours'] })
    ]);

    if (!service || !staffMember) {
      return res.status(404).json({ error: 'Serviço ou profissional não encontrado.' });
    }

    // Blindagem contra dados nulos
    if (!staffMember.workingHours) {
        return res.status(200).json([]); 
    }

    const targetDay = dayjs.tz(date, 'YYYY-MM-DD', tz);
    if (!targetDay.isValid()) {
        return res.status(400).json({ error: 'Data inválida.' });
    }
    
    const dayName = targetDay.format('dddd').toLowerCase();
    const workSchedule = staffMember.workingHours[dayName]; 

    // Se estiver marcado como folga ou não existir configuração para o dia
    if (!workSchedule || workSchedule.isOff) {
      return res.status(200).json([]);
    }

    // 2. Busca agendamentos existentes para verificar conflitos
    const startOfDay = targetDay.startOf('day').toDate(); 
    const endOfDay = targetDay.endOf('day').toDate();

    const existingAppointments = await db.Appointment.findAll({
      where: {
        organizationId: organizationId,
        staffId: staffId,
        status: { [Op.in]: ['pendente', 'confirmado'] },
        date: { [Op.between]: [startOfDay, endOfDay] }
      },
      attributes: ['date', 'duration']
    });

    const serviceDuration = service.duration || 60;
    const slotInterval = 30; // Intervalo entre opções de horário
    const availableSlots = [];
    const dateString = targetDay.format('YYYY-MM-DD');
    const now = dayjs().tz(tz);

    // Função auxiliar para gerar slots de um período (Ex: Manhã ou Tarde)
    const generateSlots = (startStr, endStr) => {
        if (!startStr || !endStr) return;

        const startTime = dayjs.tz(`${dateString}T${startStr}`, 'YYYY-MM-DDTHH:mm', tz);
        const endTime = dayjs.tz(`${dateString}T${endStr}`, 'YYYY-MM-DDTHH:mm', tz);
        
        let currentSlot = startTime;

        while (currentSlot.isBefore(endTime)) {
            const slotEnd = currentSlot.add(serviceDuration, 'minute');

            // Se o serviço terminar depois do fim do expediente deste turno, pula
            if (slotEnd.isAfter(endTime)) {
                break;
            }

            let isBooked = false;
            // Verifica colisão com agendamentos existentes
            for (const appt of existingAppointments) {
                const apptStart = dayjs(appt.date).tz(tz);
                const apptEnd = apptStart.add(appt.duration, 'minute');

                // Lógica de Colisão
                if (currentSlot.isBefore(apptEnd) && slotEnd.isAfter(apptStart)) {
                    isBooked = true;
                    break; 
                }
            }

            // Verifica se é horário passado (para o dia de hoje)
            let isPast = false;
            if (targetDay.isSame(now, 'day')) {
                if (currentSlot.isBefore(now)) {
                    isPast = true;
                }
            }

            if (!isBooked && !isPast) {
                availableSlots.push(currentSlot.format('HH:mm'));
            }

            currentSlot = currentSlot.add(slotInterval, 'minute');
        }
    };

    // 3. Gera slots para o Turno 1 (Manhã)
    generateSlots(workSchedule.startTime1, workSchedule.endTime1);

    // 4. Gera slots para o Turno 2 (Tarde)
    generateSlots(workSchedule.startTime2, workSchedule.endTime2);

    // Ordena e remove duplicatas (segurança extra)
    const uniqueSlots = [...new Set(availableSlots)].sort();

    res.status(200).json(uniqueSlots);

  } catch (err) {
    console.error('API Error: getAvailableTimes', err);
    res.status(500).json({ error: 'Erro interno ao calcular horários.' });
  }
};