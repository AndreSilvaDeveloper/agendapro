// controllers/staffController.js

const Staff = require('../models/Staff');
const Service = require('../models/Service');
const mongoose = require('mongoose');
const fs = require('fs'); // <-- ADICIONADO: Para deletar arquivos
const path = require('path'); // <-- ADICIONADO: Para construir caminhos de arquivos

/**
 * Pega o ID da organização logada a partir da sessão.
 */
const getOrgId = (req) => req.session.organizationId;

// --- FUNÇÃO HELPER (Sem alterações) ---
function processWorkingHours(formData) {
  // ... (Sua função está perfeita, sem alterações) ...
  const hoursMap = new Map();
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

  days.forEach(day => {
    const dayData = formData && formData[day] ? formData[day] : {};
    const isOff = dayData.isOff === 'true';

    hoursMap.set(day, {
      startTime: !isOff ? (dayData.startTime || '') : '',
      endTime: !isOff ? (dayData.endTime || '') : '',
      isOff: isOff
    });
  });
  return hoursMap;
}
// --- FIM DA FUNÇÃO HELPER ---


/**
 * GET /admin/equipe (Sem alterações)
 * Lista todos os membros da equipe.
 */
exports.getStaffList = async (req, res) => {
  // ... (Sem alterações) ...
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
 * GET /admin/equipe/novo (Sem alterações)
 * Mostra o formulário para adicionar novo membro.
 */
exports.getNewStaff = async (req, res) => {
  // ... (Sem alterações) ...
  try {
    const organizationId = getOrgId(req);
    const availableServices = await Service.find({ organizationId: organizationId, isActive: true }).sort({ name: 1 });
    const defaultStaff = new Staff(); 

    res.render('admin/staff-form', {
      pageTitle: 'Novo Membro da Equipe',
      staffMember: defaultStaff.toObject(),
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
 * POST /admin/equipe/novo (MODIFICADO PARA UPLOAD)
 * Salva o novo membro da equipe.
 */
exports.postNewStaff = async (req, res) => {
  const organizationId = getOrgId(req);
  // Pega os campos (Note que 'imageUrl' saiu daqui)
  const { name, isActive, services, workingHours } = req.body;

  try {
    const selectedServiceIds = Array.isArray(services) ? services : (services ? [services] : []);
    const processedHours = processWorkingHours(workingHours);

    // --- Lógica da Imagem ---
    let imageUrl = ''; // Padrão é sem imagem
    if (req.file) {
      // Se o multer enviou um arquivo, pegamos o nome dele e montamos a URL
      imageUrl = `/uploads/staff/${req.file.filename}`;
    }
    // --- Fim Lógica da Imagem ---

    await Staff.create({
      organizationId: organizationId,
      name: name,
      imageUrl: imageUrl, // Salva o caminho da imagem (ou string vazia)
      isActive: isActive === 'on',
      services: selectedServiceIds,
      workingHours: processedHours
    });

    res.redirect('/admin/equipe?success=Membro da equipe criado com sucesso!');
  } catch (err) {
    console.error("Erro ao criar membro da equipe:", err);
    let errorMsg = 'Erro ao salvar o membro da equipe. Verifique os dados.';
    if (err.name === 'ValidationError') {
      errorMsg = Object.values(err.errors)[0].message;
    }
    const availableServices = await Service.find({ organizationId: organizationId, isActive: true }).sort({ name: 1 });
    res.render('admin/staff-form', {
      pageTitle: 'Novo Membro da Equipe',
      staffMember: { ...req.body, workingHours: processWorkingHours(workingHours) },
      availableServices: availableServices,
      editing: false,
      error: errorMsg
    });
  }
};

/**
 * GET /admin/equipe/:id/editar (Sem alterações)
 * Mostra o formulário de edição.
 */
exports.getEditStaff = async (req, res) => {
  // ... (Sem alterações) ...
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
      staffMember: staffMember, 
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
 * POST /admin/equipe/:id/editar (MODIFICADO PARA UPLOAD)
 * Atualiza o membro da equipe.
 */
exports.postEditStaff = async (req, res) => {
  const organizationId = getOrgId(req);
  const { id } = req.params;
  // Pega 'oldImageUrl' do campo oculto, 'imageUrl' não vem mais
  const { name, isActive, services, workingHours, oldImageUrl } = req.body;
  const selectedServiceIds = Array.isArray(services) ? services : (services ? [services] : []);
  const processedHours = processWorkingHours(workingHours);

  try {
    // --- Lógica da Imagem ---
    let newImageUrl = oldImageUrl; // Por padrão, mantém a imagem antiga

    if (req.file) {
      // 1. Se uma nova foto foi enviada, definimos a nova URL
      newImageUrl = `/uploads/staff/${req.file.filename}`;
      
      // 2. Deletamos a foto antiga, se ela existir
      if (oldImageUrl && oldImageUrl.startsWith('/uploads/')) {
        const oldImagePath = path.join(__dirname, '../public', oldImageUrl);
        fs.unlink(oldImagePath, (err) => {
          if (err) console.error("Erro ao deletar foto antiga:", err);
        });
      }
    }
    // --- Fim Lógica da Imagem ---

    const result = await Staff.findOneAndUpdate(
      { _id: id, organizationId: organizationId },
      {
        name: name,
        imageUrl: newImageUrl, // Salva a URL (nova ou a antiga mantida)
        isActive: isActive === 'on',
        services: selectedServiceIds,
        workingHours: processedHours
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
    res.render('admin/staff-form', {
        pageTitle: 'Editar Membro da Equipe',
        staffMember: { ...req.body, _id: id, services: selectedServiceIds, workingHours: processedHours }, 
        availableServices: availableServices,
        editing: true,
        error: errorMsg
    });
  }
};

/**
 * POST /admin/equipe/:id/deletar (MODIFICADO PARA DELETAR FOTO)
 * Deleta um membro da equipe.
 */
exports.postDeleteStaff = async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const { id } = req.params;

    // Encontra e deleta, e retorna o documento deletado
    const deletedStaff = await Staff.findOneAndDelete({ _id: id, organizationId: organizationId });

    if (!deletedStaff) {
      return res.redirect('/admin/equipe?error=Membro da equipe não encontrado.');
    }

    // --- Lógica da Imagem ---
    // Se o membro deletado tinha uma foto, vamos deletá-la do servidor
    if (deletedStaff.imageUrl && deletedStaff.imageUrl.startsWith('/uploads/')) {
      const imagePath = path.join(__dirname, '../public', deletedStaff.imageUrl);
      fs.unlink(imagePath, (err) => {
        if (err) console.error("Erro ao deletar foto do membro:", err);
      });
    }
    // --- Fim Lógica da Imagem ---

    res.redirect('/admin/equipe?success=Membro da equipe excluído com sucesso!');
  } catch (err) {
    console.error("Erro ao deletar membro da equipe:", err);
    res.redirect('/admin/equipe?error=Erro ao excluir o membro da equipe.');
  }
};