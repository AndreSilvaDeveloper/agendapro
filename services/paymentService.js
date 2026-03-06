// services/paymentService.js
// Interface para gateways de pagamento

const asaasService = require('./asaasService');

const GATEWAYS = {
  mercadopago: {
    name: 'Mercado Pago',
    createCustomer: async (data) => { throw new Error('Mercado Pago nao integrado ainda'); },
    createSubscription: async (data) => { throw new Error('Mercado Pago nao integrado ainda'); },
    cancelSubscription: async (id) => { throw new Error('Mercado Pago nao integrado ainda'); },
    getSubscription: async (id) => { throw new Error('Mercado Pago nao integrado ainda'); },
    handleWebhook: async (body) => { throw new Error('Mercado Pago nao integrado ainda'); }
  },
  asaas: {
    name: 'Asaas',
    createCustomer: async (data) => asaasService.createCustomer(data),
    createSubscription: async (data) => asaasService.createSubscription(data),
    cancelSubscription: async (id) => asaasService.cancelSubscription(id),
    getSubscription: async (id) => asaasService.getSubscription(id),
    handleWebhook: async (body) => asaasService.handleWebhook(body)
  }
};

const getGateway = (name) => {
  const gw = GATEWAYS[name];
  if (!gw) throw new Error(`Gateway "${name}" nao suportado`);
  return gw;
};

// Cria assinatura completa (cliente + assinatura no gateway + salva no DB)
const createSubscription = async (gatewayName, { org, plan, billingCycle, customer, billingType, creditCard, creditCardHolderInfo }) => {
  const gw = getGateway(gatewayName);

  // 1. Criar/encontrar cliente no gateway
  const gwCustomer = await gw.createCustomer({
    name: customer.name,
    email: customer.email,
    cpfCnpj: customer.cpfCnpj || null,
    phone: customer.phone || null
  });

  // 2. Criar assinatura no gateway
  const price = billingCycle === 'yearly' ? plan.yearlyPrice : plan.price;
  const gwSubscription = await gw.createSubscription({
    customerId: gwCustomer.id,
    value: parseFloat(price),
    cycle: billingCycle === 'yearly' ? 'YEARLY' : 'MONTHLY',
    description: `AgendaPro - Plano ${plan.name}`,
    billingType: billingType || 'BOLETO',
    creditCard: creditCard || undefined,
    creditCardHolderInfo: creditCardHolderInfo || undefined
  });

  return {
    gatewayCustomerId: gwCustomer.id,
    gatewaySubscriptionId: gwSubscription.id,
    gatewayData: gwSubscription
  };
};

// Cancela assinatura no gateway
const cancelSubscription = async (gatewayName, subscriptionId) => {
  const gw = getGateway(gatewayName);
  return await gw.cancelSubscription(subscriptionId);
};

// Processa webhook do gateway
const handleWebhook = async (gatewayName, body) => {
  const gw = getGateway(gatewayName);
  return await gw.handleWebhook(body);
};

// Verifica se um gateway esta configurado
const isGatewayConfigured = (name) => {
  if (name === 'mercadopago') return !!process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (name === 'asaas') return !!process.env.ASAAS_API_KEY;
  return false;
};

// Retorna se esta em modo sandbox
const isSandbox = (name) => {
  if (name === 'asaas') return process.env.ASAAS_SANDBOX === 'true';
  return false;
};

// Lista gateways disponiveis
const getAvailableGateways = () => {
  return Object.entries(GATEWAYS).map(([key, gw]) => ({
    id: key,
    name: gw.name,
    configured: isGatewayConfigured(key),
    sandbox: isSandbox(key)
  }));
};

module.exports = {
  createSubscription,
  cancelSubscription,
  handleWebhook,
  isGatewayConfigured,
  isSandbox,
  getAvailableGateways,
  getGateway
};
