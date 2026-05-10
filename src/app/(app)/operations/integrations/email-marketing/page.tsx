"use client";

import { useEffect, useMemo, useState } from "react";
import { CustomerSource, EmailCampaignFontFamily, EmailCampaignTemplate } from "@prisma/client";
import { useLocale, useTranslations } from "next-intl";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal, ModalFooter } from "@/components/ui/modal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/i18nFormat";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { cn } from "@/lib/utils";

const sourceValues = [
  CustomerSource.IMPORT,
  CustomerSource.ORDER,
  CustomerSource.MANUAL,
  CustomerSource.INTEGRATION,
];
const templateValues = [
  EmailCampaignTemplate.ANNOUNCEMENT,
  EmailCampaignTemplate.PROMOTION,
  EmailCampaignTemplate.NEW_ARRIVALS,
  EmailCampaignTemplate.SALE,
  EmailCampaignTemplate.CUSTOM,
];

const templatePreset = (template: EmailCampaignTemplate) => {
  switch (template) {
    case EmailCampaignTemplate.PROMOTION:
      return {
        heading: "Special offer",
        body: "A new promotion is available for our customers.",
        ctaLabel: "Shop now",
      };
    case EmailCampaignTemplate.NEW_ARRIVALS:
      return {
        heading: "New arrivals",
        body: "Fresh products are now available in store.",
        ctaLabel: "View products",
      };
    case EmailCampaignTemplate.SALE:
      return {
        heading: "Sale",
        body: "Selected products are available at reduced prices.",
        ctaLabel: "See sale",
      };
    case EmailCampaignTemplate.ANNOUNCEMENT:
      return {
        heading: "Announcement",
        body: "We have an update to share with you.",
        ctaLabel: "Learn more",
      };
    default:
      return { heading: "", body: "", ctaLabel: "" };
  }
};

const EmailMarketingPage = () => {
  const t = useTranslations("emailMarketingSettings");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const { toast } = useToast();
  const [storeId, setStoreId] = useState("");
  const [source, setSource] = useState<"ALL" | CustomerSource>("ALL");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [preheader, setPreheader] = useState("");
  const [template, setTemplate] = useState<EmailCampaignTemplate>(EmailCampaignTemplate.CUSTOM);
  const [heading, setHeading] = useState("");
  const [body, setBody] = useState("");
  const [ctaLabel, setCtaLabel] = useState("");
  const [ctaUrl, setCtaUrl] = useState("");
  const [footerText, setFooterText] = useState("");
  const [senderDisplayName, setSenderDisplayName] = useState("");
  const [replyToEmail, setReplyToEmail] = useState("");
  const [brandColor, setBrandColor] = useState("#111827");
  const [buttonColor, setButtonColor] = useState("#111827");
  const [fontFamily, setFontFamily] = useState<EmailCampaignFontFamily>(
    EmailCampaignFontFamily.INTER,
  );
  const [bannerImageUrl, setBannerImageUrl] = useState("");
  const [logoStoreId, setLogoStoreId] = useState("");
  const [uploadingLogoStoreId, setUploadingLogoStoreId] = useState<string | null>(null);

  const storesQuery = trpc.stores.list.useQuery();
  const stores = useMemo(() => storesQuery.data ?? [], [storesQuery.data]);
  useEffect(() => {
    if (!storeId && stores.length) {
      setStoreId(stores[0]?.id ?? "");
    }
  }, [storeId, stores]);
  useEffect(() => {
    if (storeId) {
      setLogoStoreId(storeId);
    }
  }, [storeId]);

  const campaignInput = useMemo(
    () => ({
      storeId,
      source,
      template,
      subject,
      preheader: preheader || null,
      heading: heading || null,
      body,
      ctaLabel: ctaLabel || null,
      ctaUrl: ctaUrl || null,
      footerText: footerText || null,
      senderDisplayName: senderDisplayName || null,
      replyToEmail: replyToEmail || null,
      brandColor,
      buttonColor,
      fontFamily,
      bannerImageUrl: bannerImageUrl || null,
      logoStoreId: logoStoreId || storeId || null,
    }),
    [
      bannerImageUrl,
      body,
      brandColor,
      buttonColor,
      ctaLabel,
      ctaUrl,
      fontFamily,
      footerText,
      heading,
      logoStoreId,
      preheader,
      replyToEmail,
      senderDisplayName,
      source,
      storeId,
      subject,
      template,
    ],
  );

  const overviewQuery = trpc.emailMarketing.overview.useQuery(
    { storeId, source },
    { enabled: Boolean(storeId) },
  );
  const previewQuery = trpc.emailMarketing.preview.useQuery(campaignInput, {
    enabled: Boolean(storeId && subject.trim() && body.trim()),
  });
  const historyQuery = trpc.emailMarketing.history.useQuery(
    { storeId, limit: 20 },
    { enabled: Boolean(storeId) },
  );
  const logoGalleryQuery = trpc.emailMarketing.logoGallery.useQuery();
  const utils = trpc.useUtils();
  const sendMutation = trpc.emailMarketing.send.useMutation({
    onSuccess: async (result) => {
      setConfirmOpen(false);
      await Promise.all([
        utils.emailMarketing.history.invalidate(),
        utils.emailMarketing.overview.invalidate(),
      ]);
      toast({
        variant: result.failed > 0 ? "error" : "success",
        description:
          result.queued
            ? t("messages.queued", { count: result.recipientCount })
            : result.failed > 0
            ? t("messages.partial", { sent: result.sent, failed: result.failed })
            : t("messages.sent", { count: result.sent }),
      });
    },
    onError: (error) => toast({ variant: "error", description: translateError(tErrors, error) }),
  });

  const applyTemplate = (value: EmailCampaignTemplate) => {
    setTemplate(value);
    const preset = templatePreset(value);
    if (value !== EmailCampaignTemplate.CUSTOM) {
      setHeading(preset.heading);
      setBody(preset.body);
      setCtaLabel(preset.ctaLabel);
    }
  };

  const handleLogoUpload = async (targetStoreId: string, file?: File | null) => {
    if (!file) {
      return;
    }
    setUploadingLogoStoreId(targetStoreId);
    const formData = new FormData();
    formData.append("storeId", targetStoreId);
    formData.append("file", file);

    try {
      const response = await fetch("/api/email-marketing/logo", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        throw new Error("logoUploadFailed");
      }
      await Promise.all([
        utils.emailMarketing.logoGallery.invalidate(),
        utils.emailMarketing.preview.invalidate(),
      ]);
      setLogoStoreId(targetStoreId);
      const storeName =
        (logoGalleryQuery.data ?? []).find((logo) => logo.storeId === targetStoreId)?.storeName ??
        stores.find((store) => store.id === targetStoreId)?.name ??
        "";
      toast({ variant: "success", description: t("messages.logoSaved", { store: storeName }) });
    } catch {
      toast({ variant: "error", description: t("messages.logoUploadFailed") });
    } finally {
      setUploadingLogoStoreId(null);
    }
  };

  const canSend =
    Boolean(storeId && subject.trim() && body.trim()) &&
    (previewQuery.data?.reachableCustomers ?? 0) > 0 &&
    overviewQuery.data?.config.ready;

  return (
    <div>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("audience.title")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("audience.store")}</Label>
                <Select value={storeId} onValueChange={setStoreId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("audience.storePlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {stores.map((store) => (
                      <SelectItem key={store.id} value={store.id}>
                        {store.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("audience.source")}</Label>
                <Select
                  value={source}
                  onValueChange={(value) => setSource(value as "ALL" | CustomerSource)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">{t("audience.allSources")}</SelectItem>
                    {sourceValues.map((value) => (
                      <SelectItem key={value} value={value}>
                        {t(`sources.${value.toLowerCase()}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-2">
                <Badge variant={overviewQuery.data?.config.ready ? "success" : "muted"}>
                  {overviewQuery.data?.config.ready ? t("status.ready") : t("status.notConfigured")}
                </Badge>
                <p className="mt-2 text-sm text-muted-foreground">
                  {t("audience.reachable", {
                    count:
                      previewQuery.data?.reachableCustomers ??
                      overviewQuery.data?.reachableCustomers ??
                      0,
                  })}
                </p>
                {!overviewQuery.data?.config.ready ? (
                  <p className="mt-1 text-xs text-danger">
                    {t("status.requiredFrom", {
                      from: overviewQuery.data?.config.requiredFrom ?? "no-reply@bazaar.kg",
                    })}
                  </p>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("composer.title")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>{t("composer.template")}</Label>
                <Select
                  value={template}
                  onValueChange={(value) => applyTemplate(value as EmailCampaignTemplate)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {templateValues.map((value) => (
                      <SelectItem key={value} value={value}>
                        {t(`templates.${value.toLowerCase()}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("composer.subject")}</Label>
                <Input value={subject} onChange={(event) => setSubject(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("composer.preheader")}</Label>
                <Input value={preheader} onChange={(event) => setPreheader(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("composer.heading")}</Label>
                <Input value={heading} onChange={(event) => setHeading(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("composer.body")}</Label>
                <Textarea value={body} onChange={(event) => setBody(event.target.value)} rows={8} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>{t("composer.ctaLabel")}</Label>
                  <Input value={ctaLabel} onChange={(event) => setCtaLabel(event.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("composer.ctaUrl")}</Label>
                  <Input value={ctaUrl} onChange={(event) => setCtaUrl(event.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>{t("composer.footer")}</Label>
                <Input value={footerText} onChange={(event) => setFooterText(event.target.value)} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("branding.title")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("branding.senderName")}</Label>
                <Input
                  value={senderDisplayName}
                  onChange={(event) => setSenderDisplayName(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("branding.replyTo")}</Label>
                <Input
                  value={replyToEmail}
                  onChange={(event) => setReplyToEmail(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("branding.brandColor")}</Label>
                <Input
                  type="color"
                  value={brandColor}
                  onChange={(event) => setBrandColor(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("branding.buttonColor")}</Label>
                <Input
                  type="color"
                  value={buttonColor}
                  onChange={(event) => setButtonColor(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("branding.font")}</Label>
                <Select
                  value={fontFamily}
                  onValueChange={(value) => setFontFamily(value as EmailCampaignFontFamily)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={EmailCampaignFontFamily.JOST}>
                      {t("branding.fontJost")}
                    </SelectItem>
                    <SelectItem value={EmailCampaignFontFamily.INTER}>
                      {t("branding.fontInter")}
                    </SelectItem>
                    <SelectItem value={EmailCampaignFontFamily.SYSTEM}>
                      {t("branding.fontSystem")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>{t("branding.bannerUrl")}</Label>
                <Input
                  value={bannerImageUrl}
                  onChange={(event) => setBannerImageUrl(event.target.value)}
                />
              </div>
              <div className="space-y-3 sm:col-span-2">
                <div>
                  <Label>{t("branding.logoGallery")}</Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("branding.logoGalleryHelp")}
                  </p>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  {logoGalleryQuery.isLoading ? (
                    <div className="border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                      {tCommon("loading")}
                    </div>
                  ) : null}
                  {(logoGalleryQuery.data ?? []).map((logo) => {
                    const isSelected = logoStoreId === logo.storeId;
                    const isUploading = uploadingLogoStoreId === logo.storeId;
                    return (
                      <div
                        key={logo.storeId}
                        className={cn(
                          "border bg-background p-3",
                          isSelected ? "border-primary" : "border-border",
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-foreground">
                              {logo.storeName}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {logo.logoUrl ? t("branding.logoReady") : t("branding.noLogo")}
                            </p>
                          </div>
                          <Badge variant={isSelected ? "success" : "muted"}>
                            {isSelected ? t("branding.selectedLogo") : t("branding.storeLogo")}
                          </Badge>
                        </div>
                        <div className="mt-3 flex h-28 items-center justify-center border border-border bg-muted/20 p-2">
                          {logo.logoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={logo.logoUrl}
                              alt={logo.storeName}
                              className="max-h-full max-w-full object-contain"
                            />
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {t("branding.noLogo")}
                            </span>
                          )}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant={isSelected ? "secondary" : "outline"}
                            disabled={!logo.logoUrl}
                            onClick={() => setLogoStoreId(logo.storeId)}
                          >
                            {isSelected ? t("branding.selectedLogo") : t("branding.selectLogo")}
                          </Button>
                          <label
                            className={cn(
                              "button-focus-ring inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-none border border-input bg-secondary px-3.5 text-sm font-semibold text-secondary-foreground shadow-sm transition hover:bg-secondary/80",
                              isUploading && "pointer-events-none opacity-50",
                            )}
                          >
                            {isUploading
                              ? t("branding.uploadingLogo")
                              : logo.logoUrl
                                ? t("branding.reuploadLogo")
                                : t("branding.uploadLogo")}
                            <input
                              type="file"
                              accept="image/*"
                              className="sr-only"
                              disabled={isUploading}
                              onChange={(event) => {
                                void handleLogoUpload(logo.storeId, event.currentTarget.files?.[0]);
                                event.currentTarget.value = "";
                              }}
                            />
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>{t("preview.title")}</CardTitle>
              <Button
                type="button"
                disabled={!canSend || sendMutation.isLoading}
                onClick={() => setConfirmOpen(true)}
              >
                {t("send.openConfirm")}
              </Button>
            </CardHeader>
            <CardContent>
              {previewQuery.data?.rendered.html ? (
                <div className="max-h-[720px] overflow-auto border border-border bg-white">
                  <div dangerouslySetInnerHTML={{ __html: previewQuery.data.rendered.html }} />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t("preview.empty")}</p>
              )}
              {previewQuery.error ? (
                <p className="mt-3 text-sm text-danger">
                  {translateError(tErrors, previewQuery.error)}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("history.title")}</CardTitle>
            </CardHeader>
            <CardContent>
              <TableContainer>
                <Table className="min-w-[680px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("history.subject")}</TableHead>
                      <TableHead>{t("history.status")}</TableHead>
                      <TableHead>{t("history.recipients")}</TableHead>
                      <TableHead>{t("history.createdAt")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(historyQuery.data ?? []).length ? (
                      (historyQuery.data ?? []).map((campaign) => (
                        <TableRow key={campaign.id}>
                          <TableCell className="font-medium">{campaign.subject}</TableCell>
                          <TableCell>
                            {t(`campaignStatus.${campaign.status.toLowerCase()}`)}
                          </TableCell>
                          <TableCell>{campaign.recipientCount}</TableCell>
                          <TableCell>{formatDateTime(campaign.createdAt, locale)}</TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell
                          colSpan={4}
                          className="py-10 text-center text-sm text-muted-foreground"
                        >
                          {historyQuery.isLoading ? tCommon("loading") : t("history.empty")}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </div>
      </div>

      <Modal
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("send.confirmTitle")}
        subtitle={t("send.confirmSubtitle")}
      >
        <div className="space-y-4">
          <div className="grid gap-2 text-sm">
            <p>{t("send.subject", { subject })}</p>
            <p>{t("send.audience", { count: previewQuery.data?.reachableCustomers ?? 0 })}</p>
            <p>
              {t("send.from", {
                from: overviewQuery.data?.config.requiredFrom ?? "no-reply@bazaar.kg",
              })}
            </p>
          </div>
          <ModalFooter>
            <Button type="button" variant="secondary" onClick={() => setConfirmOpen(false)}>
              {tCommon("cancel")}
            </Button>
            <Button
              type="button"
              disabled={!canSend || sendMutation.isLoading}
              onClick={() => sendMutation.mutate(campaignInput)}
            >
              {sendMutation.isLoading ? tCommon("loading") : t("send.confirm")}
            </Button>
          </ModalFooter>
        </div>
      </Modal>
    </div>
  );
};

export default EmailMarketingPage;
