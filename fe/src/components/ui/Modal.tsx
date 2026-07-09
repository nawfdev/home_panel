import type { ReactNode } from "react";
import { XMarkIcon } from "@heroicons/react/24/outline";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}

export function Modal({ title, onClose, children, wide }: ModalProps) {
  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`panel w-full ${wide ? "max-w-2xl" : "max-w-md"} max-h-[85vh] overflow-y-auto p-5`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-100">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-gray-500 hover:text-gray-200 hover:bg-white/5 rounded-lg transition"
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
