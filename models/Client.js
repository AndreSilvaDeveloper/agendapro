const mongoose = require('mongoose');

const PaymentSchema = new mongoose.Schema({
  amount: Number,
  paidAt: Date,
  description: String,
  method: String
});

const ProductSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  addedAt: { type: Date, default: Date.now },
  payments: [PaymentSchema]
});

const ClientSchema = new mongoose.Schema({
  name: String,
  phone: String,
  products: [ProductSchema]
});

module.exports = mongoose.model('Client', ClientSchema);
