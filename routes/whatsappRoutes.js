import express from 'express';
import whatsappController from '../controllers/whatsappController.js';

const router = express.Router();

// Obtener estado de WhatsApp para un whatsappId específico
router.get('/status', async (req, res) => {
  try {
    const { whatsappId } = req.query;
    
    if (!whatsappId) {
      return res.status(400).json({
        success: false,
        error: 'whatsappId es requerido'
      });
    }

    const status = await whatsappController.getStatus(whatsappId);
    const client = whatsappController.getClient(whatsappId);
    
    res.json({
      success: true,
      data: {
        whatsappId,
        ready: status.ready,
        connected: client !== null,
        message: status.message
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Obtener QR Code para un whatsappId específico (mejorado: inicializa automáticamente si no existe)
router.get('/qr', async (req, res) => {
  try {
    const { whatsappId, nombreUsuario } = req.query;
    
    if (!whatsappId) {
      return res.status(400).json({
        success: false,
        error: 'whatsappId es requerido'
      });
    }

    // Verificar si el cliente existe
    let client = whatsappController.getClient(whatsappId);
    
    // Si no existe cliente, inicializar automáticamente
    if (!client) {
      console.log(`Cliente ${whatsappId} no existe, inicializando automáticamente...`);
      try {
        await whatsappController.initialize(whatsappId, nombreUsuario || whatsappId);
        client = whatsappController.getClient(whatsappId);
      } catch (error) {
        return res.status(error.message.includes('espacio disponible') ? 403 : 500).json({
          success: false,
          error: error.message,
          data: {
            whatsappId,
            needsInitialization: true
          }
        });
      }
    }

    // Verificar si ya está conectado
    const status = await whatsappController.getStatus(whatsappId);
    if (status.ready) {
      return res.json({
        success: true,
        message: 'WhatsApp ya está conectado, no necesita QR',
        data: {
          whatsappId,
          connected: true,
          ready: true,
          qr: null
        }
      });
    }

    // Intentar obtener QR inmediatamente
    let qr = whatsappController.qrCodes.get(whatsappId);
    if (qr) {
      return res.json({
        success: true,
        data: {
          whatsappId,
          qr: qr
        }
      });
    }

    // Si no hay QR disponible, esperar un poco (el cliente podría estar inicializando)
    console.log(`QR no disponible aún para ${whatsappId}, esperando...`);
    qr = await whatsappController.waitForQR(whatsappId, 15000, 500); // Esperar hasta 15 segundos
    
    if (qr) {
      return res.json({
        success: true,
        data: {
          whatsappId,
          qr: qr
        }
      });
    }
    
    // Verificar si ya está conectado
    const currentStatus = await whatsappController.getStatus(whatsappId);
    if (currentStatus.ready) {
      return res.json({
        success: true,
        message: 'WhatsApp ya está conectado',
        data: {
          whatsappId,
          connected: true,
          ready: true,
          qr: null
        }
      });
    }
    
    // Si después de esperar no hay QR, el cliente podría necesitar reinicialización
    return res.status(404).json({
      success: false,
      error: 'No hay QR disponible después de esperar. El cliente podría necesitar reinicialización. Usa POST /api/whatsapp/connect para reinicializar.',
      data: {
        whatsappId,
        connected: false,
        ready: false,
        suggestion: 'POST /api/whatsapp/connect'
      }
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      error: error.message
    });
  }
});

// Inicializar WhatsApp para un whatsappId específico
router.post('/initialize', async (req, res) => {
  try {
    const { whatsappId, nombreUsuario } = req.body;
    
    if (!whatsappId) {
      return res.status(400).json({
        success: false,
        error: 'whatsappId es requerido'
      });
    }

    const client = whatsappController.getClient(whatsappId);
    if (client) {
      const status = await whatsappController.getStatus(whatsappId);
      const qr = whatsappController.qrCodes.get(whatsappId);
      
      return res.json({
        success: true,
        message: 'WhatsApp ya está inicializado',
        data: {
          whatsappId,
          ready: status.ready,
          hasQR: !!qr
        }
      });
    }

    await whatsappController.initialize(whatsappId, nombreUsuario);
    res.json({
      success: true,
      message: 'WhatsApp se está inicializando. Usa GET /api/whatsapp/qr?whatsappId=xxx para obtener el QR code.',
      data: {
        whatsappId,
        initialized: true
      }
    });
  } catch (error) {
    res.status(error.message.includes('espacio disponible') ? 403 : 500).json({
      success: false,
      error: error.message
    });
  }
});

// Enviar mensaje usando un whatsappId específico
router.post('/send', async (req, res) => {
  try {
    const { whatsappId, number, message } = req.body;

    if (!whatsappId || !number || !message) {
      return res.status(400).json({
        success: false,
        error: 'whatsappId, número y mensaje son requeridos'
      });
    }

    const status = await whatsappController.getStatus(whatsappId);
    if (!status.ready) {
      return res.status(400).json({
        success: false,
        error: 'WhatsApp no está listo. Por favor espera a que se conecte.'
      });
    }

    const result = await whatsappController.sendMessage(whatsappId, number, message);
    
    res.json({
      success: true,
      message: 'Mensaje enviado exitosamente',
      data: result
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Inicializar WhatsApp y obtener QR en un solo paso
router.post('/connect', async (req, res) => {
  try {
    const { whatsappId, nombreUsuario } = req.body;
    
    if (!whatsappId) {
      return res.status(400).json({
        success: false,
        error: 'whatsappId es requerido'
      });
    }

    // Verificar si ya está conectado
    const existingClient = whatsappController.getClient(whatsappId);
    let status = null;
    let existingQR = null;
    
    if (existingClient) {
      status = await whatsappController.getStatus(whatsappId);
      
      if (status.ready) {
        return res.json({
          success: true,
          message: 'WhatsApp ya está conectado',
          data: {
            whatsappId,
            connected: true,
            ready: true,
            qr: null
          }
        });
      }

      // Si está inicializado pero no conectado, verificar si hay QR
      existingQR = whatsappController.qrCodes.get(whatsappId);
      if (existingQR) {
        return res.json({
          success: true,
          message: 'QR code disponible',
          data: {
            whatsappId,
            connected: false,
            ready: false,
            qr: existingQR
          }
        });
      }
    }

    // Inicializar cliente (forzar reinicialización si no tiene QR y no está listo)
    const needsReinit = existingClient && status && !status.ready && !existingQR;
    await whatsappController.initialize(whatsappId, nombreUsuario, needsReinit);

    // Esperar a que se genere el QR (máximo 30 segundos)
    const qr = await whatsappController.waitForQR(whatsappId, 30000, 1000);

    if (qr) {
      res.json({
        success: true,
        message: 'QR code generado exitosamente. Escanea el código con WhatsApp.',
        data: {
          whatsappId,
          connected: false,
          ready: false,
          qr: qr
        }
      });
    } else {
      // Verificar si ya está conectado (puede haber sido muy rápido)
      const status = await whatsappController.getStatus(whatsappId);
      if (status.ready) {
        res.json({
          success: true,
          message: 'WhatsApp conectado exitosamente (sin necesidad de QR)',
          data: {
            whatsappId,
            connected: true,
            ready: true,
            qr: null
          }
        });
      } else {
        res.status(408).json({
          success: false,
          error: 'Timeout esperando QR code. Intenta nuevamente o usa GET /api/whatsapp/qr?whatsappId=xxx',
          data: {
            whatsappId,
            connected: false,
            ready: false,
            qr: null
          }
        });
      }
    }
  } catch (error) {
    res.status(error.message.includes('espacio disponible') ? 403 : 500).json({
      success: false,
      error: error.message
    });
  }
});

// Cerrar sesión de WhatsApp para un whatsappId específico
router.post('/logout', async (req, res) => {
  try {
    const { whatsappId } = req.body;
    
    if (!whatsappId) {
      return res.status(400).json({
        success: false,
        error: 'whatsappId es requerido'
      });
    }

    const result = await whatsappController.logout(whatsappId);
    
    if (result) {
      res.json({
        success: true,
        message: 'Sesión cerrada exitosamente'
      });
    } else {
      res.status(400).json({
        success: false,
        error: 'No hay sesión activa para este whatsappId'
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Reiniciar todos los sockets (desconectar todas las conexiones)
router.post('/reset-sockets', async (req, res) => {
  try {
    const resultado = await whatsappController.resetAllSockets();
    
    res.json({
      success: true,
      message: `Reinicio completado. ${resultado.total} socket(s) procesado(s)`,
      data: resultado
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Obtener información de chats y respuestas para todos los números conectados
router.get('/chats-responses', async (req, res) => {
  try {
    const { limit, fechaInicio, fechaFin } = req.query;
    const limitMensajes = limit ? parseInt(limit) : 100;
    
    if (isNaN(limitMensajes) || limitMensajes < 1 || limitMensajes > 500) {
      return res.status(400).json({
        success: false,
        error: 'El parámetro limit debe ser un número entre 1 y 500'
      });
    }

    // Validar y parsear fechas
    let fechaInicioDate = null;
    let fechaFinDate = null;
    
    if (fechaInicio) {
      fechaInicioDate = new Date(fechaInicio);
      if (isNaN(fechaInicioDate.getTime())) {
        return res.status(400).json({
          success: false,
          error: 'El parámetro fechaInicio debe ser una fecha válida (formato: YYYY-MM-DD o ISO 8601)'
        });
      }
    }
    
    if (fechaFin) {
      fechaFinDate = new Date(fechaFin);
      if (isNaN(fechaFinDate.getTime())) {
        return res.status(400).json({
          success: false,
          error: 'El parámetro fechaFin debe ser una fecha válida (formato: YYYY-MM-DD o ISO 8601)'
        });
      }
    }
    
    // Validar que fechaInicio sea anterior a fechaFin
    if (fechaInicioDate && fechaFinDate && fechaInicioDate > fechaFinDate) {
      return res.status(400).json({
        success: false,
        error: 'La fecha de inicio debe ser anterior o igual a la fecha de fin'
      });
    }

    const resultados = await whatsappController.getChatsWithResponses(
      limitMensajes, 
      fechaInicioDate, 
      fechaFinDate
    );
    
    const filtros = {};
    if (fechaInicioDate) filtros.fechaInicio = fechaInicioDate.toISOString().split('T')[0];
    if (fechaFinDate) filtros.fechaFin = fechaFinDate.toISOString().split('T')[0];
    
    res.json({
      success: true,
      message: `Información de chats obtenida para ${resultados.length} número(s) conectado(s)`,
      data: {
        totalNumeros: resultados.length,
        limitMensajesPorChat: limitMensajes,
        filtros: Object.keys(filtros).length > 0 ? filtros : null,
        numeros: resultados
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;

