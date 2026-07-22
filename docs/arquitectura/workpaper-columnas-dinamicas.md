# Workpaper: Columnas Dinámicas (Core + Complementos)

## Objetivo

Hacer que los reportes tipo `workpaper` (emitidos y recibidos) puedan:

- activar/desactivar columnas por grupos (Comprobante, Emisor, Receptor, Timbre, Complementos)
- filtrar por columna de forma eficiente
- exportar a CSV sin depender del parseo del XML en runtime
- soportar atributos de complementos del SAT (Pagos/REP, Nómina, Carta Porte, Comercio Exterior, etc.)

## Problema Actual

Hoy las columnas dinámicas y varios filtros del workpaper dependen de:

- `xmlContent` incluido en cada fila
- extracción por búsqueda de strings/regex en el frontend
- filtros `contains` contra `xmlContent` en el endpoint de listado

Esto escala mal para volúmenes altos.

## Enfoque Objetivo

Separar las columnas en 3 familias:

1. **Core (columnas tipadas en el documento)**
   - vienen de la tabla principal (`Invoice` / `ProviderUploadedCfdi`)
   - se indexan con índices compuestos según patrón de consulta

2. **Atributos indexados (proyección)**
   - vienen de una tabla `...ComplementAttribute`
   - se consultan por `attributeKey` y valores normalizados
   - permiten filtros dinámicos sin inflar el modelo con miles de columnas

3. **Especializadas**
   - calculadas con tablas dedicadas (ej. `...PaymentComplementDetail` para REP)

## Catálogo De Columnas (Contrato)

El botón `Columnas` no debe “inventar” campos. Debe operar sobre un catálogo estático (versionado) con:

- `key`: identificador único estable (lo que viaja a la API)
- `label`: texto visible
- `group`: agrupación en UI
- `kind`: `core | projectionAttribute | specialized`
- `dataType`: `text | number | date | boolean | currency`
- `filter`: `contains | equals | range | exists`
- `complementType` (solo si aplica)

Ejemplos de keys:

- `core.uuid`
- `core.issuerRfc`
- `attr.cfdi.tipoRelacion`
- `attr.pagos.monedaP`
- `attr.cartaporte.transpInternac`
- `has.PAGOS`

## Cómo El Workpaper Llama Al API

### Parámetros base

- `companyId`
- `page`, `limit`
- `dateFrom`, `dateTo`
- `satStatus`
- `cfdiType` (lista)

### Filtros por columna (nueva convención)

1. **Core**

- `core.<field>=valor`

2. **Presencia de complemento**

- `has.<COMPLEMENT_TYPE>=1`

3. **Atributos de complemento**

- `attr.<attributeKey>=valor`

Ejemplos:

- `has.PAGOS=1`
- `attr.pagos.monedaP=MXN`
- `attr.comercioExterior.motivoTraslado=`

## Respuesta Del API (workpaper)

El endpoint de workpaper debe devolver:

- `rows`: datos core del documento
- `projection`: mapa de atributos solicitados (solo los visibles)
- `pagination`

Reglas:

- el API no debe regresar `xmlContent` por defecto
- si se necesita XML, debe ser bajo un endpoint de detalle/descarga con autorización

Ejemplo de shape:

```json
{
  "rows": [
    {
      "id": "....",
      "uuid": "....",
      "issuerRfc": "....",
      "receiverRfc": "....",
      "total": 123.45,
      "issuanceDate": "2026-01-01T00:00:00.000Z",
      "projection": {
        "attr.cfdi.tipoRelacion": "04",
        "attr.pagos.monedaP": "MXN"
      }
    }
  ],
  "pagination": { "total": 1000, "page": 1, "limit": 20, "totalPages": 50 }
}
```

## Exportación CSV

La exportación debe tomar el mismo conjunto de columnas visibles:

- core: de la fila
- projection: del mapa `projection`
- specialized: de resultados precalculados o joins ya hechos en el API

Regla de Excel:

- el CSV debe incluir BOM UTF-8 (`\uFEFF`) antes del contenido

## Complementos Prioritarios (primer catálogo)

Para el primer catálogo soportado (Fase 1–2):

- Pagos/REP
- Nómina (básicos)
- Carta Porte
- Comercio Exterior

Notas:

- REP requiere tablas especializadas para escalar (no solo atributos).
- Nómina tendrá un módulo dedicado; el workpaper solo consume atributos básicos.

## Cómo Agregar Un Complemento Nuevo

1. Definir `COMPLEMENT_TYPE` estable (ej. `CARTA_PORTE`).
2. Actualizar detector de complementos (backfill / ingesta).
3. Agregar columnas al catálogo (`has.*` y/o `attr.*`).
4. Si se requiere explotación profunda:
   - diseñar tabla especializada
   - poblarla con backfill
   - exponerla como columnas `specialized`

