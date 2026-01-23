import { getEstadisticasGenerales, getEstadisticasPorDia, getEstadisticasPorFase } from '../models/estadisticasModel.js';
import { countConexionesActivas } from '../models/conexionesModel.js';
import { countAllContactosPendientes } from '../models/contactosModel.js';
import conexionesService from '../services/conexionesService.js';
import baileysController from './baileysController.js';

/**
 * Obtiene el resumen del dashboard
 */
export async function getDashboard(req, res) {
  try {
    const estadisticas = await getEstadisticasGenerales();
    const conexionesActivas = await countConexionesActivas();
    const contactosPendientes = await countAllContactosPendientes();
    const conexionesInfo = await conexionesService.getAllConexionesInfo();
    
    // Calcular tendencias (simplificado - comparar con ayer)
    const mensajesAyer = await getEstadisticasPorDia(2);
    const mensajesHoy = estadisticas.mensajesHoy;
    const mensajesAyerCount = mensajesAyer.find(m => m.fecha !== new Date().toISOString().split('T')[0])?.cantidad || 0;
    const tendenciaMensajes = mensajesAyerCount > 0 
      ? ((mensajesHoy - mensajesAyerCount) / mensajesAyerCount * 100).toFixed(1)
      : mensajesHoy > 0 ? '100' : '0';

    // Estado de conexión (verificar si hay alguna conexión activa con socket)
    const tieneConexionActiva = conexionesInfo.some(c => c.hasSocket);
    const estadoConexion = tieneConexionActiva ? 'Conectado' : 'Desconectado';

    res.json({
      success: true,
      data: {
        metricas: {
          mensajesEnviados: {
            valor: estadisticas.mensajesEnviados.total,
            tendencia: `+${tendenciaMensajes}%`,
            hoy: estadisticas.mensajesHoy
          },
          conexionesActivas: {
            valor: conexionesActivas, // Total de conexiones en BD
            socketsActivos: conexionesService.getActiveSocketsCount(), // Sockets activos
            estado: tieneConexionActiva ? 'Conectado' : 'Desconectado',
            maxSockets: conexionesService.MAX_CONEXIONES, // Límite de sockets
            socketsDisponibles: conexionesService.getAvailableSlots(),
            // Mantener compatibilidad
            maxConexiones: conexionesService.MAX_CONEXIONES
          },
          numerosRegistrados: {
            valor: estadisticas.numerosRegistrados,
            tendencia: `+${estadisticas.mensajesEnviados.estaSemana} esta semana`
          },
          mensajesHoy: {
            valor: estadisticas.mensajesHoy,
            tendencia: `+${tendenciaMensajes}%`
          }
        },
        estadoConexion: {
          estado: estadoConexion,
          tieneConexion: tieneConexionActiva
        },
        actividadReciente: estadisticas.actividadReciente.map(act => ({
          conexion: act.nombre_usuario || act.whatsapp_id,
          fecha: act.fecha_ultima_actividad,
          mensajes: act.mensajes_enviados_hoy,
          estado: act.estado
        })),
        contactosPendientes,
        estadisticasPorDia: await getEstadisticasPorDia(7),
        estadisticasPorFase: await getEstadisticasPorFase()
      }
    });
  } catch (error) {
    console.error('Error obteniendo dashboard:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

