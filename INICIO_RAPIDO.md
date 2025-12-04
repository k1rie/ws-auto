# ⚡ Inicio Rápido - 5 Minutos

## Paso 1: Instalar Dependencias

```bash
npm install
```

## Paso 2: Iniciar el Servidor

```bash
npm run dev
```

Deberías ver:
```
🚀 Servidor API corriendo en puerto 3000
📚 Endpoints disponibles:
   GET  http://localhost:3000/health
   GET  http://localhost:3000/api/whatsapp/status
   ...
```

## Paso 3: Verificar que Funciona

Abre en tu navegador o usa curl:
```bash
curl http://localhost:3000/health
```

## Paso 4: Inicializar WhatsApp

```bash
curl -X POST http://localhost:3000/api/whatsapp/initialize
```

## Paso 5: Obtener QR Code

```bash
curl http://localhost:3000/api/whatsapp/qr
```

Escanea el QR con WhatsApp (Menú → Dispositivos vinculados → Vincular un dispositivo)

## Paso 6: Verificar Estado

```bash
curl http://localhost:3000/api/whatsapp/status
```

Espera hasta que `ready` sea `true`

## Paso 7: Enviar Mensaje

```bash
curl -X POST http://localhost:3000/api/whatsapp/send \
  -H "Content-Type: application/json" \
  -d '{
    "number": "521234567890",
    "message": "Hola desde la API!"
  }'
```

---

## 📝 Formato del Número

El número debe incluir el código de país **sin el signo +**:

- ✅ Correcto: `521234567890` (México)
- ✅ Correcto: `11234567890` (Estados Unidos)
- ❌ Incorrecto: `+521234567890`
- ❌ Incorrecto: `1234567890` (falta código de país)

## 📚 Más Información

- Ver [GUIA_USO.md](./GUIA_USO.md) para documentación completa de todos los endpoints
- Ver [README.md](./README.md) para información general
