// controllers/financialController.js
const Client = require('../models/Client');
const Appointment = require('../models/Appointment');
const Expense = require('../models/Expense');
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

exports.getFinanceiro = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const { day, month, week } = req.query;

    let dateStart, dateEnd;
    let label = 'Geral';
    let dayValue = '', monthValue = '', weekValue = '';

    // Lógica de datas (não muda)
    if (day) {
      dayValue = day;
      dateStart = dayjs.tz(`${day}T00:00:00`, 'America/Sao_Paulo');
      dateEnd = dateStart.endOf('day');
      label = `Dia ${dateStart.format('DD/MM/YYYY')}`;
    }
    else if (month) {
      monthValue = month;
      dateStart = dayjs.tz(`${month}-01T00:00:00`, 'America/Sao_Paulo');
      dateEnd = dateStart.endOf('month');
      label = `${dateStart.format('MMMM [de] YYYY')}`;
    }
    else if (week) {
      weekValue = week;
      const [y, w] = week.split('-W').map(Number);
      dateStart = dayjs().year(y).isoWeek(w).tz('America/Sao_Paulo').startOf('isoWeek');
      dateEnd = dateStart.clone().endOf('isoWeek');
      label = `Semana de ${dateStart.format('DD/MM')} a ${dateEnd.format('DD/MM/YYYY')}`;
    }

    // Busca dados APENAS desta organização
    const appointments = await Appointment.find({ organizationId: organizationId }).populate('clientId');
    const clients = await Client.find({ organizationId: organizationId });

    let totals = {}, overallTotal = 0;
    let totalServicos = 0, totalProdutos = 0;
    let details = {};

    const processPayment = (p, clientName, itemName, itemType) => {
      const paid = dayjs(p.paidAt).tz('America/Sao_Paulo');
      if (!dateStart || paid.isBetween(dateStart, dateEnd, null, '[]')) {
        if (itemType === 'service') totalServicos += p.amount;
        if (itemType === 'product') totalProdutos += p.amount;

        // Padroniza a chave do método
        const key = ['pix', 'dinheiro', 'cartao'].find(k => p.method.toLowerCase().includes(k)) || 'outros';
        totals[key] = (totals[key] || 0) + p.amount;
        details[key] = details[key] || [];
        details[key].push({
          date: paid.format('DD/MM/YYYY'),
          client: clientName,
          item: itemName,
          amount: p.amount.toFixed(2),
          description: p.description || ''
        });
      }
    };

    appointments.forEach(a => {
      // Verifica se clientId existe antes de acessar .name
      const clientName = a.clientId ? a.clientId.name : 'Cliente Excluído';
      a.services.forEach(svc => svc.payments.forEach(p => processPayment(p, clientName, svc.name, 'service')));
      a.products.forEach(prod => prod.payments.forEach(p => processPayment(p, clientName, prod.name, 'product')));
    });

    clients.forEach(c => {
      (c.products || []).forEach(prod => prod.payments.forEach(p => processPayment(p, c.name, prod.name, 'product')));
    });

    overallTotal = totalServicos + totalProdutos;

    res.render('financeiro', {
      label,
      dayValue, monthValue, weekValue,
      totals, details,
      totalServicos, totalProdutos, overallTotal,
      error: null
    });
  } catch (err) {
    console.error("Erro ao buscar financeiro:", err);
    res.render('financeiro', {
      label: 'Erro',
      dayValue: '', monthValue: '', weekValue: '',
      totals: {}, details: {},
      totalServicos: 0, totalProdutos: 0, overallTotal: 0,
      error: 'Erro ao carregar dados financeiros.'
    });
  }
};

// --- Despesas (saídas) ---
exports.getExpenses = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    // Busca despesas APENAS desta organização
    const expenses = await Expense.find({ organizationId: organizationId }).sort({ date: -1 });
    const totalDespesa = expenses.reduce((sum, e) => sum + e.amount, 0);

    res.render('expenses', {
      expenses,
      totalDespesa,
      dayjs,
      error: req.query.error || null,
      success: req.query.success || null
    });
  } catch (err) {
    console.error("Erro ao buscar despesas:", err);
    res.render('expenses', {
      expenses: [],
      totalDespesa: 0,
      dayjs,
      error: 'Erro ao carregar despesas.'
    });
  }
};

exports.createExpense = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const { date, category, description, amount } = req.body;

    // "Etiqueta" a nova despesa com o ID da organização
    await Expense.create({
      organizationId: organizationId, // <-- ETIQUETA DE SEGURANÇA
      date: new Date(date),
      category: category.toLowerCase(), // Salva em minúsculas (conforme modelo)
      description: description.trim(),
      amount: parseFloat(amount)
    });
    res.redirect('/expenses?success=Despesa salva!');
  } catch (err) {
    console.error("Erro ao criar despesa:", err);
    // Trata erros de validação do Mongoose
    if (err.name === 'ValidationError') {
      return res.redirect(`/expenses?error=${Object.values(err.errors)[0].message}`);
    }
    res.redirect('/expenses?error=Erro ao salvar despesa.');
  }
};

exports.deleteExpense = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const { id } = req.params;

    // Deleta a despesa APENAS se pertencer a esta organização
    const result = await Expense.findOneAndDelete({
      _id: id,
      organizationId: organizationId // <-- FILTRO DE SEGURANÇA
    });

    if (!result) {
      return res.redirect('/expenses?error=Despesa não encontrada.');
    }
    res.redirect('/expenses?success=Despesa excluída!');
  } catch (err) {
    console.error("Erro ao deletar despesa:", err);
    res.redirect('/expenses?error=Erro ao excluir despesa.');
  }
};

// --- Balanço ---
exports.getBalanco = async (req, res) => {
  try {
    const organizationId = getOrgId(req);

    // Busca dados APENAS desta organização
    const appointments = await Appointment.find({ organizationId: organizationId }).populate('clientId');
    const clients = await Client.find({ organizationId: organizationId });
    const expenses = await Expense.find({ organizationId: organizationId });

    let totalReceita = 0;
    const prodMap = {};
    const monthlyMap = {};

    const processPayment = (p, itemName) => {
      totalReceita += p.amount;
      const m = dayjs(p.paidAt).tz('America/Sao_Paulo').format('YYYY-MM');
      monthlyMap[m] = (monthlyMap[m] || 0) + p.amount;
      prodMap[itemName] = (prodMap[itemName] || 0) + p.amount;
    };

    appointments.forEach(a => {
      a.services.forEach(item => item.payments.forEach(p => processPayment(p, item.name)));
      a.products.forEach(item => item.payments.forEach(p => processPayment(p, item.name)));
    });
    clients.forEach(c => {
      (c.products || []).forEach(prod => prod.payments.forEach(p => processPayment(p, prod.name)));
    });

    const totalDespesa = expenses.reduce((sum, e) => sum + e.amount, 0);
    const liquido = totalReceita - totalDespesa;

    const productTotals = Object.entries(prodMap)
      .map(([name, total]) => ({ name, total }));

    const monthlyTotals = Object.entries(monthlyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([m, total]) => {
        const [year, month] = m.split('-');
        return { month: `${month}/${year}`, total };
      });

    let serviceCount = 0, productCount = 0;
    appointments.forEach(a => {
      serviceCount += a.services.length;
      productCount += a.products.length;
    });

    res.render('balanco', {
      totalReceita,
      totalDespesa,
      liquido,
      productTotals,
      monthlyTotals,
      serviceCount,
      productCount,
      error: null
    });
  } catch (err) {
    console.error("Erro ao gerar balanço:", err);
    res.render('balanco', {
      totalReceita: 0, totalDespesa: 0, liquido: 0,
      productTotals: [], monthlyTotals: [],
      serviceCount: 0, productCount: 0,
      error: 'Erro ao carregar o balanço.'
    });
  }
};