const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const routes = require('./routes/index');

const app = express();

mongoose.connect('mongodb+srv://Andresamara93:Andresamara93@devhouse.owgtbeh.mongodb.net/salon_agenda?retryWrites=true&w=majority&appName=devhouse')
  .then(() => console.log("🟢 Conectado ao MongoDB"))
  .catch(err => console.error("🔴 Erro na conexão com MongoDB:", err));

  const session = require('express-session');

app.use(session({
  secret: 'salao-kadosh-segredo',
  resave: false,
  saveUninitialized: true
}));


app.use(bodyParser.urlencoded({ extended: false }));
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use('/', routes);

app.listen(3000, () => console.log('Servidor rodando em http://localhost:3000'));
