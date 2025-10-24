// models/Service.js
const mongoose = require('mongoose');

const serviceSchema = new mongoose.Schema({
  // 1. O ID do Salão (inquilino) ao qual este serviço pertence
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: [true, 'A organização (salão) é obrigatória.'],
    index: true // Essencial para performance
  },
  
  // 2. O nome do serviço (ex: "Corte Feminino", "Manicure", "Progressiva")
  name: {
    type: String,
    required: [true, 'O nome do serviço é obrigatório.'],
    trim: true
  },

  // 3. A descrição (para o cliente ver, como na imagem de inspiração)
  description: {
    type: String,
    trim: true
  },

  // 4. O preço do serviço
  price: {
    type: Number,
    required: [true, 'O preço é obrigatório.'],
    min: [0, 'O preço não pode ser negativo.'],
    default: 0
  },

  // 5. A duração do serviço em minutos (ex: 30, 60, 120)
  // Isso é crucial para o sistema de agendamento encontrar horários livres.
  duration: {
    type: Number,
    required: [true, 'A duração em minutos é obrigatória.'],
    min: [1, 'A duração deve ser de pelo menos 1 minuto.']
  },

  // 6. Uma foto para o serviço (como na inspiração) - opcional
  imageUrl: {
    type: String,
    trim: true
  },

  // 7. Campo para "desativar" um serviço sem apagá-lo
  isActive: {
    type: Boolean,
    default: true
  }
  
}, { timestamps: true }); // Adiciona createdAt e updatedAt

// Índice para buscar serviços rapidamente por nome dentro do salão
serviceSchema.index({ organizationId: 1, name: 1 });

module.exports = mongoose.model('Service', serviceSchema);