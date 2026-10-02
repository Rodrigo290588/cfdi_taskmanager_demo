# Tasks

- [ ] Task 1: Actualización de Base de Datos y Permisos
  - [ ] SubTask 1.1: Modificar `prisma/schema.prisma` para agregar `canUseAiChat Boolean @default(false)` en `CustomRole` y `Member`. Ejecutar migración (`npx prisma migrate dev`).
  - [ ] SubTask 1.2: Actualizar `src/lib/permissions.ts` y esquemas de validación Zod (`src/lib/admin-roles.ts`) para incluir el nuevo permiso `AI_CHAT_ACCESS` / `canUseAiChat`.
  - [ ] SubTask 1.3: Agregar el switch "Chat de IA" en la UI de edición de roles (`src/app/admin/roles/page.tsx`).

- [ ] Task 2: Preparación del Backend (IA)
  - [ ] SubTask 2.1: Instalar dependencias requeridas (`npm install ai @ai-sdk/google zod`).
  - [ ] SubTask 2.2: Crear endpoint `/api/ai/chat/route.ts`. Debe validar que la sesión activa tenga el permiso `canUseAiChat` antes de instanciar `gemini-1.5-flash`.
  - [ ] SubTask 2.3: Crear Tools en `src/lib/ai/tools/billing-summary.ts` para obtener totales de ingresos, egresos e impuestos del mes (filtrando por `companyId`).

- [ ] Task 3: Desarrollo del Frontend (Interfaz del Chat)
  - [ ] SubTask 3.1: Crear componentes base del chat en `src/components/ai/` (Panel Lateral Drawer/Sheet, lista de mensajes, input).
  - [ ] SubTask 3.2: Crear el componente contenedor `src/components/ai/ai-chat-wrapper.tsx` que use `usePathname` para mostrar el trigger del chat SOLAMENTE si la ruta coincide con `/dashboard_fiscal/workpaper`, `/dashboard_recibidos/workpaper` o `/nomina/workpaper`, y si el usuario tiene permiso.
  - [ ] SubTask 3.3: Inyectar `ai-chat-wrapper.tsx` en el `src/components/layout/main-layout.tsx` (o layout general) para que esté disponible globalmente pero condicionado.

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 2]
