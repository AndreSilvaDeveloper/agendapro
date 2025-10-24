// controllers/staffController.js

const Staff = require('../models/Staff');
const Service = require('../models/Service');
const mongoose = require('mongoose');

/**
 * Pega o ID da organização logada a partir da sessão.
 */
const getOrgId = (req) => req.session.organizationId;

// --- (NOVA FUNÇÃO HELPER) ---
/**
 * Processa os dados de workingHours vindos do formulário.
 * @param {object} formData - O objeto req.body.workingHours
 * @returns {Map<string, object>} - Um Map no formato { day => { startTime, endTime, isOff } }
 */
function processWorkingHours(formData) {
  const hoursMap = new Map();
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

  days.forEach(day => {
    const dayData = formData && formData[day] ? formData[day] : {};
    const isOff = dayData.isOff === 'true'; // Checkbox marcado envia 'true' como string

    hoursMap.set(day, {
      startTime: !isOff ? (dayData.startTime || '') : '', // Limpa se for folga
      endTime: !isOff ? (dayData.endTime || '') : '',     // Limpa se for folga
      isOff: isOff
    });
  });
  return hoursMap;
}
// --- FIM DA FUNÇÃO HELPER ---


/**
 * GET /admin/equipe
 * Lista todos os membros da equipe.
 */
exports.getStaffList = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const staffList = await Staff.find({ organizationId: organizationId })
      .populate('services', 'name')
      .sort({ name: 1 });

    res.render('admin/staff-list', {
      staffList: staffList,
      pageTitle: 'Equipe',
      error: req.query.error || null,
      success: req.query.success || null
    });
  } catch (err) {
    console.error("Erro ao listar equipe:", err);
    res.render('admin/staff-list', { staffList: [], pageTitle: 'Equipe', error: 'Erro ao carregar a lista da equipe.', success: null });
  }
};

/**
 * GET /admin/equipe/novo
 * Mostra o formulário para adicionar novo membro.
 */
exports.getNewStaff = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const availableServices = await Service.find({ organizationId: organizationId, isActive: true }).sort({ name: 1 });

    // Cria um objeto staffMember vazio com a estrutura de workingHours padrão
    // para preencher o formulário corretamente na primeira vez
    const defaultStaff = new Staff(); // Usa o default do modelo

    res.render('admin/staff-form', {
      pageTitle: 'Novo Membro da Equipe',
      staffMember: defaultStaff.toObject(), // Converte para objeto simples
      availableServices: availableServices,
      editing: false,
      error: null
    });
  } catch (err) {
    console.error("Erro ao carregar formulário de nova equipe:", err);
    res.redirect('/admin/equipe?error=Erro ao carregar o formulário.');
  }
};

/**
 * POST /admin/equipe/novo
 * Salva o novo membro da equipe. (MODIFICADO)
 */
exports.postNewStaff = async (req, res) => {
  const organizationId = getOrgId(req);
  // Pega todos os campos, incluindo workingHours
  const { name, imageUrl, isActive, services, workingHours } = req.body;

  try {
    const selectedServiceIds = Array.isArray(services) ? services : (services ? [services] : []);
    // Processa os dados de horário vindos do formulário
    const processedHours = processWorkingHours(workingHours);

    await Staff.create({
      organizationId: organizationId,
      name: name,
      imageUrl: imageUrl || '',
      isActive: isActive === 'on',
      services: selectedServiceIds,
      workingHours: processedHours // Salva o Map processado
    });

    res.redirect('/admin/equipe?success=Membro da equipe criado com sucesso!');
  } catch (err) {
    console.error("Erro ao criar membro da equipe:", err);
    let errorMsg = 'Erro ao salvar o membro da equipe. Verifique os dados.';
    if (err.name === 'ValidationError') {
      errorMsg = Object.values(err.errors)[0].message;
    }
    const availableServices = await Service.find({ organizationId: organizationId, isActive: true }).sort({ name: 1 });
    // Reenvia os dados digitados, incluindo os horários processados para o EJS
    res.render('admin/staff-form', {
      pageTitle: 'Novo Membro da Equipe',
      staffMember: { ...req.body, workingHours: processWorkingHours(workingHours) }, // Passa os horários processados
      availableServices: availableServices,
      editing: false,
      error: errorMsg
    });
  }
};

/**
 * GET /admin/equipe/:id/editar
 * Mostra o formulário de edição. (Sem alterações, já carrega workingHours do DB)
 */
exports.getEditStaff = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const { id } = req.params;
    const staffMember = await Staff.findOne({ _id: id, organizationId: organizationId });

    if (!staffMember) {
      return res.redirect('/admin/equipe?error=Membro da equipe não encontrado.');
    }
    const availableServices = await Service.find({ organizationId: organizationId, isActive: true }).sort({ name: 1 });

    res.render('admin/staff-form', {
      pageTitle: 'Editar Membro da Equipe',
      staffMember: staffMember, // O EJS já sabe lidar com o Map de workingHours vindo do DB
      availableServices: availableServices,
      editing: true,
      error: null
    });
  } catch (err) {
    console.error("Erro ao carregar formulário de edição de equipe:", err);
    res.redirect('/admin/equipe?error=Erro ao carregar dados do membro da equipe.');
  }
};

/**
 * POST /admin/equipe/:id/editar
 * Atualiza o membro da equipe. (MODIFICADO)
 */
exports.postEditStaff = async (req, res) => {
  const organizationId = getOrgId(req);
  const { id } = req.params;
  // Pega todos os campos, incluindo workingHours
  const { name, imageUrl, isActive, services, workingHours } = req.body;
  const selectedServiceIds = Array.isArray(services) ? services : (services ? [services] : []);
  // Processa os dados de horário vindos do formulário
  const processedHours = processWorkingHours(workingHours);

  try {
    const result = await Staff.findOneAndUpdate(
      { _id: id, organizationId: organizationId },
      {
        name: name,
        imageUrl: imageUrl || '',
        isActive: isActive === 'on',
        services: selectedServiceIds,
        workingHours: processedHours // Salva o Map processado
      },
      { new: true, runValidators: true }
    );

    if (!result) {
      return res.redirect('/admin/equipe?error=Membro da equipe não encontrado.');
    }

    res.redirect('/admin/equipe?success=Membro da equipe atualizado com sucesso!');
  } catch (err) {
    console.error("Erro ao editar membro da equipe:", err);
    let errorMsg = 'Erro ao atualizar o membro da equipe. Verifique os dados.';
    if (err.name === 'ValidationError') {
      errorMsg = Object.values(err.errors)[0].message;
    }
    const availableServices = await Service.find({ organizationId: organizationId, isActive: true }).sort({ name: 1 });
    // Reenvia os dados digitados, incluindo os horários processados para o EJS
    res.render('admin/staff-form', {
        pageTitle: 'Editar Membro da Equipe',
        staffMember: { ...req.body, _id: id, services: selectedServiceIds, workingHours: processedHours }, // Passa os horários
        availableServices: availableServices,
        editing: true,
        error: errorMsg
    });
  }
};

/**
 * POST /admin/equipe/:id/deletar
 * Deleta um membro da equipe. (Sem alterações)
 */
exports.postDeleteStaff = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const { id } = req.params;
    const result = await Staff.findOneAndDelete({ _id: id, organizationId: organizationId });
    if (!result) {
      return res.redirect('/admin/equipe?error=Membro da equipe não encontrado.');
    }
    res.redirect('/admin/equipe?success=Membro da equipe excluído com sucesso!');
  } catch (err) {
    console.error("Erro ao deletar membro da equipe:", err);
    res.redirect('/admin/equipe?error=Erro ao excluir o membro da equipe.');
  }
};