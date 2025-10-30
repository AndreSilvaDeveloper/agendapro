// controllers/publicController.js

// --- REMOVIDO ---
// const Organization = require('../models/Organization');
// const Service = require('../models/Service');
// const Staff = require('../models/Staff');
// const dayjs = require('dayjs'); // Não era usado neste arquivo

// --- ADICIONADO ---
const db = require('../models');

/**
 * GET /salao/:slug
 * Mostra a "página pública" ou "vitrine" de um salão específico.
 * (ATUALIZADO para Sequelize com 'include')
 */
exports.getSalonBySlug = async (req, res) => {
  try {
    const { slug } = req.params;

    // 1. (ATUALIZADO) Encontra a organização e INCLUI seus serviços e equipe ativos
    // Esta é UMA ÚNICA busca no banco de dados.
    const organization = await db.Organization.findOne({
      where: { slug: slug.toLowerCase() },
      include: [
        {
          model: db.Service,
          where: { isActive: true },
          required: false // LEFT JOIN: mostra o salão mesmo que não tenha serviços
        },
        {
          model: db.Staff,
          where: { isActive: true },
          required: false // LEFT JOIN: mostra o salão mesmo que não tenha equipe
        }
      ],
      order: [
        // Adiciona ordenação para os modelos incluídos
        [db.Service, 'name', 'ASC'],
        [db.Staff, 'name', 'ASC']
      ]
    });

    // 2. Se o salão não for encontrado, mostra 404
    if (!organization) {
      return res.status(404).render('public/not-found', {
        error: 'Salão não encontrado',
        slug: slug
      });
    }

    // 3. (REMOVIDO) - Queries separadas para Service e Staff não são mais necessárias

    // 4. Renderiza a página
    // Os dados estão em 'organization.Services' e 'organization.Staff'
    res.render('public/salon-page', {
      org: organization, 
      services: organization.Services, // Passa os serviços incluídos
      staff: organization.Staff,       // Passa a equipe incluída
      error: null
    });

  } catch (err) {
    console.error(`Erro ao buscar salão pelo slug [${req.params.slug}]:`, err);
    res.status(500).render('public/not-found', {
      error: 'Erro interno no servidor.',
      slug: req.params.slug
    });
  }
};