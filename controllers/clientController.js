// controllers/clientController.js
const Client = require('../models/Client');
const Appointment = require('../models/Appointment');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Pega o ID da organização logada a partir da sessão.
 * Esta é a chave de segurança para o multi-salão.
 */
const getOrgId = (req) => req.session.organizationId;

// --- Home e Busca de Clientes ---
exports.getClients = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    // Filtra clientes APENAS desta organização
    const clients = await Client.find({ organizationId: organizationId }).sort({ name: 1 });
    res.render('home', {
        clients,
        error: req.query.error || null,
        success: req.query.success || null // Passa success para home.ejs também
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
    const regex = new RegExp(q, 'i');

    // Busca APENAS dentro da organização
    const clients = await Client.find({
      organizationId: organizationId, // <-- FILTRO DE SEGURANÇA
      $or: [{ name: regex }, { phone: regex }]
    });
    res.render('home', { clients, error: null, success: null });
  } catch (err) {
    console.error(err);
    res.render('home', { clients: [], error: 'Erro ao buscar clientes.', success: null });
  }
};

// --- Criar Cliente (com validação de duplicata) ---
exports.createClient = async (req, res) => {
  const organizationId = getOrgId(req); // Pega o ID do salão
  try {
    const { name, phone } = req.body;
    const trimmedName = name.trim();
    const normalizedPhone = phone.replace(/\D/g, '');

    // Procura duplicatas APENAS dentro da organização
    const existing = await Client.findOne({
      organizationId: organizationId, // <-- FILTRO DE SEGURANÇA
      $or: [
        { name: trimmedName },
        { phone: { $regex: normalizedPhone + '$' } }
      ]
    });

    if (existing) {
      const errorMsg = existing.name === trimmedName
        ? 'Já existe um cliente cadastrado com esse nome.'
        : 'Já existe um cliente cadastrado com esse telefone.';
      // Busca clientes APENAS desta organização para renderizar o erro
      const clients = await Client.find({ organizationId: organizationId }).sort({ name: 1 });
      return res.render('home', { clients, error: errorMsg, success: null });
    }

    // "Etiqueta" o novo cliente com o ID da organização
    await Client.create({
      name: trimmedName,
      phone: normalizedPhone,
      organizationId: organizationId // <-- ETIQUETA DE SEGURANÇA
    });
    res.redirect('/clients?success=Cliente criado com sucesso!');
  } catch (err) {
    console.error(err);
    // Em caso de erro, recarrega a página com a mensagem
    const clients = await Client.find({ organizationId: organizationId }).sort({ name: 1 });
    res.render('home', { clients, error: 'Erro ao criar cliente.', success: null });
  }
};

// --- Página do Cliente (Futuros + Produtos) ---
exports.getClientById = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const { id } = req.params;
    // <<< CORREÇÃO AQUI (Problema 2: Pega success/error da URL)
    const { success, error } = req.query;

    // Busca o cliente APENAS se ele pertencer a esta organização
    const client = await Client.findOne({ _id: id, organizationId: organizationId });

    // Se não encontrar (ou se pertencer a outro salão), redireciona
    if (!client) {
      return res.redirect('/clients?error=Cliente não encontrado');
    }

    // Busca agendamentos APENAS desta organização
    const allAppts = await Appointment.find({
      clientId: client._id,
      organizationId: organizationId // <-- FILTRO DE SEGURANÇA
    });

    const midnight = dayjs().tz('America/Sao_Paulo').startOf('day').toDate();

    let display = allAppts
      .map(a => ({
        ...a.toObject(),
        formatted: dayjs(a.date).tz('America/Sao_Paulo')
          .format('DD/MM/YYYY [às] HH:mm')
      }))
      .filter(a => {
        // <<< CORREÇÃO AQUI (Problema 1: Exclui cancelados pelo salão)
        if (a.status === 'cancelado_pelo_salao') {
            return false;
        }

        // Mostrar se for futuro (ou hoje)
        if (a.date >= midnight) return true;

        // Ou mostrar se for passado MAS tiver pendências financeiras
        const svcPending = (a.services || []).some(s => (s.payments || []).reduce((sum, p) => sum + p.amount, 0) < s.price);
        if (svcPending) return true;

        const prodPending = (a.products || []).some(p => (p.payments || []).reduce((sum, q) => sum + q.amount, 0) < p.price);
        if (prodPending) return true;

        // Se for passado e sem pendências (e não cancelado pelo salão), não mostra
        return false;
      });


    display.sort((a, b) => new Date(a.date) - new Date(b.date));

    // Cálculos (sem alteração significativa, apenas segurança com || [])
    let totalService = 0, totalPaidService = 0, totalProduct = 0, totalPaidProduct = 0;
    display.forEach(a => {
        (a.services || []).forEach(s => {
            totalService += s.price || 0;
            totalPaidService += (s.payments || []).reduce((sum, p) => sum + (p.amount || 0), 0);
        });
        (a.products || []).forEach(p => {
             totalProduct += p.price || 0;
             totalPaidProduct += (p.payments || []).reduce((sum, pay) => sum + (pay.amount || 0), 0);
        });
    });
    (client.products || []).forEach(p => {
      totalProduct += p.price || 0;
      totalPaidProduct += (p.payments || []).reduce((sum, pay) => sum + (pay.amount || 0), 0);
    });

    res.render('client', {
      client,
      appointments: display,
      totalService, totalPaidService,
      totalProduct, totalPaidProduct,
      isHistory: false,
      paidProducts: [],
      // <<< CORREÇÃO AQUI (Problema 2: Passa success/error para o EJS)
      error: error || null,
      success: success || null
    });

  } catch (err) {
    console.error(err);
    res.redirect('/clients?error=Erro ao carregar dados do cliente.');
  }
};

// --- Histórico (Passados) ---
// (Esta função já estava correta em relação a mostrar cancelados e não precisa passar success/error diretamente)
exports.getClientHistory = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const { id } = req.params;

    // Busca o cliente APENAS se ele pertencer a esta organização
    const client = await Client.findOne({ _id: id, organizationId: organizationId });
    if (!client) {
      return res.redirect('/clients?error=Cliente não encontrado');
    }

    // Busca agendamentos APENAS desta organização
    const all = await Appointment.find({
      clientId: client._id,
      organizationId: organizationId // <-- FILTRO DE SEGURANÇA
    });

    const midnight = dayjs().tz('America/Sao_Paulo').startOf('day').toDate();

    const past = all
      .map(a => ({
        ...a.toObject(),
        formatted: dayjs(a.date).tz('America/Sao_Paulo').format('DD/MM/YYYY [às] HH:mm')
      }))
      .filter(a => {
          if (a.date < midnight) return true;
          if (['concluido', 'cancelado_pelo_cliente', 'cancelado_pelo_salao'].includes(a.status)) return true;
          
          const isFuture = a.date >= midnight;
          const hasPendingPayments = (a.services || []).some(s => (s.payments || []).reduce((sum, p) => sum + p.amount, 0) < s.price) ||
                                     (a.products || []).some(p => (p.payments || []).reduce((sum, q) => sum + q.amount, 0) < p.price);

          if (isFuture || hasPendingPayments) return false;

          return true;
      });

    past.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Cálculos (sem alteração significativa)
    let totalService = 0, totalPaidService = 0, totalProduct = 0, totalPaidProduct = 0;
    past.forEach(a => {
        (a.services || []).forEach(s => {
            totalService += s.price || 0;
            totalPaidService += (s.payments || []).reduce((sum, p) => sum + (p.amount || 0), 0);
        });
        (a.products || []).forEach(p => {
             totalProduct += p.price || 0;
             totalPaidProduct += (p.payments || []).reduce((sum, pay) => sum + (pay.amount || 0), 0);
        });
    });
    const paidProducts = (client.products || [])
      .filter(prod => (prod.payments || []).reduce((sum, pay) => sum + pay.amount, 0) >= prod.price)
      .map(prod => ({
        name: prod.name,
        price: prod.price,
        payments: (prod.payments || []).map(p => ({
          ...p.toObject(),
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
      error: null, // Histórico não recebe erros/sucessos via query params normalmente
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

    // Deleta o cliente APENAS se pertencer a esta organização
    const deletedClient = await Client.findOneAndDelete({ _id: id, organizationId: organizationId });

    if (!deletedClient) {
        return res.redirect('/clients?error=Cliente não encontrado para exclusão.');
    }

    // Deleta os agendamentos APENAS desta organização
    await Appointment.deleteMany({ clientId: id, organizationId: organizationId });

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

    // Atualiza o cliente APENAS se pertencer a esta organização
    const updatedClient = await Client.findOneAndUpdate(
      { _id: id, organizationId: organizationId }, // <-- FILTRO DE SEGURANÇA
      { name, phone }
    );

    if (!updatedClient) {
        return res.redirect('/clients?error=Cliente não encontrado para edição.');
    }

    res.redirect(`/client/${id}?success=Cliente atualizado com sucesso!`);
  } catch (err) {
    console.error(err);
    res.redirect(`/client/${req.params.id}?error=Erro ao editar cliente.`);
  }
};


// ─── Produtos do Cliente ────────────────────────────────────
// (Sem alterações nestas funções)
exports.addProductToClient = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const { id } = req.params;
    const { name, price } = req.body;

    // Atualiza o cliente (adiciona produto) APENAS se pertencer a esta organização
    const updatedClient = await Client.findOneAndUpdate(
      { _id: id, organizationId: organizationId }, // <-- FILTRO DE SEGURANÇA
      { $push: { products: { name, price: parseFloat(price), payments: [] } } }
    );
     // Se não encontrou o cliente
    if (!updatedClient) {
        return res.redirect('/clients?error=Cliente não encontrado.');
    }
    res.redirect(`/client/${id}?success=Produto adicionado com sucesso!`); // Redireciona com sucesso
  } catch (err) {
    console.error(err);
    res.redirect(`/client/${req.params.id}?error=Erro ao adicionar produto.`);
  }
};

exports.editClientProduct = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const { id, pi } = req.params;
    const { name, price } = req.body;

    // Busca o cliente APENAS se pertencer a esta organização
    const client = await Client.findOne({ _id: id, organizationId: organizationId });
    if (!client) {
      return res.redirect('/clients?error=Cliente não encontrado');
    }

    const prod = client.products[pi];
    if (prod) {
      prod.name = name;
      prod.price = parseFloat(price);
      await client.save();
      res.redirect(`/client/${id}?success=Produto editado com sucesso!`); // Redireciona com sucesso
    } else {
        res.redirect(`/client/${id}?error=Produto não encontrado para edição.`);
    }
  } catch (err) {
    console.error(err);
    res.redirect(`/client/${req.params.id}?error=Erro ao editar produto.`);
  }
};

exports.deleteClientProduct = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const { id, pi } = req.params;

    const client = await Client.findOne({ _id: id, organizationId: organizationId });
    if (!client) {
      return res.redirect('/clients?error=Cliente não encontrado');
    }

    if (client.products[pi]) {
      client.products.splice(pi, 1);
      await client.save();
      res.redirect(`/client/${id}?success=Produto excluído com sucesso!`); // Redireciona com sucesso
    } else {
        res.redirect(`/client/${id}?error=Produto não encontrado para exclusão.`);
    }
  } catch (err) {
    console.error(err);
    res.redirect(`/client/${req.params.id}?error=Erro ao excluir produto.`);
  }
};

exports.payClientProduct = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const { id, pi } = req.params;
    const { amount, method, description, paidAt } = req.body;

    const client = await Client.findOne({ _id: id, organizationId: organizationId });
    if (!client) {
      return res.redirect('/clients?error=Cliente não encontrado');
    }

    const prod = client.products[pi];
    if (prod) {
      const val = parseFloat(amount);
      const when = paidAt ? dayjs.tz(paidAt, dayjs.ISO_8601, 'America/Sao_Paulo').toDate() : new Date();

      // Validação básica do pagamento
      if (isNaN(val) || val <= 0) {
          return res.redirect(`/client/${id}?error=Valor de pagamento inválido.`);
      }
      if (!['pix', 'dinheiro', 'cartao'].includes(method.toLowerCase())) {
          return res.redirect(`/client/${id}?error=Método de pagamento inválido.`);
      }

      prod.payments.push({
        amount: val,
        paidAt: when,
        method: method.toLowerCase(), // Padronizando
        description: description || ''
      });
      await client.save();
      res.redirect(`/client/${id}?success=Pagamento registrado com sucesso!`); // Redireciona com sucesso
    } else {
        res.redirect(`/client/${id}?error=Produto não encontrado para pagamento.`);
    }
  } catch (err) {
    console.error(err);
    res.redirect(`/client/${req.params.id}?error=Erro ao salvar pagamento.`);
  }
}; 

exports.removeClientProductPayment = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const { id, pi, pj } = req.params;

    const client = await Client.findOne({ _id: id, organizationId: organizationId });
    if (!client) {
      return res.redirect('/clients?error=Cliente não encontrado');
    }

    if (client.products[pi] && client.products[pi].payments[pj]) {
      client.products[pi].payments.splice(pj, 1);
      await client.save();
      res.redirect(`/client/${id}?success=Pagamento removido com sucesso!`); // Redireciona com sucesso
    } else {
        res.redirect(`/client/${id}?error=Pagamento não encontrado para remoção.`);
    }
  } catch (err) {
    console.error(err);
    res.redirect(`/client/${req.params.id}?error=Erro ao remover pagamento.`);
  }
};

