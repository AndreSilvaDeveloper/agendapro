require('dotenv').config();
const db = require('./models');

(async () => {
  const clients = await db.Client.findAll({ where: { organizationId: 1 }, order: [['id', 'ASC']] });
  console.log('Clientes atuais:');
  clients.forEach(c => console.log(`  ID ${c.id}: "${c.name}" - phone: "${c.phone}"`));

  // Verificar se André existe
  const andre = clients.find(c => c.name.includes('André') || c.name.includes('Andre'));
  if (andre) {
    console.log('\nAndré encontrado: ID', andre.id, 'phone:', andre.phone);
    // Garantir que André tem o phone correto normalizado
    if (andre.phone !== '5532935005492') {
      andre.phone = '5532935005492';
      await andre.save();
      console.log('Phone do André atualizado para 5532935005492');
    }
  }

  // Remover duplicados (clientes com emoji como nome ou "Cliente WhatsApp")
  for (const c of clients) {
    if (c.id === (andre ? andre.id : -1)) continue; // Não mexer no André
    if (c.phone === '5532935005492') {
      // Duplicado do André - mover agendamentos e deletar
      const moved = await db.Appointment.update({ clientId: andre.id }, { where: { clientId: c.id } });
      await c.destroy();
      console.log(`Duplicado removido: ID ${c.id} "${c.name}" (${moved[0]} agendamentos movidos)`);
    }
  }

  // Resultado final
  const final = await db.Client.findAll({ where: { organizationId: 1 }, order: [['id', 'ASC']] });
  console.log('\nClientes finais:');
  final.forEach(c => console.log(`  ID ${c.id}: "${c.name}" - phone: "${c.phone}"`));

  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
