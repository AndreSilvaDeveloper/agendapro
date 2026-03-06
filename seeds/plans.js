// seeds/plans.js
require('dotenv').config();
const db = require('../models');

const plans = [
  {
    name: 'Gratuito',
    slug: 'gratuito',
    price: 0,
    yearlyPrice: 0,
    description: 'Ideal para quem está começando e quer testar a plataforma.',
    sortOrder: 0,
    isFeatured: false,
    features: [
      '1 profissional',
      'Até 5 serviços',
      'Até 50 clientes',
      '30 agendamentos/mês',
      'Portal do cliente',
      'Lembretes por e-mail'
    ],
    limits: {
      maxStaff: 1,
      maxServices: 5,
      maxClients: 50,
      maxAppointmentsPerMonth: 30,
      whatsappBot: false,
      customBranding: false,
      financialReports: false,
      multipleStaff: false,
      clientPortal: true,
      emailReminders: true,
      whatsappReminders: false,
      prioritySupport: false
    }
  },
  {
    name: 'Profissional',
    slug: 'profissional',
    price: 79.90,
    yearlyPrice: 767.00,
    description: 'Para profissionais e pequenas equipes que querem crescer.',
    sortOrder: 1,
    isFeatured: true,
    features: [
      'Até 5 profissionais',
      'Até 20 serviços',
      'Até 500 clientes',
      'Agendamentos ilimitados',
      'Bot WhatsApp com IA',
      'Relatórios financeiros',
      'Marca personalizada',
      'Lembretes por WhatsApp'
    ],
    limits: {
      maxStaff: 5,
      maxServices: 20,
      maxClients: 500,
      maxAppointmentsPerMonth: -1,
      whatsappBot: true,
      customBranding: true,
      financialReports: true,
      multipleStaff: true,
      clientPortal: true,
      emailReminders: true,
      whatsappReminders: true,
      prioritySupport: false
    }
  },
  {
    name: 'Enterprise',
    slug: 'enterprise',
    price: 199.90,
    yearlyPrice: 1919.00,
    description: 'Para grandes equipes e negócios que precisam do máximo.',
    sortOrder: 2,
    isFeatured: false,
    features: [
      'Profissionais ilimitados',
      'Serviços ilimitados',
      'Clientes ilimitados',
      'Agendamentos ilimitados',
      'Bot WhatsApp com IA',
      'Relatórios avançados',
      'Marca personalizada',
      'Suporte prioritário',
      'API de integração'
    ],
    limits: {
      maxStaff: -1,
      maxServices: -1,
      maxClients: -1,
      maxAppointmentsPerMonth: -1,
      whatsappBot: true,
      customBranding: true,
      financialReports: true,
      multipleStaff: true,
      clientPortal: true,
      emailReminders: true,
      whatsappReminders: true,
      prioritySupport: true
    }
  }
];

async function seedPlans() {
  try {
    // Sincroniza apenas as tabelas de Plan (sem dropar as existentes)
    await db.Plan.sync();

    for (const plan of plans) {
      const [record, created] = await db.Plan.findOrCreate({
        where: { slug: plan.slug },
        defaults: plan
      });

      if (created) {
        console.log(`Plano criado: ${record.name}`);
      } else {
        console.log(`Plano já existe: ${record.name}`);
      }
    }

    console.log('\nSeed de planos concluído com sucesso!');
    process.exit(0);
  } catch (error) {
    console.error('Erro ao executar seed de planos:', error);
    process.exit(1);
  }
}

seedPlans();
