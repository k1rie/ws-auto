import express from 'express';
import { getQueue, initializeConnection, updatePriority, forceProcess, pauseSending, resumeSending, getSendingStatus, sendAllNow } from '../controllers/queueController.js';

const router = express.Router();

// Obtener cola de conexiones
router.get('/', getQueue);

// Inicializar conexión
router.post('/initialize', initializeConnection);

// Actualizar prioridad
router.post('/priority', updatePriority);

// Forzar procesamiento inmediato de mensajes
router.post('/force-process', forceProcess);

// Pausar envío de mensajes
router.post('/pause', pauseSending);

// Reanudar envío de mensajes
router.post('/resume', resumeSending);

// Obtener estado del servicio de mensajería
router.get('/sending-status', getSendingStatus);

// Enviar todos los mensajes pendientes inmediatamente
router.post('/send-all-now', sendAllNow);

export default router;

