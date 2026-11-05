# Guía de Diagnóstico de Sesión y Permisos

Para identificar exactamente en qué punto se están perdiendo los permisos de tu usuario Administrador, necesitamos extraer la información de tu sesión directamente del navegador.

Sigue estos pasos detallados:

## Paso 1: Iniciar sesión normalmente
1. Abre tu navegador (por ejemplo, Microsoft Edge) en **modo incógnito/privado**.
2. Entra a tu aplicación (por ejemplo: `http://localhost:3000` o la IP de tu servidor de producción).
3. Inicia sesión con el correo `rtorreh@gmail.com`.
4. Una vez que hayas ingresado y verifiques que los menús de administrador NO aparecen, **NO cierres esa pestaña ni cierres tu sesión**.

## Paso 2: Obtener datos de la Sesión (NextAuth)
5. En esa misma ventana de incógnito, abre una **nueva pestaña**.
6. En la barra de direcciones de esta nueva pestaña, escribe exactamente esto y presiona Enter:
   `http://localhost:3000/api/auth/session`
   *(Si estás usando una IP o dominio distinto, reemplaza localhost:3000 por tu IP/dominio, ejemplo: http://10.10.33.143:3000/api/auth/session)*
7. Verás en pantalla un texto con formato de código (JSON).
8. Selecciona todo ese texto, cópialo y **pégalo en nuestro chat**.

## Paso 3: Obtener datos de la Organización (Tenant)
9. En la barra de direcciones de esa misma pestaña, borra la ruta anterior y ahora escribe:
   `http://localhost:3000/api/tenant/status`
   *(Igualmente, usa tu IP/dominio si es necesario)*
10. Presiona Enter.
11. Verás otro texto en pantalla. Selecciona todo ese texto, cópialo y **pégalo también en nuestro chat**.

---
**¿Para qué sirve esto?**
- El Paso 2 nos dirá si al momento de iniciar sesión, el sistema está recordando correctamente tu rol de Administrador.
- El Paso 3 nos dirá si el validador de la organización (Tenant) está bloqueando el acceso o si detecta que falta algún paso de configuración.

¡Espero tu respuesta con los dos textos copiados!