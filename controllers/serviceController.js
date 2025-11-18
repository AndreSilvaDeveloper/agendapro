// controllers/serviceController.js

// --- REMOVIDO ---
// const Service = require('../models/Service');
// const mongoose = require('mongoose');

// --- ADICIONADO ---
const db = require('../models');

/**
 * Pega o ID da organização logada a partir da sessão.
 */
const getOrgId = (req) => req.session.organizationId;


const parsePriceBRL = (v) => {
      if (v === null || v === undefined) return null;
      if (typeof v === "number") return Number.isFinite(v) ? v : null;
      if (typeof v === "string") {
        let s = v.trim().replace(/\s+/g, "").replace(/R\$/g, "");
    
        const hasComma = s.includes(',');
        // Se tem vírgula, é BRL (ex: "1.250,50" ou "25,50")
        if (hasComma) {
          s = s.replace(/\./g, ""). // Remove milhar
                replace(/,/g, "."); // Troca vírgula
        } 
        // Se não tem vírgula, assume formato "25.50" ou "2500"
        
        const parsed = parseFloat(s);
        return Number.isNaN(parsed) ? null : parsed;
      }
      return null;
    };

/**
 * GET /admin/servicos
 * Lista todos os serviços cadastrados pelo salão.
 */
exports.getServices = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    // ATUALIZADO: Service.find().sort() -> db.Service.findAll()
    const services = await db.Service.findAll({ 
      where: { organizationId: organizationId },
      order: [['name', 'ASC']] // sort({ name: 1 })
    });

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
  // (Sem alterações)
  res.render('admin/service-form', {
    pageTitle: 'Novo Serviço',
    service: {}, 
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

    // ATUALIZADO: Service.create() -> db.Service.create()
    // A sintaxe é idêntica.
    await db.Service.create({
      organizationId: organizationId,
      name: name,
      description: description || '',
      price: parsePriceBRL(price),
      duration: parseInt(duration, 10),
      imageUrl: imageUrl || '',
      isActive: isActive === 'on'
    });

    res.redirect('/admin/servicos?success=Serviço criado com sucesso!');
  } catch (err) {
    console.error("Erro ao criar serviço:", err);
    // ATUALIZADO: Trata erro de validação do Sequelize
    let errorMsg = 'Erro ao salvar o serviço. Verifique os dados.';
    if (err.name === 'SequelizeValidationError') {
      errorMsg = err.errors[0].message;
    }
    
    res.render('admin/service-form', {
      pageTitle: 'Novo Serviço',
      service: req.body,
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

    // ATUALIZADO: Service.findOne({ _id: id }) -> db.Service.findOne({ where: { id: id } })
    const service = await db.Service.findOne({ 
      where: { id: id, organizationId: organizationId } 
    });

    if (!service) {
      return res.redirect('/admin/servicos?error=Serviço não encontrado.');
    }

    res.render('admin/service-form', {
      pageTitle: 'Editar Serviço',
      service: service,
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
    // ATUALIZADO: Service.findOneAndUpdate() -> db.Service.update()
    const [affectedRows] = await db.Service.update(
      {
        name: name,
        description: description || '',
        price: parsePriceBRL(price),
        duration: parseInt(duration, 10),
        imageUrl: imageUrl || '',
        isActive: isActive === 'on'
      },
      { 
        where: { id: id, organizationId: organizationId }
        // 'runValidators: true' é o comportamento padrão no Sequelize
      }
    );

    if (affectedRows === 0) {
      return res.redirect('/admin/servicos?error=Serviço não encontrado.');
    }

    res.redirect('/admin/servicos?success=Serviço atualizado com sucesso!');
  } catch (err) {
    console.error("Erro ao editar serviço:", err);
    // ATUALIZADO: Trata erro de validação do Sequelize
    let errorMsg = 'Erro ao atualizar o serviço. Verifique os dados.';
    if (err.name === 'SequelizeValidationError') {
      errorMsg = err.errors[0].message;
    }
    
    res.render('admin/service-form', {
        pageTitle: 'Editar Serviço',
        service: { ...req.body, id: id }, // ATUALIZADO: _id -> id
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

    // ATUALIZADO: Service.findOneAndDelete() -> db.Service.destroy()
    const affectedRows = await db.Service.destroy({
      where: {
        id: id,
        organizationId: organizationId
      }
    });

    if (affectedRows === 0) {
      return res.redirect('/admin/servicos?error=Serviço não encontrado.');
    }

    res.redirect('/admin/servicos?success=Serviço excluído com sucesso!');
  } catch (err) {
    console.error("Erro ao deletar serviço:", err);
    
    // ATUALIZADO: Tratamento de erro de chave estrangeira
    if (err.name === 'SequelizeForeignKeyConstraintError') {
      return res.redirect('/admin/servicos?error=Este serviço não pode ser excluído, pois está sendo usado por um profissional.');
    }
    
    res.redirect('/admin/servicos?error=Erro ao excluir o serviço.');
  }
};