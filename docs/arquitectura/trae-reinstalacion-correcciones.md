# Correcciones Base Para Reinstalacion De Trae

Este documento sirve como guia para una nueva instalacion de Trae o para una nueva sesion del agente en este proyecto. Su objetivo es evitar volver a diagnosticar problemas ya resueltos y pedirle al agente que replique exactamente las correcciones tecnicas necesarias.

## Objetivo

Al iniciar una nueva sesion de Trae en este proyecto, pedir que:

1. Verifique y mantenga las dependencias corregidas
2. Reinstale dependencias de forma segura si hace falta
3. Regenere Prisma Client
4. Mantenga la correccion de Puppeteer para Windows
5. Mantenga la correccion de Recharts con `react-is`
6. Confirme que `npm audit` quede en `0 vulnerabilities`

## Prompt Recomendado Para Trae

Copia y pega este bloque en una nueva sesion de Trae:

```md
Revisa este proyecto y aplica las correcciones base ya validadas anteriormente. Necesito que confirmes y, si hace falta, vuelvas a aplicar lo siguiente:

1. Dependencias esperadas en package.json:
- next-auth: ^5.0.0-beta.31
- @auth/prisma-adapter: ^2.11.2
- nodemailer: ^9.0.3
- prisma: 6.19.3
- @prisma/client: 6.19.3
- puppeteer-core: ^24.40.0
- react-is: ^19.2.7

2. Configuracion esperada:
- existe .npmrc con legacy-peer-deps=true
- package.json tiene override postcss = 8.5.19

3. Correccion esperada en src/lib/cfdi-pdf.ts:
- usa puppeteer-core en lugar de puppeteer
- detecta Chrome o Edge instalados localmente
- soporta PUPPETEER_EXECUTABLE_PATH
- lanza error claro si no encuentra navegador

4. Acciones a ejecutar:
- revisar package.json, .npmrc y src/lib/cfdi-pdf.ts
- ejecutar npm install
- ejecutar npx prisma generate
- verificar que npm audit reporte 0 vulnerabilities
- verificar que recharts no falle por falta de react-is

5. Si detectas diferencias, corrigelas sin revertir otros cambios del usuario.

Entrégame al final:
- archivos modificados
- comandos ejecutados
- estado final de npm audit
- cualquier riesgo pendiente
```

## Estado Tecnico Esperado

Estas son las condiciones que deben quedar al final:

### package.json

- `next-auth`: `^5.0.0-beta.31`
- `@auth/prisma-adapter`: `^2.11.2`
- `nodemailer`: `^9.0.3`
- `prisma`: `6.19.3`
- `@prisma/client`: `6.19.3`
- `puppeteer-core`: `^24.40.0`
- `react-is`: `^19.2.7`
- `overrides.postcss`: `8.5.19`

### .npmrc

Debe existir este archivo en la raiz del proyecto:

```ini
legacy-peer-deps=true
```

### src/lib/cfdi-pdf.ts

Debe cumplir con estas reglas:

- importar `puppeteer-core`
- no depender de descarga automatica de Chromium durante `npm install`
- buscar navegador en rutas comunes de Windows, macOS y Linux
- aceptar `PUPPETEER_EXECUTABLE_PATH`
- lanzar un error entendible si no encuentra navegador

## Comandos De Verificacion

Estos son los comandos base que Trae puede usar para validar el entorno:

```bash
npm install
npx prisma generate
npm audit
npm ls react-is recharts
npm ls prisma @prisma/client
```

## Problemas Ya Resueltos

### 1. Conflicto entre next-auth y nodemailer

- `next-auth` beta tenia conflicto de peer con `nodemailer`
- se resolvio manteniendo `legacy-peer-deps=true`
- se actualizo `nodemailer` a `9.0.3` para eliminar vulnerabilidades

### 2. Error de Puppeteer durante npm install

- `puppeteer` intentaba descargar Chromium y fallaba en Windows
- se reemplazo por `puppeteer-core`
- el runtime ahora usa Chrome o Edge instalados localmente

### 3. Vulnerabilidades de npm audit

- se corrigieron actualizando `nodemailer`
- se forzo `postcss` a `8.5.19`
- el estado esperado final es `0 vulnerabilities`

### 4. Error de Prisma Client sin generar

- el error fue: `@prisma/client did not initialize yet`
- se resolvio con:

```bash
npx prisma generate
```

- adicionalmente se alinearon versiones:
  - `prisma = 6.19.3`
  - `@prisma/client = 6.19.3`

### 5. Error de Recharts por falta de react-is

- el error fue: `Module not found: Can't resolve 'react-is'`
- se resolvio agregando `react-is` como dependencia directa

## Nota Operativa

Si Trae reinstala dependencias y luego aparece un error de Prisma, pedirle que vuelva a ejecutar:

```bash
npx prisma generate
```

Si el servidor de desarrollo sigue mostrando errores viejos despues de corregir dependencias, reiniciar `npm run dev`.

## Resultado Esperado

Al terminar, el proyecto debe:

- instalar dependencias sin fallar
- generar PDFs usando navegador local
- cargar Recharts sin error de `react-is`
- inicializar Prisma Client correctamente
- reportar `0 vulnerabilities` en `npm audit`
