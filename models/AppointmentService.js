// models/AppointmentService.js
const { Sequelize, DataTypes } = require('sequelize');
const sequelize = require('../db');

// Esta tabela representa a 'serviceSchema' de dentro do Appointment
// É um item na "comanda" do agendamento.
const AppointmentService = sequelize.define('AppointmentService', {
  // 'id' (PK) é criado automaticamente
  
  // Link para o agendamento principal
  appointmentId: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  
  // Link para o catálogo de serviços (opcional, como no seu Mongoose)
  serviceId: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  
  // "Congela" o nome no momento do agendamento
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  
  // "Congela" o preço no momento do agendamento
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

module.exports = AppointmentService;