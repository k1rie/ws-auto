import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import { createContactosBulk } from '../models/contactosModel.js';
import { getConexionByWhatsAppId } from '../models/conexionesModel.js';
import conexionesService from '../services/conexionesService.js';
// Ya no necesitamos validar teléfonos, solo limpiarlos

/**
 * Procesa un archivo CSV y guarda los contactos en la base de datos
 */
export async function uploadCSV(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No se proporcionó ningún archivo CSV'
      });
    }

    const filePath = req.file.path;
    const sessionId = req.body.sessionId || req.query.sessionId; // Opcional ahora

    // sessionId es opcional - si no se proporciona, los contactos estarán disponibles para cualquier conexión
    let conexionId = null;
    
    if (sessionId) {
      // Si se proporciona sessionId, verificar o crear conexión (opcional)
      let conexion = await getConexionByWhatsAppId(sessionId);
      if (!conexion) {
        // Crear conexión si no existe (siempre permitido en BD)
        conexion = await conexionesService.createOrUpdateConexion(
          sessionId,
          req.body.nombreUsuario || sessionId
        );
      }
      conexionId = conexion.id;
    }
    // Si no hay sessionId, conexionId será null y los contactos estarán disponibles para cualquier conexión
    
    console.log(`📝 Subiendo CSV con conexionId: ${conexionId || 'NULL (disponible para cualquier conexión)'}`);

    // Leer y procesar CSV
    const contactos = [];
    const errors = [];

    await new Promise((resolve, reject) => {
      let isFirstRow = true;
      let headerMap = {}; // Mapa de nombre de columna -> índice
      
      fs.createReadStream(filePath)
        .pipe(csv({
          skipEmptyLines: false,
          skipLinesWithError: false,
          headers: false // Leer sin headers automáticos
        }))
        .on('data', (row) => {
          try {
            // Convertir row a array de valores
            const values = Object.values(row);
            
            // Si es la primera fila, son los headers - crear mapa
            if (isFirstRow) {
              values.forEach((header, index) => {
                const cleaned = (header || '').trim().replace(/\t/g, '');
                if (cleaned) {
                  // Guardar tanto el nombre completo como variaciones
                  const key = cleaned.toLowerCase();
                  headerMap[key] = index;
                  
                  // También guardar sin espacios para búsqueda flexible
                  headerMap[key.replace(/\s+/g, '')] = index;
                  headerMap[key.replace(/\s+/g, '_')] = index;
                }
              });
              console.log('📋 Headers detectados:', Object.keys(headerMap).filter(k => !k.includes('_')));
              console.log('📋 Mapa completo:', headerMap);
              isFirstRow = false;
              return; // Saltar la primera fila (headers)
            }
            
            // Función helper para obtener valor de columna
            const getColumn = (columnName) => {
              // Buscar exacto primero
              let index = headerMap[columnName.toLowerCase()];
              
              // Si no encuentra exacto, buscar parcial
              if (index === undefined) {
                const searchTerm = columnName.toLowerCase();
                for (const [header, idx] of Object.entries(headerMap)) {
                  if (header.includes(searchTerm) || searchTerm.includes(header)) {
                    index = idx;
                    break;
                  }
                }
              }
              
              if (index !== undefined && values[index]) {
                return (values[index] || '').trim();
              }
              return '';
            };
            
            // Extraer datos del CSV usando el mapa de headers
            const firstName = getColumn('First Name') || '';
            const lastName = getColumn('Last Name') || '';
            const nombre = `${firstName} ${lastName}`.trim() || null;
            const empresa = getColumn('Company Name') || null;
            const cargo = getColumn('Title') || null;
            const mensajePersonalizado = getColumn('Message') || null;
            
            // Obtener los 3 números de teléfono (guardar todos)
            const telefonoMobile = getColumn('Mobile Phone');
            const telefonoCorporate = getColumn('Corporate Phone');
            const telefonoOther = getColumn('Other Phone');
            
            // Limpiar cada teléfono (solo quitar caracteres no numéricos)
            const cleanPhone = (phone) => {
              if (!phone) return null;
              const cleaned = phone.toString().trim().replace(/\D/g, '');
              return cleaned && cleaned !== '' ? cleaned : null;
            };
            
            const telefonoMobileLimpio = cleanPhone(telefonoMobile);
            const telefonoCorporateLimpio = cleanPhone(telefonoCorporate);
            const telefonoOtherLimpio = cleanPhone(telefonoOther);
            
            // El teléfono principal será el primero que encuentre (en orden de prioridad)
            const telefono = telefonoMobileLimpio || telefonoCorporateLimpio || telefonoOtherLimpio;
            
            // Validar que al menos uno de los teléfonos existe
            if (!telefono) {
              errors.push({
                row: {
                  nombre: nombre || 'Sin nombre',
                  empresa: empresa || 'Sin empresa'
                },
                error: 'No se encontró ningún teléfono en las columnas Mobile Phone, Corporate Phone u Other Phone'
              });
              return;
            }

            // Agregar contacto (incluso si otros campos están vacíos)
            // Guarda los 3 números de teléfono
            contactos.push({
              nombre: nombre || null,
              empresa: empresa || null,
              cargo: cargo || null,
              telefono: telefono, // Teléfono principal (el primero encontrado)
              telefono_mobile: telefonoMobileLimpio,
              telefono_corporate: telefonoCorporateLimpio,
              telefono_other: telefonoOtherLimpio,
              mensaje_personalizado: mensajePersonalizado || null
            });
          } catch (error) {
            console.error('Error procesando fila:', error);
            errors.push({
              row: {
                nombre: (row['First Name'] || '').trim() || 'Desconocido',
                empresa: (row['Company Name'] || '').trim() || 'Desconocido'
              },
              error: error.message,
              stack: error.stack
            });
          }
        })
        .on('end', resolve)
        .on('error', reject);
    });

    // Log para debugging
    console.log(`📊 CSV procesado: ${contactos.length} contactos válidos, ${errors.length} errores`);
    if (contactos.length > 0) {
      console.log(`✅ Primer contacto válido:`, {
        nombre: contactos[0].nombre,
        telefono: contactos[0].telefono,
        telefono_usado: contactos[0].telefono_usado
      });
    }
    if (errors.length > 0) {
      console.log(`❌ Primer error:`, errors[0]);
    }

    // Guardar contactos en base de datos (conexionId puede ser null)
    const result = await createContactosBulk(conexionId, contactos);

    // Limpiar archivo temporal
    fs.unlinkSync(filePath);

    // Respuesta con información detallada
    console.log(`💾 Base de datos: ${result.inserted} insertados, ${result.errors.length} errores de BD`);
    
    res.json({
      success: true,
      message: 'CSV procesado exitosamente',
      data: {
        total: contactos.length + errors.length,
        guardados: result.inserted,
        errores: errors.length + result.errors.length,
        contactos: contactos.slice(0, 10).map(c => ({
          nombre: c.nombre,
          empresa: c.empresa,
          telefono: c.telefono,
          telefono_usado: c.telefono_usado
        })), // Primeros 10 como muestra
        detalles_errores: [...errors, ...result.errors].slice(0, 10) // Primeros 10 errores para debugging
      }
    });
  } catch (error) {
    console.error('Error procesando CSV:', error);
    
    // Limpiar archivo temporal si existe
    if (req.file && req.file.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (e) {
        // Ignorar error al eliminar
      }
    }

    res.status(500).json({
      success: false,
      error: error.message || 'Error procesando el archivo CSV'
    });
  }
}

