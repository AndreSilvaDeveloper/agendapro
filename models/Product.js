// models/Product.js
const { Sequelize, DataTypes } = require('sequelize');
const sequelize = require('../db');

const Product = sequelize.define('Product', {
  // 'id' (PK) criado automaticamente
  
  // Chave estrangeira para o Cliente
  clientId: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  
  // Chave estrangeira para a Organização (para facilitar consultas)
  organizationId: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },

  name: {
    type: DataTypes.STRING,
    allowNull: false,
    set(value) {
      this.setDataValue('name', value.trim());
    }
  },
  
  price: {
    // Para dinheiro, DECIMAL é o tipo correto, não FLOAT.
    // '10, 2' significa 10 dígitos no total, com 2 casas decimais.
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0
  },
  
  addedAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
  
  // O array 'payments' foi removido.
  // A associação (Product.hasMany(Payment)) será definida depois.
  
}, {
  timestamps: true // Adiciona createdAt e updatedAt
});

module.exports = Product;