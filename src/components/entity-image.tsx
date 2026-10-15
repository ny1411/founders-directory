"use client"

import Image, { type ImageProps } from "next/image"
import { Building2, UserRound } from "lucide-react"
import { useState } from "react"

import { normalizeImageUrl } from "@/lib/image-url"
import { cn } from "@/lib/utils"

type EntityImageProps = Omit<ImageProps, "src" | "onError"> & {
  src?: string | null
  fallback: "company" | "person"
  fallbackLabel: string
}

function ImageFallback({
  fallback,
  label,
  className,
  width,
  height,
}: Pick<EntityImageProps, "fallback" | "className" | "width" | "height"> & { label: string }) {
  const Icon = fallback === "company" ? Building2 : UserRound

  return (
    <span
      role="img"
      aria-label={label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center bg-secondary text-muted-foreground",
        className,
      )}
      style={{ width, height }}
    >
      <Icon aria-hidden="true" className="h-2/5 w-2/5" />
    </span>
  )
}

function LoadableImage({ fallback, fallbackLabel, alt, ...props }: EntityImageProps & { src: string }) {
  const [failed, setFailed] = useState(false)

  if (failed) {
    return (
      <ImageFallback
        fallback={fallback}
        label={fallbackLabel}
        className={props.className}
        width={props.width}
        height={props.height}
      />
    )
  }

  return <Image {...props} alt={alt} onError={() => setFailed(true)} />
}

export function EntityImage({ src, fallback, fallbackLabel, ...props }: EntityImageProps) {
  const normalizedSrc = normalizeImageUrl(src)

  if (!normalizedSrc) {
    return (
      <ImageFallback
        fallback={fallback}
        label={fallbackLabel}
        className={props.className}
        width={props.width}
        height={props.height}
      />
    )
  }

  return (
    <LoadableImage
      key={normalizedSrc}
      {...props}
      src={normalizedSrc}
      fallback={fallback}
      fallbackLabel={fallbackLabel}
    />
  )
}
