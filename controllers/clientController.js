// controllers/clientController.js
const db = require('../models');
const { Op } = require('sequelize'); // Para $or, $regex (iLike)

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

const getOrgId = (req) => req.session.organizationId;

// --- Home e Busca de Clientes ---
exports.getClients = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    // ATUALIZADO: Client.find().sort() -> db.Client.findAll({ order: ... })
    const clients = await db.Client.findAll({ 
      where: { organizationId: organizationId },
      order: [['name', 'ASC']] 
    });
    res.render('home', {
        clients,
        error: req.query.error || null,
        success: req.query.success || null
    });
  } catch (err) {
    console.error(err);
    res.render('home', { clients: [], error: 'Erro ao carregar clientes.', success: null });
  }
};

exports.searchClients = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const q = req.query.q?.trim() || '';
    
    // ATUALIZADO: new RegExp(q, 'i') -> { [Op.iLike]: ... }
    // ATUALIZADO: $or -> [Op.or]
    const clients = await db.Client.findAll({
      where: {
        organizationId: organizationId,
        [Op.or]: [
          { name: { [Op.iLike]: `%${q}%` } }, // 'iLike' é case-insensitive
          { phone: { [Op.iLike]: `%${q}%` } }
        ]
      }
    });
    res.render('home', { clients, error: null, success: null });
  } catch (err) {
    console.error(err);
    res.render('home', { clients: [], error: 'Erro ao buscar clientes.', success: null });
  }
};

// --- Criar Cliente (com validação de duplicata) ---
exports.createClient = async (req, res) => {
  const organizationId = getOrgId(req);
  try {
    const { name, phone } = req.body;
    const trimmedName = name.trim();
    const normalizedPhone = phone.replace(/\D/g, '');

    // ATUALIZADO: Client.findOne({ $or: ... })
    const existing = await db.Client.findOne({
      where: {
        organizationId: organizationId,
        [Op.or]: [
          { name: trimmedName },
          { phone: normalizedPhone } // $regex ...$ vira uma busca exata
        ]
      }
    });

    if (existing) {
      const errorMsg = existing.name === trimmedName
        ? 'Já existe um cliente cadastrado com esse nome.'
        : 'Já existe um cliente cadastrado com esse telefone.';
      const clients = await db.Client.findAll({ where: { organizationId: organizationId }, order: [['name', 'ASC']] });
      return res.render('home', { clients, error: errorMsg, success: null });
    }

    // ATUALIZADO: Client.create() -> db.Client.create()
    await db.Client.create({
      name: trimmedName,
      phone: normalizedPhone,
      organizationId: organizationId
    });
    res.redirect('/clients?success=Cliente criado com sucesso!');
  } catch (err) {
    console.error(err);
    const clients = await db.Client.findAll({ where: { organizationId: organizationId }, order: [['name', 'ASC']] });
    res.render('home', { clients, error: 'Erro ao criar cliente.', success: null });
  }
};

// --- Página do Cliente (Futuros + Produtos) ---
exports.getClientById = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const { id } = req.params;
    const { success, error } = req.query;

    // 1. Busca Cliente (incluindo produtos)
    const client = await db.Client.findOne({ 
      where: { id: id, organizationId: organizationId },
      include: [
        { 
          model: db.Product, 
          include: [db.Payment] 
        }
      ]
    });

    if (!client) {
      return res.redirect('/clients?error=Cliente não encontrado');
    }

    const organization = await db.Organization.findByPk(organizationId);

    // 2. Busca Agendamentos
    const allAppts = await db.Appointment.findAll({
      where: {
        clientId: client.id, // ATUALIZADO: client._id -> client.id
        organizationId: organizationId
      },
      include: [
        { model: db.AppointmentService, include: [db.AppointmentPayment] },
        { model: db.AppointmentProduct, include: [db.AppointmentPayment] }
      ]
    });

    // --- NOVO: Busca Profissionais Ativos (Staff) para o Dropdown ---
    const staff = await db.Staff.findAll({
        where: { organizationId: organizationId, isActive: true },
        attributes: ['id', 'name'],
        order: [['name', 'ASC']]
    });
    // ----------------------------------------------------------------

    const midnight = dayjs().tz('America/Sao_Paulo').startOf('day').toDate();

    let display = allAppts
      .map(a => ({
        ...a.get({ plain: true }), // .get({ plain: true }) é o .toObject()
        formatted: dayjs(a.date).tz('America/Sao_Paulo')
          .format('DD/MM/YYYY [às] HH:mm')
      }))
      .filter(a => {
        if (a.status === 'cancelado_pelo_salao') {
            return false;
        }
        if (a.date >= midnight) return true;

        // ATUALIZADO: a.services -> a.AppointmentServices, etc.
        const svcPending = (a.AppointmentServices || []).some(s => (s.AppointmentPayments || []).reduce((sum, p) => sum + parseFloat(p.amount), 0) < parseFloat(s.price));
        if (svcPending) return true;

        const prodPending = (a.AppointmentProducts || []).some(p => (p.AppointmentPayments || []).reduce((sum, q) => sum + parseFloat(q.amount), 0) < parseFloat(p.price));
        if (prodPending) return true;

        return false;
      });

    display.sort((a, b) => new Date(a.date) - new Date(b.date));

    // Cálculos (ATUALIZADO para novos nomes de modelo)
    let totalService = 0, totalPaidService = 0, totalProduct = 0, totalPaidProduct = 0;
    display.forEach(a => {
        (a.AppointmentServices || []).forEach(s => {
            totalService += parseFloat(s.price || 0);
            totalPaidService += (s.AppointmentPayments || []).reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
        });
        (a.AppointmentProducts || []).forEach(p => {
             totalProduct += parseFloat(p.price || 0);
             totalPaidProduct += (p.AppointmentPayments || []).reduce((sum, pay) => sum + (parseFloat(pay.amount) || 0), 0);
        });
    });
    // ATUALIZADO: client.products -> client.Products
    (client.Products || []).forEach(p => {
      totalProduct += parseFloat(p.price || 0);
      // ATUALIZADO: p.payments -> p.Payments
      totalPaidProduct += (p.Payments || []).reduce((sum, pay) => sum + (parseFloat(pay.amount) || 0), 0);
    });

    res.render('client', {
      client, // O client já contém client.Products
      appointments: display,
      staff, // <--- Passa a lista de profissionais para a View
      totalService, totalPaidService,
      totalProduct, totalPaidProduct,
      isHistory: false,
      paidProducts: [],
      error: error || null,
      success: success || null,
      organization: organization
    });

  } catch (err) {
    console.error(err);
    res.redirect('/clients?error=Erro ao carregar dados do cliente.');
  }
};

// --- Histórico (Passados) ---
exports.getClientHistory = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const { id } = req.params;

    // ATUALIZADO: Busca o cliente com seus produtos/pagamentos de varejo
    const client = await db.Client.findOne({ 
      where: { id: id, organizationId: organizationId },
      include: [
        { 
          model: db.Product, 
          include: [db.Payment] 
        }
      ]
    });
    if (!client) {
      return res.redirect('/clients?error=Cliente não encontrado');
    }

    // ATUALIZADO: Busca agendamentos com seus itens/pagamentos
    const all = await db.Appointment.findAll({
      where: {
        clientId: client.id,
        organizationId: organizationId
      },
      include: [
        { model: db.AppointmentService, include: [db.AppointmentPayment] },
        { model: db.AppointmentProduct, include: [db.AppointmentPayment] }
      ]
    });

    const midnight = dayjs().tz('America/Sao_Paulo').startOf('day').toDate();

    const past = all
      .map(a => ({
        ...a.get({ plain: true }), // .toObject()
        formatted: dayjs(a.date).tz('America/Sao_Paulo').format('DD/MM/YYYY [às] HH:mm')
      }))
      .filter(a => {
          if (a.date < midnight) return true;
          if (['concluido', 'cancelado_pelo_cliente', 'cancelado_pelo_salao'].includes(a.status)) return true;
          
          const isFuture = a.date >= midnight;
          // ATUALIZADO: a.services -> a.AppointmentServices, etc.
          const hasPendingPayments = (a.AppointmentServices || []).some(s => (s.AppointmentPayments || []).reduce((sum, p) => sum + parseFloat(p.amount), 0) < parseFloat(s.price)) ||
                                     (a.AppointmentProducts || []).some(p => (p.AppointmentPayments || []).reduce((sum, q) => sum + parseFloat(q.amount), 0) < parseFloat(q.price));

          if (isFuture || hasPendingPayments) return false;

          return true;
      });

    past.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Cálculos (ATUALIZADO)
    let totalService = 0, totalPaidService = 0, totalProduct = 0, totalPaidProduct = 0;
    past.forEach(a => {
        (a.AppointmentServices || []).forEach(s => {
            totalService += parseFloat(s.price || 0);
            totalPaidService += (s.AppointmentPayments || []).reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
        });
        (a.AppointmentProducts || []).forEach(p => {
             totalProduct += parseFloat(p.price || 0);
             totalPaidProduct += (p.AppointmentPayments || []).reduce((sum, pay) => sum + (parseFloat(pay.amount) || 0), 0);
        });
    });
    // ATUALIZADO: client.products -> client.Products
    const paidProducts = (client.Products || [])
      .filter(prod => (prod.Payments || []).reduce((sum, pay) => sum + parseFloat(pay.amount), 0) >= parseFloat(prod.price))
      .map(prod => ({
        ...prod.get({ plain: true }), // .toObject()
        payments: (prod.Payments || []).map(p => ({
          ...p.get({ plain: true }),
          formattedDate: dayjs(p.paidAt).tz('America/Sao_Paulo').format('DD/MM/YYYY')
        }))
      }));

    res.render('client', {
      client,
      appointments: past,
      isHistory: true,
      totalService, totalPaidService,
      totalProduct, totalPaidProduct,
      paidProducts,
      error: null,
      success: null
    });
  } catch (err) {
    console.error(err);
    res.redirect(`/client/${req.params.id}?error=Erro ao carregar histórico.`);
  }
};

// --- Excluir Cliente + Agendamentos ---
exports.deleteClient = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const { id } = req.params;

    // ATUALIZADO: findOneAndDelete -> destroy
    // Graças ao 'onDelete: CASCADE' que definimos no models/index.js,
    // o PostgreSQL irá deletar automaticamente todos os Appointments,
    // Products e Payments ligados a este cliente.
    const deletedCount = await db.Client.destroy({ 
      where: { id: id, organizationId: organizationId } 
    });

    if (deletedCount === 0) {
        return res.redirect('/clients?error=Cliente não encontrado para exclusão.');
    }

    // REMOVIDO: Appointment.deleteMany() não é mais necessário.

    res.redirect('/clients?success=Cliente excluído com sucesso!');
  } catch (err) {
    console.error(err);
    res.redirect('/clients?error=Erro ao excluir cliente.');
  }
};

// --- Editar Cliente ---
exports.editClient = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const { id } = req.params;
    const { name, phone } = req.body;

    // ATUALIZADO: findOneAndUpdate -> update
    const [affectedRows] = await db.Client.update(
      { name, phone },
      { where: { id: id, organizationId: organizationId } }
    );

    if (affectedRows === 0) {
        return res.redirect('/clients?error=Cliente não encontrado para edição.');
    }

    res.redirect(`/client/${id}?success=Cliente atualizado com sucesso!`);
  } catch (err) {
    console.error(err);
    res.redirect(`/client/${req.params.id}?error=Erro ao editar cliente.`);
  }
};


// ─── Produtos do Cliente (Varejo) - TOTALMENTE REESCRITO ───

exports.addProductToClient = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const { id } = req.params; // id do Cliente
    const { name, price } = req.body;

    // 1. Verifica se o cliente existe e pertence à organização
    const client = await db.Client.findOne({ where: { id, organizationId } });
    if (!client) {
      return res.redirect('/clients?error=Cliente não encontrado.');
    }

    // 2. Cria o Produto (varejo) associado a este cliente
    // ATUALIZADO: $push -> db.Product.create
    await db.Product.create({
      name,
      price: parseFloat(price),
      clientId: id,
      organizationId: organizationId // Garante a etiqueta da organização
    });

    res.redirect(`/client/${id}?success=Produto adicionado com sucesso!`);
  } catch (err) {
    console.error(err);
    res.redirect(`/client/${req.params.id}?error=Erro ao adicionar produto.`);
  }
};

exports.editClientProduct = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const { id, pi } = req.params; // id = Cliente, pi = ID do Produto
    const { name, price } = req.body;

    // ATUALIZADO: client.save() -> db.Product.update
    // Atualiza o produto DIRETAMENTE, mas com uma cláusula 'where'
    // que garante que ele pertence ao cliente E à organização.
    const [affectedRows] = await db.Product.update(
      { name, price: parseFloat(price) },
      { where: { id: pi, clientId: id, organizationId: organizationId } }
    );

    if (affectedRows === 0) {
      return res.redirect(`/client/${id}?error=Produto não encontrado para edição.`);
    }
    
    res.redirect(`/client/${id}?success=Produto editado com sucesso!`);
  } catch (err) {
    console.error(err);
    res.redirect(`/client/${req.params.id}?error=Erro ao editar produto.`);
  }
};

exports.deleteClientProduct = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const { id, pi } = req.params; // id = Cliente, pi = ID do Produto

    // ATUALIZADO: client.products.splice -> db.Product.destroy
    // Graças ao 'onDelete: CASCADE' no modelo Product -> Payment,
    // todos os pagamentos associados a este produto serão excluídos.
    const affectedRows = await db.Product.destroy({
      where: { id: pi, clientId: id, organizationId: organizationId }
    });

    if (affectedRows === 0) {
      return res.redirect(`/client/${id}?error=Produto não encontrado para exclusão.`);
    }

    res.redirect(`/client/${id}?success=Produto excluído com sucesso!`);
  } catch (err)
 {
    console.error(err);
    res.redirect(`/client/${req.params.id}?error=Erro ao excluir produto.`);
  }
};

exports.payClientProduct = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const { id, pi } = req.params; // id = Cliente, pi = ID do Produto
    const { amount, method, description, paidAt } = req.body;

    // 1. Verifica se o produto existe e pertence ao cliente/org
    const product = await db.Product.findOne({
      where: { id: pi, clientId: id, organizationId: organizationId }
    });

    if (!product) {
      return res.redirect(`/client/${id}?error=Produto não encontrado para pagamento.`);
    }

    // Validações
    const val = parseFloat(amount);
    const when = paidAt ? dayjs.tz(paidAt, dayjs.ISO_8601, 'America/Sao_Paulo').toDate() : new Date();
    if (isNaN(val) || val <= 0) {
      return res.redirect(`/client/${id}?error=Valor de pagamento inválido.`);
    }
    if (!['pix', 'dinheiro', 'cartao'].includes(method.toLowerCase())) {
      return res.redirect(`/client/${id}?error=Método de pagamento inválido.`);
    }

    // 2. Cria o Pagamento (varejo) associado a este produto
    // ATUALIZADO: prod.payments.push -> db.Payment.create
    await db.Payment.create({
      amount: val,
      paidAt: when,
      method: method.toLowerCase(),
      description: description || '',
      productId: pi, // Associa ao produto
      organizationId: organizationId // Garante a etiqueta da organização
    });

    res.redirect(`/client/${id}?success=Pagamento registrado com sucesso!`);
  } catch (err) {
    console.error(err);
    res.redirect(`/client/${req.params.id}?error=Erro ao salvar pagamento.`);
  }
}; 

exports.removeClientProductPayment = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const { id, pi, pj } = req.params; // id=Cliente, pi=Produto, pj=Pagamento

    // ATUALIZADO: client.products[...].payments.splice -> db.Payment.destroy
    // Para segurança, encontramos o pagamento E verificamos se ele
    // pertence ao produto e organização corretos antes de deletar.
    const payment = await db.Payment.findByPk(pj, {
      include: { 
        model: db.Product, 
        attributes: ['clientId', 'organizationId'] 
      }
    });

    if (!payment || 
        !payment.Product || 
        payment.Product.clientId != id || 
        payment.Product.organizationId != organizationId ||
        payment.productId != pi) {
      return res.redirect(`/client/${id}?error=Pagamento não encontrado para remoção.`);
    }
    
    await payment.destroy(); // Deleta o pagamento

    res.redirect(`/client/${id}?success=Pagamento removido com sucesso!`);
  } catch (err) {
    console.error(err);
    res.redirect(`/client/${req.params.id}?error=Erro ao remover pagamento.`);
  }
};