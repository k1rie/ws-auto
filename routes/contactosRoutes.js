import express from 'express';
import { getContactos } from '../controllers/contactosController.js';

const router = express.Router();

// Obtener contactos de una conexión
router.get('/', getContactos);

export default router;

