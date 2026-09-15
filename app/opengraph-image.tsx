import { ImageResponse } from "next/og";
import { siteConfig } from "@/lib/site-config";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          backgroundColor: "#FAFAF8",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 28, height: 28, borderRadius: 6, backgroundColor: "#1F6E54" }} />
          <div style={{ fontSize: 28, fontWeight: 600, color: "#14171A" }}>{siteConfig.name}</div>
        </div>
        <div
          style={{
            marginTop: 40,
            fontSize: 56,
            fontWeight: 600,
            color: "#14171A",
            maxWidth: 900,
            lineHeight: 1.15,
          }}
        >
          {siteConfig.tagline}
        </div>
      </div>
    ),
    { ...size }
  );
}
