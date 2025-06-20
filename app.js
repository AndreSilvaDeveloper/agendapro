const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const session = require('express-session');
const routes = require('./routes/index');

const app = express();

// Conexão com MongoDB
mongoose.connect('mongodb+srv://Andresamara93:Andresamara93@devhouse.owgtbeh.mongodb.net/salon_agenda?retryWrites=true&w=majority&appName=devhouse')
  .then(() => console.log("🟢 Conectado ao MongoDB"))
  .catch(err => console.error("🔴 Erro na conexão com MongoDB:", err));

// Sessão (login)
app.use(session({
  secret: 'salao-kadosh-segredo',
  resave: false,
  saveUninitialized: true
}));

// Middlewares
app.use(bodyParser.urlencoded({ extended: false }));
app.set('view engine', 'ejs');
app.use(express.static('public'));

// Rotas
app.use('/', routes);

// Porta dinâmica para deploy
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
