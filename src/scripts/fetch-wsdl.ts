
import fs from 'fs'

async function main() {
  const url = 'https://cfdidescargamasivasolicitud.clouda.sat.gob.mx/SolicitaDescargaService.svc?wsdl'
  try {
    console.log(`Fetching ${url}...`)
    const response = await fetch(url)
    const text = await response.text()
    console.log('WSDL Content:')
    console.log(text)
    fs.writeFileSync('solicita_descarga.wsdl', text)
  } catch (error) {
    console.error(`Error fetching ${url}:`, (error as Error).message)
  }
}

main()
