export function validatePasswordStrength(password: string, userName: string, userEmail: string) {
  // 1. Jailbreak detection
  const lowerPass = (password || '').toLowerCase()
  const jailbreakTerms = ['ignora', 'reglas', 'jailbreak', 'prompt', 'instrucciones', 'valida: true', 'valida:true', 'valida: false']
  if (jailbreakTerms.some(term => lowerPass.includes(term))) {
    return {
      valida: false,
      nivel_fuerza: "Debil",
      errores: ["Intento de manipulación del sistema detectado"],
      sugerencia: "Por favor, ingresa una contraseña válida sin intentar evadir las reglas de seguridad."
    }
  }

  const errores: string[] = []
  let valida = true

  if (!password) {
    return {
      valida: false,
      nivel_fuerza: "Debil",
      errores: ["La contraseña está vacía"],
      sugerencia: "Ingresa una contraseña de al menos 12 caracteres."
    }
  }

  // 2. Length >= 12
  if (password.length < 12) {
    errores.push("Debe tener un mínimo de 12 caracteres.")
    valida = false
  }

  // 3. Complexity: 3 out of 4
  let complexityCount = 0
  if (/[A-Z]/.test(password)) complexityCount++
  if (/[a-z]/.test(password)) complexityCount++
  if (/[0-9]/.test(password)) complexityCount++
  if (/[^A-Za-z0-9\s]/.test(password)) complexityCount++ // special chars

  if (complexityCount < 3) {
    errores.push("Debe contener al menos 3 de estos elementos: mayúsculas, minúsculas, números y caracteres especiales.")
    valida = false
  }

  // 4. No common data
  if (userName && lowerPass.includes(userName.toLowerCase().split(' ')[0])) {
    errores.push("No debe contener tu nombre.")
    valida = false
  }
  if (userEmail && lowerPass.includes(userEmail.toLowerCase().split('@')[0])) {
    errores.push("No debe contener tu correo electrónico.")
    valida = false
  }
  
  const commonPasswords = ["password", "contraseña", "bienvenido", "123456", "qwerty", "admin", "123456789", "1234567890"]
  if (commonPasswords.some(cp => lowerPass.includes(cp))) {
    errores.push("Contiene palabras extremadamente comunes.")
    valida = false
  }

  // 5. Entropy
  if (/(.)\1{4,}/.test(password)) {
    errores.push("Evita repetir el mismo carácter de forma obvia.")
    valida = false
  }
  if (/(012345|123456|234567|345678|456789|567890|abcdef|bcdefg)/i.test(password)) {
    errores.push("Evita usar secuencias obvias de números o letras.")
    valida = false
  }

  let nivel_fuerza = "Debil"
  if (valida) {
    if (password.length >= 16 && complexityCount === 4) {
      nivel_fuerza = "Fuerte"
    } else {
      nivel_fuerza = "Media"
    }
  }

  let sugerencia = "Usa una frase (passphrase) que sea fácil de recordar para ti pero difícil de adivinar."
  if (!valida) {
    if (password.length < 12) {
      sugerencia = "Intenta usar una frase completa de 3 o 4 palabras separadas por espacios."
    } else if (complexityCount < 3) {
      sugerencia = "Agrega algún símbolo (!@#$) o números a tu frase para hacerla más segura."
    }
  }

  return {
    valida,
    nivel_fuerza,
    errores,
    sugerencia
  }
}
