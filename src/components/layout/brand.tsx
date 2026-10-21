/* eslint-disable @next/next/no-img-element */
import { Activity } from "lucide-react";

/** Configurable logo; neutral placeholder when none is configured (no official emblems bundled). */
export function BrandMark({ logoUrl, size = 40 }: { logoUrl?: string; size?: number }) {
  if (logoUrl) {
    return <img src={logoUrl} alt="Logo" width={size} height={size} className="rounded object-contain" style={{ width: size, height: size }} />;
  }
  return (
    <div
      className="flex items-center justify-center rounded-md bg-white/10 text-white ring-1 ring-white/20"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <Activity className="h-1/2 w-1/2" />
    </div>
  );
}
