import { query } from '../config/database.js';

/**
 * Obtiene la configuración de una fase específica
 */
export async function getFaseConfig(fase) {
  const sql = 'SELECT * FROM configuracion_fases WHERE fase = ?';
  const results = await query(sql, [fase]);
  return results[0] || null;
}

/**
 * Obtiene todas las fases ordenadas
 */
export async function getAllFases() {
  const sql = 'SELECT * FROM configuracion_fases ORDER BY fase ASC';
  return await query(sql);
}

/**
 * Obtiene la siguiente fase disponible
 */
export async function getSiguienteFase(faseActual) {
  const sql = 'SELECT * FROM configuracion_fases WHERE fase > ? ORDER BY fase ASC LIMIT 1';
  const results = await query(sql, [faseActual]);
  return results[0] || null;
}

