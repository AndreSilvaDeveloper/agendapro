// routes/index.js
const express    = require('express');
const router     = express.Router();
const Client     = require('../models/Client');
const Appointment= require('../models/Appointment');
const dayjs      = require('dayjs');
const utc        = require('dayjs/plugin/utc');
const timezone   = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

// Twilio
const twilio = require('twilio');
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);
// Autenticação
function authMiddleware(req, res, next) {
  if (req.session && req.session.loggedIn) return next();
  res.redirect('/login');
}

// --- Login / Logout ---
router.get('/login', (req, res) => {
  res.render('login', { error: null });
});
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === 'samara' && password === '160793') {
    req.session.loggedIn = true;
    return res.redirect('/');
  }
  res.render('login', { error: 'Usuário ou senha inválidos' });
});
router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// --- Home e Busca de Clientes ---
router.get('/', authMiddleware, async (req, res) => {
  const clients = await Client.find();
  res.render('home', { clients });
});
router.get('/search', authMiddleware, async (req, res) => {
  const q = req.query.q?.trim() || '';
  const regex = new RegExp(q, 'i');
  const clients = await Client.find({ $or: [{ name: regex }, { phone: regex }] });
  res.render('home', { clients });
});

// --- Criar Cliente ---
router.post('/client', authMiddleware, async (req, res) => {
  const { name, phone } = req.body;
  await Client.create({ name, phone });
  res.redirect('/');
});




// --- Criar Agendamento + SMS ---
router.post('/appointment', authMiddleware, async (req, res) => {
  const { clientId, date, time, duration, services, products, force } = req.body;
  const parsedServices = services ? JSON.parse(services) : [];
  const parsedProducts = products ? JSON.parse(products) : [];

  // Início e fim no fuso SP
  const start = dayjs.tz(`${date}T${time}`, 'America/Sao_Paulo').toDate();
  const dur   = parseInt(duration, 10);
  const end   = new Date(start.getTime() + dur * 60000);

  // Verifica conflito
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
    // Pergunta se quer forçar
    return res.send(`
<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><title>Confirmar Agendamento</title></head><body>
  <script>
    if (confirm("⚠️ Já existe outro agendamento nesse horário. Deseja agendar assim mesmo?")) {
      const f = document.createElement('form');
      f.method = 'POST';
      f.action = '/appointment';
      const data = ${JSON.stringify({ clientId, date, time, duration, services, products, force: true })};
      for (const k in data) {
        const i = document.createElement('input');
        i.type = 'hidden'; i.name = k;
        i.value = typeof data[k] === 'string' ? data[k] : JSON.stringify(data[k]);
        f.appendChild(i);
      }
      document.body.appendChild(f);
      f.submit();
    } else {
      history.back();
    }
  </script>
</body></html>
    `);
  }

  // Sem conflito ou forçado: salva
  parsedServices.forEach(s => s.payments = []);
  parsedProducts.forEach(p => p.payments = []);
  const appt = await Appointment.create({
    clientId,
    date: start,
    duration: dur,
    services: parsedServices,
    products: parsedProducts
  });

  // Busca dados do cliente e envia SMS
  const client = await Client.findById(clientId);

  // extrai nome do primeiro serviço ou usa termo genérico
  const firstService = parsedServices[0]?.name || 'serviço';

  let raw = client.phone.replace(/\D/g, '');
  if (!raw.startsWith('55')) raw = '55' + raw;
  const toE164 = '+' + raw;

  try {
    await twilioClient.messages.create({
      to:   toE164,
      from: process.env.TWILIO_PHONE_NUMBER,
      body: `Olá ${client.name}! Seu agendamento de ${firstService} está confirmado para ${dayjs(start)
        .tz('America/Sao_Paulo')
        .format('DD/MM/YYYY [às] HH:mm')}.`
    });
    console.log('SMS enviado para', toE164);
  } catch (err) {
    console.error('Falha ao enviar SMS:', err.message);
  }

  res.redirect(`/client/${clientId}`);
});


// --- Página do Cliente (Futuros) ---
router.get('/client/:id', authMiddleware, async (req, res) => {
  const client = await Client.findById(req.params.id);
  const all     = await Appointment.find({ clientId: client._id });
  const midnight= dayjs().tz('America/Sao_Paulo').startOf('day').toDate();

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
      totalPaid    += (s.payments||[]).reduce((sum,p)=>sum+(p.amount||0),0);
    });
    a.products.forEach(p => {
      totalProduct += p.price;
      totalPaid    += (p.payments||[]).reduce((sum,p)=>sum+(p.amount||0),0);
    });
  });

  res.render('client', {
    client,
    appointments: upcoming,
    totalService,
    totalProduct,
    total: totalService+totalProduct,
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
      totalPaid    += (s.payments||[]).reduce((sum,p)=>sum+(p.amount||0),0);
    });
    a.products.forEach(p => {
      totalProduct += p.price;
      totalPaid    += (p.payments||[]).reduce((sum,p)=>sum+(p.amount||0),0);
    });
  });

  res.render('client', {
    client,
    appointments: past,
    totalService,
    totalProduct,
    total: totalService+totalProduct,
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
  a.services.splice(req.params.idx,1);
  await a.save();
  res.redirect(`/client/${a.clientId}`);
});
router.post('/appointment/:id/remove-product/:idx', authMiddleware, async (req, res) => {
  const a = await Appointment.findById(req.params.id);
  a.products.splice(req.params.idx,1);
  await a.save();
  res.redirect(`/client/${a.clientId}`);
});




// Rota de cancelamento de agendamento
router.post('/appointment/:id/cancel', authMiddleware, async (req, res) => {
  try {
    const appt = await Appointment.findById(req.params.id).populate('clientId');
    if (!appt) return res.status(404).send('Agendamento não encontrado.');

    // extrai nome do primeiro serviço ou usa termo genérico
    const firstService = appt.services[0]?.name || 'serviço';

    // formata telefone em E.164
    let raw = appt.clientId.phone.replace(/\D/g, '');
    if (!raw.startsWith('55')) raw = '55' + raw;
    const toE164 = '+' + raw;

    // verifica configuração de envio
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;
    const serviceSid  = process.env.TWILIO_MESSAGING_SERVICE_SID;
    if (!fromNumber && !serviceSid) {
      console.error(
        (!fromNumber ? 'TWILIO_PHONE_NUMBER' : '') +
        (!fromNumber && !serviceSid ? ' e ' : '') +
        (!serviceSid ? 'TWILIO_MESSAGING_SERVICE_SID' : '') +
        ' não definidos.'
      );
      return res.status(500).send('Configuração do Twilio ausente.');
    }

    // monta opções de mensagem
    const msgOpts = { to: toE164 };
    if (fromNumber)      msgOpts.from = fromNumber;
    else if (serviceSid) msgOpts.messagingServiceSid = serviceSid;

    msgOpts.body = `Olá ${appt.clientId.name}! Seu agendamento de ${firstService} para ${dayjs(appt.date)
      .tz('America/Sao_Paulo')
      .format('DD/MM/YYYY [às] HH:mm')} foi cancelado.`;

    // envia SMS
    await twilioClient.messages.create(msgOpts);
    console.log('SMS de cancelamento enviado para', toE164);

    // remove do banco
    await Appointment.deleteOne({ _id: appt._id });

    res.redirect(`/client/${appt.clientId._id}`);
  } catch (err) {
    console.error('Erro ao cancelar agendamento:', err);
    res.status(500).send('Erro ao cancelar agendamento.');
  }
});

// --- Pagamentos com Método ---
router.post('/appointment/:id/pay-service/:idx', authMiddleware, async (req, res) => {
  const { amount, description, method } = req.body;
  const a     = await Appointment.findById(req.params.id);
  const item  = a.services[req.params.idx];
  const val   = parseFloat(amount);
  if (isNaN(val)||val<=0) return res.send("Valor inválido.");
  if (!['Pix','Dinheiro','Cartão'].includes(method)) return res.send("Método inválido.");
  item.payments.push({ amount:val, paidAt:new Date(), description:description||'', method });
  await a.save();
  res.redirect(`/client/${a.clientId}`);
});
router.post('/appointment/:id/pay-product/:idx', authMiddleware, async (req, res) => {
  const { amount, description, method } = req.body;
  const a     = await Appointment.findById(req.params.id);
  const item  = a.products[req.params.idx];
  const val   = parseFloat(amount);
  if (isNaN(val)||val<=0) return res.send("Valor inválido.");
  if (!['Pix','Dinheiro','Cartão'].includes(method)) return res.send("Método inválido.");
  item.payments.push({ amount:val, paidAt:new Date(), description:description||'', method });
  await a.save();
  res.redirect(`/client/${a.clientId}`);
});

// --- Remover Pagamento ---
router.post('/appointment/:id/remove-payment/service/:sIdx/:pIdx', authMiddleware, async (req, res) => {
  const a = await Appointment.findById(req.params.id);
  a.services[req.params.sIdx].payments.splice(req.params.pIdx,1);
  await a.save();
  res.redirect(`/client/${a.clientId}`);
});
router.post('/appointment/:id/remove-payment/product/:pIdx/:ppIdx', authMiddleware, async (req, res) => {
  const a = await Appointment.findById(req.params.id);
  a.products[req.params.pIdx].payments.splice(req.params.ppIdx,1);
  await a.save();
  res.redirect(`/client/${a.clientId}`);
});

// --- Agenda por Dia (ordenado) ---
router.get('/agendamentos-por-dia', authMiddleware, async (req, res) => {
  const { date } = req.query;
  if (!date) return res.render('agenda-dia',{ date:null, results:[] });

  const start = dayjs.tz(`${date}T00:00:00`,'America/Sao_Paulo').toDate();
  const end   = dayjs.tz(`${date}T23:59:59`,'America/Sao_Paulo').toDate();

  const ags = await Appointment.find({
    date:{ $gte:start, $lte:end }
  }).sort({ date:1 }).populate('clientId');

  const results = ags.filter(a=>a.services.length>0).map(a=>({
    clientId: a.clientId,
    services: a.services,
    timeFormatted: dayjs(a.date).tz('America/Sao_Paulo').format('HH:mm')
  }));

  res.render('agenda-dia',{ date, results });
});

// --- Editar Cliente, Serviço, Produto ---
router.post('/client/:id/edit', authMiddleware, async (req, res) => {
  const { name, phone } = req.body;
  await Client.findByIdAndUpdate(req.params.id,{ name, phone });
  res.redirect(`/client/${req.params.id}`);
});
router.post('/appointment/:id/edit-service/:idx', authMiddleware, async (req, res) => {
  const a = await Appointment.findById(req.params.id);
  const { name, price } = req.body;
  a.services[req.params.idx].name  = name;
  a.services[req.params.idx].price = parseFloat(price);
  await a.save();
  res.redirect(`/client/${a.clientId}`);
});
router.post('/appointment/:id/edit-product/:idx', authMiddleware, async (req, res) => {
  const a = await Appointment.findById(req.params.id);
  const { name, price } = req.body;
  a.products[req.params.idx].name  = name;
  a.products[req.params.idx].price = parseFloat(price);
  await a.save();
  res.redirect(`/client/${a.clientId}`);
});

// --- Financeiro por Mês ---
router.get('/financeiro', authMiddleware, async (req, res) => {
  const { month } = req.query;
  const monthNames= ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

  let filter={}, monthLabel='', monthValue='';
  if (month) {
    const [year, mon] = month.split('-');
    monthValue = month;
    monthLabel = `${monthNames[parseInt(mon,10)-1]} de ${year}`;
    const start = dayjs.tz(`${month}-01T00:00:00`,'America/Sao_Paulo').toDate();
    const end   = dayjs(start).endOf('month').toDate();
    filter.date={ $gte:start, $lte:end };
  }

  const ags = await Appointment.find(filter).populate('clientId').exec();
  const totals  = {};
  const details = {};

  ags.forEach(a => {
    const date = dayjs(a.date).tz('America/Sao_Paulo').format('DD/MM/YYYY');
    [...a.services,...a.products].forEach(item => {
      (item.payments||[]).forEach(p => {
        const m = (p.method||'').toLowerCase();
        let key;
        if (m.includes('pix'))                    key='Pix';
        else if (m.includes('dinheiro'))          key='Dinheiro';
        else if (m.includes('cartão')||m.includes('cartao')) key='Cartão';
        else return;

        totals[key]  = (totals[key]||0)+p.amount;
        details[key] = details[key]||[];
        details[key].push({
          date,
          client: a.clientId.name,
          item:   item.name,
          amount: p.amount.toFixed(2),
          description: p.description||''
        });
      });
    });
  });

  const overallTotal = Object.values(totals).reduce((sum,v)=>sum+v,0);
  res.render('financeiro',{
    monthLabel, monthValue, totals, details, overallTotal
  });
});



module.exports = router;
