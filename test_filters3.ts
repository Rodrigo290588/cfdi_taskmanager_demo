import { fetchHeadcountKpis } from './src/lib/payroll-analytics-service';

async function main() {
  try {
    const res = await fetchHeadcountKpis({
      companyId: 'cmtm8jg7r00012qdwca083613',
      organizationId: null,
      fiscalEntityId: null,
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-01-06'),
      departamento: null,
      tipoNomina: 'O',
      periodicidad: '05'
    });
    console.log("Result:", res);
  } catch (err) {
    console.error("Error:", err);
  }
}
main();