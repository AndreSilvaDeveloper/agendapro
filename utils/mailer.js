// utils/mailer.js
const nodemailer = require('nodemailer');

// --- MUDANÇA (Início) ---
// Detecta o ambiente para definir o protocolo (http ou https)
// Em produção (Render), usará 'https'
const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
// --- MUDANÇA (Fim) ---

// Configura o "transportador" de e-mail usando as variáveis de ambiente
// Esta parte do seu código já estava correta!
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: process.env.EMAIL_SECURE === 'true', // true para porta 465
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

/**
 * Envia um e-mail de redefinição de senha.
 * @param {string} to - O e-mail do destinatário.
 * @param {string} token - O token de redefinição.
 * @param {string} host - O host da aplicação (ex: agendapro-y3aq.onrender.com)
 */
exports.sendPasswordResetEmail = async (to, token, host) => {
  // --- MUDANÇA (Início) ---
  // Usa a variável 'protocol' que definimos lá em cima
  const resetUrl = `${protocol}://${host}/reset/${token}`;
  // --- MUDANÇA (Fim) ---

  const mailOptions = {
    // Recomendado mudar o 'from' para ser seu e-mail real para evitar spam
    from: `"AgendaPro" <${process.env.EMAIL_FROM || process.env.EMAIL_USER}>`,
    to: to,
    subject: 'Redefinição de Senha – AgendaPro',
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6;">
        <h2 style="color: #B8860B;">Redefinição de Senha</h2>
        <p>Você solicitou uma redefinição de senha para sua conta no sistema Studio Kadosh.</p>
        <p>Por favor, clique no link abaixo para criar uma nova senha:</p>
        <p style="text-align: center; margin: 25px 0;">
          <a href="${resetUrl}" 
             style="background-color: #DAA520; color: white; padding: 12px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">
            Redefinir Minha Senha
          </a>
        </p>
        <p>Se você não solicitou isso, por favor, ignore este e-mail.</p>
        <p>Este link expirará em 1 hora.</p>
        <hr>
        <p style="font-size: 0.9em; color: #777;">
          Link direto (se o botão não funcionar): <br>
          <a href="${resetUrl}">${resetUrl}</a>
        </p>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`E-mail de redefinição enviado para ${to}`);
  } catch (error) {
    // O console.error mostrará o erro completo nos logs do Render
    console.error('Erro ao enviar e-mail:', error);
    throw new Error('Não foi possível enviar o e-mail de redefinição.');
  }
};