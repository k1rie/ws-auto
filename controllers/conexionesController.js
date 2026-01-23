import { getAllConexiones } from '../models/conexionesModel.js';
import conexionesService from '../services/conexionesService.js';
import baileysController from './baileysController.js';

/**
 * Crea una conexión en la BD (sin inicializar socket)
 */
export async function createConexion(req, res) {
  try {
    const { whatsappId, nombreUsuario } = req.body;
    
    if (!whatsappId) {
      return res.status(400).json({
        success: false,
        error: 'whatsappId es requerido'
      });
    }

    const conexion = await conexionesService.createOrUpdateConexion(
      whatsappId,
      nombreUsuario || whatsappId
    );
    
    res.json({
      success: true,
      message: 'Conexión creada/actualizada en la base de datos',
      data: {
        conexion: {
          id: conexion.id,
          whatsappId: conexion.whatsapp_id,
          nombreUsuario: conexion.nombre_usuario,
          estado: conexion.estado,
          fase: conexion.fase_actual
        }
      }
    });
  } catch (error) {
    console.error('Error creando conexión:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * Obtiene todas las conexiones
 */
export async function getConexiones(req, res) {
  try {
    const conexiones = await getAllConexiones();
    const conexionesInfo = await conexionesService.getAllConexionesInfo();
    
    // Combinar información de BD con estado de sockets
    const conexionesConEstado = conexiones.map(conexion => {
      const info = conexionesInfo.find(c => c.whatsapp_id === conexion.whatsapp_id);
      return {
        ...conexion,
        hasSocket: info?.hasSocket || false
      };
    });

    res.json({
      success: true,
      data: {
        conexiones: conexionesConEstado,
        total: conexionesConEstado.length,
        activas: conexionesConEstado.filter(c => c.estado === 'active').length,
        socketsActivos: conexionesService.getActiveSocketsCount(),
        socketsDisponibles: conexionesService.getAvailableSlots(),
        maxSockets: conexionesService.MAX_CONEXIONES,
        socketsRegistro: conexionesService.getRegistrationSocketsCount(),
        socketsRegistroDisponibles: conexionesService.getAvailableSlots(true),
        maxSocketsRegistro: conexionesService.MAX_CONEXIONES_REGISTRO,
        // Mantener compatibilidad con versiones anteriores
        disponibles: conexionesService.getAvailableSlots(),
        maxConexiones: conexionesService.MAX_CONEXIONES
      }
    });
  } catch (error) {
    console.error('Error obteniendo conexiones:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * Registra un dispositivo: inicializa, obtiene QR, espera conexión, guarda datos y cierra
 */
export async function registerDevice(req, res) {
  try {
    const { whatsappId, nombreUsuario } = req.body;
    
    if (!whatsappId) {
      return res.status(400).json({
        success: false,
        error: 'whatsappId es requerido'
      });
    }

    // Verificar si ya está conectado
    const existingSocket = baileysController.getSocket(whatsappId);
    if (existingSocket) {
      const status = await baileysController.getStatus(whatsappId);
      if (status.ready) {
        // Si ya está conectado, obtener los datos y cerrar
        try {
          const socket = baileysController.getSocket(whatsappId);
          const user = socket?.user;
          const numeroReal = user?.id?.split('@')[0] || whatsappId;
          const nombreReal = user?.name || numeroReal || nombreUsuario || whatsappId;
          
          // Guardar en BD
          await conexionesService.createOrUpdateConexion(numeroReal, nombreReal);
          
          // Cerrar el cliente
          await baileysController.logout(whatsappId);
          
          return res.json({
            success: true,
            message: 'Dispositivo registrado y cliente cerrado',
            data: {
              whatsappId: numeroReal,
              nombreUsuario: nombreReal,
              yaEstabaConectado: true
            }
          });
        } catch (error) {
          return res.status(500).json({
            success: false,
            error: `Error obteniendo datos del dispositivo conectado: ${error.message}`
          });
        }
      }
    }

    // Inicializar cliente en modo registro (usa el límite de registro, no el de envío)
    try {
      await baileysController.initialize(whatsappId, nombreUsuario || whatsappId, false, true); // isRegistration = true
    } catch (error) {
      if (error.message.includes('espacio disponible')) {
        return res.status(403).json({
          success: false,
          error: error.message
        });
      }
      throw error;
    }

    // Esperar a que se genere el QR (máximo 30 segundos)
    const qr = await baileysController.waitForQR(whatsappId, 30000, 1000);
    
    if (!qr) {
      // Verificar si ya está conectado
      const status = await baileysController.getStatus(whatsappId);
      if (status.ready) {
        // Ya está conectado, obtener datos y cerrar
        try {
          const socket = baileysController.getSocket(whatsappId);
          const user = socket?.user;
          const numeroReal = user?.id?.split('@')[0] || whatsappId;
          const nombreReal = user?.name || numeroReal || nombreUsuario || whatsappId;
          
          // Guardar en BD
          await conexionesService.createOrUpdateConexion(numeroReal, nombreReal);
          
          // Cerrar el cliente
          await baileysController.logout(whatsappId);
          
          return res.json({
            success: true,
            message: 'Dispositivo registrado y cliente cerrado',
            data: {
              whatsappId: numeroReal,
              nombreUsuario: nombreReal
            }
          });
        } catch (error) {
          return res.status(500).json({
            success: false,
            error: `Error obteniendo datos: ${error.message}`
          });
        }
      }
      
      return res.status(408).json({
        success: false,
        error: 'Timeout esperando QR code. Intenta nuevamente.',
        data: {
          whatsappId,
          suggestion: 'El QR code no se generó a tiempo. Intenta nuevamente.'
        }
      });
    }

    // Marcar esta conexión para que se cierre automáticamente después de registrar
    baileysController.markForAutoClose(whatsappId);
    
    // Retornar QR - el cliente se cerrará automáticamente cuando se conecte (evento ready)
    res.json({
      success: true,
      message: 'QR code generado. Escanea el código con WhatsApp. El cliente se cerrará automáticamente después de registrar los datos.',
      data: {
        whatsappId,
        qr: qr,
        message: 'Escanea el QR code. Una vez conectado, los datos se guardarán automáticamente en la BD y el cliente se cerrará.'
      }
    });

  } catch (error) {
    console.error('Error registrando dispositivo:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

