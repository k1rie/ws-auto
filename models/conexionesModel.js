import { query, transaction } from '../config/database.js';

/**
 * Crea o actualiza una conexión
 */
export async function createOrUpdateConexion(whatsappId, nombreUsuario) {
  const sql = `
    INSERT INTO conexiones (whatsapp_id, nombre_usuario, estado, fecha_inicio_fase)
    VALUES (?, ?, 'active', CURDATE())
    ON DUPLICATE KEY UPDATE
      nombre_usuario = VALUES(nombre_usuario),
      estado = 'active',
      fecha_inicio_fase = IF(fecha_inicio_fase IS NULL, CURDATE(), fecha_inicio_fase),
      fecha_ultima_actividad = NOW()
  `;
  
  await query(sql, [whatsappId, nombreUsuario]);
  return await getConexionByWhatsAppId(whatsappId);
}

/**
 * Obtiene una conexión por whatsapp_id
 */
export async function getConexionByWhatsAppId(whatsappId) {
  const sql = 'SELECT * FROM conexiones WHERE whatsapp_id = ?';
  const results = await query(sql, [whatsappId]);
  return results[0] || null;
}

/**
 * Obtiene todas las conexiones
 */
export async function getAllConexiones() {
  const sql = 'SELECT * FROM conexiones ORDER BY fecha_registro DESC';
  return await query(sql);
}

/**
 * Obtiene conexiones activas
 */
export async function getConexionesActivas() {
  const sql = "SELECT * FROM conexiones WHERE estado = 'active' ORDER BY fase_actual DESC, fecha_registro DESC";
  return await query(sql);
}

/**
 * Obtiene el número de conexiones activas
 */
export async function countConexionesActivas() {
  const sql = "SELECT COUNT(*) as count FROM conexiones WHERE estado = 'active'";
  const results = await query(sql);
  return results[0]?.count || 0;
}

/**
 * Actualiza el estado de una conexión
 */
export async function updateConexionEstado(whatsappId, estado) {
  const sql = `
    UPDATE conexiones 
    SET estado = ?, fecha_ultima_actividad = NOW()
    WHERE whatsapp_id = ?
  `;
  await query(sql, [estado, whatsappId]);
  return await getConexionByWhatsAppId(whatsappId);
}

/**
 * Actualiza la fase de una conexión
 */
export async function updateConexionFase(whatsappId, nuevaFase) {
  const sql = `
    UPDATE conexiones 
    SET fase_actual = ?, fecha_inicio_fase = CURDATE(), fecha_ultima_actividad = NOW()
    WHERE whatsapp_id = ?
  `;
  await query(sql, [nuevaFase, whatsappId]);
  return await getConexionByWhatsAppId(whatsappId);
}

/**
 * Actualiza el whatsapp_id y nombre_usuario de una conexión existente
 * Útil cuando se obtiene el número real del WhatsApp después de la conexión
 * Elimina la conexión temporal si existe una conexión con el número real
 */
export async function updateConexionWhatsAppId(whatsappIdAnterior, whatsappIdNuevo, nombreUsuario) {
  // Si el número es el mismo, solo actualizar el nombre
  if (whatsappIdAnterior === whatsappIdNuevo) {
    const sql = `
      UPDATE conexiones 
      SET nombre_usuario = ?, fecha_ultima_actividad = NOW()
      WHERE whatsapp_id = ?
    `;
    await query(sql, [nombreUsuario, whatsappIdAnterior]);
    return await getConexionByWhatsAppId(whatsappIdAnterior);
  }
  
  // Si el número es diferente, verificar si ya existe una conexión con el nuevo número
  const conexionConNumeroReal = await getConexionByWhatsAppId(whatsappIdNuevo);
  const conexionTemporal = await getConexionByWhatsAppId(whatsappIdAnterior);
  
  if (conexionConNumeroReal) {
    // Si ya existe una conexión con el número real, actualizarla y eliminar la temporal
    console.log(`[INFO] Ya existe conexión con número real ${whatsappIdNuevo}, actualizando y eliminando temporal ${whatsappIdAnterior}`);
    
    // Actualizar la conexión existente con el número real
    const sqlUpdate = `
      UPDATE conexiones 
      SET nombre_usuario = ?, estado = 'active', fecha_ultima_actividad = NOW()
      WHERE whatsapp_id = ?
    `;
    await query(sqlUpdate, [nombreUsuario, whatsappIdNuevo]);
    
    // Eliminar la conexión temporal si existe y es diferente
    if (conexionTemporal && conexionTemporal.id !== conexionConNumeroReal.id) {
      const sqlDelete = `DELETE FROM conexiones WHERE whatsapp_id = ?`;
      await query(sqlDelete, [whatsappIdAnterior]);
      console.log(`[INFO] Conexión temporal ${whatsappIdAnterior} eliminada`);
    }
    
    return await getConexionByWhatsAppId(whatsappIdNuevo);
  } else {
    // Si no existe conexión con el número real
    if (conexionTemporal) {
      // Si existe conexión temporal, actualizarla con el número real
      console.log(`[INFO] Actualizando conexión temporal ${whatsappIdAnterior} con número real ${whatsappIdNuevo}`);
      const sql = `
        UPDATE conexiones 
        SET whatsapp_id = ?, nombre_usuario = ?, fecha_ultima_actividad = NOW()
        WHERE whatsapp_id = ?
      `;
      await query(sql, [whatsappIdNuevo, nombreUsuario, whatsappIdAnterior]);
      return await getConexionByWhatsAppId(whatsappIdNuevo);
    } else {
      // Si no existe conexión temporal, crear una nueva con el número real
      console.log(`[INFO] Creando nueva conexión con número real ${whatsappIdNuevo}`);
      return await createOrUpdateConexion(whatsappIdNuevo, nombreUsuario);
    }
  }
}

/**
 * Incrementa los contadores de mensajes enviados
 */
export async function incrementMensajesEnviados(whatsappId, cantidad = 1) {
  const sql = `
    UPDATE conexiones 
    SET mensajes_enviados_hoy = mensajes_enviados_hoy + ?,
        mensajes_enviados_total = mensajes_enviados_total + ?,
        fecha_ultima_actividad = NOW()
    WHERE whatsapp_id = ?
  `;
  await query(sql, [cantidad, cantidad, whatsappId]);
  return await getConexionByWhatsAppId(whatsappId);
}

/**
 * Resetea los mensajes diarios de todas las conexiones
 */
export async function resetMensajesDiarios() {
  const sql = "UPDATE conexiones SET mensajes_enviados_hoy = 0";
  await query(sql);
  console.log('[INFO] Mensajes diarios reseteados para todas las conexiones');
}

/**
 * Verifica y actualiza la fase si es necesario
 */
export async function checkAndUpdateFase(whatsappId) {
  const conexion = await getConexionByWhatsAppId(whatsappId);
  if (!conexion || !conexion.fecha_inicio_fase) {
    return conexion;
  }

  // Obtener configuración de la fase actual
  const { getFaseConfig } = await import('./fasesModel.js');
  const faseConfig = await getFaseConfig(conexion.fase_actual);
  
  if (!faseConfig || faseConfig.duracion_dias === 0) {
    // Fase sin límite de duración
    return conexion;
  }

  // Calcular días transcurridos
  const sql = `
    SELECT DATEDIFF(CURDATE(), fecha_inicio_fase) as dias_transcurridos
    FROM conexiones
    WHERE whatsapp_id = ?
  `;
  const results = await query(sql, [whatsappId]);
  const diasTranscurridos = results[0]?.dias_transcurridos || 0;

  // Si se cumplió la duración, avanzar a la siguiente fase
  if (diasTranscurridos >= faseConfig.duracion_dias) {
    const { getAllFases } = await import('./fasesModel.js');
    const todasLasFases = await getAllFases();
    const faseActualIndex = todasLasFases.findIndex(f => f.fase === conexion.fase_actual);
    
    if (faseActualIndex < todasLasFases.length - 1) {
      const siguienteFase = todasLasFases[faseActualIndex + 1].fase;
      console.log(`[INFO] Cambiando conexión ${whatsappId} de fase ${conexion.fase_actual} a fase ${siguienteFase}`);
      return await updateConexionFase(whatsappId, siguienteFase);
    }
  }

  return conexion;
}

/**
 * Revisa y actualiza las fases de todas las conexiones activas
 * basándose en la configuración de fases
 */
export async function updateFasesTodasConexiones() {
  try {
    const conexiones = await getConexionesActivas();
    let actualizadas = 0;
    let errores = 0;

    console.log(`[INFO] Revisando ${conexiones.length} conexión(es) activa(s) para actualizar fases...`);

    for (const conexion of conexiones) {
      try {
        const conexionAnterior = conexion.fase_actual;
        const conexionActualizada = await checkAndUpdateFase(conexion.whatsapp_id);
        
        if (conexionActualizada && conexionActualizada.fase_actual !== conexionAnterior) {
          actualizadas++;
          console.log(
            `[INFO] Conexión ${conexion.whatsapp_id}: Fase ${conexionAnterior} -> ${conexionActualizada.fase_actual}`
          );
        }
      } catch (error) {
        errores++;
        console.error(
          `[ERROR] Error actualizando fase de conexión ${conexion.whatsapp_id}:`,
          error.message
        );
      }
    }

    if (actualizadas > 0 || errores > 0) {
      console.log(
        `[INFO] Actualización de fases completada: ${actualizadas} actualizada(s), ${errores} error(es)`
      );
    }

    return { actualizadas, errores, total: conexiones.length };
  } catch (error) {
    console.error('[ERROR] Error en updateFasesTodasConexiones:', error);
    throw error;
  }
}

