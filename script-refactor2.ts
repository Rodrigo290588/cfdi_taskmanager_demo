import fs from 'fs'

const p = './src/app/api/dashboard_fiscal/route.ts'
let content = fs.readFileSync(p, 'utf8')

const extractStart = content.indexOf("// Aggregations")
const endOfFile = content.lastIndexOf("}")

const toReplace = content.substring(extractStart, endOfFile)

const newFunc = `async function getDashboardHeavyMetricsResponse(
  baseWhere: any,
  monthsToQuery: Date[],
  effectiveOrigin: string,
  rfc: string,
  issuerFiscalEntityId: string,
  dateFilter: any,
  companyId: string,
  companyName: string,
  includeHeavyMetrics: boolean,
  startDateParam: string | null,
  endDateParam: string | null
) {
  ${toReplace}
}
`

const getCode = `
    return await getDashboardHeavyMetricsResponse(
      baseWhere,
      monthsToQuery,
      effectiveOrigin,
      rfc,
      issuerFiscalEntityId,
      dateFilter,
      companyId,
      company.businessName,
      includeHeavyMetrics,
      startDateParam,
      endDateParam
    )
`

// Insert newFunc right before GET
const getIndex = content.indexOf("export async function GET(request: NextRequest) {")
content = content.slice(0, getIndex) + newFunc + content.slice(getIndex)

// Replace in GET
content = content.replace(toReplace, getCode)

fs.writeFileSync(p, content)
