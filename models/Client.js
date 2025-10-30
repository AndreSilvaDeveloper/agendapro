// models/Client.js
const { Sequelize, DataTypes } = require('sequelize');
const sequelize = require('../db');
const bcrypt = require('bcrypt');
const SALT_ROUNDS = 10;

const Client = sequelize.define('Client', {
  // O 'id' (PK) é criado automaticamente
  
  organizationId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    // A associação (belongsTo Organization) será definida depois
  },
  
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    set(value) {
      this.setDataValue('name', value.trim());
    }
  },
  
  phone: {
    type: DataTypes.STRING,
    allowNull: true,
    set(value) {
      this.setDataValue('phone', value ? value.trim() : null);
    }
  },
  
  // --- CAMPOS DE LOGIN ---
  email: {
    type: DataTypes.STRING,
    allowNull: true, // Permite nulo (para clientes cadastrados pelo admin)
    set(value) {
      this.setDataValue('email', value ? value.toLowerCase().trim() : null);
    }
  },
  
  password: {
    type: DataTypes.STRING,
    allowNull: true, // Permite nulo
  }
  
  // O array 'products' foi removido.
  // A associação (Client.hasMany(Product)) será definida depois.
  
}, {
  // Opções
  timestamps: true,
  indexes: [
    {
      // Substitui o 'index({ organizationId: 1, email: 1 }, { unique: true, sparse: true })'
      // No SQL, um índice único já permite múltiplos valores nulos (comportamento 'sparse').
      unique: true,
      fields: ['organizationId', 'email']
    },
    {
      fields: ['organizationId', 'name']
    },
    {
      fields: ['organizationId', 'phone']
    }
  ],
  
  // --- Hooks para senha (idênticos ao User.js) ---
  hooks: {
    beforeSave: async (client) => {
      // 'beforeSave' roda no create e no update
      if (client.changed('password')) {
        // Só faz o hash se a senha existir (não for nula)
        if (client.password) {
          const hash = await bcrypt.hash(client.password, SALT_ROUNDS);
          client.password = hash;
        }
      }
    }
  }
});

// --- Método para comparar senha (idêntico ao User.js) ---
Client.prototype.comparePassword = function(candidatePassword) {
  if (!this.password) {
    return false; // Cliente não tem senha cadastrada
  }
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = Client;