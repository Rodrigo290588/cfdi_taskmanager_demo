# Instrucciones de Ejecución de Pruebas Automatizadas (Jest) - Papel de Trabajo

Este documento explica de forma sencilla cómo ejecutar el script automatizado de pruebas para el módulo **Papel de Trabajo (Workpaper)** y cómo obtener la evidencia en formato CSV.

---

## 1. Requisitos Previos

Asegúrese de estar ubicado en la carpeta raíz del proyecto en su terminal de comandos.

```bash
cd C:\ITC_IA\cfditaskmanager_demo\cfdi_taskmanager_demo
```

Verifique que el servidor de desarrollo (`npm run dev`) **esté detenido** si requiere regenerar el cliente de base de datos, aunque para estas pruebas de frontend no es estrictamente necesario regenerar Prisma, es una buena práctica asegurar que el entorno está libre de bloqueos.

---

## 2. Ejecutar las Pruebas

Para correr exclusivamente el script de pruebas del Papel de Trabajo, ejecute el siguiente comando en su terminal:

```bash
npx jest "Guias de Prueba/Ingresos/Papel de Trabajo (Workpaper)/workpaper_ingresos.test.tsx"
```

### ¿Qué hace este comando?
- Inicia el entorno de pruebas de Jest.
- Ejecuta las validaciones simuladas del componente `page.tsx` de Workpaper (Filtros, Tabla, Paginación, Exportaciones).
- Muestra en consola una lista con el estatus de cada prueba (PASS / FAIL).

---

## 3. Generar la Evidencia en CSV

Si necesita entregar un reporte físico o digital de que las pruebas pasaron correctamente, ejecute el siguiente comando. Este comando corre las pruebas, extrae el resultado y lo guarda en un archivo CSV dentro de la misma carpeta de pruebas.

**(Copie y pegue todo este bloque en su terminal PowerShell):**

```powershell
$Output = npx jest "Guias de Prueba/Ingresos/Papel de Trabajo (Workpaper)/workpaper_ingresos.test.tsx" 2>&1; $Date = (Get-Date -Format "yyyy-MM-dd"); $CsvPath = "Guias de Prueba\Ingresos\Papel de Trabajo (Workpaper)\Evidencia_Resultados_Jest_Workpaper_$Date.csv"; "Suite,Prueba,Estado" | Out-File -FilePath $CsvPath -Encoding utf8; $Output | Select-String -Pattern '^\s*(PASS|FAIL)\s+' | ForEach-Object { $line = $_.Line.Trim(); if ($line -match '^(PASS|FAIL)\s+(.+?)\s+([^\s]+)$') { $status = $matches[1]; $suite = $matches[2]; $test = $matches[3]; "$suite,$test,$status" | Out-File -FilePath $CsvPath -Append -Encoding utf8 } else { $status = if ($line -match '^PASS') { 'PASS' } else { 'FAIL' }; $testName = $line -replace '^(PASS|FAIL)\s+', ''; "Workpaper,$testName,$status" | Out-File -FilePath $CsvPath -Append -Encoding utf8 } }; Write-Host "Evidencia generada en: $CsvPath"
```

### ¿Qué obtendrá?
Un archivo llamado `Evidencia_Resultados_Jest_Workpaper_YYYY-MM-DD.csv` en la carpeta `Guias de Prueba/Ingresos/Papel de Trabajo (Workpaper)` que podrá abrir en Excel para comprobar los resultados exitosos.

---

## 4. Solución de Problemas Frecuentes

1. **Error de Módulos (Cannot find module):**
   Asegúrese de haber instalado las dependencias previas:
   `npm install -D jest jest-environment-jsdom @testing-library/react @testing-library/jest-dom ts-jest @swc/core @swc/jest`

2. **Error de Transformación (SyntaxError):**
   Verifique que su archivo `jest.config.mjs` tenga configurado `@swc/jest` en la sección `transform`.

3. **Pruebas Fallidas (FAIL):**
   Si alguna prueba marca FAIL, lea la descripción del error en la consola; generalmente indica si faltó un mock o si la lógica del componente cambió recientemente.
