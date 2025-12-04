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
import whatsappController from './controllers/whatsappController.js';
import mensajeriaService from './services/mensajeriaService.js';
import { testConnection } from './config/database.js';
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

// Inicializar base de datos al arrancar
async function initializeDatabase() {
  const connected = await testConnection();
  if (!connected) {
    console.warn('⚠️  Advertencia: No se pudo conectar a la base de datos. Algunas funcionalidades pueden no estar disponibles.');
    return false;
  }
  return true;
}

// Inicializar servicio de mensajería automática
async function initializeMensajeria() {
  try {
    await mensajeriaService.start();
    console.log('✅ Servicio de mensajería automática iniciado');
  } catch (error) {
    console.error('❌ Error iniciando servicio de mensajería:', error);
  }
}

// Configurar cron job para resetear mensajes diarios a medianoche
cron.schedule('0 0 * * *', async () => {
  console.log('🔄 Ejecutando reseteo diario de mensajes...');
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
  console.log('🔄 Ejecutando actualización periódica de fases...');
  try {
    await updateFasesTodasConexiones();
  } catch (error) {
    console.error('Error en actualización de fases:', error);
  }
}, {
  timezone: 'America/Mexico_City' // Ajustar según tu zona horaria
});

// Crear servidor HTTP
const server = app.listen(PORT, async () => {
  console.log(`🚀 Servidor API corriendo en puerto ${PORT}`);
  console.log(`📚 Endpoints disponibles:`);
  console.log(`   GET  http://localhost:${PORT}/health`);
  console.log(`   POST http://localhost:${PORT}/api/whatsapp/connect (⭐ Recomendado: inicializa y obtiene QR)`);
  console.log(`   GET  http://localhost:${PORT}/api/whatsapp/status?whatsappId=xxx`);
  console.log(`   GET  http://localhost:${PORT}/api/whatsapp/qr?whatsappId=xxx`);
  console.log(`   POST http://localhost:${PORT}/api/whatsapp/initialize`);
  console.log(`   POST http://localhost:${PORT}/api/whatsapp/send`);
  console.log(`   POST http://localhost:${PORT}/api/whatsapp/logout`);
  console.log(`   POST http://localhost:${PORT}/api/whatsapp/reset-sockets (🔄 Reiniciar todos los sockets)`);
  console.log(`   POST http://localhost:${PORT}/api/upload-csv`);
  console.log(`   GET  http://localhost:${PORT}/api/conexiones`);
  console.log(`   GET  http://localhost:${PORT}/api/contactos?sessionId=xxx`);
  console.log(`   GET  http://localhost:${PORT}/api/dashboard`);
  console.log(`   GET  http://localhost:${PORT}/api/queue`);
  console.log(`   GET  http://localhost:${PORT}/api/device/info?whatsappId=xxx`);
  console.log(`\n📊 Configuración:`);
  console.log(`   Máximo de conexiones simultáneas: ${process.env.MAX_CONEXIONES || 1}`);
  
  // Inicializar base de datos
  const dbConnected = await initializeDatabase();
  
  // Inicializar servicio de mensajería automática si la BD está conectada
  if (dbConnected) {
    await initializeMensajeria();
    
    // Actualizar fases de conexiones al iniciar el servidor
    console.log('🔄 Actualizando fases de conexiones al iniciar...');
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
  whatsappController.destroy();
  server.close(() => {
    console.log('Servidor cerrado');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT recibido, cerrando servidor...');
  mensajeriaService.stop();
  whatsappController.destroy();
  server.close(() => {
    console.log('Servidor cerrado');
    process.exit(0);
  });
});

