// models/AppointmentProduct.js
const { Sequelize, DataTypes } = require('sequelize');
const sequelize = require('../db');

// Esta tabela representa a 'productSchema' de dentro do Appointment
const AppointmentProduct = sequelize.define('AppointmentProduct', {
  // 'id' (PK) é criado automaticamente
  
  // Link para o agendamento principal
  appointmentId: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  
  // Não há link para um "catálogo de produtos" no seu Mongoose,
  // então apenas "congelamos" o nome.
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  
  price: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0
  }
  
  // O array 'payments' foi REMOVIDO.
  // A tabela 'AppointmentPayment' irá se ligar a esta.
  
}, {
  timestamps: true // Adiciona createdAt/updatedAt
});

module.exports = AppointmentProduct;
