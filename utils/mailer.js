// utils/mailer.js
const nodemailer = require('nodemailer');

const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';

function buildTransporter() {
  const port = Number(process.env.EMAIL_PORT) || 587;
  const secure = String(process.env.EMAIL_SECURE).toLowerCase() === 'true';

  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port,                       // 587 recomendado
    secure,                     // false para 587 (STARTTLS)
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    requireTLS: !secure,        // força STARTTLS quando não é 465
    tls: { minVersion: 'TLSv1.2' },
    connectionTimeout: 20000,   // evita travar indefinidamente
    socketTimeout: 20000,
    pool: true,
    maxConnections: 3,
    maxMessages: 50
  });
}
const transporter = buildTransporter();

exports.sendPasswordResetEmail = async (to, token, host) => {
  const resetUrl = `${protocol}://${host}/reset/${token}`;

  const mailOptions = {
    from: `"AgendaPro" <${process.env.EMAIL_FROM || process.env.EMAIL_USER}>`,
    to,
    subject: 'Redefinição de Senha – AgendaPro',
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6;">
        <h2 style="color: #B8860B;">Redefinição de Senha</h2>
        <p>Você solicitou uma redefinição de senha para sua conta no sistema Studio Kadosh.</p>
        <p>Clique abaixo para criar uma nova senha:</p>
        <p style="text-align:center;margin:25px 0;">
          <a href="${resetUrl}" style="background:#DAA520;color:#fff;padding:12px 20px;text-decoration:none;border-radius:5px;font-weight:bold;">
            Redefinir Minha Senha
          </a>
        </p>
        <p>Se você não solicitou, ignore este e-mail. O link expira em 1 hora.</p>
        <hr>
        <p style="font-size:.9em;color:#777">Link direto: <a href="${resetUrl}">${resetUrl}</a></p>
      </div>
    `,
  };

  try {
    // Checa conexão/config antes do envio (aparece nos logs do Render)
    await transporter.verify();
    await transporter.sendMail(mailOptions);
    console.log(`E-mail de redefinição enviado para ${to}`);
  } catch (error) {
    console.error('Erro ao enviar e-mail:', error);
    throw new Error('Não foi possível enviar o e-mail de redefinição.');
  }
};
