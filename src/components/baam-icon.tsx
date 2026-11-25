export function BaamIcon({ className, size = 24 }: { className?: string; size?: number | string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.65}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8.25 4.95a3.6 3.6 0 0 1 2.9-1.45h6.65a3.7 3.7 0 0 1 3.7 3.7v1.6a3.7 3.7 0 0 1-1.8 3.18v3.12l-1.1-.85" />
      <path d="M6.15 7.6h6.7a3.65 3.65 0 0 1 3.65 3.65v1.65a3.65 3.65 0 0 1-3.65 3.65H8.2L4.55 19.5v-3.36A3.65 3.65 0 0 1 2.5 12.9v-1.65A3.65 3.65 0 0 1 6.15 7.6Z" />
      <g fill="currentColor" stroke="none">
        <circle cx="6.6" cy="12" r="0.8" />
        <circle cx="9.5" cy="12" r="0.8" />
        <circle cx="12.4" cy="12" r="0.8" />
      </g>
    </svg>
  );
}
