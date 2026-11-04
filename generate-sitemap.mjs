import fs from "fs";
import path from "path";

const baseUrl = "https://freellm.hasit.in";
const lastmod = new Date().toISOString().split("T")[0];

// Public routes that should be indexed
const publicRoutes = [
  { url: "/", changefreq: "weekly", priority: 1.0 },
  { url: "/providers", changefreq: "weekly", priority: 0.9 },
  { url: "/models", changefreq: "daily", priority: 0.8 },
  { url: "/developers", changefreq: "monthly", priority: 0.7 },
  { url: "/login", changefreq: "monthly", priority: 0.5 },
];

function generateSitemap() {
  const urls = publicRoutes.map(route => `  <url>
    <loc>${baseUrl}${route.url}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${route.changefreq}</changefreq>
    <priority>${route.priority}</priority>
  </url>`).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
}

const sitemap = generateSitemap();
const outputPath = path.join("public", "sitemap.xml");
fs.writeFileSync(outputPath, sitemap);
console.log("Generated sitemap.xml at", outputPath);
