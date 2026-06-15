export const PageLoading = () => {
  return (
    <>
      <div className="md:hidden" data-mobile-loading-skeleton>
        <div className="space-y-4 px-1 py-2">
          <div className="h-24 animate-pulse rounded-xl border border-border/70 bg-card shadow-sm" />
          <div className="grid grid-cols-2 gap-3">
            <div className="h-24 animate-pulse rounded-xl border border-border/70 bg-card shadow-sm" />
            <div className="h-24 animate-pulse rounded-xl border border-border/70 bg-card shadow-sm" />
          </div>
          <div className="space-y-2">
            <div className="h-16 animate-pulse rounded-xl border border-border/70 bg-card shadow-sm" />
            <div className="h-16 animate-pulse rounded-xl border border-border/70 bg-card shadow-sm" />
            <div className="h-16 animate-pulse rounded-xl border border-border/70 bg-card shadow-sm" />
          </div>
        </div>
      </div>
      <DesktopPageLoading />
    </>
  );
};

export const DesktopPageLoading = () => {
  return (
    <div className="hidden min-h-[40vh] md:block">
      <div className="space-y-5">
        <div className="h-32 animate-pulse rounded-xl border border-border/70 bg-card shadow-sm" />
        <div className="grid gap-4 xl:grid-cols-4">
          <div className="h-32 animate-pulse rounded-xl border border-border/70 bg-card shadow-sm" />
          <div className="h-32 animate-pulse rounded-xl border border-border/70 bg-card shadow-sm" />
          <div className="h-32 animate-pulse rounded-xl border border-border/70 bg-card shadow-sm" />
          <div className="h-32 animate-pulse rounded-xl border border-border/70 bg-card shadow-sm" />
        </div>
        <div className="h-80 animate-pulse rounded-xl border border-border/70 bg-card shadow-sm" />
      </div>
    </div>
  );
};
