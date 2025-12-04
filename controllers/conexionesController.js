import { getAllConexiones } from '../models/conexionesModel.js';
import conexionesService from '../services/conexionesService.js';

/**
 * Obtiene todas las conexiones
 */
export async function getConexiones(req, res) {
  try {
    const conexiones = await getAllConexiones();
    const conexionesInfo = await conexionesService.getAllConexionesInfo();
    
    // Combinar información de BD con estado de sockets
    const conexionesConEstado = conexiones.map(conexion => {
      const info = conexionesInfo.find(c => c.whatsapp_id === conexion.whatsapp_id);
      return {
        ...conexion,
        hasSocket: info?.hasSocket || false
      };
    });

    res.json({
      success: true,
      data: {
        conexiones: conexionesConEstado,
        total: conexionesConEstado.length,
        activas: conexionesConEstado.filter(c => c.estado === 'active').length,
        socketsActivos: conexionesService.getActiveSocketsCount(),
        socketsDisponibles: conexionesService.getAvailableSlots(),
        maxSockets: conexionesService.MAX_CONEXIONES,
        // Mantener compatibilidad con versiones anteriores
        disponibles: conexionesService.getAvailableSlots(),
        maxConexiones: conexionesService.MAX_CONEXIONES
      }
    });
  } catch (error) {
    console.error('Error obteniendo conexiones:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

