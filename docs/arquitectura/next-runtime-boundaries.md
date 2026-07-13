# Limites de Runtime Entre Next y Workers

## Objetivo

Dejar documentada la correccion aplicada para evitar que los workers, scripts operativos y procesos ejecutados con `tsx` fallen por depender de marcadores exclusivos del runtime de Next.js.

## Problema Detectado

El comando:

```bash
npm run worker:verify
```

fallaba al iniciar con el error:

```text
Error: Cannot find module 'server-only'
```

La falla ocurria porque el worker importaba helpers compartidos que incluian:

```ts
import 'server-only'
```

Ese marcador funciona en el ecosistema de Next.js, pero no debe ser un requisito para procesos ejecutados directamente con Node.js o `tsx`.

## Causa Raiz

Se habia mezclado en la misma capa:

- logica reutilizable de servidor en `src/lib` y `src/services`
- una restriccion de framework especifica de Next.js (`server-only`)

Cuando un worker o script importaba esa logica compartida, Node intentaba resolver `server-only` como modulo real y el proceso abortaba antes de ejecutar la logica de negocio.

## Modificaciones Aplicadas

### 1. Se retiro `import 'server-only'` de helpers compartidos

Se elimino el marcador en archivos reutilizados por rutas, workers o scripts, incluyendo:

- `src/lib/provider-post-load-cancellation-alerts.ts`
- `src/lib/provider-cfdi-storage.ts`
- `src/lib/provider-received-cfdi-summary.ts`
- `src/lib/provider-context.ts`
- `src/lib/provider-business-rules.ts`
- `src/lib/provider-cfdi-report.ts`
- `src/lib/provider-tax-period-summary.ts`
- `src/lib/provider-payment-balance-period-summary.ts`
- `src/lib/sat-error-humanization.ts`
- `src/services/sat-cfdi-status.service.ts`
- `src/services/factronica-pac.service.ts`

### 2. Se normalizo el criterio para capas compartidas

La regla aplicada es:

- `src/lib` y `src/services` deben ser reutilizables desde rutas Next, workers, scripts y tareas en segundo plano
- los marcadores o protecciones especificas de Next deben vivir en el borde de entrada del framework, por ejemplo:
  - `route.ts`
  - `page.tsx`
  - server actions
  - wrappers especificos de Next

### 3. Se valido que no quedaran imports `server-only` en capas compartidas

Despues de la correccion, se verifico que:

- `src/lib` ya no contiene `import 'server-only'`
- `src/services` ya no contiene `import 'server-only'`

### 4. Se valido el arranque del worker

Se ejecuto nuevamente:

```bash
npm run worker:verify
```

El proceso avanzo a ejecucion real del worker y ya no reprodujo el error de resolucion del modulo `server-only`.

## Pros Del Cambio

- evita fallos futuros en workers y scripts
- reduce el acoplamiento al runtime de Next.js
- mejora la reutilizacion de la logica de negocio
- facilita pruebas unitarias y scripts operativos
- deja una arquitectura mas clara entre capa compartida y capa de framework

## Contras O Trade-Offs

- se pierde una barrera explicita dentro del helper compartido
- aumenta la importancia de mantener una separacion clara entre cliente, server y shared
- exige disciplina para no importar helpers server-side desde componentes client

## Regla Arquitectonica Recomendada

Usar este patron de forma consistente:

1. La logica reutilizable vive en `src/lib` o `src/services` sin `server-only`.
2. Las restricciones especificas de Next viven en archivos borde del framework.
3. Si un modulo necesita una proteccion explicita para Next, crear un wrapper delgado cerca de la ruta o pagina, en lugar de contaminar el helper compartido.

## Cuando Si Usar `server-only`

Usar `server-only` solo cuando el archivo sea verdaderamente exclusivo de Next.js y no deba ser importado por workers, scripts, CLI ni procesos externos al runtime web.

Ejemplos validos:

- wrappers de sesion usados solo por rutas o paginas
- helpers pensados exclusivamente para `route.ts`, `page.tsx` o server actions
- adaptadores de framework que no forman parte de la logica compartida

## Cuando No Usar `server-only`

No usar `server-only` en:

- servicios SAT reutilizables
- helpers de cifrado o descifrado
- sincronizadores
- calculos de resumen
- logica de negocio compartida
- modulos usados por BullMQ
- scripts operativos en `src/scripts`

## Validacion Manual Recomendada

Cada vez que se introduzca un nuevo helper server-side compartido:

1. verificar si sera consumido por workers o scripts
2. evitar `server-only` si la respuesta es si
3. correr el flujo operativo correspondiente, por ejemplo:

```bash
npm run worker:verify
```

4. revisar diagnosticos del archivo modificado

## Resultado Esperado

Con esta separacion:

- Next sigue controlando sus entradas server-side
- los workers pueden reutilizar la logica sin depender del runtime de Next
- el sistema evita una clase completa de errores de resolucion de modulos en segundo plano
