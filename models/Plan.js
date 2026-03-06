// models/Plan.js
const { Sequelize, DataTypes } = require('sequelize');
const sequelize = require('../db');

const Plan = sequelize.define('Plan', {
  // O 'id' (PK, auto-increment) é criado por padrão

  name: {
    type: DataTypes.STRING,
    allowNull: false,
    set(value) {
      this.setDataValue('name', value.trim());
    }
  },

  slug: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    set(value) {
      this.setDataValue('slug', value.toLowerCase().trim());
    }
  },

  price: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0
  },

  yearlyPrice: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0
  },

  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },

  features: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: []
  },

  limits: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: {
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

  isActive: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  },

  sortOrder: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },

  isFeatured: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  }

  // 'createdAt' e 'updatedAt' são adicionados automaticamente
});

module.exports = Plan;
