// models/Staff.js
const { Sequelize, DataTypes } = require('sequelize');
const sequelize = require('../db');

const Staff = sequelize.define('Staff', {
  // 'id' (PK) é criado automaticamente
  
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
  
  imageUrl: {
    type: DataTypes.STRING,
    allowNull: true,
    set(value) {
      this.setDataValue('imageUrl', value ? value.trim() : null);
    }
  },
  
  // O array 'services' foi REMOVIDO daqui.
  // Esta será uma relação Many-to-Many, definida fora do modelo
  // através de uma tabela de junção (ex: 'StaffServices').
  
  isActive: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  },
  
  // --- Horários de Trabalho (Tradução de Map para JSONB) ---
  workingHours: {
    type: DataTypes.JSONB, // Usa o tipo JSONB nativo do PostgreSQL
    allowNull: false,
    // O objeto de 'default' do Mongoose funciona perfeitamente aqui
    defaultValue: {
      monday:    { startTime: '08:00', endTime: '18:00', isOff: false },
      tuesday:   { startTime: '08:00', endTime: '18:00', isOff: false },
      wednesday: { startTime: '08:00', endTime: '18:00', isOff: false },
      thursday:  { startTime: '08:00', endTime: '18:00', isOff: false },
      friday:    { startTime: '08:00', endTime: '18:00', isOff: false },
      saturday:  { startTime: '08:00', endTime: '14:00', isOff: false },
      sunday:    { startTime: '', endTime: '', isOff: true }
    }
  }
  
}, {
  // Opções
  timestamps: true,
  indexes: [
    {
      fields: ['organizationId', 'name']
    }
  ]
});

module.exports = Staff;