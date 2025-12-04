# 📖 Guía de Uso - API REST WhatsApp

API REST para envío de mensajes de WhatsApp. Optimizada para uso desde frontend.

## 🚀 Inicio Rápido

### Paso 1: Instalar y Ejecutar

```bash
# 1. Instalar dependencias
npm install

# 2. Ejecutar servidor
npm run dev
```

El servidor estará disponible en `http://localhost:3000`

### Paso 2: Verificar que Funciona

```bash
curl http://localhost:3000/health
```

O abre en tu navegador: `http://localhost:3000/health`

## 📚 Endpoints de la API

Base URL: `http://localhost:3000` (o tu URL de producción)

### 1. Health Check

Verifica que el servidor esté funcionando.

**Endpoint:** `GET /health`

**Respuesta:**
```json
{
  "status": "ok",
  "message": "Server is running",
  "whatsapp": {
    "ready": false,
    "connected": false
  }
}
```

**Ejemplo:**
```bash
curl http://localhost:3000/health
```

---

### 2. Obtener Estado de WhatsApp

Obtiene el estado actual de la conexión de WhatsApp.

**Endpoint:** `GET /api/whatsapp/status`

**Respuesta Exitosa (200):**
```json
{
  "success": true,
  "data": {
    "ready": true,
    "connected": true,
    "message": "Conectado"
  }
}
```

**Ejemplo:**
```bash
curl http://localhost:3000/api/whatsapp/status
```

**Ejemplo en JavaScript:**
```javascript
const response = await fetch('http://localhost:3000/api/whatsapp/status');
const data = await response.json();
console.log(data);
```

---

### 3. Inicializar WhatsApp

Inicializa la conexión de WhatsApp. Después de llamar este endpoint, usa `/api/whatsapp/qr` para obtener el código QR.

**Endpoint:** `POST /api/whatsapp/initialize`

**Respuesta Exitosa (200):**
```json
{
  "success": true,
  "message": "WhatsApp se está inicializando. Usa GET /api/whatsapp/qr para obtener el QR code.",
  "data": {
    "initialized": true
  }
}
```

**Ejemplo:**
```bash
curl -X POST http://localhost:3000/api/whatsapp/initialize
```

**Ejemplo en JavaScript:**
```javascript
const response = await fetch('http://localhost:3000/api/whatsapp/initialize', {
  method: 'POST'
});
const data = await response.json();
```

---

### 4. Obtener Código QR

Obtiene el código QR para escanear con WhatsApp. Solo disponible si WhatsApp está inicializado pero no autenticado.

**Endpoint:** `GET /api/whatsapp/qr`

**Respuesta Exitosa (200):**
```json
{
  "success": true,
  "data": {
    "qr": "código_qr_aqui"
  }
}
```

**Respuesta de Error (404):**
```json
{
  "success": false,
  "error": "No hay QR disponible"
}
```

**Ejemplo:**
```bash
curl http://localhost:3000/api/whatsapp/qr
```

**Ejemplo en JavaScript:**
```javascript
const response = await fetch('http://localhost:3000/api/whatsapp/qr');
const data = await response.json();

if (data.success) {
  // Mostrar QR code usando una librería como qrcode.js
  console.log('QR Code:', data.data.qr);
}
```

**Flujo completo de autenticación:**
```javascript
// 1. Inicializar
await fetch('http://localhost:3000/api/whatsapp/initialize', { method: 'POST' });

// 2. Obtener QR (puede requerir varios intentos hasta que esté disponible)
let qrData = null;
while (!qrData) {
  const response = await fetch('http://localhost:3000/api/whatsapp/qr');
  const data = await response.json();
  if (data.success) {
    qrData = data.data.qr;
    break;
  }
  await new Promise(resolve => setTimeout(resolve, 2000)); // Esperar 2 segundos
}

// 3. Mostrar QR para escanear
// 4. Verificar estado hasta que esté "ready"
```

---

### 5. Enviar Mensaje

Envía un mensaje de WhatsApp a un número específico.

**Endpoint:** `POST /api/whatsapp/send`

**Body (JSON):**
```json
{
  "number": "521234567890",
  "message": "Hola! Este es un mensaje de prueba"
}
```

**Parámetros:**
- `number` (requerido): Número de teléfono con código de país, sin el signo `+`
- `message` (requerido): Texto del mensaje a enviar

**Respuesta Exitosa (200):**
```json
{
  "success": true,
  "message": "Mensaje enviado exitosamente",
  "data": {
    "id": "3EB0C767F26DE8B4",
    "to": "521234567890@c.us",
    "message": "Hola! Este es un mensaje de prueba",
    "timestamp": 1234567890
  }
}
```

**Respuesta de Error (400):**
```json
{
  "success": false,
  "error": "WhatsApp no está listo. Por favor espera a que se conecte."
}
```

**Ejemplo:**
```bash
curl -X POST http://localhost:3000/api/whatsapp/send \
  -H "Content-Type: application/json" \
  -d '{
    "number": "521234567890",
    "message": "Hola desde la API!"
  }'
```

**Ejemplo en JavaScript:**
```javascript
const response = await fetch('http://localhost:3000/api/whatsapp/send', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    number: '521234567890',
    message: 'Hola desde la API!'
  })
});

const data = await response.json();
if (data.success) {
  console.log('Mensaje enviado:', data.data);
} else {
  console.error('Error:', data.error);
}
```

**Formato del número:**
- ✅ Correcto: `521234567890` (México - código 52)
- ✅ Correcto: `11234567890` (USA - código 1)
- ✅ Correcto: `34123456789` (España - código 34)
- ❌ Incorrecto: `+521234567890` (no incluyas el +)
- ❌ Incorrecto: `1234567890` (falta código de país)

---

### 6. Cerrar Sesión

Cierra la sesión de WhatsApp.

**Endpoint:** `POST /api/whatsapp/logout`

**Respuesta Exitosa (200):**
```json
{
  "success": true,
  "message": "Sesión cerrada exitosamente"
}
```

**Respuesta de Error (400):**
```json
{
  "success": false,
  "error": "No hay sesión activa"
}
```

**Ejemplo:**
```bash
curl -X POST http://localhost:3000/api/whatsapp/logout
```

**Ejemplo en JavaScript:**
```javascript
const response = await fetch('http://localhost:3000/api/whatsapp/logout', {
  method: 'POST'
});
const data = await response.json();
```

---

## 🔄 Flujo Completo de Uso

### 1. Inicializar y Autenticar

```javascript
// Paso 1: Inicializar WhatsApp
const initResponse = await fetch('http://localhost:3000/api/whatsapp/initialize', {
  method: 'POST'
});

// Paso 2: Obtener QR (puede requerir varios intentos)
let qrCode = null;
let attempts = 0;
while (!qrCode && attempts < 10) {
  const qrResponse = await fetch('http://localhost:3000/api/whatsapp/qr');
  const qrData = await qrResponse.json();
  
  if (qrData.success) {
    qrCode = qrData.data.qr;
    // Mostrar QR al usuario para escanear
    break;
  }
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  attempts++;
}

// Paso 3: Verificar estado hasta que esté listo
let isReady = false;
while (!isReady) {
  const statusResponse = await fetch('http://localhost:3000/api/whatsapp/status');
  const statusData = await statusResponse.json();
  
  if (statusData.data.ready) {
    isReady = true;
    console.log('WhatsApp está listo!');
    break;
  }
  
  await new Promise(resolve => setTimeout(resolve, 3000));
}
```

### 2. Enviar Mensaje

```javascript
const sendResponse = await fetch('http://localhost:3000/api/whatsapp/send', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    number: '521234567890',
    message: 'Hola desde mi aplicación!'
  })
});

const sendData = await sendResponse.json();
if (sendData.success) {
  console.log('Mensaje enviado:', sendData.data);
}
```


---

## 💡 Ejemplos Prácticos

### Ejemplo 1: Verificar Estado Antes de Enviar

```javascript
async function enviarMensajeSeguro(number, message) {
  // Verificar estado primero
  const statusResponse = await fetch('http://localhost:3000/api/whatsapp/status');
  const statusData = await statusResponse.json();
  
  if (!statusData.data.ready) {
    throw new Error('WhatsApp no está listo');
  }
  
  // Enviar mensaje
  const sendResponse = await fetch('http://localhost:3000/api/whatsapp/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ number, message })
  });
  
  return await sendResponse.json();
}
```

### Ejemplo 2: React Hook para WhatsApp

```javascript
import { useState, useEffect } from 'react';

function useWhatsApp() {
  const [status, setStatus] = useState(null);
  const API_URL = 'http://localhost:3000/api/whatsapp';

  // Obtener estado
  const getStatus = async () => {
    const response = await fetch(`${API_URL}/status`);
    const data = await response.json();
    setStatus(data.data);
    return data.data;
  };

  // Inicializar
  const initialize = async () => {
    await fetch(`${API_URL}/initialize`, { method: 'POST' });
  };

  // Obtener QR
  const getQR = async () => {
    const response = await fetch(`${API_URL}/qr`);
    const data = await response.json();
    return data.success ? data.data.qr : null;
  };

  // Enviar mensaje
  const sendMessage = async (number, message) => {
    const response = await fetch(`${API_URL}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number, message })
    });
    return await response.json();
  };

  // Polling de estado
  useEffect(() => {
    const interval = setInterval(getStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  return {
    status,
    getStatus,
    initialize,
    getQR,
    sendMessage
  };
}
```

---

## 🌐 CORS

La API está configurada con CORS habilitado, por lo que puedes hacer requests desde cualquier frontend. Si necesitas restringir el acceso, configura las opciones de CORS en `server.js`.

---

## ❓ Preguntas Frecuentes

### ¿Cómo formateo el número correctamente?
- Incluye código de país sin el signo `+`
- Ejemplo México: `521234567890` (no `+521234567890`)

### ¿Puedo enviar imágenes o archivos?
- Actualmente solo soporta mensajes de texto
- Para multimedia, necesitarías extender el código

### ¿Qué pasa si el servidor se reinicia?
- Necesitarás inicializar y escanear el QR nuevamente
- Para mantener la sesión, usa volúmenes persistentes en Koyeb

### ¿La API puede recibir mensajes?
- No, esta API está diseñada solo para enviar mensajes
- Si necesitas recibir mensajes, deberías usar otra solución o extender el código

### ¿Puedo tener múltiples sesiones?
- No, está diseñado para una sola sesión (optimizado para Koyeb)

---

## 🐛 Códigos de Estado HTTP

- `200` - Éxito
- `400` - Error de validación o solicitud incorrecta
- `404` - Recurso no encontrado (ej: QR no disponible)
- `500` - Error interno del servidor

---

## 📚 Más Información

- Ver [README.md](./README.md) para documentación completa
- Ver [INICIO_RAPIDO.md](./INICIO_RAPIDO.md) para guía rápida
