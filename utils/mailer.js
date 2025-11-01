// utils/mailer.js
const nodemailer = require('nodemailer');

const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';

function buildTransporter() {
  const port = Number(process.env.EMAIL_PORT) || 587;
  const secure = String(process.env.EMAIL_SECURE).toLowerCase() === 'true';

  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port,                // 587 recomendado
    secure,              // false para 587 (STARTTLS); true só se usar 465
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    requireTLS: !secure, // força STARTTLS quando não for SSL direto
    tls: { minVersion: 'TLSv1.2' },
    connectionTimeout: 20000,
    socketTimeout: 20000,
    pool: true,          // opcional: reusa conexões
    maxConnections: 3,
    maxMessages: 50
  });
}

const transporter = buildTransporter();

exports.sendPasswordResetEmail = async (to, token, host) => {
  const resetUrl = `${protocol}://${host}/reset/${token}`;

  const mailOptions = {
    from: `"AgendaPro" <${process.env.EMAIL_FROM || process.env.EMAIL_USER}>`,
    to: to,
    subject: 'Redefinição de Senha – AgendaPro',
    html: /* igual ao seu */,
  };

  try {
    // opcional: verificação explícita antes de enviar
    await transporter.verify();
    await transporter.sendMail(mailOptions);
    console.log(`E-mail de redefinição enviado para ${to}`);
  } catch (err) {
    console.error('Erro ao enviar e-mail:', err);
    throw new Error('Não foi possível enviar o e-mail de redefinição.');
  }
};
