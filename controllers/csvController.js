import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import { createContactosBulk } from '../models/contactosModel.js';
import { getConexionByWhatsAppId } from '../models/conexionesModel.js';
import conexionesService from '../services/conexionesService.js';
import whatsappVerificationService from '../services/whatsappVerificationService.js';

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
            
            // Limpiar cada teléfono (quitar caracteres no numéricos y normalizar números mexicanos)
            const cleanPhone = (phone) => {
              if (!phone) return null;
              let cleaned = phone.toString().trim().replace(/\D/g, '');
              
              if (!cleaned || cleaned === '') return null;
              
              // Normalizar números mexicanos: agregar "1" después de "52" si falta
              // Formato correcto: 521XXXXXXXXXX (12 dígitos)
              if (cleaned.startsWith('52') && cleaned.length === 11) {
                // Agregar el "1" después del "52"
                cleaned = '521' + cleaned.substring(2);
              } else if (cleaned.startsWith('52') && cleaned.length === 12 && cleaned[2] !== '1') {
                // Si tiene 12 dígitos pero el tercer dígito no es "1", agregarlo
                cleaned = '521' + cleaned.substring(2);
              }
              
              return cleaned;
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
        telefono: contactos[0].telefono
      });
    }
    if (errors.length > 0) {
      console.log(`❌ Primer error:`, errors[0]);
    }

    // Verificar números en WhatsApp usando whatsapp-web.js
    console.log(`🔍 Verificando números en WhatsApp...`);
    const contactosVerificados = [];
    const contactosRechazados = [];

    // Verificar si hay una conexión disponible (OBLIGATORIO)
    const hayConexionDisponible = await whatsappVerificationService.isAvailable();
    
    if (!hayConexionDisponible) {
      console.log(`❌ No hay conexión activa de WhatsApp disponible. No se pueden subir contactos sin verificación.`);
      
      // Limpiar archivo temporal
      fs.unlinkSync(filePath);
      
      return res.status(400).json({
        success: false,
        error: 'No se puede procesar el CSV sin una conexión activa de WhatsApp',
        message: 'Se requiere al menos una conexión activa de WhatsApp para verificar los números antes de agregarlos. Por favor, conecta al menos un número de WhatsApp antes de subir contactos.',
        data: {
          total: contactos.length + errors.length,
          contactos_procesados: contactos.length,
          errores: errors.length
        }
      });
    }

    // Recopilar todos los números únicos para verificar
    const numerosUnicos = new Set();
    const contactoPorNumero = new Map(); // Mapa para rastrear qué contactos tienen cada número

    for (const contacto of contactos) {
      const telefonos = [
        contacto.telefono,
        contacto.telefono_mobile,
        contacto.telefono_corporate,
        contacto.telefono_other
      ].filter(t => t); // Filtrar nulos

      for (const telefono of telefonos) {
        numerosUnicos.add(telefono);
        if (!contactoPorNumero.has(telefono)) {
          contactoPorNumero.set(telefono, []);
        }
        contactoPorNumero.get(telefono).push(contacto);
      }
    }

    console.log(`📊 Verificando ${numerosUnicos.size} números únicos...`);

    // Verificar todos los números en lote
    const resultadosVerificacion = await whatsappVerificationService.verifyBatch(Array.from(numerosUnicos));

    // Procesar resultados y construir contactos verificados
    const contactosProcesados = new Set(); // Para evitar duplicados

    for (const contacto of contactos) {
      const contactoId = `${contacto.nombre || ''}_${contacto.empresa || ''}`;
      if (contactosProcesados.has(contactoId)) {
        continue; // Ya procesado
      }
      contactosProcesados.add(contactoId);

      let tieneNumeroValido = false;
      const telefonosVerificados = {
        telefono: null,
        telefono_mobile: null,
        telefono_corporate: null,
        telefono_other: null
      };

      // Verificar cada número disponible en orden de prioridad
      const telefonosParaVerificar = [
        { key: 'telefono', value: contacto.telefono },
        { key: 'telefono_mobile', value: contacto.telefono_mobile },
        { key: 'telefono_corporate', value: contacto.telefono_corporate },
        { key: 'telefono_other', value: contacto.telefono_other }
      ];

      for (const { key, value } of telefonosParaVerificar) {
        if (!value) continue;

        // Verificar si el número está registrado según los resultados
        const estaRegistrado = resultadosVerificacion.get(value);

        if (estaRegistrado === true) {
          telefonosVerificados[key] = value;
          if (!tieneNumeroValido) {
            // El primer número válido será el teléfono principal
            telefonosVerificados.telefono = value;
            tieneNumeroValido = true;
          }
          console.log(`✅ Número ${value} verificado y está en WhatsApp`);
        } else {
          console.log(`❌ Número ${value} no está registrado en WhatsApp`);
        }
      }

      // Si tiene al menos un número válido, agregar el contacto
      if (tieneNumeroValido) {
        contactosVerificados.push({
          nombre: contacto.nombre,
          empresa: contacto.empresa,
          cargo: contacto.cargo,
          telefono: telefonosVerificados.telefono,
          telefono_mobile: telefonosVerificados.telefono_mobile,
          telefono_corporate: telefonosVerificados.telefono_corporate,
          telefono_other: telefonosVerificados.telefono_other,
          mensaje_personalizado: contacto.mensaje_personalizado
        });
      } else {
        // Si ningún número está en WhatsApp, no agregar el contacto
        contactosRechazados.push({
          nombre: contacto.nombre || 'Sin nombre',
          empresa: contacto.empresa || 'Sin empresa',
          razon: 'Ninguno de los números está registrado en WhatsApp'
        });
        errors.push({
          row: {
            nombre: contacto.nombre || 'Sin nombre',
            empresa: contacto.empresa || 'Sin empresa'
          },
          error: 'Ninguno de los números está registrado en WhatsApp'
        });
      }
    }

    console.log(`✅ Verificación completada: ${contactosVerificados.length} contactos válidos, ${contactosRechazados.length} rechazados`);

    // Guardar solo los contactos verificados en base de datos
    const result = await createContactosBulk(conexionId, contactosVerificados);

    // Limpiar archivo temporal
    fs.unlinkSync(filePath);

    // Respuesta con información detallada
    console.log(`💾 Base de datos: ${result.inserted} insertados, ${result.errors.length} errores de BD`);
    
    res.json({
      success: true,
      message: 'CSV procesado exitosamente con verificación de WhatsApp',
      data: {
        total: contactos.length + errors.length,
        verificados: contactosVerificados.length,
        rechazados: contactosRechazados.length,
        guardados: result.inserted,
        errores: errors.length + result.errors.length,
        contactos: contactosVerificados.slice(0, 10).map(c => ({
          nombre: c.nombre,
          empresa: c.empresa,
          telefono: c.telefono
        })), // Primeros 10 como muestra
        contactos_rechazados: contactosRechazados.slice(0, 10), // Primeros 10 rechazados
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

