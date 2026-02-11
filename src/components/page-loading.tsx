import { Spinner } from "@/components/ui/spinner";

export const PageLoading = () => {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card shadow-sm">
        <Spinner className="h-4 w-4 text-muted-foreground" />
      </div>
    </div>
  );
};
