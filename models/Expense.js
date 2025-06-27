const mongoose = require('mongoose')

const expenseSchema = new mongoose.Schema({
  date: {
    type: Date,
    required: true
  },
  category: {
    type: String,
    enum: ['Luz','Água','Aluguel','Produtos','Comissão Calcinhas','Comissão Joias','Outros Gastos'],
    required: true
  },
  description: String,
  amount: {
    type: Number,
    required: true,
    min: 0
  }
})



module.exports = mongoose.model('Expense', expenseSchema)
