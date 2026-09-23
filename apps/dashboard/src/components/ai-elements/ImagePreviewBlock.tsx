// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * ImagePreviewBlock — base64 / URL image preview for message parts. The
 * thumbnail sits in a <details> summary; expanding reveals the full-size
 * image (progressive enhancement, no modal machinery needed).
 */
import { useLocale, t } from "@max/i18n"
import { cn } from "@/lib/utils"
import { imageSrcModel } from "./model"

export interface ImagePreviewBlockProps {
  /** Image URL, data URL, or passthrough { src | url } payload. */
  image: unknown
  alt?: string
  className?: string
}

export function ImagePreviewBlock({ image, alt, className }: ImagePreviewBlockProps) {
  useLocale()
  const { src } = imageSrcModel(image)

  if (!src) {
    return (
      <div
        role="img"
        aria-label={t("aiElements.image.unavailable")}
        className={cn(
          "flex items-center justify-center rounded-md border border-dashed border-border bg-muted/20 px-3 py-4 text-xs text-muted-foreground italic",
          className,
        )}
      >
        {t("aiElements.image.unavailable")}
      </div>
    )
  }

  return (
    <details className={cn("group rounded-md border border-border bg-muted/20 p-1.5", className)}>
      <summary className="cursor-pointer list-none">
        <img
          src={src}
          alt={alt ?? t("aiElements.image.ariaPreview")}
          className="max-h-40 max-w-full rounded object-contain"
          loading="lazy"
        />
        <span className="mt-1 block text-[10px] text-muted-foreground group-open:hidden">
          {t("aiElements.image.zoomHint")}
        </span>
      </summary>
      <img
        src={src}
        alt={alt ?? t("aiElements.image.ariaPreview")}
        className="mt-1.5 max-h-96 max-w-full rounded object-contain"
      />
    </details>
  )
}
