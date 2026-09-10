export const MarketingIcon = ({
  name = "arrow",
  className,
}: {
  name?:
    | "arrow"
    | "check"
    | "chart"
    | "box"
    | "store"
    | "receipt"
    | "people"
    | "search"
    | "close"
    | "menu"
    | "plus";
  className?: string;
}) => (
  <svg
    className={className}
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {name === "arrow" && <path d="M4 12h15m-6-6 6 6-6 6" />}
    {name === "check" && <path d="m5 12 4 4L19 6" />}
    {name === "chart" && <path d="M4 4v16h16M8 15v-4m5 4V7m5 8V4" />}
    {name === "box" && <path d="m12 3 9 5-9 5-9-5 9-5Zm-9 5v9l9 5 9-5V8M12 13v9M7.5 5.5l9 5" />}
    {name === "store" && (
      <path d="M4 10v10h16V10M3 10l2-7h14l2 7M3 10c0 4 6 4 6 0 0 4 6 4 6 0 0 4 6 4 6 0M9 20v-6h6v6" />
    )}
    {name === "receipt" && <path d="M5 3h14v18l-3-2-4 2-4-2-3 2V3Zm4 5h6m-6 4h6m-6 4h3" />}
    {name === "people" && (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v2" />
      </>
    )}
    {name === "search" && (
      <>
        <circle cx="10" cy="10" r="6" />
        <path d="m15 15 5 5" />
      </>
    )}
    {name === "close" && <path d="m6 6 12 12M6 18 18 6" />}
    {name === "menu" && <path d="M4 8h16M4 16h16" />}
    {name === "plus" && <path d="M12 5v14M5 12h14" />}
  </svg>
);
