// src/infrastructure/utils/systemOfMedicineHelper.js

export const VALID_SYSTEMS_OF_MEDICINE = [
  'Modern Medicine',
  'Homeopathy',
  'Ayurveda',
  'Dentistry',
  'Psychology',
];

/**
 * Normalizes system of medicine strings and common aliases.
 * E.g., 'allopathy' -> 'Modern Medicine', 'modern medicine' -> 'Modern Medicine'
 */
export function normalizeSystemOfMedicine(system) {
  if (!system || typeof system !== 'string') return null;
  const trimmed = system.trim().toLowerCase();

  if (trimmed === 'allopathy' || trimmed === 'modern medicine') {
    return 'Modern Medicine';
  }
  if (trimmed === 'homeopathy' || trimmed === 'homoeopathy') {
    return 'Homeopathy';
  }
  if (trimmed === 'ayurveda' || trimmed === 'ayush') {
    return 'Ayurveda';
  }
  if (trimmed === 'dentistry' || trimmed === 'dental') {
    return 'Dentistry';
  }
  if (trimmed === 'psychology' || trimmed === 'mental health') {
    return 'Psychology';
  }

  // Exact match case-insensitive fallback against known values
  const match = VALID_SYSTEMS_OF_MEDICINE.find(
    (s) => s.toLowerCase() === trimmed
  );
  return match || null;
}

/**
 * Intelligently deduces the System of Medicine based on degrees.
 * Handles critical edge cases:
 * - Doctors entering only "MD" or "MS" without MBBS -> maps to "Modern Medicine"
 * - Homeopathy higher degrees like "MD (Homeopathy)" -> maps to "Homeopathy"
 * - Ayurveda higher degrees like "MD (Ayurveda)" -> maps to "Ayurveda"
 * - Dentistry degrees (BDS, MDS) -> maps to "Dentistry"
 * - Psychology degrees (Psy.D, M.Phil, M.Sc Psychology) -> maps to "Psychology"
 */
export function deduceSystemOfMedicine(qualifications, currentSystem = null) {
  const normalizedCurrent = normalizeSystemOfMedicine(currentSystem);

  // If qualifications are not provided or empty, return the normalized current or default
  if (!qualifications || !Array.isArray(qualifications) || qualifications.length === 0) {
    return normalizedCurrent || 'Modern Medicine';
  }

  // Extract all degree text into a searchable list
  const degreeStrings = qualifications
    .map((q) => {
      if (!q) return '';
      if (typeof q === 'string') return q;
      return q.degree || q.name || q.title || '';
    })
    .filter(Boolean);

  if (degreeStrings.length === 0) {
    return normalizedCurrent || 'Modern Medicine';
  }

  // Check each degree string for strong distinctive markers
  // We prioritize specific systems first before broader modern medicine markers
  for (const deg of degreeStrings) {
    const d = deg.trim().toLowerCase();

    // 1. Homeopathy check
    if (
      /\b(bhms|dhms)\b/i.test(d) ||
      d.includes('homeo') ||
      d.includes('homoeo')
    ) {
      return 'Homeopathy';
    }

    // 2. Ayurveda check
    if (
      /\b(bams|bums|bsms)\b/i.test(d) ||
      d.includes('ayur') ||
      d.includes('panchakarma')
    ) {
      return 'Ayurveda';
    }

    // 3. Dentistry check
    if (
      /\b(bds|mds|dds|dmd)\b/i.test(d) ||
      d.includes('dental') ||
      d.includes('dentistry')
    ) {
      return 'Dentistry';
    }

    // 4. Psychology check
    if (
      /\b(psy\.?d|psyd)\b/i.test(d) ||
      d.includes('psycholog') ||
      d.includes('psychotherapy') ||
      (/\bm\.?phil\b/i.test(d) && d.includes('psych')) ||
      (/\bm\.?sc\b/i.test(d) && d.includes('psych')) ||
      (/\bb\.?sc\b/i.test(d) && d.includes('psych')) ||
      (/\bm\.?a\b/i.test(d) && d.includes('psych')) ||
      (/\bb\.?a\b/i.test(d) && d.includes('psych'))
    ) {
      return 'Psychology';
    }

    // 5. Modern Medicine (Allopathy) check
    // Edge case: "MD", "MS", "MBBS", "DNB", "DM", "MCh", "MRCP", "FRCS", "FCPS"
    // Since Homeopathy and Ayurveda were checked above, any plain MD, MS, etc. is Modern Medicine.
    if (
      /\b(mbbs|dnb|mch|dm|mrcp|frcs|fcps)\b/i.test(d) ||
      /\b(md|ms)\b/i.test(d) ||
      d.includes('medicine') ||
      d.includes('surgery') ||
      d.includes('pediatric') ||
      d.includes('gynec') ||
      d.includes('ortho') ||
      d.includes('cardio')
    ) {
      return 'Modern Medicine';
    }
  }

  // If no degree rule triggered, fallback to normalized current or 'Modern Medicine'
  return normalizedCurrent || 'Modern Medicine';
}

/**
 * Extracts and formats a primary qualification string from a doctor's qualifications array.
 * E.g., [{degree: 'MBBS'}, {degree: 'MD General Medicine'}] -> "MBBS, MD"
 * E.g., [{degree: 'MD'}] -> "MD"
 * E.g., [{degree: 'BDS'}, {degree: 'MDS'}] -> "BDS, MDS"
 */
export function extractPrimaryQualifications(qualifications) {
  if (!qualifications) return '';
  if (typeof qualifications === 'string') return qualifications.trim();
  if (!Array.isArray(qualifications) || qualifications.length === 0) return '';

  const cleanedDegrees = qualifications
    .map((q) => {
      if (!q) return '';
      const raw = typeof q === 'string' ? q : q.degree || q.name || '';
      return raw.trim();
    })
    .filter(Boolean);

  if (cleanedDegrees.length === 0) return '';

  // Extract short acronyms if available (e.g., "MD General Medicine" -> "MD")
  const standardAcronyms = [
    'MBBS', 'MD', 'MS', 'DNB', 'DM', 'MCh', 'MRCP', 'FRCS',
    'BDS', 'MDS',
    'BHMS', 'DHMS',
    'BAMS',
    'Psy.D', 'Ph.D', 'M.Phil'
  ];

  const simplified = [];
  for (const deg of cleanedDegrees) {
    let matched = null;
    for (const acr of standardAcronyms) {
      const regex = new RegExp(`\\b${acr.replace('.', '\\.')}\\b`, 'i');
      if (regex.test(deg)) {
        matched = acr;
        break;
      }
    }
    if (matched && !simplified.includes(matched)) {
      simplified.push(matched);
    } else if (!matched && !simplified.includes(deg)) {
      simplified.push(deg);
    }
  }

  return simplified.slice(0, 3).join(', ');
}
