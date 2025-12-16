# Errores Comunes de WhatsApp Web

## Error: "No LID for user"

### ¿Qué significa?

El error **"No LID for user"** (LID = Local ID / LinkedIn ID) indica que WhatsApp Web no puede encontrar el identificador interno del usuario en su base de datos. Esto ocurre cuando intentas enviar un mensaje a un número que:

1. **No está registrado en WhatsApp** - El número de teléfono no tiene una cuenta de WhatsApp activa
2. **No existe o es inválido** - El número no es un número de teléfono válido
3. **Está bloqueado o no es accesible** - El número puede estar bloqueado o no disponible temporalmente
4. **Formato incorrecto** - Aunque menos común, puede ser un problema de formato del número

### Ejemplo del error:

```
❌ Error enviando mensaje a 528181721828: Evaluation failed: Error: No LID for user
```

En este caso, el número `528181721828` (México) no está registrado en WhatsApp o no existe.

### Soluciones

#### 1. Verificar el número
- Confirma que el número existe y está correctamente formateado
- Verifica que el número tenga cuenta de WhatsApp activa
- Asegúrate de incluir el código de país (ej: 52 para México)

#### 2. Validar antes de enviar
El sistema ya valida el formato del número, pero no puede verificar si está registrado en WhatsApp hasta intentar enviar el mensaje.

#### 3. Manejo automático
El sistema automáticamente:
- Marca el contacto con estado `error`
- Guarda el mensaje de error
- Continúa con el siguiente contacto
- No bloquea el proceso de envío

### Números que comúnmente causan este error

- Números de teléfono fijo (no móviles)
- Números que nunca se han registrado en WhatsApp
- Números desactivados o eliminados
- Números con formato incorrecto
- Números de prueba o ficticios

### Recomendaciones

1. **Validar números antes de importar**: Si es posible, verifica que los números sean móviles y estén activos
2. **Limpiar base de datos**: Revisa periódicamente los contactos con estado `error` y elimina los números inválidos
3. **Reintentar manualmente**: Algunos números pueden estar temporalmente inaccesibles, puedes intentar reenviar más tarde

### Código de manejo

El error se captura en `services/mensajeriaService.js` línea 210-220:

```javascript
catch (error) {
  console.error(`❌ Error enviando mensaje a ${contacto.telefono}:`, error.message);
  await updateContactoEstado(contacto.id, 'error', error.message, conexion.id);
  contactosError++;
  // El contacto se remueve de la lista de pendientes
}
```

El contacto queda marcado como `error` en la base de datos y no se reintentará automáticamente.



