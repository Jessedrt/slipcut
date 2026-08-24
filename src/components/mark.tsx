export function Mark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="7" className="fill-card" />
      <rect x="9" y="5" width="14" height="22" rx="2" className="fill-foreground" />
      <rect x="14" y="18" width="4" height="10" rx="0.5" className="fill-ring" />
    </svg>
  );
}
