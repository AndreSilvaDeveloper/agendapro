const mongoose = require('mongoose');

const AppointmentSchema = new mongoose.Schema({
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
  date: Date,
  services: [{
    name: String,
    price: Number
  }],
  products: [{
    name: String,
    price: Number
  }]
});

module.exports = mongoose.model('Appointment', AppointmentSchema);
