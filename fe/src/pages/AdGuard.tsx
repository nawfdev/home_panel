export function AdGuard() {
  return (
    <div className="flex flex-col h-full">
      <h1 className="text-2xl font-bold text-white px-6 py-4">AdGuard Home</h1>
      <iframe
        src="/api/adguard/"
        title="AdGuard Home"
        className="w-full flex-1 border-0"
        style={{ minHeight: "calc(100vh - 120px)" }}
      />
    </div>
  );
}
