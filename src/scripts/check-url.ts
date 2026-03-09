
async function checkUrl(url: string) {
  try {
    console.log(`Checking ${url}...`)
    const response = await fetch(url, { method: 'GET' })
    console.log(`Status: ${response.status} ${response.statusText}`)
  } catch (error) {
    console.error(`Error checking ${url}:`, (error as Error).message)
  }
}

async function main() {
  await checkUrl('https://cfdidescargamasivasolicitud.clouda.sat.gob.mx/Autenticacion/Autenticacion.svc')
  await checkUrl('https://cfdidescargamasivasolicitud.clouda.sat.gob.mx/SolicitaDescarga.svc')
  await checkUrl('https://cfdidescargamasivasolicitud.clouda.sat.gob.mx/SolicitaDescargaService.svc?wsdl')
}

main()
