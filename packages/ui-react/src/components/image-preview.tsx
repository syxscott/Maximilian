import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import { cn } from "../lib/utils.js"

export interface ImagePreviewProps {
  src: string
  alt?: string
}

export function ImagePreview({
  src,
  alt = "Image preview",
  children,
}: ImagePreviewProps & { children?: React.ReactNode }) {
  return (
    <DialogPrimitive.Root>
      {children}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          data-slot="image-preview-overlay"
          className="fixed inset-0 z-50 bg-black/70 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        />
        <div data-component="image-preview">
          <div data-slot="image-preview-container">
            <DialogPrimitive.Content
              data-slot="image-preview-content"
              className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 outline-none"
            >
              <div data-slot="image-preview-header" className="flex justify-end">
                <DialogPrimitive.Close
                  data-slot="image-preview-close"
                  aria-label="Close"
                  className={cn(
                    "inline-flex h-8 w-8 items-center justify-center rounded-md",
                    "opacity-70 transition-opacity hover:opacity-100",
                    "focus:outline-none focus:ring-2 focus:ring-ring",
                  )}
                >
                  <X className="h-4 w-4" />
                </DialogPrimitive.Close>
              </div>
              <div data-slot="image-preview-body">
                <img
                  src={src}
                  alt={alt}
                  data-slot="image-preview-image"
                  className="max-h-[85vh] max-w-[85vw] rounded-md object-contain"
                />
              </div>
            </DialogPrimitive.Content>
          </div>
        </div>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}