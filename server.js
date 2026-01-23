import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import healthRoutes from './routes/healthRoutes.js';
import whatsappRoutes from './routes/whatsappRoutes.js';
import csvRoutes from './routes/csvRoutes.js';
import conexionesRoutes from './routes/conexionesRoutes.js';
import contactosRoutes from './routes/contactosRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import queueRoutes from './routes/queueRoutes.js';
import deviceRoutes from './routes/deviceRoutes.js';
import hubspotRoutes from './routes/hubspotRoutes.js';
import configuracionRoutes from './routes/configuracionRoutes.js';
import baileysController from './controllers/baileysController.js';
import mensajeriaService from './services/mensajeriaService.js';
import { testConnection } from './config/database.js';
import { ensureContactScheduleColumns } from './models/contactosModel.js';
import { resetMensajesDiarios, updateFasesTodasConexiones } from './models/conexionesModel.js';
import cron from 'node-cron';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors()); // Permitir CORS para frontend
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/', healthRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api', csvRoutes);
app.use('/api/conexiones', conexionesRoutes);
app.use('/api/contactos', contactosRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/queue', queueRoutes);
app.use('/api/device', deviceRoutes);
app.use('/api', hubspotRoutes);
app.use('/api/configuracion', configuracionRoutes);

// Inicializar base de datos al arrancar
async function initializeDatabase() {
  const connected = await testConnection();
  if (!connected) {
    console.warn('[WARN] No se pudo conectar a la base de datos. Algunas funcionalidades pueden no estar disponibles.');
    return false;
  }

  // Intentar asegurar columnas nuevas antes de arrancar mensajería
  try {
    await ensureContactScheduleColumns();
  } catch (error) {
    console.warn(`[WARN] No se pudieron asegurar columnas de programación en contactos: ${error.message}`);
  }

  return true;
}

// Inicializar servicio de mensajería automática
async function initializeMensajeria() {
  try {
    await mensajeriaService.start();
    console.log('[INFO] Servicio de mensajería automática iniciado');
    // Ejecutar un primer procesamiento inmediato (cron seguirá cada 5 min)
    try {
      await mensajeriaService.forceProcess();
    } catch (e) {
      // ignore
    }
  } catch (error) {
    console.error('[ERROR] Error iniciando servicio de mensajería:', error);
  }
}

// Configurar cron job para resetear mensajes diarios a medianoche
cron.schedule('0 0 * * *', async () => {
  console.log('[INFO] Ejecutando reseteo diario de mensajes...');
  try {
    await resetMensajesDiarios();
  } catch (error) {
    console.error('Error en reseteo diario:', error);
  }
}, {
  timezone: 'America/Mexico_City' // Ajustar según tu zona horaria
});

// Configurar cron job para actualizar fases de conexiones cada hora
cron.schedule('0 * * * *', async () => {
  console.log('[INFO] Ejecutando actualización periódica de fases...');
  try {
    await updateFasesTodasConexiones();
  } catch (error) {
    console.error('Error en actualización de fases:', error);
  }
}, {
  timezone: 'America/Mexico_City' // Ajustar según tu zona horaria
});

// Envío automático: ejecutar cada 5 minutos vía CRON (no setInterval)
cron.schedule('*/5 * * * *', async () => {
  try {
    // Si el servicio no está "habilitado", no procesar
    if (!mensajeriaService.getStatus().isRunning) {
      return;
    }
    await mensajeriaService.forceProcess();
  } catch (error) {
    // Puede fallar si ya hay un batch en curso; no es crítico
    console.warn(`[WARN] Cron de envío: ${error.message}`);
  }
}, {
  timezone: 'America/Mexico_City'
});

// Crear servidor HTTP
const server = app.listen(PORT, async () => {
  console.log(`[INFO] Servidor API corriendo en puerto ${PORT}`);
  console.log('[INFO] Endpoints disponibles:');
  console.log(`   GET  http://localhost:${PORT}/health`);
  console.log(`   POST http://localhost:${PORT}/api/whatsapp/connect (recomendado: inicializa y obtiene QR)`);
  console.log(`   GET  http://localhost:${PORT}/api/whatsapp/status?whatsappId=xxx`);
  console.log(`   GET  http://localhost:${PORT}/api/whatsapp/qr?whatsappId=xxx`);
  console.log(`   POST http://localhost:${PORT}/api/whatsapp/initialize`);
  console.log(`   POST http://localhost:${PORT}/api/whatsapp/send`);
  console.log(`   POST http://localhost:${PORT}/api/whatsapp/logout`);
  console.log(`   POST http://localhost:${PORT}/api/whatsapp/reset-sockets (reiniciar todos los sockets)`);
  console.log(`   GET  http://localhost:${PORT}/api/whatsapp/chats-responses (obtener chats y respuestas - ?fechaInicio=YYYY-MM-DD&fechaFin=YYYY-MM-DD&limit=100)`);
  console.log(`   POST http://localhost:${PORT}/api/upload-csv`);
  console.log(`   GET  http://localhost:${PORT}/api/conexiones`);
  console.log(`   POST http://localhost:${PORT}/api/conexiones (crear conexión en BD)`);
  console.log(`   POST http://localhost:${PORT}/api/conexiones/register (registrar dispositivo: QR -> guardar -> cerrar)`);
  console.log(`   GET  http://localhost:${PORT}/api/contactos?sessionId=xxx`);
  console.log(`   GET  http://localhost:${PORT}/api/dashboard`);
  console.log(`   GET  http://localhost:${PORT}/api/queue`);
  console.log(`   POST http://localhost:${PORT}/api/queue/force-process (forzar procesamiento inmediato)`);
  console.log(`   GET  http://localhost:${PORT}/api/device/info?whatsappId=xxx`);
  console.log(`   POST http://localhost:${PORT}/api/import-hubspot/preview (confirmar cantidad antes de importar)`);
  console.log(`   POST http://localhost:${PORT}/api/import-hubspot (importar lista de HubSpot con IA)`);
  console.log('\n[INFO] Configuración:');
  console.log(`   Max conexiones para envío: ${process.env.MAX_CONEXIONES || 1}`);
  console.log(`   Max conexiones para registro: ${process.env.MAX_CONEXIONES_REGISTRO || 2}`);
  
  // Inicializar base de datos
  const dbConnected = await initializeDatabase();
  
  // Inicializar servicio de mensajería automática si la BD está conectada
  if (dbConnected) {
    await initializeMensajeria();
    
    // Actualizar fases de conexiones al iniciar el servidor
    console.log('[INFO] Actualizando fases de conexiones al iniciar...');
    try {
      await updateFasesTodasConexiones();
    } catch (error) {
      console.error('Error actualizando fases al iniciar:', error);
    }
  }
});

// Manejar cierre graceful
process.on('SIGTERM', () => {
  console.log('SIGTERM recibido, cerrando servidor...');
  mensajeriaService.stop();
  // Baileys no tiene método destroy, los sockets se cierran automáticamente
  server.close(() => {
    console.log('Servidor cerrado');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT recibido, cerrando servidor...');
  mensajeriaService.stop();
  // Baileys no tiene método destroy, los sockets se cierran automáticamente
  server.close(() => {
    console.log('Servidor cerrado');
    process.exit(0);
  });
});

