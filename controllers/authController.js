// controllers/authController.js

const db = require("../models"); // Importa o 'models/index.js'
const { Op } = require("sequelize"); // Importa o operador do Sequelize

const crypto = require("crypto");
const mailer = require("../utils/mailer");
const slugify = require("slugify"); // Mantido para a pré-verificação

// --- Página de Login (GET) ---
// (Sem alterações)
exports.getLogin = (req, res) => {
  res.render("login", {
    error: req.query.error || null,
    success: req.query.success || null,
  });
};

// --- Processar o Login (POST) ---
// (Atualizado para Sequelize)
exports.postLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.render("login", {
        error: "E-mail e senha são obrigatórios.",
        success: null,
      });
    }

    // ATUALIZADO: User.findOne -> db.User.findOne({ where: ... })
    const user = await db.User.findOne({
      where: { email: email.toLowerCase() },
    });

    if (!user) {
      return res.render("login", {
        error: "E-mail ou senha inválidos.",
        success: null,
      });
    }

    // O método comparePassword (User.prototype.comparePassword) funciona igual
    const isMatch = await user.comparePassword(password);

    if (!isMatch) {
      return res.render("login", {
        error: "E-mail ou senha inválidos.",
        success: null,
      });
    }

    // Se usuario bloqueado (assinatura vencida), permite login mas redireciona para pagamento
    if (user.isBlocked && user.role !== "superadmin") {
      req.session.loggedIn = true;
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.role = user.role;
      req.session.organizationId = user.organizationId;
      return req.session.save((err) => {
        if (err) {
          console.error("Erro ao salvar sessao:", err);
          return res.render("login", { error: "Erro interno.", success: null });
        }
        return res.redirect("/admin/assinatura?blocked=true");
      });
    }

    // Define os dados da sessão
    req.session.loggedIn = true;
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role;

    // Se for superadmin, organizationId ficará 'null'.
    // Se for usuário normal, terá o ID. Está correto.
    req.session.organizationId = user.organizationId;

    // Lógica de salvar sessão (mantida)
    req.session.save((err) => {
      if (err) {
        console.error("Erro ao salvar a sessão:", err);
        return res.render("login", {
          error: "Erro interno ao salvar sua sessão.",
          success: null,
        });
      }

      // --- MUDANÇA AQUI ---
      // Verifica o 'role' e redireciona para o painel correto
      if (user.role === "superadmin") {
        return res.redirect("/master");
      } else {
        return res.redirect("/dashboard");
      }
      // --- FIM DA MUDANÇA ---
    });
  } catch (err) {
    console.error("Erro no login:", err);
    res.render("login", {
      error: "Erro interno. Tente novamente.",
      success: null,
    });
  }
};

// --- Página de Registro (GET) ---
// (Sem alterações)
exports.getRegister = async (req, res) => {
  const planSlug = req.query.plan || null;
  let selectedPlan = null;
  if (planSlug && db.Plan) {
    selectedPlan = await db.Plan.findOne({ where: { slug: planSlug, isActive: true } });
  }
  res.render("register", { error: null, selectedPlan: selectedPlan ? selectedPlan.toJSON() : null });
};

// --- Processar o Registro (POST) ---
// (Sem alterações)
exports.postRegister = async (req, res) => {
  const { salonName, username, email, password, passwordConfirm } = req.body;
  const planSlug = req.query.plan || null;

  // Buscar plano selecionado para re-exibir na view em caso de erro
  let selectedPlan = null;
  if (planSlug && db.Plan) {
    const p = await db.Plan.findOne({ where: { slug: planSlug, isActive: true } });
    if (p) selectedPlan = p.toJSON();
  }

  // --- Validacoes ---
  if (!salonName || !username || !email || !password || !passwordConfirm) {
    return res.render("register", {
      error: "Todos os campos são obrigatórios.",
      selectedPlan,
    });
  }
  if (password !== passwordConfirm) {
    return res.render("register", { error: "As senhas não coincidem.", selectedPlan });
  }
  if (password.length < 6) {
    return res.render("register", {
      error: "A senha deve ter pelo menos 6 caracteres.",
      selectedPlan,
    });
  }

  // --- Pre-verificacoes ---
  let testSlug;
  try {
    const existingEmail = await db.User.findOne({
      where: { email: email.toLowerCase() },
    });
    if (existingEmail) {
      return res.render("register", { error: "Este e-mail já está em uso.", selectedPlan });
    }

    testSlug = slugify(salonName, {
      lower: true,
      strict: true,
      remove: /[*+~.()'"!:@]/g,
    });

    const existingSlug = await db.Organization.findOne({
      where: { slug: testSlug },
    });
    if (existingSlug) {
      return res.render("register", {
        error: "Este nome de salão já está em uso. Por favor, escolha outro.",
        selectedPlan,
      });
    }
  } catch (err) {
    console.error("Erro na pré-verificação do registro:", err);
    return res.render("register", {
      error: "Erro ao verificar dados. Tente novamente.",
      selectedPlan,
    });
  }

  // --- Transacao do Sequelize ---
  try {
    const newUser = await db.sequelize.transaction(async (t) => {
      // 1. Criar a Organizacao
      const newOrg = await db.Organization.create(
        { name: salonName, slug: testSlug },
        { transaction: t }
      );

      // 2. Criar o Usuario 'owner'
      const user = await db.User.create(
        {
          organizationId: newOrg.id,
          username: username,
          email: email,
          password: password,
          role: "owner",
        },
        { transaction: t }
      );

      // 3. Criar Assinatura (trial ou plano selecionado)
      if (db.Subscription) {
        let planId = null;
        if (selectedPlan) {
          planId = selectedPlan.id;
        } else if (db.Plan) {
          // Plano gratuito como fallback
          const freePlan = await db.Plan.findOne({ where: { slug: 'gratuito', isActive: true }, transaction: t });
          if (freePlan) planId = freePlan.id;
        }

        if (planId) {
          const trialDays = parseInt(process.env.TRIAL_DAYS) || 14;
          await db.Subscription.create(
            {
              organizationId: newOrg.id,
              planId: planId,
              status: 'trial',
              billingCycle: 'monthly',
              trialEndsAt: new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000),
              currentPeriodStart: new Date(),
              currentPeriodEnd: new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000),
            },
            { transaction: t }
          );
        }
      }

      return user;
    });

    // Loga o novo usuario
    req.session.loggedIn = true;
    req.session.userId = newUser.id;
    req.session.username = newUser.username;
    req.session.role = newUser.role;
    req.session.organizationId = newUser.organizationId;

    req.session.save((err) => {
      if (err) {
        console.error("Erro ao salvar a sessão após o registro:", err);
        return res.redirect(
          "/login?success=Conta criada com sucesso! Faça o login."
        );
      }
      res.redirect("/dashboard");
    });
  } catch (err) {
    console.error("Erro no registro (transação):", err);

    let errorMsg = "Erro ao criar conta. Tente novamente.";
    if (err.name === "SequelizeUniqueConstraintError") {
      const errorPath = err.errors[0].path;
      if (errorPath.includes("slug")) {
        errorMsg = "Este nome de salão já está em uso. Tente outro.";
      } else if (errorPath.includes("email")) {
        errorMsg = "Este e-mail já está em uso.";
      } else if (errorPath.includes("username")) {
        errorMsg = "Este nome de usuário já está em uso para este salão.";
      }
    }
    res.render("register", { error: errorMsg, selectedPlan });
  }
};

// --- Logout ---
// (Sem alterações)
exports.getLogout = (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Erro ao fazer logout:", err);

      return res.redirect("/login");
    }
    res.clearCookie("connect.sid");

    res.redirect("/login");
  });
};

// --- Rota Raiz ---
// (Sem alterações)
exports.getRoot = (req, res) => {
  res.redirect("/dashboard");
};

// --- FUNÇÕES DE REDEFINIÇÃO DE SENHA ---
// (Sem alterações)
exports.getForgotPassword = (req, res) => {
  res.render("forgot-password", { error: null, success: null });
};

exports.postForgotPassword = async (req, res) => {
  try {
    const token = crypto.randomBytes(20).toString("hex");

    const user = await db.User.findOne({
      where: { email: req.body.email.toLowerCase() },
    });

    if (!user) {
      return res.render("forgot-password", {
        error: null,
        success:
          "Se um e-mail válido foi fornecido, um link de redefinição foi enviado. Verifique sua caixa de spam.",
      });
    }
    user.resetToken = token;
    user.resetTokenExpires = Date.now() + 3600000;

    await user.save();

    await mailer.sendPasswordResetEmail(user.email, token, req.headers.host);
    return res.render("forgot-password", {
      error: null,
      success:
        "Se um e-mail válido foi fornecido, um link de redefinição foi enviado. Verifique sua caixa de spam.",
    });
  } catch (err) {
    console.error("Erro em postForgotPassword:", err);
    res.render("forgot-password", {
      error: "Erro ao processar sua solicitação. Tente novamente.",
      success: null,
    });
  }
};

exports.getReset = async (req, res) => {
  try {
    const { token } = req.params;

    const user = await db.User.findOne({
      where: {
        resetToken: token,
        resetTokenExpires: { [Op.gt]: Date.now() },
      },
    });

    if (!user) {
      return res.redirect(
        "/login?error=Token de redefinição inválido ou expirado."
      );
    }
    res.render("reset-password", { error: null, token: token });
  } catch (err) {
    console.error("Erro em getReset:", err);
    res.redirect("/login?error=Erro ao processar o token.");
  }
};

exports.postReset = async (req, res) => {
  try {
    const { token } = req.params;
    const { password, passwordConfirm } = req.body;
    if (password !== passwordConfirm) {
      return res.render("reset-password", {
        error: "As senhas não coincidem.",
        token: token,
      });
    }
    if (password.length < 6) {
      return res.render("reset-password", {
        error: "A senha deve ter pelo menos 6 caracteres.",
        token: token,
      });
    }

    const user = await db.User.findOne({
      where: {
        resetToken: token,
        resetTokenExpires: { [Op.gt]: Date.now() },
      },
    });

    if (!user) {
      return res.redirect(
        "/login?error=Token de redefinição inválido ou expirado."
      );
    }

    user.password = password;
    user.resetToken = null;
    user.resetTokenExpires = null;

    await user.save();

    req.session.destroy(() => {
      res.redirect(
        "/login?success=Senha redefinida com sucesso! Você já pode entrar."
      );
    });
  } catch (err) {
    console.error("Erro em postReset:", err);
    res.render("reset-password", {
      error: "Erro ao salvar sua nova senha.",
      token: token,
    });
  }
};