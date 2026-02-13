"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { z } from "zod";

import { LanguageSwitcher } from "@/components/language-switcher";
import { FormStack } from "@/components/form-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/components/ui/toast";
import { translateError } from "@/lib/translateError";

const RegisterBusinessPage = () => {
  const params = useParams();
  const token = String(params?.token ?? "");
  const t = useTranslations("registerBusiness");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const { toast } = useToast();
  const [submitted, setSubmitted] = useState(false);
  const [needsEmailVerification, setNeedsEmailVerification] = useState(false);
  const [values, setValues] = useState<{
    orgName: string;
    storeName: string;
    storeCode: string;
    legalEntityType?: "IP" | "OSOO" | "AO" | "OTHER";
    legalName?: string;
    inn?: string;
    address?: string;
    phone?: string;
  }>({
    orgName: "",
    storeName: "",
    storeCode: "",
    legalEntityType: undefined,
    legalName: "",
    inn: "",
    address: "",
    phone: "",
  });
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<"orgName" | "storeName" | "storeCode" | "legalEntityType" | "legalName" | "inn" | "address" | "phone", string>>
  >({});

  const schema = z.object({
    orgName: z.string().min(2, t("orgRequired")),
    storeName: z.string().min(2, t("storeRequired")),
    storeCode: z.string().min(2, t("storeCodeRequired")),
    legalEntityType: z.enum(["IP", "OSOO", "AO", "OTHER"]).optional(),
    legalName: z.string().optional(),
    inn: z.string().optional(),
    address: z.string().optional(),
    phone: z.string().optional(),
  });

  const mutation = trpc.publicAuth.registerBusiness.useMutation({
    onSuccess: (result) => {
      setNeedsEmailVerification(Boolean(result.requiresEmailVerification));
      setSubmitted(true);
      toast({
        variant: "success",
        description: result.requiresEmailVerification ? t("verifyHintAfterRegistration") : t("success"),
      });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      const nextErrors: Partial<
        Record<"orgName" | "storeName" | "storeCode" | "legalEntityType" | "legalName" | "inn" | "address" | "phone", string>
      > = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (
          typeof key === "string" &&
          (key === "orgName" ||
            key === "storeName" ||
            key === "storeCode" ||
            key === "legalEntityType" ||
            key === "legalName" ||
            key === "inn" ||
            key === "address" ||
            key === "phone")
        ) {
          nextErrors[key] = issue.message;
        }
      }
      setFieldErrors(nextErrors);
      return;
    }
    setFieldErrors({});
    mutation.mutate({ token, ...parsed.data });
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-4 py-8 sm:py-12">
      <div className="flex justify-end">
        <LanguageSwitcher />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {submitted ? (
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>{needsEmailVerification ? t("submittedVerify") : t("submitted")}</p>
              <Link href="/login" className="text-sm font-semibold text-primary hover:text-primary/80">
                {t("goToLogin")}
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <FormStack>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-foreground" htmlFor="register-org-name">
                    {t("orgName")}
                  </label>
                  <Input
                    id="register-org-name"
                    placeholder={t("orgPlaceholder")}
                    value={values.orgName}
                    onChange={(event) => {
                      const next = event.target.value;
                      setValues((prev) => ({ ...prev, orgName: next }));
                      if (fieldErrors.orgName) {
                        setFieldErrors((prev) => ({ ...prev, orgName: undefined }));
                      }
                    }}
                  />
                  {fieldErrors.orgName ? <p className="text-xs font-medium text-danger">{fieldErrors.orgName}</p> : null}
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-foreground" htmlFor="register-store-name">
                    {t("storeName")}
                  </label>
                  <Input
                    id="register-store-name"
                    placeholder={t("storePlaceholder")}
                    value={values.storeName}
                    onChange={(event) => {
                      const next = event.target.value;
                      setValues((prev) => ({ ...prev, storeName: next }));
                      if (fieldErrors.storeName) {
                        setFieldErrors((prev) => ({ ...prev, storeName: undefined }));
                      }
                    }}
                  />
                  {fieldErrors.storeName ? (
                    <p className="text-xs font-medium text-danger">{fieldErrors.storeName}</p>
                  ) : null}
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-foreground" htmlFor="register-store-code">
                    {t("storeCode")}
                  </label>
                  <Input
                    id="register-store-code"
                    placeholder={t("storeCodePlaceholder")}
                    value={values.storeCode}
                    onChange={(event) => {
                      const next = event.target.value;
                      setValues((prev) => ({ ...prev, storeCode: next }));
                      if (fieldErrors.storeCode) {
                        setFieldErrors((prev) => ({ ...prev, storeCode: undefined }));
                      }
                    }}
                  />
                  {fieldErrors.storeCode ? (
                    <p className="text-xs font-medium text-danger">{fieldErrors.storeCode}</p>
                  ) : null}
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-foreground">{t("legalEntityType")}</label>
                  <Select
                    value={values.legalEntityType}
                    onValueChange={(value) => {
                      setValues((prev) => ({ ...prev, legalEntityType: value as "IP" | "OSOO" | "AO" | "OTHER" }));
                      if (fieldErrors.legalEntityType) {
                        setFieldErrors((prev) => ({ ...prev, legalEntityType: undefined }));
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("selectLegalEntityType")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="IP">{t("legalEntityTypes.IP")}</SelectItem>
                      <SelectItem value="OSOO">{t("legalEntityTypes.OSOO")}</SelectItem>
                      <SelectItem value="AO">{t("legalEntityTypes.AO")}</SelectItem>
                      <SelectItem value="OTHER">{t("legalEntityTypes.OTHER")}</SelectItem>
                    </SelectContent>
                  </Select>
                  {fieldErrors.legalEntityType ? (
                    <p className="text-xs font-medium text-danger">{fieldErrors.legalEntityType}</p>
                  ) : null}
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-foreground" htmlFor="register-legal-name">
                    {t("legalName")}
                  </label>
                  <Input
                    id="register-legal-name"
                    placeholder={t("legalNamePlaceholder")}
                    value={values.legalName ?? ""}
                    onChange={(event) => {
                      const next = event.target.value;
                      setValues((prev) => ({ ...prev, legalName: next }));
                      if (fieldErrors.legalName) {
                        setFieldErrors((prev) => ({ ...prev, legalName: undefined }));
                      }
                    }}
                  />
                  {fieldErrors.legalName ? (
                    <p className="text-xs font-medium text-danger">{fieldErrors.legalName}</p>
                  ) : null}
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-foreground" htmlFor="register-inn">
                    {t("inn")}
                  </label>
                  <Input
                    id="register-inn"
                    placeholder={t("innPlaceholder")}
                    value={values.inn ?? ""}
                    onChange={(event) => {
                      const next = event.target.value;
                      setValues((prev) => ({ ...prev, inn: next }));
                      if (fieldErrors.inn) {
                        setFieldErrors((prev) => ({ ...prev, inn: undefined }));
                      }
                    }}
                  />
                  {fieldErrors.inn ? <p className="text-xs font-medium text-danger">{fieldErrors.inn}</p> : null}
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-foreground" htmlFor="register-phone">
                    {t("phone")}
                  </label>
                  <Input
                    id="register-phone"
                    placeholder={t("phonePlaceholder")}
                    value={values.phone ?? ""}
                    onChange={(event) => {
                      const next = event.target.value;
                      setValues((prev) => ({ ...prev, phone: next }));
                      if (fieldErrors.phone) {
                        setFieldErrors((prev) => ({ ...prev, phone: undefined }));
                      }
                    }}
                  />
                  {fieldErrors.phone ? <p className="text-xs font-medium text-danger">{fieldErrors.phone}</p> : null}
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-foreground" htmlFor="register-address">
                    {t("address")}
                  </label>
                  <Input
                    id="register-address"
                    placeholder={t("addressPlaceholder")}
                    value={values.address ?? ""}
                    onChange={(event) => {
                      const next = event.target.value;
                      setValues((prev) => ({ ...prev, address: next }));
                      if (fieldErrors.address) {
                        setFieldErrors((prev) => ({ ...prev, address: undefined }));
                      }
                    }}
                  />
                  {fieldErrors.address ? <p className="text-xs font-medium text-danger">{fieldErrors.address}</p> : null}
                </div>
                <Button type="submit" className="w-full" disabled={mutation.isLoading}>
                  {mutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
                  {mutation.isLoading ? tCommon("loading") : t("submit")}
                </Button>
              </FormStack>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default RegisterBusinessPage;
