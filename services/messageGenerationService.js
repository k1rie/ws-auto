import dotenv from 'dotenv';
import OpenAI from 'openai';
import { getGuideText } from './guideService.js';

dotenv.config();

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

function getClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY no está configurada');
  }
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });
}

function buildPrompt(guide, contacto) {
  const nombre = [contacto.firstname, contacto.lastname].filter(Boolean).join(' ').trim() || 'contacto';
  const telefono = contacto.phone || 'sin teléfono';

  return [
    'Usa la siguiente guía para redactar un mensaje de WhatsApp personalizado.',
    'Debes mantener un tono profesional, breve y accionable.',
    'Evita emojis y mensajes demasiado largos.',
    '',
    '--- GUÍA ---',
    guide,
    '------------',
    '',
    'Información del contacto:',
    `- Nombre: ${nombre}`,
    `- Teléfono: ${telefono}`,
    '',
    'Genera solo el cuerpo del mensaje listo para enviar por WhatsApp.'
  ].join('\n');
}

export async function generateMessageForContact(contacto, sharedGuide = null) {
  try {
    const guide = sharedGuide || await getGuideText();
    const client = getClient();
    const prompt = buildPrompt(guide, contacto);

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.7,
      max_tokens: 200,
      messages: [
        {
          role: 'system',
          content: 'Eres un asistente experto en ventas B2B que genera mensajes de WhatsApp concisos y claros.'
        },
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    const mensaje = completion.choices?.[0]?.message?.content?.trim();
    if (!mensaje) {
      throw new Error('La IA no devolvió contenido');
    }

    return mensaje;
  } catch (error) {
    console.error('Error generando mensaje con IA:', error.message);
    // Fallback simple para no bloquear el flujo
    const nombre = [contacto.firstname, contacto.lastname].filter(Boolean).join(' ').trim() || 'Hola';
    return `${nombre}, soy parte del equipo de ventas. Me gustaría compartirte una propuesta de valor y agendar una llamada rápida para explicarte cómo podemos ayudar.`;
  }
}

export default {
  generateMessageForContact
};
