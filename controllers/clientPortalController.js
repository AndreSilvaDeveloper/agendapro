// controllers/clientPortalController.js
const db = require('../models');
const { Op } = require('sequelize');

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const customParseFormat = require('dayjs/plugin/customParseFormat'); // <--- ESSENCIAL PARA O FIX

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

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
 */
exports.getMinhaArea = async (req, res) => {
  try {
    const { clientId, organizationId, clientName } = getClientSession(req);

    // 1. Notificações
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

      // Marca notificações como vistas
      const idsToUpdate = unseenAppts.map(a => a.id);
      db.Appointment.update(
        { clientNotified: true },
        { where: { id: { [Op.in]: idsToUpdate } } }
      ); 
    }

    // 2. Organização
    const organization = await db.Organization.findByPk(organizationId);
    if (!organization) {
      return res.redirect('/portal/logout');
    }

    // 3. Buscar agendamentos
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

    todosAgendamentos.forEach(appt => {
      const apptData = {
        _id: appt.id,
        date: dayjs(appt.date).tz(tz).format('DD/MM/YYYY'),
        time: dayjs(appt.date).tz(tz).format('HH:mm'),
        status: appt.status,
        services: (appt.AppointmentServices || []).map(s => s.name).join(', '),
        staffName: appt.Staff ? appt.Staff.name : 'Qualquer Profissional',
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

    // 4. Buscar produtos
    const clientData = await db.Client.findByPk(clientId, {
      include: [{
        model: db.Product,
        include: [db.Payment]
      }]
    });
    
    const produtosPendentes = [];
    const historicoProdutos = [];
    
    if (clientData.Products && clientData.Products.length > 0) {
      clientData.Products.forEach(p => {
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
 */
exports.getNovoAgendamento = async (req, res) => {
  try {
    const { organizationId, clientName } = getClientSession(req);
    
    const organization = await db.Organization.findByPk(organizationId);
    if (!organization) {
      return res.redirect('/portal/logout');
    }

    const services = await db.Service.findAll({
      where: {
        organizationId: organizationId,
        isActive: true
      },
      order: [['name', 'ASC']]
    });

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
 */
exports.postNovoAgendamento = async (req, res) => {
  try {
    const { clientId, organizationId } = getClientSession(req);
    const { serviceId, staffId, date, time } = req.body;

    if (!serviceId || !date || !time) {
      req.flash('error', 'Serviço, data e hora são obrigatórios.');
      return res.redirect('/portal/agendar');
    }

    // 1. Busca o serviço
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
    
    // --- CORREÇÃO AQUI: Parse seguro com plugin customParseFormat ---
    const start = dayjs.tz(`${date}T${time}`, 'YYYY-MM-DDTHH:mm', tz);
    
    if (!start.isValid()) {
       req.flash('error', 'Data ou hora inválida.');
       return res.redirect('/portal/agendar');
    }

    const end = start.add(duration, 'minute');

    if (staffId) {
      // 2. Valida Profissional
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

      // 3. Verifica se profissional faz o serviço
      const staffServices = await staffMember.getServices({ where: { id: serviceId } });
      if (staffServices.length === 0) {
        req.flash('error', 'O profissional selecionado não realiza este serviço.');
        return res.redirect('/portal/agendar');
      }

      // 4. Verifica Horário de Trabalho
      const dayName = start.format('dddd').toLowerCase();
      const workSchedule = staffMember.workingHours ? staffMember.workingHours[dayName] : null; 

      if (!workSchedule || workSchedule.isOff) {
        req.flash('error', 'O profissional não atende neste dia da semana.');
        return res.redirect('/portal/agendar');
      }
      
      // Validação simplificada de expediente (considera hora inicial do primeiro turno e final do último)
      const openingTime = dayjs.tz(`${date}T${workSchedule.startTime || workSchedule.startTime1}`, 'YYYY-MM-DDTHH:mm', tz);
      // Pega o fim do turno 2, se existir, senão pega do turno único/1
      const endTimeStr = workSchedule.endTime2 || workSchedule.endTime || workSchedule.endTime1;
      const closingTime = dayjs.tz(`${date}T${endTimeStr}`, 'YYYY-MM-DDTHH:mm', tz);

      if (start.isBefore(openingTime) || end.isAfter(closingTime)) {
        req.flash('error', 'O horário solicitado está fora do expediente do profissional.');
        return res.redirect('/portal/agendar');
      }

      // 5. Verificação de Conflito
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

    // 6. Criar Agendamento
    await db.sequelize.transaction(async (t) => {
      const newAppointment = await db.Appointment.create({
        organizationId: organizationId,
        clientId: clientId,
        staffId: staffId || null,
        date: start.toDate(),
        duration: duration,
        status: 'pendente',
        clientNotified: true,
      }, { transaction: t });

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

/**
 * API GET /api/portal/staff-by-service/:serviceId
 */
exports.getStaffByService = async (req, res) => {
  try {
    const { serviceId } = req.params;
    const { organizationId } = getClientSession(req);

    const staffList = await db.Staff.findAll({
      where: {
        organizationId: organizationId,
        isActive: true
      },
      include: [{
        model: db.Service,
        where: { id: serviceId },
        attributes: [] 
      }],
      attributes: ['name', 'id']
    });

    res.status(200).json(staffList);

  } catch (err) {
    console.error('API Error: getStaffByService', err);
    res.status(500).json({ error: 'Erro ao buscar profissionais.' });
  }
};

/**
 * API GET /api/portal/available-times
 * Suporta 2 turnos (Manhã/Tarde)
 */
exports.getAvailableTimes = async (req, res) => {
  try {
    const { serviceId, staffId, date } = req.query;
    const { organizationId } = getClientSession(req);

    if (!serviceId || !staffId || !date) {
      return res.status(400).json({ error: 'Parâmetros inválidos.' });
    }

    const [service, staffMember] = await Promise.all([
      db.Service.findByPk(serviceId, { attributes: ['duration'] }),
      db.Staff.findByPk(staffId, { attributes: ['workingHours'] })
    ]);

    if (!service || !staffMember) {
      return res.status(404).json({ error: 'Serviço ou profissional não encontrado.' });
    }

    if (!staffMember.workingHours) {
        return res.status(200).json([]); 
    }

    const targetDay = dayjs.tz(date, 'YYYY-MM-DD', tz);
    if (!targetDay.isValid()) {
        return res.status(400).json({ error: 'Data inválida.' });
    }
    
    const dayName = targetDay.format('dddd').toLowerCase();
    const workSchedule = staffMember.workingHours[dayName]; 

    if (!workSchedule || workSchedule.isOff) {
      return res.status(200).json([]);
    }

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
    const slotInterval = 30; 
    const availableSlots = [];
    const dateString = targetDay.format('YYYY-MM-DD');
    const now = dayjs().tz(tz);

    // Função auxiliar para gerar slots
    const generateSlots = (startStr, endStr) => {
        if (!startStr || !endStr) return;

        // Com customParseFormat carregado, isso funciona corretamente agora
        const startTime = dayjs.tz(`${dateString}T${startStr}`, 'YYYY-MM-DDTHH:mm', tz);
        const endTime = dayjs.tz(`${dateString}T${endStr}`, 'YYYY-MM-DDTHH:mm', tz);
        
        let currentSlot = startTime;

        while (currentSlot.isBefore(endTime)) {
            const slotEnd = currentSlot.add(serviceDuration, 'minute');

            if (slotEnd.isAfter(endTime)) {
                break;
            }

            let isBooked = false;
            for (const appt of existingAppointments) {
                const apptStart = dayjs(appt.date).tz(tz);
                const apptEnd = apptStart.add(appt.duration, 'minute');

                if (currentSlot.isBefore(apptEnd) && slotEnd.isAfter(apptStart)) {
                    isBooked = true;
                    break; 
                }
            }

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

    // Gera slots para Turno 1
    generateSlots(workSchedule.startTime1 || workSchedule.startTime, workSchedule.endTime1 || workSchedule.endTime);

    // Gera slots para Turno 2 (se existir)
    if (workSchedule.startTime2 && workSchedule.endTime2) {
        generateSlots(workSchedule.startTime2, workSchedule.endTime2);
    }

    const uniqueSlots = [...new Set(availableSlots)].sort();

    res.status(200).json(uniqueSlots);

  } catch (err) {
    console.error('API Error: getAvailableTimes', err);
    res.status(500).json({ error: 'Erro interno ao calcular horários.' });
  }
};