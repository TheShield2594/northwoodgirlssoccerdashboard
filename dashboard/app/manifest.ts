import type { MetadataRoute } from "next";

/**
 * Web app manifest — lets the dashboard be added to a phone home screen
 * and opened fullscreen, which is the common case here (checking a score
 * from the stands rather than browsing to it).
 *
 * `background_color` matches --paper and `theme_color` matches the
 * masthead, so the splash and the OS chrome line up with the light
 * edition. Android picks the maskable icon for adaptive launchers; iOS
 * ignores this file and uses app/apple-icon.png instead.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NorthWood Panthers — Girls Soccer",
    short_name: "NW Soccer",
    description:
      "Season stats, schedule, player leaders, and program history for NorthWood girls soccer (Varsity & JV).",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#f4f4f4",
    theme_color: "#0d0d0d",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
