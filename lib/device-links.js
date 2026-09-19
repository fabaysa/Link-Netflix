const ALLOWED_HOSTS = new Set([
  "netflix.com",
  "www.netflix.com",
  "help.netflix.com"
]);

const DEFAULT_LINKS = {
  pc: "https://www.netflix.com/id/login",
  mobile: "https://www.netflix.com/id/login",
  tv: "https://www.netflix.com/tv8"
};

function safeNetflixUrl(value, fallback) {
  const candidate = String(value || "").trim() || fallback;

  try {
    const url = new URL(candidate);
    const host = url.hostname.toLowerCase();

    if (url.protocol !== "https:") return fallback;
    if (!ALLOWED_HOSTS.has(host)) return fallback;
    if (url.username || url.password) return fallback;

    const sensitive = /(?:nftoken|session(?:id|_id)?|access_token|refresh_token|auth_token|password|cookie)/i;
    if (sensitive.test(url.pathname) || sensitive.test(url.search) || sensitive.test(url.hash)) {
      return fallback;
    }

    return url.toString();
  } catch {
    return fallback;
  }
}

export function getPublicDeviceLinks() {
  return {
    pc: {
      key: "pc",
      label: "PC / Laptop",
      url: safeNetflixUrl(process.env.WEB_PC_ACCESS_URL, DEFAULT_LINKS.pc)
    },
    mobile: {
      key: "mobile",
      label: "HP / Mobile",
      url: safeNetflixUrl(process.env.WEB_MOBILE_ACCESS_URL, DEFAULT_LINKS.mobile)
    },
    tv: {
      key: "tv",
      label: "TV / Smart TV",
      url: safeNetflixUrl(process.env.WEB_TV_ACCESS_URL, DEFAULT_LINKS.tv)
    }
  };
}

export { safeNetflixUrl };
