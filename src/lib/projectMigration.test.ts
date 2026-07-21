import assert from 'node:assert/strict';
import test from 'node:test';
import { migrateProject } from './projectMigration';
import type { AppState } from '../types';

const initial = { projectSchemaVersion: 3, projectName: 'Untitled', projectFormat: 'standard-lifecycle', phase: 1, topic: null, sceneDirections: [], masterVoiceoverScript: '', voiceoverTranscription: null, visualPrompts: [], demoState: 'idle', demoScenes: [], demoSceneNumbers: [] } as AppState;

test('rejects Hybrid projects', () => assert.equal(migrateProject({ creationMode: 'hybrid-split' }, initial, 10).state, null));
test('moves legacy projects without typed directions to Phase 2', () => {
  const result = migrateProject({ topic: { topic: { title: 'X' } }, phase: 4, phase4Mode: 'image-animation', visualPrompts: [{ image_prompt: 'x' }] }, initial, 10);
  assert.equal(result.state?.phase, 2);
  assert.deepEqual(result.state?.visualPrompts, []);
});
