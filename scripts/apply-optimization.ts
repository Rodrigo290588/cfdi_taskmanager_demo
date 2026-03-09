import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function main() {
  const sqlPath = path.join(process.cwd(), 'scripts', 'optimize-postgres.sql');
  console.log(`Leyendo script SQL desde: ${sqlPath}`);
  
  try {
    const sql = fs.readFileSync(sqlPath, 'utf-8');
    
    // Separar comandos por punto y coma y filtrar líneas vacías
    const commands = sql
      .split(';')
      .map(cmd => cmd.trim())
      .filter(cmd => cmd.length > 0);

    console.log(`Se encontraron ${commands.length} comandos para ejecutar.`);

    for (const command of commands) {
      try {
        console.log(`Ejecutando: ${command}`);
        // executeRawUnsafe permite ejecutar comandos arbitrarios
        await prisma.$executeRawUnsafe(command);
        console.log('✅ Éxito.');
      } catch (e: unknown) {
        console.error(`❌ Error al ejecutar: ${command}`);
        if (e instanceof Error) {
          console.error(`   Detalle: ${e.message}`);
        } else {
          console.error(`   Detalle: ${String(e)}`);
        }
        // No detenemos el script, intentamos el siguiente comando
      }
    }
    
    console.log('\nNOTA: Algunos cambios en postgresql.conf (como shared_buffers) requieren reiniciar el servicio de PostgreSQL para tener efecto.');
    
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error('Error general:', error.message);
    } else {
      console.error('Error general:', String(error));
    }
  }
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
