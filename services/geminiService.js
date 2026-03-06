// services/geminiService.js
// Integração com Google Gemini para o bot WhatsApp

const { GoogleGenerativeAI } = require('@google/generative-ai');

let GEMINI_API_KEY = process.env.GEMINI_API_KEY;
let genAI = null;

const MODELS = ['gemini-2.5-flash', 'gemini-2.5-pro'];


const getGenAI = () => {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY nao configurada no .env');
  if (!genAI) genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  return genAI;
};

// Definicao das ferramentas que o Gemini pode chamar
const tools = [{
  functionDeclarations: [
    {
      name: 'listar_servicos',
      description: 'Lista todos os servicos disponiveis do salao com precos e duracao',
      parameters: { type: 'OBJECT', properties: {}, required: [] }
    },
    {
      name: 'listar_profissionais',
      description: 'Lista os profissionais disponiveis para um servico especifico',
      parameters: {
        type: 'OBJECT',
        properties: {
          serviceId: { type: 'NUMBER', description: 'ID do servico' }
        },
        required: ['serviceId']
      }
    },
    {
      name: 'ver_datas_disponiveis',
      description: 'Mostra as proximas datas disponiveis para um profissional',
      parameters: {
        type: 'OBJECT',
        properties: {
          staffId: { type: 'NUMBER', description: 'ID do profissional' }
        },
        required: ['staffId']
      }
    },
    {
      name: 'ver_horarios_disponiveis',
      description: 'Mostra horarios disponiveis para um profissional em uma data especifica',
      parameters: {
        type: 'OBJECT',
        properties: {
          staffId: { type: 'NUMBER', description: 'ID do profissional' },
          serviceId: { type: 'NUMBER', description: 'ID do servico' },
          date: { type: 'STRING', description: 'Data no formato YYYY-MM-DD' }
        },
        required: ['staffId', 'serviceId', 'date']
      }
    },
    {
      name: 'criar_agendamento',
      description: 'Cria um novo agendamento para o cliente. Só use após o cliente CONFIRMAR explicitamente todos os dados (servico, profissional, data e horario)',
      parameters: {
        type: 'OBJECT',
        properties: {
          serviceId: { type: 'NUMBER', description: 'ID do servico' },
          staffId: { type: 'NUMBER', description: 'ID do profissional' },
          date: { type: 'STRING', description: 'Data no formato YYYY-MM-DD' },
          time: { type: 'STRING', description: 'Horario no formato HH:mm' }
        },
        required: ['serviceId', 'staffId', 'date', 'time']
      }
    },
    {
      name: 'meus_agendamentos',
      description: 'Lista os proximos agendamentos do cliente',
      parameters: { type: 'OBJECT', properties: {}, required: [] }
    },
    {
      name: 'cancelar_agendamento',
      description: 'Cancela um agendamento do cliente. Só use após o cliente CONFIRMAR que deseja cancelar',
      parameters: {
        type: 'OBJECT',
        properties: {
          appointmentId: { type: 'NUMBER', description: 'ID do agendamento a cancelar' }
        },
        required: ['appointmentId']
      }
    }
  ]
}];

const buildSystemPrompt = (org, clientName) => {
  const now = new Date();
  const dateStr = now.toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Sao_Paulo' });
  const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

  return `Voce e a assistente virtual do salao "${org.name}" no WhatsApp. Seu nome e Lia.

DATA E HORA ATUAL: ${dateStr}, ${timeStr}. Use SEMPRE o ano 2026 para datas.

COMO VOCE DEVE SE COMPORTAR:
Voce conversa como uma pessoa real, nao como um robo. Imagine que voce e a recepcionista do salao, batendo papo pelo WhatsApp com as clientes. Voce e calorosa, divertida e faz as pessoas se sentirem bem-vindas. Voce fala de um jeito natural e informal, mas sem perder o profissionalismo.

REGRAS ESSENCIAIS:
- Fale de forma curta e natural. Nada de textao. Mensagens curtas como numa conversa real de WhatsApp
- Trate o cliente pelo PRIMEIRO nome apenas
- Use no maximo 1-2 emojis por mensagem, e so quando fizer sentido
- NUNCA use palavras roboticas: "processando", "solicitacao", "registrado", "selecionado", "opcao", "disponivel para ajudar"
- NUNCA faca listas enormes. Se tiver muitos horarios, agrupe (ex: "De manha tem das 8h as 11h, e a tarde das 13h as 17h. Qual horario te agrada?")
- NUNCA invente dados. Use SEMPRE as ferramentas para consultar antes de responder
- SEMPRE consulte as ferramentas, mesmo que o cliente informe tudo de uma vez
- Peca confirmacao antes de criar agendamento, mas de forma natural (ex: "Bora confirmar entao? Escova com a Samara, amanha as 15h")
- Quando o cliente confirmar (ex: "sim", "pode ser", "bora", "isso"), chame IMEDIATAMENTE a ferramenta criar_agendamento. NAO peca confirmacao duas vezes.
- Apos criar o agendamento, diga que o profissional vai confirmar em breve
- Formate precos como R$ X,XX
- Se o cliente mandar so "oi", responda de forma curta e acolhedora, sem listar tudo que voce faz

${clientName ? `O cliente se chama ${clientName.split(' ')[0]}.` : ''}

EXEMPLOS DE COMO FALAR (siga esse estilo):
- "Oi ${clientName ? clientName.split(' ')[0] : ''}! Tudo bem? O que voce precisa hoje? 😊"
- "A Escova ta R$ 45,00 e leva mais ou menos 1 hora. Quer agendar?"
- "Com a Samara, certo! Quando seria bom pra voce?"
- "Amanha a tarde tem horario das 13h as 17h. Qual te agrada mais?"
- "Prontinho! Ja mandei pra Samara confirmar. Assim que ela responder, te aviso!"
- "Ah que bom que deu certo! Te espero la 💇‍♀️"

EXEMPLOS DE COMO NAO FALAR (nunca fale assim):
- "Claro! Estou aqui para ajudá-lo. Aqui estão os serviços disponíveis:"
- "Agendamento criado com sucesso! Seu agendamento #12 foi registrado."
- "Selecione uma das opções abaixo:"
- "Posso ajudá-lo com mais alguma coisa?"`;


};

// Helper: delay em ms
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Envia mensagem para o Gemini e processa function calls
const chat = async (history, userMessage, org, clientName, executeTool) => {
  const ai = getGenAI();
  const systemInstruction = buildSystemPrompt(org, clientName);

  let result, response;

  // Tentar cada modelo com retry para 503
  for (const modelName of MODELS) {
    try {
      console.log(`[Gemini] Tentando modelo: ${modelName}`);
      const model = ai.getGenerativeModel({ model: modelName, systemInstruction });
      const chatSession = model.startChat({ history, tools });

      // Retry ate 2x para erros 503
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          result = await chatSession.sendMessage(userMessage);
          response = result.response;
          break;
        } catch (retryErr) {
          if (retryErr.message && retryErr.message.includes('503') && attempt === 0) {
            console.log(`[Gemini] 503 no ${modelName}, retentando em 3s...`);
            await delay(3000);
            continue;
          }
          throw retryErr;
        }
      }

      // Se chegou aqui, deu certo - continuar com function calling usando este chatSession
      console.log(`[Gemini] Usando modelo: ${modelName}`);
      return await processFunctionCalls(chatSession, response, executeTool);
    } catch (err) {
      console.log(`[Gemini] Erro no ${modelName}: ${err.message}`);
      if (modelName === MODELS[MODELS.length - 1]) throw err;
      console.log('[Gemini] Tentando proximo modelo...');
    }
  }
};

// Processa function calls e retorna resultado final
const processFunctionCalls = async (chatSession, response, executeTool) => {

  let maxCalls = 5;
  while (response.candidates[0].content.parts.some(p => p.functionCall) && maxCalls > 0) {
    maxCalls--;
    const functionCalls = response.candidates[0].content.parts.filter(p => p.functionCall);
    const functionResponses = [];

    for (const fc of functionCalls) {
      console.log('[Gemini] Tool call:', fc.functionCall.name, JSON.stringify(fc.functionCall.args));
      const toolResult = await executeTool(fc.functionCall.name, fc.functionCall.args || {});
      functionResponses.push({
        functionResponse: {
          name: fc.functionCall.name,
          response: { result: toolResult }
        }
      });
    }

    const result = await chatSession.sendMessage(functionResponses);
    response = result.response;
  }

  const text = response.candidates[0].content.parts
    .filter(p => p.text)
    .map(p => p.text)
    .join('\n');

  const updatedHistory = await chatSession.getHistory();
  return { text, history: updatedHistory };
};

module.exports = { chat, tools };
