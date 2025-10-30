// db.js
const { Sequelize } = require('sequelize');

// Carrega as variáveis de ambiente (caso ainda não tenham sido carregadas no app.js)
require('dotenv').config(); 

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL não definida em process.env');
}

const sequelize = new Sequelize(DATABASE_URL, {
  dialect: 'postgres',
  logging: false, // Mude para true ou console.log se quiser ver as queries SQL no terminal
  
  // --- IMPORTANTE PARA PRODUÇÃO ---
  // Se o seu banco de dados PostgreSQL (ex: Vercel, Heroku, AWS) usa SSL, 
  // você PRECISARÁ descomentar e configurar isto:
  /*
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false // Esta opção pode ser necessária dependendo do provedor
    }
  },
  */
  
  // Configuração do Pool de Conexões (o Sequelize gerencia isso para você)
  pool: {
    max: 5,  // Máximo de conexões ativas
    min: 0,  // Mínimo de conexões ativas
    acquire: 30000, // Tempo (ms) para tentar obter uma conexão antes de lançar um erro
    idle: 10000     // Tempo (ms) que uma conexão pode ficar ociosa antes de ser fechada
  }
});

// Função assíncrona para testar a conexão
const testConnection = async () => {
  try {
    await sequelize.authenticate();
    console.log('Conexão com PostgreSQL estabelecida com sucesso.');
  } catch (error) {
    console.error('Não foi possível conectar ao PostgreSQL:', error);
  }
};

// Executa o teste de conexão
testConnection();

// Exporta a instância do Sequelize para ser usada em toda a aplicação
module.exports = sequelize;