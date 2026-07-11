import { Bars3Icon, ServerIcon } from "@heroicons/react/24/outline";

export function MobileHeader({ onOpen }: { onOpen: () => void }) {
  return (
    <header className="fixed top-0 left-0 right-0 bg-gray-900/95 backdrop-blur-md h-14 px-3 flex items-center justify-between z-30 md:hidden border-b border-white/7">
      <button
        type="button"
        onClick={onOpen}
        className="w-11 h-11 flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/5 rounded-xl active:scale-95 transition"
      >
        <Bars3Icon className="w-5 h-5" />
      </button>
      <div className="flex items-center gap-2">
        <div className="brand-mark brand-mark-sm">
          <ServerIcon />
        </div>
        <span className="font-bold text-sm tracking-tight">Nestcore</span>
      </div>
      <div className="w-11" />
    </header>
  );
}
