import conexionesService from './conexionesService.js';
import { getConexionesActivas } from '../models/conexionesModel.js';

/**
 * Servicio para verificar números de WhatsApp usando whatsapp-web.js
 * Verifica sin enviar mensajes, solo consulta si el número existe
 */
class WhatsAppVerificationService {
  /**
   * Verifica si un número está registrado en WhatsApp
   * @param {string} phoneNumber - Número de teléfono a verificar (formato: 521234567890)
   * @returns {Promise<boolean>} - true si está registrado, false si no
   */
  async verifyNumber(phoneNumber) {
    // Obtener una conexión activa disponible
    const conexionesActivas = await getConexionesActivas();
    
    let client = null;
    let whatsappId = null;

    // Buscar una conexión activa con socket listo
    for (const conexion of conexionesActivas) {
      const socket = conexionesService.getSocketByWhatsAppId(conexion.whatsapp_id);
      if (socket) {
        try {
          // Importar whatsappController dinámicamente para evitar dependencias circulares
          const whatsappController = (await import('../controllers/whatsappController.js')).default;
          const status = await whatsappController.getStatus(conexion.whatsapp_id);
          
          if (status.ready) {
            client = socket;
            whatsappId = conexion.whatsapp_id;
            break;
          }
        } catch (e) {
          // Continuar con la siguiente conexión
          continue;
        }
      }
    }

    if (!client) {
      throw new Error('No hay conexión activa de WhatsApp disponible para verificar números');
    }

    // Formatear número para WhatsApp (agregar @c.us si no lo tiene)
    const chatId = phoneNumber.includes('@c.us') ? phoneNumber : `${phoneNumber}@c.us`;

    try {
      // Método 1: Intentar usar isRegisteredUser (método más directo)
      if (typeof client.isRegisteredUser === 'function') {
        const isRegistered = await client.isRegisteredUser(chatId);
        return isRegistered;
      }

      // Método 2: Usar getNumberId (retorna null si no está registrado)
      if (typeof client.getNumberId === 'function') {
        const numberId = await client.getNumberId(chatId);
        return numberId !== null;
      }

      // Método 3: Intentar obtener información del contacto (sin enviar mensaje)
      // Esto es seguro porque getContactById solo consulta información, no envía nada
      try {
        const contact = await client.getContactById(chatId);
        // Si el contacto existe y es un usuario, está registrado
        return contact !== null && (contact.isUser === true || contact.isUser === undefined);
      } catch (contactError) {
        // Si falla con "No LID for user" o similar, el número no está registrado
        const errorMessage = contactError.message || contactError.toString();
        if (errorMessage.includes('No LID for user') || 
            errorMessage.includes('not registered') ||
            errorMessage.includes('not found')) {
          return false;
        }
        // Para otros errores, asumir que no está registrado
        return false;
      }
    } catch (error) {
      // Detectar errores específicos
      const errorMessage = error.message || error.toString();
      if (errorMessage.includes('No LID for user') || 
          errorMessage.includes('not registered') ||
          errorMessage.includes('not found')) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Verifica múltiples números en lote
   * @param {string[]} phoneNumbers - Array de números a verificar
   * @returns {Promise<Map<string, boolean>>} - Mapa de número -> está registrado
   */
  async verifyBatch(phoneNumbers) {
    const results = new Map();
    
    // Verificar en lotes pequeños para no sobrecargar
    const batchSize = 5;
    for (let i = 0; i < phoneNumbers.length; i += batchSize) {
      const batch = phoneNumbers.slice(i, i + batchSize);
      
      // Verificar cada número del lote
      for (const phone of batch) {
        try {
          const isValid = await this.verifyNumber(phone);
          results.set(phone, isValid);
          
          // Delay para evitar rate limiting
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
          console.error(`Error verificando ${phone}:`, error.message);
          results.set(phone, true); // En caso de error, aceptar el número
        }
      }
      
      // Delay entre lotes
      if (i + batchSize < phoneNumbers.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    return results;
  }

  /**
   * Verifica si hay una conexión disponible para verificar
   */
  async isAvailable() {
    try {
      const conexionesActivas = await getConexionesActivas();
      
      for (const conexion of conexionesActivas) {
        const socket = conexionesService.getSocketByWhatsAppId(conexion.whatsapp_id);
        if (socket) {
          try {
            const whatsappController = (await import('../controllers/whatsappController.js')).default;
            const status = await whatsappController.getStatus(conexion.whatsapp_id);
            if (status.ready) {
              return true;
            }
          } catch (e) {
            continue;
          }
        }
      }
      return false;
    } catch (error) {
      return false;
    }
  }
}

// Exportar instancia singleton
export default new WhatsAppVerificationService();
