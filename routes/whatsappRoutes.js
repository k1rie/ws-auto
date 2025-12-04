import express from 'express';
import whatsappController from '../controllers/whatsappController.js';

const router = express.Router();

// Obtener estado de WhatsApp
router.get('/status', (req, res) => {
  try {
    const status = whatsappController.getStatus();
    res.json({
      success: true,
      data: {
        ready: status.ready,
        connected: whatsappController.client !== null,
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

// Obtener QR Code
router.get('/qr', (req, res) => {
  try {
    const qr = whatsappController.getQRCode();
    res.json({
      success: true,
      data: {
        qr: qr
      }
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      error: error.message
    });
  }
});

// Inicializar WhatsApp
router.post('/initialize', (req, res) => {
  try {
    if (whatsappController.client) {
      return res.json({
        success: true,
        message: 'WhatsApp ya está inicializado',
        data: {
          ready: whatsappController.isReady,
          hasQR: !!whatsappController.qrCodeData
        }
      });
    }

    whatsappController.initialize();
    res.json({
      success: true,
      message: 'WhatsApp se está inicializando. Usa GET /api/whatsapp/qr para obtener el QR code.',
      data: {
        initialized: true
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Enviar mensaje
router.post('/send', async (req, res) => {
  try {
    const { number, message } = req.body;

    if (!number || !message) {
      return res.status(400).json({
        success: false,
        error: 'Número y mensaje son requeridos'
      });
    }

    if (!whatsappController.isReady) {
      return res.status(400).json({
        success: false,
        error: 'WhatsApp no está listo. Por favor espera a que se conecte.'
      });
    }

    const result = await whatsappController.sendMessage(number, message);
    
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

// Cerrar sesión de WhatsApp
router.post('/logout', async (req, res) => {
  try {
    const result = await whatsappController.logout();
    
    if (result) {
      res.json({
        success: true,
        message: 'Sesión cerrada exitosamente'
      });
    } else {
      res.status(400).json({
        success: false,
        error: 'No hay sesión activa'
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;

