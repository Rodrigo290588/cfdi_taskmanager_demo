const fs = require('fs');

// 1. Update package.json
const pkgPath = 'package.json';
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.version = '1.20.0';
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

// 2. Update CHANGELOG.md
const changelogPath = 'CHANGELOG.md';
let changelog = fs.readFileSync(changelogPath, 'utf8');

const newEntry = `## v1.20.0 - 2026-09-30

### Resumen
- **Automatización Integral de QA y Pruebas**: Creación de Guías de Prueba en lenguaje no técnico, Checklists detallados y Scripts de Jest automatizados para más de 10 módulos críticos (Dashboard Admin, Gestión de Usuarios, Carga Masiva, Roles y Perfiles, Empresas, Monitor de Importación, Preferencias, Descargas Masivas, Tableros de Ingresos y Egresos, Cancelaciones y Papel de Trabajo).
- **Gestor Interactivo de Pruebas**: Se agregó el script \`ejecutar_pruebas.js\` (accesible vía \`npm run test:menu\`) que permite ejecutar suites de prueba de manera individual o completa desde una interfaz CLI, autogenerando reportes de evidencia en formato CSV.
- **Resolución de Deuda Técnica (ESLint / SonarQube)**: Refactorización masiva en scripts de prueba y componentes para resolver advertencias de análisis estático (remoción de tipos \`any\`, corrección de ternarios anidados, optimización de expresiones regulares, eliminación de side-effects en \`waitFor\` y reemplazo de importaciones nativas por el estándar \`node:\`).
- **Mocks Avanzados para Entornos Virtuales**: Implementación de mocks estructurales para componentes complejos de Radix UI, simulación de navegación (Next.js App Router), y objetos \`File\` nativos para validación de cargas masivas.

### Archivos Afectados Relevantes
- \`ejecutar_pruebas.js\` (Nuevo gestor de pruebas)
- \`package.json\` (Nuevo script \`test:menu\`)
- Múltiples scripts de prueba integrados en el directorio \`Guias de Prueba/\`
- Archivos de componentes y configuración sanitizados según reglas de SonarQube.

---

`;

if (changelog.includes('## v1.19.0')) {
    changelog = changelog.replace('## v1.19.0', newEntry + '## v1.19.0');
} else {
    // Fallback if exactly v1.19.0 string is slightly different
    changelog = changelog.replace('Este archivo documenta los cambios versionados relevantes de la aplicacion.\n', 'Este archivo documenta los cambios versionados relevantes de la aplicacion.\n\n' + newEntry);
}

fs.writeFileSync(changelogPath, changelog);
console.log("Archivos actualizados correctamente.");
