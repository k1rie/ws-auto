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
 * Formatea número para WhatsApp (agrega @c.us si no lo tiene)
 */
export function formatForWhatsApp(phone) {
  const formatted = formatPhoneNumber(phone);
  if (!formatted) {
    return null;
  }

  // Si ya incluye @c.us, retornarlo tal cual
  if (formatted.includes('@c.us')) {
    return formatted;
  }

  // Agregar @c.us
  return `${formatted}@c.us`;
}

