import * as xmlCrypto from 'xml-crypto'

export interface SolicitaDescargaOptions {
  rfcSolicitante: string
  startDate: Date
  endDate: Date
  tipoSolicitud: 'CFDI' | 'Metadata'
  retrievalType: 'emitidos' | 'recibidos' | 'folio'
  rfcEmisor?: string
  rfcReceptor?: string
  rfcACuentaTerceros?: string
  tipoComprobante?: string
  estadoComprobante?: string
  complemento?: string
  uuid?: string // Folio
  
  // Credentials
  certificate: string // PEM format (cleaned or not, we'll clean it)
  privateKey: string // PEM format
}

export class SatSoapService {
  private static NAMESPACES = {
    s: 'http://schemas.xmlsoap.org/soap/envelope/',
    des: 'http://DescargaMasivaTerceros.sat.gob.mx',
    xd: 'http://www.w3.org/2000/09/xmldsig#',
    o: 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd',
    u: 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd'
  }

  public generateSolicitaDescargaSoap(options: SolicitaDescargaOptions): string {
    const {
      rfcSolicitante,
      startDate,
      endDate,
      tipoSolicitud,
      retrievalType,
      rfcEmisor,
      rfcReceptor,
      rfcACuentaTerceros,
      tipoComprobante,
      estadoComprobante,
      complemento,
      uuid,
      certificate,
      privateKey
    } = options

    // Format dates: YYYY-MM-DDTHH:mm:ss
    const startStr = startDate.toISOString().split('.')[0]
    const endStr = endDate.toISOString().split('.')[0]

    // Attributes for <solicitud>
    // CRITICAL: TipoSolicitud must be "CFDI" (uppercase)
    // Removed Id and xmlns:u to match WSDL strictly
    let solicitudAttrs = `xmlns="${SatSoapService.NAMESPACES.des}" RfcSolicitante="${rfcSolicitante}"`

    // Add common attributes based on type
    if (retrievalType !== 'folio') {
       // Force string comparison to avoid TS error since we might get lowercase from DB despite the type
       const typeStr = tipoSolicitud as string;
       solicitudAttrs += ` FechaInicial="${startStr}" FechaFinal="${endStr}" TipoSolicitud="${typeStr === 'cfdi' ? 'CFDI' : tipoSolicitud}"`
    }

    // Specific logic per Retrieval Type
    let rootElement = ''
    
    // We will build the <solicitud> content first
    let solicitudContent = ''

    if (retrievalType === 'folio') {
      rootElement = 'SolicitaDescargaFolio'
      if (uuid) solicitudAttrs += ` Folio="${uuid}"`
      if (rfcACuentaTerceros) solicitudAttrs += ` RfcACuentaTerceros="${rfcACuentaTerceros}"`
    } else if (retrievalType === 'recibidos') {
      rootElement = 'SolicitaDescargaRecibidos'
      if (rfcEmisor) solicitudAttrs += ` RfcEmisor="${rfcEmisor}"`
      if (rfcReceptor) solicitudAttrs += ` RfcReceptor="${rfcReceptor}"`
      if (rfcACuentaTerceros) solicitudAttrs += ` RfcACuentaTerceros="${rfcACuentaTerceros}"`
      if (tipoComprobante) solicitudAttrs += ` TipoComprobante="${tipoComprobante}"`
      if (estadoComprobante) solicitudAttrs += ` EstadoComprobante="${estadoComprobante}"`
      if (complemento) solicitudAttrs += ` Complemento="${complemento}"`
    } else {
      // Default: emitidos
      rootElement = 'SolicitaDescargaEmitidos'
      if (rfcEmisor) solicitudAttrs += ` RfcEmisor="${rfcEmisor}"`
      if (rfcACuentaTerceros) solicitudAttrs += ` RfcACuentaTerceros="${rfcACuentaTerceros}"`
      if (tipoComprobante) solicitudAttrs += ` TipoComprobante="${tipoComprobante}"`
      if (estadoComprobante) solicitudAttrs += ` EstadoComprobante="${estadoComprobante}"`
      if (complemento) solicitudAttrs += ` Complemento="${complemento}"`

      if (rfcReceptor) {
        solicitudContent = `<RfcReceptores><RfcReceptor>${rfcReceptor}</RfcReceptores></RfcReceptores>`
      }
    }

    // Prepare content for signature
    // The signature goes INSIDE the <solicitud> element
    const solicitudXml = `<solicitud ${solicitudAttrs}>${solicitudContent}</solicitud>`
    
    // Sign the <solicitud> element content
    const signedSolicitud = this.signSolicitud(solicitudXml, privateKey, certificate)
    
    // Construct final SOAP envelope with signed content
    // Note: signedSolicitud already contains the <solicitud> with the enveloped signature
    
    // EMPTY HEADER as requested by user
    const soapEnvelope = `<s:Envelope xmlns:s="${SatSoapService.NAMESPACES.s}"><s:Header/><s:Body><${rootElement} xmlns="${SatSoapService.NAMESPACES.des}">${signedSolicitud}</${rootElement}></s:Body></s:Envelope>`

    return soapEnvelope
  }

  public generateVerificaSolicitudDescargaSoap(options: {
    rfcSolicitante: string
    idSolicitud: string
    certificate: string
    privateKey: string
  }): string {
    const { rfcSolicitante, idSolicitud, certificate, privateKey } = options
    
    // <solicitud IdSolicitud="..." RfcSolicitante="...">
    const solicitudAttrs = `xmlns="${SatSoapService.NAMESPACES.des}" IdSolicitud="${idSolicitud}" RfcSolicitante="${rfcSolicitante}"`
    const solicitudXml = `<solicitud ${solicitudAttrs}></solicitud>`
    
    const signedSolicitud = this.signSolicitud(solicitudXml, privateKey, certificate)
    
    // EMPTY HEADER as requested by user
    const rootElement = 'VerificaSolicitudDescarga'
    const soapEnvelope = `<s:Envelope xmlns:s="${SatSoapService.NAMESPACES.s}"><s:Header/><s:Body><${rootElement} xmlns="${SatSoapService.NAMESPACES.des}">${signedSolicitud}</${rootElement}></s:Body></s:Envelope>`

    return soapEnvelope
  }

  private cleanCertificate(cert: string): string {
    return cert
      .replace(/-----BEGIN CERTIFICATE-----/g, '')
      .replace(/-----END CERTIFICATE-----/g, '')
      .replace(/\s+/g, '')
  }

  private signSolicitud(xmlFragment: string, privateKey: string, certificate: string): string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sig: any = new xmlCrypto.SignedXml({ idAttribute: 'RfcSolicitante' })
    
    sig.privateKey = privateKey
            sig.signatureAlgorithm = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1'
            sig.canonicalizationAlgorithm = 'http://www.w3.org/2001/10/xml-exc-c14n#'
            
            // We sign the ENTIRE <solicitud> element (enveloped signature)
    // Using URI="" to refer to the containing document (the solicitud element itself)
    // This removes the dependency on an explicit Id attribute which is not in the WSDL
    
    // Hack: Use an existing attribute as "Id" to prevent xml-crypto from adding a new "Id" attribute
    // We use "RfcSolicitante" which is always present on the root <solicitud> element.
    // sig.idAttribute = "RfcSolicitante" // Handled in constructor

    sig.addReference({
      xpath: "/*", 
      uri: "",
      isEmptyUri: true,
      transforms: [
        'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
        'http://www.w3.org/2001/10/xml-exc-c14n#'
      ],
      digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1'
    })

            // Override KeyInfo to match SAT simplified format (just Certificate)
            // xml-crypto v6 uses getKeyInfoContent, NOT keyInfoProvider
            sig.getKeyInfoContent = () => {
                 const cleaned = this.cleanCertificate(certificate)
                 return `<X509Data><X509Certificate>${cleaned}</X509Certificate></X509Data>`
            }
            
            // We also need to set publicCert or privateKey for validation/signing, 
            // but here we just need to ensure getKeyInfoContent is called.
            // xml-crypto calls getKeyInfoContent inside computeSignature.

            // Compute signature on the fragment directly
            sig.computeSignature(xmlFragment, {
                location: { reference: "//*[local-name(.)='solicitud']", action: "append" }
            })

    // Return the ENTIRE signed XML element
    return sig.getSignedXml()
  }
}
