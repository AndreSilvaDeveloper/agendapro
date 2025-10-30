// models/AppointmentPayment.js
const { Sequelize, DataTypes } = require('sequelize');
const sequelize = require('../db');

// Esta tabela representa a 'paymentSchema' de dentro do Appointment.
// Ela pode se ligar a um Serviço ou a um Produto.
const AppointmentPayment = sequelize.define('AppointmentPayment', {
  // 'id' (PK) é criado automaticamente
  
  // Chave estrangeira para o Serviço (pode ser nula)
  appointmentServiceId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'AppointmentServices', // Nome da tabela
      key: 'id'
    }
  },
  
  // Chave estrangeira para o Produto (pode ser nula)
  appointmentProductId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'AppointmentProducts', // Nome da tabela
      key: 'id'
    }
  },
  
  // --- Campos do seu paymentSchema ---
  amount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0
  },
  
  paidAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  
  description: {
    type: DataTypes.STRING,
    allowNull: true
  },
  
  method: {
    type: DataTypes.ENUM('pix', 'dinheiro', 'cartao'),
    allowNull: false
  }
  
}, {
  timestamps: true // Adiciona createdAt/updatedAt
});

module.exports = AppointmentPayment;