# Implementación de Chat IA con Gemini (Panel Lateral) - Fase Piloto Spec

## Why
El proyecto requiere un asistente conversacional para que los usuarios puedan consultar de forma ágil y natural información sobre sus CFDI. Esta fase piloto busca validar la integración técnica y la seguridad de los datos utilizando Google Gemini (reutilizando la API key existente) y un panel lateral interactivo.
Adicionalmente, por cuestiones de seguridad y control de acceso, el chat debe estar restringido a usuarios con un permiso específico administrable únicamente por superusuarios, y solo debe ser visible en pantallas de trabajo ("workpapers") específicas.

## What Changes
- **Base de datos:** Agregar el campo booleano `canUseAiChat` a los modelos `CustomRole` y `Member` en Prisma.
- **Roles y Permisos:** 
  - Actualización de `src/app/admin/roles/page.tsx` para incluir el toggle del Chat IA (solo gestionable por Superusuarios).
  - Adición del permiso en `src/lib/permissions.ts` y esquemas de validación Zod.
- **Backend AI:** 
  - Instalación de dependencias del Vercel AI SDK (`ai`, `@ai-sdk/google`).
  - Endpoint `src/app/api/ai/chat/route.ts` con integración a `gemini-1.5-flash` y validación de sesión/permisos.
  - Creación de Tools (Function Calling) para leer métricas de facturación e impuestos con inyección segura de `companyId`.
- **Frontend UI:**
  - Panel Lateral (Drawer/Sheet) accesible en rutas específicas mediante un botón flotante o botón en la barra superior.
  - Validación de ruta activa (`usePathname`) para mostrar el botón del chat exclusivamente en `/dashboard_fiscal/workpaper`, `/dashboard_recibidos/workpaper` y `/nomina/workpaper`.
  - Validación de permisos para ocultar el botón si el usuario no tiene activado `canUseAiChat`.

## Impact
- Affected specs: N/A (Nueva característica con impacto en módulo de roles).
- Affected code:
  - `prisma/schema.prisma`
  - `src/lib/permissions.ts` y `src/lib/admin-roles.ts`
  - `src/app/admin/roles/page.tsx`
  - `package.json`
  - `src/app/api/ai/chat/route.ts`
  - `src/components/layout/main-layout.tsx` (o un nuevo componente cliente `AiChatWrapper` para inyectar en layout)

## ADDED Requirements

### Requirement: Control de Acceso por Roles (Superusuario)
El sistema DEBE permitir que únicamente un usuario con privilegios de Superusuario asigne el permiso de acceso al Chat IA a otros roles/usuarios desde la pantalla de `/admin/roles`.

#### Scenario: Activación de permiso
- **WHEN** un superusuario edita un rol en `/admin/roles`.
- **THEN** visualiza un switch llamado "Chat de IA".
- **WHEN** lo activa y guarda.
- **THEN** los usuarios con ese rol adquieren el permiso `canUseAiChat` en la base de datos.

### Requirement: Visibilidad Restringida por Ruta
El botón para abrir el Chat IA DEBE ser visible EXCLUSIVAMENTE en las pantallas de workpaper predefinidas.

#### Scenario: Navegación del usuario
- **WHEN** el usuario autorizado navega a `/dashboard_fiscal/workpaper`.
- **THEN** el botón del Asistente IA es visible.
- **WHEN** el mismo usuario navega a `/dashboard_fiscal` (dashboard principal).
- **THEN** el botón del Asistente IA desaparece.

### Requirement: Interfaz de Chat (Panel Lateral)
El sistema DEBE proveer un panel lateral deslizable (opción B) donde el usuario autorizado pueda interactuar con el asistente.

### Requirement: Consulta Segura de Facturación e Impuestos
La IA DEBE poder responder preguntas sobre los totales de facturación e impuestos del mes, garantizando el aislamiento de datos por empresa inyectando el `companyId`.
