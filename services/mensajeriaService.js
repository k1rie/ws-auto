import { getAllContactosPendientes } from '../models/contactosModel.js';
import { incrementMensajesEnviados, checkAndUpdateFase } from '../models/conexionesModel.js';
import { updateContactoEstado } from '../models/contactosModel.js';
import { getFaseConfig } from '../models/fasesModel.js';
import conexionesService from '../services/conexionesService.js';
import whatsappController from '../controllers/whatsappController.js';
import { formatForWhatsApp } from '../utils/phoneUtils.js';

/**
 * Servicio de envío automático de mensajes
 * Distribuye mensajes a lo largo del día según las fases de cada conexión
 */
class MensajeriaService {
  constructor() {
    this.isRunning = false;
    this.currentBatch = null;
  }

  /**
   * Inicia el servicio de envío automático
   */
  async start() {
    if (this.isRunning) {
      console.log('⚠️  Servicio de mensajería ya está corriendo');
      return;
    }

    this.isRunning = true;
    console.log('🚀 Servicio de mensajería automática iniciado');
    
    // Ejecutar cada 5 minutos
    this.interval = setInterval(async () => {
      await this.procesarEnvio();
    }, 5 * 60 * 1000); // 5 minutos

    // Ejecutar inmediatamente
    await this.procesarEnvio();
  }

  /**
   * Detiene el servicio de envío automático
   */
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.isRunning = false;
    console.log('🛑 Servicio de mensajería automática detenido');
  }

  /**
   * Procesa el envío de mensajes pendientes
   */
  async procesarEnvio() {
    if (this.currentBatch) {
      console.log('⏳ Procesamiento de lote anterior aún en curso, esperando...');
      return;
    }

    try {
      this.currentBatch = true;
      
      // Obtener todos los contactos pendientes
      const contactosPendientes = await getAllContactosPendientes(1000); // Máximo 1000 por lote
      
      if (contactosPendientes.length === 0) {
        console.log('📭 No hay contactos pendientes para enviar');
        return;
      }

      console.log(`📬 Procesando ${contactosPendientes.length} contactos pendientes...`);

      // Obtener todas las conexiones disponibles
      const conexionesDisponibles = await this.getConexionesDisponibles();
      
      if (conexionesDisponibles.length === 0) {
        console.log('⚠️  No hay conexiones disponibles para enviar mensajes');
        return;
      }

      console.log(`📱 ${conexionesDisponibles.length} conexión(es) disponible(s)`);

      // Distribuir contactos entre conexiones disponibles
      let contactosEnviados = 0;
      let contactosError = 0;

      for (const { conexion, faseConfig, socket } of conexionesDisponibles) {
        if (contactosPendientes.length === 0) break;

        // Calcular cuántos mensajes puede enviar esta conexión
        const mensajesRestantes = faseConfig.mensajes_por_numero_por_dia - conexion.mensajes_enviados_hoy;
        
        if (mensajesRestantes <= 0) {
          console.log(`⏸️  Conexión ${conexion.whatsapp_id} ha alcanzado su límite diario (${conexion.mensajes_enviados_hoy}/${faseConfig.mensajes_por_numero_por_dia})`);
          // No cerrar la conexión, solo saltarla para este lote
          continue;
        }

        // Obtener contactos pendientes (cualquier contacto, sin importar conexión)
        // Cualquier conexión puede enviar a cualquier contacto pendiente
        const contactosParaEnviar = contactosPendientes.slice(0, Math.min(mensajesRestantes, contactosPendientes.length));

        if (contactosParaEnviar.length === 0) {
          continue;
        }

        console.log(`📤 Enviando ${contactosParaEnviar.length} mensajes desde ${conexion.whatsapp_id}...`);

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
        
        console.log(`⏰ Distribuyendo ${contactosParaEnviar.length} mensajes en ${lapsoHoras} horas. Tiempo restante: ${(tiempoRestanteEnLapso / (60 * 1000)).toFixed(1)} minutos`);

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
            console.log(`⏳ Esperando ${delayEnMinutos} minutos antes del siguiente mensaje...`);
            await this.sleep(delay);
          }

          try {
            // Intentar usar cualquiera de los 3 números disponibles
            // Prioridad: telefono (principal) -> telefono_mobile -> telefono_corporate -> telefono_other
            let telefonoAUsar = contacto.telefono || 
                               contacto.telefono_mobile || 
                               contacto.telefono_corporate || 
                               contacto.telefono_other;
            
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

            // Enviar mensaje
            await whatsappController.sendMessage(
              conexion.whatsapp_id,
              telefonoFormateado,
              mensaje
            );

            // Actualizar contacto (registrar qué conexión lo envió)
            await updateContactoEstado(contacto.id, 'enviado', null, conexion.id);

            // Incrementar contador
            await incrementMensajesEnviados(conexion.whatsapp_id, 1);

            contactosEnviados++;
            console.log(`✅ Mensaje enviado a ${telefonoAUsar} desde ${conexion.whatsapp_id}`);

            // Remover de la lista de pendientes
            const index = contactosPendientes.findIndex(c => c.id === contacto.id);
            if (index > -1) {
              contactosPendientes.splice(index, 1);
            }

          } catch (error) {
            // Detectar errores específicos de WhatsApp
            let errorMessage = error.message;
            let errorType = 'error';
            
            // Error "No LID for user" - número no registrado en WhatsApp
            if (error.message && error.message.includes('No LID for user')) {
              errorMessage = 'Número no registrado en WhatsApp o no existe';
              errorType = 'numero_no_registrado';
              console.error(`❌ Error enviando mensaje a ${telefonoAUsar}: ${errorMessage}`);
            } else {
              console.error(`❌ Error enviando mensaje a ${telefonoAUsar}:`, error.message);
            }
            
            await updateContactoEstado(contacto.id, errorType, errorMessage, conexion.id);
            contactosError++;

            // Remover de la lista de pendientes
            const index = contactosPendientes.findIndex(c => c.id === contacto.id);
            if (index > -1) {
              contactosPendientes.splice(index, 1);
            }
          }
        }
      }

      console.log(`✅ Lote procesado: ${contactosEnviados} enviados, ${contactosError} errores`);

    } catch (error) {
      console.error('❌ Error en procesamiento de envío:', error);
    } finally {
      this.currentBatch = null;
    }
  }

  /**
   * Obtiene todas las conexiones disponibles para enviar mensajes
   */
  async getConexionesDisponibles() {
    const conexionesDisponibles = [];

    // Obtener todas las conexiones activas
    const { getConexionesActivas } = await import('../models/conexionesModel.js');
    const conexiones = await getConexionesActivas();

    for (const conexion of conexiones) {
      // Verificar y actualizar fase si es necesario
      const updatedConexion = await checkAndUpdateFase(conexion.whatsapp_id);
      
      // Obtener configuración de fase
      const faseConfig = await getFaseConfig(updatedConexion.fase_actual);
      
      if (!faseConfig) {
        continue;
      }

      // Verificar límite diario
      if (updatedConexion.mensajes_enviados_hoy >= faseConfig.mensajes_por_numero_por_dia) {
        // No cerrar la conexión, solo saltarla (puede usarse para verificación)
        continue;
      }

      // Verificar que tenga socket activo
      const socket = conexionesService.getSocketByWhatsAppId(updatedConexion.whatsapp_id);
      if (!socket) {
        continue;
      }

      // Verificar que el cliente esté listo
      try {
        const status = await whatsappController.getStatus(updatedConexion.whatsapp_id);
        if (!status.ready) {
          continue;
        }
      } catch (e) {
        continue;
      }

      conexionesDisponibles.push({
        conexion: updatedConexion,
        faseConfig,
        socket
      });
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

    return conexionesDisponibles;
  }

  /**
   * Sleep helper
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Obtiene el estado del servicio
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
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

    console.log('🔄 Forzando procesamiento inmediato de mensajes...');
    await this.procesarEnvio();
    return {
      success: true,
      message: 'Procesamiento completado'
    };
  }
}

// Exportar instancia singleton
export default new MensajeriaService();

