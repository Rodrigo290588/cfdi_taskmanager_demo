import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { encrypt } from "@/lib/encryption"
import { validateFiel } from "@/lib/fiel-validation"

export async function POST(req: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return new NextResponse("Unauthorized", { status: 401 })
    }

    const formData = await req.formData()
    const rfc = formData.get("rfc") as string
    const password = formData.get("password") as string
    const privateKeyFile = formData.get("privateKey") as File
    const certificateFile = formData.get("certificate") as File
    const organizationId = formData.get("organizationId") as string

    if (!rfc || !password || !privateKeyFile || !certificateFile || !organizationId) {
      return new NextResponse("Missing fields", { status: 400 })
    }

    // Verify membership
    const member = await prisma.member.findUnique({
      where: {
        userId_organizationId: {
          userId: session.user.id,
          organizationId,
        },
      },
    })

    if (!member || member.status !== "APPROVED") {
      return new NextResponse("Forbidden", { status: 403 })
    }

    // Read files
    const privateKeyBuffer = Buffer.from(await privateKeyFile.arrayBuffer())
    const certificateBuffer = Buffer.from(await certificateFile.arrayBuffer())

    // Validate FIEL (Key, Cer, Password correspondence)
    const validation = validateFiel(privateKeyBuffer, certificateBuffer, password)
    
    if (!validation.isValid) {
      return new NextResponse(validation.error || "La FIEL no es válida", { status: 400 })
    }

    // Validate RFC matches the certificate
    if (validation.rfc && validation.rfc !== rfc) {
      return new NextResponse(`El RFC del certificado (${validation.rfc}) no coincide con el RFC seleccionado (${rfc})`, { status: 400 })
    }


    // Prepare data for encryption
    // .key files are binary, so we base64 encode them before encryption to safe-guard format
    const privateKeyBase64 = privateKeyBuffer.toString('base64')
    
    // Encrypt
    const encryptedPrivateKey = encrypt(privateKeyBase64)
    const encryptedPassword = encrypt(password)
    
    // Certificate is stored as base64 (public info)
    const certificateBase64 = certificateBuffer.toString('base64')

    // Save to DB
    await prisma.satCredential.upsert({
      where: {
        organizationId_rfc: {
          organizationId,
          rfc,
        },
      },
      update: {
        encryptedPrivateKey,
        encryptedPassword,
        certificate: certificateBase64,
      },
      create: {
        organizationId,
        rfc,
        encryptedPrivateKey,
        encryptedPassword,
        certificate: certificateBase64,
      },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error saving SAT credentials:", error)
    return new NextResponse("Internal Server Error", { status: 500 })
  }
}
