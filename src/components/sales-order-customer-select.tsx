"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";

import { ChevronDownIcon } from "@/components/icons";
import { QueryErrorState } from "@/components/query-error-state";
import { SearchInput } from "@/components/search-input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { isValidOptionalCustomerPhone } from "@/lib/customerContact";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";

export type SalesOrderCustomerOption = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
};

export function SalesOrderCustomerSelect({
  storeId,
  customerId,
  customerName,
  disabled = false,
  createDefaultOpen = false,
  onSelect,
}: {
  storeId: string;
  customerId: string | null;
  customerName: string;
  disabled?: boolean;
  createDefaultOpen?: boolean;
  onSelect: (customer: SalesOrderCustomerOption | null) => void;
}) {
  const t = useTranslations("salesOrders");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const { data: session } = useSession();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(createDefaultOpen);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  const canCreateCustomer =
    session?.user?.role === "ADMIN" || session?.user?.role === "MANAGER";

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setOpen(false);
    setSearch("");
    setDebouncedSearch("");
    setCreateOpen(false);
    setName("");
    setEmail("");
    setPhone("");
    setAddress("");
    setFieldError(null);
  }, [storeId]);

  const query = trpc.salesOrders.customerOptions.useQuery(
    { storeId, search: debouncedSearch || undefined, limit: 25 },
    { enabled: open && Boolean(storeId) && !disabled, keepPreviousData: false },
  );

  const createMutation = trpc.customers.create.useMutation({
    onSuccess: (result) => {
      const customer = result.customer;
      toast({
        variant: "success",
        description:
          result.action === "created" ? t("customerCreated") : t("customerMatched"),
      });
      setCreateOpen(false);
      setName("");
      setEmail("");
      setPhone("");
      setAddress("");
      setFieldError(null);
      choose({
        id: customer.id,
        name: customer.name,
        email: customer.email ?? null,
        phone: customer.phone ?? null,
        address: customer.address ?? null,
      });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const choose = (customer: SalesOrderCustomerOption | null) => {
    onSelect(customer);
    setOpen(false);
    setSearch("");
    setDebouncedSearch("");
  };

  const submitNewCustomer = () => {
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const trimmedPhone = phone.trim();
    if (trimmedName.length < 1) {
      setFieldError(t("customerNameRequired"));
      return;
    }
    if (!trimmedEmail && !trimmedPhone) {
      setFieldError(t("customerContactRequired"));
      return;
    }
    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setFieldError(t("customerEmailInvalid"));
      return;
    }
    if (trimmedPhone && !isValidOptionalCustomerPhone(trimmedPhone)) {
      setFieldError(t("customerPhoneInvalid"));
      return;
    }
    setFieldError(null);
    createMutation.mutate({
      storeId,
      name: trimmedName,
      email: trimmedEmail || null,
      phone: trimmedPhone || null,
      address: address.trim() || null,
    });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="secondary"
            className="w-full justify-between gap-2"
            disabled={disabled || !storeId}
            aria-label={t("selectCustomer")}
          >
            <span className="min-w-0 truncate">
              {customerId ? customerName || t("selectedCustomer") : t("selectCustomer")}
            </span>
            <ChevronDownIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          </Button>
        </DialogTrigger>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>{t("selectCustomer")}</DialogTitle>
            <DialogDescription>{t("customerSelectionHint")}</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <SearchInput
              value={search}
              onValueChange={setSearch}
              maxLength={120}
              aria-label={t("customerSearch")}
              placeholder={t("customerSearch")}
            />
            {canCreateCustomer ? (
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                onClick={() => setCreateOpen(true)}
                data-testid="sales-order-new-customer"
              >
                {t("createCustomer")}
              </Button>
            ) : null}
            {query.isLoading || search.trim() !== debouncedSearch ? (
              <div className="flex justify-center py-5" role="status" aria-label={tCommon("loading")}>
                <Spinner />
              </div>
            ) : query.error ? (
              <QueryErrorState error={query.error} onRetry={() => void query.refetch()} />
            ) : query.data?.length ? (
              <div className="space-y-1" data-testid="sales-order-customer-results">
                {query.data.map((customer) => (
                  <Button
                    key={customer.id}
                    type="button"
                    variant="ghost"
                    className="h-auto min-h-12 w-full justify-start px-3 py-3 text-left"
                    onClick={() => choose(customer)}
                  >
                    <span className="min-w-0 space-y-1">
                      <span className="block truncate font-medium">{customer.name}</span>
                      {customer.phone || customer.email ? (
                        <span className="block truncate text-xs font-normal text-muted-foreground">
                          {customer.phone || customer.email}
                        </span>
                      ) : null}
                    </span>
                  </Button>
                ))}
              </div>
            ) : (
              <div className="space-y-2 py-3 text-center">
                <p className="text-sm text-muted-foreground">{t("noCustomerMatches")}</p>
                {canCreateCustomer && search.trim() ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setName(search.trim());
                      setCreateOpen(true);
                    }}
                  >
                    {t("createCustomerNamed", { name: search.trim() })}
                  </Button>
                ) : null}
              </div>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => choose(null)}>
              {t("withoutCustomerCard")}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {tCommon("cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={createOpen}
        onOpenChange={(value) => {
          if (createMutation.isLoading) return;
          setCreateOpen(value);
          if (!value) setFieldError(null);
        }}
      >
        <DialogContent size="md" showClose={!createMutation.isLoading}>
          <DialogHeader>
            <DialogTitle>{t("createCustomerTitle")}</DialogTitle>
            <DialogDescription>{t("createCustomerDescription")}</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-order-customer-name">{t("customerName")}</Label>
              <Input
                id="new-order-customer-name"
                value={name}
                maxLength={180}
                autoFocus
                aria-invalid={fieldError === t("customerNameRequired")}
                aria-describedby={
                  fieldError === t("customerNameRequired")
                    ? "new-order-customer-name-error"
                    : undefined
                }
                className={
                  fieldError === t("customerNameRequired")
                    ? "border-danger focus:border-danger"
                    : undefined
                }
                onChange={(event) => setName(event.target.value)}
              />
              {fieldError === t("customerNameRequired") ? (
                <p id="new-order-customer-name-error" role="alert" className="text-sm text-danger">
                  {fieldError}
                </p>
              ) : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="new-order-customer-phone">{t("customerPhone")}</Label>
                <Input
                  id="new-order-customer-phone"
                  value={phone}
                  inputMode="tel"
                  maxLength={64}
                  placeholder={t("customerPhoneExample")}
                  aria-invalid={
                    fieldError === t("customerPhoneInvalid") ||
                    fieldError === t("customerContactRequired")
                  }
                  aria-describedby={
                    fieldError === t("customerPhoneInvalid") ||
                    fieldError === t("customerContactRequired")
                      ? "new-order-customer-contact-error"
                      : undefined
                  }
                  className={
                    fieldError === t("customerPhoneInvalid") ||
                    fieldError === t("customerContactRequired")
                      ? "border-danger focus:border-danger"
                      : undefined
                  }
                  onChange={(event) => setPhone(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-order-customer-email">{t("customerEmail")}</Label>
                <Input
                  id="new-order-customer-email"
                  value={email}
                  type="email"
                  maxLength={254}
                  aria-invalid={
                    fieldError === t("customerEmailInvalid") ||
                    fieldError === t("customerContactRequired")
                  }
                  aria-describedby={
                    fieldError === t("customerEmailInvalid") ||
                    fieldError === t("customerContactRequired")
                      ? "new-order-customer-contact-error"
                      : undefined
                  }
                  className={
                    fieldError === t("customerEmailInvalid") ||
                    fieldError === t("customerContactRequired")
                      ? "border-danger focus:border-danger"
                      : undefined
                  }
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
            </div>
            {fieldError && fieldError !== t("customerNameRequired") ? (
              <p
                id="new-order-customer-contact-error"
                role="alert"
                className="text-sm text-danger"
              >
                {fieldError}
              </p>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="new-order-customer-address">{t("customerAddress")}</Label>
              <Input
                id="new-order-customer-address"
                value={address}
                maxLength={512}
                onChange={(event) => setAddress(event.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">{t("createCustomerContactHint")}</p>
            {createMutation.error ? (
              <p role="alert" className="text-sm text-danger">
                {translateError(tErrors, createMutation.error)}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={createMutation.isLoading}
              onClick={() => setCreateOpen(false)}
            >
              {tCommon("cancel")}
            </Button>
            <Button type="button" disabled={createMutation.isLoading} onClick={submitNewCustomer}>
              {createMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
              {t("createCustomerSubmit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
