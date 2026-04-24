// api/ical-proxy.js
// Vercel serverless function — proxies iCal feed requests to avoid CORS errors.
// The browser can't directly fetch iCloud calendar URLs due to CORS restrictions,
// so we route the request through this server-side function instead.

export default async function handler(req, res) {
  // Allow requests from your app only
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  const { url } = req.query;

  if (!url) {
    res.status(400).json({ error: "Missing url parameter" });
    return;
  }

  // Only allow iCloud and common calendar domains for security
  const allowed = [
    "p-calendar.icloud.com",
    "calendar.icloud.com",
    "calendar.google.com",
    "outlook.live.com",
    "outlook.office365.com",
    "p02-caldav.icloud.com",
    "p03-caldav.icloud.com",
    "p04-caldav.icloud.com",
    "p05-caldav.icloud.com",
    "p06-caldav.icloud.com",
    "p07-caldav.icloud.com",
    "p08-caldav.icloud.com",
    "p09-caldav.icloud.com",
    "p10-caldav.icloud.com",
  ];

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    res.status(400).json({ error: "Invalid URL" });
    return;
  }

  const isAllowed = allowed.some(domain => parsedUrl.hostname.endsWith(domain));
  if (!isAllowed) {
    res.status(403).json({ error: `Domain ${parsedUrl.hostname} is not allowed. Only iCloud and major calendar providers are supported.` });
    return;
  }

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "FamPlan/1.0 (Calendar Sync)",
        "Accept": "text/calendar, */*",
      },
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });

    if (!response.ok) {
      res.status(response.status).json({ error: `Calendar server returned ${response.status}` });
      return;
    }

    const text = await response.text();

    // Make sure it looks like an iCal file
    if (!text.includes("BEGIN:VCALENDAR")) {
      res.status(400).json({ error: "URL did not return a valid iCal file. Make sure you have enabled Public Calendar sharing." });
      return;
    }

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.status(200).send(text);

  } catch (err) {
    if (err.name === "TimeoutError") {
      res.status(504).json({ error: "Request timed out. The calendar server took too long to respond." });
    } else {
      res.status(500).json({ error: `Failed to fetch calendar: ${err.message}` });
    }
  }
}
