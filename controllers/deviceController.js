import { getConexionByWhatsAppId, checkAndUpdateFase } from '../models/conexionesModel.js';
import { getFaseConfig } from '../models/fasesModel.js';
import { getContactosByConexion, countContactosPendientesByConexion } from '../models/contactosModel.js';
import conexionesService from '../services/conexionesService.js';
import whatsappController from './whatsappController.js';

/**
 * Obtiene información detallada de un dispositivo/conexión
 */
export async function getDeviceInfo(req, res) {
  try {
    const { whatsappId } = req.query;

    if (!whatsappId) {
      return res.status(400).json({
        success: false,
        error: 'whatsappId es requerido'
      });
    }

    // Obtener conexión
    let conexion = await getConexionByWhatsAppId(whatsappId);
    if (!conexion) {
      return res.status(404).json({
        success: false,
        error: 'Conexión no encontrada'
      });
    }

    // Verificar y actualizar fase si es necesario
    conexion = await checkAndUpdateFase(whatsappId);

    // Obtener configuración de fase
    const faseConfig = await getFaseConfig(conexion.fase_actual);

    // Obtener información del socket
    const client = whatsappController.getClient(whatsappId);
    const hasSocket = client !== null;
    const status = await whatsappController.getStatus(whatsappId);
    
    // Obtener QR si está disponible (esperar un poco si está inicializando)
    let qrCode = null;
    try {
      qrCode = whatsappController.getQRCode(whatsappId);
    } catch (e) {
      // Si no hay QR inmediatamente, esperar un poco
      try {
        qrCode = await whatsappController.waitForQR(whatsappId, 5000, 500);
      } catch (e2) {
        // No hay QR disponible
      }
    }

    // Obtener contactos
    const contactos = await getContactosByConexion(conexion.id);
    const contactosPendientes = await countContactosPendientesByConexion(conexion.id);
    const contactosEnviados = contactos.filter(c => c.estado === 'enviado').length;
    const contactosError = contactos.filter(c => c.estado === 'error').length;

    // Obtener número de teléfono del cliente si está disponible
    let numeroTelefono = 'No disponible';
    if (client && status.ready) {
      try {
        const info = await client.info;
        numeroTelefono = info?.wid?.user || 'No disponible';
      } catch (e) {
        // No se pudo obtener
      }
    }

    // Calcular tiempo activo
    let tiempoActivo = 'Desconectado';
    if (status.ready && conexion.fecha_ultima_actividad) {
      const diff = new Date() - new Date(conexion.fecha_ultima_actividad);
      const horas = Math.floor(diff / (1000 * 60 * 60));
      const minutos = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      tiempoActivo = `${horas}h ${minutos}m`;
    }

    res.json({
      success: true,
      data: {
        conexion: {
          id: conexion.id,
          whatsappId: conexion.whatsapp_id,
          nombre: conexion.nombre_usuario || conexion.whatsapp_id,
          estado: conexion.estado,
          estadoDisplay: status.ready ? 'Conectado' : 'Desconectado',
          fase: conexion.fase_actual,
          faseConfig: faseConfig ? {
            mensajesPorDia: faseConfig.mensajes_por_numero_por_dia,
            duracionDias: faseConfig.duracion_dias,
            lapsoDistribucion: faseConfig.lapso_distribucion_horas,
            descripcion: faseConfig.descripcion
          } : null,
          fechaRegistro: conexion.fecha_registro,
          fechaUltimaActividad: conexion.fecha_ultima_actividad,
          fechaInicioFase: conexion.fecha_inicio_fase
        },
        dispositivo: {
          numeroTelefono,
          ultimaConexion: conexion.fecha_ultima_actividad,
          mensajesEnviados: conexion.mensajes_enviados_total,
          mensajesRecibidos: 0, // No se rastrea actualmente
          mensajesHoy: conexion.mensajes_enviados_hoy,
          limiteDiario: faseConfig?.mensajes_por_numero_por_dia || 0,
          mensajesRestantes: faseConfig 
            ? Math.max(0, faseConfig.mensajes_por_numero_por_dia - conexion.mensajes_enviados_hoy)
            : 0
        },
        qrCode: qrCode,
        sistema: {
          conexion: status.ready ? 'Activa' : 'Inactiva',
          estado: status.message,
          tiempoActivo,
          hasSocket
        },
        estadisticas: {
          contactosTotal: contactos.length,
          contactosPendientes,
          contactosEnviados,
          contactosError,
          tasaExito: contactos.length > 0 
            ? ((contactosEnviados / contactos.length) * 100).toFixed(2) + '%'
            : '0%'
        }
      }
    });
  } catch (error) {
    console.error('Error obteniendo información del dispositivo:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * Inicializa WhatsApp para un dispositivo
 */
export async function initializeDevice(req, res) {
  try {
    const { whatsappId, nombreUsuario } = req.body;

    if (!whatsappId) {
      return res.status(400).json({
        success: false,
        error: 'whatsappId es requerido'
      });
    }

    // Verificar si ya está inicializado
    const client = whatsappController.getClient(whatsappId);
    if (client) {
      const status = await whatsappController.getStatus(whatsappId);
      return res.json({
        success: true,
        message: 'Dispositivo ya está inicializado',
        data: {
          whatsappId,
          ready: status.ready
        }
      });
    }

    // Inicializar
    await whatsappController.initialize(whatsappId, nombreUsuario);

    res.json({
      success: true,
      message: 'Dispositivo inicializado. Usa GET /api/device/info?whatsappId=xxx para obtener el QR code.',
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

