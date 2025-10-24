// models/Organization.js
const mongoose = require('mongoose');
const slugify = require('slugify'); // Importa o pacote que acabamos de instalar

const organizationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'O nome do salão é obrigatório.'],
    trim: true
  },
  
  // NOVO: O link amigável (ex: /salao/studio-kadosh)
  slug: {
    type: String,
    required: true,
    unique: true, // Garante que dois salões não tenham o mesmo link
    lowercase: true,
    trim: true,
    index: true
  },
  
  // --- NOVOS CAMPOS PARA A PÁGINA "VITRINE" ---
  phone: {
    type: String,
    trim: true
  },
  whatsapp: {
    type: String,
    trim: true
  },
  address: {
    type: String,
    trim: true,
    maxlength: 200
  },
  coverImageUrl: { // Foto de capa (como na sua inspiração)
    type: String,
    trim: true
  },
  galleryImageUrls: [{ // Fotos da galeria
    type: String,
    trim: true
  }],
  operatingHours: { // Ex: "Segunda a Sábado, 08:00 - 18:00"
    type: String,
    trim: true
  }
  // --- FIM DOS NOVOS CAMPOS ---

}, { timestamps: true }); // Adiciona createdAt e updatedAt e remove o createdAt manual

// --- NOVO HOOK (Executa ANTES de salvar) ---
// Isso gera o 'slug' automaticamente a partir do 'name'
organizationSchema.pre('save', function(next) {
  // Só gera o slug se o 'name' foi modificado (ou é um novo documento)
  if (this.isModified('name')) {
    this.slug = slugify(this.name, {
      lower: true,      // Força minúsculas
      strict: true,     // Remove caracteres especiais (como '!')
      remove: /[*+~.()'"!:@]/g // Remove outros caracteres inválidos
    });
  }
  next();
});

module.exports = mongoose.model('Organization', organizationSchema);