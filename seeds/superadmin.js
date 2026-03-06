// seeds/superadmin.js
// Cria o usuario superadmin (dono da plataforma)
// Uso: node seeds/superadmin.js

require('dotenv').config();
const db = require('../models');

const EMAIL = process.env.SUPERADMIN_EMAIL || 'andre.admft@gmail.com';
const PASSWORD = process.env.SUPERADMIN_PASSWORD || '160793';
const USERNAME = process.env.SUPERADMIN_NAME || 'Super Admin';

async function createSuperAdmin() {
  try {
    await db.sequelize.authenticate();

    const existing = await db.User.findOne({ where: { role: 'superadmin' } });
    if (existing) {
      console.log('SuperAdmin ja existe:', existing.email);
      process.exit(0);
    }

    const user = await db.User.create({
      username: USERNAME,
      email: EMAIL,
      password: PASSWORD,
      role: 'superadmin',
      organizationId: null
    });

    console.log('SuperAdmin criado com sucesso!');
    console.log('Email:', user.email);
    console.log('Senha:', PASSWORD);
    console.log('\nAcesse: http://localhost:3003/login');
    console.log('Apos o login, voce sera redirecionado para /master');
    process.exit(0);
  } catch (error) {
    console.error('Erro ao criar superadmin:', error.message);
    process.exit(1);
  }
}

createSuperAdmin();
