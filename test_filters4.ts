import { PayrollDashboardFiltersSchema, fetchHeadcountKpis } from './src/lib/payroll-analytics-service';

async function main() {
  try {
    const filters = PayrollDashboardFiltersSchema.parse({
      companyId: 'cmtm8jg7r00012qdwca083613',
      organizationId: null,
      fiscalEntityId: null,
      startDate: '2026-01-01',
      endDate: '2026-01-06',
      departamento: null,
      tipoNomina: 'O',
      periodicidad: '05'
    });
    console.log("Parsed filters:", filters);
    const res = await fetchHeadcountKpis(filters);
    console.log("Result:", res);
  } catch (err) {
    console.error("Error:", err);
  }
}
main();