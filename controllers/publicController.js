// controllers/publicController.js

const Organization = require('../models/Organization');
const Service = require('../models/Service');
const Staff = require('../models/Staff');
const dayjs = require('dayjs');

/**
 * GET /salao/:slug
 * Mostra a "página pública" ou "vitrine" de um salão específico.
 * Esta é a página que o cliente acessa para encontrar os links de login e agendamento.
 */
exports.getSalonBySlug = async (req, res) => {
  try {
    const { slug } = req.params;

    // 1. Encontra a organização (salão) pelo seu link amigável (slug)
    const organization = await Organization.findOne({ slug: slug.toLowerCase() });

    // Se o salão não for encontrado, mostra uma página de erro 404
    if (!organization) {
      return res.status(404).render('public/not-found', {
        error: 'Salão não encontrado',
        slug: slug
      });
    }

    // 2. Busca os serviços ATIVOS deste salão
    const services = await Service.find({
      organizationId: organization._id,
      isActive: true
    }).sort({ name: 1 });

    // 3. Busca a equipe (profissionais) ATIVOS deste salão
    const staff = await Staff.find({
      organizationId: organization._id,
      isActive: true
    }).sort({ name: 1 });

    // 4. Renderiza a nova view da vitrine (que criaremos a seguir)
    res.render('public/salon-page', {
      org: organization, // Envia todos os dados do salão (nome, endereço, fotos, etc.)
      services: services,  // Lista de serviços
      staff: staff,        // Lista de equipe
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