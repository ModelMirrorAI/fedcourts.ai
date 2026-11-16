import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://fedcourts.ai",
  // The subscribe pages are redirect targets marked noindex, so the sitemap leaves them out.
  integrations: [mdx(), sitemap({ filter: (page) => !page.includes("/subscribe/") })],
  build: { format: "directory" },
});
