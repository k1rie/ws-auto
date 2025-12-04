import express from 'express';
import upload from '../middleware/upload.js';
import { uploadCSV } from '../controllers/csvController.js';

const router = express.Router();

// Subir y procesar CSV
router.post('/upload-csv', upload.single('csv'), uploadCSV);

export default router;

