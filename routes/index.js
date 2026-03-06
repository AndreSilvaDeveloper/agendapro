// routes/index.js
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
const botController = require('../controllers/botController');
const webhookEvolutionController = require('../controllers/webhookEvolutionController');

// --- Novos Controladores ---
const settingsController = require('../controllers/settingsController');
const masterController = require('../controllers/masterController');
const billingController = require('../controllers/billingController');
const checkSubscription = require('../middleware/subscriptionMiddleware');
// const { isSuperAdmin } = require('../middleware/authMiddleware'); // Removido, já importado acima



// --- Controladores Cliente ---
const clientAuthController = require('../controllers/clientAuthController');
const clientPortalController = require('../controllers/clientPortalController');
const publicController = require('../controllers/publicController');


// =========================================================================
// === LANDING PAGE ========================================================
// =========================================================================
router.get('/landing', masterController.getLandingPage);

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
  '/api/admin/services-by-staff/:staffId',
  isAuthenticated,
  staffController.apiGetServicesByStaff
);

router.get(
  '/api/portal/available-times',
  clientAuthMiddleware,
  clientPortalController.getAvailableTimes
);

// =========================================================================
/* === WEBHOOK EVOLUTION API (público - recebe mensagens WhatsApp) ======= */
// =========================================================================
router.post('/webhook/evolution', webhookEvolutionController.handleIncoming);

// Debug: captura TUDO que chega no webhook
router.post('/webhook/debug', (req, res) => {
  console.log('[WEBHOOK DEBUG]', JSON.stringify(req.body).substring(0, 500));
  res.json({ ok: true });
});

// =========================================================================
/* === ROTA API DO BOT WHATSAPP (autenticada por API key) ================ */
// =========================================================================
router.post('/api/bot/process-message', botController.processMessage);

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
router.get('/', (req, res, next) => {
  if (req.session && req.session.loggedIn) {
    return res.redirect('/dashboard');
  }
  return masterController.getLandingPage(req, res);
});

// --- Rotas de Assinatura (acessiveis mesmo bloqueado) ---
router.get('/admin/assinatura', isAuthenticated, billingController.getAssinatura);
router.post('/admin/assinatura/escolher', isAuthenticated, billingController.postEscolherPlano);
router.post('/admin/assinatura/cancelar', isAuthenticated, billingController.postCancelar);

// --- Middleware de assinatura: verifica se org tem plano valido ---
// Roda antes de todas as rotas admin abaixo, exceto /admin/assinatura
router.use((req, res, next) => {
  // So verifica se usuario esta logado e nao e superadmin
  if (!req.session || !req.session.loggedIn) return next();
  if (req.session.role === 'superadmin') return next();
  if (req.path === '/admin/assinatura' || req.path.startsWith('/admin/assinatura/')) return next();
  return checkSubscription(req, res, next);
});

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
router.post('/api/whatsapp/create-instance', isAuthenticated, whatsappController.createInstance);
router.get('/api/whatsapp/qrcode', isAuthenticated, whatsappController.getQrCode);
router.get('/api/whatsapp/status', isAuthenticated, whatsappController.getStatus);
router.post('/api/whatsapp/disconnect', isAuthenticated, whatsappController.disconnect);
router.post('/api/whatsapp/toggle-bot', isAuthenticated, whatsappController.toggleBot);
router.post('/api/whatsapp/test', isAuthenticated, whatsappController.testConnection);

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

// --- Novas Rotas Master ---
router.get('/master/organizacoes', isAuthenticated, isSuperAdmin, masterController.getOrganizacoes);
router.get('/master/organizacoes/:id', isAuthenticated, isSuperAdmin, masterController.getOrganizacaoDetalhes);
router.get('/master/assinaturas', isAuthenticated, isSuperAdmin, masterController.getAssinaturas);
router.get('/master/planos', isAuthenticated, isSuperAdmin, masterController.getPlanos);
router.get('/master/planos/novo', isAuthenticated, isSuperAdmin, masterController.getNewPlan);
router.post('/master/planos/novo', isAuthenticated, isSuperAdmin, masterController.postNewPlan);
router.get('/master/planos/:id/editar', isAuthenticated, isSuperAdmin, masterController.getEditPlan);
router.post('/master/planos/:id/editar', isAuthenticated, isSuperAdmin, masterController.postEditPlan);
router.get('/master/financeiro', isAuthenticated, isSuperAdmin, masterController.getFinanceiro);
router.get('/master/usuarios', isAuthenticated, isSuperAdmin, masterController.getUsuarios);
router.get('/master/configuracoes', isAuthenticated, isSuperAdmin, masterController.getConfiguracoes);
router.post('/master/subscription', isAuthenticated, isSuperAdmin, masterController.postChangeSubscription);

// --- Bloqueio/Desbloqueio ---
router.post('/master/user/:userId/block', isAuthenticated, isSuperAdmin, masterController.blockUser);
router.post('/master/user/:userId/unblock', isAuthenticated, isSuperAdmin, masterController.unblockUser);

// --- Webhook de pagamento (público - recebe callbacks do gateway) ---
router.post('/webhook/payment/:gateway', masterController.handlePaymentWebhook);

module.exports = router;