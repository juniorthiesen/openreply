import type { MetadataRoute } from "next";

// Lets a self-hosted instance be installed to the home screen: on iOS via
// Share -> "Add to Home Screen", on Android through the install prompt. It then
// opens standalone, without browser chrome, which makes checking campaigns from
// a phone practical.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FISGA",
    short_name: "FISGA",
    description: "Campanhas, publicações e métricas para Instagram",
    start_url: "/overview",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F6F4EF",
    theme_color: "#F6F4EF",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
