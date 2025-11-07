// models/index.js
const { Sequelize } = require('sequelize');
const sequelize = require('../db'); // Nossa conexão

// Objeto 'db' para armazenar todos os modelos
const db = {};

// 1. Importando todos os nossos modelos
db.Organization = require('./Organization');
db.User = require('./User');
db.Client = require('./Client');
db.Staff = require('./Staff');
db.Service = require('./Service');
db.Expense = require('./Expense');
db.Appointment = require('./Appointment');

// Modelos de "Varejo" (ligados ao Cliente)
db.Product = require('./Product');
db.Payment = require('./Payment');

// Modelos de "Itens do Agendamento"
db.AppointmentService = require('./AppointmentService');
db.AppointmentProduct = require('./AppointmentProduct');
db.AppointmentPayment = require('./AppointmentPayment');


// 2. Definindo Associações

// ===============================================
// === Relações da ORGANIZAÇÃO (O "Dono") ========
// ===============================================
// Uma Organização (Salão) TEM MUITOS...
db.Organization.hasMany(db.User, { foreignKey: 'organizationId', onDelete: 'CASCADE' });
db.Organization.hasMany(db.Client, { foreignKey: 'organizationId', onDelete: 'CASCADE' });
db.Organization.hasMany(db.Staff, { foreignKey: 'organizationId', onDelete: 'CASCADE' });
db.Organization.hasMany(db.Service, { foreignKey: 'organizationId', onDelete: 'CASCADE' });
db.Organization.hasMany(db.Expense, { foreignKey: 'organizationId', onDelete: 'CASCADE' });
db.Organization.hasMany(db.Appointment, { foreignKey: 'organizationId', onDelete: 'CASCADE' });
db.Organization.hasMany(db.Product, { foreignKey: 'organizationId', onDelete: 'CASCADE' });
db.Organization.hasMany(db.Payment, { foreignKey: 'organizationId', onDelete: 'CASCADE' });

// ...e cada um deles PERTENCE A UMA Organização
db.User.belongsTo(db.Organization, { foreignKey: 'organizationId' });
db.Client.belongsTo(db.Organization, { foreignKey: 'organizationId' });
db.Staff.belongsTo(db.Organization, { foreignKey: 'organizationId' });
db.Service.belongsTo(db.Organization, { foreignKey: 'organizationId' });
db.Expense.belongsTo(db.Organization, { foreignKey: 'organizationId' });
db.Appointment.belongsTo(db.Organization, { foreignKey: 'organizationId' });
db.Product.belongsTo(db.Organization, { foreignKey: 'organizationId' });
db.Payment.belongsTo(db.Organization, { foreignKey: 'organizationId' });


// ===============================================
// === Relações do AGENDAMENTO ===================
// ===============================================
// Um Agendamento (Appointment) PERTENCE A UM Cliente
db.Appointment.belongsTo(db.Client, { foreignKey: 'clientId',onDelete: 'CASCADE' });
db.Client.hasMany(db.Appointment, { foreignKey: 'clientId', onDelete: 'CASCADE' });

// Um Agendamento (Appointment) PERTENCE A UM Profissional (Staff)
db.Appointment.belongsTo(db.Staff, { foreignKey: 'staffId' });
db.Staff.hasMany(db.Appointment, { foreignKey: 'staffId' }); // Não usamos cascade aqui

// Um Agendamento (Appointment) TEM MUITOS...
db.Appointment.hasMany(db.AppointmentService, { foreignKey: 'appointmentId', onDelete: 'CASCADE' });
db.Appointment.hasMany(db.AppointmentProduct, { foreignKey: 'appointmentId', onDelete: 'CASCADE' });
// ... e eles PERTENCEM a um Agendamento
db.AppointmentService.belongsTo(db.Appointment, { foreignKey: 'appointmentId' });
db.AppointmentProduct.belongsTo(db.Appointment, { foreignKey: 'appointmentId' });

// Um Serviço de Agendamento (AppointmentService) se refere a um Serviço do Catálogo
db.AppointmentService.belongsTo(db.Service, { foreignKey: 'serviceId' });
db.Service.hasMany(db.AppointmentService, { foreignKey: 'serviceId' });


// ===============================================
// === Relação Staff <-> Service (Muitos-para-Muitos) ===
// ===============================================
// Um Profissional (Staff) pode realizar Muitos Serviços
// Um Serviço pode ser realizado por Muitos Profissionais
db.Staff.belongsToMany(db.Service, { 
  through: 'StaffServices', // Nome da tabela de junção que será criada
  foreignKey: 'staffId'
});
db.Service.belongsToMany(db.Staff, { 
  through: 'StaffServices', // Mesmo nome da tabela
  foreignKey: 'serviceId'
});


// ===============================================
// === Relações de VAREJO (do Cliente) ===========
// ===============================================
// Um Cliente pode ter comprado Muitos Produtos
db.Client.hasMany(db.Product, { foreignKey: 'clientId', onDelete: 'CASCADE' });
db.Product.belongsTo(db.Client, { foreignKey: 'clientId', onDelete: 'CASCADE' });

// Um Produto pode ter Muitos Pagamentos
db.Product.hasMany(db.Payment, { foreignKey: 'productId', onDelete: 'CASCADE' });
db.Payment.belongsTo(db.Product, { foreignKey: 'productId', onDelete: 'CASCADE' });


// ===============================================
// === Relações de PAGAMENTOS (do Agendamento) ===
// ===============================================
// Um Pagamento de Agendamento (AppointmentPayment) pode pertencer a...
// ...ou a um Serviço de Agendamento
db.AppointmentPayment.belongsTo(db.AppointmentService, { foreignKey: 'appointmentServiceId' });
db.AppointmentService.hasMany(db.AppointmentPayment, { foreignKey: 'appointmentServiceId', onDelete: 'CASCADE' });

// ...ou a um Produto de Agendamento
db.AppointmentPayment.belongsTo(db.AppointmentProduct, { foreignKey: 'appointmentProductId' });
db.AppointmentProduct.hasMany(db.AppointmentPayment, { foreignKey: 'appointmentProductId', onDelete: 'CASCADE' });


// 3. Exportando o objeto 'db'
db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;