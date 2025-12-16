# WhatsApp API REST

API REST para envío y recepción de mensajes de WhatsApp usando `whatsapp-web.js`. Optimizada para uso desde frontend y despliegue en Koyeb con soporte para una sola sesión a la vez.

## 🚀 Inicio Rápido

```bash
# 1. Instalar dependencias
npm install

# 2. Ejecutar servidor
npm run dev
```

**Ver [GUIA_USO.md](./GUIA_USO.md) para documentación completa de todos los endpoints.**

## Características

- ✅ API REST para envío de mensajes de WhatsApp
- ✅ Envío de mensajes mediante endpoints HTTP
- ✅ Una sola sesión activa (optimizado para Koyeb)
- ✅ Generación automática de QR para autenticación
- ✅ CORS habilitado para uso desde frontend
- ✅ Dockerizado y listo para producción
- ✅ Health check endpoint
- ✅ Verificación automática de números de WhatsApp antes de agregar contactos (usando APIs externas)

## Requisitos

- Node.js >= 18.0.0
- npm o yarn

## Instalación Local

1. Clonar el repositorio o descargar los archivos
2. Instalar dependencias:

```bash
npm install
```

3. Crear archivo `.env` (opcional, el puerto por defecto es 3000):

```bash
cp .env.example .env
```

4. Ejecutar en modo desarrollo:

```bash
npm run dev
```

5. Ejecutar en producción:

```bash
npm start
```

## Endpoints de la API

### Principales

- `GET /health` - Health check del servidor
- `GET /api/whatsapp/status` - Obtener estado de WhatsApp
- `POST /api/whatsapp/initialize` - Inicializar WhatsApp
- `GET /api/whatsapp/qr` - Obtener código QR
- `POST /api/whatsapp/send` - Enviar mensaje
- `POST /api/whatsapp/logout` - Cerrar sesión

**Ver [GUIA_USO.md](./GUIA_USO.md) para documentación completa de cada endpoint con ejemplos.**

## Despliegue en Koyeb

**📖 Ver [DESPLIEGUE_KOYEB.md](./DESPLIEGUE_KOYEB.md) para una guía completa paso a paso.**

### Resumen Rápido

1. **Sube todo tu código a GitHub** (no solo el Dockerfile)
2. En Koyeb, crea un nuevo servicio desde GitHub
3. Koyeb detectará automáticamente el Dockerfile
4. Configura el puerto `3000`
5. Despliega

**Importante**: Necesitas subir **todo el proyecto** a GitHub, no solo el Dockerfile. Koyeb usará el Dockerfile para construir la imagen, pero necesita todos los archivos del proyecto.

### Variables de Entorno en Koyeb

- `PORT`: Puerto del servidor (por defecto: 3000)
- `NODE_ENV`: `production`

**📖 Ver [VERIFICACION_NUMEROS.md](./VERIFICACION_NUMEROS.md) para más información sobre la verificación de números.**

### Notas Importantes

- **Una sola sesión**: El código está optimizado para mantener solo una sesión activa
- **Persistencia**: Usa volúmenes persistentes en Koyeb para mantener la sesión entre reinicios (path: `/app/.wwebjs_auth`)
- **Recursos**: Mínimo 512MB RAM recomendado

## Ejemplo Rápido

```javascript
// Inicializar WhatsApp
await fetch('http://localhost:3000/api/whatsapp/initialize', { method: 'POST' });

// Obtener QR
const qrResponse = await fetch('http://localhost:3000/api/whatsapp/qr');
const qrData = await qrResponse.json();
console.log('QR Code:', qrData.data.qr);

// Enviar mensaje
await fetch('http://localhost:3000/api/whatsapp/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    number: '521234567890',
    message: 'Hola desde la API!'
  })
});
```

## Estructura del Proyecto

```
.
├── server.js                    # Servidor principal
├── controllers/
│   └── whatsappController.js   # Lógica de WhatsApp
├── routes/
│   ├── healthRoutes.js         # Rutas de health check
│   └── whatsappRoutes.js      # Rutas de la API WhatsApp
├── package.json                # Dependencias
├── Dockerfile                 # Configuración Docker
├── .dockerignore              # Archivos ignorados en Docker
├── .gitignore                 # Archivos ignorados en Git
├── README.md                   # Este archivo
├── GUIA_USO.md                # Guía completa de endpoints
└── INICIO_RAPIDO.md           # Guía de inicio rápido
```

## Solución de Problemas

### Error: "WhatsApp no está listo"
- Espera a que el QR code se genere y se escanee
- Verifica que la conexión a Internet esté activa
- Revisa los logs del servidor

### Error: "Error al enviar mensaje"
- Verifica que el número esté en el formato correcto (con código de país)
- Asegúrate de que el número tenga WhatsApp activo
- Verifica que el mensaje no esté vacío

### La sesión se pierde al reiniciar
- Esto es normal si no usas volúmenes persistentes
- Escanea el QR nuevamente después de cada reinicio
- Considera usar volúmenes en Koyeb para persistir `.wwebjs_auth/`

## Licencia

ISC

# ws-auto
