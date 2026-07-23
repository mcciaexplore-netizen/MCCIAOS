import { useSheet } from './useSheet';
import type {
  Company,
  Creative,
  Followup,
  Project,
  Resource,
  Session,
} from '@/types';

export const useCompanies = () => useSheet<Company>('Company');
export const useSessions = () => useSheet<Session>('Session');
export const useFollowups = () => useSheet<Followup>('Followup');
export const useProjects = () => useSheet<Project>('Project');
export const useCreatives = () => useSheet<Creative>('Creative');
export const useResources = () => useSheet<Resource>('Resource');
