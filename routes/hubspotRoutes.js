import express from 'express';
import { previewImport, importFromHubspot } from '../controllers/hubspotImportController.js';

const router = express.Router();

// Preview de lista de HubSpot
router.post('/import-hubspot/preview', previewImport);

// Importar contactos desde HubSpot
router.post('/import-hubspot', importFromHubspot);

export default router;
