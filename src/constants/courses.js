/**
 * Canonical Corizo course catalog.
 * Used by seed and can be referenced for docs.
 */
export const CORIZO_COURSES = [
  { name: 'Web Development', category: 'Technology', sortOrder: 1 },
  { name: 'Android Development', category: 'Technology', sortOrder: 2 },
  { name: 'Cyber Security', category: 'Technology', sortOrder: 3 },
  { name: 'Artificial Intelligence', category: 'Technology', sortOrder: 4 },
  { name: 'Data Science', category: 'Technology', sortOrder: 5 },
  { name: 'Machine Learning', category: 'Technology', sortOrder: 6 },
  { name: 'IoT & Robotics', category: 'Technology', sortOrder: 7 },
  { name: 'Cloud Computing', category: 'Technology', sortOrder: 8 },
  { name: 'Embedded System', category: 'Technology', sortOrder: 9 },
  { name: 'DSA', category: 'Technology', sortOrder: 10 },

  { name: 'Hybrid & Electric Vehicles', category: 'Automotive', sortOrder: 11 },
  { name: 'Auto CAD', category: 'Automotive', sortOrder: 12 },

  { name: 'Digital Marketing', category: 'Business', sortOrder: 13 },
  { name: 'Finance', category: 'Business', sortOrder: 14 },
  { name: 'Human Resource', category: 'Business', sortOrder: 15 },
  { name: 'Stock Market', category: 'Business', sortOrder: 16 },
  { name: 'Business Analytics', category: 'Business', sortOrder: 17 },
  { name: 'Corporate Law', category: 'Business', sortOrder: 18 },

  { name: 'Genetics Engineering / Nanotechnology', category: 'Healthcare & Sciences', sortOrder: 19 },
  { name: 'Psychology', category: 'Healthcare & Sciences', sortOrder: 20 },
  { name: 'Medical Coding', category: 'Healthcare & Sciences', sortOrder: 21 },
  { name: 'Neurology', category: 'Healthcare & Sciences', sortOrder: 22 },

  { name: 'UI/UX Design', category: 'Design', sortOrder: 23 },
  { name: 'Graphic Design', category: 'Design', sortOrder: 24 },
  { name: 'Fashion Designing', category: 'Design', sortOrder: 25 },

  { name: 'AR VR', category: 'Emerging Tech', sortOrder: 26 },
  { name: 'Drone Engineering', category: 'Emerging Tech', sortOrder: 27 },
  { name: 'Robot Engineering', category: 'Emerging Tech', sortOrder: 28 },
  { name: 'Career Advancement Program', category: 'Emerging Tech', sortOrder: 29 },

  { name: 'Advanced Digital Marketing Program', category: 'Advanced Programs', sortOrder: 30 },
  { name: 'Advanced Data Science Program', category: 'Advanced Programs', sortOrder: 31 },
];

export const courseCodeFromName = (name) =>
  name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);
