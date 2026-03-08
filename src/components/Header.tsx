export function Header() {
  return (
    <header className="border-b border-slate-200">
      <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-6">
        {/* Logo */}
        <a href="https://bundlenudge.com" className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-[#4F46E5] to-[#7C3AED]">
            <span className="text-[10px] font-bold leading-none text-white">BN</span>
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-slate-900">
            BundleNudge
          </span>
        </a>

        {/* Right */}
        <div className="flex items-center gap-4">
          <a
            href="mailto:support@bundlenudge.com"
            className="hidden text-sm text-slate-500 transition-colors hover:text-slate-900 sm:block"
          >
            Report an issue
          </a>
          <a
            href="#subscribe"
            className="rounded-full border border-slate-200 px-4 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-900"
          >
            Subscribe to updates
          </a>
        </div>
      </div>
    </header>
  );
}
