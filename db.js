const { Sequelize } = require('sequelize');
// Explicit require so Vercel's NFT tracer includes pg in the bundle
require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
const isProduction = process.env.NODE_ENV === 'production';

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL nao definida em process.env');
}

const dialectOptions = {};
const needsSsl = isProduction || DATABASE_URL.includes('neon.tech') || DATABASE_URL.includes('sslmode=require');
if (needsSsl) {
  dialectOptions.ssl = {
    require: true,
    rejectUnauthorized: false
  };
}

const sequelize = new Sequelize(DATABASE_URL, {
  dialect: 'postgres',
  logging: false,
  dialectOptions: dialectOptions,
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000
  }
});

module.exports = sequelize;
