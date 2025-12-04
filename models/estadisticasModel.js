import { query } from '../config/database.js';

/**
 * Obtiene estadísticas generales del sistema
 */
export async function getEstadisticasGenerales() {
  // Mensajes enviados totales
  const mensajesTotales = await query(`
    SELECT 
      SUM(mensajes_enviados_total) as total,
      SUM(mensajes_enviados_hoy) as hoy
    FROM conexiones
  `);

  // Conexiones activas
  const conexionesActivas = await query(`
    SELECT COUNT(*) as count 
    FROM conexiones 
    WHERE estado = 'active'
  `);

  // Números registrados (contactos únicos)
  const numerosRegistrados = await query(`
    SELECT COUNT(DISTINCT telefono) as count 
    FROM contactos
  `);

  // Mensajes enviados esta semana
  const mensajesSemana = await query(`
    SELECT COUNT(*) as count
    FROM contactos
    WHERE estado = 'enviado'
    AND fecha_envio >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
  `);

  // Mensajes enviados hoy
  const mensajesHoy = await query(`
    SELECT COUNT(*) as count
    FROM contactos
    WHERE estado = 'enviado'
    AND DATE(fecha_envio) = CURDATE()
  `);

  // Actividad reciente (últimos 10 eventos)
  const actividadReciente = await query(`
    SELECT 
      c.nombre_usuario,
      c.whatsapp_id,
      c.fecha_ultima_actividad,
      c.mensajes_enviados_hoy,
      c.estado
    FROM conexiones c
    ORDER BY c.fecha_ultima_actividad DESC
    LIMIT 10
  `);

  return {
    mensajesEnviados: {
      total: mensajesTotales[0]?.total || 0,
      hoy: mensajesTotales[0]?.hoy || 0,
      estaSemana: mensajesSemana[0]?.count || 0
    },
    conexionesActivas: conexionesActivas[0]?.count || 0,
    numerosRegistrados: numerosRegistrados[0]?.count || 0,
    mensajesHoy: mensajesHoy[0]?.count || 0,
    actividadReciente
  };
}

/**
 * Obtiene estadísticas de mensajes por día (últimos 7 días)
 */
export async function getEstadisticasPorDia(dias = 7) {
  const sql = `
    SELECT 
      DATE(fecha_envio) as fecha,
      COUNT(*) as cantidad
    FROM contactos
    WHERE estado = 'enviado'
    AND fecha_envio >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
    GROUP BY DATE(fecha_envio)
    ORDER BY fecha DESC
  `;
  
  return await query(sql, [dias]);
}

/**
 * Obtiene estadísticas de conexiones por fase
 */
export async function getEstadisticasPorFase() {
  const sql = `
    SELECT 
      fase_actual,
      COUNT(*) as cantidad,
      SUM(mensajes_enviados_hoy) as mensajes_hoy,
      SUM(mensajes_enviados_total) as mensajes_total
    FROM conexiones
    WHERE estado = 'active'
    GROUP BY fase_actual
    ORDER BY fase_actual ASC
  `;
  
  return await query(sql);
}

