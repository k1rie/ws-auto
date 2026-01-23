import { getGlobalDaysOfWeek, setGlobalDaysOfWeek, getAllGlobalConfig } from '../models/configuracionModel.js';

/**
 * Obtiene la configuración global de días de envío
 */
export async function getConfiguracion(req, res) {
  try {
    const daysOfWeek = await getGlobalDaysOfWeek();
    const allConfig = await getAllGlobalConfig();
    
    res.json({
      success: true,
      data: {
        daysOfWeek,
        allConfig
      }
    });
  } catch (error) {
    console.error('[ERROR] Error obteniendo configuración:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Error obteniendo configuración'
    });
  }
}

/**
 * Actualiza la configuración global de días de envío
 */
export async function updateConfiguracion(req, res) {
  try {
    const { daysOfWeek } = req.body;
    
    if (!daysOfWeek || !Array.isArray(daysOfWeek) || daysOfWeek.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'daysOfWeek debe ser un array no vacío con valores entre 0 y 6'
      });
    }
    
    const updatedDays = await setGlobalDaysOfWeek(daysOfWeek);
    
    res.json({
      success: true,
      message: 'Configuración actualizada correctamente',
      data: {
        daysOfWeek: updatedDays
      }
    });
  } catch (error) {
    console.error('[ERROR] Error actualizando configuración:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Error actualizando configuración'
    });
  }
}
