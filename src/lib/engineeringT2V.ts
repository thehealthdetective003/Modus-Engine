import type { EngineeringT2VSubstitution, PlannedScene, SceneDirection } from '../types';
import type { V3GenerationPermission, V3MediaRoute } from '../types/visualEngineeringV3';

type EngineeringScene = PlannedScene | SceneDirection;

const unique = (values: string[]) => [...new Set(values.map(value => value.trim()).filter(Boolean))];

export function prepareEngineeringSceneForT2V<T extends EngineeringScene>(scene: T): T {
  if (scene.handoff_mode !== 'ENGINEERING_V3') return scene;
  if (scene.media_route === 'GENERATED_T2V' && scene.generation_permission === 'T2V_ALLOWED') return scene;

  const sourcePermission = scene.source_generation_permission || scene.generation_permission || 'NOT_ALLOWED';
  const sourceRoute = scene.source_media_route || scene.media_route || 'NO_VALID_ROUTE';
  const blocked = sourcePermission === 'NOT_ALLOWED' || sourceRoute === 'NO_VALID_ROUTE';
  const editor = sourcePermission === 'EDITOR_ONLY' || sourceRoute === 'EDITOR_NATIVE_GRAPHIC';
  const substitution: EngineeringT2VSubstitution = blocked
    ? 'BLOCKED_TO_NEUTRAL_CONTEXT'
    : editor
      ? 'EDITOR_DATA_TO_TEXT_FREE_GRAPHIC'
      : 'REFERENCE_TO_CONTEXTUAL_T2V';

  const patch: Record<string, unknown> = {
    source_generation_permission: sourcePermission,
    source_media_route: sourceRoute,
    t2v_substitution: substitution,
    generation_permission: 'T2V_ALLOWED',
    media_route: 'GENERATED_T2V',
    truth_status: 'CONTEXTUAL_NON_IDENTIFYING',
    route_reason: blocked
      ? `The original ${sourcePermission}/${sourceRoute} assignment is replaced by a neutral contextual T2V scene that does not visualize the blocked claim.`
      : editor
        ? `The original ${sourcePermission}/${sourceRoute} assignment is converted into a qualitative, text-free T2V technical graphic with no readable or precise data.`
        : `The original ${sourcePermission}/${sourceRoute} assignment is converted into a contextual text-only T2V reconstruction with no exact event, location, or source-locked claim.`,
  };

  if (blocked) {
    patch.product_visibility = 'NONE';
    patch.visual_treatment = 'LIVE_ACTION_T2V';
  } else if (editor) {
    patch.visual_treatment = scene.visual_treatment === 'MOTION_GRAPHIC_T2V' ? 'MOTION_GRAPHIC_T2V' : 'STATIC_GRAPHIC_T2V';
  }

  if ('forbidden_elements' in scene) {
    patch.forbidden_elements = unique([
      ...(scene.forbidden_elements || []),
      'readable labels, numbers, measurements, tables, formulas, maps, or interface text',
      'exact event or location recreation',
      'unsupported source-locked markings or proprietary internal detail',
    ]);
    if (blocked) {
      patch.subject = 'A neutral non-identifying engineering context shot';
      patch.product_visual_state = 'No product-specific geometry or blocked evidence is shown';
      patch.primary_action = 'Environmental motion provides a restrained documentary transition without illustrating the prohibited claim';
      patch.required_visible_features = ['one neutral physical environment with restrained observable motion'];
    }
  }

  return { ...scene, ...patch } as T;
}

export function engineeringT2VSubstitutionCount(scenes: EngineeringScene[]): number {
  return scenes.filter(scene => Boolean(prepareEngineeringSceneForT2V(scene).t2v_substitution)).length;
}

export function sourceEngineeringRoute(scene: EngineeringScene): { permission?: V3GenerationPermission; route?: V3MediaRoute } {
  return {
    permission: scene.source_generation_permission || scene.generation_permission,
    route: scene.source_media_route || scene.media_route,
  };
}
