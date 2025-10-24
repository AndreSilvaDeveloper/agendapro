// models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const SALT_ROUNDS = 10;

const userSchema = new mongoose.Schema({
  // 1. Vincula o usuário a um Salão (Organization)
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: [true, 'A organização (salão) é obrigatória.'],
    index: true // Adiciona um índice para consultas mais rápidas
  },

  // 2. O username NÃO é mais globalmente único
  username: {
    type: String,
    required: [true, 'O nome de usuário é obrigatório.'],
    lowercase: true,
    trim: true
    // 'unique: true' foi REMOVIDO daqui.
  },

  // 3. O email DEVE ser globalmente único (para login e recuperação)
  email: {
    type: String,
    required: [true, 'O e-mail é obrigatório.'],
    unique: true, // Garante que um e-mail não possa ser usado em duas contas
    lowercase: true,
    trim: true,
  },

  password: {
    type: String,
    required: [true, 'A senha é obrigatória.'],
  },

  // 4. Papel do usuário (Dono do salão ou Funcionário)
  role: {
    type: String,
    enum: ['owner', 'staff'], 
    default: 'staff',
    required: true
  },
  
  resetToken: String,
  resetTokenExpires: Date,
}, { timestamps: true }); // Adiciona createdAt e updatedAt

// 5. O username deve ser único DENTRO de uma mesma organizationId
// Isso permite que 'Studio Kadosh' tenha um user 'admin' e 'Beleza Pura' também.
userSchema.index({ organizationId: 1, username: 1 }, { unique: true });

// Hook 'pre-save' para criptografar a senha (sem alterações)
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) {
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

// Método para comparar a senha (sem alterações)
userSchema.methods.comparePassword = function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);