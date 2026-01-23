/**
 * Normaliza números mexicanos agregando el "1" después del "52" si falta
 * Formato correcto: 521XXXXXXXXXX (12 dígitos)
 */
function normalizeMexicanPhone(cleaned) {
  // Si el número empieza con "52" y tiene 11 dígitos (52 + 10 dígitos sin el 1)
  if (cleaned.startsWith('52') && cleaned.length === 11) {
    // Agregar el "1" después del "52"
    return '521' + cleaned.substring(2);
  }
  
  // Si el número empieza con "52" y tiene 12 dígitos pero el tercer dígito no es "1"
  if (cleaned.startsWith('52') && cleaned.length === 12 && cleaned[2] !== '1') {
    // Agregar el "1" después del "52"
    return '521' + cleaned.substring(2);
  }
  
  return cleaned;
}

/**
 * Formatea un número de teléfono para WhatsApp
 * Acepta diferentes formatos y los normaliza
 */
export function formatPhoneNumber(phone) {
  if (!phone) {
    return null;
  }

  // Remover todos los caracteres no numéricos
  let cleaned = phone.toString().replace(/\D/g, '');

  // Si está vacío después de limpiar, retornar null
  if (!cleaned) {
    return null;
  }

  // Normalizar números mexicanos (agregar "1" después de "52" si falta)
  cleaned = normalizeMexicanPhone(cleaned);

  // Si el número ya incluye el código de país (más de 10 dígitos), retornarlo
  if (cleaned.length >= 10) {
    return cleaned;
  }

  // Si tiene menos de 10 dígitos, podría ser un número local
  // En este caso, asumimos que necesita código de país
  // Por defecto, si no tiene código de país, retornamos el número limpio
  return cleaned;
}

/**
 * Valida si un número de teléfono es válido
 */
export function isValidPhoneNumber(phone) {
  if (!phone) {
    return false;
  }

  // Convertir a string y limpiar
  const phoneStr = phone.toString().trim();
  if (!phoneStr || phoneStr === '') {
    return false;
  }

  // Remover todos los caracteres no numéricos
  const cleaned = phoneStr.replace(/\D/g, '');
  
  if (!cleaned || cleaned === '') {
    return false;
  }

  // Un número válido debe tener al menos 10 dígitos
  // (números internacionales pueden tener más)
  return cleaned.length >= 10;
}

/**
 * Formatea número para WhatsApp (agrega @s.whatsapp.net para Baileys)
 * Baileys usa @s.whatsapp.net en lugar de @c.us
 */
export function formatForWhatsApp(phone) {
  const formatted = formatPhoneNumber(phone);
  if (!formatted) {
    return null;
  }

  // Si ya incluye @s.whatsapp.net o @c.us, convertir a formato Baileys
  if (formatted.includes('@s.whatsapp.net')) {
    return formatted;
  }
  
  if (formatted.includes('@c.us')) {
    // Convertir de formato antiguo a nuevo
    return formatted.replace('@c.us', '@s.whatsapp.net');
  }

  // Agregar @s.whatsapp.net (formato Baileys)
  return `${formatted}@s.whatsapp.net`;
}

