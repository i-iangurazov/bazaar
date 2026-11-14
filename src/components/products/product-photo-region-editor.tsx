"use client";

import { useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { validProductPhotoRegion, type ProductPhotoRegion } from "@/lib/productPhotoSearch";

export function ProductPhotoRegionEditor({ image, dimensions, initial, onApply, onCancel }: {
  image: string; dimensions: { width: number; height: number }; initial: ProductPhotoRegion | null;
  onApply: (region: ProductPhotoRegion) => void; onCancel: () => void;
}) {
  const t = useTranslations("productPhotoSearch");
  const common = useTranslations("common");
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const initialAspect = initial ? initial.width * dimensions.width / (initial.height * dimensions.height) : 1;
  const [aspect, setAspect] = useState(Math.max(0.3, Math.min(3, initialAspect)));
  const [region, setRegion] = useState<ProductPhotoRegion | null>(null);
  const complete = (area: Area) => setRegion({ x: area.x / 100, y: area.y / 100, width: area.width / 100, height: area.height / 100 });
  return <section className="space-y-4 p-4 sm:p-5" aria-label={t("cropTitle")}>
    <div><h3 className="font-semibold">{t("cropTitle")}</h3><p className="mt-1 text-sm text-muted-foreground">{t("cropHelp")}</p></div>
    <div className="relative h-[38vh] min-h-60 overflow-hidden rounded-xl bg-black/80">
      <Cropper image={image} crop={crop} zoom={zoom} aspect={aspect} minZoom={1} maxZoom={5} objectFit="contain"
        cropperProps={{ "aria-label": t("cropTitle") }}
        onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={complete}
        initialCroppedAreaPercentages={initial ? { x: initial.x * 100, y: initial.y * 100, width: initial.width * 100, height: initial.height * 100 } : undefined} />
    </div>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="space-y-2 text-sm"><span>{t("cropZoom")}</span>
        <input className="block w-full accent-primary" type="range" min={1} max={5} step={0.05} value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
      </label>
      <label className="space-y-2 text-sm"><span>{t("cropShape")}</span>
        <input className="block w-full accent-primary" type="range" min={0.3} max={3} step={0.05} value={aspect} onChange={(event) => setAspect(Number(event.target.value))} />
      </label>
    </div>
    <div className="flex justify-end gap-2">
      <Button type="button" variant="outline" onClick={onCancel}>{common("cancel")}</Button>
      <Button type="button" disabled={!validProductPhotoRegion(region)} onClick={() => { if (validProductPhotoRegion(region)) onApply(region); }}>{t("applyRegion")}</Button>
    </div>
  </section>;
}
