import React from "react";

import { PageHeader } from "@/components/page-header";

type DynamicResourceTerminalStateProps = {
  title: string;
  message: string;
};

export const DynamicResourceTerminalState = ({
  title,
  message,
}: DynamicResourceTerminalStateProps) => (
  <div data-dynamic-resource-terminal>
    <PageHeader title={title} subtitle={message} />
    <div
      role="alert"
      className="mt-4 rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger"
    >
      {message}
    </div>
  </div>
);
