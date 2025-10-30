// models/Expense.js
const { DataTypes } = require('sequelize');
const sequelize = require('../db');

// Normaliza valores monetários vindos como:
//  "1234.56" (ponto decimal), "1.234,56" (pt-BR) ou "1234,56"
function normalizeAmount(input) {
  if (input == null) return 0;
  if (typeof input === 'number') return input;

  let s = String(input).trim();

  // Tem vírgula e não tem ponto -> vírgula é decimal
  if (s.includes(',') && !s.includes('.')) {
    s = s.replace(/\s/g, '').replace(',', '.');
  }
  // Tem vírgula e ponto -> assume ponto como milhar e vírgula como decimal (pt-BR)
  else if (s.includes(',') && s.includes('.')) {
    s = s.replace(/\./g, '').replace(',', '.');
  }
  // Só ponto -> já está ok (en-US)

  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

const ALLOWED_CATEGORIES = [
  'luz',
  'água',
  'aluguel',
  'produtos',
  'comissão calcinhas',
  'comissão joias',
  'outros gastos'
];

const Expense = sequelize.define('Expense', {
  // id (PK) automático

  organizationId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },

  date: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },

  category: {
    type: DataTypes.ENUM(...ALLOWED_CATEGORIES),
    allowNull: false,
    set(value) {
      const v = (value ?? '').toString().trim().toLowerCase();
      // mapeia variações comuns (ex.: "Água", "Agua", etc.)
      // apenas para garantir aderência ao ENUM
      const map = {
        'agua': 'água',
        'água': 'água',
        'luz': 'luz',
        'aluguel': 'aluguel',
        'produtos': 'produtos',
        'comissão calcinhas': 'comissão calcinhas',
        'comissao calcinhas': 'comissão calcinhas',
        'comissão joias': 'comissão joias',
        'comissao joias': 'comissão joias',
        'outros gastos': 'outros gastos'
      };
      const normalized = map[v] || v;
      if (!ALLOWED_CATEGORIES.includes(normalized)) {
        // se vier algo fora do ENUM, force "outros gastos"
        this.setDataValue('category', 'outros gastos');
      } else {
        this.setDataValue('category', normalized);
      }
    }
  },

  description: {
    type: DataTypes.STRING,
    allowNull: true,
    set(value) {
      this.setDataValue('description', value ? String(value).trim() : null);
    }
  },

  amount: {
    // Use DECIMAL para armazenar em reais; getter/setter garantem número correto
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    validate: { min: 0 },
    get() {
      const raw = this.getDataValue('amount');
      return raw == null ? 0 : Number(raw); // evita string no consumo
    },
    set(v) {
      const n = normalizeAmount(v);
      // salva sempre com duas casas (como string compatível com DECIMAL)
      this.setDataValue('amount', n.toFixed(2));
    }
  }

}, {
  timestamps: true,
  indexes: [
    { fields: ['organizationId', 'date'] }
  ]
});

module.exports = Expense;
