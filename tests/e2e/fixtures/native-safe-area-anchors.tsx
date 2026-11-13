/** Offline QA only: real shared primitives, synthetic content, no data/providers. */
import { createRoot } from "react-dom/client";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../../src/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "../../../src/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../src/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../../../src/components/ui/tooltip";

function Scene({ kind, edge }: { kind: string; edge: "left" | "right" }) {
  const trigger = <button id="anchor-trigger" className="h-11 border px-3">Synthetic {kind}</button>;
  const content = <span>Synthetic long menu label for the selected store</span>;
  return <div data-bazaar-app id="anchor-shell" className="fixed inset-x-0 top-24 flex" style={{ justifyContent: edge === "left" ? "flex-start" : "flex-end" }}>
    {kind === "dropdown" ? <DropdownMenu><DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent id="anchor-surface" align={edge === "left" ? "start" : "end"} collisionPadding={{ top: 12, bottom: 18, left: 16, right: 20 }}>
        <DropdownMenuItem>{content}</DropdownMenuItem>
      </DropdownMenuContent></DropdownMenu> : null}
    {kind === "popover" ? <Popover><PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent id="anchor-surface" align={edge === "left" ? "end" : "start"} collisionPadding={16}>{content}</PopoverContent>
    </Popover> : null}
    {kind === "select" ? <Select defaultValue="one"><SelectTrigger id="anchor-trigger" aria-label="Synthetic store" style={{ width: 256 }}><SelectValue /></SelectTrigger>
      <SelectContent id="anchor-surface" align={edge === "left" ? "end" : "start"} collisionPadding={{ top: 12, bottom: 18, left: 16, right: 20 }}>
        <SelectItem value="one">Synthetic store one</SelectItem><SelectItem value="two">Synthetic store two</SelectItem>
      </SelectContent></Select> : null}
    {kind === "tooltip" ? <TooltipProvider delayDuration={0}><Tooltip><TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent id="anchor-surface" side={edge} collisionPadding={16}>Synthetic price help</TooltipContent>
    </Tooltip></TooltipProvider> : null}
  </div>;
}

Object.assign(window, { fixtureMountAnchors: (kind: string, edge: "left" | "right") => {
  const container = document.createElement("div"); container.id = "react-anchor-fixture"; document.body.append(container);
  const root = createRoot(container); root.render(<Scene kind={kind} edge={edge} />);
  Object.assign(window, { fixtureReactRoot: root });
} });
