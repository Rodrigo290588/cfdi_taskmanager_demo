import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';

const prisma = new PrismaClient();

async function main() {
  const sql = fs.readFileSync('prisma/migrations/20260831000000_add_payroll_materialized_views/migration.sql', 'utf8');
  
  const functionStart = sql.indexOf('CREATE OR REPLACE FUNCTION');
  const queries = sql.substring(0, functionStart).split(';').map(s => s.trim()).filter(s => s.length > 0);
  const functionDef = sql.substring(functionStart).trim();
  
  console.log('Executing migration script...');
  for (const stmt of queries) {
    if (stmt) {
      console.log(stmt.substring(0, 50) + '...');
      await prisma.$executeRawUnsafe(stmt);
    }
  }
  
  if (functionDef) {
    console.log('Creating function...');
    await prisma.$executeRawUnsafe(functionDef);
  }
  
  // Also run the refresh manually to make sure data is populated
  console.log('Refreshing views...');
  await prisma.$executeRawUnsafe('SELECT refresh_hr_materialized_views(false);');
  
  console.log('Done.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
