// src/maps/mapRegistry.ts
import { buildSurfSandbox01, MapBuildResult } from './surfSandbox01';
import { buildSurfSandbox02 } from './surfSandbox02';
import { buildSurfSandbox03 } from './surfSandbox03';

export type MapId = 'surf_sandbox_01' | 'surf_sandbox_02' | 'surf_sandbox_03';

export interface MapDefinition {
  id: MapId;
  name: string;
  shortName: string;
  stages: number;
  difficulty: 'TIER 1' | 'TIER 2' | 'TIER 3';
  description: string;
  build: () => MapBuildResult;
}

export const MAP_LIST: readonly MapDefinition[] = [
  {
    id: 'surf_sandbox_01',
    name: 'Surf Sandbox 01 — Citadel Course',
    shortName: 'MAP 01: SANDBOX',
    stages: 4,
    difficulty: 'TIER 1',
    description: '4-stage classic surf course + calibration & VPhysics prop lab.',
    build: buildSurfSandbox01,
  },
  {
    id: 'surf_sandbox_02',
    name: 'Surf Sandbox 02 — Combat Range',
    shortName: 'MAP 02: COMBAT',
    stages: 3,
    difficulty: 'TIER 2',
    description: '3-stage combat surf with armory, bleeding targets & finish arena.',
    build: buildSurfSandbox02,
  },
  {
    id: 'surf_sandbox_03',
    name: 'Surf Sandbox 03 — Citadel Gauntlet',
    shortName: 'MAP 03: GAUNTLET',
    stages: 5,
    difficulty: 'TIER 3',
    description: '5-stage extended course with 16u step-up stairs, dual split, 90° bank & armories.',
    build: buildSurfSandbox03,
  },
];

export const DEFAULT_MAP_ID: MapId = 'surf_sandbox_03';

export function getMapById(id: MapId): MapDefinition {
  return MAP_LIST.find((m) => m.id === id) ?? MAP_LIST[0];
}
