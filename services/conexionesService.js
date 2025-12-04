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
    // Límite máximo de conexiones simultáneas (configurable por variable de entorno)
    this.MAX_CONEXIONES = parseInt(process.env.MAX_CONEXIONES || '1');
    this.activeSockets = new Map(); // Map<whatsappId, socket>
  }

  /**
   * Registra un socket activo
   */
  registerSocket(whatsappId, socket) {
    this.activeSockets.set(whatsappId, socket);
    console.log(`📱 Socket registrado para ${whatsappId}. Total activos: ${this.activeSockets.size}`);
  }

  /**
   * Elimina un socket activo
   */
  unregisterSocket(whatsappId) {
    this.activeSockets.delete(whatsappId);
    console.log(`📱 Socket eliminado para ${whatsappId}. Total activos: ${this.activeSockets.size}`);
  }

  /**
   * Obtiene un socket por whatsappId
   */
  getSocketByWhatsAppId(whatsappId) {
    return this.activeSockets.get(whatsappId) || null;
  }

  /**
   * Verifica si hay espacio disponible para un nuevo socket (cliente de WhatsApp)
   * NOTA: Solo verifica sockets activos, NO conexiones en BD
   */
  canCreateSocket() {
    const socketsActivos = this.activeSockets.size;
    const disponible = socketsActivos < this.MAX_CONEXIONES;
    
    console.log(`🔍 Verificación de socket: ${socketsActivos}/${this.MAX_CONEXIONES} sockets activos`);
    
    return disponible;
  }

  /**
   * Obtiene el número de sockets disponibles
   * NOTA: Solo cuenta sockets, no conexiones en BD
   */
  getAvailableSlots() {
    const socketsActivos = this.activeSockets.size;
    return Math.max(0, this.MAX_CONEXIONES - socketsActivos);
  }

  /**
   * Obtiene el número de sockets activos
   */
  getActiveSocketsCount() {
    return this.activeSockets.size;
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
   * Solo verifica sockets activos, no conexiones en BD
   */
  canCreateNewSocket() {
    return this.canCreateSocket();
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


