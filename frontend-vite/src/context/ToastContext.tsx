import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";

type ToastType = "success" | "error" | "warning" | "info";

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  toasts: Toast[];
  show: (message: string, type?: ToastType, durationMs?: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TYPE_STYLES: Record<ToastType, string> = {
  success: "border-green-500/30 text-green-400",
  error: "border-red-500/30 text-red-400",
  warning: "border-yellow-500/30 text-yellow-400",
  info: "border-white/10 text-gray-200",
};

const TYPE_ICONS: Record<ToastType, typeof CheckCircleIcon> = {
  success: CheckCircleIcon,
  error: ExclamationCircleIcon,
  warning: ExclamationTriangleIcon,
  info: InformationCircleIcon,
};

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((message: string, type: ToastType = "info", durationMs = 4000) => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, type }]);
    if (durationMs > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, durationMs);
    }
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, show }}>
      {children}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 w-full max-w-sm">
        {toasts.map((t) => {
          const Icon = TYPE_ICONS[t.type];
          return (
            <div
              key={t.id}
              className={`panel border px-4 py-3 text-sm flex items-center gap-2 ${TYPE_STYLES[t.type]}`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="text-gray-200">{t.message}</span>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
