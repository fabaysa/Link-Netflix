/**
 * Parser for target bot replies (Netflix Token Generator Bot)
 */

export function parseBotReply(resultOrText) {
  let text = "";
  let urlButtons = [];

  if (typeof resultOrText === "string") {
    text = resultOrText.trim();
  } else if (resultOrText && typeof resultOrText === "object") {
    const messages = Array.isArray(resultOrText.messages) ? resultOrText.messages : [];
    text = messages.map(m => m.text || "").filter(Boolean).join("\n\n").trim();
    if (!text && resultOrText.sourceText) {
      text = String(resultOrText.sourceText).trim();
    }
    for (const msg of messages) {
      for (const row of msg.urlButtons || []) {
        for (const btn of row || []) {
          if (btn?.url && btn?.text) {
            urlButtons.push({ text: btn.text, url: btn.url });
          }
        }
      }
    }
  }

  // Check for Cookie Expired / Invalid error
  const isCookieError = /cookie\s+(?:sudah\s+)?(?:expired|kadaluwarsa|tidak\s+valid)/i.test(text) ||
    /ambil\s+cookie\s+(?:baru|fresh)/i.test(text);

  if (isCookieError) {
    const causes = [];
    const bulletMatches = text.match(/[•\-\*]\s*([^\n\r]+)/g);
    if (bulletMatches) {
      for (const b of bulletMatches) {
        causes.push(b.replace(/^[•\-\*]\s*/, "").trim());
      }
    } else {
      causes.push("Cookie sudah expired");
      causes.push("Cookie tidak valid");
      causes.push("Perlu login Netflix lagi");
    }

    return {
      type: "cookie_expired",
      success: false,
      title: "⚠️ Cookie expired atau tidak valid. Silakan ambil cookie baru.",
      description: "Cookies Netflix yang Anda kirimkan tidak dapat digunakan untuk generate link login.",
      causes: causes.length ? causes : [
        "Cookie sudah expired",
        "Cookie tidak valid",
        "Perlu login Netflix lagi"
      ],
      suggestion: "Ambil cookie fresh dari akun Netflix Anda dan coba lagi.",
      rawText: text
    };
  }

  // Check for Success NFT Token response
  const isSuccess = /(?:nft|netflix)\s+token\s+berhasil\s+digenerate/i.test(text) ||
    /nftoken=/i.test(text) ||
    urlButtons.some(b => /nftoken=/i.test(b.url));

  if (isSuccess) {
    // Extract devices
    const devices = [];

    // PC / Laptop URL
    let pcUrl = "";
    const pcMatch = text.match(/(?:🖥️|pc\s*\/\s*laptop|pc|laptop)[:\s]*\n*(https?:\/\/[^\s]+)/i);
    if (pcMatch) {
      pcUrl = pcMatch[1].trim();
    }

    // HP / Mobile URL
    let mobileUrl = "";
    const mobileMatch = text.match(/(?:📱|hp\s*\/\s*mobile|hp|mobile|android|ios)[:\s]*\n*(https?:\/\/[^\s]+)/i);
    if (mobileMatch) {
      mobileUrl = mobileMatch[1].trim();
    }

    // TV / Smart TV URL
    let tvUrl = "";
    const tvMatch = text.match(/(?:📺|tv\s*\/\s*smart\s*tv|tv|smart\s*tv)[:\s]*\n*(https?:\/\/[^\s]+)/i);
    if (tvMatch) {
      tvUrl = tvMatch[1].trim();
    }

    // Fallback URL extraction based on url path patterns if any device url was missed
    const allUrls = Array.from(text.matchAll(/(https?:\/\/[^\s\)\>]+)/g)).map(m => m[1]);
    for (const b of urlButtons) {
      if (!allUrls.includes(b.url)) allUrls.push(b.url);
    }

    for (const url of allUrls) {
      if (!url.includes("nftoken=")) continue;
      if (!mobileUrl && /unsupported/i.test(url)) {
        mobileUrl = url;
      } else if (!tvUrl && /\/tv/i.test(url)) {
        tvUrl = url;
      } else if (!pcUrl && !/unsupported/i.test(url) && !/\/tv/i.test(url)) {
        pcUrl = url;
      }
    }

    if (pcUrl) {
      devices.push({
        id: "pc",
        label: "PC / Laptop",
        icon: "🖥️",
        url: pcUrl
      });
    }

    if (mobileUrl) {
      devices.push({
        id: "mobile",
        label: "HP / Mobile",
        icon: "📱",
        url: mobileUrl
      });
    }

    if (tvUrl) {
      devices.push({
        id: "tv",
        label: "TV / Smart TV",
        icon: "📺",
        url: tvUrl
      });
    }

    // Extract Expired timestamp
    let expired = null;
    const expiredMatch = text.match(/(?:⏰\s*)?Expired:\s*([0-9]{4}-[0-9]{2}-[0-9]{2}\s+[0-9]{2}:[0-9]{2}:[0-9]{2})/i);
    if (expiredMatch) {
      expired = expiredMatch[1].trim();
    } else {
      const expLoose = text.match(/(?:⏰\s*)?Expired:\s*([^\n\r]+)/i);
      if (expLoose) expired = expLoose[1].trim();
    }

    // Extract Instructions & Notes
    const notes = [];
    const noteMatches = text.match(/(?:⚠️|💡)[^\n\r]+/g);
    if (noteMatches) {
      for (const n of noteMatches) {
        const clean = n.trim();
        if (clean) notes.push(clean);
      }
    } else {
      notes.push("⚠️ Penting: Pake link sebelum expired ya!");
      notes.push("⚠️ Cara pakenya tinggal klik link/copy paste lalu tempel di browser nanti otomatis login");
      notes.push("💡 Kalo udah expired, generate lagi aja.");
    }

    return {
      type: "success",
      success: true,
      title: "✅ NFT Token Berhasil Digenerate!",
      devices,
      expired,
      notes,
      rawText: text
    };
  }

  // Generic reply
  return {
    type: "generic",
    success: false,
    title: "Balasan dari Bot",
    rawText: text || "(Tidak ada teks balasan dari bot tujuan)",
    buttons: urlButtons
  };
}
