import express from 'express';
import whatsappController from '../controllers/whatsappController.js';

const router = express.Router();

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Server is running',
    whatsapp: {
      ready: whatsappController.isReady,
      connected: whatsappController.client !== null
    }
  });
});

export default router;

