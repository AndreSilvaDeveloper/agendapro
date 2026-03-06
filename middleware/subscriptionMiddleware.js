// middleware/subscriptionMiddleware.js
// Verifica se a organizacao tem uma assinatura valida
// Bloqueia acesso se expirada/cancelada, redireciona para pagina de assinatura

const db = require('../models');

async function checkSubscription(req, res, next) {
  // Superadmin passa sempre
  if (req.session.role === 'superadmin') return next();

  // Se esta impersonando, passa
  if (req.session.originalAdminSession) return next();

  // Se nao tem organizationId, o authMiddleware ja trata
  if (!req.session.organizationId) return next();

  try {
    const subscription = await db.Subscription.findOne({
      where: { organizationId: req.session.organizationId },
      include: [{ model: db.Plan, attributes: ['name', 'slug', 'price'] }]
    });

    // Sem assinatura = plano gratuito, deixa passar
    if (!subscription) {
      res.locals.subscription = null;
      res.locals.planName = 'Sem plano';
      return next();
    }

    const sub = subscription.toJSON();
    res.locals.subscription = sub;
    res.locals.planName = sub.Plan ? sub.Plan.name : 'Sem plano';

    // Calcular alerta de vencimento para exibir em todas as paginas
    const now = new Date();
    if (sub.status === 'trial' && sub.trialEndsAt) {
      const diff = Math.ceil((new Date(sub.trialEndsAt) - now) / (1000 * 60 * 60 * 24));
      if (diff >= 0 && diff <= 7) {
        res.locals.daysAlert = { type: 'trial', days: diff };
      }
    } else if (sub.status === 'active' && sub.currentPeriodEnd) {
      const diff = Math.ceil((new Date(sub.currentPeriodEnd) - now) / (1000 * 60 * 60 * 24));
      if (diff >= 0 && diff <= 7) {
        res.locals.daysAlert = { type: 'invoice', days: diff };
      }
    }

    // Trial expirado?
    if (sub.status === 'trial' && sub.trialEndsAt && new Date(sub.trialEndsAt) < new Date()) {
      // Plano gratuito nao expira
      if (sub.Plan && parseFloat(sub.Plan.price) === 0) {
        return next();
      }

      await subscription.update({ status: 'expired' });

      // Bloqueia users da org
      await db.User.update(
        { isBlocked: true },
        { where: { organizationId: req.session.organizationId } }
      );

      return res.redirect('/admin/assinatura?expired=trial');
    }

    // Status que bloqueiam acesso
    if (['canceled', 'expired', 'past_due'].includes(sub.status)) {
      // Permite acessar a pagina de assinatura para regularizar
      if (req.path === '/admin/assinatura' || req.path.startsWith('/api/billing')) {
        return next();
      }
      return res.redirect('/admin/assinatura?blocked=true');
    }

    return next();
  } catch (err) {
    console.error('Erro no middleware de assinatura:', err);
    return next(); // Em caso de erro, nao bloqueia
  }
}

module.exports = checkSubscription;
