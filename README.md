# Panama Viajero API

API independiente para conectar el panel administrativo y la pagina publica de Panama Viajero.

## Tecnologias

- Cloudflare Workers
- TypeScript
- Hono
- Cloudflare D1
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
```

`GET /api/v1/admin/users` requiere autenticacion, cambio de contrasena completado y el permiso `manage_users`.

## Seguridad implementada

- PBKDF2-HMAC-SHA256 con sal unica y 600,000 iteraciones.
- Tokens de sesion aleatorios y solo su hash se almacena en D1.
- Cookie `HttpOnly`.
- Renovacion de sesion por actividad.
- Expiracion predeterminada de 8 horas.
- Validacion de origen y CORS con credenciales.
- Cambio obligatorio de contrasena.
- Cinco intentos fallidos producen un bloqueo temporal de 15 minutos.
- Permisos verificados dentro del Worker.

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

El panel administrativo consume esta API mediante una Pages Function y un
Service Binding llamado `API_SERVICE`. Las cookies se entregan desde el dominio
del panel y usan `SameSite=Lax`.
