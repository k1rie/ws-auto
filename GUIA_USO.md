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

### 2. Conectar WhatsApp y Obtener QR (Recomendado) ⭐

**Endpoint único que inicializa la conexión y devuelve el QR code automáticamente.**

**Endpoint:** `POST /api/whatsapp/connect`

**Body (JSON):**
```json
{
  "whatsappId": "dispositivo-principal",
  "nombreUsuario": "Dispositivo Principal"
}
```

**Parámetros:**
- `whatsappId` (requerido): ID único para identificar la conexión
- `nombreUsuario` (opcional): Nombre descriptivo para la conexión

**Respuesta Exitosa - QR Generado (200):**
```json
{
  "success": true,
  "message": "QR code generado exitosamente. Escanea el código con WhatsApp.",
  "data": {
    "whatsappId": "dispositivo-principal",
    "connected": false,
    "ready": false,
    "qr": "código_qr_aqui"
  }
}
```

**Respuesta Exitosa - Ya Conectado (200):**
```json
{
  "success": true,
  "message": "WhatsApp ya está conectado",
  "data": {
    "whatsappId": "dispositivo-principal",
    "connected": true,
    "ready": true,
    "qr": null
  }
}
```

**Respuesta de Error - Timeout (408):**
```json
{
  "success": false,
  "error": "Timeout esperando QR code. Intenta nuevamente o usa GET /api/whatsapp/qr?whatsappId=xxx",
  "data": {
    "whatsappId": "dispositivo-principal",
    "connected": false,
    "ready": false,
    "qr": null
  }
}
```

**Ejemplo con curl:**
```bash
curl -X POST http://localhost:3000/api/whatsapp/connect \
  -H "Content-Type: application/json" \
  -d '{
    "whatsappId": "dispositivo-principal",
    "nombreUsuario": "Dispositivo Principal"
  }'
```

**Ejemplo en JavaScript:**
```javascript
const response = await fetch('http://localhost:3000/api/whatsapp/connect', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    whatsappId: 'dispositivo-principal',
    nombreUsuario: 'Dispositivo Principal'
  })
});

const data = await response.json();

if (data.success) {
  if (data.data.qr) {
    // Mostrar QR code para escanear
    console.log('QR Code:', data.data.qr);
    // Usar una librería como qrcode.js para mostrar el QR visualmente
    // Ejemplo: QRCode.toCanvas(canvas, data.data.qr);
  } else if (data.data.ready) {
    // Ya está conectado, no necesita QR
    console.log('WhatsApp ya está conectado');
  }
} else {
  console.error('Error:', data.error);
}
```

**Ejemplo completo con React:**
```javascript
import { useState } from 'react';
import QRCode from 'qrcode.react';

function WhatsAppConnect() {
  const [qr, setQr] = useState(null);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);

  const connect = async () => {
    setLoading(true);
    try {
      const response = await fetch('http://localhost:3000/api/whatsapp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          whatsappId: 'dispositivo-principal',
          nombreUsuario: 'Dispositivo Principal'
        })
      });

      const data = await response.json();
      
      if (data.success) {
        if (data.data.qr) {
          setQr(data.data.qr);
        } else if (data.data.ready) {
          setConnected(true);
          setQr(null);
        }
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <button onClick={connect} disabled={loading}>
        {loading ? 'Conectando...' : 'Conectar WhatsApp'}
      </button>
      
      {qr && (
        <div>
          <p>Escanea este código QR con WhatsApp:</p>
          <QRCode value={qr} size={256} />
        </div>
      )}
      
      {connected && <p>✅ WhatsApp conectado exitosamente</p>}
    </div>
  );
}
```

**Ventajas de este endpoint:**
- ✅ **Un solo paso**: Inicializa y obtiene el QR en una sola llamada
- ✅ **Automático**: Espera automáticamente a que se genere el QR (hasta 30 segundos)
- ✅ **Simple**: No necesitas hacer polling manual
- ✅ **Inteligente**: Detecta si ya está conectado y retorna el estado apropiado

---

### 3. Obtener Estado de WhatsApp

Obtiene el estado actual de la conexión de WhatsApp.

**Endpoint:** `GET /api/whatsapp/status?whatsappId=xxx`

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
curl "http://localhost:3000/api/whatsapp/status?whatsappId=dispositivo-principal"
```

**Ejemplo en JavaScript:**
```javascript
const response = await fetch('http://localhost:3000/api/whatsapp/status?whatsappId=dispositivo-principal');
const data = await response.json();
console.log(data);
```

---

### 4. Inicializar WhatsApp (Método Manual)

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

### 5. Obtener Código QR (Método Manual)

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

**Flujo completo de autenticación (Método Manual):**
```javascript
// 1. Inicializar
await fetch('http://localhost:3000/api/whatsapp/initialize', { 
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    whatsappId: 'dispositivo-principal',
    nombreUsuario: 'Dispositivo Principal'
  })
});

// 2. Obtener QR (puede requerir varios intentos hasta que esté disponible)
let qrData = null;
while (!qrData) {
  const response = await fetch('http://localhost:3000/api/whatsapp/qr?whatsappId=dispositivo-principal');
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

**💡 Recomendación:** Usa el endpoint `/api/whatsapp/connect` (sección 2) para un proceso más simple y automático.

---

### 6. Enviar Mensaje

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

## 🎯 Nuevos Endpoints - Dashboard y Gestión

### 1. Dashboard - Resumen General

Obtiene métricas y estadísticas generales del sistema.

**Endpoint:** `GET /api/dashboard`

**Respuesta:**
```json
{
  "success": true,
  "data": {
    "metricas": {
      "mensajesEnviados": {
        "valor": 1250,
        "tendencia": "+12%",
        "hoy": 45
      },
      "conexionesActivas": {
        "valor": 2,
        "estado": "Conectado",
        "maxConexiones": 3
      },
      "numerosRegistrados": {
        "valor": 5000,
        "tendencia": "+25 esta semana"
      },
      "mensajesHoy": {
        "valor": 45,
        "tendencia": "+8%"
      }
    },
    "estadoConexion": {
      "estado": "Conectado",
      "tieneConexion": true
    },
    "actividadReciente": [
      {
        "conexion": "Dispositivo Principal",
        "fecha": "2025-12-03T20:31:39.000Z",
        "mensajes": 25,
        "estado": "active"
      }
    ],
    "contactosPendientes": 150,
    "estadisticasPorDia": [
      {
        "fecha": "2025-12-03",
        "cantidad": 45
      }
    ],
    "estadisticasPorFase": [
      {
        "fase_actual": 1,
        "cantidad": 1,
        "mensajes_hoy": 10,
        "mensajes_total": 150
      }
    ]
  }
}
```

**Ejemplo:**
```bash
curl http://localhost:3000/api/dashboard
```

---

### 2. Cola de Conexiones

Gestiona las conexiones de WhatsApp por orden de prioridad.

#### 2.1. Obtener Cola de Conexiones

**Endpoint:** `GET /api/queue`

**Respuesta:**
```json
{
  "success": true,
  "data": {
    "conexiones": [
      {
        "id": 1,
        "whatsappId": "dispositivo-principal",
        "nombre": "Dispositivo Principal",
        "fase": 3,
        "faseConfig": {
          "mensajesPorDia": 30,
          "duracionDias": 7,
          "descripcion": "Fase avanzada: 30 mensajes por día durante 7 días"
        },
        "estado": "active",
        "estadoDisplay": "ACTIVO",
        "mensajesEnviados": 250,
        "mensajesHoy": 15,
        "fechaUltimaActividad": "2025-12-03T20:31:39.000Z",
        "fechaRegistro": "2025-12-01T10:00:00.000Z",
        "hasSocket": true,
        "contactosPendientes": 50,
        "puedeEnviar": true
      }
    ],
    "total": 3,
    "activas": 2,
    "disponibles": 1,
    "maxConexiones": 3
  }
}
```

**Ejemplo:**
```bash
curl http://localhost:3000/api/queue
```

#### 2.2. Inicializar Conexión desde la Cola

**Endpoint:** `POST /api/queue/initialize`

**Body:**
```json
{
  "whatsappId": "dispositivo-principal",
  "nombreUsuario": "Dispositivo Principal"
}
```

**Respuesta:**
```json
{
  "success": true,
  "message": "Conexión inicializada. Usa GET /api/whatsapp/qr?whatsappId=xxx para obtener el QR code.",
  "data": {
    "whatsappId": "dispositivo-principal",
    "initialized": true
  }
}
```

**Ejemplo:**
```bash
curl -X POST http://localhost:3000/api/queue/initialize \
  -H "Content-Type: application/json" \
  -d '{
    "whatsappId": "dispositivo-principal",
    "nombreUsuario": "Dispositivo Principal"
  }'
```

#### 2.3. Actualizar Prioridad

**Endpoint:** `POST /api/queue/priority`

**Body:**
```json
{
  "whatsappId": "dispositivo-principal",
  "nuevaPrioridad": 1
}
```

**Nota:** La prioridad se determina automáticamente por fase y estado. Este endpoint está disponible para futuras implementaciones.

---

### 3. Información del Dispositivo

Obtiene detalles completos de una conexión específica.

#### 3.1. Obtener Información del Dispositivo

**Endpoint:** `GET /api/device/info?whatsappId=xxx`

**Parámetros:**
- `whatsappId` (requerido): ID de la conexión de WhatsApp

**Respuesta:**
```json
{
  "success": true,
  "data": {
    "conexion": {
      "id": 1,
      "whatsappId": "dispositivo-principal",
      "nombre": "Dispositivo Principal",
      "estado": "active",
      "estadoDisplay": "Conectado",
      "fase": 3,
      "faseConfig": {
        "mensajesPorDia": 30,
        "duracionDias": 7,
        "lapsoDistribucion": 8,
        "descripcion": "Fase avanzada: 30 mensajes por día durante 7 días"
      },
      "fechaRegistro": "2025-12-01T10:00:00.000Z",
      "fechaUltimaActividad": "2025-12-03T20:31:39.000Z",
      "fechaInicioFase": "2025-12-01"
    },
    "dispositivo": {
      "numeroTelefono": "521234567890",
      "ultimaConexion": "2025-12-03T20:31:39.000Z",
      "mensajesEnviados": 250,
      "mensajesRecibidos": 0,
      "mensajesHoy": 15,
      "limiteDiario": 30,
      "mensajesRestantes": 15
    },
    "qrCode": null,
    "sistema": {
      "conexion": "Activa",
      "estado": "Conectado",
      "tiempoActivo": "2h 15m",
      "hasSocket": true
    },
    "estadisticas": {
      "contactosTotal": 500,
      "contactosPendientes": 50,
      "contactosEnviados": 400,
      "contactosError": 50,
      "tasaExito": "80.00%"
    }
  }
}
```

**Ejemplo:**
```bash
curl "http://localhost:3000/api/device/info?whatsappId=dispositivo-principal"
```

#### 3.2. Inicializar Dispositivo

**Endpoint:** `POST /api/device/initialize`

**Body:**
```json
{
  "whatsappId": "dispositivo-principal",
  "nombreUsuario": "Dispositivo Principal"
}
```

**Respuesta:**
```json
{
  "success": true,
  "message": "Dispositivo inicializado. Usa GET /api/device/info?whatsappId=xxx para obtener el QR code.",
  "data": {
    "whatsappId": "dispositivo-principal",
    "initialized": true
  }
}
```

**Ejemplo:**
```bash
curl -X POST http://localhost:3000/api/device/initialize \
  -H "Content-Type: application/json" \
  -d '{
    "whatsappId": "dispositivo-principal",
    "nombreUsuario": "Dispositivo Principal"
  }'
```

---

## 🤖 Sistema de Envío Automático

El sistema incluye un servicio de envío automático que:

- **Se ejecuta cada 5 minutos** procesando contactos pendientes
- **Distribuye mensajes** entre todas las conexiones disponibles
- **Respeta los límites de fase** de cada conexión
- **Distribuye mensajes en el tiempo** según el `lapso_distribucion_horas` configurado
- **Prioriza conexiones** con mayor fase y más capacidad disponible

### Características:

1. **Distribución Inteligente**: Selecciona la mejor conexión disponible basándose en:
   - Fase actual (mayor fase = mayor prioridad)
   - Mensajes restantes del día
   - Estado de conexión (debe estar activa y con socket)

2. **Distribución Temporal**: Los mensajes se distribuyen aleatoriamente dentro del lapso configurado (por defecto 8 horas) con una variación de ±25%

3. **Manejo de Errores**: Si un mensaje falla, se marca como error y se continúa con el siguiente

4. **Límites Diarios**: Cada conexión respeta su límite diario según su fase actual

### Objetivo: 1000 mensajes al día

Para alcanzar ~1000 mensajes al día, el sistema:
- Utiliza múltiples conexiones (configurado con `MAX_CONEXIONES`)
- Distribuye la carga entre todas las conexiones disponibles
- Respeta los límites de cada fase
- Envía mensajes a lo largo del día (no todos a la vez)

**Ejemplo de distribución:**
- 10 conexiones en fase 4 (50 mensajes/día cada una) = 500 mensajes/día
- 20 conexiones en fase 3 (30 mensajes/día cada una) = 600 mensajes/día
- **Total: 1100 mensajes/día** (más que suficiente para el objetivo)

---

## 📚 Más Información

- Ver [README.md](./README.md) para documentación completa
- Ver [INICIO_RAPIDO.md](./INICIO_RAPIDO.md) para guía rápida
