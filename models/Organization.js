// models/Organization.js
const { Sequelize, DataTypes } = require('sequelize');
const sequelize = require('../db'); // Importa a conexão
const slugify = require('slugify');  // O slugify continua o mesmo

const Organization = sequelize.define('Organization', {
  // O 'id' (PK, auto-increment) é criado por padrão
  
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    set(value) {
      // Substitui o 'trim: true'
      this.setDataValue('name', value.trim());
    }
  },

  slug: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true // O hook 'beforeSave' irá preencher isso
  },

  phone: {
    type: DataTypes.STRING,
    allowNull: true,
    set(value) {
      this.setDataValue('phone', value ? value.trim() : null);
    }
  },
  
  whatsapp: {
    type: DataTypes.STRING,
    allowNull: true,
    set(value) {
      this.setDataValue('whatsapp', value ? value.trim() : null);
    }
  },

  address: {
    // Tradução do 'maxlength: 200'
    type: DataTypes.STRING(200),
    allowNull: true,
    set(value) {
      this.setDataValue('address', value ? value.trim() : null);
    }
  },

  coverImageUrl: {
    type: DataTypes.STRING,
    allowNull: true,
    set(value) {
      this.setDataValue('coverImageUrl', value ? value.trim() : null);
    }
  },

  galleryImageUrls: {
    // PostgreSQL tem um tipo nativo de Array, que o Sequelize suporta
    type: DataTypes.ARRAY(DataTypes.STRING),
    allowNull: true,
    defaultValue: [], // Boa prática
    set(value) {
      // Garante que todos os URLs no array também sofram 'trim'
      const trimmedUrls = Array.isArray(value) 
        ? value.map(url => url ? url.trim() : null) 
        : [];
      this.setDataValue('galleryImageUrls', trimmedUrls);
    }
  },

  operatingHours: {
    type: DataTypes.STRING,
    allowNull: true,
    set(value) {
      this.setDataValue('operatingHours', value ? value.trim() : null);
    }
  },

  // --- MUDANÇA AQUI: NOVO CAMPO DE CONFIGURAÇÕES ---
  settings: {
    type: DataTypes.JSONB, // Use JSONB para PostgreSQL (preferível) ou DataTypes.JSON
    allowNull: false,
    /**
     * Define os valores padrão para todas as novas organizações.
     * Assim, o sistema funciona "de fábrica" e você só altera
     * as exceções.
     */
    defaultValue: {
      /**
       * Configuração de tema (light/dark)
       * (Para a Meta 2)
       */
      theme: 'light',

      /**
       * Configurações de visibilidade da página pública
       * (Para a Meta 1)
       */
      
      showGallery: true,
      showOperatingHours: true,
      showAddress: true, // adicionada vírgula ausente
      // Você pode adicionar mais chaves aqui no futuro (ex: 'enableReviews: false')

      automaticReminders: true, // Habilita lembretes automáticos por padrão
    }
  }

  // 'createdAt' e 'updatedAt' são adicionados automaticamente

}, {
  // Opções do Modelo
  
  // --- Hook para gerar o Slug (Tradução do 'pre('save')') ---
  hooks: {
    // 'beforeSave' é um hook do Sequelize que roda ANTES do 'create' e do 'update'
    // Exatamente como o 'pre('save')' do Mongoose
    beforeSave: (organization) => {
      // 'changed('name')' verifica se o campo 'name' foi alterado
      // 'isNewRecord' é true quando estamos criando um novo
      if (organization.changed('name') || organization.isNewRecord) {
        organization.slug = slugify(organization.name, {
          lower: true,
          strict: true,
          remove: /[*+~.()'"!:@]/g
        });
      }
    }
  }
});

module.exports = Organization;