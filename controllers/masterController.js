// controllers/masterController.js
// Painel Master (SuperAdmin) - Gerenciamento completo da plataforma

const db = require('../models');
const { Op } = require('sequelize');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const isBetween = require('dayjs/plugin/isBetween');
const slugify = require('slugify');
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isBetween);

// Helper: formata org com dados flat para as views
function formatOrg(org) {
  const o = org.toJSON ? org.toJSON() : org;
  const sub = o.Subscription || null;
  const plan = sub && sub.Plan ? sub.Plan : null;
  const owner = (o.Users && o.Users.length > 0) ? o.Users[0] : null;
  return {
    ...o,
    owner,
    planName: plan ? plan.name : null,
    subscriptionStatus: sub ? sub.status : null,
    subscriptionId: sub ? sub.id : null,
  };
}

// ========================================
// DASHBOARD
// ========================================
exports.getDashboard = async (req, res) => {
  try {
    const now = dayjs().tz('America/Sao_Paulo');
    const startOfMonth = now.startOf('month').toDate();

    const [totalOrgs, newOrgsThisMonth, subscriptions, allOrgs] = await Promise.all([
      db.Organization.count(),
      db.Organization.count({ where: { createdAt: { [Op.gte]: startOfMonth } } }),
      db.Subscription ? db.Subscription.findAll({ include: [{ model: db.Plan, attributes: ['name', 'price'] }] }) : [],
      db.Organization.findAll({
        order: [['createdAt', 'DESC']],
        limit: 10,
        include: [
          { model: db.User, as: 'Users', where: { role: 'owner' }, attributes: ['id', 'username', 'email', 'isBlocked'], required: false },
          ...(db.Subscription ? [{ model: db.Subscription, include: [{ model: db.Plan, attributes: ['name', 'slug'] }] }] : [])
        ]
      })
    ]);

    const activeSubscriptions = subscriptions.filter(s => s.status === 'active' || s.status === 'trial').length;
    const monthlyRevenue = subscriptions
      .filter(s => s.status === 'active')
      .reduce((sum, s) => sum + (s.Plan ? parseFloat(s.Plan.price) : 0), 0);

    // Receita por plano
    const revenueByPlan = [];
    if (db.Plan) {
      const plans = await db.Plan.findAll({ where: { isActive: true }, order: [['sortOrder', 'ASC']] });
      for (const plan of plans) {
        const count = subscriptions.filter(s => s.planId === plan.id && s.status === 'active').length;
        revenueByPlan.push({ planName: plan.name, count, revenue: (count * parseFloat(plan.price)).toFixed(2) });
      }
    }

    // Atividade recente
    const recentActivity = allOrgs.slice(0, 5).map(org => ({
      icon: 'building',
      description: `Nova organizacao: ${org.name}`,
      timeAgo: dayjs(org.createdAt).format('DD/MM HH:mm')
    }));

    res.render('master/dashboard', {
      path: '/master',
      stats: { totalOrgs, activeSubscriptions, monthlyRevenue: monthlyRevenue.toFixed(2), newOrgsThisMonth },
      recentOrgs: allOrgs.map(formatOrg),
      revenueByPlan,
      recentActivity,
      originalAdminSession: req.session.originalAdminSession || null
    });
  } catch (err) {
    console.error('Erro no dashboard master:', err);
    res.redirect('/login');
  }
};

// ========================================
// ORGANIZACOES - LISTA
// ========================================
exports.getOrganizacoes = async (req, res) => {
  try {
    const { search, plan, status, page = 1 } = req.query;
    const limit = 20;
    const offset = (page - 1) * limit;

    const where = {};
    if (search) {
      where.name = { [Op.iLike]: `%${search}%` };
    }

    const include = [
      { model: db.User, as: 'Users', where: { role: 'owner' }, attributes: ['id', 'username', 'email', 'isBlocked'], required: false }
    ];

    if (db.Subscription) {
      const subWhere = {};
      if (status) subWhere.status = status;

      const subInclude = { model: db.Plan, attributes: ['name', 'slug'] };
      if (plan) subInclude.where = { slug: plan };

      include.push({
        model: db.Subscription,
        include: [subInclude],
        where: Object.keys(subWhere).length > 0 ? subWhere : undefined,
        required: !!(status || plan)
      });
    }

    const { count, rows } = await db.Organization.findAndCountAll({
      where,
      include,
      order: [['createdAt', 'DESC']],
      limit,
      offset,
      distinct: true
    });

    const plans = db.Plan ? await db.Plan.findAll({ where: { isActive: true }, order: [['sortOrder', 'ASC']] }) : [];

    res.render('master/organizacoes', {
      path: '/master/organizacoes',
      organizations: rows.map(formatOrg),
      plans: plans.map(p => p.toJSON()),
      pagination: { page: parseInt(page), limit, totalPages: Math.ceil(count / limit), total: count },
      query: { search: search || '', plan: plan || '', status: status || '' }
    });
  } catch (err) {
    console.error('Erro ao listar organizacoes:', err);
    req.flash('error', 'Erro ao carregar organizacoes.');
    res.redirect('/master');
  }
};

// ========================================
// ORGANIZACOES - DETALHES
// ========================================
exports.getOrganizacaoDetalhes = async (req, res) => {
  try {
    const { id } = req.params;

    const org = await db.Organization.findByPk(id, {
      include: [
        { model: db.User, as: 'Users', attributes: ['id', 'username', 'email', 'role', 'isBlocked', 'createdAt'] },
        ...(db.Subscription ? [{ model: db.Subscription, include: [{ model: db.Plan }] }] : []),
        { model: db.Client, attributes: ['id'] },
        { model: db.Staff, attributes: ['id'] },
        { model: db.Service, attributes: ['id'] },
        { model: db.Appointment, attributes: ['id', 'status'] }
      ]
    });

    if (!org) {
      req.flash('error', 'Organizacao nao encontrada.');
      return res.redirect('/master/organizacoes');
    }

    const plans = db.Plan ? await db.Plan.findAll({ where: { isActive: true }, order: [['sortOrder', 'ASC']] }) : [];

    const orgData = org.toJSON();
    const sub = orgData.Subscription || null;
    const stats = {
      totalUsers: orgData.Users ? orgData.Users.length : 0,
      totalClients: orgData.Clients ? orgData.Clients.length : 0,
      totalStaff: orgData.Staff ? orgData.Staff.length : 0,
      totalServices: orgData.Services ? orgData.Services.length : 0,
      totalAppointments: orgData.Appointments ? orgData.Appointments.length : 0,
      confirmedAppointments: orgData.Appointments ? orgData.Appointments.filter(a => a.status === 'confirmado').length : 0
    };

    res.render('master/organizacao-detalhes', {
      path: '/master/organizacoes',
      org: orgData,
      subscription: sub,
      plan: sub && sub.Plan ? sub.Plan : null,
      plans: plans.map(p => p.toJSON()),
      stats
    });
  } catch (err) {
    console.error('Erro ao ver detalhes da org:', err);
    req.flash('error', 'Erro ao carregar detalhes.');
    res.redirect('/master/organizacoes');
  }
};

// ========================================
// ASSINATURAS
// ========================================
exports.getAssinaturas = async (req, res) => {
  try {
    if (!db.Subscription) {
      return res.render('master/assinaturas', { path: '/master/assinaturas', subscriptions: [], stats: {}, plans: [], query: {} });
    }

    const { status, plan } = req.query;
    const where = {};
    if (status) where.status = status;

    const planInclude = { model: db.Plan, attributes: ['name', 'slug', 'price'] };
    if (plan) planInclude.where = { slug: plan };

    const subscriptions = await db.Subscription.findAll({
      where,
      include: [
        { model: db.Organization, attributes: ['id', 'name'] },
        planInclude
      ],
      order: [['createdAt', 'DESC']]
    });

    const allSubs = await db.Subscription.findAll();
    const stats = {
      total: allSubs.length,
      active: allSubs.filter(s => s.status === 'active').length,
      trial: allSubs.filter(s => s.status === 'trial').length,
      canceled: allSubs.filter(s => s.status === 'canceled').length,
      pastDue: allSubs.filter(s => s.status === 'past_due').length
    };

    const plans = await db.Plan.findAll({ where: { isActive: true }, order: [['sortOrder', 'ASC']] });

    // Formatar para a view
    const formattedSubs = subscriptions.map(s => {
      const sj = s.toJSON();
      return {
        ...sj,
        orgName: sj.Organization ? sj.Organization.name : '-',
        orgId: sj.Organization ? sj.Organization.id : null,
        planName: sj.Plan ? sj.Plan.name : '-',
        cycle: sj.billingCycle,
        startDate: sj.currentPeriodStart,
        endDate: sj.currentPeriodEnd,
        gateway: sj.paymentGateway || '-'
      };
    });

    res.render('master/assinaturas', {
      path: '/master/assinaturas',
      subscriptions: formattedSubs,
      stats,
      plans: plans.map(p => p.toJSON()),
      query: { status: status || '', plan: plan || '' }
    });
  } catch (err) {
    console.error('Erro ao listar assinaturas:', err);
    req.flash('error', 'Erro ao carregar assinaturas.');
    res.redirect('/master');
  }
};

// ========================================
// PLANOS - LISTA
// ========================================
exports.getPlanos = async (req, res) => {
  try {
    if (!db.Plan) {
      return res.render('master/planos', { path: '/master/planos', plans: [] });
    }

    const plans = await db.Plan.findAll({ order: [['sortOrder', 'ASC']] });

    const plansWithCounts = [];
    for (const plan of plans) {
      const subscriberCount = db.Subscription
        ? await db.Subscription.count({ where: { planId: plan.id, status: { [Op.in]: ['active', 'trial'] } } })
        : 0;
      plansWithCounts.push({ ...plan.toJSON(), subscriberCount });
    }

    res.render('master/planos', {
      path: '/master/planos',
      plans: plansWithCounts
    });
  } catch (err) {
    console.error('Erro ao listar planos:', err);
    req.flash('error', 'Erro ao carregar planos.');
    res.redirect('/master');
  }
};

// ========================================
// PLANOS - FORMULARIO NOVO
// ========================================
exports.getNewPlan = (req, res) => {
  res.render('master/plano-form', {
    path: '/master/planos',
    plan: null,
    isEdit: false
  });
};

exports.postNewPlan = async (req, res) => {
  try {
    const { name, price, yearlyPrice, description, isActive, isFeatured, sortOrder, features } = req.body;

    const slug = slugify(name, { lower: true, strict: true });

    await db.Plan.create({
      name,
      slug,
      price: parseFloat(price) || 0,
      yearlyPrice: parseFloat(yearlyPrice) || 0,
      description: description || '',
      isActive: isActive === 'on',
      isFeatured: isFeatured === 'on',
      sortOrder: parseInt(sortOrder) || 0,
      features: features ? features.split('\n').map(f => f.trim()).filter(Boolean) : []
    });

    req.flash('success', 'Plano criado com sucesso.');
    res.redirect('/master/planos');
  } catch (err) {
    console.error('Erro ao criar plano:', err);
    req.flash('error', 'Erro ao criar plano.');
    res.redirect('/master/planos/novo');
  }
};

// ========================================
// PLANOS - FORMULARIO EDITAR
// ========================================
exports.getEditPlan = async (req, res) => {
  try {
    const plan = await db.Plan.findByPk(req.params.id);
    if (!plan) {
      req.flash('error', 'Plano nao encontrado.');
      return res.redirect('/master/planos');
    }

    res.render('master/plano-form', {
      path: '/master/planos',
      plan: plan.toJSON(),
      isEdit: true
    });
  } catch (err) {
    console.error('Erro ao carregar plano:', err);
    res.redirect('/master/planos');
  }
};

exports.postEditPlan = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, price, yearlyPrice, description, isActive, isFeatured, sortOrder, features } = req.body;

    const plan = await db.Plan.findByPk(id);
    if (!plan) {
      req.flash('error', 'Plano nao encontrado.');
      return res.redirect('/master/planos');
    }

    await plan.update({
      name: name || plan.name,
      price: price ? parseFloat(price) : plan.price,
      yearlyPrice: yearlyPrice ? parseFloat(yearlyPrice) : plan.yearlyPrice,
      description: description !== undefined ? description : plan.description,
      isActive: isActive === 'on',
      isFeatured: isFeatured === 'on',
      sortOrder: sortOrder ? parseInt(sortOrder) : plan.sortOrder,
      features: features ? features.split('\n').map(f => f.trim()).filter(Boolean) : plan.features
    });

    req.flash('success', 'Plano atualizado com sucesso.');
    res.redirect('/master/planos');
  } catch (err) {
    console.error('Erro ao editar plano:', err);
    req.flash('error', 'Erro ao atualizar plano.');
    res.redirect('/master/planos');
  }
};

// ========================================
// FINANCEIRO
// ========================================
exports.getFinanceiro = async (req, res) => {
  try {
    const { period } = req.query;
    const targetMonth = period ? dayjs(period, 'YYYY-MM') : dayjs().tz('America/Sao_Paulo');
    const startOfMonth = targetMonth.startOf('month').toDate();
    const endOfMonth = targetMonth.endOf('month').toDate();

    let mrr = 0, activeCount = 0, trialCount = 0, canceledThisMonth = 0;
    const transactions = [];

    if (db.Subscription && db.Plan) {
      const subs = await db.Subscription.findAll({
        include: [
          { model: db.Organization, attributes: ['name'] },
          { model: db.Plan, attributes: ['name', 'price', 'yearlyPrice'] }
        ]
      });

      for (const sub of subs) {
        if (sub.status === 'active' && sub.Plan) {
          const monthlyValue = sub.billingCycle === 'yearly'
            ? parseFloat(sub.Plan.yearlyPrice) / 12
            : parseFloat(sub.Plan.price);
          mrr += monthlyValue;
          activeCount++;
        }
        if (sub.status === 'trial') trialCount++;
        if (sub.status === 'canceled' && sub.canceledAt && dayjs(sub.canceledAt).isBetween(startOfMonth, endOfMonth)) {
          canceledThisMonth++;
        }

        if (dayjs(sub.createdAt).isBetween(startOfMonth, endOfMonth)) {
          transactions.push({
            date: dayjs(sub.createdAt).format('DD/MM/YYYY'),
            org: sub.Organization ? sub.Organization.name : 'N/A',
            plan: sub.Plan ? sub.Plan.name : 'N/A',
            value: sub.billingCycle === 'yearly' ? parseFloat(sub.Plan?.yearlyPrice || 0) : parseFloat(sub.Plan?.price || 0),
            status: sub.status,
            gateway: sub.paymentGateway || 'Manual'
          });
        }
      }
    }

    const totalSubs = activeCount + trialCount;
    const churnRate = totalSubs > 0 ? ((canceledThisMonth / totalSubs) * 100).toFixed(1) : '0.0';
    const arpu = activeCount > 0 ? (mrr / activeCount).toFixed(2) : '0.00';

    res.render('master/financeiro', {
      path: '/master/financeiro',
      stats: {
        mrr: mrr.toFixed(2),
        arr: (mrr * 12).toFixed(2),
        churnRate,
        arpu,
        activeCount,
        trialCount
      },
      transactions,
      query: { period: targetMonth.format('YYYY-MM') }
    });
  } catch (err) {
    console.error('Erro no financeiro master:', err);
    req.flash('error', 'Erro ao carregar financeiro.');
    res.redirect('/master');
  }
};

// ========================================
// USUARIOS
// ========================================
exports.getUsuarios = async (req, res) => {
  try {
    const { search, role } = req.query;
    const where = {};
    if (search) {
      where[Op.or] = [
        { username: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } }
      ];
    }
    if (role) where.role = role;

    const users = await db.User.findAll({
      where,
      include: [{ model: db.Organization, attributes: ['id', 'name'] }],
      order: [['createdAt', 'DESC']],
      attributes: ['id', 'username', 'email', 'role', 'isBlocked', 'createdAt']
    });

    res.render('master/usuarios', {
      path: '/master/usuarios',
      users: users.map(u => u.toJSON()),
      filters: { search: search || '', role: role || '' }
    });
  } catch (err) {
    console.error('Erro ao listar usuarios:', err);
    req.flash('error', 'Erro ao carregar usuarios.');
    res.redirect('/master');
  }
};

// ========================================
// CONFIGURACOES MASTER
// ========================================
exports.getConfiguracoes = async (req, res) => {
  try {
    const paymentService = require('../services/paymentService');
    const gateways = paymentService.getAvailableGateways();

    res.render('master/configuracoes', {
      path: '/master/configuracoes',
      gateways
    });
  } catch (err) {
    console.error('Erro nas configuracoes master:', err);
    req.flash('error', 'Erro ao carregar configuracoes.');
    res.redirect('/master');
  }
};

// ========================================
// ASSINATURA MANUAL (criar/alterar plano de uma org)
// ========================================
exports.postChangeSubscription = async (req, res) => {
  try {
    const { orgId, planId, status, billingCycle, useGateway } = req.body;

    if (!db.Subscription || !db.Plan) {
      req.flash('error', 'Sistema de planos nao disponivel.');
      return res.redirect('/master/organizacoes');
    }

    const plan = await db.Plan.findByPk(planId);
    if (!plan) {
      req.flash('error', 'Plano nao encontrado.');
      return res.redirect('/master/organizacoes');
    }

    const org = await db.Organization.findByPk(orgId, {
      include: [{ model: db.User, as: 'Users', where: { role: 'owner' }, attributes: ['username', 'email'], required: false }]
    });
    if (!org) {
      req.flash('error', 'Organizacao nao encontrada.');
      return res.redirect('/master/organizacoes');
    }

    const now = new Date();
    const cycle = billingCycle || 'monthly';
    const periodEnd = cycle === 'yearly'
      ? dayjs(now).add(1, 'year').toDate()
      : dayjs(now).add(1, 'month').toDate();

    let gatewayData = {};

    // Se solicitou integracao com gateway e o plano e pago
    if (useGateway === 'asaas' && parseFloat(plan.price) > 0) {
      const paymentService = require('../services/paymentService');
      if (paymentService.isGatewayConfigured('asaas')) {
        const owner = org.Users && org.Users[0];
        const result = await paymentService.createSubscription('asaas', {
          org,
          plan,
          billingCycle: cycle,
          customer: {
            name: owner ? owner.username : org.name,
            email: owner ? owner.email : 'sem-email@agendapro.com'
          }
        });
        gatewayData = {
          paymentGateway: 'asaas',
          gatewayCustomerId: result.gatewayCustomerId,
          gatewaySubscriptionId: result.gatewaySubscriptionId,
          gatewayData: result.gatewayData
        };
      }
    }

    const [subscription, created] = await db.Subscription.findOrCreate({
      where: { organizationId: orgId },
      defaults: {
        planId: plan.id,
        status: status || 'active',
        billingCycle: cycle,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        ...gatewayData
      }
    });

    if (!created) {
      // Se tinha assinatura no gateway antigo, cancela
      if (subscription.gatewaySubscriptionId && subscription.paymentGateway && !useGateway) {
        try {
          const paymentService = require('../services/paymentService');
          await paymentService.cancelSubscription(subscription.paymentGateway, subscription.gatewaySubscriptionId);
        } catch (e) {
          console.error('Erro ao cancelar assinatura antiga no gateway:', e.message);
        }
      }

      await subscription.update({
        planId: plan.id,
        status: status || subscription.status,
        billingCycle: cycle,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        ...gatewayData
      });
    }

    req.flash('success', `Plano ${plan.name} ${created ? 'atribuido' : 'atualizado'} com sucesso.`);
    res.redirect(req.get('Referer') || '/master/organizacoes');
  } catch (err) {
    console.error('Erro ao alterar assinatura:', err);
    req.flash('error', `Erro ao alterar assinatura: ${err.message}`);
    res.redirect(req.get('Referer') || '/master/organizacoes');
  }
};

// ========================================
// WEBHOOK DE PAGAMENTO (futuro)
// ========================================
exports.handlePaymentWebhook = async (req, res) => {
  try {
    const { gateway } = req.params;

    // Validar webhook token do Asaas
    if (gateway === 'asaas' && process.env.ASAAS_WEBHOOK_TOKEN) {
      const token = req.headers['asaas-access-token'] || req.query.access_token;
      if (token !== process.env.ASAAS_WEBHOOK_TOKEN) {
        console.warn('[Webhook] Token invalido recebido');
        return res.status(401).json({ error: 'Token invalido' });
      }
    }

    const paymentService = require('../services/paymentService');

    if (!paymentService.isGatewayConfigured(gateway)) {
      return res.status(400).json({ error: 'Gateway nao configurado' });
    }

    const result = await paymentService.handleWebhook(gateway, req.body);
    console.log(`[Webhook ${gateway}] Resultado:`, JSON.stringify(result));
    res.json({ success: true, result });
  } catch (err) {
    console.error('[Webhook Pagamento] Erro:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ========================================
// IMPERSONACAO
// ========================================
exports.impersonate = async (req, res) => {
  try {
    const { orgId } = req.params;
    const owner = await db.User.findOne({ where: { organizationId: orgId, role: 'owner' } });

    if (!owner) return res.redirect('/master');
    if (owner.isBlocked) {
      req.flash('error', 'Usuario bloqueado. Desbloqueie primeiro.');
      return res.redirect('/master');
    }

    req.session.originalAdminSession = {
      userId: req.session.userId,
      username: req.session.username,
      role: req.session.role,
    };

    req.session.loggedIn = true;
    req.session.userId = owner.id;
    req.session.username = owner.username;
    req.session.role = owner.role;
    req.session.organizationId = owner.organizationId;

    req.session.save((err) => {
      if (err) return res.redirect('/master');
      res.redirect('/dashboard');
    });
  } catch (err) {
    console.error('Erro ao impersonar:', err);
    res.redirect('/master');
  }
};

exports.stopImpersonation = (req, res) => {
  if (!req.session.originalAdminSession) return res.redirect('/dashboard');

  const adminSession = req.session.originalAdminSession;
  req.session.loggedIn = true;
  req.session.userId = adminSession.userId;
  req.session.username = adminSession.username;
  req.session.role = adminSession.role;
  req.session.organizationId = null;
  req.session.originalAdminSession = null;

  req.session.save((err) => {
    if (err) return res.redirect('/');
    res.redirect('/master');
  });
};

exports.blockUser = async (req, res) => {
  try {
    const user = await db.User.findByPk(req.params.userId);
    if (!user || user.role === 'superadmin') return res.redirect('/master');
    user.isBlocked = true;
    await user.save();
    req.flash('success', `Usuario ${user.username} bloqueado.`);
    res.redirect(req.get('Referer') || '/master');
  } catch (err) {
    console.error('Erro ao bloquear:', err);
    res.redirect('/master');
  }
};

exports.unblockUser = async (req, res) => {
  try {
    const user = await db.User.findByPk(req.params.userId);
    if (!user) return res.redirect('/master');
    user.isBlocked = false;
    await user.save();
    req.flash('success', `Usuario ${user.username} desbloqueado.`);
    res.redirect(req.get('Referer') || '/master');
  } catch (err) {
    console.error('Erro ao desbloquear:', err);
    res.redirect('/master');
  }
};

// ========================================
// LANDING PAGE
// ========================================
exports.getLandingPage = async (req, res) => {
  try {
    const plans = db.Plan ? await db.Plan.findAll({ where: { isActive: true }, order: [['sortOrder', 'ASC']] }) : [];
    res.render('landing', { plans: plans.map(p => p.toJSON()) });
  } catch (err) {
    console.error('Erro na landing page:', err);
    res.render('landing', { plans: [] });
  }
};
