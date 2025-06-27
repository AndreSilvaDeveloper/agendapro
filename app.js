require('dotenv').config();
const express    = require('express');
const mongoose   = require('mongoose');
const session    = require('express-session');
const bodyParser = require('body-parser');
const routes     = require('./routes/index');

const app = express();

// Conexão ao MongoDB com timeout maior
mongoose.connect(process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 60000   // aguarda até 60 segundos por um primário
})
  .then(() => console.log("🟢 Conectado ao MongoDB"))
  .catch(err => console.error("🔴 Erro ao conectar MongoDB:", err));

// Middlewares
app.use(session({
  secret: 'salao-kadosh-segredo',
  resave: false,
  saveUninitialized: true
}));
app.use(bodyParser.urlencoded({ extended: false }));
app.set('view engine', 'ejs');

// Static files
app.use(express.static('public'));

// Rotas
app.use('/', routes);

// Inicialização do servidor
const PORT = process.env.PORT || 3003;
app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
