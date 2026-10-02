# Checklist de Pruebas: Alta Masiva de Usuarios (`/admin/users-bulk`)

Este checklist debe ser completado por el usuario de pruebas. Marca con una 'X' dentro de los corchetes `[ ]` cuando hayas validado exitosamente cada punto en el sistema.

## 1. Bloqueo de Archivos Incorrectos (Ej. Imágenes o PDF)
- [ ] Intenté subir un archivo que NO era `.txt` (por ejemplo, una foto `.jpg` o un `.pdf`).
- [ ] El sistema bloqueó la carga y el nombre del archivo no apareció en la caja punteada.
- [ ] Apareció inmediatamente un mensaje rojo de advertencia diciendo: "Solo se permiten archivos de texto plano (.txt)".

## 2. Detección de Errores dentro del Archivo (Auditoría)
- [ ] Subí un archivo `.txt` de prueba que contenía información mal escrita (formato incorrecto).
- [ ] Al hacer clic en "Cargar e Invitar Usuarios", el botón mostró el texto "Procesando..." brevemente.
- [ ] El sistema detuvo la carga y me mostró un recuadro rojo grande con el título "Se encontraron errores en el Layout".
- [ ] Debajo del recuadro rojo, apareció una tabla detallada.
- [ ] La tabla indicó claramente el número de Fila y el "Motivo del Rechazo" por cada error encontrado.

## 3. Simulación de Carga Exitosa
- [ ] Al simular la subida de un archivo `.txt` con formato perfecto, hice clic en "Cargar e Invitar Usuarios".
- [ ] La tabla roja de errores desapareció por completo (si es que estaba en la pantalla).
- [ ] Apareció un recuadro verde con el título "Proceso Completado".
- [ ] El mensaje verde me indicó la cantidad exacta de usuarios que fueron invitados.
- [ ] La caja punteada se limpió automáticamente, volviendo a mostrar el texto "Haz clic para seleccionar un archivo .txt" y el botón se deshabilitó.

## 4. Seguridad Anti-Intrusos (Bloqueo por Roles)
- [ ] Ingresé al sistema utilizando una cuenta de "Usuario Normal" (sin permisos de Administrador).
- [ ] Intenté abrir la página de Carga Masiva.
- [ ] El sistema NO me mostró la pantalla de subida de archivos; en su lugar, me bloqueó y mostró una pantalla de "Acceso Denegado".

## Notas Adicionales del Usuario de Pruebas
_Usa este espacio para anotar cualquier comportamiento extraño, textos confusos o si el sistema se quedó cargando infinitamente:_
- 
- 
- 
