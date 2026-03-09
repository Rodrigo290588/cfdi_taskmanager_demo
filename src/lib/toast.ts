import { toast } from "sonner"

export function showSuccess(message: string, description?: string) {
  toast.success(message, {
    description,
    duration: 4000,
    closeButton: true,
  })
}

export function showError(message: string, description?: string) {
  toast.error(message, {
    description,
    duration: 5000,
    closeButton: true,
  })
}

export function showInfo(message: string, description?: string) {
  toast.info(message, {
    description,
    duration: 4000,
    closeButton: true,
  })
}

export function showWarning(message: string, description?: string) {
  toast.warning(message, {
    description,
    duration: 4500,
    closeButton: true,
  })
}

export function showLoading(message: string) {
  return toast.loading(message, { closeButton: true })
}

export function showPromise<T>(
  promise: Promise<T>,
  messages: {
    loading: string
    success: string
    error: string
  }
) {
  return toast.promise(promise, {
    loading: messages.loading,
    success: messages.success,
    error: messages.error,
    closeButton: true,
  })
}
