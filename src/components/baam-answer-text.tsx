"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { isBaamLink } from "@/lib/baam/companion";

// A deliberately small text format: no HTML, embedded media or provider-created
// destinations. Links are clickable only when supplied separately by the server.
export function BaamAnswerText({ text, links = [] }: { text: string; links?: string[] }) {
  const allowed = new Set(links.filter(isBaamLink));
  function inline(value: string): ReactNode[] {
    return value
      .split(/((?<!\\)\*\*[^*\n]+\*\*|(?<!\\)`[^`\n]+`|(?<!\\)\[[^\]\n]+\]\([^\s)]+\))/g)
      .map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**"))
          return (
            <strong key={i} className="font-semibold text-foreground">
              {part.slice(2, -2)}
            </strong>
          );
        if (part.startsWith("`") && part.endsWith("`"))
          return (
            <code key={i} className="rounded bg-muted px-1 py-0.5 text-[0.9em]">
              {part.slice(1, -1)}
            </code>
          );
        const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
        if (link)
          return allowed.has(link[2]) ? (
            <Link
              key={i}
              href={link[2]}
              prefetch={false}
              className="font-medium text-primary underline underline-offset-4"
            >
              {link[1]}
            </Link>
          ) : (
            link[1]
          );
        return part.replace(/\\([\\`*_[\]<>|])/g, "$1");
      });
  }
  return (
    <div className="space-y-3 break-words text-sm leading-6 [overflow-wrap:anywhere]">
      {text
        .split(/\n\s*\n/)
        .filter(Boolean)
        .map((block, i) => {
          const lines = block.split("\n");
          const cells = (line: string) =>
            line
              .trim()
              .replace(/^\||(?<!\\)\|$/g, "")
              .split(/(?<!\\)\|/)
              .map((cell) => cell.trim());
          if (
            lines.length >= 3 &&
            cells(lines[1]).length > 1 &&
            cells(lines[1]).every((cell) => /^:?-{3,}:?$/.test(cell))
          ) {
            const headers = cells(lines[0]);
            return (
              <div
                key={i}
                className="max-w-full overflow-x-auto rounded-lg border border-border"
                tabIndex={0}
              >
                <table className="w-full border-collapse text-left text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      {headers.map((cell, n) => (
                        <th key={n} scope="col" className="border-b px-3 py-2 font-medium">
                          {inline(cell)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lines.slice(2).map((line, n) => (
                      <tr key={n} className="border-b last:border-0">
                        {cells(line)
                          .slice(0, headers.length)
                          .map((cell, j) => (
                            <td key={j} className="px-3 py-2 align-top">
                              {inline(cell)}
                            </td>
                          ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }
          if (lines.every((line) => /^\s*\d+[.)]\s+/.test(line)))
            return (
              <ol key={i} className="list-decimal space-y-2 pl-5">
                {lines.map((line, n) => (
                  <li key={n}>{inline(line.replace(/^\s*\d+[.)]\s+/, ""))}</li>
                ))}
              </ol>
            );
          if (lines.every((line) => /^\s*[-*•]\s+/.test(line)))
            return (
              <ul key={i} className="list-disc space-y-2 pl-5">
                {lines.map((line, n) => (
                  <li key={n}>{inline(line.replace(/^\s*[-*•]\s+/, ""))}</li>
                ))}
              </ul>
            );
          if (/^#{1,4}\s+/.test(block) && lines.length === 1)
            return (
              <h3 key={i} className="pt-1 text-base font-semibold">
                {inline(block.replace(/^#{1,4}\s+/, ""))}
              </h3>
            );
          return (
            <p key={i} className="whitespace-pre-wrap">
              {inline(block)}
            </p>
          );
        })}
    </div>
  );
}
