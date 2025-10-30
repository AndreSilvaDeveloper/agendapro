// controllers/staffController.js

// --- MODELOS (Sequelize) ---
const db = require('../models');
const { Op } = require('sequelize');

const fs = require('fs');
const path = require('path');

// --- Utils de sessão/organização ---
const getOrgId = (req) => req.session && req.session.organizationId ? req.session.organizationId : null;

// --- Helpers ---
// Converte array/valor de services em array de inteiros válidos
function normalizeServiceIds(services) {
  const arr = Array.isArray(services) ? services : (services ? [services] : []);
  return arr
    .map((v) => {
      // aceita string "12" ou número 12
      if (typeof v === 'number') return v;
      if (typeof v === 'string' && /^\d+$/.test(v)) return parseInt(v, 10);
      return null;
    })
    .filter((v) => Number.isInteger(v));
}

// Normaliza booleans vindos de checkbox
function toBool(v) {
  return v === true || v === 'true' || v === 'on' || v === 1 || v === '1';
}

// --- FUNÇÃO HELPER (MODIFICADA) ---
// Retorna um Objeto simples com os horários por dia
function processWorkingHours(formData) {
  const hoursObject = {};
  const days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];

  days.forEach((day) => {
    const dayData = formData && formData[day] ? formData[day] : {};
    const isOff = toBool(dayData.isOff);
    hoursObject[day] = {
      startTime: !isOff ? (dayData.startTime || '') : '',
      endTime:   !isOff ? (dayData.endTime   || '') : '',
      isOff
    };
  });
  return hoursObject;
}

// Para views EJS: sempre mandar objeto "plain"
function toPlain(modelOrObject) {
  if (!modelOrObject) return modelOrObject;
  if (typeof modelOrObject.get === 'function') return modelOrObject.get({ plain: true });
  return modelOrObject;
}

/**
 * GET /admin/equipe
 * Lista todos os membros da equipe.
 */
exports.getStaffList = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    if (!organizationId) {
      return res.render('admin/staff-list', {
        staffList: [],
        pageTitle: 'Equipe',
        error: 'Organização não encontrada na sessão.',
        success: null
      });
    }

    const staffList = await db.Staff.findAll({
      where: { organizationId },
      include: [
        {
          model: db.Service,
          as: 'Services', // <-- CORREÇÃO: Adicionado 'as: Services'
          attributes: ['id', 'name'],
          through: { attributes: [] }
        }
      ],
      order: [['name', 'ASC']]
    });

    res.render('admin/staff-list', {
      staffList: staffList.map(toPlain),
      pageTitle: 'Equipe',
      error: req.query.error || null,
      success: req.query.success || null
    });
  } catch (err) {
    console.error('Erro ao listar equipe:', err);
    res.render('admin/staff-list', {
      staffList: [],
      pageTitle: 'Equipe',
      error: 'Erro ao carregar a lista da equipe.',
      success: null
    });
  }
};

/**
 * GET /admin/equipe/novo
 * Mostra o formulário para adicionar novo membro.
 */
exports.getNewStaff = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    if (!organizationId) {
      return res.redirect('/admin/equipe?error=Organização não encontrada na sessão.');
    }

    const availableServices = await db.Service.findAll({
      where: { organizationId, isActive: true },
      order: [['name', 'ASC']]
    });

    const defaultStaff = db.Staff.build(); // usa defaults do modelo (incl. workingHours se existir default)

    res.render('admin/staff-form', {
      pageTitle: 'Novo Membro da Equipe',
      staffMember: toPlain(defaultStaff),
      availableServices: availableServices.map(toPlain),
      editing: false,
      error: null
    });
  } catch (err) {
    console.error('Erro ao carregar formulário de nova equipe:', err);
    res.redirect('/admin/equipe?error=Erro ao carregar o formulário.');
  }
};

/**
 * POST /admin/equipe/novo
 * Salva o novo membro da equipe.
 */
exports.postNewStaff = async (req, res) => {
  const organizationId = getOrgId(req);
  const { name, isActive, services, workingHours } = req.body;

  try {
    if (!organizationId) {
      return res.redirect('/admin/equipe?error=Organização não encontrada na sessão.');
    }

    const selectedServiceIds = normalizeServiceIds(services);
    const processedHours = processWorkingHours(workingHours);

    let imageUrl = '';
    if (req.file) imageUrl = `/uploads/staff/${req.file.filename}`;

    await db.sequelize.transaction(async (t) => {
      const newStaff = await db.Staff.create(
        {
          organizationId,
          name: name?.trim(),
          imageUrl,
          isActive: toBool(isActive),
          workingHours: processedHours
        },
        { transaction: t }
      );

      if (selectedServiceIds.length > 0) {
        // Assume que a associação M2M é 'Services' (plural)
        await newStaff.setServices(selectedServiceIds, { transaction: t });
      }
    });

    res.redirect('/admin/equipe?success=Membro da equipe criado com sucesso!');
  } catch (err) {
    console.error('Erro ao criar membro da equipe:', err);
    let errorMsg = 'Erro ao salvar o membro da equipe. Verifique os dados.';
    if (err.name === 'SequelizeValidationError' && err.errors?.length) {
      errorMsg = err.errors[0].message;
    }

    const availableServices = await db.Service.findAll({
      where: { organizationId, isActive: true },
      order: [['name', 'ASC']]
    });

    res.render('admin/staff-form', {
      pageTitle: 'Novo Membro da Equipe',
      staffMember: {
        name: name || '',
        imageUrl: '',
        isActive: toBool(isActive),
        Services: [], // Use 'Services' (maiúsculo) para consistência
        workingHours: processedHours
      },
      availableServices: availableServices.map(toPlain),
      editing: false,
      error: errorMsg
    });
  }
};

/**
 * GET /admin/equipe/:id/editar
 * Mostra o formulário de edição.
 */
exports.getEditStaff = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    if (!organizationId) {
      return res.redirect('/admin/equipe?error=Organização não encontrada na sessão.');
    }

    const idRaw = req.params.id;
    const id = /^\d+$/.test(idRaw) ? parseInt(idRaw, 10) : idRaw; // permite numérico ou UUID se seu modelo usar

    const staffMember = await db.Staff.findOne({
      where: { id, organizationId },
      include: [
        {
          model: db.Service,
          as: 'Services',
          attributes: ['id', 'name'],
          through: { attributes: [] }
        }
      ]
    });

    if (!staffMember) {
      return res.redirect('/admin/equipe?error=Membro da equipe não encontrado.');
    }

    const availableServices = await db.Service.findAll({
      where: { organizationId, isActive: true },
      order: [['name', 'ASC']]
    });

    res.render('admin/staff-form', {
      pageTitle: 'Editar Membro da Equipe',
      staffMember: toPlain(staffMember),
      availableServices: availableServices.map(toPlain),
      editing: true,
      error: null
    });
  } catch (err) {
    console.error('Erro ao carregar formulário de edição de equipe:', err);
    res.redirect('/admin/equipe?error=Erro ao carregar dados do membro da equipe.');
  }
};

/**
 * POST /admin/equipe/:id/editar
 * Atualiza o membro da equipe.
 */
exports.postEditStaff = async (req, res) => {
  const organizationId = getOrgId(req);
  const idRaw = req.params.id;
  const id = /^\d+$/.test(idRaw) ? parseInt(idRaw, 10) : idRaw;

  const { name, isActive, services, workingHours, oldImageUrl } = req.body;

  const selectedServiceIds = normalizeServiceIds(services);
  const processedHours = processWorkingHours(workingHours);

  try {
    if (!organizationId) {
      return res.redirect('/admin/equipe?error=Organização não encontrada na sessão.');
    }

    await db.sequelize.transaction(async (t) => {
      const staffMember = await db.Staff.findOne({
        where: { id, organizationId },
        transaction: t
      });

      if (!staffMember) {
        throw new Error('Membro da equipe não encontrado.');
      }

      let newImageUrl = oldImageUrl || '';
      if (req.file) {
        newImageUrl = `/uploads/staff/${req.file.filename}`;
        if (oldImageUrl && oldImageUrl.startsWith('/uploads/')) {
          const oldImagePath = path.join(__dirname, '../public', oldImageUrl);
          fs.unlink(oldImagePath, (err) => {
            if (err) console.error('Erro ao deletar foto antiga:', err);
          });
        }
      }

      await staffMember.update(
        {
          name: name?.trim(),
          imageUrl: newImageUrl,
          isActive: toBool(isActive),
          workingHours: processedHours
        },
        { transaction: t }
      );

      // Atualiza M2M (Assume 'Services' como nome da associação)
      await staffMember.setServices(selectedServiceIds, { transaction: t });
    });

    res.redirect('/admin/equipe?success=Membro da equipe atualizado com sucesso!');
  } catch (err) {
    console.error('Erro ao editar membro da equipe:', err);

    let errorMsg = 'Erro ao atualizar o membro da equipe. Verifique os dados.';
    if (err.message === 'Membro da equipe não encontrado.') {
      errorMsg = err.message;
    } else if (err.name === 'SequelizeValidationError' && err.errors?.length) {
      errorMsg = err.errors[0].message;
    }

    const availableServices = await db.Service.findAll({
      where: { organizationId, isActive: true },
      order: [['name', 'ASC']]
    });
    
    // Recria o objeto staffMember para repopular o formulário em caso de erro
    // É importante que 'Services' (maiúsculo) contenha os IDs para os checkboxes
    const staffMemberData = {
      id,
      name: name || '',
      imageUrl: oldImageUrl || '',
      isActive: toBool(isActive),
      // Recria os objetos de serviço (parciais) com base nos IDs enviados
      Services: selectedServiceIds.map(serviceId => ({ id: serviceId })), 
      workingHours: processedHours
    };

    res.render('admin/staff-form', {
      pageTitle: 'Editar Membro da Equipe',
      staffMember: staffMemberData,
      availableServices: availableServices.map(toPlain),
      editing: true,
      error: errorMsg
    });
  }
};

/**
 * POST /admin/equipe/:id/deletar
 * Deleta um membro da equipe.
 */
exports.postDeleteStaff = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    if (!organizationId) {
      return res.redirect('/admin/equipe?error=Organização não encontrada na sessão.');
    }

    const idRaw = req.params.id;
    const id = /^\d+$/.test(idRaw) ? parseInt(idRaw, 10) : idRaw;

    const deletedStaff = await db.Staff.findOne({
      where: { id, organizationId }
    });

    if (!deletedStaff) {
      return res.redirect('/admin/equipe?error=Membro da equipe não encontrado.');
    }

    const imageUrlToDelete = deletedStaff.imageUrl;

    await deletedStaff.destroy();

    if (imageUrlToDelete && imageUrlToDelete.startsWith('/uploads/')) {
      const imagePath = path.join(__dirname, '../public', imageUrlToDelete);
      fs.unlink(imagePath, (err) => {
        if (err) console.error('Erro ao deletar foto do membro:', err);
      });
    }

    res.redirect('/admin/equipe?success=Membro da equipe excluído com sucesso!');
  } catch (err) {
    console.error('Erro ao deletar membro da equipe:', err);
    if (err.name === 'SequelizeForeignKeyConstraintError') {
      return res.redirect('/admin/equipe?error=Este membro não pode ser excluído, pois está vinculado a agendamentos.');
    }
    res.redirect('/admin/equipe?error=Erro ao excluir o membro da equipe.');
  }
};

/**
 * GET /api/portal/staff-by-service/:serviceId
 * (Opcional) Endpoint para o front listar profissionais por serviço (apenas id e name).
 * Garante que o value do <select> será SEMPRE o id numérico, evitando passar "nome" para consultas.
 */
exports.apiGetStaffByService = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    if (!organizationId) {
      return res.status(400).json({ error: 'Organização não encontrada na sessão.' });
    }

    const raw = req.params.serviceId;
    const serviceId = /^\d+$/.test(raw) ? parseInt(raw, 10) : null;
    if (!serviceId) {
      return res.status(400).json({ error: 'serviceId inválido.' });
    }

    const staffList = await db.Staff.findAll({
      where: {
        organizationId,
        isActive: true
      },
      include: [
        {
          model: db.Service,
          where: { id: serviceId },
          attributes: [],
          through: { attributes: [] }
        }
      ],
      attributes: ['id', 'name'],
      order: [['name', 'ASC']]
    });

    const result = staffList.map((s) => ({ id: s.id, name: s.name }));
    return res.json(result);
  } catch (err) {
    console.error('Erro em apiGetStaffByService:', err);
    return res.status(500).json({ error: 'Erro ao buscar profissionais.' });
  }
};