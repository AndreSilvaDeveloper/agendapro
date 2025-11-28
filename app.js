// app.js
'use strict';

require('dotenv').config();

// 🔥 Captura erros globais para não derrubar o servidor
process.on('unhandledRejection', (reason, promise) => {
  console.error('🔥 Unhandled Rejection em promessa:', promise, 'motivo:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('🔥 Uncaught Exception:', err);
  // Não chamamos process.exit() aqui para o servidor continuar rodando
});

const http = require('http'); // Importar módulo HTTP nativo
const { Server } = require("socket.io"); // Importar Socket.IO

const express = require('express');
const whatsappService = require('./services/whatsappService');
const schedulerService = require('./services/schedulerService');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const flash = require('connect-flash');

// --- Sequelize / Store de sessão ---
const sequelize = require('./db'); // deve exportar a instância do Sequelize
const SequelizeStore = require('connect-session-sequelize')(session.Store);

// Rotas
const routes = require('./routes/index');

const app = express();

const server = http.createServer(app); // Criar servidor HTTP com o Express
const io = new Server(server); // Vincular Socket.IO ao servidor

// Proxy (Render/Heroku/etc.)
app.set('trust proxy', 1);

// Ambiente
const isProd = process.env.NODE_ENV === 'production';

// Store de sessão no PostgreSQL
const sessionStore = new SequelizeStore({
  db: sequelize,
  tableName: 'Session',
  checkExpirationInterval: 15 * 60 * 1000,  // limpa sessões expiradas a cada 15 min
  expiration: 14 * 24 * 60 * 60 * 1000      // 14 dias
});

// Sessão
app.use(session({
  secret: process.env.SESSION_SECRET || 'salao-kadosh-segredo',
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    maxAge: 14 * 24 * 60 * 60 * 1000, // 14 dias
    secure: isProd,                   // em produção exige HTTPS
    sameSite: isProd ? 'none' : 'lax' // 'none' exige secure:true
  }
}));

// Flash messages
app.use(flash());

// Middleware global para expor flash nas views
app.use((req, res, next) => {
  res.locals.success_msg = req.flash('success_msg');
  res.locals.error_msg = req.flash('error_msg');
  res.locals.error = req.flash('error');
  next();
});

// View engine e estáticos
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Rotas
app.use('/', routes);

// Tratamento de erro de rota/controller
app.use((err, req, res, next) => {
  console.error('⛔️ ERRO:', err.stack || err);
  res.status(err.status || 500).send('Erro interno no servidor');
});

// Inicialização
const PORT = process.env.PORT || 3003;
const HOST = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost';

(async () => {
  try {
    // 1) Testa conexão com o banco
    await sequelize.authenticate();
    console.log('🟢 Conexão com o PostgreSQL OK.');

    // 2) Sincroniza a tabela de sessão
    await sessionStore.sync();
    console.log('🟢 Tabela de Sessão sincronizada.');

    // 3) Sincroniza seus models (User, Client, etc.)
    await sequelize.sync({ alter: true });
    console.log('🟢 Tabelas principais do PostgreSQL sincronizadas.');

    // 4) Inicializa serviços
    whatsappService.init(io);
    schedulerService.init();

    // 5) Sobe o servidor
    server.listen(PORT, () => {
      console.log(`🚀 Servidor rodando em: \x1b[36mhttp://${HOST}:${PORT}\x1b[0m`);
    });

  } catch (err) {
    console.error('🔴 Erro ao iniciar a aplicação:', err);
    process.exit(1);
  }
})();

module.exports = app;
