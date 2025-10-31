const { Sequelize } = require('sequelize');

// Carrega as variáveis de ambiente (caso ainda não tenham sido carregadas no app.js)
require('dotenv').config(); 

const DATABASE_URL = process.env.DATABASE_URL;

// --- MUDANÇA 1: Detectar se estamos em produção ---
// (Servidores como o Render definem esta variável como 'production' automaticamente)
const isProduction = process.env.NODE_ENV === 'production';
// --- FIM DA MUDANÇA 1 ---

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL não definida em process.env');
}

// --- MUDANÇA 2: Configurar SSL apenas em produção ---
const dialectOptions = {}; // Começa vazio

if (isProduction) {
  console.log("Ambiente de produção detectado. Habilitando SSL para o PostgreSQL.");
  dialectOptions.ssl = {
    require: true,
    // Esta opção é necessária para a maioria dos provedores de nuvem
    rejectUnauthorized: false 
  };
}
// --- FIM DA MUDANÇA 2 ---

const sequelize = new Sequelize(DATABASE_URL, {
  dialect: 'postgres',
  logging: false, // Mude para true se quiser ver as queries em produção
  
  // --- MUDANÇA 3: Passa as opções do dialeto ---
  dialectOptions: dialectOptions,
  // --- FIM DA MUDANÇA 3 ---
  
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
