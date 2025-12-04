import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';

class WhatsAppController {
  constructor() {
    this.client = null;
    this.isReady = false;
    this.qrCodeData = null;
    this.broadcastCallback = null;
  }

  // Establecer callback para broadcast
  setBroadcastCallback(callback) {
    this.broadcastCallback = callback;
  }

  // Inicializar WhatsApp Client
  initialize() {
    if (this.client) {
      return this.client;
    }

    console.log('Inicializando WhatsApp Client...');
    
    this.client = new Client({
      authStrategy: new LocalAuth({
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

    this.setupEventHandlers();

    // Inicializar cliente
    this.client.initialize().catch(err => {
      console.error('Error al inicializar WhatsApp Client:', err);
      this.broadcast({ type: 'error', message: err.message });
    });

    return this.client;
  }

  // Configurar event handlers
  setupEventHandlers() {
    // Event: QR Code generado
    this.client.on('qr', (qr) => {
      console.log('QR Code recibido, escaneando...');
      this.qrCodeData = qr;
      qrcode.generate(qr, { small: true });
      this.broadcast({ type: 'qr', data: qr });
    });

    // Event: Cliente listo
    this.client.on('ready', () => {
      console.log('WhatsApp Client está listo!');
      this.isReady = true;
      this.qrCodeData = null;
      this.broadcast({ type: 'ready', message: 'WhatsApp conectado exitosamente' });
    });

    // Event: Autenticación exitosa
    this.client.on('authenticated', () => {
      console.log('Autenticación exitosa');
      this.broadcast({ type: 'authenticated', message: 'Autenticación completada' });
    });

    // Event: Autenticación fallida
    this.client.on('auth_failure', (msg) => {
      console.error('Error de autenticación:', msg);
      this.isReady = false;
      this.broadcast({ type: 'auth_failure', message: msg });
    });

    // Event: Cliente desconectado
    this.client.on('disconnected', (reason) => {
      console.log('Cliente desconectado:', reason);
      this.isReady = false;
      this.client = null;
      this.broadcast({ type: 'disconnected', message: reason });
    });
  }

  // Enviar mensaje
  async sendMessage(number, message) {
    if (!this.isReady) {
      throw new Error('WhatsApp no está listo. Por favor espera a que se conecte.');
    }

    if (!number || !message) {
      throw new Error('Número y mensaje son requeridos');
    }

    // Formatear número (agregar código de país si no está presente)
    const chatId = number.includes('@c.us') ? number : `${number}@c.us`;
    
    // Enviar mensaje
    const result = await this.client.sendMessage(chatId, message);
    
    return {
      id: result.id._serialized,
      to: chatId,
      message: message,
      timestamp: result.timestamp
    };
  }

  // Obtener estado
  getStatus() {
    return {
      ready: this.isReady,
      message: this.isReady ? 'Conectado' : 'Desconectado'
    };
  }

  // Obtener QR Code
  getQRCode() {
    if (!this.qrCodeData) {
      throw new Error('No hay QR disponible');
    }
    return this.qrCodeData;
  }

  // Obtener estado inicial para nuevo cliente
  getInitialState() {
    if (this.qrCodeData) {
      return { type: 'qr', data: this.qrCodeData };
    } else if (this.isReady) {
      return { type: 'ready', message: 'WhatsApp conectado' };
    } else {
      return { type: 'status', message: 'Inicializando...' };
    }
  }

  // Broadcast a todos los clientes
  broadcast(data) {
    if (this.broadcastCallback) {
      this.broadcastCallback(data);
    }
  }

  // Destruir cliente
  destroy() {
    if (this.client) {
      this.client.destroy();
      this.client = null;
      this.isReady = false;
    }
  }

  // Cerrar sesión
  async logout() {
    if (this.client) {
      await this.client.logout();
      this.isReady = false;
      this.qrCodeData = null;
      this.client = null;
      return true;
    }
    return false;
  }
}

// Exportar instancia singleton
export default new WhatsAppController();

