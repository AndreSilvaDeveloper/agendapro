// services/asaasService.js
// Integracao com Asaas API (sandbox e producao)

const axios = require('axios');

const SANDBOX_URL = 'https://sandbox.asaas.com/api/v3';
const PRODUCTION_URL = 'https://api.asaas.com/v3';

function getClient() {
  const apiKey = process.env.ASAAS_API_KEY;
  if (!apiKey) throw new Error('ASAAS_API_KEY nao configurada no .env');

  const isSandbox = process.env.ASAAS_SANDBOX === 'true';
  const baseURL = isSandbox ? SANDBOX_URL : PRODUCTION_URL;

  return axios.create({
    baseURL,
    headers: {
      'access_token': apiKey,
      'Content-Type': 'application/json'
    }
  });
}

// ========================================
// CLIENTES
// ========================================

async function createCustomer({ name, email, cpfCnpj, phone }) {
  const client = getClient();

  // Tenta encontrar por email primeiro
  try {
    const { data: existing } = await client.get('/customers', { params: { email } });
    if (existing.data && existing.data.length > 0) {
      return existing.data[0];
    }
  } catch (e) { /* ignora, vai criar */ }

  const { data } = await client.post('/customers', {
    name,
    email,
    cpfCnpj: cpfCnpj || undefined,
    phone: phone || undefined,
    notificationDisabled: false
  });

  return data;
}

async function getCustomer(customerId) {
  const client = getClient();
  const { data } = await client.get(`/customers/${customerId}`);
  return data;
}

// ========================================
// ASSINATURAS
// ========================================

// billingType: 'BOLETO' gera boleto com codigo de barras + PIX QR automatico
// billingType: 'CREDIT_CARD' cria recorrencia no cartao
async function createSubscription({ customerId, value, cycle, description, nextDueDate, billingType, creditCard, creditCardHolderInfo }) {
  const client = getClient();

  const payload = {
    customer: customerId,
    billingType: billingType || 'BOLETO',
    value: parseFloat(value),
    cycle: cycle || 'MONTHLY',
    description: description || 'AgendaPro - Assinatura',
    nextDueDate: nextDueDate || formatDate(addDays(new Date(), 3))
  };

  // Se for cartao de credito, envia dados do cartao
  if (billingType === 'CREDIT_CARD' && creditCard) {
    payload.creditCard = creditCard;
    if (creditCardHolderInfo) {
      payload.creditCardHolderInfo = creditCardHolderInfo;
    }
  }

  const { data } = await client.post('/subscriptions', payload);
  return data;
}

async function getSubscription(subscriptionId) {
  const client = getClient();
  const { data } = await client.get(`/subscriptions/${subscriptionId}`);
  return data;
}

async function cancelSubscription(subscriptionId) {
  const client = getClient();
  const { data } = await client.delete(`/subscriptions/${subscriptionId}`);
  return data;
}

async function updateSubscription(subscriptionId, { value, cycle, description }) {
  const client = getClient();
  const payload = {};
  if (value !== undefined) payload.value = parseFloat(value);
  if (cycle) payload.cycle = cycle;
  if (description) payload.description = description;

  const { data } = await client.put(`/subscriptions/${subscriptionId}`, payload);
  return data;
}

async function getSubscriptionPayments(subscriptionId) {
  const client = getClient();
  const { data } = await client.get(`/subscriptions/${subscriptionId}/payments`);
  return data;
}

// ========================================
// COBRANÇAS
// ========================================

async function getPayment(paymentId) {
  const client = getClient();
  const { data } = await client.get(`/payments/${paymentId}`);
  return data;
}

async function getPaymentLink(paymentId) {
  const client = getClient();
  const { data } = await client.get(`/payments/${paymentId}/identificationField`);
  return data;
}

async function getPixQrCode(paymentId) {
  const client = getClient();
  const { data } = await client.get(`/payments/${paymentId}/pixQrCode`);
  return data;
}

// ========================================
// WEBHOOK HANDLER (com auto-block/unblock)
// ========================================

async function handleWebhook(body) {
  const event = body.event;
  const payment = body.payment || null;

  console.log(`[Asaas Webhook] Evento: ${event}`, payment ? `payment_id=${payment.id}` : '');

  const db = require('../models');

  // Helper: bloqueia todos os users da org
  async function blockOrg(orgId, reason) {
    await db.User.update(
      { isBlocked: true },
      { where: { organizationId: orgId, role: { [require('sequelize').Op.ne]: 'superadmin' } } }
    );
    console.log(`[Asaas] Org ${orgId} BLOQUEADA: ${reason}`);
  }

  // Helper: desbloqueia todos os users da org
  async function unblockOrg(orgId) {
    await db.User.update(
      { isBlocked: false },
      { where: { organizationId: orgId } }
    );
    console.log(`[Asaas] Org ${orgId} DESBLOQUEADA`);
  }

  // Helper: encontra subscription pelo gateway subscription id
  async function findSub(gatewaySubId) {
    if (!gatewaySubId) return null;
    return await db.Subscription.findOne({
      where: { gatewaySubscriptionId: gatewaySubId },
      include: [{ model: db.Organization, attributes: ['id', 'name'] }]
    });
  }

  // PAGAMENTO CONFIRMADO -> ativar + desbloquear + renovar periodo
  if (event === 'PAYMENT_CONFIRMED' || event === 'PAYMENT_RECEIVED') {
    if (payment && payment.subscription) {
      const sub = await findSub(payment.subscription);
      if (sub) {
        const now = new Date();
        const cycleDays = sub.billingCycle === 'yearly' ? 365 : 30;
        const nextPeriodEnd = new Date(now.getTime() + cycleDays * 24 * 60 * 60 * 1000);

        await sub.update({
          status: 'active',
          currentPeriodStart: now,
          currentPeriodEnd: nextPeriodEnd
        });
        await unblockOrg(sub.organizationId);
        console.log(`[Asaas] Assinatura ${sub.id} ATIVADA ate ${nextPeriodEnd.toLocaleDateString('pt-BR')} (org: ${sub.Organization?.name})`);
      }
    }
    return { processed: true, event, action: 'activated_and_unblocked' };
  }

  // PAGAMENTO VENCIDO -> marcar inadimplente + bloquear
  if (event === 'PAYMENT_OVERDUE') {
    if (payment && payment.subscription) {
      const sub = await findSub(payment.subscription);
      if (sub) {
        await sub.update({ status: 'past_due' });
        await blockOrg(sub.organizationId, 'Pagamento vencido');
        console.log(`[Asaas] Assinatura ${sub.id} INADIMPLENTE (org: ${sub.Organization?.name})`);
      }
    }
    return { processed: true, event, action: 'past_due_and_blocked' };
  }

  // PAGAMENTO REEMBOLSADO/DELETADO
  if (event === 'PAYMENT_REFUNDED' || event === 'PAYMENT_DELETED') {
    if (payment && payment.subscription) {
      const sub = await findSub(payment.subscription);
      if (sub) {
        await sub.update({ status: 'past_due' });
        await blockOrg(sub.organizationId, `Pagamento ${event.toLowerCase()}`);
      }
    }
    return { processed: true, event, action: 'payment_reversed' };
  }

  // ASSINATURA CANCELADA/INATIVADA -> cancelar + bloquear
  if (event === 'SUBSCRIPTION_DELETED' || event === 'SUBSCRIPTION_INACTIVATED') {
    const subRef = body.subscription || (payment && payment.subscription);
    const subId = typeof subRef === 'object' ? subRef.id : subRef;
    if (subId) {
      const sub = await findSub(subId);
      if (sub) {
        await sub.update({
          status: 'canceled',
          canceledAt: new Date(),
          cancelReason: 'Cancelado via Asaas'
        });
        await blockOrg(sub.organizationId, 'Assinatura cancelada');
        console.log(`[Asaas] Assinatura ${sub.id} CANCELADA (org: ${sub.Organization?.name})`);
      }
    }
    return { processed: true, event, action: 'canceled_and_blocked' };
  }

  console.log(`[Asaas Webhook] Evento nao tratado: ${event}`);
  return { processed: false, event };
}

// ========================================
// HELPERS
// ========================================
function formatDate(date) {
  return new Date(date).toISOString().split('T')[0];
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

module.exports = {
  createCustomer,
  getCustomer,
  createSubscription,
  getSubscription,
  cancelSubscription,
  updateSubscription,
  getSubscriptionPayments,
  getPayment,
  getPaymentLink,
  getPixQrCode,
  handleWebhook
};
