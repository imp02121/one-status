const columns = [
  {
    title: 'Product',
    links: [
      { label: 'Features', href: 'https://bundlenudge.com/features' },
      { label: 'Pricing', href: 'https://bundlenudge.com/pricing' },
      { label: 'Blog', href: 'https://blog.bundlenudge.com' },
      { label: 'Status', href: '/' },
    ],
  },
  {
    title: 'Developers',
    links: [
      { label: 'Documentation', href: 'https://docs.bundlenudge.com' },
      { label: 'Getting Started', href: 'https://docs.bundlenudge.com/getting-started' },
      { label: 'SDK Reference', href: 'https://docs.bundlenudge.com/sdk' },
      { label: 'API Reference', href: 'https://docs.bundlenudge.com/api' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { label: 'Migrate from CodePush', href: 'https://docs.bundlenudge.com/guides/migrate-from-codepush' },
      { label: 'Migrate from EAS Update', href: 'https://docs.bundlenudge.com/guides/migrate-from-eas-update' },
      { label: 'Expo Compatibility', href: 'https://docs.bundlenudge.com/guides/expo' },
      { label: 'FAQ', href: 'https://bundlenudge.com/#faq' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'GitHub', href: 'https://github.com/bundlenudge' },
      { label: 'Twitter / X', href: 'https://x.com/bundlenudge' },
      { label: 'Contact', href: 'mailto:hello@bundlenudge.com' },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white py-16 lg:py-20">
      <div className="mx-auto max-w-5xl px-6">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-5">
          {/* Logo */}
          <div className="lg:col-span-1">
            <a href="https://bundlenudge.com" className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-[#4F46E5] to-[#7C3AED]">
                <span className="text-[10px] font-bold leading-none text-white">BN</span>
              </span>
              <span className="text-[15px] font-semibold tracking-tight text-slate-900">
                BundleNudge
              </span>
            </a>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-slate-400">
              OTA updates for React Native. Ship fixes in seconds, not days.
            </p>
          </div>

          {/* Columns */}
          {columns.map(({ title, links }) => (
            <div key={title}>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                {title}
              </p>
              <ul className="mt-4 space-y-3">
                {links.map(({ label, href }) => (
                  <li key={label}>
                    <a
                      href={href}
                      className="text-sm text-slate-500 transition-colors hover:text-slate-900"
                    >
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-14 flex flex-col items-center justify-between gap-4 border-t border-slate-100 pt-8 sm:flex-row">
          <p className="text-xs text-slate-400">
            &copy; {new Date().getFullYear()} BundleNudge. All rights reserved.
          </p>
          <div className="flex gap-6">
            <a
              href="https://bundlenudge.com/privacy"
              className="text-xs text-slate-400 transition-colors hover:text-slate-600"
            >
              Privacy Policy
            </a>
            <a
              href="https://bundlenudge.com/terms"
              className="text-xs text-slate-400 transition-colors hover:text-slate-600"
            >
              Terms of Service
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
