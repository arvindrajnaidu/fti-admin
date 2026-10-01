import { useKumoToastManager } from '@cloudflare/kumo';

export function useToast() {
  const toasts = useKumoToastManager();
  return {
    success: (title, description) => toasts.add({ title, description, variant: 'success' }),
    error: (title, description) => toasts.add({ title, description, variant: 'error' }),
    warning: (title, description) => toasts.add({ title, description, variant: 'warning' }),
    info: (title, description) => toasts.add({ title, description, variant: 'info' }),
  };
}
