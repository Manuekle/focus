/** The same app artwork in marketing scenes and the product. */
export const APP_ICON_ASSETS = {
  whatsapp: "/logos/apps/tiles/whatsapp.webp",
  instagram: "/logos/apps/tiles/instagram.webp",
  meta: "/logos/apps/tiles/meta.webp",
  salesforce: "/logos/apps/tiles/salesforce.webp",
  googleCalendar: "/logos/apps/tiles/google-calendar.webp",
  hubspot: "/logos/apps/tiles/hubspot.webp",
  stripe: "/logos/apps/stripe-app.svg",
  phone: "/logos/apps/tiles/phone.png",
  messages: "/logos/apps/tiles/messages.png",
  contacts: "/logos/apps/tiles/contacts.png",
  maps: "/logos/apps/tiles/maps.png",
  // Pin artwork from Google's Maps product page: https://www.google.com/maps/about/
  googleMaps: "/logos/apps/google-maps.webp",
  safari: "/logos/apps/tiles/safari.webp",
  notes: "/logos/apps/tiles/notes.webp",
  facebook: "/logos/apps/tiles/facebook.webp",
  tiktok: "/logos/apps/tiles/tiktok.webp",
  mail: "/logos/apps/tiles/mail.webp",
  // Rounded tile: maps.png is a square, so it looks cut off next to the others.
  mapsTile: "/logos/apps/tiles/maps.webp",
  link: "/logos/apps/tiles/link.webp",
} as const;

export type AppIconBrand = keyof typeof APP_ICON_ASSETS;
