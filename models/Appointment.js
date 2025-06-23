// models/Appointment.js
const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  amount: Number,
  paidAt: Date,
  description: String,
  method: {
    type: String,
    enum: [
      'Pix','pix',
      'Dinheiro','dinheiro',
      'Cartão','cartão','Cartao','cartao'
    ],
    required: true
  }
});

const serviceSchema = new mongoose.Schema({
  name: String,
  price: Number,
  payments: [paymentSchema]
});

const productSchema = new mongoose.Schema({
  name: String,
  price: Number,
  payments: [paymentSchema]
});

const appointmentSchema = new mongoose.Schema({
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
  date: Date,
  duration: Number,
  services: [serviceSchema],
  products: [productSchema]
});

module.exports = mongoose.model('Appointment', appointmentSchema);
