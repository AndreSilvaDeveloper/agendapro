const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const BotSession = sequelize.define('BotSession', {
  phone: {
    type: DataTypes.STRING,
    allowNull: false
  },
  organizationId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  state: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'menu'
  },
  data: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: {}
  },
  lastActivity: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  }
}, {
  timestamps: true,
  indexes: [
    { unique: true, fields: ['phone', 'organizationId'] }
  ]
});

module.exports = BotSession;
