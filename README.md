# Panama Viajero API

API independiente para conectar el panel administrativo y la pagina publica de Panama Viajero.

## Tecnologias

- Cloudflare Workers
- TypeScript
- Hono
- Cloudflare D1
- Cloudflare R2
- Wrangler
- Yarn Classic

## Instalacion

```bash
yarn
```

## Base de datos local

```bash
yarn db:migrate:local
yarn db:seed:local
```

El usuario `Administrador` queda pendiente de configuracion hasta ejecutar el bootstrap seguro.

## Configuracion local

Duplica el archivo de ejemplo:

```powershell
Copy-Item .dev.vars.example .dev.vars
```

Reemplaza el valor de `BOOTSTRAP_SECRET` por una cadena larga y aleatoria. Este archivo esta ignorado por Git.

## Desarrollo

```bash
yarn dev
```

## Configurar Administrador

Con la API en ejecucion, realiza una sola peticion:

```powershell
$headers = @{
  "X-Bootstrap-Secret" = "TU_SECRETO_LOCAL"
}

$body = @{
  password = "UNA_CONTRASENA_TEMPORAL_SEGURA"
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:8787/api/v1/auth/bootstrap" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body $body
```

La contrasena debe tener entre 12 y 128 caracteres. El bootstrap solo funciona una vez.

## Endpoints actuales

```text
GET /
GET /api/v1/health

POST /api/v1/auth/bootstrap
POST /api/v1/auth/login
GET  /api/v1/auth/me
POST /api/v1/auth/change-password
POST /api/v1/auth/logout

GET  /api/v1/admin/users
POST /api/v1/admin/users
PATCH /api/v1/admin/users/:userId/permissions
DELETE /api/v1/admin/users/:userId

GET    /api/v1/admin/catalog/provinces
GET    /api/v1/admin/catalog/activities
POST   /api/v1/admin/catalog/activities

GET    /api/v1/admin/sites?status=draft
GET    /api/v1/admin/sites?status=published
GET    /api/v1/admin/sites/:siteId
POST   /api/v1/admin/sites
PATCH  /api/v1/admin/sites/:siteId
POST   /api/v1/admin/sites/:siteId/publish
DELETE /api/v1/admin/sites/:siteId

POST   /api/v1/admin/sites/:siteId/images
DELETE /api/v1/admin/sites/:siteId/images/:imageId

GET    /api/v1/admin/media/:imageId
GET    /api/v1/media/:imageId

GET    /api/v1/public/sites
GET    /api/v1/public/sites/:slug

GET    /api/v1/admin/sites/trash/items
POST   /api/v1/admin/sites/trash/:siteId/restore
DELETE /api/v1/admin/sites/trash/:siteId
```

El listado de usuarios requiere `manage_users` o `manage_permissions`. Crear y
eliminar usuarios requiere `manage_users`, mientras que modificar permisos
requiere `manage_permissions`.

## Seguridad implementada

- PBKDF2-HMAC-SHA256 con sal unica y 100,000 iteraciones.
- Tokens de sesion aleatorios y solo su hash se almacena en D1.
- Cookie `HttpOnly`.
- Renovacion de sesion por actividad.
- Expiracion predeterminada de 8 horas.
- Validacion de origen y CORS con credenciales.
- Cambio obligatorio de contrasena.
- Cinco intentos fallidos producen un bloqueo temporal de 15 minutos.
- Permisos verificados dentro del Worker.
- El administrador principal no puede eliminarse ni perder permisos.
- Eliminar un usuario invalida inmediatamente todas sus sesiones.

## Verificacion

```bash
yarn lint
yarn typecheck
yarn build
```

## Produccion

Antes de desplegar:

```bash
yarn wrangler secret put BOOTSTRAP_SECRET
```

Configura `ENVIRONMENT=production`, los origenes reales y la base D1 remota. No ejecutes la migracion remota hasta comprobar que estas usando la cuenta correcta de Cloudflare.

La API requiere un bucket R2 llamado `panama-viajero-images`, conectado al
Worker mediante el binding `IMAGES`. Solo acepta archivos WebP validos de hasta
10 MB y permite un maximo de 30 imagenes de galeria por sitio. Reemplazar el
banner o eliminar definitivamente un sitio tambien elimina los objetos
anteriores de R2.

El panel administrativo consume esta API mediante una Pages Function y un
Service Binding llamado `API_SERVICE`. Las cookies se entregan desde el dominio
del panel y usan `SameSite=Lax`.

Los sitios eliminados conservan su estado original durante 50 dias. Un trigger
programado se ejecuta todos los dias a las 08:15 UTC para eliminar de D1 los
registros cuyo `purge_at` haya vencido.
