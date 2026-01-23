import { query, transaction } from '../config/database.js';

let scheduleColumnsChecked = false;

export async function ensureContactScheduleColumns() {
  if (scheduleColumnsChecked) return;

  const columnsNeeded = [
    { name: 'intervalo_envio_dias', definition: 'INT DEFAULT 1' },
    { name: 'dias_envio', definition: 'TEXT NULL' },
    { name: 'fecha_proximo_envio', definition: 'DATETIME NULL' }
  ];

  const columnExists = async (columnName) => {
    const results = await query(
      `
        SELECT COUNT(*) AS count
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'contactos'
          AND COLUMN_NAME = ?
      `,
      [columnName]
    );
    return (results?.[0]?.count || 0) > 0;
  };

  for (const column of columnsNeeded) {
    try {
      const exists = await columnExists(column.name);
      if (exists) continue;

      // Compatible con versiones antiguas (sin IF NOT EXISTS)
      await query(`ALTER TABLE contactos ADD COLUMN ${column.name} ${column.definition}`);
    } catch (error) {
      // Si otra instancia lo creó en paralelo, ignorar
      if (error.message && error.message.includes('Duplicate column name')) {
        continue;
      }
      console.warn(`[WARN] No se pudo asegurar la columna ${column.name}: ${error.message}`);
    }
  }

  scheduleColumnsChecked = true;
}

/**
 * Crea múltiples contactos en una transacción
 * conexionId puede ser null - los contactos estarán disponibles para cualquier conexión
 */
export async function createContactosBulk(conexionId, contactos) {
  if (!contactos || contactos.length === 0) {
    return { inserted: 0, errors: [] };
  }

  await ensureContactScheduleColumns();

  const errors = [];
  let inserted = 0;

  await transaction(async (connection) => {
    const sql = `
      INSERT INTO contactos 
      (conexion_id, nombre, empresa, cargo, telefono, telefono_mobile, telefono_corporate, telefono_other, mensaje_personalizado, estado, intervalo_envio_dias, dias_envio, fecha_proximo_envio)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, ?, ?)
    `;

    for (const contacto of contactos) {
      try {
        // Validar que dias_envio esté presente y sea válido
        // Si dias_envio es una cadena vacía, null o undefined, usar valor por defecto
        let diasEnvio = contacto.dias_envio;
        
        // Si es null, undefined, o cadena vacía, usar valor por defecto
        if (!diasEnvio || (typeof diasEnvio === 'string' && diasEnvio.trim() === '')) {
          diasEnvio = JSON.stringify([0,1,2,3,4,5,6]);
          console.warn(`[WARN] Contacto ${contacto.telefono} sin dias_envio válido, usando valor por defecto: ${diasEnvio}`);
        } else {
          // Validar que sea un JSON válido
          try {
            const parsed = JSON.parse(diasEnvio);
            if (!Array.isArray(parsed) || parsed.length === 0) {
              diasEnvio = JSON.stringify([0,1,2,3,4,5,6]);
              console.warn(`[WARN] Contacto ${contacto.telefono} con dias_envio inválido (no es array o está vacío), usando valor por defecto`);
            } else {
              console.log(`[INFO] Guardando contacto ${contacto.telefono} con dias_envio: ${diasEnvio}`);
            }
          } catch (parseError) {
            console.warn(`[WARN] Contacto ${contacto.telefono} con dias_envio no es JSON válido: ${diasEnvio}, usando valor por defecto`);
            diasEnvio = JSON.stringify([0,1,2,3,4,5,6]);
          }
        }

        await connection.execute(sql, [
          conexionId || null, // Permite NULL - contactos disponibles para cualquier conexión
          contacto.nombre || null,
          contacto.empresa || null,
          contacto.cargo || null,
          contacto.telefono || null, // Teléfono principal (el primero encontrado)
          contacto.telefono_mobile || null,
          contacto.telefono_corporate || null,
          contacto.telefono_other || null,
          contacto.mensaje_personalizado || null,
          contacto.intervalo_envio_dias || 1,
          diasEnvio, // Ya validado arriba
          contacto.fecha_proximo_envio || new Date()
        ]);
        inserted++;
      } catch (error) {
        console.error(`[ERROR] Error guardando contacto ${contacto.telefono}:`, error.message);
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
 * Alias para crear contactos programados (HubSpot)
 */
export async function createContactosProgramados(conexionId, contactos) {
  return createContactosBulk(conexionId, contactos);
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
  // Asegurar columnas si es posible (evita crash al arrancar)
  try {
    await ensureContactScheduleColumns();
  } catch (e) {
    // si falla la migración, continuamos con fallback en query
  }

  // Incluir contactos con estado vacío o NULL como pendientes
  const baseSql = "SELECT * FROM contactos WHERE (estado = 'pendiente' OR estado IS NULL OR estado = '')";
  const scheduleSql = `${baseSql} AND (fecha_proximo_envio IS NULL OR fecha_proximo_envio <= NOW()) ORDER BY fecha_creacion ASC`;
  const fallbackSql = `${baseSql} ORDER BY fecha_creacion ASC`;

  const applyLimit = (sql) => {
    if (limit) return `${sql} LIMIT ${parseInt(limit)}`;
    return sql;
  };

  try {
    return await query(applyLimit(scheduleSql));
  } catch (error) {
    // Fallback para BD aún sin columnas (evita detener la app)
    if (error?.code === 'ER_BAD_FIELD_ERROR' || (error?.message || '').includes('Unknown column')) {
      console.warn('[WARN] Columnas de programación no existen aún; enviando pendientes sin filtro por fecha_proximo_envio.');
      return await query(applyLimit(fallbackSql));
    }
    throw error;
  }
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

