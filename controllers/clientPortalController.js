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
 * O "Dashboard" principal do cliente.
 * Mostra próximos agendamentos, histórico e produtos.
 */
exports.getMinhaArea = async (req, res) => {
  try {
    const { clientId, organizationId, clientName } = getClientSession(req);
    const tz = 'America/Sao_Paulo';

    // 1. Buscar a organização (para mostrar o nome do salão)
    const organization = await Organization.findById(organizationId);
    if (!organization) {
      return res.redirect('/portal/logout');
    }

    // 2. Buscar todos os agendamentos deste cliente, ordenados
    const todosAgendamentos = await Appointment.find({
      clientId: clientId,
      organizationId: organizationId
    })
    .sort({ date: -1 }) // Mais recentes primeiro
    .populate('staffId', 'name'); // Pega o nome do profissional

    const agora = dayjs().tz(tz);
    const proximos = [];
    const historico = [];

    // =================================
    // ===     NOVA ALTERAÇÃO AQUI     ===
    // =================================
    // 3. Separar agendamentos em "Próximos" vs "Histórico" E ADICIONAR MOTIVO
    todosAgendamentos.forEach(appt => {
      const apptData = {
        _id: appt._id,
        date: dayjs(appt.date).tz(tz).format('DD/MM/YYYY'),
        time: dayjs(appt.date).tz(tz).format('HH:mm'),
        status: appt.status, // 'pendente', 'confirmado', 'concluido', etc.
        services: appt.services.map(s => s.name).join(', '),
        staffName: appt.staffId ? appt.staffId.name : 'Qualquer Profissional',
        total: appt.services.reduce((sum, s) => sum + s.price, 0),
        cancellationReason: null // Inicializa como nulo
      };

      // Adiciona o motivo APENAS se for cancelado pelo salão
      if (appt.status === 'cancelado_pelo_salao') {
          apptData.cancellationReason = appt.cancellationReason;
      }
      
      // Classifica o agendamento
      if (appt.status === 'concluido' || appt.status.startsWith('cancelado_')) {
        historico.push(apptData);
      } 
      // Mostra nos próximos se ainda não passou ou se passou há menos de 1 hora (margem)
      else if (dayjs(appt.date).tz(tz).isAfter(agora.subtract(1, 'hour'))) { 
        proximos.push(apptData);
      } 
      // Se passou há mais de 1 hora e não está concluído/cancelado (ex: confirmado antigo), vai pro histórico
      else {
        historico.push(apptData);
      }
    });
    // =================================
    // === FIM DA ALTERAÇÃO          ===
    // =================================

    
    // 4. Buscar e processar os produtos comprados pelo cliente
    const clientData = await Client.findById(clientId).select('products');
    const produtosPendentes = [];  // Lista para produtos pendentes
    const historicoProdutos = []; // Lista para produtos já pagos

    if (clientData.products && clientData.products.length > 0) {
      clientData.products.forEach(p => {
        const totalPaid = (p.payments || []).reduce((sum, pay) => sum + pay.amount, 0);
        const isPending = totalPaid < p.price;

        const formattedProduct = {
          name: p.name,
          price: p.price,
          // Corrigido para buscar timestamp do _id, se 'addedAt' não existir
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

    // 5. Renderizar a view do dashboard do cliente
    res.render('client/dashboard', { // Seu EJS chama-se 'dashboard.ejs' dentro de 'views/client'
      clientName: clientName,
      orgName: organization.name,
      proximosAgendamentos: proximos.reverse(), // Correto, para inverter a ordem
      historicoAgendamentos: historico, // Já está na ordem correta (mais recentes primeiro)
      produtosPendentes: produtosPendentes,     
      historicoProdutos: historicoProdutos,   
      error: req.query.error || null,
      success: req.query.success || null
    });

  } catch (err) {
    console.error('Erro ao carregar /minha-area do cliente:', err);
    res.status(500).send('Erro interno do servidor.');
  }
};

/**
 * GET /portal/agendar
 * Página para o cliente iniciar um novo agendamento.
 * (Seu código original - Sem alterações)
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
      error: req.query.error || null // Mostra erro de conflito, se houver
    });

  } catch (err) {
    console.error('Erro ao carregar página de agendamento:', err);
    res.redirect('/portal/minha-area?error=Erro ao carregar página de agendamento.');
  }
};

/**
 * POST /portal/agendar
 * Processa a solicitação de um novo agendamento do cliente.
 * (Seu código original - Sem alterações)
 */
exports.postNovoAgendamento = async (req, res) => {
  try {
    const { clientId, organizationId } = getClientSession(req);
    const { serviceId, staffId, date, time } = req.body;
    const tz = 'America/Sao_Paulo';

    // 1. Validação básica
    if (!serviceId || !date || !time) {
      return res.redirect('/portal/agendar?error=Serviço, data e hora são obrigatórios.');
    }

    // 2. Buscar o serviço no DB (para segurança e para pegar dados)
    const service = await Service.findOne({
      _id: serviceId,
      organizationId: organizationId
    });

    if (!service) {
      return res.redirect('/portal/agendar?error=Serviço não encontrado.');
    }

    // 3. Pegar os dados do serviço
    const duration = service.duration;
    const serviceName = service.name;
    const servicePrice = service.price;

    // 4. Calcular datas
    const start = dayjs.tz(`${date}T${time}`, tz).toDate();
    const end = dayjs(start).add(duration, 'minute').toDate();

    // 5. [Opcional] Verificação de Conflito
    // Se um profissional foi escolhido, verifica se ELE está livre
    if (staffId) {
      const conflict = await Appointment.findOne({
        organizationId: organizationId,
        staffId: staffId,
        status: { $in: ['pendente', 'confirmado'] }, // Verifica pendentes e confirmados
        date: { $lt: end },
        $expr: {
          $gt: [
            { $add: ['$date', { $multiply: ['$duration', 60000] }] },
            start
          ]
        }
      });
      
      if (conflict) {
        return res.redirect('/portal/agendar?error=Este profissional já possui um agendamento neste horário.');
      }
    }
    // (Se 'qualquer profissional' for escolhido, o admin aprovará manually)

    // 6. Criar o agendamento
    const newAppointment = new Appointment({
      organizationId: organizationId,
      clientId: clientId,
      staffId: staffId || null, // Salva null se 'qualquer'
      date: start,
      duration: duration,
      status: 'pendente', // <-- O agendamento começa PENDENTE
      services: [{
        serviceId: service._id,
        name: serviceName,
        price: servicePrice,
        payments: []
      }],
      products: []
    });

    await newAppointment.save();

    // 7. Redirecionar para o dashboard com sucesso
    res.redirect('/portal/minha-area?success=Agendamento solicitado! Aguarde a confirmação do salão.');

  } catch (err) {
    console.error('Erro ao salvar agendamento do cliente:', err);
    res.redirect('/portal/agendar?error=Erro ao salvar seu agendamento. Tente novamente.');
  }
};