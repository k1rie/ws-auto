import { getAllConexiones, getConexionByWhatsAppId, updateConexionEstado } from '../models/conexionesModel.js';
import { getFaseConfig } from '../models/fasesModel.js';
import { countContactosPendientesByConexion } from '../models/contactosModel.js';
import conexionesService from '../services/conexionesService.js';
import whatsappController from './whatsappController.js';
import mensajeriaService from '../services/mensajeriaService.js';

/**
 * Obtiene la cola de conexiones ordenada por prioridad
 */
export async function getQueue(req, res) {
  try {
    const conexiones = await getAllConexiones();
    const conexionesInfo = await conexionesService.getAllConexionesInfo();
    
    // Enriquecer con información adicional
    const cola = await Promise.all(conexiones.map(async (conexion) => {
      const faseConfig = await getFaseConfig(conexion.fase_actual);
      const hasSocket = conexionesInfo.find(c => c.whatsapp_id === conexion.whatsapp_id)?.hasSocket || false;
      const contactosPendientes = await countContactosPendientesByConexion(conexion.id);
      
      // Determinar estado
      let estado = 'PENDIENTE';
      if (conexion.estado === 'active' && hasSocket) {
        estado = 'ACTIVO';
      } else if (conexion.estado === 'active' && !hasSocket) {
        estado = 'INICIALIZANDO';
      } else if (conexion.estado === 'inactive') {
        estado = 'INACTIVO';
      }

      return {
        id: conexion.id,
        whatsappId: conexion.whatsapp_id,
        nombre: conexion.nombre_usuario || conexion.whatsapp_id,
        fase: conexion.fase_actual,
        faseConfig: faseConfig ? {
          mensajesPorDia: faseConfig.mensajes_por_numero_por_dia,
          duracionDias: faseConfig.duracion_dias,
          descripcion: faseConfig.descripcion
        } : null,
        estado: conexion.estado,
        estadoDisplay: estado,
        mensajesEnviados: conexion.mensajes_enviados_total,
        mensajesHoy: conexion.mensajes_enviados_hoy,
        fechaUltimaActividad: conexion.fecha_ultima_actividad,
        fechaRegistro: conexion.fecha_registro,
        hasSocket,
        contactosPendientes,
        puedeEnviar: hasSocket && conexion.estado === 'active' && 
                     faseConfig && 
                     conexion.mensajes_enviados_hoy < faseConfig.mensajes_por_numero_por_dia
      };
    }));

    // Ordenar por prioridad: activas primero, luego por fase (mayor primero), luego por fecha
    cola.sort((a, b) => {
      // Activas primero
      if (a.estado === 'active' && b.estado !== 'active') return -1;
      if (a.estado !== 'active' && b.estado === 'active') return 1;
      
      // Por fase (mayor primero)
      if (a.fase !== b.fase) return b.fase - a.fase;
      
      // Por fecha de registro (más antiguas primero)
      return new Date(a.fechaRegistro) - new Date(b.fechaRegistro);
    });

    res.json({
      success: true,
      data: {
        conexiones: cola,
        total: cola.length,
        activas: cola.filter(c => c.estado === 'active').length,
        socketsActivos: conexionesService.getActiveSocketsCount(),
        socketsDisponibles: conexionesService.getAvailableSlots(),
        maxSockets: conexionesService.MAX_CONEXIONES,
        // Mantener compatibilidad
        disponibles: conexionesService.getAvailableSlots(),
        maxConexiones: conexionesService.MAX_CONEXIONES
      }
    });
  } catch (error) {
    console.error('Error obteniendo cola:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * Inicializa una conexión de la cola
 */
export async function initializeConnection(req, res) {
  try {
    const { whatsappId, nombreUsuario } = req.body;

    if (!whatsappId) {
      return res.status(400).json({
        success: false,
        error: 'whatsappId es requerido'
      });
    }

    // Verificar si ya existe
    const existing = whatsappController.getClient(whatsappId);
    if (existing) {
      return res.json({
        success: true,
        message: 'Conexión ya está inicializada',
        data: {
          whatsappId,
          initialized: true
        }
      });
    }

    // Inicializar
    await whatsappController.initialize(whatsappId, nombreUsuario);

    res.json({
      success: true,
      message: 'Conexión inicializada. Usa GET /api/whatsapp/qr?whatsappId=xxx para obtener el QR code.',
      data: {
        whatsappId,
        initialized: true
      }
    });
  } catch (error) {
    res.status(error.message.includes('espacio disponible') ? 403 : 500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * Actualiza la prioridad de una conexión (cambiar orden)
 */
export async function updatePriority(req, res) {
  try {
    const { whatsappId, nuevaPrioridad } = req.body;

    if (!whatsappId || nuevaPrioridad === undefined) {
      return res.status(400).json({
        success: false,
        error: 'whatsappId y nuevaPrioridad son requeridos'
      });
    }

    // En este sistema, la prioridad se determina por fase y estado
    // Si quieres cambiar la prioridad, podrías actualizar la fase manualmente
    // Por ahora, solo retornamos éxito
    res.json({
      success: true,
      message: 'Prioridad actualizada (la prioridad se determina automáticamente por fase y estado)',
      data: {
        whatsappId
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * Fuerza el procesamiento inmediato de mensajes pendientes
 * Útil cuando se actualizan números en la base de datos
 */
export async function forceProcess(req, res) {
  try {
    const resultado = await mensajeriaService.forceProcess();
    
    res.json({
      success: true,
      message: 'Procesamiento de mensajes iniciado. Los números actualizados en la base de datos serán procesados inmediatamente.',
      data: resultado
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

