// Schutz vor KI-Training: maschinenlesbarer Nutzungsvorbehalt (§ 44b Abs. 3 UrhG / Art. 4 DSM-Richtlinie).
// Wird beim Build als robots.txt, ai.txt und .well-known/tdmrep.json ausgegeben + Meta-Tags in jeder Seite.
// Wirkt nur bei Bots, die sich an Regeln halten (die großen Firmen tun das) – harte Sperre: Cloudflare (s. CLAUDE.md).

// Crawler, die Inhalte für KI-Training sammeln (Stand Ende 2026). Normale Suchmaschinen bleiben erlaubt.
export const AI_BOTS = [
  'GPTBot',              // OpenAI – Training
  'ClaudeBot',           // Anthropic
  'anthropic-ai',        // Anthropic (älter)
  'Google-Extended',     // Google – Gemini/KI-Training (Google-Suche bleibt unberührt)
  'Applebot-Extended',   // Apple – KI-Training (Apple-Suche bleibt unberührt)
  'CCBot',               // Common Crawl – Grundlage vieler Trainingsdatensätze
  'Meta-ExternalAgent',  // Meta – KI-Training
  'FacebookBot',
  'Bytespider',          // ByteDance/TikTok
  'Amazonbot',
  'PerplexityBot',
  'cohere-ai',
  'cohere-training-data-crawler',
  'Diffbot',
  'Omgilibot',
  'ImagesiftBot',        // Bild-Datensätze
  'Timpibot',
  'DeepSeekBot',
  'AI2Bot',
  'Ai2Bot-Dolma',
  'PanguBot',
  'YouBot',
];

export function robotsTxt() {
  return `# Nutzungsvorbehalt: Keine Verwendung der Inhalte (insbesondere Fotos & Videos) für Text- und Data-Mining
# oder das Training von KI-Systemen (§ 44b Abs. 3 UrhG, Art. 4 Abs. 3 Richtlinie (EU) 2019/790).

${AI_BOTS.map(b => `User-agent: ${b}`).join('\n')}
Disallow: /

User-agent: *
Allow: /
`;
}

// Spawning „ai.txt" – von einigen Bild-Datensatz-Werkzeugen ausgewertet
export function aiTxt() {
  return `# Keine Verwendung für KI-Training.
User-Agent: *
Disallow: /
Disallow: *.jpg
Disallow: *.jpeg
Disallow: *.png
Disallow: *.webp
Disallow: *.gif
Disallow: *.mp4
Disallow: *.webm
`;
}

// W3C TDM Reservation Protocol
export const tdmrepJson = () => JSON.stringify([{ location: '/', 'tdm-reservation': 1 }], null, 2) + '\n';

// Meta-Tags für jede Seite (funktionieren auch, wenn die Seite nicht im Domain-Stamm liegt)
export const AI_META = `<meta name="tdm-reservation" content="1">
<meta name="robots" content="noai, noimageai">`;
