import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeDirectionMetadata, validateSceneDirections } from './sceneDirections';

const timed = [{ number: 1, start: 0, end: 10, duration: 10, text: 'Hello.', silent: false }];
const generated = [{ number: 1, stage_id: 'S01', state: 'A', subject: 'Raw aluminum billet', product_visual_state: 'Unfinished raw stock', primary_action: 'A crane lowers the billet', supporting_motion: 'Coolant mist drifts', environment_ref: 'E01', environment_description: 'Steel receiving bay', camera: { shot_scale: 'wide', lens: '35mm', angle: 'low', movement: 'push in', movement_speed: 'slow' }, lighting_and_material: 'Cool LED on brushed metal', continuity_from_previous: 'Opening state', transition_to_next: 'Billet enters machining', required_visible_features: ['rectangular billet'], forbidden_elements: ['finished product'] }];

test('merges immutable imported timing and validates complete directions', () => {
  const merged = mergeDirectionMetadata(generated, timed);
  assert.equal(merged[0].voiceover, 'Hello.');
  assert.deepEqual(validateSceneDirections(merged, timed), []);
});

test('rejects modified imported metadata', () => {
  const merged = mergeDirectionMetadata(generated, timed);
  merged[0].voiceover = 'Changed';
  assert.ok(validateSceneDirections(merged, timed).some(error => error.includes('modified')));
});
