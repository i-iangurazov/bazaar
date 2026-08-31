// @vitest-environment jsdom

import React, { useEffect } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useForm } from "react-hook-form";

import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

type Values = { email: string };

const Fixture = ({ description = false, error = false }) => {
  const form = useForm<Values>({ defaultValues: { email: "" } });

  useEffect(() => {
    if (error) {
      form.setError("email", { type: "manual", message: "Invalid email" });
    }
  }, [error, form]);

  return (
    <Form {...form}>
      <FormField
        control={form.control}
        name="email"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Email</FormLabel>
            <FormControl>
              <Input {...field} />
            </FormControl>
            {description ? <FormDescription>Use a work address.</FormDescription> : null}
            <FormMessage />
          </FormItem>
        )}
      />
    </Form>
  );
};

const referencedElements = (control: HTMLElement) =>
  (control.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id));

describe("FormControl accessibility descriptions", () => {
  it("does not point at a missing description when no description or error renders", () => {
    render(<Fixture />);

    expect(screen.getByRole("textbox", { name: "Email" }).getAttribute("aria-describedby")).toBe(
      null,
    );
  });

  it("references the rendered field description", () => {
    render(<Fixture description />);

    const references = referencedElements(screen.getByRole("textbox", { name: "Email" }));
    expect(references).toHaveLength(1);
    expect(references[0]?.textContent).toBe("Use a work address.");
  });

  it("references only the rendered error when no description exists", async () => {
    render(<Fixture error />);
    await screen.findByText("Invalid email");

    const control = screen.getByRole("textbox", { name: "Email" });
    const references = referencedElements(control);
    expect(control.getAttribute("aria-invalid")).toBe("true");
    expect(references).toHaveLength(1);
    expect(references[0]?.textContent).toBe("Invalid email");
    expect(screen.getByRole("alert").getAttribute("aria-live")).toBe("assertive");
  });

  it("references both rendered description and error when both exist", async () => {
    render(<Fixture description error />);
    await screen.findByText("Invalid email");

    expect(
      referencedElements(screen.getByRole("textbox", { name: "Email" })).map(
        (element) => element?.textContent,
      ),
    ).toEqual(["Use a work address.", "Invalid email"]);
  });
});
