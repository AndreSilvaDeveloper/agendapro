// api/index.js
const express    = require('express');
const serverless = require('serverless-http');
const session    = require('express-session');
const bodyParser = require('body-parser');
const path       = require('path');
const connectDB  = require('../db');           // 👈 nosso módulo de conexão
const routes     = require('../routes/index');

require('dotenv').config();

const app = express();

// ——— Middleware para garantir a conexão antes de tudo ———
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error('🔴 Falha ao conectar ao MongoDB:', err);
    res.status(500).send('Erro interno de banco de dados');
  }
});

// Session (em memória — pode trocar para connect-mongo, Redis etc)
app.use(session({
  secret: process.env.SESSION_SECRET || 'salao-kadosh-segredo',
  resave: false,
  saveUninitialized: true
}));

app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, '../public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));
app.use('/', routes);

// ——— Exporta o handler serverless ———
module.exports = app;
const handler = serverless(app);
module.exports.handler = async (event, context) => {
  // Garante que o DB está pronto mesmo em cold-start
  await connectDB();
  return handler(event, context);
};
