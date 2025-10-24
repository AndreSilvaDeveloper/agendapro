// models/Client.js
const mongoose = require('mongoose');
// NOVO: Importa o bcrypt para criptografar a senha do cliente
const bcrypt = require('bcrypt');
const SALT_ROUNDS = 10; // Fator de "custo" do hash

// --- Esquema de Pagamento ---
// (Sem alterações)
const PaymentSchema = new mongoose.Schema({
  amount: {
    type: Number,
    required: [true, 'O valor do pagamento é obrigatório.'],
    default: 0
  },
  paidAt: {
    type: Date,
    required: [true, 'A data do pagamento é obrigatória.'],
    default: Date.now
  },
  description: String,
  method: {
    type: String,
    enum: ['pix', 'dinheiro', 'cartao'],
    required: [true, 'O método de pagamento é obrigatório.']
  }
}, { _id: true, timestamps: true });

// --- Esquema de Produto (comprado pelo cliente) ---
// (Sem alterações)
const ProductSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'O nome do produto é obrigatório.'],
    trim: true
  },
  price: {
    type: Number,
    required: [true, 'O preço do produto é obrigatório.'],
    default: 0
  },
  addedAt: {
    type: Date,
    default: Date.now
  },
  payments: [PaymentSchema]
}, { _id: true, timestamps: true });

// --- Esquema Principal do Cliente ---
// (MODIFICADO: Adicionado 'email' e 'password')
const ClientSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: [true, 'A organização (salão) é obrigatória.'],
    index: true
  },
  name: {
    type: String,
    required: [true, 'O nome do cliente é obrigatório.'],
    trim: true
  },
  phone: {
    type: String,
    trim: true
  },
  
  // --- NOVOS CAMPOS PARA LOGIN DO CLIENTE ---
  email: {
    type: String,
    lowercase: true,
    trim: true,
    // Não é globalmente único, mas será único DENTRO da organização (ver índice abaixo)
  },
  password: {
    type: String,
    // Não é 'required' para permitir que o admin crie clientes sem login.
  },
  // --- FIM DOS NOVOS CAMPOS ---

  products: [ProductSchema]
}, { timestamps: true });

// --- NOVOS ÍNDICES ---
// Garante que o email do cliente seja único DENTRO de um mesmo salão.
// 'sparse: true' permite que haja múltiplos clientes sem email (null)
ClientSchema.index({ organizationId: 1, email: 1 }, { unique: true, sparse: true });
ClientSchema.index({ organizationId: 1, name: 1 });
ClientSchema.index({ organizationId: 1, phone: 1 });


// --- NOVOS MÉTODOS DE BCRYPT (iguais ao User.js) ---

// Hook 'pre-save' para criptografar a senha do cliente
ClientSchema.pre('save', async function(next) {
  // 'this' se refere ao cliente que está sendo salvo
  if (!this.isModified('password')) {
    return next();
  }
  // Se a senha for nula ou vazia (admin não definiu), não faz nada
  if (!this.password) {
      return next();
  }

  try {
    const hash = await bcrypt.hash(this.password, SALT_ROUNDS);
    this.password = hash;
    next();
  } catch (err) {
    next(err);
  }
});

// Método auxiliar para comparar a senha
ClientSchema.methods.comparePassword = function(candidatePassword) {
  if (!this.password) {
    return false; // Se o cliente não tem senha, não pode logar
  }
  return bcrypt.compare(candidatePassword, this.password);
};
// --- FIM DOS NOVOS MÉTODOS ---

module.exports = mongoose.model('Client', ClientSchema);