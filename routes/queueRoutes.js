import express from 'express';
import { getQueue, initializeConnection, updatePriority } from '../controllers/queueController.js';

const router = express.Router();

// Obtener cola de conexiones
router.get('/', getQueue);

// Inicializar conexión
router.post('/initialize', initializeConnection);

// Actualizar prioridad
router.post('/priority', updatePriority);

export default router;

