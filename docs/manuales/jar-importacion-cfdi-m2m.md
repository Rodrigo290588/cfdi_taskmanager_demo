# Manual de Uso del JAR de Importacion CFDI M2M

## Objetivo

Este manual describe como ejecutar el cliente Java de importacion CFDI M2M para enviar XML individuales o directorios completos hacia la plataforma.

El `jar` obtiene el token OAuth automaticamente, arma el payload requerido por la API y envia los lotes al endpoint externo de importacion.

## Artefactos disponibles

Ubicacion de compilacion:

- `java-client/target/cfdi-ingest-1.0-SNAPSHOT.jar`
- `java-client/target/cfdi-ingest-1.0-SNAPSHOT-shaded.jar`

Ambos artefactos son ejecutables. Para distribucion al cliente se recomienda entregar el `jar` principal junto con este manual y sus credenciales M2M.

## Requisitos

### Runtime requerido

- Java `21`

### Requisitos de conectividad

- acceso HTTP/HTTPS a la aplicacion
- `clientId` y `clientSecret` vigentes
- scope autorizado: `cfdi.import`

## Funcionamiento general

El cliente Java realiza este flujo:

1. valida argumentos de linea de comandos
2. solicita token OAuth en `/api/oauth/token`
3. arma lotes con XML en Base64
4. envia esos lotes a `/api/external/cfdi-import`
5. muestra en consola el `importRunId` y el estatus inicial
6. en modo directorio, calcula cifras de control de importacion
7. en modo directorio, registra progreso en `progress.log`

## Sintaxis general

```bash
java -jar cfdi-ingest-1.0-SNAPSHOT.jar --client-id <id> --client-secret <secret> [opciones]
```

## Modos soportados

### 1. Archivo unico

Se utiliza cuando se quiere importar un solo XML.

```bash
java -jar cfdi-ingest-1.0-SNAPSHOT.jar \
  --client-id demo-client \
  --client-secret demo-secret \
  --file-path "C:\\CFDI\\factura.xml"
```

### 2. Directorio completo

Se utiliza cuando se quiere importar todos los XML contenidos en una carpeta.

```bash
java -jar cfdi-ingest-1.0-SNAPSHOT.jar \
  --client-id demo-client \
  --client-secret demo-secret \
  --dir "C:\\CFDI\\lote-julio"
```

En este modo el cliente calcula y envia automaticamente:

- `totalXmlFiles`: total de XML detectados en la carpeta
- `skippedByProgressFiles`: XML omitidos porque ya estaban en `progress.log`
- `newXmlFiles`: XML realmente nuevos a enviar

Estas cifras viajan al backend dentro del bloque `directoryControl`.

## Parametros soportados

### Credenciales y conexion

#### `--client-id`

- Obligatorio: si
- Descripcion: identificador del cliente M2M

#### `--client-secret`

- Obligatorio: si
- Descripcion: secreto del cliente M2M

#### `--base-url`

- Obligatorio: no
- Default: `http://localhost:3000`
- Descripcion: URL base de la aplicacion

Ejemplo:

```bash
--base-url "https://mi-servidor.empresa.com"
```

#### `--scope`

- Obligatorio: no
- Default: `cfdi.import`
- Descripcion: scope OAuth solicitado al emitir el token

## Parametros de entrada

#### `--file-path`

- Obligatorio: si, cuando se importa un archivo unico
- Descripcion: ruta absoluta o relativa del XML a importar

#### `--file-name`

- Obligatorio: no
- Descripcion: nombre logico a enviar al backend
- Uso: permite cambiar el nombre visible del archivo sin modificar el archivo local

#### `--dir`

- Obligatorio: si, cuando se importa una carpeta
- Default: `xml-data`
- Descripcion: directorio que contiene XML a importar

#### `--batch-id`

- Obligatorio: no
- Descripcion: identificador explicito del lote
- Recomendacion: enviarlo cuando el sistema cliente necesita trazabilidad exacta

#### `--batch-size`

- Obligatorio: no
- Default: `500`
- Rango valido: `1-500`
- Descripcion: tamaño de lote cuando se procesa un directorio

#### `--skip-progress`

- Obligatorio: no
- Descripcion: omite el uso del archivo `progress.log`
- Uso recomendado: pruebas controladas o reimportaciones intencionales
- Efecto en cifras: `skippedByProgressFiles` se vuelve `0`

#### `--help`

- Obligatorio: no
- Descripcion: muestra ayuda de uso

## Alias en español

El cliente acepta estos alias:

- `--ruta-archivo` -> `--file-path`
- `--nombre-archivo` -> `--file-name`
- `--directorio` -> `--dir`
- `--omitir-progreso` -> `--skip-progress`
- `--ayuda` -> `--help`

## Variables de entorno soportadas

Si no se pasan por linea de comandos, el cliente puede tomar estas credenciales desde el sistema operativo:

```env
CFDI_IMPORT_CLIENT_ID=demo-client
CFDI_IMPORT_CLIENT_SECRET=demo-secret
```

Ejemplo de uso:

```bash
set CFDI_IMPORT_CLIENT_ID=demo-client
set CFDI_IMPORT_CLIENT_SECRET=demo-secret
java -jar cfdi-ingest-1.0-SNAPSHOT.jar --dir "C:\\CFDI\\lote"
```

## Ejemplos de ejecucion

### Ejemplo 1. Importar un XML unico

```bash
java -jar cfdi-ingest-1.0-SNAPSHOT.jar ^
  --base-url "https://mi-servidor.empresa.com" ^
  --client-id demo-client ^
  --client-secret demo-secret ^
  --file-path "C:\\CFDI\\emitido-prueba.xml"
```

### Ejemplo 2. Importar un XML unico con nombre logico personalizado

```bash
java -jar cfdi-ingest-1.0-SNAPSHOT.jar ^
  --client-id demo-client ^
  --client-secret demo-secret ^
  --file-path "C:\\CFDI\\tmp\\archivo123.xml" ^
  --file-name "factura-cliente-123.xml"
```

### Ejemplo 3. Importar un directorio completo

```bash
java -jar cfdi-ingest-1.0-SNAPSHOT.jar ^
  --client-id demo-client ^
  --client-secret demo-secret ^
  --dir "C:\\CFDI\\lote-julio"
```

### Ejemplo 4. Importar directorio con `batch-size` especifico

```bash
java -jar cfdi-ingest-1.0-SNAPSHOT.jar ^
  --client-id demo-client ^
  --client-secret demo-secret ^
  --dir "C:\\CFDI\\lote-julio" ^
  --batch-size 200
```

### Ejemplo 5. Importar directorio omitiendo `progress.log`

```bash
java -jar cfdi-ingest-1.0-SNAPSHOT.jar ^
  --client-id demo-client ^
  --client-secret demo-secret ^
  --dir "C:\\CFDI\\lote-julio" ^
  --skip-progress
```

### Ejemplo 6. Uso con alias en español

```bash
java -jar cfdi-ingest-1.0-SNAPSHOT.jar ^
  --client-id demo-client ^
  --client-secret demo-secret ^
  --ruta-archivo "C:\\CFDI\\factura.xml" ^
  --nombre-archivo "factura-ajustada.xml"
```

## Ejemplo de salida en consola

### Archivo unico

```text
Iniciando cliente de ingesta CFDI M2M...
Base URL: https://mi-servidor.empresa.com
Endpoint importación: https://mi-servidor.empresa.com/api/external/cfdi-import
Scope solicitado: cfdi.import
Archivo enviado correctamente.
ImportRunId: 067a3177-9b37-4403-a5c7-69fb11182d49
Estatus inicial: QUEUED
```

### Directorio

```text
Iniciando cliente de ingesta CFDI M2M...
Directorio objetivo: C:\CFDI\lote-julio
Archivos previamente procesados: 1200
XML detectados en directorio: 3201
XML omitidos por progress.log: 1200
XML nuevos a enviar: 2001
Lote enviado: 500 archivo(s). HTTP 202
Total procesados: 1700 | ImportRunId: 067a3177-9b37-4403-a5c7-69fb11182d49
Ingesta completada en 46435ms
Total nuevos procesados: 2001
Errores de preparación/envío: 0
```

## Archivo de progreso

Cuando se procesa un directorio, el cliente usa el archivo:

- `java-client/target/progress.log`

### Funcion

- registrar archivos ya enviados
- evitar reenvios accidentales en ejecuciones posteriores
- permitir reanudar cargas largas
- sustentar el calculo de `skippedByProgressFiles`

### Cuando usar `--skip-progress`

Se recomienda usar `--skip-progress` solo cuando:

- se quiere reprocesar completamente un directorio
- se esta haciendo una prueba controlada
- el archivo `progress.log` ya no debe tomarse como referencia

## Payload de control en modo directorio

Cuando se usa `--dir`, cada lote enviado al backend incluye un bloque adicional como este:

```json
{
  "batchId": "dir-20260730153000-ab12cd34",
  "source": "JAVA_M2M",
  "directoryControl": {
    "executionId": "dir-exec-20260730153000-ff98aa11",
    "totalXmlFiles": 120,
    "skippedByProgressFiles": 20,
    "newXmlFiles": 100
  },
  "items": [
    {
      "fileName": "factura-001.xml",
      "contentBase64": "..."
    }
  ]
}
```

El backend usa ese bloque para conciliar:

- XML detectados en el directorio
- XML realmente nuevos a enviar
- CFDI aceptados por corrida
- CFDI procesados en backend

## Politica de reintentos del cliente

El `jar` incorpora manejo de reintentos para robustecer la importacion masiva.

### Comportamiento actual

- maximo `5` reintentos de envio por lote
- delay inicial de `1000 ms`
- pausa de `300 ms` entre requests exitosos
- si el servidor devuelve `429`, respeta `Retry-After`
- si el servidor devuelve `500` o hay error de red, aplica incremento progresivo del delay

## Recomendaciones operativas

1. Usar `batch-size` de `500` para cargas grandes, salvo que soporte indique otro valor
2. Ejecutar primero una prueba con un subconjunto pequeño
3. Resguardar siempre `clientId` y `clientSecret`
4. Conservar el `importRunId` devuelto por consola para seguimiento
5. Si se recibe `429`, no reiniciar procesos manualmente de forma inmediata; dejar actuar los reintentos del cliente

## Causas comunes de error

### Credenciales invalidas

Sintoma:

```text
No fue posible obtener el token OAuth para realizar la importación.
```

Validar:

- `clientId`
- `clientSecret`
- `scope`
- `base-url`

### Scope no autorizado

Sintoma:

```text
Error obteniendo token. HTTP 403: {"error":"invalid_scope","error_description":"El cliente solicitó scopes no autorizados"}
```

Validar:

- que el cliente tenga autorizado `cfdi.import`

### Archivo no valido

Sintoma:

```text
El archivo no existe o no es válido
```

Validar:

- ruta real del archivo
- extension `.xml`

### Directorio inexistente

Sintoma:

```text
El directorio no existe
```

Validar:

- ruta real de la carpeta

### Error 429

Sintoma:

```text
Error HTTP 429 al enviar lote
```

Accion recomendada:

- dejar que el cliente aplique sus reintentos
- reducir temporalmente volumen o frecuencia si soporte lo indica

### Error 500

Sintoma:

```text
Error HTTP 500 al enviar lote
```

Accion recomendada:

- revisar conectividad y disponibilidad del servidor
- permitir que el cliente haga reintentos automaticos
- si persiste, compartir `importRunId`, hora y lote ejecutado con soporte

## Comandos de ayuda

```bash
java -jar cfdi-ingest-1.0-SNAPSHOT.jar --help
```

o bien:

```bash
java -jar cfdi-ingest-1.0-SNAPSHOT.jar --ayuda
```

## Checklist de entrega al cliente

Antes de liberar el `jar` a un cliente, entregar:

1. `jar` ejecutable
2. `baseUrl`
3. `clientId`
4. `clientSecret`
5. scope autorizado `cfdi.import`
6. este manual
7. ejemplos de comandos ya ajustados a su entorno
