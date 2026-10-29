import { Bot } from "lucide-react";

export function BaamIcon({ className, size = 24 }: { className?: string; size?: number | string }) {
  return <Bot size={size} strokeWidth={1.6} className={className} aria-hidden="true" />;
}
