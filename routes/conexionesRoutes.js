import express from 'express';
import { getConexiones } from '../controllers/conexionesController.js';

const router = express.Router();

// Obtener todas las conexiones
router.get('/', getConexiones);

export default router;

