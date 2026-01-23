import { 
  createOrUpdateConexion, 
  getConexionByWhatsAppId,
  getConexionesActivas,
  countConexionesActivas,
  updateConexionEstado,
  checkAndUpdateFase
} from '../models/conexionesModel.js';
import { getFaseConfig } from '../models/fasesModel.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Servicio para gestionar conexiones de WhatsApp
 * Controla el límite de conexiones simultáneas
 */
class ConexionesService {
  constructor() {
    // Límite máximo de conexiones simultáneas para envío de mensajes
    this.MAX_CONEXIONES = parseInt(process.env.MAX_CONEXIONES || '1');
    // Límite máximo de conexiones simultáneas para registro (obtener QR y guardar datos)
    this.MAX_CONEXIONES_REGISTRO = parseInt(process.env.MAX_CONEXIONES_REGISTRO || '2');
    this.activeSockets = new Map(); // Map<whatsappId, socket> - conexiones activas para envío
    this.registrationSockets = new Map(); // Map<whatsappId, socket> - conexiones temporales para registro
  }

  /**
   * Registra un socket activo (para envío de mensajes)
   */
  registerSocket(whatsappId, socket, isRegistration = false) {
    if (isRegistration) {
      this.registrationSockets.set(whatsappId, socket);
      console.log(`[INFO] Socket de registro registrado para ${whatsappId}. Total registros: ${this.registrationSockets.size}/${this.MAX_CONEXIONES_REGISTRO}`);
    } else {
      this.activeSockets.set(whatsappId, socket);
      console.log(`[INFO] Socket activo registrado para ${whatsappId}. Total activos: ${this.activeSockets.size}/${this.MAX_CONEXIONES}`);
    }
  }

  /**
   * Elimina un socket activo
   */
  unregisterSocket(whatsappId) {
    // Intentar eliminar de ambos pools
    const removedFromActive = this.activeSockets.delete(whatsappId);
    const removedFromRegistration = this.registrationSockets.delete(whatsappId);
    
    if (removedFromActive) {
      console.log(`[INFO] Socket activo eliminado para ${whatsappId}. Total activos: ${this.activeSockets.size}/${this.MAX_CONEXIONES}`);
    }
    if (removedFromRegistration) {
      console.log(`[INFO] Socket de registro eliminado para ${whatsappId}. Total registros: ${this.registrationSockets.size}/${this.MAX_CONEXIONES_REGISTRO}`);
    }
  }

  /**
   * Obtiene un socket por whatsappId (busca en ambos pools)
   */
  getSocketByWhatsAppId(whatsappId) {
    return this.activeSockets.get(whatsappId) || this.registrationSockets.get(whatsappId) || null;
  }

  /**
   * Verifica si hay espacio disponible para un nuevo socket (cliente de WhatsApp)
   * @param {boolean} isRegistration - Si es true, verifica el límite de registro; si es false, verifica el límite de envío
   */
  canCreateSocket(isRegistration = false) {
    if (isRegistration) {
      const socketsRegistro = this.registrationSockets.size;
      const disponible = socketsRegistro < this.MAX_CONEXIONES_REGISTRO;
      console.log(`[INFO] Verificación de socket de registro: ${socketsRegistro}/${this.MAX_CONEXIONES_REGISTRO} sockets de registro`);
      return disponible;
    } else {
      const socketsActivos = this.activeSockets.size;
      const disponible = socketsActivos < this.MAX_CONEXIONES;
      console.log(`[INFO] Verificación de socket activo: ${socketsActivos}/${this.MAX_CONEXIONES} sockets activos`);
      return disponible;
    }
  }

  /**
   * Obtiene el número de sockets disponibles
   * @param {boolean} isRegistration - Si es true, retorna slots de registro; si es false, retorna slots de envío
   */
  getAvailableSlots(isRegistration = false) {
    if (isRegistration) {
      const socketsRegistro = this.registrationSockets.size;
      return Math.max(0, this.MAX_CONEXIONES_REGISTRO - socketsRegistro);
    } else {
      const socketsActivos = this.activeSockets.size;
      return Math.max(0, this.MAX_CONEXIONES - socketsActivos);
    }
  }

  /**
   * Obtiene el número de sockets activos (para envío)
   */
  getActiveSocketsCount() {
    return this.activeSockets.size;
  }

  /**
   * Obtiene el número de sockets de registro
   */
  getRegistrationSocketsCount() {
    return this.registrationSockets.size;
  }

  /**
   * Obtiene el total de sockets (activos + registro)
   */
  getTotalSocketsCount() {
    return this.activeSockets.size + this.registrationSockets.size;
  }

  /**
   * Crea o actualiza una conexión en BD (sin límite)
   * NOTA: Las conexiones en BD pueden ser ilimitadas, solo se limita el número de sockets activos
   */
  async createOrUpdateConexion(whatsappId, nombreUsuario) {
    // Siempre permitir crear/actualizar en BD (sin verificar límite)
    return await createOrUpdateConexion(whatsappId, nombreUsuario);
  }

  /**
   * Verifica si se puede crear un nuevo socket (cliente de WhatsApp)
   * @param {boolean} isRegistration - Si es true, verifica el límite de registro; si es false, verifica el límite de envío
   */
  canCreateNewSocket(isRegistration = false) {
    return this.canCreateSocket(isRegistration);
  }

  /**
   * Obtiene la mejor conexión disponible para enviar mensajes
   */
  async getBestAvailableConnection() {
    // Obtener todas las conexiones activas ordenadas por fase (mayor primero)
    const conexiones = await getConexionesActivas();
    
    if (conexiones.length === 0) {
      return null;
    }

    // Para cada conexión, verificar:
    // 1. Que tenga socket activo
    // 2. Que no haya excedido el límite diario
    for (const conexion of conexiones) {
      // Verificar y actualizar fase si es necesario
      const updatedConexion = await checkAndUpdateFase(conexion.whatsapp_id);
      
      // Obtener configuración de la fase
      const faseConfig = await getFaseConfig(updatedConexion.fase_actual);
      
      if (!faseConfig) {
        continue;
      }

      // Verificar límite diario
      if (updatedConexion.mensajes_enviados_hoy >= faseConfig.mensajes_por_numero_por_dia) {
        continue;
      }

      // Verificar que tenga socket activo
      const socket = this.getSocketByWhatsAppId(updatedConexion.whatsapp_id);
      if (!socket) {
        continue;
      }

      // Esta conexión está disponible
      return {
        conexion: updatedConexion,
        faseConfig,
        socket
      };
    }

    return null;
  }

  /**
   * Obtiene información de todas las conexiones
   */
  async getAllConexionesInfo() {
    const conexiones = await getConexionesActivas();
    
    return conexiones.map(conexion => ({
      ...conexion,
      hasSocket: this.getSocketByWhatsAppId(conexion.whatsapp_id) !== null
    }));
  }

  /**
   * Desactiva una conexión
   */
  async deactivateConnection(whatsappId) {
    await updateConexionEstado(whatsappId, 'inactive');
    this.unregisterSocket(whatsappId);
  }
}

// Exportar instancia singleton
export default new ConexionesService();


