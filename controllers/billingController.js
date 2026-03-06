// controllers/billingController.js
// Pagina de assinatura/pagamento para donos de loja

const db = require('../models');
const { Op } = require('sequelize');
const paymentService = require('../services/paymentService');

// GET /admin/assinatura - Pagina de assinatura
exports.getAssinatura = async (req, res) => {
  try {
    const orgId = req.session.organizationId;

    const [subscription, plans, org] = await Promise.all([
      db.Subscription.findOne({
        where: { organizationId: orgId },
        include: [{ model: db.Plan }]
      }),
      db.Plan.findAll({ where: { isActive: true }, order: [['sortOrder', 'ASC']] }),
      db.Organization.findByPk(orgId, {
        include: [{ model: db.User, as: 'Users', where: { role: 'owner' }, attributes: ['username', 'email'], required: false }]
      })
    ]);

    // Buscar dados de pagamento do Asaas (boleto, PIX QR code, historico)
    let paymentUrl = null;
    let invoiceUrl = null;
    let boletoData = null;
    let pixData = null;
    let pendingPayment = null;
    let paymentHistory = [];

    if (subscription && subscription.gatewaySubscriptionId && subscription.paymentGateway === 'asaas') {
      try {
        const asaasService = require('../services/asaasService');
        const payments = await asaasService.getSubscriptionPayments(subscription.gatewaySubscriptionId);
        if (payments.data && payments.data.length > 0) {
          // Historico de pagamentos
          paymentHistory = payments.data.map(p => ({
            id: p.id,
            value: p.value,
            status: p.status,
            dueDate: p.dueDate,
            paymentDate: p.paymentDate || null,
            billingType: p.billingType,
            invoiceUrl: p.invoiceUrl,
            bankSlipUrl: p.bankSlipUrl
          }));

          // Pega a cobranca pendente/vencida
          const pending = payments.data.find(p => p.status === 'PENDING' || p.status === 'OVERDUE');
          if (pending) {
            pendingPayment = pending;
            invoiceUrl = pending.invoiceUrl;
            paymentUrl = pending.bankSlipUrl || pending.invoiceUrl;

            try {
              const boletoInfo = await asaasService.getPaymentLink(pending.id);
              boletoData = {
                barCode: boletoInfo.barCode || null,
                identificationField: boletoInfo.identificationField || null,
                nossoNumero: boletoInfo.nossoNumero || null
              };
            } catch (e) {
              console.error('Erro ao buscar boleto:', e.message);
            }

            try {
              const pixInfo = await asaasService.getPixQrCode(pending.id);
              pixData = {
                encodedImage: pixInfo.encodedImage || null,
                payload: pixInfo.payload || null,
                expirationDate: pixInfo.expirationDate || null
              };
            } catch (e) {
              console.error('Erro ao buscar PIX QR:', e.message);
            }
          }
        }
      } catch (e) {
        console.error('Erro ao buscar pagamentos Asaas:', e.message);
      }
    }

    const asaasConfigured = paymentService.isGatewayConfigured('asaas');
    const isSandbox = paymentService.isSandbox('asaas');

    // Calcular alertas de vencimento
    let daysAlert = null; // { type: 'trial'|'invoice', days: N }
    if (subscription) {
      const sub = subscription.toJSON ? subscription.toJSON() : subscription;
      const now = new Date();

      if (sub.status === 'trial' && sub.trialEndsAt) {
        const diff = Math.ceil((new Date(sub.trialEndsAt) - now) / (1000 * 60 * 60 * 24));
        if (diff >= 0 && diff <= 7) {
          daysAlert = { type: 'trial', days: diff };
        }
      }

      if (sub.status === 'active' && sub.currentPeriodEnd) {
        const diff = Math.ceil((new Date(sub.currentPeriodEnd) - now) / (1000 * 60 * 60 * 24));
        if (diff >= 0 && diff <= 7) {
          daysAlert = { type: 'invoice', days: diff };
        }
      }
    }

    res.render('admin/assinatura', {
      activePage: 'assinatura',
      pageTitle: 'Minha Assinatura',
      subscription: subscription ? subscription.toJSON() : null,
      currentPlan: subscription && subscription.Plan ? subscription.Plan.toJSON() : null,
      plans: plans.map(p => p.toJSON()),
      org: org ? org.toJSON() : null,
      paymentUrl,
      invoiceUrl,
      boletoData,
      pixData,
      pendingPayment,
      paymentHistory,
      daysAlert,
      asaasConfigured,
      isSandbox,
      blocked: req.query.blocked === 'true',
      expired: req.query.expired || null
    });
  } catch (err) {
    console.error('Erro ao carregar assinatura:', err);
    req.flash('error', 'Erro ao carregar dados da assinatura.');
    res.redirect('/dashboard');
  }
};

// POST /admin/assinatura/escolher - Escolher/trocar plano
exports.postEscolherPlano = async (req, res) => {
  try {
    const orgId = req.session.organizationId;
    const { planId, billingCycle, billingType } = req.body;

    const plan = await db.Plan.findByPk(planId);
    if (!plan) {
      req.flash('error', 'Plano nao encontrado.');
      return res.redirect('/admin/assinatura');
    }

    const org = await db.Organization.findByPk(orgId, {
      include: [{ model: db.User, as: 'Users', where: { role: 'owner' }, attributes: ['username', 'email'], required: false }]
    });

    const cycle = billingCycle || 'monthly';
    const payType = billingType || 'BOLETO';
    const now = new Date();
    let gatewayData = {};

    // Se plano pago e Asaas configurado, cria assinatura no gateway
    if (parseFloat(plan.price) > 0 && paymentService.isGatewayConfigured('asaas')) {
      const owner = org.Users && org.Users[0];

      // Montar dados de cartao se billingType for CREDIT_CARD
      let creditCard = null;
      let creditCardHolderInfo = null;
      if (payType === 'CREDIT_CARD' && req.body.cardNumber) {
        creditCard = {
          holderName: req.body.cardHolderName,
          number: req.body.cardNumber.replace(/\s/g, ''),
          expiryMonth: req.body.cardExpiryMonth,
          expiryYear: req.body.cardExpiryYear,
          ccv: req.body.cardCcv
        };
        creditCardHolderInfo = {
          name: req.body.cardHolderName,
          email: owner ? owner.email : req.body.holderEmail,
          cpfCnpj: req.body.holderCpf || '',
          postalCode: req.body.holderPostalCode || '',
          addressNumber: req.body.holderAddressNumber || '',
          phone: req.body.holderPhone || ''
        };
      }

      const result = await paymentService.createSubscription('asaas', {
        org,
        plan,
        billingCycle: cycle,
        billingType: payType,
        creditCard,
        creditCardHolderInfo,
        customer: {
          name: owner ? owner.username : org.name,
          email: owner ? owner.email : 'contato@agendapro.com'
        }
      });

      gatewayData = {
        paymentGateway: 'asaas',
        gatewayCustomerId: result.gatewayCustomerId,
        gatewaySubscriptionId: result.gatewaySubscriptionId,
        gatewayData: result.gatewayData
      };
    }

    const periodEnd = cycle === 'yearly'
      ? new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)
      : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    // Se plano gratuito, ativa direto
    const status = parseFloat(plan.price) === 0 ? 'active' : 'trial';

    const [subscription, created] = await db.Subscription.findOrCreate({
      where: { organizationId: orgId },
      defaults: {
        planId: plan.id,
        status,
        billingCycle: cycle,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        trialEndsAt: status === 'trial' ? new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000) : null,
        ...gatewayData
      }
    });

    if (!created) {
      // Cancela assinatura antiga no gateway se existir
      if (subscription.gatewaySubscriptionId && subscription.paymentGateway) {
        try {
          await paymentService.cancelSubscription(subscription.paymentGateway, subscription.gatewaySubscriptionId);
        } catch (e) {
          console.error('Erro ao cancelar assinatura antiga:', e.message);
        }
      }

      await subscription.update({
        planId: plan.id,
        status,
        billingCycle: cycle,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        trialEndsAt: status === 'trial' ? new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000) : null,
        canceledAt: null,
        cancelReason: null,
        ...gatewayData
      });
    }

    // Desbloqueia users da org
    await db.User.update(
      { isBlocked: false },
      { where: { organizationId: orgId } }
    );

    if (gatewayData.gatewaySubscriptionId) {
      // Busca link de pagamento para redirecionar
      try {
        const asaasService = require('../services/asaasService');
        const payments = await asaasService.getSubscriptionPayments(gatewayData.gatewaySubscriptionId);
        if (payments.data && payments.data.length > 0) {
          const firstPayment = payments.data[0];
          if (firstPayment.invoiceUrl) {
            return res.redirect(firstPayment.invoiceUrl);
          }
        }
      } catch (e) {
        console.error('Erro ao buscar link de pagamento:', e.message);
      }
    }

    req.flash('success', `Plano ${plan.name} ${created ? 'ativado' : 'atualizado'} com sucesso!`);
    res.redirect('/admin/assinatura');
  } catch (err) {
    console.error('Erro ao escolher plano:', err);
    req.flash('error', `Erro ao processar: ${err.message}`);
    res.redirect('/admin/assinatura');
  }
};

// POST /admin/assinatura/cancelar - Cancelar assinatura
exports.postCancelar = async (req, res) => {
  try {
    const orgId = req.session.organizationId;
    const subscription = await db.Subscription.findOne({ where: { organizationId: orgId } });

    if (!subscription) {
      req.flash('error', 'Nenhuma assinatura encontrada.');
      return res.redirect('/admin/assinatura');
    }

    // Cancela no gateway
    if (subscription.gatewaySubscriptionId && subscription.paymentGateway) {
      try {
        await paymentService.cancelSubscription(subscription.paymentGateway, subscription.gatewaySubscriptionId);
      } catch (e) {
        console.error('Erro ao cancelar no gateway:', e.message);
      }
    }

    await subscription.update({
      status: 'canceled',
      canceledAt: new Date(),
      cancelReason: req.body.reason || 'Cancelado pelo usuario'
    });

    req.flash('success', 'Assinatura cancelada. Voce pode reativar a qualquer momento.');
    res.redirect('/admin/assinatura');
  } catch (err) {
    console.error('Erro ao cancelar assinatura:', err);
    req.flash('error', 'Erro ao cancelar assinatura.');
    res.redirect('/admin/assinatura');
  }
};
