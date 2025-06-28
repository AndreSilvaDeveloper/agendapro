require('dotenv').config();
const express     = require('express');
const router      = express.Router();
const Client      = require('../models/Client');
const Appointment = require('../models/Appointment');
const Expense     = require('../models/Expense');
const dayjs       = require('dayjs');
const utc         = require('dayjs/plugin/utc');
const timezone    = require('dayjs/plugin/timezone');
const isoWeek     = require('dayjs/plugin/isoWeek');

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isoWeek);

function authMiddleware(req, res, next) {
  if (req.session && req.session.loggedIn) return next();
  res.redirect('/login');
}


router.get('/login', (req, res) => {
  res.render('login', { error: null });
});
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === 'samara' && password === '160793') {
    req.session.loggedIn = true;
    return res.redirect('/dashboard');
  }
  res.render('login', { error: 'Usuário ou senha inválidos' });
});
router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});



router.get('/', authMiddleware, (req, res) => {
  res.redirect('/dashboard');
});



router.get('/dashboard', authMiddleware, async (req, res) => {
  try {
    const agoraSP      = () => dayjs().tz('America/Sao_Paulo');
    const hojeStart    = agoraSP().startOf('day');
    const hojeEnd      = agoraSP().endOf('day');
    const amanhaStart  = hojeStart.add(1, 'day');
    const amanhaEnd    = hojeEnd.add(1, 'day');

    // Próximos hoje
    const rawHoje = await Appointment.find({
      date: { $gte: hojeStart.toDate(), $lte: hojeEnd.toDate() }
    }).populate('clientId').sort({ date: 1 });

    const proximosHoje = [...new Map(
      rawHoje.map(a => {
        const time = dayjs(a.date).tz('America/Sao_Paulo').format('HH:mm');
        return [
          `${a.clientId?.name || 'Desconhecido'}|${time}`,
          { name: a.clientId?.name || 'Sem Nome', time, service: a.services[0]?.name || '—' }
        ];
      })
    ).values()];

    // Próximos amanhã
    const rawAmanha = await Appointment.find({
      date: { $gte: amanhaStart.toDate(), $lte: amanhaEnd.toDate() }
    }).populate('clientId').sort({ date: 1 });

    const proximosAmanha = [...new Map(
      rawAmanha.map(a => {
        const time = dayjs(a.date).tz('America/Sao_Paulo').format('HH:mm');
        return [
          `${a.clientId?.name || 'Desconhecido'}|${time}`,
          { name: a.clientId?.name || 'Sem Nome', time, service: a.services[0]?.name || '—' }
        ];
      })
    ).values()];

    const todos = await Appointment.find().populate('clientId');

    let receitaHoje = 0;
    let receitaSemana = 0;
    let receitaMes = 0;

    todos.forEach(a => {
      const itens = [
        ...(Array.isArray(a.services) ? a.services : []),
        ...(Array.isArray(a.products) ? a.products : [])
      ];

      itens.forEach(item => {
        (Array.isArray(item.payments) ? item.payments : []).forEach(p => {
          const pago = dayjs(p.paidAt).tz('America/Sao_Paulo');
          if (pago.isSame(hojeStart, 'day')) receitaHoje += p.amount;
          if (pago.isSame(hojeStart, 'week')) receitaSemana += p.amount;
          if (pago.isSame(hojeStart, 'month')) receitaMes += p.amount;
        });
      });
    });

    res.render('dashboard', {
      proximosHoje,
      proximosAmanha,
      receitaHoje,
      receitaSemana,
      receitaMes
    });
  } catch (err) {
    console.error('Erro ao carregar dashboard:', err);
    res.status(500).send('Erro interno no dashboard.');
  }
});





// --- Home e Busca de Clientes ---
router.get('/clients', authMiddleware, async (req, res) => {
  const clients = await Client.find();
  res.render('home', { clients });
});
router.get('/search', authMiddleware, async (req, res) => {
  const q      = req.query.q?.trim() || '';
  const regex  = new RegExp(q, 'i');
  const clients = await Client.find({
    $or: [{ name: regex }, { phone: regex }]
  });
  res.render('home', { clients });
});

// --- Criar Cliente (com validação de duplicata) ---
router.post('/client', authMiddleware, async (req, res) => {
  const { name, phone }   = req.body;
  const trimmedName       = name.trim();
  const normalizedPhone   = phone.replace(/\D/g, '');

  const existing = await Client.findOne({
    $or: [
      { name: trimmedName },
      { phone: { $regex: normalizedPhone + '$' } }
    ]
  });

  if (existing) {
    const errorMsg = existing.name === trimmedName
      ? 'Já existe um cliente cadastrado com esse nome.'
      : 'Já existe um cliente cadastrado com esse telefone.';
    const clients = await Client.find();
    return res.render('home', { clients, error: errorMsg });
  }

  await Client.create({ name: trimmedName, phone: normalizedPhone });
  res.redirect('/clients');
});




router.post('/appointment', authMiddleware, async (req, res) => {
  const { clientId, date, time, duration, services, products, force } = req.body;
  const parsedServices = services ? JSON.parse(services) : [];
  const parsedProducts = products ? JSON.parse(products) : [];

  const start = dayjs.tz(`${date}T${time}`, 'America/Sao_Paulo').toDate();
  const dur   = parseInt(duration, 10);
  const end   = new Date(start.getTime() + dur * 60000);

  const conflict = await Appointment.findOne({
    date: { $lt: end },
    $expr: {
      $gt: [
        { $add: ['$date', { $multiply: ['$duration', 60000] }] },
        start
      ]
    }
  });
  if (conflict && !force) {
    return res.send(`
<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Confirmar</title></head><body>
<script>
if (confirm("⚠️ Conflito de horário. Agendar mesmo assim?")) {
  const f = document.createElement('form'); f.method='POST'; f.action='/appointment';
  const data = ${JSON.stringify({ clientId,date,time,duration,services,products,force:true })};
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
  await Appointment.create({
    clientId,
    date: start,
    duration: dur,
    services: parsedServices,
    products: parsedProducts
  });

  // não há mais envio de SMS
  res.redirect(`/client/${clientId}`);
});



// --- Página do Cliente (Futuros) ---
router.get('/client/:id', authMiddleware, async (req, res) => {
  const client = await Client.findById(req.params.id);
  const all    = await Appointment.find({ clientId: client._id });
  const midnight = dayjs().tz('America/Sao_Paulo').startOf('day').toDate();

  const upcoming = all
    .filter(a => a.date >= midnight)
    .map(a => ({
      ...a.toObject(),
      formatted: dayjs(a.date).tz('America/Sao_Paulo').format('DD/MM/YYYY [às] HH:mm')
    }));

  let totalService = 0, totalProduct = 0, totalPaid = 0;
  upcoming.forEach(a => {
    a.services.forEach(s => {
      totalService += s.price;
      totalPaid    += (s.payments||[]).reduce((sum,p) => sum + (p.amount||0), 0);
    });
    a.products.forEach(p => {
      totalProduct += p.price;
      totalPaid    += (p.payments||[]).reduce((sum,p) => sum + (p.amount||0), 0);
    });
  });

  res.render('client', {
    client,
    appointments: upcoming,
    totalService,
    totalProduct,
    total: totalService + totalProduct,
    totalPaid
  });
});

// --- Histórico (Passados) ---
router.get('/client/:id/historico', authMiddleware, async (req, res) => {
  const client   = await Client.findById(req.params.id);
  const all      = await Appointment.find({ clientId: client._id });
  const midnight = dayjs().tz('America/Sao_Paulo').startOf('day').toDate();

  const past = all
    .filter(a => a.date < midnight)
    .map(a => ({
      ...a.toObject(),
      formatted: dayjs(a.date).tz('America/Sao_Paulo').format('DD/MM/YYYY [às] HH:mm')
    }));

  let totalService = 0, totalProduct = 0, totalPaid = 0;
  past.forEach(a => {
    a.services.forEach(s => {
      totalService += s.price;
      totalPaid    += (s.payments||[]).reduce((sum,p) => sum + (p.amount||0), 0);
    });
    a.products.forEach(p => {
      totalProduct += p.price;
      totalPaid    += (p.payments||[]).reduce((sum,p) => sum + (p.amount||0), 0);
    });
  });

  res.render('client', {
    client,
    appointments: past,
    totalService,
    totalProduct,
    total: totalService + totalProduct,
    totalPaid
  });
});

// --- Excluir Cliente + Agendamentos ---
router.post('/client/:id/delete', authMiddleware, async (req, res) => {
  await Client.findByIdAndDelete(req.params.id);
  await Appointment.deleteMany({ clientId: req.params.id });
  res.redirect('/');
});

// --- Remover Serviço / Produto ---
router.post('/appointment/:id/remove-service/:idx', authMiddleware, async (req, res) => {
  const a = await Appointment.findById(req.params.id);
  a.services.splice(req.params.idx, 1);
  await a.save();
  res.redirect(`/client/${a.clientId}`);
});
router.post('/appointment/:id/remove-product/:idx', authMiddleware, async (req, res) => {
  const a = await Appointment.findById(req.params.id);
  a.products.splice(req.params.idx, 1);
  await a.save();
  res.redirect(`/client/${a.clientId}`);
});

// --- Cancelar Agendamento + SMS ---
router.post('/appointment/:id/cancel', authMiddleware, async (req, res) => {
  try {
    const appt = await Appointment.findById(req.params.id);
    if (!appt) return res.status(404).send('Agendamento não encontrado.');
    await Appointment.deleteOne({ _id: appt._id });
    res.redirect(`/client/${appt.clientId}`);
  } catch (err) {
    console.error('Erro no cancelamento:', err);
    res.status(500).send('Erro ao cancelar agendamento.');
  }
});




// --- Pagamentos com Método ---
router.post('/appointment/:id/pay-service/:idx', authMiddleware, async (req, res) => {
  const { amount, description, method } = req.body;
  const a    = await Appointment.findById(req.params.id);
  const item = a.services[req.params.idx];
  const val  = parseFloat(amount);
  if (isNaN(val) || val <= 0) return res.send("Valor inválido.");
  if (!['Pix','Dinheiro','Cartão'].includes(method)) return res.send("Método inválido.");
  item.payments.push({ amount: val, paidAt: new Date(), description: description||'', method });
  await a.save();
  res.redirect(`/client/${a.clientId}`);
});
router.post('/appointment/:id/pay-product/:idx', authMiddleware, async (req, res) => {
  const { amount, description, method } = req.body;
  const a    = await Appointment.findById(req.params.id);
  const item = a.products[req.params.idx];
  const val  = parseFloat(amount);
  if (isNaN(val) || val <= 0) return res.send("Valor inválido.");
  if (!['Pix','Dinheiro','Cartão'].includes(method)) return res.send("Método inválido.");
  item.payments.push({ amount: val, paidAt: new Date(), description: description||'', method });
  await a.save();
  res.redirect(`/client/${a.clientId}`);
});

// --- Remover Pagamento ---
router.post('/appointment/:id/remove-payment/service/:sIdx/:pIdx', authMiddleware, async (req, res) => {
  const a = await Appointment.findById(req.params.id);
  a.services[req.params.sIdx].payments.splice(req.params.pIdx, 1);
  await a.save();
  res.redirect(`/client/${a.clientId}`);
});
router.post('/appointment/:id/remove-payment/product/:pIdx/:ppIdx', authMiddleware, async (req, res) => {
  const a = await Appointment.findById(req.params.id);
  a.products[req.params.pIdx].payments.splice(req.params.ppIdx, 1);
  await a.save();
  res.redirect(`/client/${a.clientId}`);
});

// --- Agenda por Dia (ordenado) ---
// --- Agenda por Dia (ordenado) ---
router.get('/agendamentos-por-dia', authMiddleware, async (req, res) => {
  const { date } = req.query;
  
  // se não enviou data, mostra apenas o form vazio
  if (!date) {
    return res.render('agenda-dia', { date: null, results: [] });
  }

  // calcula início e fim do dia no fuso SP
  const start = dayjs.tz(`${date}T00:00:00`, 'America/Sao_Paulo').toDate();
  const end   = dayjs.tz(`${date}T23:59:59`, 'America/Sao_Paulo').toDate();

  // busca todos os appointments no dia e popula o client
  const ags = await Appointment.find({
    date: { $gte: start, $lte: end }
  })
    .sort({ date: 1 })
    .populate('clientId');

  // monta o array que vai pra view, incluindo _id e nomes de serviço
  const results = ags
    .filter(a => a.services.length > 0)
    .map(a => ({
      _id:            a._id,
      clientName:     a.clientId.name,
      timeFormatted:  dayjs(a.date).tz('America/Sao_Paulo').format('HH:mm'),
      servicesNames:  a.services.map(s => s.name).join(', ')
    }));

  // renderiza
  res.render('agenda-dia', { date, results });
});


// --- Editar Cliente, Serviço, Produto ---
router.post('/client/:id/edit', authMiddleware, async (req, res) => {
  const { name, phone } = req.body;
  await Client.findByIdAndUpdate(req.params.id, { name, phone });
  res.redirect(`/client/${req.params.id}`);
});
router.post('/appointment/:id/edit-service/:idx', authMiddleware, async (req, res) => {
  const a    = await Appointment.findById(req.params.id);
  const { name, price } = req.body;
  a.services[req.params.idx].name  = name;
  a.services[req.params.idx].price = parseFloat(price);
  await a.save();
  res.redirect(`/client/${a.clientId}`);
});
router.post('/appointment/:id/edit-product/:idx', authMiddleware, async (req, res) => {
  const a    = await Appointment.findById(req.params.id);
  const { name, price } = req.body;
  a.products[req.params.idx].name  = name;
  a.products[req.params.idx].price = parseFloat(price);
  await a.save();
  res.redirect(`/client/${a.clientId}`);
});

// --- Financeiro por Dia, Mês ou Semana ISO ---
router.get('/financeiro', authMiddleware, async (req, res) => {
  const { day, month, week } = req.query;
  const monthNames = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

  let filter       = {};
  let dayLabel     = '', dayValue     = '';
  let monthLabel   = '', monthValue   = '';
  let weekLabel    = '', weekValue    = '';

  if (day) {
    // FILTRO POR DIA
    dayValue = day;
    const start = dayjs.tz(`${day}T00:00:00`, 'America/Sao_Paulo');
    const end   = start.endOf('day');
    dayLabel = `Dia ${start.format('DD/MM/YYYY')}`;
    filter.date = { $gte: start.toDate(), $lte: end.toDate() };

  } else if (month) {
    // FILTRO POR MÊS
    const [year, mon] = month.split('-');
    monthValue = month;
    monthLabel = `${monthNames[Number(mon)-1]} de ${year}`;
    const start = dayjs.tz(`${month}-01T00:00:00`, 'America/Sao_Paulo');
    filter.date = { $gte: start.toDate(), $lte: start.endOf('month').toDate() };

  } else if (week) {
    // FILTRO POR SEMANA ISO
    const [yearW, wk] = week.split('-W').map(Number);
    weekValue = week;
    const startOfWeek = dayjs().year(yearW).isoWeek(wk).tz('America/Sao_Paulo').startOf('isoWeek');
    const endOfWeek   = startOfWeek.clone().endOf('isoWeek');
    weekLabel = `Semana de ${startOfWeek.format('DD/MM/YYYY')} a ${endOfWeek.format('DD/MM/YYYY')}`;
    filter.date = { $gte: startOfWeek.toDate(), $lte: endOfWeek.toDate() };
  }

  // Consulta
  const ags = await Appointment.find(filter).populate('clientId');

  // Totais por método
  const totals  = {};
  const details = {};

  // Totais separados
  let totalServicos = 0;
  let totalProdutos = 0;

  ags.forEach(a => {
    // Serviços
    (a.services || []).forEach(item => {
      (item.payments || []).forEach(p => {
        const amt = p.amount || 0;
        totalServicos += amt;

        // Agrupa por método
        const m = (p.method || '').toLowerCase();
        let key;
        if (m.includes('pix'))                key = 'Pix';
        else if (m.includes('dinheiro'))      key = 'Dinheiro';
        else if (m.includes('cartão') || m.includes('cartao')) key = 'Cartão';
        else return;

        totals[key]  = (totals[key]  || 0) + amt;
        details[key] = details[key] || [];
        details[key].push({
          date:        dayjs(p.paidAt).tz('America/Sao_Paulo').format('DD/MM/YYYY'),
          client:      a.clientId.name,
          item:        item.name,
          amount:      amt.toFixed(2),
          description: p.description || ''
        });
      });
    });

    // Produtos
    (a.products || []).forEach(item => {
      (item.payments || []).forEach(p => {
        const amt = p.amount || 0;
        totalProdutos += amt;

        const m = (p.method || '').toLowerCase();
        let key;
        if (m.includes('pix'))                key = 'Pix';
        else if (m.includes('dinheiro'))      key = 'Dinheiro';
        else if (m.includes('cartão') || m.includes('cartao')) key = 'Cartão';
        else return;

        totals[key]  = (totals[key]  || 0) + amt;
        details[key] = details[key] || [];
        details[key].push({
          date:        dayjs(p.paidAt).tz('America/Sao_Paulo').format('DD/MM/YYYY'),
          client:      a.clientId.name,
          item:        item.name,
          amount:      amt.toFixed(2),
          description: p.description || ''
        });
      });
    });
  });

  // Soma geral de todos os métodos
  const overallTotal = Object.values(totals).reduce((sum, v) => sum + v, 0);

  // Renderiza a view, agora incluindo dayLabel e dayValue
  res.render('financeiro', {
    dayLabel,
    dayValue,
    monthLabel,
    monthValue,
    weekLabel,
    weekValue,
    overallTotal,
    totalServicos,
    totalProdutos,
    totals,
    details
  });
});



// --- Despesas (saídas) ---
router.get('/expenses', authMiddleware, async (req, res) => {
  // lista todas despesas ordenadas por data desc
  const expenses = await Expense.find({ /* ... */ }).sort({ date: -1 });
  const totalDespesa = expenses.reduce((sum, e) => sum + e.amount, 0);
  
  res.render('expenses', {
    expenses,
    totalDespesa,
    dayjs,
  });
});


router.post('/expenses', authMiddleware, async (req, res) => {
  const { date, category, description, amount } = req.body
  // cria e salva
  await Expense.create({
    date: new Date(date),
    category,
    description: description.trim(),
    amount: parseFloat(amount)
  })
  res.redirect('/expenses')
})

// rota para excluir
router.post('/expenses/:id/delete', authMiddleware, async (req, res) => {
  await Expense.findByIdAndDelete(req.params.id)
  res.redirect('/expenses')
})

// --- Balanço Geral (Receita vs Despesa) ---
router.get('/balanco', authMiddleware, async (req, res) => {
  // busca todas as receitas (pagamentos de serviços e produtos)
  const appts = await Appointment.find().populate('clientId');
  let totalReceita = 0;
  appts.forEach(a => {
    [...a.services, ...a.products].forEach(item => {
      (item.payments || []).forEach(p => totalReceita += p.amount);
    });
  });

  // busca todas as despesas
  const expenses = await Expense.find();  // assuma que você já criou o model Expense
  let totalDespesa = 0;
  expenses.forEach(e => totalDespesa += e.amount);

  const liquido = totalReceita - totalDespesa;

  res.render('balanco', {
    totalReceita,
    totalDespesa,
    liquido
  });
});



module.exports = router;
