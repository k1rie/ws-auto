import makeWASocket, { 
  DisconnectReason, 
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import P from 'pino';
import qrcode from 'qrcode-terminal';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import conexionesService from '../services/conexionesService.js';
import { 
  createOrUpdateConexion, 
  updateConexionEstado, 
  updateConexionWhatsAppId, 
  getConexionByWhatsAppId 
} from '../models/conexionesModel.js';

class BaileysController {
  constructor() {
    this.sockets = new Map(); // Map<whatsappId, socket>
    this.qrCodes = new Map(); // Map<whatsappId, qrCode>
    this.qrTimestamps = new Map(); // Map<whatsappId, timestamp>
    this.qrCounts = new Map(); // Map<whatsappId, count>
    this.whatsappIdToRealNumber = new Map(); // Map<whatsappId, numeroReal>
    this.autoCloseAfterRegister = new Set(); // Set<whatsappId>
    this.broadcastCallback = null;
    this.QR_COOLDOWN_MS = 60 * 1000; // 1 minuto
    this.MAX_QR_ATTEMPTS = 2;
    this.initializing = new Set(); // Set<whatsappId> - IDs que están siendo inicializados
    this.processingOpen = new Set(); // Set<whatsappId> - IDs que están procesando el evento 'open'
  }

  // Establecer callback para broadcast
  setBroadcastCallback(callback) {
    this.broadcastCallback = callback;
  }

  // Broadcast a todos los clientes
  broadcast(data) {
    if (this.broadcastCallback) {
      this.broadcastCallback(data);
    }
  }

  // Inicializar socket de Baileys para un whatsappId específico
  async initialize(whatsappId, nombreUsuario = null, forceReinitialize = false, isRegistration = false) {
    // Prevenir inicializaciones simultáneas del mismo whatsappId
    if (this.initializing.has(whatsappId) && !forceReinitialize) {
      throw new Error(`Ya hay una inicialización en curso para ${whatsappId}. Por favor espera.`);
    }

    // Verificar si ya existe un socket para este whatsappId
    if (this.sockets.has(whatsappId) && !forceReinitialize) {
      const socket = this.sockets.get(whatsappId);
      try {
        const status = await this.getStatus(whatsappId);
        if (status.ready) {
          return socket;
        }
      } catch (e) {
        // Continuar con reinicialización
      }
      
      // Verificar QR code pendiente
      if (this.qrCodes.has(whatsappId)) {
        const lastQRTimestamp = this.qrTimestamps.get(whatsappId);
        if (lastQRTimestamp) {
          const timeSinceLastQR = Date.now() - lastQRTimestamp;
          if (timeSinceLastQR < this.QR_COOLDOWN_MS) {
            const remainingSeconds = Math.ceil((this.QR_COOLDOWN_MS - timeSinceLastQR) / 1000);
            throw new Error(
              `Ya hay un QR code pendiente para ${whatsappId}. ` +
              `Espera ${remainingSeconds} segundo(s) antes de generar uno nuevo.`
            );
          }
        }
      }
    }

    // Marcar como inicializando
    this.initializing.add(whatsappId);

    // Limpiar si es necesario
    if (forceReinitialize && this.sockets.has(whatsappId)) {
      try {
        const oldSocket = this.sockets.get(whatsappId);
        await oldSocket.end(undefined);
      } catch (e) {
        // Ignorar errores
      }
      this.sockets.delete(whatsappId);
      this.qrCodes.delete(whatsappId);
      this.qrTimestamps.delete(whatsappId);
      this.qrCounts.delete(whatsappId);
      conexionesService.unregisterSocket(whatsappId);
    }

    // Verificar espacio disponible
    const canCreate = conexionesService.canCreateSocket(isRegistration);
    let conexionExistente = await getConexionByWhatsAppId(whatsappId);
    
    if (!isRegistration && !canCreate && !conexionExistente) {
      console.log(`[INFO] No hay espacio para socket, pero registrando dispositivo ${whatsappId} en la BD...`);
      await conexionesService.createOrUpdateConexion(whatsappId, nombreUsuario || whatsappId);
      console.log(`[INFO] Dispositivo ${whatsappId} registrado en la BD`);
    } else if (conexionExistente && nombreUsuario && nombreUsuario !== conexionExistente.nombre_usuario) {
      await conexionesService.createOrUpdateConexion(whatsappId, nombreUsuario);
    }
    
    if (!canCreate) {
      if (isRegistration) {
        const socketsRegistro = conexionesService.getRegistrationSocketsCount();
        throw new Error(
          `No hay espacio disponible para un nuevo socket de registro. Máximo ${conexionesService.MAX_CONEXIONES_REGISTRO} socket(s) de registro simultáneo(s). ` +
          `Actualmente hay ${socketsRegistro} socket(s) de registro activo(s).`
        );
      } else {
        const socketsActivos = conexionesService.getActiveSocketsCount();
        throw new Error(
          `No hay espacio disponible para un nuevo socket. Máximo ${conexionesService.MAX_CONEXIONES} socket(s) simultáneo(s). ` +
          `Actualmente hay ${socketsActivos} socket(s) activo(s).`
        );
      }
    }

    console.log(`[INFO] Inicializando Baileys socket para ${whatsappId}...`);

    // Ruta para guardar el estado de autenticación
    const authPath = join(__dirname, '../.baileys_auth', whatsappId);
    
    // Obtener versión más reciente de Baileys
    const { version } = await fetchLatestBaileysVersion();
    
    // Configurar estado de autenticación
    const { state, saveCreds } = await useMultiFileAuthState(authPath);

    // Crear socket de Baileys
    const sock = makeWASocket({
      version,
      logger: P({ level: 'silent' }), // Silenciar logs de Baileys
      printQRInTerminal: false,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, P({ level: 'silent' })),
      },
      getMessage: async (key) => {
        return undefined; // No necesitamos mensajes antiguos
      },
    });

    // Guardar credenciales cuando cambien
    sock.ev.on('creds.update', saveCreds);

    // Configurar event handlers
    this.setupEventHandlers(sock, whatsappId, saveCreds);

    // Guardar socket
    this.sockets.set(whatsappId, sock);

    // Quitar de inicializando cuando termine (se quitará también en el evento 'open' o 'close')
    // Pero lo dejamos aquí por si falla antes de llegar al evento
    setTimeout(() => {
      this.initializing.delete(whatsappId);
    }, 5000); // Quitar después de 5 segundos si no se procesó el evento

    return sock;
  }

  // Configurar event handlers para un socket específico
  setupEventHandlers(sock, whatsappId, saveCreds) {
    // Event: QR Code generado
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        // Verificar cooldown
        const lastQRTimestamp = this.qrTimestamps.get(whatsappId);
        if (lastQRTimestamp) {
          const timeSinceLastQR = Date.now() - lastQRTimestamp;
          if (timeSinceLastQR < this.QR_COOLDOWN_MS) {
            const remainingSeconds = Math.ceil((this.QR_COOLDOWN_MS - timeSinceLastQR) / 1000);
            console.log(`[INFO] QR code para ${whatsappId} ignorado. Espera ${remainingSeconds} segundo(s) más.`);
            return;
          }
        }

        console.log(`[INFO] QR Code recibido para ${whatsappId}, escaneando...`);
        this.qrCodes.set(whatsappId, qr);
        this.qrTimestamps.set(whatsappId, Date.now());
        
        const currentCount = this.qrCounts.get(whatsappId) || 0;
        const newCount = currentCount + 1;
        this.qrCounts.set(whatsappId, newCount);
        console.log(`[INFO] QR code #${newCount} generado para ${whatsappId}`);
        
        // Mostrar QR en terminal
        qrcode.generate(qr, { small: true });
        
        this.broadcast({ type: 'qr', whatsappId, data: qr });
      }

      if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        
        if (shouldReconnect) {
          console.log(`[INFO] Conexión cerrada para ${whatsappId}, reconectando...`);
          // Limpiar QR codes y timestamps antes de reconectar para evitar el error de "QR pendiente"
          this.qrCodes.delete(whatsappId);
          this.qrTimestamps.delete(whatsappId);
          this.qrCounts.delete(whatsappId);
          
          // Reconectar después de un delay con forceReinitialize para limpiar estado previo
          setTimeout(() => {
            this.initialize(whatsappId, null, true, false).catch(err => {
              console.error(`[ERROR] Error reconectando ${whatsappId}:`, err);
            });
          }, 3000);
        } else {
          console.log(`[INFO] Conexión cerrada permanentemente para ${whatsappId}`);
          this.sockets.delete(whatsappId);
          this.qrCodes.delete(whatsappId);
          this.qrTimestamps.delete(whatsappId);
          this.qrCounts.delete(whatsappId);
          this.initializing.delete(whatsappId);
          this.processingOpen.delete(whatsappId);
          conexionesService.unregisterSocket(whatsappId);
          
          const numeroReal = this.whatsappIdToRealNumber.get(whatsappId);
          if (numeroReal && numeroReal !== whatsappId) {
            this.sockets.delete(numeroReal);
            conexionesService.unregisterSocket(numeroReal);
            await updateConexionEstado(numeroReal, 'inactive');
            this.whatsappIdToRealNumber.delete(whatsappId);
          } else {
            await updateConexionEstado(whatsappId, 'inactive');
          }
          
          this.broadcast({ type: 'disconnected', whatsappId, message: 'Conexión cerrada' });
        }
      }

      if (connection === 'open') {
        // Prevenir procesamiento múltiple del evento 'open'
        if (this.processingOpen.has(whatsappId)) {
          console.log(`[INFO] Evento 'open' ya está siendo procesado para ${whatsappId}, ignorando...`);
          return;
        }
        
        this.processingOpen.add(whatsappId);
        this.initializing.delete(whatsappId); // Ya no está inicializando
        
        try {
          console.log(`[INFO] Baileys socket está listo para ${whatsappId}!`);
          this.qrCodes.delete(whatsappId);
          this.qrTimestamps.delete(whatsappId);
          this.qrCounts.delete(whatsappId);
          
          // Obtener información del socket
          let numeroReal = whatsappId;
          let nombreUsuario = whatsappId;
          
          try {
            const jid = sock.user?.id;
            if (jid) {
              // Extraer número del JID (formato: 5219611137503@s.whatsapp.net)
              numeroReal = jid.split('@')[0];
              nombreUsuario = sock.user?.name || numeroReal;
              
              console.log(`[INFO] Información del WhatsApp obtenida: ${numeroReal} - ${nombreUsuario}`);
            } else {
              console.log(`[WARN] No se pudo obtener el número real, usando ${whatsappId}`);
            }
          } catch (error) {
            console.error(`[ERROR] Error obteniendo información del WhatsApp:`, error);
          }
          
          // Verificar si ya existe una conexión con el número real
          let conexionExistente = await getConexionByWhatsAppId(numeroReal);
          
          if (numeroReal !== whatsappId) {
            // Si el número real es diferente del ID temporal
            this.whatsappIdToRealNumber.set(whatsappId, numeroReal);
            this.sockets.set(numeroReal, sock);
            console.log(`[INFO] Cliente registrado con ambos IDs: ${whatsappId} y ${numeroReal}`);
            
            // Verificar si existe conexión con el número real
            if (conexionExistente) {
              console.log(`[INFO] Conexión ya existe con número real ${numeroReal}, actualizando...`);
              // Actualizar la conexión existente
              await updateConexionWhatsAppId(whatsappId, numeroReal, nombreUsuario);
            } else {
              // Verificar si existe conexión temporal
              const conexionTemporal = await getConexionByWhatsAppId(whatsappId);
              if (conexionTemporal) {
                console.log(`[INFO] Actualizando conexión temporal ${whatsappId} con número real ${numeroReal}`);
                await updateConexionWhatsAppId(whatsappId, numeroReal, nombreUsuario);
              } else {
                console.log(`[INFO] Creando nueva conexión con número real ${numeroReal}`);
                await conexionesService.createOrUpdateConexion(numeroReal, nombreUsuario);
              }
            }
          } else {
            // Si el número real es igual al ID temporal
            if (conexionExistente) {
              console.log(`[INFO] Conexión ya existe con ${numeroReal}, actualizando nombre...`);
              // Solo actualizar el nombre si es diferente
              if (nombreUsuario !== conexionExistente.nombre_usuario) {
                await conexionesService.createOrUpdateConexion(numeroReal, nombreUsuario);
              }
            } else {
              console.log(`[INFO] Creando nueva conexión con número ${numeroReal}`);
              await conexionesService.createOrUpdateConexion(numeroReal, nombreUsuario);
            }
          }
          
          // Registrar socket
          const isRegistration = this.autoCloseAfterRegister.has(whatsappId) || this.autoCloseAfterRegister.has(numeroReal);
          conexionesService.registerSocket(whatsappId, sock, isRegistration);
          if (numeroReal !== whatsappId) {
            conexionesService.registerSocket(numeroReal, sock, isRegistration);
          }
          
          // Actualizar estado (usar el número real)
          await updateConexionEstado(numeroReal, 'active');
          console.log(`[INFO] Conexión ${numeroReal} creada/actualizada y marcada como activa en la BD`);
          
          // Si debe cerrarse automáticamente después de registrar
          if (this.autoCloseAfterRegister.has(whatsappId) || this.autoCloseAfterRegister.has(numeroReal)) {
            console.log(`[INFO] Cerrando socket ${whatsappId} automáticamente después de registrar...`);
            setTimeout(async () => {
              try {
                await this.logout(whatsappId);
                this.autoCloseAfterRegister.delete(whatsappId);
                this.autoCloseAfterRegister.delete(numeroReal);
                console.log(`[INFO] Socket ${whatsappId} cerrado automáticamente después de registrar`);
              } catch (error) {
                console.error(`[ERROR] Error cerrando socket automáticamente:`, error);
              }
            }, 2000);
          }
          
          this.broadcast({ type: 'ready', whatsappId, message: 'WhatsApp conectado exitosamente' });
        } finally {
          // Quitar del set de procesamiento después de un delay para evitar procesamiento múltiple
          setTimeout(() => {
            this.processingOpen.delete(whatsappId);
          }, 2000);
        }
      }
    });
  }

  // Enviar mensaje usando Baileys
  async sendMessage(whatsappId, number, message) {
    const socket = this.getSocket(whatsappId);
    
    if (!socket) {
      throw new Error(`No hay socket activo para ${whatsappId}`);
    }

    if (!number || !message) {
      throw new Error('Número y mensaje son requeridos');
    }

    // Formatear número para Baileys (usar @s.whatsapp.net)
    const jid = number.includes('@') ? number : `${number}@s.whatsapp.net`;

    try {
      // Enviar mensaje con Baileys
      const result = await socket.sendMessage(jid, { text: message });
      
      return {
        id: result?.key?.id || 'unknown',
        to: jid,
        message: message,
        timestamp: Date.now(),
        whatsappId
      };
    } catch (error) {
      const errorMessage = error.message || error.toString();
      
      if (errorMessage.includes('No LID for user') || errorMessage.includes('not registered')) {
        throw new Error(`Número ${number} no está registrado en WhatsApp o no existe.`);
      }
      
      throw error;
    }
  }

  // Obtener socket por whatsappId
  getSocket(whatsappId) {
    // Buscar directamente
    let socket = this.sockets.get(whatsappId);
    if (socket) {
      return socket;
    }
    
    // Buscar en el mapeo inverso
    for (const [tempId, realNumber] of this.whatsappIdToRealNumber.entries()) {
      if (realNumber === whatsappId) {
        socket = this.sockets.get(tempId);
        if (socket) {
          return socket;
        }
      }
    }
    
    return null;
  }

  // Obtener estado de un socket específico
  async getStatus(whatsappId) {
    const socket = this.getSocket(whatsappId);
    if (!socket) {
      return {
        ready: false,
        message: 'Socket no inicializado'
      };
    }

    try {
      // Verificar si el socket está conectado
      const user = socket.user;
      return {
        ready: !!user,
        message: user ? 'Conectado' : 'Desconectado'
      };
    } catch (error) {
      return {
        ready: false,
        message: 'Desconectado'
      };
    }
  }

  // Obtener QR Code de un socket específico
  getQRCode(whatsappId) {
    const qr = this.qrCodes.get(whatsappId);
    if (!qr) {
      throw new Error(`No hay QR disponible para ${whatsappId}`);
    }
    return qr;
  }

  // Esperar a que se genere el QR code
  async waitForQR(whatsappId, maxWaitTime = 30000, checkInterval = 1000) {
    const startTime = Date.now();
    
    let qr = this.qrCodes.get(whatsappId);
    if (qr) {
      return qr;
    }

    while (Date.now() - startTime < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, checkInterval));
      
      qr = this.qrCodes.get(whatsappId);
      if (qr) {
        return qr;
      }

      try {
        const status = await this.getStatus(whatsappId);
        if (status.ready) {
          return null; // Ya está conectado
        }
      } catch (e) {
        // Continuar esperando
      }
    }

    return null; // Timeout
  }

  // Cerrar sesión de un socket específico
  async logout(whatsappId) {
    const socket = this.getSocket(whatsappId);
    if (socket) {
      try {
        await socket.logout();
        this.sockets.delete(whatsappId);
        this.qrCodes.delete(whatsappId);
        this.qrTimestamps.delete(whatsappId);
        this.qrCounts.delete(whatsappId);
        this.autoCloseAfterRegister.delete(whatsappId);
        this.initializing.delete(whatsappId);
        this.processingOpen.delete(whatsappId);
        conexionesService.unregisterSocket(whatsappId);
        
        const numeroReal = this.whatsappIdToRealNumber.get(whatsappId);
        if (numeroReal && numeroReal !== whatsappId) {
          this.sockets.delete(numeroReal);
          conexionesService.unregisterSocket(numeroReal);
          await updateConexionEstado(numeroReal, 'inactive');
          this.whatsappIdToRealNumber.delete(whatsappId);
        } else {
          await updateConexionEstado(whatsappId, 'inactive');
        }
        return true;
      } catch (error) {
        console.error(`[ERROR] Error cerrando sesión de ${whatsappId}:`, error);
        // Limpiar de todas formas
        this.sockets.delete(whatsappId);
        this.qrCodes.delete(whatsappId);
        this.qrTimestamps.delete(whatsappId);
        this.qrCounts.delete(whatsappId);
        this.autoCloseAfterRegister.delete(whatsappId);
        this.initializing.delete(whatsappId);
        this.processingOpen.delete(whatsappId);
        conexionesService.unregisterSocket(whatsappId);
        
        const numeroReal = this.whatsappIdToRealNumber.get(whatsappId);
        if (numeroReal && numeroReal !== whatsappId) {
          this.sockets.delete(numeroReal);
          conexionesService.unregisterSocket(numeroReal);
          await updateConexionEstado(numeroReal, 'inactive');
          this.whatsappIdToRealNumber.delete(whatsappId);
        } else {
          await updateConexionEstado(whatsappId, 'inactive');
        }
        return true;
      }
    }
    return false;
  }

  // Marcar para cerrar automáticamente después de registrar
  markForAutoClose(whatsappId) {
    this.autoCloseAfterRegister.add(whatsappId);
  }

  // Reiniciar todos los sockets (desconectar y limpiar)
  async resetAllSockets() {
    console.log('[INFO] Reiniciando todos los sockets de Baileys...');
    const resultados = [];
    
    for (const [whatsappId, socket] of this.sockets.entries()) {
      try {
        // Intentar cerrar sesión limpiamente
        await socket.logout();
        resultados.push({ whatsappId, estado: 'desconectado', error: null });
      } catch (error) {
        // Si falla, cerrar directamente
        try {
          await socket.end(undefined);
          resultados.push({ whatsappId, estado: 'cerrado', error: null });
        } catch (endError) {
          resultados.push({ whatsappId, estado: 'error', error: endError.message });
        }
      }
      
      // Limpiar registros
      conexionesService.unregisterSocket(whatsappId);
      const numeroReal = this.whatsappIdToRealNumber.get(whatsappId);
      if (numeroReal && numeroReal !== whatsappId) {
        this.sockets.delete(numeroReal);
        conexionesService.unregisterSocket(numeroReal);
        await updateConexionEstado(numeroReal, 'inactive');
        this.whatsappIdToRealNumber.delete(whatsappId);
      } else {
        await updateConexionEstado(whatsappId, 'inactive');
      }
    }
    
    this.sockets.clear();
    this.qrCodes.clear();
    this.qrTimestamps.clear();
    this.qrCounts.clear();
    this.autoCloseAfterRegister.clear();
    this.whatsappIdToRealNumber.clear();
    this.initializing.clear();
    this.processingOpen.clear();
    
    console.log(`[INFO] Reinicio completado. ${resultados.length} socket(s) procesado(s)`);
    return {
      total: resultados.length,
      resultados
    };
  }

  /**
   * Obtiene información de chats y respuestas para todos los números conectados
   * NOTA: Esta funcionalidad requiere implementación específica de Baileys
   * Por ahora retorna un array vacío ya que Baileys maneja los chats de manera diferente
   */
  async getChatsWithResponses(limitMensajes = 100, fechaInicio = null, fechaFin = null) {
    // TODO: Implementar con Baileys usando sock.ev.on('messages.upsert')
    // Por ahora retornamos array vacío ya que la implementación es diferente
    console.log('[INFO] getChatsWithResponses no está implementado aún para Baileys');
    return [];
  }
}

// Exportar instancia singleton
export default new BaileysController();
