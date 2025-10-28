// models/Appointment.js
const mongoose = require('mongoose');

// --- Esquema de Pagamento ---
// (Sem alterações)
const paymentSchema = new mongoose.Schema({
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

// --- Esquema de Serviço ---
// (MODIFICADO: Adicionado 'serviceId')
const serviceSchema = new mongoose.Schema({
  // NOVO: Link para o catálogo de serviços. Opcional, pois o admin
  // pode adicionar um serviço personalizado que não está no catálogo.
  serviceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Service'
  },
  
  // "Congela" o nome e o preço no momento do agendamento
  name: {
    type: String,
    required: [true, 'O nome do serviço é obrigatório.'],
    trim: true
  },
  price: {
    type: Number,
    required: [true, 'O preço do serviço é obrigatório.'],
    default: 0
  },
  payments: [paymentSchema]
}, { _id: true, timestamps: true });

// --- Esquema de Produto ---
// (Sem alterações)
const productSchema = new mongoose.Schema({
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
  payments: [paymentSchema]
}, { _id: true, timestamps: true });

// --- Esquema Principal do Agendamento ---
// (MODIFICADO: Adicionado 'staffId' e 'status' atualizado)
const appointmentSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true 
  },
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: [true, 'O cliente é obrigatório.']
  },
  
  // NOVO: O profissional (da equipe) que fará o atendimento
  staffId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Staff',
    index: true // Para filtrar a agenda por profissional
  },
  
  date: {
    type: Date,
    required: [true, 'A data do agendamento é obrigatória.']
  },
  duration: Number,
  services: [serviceSchema],
  products: [productSchema],
  
  // ATUALIZADO: O novo fluxo de status para aprovação
  status: {
    type: String,
    enum: [
      'pendente',             // Criado pelo cliente, aguarda aprovação
      'confirmado',           // (Substitui 'agendado') Criado pelo admin ou aprovado
      'concluido',            // O serviço foi realizado
      'cancelado_pelo_cliente', // Cliente cancelou
      'cancelado_pelo_salao'    // Salão (admin) cancelou
    ],
    // O padrão é 'confirmado' para NÃO QUEBRAR o fluxo atual do admin.
    // O fluxo do cliente irá FORÇAR o status 'pendente' na criação.
    default: 'confirmado',
    required: true
  },

  // =================================
  // ===     NOVA ALTERAÇÃO AQUI     ===
  // =================================
  cancellationReason: {
    type: String,
    trim: true,
    default: null
  },
  // =================================


  // ==========================================
  // ===       NOVA ALTERAÇÃO (GEMINI)      ===
  // ==========================================
  // Este campo controla se o cliente já foi
  // notificado sobre a última mudança de status.
  clientNotified: {
    type: Boolean,
    default: true
  }
  // ==========================================

}, { timestamps: true }); 

module.exports = mongoose.model('Appointment', appointmentSchema);