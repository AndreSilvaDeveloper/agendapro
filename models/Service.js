// models/Service.js
const { Sequelize, DataTypes } = require("sequelize");
const sequelize = require("../db");

const Service = sequelize.define(
  "Service",
  {
    // 'id' (PK) é criado automaticamente

    // 1. ID do Salão
    organizationId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      // A associação (belongsTo Organization) será definida depois
    },

    // 2. Nome do serviço
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      set(value) {
        this.setDataValue("name", value.trim());
      },
    },

    // 3. Descrição
    description: {
      type: DataTypes.STRING, // Pode ser DataTypes.TEXT se a descrição for longa
      allowNull: true,
      set(value) {
        this.setDataValue("description", value ? value.trim() : null);
      },
    },

    // 4. Preço
    price: {
      type: DataTypes.DECIMAL(10, 2), // Tipo correto para dinheiro
      allowNull: false,
      defaultValue: 0,
      validate: {
        min: 0, // Substitui o 'min: [0, ...]' do Mongoose
      },
    },

    // 5. Duração em minutos
    duration: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 1, // Substitui o 'min: [1, ...]' do Mongoose
      },
    },

    // 6. URL da Imagem
    imageUrl: {
      type: DataTypes.STRING,
      allowNull: true,
      set(value) {
        this.setDataValue("imageUrl", value ? value.trim() : null);
      },
    },

    // 7. Ativo
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    // Opções
    timestamps: true,
    indexes: [
      {
        fields: ["organizationId", "name"],
      },
    ],
  }
);

module.exports = Service;