// controllers/financialController.js
// --- REMOVIDO ---
// const Client = require('../models/Client');
// const Appointment = require('../models/Appointment');
// const Expense = require('../models/Expense');

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

exports.getFinanceiro = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const { day, month, week } = req.query;

    let dateStart, dateEnd;
    let label = 'Geral';
    let dayValue = '', monthValue = '', weekValue = '';

    // Lógica de datas (sem alteração)
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

    // ATUALIZADO: Busca dados com 'include' aninhado
    const [appointments, clients] = await Promise.all([
      db.Appointment.findAll({
        where: { organizationId },
        include: [
          { model: db.Client, attributes: ['name'] },
          { model: db.AppointmentService, include: [db.AppointmentPayment] },
          { model: db.AppointmentProduct, include: [db.AppointmentPayment] }
        ]
      }),
      db.Client.findAll({
        where: { organizationId },
        include: [
          { model: db.Product, include: [db.Payment] }
        ]
      })
    ]);

    let totals = {}, overallTotal = 0;
    let totalServicos = 0, totalProdutos = 0;
    let details = {};

    const processPayment = (p, clientName, itemName, itemType) => {
      const paid = dayjs(p.paidAt).tz('America/Sao_Paulo');
      if (!dateStart || paid.isBetween(dateStart, dateEnd, null, '[]')) {
        // ATUALIZADO: Usar parseFloat para valores DECIMAL
        const amount = parseFloat(p.amount);
        
        if (itemType === 'service') totalServicos += amount;
        if (itemType === 'product') totalProdutos += amount;

        const key = ['pix', 'dinheiro', 'cartao'].find(k => p.method.toLowerCase().includes(k)) || 'outros';
        totals[key] = (totals[key] || 0) + amount;
        details[key] = details[key] || [];
        details[key].push({
          date: paid.format('DD/MM/YYYY'),
          client: clientName,
          item: itemName,
          amount: amount.toFixed(2),
          description: p.description || ''
        });
      }
    };

    // ATUALIZADO: Itera sobre os nomes dos modelos Sequelize
    appointments.forEach(a => {
      const clientName = a.Client ? a.Client.name : 'Cliente Excluído';
      (a.AppointmentServices || []).forEach(svc => (svc.AppointmentPayments || []).forEach(p => processPayment(p, clientName, svc.name, 'service')));
      (a.AppointmentProducts || []).forEach(prod => (prod.AppointmentPayments || []).forEach(p => processPayment(p, clientName, prod.name, 'product')));
    });

    clients.forEach(c => {
      (c.Products || []).forEach(prod => (prod.Payments || []).forEach(p => processPayment(p, c.name, prod.name, 'product')));
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
    // ATUALIZADO: Expense.find().sort() -> db.Expense.findAll()
    const expenses = await db.Expense.findAll({ 
      where: { organizationId: organizationId },
      order: [['date', 'DESC']] // sort({ date: -1 })
    });
    // ATUALIZADO: Usar parseFloat
    const totalDespesa = expenses.reduce((sum, e) => sum + parseFloat(e.amount), 0);

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

    // ATUALIZADO: Expense.create() -> db.Expense.create()
    await db.Expense.create({
      organizationId: organizationId,
      date: new Date(date),
      category: category.toLowerCase(),
      description: description.trim(),
      amount: parseFloat(amount)
    });
    res.redirect('/expenses?success=Despesa salva!');
  } catch (err) {
    console.error("Erro ao criar despesa:", err);
    // ATUALIZADO: Trata erro de validação do Sequelize
    if (err.name === 'SequelizeValidationError') {
      return res.redirect(`/expenses?error=${err.errors[0].message}`);
    }
    res.redirect('/expenses?error=Erro ao salvar despesa.');
  }
};

exports.deleteExpense = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const { id } = req.params;

    // ATUALIZADO: findOneAndDelete -> destroy
    const affectedRows = await db.Expense.destroy({
      where: {
        id: id,
        organizationId: organizationId
      }
    });

    if (affectedRows === 0) {
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

    // ATUALIZADO: Busca de dados com 'include' aninhado
    const [appointments, clients, expenses] = await Promise.all([
      db.Appointment.findAll({
        where: { organizationId },
        include: [
          { model: db.AppointmentService, include: [db.AppointmentPayment] },
          { model: db.AppointmentProduct, include: [db.AppointmentPayment] }
        ]
      }),
      db.Client.findAll({
        where: { organizationId },
        include: [
          { model: db.Product, include: [db.Payment] }
        ]
      }),
      db.Expense.findAll({ where: { organizationId } })
    ]);


    let totalReceita = 0;
    const prodMap = {};
    const monthlyMap = {};

    const processPayment = (p, itemName) => {
      // ATUALIZADO: Usar parseFloat
      const amount = parseFloat(p.amount);
      totalReceita += amount;
      const m = dayjs(p.paidAt).tz('America/Sao_Paulo').format('YYYY-MM');
      monthlyMap[m] = (monthlyMap[m] || 0) + amount;
      prodMap[itemName] = (prodMap[itemName] || 0) + amount;
    };

    // ATUALIZADO: Itera sobre os nomes dos modelos Sequelize
    appointments.forEach(a => {
      (a.AppointmentServices || []).forEach(item => (item.AppointmentPayments || []).forEach(p => processPayment(p, item.name)));
      (a.AppointmentProducts || []).forEach(item => (item.AppointmentPayments || []).forEach(p => processPayment(p, item.name)));
    });
    clients.forEach(c => {
      (c.Products || []).forEach(prod => (prod.Payments || []).forEach(p => processPayment(p, prod.name)));
    });

    // ATUALIZADO: Usar parseFloat
    const totalDespesa = expenses.reduce((sum, e) => sum + parseFloat(e.amount), 0);
    const liquido = totalReceita - totalDespesa;

    const productTotals = Object.entries(prodMap)
      .map(([name, total]) => ({ name, total }));

    const monthlyTotals = Object.entries(monthlyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([m, total]) => {
        const [year, month] = m.split('-');
        return { month: `${month}/${year}`, total };
      });

    // ATUALIZADO: Itera sobre os nomes dos modelos Sequelize
    let serviceCount = 0, productCount = 0;
    appointments.forEach(a => {
      serviceCount += (a.AppointmentServices || []).length;
      productCount += (a.AppointmentProducts || []).length;
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