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



// --- Dashboard unificado ---
router.get('/dashboard', authMiddleware, async (req, res) => {
  const hojeStart   = dayjs().tz('America/Sao_Paulo').startOf('day').toDate();
  const hojeEnd     = dayjs().tz('America/Sao_Paulo').endOf('day').toDate();
  const amanhaStart = dayjs().tz('America/Sao_Paulo').add(1, 'day').startOf('day').toDate();
  const amanhaEnd   = dayjs().tz('America/Sao_Paulo').add(1, 'day').endOf('day').toDate();

  const rawHoje = await Appointment.find({
    date: { $gte: hojeStart, $lte: hojeEnd }
  }).populate('clientId').sort('date');

  const proximosHoje = [...new Map(
    rawHoje.filter(a => a.clientId && ((a.services || []).length || (a.products || []).length))
      .map(a => {
        const time = dayjs(a.date).tz('America/Sao_Paulo').format('HH:mm');
        return [`${a.clientId.name}|${time}`, {
          name: a.clientId.name,
          time,
          service: a.services[0]?.name || '—'
        }];
      })
  ).values()];

  const rawAmanha = await Appointment.find({
    date: { $gte: amanhaStart, $lte: amanhaEnd }
  }).populate('clientId').sort('date');

  const proximosAmanha = [...new Map(
    rawAmanha.filter(a => a.clientId && ((a.services || []).length || (a.products || []).length))
      .map(a => {
        const time = dayjs(a.date).tz('America/Sao_Paulo').format('HH:mm');
        return [`${a.clientId.name}|${time}`, {
          name: a.clientId.name,
          time,
          service: a.services[0]?.name || '—'
        }];
      })
  ).values()];

  let receitaHoje = 0, receitaSemana = 0, receitaMes = 0;
  const ref = dayjs().tz('America/Sao_Paulo');

  const todos = await Appointment.find().populate('clientId');
  todos.forEach(a => {
    [...(a.services||[]), ...(a.products||[])].forEach(item => {
      (item.payments||[]).forEach(p => {
        const pago = dayjs(p.paidAt).tz('America/Sao_Paulo');
        if (pago.isSame(ref, 'day'))   receitaHoje   += p.amount;
        if (pago.isSame(ref, 'week'))  receitaSemana += p.amount;
        if (pago.isSame(ref, 'month')) receitaMes    += p.amount;
      });
    });
  });

  // Soma produtos diretos do cliente
  const clients = await Client.find();
  clients.forEach(c => {
    (c.products || []).forEach(prod => {
      (prod.payments || []).forEach(p => {
        const pago = dayjs(p.paidAt).tz('America/Sao_Paulo');
        if (pago.isSame(ref, 'day'))   receitaHoje   += p.amount;
        if (pago.isSame(ref, 'week'))  receitaSemana += p.amount;
        if (pago.isSame(ref, 'month')) receitaMes    += p.amount;
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



// --- Página do Cliente (Futuros + Produtos) ---
router.get('/client/:id', authMiddleware, async (req, res) => {
  const client = await Client.findById(req.params.id);
  const allAppts = await Appointment.find({ clientId: client._id });
  const midnight = dayjs().tz('America/Sao_Paulo').startOf('day').toDate();

  // Upcoming appointments
  const upcoming = allAppts
    .filter(a => a.date >= midnight)
    .map(a => ({
      ...a.toObject(),
      formatted: dayjs(a.date).tz('America/Sao_Paulo').format('DD/MM/YYYY [às] HH:mm')
    }));

  // Totals for appointments (services)
  let totalService     = 0;
  let totalPaidService = 0;

  upcoming.forEach(a => {
    a.services.forEach(s => {
      totalService += s.price;
      totalPaidService += (s.payments || []).reduce((sum,p) => sum + (p.amount||0), 0);
    });
  });

  // Totals for products attached directly to client
  let totalProduct       = 0;
  let totalPaidProduct   = 0;

  client.products.forEach(p => {
    totalProduct += p.price;
    totalPaidProduct += (p.payments || []).reduce((sum, pay) => sum + (pay.amount||0), 0);
  });

  // Render view passing both sets of totals
  res.render('client', {
    client,
    appointments: upcoming,
    totalService,
    totalPaidService,
    totalProduct,
    totalPaidProduct
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





// ─── Produtos do Cliente ────────────────────────────────────

// Adicionar
router.post('/client/:id/add-product', authMiddleware, async (req, res) => {
  const { name, price } = req.body;
  await Client.findByIdAndUpdate(req.params.id, {
    $push: { products: { name, price: parseFloat(price), payments: [] } }
  });
  res.redirect(`/client/${req.params.id}`);
});

// Editar
router.post('/client/:id/product/:pi/edit', authMiddleware, async (req, res) => {
  const { name, price } = req.body;
  const client = await Client.findById(req.params.id);
  const prod   = client.products[req.params.pi];
  prod.name    = name;
  prod.price   = parseFloat(price);
  await client.save();
  res.redirect(`/client/${req.params.id}`);
});

// Excluir
router.post('/client/:id/product/:pi/delete', authMiddleware, async (req, res) => {
  const client = await Client.findById(req.params.id);
  client.products.splice(req.params.pi, 1);
  await client.save();
  res.redirect(`/client/${req.params.id}`);
});

// Pagar Produto
router.post('/client/:id/product/:pi/pay', authMiddleware, async (req, res) => {
  const { amount, method, description } = req.body;
  const client = await Client.findById(req.params.id);
  const prod   = client.products[req.params.pi];
  prod.payments.push({
    amount: parseFloat(amount),
    paidAt: new Date(),
    method,
    description: description || ''
  });
  await client.save();
  res.redirect(`/client/${req.params.id}`);
});

// Remover pagamento
router.post('/client/:id/product/:pi/remove-payment/:pj', authMiddleware, async (req, res) => {
  const client = await Client.findById(req.params.id);
  client.products[req.params.pi].payments.splice(req.params.pj, 1);
  await client.save();
  res.redirect(`/client/${req.params.id}`);
});



// --- Remover Serviço / Produto ---
router.post('/appointment/:id/remove-service/:idx', authMiddleware, async (req, res) => {
  const a = await Appointment.findById(req.params.id);
  a.services.splice(req.params.idx, 1);
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

  item.payments.push({ amount: val, paidAt: new Date(), description: description || '', method });

  a.markModified('services'); // <- força o mongoose a detectar a alteração
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



// --- Editar Data/Hora do Agendamento ---
router.post('/appointment/:id/edit-datetime', authMiddleware, async (req, res) => {
  const { date, time } = req.body; // vindo do formulario
  const a = await Appointment.findById(req.params.id);
  if (!a) return res.status(404).send('Agendamento não encontrado.');

  // Monta o novo Date no fuso de SP
  const newDate = dayjs.tz(`${date}T${time}`, 'America/Sao_Paulo').toDate();
  a.date = newDate;
  await a.save();

  res.redirect(`/client/${a.clientId}`);
});


// --- FINANCEIRO corrigido ---
router.get('/financeiro', authMiddleware, async (req, res) => {
  const { day, month, week } = req.query;
  const monthNames = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

  let filter = {};
  let dayLabel = '', dayValue = '';
  let monthLabel = '', monthValue = '';
  let weekLabel = '', weekValue = '';
  let dateStart, dateEnd;

  if (day) {
    dayValue = day;
    dateStart = dayjs.tz(`${day}T00:00:00`, 'America/Sao_Paulo');
    dateEnd   = dateStart.endOf('day'); // <-- ESSA LINHA FALTAVA
    dayLabel  = `Dia ${dateStart.format('DD/MM/YYYY')}`;
    filter.date = { $gte: dateStart.toDate(), $lte: dateEnd.toDate() };
    
  } else if (month) {
    const [year, mon] = month.split('-');
    monthValue = month;
    monthLabel = `${monthNames[Number(mon)-1]} de ${year}`;
    dateStart = dayjs.tz(`${month}-01T00:00:00`, 'America/Sao_Paulo');
    dateEnd = dateStart.endOf('month');
    filter.date = { $gte: dateStart.toDate(), $lte: dateEnd.toDate() };

  } else if (week) {
    const [yearW, wk] = week.split('-W').map(Number);
    weekValue = week;
    dateStart = dayjs().year(yearW).isoWeek(wk).tz('America/Sao_Paulo').startOf('isoWeek');
    dateEnd   = dateStart.clone().endOf('isoWeek');
    weekLabel = `Semana de ${dateStart.format('DD/MM/YYYY')} a ${dateEnd.format('DD/MM/YYYY')}`;
    filter.date = { $gte: dateStart.toDate(), $lte: dateEnd.toDate() };
  }

  const ags = await Appointment.find(filter).populate('clientId');

  const totals = {}, details = {};
  let totalServicos = 0, totalProdutos = 0;

  ags.forEach(a => {
    (a.services || []).forEach(item => {
      (item.payments || []).forEach(p => {
        const amt = p.amount || 0;
        totalServicos += amt;
        const m = (p.method || '').toLowerCase();
        let key;
        if (m.includes('pix')) key = 'Pix';
        else if (m.includes('dinheiro')) key = 'Dinheiro';
        else if (m.includes('cartão') || m.includes('cartao')) key = 'Cartão';
        else return;
        totals[key] = (totals[key] || 0) + amt;
        details[key] = details[key] || [];
        details[key].push({
          date: dayjs(p.paidAt).tz('America/Sao_Paulo').format('DD/MM/YYYY'),
          client: a.clientId.name,
          item: item.name,
          amount: amt.toFixed(2),
          description: p.description || ''
        });
      });
    });

    (a.products || []).forEach(item => {
      (item.payments || []).forEach(p => {
        const amt = p.amount || 0;
        totalProdutos += amt;
        const m = (p.method || '').toLowerCase();
        let key;
        if (m.includes('pix')) key = 'Pix';
        else if (m.includes('dinheiro')) key = 'Dinheiro';
        else if (m.includes('cartão') || m.includes('cartao')) key = 'Cartão';
        else return;
        totals[key] = (totals[key] || 0) + amt;
        details[key] = details[key] || [];
        details[key].push({
          date: dayjs(p.paidAt).tz('America/Sao_Paulo').format('DD/MM/YYYY'),
          client: a.clientId.name,
          item: item.name,
          amount: amt.toFixed(2),
          description: p.description || ''
        });
      });
    });
  });

  // Corrigido: incluir produtos fora do agendamento
  const clients = await Client.find();
  clients.forEach(c => {
    (c.products || []).forEach(prod => {
      (prod.payments || []).forEach(p => {
        const paidDate = dayjs(p.paidAt).tz('America/Sao_Paulo');
        if (!dateStart || (paidDate.isAfter(dateStart) && paidDate.isBefore(dateEnd))) {
          const amt = p.amount || 0;
          totalProdutos += amt;
          const m = (p.method || '').toLowerCase();
          let key;
          if (m.includes('pix')) key = 'Pix';
          else if (m.includes('dinheiro')) key = 'Dinheiro';
          else if (m.includes('cartão') || m.includes('cartao')) key = 'Cartão';
          else return;
          totals[key] = (totals[key] || 0) + amt;
          details[key] = details[key] || [];
          details[key].push({
            date: paidDate.format('DD/MM/YYYY'),
            client: c.name,
            item: prod.name,
            amount: amt.toFixed(2),
            description: p.description || ''
          });
        }
      });
    });
  });

  const overallTotal = Object.values(totals).reduce((sum, v) => sum + v, 0);

  res.render('financeiro', {
    dayLabel, dayValue,
    monthLabel, monthValue,
    weekLabel, weekValue,
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




// --- BALANÇO corrigido ---
router.get('/balanco', authMiddleware, async (req, res) => {
  const appts = await Appointment.find().populate('clientId');
  let totalReceita = 0;
  appts.forEach(a => {
    [...a.services, ...a.products].forEach(item => {
      (item.payments || []).forEach(p => totalReceita += p.amount);
    });
  });

  // Correção: produtos fora de agendamento
  const clients = await Client.find();
  clients.forEach(c => {
    (c.products || []).forEach(prod => {
      (prod.payments || []).forEach(p => {
        totalReceita += p.amount;
      });
    });
  });

  const expenses = await Expense.find();
  const totalDespesa = expenses.reduce((sum, e) => sum + e.amount, 0);
  const liquido = totalReceita - totalDespesa;

  res.render('balanco', {
    totalReceita,
    totalDespesa,
    liquido
  });
});

module.exports = router;


module.exports = router;
