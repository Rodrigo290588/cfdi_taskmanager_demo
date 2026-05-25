# API Externa de Alta de Usuarios

## Objetivo

Este documento describe la integracion de alta externa de usuarios para ERPs, PACs u otros sistemas cliente usando OAuth 2.0 Client Credentials y un endpoint protegido por JWT con scope `users:create`.

## Entregables tecnicos

1. Middleware de autenticacion y validacion de scope:
   - `src/lib/m2m-route.ts`
   - `src/lib/m2m-oauth.ts`
2. Schema de validacion con reglas condicionales:
   - `src/lib/external-user-provisioning.ts`
3. Handler del endpoint de alta:
   - `src/app/api/external/users/route.ts`
4. Coleccion Postman:
   - `postman/cfdi-external-users.postman_collection.json`

## Endpoints

### 1. Obtener token M2M

- Metodo: `POST`
- URL: `/api/oauth/token`
- Content-Type: `application/x-www-form-urlencoded`
- Auth: `Basic Auth`

#### Parametros form-data

- `grant_type=client_credentials`
- `scope=users:create`

#### Respuesta exitosa

```json
{
  "access_token": "<JWT>",
  "token_type": "Bearer",
  "expires_in": 300,
  "scope": "users:create"
}
```

#### Errores esperados

- `400 unsupported_grant_type`
- `401 invalid_client`
- `403 invalid_scope`
- `429 rate_limited`

### 2. Alta externa de usuarios

- Metodo: `POST`
- URL: `/api/external/users`
- Content-Type: `application/json`
- Header: `Authorization: Bearer <TOKEN>`
- Scope requerido: `users:create`

#### Payload individual

```json
{
  "user": {
    "correo": "proveedor.demo@cliente.com",
    "nombre_usuario": "Proveedor Demo",
    "rol_empresa": "proveedor",
    "empresas": ["AAA010101AAA"],
    "rfc_proveedor": "XAXX010101000",
    "nombre_proveedor": "Proveedor Demo SA de CV",
    "externalId": "ERP-USER-001"
  }
}
```

#### Payload masivo

```json
{
  "users": [
    {
      "correo": "auditor.demo@cliente.com",
      "nombre_usuario": "Auditor Demo",
      "rol_empresa": "auditor",
      "empresas": ["AAA010101AAA"],
      "externalId": "ERP-USER-002"
    },
    {
      "correo": "visualizador.demo@cliente.com",
      "nombre_usuario": "Visualizador Demo",
      "rol_empresa": "visualizador",
      "empresas": ["AAA010101AAA", "BBB010101BBB"],
      "externalId": "ERP-USER-003"
    }
  ]
}
```

#### Respuesta exitosa

- HTTP `201 Created`

```json
{
  "success": true,
  "organizationId": "org_123",
  "sourceClientId": "demo-client",
  "results": [
    {
      "email": "proveedor.demo@cliente.com",
      "status": "created",
      "message": "Usuario invitado exitosamente",
      "externalId": "ERP-USER-001"
    }
  ],
  "summary": {
    "total": 1,
    "created": 1,
    "rejected": 0
  }
}
```

#### Errores esperados

- `400 Datos invalidos`
- `401 Token invalido o expirado`
- `403 El token no contiene el scope requerido`
- `429 Demasiadas peticiones para este cliente`
- `500 Error interno del servidor`

## Reglas de validacion del payload

El schema se construye dinamicamente con Zod para permitir roles base y roles personalizados existentes en la organizacion.

### Campos obligatorios para todos

- `correo`: email valido
- `nombre_usuario`: alfanumerico con separadores permitidos
- `rol_empresa`: debe existir en la organizacion
- `empresas`: arreglo de RFCs mexicanos validos

### Regla condicional para proveedor

Si `rol_empresa` es exactamente `proveedor`, entonces:

- `rfc_proveedor` es obligatorio
- `nombre_proveedor` es obligatorio

Si `rol_empresa` es distinto de `proveedor`, entonces:

- `rfc_proveedor` no esta permitido
- `nombre_proveedor` no esta permitido

### RFC validado

Se usa una expresion regular estricta para RFC mexicano de persona fisica y moral:

```ts
/^([A-ZÑ&]{3,4})\d{6}([A-Z0-9]{3})$/i
```

## Middleware de autenticacion y scopes

El middleware:

- Lee `Authorization: Bearer <TOKEN>`
- Verifica firma, issuer y audience del JWT
- Valida que `token_use` sea `m2m`
- Valida que el scope incluya `users:create`
- Devuelve `401` o `403` segun corresponda

## Comportamiento del proxy

Las rutas M2M:

- `/api/oauth/token`
- `/api/external/users`

quedan fuera de la proteccion por sesion web del `proxy` global para permitir consumo por sistemas externos. La seguridad de estas rutas recae en OAuth 2.0 Client Credentials, validacion de JWT, scopes, rate limiting y auditoria.

## Provisionamiento de clientes M2M

Los clientes OAuth M2M ahora se resguardan prioritariamente en base de datos en la tabla `machine_clients`.

Controles aplicados:

- `clientSecret` almacenado como hash `bcrypt`
- secreto en claro mostrado solo una vez al crear la organizacion
- cliente ligado a una sola organizacion
- soporte para `isActive`, `expiresAt` y `allowedIps`
- actualizacion de `lastUsedAt` y `lastUsedIp`

Compatibilidad:

- si una organizacion aun no tiene cliente M2M en BD, el sistema puede usar temporalmente el fallback legado `M2M_OAUTH_CLIENTS_JSON`

## Importante sobre credenciales y contrasenas

Por requerimiento de seguridad del proyecto, este endpoint **no recibe ni hashea contrasenas**. La API externa delega la creacion de credenciales al flujo interno de invitaciones del sistema.

Eso significa que:

- El endpoint crea la invitacion y el registro pendiente
- El usuario final completa su alta desde el enlace seguro de invitacion
- La contrasena se define en el flujo interno de onboarding
- Los logs de auditoria no almacenan contrasenas ni tokens en claro

## Auditoria y datos sensibles

Cada alta registra auditoria con:

- cliente M2M que ejecuto la accion
- IP de origen
- user-agent
- timestamp de base de datos
- payload sanitizado

Campos sensibles como `password`, `token`, `authorization`, `client_secret`, `access_token`, `refresh_token` e `invitationTokenHash` se ofuscan antes de persistirse en auditoria.

## Rate limiting

La API aplica una estructura de rate limiting por `clientId`:

- maximo `10` peticiones por segundo en `/api/external/users`
- respuesta `429` con headers `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining` y `X-RateLimit-Reset`
- autenticacion M2M limitada por cliente en `/api/oauth/token`
- contadores centralizados en Redis mediante `REDIS_URL`

## Variables de entorno requeridas

```env
M2M_JWT_SECRET=colocar_un_secreto_largo_y_seguro
M2M_JWT_ISSUER=cfdi-platform
M2M_JWT_AUDIENCE=cfdi-external-users
M2M_JWT_EXPIRES_IN=5m
REDIS_URL=redis://localhost:6379
```

Variable opcional solo para compatibilidad con clientes legacy:

```env
M2M_OAUTH_CLIENTS_JSON=[{"clientId":"demo-client","clientSecret":"demo-secret","organizationId":"ORG_ID","scopes":["users:create"]}]
```

## Flujo recomendado para el cliente

1. Crear organizacion y resguardar el `clientId` y `clientSecret` mostrados una sola vez
2. Solicitar token en `/api/oauth/token`
3. Guardar `access_token`
4. Consumir `/api/external/users` con Bearer token
5. Revisar `results` y `summary`
6. Si hay `429`, reintentar con backoff respetando `Retry-After`

## Uso en Postman

1. Importar `postman/cfdi-external-users.postman_collection.json`
2. Ajustar `baseUrl`, `clientId` y `clientSecret`
3. Ejecutar `1. OAuth Token`
4. Ejecutar `2. Alta Individual` o `3. Alta Masiva`
