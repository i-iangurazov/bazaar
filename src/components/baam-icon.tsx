export function BaamIcon({ className, size = 24 }: { className?: string; size?: number | string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M6 15.5C6 9.7 10.3 6 16 6s10 3.7 10 9.5S21.7 25 16 25h-3.8L7 28l.8-6.2A9.7 9.7 0 0 1 6 15.5Z"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <path
        d="M12 12.5v5m4-7v9m4-7v5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
