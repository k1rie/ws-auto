import { getListInfo, getListContacts } from '../services/hubspotService.js';
import { generateMessageForContact } from '../services/messageGenerationService.js';
import whatsappVerificationService from '../services/whatsappVerificationService.js';
import conexionesService from '../services/conexionesService.js';
import { getConexionByWhatsAppId } from '../models/conexionesModel.js';
import { createContactosProgramados, ensureContactScheduleColumns } from '../models/contactosModel.js';
import { formatPhoneNumber, isValidPhoneNumber } from '../utils/phoneUtils.js';

// Las funciones parseDaysOfWeek y calculateNextSendDate ya no se usan
// La configuración de días de envío ahora es global y se maneja en configuracionModel.js

export async function previewImport(req, res) {
  try {
    const { listId } = req.body;
    if (!listId) {
      return res.status(400).json({
        success: false,
        error: 'listId es requerido'
      });
    }

    const listInfo = await getListInfo(listId);
    // Contar "importables" (con teléfono válido), porque es lo que realmente se puede importar
    const contactosImportables = await getListContacts(listId);

    res.json({
      success: true,
      data: {
        listId: listInfo.id,
        listName: listInfo.name,
        // totalContacts = lo que el usuario verá como "a importar"
        totalContacts: contactosImportables.length,
        // info adicional (por si quieres mostrarla luego)
        listTotalContacts: listInfo.totalContacts
      }
    });
  } catch (error) {
    console.error('Error en preview de HubSpot:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'No se pudo obtener la lista en HubSpot'
    });
  }
}

export async function importFromHubspot(req, res) {
  try {
    const {
      listId,
      sessionId = null,
      nombreUsuario = null
      // daysOfWeek ya no se usa - la configuración es global
    } = req.body;

    if (!listId) {
      return res.status(400).json({
        success: false,
        error: 'listId es requerido'
      });
    }

    // La configuración de días de envío ahora es GLOBAL, no se usa en la importación
    // Los días se configuran desde la sección de configuración del sistema
    console.log('[INFO] ===== INICIO IMPORTACIÓN HUBSPOT =====');
    console.log('[INFO] Nota: La configuración de días de envío es global y se aplica a todos los contactos');

    // Asegurar columnas nuevas
    await ensureContactScheduleColumns();

    // Gestionar conexión opcional
    let conexionId = null;
    if (sessionId) {
      let conexion = await getConexionByWhatsAppId(sessionId);
      if (!conexion) {
        conexion = await conexionesService.createOrUpdateConexion(sessionId, nombreUsuario || sessionId);
      }
      conexionId = conexion.id;
    }

    const listInfo = await getListInfo(listId);
    const hubspotContacts = await getListContacts(listId);

    if (!hubspotContacts.length) {
      return res.status(400).json({
        success: false,
        error: 'La lista no tiene contactos con teléfono válido'
      });
    }

    // Normalizar y deduplicar por teléfono
    const contactosUnicos = [];
    const telefonosVistos = new Set();

    for (const contacto of hubspotContacts) {
      const cleanedPhone = formatPhoneNumber(contacto.phone);
      if (!isValidPhoneNumber(cleanedPhone)) continue;
      if (telefonosVistos.has(cleanedPhone)) continue;
      telefonosVistos.add(cleanedPhone);
      contactosUnicos.push({
        phone: cleanedPhone,
        firstname: contacto.firstname?.trim() || '',
        lastname: contacto.lastname?.trim() || ''
      });
    }

    // Verificar disponibilidad para validar números
    let verificationResults = null;
    try {
      const available = await whatsappVerificationService.isAvailable();
      if (available) {
        verificationResults = await whatsappVerificationService.verifyBatch(
          Array.from(telefonosVistos)
        );
      }
    } catch (error) {
      console.warn('[WARN] No se pudo verificar números en WhatsApp, se continuará sin verificación:', error.message);
    }

    const contactosListos = [];
    const errores = [];

    // Obtener guía una sola vez
    let guideText = null;
    try {
      guideText = await (await import('../services/guideService.js')).getGuideText();
    } catch (error) {
      console.error('Error obteniendo guía, se usará fallback:', error.message);
    }

    for (const contacto of contactosUnicos) {
      // Validar verificación de WhatsApp si está disponible
      if (verificationResults && verificationResults.has(contacto.phone)) {
        const isRegistered = verificationResults.get(contacto.phone);
        if (!isRegistered) {
          errores.push({
            contacto: contacto.phone,
            error: 'Número no está en WhatsApp'
          });
          continue;
        }
      }

      // Generar mensaje con IA
      const mensaje = await generateMessageForContact(contacto, guideText);

      const nombre = [contacto.firstname, contacto.lastname].filter(Boolean).join(' ').trim() || null;

      // La configuración de días de envío es GLOBAL, no se guarda por contacto
      // fecha_proximo_envio se calculará usando la configuración global cuando se procese
      contactosListos.push({
        nombre,
        empresa: null,
        cargo: null,
        telefono: contacto.phone,
        telefono_mobile: contacto.phone,
        telefono_corporate: null,
        telefono_other: null,
        mensaje_personalizado: mensaje,
        intervalo_envio_dias: 1, // Fijo a 1 día
        dias_envio: null, // Ya no se usa, la configuración es global
        fecha_proximo_envio: null // Se calculará usando la configuración global
      });
    }

    if (contactosListos.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No hay contactos válidos para importar después de validar teléfonos'
      });
    }

    const resultado = await createContactosProgramados(conexionId, contactosListos);

    res.json({
      success: true,
      message: 'Importación desde HubSpot completada',
      data: {
        total: contactosUnicos.length,
        importados: resultado.inserted,
        errores: errores.length + resultado.errors.length,
        detalles_errores: [...errores, ...resultado.errors].slice(0, 20),
        list: {
          id: listInfo.id,
          name: listInfo.name,
          totalContacts: listInfo.totalContacts
        },
        guardados: resultado.inserted
      }
    });
  } catch (error) {
    console.error('Error importando desde HubSpot:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Error importando desde HubSpot'
    });
  }
}

export default {
  previewImport,
  importFromHubspot
};
