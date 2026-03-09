import { z } from "zod"

export const signInSchema = z.object({
  email: z.string().email("Formato de email inválido").trim().toLowerCase(),
  password: z.string().min(1, "La contraseña es requerida"),
})

export const signUpSchema = z.object({
  name: z.string()
    .min(2, 'El nombre debe tener al menos 2 caracteres')
    .max(50, 'El nombre es demasiado largo')
    .trim()
    .regex(/^[a-zA-Z\s\u00C0-\u00FF]*$/, 'El nombre solo puede contener letras y espacios'),
  email: z.string()
    .email('Correo electrónico inválido')
    .trim()
    .toLowerCase(),
  password: z.string()
    .min(8, 'La contraseña debe tener al menos 8 caracteres')
    .regex(/[A-Z]/, 'Debe contener al menos una letra mayúscula')
    .regex(/[a-z]/, 'Debe contener al menos una letra minúscula')
    .regex(/[0-9]/, 'Debe contener al menos un número')
    .regex(/[^A-Za-z0-9]/, 'Debe contener al menos un carácter especial (@$!%*?&)'),
  confirmPassword: z.string()
}).refine((data) => data.password === data.confirmPassword, {
  message: "Las contraseñas no coinciden",
  path: ["confirmPassword"],
});
