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

    // Importar baileysController una vez
    const baileysController = (await import('../controllers/baileysController.js')).default;

    // Buscar cualquier conexión activa con socket listo (sin importar la fase)
    for (const conexion of conexionesActivas) {
      const socket = conexionesService.getSocketByWhatsAppId(conexion.whatsapp_id);
      if (socket) {
        try {
          // Verificar directamente con el socket si está listo
          let isReady = false;
          try {
            // Baileys usa socket.user en lugar de socket.info
            const user = socket.user;
            isReady = !!user;
          } catch (socketError) {
            // Si falla, intentar con getStatus como fallback
            try {
              const status = await baileysController.getStatus(conexion.whatsapp_id);
              isReady = status.ready;
            } catch (statusError) {
              console.error(`Error verificando estado de ${conexion.whatsapp_id}:`, statusError.message);
              continue;
            }
          }
          
          if (isReady) {
            client = socket;
            whatsappId = conexion.whatsapp_id;
            console.log(`[INFO] Usando conexión ${whatsappId} (fase ${conexion.fase_actual || 'N/A'}) para verificar números`);
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
      console.log('[WARN] No se encontró cliente disponible. Información de debugging:');
      console.log(`   - Conexiones en BD: ${conexionesActivas.length}`);
      for (const conexion of conexionesActivas) {
        const socket = conexionesService.getSocketByWhatsAppId(conexion.whatsapp_id);
        console.log(`   - ${conexion.whatsapp_id}: socket=${socket ? 'SI' : 'NO'}`);
        if (socket) {
          try {
            const status = await baileysController.getStatus(conexion.whatsapp_id);
            console.log(`     Estado: ready=${status.ready}, message=${status.message}`);
          } catch (e) {
            console.log(`     Error obteniendo estado: ${e.message}`);
          }
        }
      }
      throw new Error('No hay conexión activa de WhatsApp disponible para verificar números');
    }

    // Formatear número para Baileys (agregar @s.whatsapp.net si no lo tiene)
    const jid = phoneNumber.includes('@s.whatsapp.net') ? phoneNumber : 
                phoneNumber.includes('@c.us') ? phoneNumber.replace('@c.us', '@s.whatsapp.net') :
                `${phoneNumber}@s.whatsapp.net`;

    try {
      // Con Baileys, usamos onWhatsApp para verificar si un número está registrado
      // Este método está disponible en el socket de Baileys
      const { onWhatsApp } = await import('@whiskeysockets/baileys');
      
      // onWhatsApp requiere un array de JIDs
      const result = await onWhatsApp(client, [jid]);
      
      if (result && result.length > 0) {
        return result[0].exists === true;
      }
      
      return false;
    } catch (error) {
      // Detectar errores específicos
      const errorMessage = error.message || error.toString();
      if (errorMessage.includes('not registered') ||
          errorMessage.includes('not found') ||
          errorMessage.includes('invalid')) {
        return false;
      }
      // Para otros errores, asumir que no está registrado por seguridad
      console.warn(`[WARN] Error verificando número ${phoneNumber}: ${errorMessage}`);
      return false;
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
      
      console.log(`[INFO] Verificando disponibilidad: ${conexionesActivas.length} conexión(es) activa(s) en BD`);
      
      if (conexionesActivas.length === 0) {
        console.log('[INFO] No hay conexiones activas en la base de datos');
        return false;
      }
      
      // Obtener todos los sockets registrados para debugging
      const baileysController = (await import('../controllers/baileysController.js')).default;
      
      for (const conexion of conexionesActivas) {
        console.log(`[INFO] Verificando conexión: ${conexion.whatsapp_id} (fase ${conexion.fase_actual || 'N/A'})`);
        
        // Intentar obtener socket con el whatsapp_id de la BD
        let socket = conexionesService.getSocketByWhatsAppId(conexion.whatsapp_id);
        
        if (!socket) {
          console.log(`   [WARN] No se encontró socket registrado para ${conexion.whatsapp_id}`);
          // Continuar con la siguiente conexión
          continue;
        }
        
        console.log(`   [INFO] Socket encontrado para ${conexion.whatsapp_id}`);
        
        try {
          // Verificar directamente con el socket si tiene info disponible
          let isReady = false;
          try {
            // Baileys usa socket.user en lugar de socket.info
            const user = socket.user;
            isReady = !!user;
            console.log(`   [INFO] Estado del socket: ready=${isReady}`);
          } catch (socketError) {
            console.log(`   [WARN] Error obteniendo user del socket: ${socketError.message}`);
            // Intentar con getStatus como fallback
            const status = await baileysController.getStatus(conexion.whatsapp_id);
            isReady = status.ready;
            console.log(`   [INFO] Estado (fallback): ready=${isReady}, message=${status.message}`);
          }
          
          if (isReady) {
            console.log(`[INFO] Conexión disponible para verificación: ${conexion.whatsapp_id} (fase ${conexion.fase_actual || 'N/A'})`);
            return true;
          } else {
            console.log(`   [INFO] Conexión ${conexion.whatsapp_id} no está lista`);
          }
        } catch (e) {
          console.error(`   [ERROR] Error verificando estado de ${conexion.whatsapp_id}:`, e.message);
          continue;
        }
      }
      
      console.log('[INFO] No hay conexiones activas disponibles para verificación');
      console.log('[INFO] Asegúrate de que:');
      console.log(`   1. El número esté conectado y el QR haya sido escaneado`);
      console.log(`   2. El cliente esté en estado 'ready'`);
      console.log(`   3. El socket esté registrado correctamente`);
      
      return false;
    } catch (error) {
      console.error('[ERROR] Error verificando disponibilidad:', error.message);
      console.error(error.stack);
      return false;
    }
  }
}

// Exportar instancia singleton
export default new WhatsAppVerificationService();
