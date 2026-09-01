import { useSheet } from './useSheet';
import type { Message, Template, Creative, Resource } from '@/types';

// useCompanies / useSessions / useFollowups / useProjects were removed along
// with the Companies, Consulting and App Development pages. Their sheets are
// gone from the store allowlist, so nothing can read them any more.
export const useCreatives = () => useSheet<Creative>('Creative');
export const useResources = () => useSheet<Resource>('Resource');
export const useMessages = () => useSheet<Message>('Message');
export const useTemplates = () => useSheet<Template>('Template');
