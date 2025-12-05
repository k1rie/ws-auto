import express from 'express';
import { getConexiones, createConexion, registerDevice } from '../controllers/conexionesController.js';

const router = express.Router();

// Obtener todas las conexiones
router.get('/', getConexiones);

// Crear una conexión en la BD (sin inicializar socket)
router.post('/', createConexion);

// Registrar dispositivo: inicializa, obtiene QR, espera conexión, guarda datos y cierra
router.post('/register', registerDevice);

export default router;

