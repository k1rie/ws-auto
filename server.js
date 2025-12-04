import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import healthRoutes from './routes/healthRoutes.js';
import whatsappRoutes from './routes/whatsappRoutes.js';
import whatsappController from './controllers/whatsappController.js';

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

// Crear servidor HTTP
const server = app.listen(PORT, () => {
  console.log(`🚀 Servidor API corriendo en puerto ${PORT}`);
  console.log(`📚 Endpoints disponibles:`);
  console.log(`   GET  http://localhost:${PORT}/health`);
  console.log(`   GET  http://localhost:${PORT}/api/whatsapp/status`);
  console.log(`   GET  http://localhost:${PORT}/api/whatsapp/qr`);
  console.log(`   POST http://localhost:${PORT}/api/whatsapp/initialize`);
  console.log(`   POST http://localhost:${PORT}/api/whatsapp/send`);
  console.log(`   POST http://localhost:${PORT}/api/whatsapp/logout`);
});

// Manejar cierre graceful
process.on('SIGTERM', () => {
  console.log('SIGTERM recibido, cerrando servidor...');
  whatsappController.destroy();
  server.close(() => {
    console.log('Servidor cerrado');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT recibido, cerrando servidor...');
  whatsappController.destroy();
  server.close(() => {
    console.log('Servidor cerrado');
    process.exit(0);
  });
});

