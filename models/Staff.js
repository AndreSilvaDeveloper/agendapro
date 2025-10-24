// models/Staff.js
const mongoose = require('mongoose');

// --- NOVO SUB-ESQUEMA ---
// Define a estrutura para o horário de um dia
const dailyHoursSchema = new mongoose.Schema({
  startTime: { type: String, trim: true }, // Formato "HH:mm" (ex: "08:00")
  endTime: { type: String, trim: true },   // Formato "HH:mm" (ex: "18:00")
  isOff: { type: Boolean, default: false } // Indica se é dia de folga
}, { _id: false }); // _id: false para não criar IDs para cada dia

const staffSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: [true, 'A organização (salão) é obrigatória.'],
    index: true
  },
  name: {
    type: String,
    required: [true, 'O nome do profissional é obrigatório.'],
    trim: true
  },
  imageUrl: {
    type: String,
    trim: true
  },
  services: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Service'
  }],
  isActive: {
    type: Boolean,
    default: true
  },

  // --- NOVO CAMPO: HORÁRIOS DE TRABALHO ---
  workingHours: {
    type: Map,
    of: dailyHoursSchema, // Usa o sub-esquema que definimos acima
    // Define um valor padrão para todos os dias da semana
    default: {
      monday:    { startTime: '08:00', endTime: '18:00', isOff: false },
      tuesday:   { startTime: '08:00', endTime: '18:00', isOff: false },
      wednesday: { startTime: '08:00', endTime: '18:00', isOff: false },
      thursday:  { startTime: '08:00', endTime: '18:00', isOff: false },
      friday:    { startTime: '08:00', endTime: '18:00', isOff: false },
      saturday:  { startTime: '08:00', endTime: '14:00', isOff: false },
      sunday:    { startTime: '', endTime: '', isOff: true } // Domingo folga por padrão
    }
  }
  // --- FIM DO NOVO CAMPO ---

}, { timestamps: true });

staffSchema.index({ organizationId: 1, name: 1 });

module.exports = mongoose.model('Staff', staffSchema);