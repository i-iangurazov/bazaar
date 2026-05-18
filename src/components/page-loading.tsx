import { Spinner } from "@/components/ui/spinner";

export const PageLoading = () => {
  return (
    <>
      <div className="md:hidden" data-mobile-loading-skeleton>
        <div className="space-y-4 px-1 py-2">
          <div className="h-20 animate-pulse rounded-md border border-border bg-card shadow-sm" />
          <div className="grid grid-cols-2 gap-3">
            <div className="h-24 animate-pulse rounded-md border border-border bg-card shadow-sm" />
            <div className="h-24 animate-pulse rounded-md border border-border bg-card shadow-sm" />
          </div>
          <div className="space-y-2">
            <div className="h-16 animate-pulse rounded-md border border-border bg-card shadow-sm" />
            <div className="h-16 animate-pulse rounded-md border border-border bg-card shadow-sm" />
            <div className="h-16 animate-pulse rounded-md border border-border bg-card shadow-sm" />
          </div>
        </div>
      </div>
      <DesktopPageLoading />
    </>
  );
};

export const DesktopPageLoading = () => {
  return (
    <div className="hidden min-h-[40vh] items-center justify-center md:flex">
      <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-card shadow-sm">
        <Spinner className="h-4 w-4 text-muted-foreground" />
      </div>
    </div>
  );
};
