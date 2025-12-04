import express from 'express';
import { getDeviceInfo, initializeDevice } from '../controllers/deviceController.js';

const router = express.Router();

// Obtener información del dispositivo
router.get('/info', getDeviceInfo);

// Inicializar dispositivo
router.post('/initialize', initializeDevice);

export default router;

