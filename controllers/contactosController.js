import { getContactosByConexion } from '../models/contactosModel.js';
import { getConexionByWhatsAppId } from '../models/conexionesModel.js';

/**
 * Obtiene contactos (de una conexión específica o todos si no se especifica)
 */
export async function getContactos(req, res) {
  try {
    const { sessionId } = req.query;
    const { estado } = req.query;

    let contactos = [];
    let conexion = null;

    if (sessionId) {
      // Si se proporciona sessionId, obtener contactos de esa conexión
      conexion = await getConexionByWhatsAppId(sessionId);
      if (!conexion) {
        return res.status(404).json({
          success: false,
          error: 'Conexión no encontrada'
        });
      }
      contactos = await getContactosByConexion(conexion.id, estado);
    } else {
      // Si no se proporciona sessionId, obtener TODOS los contactos del sistema
      const { getAllContactosPendientes } = await import('../models/contactosModel.js');
      if (estado === 'pendiente') {
        contactos = await getAllContactosPendientes();
      } else {
        // Para otros estados, necesitamos una función que obtenga todos
        const { query } = await import('../config/database.js');
        let sql = 'SELECT * FROM contactos';
        const params = [];
        if (estado) {
          sql += ' WHERE estado = ?';
          params.push(estado);
        }
        sql += ' ORDER BY fecha_creacion DESC';
        contactos = await query(sql, params);
      }
    }

    res.json({
      success: true,
      data: {
        conexion: conexion ? {
          id: conexion.id,
          whatsapp_id: conexion.whatsapp_id,
          nombre_usuario: conexion.nombre_usuario
        } : null,
        contactos,
        total: contactos.length,
        pendientes: contactos.filter(c => c.estado === 'pendiente').length,
        enviados: contactos.filter(c => c.estado === 'enviado').length,
        errores: contactos.filter(c => c.estado === 'error').length,
        filtro: sessionId ? `conexion: ${sessionId}` : 'todos'
      }
    });
  } catch (error) {
    console.error('Error obteniendo contactos:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

