import { cn } from "@/lib/utils";

export const Spinner = ({ className }: { className?: string }) => (
  <svg
    className={cn("h-4 w-4 animate-spin text-muted-foreground/80", className)}
    viewBox="0 0 24 24"
    aria-hidden
  >
    <circle
      className="opacity-20"
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      strokeWidth="4"
      fill="none"
    />
    <path
      className="opacity-80"
      d="M22 12a10 10 0 0 1-10 10"
      stroke="currentColor"
      strokeWidth="4"
      fill="none"
    />
  </svg>
);
