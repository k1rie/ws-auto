import { query, transaction } from '../config/database.js';

/**
 * Crea múltiples contactos en una transacción
 * conexionId puede ser null - los contactos estarán disponibles para cualquier conexión
 */
export async function createContactosBulk(conexionId, contactos) {
  if (!contactos || contactos.length === 0) {
    return { inserted: 0, errors: [] };
  }

  const errors = [];
  let inserted = 0;

  await transaction(async (connection) => {
    const sql = `
      INSERT INTO contactos 
      (conexion_id, nombre, empresa, cargo, telefono, telefono_mobile, telefono_corporate, telefono_other, mensaje_personalizado, estado)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente')
    `;

    for (const contacto of contactos) {
      try {
        await connection.execute(sql, [
          conexionId || null, // Permite NULL - contactos disponibles para cualquier conexión
          contacto.nombre || null,
          contacto.empresa || null,
          contacto.cargo || null,
          contacto.telefono || null, // Teléfono principal (el primero encontrado)
          contacto.telefono_mobile || null,
          contacto.telefono_corporate || null,
          contacto.telefono_other || null,
          contacto.mensaje_personalizado || null
        ]);
        inserted++;
      } catch (error) {
        errors.push({
          contacto,
          error: error.message
        });
      }
    }
  });

  return { inserted, errors };
}

/**
 * Obtiene contactos de una conexión
 */
export async function getContactosByConexion(conexionId, filtroEstado = null) {
  let sql = 'SELECT * FROM contactos WHERE conexion_id = ?';
  const params = [conexionId];

  if (filtroEstado) {
    sql += ' AND estado = ?';
    params.push(filtroEstado);
  }

  sql += ' ORDER BY fecha_creacion DESC';
  return await query(sql, params);
}

/**
 * Obtiene todos los contactos pendientes del sistema
 */
export async function getAllContactosPendientes(limit = null) {
  let sql = "SELECT * FROM contactos WHERE estado = 'pendiente' ORDER BY fecha_creacion ASC";
  
  if (limit) {
    sql += ` LIMIT ${parseInt(limit)}`;
  }
  
  return await query(sql);
}

/**
 * Actualiza el estado de un contacto
 * conexionId es opcional - se usa para registrar qué conexión envió el mensaje
 */
export async function updateContactoEstado(contactoId, estado, errorMensaje = null, conexionId = null) {
  const sql = `
    UPDATE contactos 
    SET estado = ?, 
        fecha_envio = ?,
        error_mensaje = ?,
        conexion_id = COALESCE(?, conexion_id)
    WHERE id = ?
  `;
  
  const fechaEnvio = estado === 'enviado' ? new Date() : null;
  await query(sql, [estado, fechaEnvio, errorMensaje, conexionId, contactoId]);
  
  return await getContactoById(contactoId);
}

/**
 * Obtiene un contacto por ID
 */
export async function getContactoById(contactoId) {
  const sql = 'SELECT * FROM contactos WHERE id = ?';
  const results = await query(sql, [contactoId]);
  return results[0] || null;
}

/**
 * Cuenta contactos pendientes por conexión
 */
export async function countContactosPendientesByConexion(conexionId) {
  const sql = `
    SELECT COUNT(*) as count 
    FROM contactos 
    WHERE conexion_id = ? AND estado = 'pendiente'
  `;
  const results = await query(sql, [conexionId]);
  return results[0]?.count || 0;
}

/**
 * Cuenta todos los contactos pendientes del sistema
 */
export async function countAllContactosPendientes() {
  const sql = "SELECT COUNT(*) as count FROM contactos WHERE estado = 'pendiente'";
  const results = await query(sql);
  return results[0]?.count || 0;
}

