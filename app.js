// app.js
'use strict';

require('dotenv').config();

const express = require('express');
const schedulerService = require('./services/schedulerService');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const flash = require('connect-flash');

const sequelize = require('./db');
const SequelizeStore = require('connect-session-sequelize')(session.Store);

const routes = require('./routes/index');

const app = express();

app.set('trust proxy', 1);

const isProd = process.env.NODE_ENV === 'production';

const sessionStore = new SequelizeStore({
  db: sequelize,
  tableName: 'Session',
  checkExpirationInterval: 15 * 60 * 1000,
  expiration: 14 * 24 * 60 * 60 * 1000
});

app.use(session({
  secret: process.env.SESSION_SECRET || 'agendapro-secret',
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    maxAge: 14 * 24 * 60 * 60 * 1000,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax'
  }
}));

app.use(flash());

app.use((req, res, next) => {
  res.locals.success_msg = req.flash('success_msg');
  res.locals.error_msg = req.flash('error_msg');
  res.locals.error = req.flash('error');
  next();
});

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', routes);

app.use((err, req, res, next) => {
  console.error('ERRO:', err.stack || err);
  res.status(err.status || 500).send('Erro interno no servidor');
});

const PORT = process.env.PORT || 3003;
const HOST = isProd ? '0.0.0.0' : 'localhost';

(async () => {
  try {
    await sequelize.authenticate();
    console.log('Conexao com o PostgreSQL OK.');

    await sessionStore.sync();
    await sequelize.sync({ alter: true });
    console.log('Tabelas sincronizadas.');

    schedulerService.init();

    app.listen(PORT, () => {
      console.log(`Servidor rodando em: http://${HOST}:${PORT}`);
    });

  } catch (err) {
    console.error('Erro ao iniciar a aplicacao:', err);
    process.exit(1);
  }
})();

module.exports = app;
