// routes/index.js
require('dotenv').config();
const express = require('express');
const router = express.Router();

// --- Middlewares ---
const { 
  isAuthenticated, 
  isSuperAdmin, 
  isOwnerOrSuperAdmin 
} = require('../middleware/authMiddleware');

const clientAuthMiddleware = require('../middleware/clientAuthMiddleware'); // Cliente
const upload = require('../middleware/upload');

// --- Controladores Admin ---
const authController = require('../controllers/authController');
const dashboardController = require('../controllers/dashboardController');
const clientController = require('../controllers/clientController');
const appointmentController = require('../controllers/appointmentController');
const financialController = require('../controllers/financialController');
const serviceController = require('../controllers/serviceController');
const staffController =require('../controllers/staffController');

const whatsappController = require('../controllers/whatsappController');

// --- Novos Controladores ---
const settingsController = require('../controllers/settingsController');
const masterController = require('../controllers/masterController');
// const { isSuperAdmin } = require('../middleware/authMiddleware'); // Removido, já importado acima



// --- Controladores Cliente ---
const clientAuthController = require('../controllers/clientAuthController');
const clientPortalController = require('../controllers/clientPortalController');
const publicController = require('../controllers/publicController');


// =========================================================================
// === ROTA PÚBLICA DA VITRINE =============================================
// =========================================================================
router.get('/salao/:slug', publicController.getSalonBySlug);

// =========================================================================
/* === ROTAS PORTAL CLIENTE (PÚBLICAS) =================================== */
// =========================================================================
router.get('/portal/:orgId/registro', clientAuthController.getRegister);
router.post('/portal/:orgId/registro', clientAuthController.postRegister);
router.get('/portal/:orgId/login', clientAuthController.getLogin);
router.post('/portal/:orgId/login', clientAuthController.postLogin);
router.get('/portal/logout', clientAuthController.getLogout);

// =========================================================================
/* === ROTAS PORTAL CLIENTE (PROTEGIDAS) ================================= */
// =========================================================================
router.use('/portal/minha-area', clientAuthMiddleware);
router.use('/portal/agendar', clientAuthMiddleware);

router.get('/portal/minha-area', clientPortalController.getMinhaArea);
router.get('/portal/agendar', clientPortalController.getNovoAgendamento);
router.post('/portal/agendar', clientPortalController.postNovoAgendamento);

// --- API do Portal (PROTEGIDAS) ---
router.get(
  '/api/portal/staff-by-service/:serviceId',
  clientAuthMiddleware,
  clientPortalController.getStaffByService
);

router.get(
  '/api/admin/staff-by-service/:serviceId',
  isAuthenticated,
  clientPortalController.getStaffByService
);

router.get(
  '/api/portal/available-times',
  clientAuthMiddleware,
  clientPortalController.getAvailableTimes
);

// =========================================================================
/* === ROTAS PAINEL ADMIN (PÚBLICAS) ===================================== */
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
/* === ROTAS PAINEL ADMIN (PROTEGIDAS) =================================== */
// =========================================================================
router.get('/', isAuthenticated, authController.getRoot);
router.get('/dashboard', isAuthenticated, dashboardController.getDashboard);

// --- Rotas Cliente (Admin) ---
router.get('/clients', isAuthenticated, clientController.getClients);
router.get('/search', isAuthenticated, clientController.searchClients);
router.post('/client', isAuthenticated, clientController.createClient);
router.get('/client/:id', isAuthenticated, clientController.getClientById);
router.get('/client/:id/historico', isAuthenticated, clientController.getClientHistory);
router.post('/client/:id/delete', isAuthenticated, clientController.deleteClient);
router.post('/client/:id/edit', isAuthenticated, clientController.editClient);
router.post('/client/:id/add-product', isAuthenticated, clientController.addProductToClient);
router.post('/client/:id/product/:pi/edit', isAuthenticated, clientController.editClientProduct);
router.post('/client/:id/product/:pi/delete', isAuthenticated, clientController.deleteClientProduct);
router.post('/client/:id/product/:pi/pay', isAuthenticated, clientController.payClientProduct);
router.post('/client/:id/product/:pi/remove-payment/:pj', isAuthenticated, clientController.removeClientProductPayment);

router.get('/admin/whatsapp', isAuthenticated, whatsappController.renderSettingsPage);

// API para o Frontend controlar a sessão
router.get('/api/whatsapp/status', isAuthenticated, whatsappController.getStatus);
router.post('/api/whatsapp/connect', isAuthenticated, whatsappController.connect);
router.post('/api/whatsapp/logout', isAuthenticated, whatsappController.logout);

router.post('/api/admin/whatsapp/pairing-code', isAuthenticated, whatsappController.getPairingCode);

router.post('/api/send-reminder', isAuthenticated, whatsappController.sendReminder);

// --- Rotas Agendamento (Admin) ---
router.post('/appointment', isAuthenticated, appointmentController.createAppointment);
router.get('/agendamentos-por-dia', isAuthenticated, appointmentController.getAgendaPorDia);
router.post('/appointment/:id/edit-service/:idx', isAuthenticated, appointmentController.editAppointmentService);
router.post('/appointment/:id/edit-datetime', isAuthenticated, appointmentController.editAppointmentDateTime);
router.post('/appointment/:id/pay-service/:idx', isAuthenticated, appointmentController.payAppointmentService);
router.post('/appointment/:id/remove-service/:idx', isAuthenticated, appointmentController.removeServiceFromAppointment);
router.post('/appointment/:id/remove-payment/service/:sIdx/:pIdx', isAuthenticated, appointmentController.removeAppointmentPayment);
router.post('/appointment/:id/cancel', isAuthenticated, appointmentController.cancelAppointment);
router.post('/admin/appointment/:id/confirm', isAuthenticated, appointmentController.confirmAppointment);
router.post('/admin/appointment/:id/cancel-by-admin', isAuthenticated, appointmentController.cancelAppointmentByAdmin);

// --- Rotas Financeiras (Admin) ---
router.get('/financeiro', isAuthenticated, financialController.getFinanceiro);
router.get('/expenses', isAuthenticated, financialController.getExpenses);
router.post('/expenses', isAuthenticated, financialController.createExpense);
router.post('/expenses/:id/delete', isAuthenticated, financialController.deleteExpense);
router.get('/balanco', isAuthenticated, financialController.getBalanco);

// --- Rotas Serviços (Admin) ---
router.get('/admin/servicos', isAuthenticated, serviceController.getServices);
router.get('/admin/servicos/novo', isAuthenticated, serviceController.getNewService);
router.post('/admin/servicos/novo', isAuthenticated, serviceController.postNewService);
router.get('/admin/servicos/:id/editar', isAuthenticated, serviceController.getEditService);
router.post('/admin/servicos/:id/editar', isAuthenticated, serviceController.postEditService);
router.post('/admin/servicos/:id/deletar', isAuthenticated, serviceController.postDeleteService);

// --- Rotas Equipe (Admin) ---
router.get('/admin/equipe', isAuthenticated, staffController.getStaffList);
router.get('/admin/equipe/novo', isAuthenticated, staffController.getNewStaff);
router.post('/admin/equipe/novo', isAuthenticated, upload.single('staffPhoto'), staffController.postNewStaff);
router.get('/admin/equipe/:id/editar', isAuthenticated, staffController.getEditStaff);
router.post('/admin/equipe/:id/editar', isAuthenticated, upload.single('staffPhoto'), staffController.postEditStaff);
// ✅ Correção: usar o handler correto de exclusão da equipe
router.post('/admin/equipe/:id/deletar', isAuthenticated, staffController.postDeleteStaff);

// =========================================================================
/* === NOVAS ROTAS DE CONFIGURAÇÃO (METAS 1 E 2) ========================= */
// =========================================================================
router.get(
  '/admin/configuracoes',
  isAuthenticated,
  isOwnerOrSuperAdmin,
  settingsController.getSettings
);

router.post(
  '/admin/configuracoes',
  isAuthenticated,
  isOwnerOrSuperAdmin,
  settingsController.updateSettings
);

// =========================================================================
/* === NOVAS ROTAS DE SUPERADMIN (MASTER) ================================ */
// =========================================================================
router.get(
  '/master',
  isAuthenticated,
  isSuperAdmin,
  masterController.getDashboard
);

router.get(
  '/master/impersonate/:orgId',
  isAuthenticated,
  isSuperAdmin,
  masterController.impersonate
);

// Sair da personificação
router.get(
  '/master/stop-impersonation',
  isAuthenticated,
  masterController.stopImpersonation
);

// --- MUDANÇA AQUI: Rotas de Bloqueio Corrigidas ---
router.post(
  '/master/user/:userId/block', // Caminho corrigido
  isAuthenticated,             // Middleware adicionado
  isSuperAdmin,                // Apenas o superadmin pode bloquear
  masterController.blockUser
);

router.post(
  '/master/user/:userId/unblock', // Caminho corrigido
  isAuthenticated,              // Middleware adicionado
  isSuperAdmin,                 // Apenas o superadmin pode desbloquear
  masterController.unblockUser
);
// --- FIM DA MUDANÇA ---

module.exports = router;