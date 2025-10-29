// api/index.js
require('dotenv').config();

const express    = require('express');
const serverless = require('serverless-http');
const session    = require('express-session');
const MongoStore = require('connect-mongo');
const bodyParser = require('body-parser');
const path       = require('path');
const connectDB  = require('../db');
const routes     = require('../routes/index');
const flash      = require('connect-flash'); // <--- 1. ADICIONE ESTA LINHA

const app = express();

// --- Confia no proxy do Vercel ---
app.set('trust proxy', 1);

// --- Garante conexão ao Mongo antes de qualquer rota ---
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error('🔴 Falha ao conectar ao MongoDB:', err);
    res.status(500).send('Erro interno de banco de dados');
  }
});

// --- Sessão com persistência no MongoDB ---
const isProd = process.env.NODE_ENV === 'production';
app.use(session({
  secret: process.env.SESSION_SECRET || 'salao-kadosh-segredo',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGO_URI,
    ttl: 14 * 24 * 60 * 60,    // 14 dias
    autoRemove: 'native'
  }),
  cookie: {
    maxAge: 14 * 24 * 60 * 60 * 1000,    // 14 dias em ms
    secure: isProd,                      // apenas HTTPS em produção
    sameSite: isProd ? 'none' : 'lax'    // necessário cross-site em prod
  }
}));

// <--- 2. ADICIONE O MIDDLEWARE DO FLASH (DEPOIS DA SESSÃO) ---
app.use(flash());

// <--- 3. ADICIONE O MIDDLEWARE GLOBAL (PARA AS VIEWS) ---
app.use((req, res, next) => {
  res.locals.success_msg = req.flash('success_msg');
  res.locals.error_msg = req.flash('error_msg');
  res.locals.error = req.flash('error'); 
  next();
});

// --- Restante das configurações ---
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, '../public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

app.use('/', routes);

// Exporta para Vercel
module.exports = app;
const handler = serverless(app);
module.exports.handler = handler;