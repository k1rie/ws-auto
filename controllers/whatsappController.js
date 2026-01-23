import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import conexionesService from '../services/conexionesService.js';
import { createOrUpdateConexion, updateConexionEstado, updateConexionWhatsAppId, getConexionByWhatsAppId } from '../models/conexionesModel.js';

class WhatsAppController {
  constructor() {
    this.clients = new Map(); // Map<whatsappId, client>
    this.qrCodes = new Map(); // Map<whatsappId, qrCode>
    this.qrTimestamps = new Map(); // Map<whatsappId, timestamp> - rastrea cuándo se generó el último QR
    this.qrCounts = new Map(); // Map<whatsappId, count> - rastrea cuántas veces se ha generado un QR
    this.whatsappIdToRealNumber = new Map(); // Map<whatsappId, numeroReal> - mapeo de ID temporal a número real
    this.autoCloseAfterRegister = new Set(); // Set<whatsappId> - conexiones que deben cerrarse después de registrar
    this.broadcastCallback = null;
    this.QR_COOLDOWN_MS = 60 * 1000; // 1 minuto de espera entre QR codes
    this.MAX_QR_ATTEMPTS = 2; // Máximo de QR codes sin escanear antes de cerrar
  }

  // Establecer callback para broadcast
  setBroadcastCallback(callback) {
    this.broadcastCallback = callback;
  }

  // Inicializar WhatsApp Client para un whatsappId específico
  async initialize(whatsappId, nombreUsuario = null, forceReinitialize = false, isRegistration = false) {
    // Verificar si ya existe un cliente para este whatsappId
    if (this.clients.has(whatsappId) && !forceReinitialize) {
      const client = this.clients.get(whatsappId);
      // Verificar si el cliente está realmente activo
      try {
        const status = await this.getStatus(whatsappId);
        if (status.ready) {
          return client;
        }
      } catch (e) {
        // Si hay error, continuar con reinicialización
      }
      
      // Si hay un QR code pendiente y es reciente (menos de 1 minuto), no generar uno nuevo
      if (this.qrCodes.has(whatsappId)) {
        const lastQRTimestamp = this.qrTimestamps.get(whatsappId);
        if (lastQRTimestamp) {
          const timeSinceLastQR = Date.now() - lastQRTimestamp;
          if (timeSinceLastQR < this.QR_COOLDOWN_MS) {
            const remainingSeconds = Math.ceil((this.QR_COOLDOWN_MS - timeSinceLastQR) / 1000);
            throw new Error(
              `Ya hay un QR code pendiente para ${whatsappId}. ` +
              `Espera ${remainingSeconds} segundo(s) antes de generar uno nuevo. ` +
              `Por favor escanea el QR actual.`
            );
          }
        }
      }
    }

    // Si forceReinitialize es true o el cliente no está listo, limpiar primero
    if (forceReinitialize && this.clients.has(whatsappId)) {
      try {
        const oldClient = this.clients.get(whatsappId);
        await oldClient.destroy();
      } catch (e) {
        // Ignorar errores al destruir
      }
      this.clients.delete(whatsappId);
      this.qrCodes.delete(whatsappId);
      this.qrTimestamps.delete(whatsappId);
      this.qrCounts.delete(whatsappId);
      conexionesService.unregisterSocket(whatsappId);
    }

    // Verificar si hay espacio disponible para un nuevo socket
    // Si es registro, usa el límite de registro; si no, usa el límite de envío
    const canCreate = conexionesService.canCreateSocket(isRegistration);
    
    // Verificar si el dispositivo ya está registrado en la BD
    let conexionExistente = await getConexionByWhatsAppId(whatsappId);
    
    // Si NO hay espacio para el socket pero el dispositivo no está registrado,
    // registrarlo en la BD para que quede disponible cuando haya espacio
    // (Solo para conexiones de envío, no para registro)
    if (!isRegistration && !canCreate && !conexionExistente) {
      console.log(`[INFO] No hay espacio para socket, pero registrando dispositivo ${whatsappId} en la BD...`);
      await conexionesService.createOrUpdateConexion(whatsappId, nombreUsuario || whatsappId);
      console.log(`[INFO] Dispositivo ${whatsappId} registrado en la BD`);
    } else if (conexionExistente && nombreUsuario && nombreUsuario !== conexionExistente.nombre_usuario) {
      // Si ya existe y se proporcionó un nombre nuevo, actualizarlo
      await conexionesService.createOrUpdateConexion(whatsappId, nombreUsuario);
    }
    
    // Si no hay espacio para el socket, lanzar error
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
          `Actualmente hay ${socketsActivos} socket(s) activo(s). ` +
          `Nota: ${!conexionExistente ? 'El dispositivo ha sido registrado en la base de datos. ' : ''}Puedes tener múltiples conexiones en la base de datos, pero solo ${conexionesService.MAX_CONEXIONES} socket(s) activo(s) a la vez.`
        );
      }
    }
    
    // Si hay espacio, NO creamos la conexión aquí porque:
    // 1. Aún no sabemos el número real del WhatsApp
    // 2. Se creará automáticamente cuando el dispositivo esté listo (evento 'ready')
    // 3. Esto evita crear conexiones temporales innecesarias

    console.log(`Inicializando WhatsApp Client para ${whatsappId}...`);
    
    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: whatsappId,
        dataPath: './.wwebjs_auth'
      }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu'
        ]
      }
    });

    this.clients.set(whatsappId, client);
    this.setupEventHandlers(client, whatsappId);

    // Inicializar cliente
    client.initialize().catch(err => {
      console.error(`Error al inicializar WhatsApp Client para ${whatsappId}:`, err);
      this.broadcast({ type: 'error', whatsappId, message: err.message });
      this.clients.delete(whatsappId);
      conexionesService.unregisterSocket(whatsappId);
    });

    return client;
  }

  // Configurar event handlers para un cliente específico
  setupEventHandlers(client, whatsappId) {
    // Event: QR Code generado
    client.on('qr', (qr) => {
      // Verificar si ya hay un QR reciente (menos de 1 minuto)
      const lastQRTimestamp = this.qrTimestamps.get(whatsappId);
      if (lastQRTimestamp) {
        const timeSinceLastQR = Date.now() - lastQRTimestamp;
        if (timeSinceLastQR < this.QR_COOLDOWN_MS) {
          const remainingSeconds = Math.ceil((this.QR_COOLDOWN_MS - timeSinceLastQR) / 1000);
          console.log(`[INFO] QR code para ${whatsappId} ignorado. Espera ${remainingSeconds} segundo(s) más antes de generar uno nuevo.`);
          return; // Ignorar este QR code
        }
      }
      
      console.log(`QR Code recibido para ${whatsappId}, escaneando...`);
      this.qrCodes.set(whatsappId, qr);
      this.qrTimestamps.set(whatsappId, Date.now()); // Registrar timestamp
      
      // Incrementar contador de QR codes generados
      const currentCount = this.qrCounts.get(whatsappId) || 0;
      const newCount = currentCount + 1;
      this.qrCounts.set(whatsappId, newCount);
      console.log(`[INFO] QR code #${newCount} generado para ${whatsappId}`);
      
      // Si se han generado 2 QR codes sin escanear, cerrar el cliente
      if (newCount >= this.MAX_QR_ATTEMPTS) {
        console.log(`[WARN] Se han generado ${newCount} QR codes para ${whatsappId} sin escanear. Cerrando cliente automáticamente...`);
        this.cerrarClientePorQRNoEscaneado(whatsappId);
        return; // No generar más QR codes
      }
      
      qrcode.generate(qr, { small: true });
      this.broadcast({ type: 'qr', whatsappId, data: qr });
    });

    // Event: Cliente listo
    client.on('ready', async () => {
      console.log(`WhatsApp Client está listo para ${whatsappId}!`);
      this.qrCodes.delete(whatsappId);
      this.qrTimestamps.delete(whatsappId); // Limpiar timestamp cuando se conecta
      this.qrCounts.delete(whatsappId); // Limpiar contador cuando se conecta exitosamente
      
      let numeroReal = whatsappId;
      let nombreUsuario = whatsappId;
      
      try {
        // Obtener información real del WhatsApp
        const info = await client.info;
        numeroReal = info?.wid?.user || whatsappId;
        nombreUsuario = info?.pushname || info?.wid?.user || whatsappId;
        
        if (info?.wid?.user) {
          console.log(`[INFO] Información del WhatsApp obtenida: ${numeroReal} - ${nombreUsuario}`);
          
          // Guardar mapeo entre whatsappId original y número real
          if (numeroReal !== whatsappId) {
            this.whatsappIdToRealNumber.set(whatsappId, numeroReal);
            // También registrar el cliente con el número real para que se pueda encontrar por ambos IDs
            this.clients.set(numeroReal, client);
            console.log(`[INFO] Cliente registrado con ambos IDs: ${whatsappId} y ${numeroReal}`);
            console.log(`[INFO] Actualizando/creando conexión: ${whatsappId} -> ${numeroReal}`);
            await updateConexionWhatsAppId(whatsappId, numeroReal, nombreUsuario);
          } else {
            // Si el número coincide, crear/actualizar la conexión
            console.log(`[INFO] Creando/actualizando conexión con número ${numeroReal}`);
            await conexionesService.createOrUpdateConexion(numeroReal, nombreUsuario);
          }
        } else {
          // Si no se puede obtener el número, usar el whatsappId proporcionado
          console.log(`[WARN] No se pudo obtener el número real, usando ${whatsappId}`);
          console.log(`[INFO] Creando/actualizando conexión con whatsappId ${whatsappId}`);
          await conexionesService.createOrUpdateConexion(whatsappId, nombreUsuario);
        }
      } catch (error) {
        console.error(`Error obteniendo información del WhatsApp:`, error);
        // En caso de error, mantener la conexión con el whatsappId original
        await conexionesService.createOrUpdateConexion(whatsappId, whatsappId);
      }
      
      // Determinar si esta conexión es de registro (basado en autoCloseAfterRegister)
      const isRegistration = this.autoCloseAfterRegister.has(whatsappId) || this.autoCloseAfterRegister.has(numeroReal);
      
      // Registrar socket en el servicio
      // Si el número real es diferente, registrar con ambos IDs para compatibilidad
      conexionesService.registerSocket(whatsappId, client, isRegistration);
      if (numeroReal !== whatsappId) {
        // También registrar con el número real para que se pueda encontrar por ese ID
        conexionesService.registerSocket(numeroReal, client, isRegistration);
      }
      
      // Asegurar que la conexión existe antes de actualizar el estado
      let conexionFinal = await getConexionByWhatsAppId(numeroReal);
      if (!conexionFinal) {
        // Si por alguna razón no existe, crearla
        console.log('[WARN] Conexión no encontrada después de crear/actualizar, creando nueva...');
        conexionFinal = await conexionesService.createOrUpdateConexion(numeroReal, nombreUsuario);
      }
      
      // Actualizar estado de conexión con el número real
      await updateConexionEstado(numeroReal, 'active');
      
      console.log(`[INFO] Conexión ${numeroReal} creada/actualizada y marcada como activa en la BD`);
      
      // Si esta conexión debe cerrarse automáticamente después de registrar
      if (this.autoCloseAfterRegister.has(whatsappId) || this.autoCloseAfterRegister.has(numeroReal)) {
        console.log(`[INFO] Cerrando cliente ${whatsappId} automáticamente después de registrar...`);
        // Esperar un momento para asegurar que los datos se guardaron
        setTimeout(async () => {
          try {
            await this.logout(whatsappId);
            this.autoCloseAfterRegister.delete(whatsappId);
            this.autoCloseAfterRegister.delete(numeroReal);
            console.log(`[INFO] Cliente ${whatsappId} cerrado automáticamente después de registrar`);
          } catch (error) {
            console.error(`Error cerrando cliente automáticamente:`, error);
          }
        }, 2000); // Esperar 2 segundos antes de cerrar
      }
      
      this.broadcast({ type: 'ready', whatsappId, message: 'WhatsApp conectado exitosamente' });
    });

    // Event: Autenticación exitosa
    client.on('authenticated', () => {
      console.log(`Autenticación exitosa para ${whatsappId}`);
      this.broadcast({ type: 'authenticated', whatsappId, message: 'Autenticación completada' });
    });

    // Event: Autenticación fallida
    client.on('auth_failure', async (msg) => {
      console.error(`Error de autenticación para ${whatsappId}:`, msg);
      this.clients.delete(whatsappId);
      this.qrCodes.delete(whatsappId);
      this.qrTimestamps.delete(whatsappId);
      this.qrCounts.delete(whatsappId);
      conexionesService.unregisterSocket(whatsappId);
      // Si hay un número real mapeado, también desconectarlo
      const numeroReal = this.whatsappIdToRealNumber.get(whatsappId);
      if (numeroReal && numeroReal !== whatsappId) {
        this.clients.delete(numeroReal); // Eliminar también el registro con el número real
        conexionesService.unregisterSocket(numeroReal);
        await updateConexionEstado(numeroReal, 'inactive');
        this.whatsappIdToRealNumber.delete(whatsappId);
      } else {
        await updateConexionEstado(whatsappId, 'inactive');
      }
      this.broadcast({ type: 'auth_failure', whatsappId, message: msg });
    });

    // Event: Cliente desconectado
    client.on('disconnected', async (reason) => {
      console.log(`Cliente desconectado para ${whatsappId}:`, reason);
      this.clients.delete(whatsappId);
      this.qrCodes.delete(whatsappId);
      this.qrTimestamps.delete(whatsappId);
      this.qrCounts.delete(whatsappId);
      conexionesService.unregisterSocket(whatsappId);
      // Si hay un número real mapeado, también desconectarlo
      const numeroReal = this.whatsappIdToRealNumber.get(whatsappId);
      if (numeroReal && numeroReal !== whatsappId) {
        this.clients.delete(numeroReal); // Eliminar también el registro con el número real
        conexionesService.unregisterSocket(numeroReal);
        await updateConexionEstado(numeroReal, 'inactive');
        this.whatsappIdToRealNumber.delete(whatsappId);
      } else {
        await updateConexionEstado(whatsappId, 'inactive');
      }
      this.broadcast({ type: 'disconnected', whatsappId, message: reason });
    });
  }

  // Enviar mensaje usando un cliente específico
  async sendMessage(whatsappId, number, message) {
    // Usar getClient para que funcione con ambos IDs (temporal y número real)
    const client = this.getClient(whatsappId);
    
    if (!client) {
      throw new Error(`No hay cliente activo para ${whatsappId}`);
    }

    if (!number || !message) {
      throw new Error('Número y mensaje son requeridos');
    }

    // Verificar que el cliente esté listo
    const info = await client.info;
    if (!info) {
      throw new Error('WhatsApp no está listo. Por favor espera a que se conecte.');
    }

    // Formatear número (agregar código de país si no está presente)
    const chatId = number.includes('@c.us') ? number : `${number}@c.us`;
    
    try {
      // Enviar mensaje
      const result = await client.sendMessage(chatId, message);
      
      return {
        id: result.id._serialized,
        to: chatId,
        message: message,
        timestamp: result.timestamp,
        whatsappId
      };
    } catch (error) {
      // Detectar errores específicos de WhatsApp y proporcionar mensajes más claros
      const errorMessage = error.message || error.toString();
      
      if (errorMessage.includes('No LID for user')) {
        throw new Error(`Número ${number} no está registrado en WhatsApp o no existe. Error: No LID for user`);
      }
      
      // Re-lanzar el error original si no es uno de los casos conocidos
      throw error;
    }
  }

  // Obtener cliente por whatsappId
  // Busca primero por el ID directo, luego por el mapeo de número real
  getClient(whatsappId) {
    // Buscar directamente
    let client = this.clients.get(whatsappId);
    if (client) {
      return client;
    }
    
    // Si no se encuentra, buscar en el mapeo inverso (número real -> ID temporal)
    for (const [tempId, realNumber] of this.whatsappIdToRealNumber.entries()) {
      if (realNumber === whatsappId) {
        client = this.clients.get(tempId);
        if (client) {
          return client;
        }
      }
    }
    
    return null;
  }

  // Obtener estado de un cliente específico
  // Busca primero por el ID directo, luego por el mapeo de número real
  async getStatus(whatsappId) {
    const client = this.getClient(whatsappId);
    if (!client) {
      return {
        ready: false,
        message: 'Cliente no inicializado'
      };
    }

    try {
      const info = await client.info;
      return {
        ready: !!info,
        message: info ? 'Conectado' : 'Desconectado'
      };
    } catch (error) {
      return {
        ready: false,
        message: 'Desconectado'
      };
    }
  }

  // Obtener QR Code de un cliente específico
  getQRCode(whatsappId) {
    const qr = this.qrCodes.get(whatsappId);
    if (!qr) {
      throw new Error(`No hay QR disponible para ${whatsappId}`);
    }
    return qr;
  }

  // Obtener estado inicial para un cliente
  async getInitialState(whatsappId) {
    const qr = this.qrCodes.get(whatsappId);
    if (qr) {
      return { type: 'qr', whatsappId, data: qr };
    }
    
    const status = await this.getStatus(whatsappId);
    if (status.ready) {
      return { type: 'ready', whatsappId, message: 'WhatsApp conectado' };
    }
    
    return { type: 'status', whatsappId, message: 'Inicializando...' };
    }

  /**
   * Espera a que se genere el QR code para un whatsappId
   * @param {string} whatsappId - ID de la conexión
   * @param {number} maxWaitTime - Tiempo máximo de espera en milisegundos (default: 30000 = 30 segundos)
   * @param {number} checkInterval - Intervalo de verificación en milisegundos (default: 1000 = 1 segundo)
   * @returns {Promise<string|null>} - QR code string o null si no se genera en el tiempo límite
   */
  async waitForQR(whatsappId, maxWaitTime = 30000, checkInterval = 1000) {
    const startTime = Date.now();
    
    // Verificar si ya existe el QR
    let qr = this.qrCodes.get(whatsappId);
    if (qr) {
      return qr;
    }

    // Esperar a que se genere el QR
    while (Date.now() - startTime < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, checkInterval));
      
      qr = this.qrCodes.get(whatsappId);
      if (qr) {
        return qr;
      }

      // Verificar si el cliente ya está listo (ya no necesita QR)
      try {
        const status = await this.getStatus(whatsappId);
        if (status.ready) {
          return null; // Ya está conectado, no necesita QR
        }
      } catch (e) {
        // Continuar esperando
      }
    }

    return null; // Timeout
  }

  // Broadcast a todos los clientes
  broadcast(data) {
    if (this.broadcastCallback) {
      this.broadcastCallback(data);
    }
  }

  // Destruir todos los clientes
  destroy() {
    for (const [whatsappId, client] of this.clients.entries()) {
      try {
        client.destroy();
        conexionesService.unregisterSocket(whatsappId);
        // Limpiar también el número real si existe
        const numeroReal = this.whatsappIdToRealNumber.get(whatsappId);
        if (numeroReal && numeroReal !== whatsappId) {
          conexionesService.unregisterSocket(numeroReal);
          this.whatsappIdToRealNumber.delete(whatsappId);
        }
      } catch (error) {
        console.error(`Error destruyendo cliente ${whatsappId}:`, error);
      }
    }
    this.clients.clear();
    this.qrCodes.clear();
    this.qrTimestamps.clear();
    this.qrCounts.clear();
    this.autoCloseAfterRegister.clear();
    this.whatsappIdToRealNumber.clear();
  }

  // Reiniciar todos los sockets (desconectar y limpiar)
  async resetAllSockets() {
    console.log('[INFO] Reiniciando todos los sockets...');
    const resultados = [];
    
    for (const [whatsappId, client] of this.clients.entries()) {
      try {
        // Intentar cerrar sesión limpiamente
        await client.logout();
        resultados.push({ whatsappId, estado: 'desconectado', error: null });
      } catch (error) {
        // Si falla, destruir directamente
        try {
          await client.destroy();
          resultados.push({ whatsappId, estado: 'destruido', error: null });
        } catch (destroyError) {
          resultados.push({ whatsappId, estado: 'error', error: destroyError.message });
        }
      }
      
      // Limpiar registros
      conexionesService.unregisterSocket(whatsappId);
      const numeroReal = this.whatsappIdToRealNumber.get(whatsappId);
      if (numeroReal && numeroReal !== whatsappId) {
        conexionesService.unregisterSocket(numeroReal);
        await updateConexionEstado(numeroReal, 'inactive');
        this.whatsappIdToRealNumber.delete(whatsappId);
      } else {
        await updateConexionEstado(whatsappId, 'inactive');
      }
    }
    
    this.clients.clear();
    this.qrCodes.clear();
    this.qrTimestamps.clear();
    this.qrCounts.clear();
    this.autoCloseAfterRegister.clear();
    this.whatsappIdToRealNumber.clear();
    
    console.log(`[INFO] Reinicio completado. ${resultados.length} socket(s) procesado(s)`);
    return {
      total: resultados.length,
      resultados
    };
  }

  // Cerrar sesión de un cliente específico
  async logout(whatsappId) {
    // Buscar el cliente usando getClient para que funcione con ambos IDs
    const client = this.getClient(whatsappId);
    if (client) {
      try {
        await client.logout();
        this.clients.delete(whatsappId);
        this.qrCodes.delete(whatsappId);
        this.qrTimestamps.delete(whatsappId);
        this.qrCounts.delete(whatsappId);
        this.autoCloseAfterRegister.delete(whatsappId);
        conexionesService.unregisterSocket(whatsappId);
        // Si hay un número real mapeado, también desconectarlo
        const numeroReal = this.whatsappIdToRealNumber.get(whatsappId);
        if (numeroReal && numeroReal !== whatsappId) {
          this.clients.delete(numeroReal); // Eliminar también el registro con el número real
          conexionesService.unregisterSocket(numeroReal);
          this.autoCloseAfterRegister.delete(numeroReal);
          await updateConexionEstado(numeroReal, 'inactive');
          this.whatsappIdToRealNumber.delete(whatsappId);
        } else {
          await updateConexionEstado(whatsappId, 'inactive');
        }
        return true;
      } catch (error) {
        console.error(`Error cerrando sesión de ${whatsappId}:`, error);
        // Aún así, limpiar
        this.clients.delete(whatsappId);
        this.qrCodes.delete(whatsappId);
        this.qrTimestamps.delete(whatsappId);
        this.qrCounts.delete(whatsappId);
        this.autoCloseAfterRegister.delete(whatsappId);
        conexionesService.unregisterSocket(whatsappId);
        // Si hay un número real mapeado, también desconectarlo
        const numeroReal = this.whatsappIdToRealNumber.get(whatsappId);
        if (numeroReal && numeroReal !== whatsappId) {
          this.clients.delete(numeroReal); // Eliminar también el registro con el número real
          conexionesService.unregisterSocket(numeroReal);
          this.autoCloseAfterRegister.delete(numeroReal);
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

  // Cerrar cliente automáticamente cuando se generan múltiples QR sin escanear
  async cerrarClientePorQRNoEscaneado(whatsappId) {
    try {
      console.log(`[WARN] Cerrando cliente ${whatsappId} por múltiples QR codes no escaneados...`);
      
      const client = this.clients.get(whatsappId);
      if (client) {
        try {
          await client.destroy();
        } catch (error) {
          console.error(`Error destruyendo cliente ${whatsappId}:`, error);
        }
      }
      
      // Limpiar todos los registros
      this.clients.delete(whatsappId);
      this.qrCodes.delete(whatsappId);
      this.qrTimestamps.delete(whatsappId);
      this.qrCounts.delete(whatsappId);
      conexionesService.unregisterSocket(whatsappId);
      
      // Limpiar también el número real si existe
      const numeroReal = this.whatsappIdToRealNumber.get(whatsappId);
      if (numeroReal && numeroReal !== whatsappId) {
        this.clients.delete(numeroReal); // Eliminar también el registro con el número real
        conexionesService.unregisterSocket(numeroReal);
        await updateConexionEstado(numeroReal, 'inactive');
        this.whatsappIdToRealNumber.delete(whatsappId);
      } else {
        await updateConexionEstado(whatsappId, 'inactive');
      }
      
      console.log(`[INFO] Cliente ${whatsappId} cerrado automáticamente por múltiples QR codes no escaneados`);
      this.broadcast({ 
        type: 'error', 
        whatsappId, 
        message: `Cliente cerrado automáticamente: se generaron ${this.MAX_QR_ATTEMPTS} QR codes sin escanear` 
      });
    } catch (error) {
      console.error(`Error cerrando cliente ${whatsappId} automáticamente:`, error);
    }
  }

  /**
   * Obtiene información de chats y respuestas para todos los números conectados
   * Retorna información sobre mensajes enviados y sus respuestas
   * @param {number} limitMensajes - Límite de mensajes a obtener por chat (default: 100)
   * @param {Date|null} fechaInicio - Fecha de inicio para filtrar mensajes (opcional)
   * @param {Date|null} fechaFin - Fecha de fin para filtrar mensajes (opcional)
   */
  async getChatsWithResponses(limitMensajes = 100, fechaInicio = null, fechaFin = null) {
    const resultados = [];
    
    // Convertir fechas a timestamps si se proporcionan
    let timestampInicio = null;
    let timestampFin = null;
    
    if (fechaInicio) {
      timestampInicio = fechaInicio.getTime();
    }
    
    if (fechaFin) {
      // Establecer la hora al final del día (23:59:59.999)
      const finDelDia = new Date(fechaFin);
      finDelDia.setHours(23, 59, 59, 999);
      timestampFin = finDelDia.getTime();
    }
    
    // Obtener todos los clientes conectados
    for (const [whatsappId, client] of this.clients.entries()) {
      try {
        // Verificar que el cliente esté listo
        const status = await this.getStatus(whatsappId);
        if (!status.ready) {
          console.log(`[INFO] Cliente ${whatsappId} no está listo, saltando...`);
          continue;
        }

        // Obtener información del cliente
        const info = await client.info;
        if (!info) {
          continue;
        }

        const numeroEnvio = info.wid?.user || whatsappId;
        const chatsInfo = [];

        try {
          // Obtener todos los chats
          const chats = await client.getChats();
          console.log(`[INFO] Revisando ${chats.length} chats para ${numeroEnvio}...`);

          // Procesar cada chat
          for (const chat of chats) {
            try {
              // Obtener mensajes del chat
              const messages = await chat.fetchMessages({ limit: limitMensajes });
              
              // Filtrar solo mensajes enviados por este cliente
              let mensajesEnviados = messages.filter(msg => msg.fromMe === true);
              
              // Filtrar por rango de fechas si se proporciona
              if (timestampInicio || timestampFin) {
                mensajesEnviados = mensajesEnviados.filter(msg => {
                  const timestampMsg = msg.timestamp * 1000; // Convertir a milisegundos
                  
                  if (timestampInicio && timestampMsg < timestampInicio) {
                    return false;
                  }
                  
                  if (timestampFin && timestampMsg > timestampFin) {
                    return false;
                  }
                  
                  return true;
                });
              }
              
              if (mensajesEnviados.length === 0) {
                continue; // No hay mensajes enviados en este chat dentro del rango
              }

              // Para cada mensaje enviado, buscar si hay respuesta
              for (const mensajeEnviado of mensajesEnviados) {
                const timestampEnvio = mensajeEnviado.timestamp * 1000; // Convertir a milisegundos
                
                // Buscar respuestas (mensajes posteriores que no sean fromMe)
                const mensajesPosteriores = messages.filter(msg => 
                  msg.timestamp * 1000 > timestampEnvio && 
                  msg.fromMe === false
                );
                
                // Ordenar por timestamp para obtener la primera respuesta
                mensajesPosteriores.sort((a, b) => a.timestamp - b.timestamp);
                
                const primeraRespuesta = mensajesPosteriores.length > 0 ? mensajesPosteriores[0] : null;
                
                // Extraer número del contacto (remover @c.us si está presente)
                let numeroContacto = chat.id._serialized || chat.id;
                if (typeof numeroContacto === 'string' && numeroContacto.includes('@c.us')) {
                  numeroContacto = numeroContacto.split('@')[0];
                } else if (typeof numeroContacto === 'object' && numeroContacto.user) {
                  numeroContacto = numeroContacto.user;
                }
                
                // Obtener nombre del contacto si está disponible
                const nombreContacto = chat.name || chat.pushname || numeroContacto;

                // Obtener el contenido del mensaje enviado
                let mensajeEnviadoTexto = '[Mensaje multimedia]';
                if (mensajeEnviado.body) {
                  mensajeEnviadoTexto = mensajeEnviado.body;
                } else if (mensajeEnviado.caption) {
                  mensajeEnviadoTexto = mensajeEnviado.caption;
                } else if (mensajeEnviado.type) {
                  mensajeEnviadoTexto = `[${mensajeEnviado.type}]`;
                }

                // Obtener el contenido de la respuesta si existe
                let mensajeRespuestaTexto = null;
                if (primeraRespuesta) {
                  if (primeraRespuesta.body) {
                    mensajeRespuestaTexto = primeraRespuesta.body;
                  } else if (primeraRespuesta.caption) {
                    mensajeRespuestaTexto = primeraRespuesta.caption;
                  } else if (primeraRespuesta.type) {
                    mensajeRespuestaTexto = `[${primeraRespuesta.type}]`;
                  } else {
                    mensajeRespuestaTexto = '[Mensaje multimedia]';
                  }
                }

                const chatInfo = {
                  numeroEnvio: numeroEnvio,
                  numeroContacto: numeroContacto,
                  nombreContacto: nombreContacto,
                  mensajeEnviado: mensajeEnviadoTexto,
                  fechaEnvio: new Date(timestampEnvio).toISOString(),
                  timestampEnvio: timestampEnvio,
                  contesto: primeraRespuesta !== null,
                  mensajeRespuesta: mensajeRespuestaTexto,
                  fechaRespuesta: primeraRespuesta ? new Date(primeraRespuesta.timestamp * 1000).toISOString() : null,
                  timestampRespuesta: primeraRespuesta ? primeraRespuesta.timestamp * 1000 : null,
                  chatId: chat.id._serialized || (typeof chat.id === 'object' ? JSON.stringify(chat.id) : chat.id)
                };

                chatsInfo.push(chatInfo);
              }
            } catch (chatError) {
              console.error(`[ERROR] Error procesando chat para ${numeroEnvio}:`, chatError.message);
              // Continuar con el siguiente chat
            }
          }

          resultados.push({
            whatsappId: numeroEnvio,
            nombreUsuario: info.pushname || numeroEnvio,
            totalChats: chats.length,
            chatsConMensajesEnviados: chatsInfo.length,
            chats: chatsInfo
          });

        } catch (error) {
          console.error(`[ERROR] Error obteniendo chats para ${numeroEnvio}:`, error.message);
          resultados.push({
            whatsappId: numeroEnvio,
            nombreUsuario: info.pushname || numeroEnvio,
            error: error.message,
            chats: []
          });
        }

      } catch (error) {
        console.error(`[ERROR] Error procesando cliente ${whatsappId}:`, error.message);
        resultados.push({
          whatsappId: whatsappId,
          error: error.message,
          chats: []
        });
      }
    }

    return resultados;
  }
}

// Exportar instancia singleton
export default new WhatsAppController();

