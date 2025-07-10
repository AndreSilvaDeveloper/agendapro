// app.js

require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bodyParser = require('body-parser');
const path = require('path');

const routes = require('./routes/index');

const app = express();

// ——— Conexão com MongoDB ———
mongoose
  .connect(process.env.MONGO_URI)  // opções de parser já padrão no driver atual
  .then(() => console.log('🟢 Conectado ao MongoDB'))
  .catch(err => console.error('🔴 Erro ao conectar MongoDB:', err));

// ——— Serverless / Proxy (Vercel) ———
app.set('trust proxy', 1);

// ——— Detecta ambiente ———
const isProd = process.env.NODE_ENV === 'production';

// ——— Sessão com persistência no MongoDB ———
app.use(session({
  secret: process.env.SESSION_SECRET || 'salao-kadosh-segredo',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGO_URI,
    ttl: 14 * 24 * 60 * 60,   // 14 dias em segundos
    autoRemove: 'native'
  }),
  cookie: {
    maxAge: 14 * 24 * 60 * 60 * 1000, // 14 dias em ms
    secure:  isProd,                  // true somente em produção (HTTPS)
    sameSite: isProd ? 'none' : 'lax' // none p/ prod cross-site, lax p/ dev
  }
}));

// ——— Configurações de view engine e static ———
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

// ——— Rotas da aplicação ———
app.use('/', routes);

// ——— Middleware de tratamento de erro ———
app.use((err, req, res, next) => {
  console.error('⛔️ ERRO:', err.stack);
  res.status(err.status || 500).send('Erro interno no servidor');
});

// ——— Inicialização do servidor ———
const PORT = process.env.PORT || 3006;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
