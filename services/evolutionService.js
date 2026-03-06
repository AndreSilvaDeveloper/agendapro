// services/evolutionService.js
// Gerencia instancias da Evolution API por organizacao

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'https://wa.bellory.com.br';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;

const headers = () => ({
  'Content-Type': 'application/json',
  'apikey': EVOLUTION_API_KEY
});

// Gera nome unico para instancia baseado no org
const instanceName = (orgId, orgSlug) => {
  return `agendapro-${orgSlug || orgId}`;
};

// Criar instancia
const createInstance = async (name, webhookUrl) => {
  const res = await fetch(`${EVOLUTION_API_URL}/instance/create`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      instanceName: name,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
      webhook: {
        url: webhookUrl,
        byEvents: false,
        base64: false,
        events: ['MESSAGES_UPSERT']
      }
    })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error('Erro ao criar instancia: ' + text);
  }
  return await res.json();
};

// Buscar QR Code
const getQrCode = async (name) => {
  const res = await fetch(`${EVOLUTION_API_URL}/instance/connect/${name}`, {
    method: 'GET',
    headers: headers()
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error('Erro ao buscar QR: ' + text);
  }
  return await res.json();
};

// Status da conexao
const getConnectionStatus = async (name) => {
  try {
    const res = await fetch(`${EVOLUTION_API_URL}/instance/connectionState/${name}`, {
      method: 'GET',
      headers: headers()
    });
    if (!res.ok) return { state: 'close' };
    const data = await res.json();
    return data.instance || data;
  } catch {
    return { state: 'close' };
  }
};

// Desconectar (logout)
const logoutInstance = async (name) => {
  const res = await fetch(`${EVOLUTION_API_URL}/instance/logout/${name}`, {
    method: 'DELETE',
    headers: headers()
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error('Erro ao desconectar: ' + text);
  }
  return await res.json();
};

// Deletar instancia
const deleteInstance = async (name) => {
  const res = await fetch(`${EVOLUTION_API_URL}/instance/delete/${name}`, {
    method: 'DELETE',
    headers: headers()
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error('Erro ao deletar instancia: ' + text);
  }
  return await res.json();
};

// Enviar mensagem de texto
const sendText = async (name, phone, message) => {
  const res = await fetch(`${EVOLUTION_API_URL}/message/sendText/${name}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ number: phone, text: message })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error('Erro ao enviar: ' + text);
  }
  return await res.json();
};

// Configurar webhook da instancia
const setWebhook = async (name, webhookUrl) => {
  const res = await fetch(`${EVOLUTION_API_URL}/webhook/set/${name}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      webhook: {
        enabled: true,
        url: webhookUrl,
        byEvents: false,
        base64: false,
        events: ['MESSAGES_UPSERT']
      }
    })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error('Erro ao configurar webhook: ' + text);
  }
  return await res.json();
};

// Verificar se instancia existe
const instanceExists = async (name) => {
  try {
    const res = await fetch(`${EVOLUTION_API_URL}/instance/fetchInstances`, {
      method: 'GET',
      headers: headers()
    });
    if (!res.ok) return false;
    const instances = await res.json();
    return instances.some(i => i.name === name);
  } catch {
    return false;
  }
};

module.exports = {
  instanceName,
  createInstance,
  getQrCode,
  getConnectionStatus,
  logoutInstance,
  deleteInstance,
  sendText,
  setWebhook,
  instanceExists,
  EVOLUTION_API_URL
};
