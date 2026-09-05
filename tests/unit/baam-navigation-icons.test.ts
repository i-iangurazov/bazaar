import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { IconProps } from "@phosphor-icons/react";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import * as icons from "@/components/icons";

// Read metadata only. Do not import AppShell, route handlers or operational pages.
const load = (path: string) =>
  ts.createSourceFile(
    path,
    readFileSync(resolve(process.cwd(), path), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
const shell = load("src/components/app-shell.tsx");
const all = <T extends ts.Node>(node: ts.Node, predicate: (node: ts.Node) => node is T): T[] => {
  const matches: T[] = [];
  const visit = (current: ts.Node) => {
    if (predicate(current)) matches.push(current);
    ts.forEachChild(current, visit);
  };
  visit(node);
  return matches;
};
const property = (node: ts.ObjectLiteralExpression, name: string) => {
  const value = node.properties.find(
    (prop) =>
      ts.isPropertyAssignment(prop) &&
      (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) &&
      prop.name.text === name,
  );
  return value && ts.isPropertyAssignment(value) ? value.initializer : undefined;
};
const text = (node: ts.Node | undefined) =>
  node && (ts.isStringLiteral(node) || ts.isIdentifier(node)) ? node.text : undefined;
const declaration = (source: ts.SourceFile, name: string) => {
  const matches = all(source, ts.isVariableDeclaration).filter((node) => text(node.name) === name);
  if (matches.length !== 1 || !matches[0].initializer)
    throw new Error(`Expected one initialized ${name} in ${source.fileName}`);
  return matches[0].initializer;
};
const imports = (source: ts.SourceFile) => {
  const result = new Map<string, { module: string; exported: string }>();
  for (const node of source.statements) {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) continue;
    const bindings = node.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings))
      for (const entry of bindings.elements) {
        result.set(entry.name.text, {
          module: node.moduleSpecifier.text,
          exported: entry.propertyName?.text ?? entry.name.text,
        });
      }
  }
  return result;
};
type IconEntry = { item: string; exported: keyof typeof icons };
const iconEntry = (source: ts.SourceFile, reference: string, item: string): IconEntry => {
  const imported = imports(source).get(reference);
  if (imported?.module !== "@/components/icons" || !(imported.exported in icons)) {
    throw new Error(`${item}: ${reference} must resolve to an actual icon barrel export`);
  }
  return { item, exported: imported.exported as keyof typeof icons };
};
const namedJsx = (node: ts.Node) =>
  ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node);
const primaryIcon = (source: ts.SourceFile, node: ts.Node, item: string): IconEntry | undefined => {
  // Footer profile chevrons are navigation affordances, not destination identity.
  // The first actual icon in each action is its leading identity glyph.
  for (const tag of all(node, namedJsx)) {
    if (!ts.isIdentifier(tag.tagName)) continue;
    const imported = imports(source).get(tag.tagName.text);
    if (imported?.module === "@/components/icons") return iconEntry(source, tag.tagName.text, item);
  }
};
const arrayFromMemo = (node: ts.Expression): ts.ArrayLiteralExpression => {
  if (ts.isParenthesizedExpression(node)) return arrayFromMemo(node.expression);
  if (ts.isArrayLiteralExpression(node)) return node;
  if (ts.isCallExpression(node)) {
    const callback = node.arguments[0];
    if (callback && ts.isArrowFunction(callback) && !ts.isBlock(callback.body))
      return arrayFromMemo(callback.body);
  }
  throw new Error("Navigation metadata must resolve to the actual array literal");
};
const sidebarEntries = () => {
  const entries: IconEntry[] = [];
  const visitItems = (value: ts.Expression | undefined) => {
    if (!value || !ts.isArrayLiteralExpression(value))
      throw new Error("Missing navigation item array");
    for (const node of value.elements) {
      if (!ts.isObjectLiteralExpression(node)) throw new Error("Unresolved navigation item");
      const key = text(property(node, "key"));
      const icon = text(property(node, "icon"));
      if (!key || !icon)
        throw new Error("Every sidebar item, including parents, needs an identifiable icon");
      entries.push(iconEntry(shell, icon, key));
      const children = property(node, "children");
      if (children) visitItems(children);
    }
  };
  for (const group of arrayFromMemo(declaration(shell, "navGroups")).elements) {
    if (!ts.isObjectLiteralExpression(group)) throw new Error("Unresolved navigation group");
    visitItems(property(group, "items"));
  }

  for (const header of all(shell, ts.isJsxElement).filter(
    (node) => node.openingElement.tagName.getText(shell) === "SidebarHeader",
  )) {
    for (const tag of all(header, namedJsx)) {
      if (!ts.isIdentifier(tag.tagName)) continue;
      if (imports(shell).get(tag.tagName.text)?.module === "@/components/icons") {
        entries.push(iconEntry(shell, tag.tagName.text, `header:${tag.tagName.text}`));
      }
    }
  }

  const footers = all(shell, ts.isJsxElement).filter(
    (node) => node.openingElement.tagName.getText(shell) === "SidebarFooter",
  );
  if (footers.length !== 1) throw new Error("Expected the rendered sidebar footer");
  const footer = footers[0];
  for (const call of all(footer, ts.isCallExpression)) {
    if (!ts.isIdentifier(call.expression) || !call.expression.text.startsWith("render")) continue;
    const icon = primaryIcon(
      shell,
      declaration(shell, call.expression.text),
      `footer:${call.expression.text}`,
    );
    // A conditional verification notice has no leading icon and contributes none.
    if (icon) entries.push(icon);
  }
  for (const node of all(footer, ts.isJsxSelfClosingElement)) {
    if (!ts.isIdentifier(node.tagName)) continue;
    const imported = imports(shell).get(node.tagName.text);
    if (!imported) continue;
    if (imported.module === "@/components/icons") {
      entries.push(iconEntry(shell, node.tagName.text, `footer:${node.tagName.text}`));
      continue;
    }
    if (!imported.module.startsWith("@/components/"))
      throw new Error("Unresolved footer component");
    const source = load(`${imported.module.replace("@/", "src/")}.tsx`);
    const icon = primaryIcon(
      source,
      declaration(source, imported.exported),
      `footer:${node.tagName.text}`,
    );
    if (!icon) throw new Error(`No primary glyph found for footer component ${node.tagName.text}`);
    entries.push(icon);
  }
  return entries;
};

const geometry = ({ exported }: IconEntry) => {
  const icon = icons[exported] as ComponentType<IconProps>;
  // Normalize weight and styling so aliases cannot become "unique" merely by
  // differing names, classes, colors or regular/duotone defaults.
  const svg = renderToStaticMarkup(createElement(icon, { weight: "regular", size: 24 }));
  const shapes = [
    ...svg.matchAll(/<(path|rect|circle|ellipse|line|polyline|polygon|g)\b([^>]*)>/g),
  ].map((match) => {
    const attributes = [...match[2].matchAll(/([\w:-]+)="([^"]*)"/g)]
      .filter((attribute) =>
        /^(?:d|x|y|x1|x2|y1|y2|cx|cy|r|rx|ry|width|height|points|transform)$/.test(attribute[1]),
      )
      .map((attribute) => [attribute[1], attribute[2].replace(/\s+/g, " ").trim()])
      .sort(([a], [b]) => a.localeCompare(b));
    return [match[1], attributes];
  });
  if (!shapes.length) throw new Error(`${exported} rendered no SVG geometry`);
  return JSON.stringify(shapes);
};
const objectIcon = (source: ts.SourceFile, propertyName: string, key: string) => {
  const objects = all(source, ts.isObjectLiteralExpression).filter(
    (node) => text(property(node, propertyName)) === key,
  );
  if (objects.length !== 1) throw new Error(`Expected one metadata object for ${key}`);
  const reference = text(property(objects[0], "icon"));
  if (!reference) throw new Error(`Missing icon for ${key}`);
  return iconEntry(source, reference, key);
};

describe("BAAM and left navigation icon identity", () => {
  it("gives every sidebar destination, nested parent/child, header and footer action distinct rendered geometry", () => {
    const entries = sidebarEntries();
    expect(entries.length).toBeGreaterThan(30);
    expect(new Set(entries.map((entry) => entry.item)).size).toBe(entries.length);
    expect(
      entries.filter((entry) => entry.item.startsWith("footer:")).length,
    ).toBeGreaterThanOrEqual(3);
    const byGeometry = new Map<string, string[]>();
    for (const entry of entries) {
      const shape = geometry(entry);
      byGeometry.set(shape, [
        ...(byGeometry.get(shape) ?? []),
        `${entry.item} (${entry.exported})`,
      ]);
    }
    const duplicates = [...byGeometry.values()].filter((items) => items.length > 1);
    expect(duplicates, "Different component aliases with the same SVG glyph still collide").toEqual(
      [],
    );
  });

  it("uses the same BAAM glyph in the sidebar, mobile menu, command palette and circular launcher", () => {
    const desktop = objectIcon(shell, "key", "baam");
    const mobile = objectIcon(shell, "key", "mobile-baam");
    const palette = objectIcon(load("src/components/command-palette.tsx"), "id", "open-baam");
    const launcher = load(resolve(dirname(shell.fileName), "baam-launcher.tsx"));
    const buttons = all(launcher, ts.isJsxElement).filter((node) =>
      node.openingElement.attributes.properties.some(
        (attribute) =>
          ts.isJsxAttribute(attribute) && attribute.name.getText(launcher) === "data-baam-launcher",
      ),
    );
    expect(buttons.length).toBeGreaterThan(0);
    const launcherIcons = buttons.map((button) => {
      const icon = primaryIcon(launcher, button, "launcher");
      if (!icon) throw new Error("Launcher button has no primary icon");
      return icon;
    });
    for (const entry of [mobile, palette, ...launcherIcons])
      expect(geometry(entry)).toBe(geometry(desktop));
  });
});
