import { query } from '../config/database.js';

const DEFAULT_DAYS_OF_WEEK = [1, 2, 3, 4, 5]; // Lunes a Viernes por defecto
const CONFIG_KEY_DAYS_OF_WEEK = 'dias_envio_global';

/**
 * Asegura que la tabla de configuración global existe
 */
async function ensureConfigTable() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS configuracion_global (
        clave VARCHAR(100) PRIMARY KEY,
        valor TEXT NOT NULL,
        fecha_actualizacion DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  } catch (error) {
    // Si la tabla ya existe, ignorar
    if (!error.message.includes('already exists')) {
      console.warn('[WARN] Error creando tabla configuracion_global:', error.message);
    }
  }
}

/**
 * Obtiene la configuración global de días de envío
 */
export async function getGlobalDaysOfWeek() {
  await ensureConfigTable();
  
  try {
    const result = await query(
      'SELECT valor FROM configuracion_global WHERE clave = ?',
      [CONFIG_KEY_DAYS_OF_WEEK]
    );
    
    if (result && result.length > 0) {
      try {
        const parsed = JSON.parse(result[0].valor);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map(Number).filter((n) => !Number.isNaN(n) && n >= 0 && n <= 6).sort();
        }
      } catch (error) {
        console.warn('[WARN] Error parseando días de envío globales, usando valor por defecto');
      }
    }
  } catch (error) {
    console.warn('[WARN] Error obteniendo configuración global, usando valor por defecto:', error.message);
  }
  
  // Si no existe configuración, crear con valor por defecto
  await setGlobalDaysOfWeek(DEFAULT_DAYS_OF_WEEK);
  return DEFAULT_DAYS_OF_WEEK;
}

/**
 * Establece la configuración global de días de envío
 */
export async function setGlobalDaysOfWeek(daysOfWeek) {
  await ensureConfigTable();
  
  // Validar que sea un array válido
  if (!Array.isArray(daysOfWeek) || daysOfWeek.length === 0) {
    throw new Error('daysOfWeek debe ser un array no vacío');
  }
  
  // Validar que todos los valores sean números entre 0 y 6
  const validDays = daysOfWeek
    .map(Number)
    .filter((n) => !Number.isNaN(n) && n >= 0 && n <= 6)
    .sort();
  
  if (validDays.length === 0) {
    throw new Error('No hay días válidos en el array');
  }
  
  const valorJson = JSON.stringify(validDays);
  
  await query(`
    INSERT INTO configuracion_global (clave, valor)
    VALUES (?, ?)
    ON DUPLICATE KEY UPDATE
      valor = VALUES(valor),
      fecha_actualizacion = NOW()
  `, [CONFIG_KEY_DAYS_OF_WEEK, valorJson]);
  
  console.log(`[INFO] Configuración global de días de envío actualizada: ${valorJson}`);
  
  return validDays;
}

/**
 * Obtiene toda la configuración global
 */
export async function getAllGlobalConfig() {
  await ensureConfigTable();
  
  try {
    const result = await query('SELECT * FROM configuracion_global');
    const config = {};
    
    for (const row of result) {
      try {
        config[row.clave] = JSON.parse(row.valor);
      } catch (error) {
        config[row.clave] = row.valor;
      }
    }
    
    return config;
  } catch (error) {
    console.warn('[WARN] Error obteniendo configuración global:', error.message);
    return {};
  }
}
