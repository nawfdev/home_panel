import type { ComponentType, ReactNode, SVGProps } from "react";

interface PanelProps {
  title?: string;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  children: ReactNode;
  className?: string;
}

export function Panel({ title, icon: Icon, children, className = "" }: PanelProps) {
  return (
    <div className={`panel p-4 ${className}`}>
      {title && (
        <h3 className="flex items-center gap-2 font-semibold mb-4 text-sm text-gray-300">
          {Icon && <Icon className="w-4 h-4 text-gray-500" />}
          {title}
        </h3>
      )}
      {children}
    </div>
  );
}
