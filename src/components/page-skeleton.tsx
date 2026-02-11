export const PageSkeleton = ({ blocks = 3 }: { blocks?: number }) => {
  const items = Array.from({ length: blocks });
  return (
    <div className="animate-pulse space-y-6">
      <div className="space-y-2">
        <div className="h-6 w-40 rounded-md bg-muted" />
        <div className="h-4 w-72 rounded-md bg-muted/70" />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {items.map((_, index) => (
          <div key={`block-${index}`} className="rounded-xl border border-border p-4">
            <div className="h-4 w-32 rounded-md bg-muted" />
            <div className="mt-3 space-y-2">
              <div className="h-3 w-full rounded-md bg-muted/70" />
              <div className="h-3 w-5/6 rounded-md bg-muted/70" />
              <div className="h-3 w-4/6 rounded-md bg-muted/70" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
