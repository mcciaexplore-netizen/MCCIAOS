import type { AppSettings, TonedOption } from '../types/index.js';

// Every tone the Badge component knows how to render. The Settings page
// offers exactly these when picking a color for a stage or status.
export const BADGE_TONES = [
  'gray',
  'blue',
  'green',
  'amber',
  'violet',
  'rose',
  'brand',
] as const;

// Seed values for a fresh install. Once saved on the Settings page these are
// superseded by the stored AppSettings record — read them via useSettings(),
// not by importing from here.
export const DEFAULT_SETTINGS: AppSettings = {
  teamMembers: ['Ismail', 'Ziya', 'Sujal', 'Pratik', 'Taniya', 'Rutuja'],
  leadSources: [
    'Workshop',
    'WhatsApp',
    'Referral',
    'Social',
    'Website',
    'Other',
  ],
  businessScales: ['Micro', 'Small', 'Medium'],
  membershipStatuses: ['Member', 'Non-Member', 'Pending'],
  resourceCategories: ['Sheet', 'Dashboard', 'Automation', 'Docs', 'Other'],
  creativePlatforms: [
    'Instagram',
    'Facebook',
    'LinkedIn',
    'WhatsApp',
    'Email',
  ],
  projectStages: [
    { label: 'Pre Dev', tone: 'gray' },
    { label: 'Started', tone: 'blue' },
    { label: 'Completed', tone: 'violet' },
    { label: 'Deployed', tone: 'amber' },
    { label: 'Using', tone: 'green' },
  ],
  companyStatuses: [
    { label: 'New Lead', tone: 'amber' },
    { label: 'Contacted', tone: 'blue' },
    { label: 'Active', tone: 'green' },
  ],
  sessionStatuses: [
    { label: 'Pending', tone: 'amber' },
    { label: 'In Progress', tone: 'blue' },
    { label: 'Completed', tone: 'green' },
  ],
  creativeStatuses: [
    { label: 'draft', tone: 'gray' },
    { label: 'scheduled', tone: 'blue' },
    { label: 'posted', tone: 'green' },
  ],
};

// Helpers for turning a TonedOption[] into the shapes the pages want.
export const labelsOf = (options: TonedOption[]): string[] =>
  options.map((o) => o.label);

export const toneMapOf = (options: TonedOption[]): Record<string, string> =>
  Object.fromEntries(options.map((o) => [o.label, o.tone]));
