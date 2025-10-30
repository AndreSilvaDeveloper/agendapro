// models/Payment.js
const { Sequelize, DataTypes } = require('sequelize');
const sequelize = require('../db');

const Payment = sequelize.define('Payment', {
  // 'id' (PK) criado automaticamente
  
  // Chave estrangeira para o Produto
  productId: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  
  // Chave estrangeira para a Organização (para facilitar consultas)
  organizationId: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },

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
  timestamps: true // Adiciona createdAt e updatedAt
});

module.exports = Payment;