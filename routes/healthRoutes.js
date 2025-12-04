import express from 'express';
import whatsappController from '../controllers/whatsappController.js';
import conexionesService from '../services/conexionesService.js';
import { testConnection } from '../config/database.js';

const router = express.Router();

// Health check endpoint
router.get('/health', async (req, res) => {
  const dbConnected = await testConnection();
  const activeConnections = whatsappController.clients.size;
  
  res.json({ 
    status: 'ok', 
    message: 'Server is running',
    database: {
      connected: dbConnected
    },
    whatsapp: {
      activeConnections,
      maxConnections: conexionesService.MAX_CONEXIONES
    }
  });
});

export default router;

