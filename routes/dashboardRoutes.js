import express from 'express';
import { getDashboard } from '../controllers/dashboardController.js';

const router = express.Router();

// Obtener resumen del dashboard
router.get('/', getDashboard);

export default router;

