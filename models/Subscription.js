// models/Subscription.js
const { Sequelize, DataTypes } = require('sequelize');
const sequelize = require('../db');

const Subscription = sequelize.define('Subscription', {
  // O 'id' (PK, auto-increment) é criado por padrão

  organizationId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },

  planId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },

  status: {
    type: DataTypes.ENUM('trial', 'active', 'past_due', 'canceled', 'expired'),
    allowNull: false,
    defaultValue: 'trial'
  },

  billingCycle: {
    type: DataTypes.ENUM('monthly', 'yearly'),
    allowNull: false,
    defaultValue: 'monthly'
  },

  currentPeriodStart: {
    type: DataTypes.DATE,
    allowNull: true
  },

  currentPeriodEnd: {
    type: DataTypes.DATE,
    allowNull: true
  },

  trialEndsAt: {
    type: DataTypes.DATE,
    allowNull: true
  },

  canceledAt: {
    type: DataTypes.DATE,
    allowNull: true
  },

  cancelReason: {
    type: DataTypes.TEXT,
    allowNull: true
  },

  paymentGateway: {
    type: DataTypes.STRING,
    allowNull: true
  },

  gatewayCustomerId: {
    type: DataTypes.STRING,
    allowNull: true
  },

  gatewaySubscriptionId: {
    type: DataTypes.STRING,
    allowNull: true
  },

  gatewayData: {
    type: DataTypes.JSONB,
    allowNull: true
  }

  // 'createdAt' e 'updatedAt' são adicionados automaticamente
});

module.exports = Subscription;
