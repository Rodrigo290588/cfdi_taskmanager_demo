 
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const readline = require('node:readline');

const BASE_DIR = 'Guias de Prueba';
const RESULTS_FILE = 'jest-results.json';

// Función para buscar archivos de prueba
function findTestFiles(dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      findTestFiles(filePath, fileList);
    } else if (filePath.endsWith('.test.tsx') || filePath.endsWith('.test.ts') || filePath.endsWith('.test.js')) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

// Función para generar CSV a partir de los resultados JSON
function generateCSV(moduleName = 'Todos') {
  if (!fs.existsSync(RESULTS_FILE)) {
    console.log('\n⚠️ No se encontró el archivo de resultados de Jest. (Las pruebas pudieron haber fallado al compilar o no se ejecutaron).');
    return;
  }

  try {
    const data = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
    let csvContent = 'Archivo,Suite,Prueba,Estado,Duracion(ms)\n';

    data.testResults.forEach(suite => {
      // Normalizamos el path para mostrar solo la parte relevante
      const fileName = suite.name.split(BASE_DIR)[1]?.substring(1).replaceAll('\\', '/') || path.basename(suite.name);
      
      suite.assertionResults.forEach(test => {
        const suiteName = test.ancestorTitles.join(' > ').replaceAll('"', '""');
        const testName = test.title.replaceAll('"', '""');
        const status = test.status === 'passed' ? 'EXITOSO' : 'FALLIDO';
        const duration = test.duration || 0;
        
        csvContent += `"${fileName}","${suiteName}","${testName}","${status}","${duration}"\n`;
      });
    });

    // Formato de fecha YYYY-MM-DD_HH-MM-SS
    const dateObj = new Date();
    const dateStr = dateObj.toISOString().split('T')[0];
    const timeStr = dateObj.toTimeString().split(' ')[0].replaceAll(':', '-');
    const csvFileName = `Evidencia_Resultados_${moduleName}_${dateStr}_${timeStr}.csv`;
    const csvPath = path.join(BASE_DIR, csvFileName);

    fs.writeFileSync(csvPath, csvContent, 'utf8');
    console.log(`\n✅ ¡Reporte CSV generado exitosamente en: ${csvPath}!`);
    
    // Limpiar archivo temporal JSON
    fs.unlinkSync(RESULTS_FILE);
  } catch (error) {
    console.log('\n❌ Error al intentar generar el CSV:', error.message);
  }
}

const testFiles = findTestFiles(BASE_DIR);

if (testFiles.length === 0) {
  console.log('❌ No se encontraron archivos de prueba en el directorio:', BASE_DIR);
  process.exit(0);
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('\n=============================================');
console.log('      GESTOR DE PRUEBAS AUTOMATIZADAS');
console.log('=============================================\n');
console.log('0. 🚀 Ejecutar TODOS los módulos (Toda la carpeta Guias de Prueba)\n');

testFiles.forEach((file, index) => {
  // Mostrar el path relativo para que sea más legible
  const displayPath = file.split(BASE_DIR)[1]?.substring(1) || file;
  console.log(`${index + 1}. 📄 ${displayPath}`);
});
console.log('\n---------------------------------------------');

rl.question('\n👉 Ingresa el número de la opción que deseas ejecutar (0 para todos): ', (answer) => {
  const option = Number.parseInt(answer.trim(), 10);

  let command = '';
  let moduleName = 'Todos';

  if (option === 0) {
    console.log('\n⏳ Ejecutando TODAS las pruebas...');
    // Ejecutamos Jest sobre el directorio base
    command = `npx jest "${BASE_DIR}" --json --outputFile=${RESULTS_FILE}`;
    moduleName = 'Todos';
  } else if (option > 0 && option <= testFiles.length) {
    const selectedFile = testFiles[option - 1];
    console.log(`\n⏳ Ejecutando prueba: ${selectedFile}...`);
    // Ejecutamos Jest solo sobre el archivo seleccionado
    command = `npx jest "${selectedFile}" --json --outputFile=${RESULTS_FILE}`;
    moduleName = path.basename(selectedFile).split('.')[0];
  } else {
    console.log('❌ Opción inválida. Saliendo...');
    rl.close();
    process.exit(1);
  }

  console.log('---------------------------------------------\n');

  try {
    // stdio: 'inherit' permite ver la salida de Jest en tiempo real en la consola
    execSync(command, { stdio: 'inherit' });
  } catch {
    // Jest arroja un error en execSync si alguna prueba falla (Exit code 1).
    // Lo capturamos para evitar que el script de Node.js se caiga y poder generar el CSV.
    console.log('\n⚠️ La ejecución finalizó (algunas pruebas fallaron o hubo alertas). Generando reporte de los resultados obtenidos...');
  }

  generateCSV(moduleName);
  console.log('\n¡Proceso Finalizado!\n');
  rl.close();
});
