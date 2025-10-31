// models/User.js
const { Sequelize, DataTypes } = require('sequelize');
const sequelize = require('../db'); // Importa a conexão do db.js
const bcrypt = require('bcrypt');
const SALT_ROUNDS = 10;

const User = sequelize.define('User', {
  // O Sequelize cria um 'id' (INTEGER, PRIMARY KEY, AUTO_INCREMENT) por padrão
  

  isBlocked: {
  type: DataTypes.BOOLEAN,
  allowNull: false,
  defaultValue: false
},
  // 1. Vínculo com Organization (Foreign Key)
  organizationId: {
    type: DataTypes.INTEGER,
    allowNull: true, 
  },

  // 2. Username
  username: {
    type: DataTypes.STRING,
    allowNull: false,
    set(value) {
      // Substitui 'lowercase: true' e 'trim: true'
      this.setDataValue('username', value.toLowerCase().trim());
    }
  },

  // 3. Email (Globalmente único)
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true, // Garante unicidade no nível do banco
    validate: {
      isEmail: true // Adiciona validação de formato de email
    },
    set(value) {
      // Substitui 'lowercase: true' e 'trim: true'
      this.setDataValue('email', value.toLowerCase().trim());
    }
  },

  // 4. Password
  password: {
    type: DataTypes.STRING,
    allowNull: false,
  },

  // 5. Role (Papel)
  role: {
    type: DataTypes.ENUM('owner', 'staff', 'superadmin'), // <-- MUDANÇA AQUI
    allowNull: false,
    defaultValue: 'staff'
  },

  // 6. Reset de Senha
  resetToken: {
    type: DataTypes.STRING,
    allowNull: true
  },
  resetTokenExpires: {
    type: DataTypes.DATE,
    allowNull: true
  },

  // 'createdAt' e 'updatedAt' são adicionados automaticamente (timestamps: true)

}, {
  // Opções do Modelo
  
  // 'timestamps: true' é o padrão no Sequelize, não precisa declarar.
  
  // 7. Índices
  indexes: [
    {
      // Equivalente a: userSchema.index({ organizationId: 1, username: 1 }, { unique: true });
      unique: true,
      fields: ['organizationId', 'username']
    }
  ],

  // 8. Hooks (para criptografar senha)
  // Substitui o 'userSchema.pre('save', ...)'
  hooks: {
    beforeCreate: async (user) => {
      const hash = await bcrypt.hash(user.password, SALT_ROUNDS);
      user.password = hash;
    },
    beforeUpdate: async (user) => {
      // Só criptografa de novo se a senha foi modificada
      if (user.changed('password')) {
        const hash = await bcrypt.hash(user.password, SALT_ROUNDS);
        user.password = hash;
      }
    }
  }
});

// 9. Métodos de Instância (para comparar senha)
// Equivalente a: userSchema.methods.comparePassword
User.prototype.comparePassword = function(candidatePassword) {
  // 'this.password' aqui é o hash armazenado no banco
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = User;