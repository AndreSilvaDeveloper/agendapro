// models/Expense.js
const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema({
  // O ID do Salão (inquilino) ao qual esta despesa pertence
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: [true, 'A organização (salão) é obrigatória.'],
    index: true // Essencial para performance
  },
  date: {
    type: Date,
    required: [true, 'A data da despesa é obrigatória.'],
    default: Date.now
  },
  category: {
    type: String,
    // Padronizei para minúsculas para consistência dos dados
    enum: {
      values: ['luz', 'água', 'aluguel', 'produtos', 'comissão calcinhas', 'comissão joias', 'outros gastos'],
      message: '"{VALUE}" não é uma categoria válida.'
    },
    required: [true, 'A categoria é obrigatória.'],
    trim: true,
    lowercase: true
  },
  description: {
    type: String,
    trim: true
  },
  amount: {
    type: Number,
    required: [true, 'O valor da despesa é obrigatório.'],
    min: [0, 'O valor não pode ser negativo.']
  }
}, { timestamps: true }); // Adiciona createdAt e updatedAt

// Índice para consultas de despesas por data
expenseSchema.index({ organizationId: 1, date: -1 });

module.exports = mongoose.model('Expense', expenseSchema);