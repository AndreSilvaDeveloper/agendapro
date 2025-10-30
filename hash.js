// hash.js
const bcrypt = require('bcrypt');
const SALT_ROUNDS = 10;

// IMPORTANTE: Coloque a senha que você quer usar aqui
const MINHA_SENHA = 'UmaSenhaBemForte123!';

bcrypt.hash(MINHA_SENHA, SALT_ROUNDS).then(hash => {
  console.log('Senha para o DBeaver:');
  console.log(hash);
});

