
import { PrismaClient } from '@prisma/client';
import { fetchDireccionKpisAggregates, setParallelWorkersDireccion } from './src/lib/direccion-analytics-service';

const prisma = new PrismaClient();

try {
  await setParallelWorkersDireccion(prisma);
  console.log('Workers set');
  
  const companyId = 'cmtm8jg7j00002qdwcvbvztgh'; // Uno real
  
  const kpis = await fetchDireccionKpisAggregates({
    companyId,
    startDate: '2025-01-01',
    endDate: '2026-06-30'
  });
  console.log('KPIs:', kpis);
} catch (e) {
  console.error('ERROR:', e);
} finally {
  await prisma.$disconnect();
}
