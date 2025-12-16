import express from 'express';
import { getQueue, initializeConnection, updatePriority, forceProcess } from '../controllers/queueController.js';

const router = express.Router();

// Obtener cola de conexiones
router.get('/', getQueue);

// Inicializar conexión
router.post('/initialize', initializeConnection);

// Actualizar prioridad
router.post('/priority', updatePriority);

// Forzar procesamiento inmediato de mensajes
router.post('/force-process', forceProcess);

export default router;

