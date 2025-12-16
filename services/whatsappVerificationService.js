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
    // Obtener todas las conexiones activas (sin importar la fase, solo verifica, no envía mensajes)
    const conexionesActivas = await getConexionesActivas();
    
    let client = null;
    let whatsappId = null;

    // Importar whatsappController una vez
    const whatsappController = (await import('../controllers/whatsappController.js')).default;

    // Buscar cualquier conexión activa con socket listo (sin importar la fase)
    for (const conexion of conexionesActivas) {
      const socket = conexionesService.getSocketByWhatsAppId(conexion.whatsapp_id);
      if (socket) {
        try {
          const status = await whatsappController.getStatus(conexion.whatsapp_id);
          
          if (status.ready) {
            client = socket;
            whatsappId = conexion.whatsapp_id;
            console.log(`✅ Usando conexión ${whatsappId} (fase ${conexion.fase_actual || 'N/A'}) para verificar números`);
            break;
          }
        } catch (e) {
          console.error(`Error verificando conexión ${conexion.whatsapp_id}:`, e.message);
          // Continuar con la siguiente conexión
          continue;
        }
      }
    }

    if (!client) {
      // Intentar obtener más información para debugging
      console.log(`❌ No se encontró cliente disponible. Información de debugging:`);
      console.log(`   - Conexiones en BD: ${conexionesActivas.length}`);
      for (const conexion of conexionesActivas) {
        const socket = conexionesService.getSocketByWhatsAppId(conexion.whatsapp_id);
        console.log(`   - ${conexion.whatsapp_id}: socket=${socket ? '✅' : '❌'}`);
        if (socket) {
          try {
            const status = await whatsappController.getStatus(conexion.whatsapp_id);
            console.log(`     Estado: ready=${status.ready}, message=${status.message}`);
          } catch (e) {
            console.log(`     Error obteniendo estado: ${e.message}`);
          }
        }
      }
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
   * Usa cualquier conexión activa, sin importar la fase (solo verifica, no envía mensajes)
   */
  async isAvailable() {
    try {
      // Obtener todas las conexiones activas (sin importar la fase)
      const conexionesActivas = await getConexionesActivas();
      
      console.log(`🔍 Verificando disponibilidad: ${conexionesActivas.length} conexión(es) activa(s) en BD`);
      
      if (conexionesActivas.length === 0) {
        console.log(`❌ No hay conexiones activas en la base de datos`);
        return false;
      }
      
      // Obtener todos los sockets registrados para debugging
      const whatsappController = (await import('../controllers/whatsappController.js')).default;
      
      for (const conexion of conexionesActivas) {
        console.log(`🔍 Verificando conexión: ${conexion.whatsapp_id} (fase ${conexion.fase_actual || 'N/A'})`);
        
        // Intentar obtener socket con el whatsapp_id de la BD
        let socket = conexionesService.getSocketByWhatsAppId(conexion.whatsapp_id);
        
        if (!socket) {
          console.log(`   ⚠️  No se encontró socket registrado para ${conexion.whatsapp_id}`);
          // Continuar con la siguiente conexión
          continue;
        }
        
        console.log(`   ✅ Socket encontrado para ${conexion.whatsapp_id}`);
        
        try {
          const status = await whatsappController.getStatus(conexion.whatsapp_id);
          console.log(`   📊 Estado: ready=${status.ready}, message=${status.message}`);
          
          if (status.ready) {
            console.log(`✅ Conexión disponible para verificación: ${conexion.whatsapp_id} (fase ${conexion.fase_actual || 'N/A'})`);
            return true;
          } else {
            console.log(`   ⚠️  Conexión ${conexion.whatsapp_id} no está lista: ${status.message}`);
          }
        } catch (e) {
          console.error(`   ❌ Error verificando estado de ${conexion.whatsapp_id}:`, e.message);
          continue;
        }
      }
      
      console.log(`❌ No hay conexiones activas disponibles para verificación`);
      console.log(`💡 Asegúrate de que:`);
      console.log(`   1. El número esté conectado y el QR haya sido escaneado`);
      console.log(`   2. El cliente esté en estado 'ready'`);
      console.log(`   3. El socket esté registrado correctamente`);
      
      return false;
    } catch (error) {
      console.error(`❌ Error verificando disponibilidad:`, error.message);
      console.error(error.stack);
      return false;
    }
  }
}

// Exportar instancia singleton
export default new WhatsAppVerificationService();
