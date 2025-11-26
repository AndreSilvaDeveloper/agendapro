// models/Appointment.js
const { Sequelize, DataTypes } = require('sequelize');
const sequelize = require('../db');

const Appointment = sequelize.define('Appointment', {
  // 'id' (PK) é criado automaticamente
  
  organizationId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    // Associação (belongsTo Organization) definida depois
  },
  clientId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    // Associação (belongsTo Client) definida depois
  },
  staffId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    // Associação (belongsTo Staff) definida depois
  },
  
  date: {
    type: DataTypes.DATE,
    allowNull: false
  },
  
  duration: {
    type: DataTypes.INTEGER,
    allowNull: true // Duração total (pode ser calculada a partir dos serviços)
  },
  
  status: {
    type: DataTypes.ENUM(
      'pendente',
      'confirmado',
      'concluido',
      'cancelado_pelo_cliente',
      'cancelado_pelo_salao'
    ),
    allowNull: false,
    defaultValue: 'confirmado'
  },
  
  cancellationReason: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: null
  },
  
  clientNotified: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  },

  reminder24hSent: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false
  },
  reminder3hSent: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false
  }
}, {
  
  timestamps: true,
  indexes: [
    { fields: ['organizationId'] },
    { fields: ['clientId'] },
    { fields: ['staffId'] }
  ]
});

module.exports = Appointment;