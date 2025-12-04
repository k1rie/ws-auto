# 🚀 Guía de Despliegue en Koyeb

## Requisitos Previos

1. Cuenta en [Koyeb](https://www.koyeb.com)
2. Código del proyecto en un repositorio Git (GitHub, GitLab, Bitbucket)

## Pasos para Desplegar

### Paso 1: Subir Código a GitHub

1. **Inicializar repositorio Git** (si no lo has hecho):
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   ```

2. **Crear repositorio en GitHub**:
   - Ve a [GitHub](https://github.com) y crea un nuevo repositorio
   - No inicialices con README, .gitignore o licencia

3. **Conectar y subir código**:
   ```bash
   git remote add origin https://github.com/TU_USUARIO/TU_REPOSITORIO.git
   git branch -M main
   git push -u origin main
   ```

### Paso 2: Desplegar en Koyeb

1. **Iniciar sesión en Koyeb**:
   - Ve a [koyeb.com](https://www.koyeb.com)
   - Inicia sesión o crea una cuenta

2. **Crear nuevo servicio**:
   - Click en **"Create App"** o **"Create Service"**
   - Selecciona **"GitHub"** como fuente

3. **Conectar repositorio**:
   - Autoriza Koyeb para acceder a tu GitHub (si es la primera vez)
   - Selecciona tu repositorio
   - Selecciona la rama (generalmente `main` o `master`)

4. **Configurar el servicio**:
   - **Build**: Koyeb detectará automáticamente el Dockerfile
   - **Port**: Configura el puerto `3000` (o el que uses)
   - **Environment Variables** (opcional):
     - `PORT=3000` (si quieres cambiarlo)
     - `NODE_ENV=production`

5. **Desplegar**:
   - Click en **"Deploy"**
   - Espera a que se complete el build y despliegue

### Paso 3: Verificar Despliegue

Una vez desplegado, Koyeb te dará una URL como:
```
https://tu-app-12345.koyeb.app
```

Verifica que funciona:
```bash
curl https://tu-app-12345.koyeb.app/health
```

## ⚙️ Configuración Adicional

### Variables de Entorno en Koyeb

En la configuración del servicio, puedes agregar variables de entorno:

- `PORT`: Puerto del servidor (default: 3000)
- `NODE_ENV`: `production`

### Persistencia de Sesión

**Importante**: Por defecto, la sesión de WhatsApp se perderá al reiniciar el contenedor.

Para mantener la sesión:

1. En Koyeb, ve a la configuración del servicio
2. Busca la sección **"Volumes"** o **"Persistent Storage"**
3. Agrega un volumen:
   - **Path**: `/app/.wwebjs_auth`
   - **Size**: 1GB (suficiente)

Esto mantendrá la autenticación de WhatsApp entre reinicios.

### Recursos Recomendados

- **RAM**: Mínimo 512MB, recomendado 1GB
- **CPU**: 0.5 vCPU mínimo

## 🔄 Actualizar el Despliegue

Cada vez que hagas `git push` a tu repositorio, Koyeb detectará los cambios y desplegará automáticamente una nueva versión.

## 📝 Notas Importantes

1. **Primera vez**: Necesitarás escanear el QR code después del primer despliegue
2. **Reinicios**: Si no usas volúmenes persistentes, necesitarás escanear el QR nuevamente
3. **Logs**: Puedes ver los logs en tiempo real desde el dashboard de Koyeb
4. **URL**: La URL de tu app será permanente mientras el servicio esté activo

## 🐛 Solución de Problemas

### El build falla
- Verifica que el Dockerfile esté en la raíz del proyecto
- Revisa los logs de build en Koyeb

### La app no inicia
- Verifica que el puerto esté configurado correctamente
- Revisa los logs del contenedor

### WhatsApp no se conecta
- Verifica que hayas escaneado el QR
- Revisa los logs para ver errores de conexión
- Asegúrate de tener suficiente RAM asignada

## 📚 Recursos

- [Documentación de Koyeb](https://www.koyeb.com/docs)
- [Guía de Dockerfile](https://www.koyeb.com/docs/deploy/dockerfile)

