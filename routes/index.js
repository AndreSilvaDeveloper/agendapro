// routes/index.js
require('dotenv').config();
const express = require('express');
const router = express.Router();

// --- Middlewares ---
const authMiddleware = require('../middleware/authMiddleware'); // Admin/Staff
const clientAuthMiddleware = require('../middleware/clientAuthMiddleware'); // Cliente

// --- Controladores Admin ---
const authController = require('../controllers/authController');
const dashboardController = require('../controllers/dashboardController');
const clientController = require('../controllers/clientController');
const appointmentController = require('../controllers/appointmentController');
const financialController = require('../controllers/financialController');
const serviceController = require('../controllers/serviceController');
const staffController = require('../controllers/staffController');

// --- Controladores Cliente ---
const clientAuthController = require('../controllers/clientAuthController');
const clientPortalController = require('../controllers/clientPortalController');
const publicController = require('../controllers/publicController');


// =========================================================================
// === ROTA PÚBLICA DA VITRINE =============================================
// =========================================================================
router.get('/salao/:slug', publicController.getSalonBySlug);


// =========================================================================
// === ROTAS PORTAL CLIENTE (PÚBLICAS) =====================================
// =========================================================================
router.get('/portal/:orgId/registro', clientAuthController.getRegister);
router.post('/portal/:orgId/registro', clientAuthController.postRegister);
router.get('/portal/:orgId/login', clientAuthController.getLogin);
router.post('/portal/:orgId/login', clientAuthController.postLogin);
router.get('/portal/logout', clientAuthController.getLogout);


// =========================================================================
// === ROTAS PORTAL CLIENTE (PROTEGIDAS) ===================================
// =========================================================================
router.use('/portal/minha-area', clientAuthMiddleware);
router.use('/portal/agendar', clientAuthMiddleware);
router.get('/portal/minha-area', clientPortalController.getMinhaArea);
router.get('/portal/agendar', clientPortalController.getNovoAgendamento);
router.post('/portal/agendar', clientPortalController.postNovoAgendamento);


// =========================================================================
// === ROTAS PAINEL ADMIN (PÚBLICAS) =======================================
// =========================================================================
router.get('/login', authController.getLogin);
router.post('/login', authController.postLogin);
router.get('/logout', authController.getLogout);
router.get('/register', authController.getRegister);
router.post('/register', authController.postRegister);
router.get('/forgot-password', authController.getForgotPassword);
router.post('/forgot-password', authController.postForgotPassword);
router.get('/reset/:token', authController.getReset);
router.post('/reset/:token', authController.postReset);


// =========================================================================
// === ROTAS PAINEL ADMIN (PROTEGIDAS) =====================================
// =========================================================================
router.get('/', authMiddleware, authController.getRoot);
router.get('/dashboard', authMiddleware, dashboardController.getDashboard);

// --- Rotas Cliente (Admin) ---
router.get('/clients', authMiddleware, clientController.getClients);
router.get('/search', authMiddleware, clientController.searchClients);
router.post('/client', authMiddleware, clientController.createClient);
router.get('/client/:id', authMiddleware, clientController.getClientById);
router.get('/client/:id/historico', authMiddleware, clientController.getClientHistory);
router.post('/client/:id/delete', authMiddleware, clientController.deleteClient);
router.post('/client/:id/edit', authMiddleware, clientController.editClient);
router.post('/client/:id/add-product', authMiddleware, clientController.addProductToClient);
router.post('/client/:id/product/:pi/edit', authMiddleware, clientController.editClientProduct);
router.post('/client/:id/product/:pi/delete', authMiddleware, clientController.deleteClientProduct);
router.post('/client/:id/product/:pi/pay', authMiddleware, clientController.payClientProduct);
router.post('/client/:id/product/:pi/remove-payment/:pj', authMiddleware, clientController.removeClientProductPayment);

// --- Rotas Agendamento (Admin) ---
router.post('/appointment', authMiddleware, appointmentController.createAppointment); // Criação pelo Admin (já seta 'confirmado')
router.get('/agendamentos-por-dia', authMiddleware, appointmentController.getAgendaPorDia);
router.post('/appointment/:id/edit-service/:idx', authMiddleware, appointmentController.editAppointmentService);
router.post('/appointment/:id/edit-datetime', authMiddleware, appointmentController.editAppointmentDateTime);
router.post('/appointment/:id/pay-service/:idx', authMiddleware, appointmentController.payAppointmentService);
router.post('/appointment/:id/remove-service/:idx', authMiddleware, appointmentController.removeServiceFromAppointment);
router.post('/appointment/:id/remove-payment/service/:sIdx/:pIdx', authMiddleware, appointmentController.removeAppointmentPayment);
router.post('/appointment/:id/cancel', authMiddleware, appointmentController.cancelAppointment); // Rota genérica de cancelamento

// --- NOVAS ROTAS PARA CONFIRMAR/CANCELAR SOLICITAÇÕES ---
router.post('/admin/appointment/:id/confirm', authMiddleware, appointmentController.confirmAppointment);
router.post('/admin/appointment/:id/cancel-by-admin', authMiddleware, appointmentController.cancelAppointmentByAdmin);


// --- Rotas Financeiras (Admin) ---
router.get('/financeiro', authMiddleware, financialController.getFinanceiro);
router.get('/expenses', authMiddleware, financialController.getExpenses);
router.post('/expenses', authMiddleware, financialController.createExpense);
router.post('/expenses/:id/delete', authMiddleware, financialController.deleteExpense);
router.get('/balanco', authMiddleware, financialController.getBalanco);

// --- Rotas Serviços (Admin) ---
router.get('/admin/servicos', authMiddleware, serviceController.getServices);
router.get('/admin/servicos/novo', authMiddleware, serviceController.getNewService);
router.post('/admin/servicos/novo', authMiddleware, serviceController.postNewService);
router.get('/admin/servicos/:id/editar', authMiddleware, serviceController.getEditService);
router.post('/admin/servicos/:id/editar', authMiddleware, serviceController.postEditService);
router.post('/admin/servicos/:id/deletar', authMiddleware, serviceController.postDeleteService);

// --- Rotas Equipe (Admin) ---
router.get('/admin/equipe', authMiddleware, staffController.getStaffList);
router.get('/admin/equipe/novo', authMiddleware, staffController.getNewStaff);
router.post('/admin/equipe/novo', authMiddleware, staffController.postNewStaff);
router.get('/admin/equipe/:id/editar', authMiddleware, staffController.getEditStaff);
router.post('/admin/equipe/:id/editar', authMiddleware, staffController.postEditStaff);
router.post('/admin/equipe/:id/deletar', authMiddleware, staffController.postDeleteStaff);


module.exports = router;