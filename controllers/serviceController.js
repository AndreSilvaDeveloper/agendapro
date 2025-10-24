// controllers/serviceController.js

const Service = require('../models/Service');
const mongoose = require('mongoose');

/**
 * Pega o ID da organização logada a partir da sessão.
 */
const getOrgId = (req) => req.session.organizationId;

/**
 * GET /admin/servicos
 * Lista todos os serviços cadastrados pelo salão.
 */
exports.getServices = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    // Busca serviços ATIVOS e INATIVOS, ordenados por nome
    const services = await Service.find({ organizationId: organizationId }).sort({ name: 1 });

    // Renderiza uma nova view (que criaremos depois)
    res.render('admin/services-list', {
      services: services,
      pageTitle: 'Serviços',
      error: req.query.error || null,
      success: req.query.success || null
    });
  } catch (err) {
    console.error("Erro ao listar serviços:", err);
    res.render('admin/services-list', {
      services: [],
      pageTitle: 'Serviços',
      error: 'Erro ao carregar a lista de serviços.',
      success: null
    });
  }
};

/**
 * GET /admin/servicos/novo
 * Mostra o formulário para adicionar um novo serviço.
 */
exports.getNewService = (req, res) => {
  // Renderiza uma nova view (que criaremos depois)
  res.render('admin/service-form', {
    pageTitle: 'Novo Serviço',
    service: {}, // Objeto vazio para o formulário
    editing: false,
    error: null
  });
};

/**
 * POST /admin/servicos/novo
 * Processa o formulário e salva o novo serviço.
 */
exports.postNewService = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const { name, description, price, duration, imageUrl, isActive } = req.body;

    // "Etiqueta" o novo serviço com o ID da organização
    await Service.create({
      organizationId: organizationId, // <-- Segurança
      name: name,
      description: description || '',
      price: parseFloat(price),
      duration: parseInt(duration, 10),
      imageUrl: imageUrl || '',
      isActive: isActive === 'on' // Checkbox retorna 'on' se marcado
    });

    res.redirect('/admin/servicos?success=Serviço criado com sucesso!');
  } catch (err) {
    console.error("Erro ao criar serviço:", err);
    // Trata erros de validação do Mongoose
    let errorMsg = 'Erro ao salvar o serviço. Verifique os dados.';
    if (err.name === 'ValidationError') {
      errorMsg = Object.values(err.errors)[0].message;
    }
    // Renderiza o formulário novamente com o erro
    res.render('admin/service-form', {
      pageTitle: 'Novo Serviço',
      service: req.body, // Reenvia os dados digitados
      editing: false,
      error: errorMsg
    });
  }
};

/**
 * GET /admin/servicos/:id/editar
 * Mostra o formulário preenchido para editar um serviço.
 */
exports.getEditService = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const { id } = req.params;

    // Busca o serviço APENAS se pertencer a esta organização
    const service = await Service.findOne({ _id: id, organizationId: organizationId });

    if (!service) {
      return res.redirect('/admin/servicos?error=Serviço não encontrado.');
    }

    // Renderiza a view do formulário em modo de edição
    res.render('admin/service-form', {
      pageTitle: 'Editar Serviço',
      service: service, // Envia os dados do serviço encontrado
      editing: true,
      error: null
    });
  } catch (err) {
    console.error("Erro ao carregar formulário de edição:", err);
    res.redirect('/admin/servicos?error=Erro ao carregar dados do serviço.');
  }
};

/**
 * POST /admin/servicos/:id/editar
 * Processa o formulário de edição e atualiza o serviço.
 */
exports.postEditService = async (req, res) => {
  const organizationId = getOrgId(req);
  const { id } = req.params;
  const { name, description, price, duration, imageUrl, isActive } = req.body;

  try {
    // Atualiza o serviço APENAS se pertencer a esta organização
    const result = await Service.findOneAndUpdate(
      { _id: id, organizationId: organizationId }, // <-- Segurança
      {
        name: name,
        description: description || '',
        price: parseFloat(price),
        duration: parseInt(duration, 10),
        imageUrl: imageUrl || '',
        isActive: isActive === 'on'
      },
      { new: true, runValidators: true } // runValidators força as validações do modelo na atualização
    );

    if (!result) {
      return res.redirect('/admin/servicos?error=Serviço não encontrado.');
    }

    res.redirect('/admin/servicos?success=Serviço atualizado com sucesso!');
  } catch (err) {
    console.error("Erro ao editar serviço:", err);
    let errorMsg = 'Erro ao atualizar o serviço. Verifique os dados.';
    if (err.name === 'ValidationError') {
      errorMsg = Object.values(err.errors)[0].message;
    }
    // Re-renderiza o formulário de edição com o erro
    res.render('admin/service-form', {
        pageTitle: 'Editar Serviço',
        service: { ...req.body, _id: id }, // Usa os dados do form + ID
        editing: true,
        error: errorMsg
    });
  }
};

/**
 * POST /admin/servicos/:id/deletar
 * Deleta um serviço.
 */
exports.postDeleteService = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const { id } = req.params;

    // Deleta o serviço APENAS se pertencer a esta organização
    const result = await Service.findOneAndDelete({
      _id: id,
      organizationId: organizationId // <-- Segurança
    });

    if (!result) {
      return res.redirect('/admin/servicos?error=Serviço não encontrado.');
    }

    // TODO Futuro: Verificar se este serviço está sendo usado em agendamentos futuros?

    res.redirect('/admin/servicos?success=Serviço excluído com sucesso!');
  } catch (err) {
    console.error("Erro ao deletar serviço:", err);
    res.redirect('/admin/servicos?error=Erro ao excluir o serviço.');
  }
};