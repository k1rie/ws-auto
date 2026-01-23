import { getAllContactosPendientes } from '../models/contactosModel.js';
import { incrementMensajesEnviados, checkAndUpdateFase } from '../models/conexionesModel.js';
import { updateContactoEstado } from '../models/contactosModel.js';
import { getFaseConfig } from '../models/fasesModel.js';
import { getGlobalDaysOfWeek } from '../models/configuracionModel.js';
import conexionesService from '../services/conexionesService.js';
import baileysController from '../controllers/baileysController.js';
import { formatForWhatsApp } from '../utils/phoneUtils.js';

/**
 * Servicio de envío automático de mensajes
 * Distribuye mensajes a lo largo del día según las fases de cada conexión
 */
class MensajeriaService {
  constructor() {
    this.isRunning = false;
    this.currentBatch = null;
    this.isPaused = false;
  }

  /**
   * Obtiene los días de envío globales (configuración del sistema)
   * Esta configuración se aplica a TODOS los contactos
   */
  async getGlobalDaysOfWeek() {
    try {
      return await getGlobalDaysOfWeek();
    } catch (error) {
      console.warn('[WARN] Error obteniendo días de envío globales, usando todos los días:', error.message);
      return [0, 1, 2, 3, 4, 5, 6];
    }
  }

  /**
   * Verifica si hoy es un día permitido para enviar mensajes (usando configuración global)
   */
  async isDiaPermitidoHoy() {
    const today = new Date().getDay();
    const dias = await this.getGlobalDaysOfWeek();
    return dias.includes(today);
  }

  /**
   * Inicia el servicio de envío automático
   */
  async start() {
    if (this.isRunning) {
      console.log('[WARN] Servicio de mensajería ya está corriendo');
      return;
    }

    this.isRunning = true;
    console.log('[INFO] Servicio de mensajería automática iniciado');
  }

  /**
   * Detiene el servicio de envío automático
   */
  stop() {
    this.isRunning = false;
    console.log('[INFO] Servicio de mensajería automática detenido');
  }

  /**
   * Procesa el envío de mensajes pendientes
   */
  async procesarEnvio() {
    if (this.isPaused) {
      console.log('[INFO] Envío de mensajes está pausado');
      return;
    }

    if (this.currentBatch) {
      console.log('[INFO] Procesamiento de lote anterior aún en curso, esperando...');
      return;
    }

    try {
      this.currentBatch = true;
      
      // Obtener todos los contactos pendientes
      const contactosPendientes = await getAllContactosPendientes(1000); // Máximo 1000 por lote
      
      if (contactosPendientes.length === 0) {
        console.log('[INFO] No hay contactos pendientes para enviar');
        return;
      }

      console.log(`[INFO] Procesando ${contactosPendientes.length} contactos pendientes...`);

      // Obtener todas las conexiones disponibles
      const conexionesDisponibles = await this.getConexionesDisponibles();
      
      if (conexionesDisponibles.length === 0) {
        console.log('[WARN] No hay conexiones disponibles para enviar mensajes');
        return;
      }

      console.log(`[INFO] ${conexionesDisponibles.length} conexión(es) disponible(s)`);

      // Verificar si hoy es un día permitido para enviar (configuración global)
      const puedeEnviarHoy = await this.isDiaPermitidoHoy();
      if (!puedeEnviarHoy) {
        const diasPermitidos = await this.getGlobalDaysOfWeek();
        const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
        const diasNombres = diasPermitidos.map(d => dayNames[d]).join(', ');
        console.log(`[INFO] Hoy no es un día permitido para enviar mensajes. Días permitidos: ${diasNombres}`);
        return;
      }

      // Todos los contactos pendientes son elegibles si hoy es un día permitido
      const contactosElegibles = contactosPendientes;

      // Distribuir contactos entre conexiones disponibles
      let contactosEnviados = 0;
      let contactosError = 0;

      for (const { conexion, faseConfig, socket } of conexionesDisponibles) {
        if (contactosElegibles.length === 0) break;

        // Calcular cuántos mensajes puede enviar esta conexión
        const mensajesRestantes = faseConfig.mensajes_por_numero_por_dia - conexion.mensajes_enviados_hoy;
        
        if (mensajesRestantes <= 0) {
          console.log(`[INFO] Conexión ${conexion.whatsapp_id} ha alcanzado su límite diario (${conexion.mensajes_enviados_hoy}/${faseConfig.mensajes_por_numero_por_dia})`);
          // No cerrar la conexión, solo saltarla para este lote
          continue;
        }

        // Obtener contactos pendientes (cualquier contacto, sin importar conexión)
        // Cualquier conexión puede enviar a cualquier contacto pendiente
        const contactosParaEnviar = contactosElegibles.slice(0, Math.min(mensajesRestantes, contactosElegibles.length));

        if (contactosParaEnviar.length === 0) {
          continue;
        }

        console.log(`[INFO] Enviando ${contactosParaEnviar.length} mensajes desde ${conexion.whatsapp_id}...`);

        // Obtener lapso de distribución de la fase (en cuántas horas distribuir los mensajes)
        const lapsoHoras = faseConfig.lapso_distribucion_horas || 8;
        
        // Obtener la hora actual del día
        const ahora = new Date();
        const horaActual = ahora.getHours();
        const minutosActuales = ahora.getMinutes();
        const segundosActuales = ahora.getSeconds();
        
        // Calcular el tiempo transcurrido desde el inicio del día (en milisegundos)
        const tiempoInicioDelDia = new Date(ahora);
        tiempoInicioDelDia.setHours(0, 0, 0, 0);
        const tiempoTranscurridoDelDia = ahora.getTime() - tiempoInicioDelDia.getTime();
        
        // Calcular el tiempo total del lapso de distribución (en milisegundos)
        const tiempoTotalLapso = lapsoHoras * 60 * 60 * 1000; // lapsoHoras horas en milisegundos
        
        // Calcular cuánto tiempo ha pasado dentro del lapso de distribución
        // Si ya pasamos el lapso, considerar que estamos al final
        const tiempoEnLapso = Math.min(tiempoTranscurridoDelDia, tiempoTotalLapso);
        const tiempoRestanteEnLapso = tiempoTotalLapso - tiempoEnLapso;
        
        // Distribuir los mensajes a lo largo del tiempo restante del lapso
        // Cada mensaje tendrá un delay calculado para distribuirse uniformemente
        const delayPromedio = tiempoRestanteEnLapso / Math.max(contactosParaEnviar.length, 1);
        const variacion = 0.3; // ±30% de variación para hacerlo más aleatorio y natural
        
        console.log(`[INFO] Distribuyendo ${contactosParaEnviar.length} mensajes en ${lapsoHoras} horas. Tiempo restante: ${(tiempoRestanteEnLapso / (60 * 1000)).toFixed(1)} minutos`);

        // Enviar mensajes con delays distribuidos aleatoriamente
        for (let i = 0; i < contactosParaEnviar.length; i++) {
          const contacto = contactosParaEnviar[i];
          
          // Calcular delay aleatorio dentro del tiempo restante
          // Distribuir uniformemente pero con variación aleatoria
          const variacionAleatoria = (Math.random() * 2 - 1) * variacion; // -0.3 a +0.3
          const delay = Math.max(5000, delayPromedio * (1 + variacionAleatoria)); // Mínimo 5 segundos entre mensajes
          
          // Esperar antes de enviar (excepto el primero)
          if (i > 0) {
            const delayEnMinutos = (delay / (60 * 1000)).toFixed(1);
            console.log(`[INFO] Esperando ${delayEnMinutos} minutos antes del siguiente mensaje...`);
            await this.sleep(delay);
          }

          // Intentar usar cualquiera de los 3 números disponibles
          // Prioridad: telefono (principal) -> telefono_mobile -> telefono_corporate -> telefono_other
          // Definir antes del try para que esté disponible en el catch
          let telefonoAUsar = contacto.telefono || 
                             contacto.telefono_mobile || 
                             contacto.telefono_corporate || 
                             contacto.telefono_other;

          try {
            if (!telefonoAUsar) {
              throw new Error('No hay teléfono disponible');
            }
            
            // Formatear teléfono
            const telefonoFormateado = formatForWhatsApp(telefonoAUsar);
            if (!telefonoFormateado) {
              throw new Error('Teléfono inválido');
            }

            // Preparar mensaje
            const mensaje = contacto.mensaje_personalizado || 
                          `Hola ${contacto.nombre || ''}, te contactamos desde ${contacto.empresa || 'nuestra empresa'}.`;

            // Enviar mensaje usando Baileys
            // Baileys usa formato @s.whatsapp.net y no tiene el problema de markedUnread
            const jid = telefonoFormateado; // Ya viene con @s.whatsapp.net de formatForWhatsApp
            
            // Enviar mensaje con Baileys (formato: { text: 'mensaje' })
            await socket.sendMessage(jid, { text: mensaje });

            // Actualizar contacto (registrar qué conexión lo envió)
            await updateContactoEstado(contacto.id, 'enviado', null, conexion.id);

            // Incrementar contador
            await incrementMensajesEnviados(conexion.whatsapp_id, 1);

            contactosEnviados++;
            console.log(`[INFO] Mensaje enviado a ${telefonoAUsar} desde ${conexion.whatsapp_id}`);

            // Remover de la lista de pendientes
            const index = contactosElegibles.findIndex(c => c.id === contacto.id);
            if (index > -1) {
              contactosElegibles.splice(index, 1);
            }

          } catch (error) {
            // Detectar errores específicos de WhatsApp
            let errorMessage = error.message;
            let errorType = 'error';
            
            // Usar telefonoAUsar si está disponible, sino usar un valor por defecto
            const telefonoParaLog = telefonoAUsar || contacto.id || 'desconocido';
            
            // Error "No LID for user" - número no registrado en WhatsApp
            if (error.message && error.message.includes('No LID for user')) {
              errorMessage = 'Número no registrado en WhatsApp o no existe';
              errorType = 'numero_no_registrado';
              console.error(`[ERROR] Error enviando mensaje a ${telefonoParaLog}: ${errorMessage}`);
            } else {
              console.error(`[ERROR] Error enviando mensaje a ${telefonoParaLog}:`, error.message);
            }
            
            await updateContactoEstado(contacto.id, errorType, errorMessage, conexion.id);
            contactosError++;

            // Remover de la lista de pendientes
            const index = contactosElegibles.findIndex(c => c.id === contacto.id);
            if (index > -1) {
              contactosElegibles.splice(index, 1);
            }
          }
        }
      }

      console.log(`[INFO] Lote procesado: ${contactosEnviados} enviados, ${contactosError} errores`);

    } catch (error) {
      console.error('[ERROR] Error en procesamiento de envío:', error);
    } finally {
      this.currentBatch = null;
    }
  }

  /**
   * Obtiene todas las conexiones disponibles para enviar mensajes
   */
  async getConexionesDisponibles() {
    const conexionesDisponibles = [];
    const razonesExclusion = [];

    // Obtener todas las conexiones activas
    const { getConexionesActivas } = await import('../models/conexionesModel.js');
    const conexiones = await getConexionesActivas();

    console.log(`[INFO] Total de conexiones activas en BD: ${conexiones.length}`);

    for (const conexion of conexiones) {
      const whatsappId = conexion.whatsapp_id;
      console.log(`[INFO] Evaluando conexión: ${whatsappId}`);
      
      // Verificar y actualizar fase si es necesario
      const updatedConexion = await checkAndUpdateFase(whatsappId);
      console.log(`[INFO]   - Fase actual: ${updatedConexion.fase_actual}`);
      
      // Obtener configuración de fase
      const faseConfig = await getFaseConfig(updatedConexion.fase_actual);
      
      if (!faseConfig) {
        console.log(`[INFO]   - ✗ Sin configuración de fase para fase ${updatedConexion.fase_actual}`);
        razonesExclusion.push(`${whatsappId}: Sin configuración de fase`);
        continue;
      }
      console.log(`[INFO]   - Configuración de fase encontrada: ${faseConfig.mensajes_por_numero_por_dia} mensajes/día`);

      // Verificar límite diario
      const mensajesEnviadosHoy = updatedConexion.mensajes_enviados_hoy || 0;
      const mensajesRestantes = faseConfig.mensajes_por_numero_por_dia - mensajesEnviadosHoy;
      console.log(`[INFO]   - Mensajes enviados hoy: ${mensajesEnviadosHoy}/${faseConfig.mensajes_por_numero_por_dia}, restantes: ${mensajesRestantes}`);
      
      if (mensajesRestantes <= 0) {
        console.log(`[INFO]   - ✗ Límite diario alcanzado`);
        razonesExclusion.push(`${whatsappId}: Límite diario alcanzado (${mensajesEnviadosHoy}/${faseConfig.mensajes_por_numero_por_dia})`);
        continue;
      }

      // Verificar que tenga socket activo
      const socket = conexionesService.getSocketByWhatsAppId(whatsappId);
      if (!socket) {
        console.log(`[INFO]   - ✗ Sin socket activo`);
        razonesExclusion.push(`${whatsappId}: Sin socket activo`);
        continue;
      }
      console.log(`[INFO]   - Socket encontrado`);

      // Verificar que el cliente esté listo usando el socket directamente
      // Esto evita problemas cuando el whatsappId en BD difiere del ID usado para inicializar el cliente
      try {
        let clientInfo = null;
        let isReady = false;
        
        // Verificar que el socket de Baileys esté listo
        // Baileys usa socket.user en lugar de socket.info
        try {
          const user = socket.user;
          isReady = !!user;
          if (user) {
            console.log(`[INFO]   - Socket de Baileys está listo: OK`);
            console.log(`[INFO]   - Número del cliente: ${user.id?.split('@')[0] || 'N/A'}`);
            clientInfo = user; // Para compatibilidad
          } else {
            console.log(`[INFO]   - Socket de Baileys no está listo (user es NULL)`);
          }
        } catch (socketError) {
          console.log(`[INFO]   - Error obteniendo user del socket: ${socketError.message}`);
          // Fallback: intentar con getStatus usando el whatsappId
          try {
            const status = await baileysController.getStatus(whatsappId);
            isReady = status.ready;
            console.log(`[INFO]   - Estado del socket (fallback): ready=${status.ready}, message=${status.message}`);
          } catch (statusError) {
            console.log(`[INFO]   - Error obteniendo estado: ${statusError.message}`);
          }
        }
        
        // El cliente está listo solo si clientInfo existe (o isReady es true como fallback)
        if (!isReady && !clientInfo) {
          const razon = `${whatsappId}: Cliente no está listo (ready=${isReady}, info=${clientInfo ? 'OK' : 'NULL'})`;
          console.log(`[INFO]   - ✗ ${razon}`);
          razonesExclusion.push(razon);
          continue;
        }
      } catch (e) {
        const razon = `${whatsappId}: Error verificando cliente (${e.message})`;
        console.log(`[INFO]   - ✗ ${razon}`);
        razonesExclusion.push(razon);
        continue;
      }

      console.log(`[INFO]   - ✓ Conexión disponible: ${whatsappId}`);
      conexionesDisponibles.push({
        conexion: updatedConexion,
        faseConfig,
        socket
      });
    }

    if (conexionesDisponibles.length === 0 && razonesExclusion.length > 0) {
      console.log(`[WARN] ===== RAZONES DE EXCLUSIÓN DE CONEXIONES =====`);
      razonesExclusion.forEach(razon => console.log(`[WARN]   - ${razon}`));
      console.log(`[WARN] ==============================================`);
    }

    // Ordenar por fase (mayor primero) y luego por mensajes restantes (más primero)
    conexionesDisponibles.sort((a, b) => {
      if (a.conexion.fase_actual !== b.conexion.fase_actual) {
        return b.conexion.fase_actual - a.conexion.fase_actual;
      }
      
      const restantesA = a.faseConfig.mensajes_por_numero_por_dia - a.conexion.mensajes_enviados_hoy;
      const restantesB = b.faseConfig.mensajes_por_numero_por_dia - b.conexion.mensajes_enviados_hoy;
      return restantesB - restantesA;
    });

    console.log(`[INFO] Conexiones disponibles finales: ${conexionesDisponibles.length}`);
    
    // Guardar razones de exclusión para que puedan ser accedidas desde sendAllNow
    this.lastExclusionReasons = razonesExclusion;
    
    return conexionesDisponibles;
  }

  /**
   * Sleep helper
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Pausa el envío de mensajes
   */
  pause() {
    this.isPaused = true;
    console.log('[INFO] Envío de mensajes pausado');
  }

  /**
   * Reanuda el envío de mensajes
   */
  resume() {
    this.isPaused = false;
    console.log('[INFO] Envío de mensajes reanudado');
  }

  /**
   * Obtiene el estado del servicio
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      hasActiveBatch: !!this.currentBatch
    };
  }

  /**
   * Fuerza el procesamiento inmediato de mensajes pendientes
   * Útil cuando se actualizan números en la base de datos y se quiere procesar de inmediato
   */
  async forceProcess() {
    if (this.currentBatch) {
      throw new Error('Ya hay un procesamiento en curso. Por favor espera a que termine.');
    }

    console.log('[INFO] Forzando procesamiento inmediato de mensajes...');
    await this.procesarEnvio();
    return {
      success: true,
      message: 'Procesamiento completado'
    };
  }

  /**
   * Envía todos los mensajes pendientes inmediatamente
   * Usa delays mínimos (2-3 segundos) entre mensajes para evitar problemas con WhatsApp
   */
  async sendAllNow() {
    if (this.isPaused) {
      throw new Error('El envío de mensajes está pausado. Reanuda el envío primero.');
    }

    if (this.currentBatch) {
      throw new Error('Ya hay un procesamiento en curso. Por favor espera a que termine.');
    }

    try {
      this.currentBatch = true;
      console.log('[INFO] ===== INICIANDO ENVÍO INMEDIATO DE TODOS LOS MENSAJES =====');
      
      // Obtener TODOS los contactos pendientes sin filtrar por fecha_proximo_envio
      // ya que el usuario quiere enviar todo inmediatamente
      const { query } = await import('../config/database.js');
      
      // Primero, corregir contactos con estado vacío o NULL a 'pendiente'
      await query("UPDATE contactos SET estado = 'pendiente' WHERE estado IS NULL OR estado = ''");
      
      // Primero verificar cuántos contactos hay en total con estado pendiente (incluyendo NULL y vacío)
      const [countResult] = await query("SELECT COUNT(*) as total FROM contactos WHERE estado = 'pendiente' OR estado IS NULL OR estado = ''");
      const totalPendientes = countResult?.total || 0;
      console.log(`[INFO] Total de contactos con estado 'pendiente' (o vacío/NULL) en BD: ${totalPendientes}`);
      
      // Verificar todos los estados para debugging
      const estadosCount = await query("SELECT estado, COUNT(*) as count FROM contactos GROUP BY estado");
      console.log(`[INFO] Distribución de estados en BD:`, estadosCount);
      
      // Obtener algunos contactos de ejemplo para ver qué estados tienen
      const ejemplos = await query("SELECT id, nombre, estado, fecha_proximo_envio FROM contactos LIMIT 5");
      console.log(`[INFO] Ejemplos de contactos (primeros 5):`, ejemplos);
      
      // Obtener contactos pendientes (incluyendo NULL y vacío por si acaso)
      const contactosPendientes = await query(
        "SELECT * FROM contactos WHERE estado = 'pendiente' OR estado IS NULL OR estado = '' ORDER BY fecha_creacion ASC"
      );
      
      console.log(`[INFO] Contactos pendientes encontrados: ${contactosPendientes.length}`);
      
      if (contactosPendientes.length === 0) {
        console.log('[INFO] No hay contactos pendientes para enviar');
        return {
          success: true,
          message: 'No hay contactos pendientes',
          enviados: 0,
          errores: 0,
          totalPendientes: totalPendientes
        };
      }
      
      // Log de los primeros contactos para debugging
      if (contactosPendientes.length > 0) {
        console.log(`[INFO] Primer contacto pendiente: ID=${contactosPendientes[0].id}, nombre=${contactosPendientes[0].nombre}, telefono=${contactosPendientes[0].telefono}, fecha_proximo_envio=${contactosPendientes[0].fecha_proximo_envio}`);
      }

      console.log(`[INFO] Procesando ${contactosPendientes.length} contactos pendientes inmediatamente...`);

      // Verificar si hoy es un día permitido
      const puedeEnviarHoy = await this.isDiaPermitidoHoy();
      if (!puedeEnviarHoy) {
        const diasPermitidos = await this.getGlobalDaysOfWeek();
        const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
        const diasNombres = diasPermitidos.map(d => dayNames[d]).join(', ');
        throw new Error(`Hoy no es un día permitido para enviar mensajes. Días permitidos: ${diasNombres}`);
      }

      // Obtener todas las conexiones disponibles
      const conexionesDisponibles = await this.getConexionesDisponibles();
      
      if (conexionesDisponibles.length === 0) {
        // Obtener información adicional para el error
        const { getConexionesActivas } = await import('../models/conexionesModel.js');
        const todasLasConexiones = await getConexionesActivas();
        const socketsActivos = todasLasConexiones.filter(c => {
          const socket = conexionesService.getSocketByWhatsAppId(c.whatsapp_id);
          return socket !== null;
        });
        
        // Obtener las razones de exclusión que se guardaron en getConexionesDisponibles
        const razonesExclusion = this.lastExclusionReasons || [];
        
        let errorMsg = 'No hay conexiones disponibles para enviar mensajes.\n\n';
        errorMsg += `Resumen:\n`;
        errorMsg += `- Conexiones en BD: ${todasLasConexiones.length}\n`;
        errorMsg += `- Sockets activos: ${socketsActivos.length}\n`;
        errorMsg += `- Conexiones disponibles: 0\n\n`;
        
        if (razonesExclusion.length > 0) {
          errorMsg += `Razones de exclusión:\n`;
          razonesExclusion.forEach(razon => {
            errorMsg += `- ${razon}\n`;
          });
        } else {
          errorMsg += `No se encontraron razones específicas. Revisa los logs del servidor.`;
        }
        
        throw new Error(errorMsg);
      }

      console.log(`[INFO] ${conexionesDisponibles.length} conexión(es) disponible(s)`);

      let contactosEnviados = 0;
      let contactosError = 0;
      const contactosElegibles = [...contactosPendientes];

      // Distribuir contactos entre todas las conexiones disponibles
      for (const { conexion, faseConfig, socket } of conexionesDisponibles) {
        if (contactosElegibles.length === 0) break;

        // Calcular cuántos mensajes puede enviar esta conexión
        const mensajesRestantes = faseConfig.mensajes_por_numero_por_dia - conexion.mensajes_enviados_hoy;
        
        if (mensajesRestantes <= 0) {
          console.log(`[INFO] Conexión ${conexion.whatsapp_id} ha alcanzado su límite diario`);
          continue;
        }

        // Obtener contactos para esta conexión
        const contactosParaEnviar = contactosElegibles.splice(0, Math.min(mensajesRestantes, contactosElegibles.length));

        if (contactosParaEnviar.length === 0) {
          continue;
        }

        console.log(`[INFO] Enviando ${contactosParaEnviar.length} mensajes desde ${conexion.whatsapp_id} (envío inmediato)...`);

        // Enviar mensajes con delay mínimo (2-3 segundos entre mensajes)
        for (let i = 0; i < contactosParaEnviar.length; i++) {
          const contacto = contactosParaEnviar[i];
          
          // Delay mínimo entre mensajes (2-3 segundos)
          if (i > 0) {
            const delay = 2000 + Math.random() * 1000; // 2-3 segundos
            await this.sleep(delay);
          }

          let telefonoAUsar = contacto.telefono || 
                             contacto.telefono_mobile || 
                             contacto.telefono_corporate || 
                             contacto.telefono_other;

          try {
            if (!telefonoAUsar) {
              throw new Error('No hay teléfono disponible');
            }
            
            const telefonoFormateado = formatForWhatsApp(telefonoAUsar);
            if (!telefonoFormateado) {
              throw new Error('Teléfono inválido');
            }

            const mensaje = contacto.mensaje_personalizado || 
                          `Hola ${contacto.nombre || ''}, te contactamos desde ${contacto.empresa || 'nuestra empresa'}.`;

            // Enviar mensaje usando Baileys
            // Baileys usa formato @s.whatsapp.net y no tiene el problema de markedUnread
            const jid = telefonoFormateado; // Ya viene con @s.whatsapp.net de formatForWhatsApp
            
            // Log del formato para debugging
            console.log(`[INFO] Formato de número: ${telefonoAUsar} -> ${telefonoFormateado} (JID: ${jid})`);
            
            // Con Baileys, el envío es más simple y no necesita preparación previa
            // Solo necesitamos un reintento simple en caso de error temporal
            let mensajeEnviado = false;
            let ultimoError = null;
            
            // Intentar enviar con un máximo de 2 reintentos
            for (let intento = 0; intento < 2; intento++) {
              try {
                if (intento > 0) {
                  // Esperar 2 segundos antes de reintentar
                  console.log(`[INFO] Reintentando envío a ${telefonoAUsar} (intento ${intento + 1}/2)...`);
                  await this.sleep(2000);
                }
                
                // Enviar mensaje con Baileys (formato: { text: 'mensaje' })
                await socket.sendMessage(jid, { text: mensaje });
                
                mensajeEnviado = true;
                console.log(`[INFO] Mensaje enviado exitosamente a ${telefonoAUsar} en intento ${intento + 1}`);
                break;
              } catch (sendError) {
                ultimoError = sendError;
                const errorMsg = sendError.message || sendError.toString();
                
                // Si es un error definitivo (número no registrado), no reintentar
                if (errorMsg.includes('not registered') || errorMsg.includes('not found')) {
                  throw sendError;
                }
                
                // Para otros errores, reintentar una vez
                if (intento === 0) {
                  console.log(`[INFO] Error temporal al enviar a ${telefonoAUsar}: ${errorMsg.substring(0, 100)}..., reintentando...`);
                  continue;
                }
                
                // Si ya se intentó 2 veces, lanzar el error
                throw sendError;
              }
            }
            
            if (!mensajeEnviado && ultimoError) {
              throw ultimoError;
            }

            // Actualizar contacto
            await updateContactoEstado(contacto.id, 'enviado', null, conexion.id);
            await incrementMensajesEnviados(conexion.whatsapp_id, 1);

            contactosEnviados++;
            console.log(`[INFO] ✓ Mensaje enviado a ${telefonoAUsar} desde ${conexion.whatsapp_id}`);

          } catch (error) {
            let errorMessage = error.message;
            let errorType = 'error';
            
            const telefonoParaLog = telefonoAUsar || contacto.id || 'desconocido';
            
            if (error.message && (error.message.includes('No LID for user') || error.message.includes('not registered'))) {
              errorMessage = 'Número no registrado en WhatsApp o no existe';
              errorType = 'numero_no_registrado';
            } else if (error.message && (error.message.includes('markedUnread') || error.message.includes('sendSeen'))) {
              errorMessage = 'Error temporal de WhatsApp Web al enviar mensaje. Intenta nuevamente más tarde.';
              errorType = 'error_temporal';
            }
            
            console.error(`[ERROR] ✗ Error enviando mensaje a ${telefonoParaLog}: ${errorMessage}`);
            
            await updateContactoEstado(contacto.id, errorType, errorMessage, conexion.id);
            contactosError++;
          }
        }
      }

      console.log(`[INFO] ===== ENVÍO COMPLETADO: ${contactosEnviados} enviados, ${contactosError} errores =====`);

      return {
        success: true,
        message: `Envío completado: ${contactosEnviados} enviados, ${contactosError} errores`,
        enviados: contactosEnviados,
        errores: contactosError,
        total: contactosPendientes.length
      };

    } catch (error) {
      console.error('[ERROR] Error en envío inmediato:', error);
      throw error;
    } finally {
      this.currentBatch = null;
    }
  }
}

// Exportar instancia singleton
export default new MensajeriaService();

