# Verificación de Números de WhatsApp

Este sistema incluye verificación automática de números de WhatsApp antes de agregarlos a la base de datos. La verificación se realiza usando **whatsapp-web.js** (la librería que ya estás usando), sin enviar mensajes ni exponer el número.

## 🎯 ¿Por qué verificar números?

- **Evita baneos**: No intenta enviar mensajes a números que no existen en WhatsApp
- **Mejora la calidad**: Solo guarda contactos con números válidos
- **Ahorra recursos**: No procesa números inválidos en el sistema de envío
- **Sin costo**: Usa tu conexión existente de WhatsApp

## ⚙️ Cómo Funciona

La verificación usa métodos nativos de `whatsapp-web.js` que **NO envían mensajes**, solo consultan si el número existe:

- `isRegisteredUser(chatId)`: Verifica si un número está registrado
- `getNumberId(chatId)`: Obtiene el ID del número (retorna null si no existe)
- `getContactById(chatId)`: Obtiene información del contacto

**Importante**: Estos métodos solo consultan información, no envían mensajes ni exponen el número al destinatario.

## 📋 Proceso de Verificación

1. **Al subir un CSV**, el sistema:
   - Extrae todos los números únicos del archivo
   - Usa una de tus conexiones activas de WhatsApp para verificar
   - Elimina números que no están registrados en WhatsApp
   - Solo guarda contactos que tienen al menos un número válido

2. **Si un contacto tiene múltiples números** (Mobile, Corporate, Other):
   - Verifica todos los números
   - Mantiene solo los que están registrados en WhatsApp
   - Si ningún número es válido, el contacto no se agrega

3. **Procesamiento en lote**:
   - Verifica números en lotes de 5 para no sobrecargar
   - Incluye delays automáticos entre verificaciones (500ms entre números, 1s entre lotes)
   - Maneja errores de forma segura

## 🔧 Requisitos

- **Conexión activa**: Necesitas tener al menos una conexión activa de WhatsApp
- **Sin configuración**: No requiere variables de entorno ni API keys
- **Automático**: Se ejecuta automáticamente al subir un CSV

## 📊 Respuesta de la API

Cuando subes un CSV, la respuesta incluye información sobre la verificación:

```json
{
  "success": true,
  "message": "CSV procesado exitosamente con verificación de WhatsApp",
  "data": {
    "total": 100,
    "verificados": 85,
    "rechazados": 15,
    "guardados": 85,
    "errores": 15,
    "contactos": [...],
    "contactos_rechazados": [...]
  }
}
```

## ⚠️ Notas Importantes

1. **Conexión activa requerida**: Si no hay conexiones activas, el sistema mostrará una advertencia pero permitirá guardar los contactos sin verificar.

2. **Velocidad**: La verificación puede ser más lenta que APIs especializadas, especialmente con muchos números. Esto es normal y ayuda a evitar rate limiting.

3. **Errores**: Si hay un error al verificar un número, el sistema lo aceptará por defecto para no bloquear el proceso.

4. **Seguridad**: La verificación es segura porque solo consulta información, no envía mensajes ni expone el número al destinatario.

## 🐛 Solución de Problemas

### No hay conexión activa disponible
- Asegúrate de tener al menos una conexión de WhatsApp activa
- Verifica que la conexión esté lista (status: ready)
- El sistema mostrará una advertencia pero permitirá guardar los contactos

### La verificación es muy lenta
- Esto es normal, especialmente con muchos números
- El sistema incluye delays para evitar rate limiting
- Los delays son: 500ms entre números, 1 segundo entre lotes

### Todos los números se rechazan
- Verifica que tu conexión de WhatsApp esté funcionando correctamente
- Revisa el formato de los números (deben incluir código de país, ej: 521234567890)
- Revisa los logs del servidor para ver errores específicos
