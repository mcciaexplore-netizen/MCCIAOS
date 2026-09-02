import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type ToastTone = 'success' | 'error' | 'info';

/**
 * An offer to reverse what just happened, shown inside the toast.
 *
 * The point of an undo is that it is reachable in the moment, so it lives where
 * the confirmation already is rather than somewhere the person has to go
 * looking. Given a longer life than a plain toast — three and a half seconds is
 * enough to read a message, not enough to decide you regret something.
 */
export interface ToastAction {
  label: string;
  onAct: () => void;
}

interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
  action?: ToastAction;
}

interface ToastValue {
  toast: (message: string, tone?: ToastTone, action?: ToastAction) => void;
}

const ToastCtx = createContext<ToastValue | null>(null);

let counter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, tone: ToastTone = 'success', action?: ToastAction) => {
      const id = ++counter;
      setToasts((t) => [...t, { id, message, tone, action }]);
      setTimeout(() => dismiss(id), action ? 10000 : 3500);
    },
    [dismiss],
  );

  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              'pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg',
              'bg-white dark:bg-slate-900',
              t.tone === 'success' && 'border-emerald-200 dark:border-emerald-900',
              t.tone === 'error' && 'border-rose-200 dark:border-rose-900',
              t.tone === 'info' && 'border-slate-200 dark:border-slate-800',
            )}
          >
            {t.tone === 'success' && (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
            )}
            {t.tone === 'error' && (
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
            )}
            {t.tone === 'info' && (
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
            )}
            <span className="flex-1 text-slate-700 dark:text-slate-200">
              {t.message}
            </span>
            {t.action && (
              <button
                onClick={() => {
                  t.action?.onAct();
                  dismiss(t.id);
                }}
                className="shrink-0 rounded px-1.5 py-0.5 text-sm font-medium text-brand-600 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-950"
              >
                {t.action.label}
              </button>
            )}
            <button
              onClick={() => dismiss(t.id)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast(): ToastValue {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
