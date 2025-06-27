require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bodyParser = require('body-parser');
const routes = require('./routes/index');
express.static('public')

const app = express();

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("🟢 Conectado ao MongoDB"))
  .catch(err => console.error("🔴 Erro ao conectar MongoDB:", err));

app.use(session({
  secret: 'salao-kadosh-segredo',
  resave: false,
  saveUninitialized: true
}));

app.use(bodyParser.urlencoded({ extended: false }));
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use('/', routes);

const PORT = process.env.PORT || 3003;
app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
