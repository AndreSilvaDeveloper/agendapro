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
const isBetween   = require('dayjs/plugin/isBetween');


dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isoWeek);
dayjs.extend(isBetween);


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
  const { amount, method, description, paidAt } = req.body;
  const client = await Client.findById(req.params.id);
  const prod   = client.products[req.params.pi];
  const val    = parseFloat(amount);

  const when = paidAt
    ? dayjs.tz(paidAt, dayjs.ISO_8601, 'America/Sao_Paulo').toDate()
    : new Date();

  prod.payments.push({
    amount: val,
    paidAt: when,
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
  const { amount, method, description, paidAt } = req.body;
  const a    = await Appointment.findById(req.params.id);
  const item = a.services[req.params.idx];
  const val  = parseFloat(amount);

  if (isNaN(val) || val <= 0) 
    return res.send("Valor inválido.");
  if (!['Pix','Dinheiro','Cartão'].includes(method)) 
    return res.send("Método inválido.");

  // parse da data enviada (ou fallback para agora)
  const when = paidAt
    ? dayjs.tz(paidAt, dayjs.ISO_8601, 'America/Sao_Paulo').toDate()
    : new Date();

  item.payments.push({
    amount: val,
    paidAt: when,
    description: description || '',
    method
  });

  a.markModified('services');
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



router.get('/agendamentos-por-dia', authMiddleware, async (req, res) => {
  const { date } = req.query;
  const days           = [];
  const resultsByDay   = {};
  const availableByDay = {};

  if (date) {
    // Modo “um dia”
    const start  = dayjs.tz(`${date}T00:00:00`, 'America/Sao_Paulo').toDate();
    const end    = dayjs.tz(`${date}T23:59:59`, 'America/Sao_Paulo').toDate();
    const ags    = await Appointment.find({ date: { $gte: start, $lte: end } })
                                    .sort('date')
                                    .populate('clientId');

    days.push(dayjs(date).tz('America/Sao_Paulo'));
    resultsByDay[date]   = [];
    availableByDay[date] = [];

    // inicializa slots 07–19h
    for (let h = 7; h < 20; h++) {
      availableByDay[date].push(`${String(h).padStart(2,'0')}:00`);
    }

    // preenche agendados e remove todos os slots da duração
    ags.forEach(a => {
      const startDT   = dayjs(a.date).tz('America/Sao_Paulo');
      const timeInicio= startDT.format('HH:mm');
      const durHoras  = Math.ceil((a.duration || 0) / 60);

      // registra nos agendados
      resultsByDay[date].push({
        _id:           a._id,
        clientName:    a.clientId.name,
        timeFormatted: timeInicio,
        servicesNames: a.services.map(s => s.name).join(', ')
      });

      // remove N slots (início + duração)
      for (let i = 0; i < durHoras; i++) {
        const slot = startDT.add(i, 'hour').format('HH:mm');
        availableByDay[date] = availableByDay[date].filter(s => s !== slot);
      }
    });

  } else {
    // Modo “semana Terça–Sábado”
    const today   = dayjs().tz('America/Sao_Paulo');
    const monday  = today.startOf('isoWeek');
    const tuesday = monday.add(1, 'day');
    [0,1,2,3,4].forEach(i => days.push(tuesday.add(i, 'day')));

    const weekStart = days[0].startOf('day').toDate();
    const weekEnd   = days[4].endOf('day').toDate();
    const agsWeek   = await Appointment.find({
      date: { $gte: weekStart, $lte: weekEnd }
    })
    .sort('date')
    .populate('clientId');

    // inicializa cada dia
    days.forEach(d => {
      const key = d.format('YYYY-MM-DD');
      resultsByDay[key]   = [];
      availableByDay[key] = [];
      for (let h = 7; h < 20; h++) {
        availableByDay[key].push(`${String(h).padStart(2,'0')}:00`);
      }
    });

    // preenche e remove slots conforme duração
    agsWeek.forEach(a => {
      const dKey     = dayjs(a.date).tz('America/Sao_Paulo');
      const key      = dKey.format('YYYY-MM-DD');
      const timeIni  = dKey.format('HH:mm');
      const durHoras = Math.ceil((a.duration || 0) / 60);

      // agendados
      resultsByDay[key].push({
        _id:           a._id,
        clientName:    a.clientId.name,
        timeFormatted: timeIni,
        servicesNames: a.services.map(s => s.name).join(', ')
      });

      // remove os slots do período ocupado
      for (let i = 0; i < durHoras; i++) {
        const slot = dKey.add(i, 'hour').format('HH:mm');
        availableByDay[key] = availableByDay[key].filter(s => s !== slot);
      }
    });
  }

  // renderiza
  res.render('agenda-dia', {
    date,
    days,
    resultsByDay,
    availableByDay
  });
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
// --- Financeiro ---
router.get('/financeiro', authMiddleware, async (req, res) => {
  const { day, month, week } = req.query;

  // inicializa valores para o template não quebrar
  let dateStart, dateEnd;
  let label        = 'Geral';
  let dayValue     = '';
  let monthValue   = '';
  let weekValue    = '';

  if (day) {
    dayValue = day;
    dateStart = dayjs.tz(`${day}T00:00:00`, 'America/Sao_Paulo');
    dateEnd   = dateStart.endOf('day');
    label     = `Dia ${dateStart.format('DD/MM/YYYY')}`;
  }
  else if (month) {
    monthValue = month;
    const [y, m] = month.split('-');
    dateStart = dayjs.tz(`${month}-01T00:00:00`, 'America/Sao_Paulo');
    dateEnd   = dateStart.endOf('month');
    label     = `${dateStart.format('MMMM [de] YYYY')}`;
  }
  else if (week) {
    weekValue = week;
    const [y, w] = week.split('-W').map(Number);
    dateStart = dayjs().year(y).isoWeek(w).tz('America/Sao_Paulo').startOf('isoWeek');
    dateEnd   = dateStart.clone().endOf('isoWeek');
    label     = `Semana de ${dateStart.format('DD/MM')} a ${dateEnd.format('DD/MM/YYYY')}`;
  }

  // busca todos os agendamentos e clientes
  const appointments = await Appointment.find().populate('clientId');
  const clients      = await Client.find();

  let totals       = {}, overallTotal = 0;
  let totalServicos = 0, totalProdutos = 0;
  let details      = {};

  // acumula pagamentos de serviços
  appointments.forEach(a => {
    a.services.forEach(svc => {
      svc.payments.forEach(p => {
        const paid = dayjs(p.paidAt).tz('America/Sao_Paulo');
        if (!dateStart || paid.isBetween(dateStart, dateEnd, null, '[]')) {
          totalServicos += p.amount;
          const key = ['Pix','Dinheiro','Cartão']
            .find(k => p.method.toLowerCase().includes(k.toLowerCase()));
          totals[key] = (totals[key]||0) + p.amount;
          details[key] = details[key] || [];
          details[key].push({
            date: paid.format('DD/MM/YYYY'),
            client: a.clientId.name,
            item: svc.name,
            amount: p.amount.toFixed(2),
            description: p.description || ''
          });
        }
      });
    });

    // acumula pagamentos de produtos
    a.products.forEach(prod => {
      prod.payments.forEach(p => {
        const paid = dayjs(p.paidAt).tz('America/Sao_Paulo');
        if (!dateStart || paid.isBetween(dateStart, dateEnd, null, '[]')) {
          totalProdutos += p.amount;
          const key = ['Pix','Dinheiro','Cartão']
            .find(k => p.method.toLowerCase().includes(k.toLowerCase()));
          totals[key] = (totals[key]||0) + p.amount;
          details[key] = details[key] || [];
          details[key].push({
            date: paid.format('DD/MM/YYYY'),
            client: a.clientId.name,
            item: prod.name,
            amount: p.amount.toFixed(2),
            description: p.description || ''
          });
        }
      });
    });
  });

  // também produtos cadastrados diretamente no cliente
  clients.forEach(c => {
    (c.products||[]).forEach(prod => {
      prod.payments.forEach(p => {
        const paid = dayjs(p.paidAt).tz('America/Sao_Paulo');
        if (!dateStart || paid.isBetween(dateStart, dateEnd, null, '[]')) {
          totalProdutos += p.amount;
          const key = ['Pix','Dinheiro','Cartão']
            .find(k => p.method.toLowerCase().includes(k.toLowerCase()));
          totals[key] = (totals[key]||0) + p.amount;
          details[key] = details[key] || [];
          details[key].push({
            date: paid.format('DD/MM/YYYY'),
            client: c.name,
            item: prod.name,
            amount: p.amount.toFixed(2),
            description: p.description || ''
          });
        }
      });
    });
  });

  overallTotal = totalServicos + totalProdutos;

  // renderiza passando **exatamente** o que o EJS espera
  res.render('financeiro', {
    label,
    dayValue,
    monthValue,
    weekValue,
    totals,
    details,
    totalServicos,
    totalProdutos,
    overallTotal
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


