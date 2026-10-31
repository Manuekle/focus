/** Ready-made school settings in `public/backgrounds/`, offered next to the generated, scene and uploaded backgrounds. */
export const BACKGROUND_PRESETS = [
  { id: "classroom", name: "Classroom", fileName: "classroom.webp", alt: "An empty classroom with wooden desks, a green chalkboard and sunlight through windows onto a cherry tree" },
  { id: "hallway", name: "Hallway", fileName: "hallway.webp", alt: "A bright school hallway with tall windows, a notice board and double doors at the end" },
  { id: "library", name: "Library", fileName: "library.webp", alt: "A school library with wooden bookshelves, reading tables and large windows onto a cherry tree" },
  { id: "rooftop", name: "Rooftop", fileName: "rooftop.webp", alt: "A school rooftop with a chain-link fence, a stairwell door and a blue sky with clouds" },
  { id: "school-entrance", name: "School entrance", fileName: "school-entrance.webp", alt: "A school courtyard with cherry trees in bloom leading to the main entrance" },
  { id: "street", name: "Street", fileName: "street.webp", alt: "A quiet residential street at sunset, with a school wall and power lines" },
  { id: "bedroom", name: "Bedroom", fileName: "bedroom.webp", alt: "A bedroom with a desk, a bookshelf, a bed and sunlight through the window" },
] as const;
export type BackgroundPreset = (typeof BACKGROUND_PRESETS)[number];
export const backgroundPresetUrl = (preset: BackgroundPreset) => `/backgrounds/${preset.fileName}`;
