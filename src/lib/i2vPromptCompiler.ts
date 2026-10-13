import type { I2VAnimationSections, I2VImageSections, I2VPromptSections, MotionArchetype, SceneDirection, T2VPrompt, T2VPromptProfile, TopicBrief } from '../types';
import {
  canonicalIdentitySignature, cleanSpace, graphicAnnotationPhrase, graphicCompositionPhrase, graphicMotionPhrase, key, naturalList, normalizeOmniSections,
  preferSpecific, productName, resolveProductionScene, sentence, showdownPurpose, stateSentence, uniqueStrings, viewpointIdentitySentence,
  type ResolvedProductionScene,
} from './omniPromptCompiler';

/*
 * Image-to-video compiles two prompts per scene:
 *  - an image prompt that describes one frozen, tack-sharp opening frame (appearance only), and
 *  - an animation prompt that animates that frame (motion only, never re-describing appearance).
 * Image models smear any motion or camera-move language into blur, and video models drift or
 * stall when the motion prompt re-describes the image, so the two sections are kept disjoint.
 */

interface ArchetypeProfile {
  frame: string;
  primary: string;
  secondary: string;
  environment: string;
  stability: string;
  motionExclusions: string[];
}

const AIR_PRODUCT=/\b(aircraft|airplane|aeroplane|fighter|jet|airliner|bomber|transport|aew|awacs|uas|uav|drone|glider)\b/;
const ROTOR_PRODUCT=/\b(helicopter|rotorcraft|rotor|tiltrotor|quadcopter|multirotor)\b/;
const SEA_PRODUCT=/\b(ship|warship|vessel|boat|submarine|frigate|destroyer|carrier)\b/;
const GROUND_PRODUCT=/\b(tank|armou?red|vehicle|truck|car|automobile|locomotive|train|tractor)\b/;
const SPACE_PRODUCT=/\b(rocket|spacecraft|launcher|missile|satellite)\b/;

const productClass=(topic:TopicBrief|null)=>`${(topic as any)?._production_handoff?.product?.product_class||''} ${topic?.topic?.category||''} ${topic?.topic?.product||''}`.toLowerCase();

export function subjectReference(topic:TopicBrief|null,direction:SceneDirection):string {
  if(direction.product_visibility==='NONE')return 'the main subject';
  if(direction.product_visibility==='DETAIL_ONLY')return 'the component';
  const cls=productClass(topic);
  if(ROTOR_PRODUCT.test(cls))return 'the helicopter';
  if(AIR_PRODUCT.test(cls))return 'the aircraft';
  if(SPACE_PRODUCT.test(cls))return 'the vehicle';
  if(SEA_PRODUCT.test(cls))return 'the vessel';
  if(GROUND_PRODUCT.test(cls))return 'the vehicle';
  return 'the product';
}

const sceneText=(direction:SceneDirection)=>`${direction.primary_action} ${direction.supporting_motion} ${direction.temporal_action?.opening_state||''} ${direction.temporal_action?.primary_motion||''} ${direction.temporal_action?.mid_shot_progression||''}`.toLowerCase();
const FLIGHT_WORDS=/\b(fly|flies|flying|flight|airborne|cruis\w*|banks?|banking|climbs?|climbing|hover\w*|soars?|soaring|in the air|aloft|formation)\b/;
const TRANSITION_WORDS=/\b(take-?off|lift-?off|launch\w*|catapult\w*|landing|lands|touchdown|touches down|approach\w*|rotat(?:es|ion) off|leaves the (?:deck|runway|ground))\b/;
const GROUND_WORDS=/\b(taxi\w*|tow\w*|rolls? (?:out|forward)|rolling|drives?|driving|reposition\w*|convoy|rollout|pushback|moves along the (?:deck|runway|apron|road))\b/;

export function classifyMotionArchetype(direction:SceneDirection,topic:TopicBrief|null=null):MotionArchetype {
  const treatment=direction.visual_treatment||'LIVE_ACTION_T2V';
  if(treatment==='STATIC_GRAPHIC_T2V')return 'STATIC_GRAPHIC';
  if(treatment==='MOTION_GRAPHIC_T2V'||direction.graphic_spec)return 'MOTION_GRAPHIC';
  const text=sceneText(direction);
  const platform=direction.camera_platform;
  if(direction.showdown_role==='COCKPIT_IMMERSION'||platform==='COCKPIT_MOUNTED'||platform==='CANOPY_SIDE')return 'COCKPIT_IMMERSION';
  if(direction.showdown_role==='DEPARTURE')return 'AIRBORNE_DEPARTURE';
  if(['AIRBORNE_ESTABLISHMENT','PERFORMANCE_PASS','SECOND_PEAK'].includes(direction.showdown_role||'')||platform==='CHASE_AIRCRAFT')return 'AIRBORNE_FLIGHT';
  if(direction.showdown_role==='ENVIRONMENTAL_SPECTACLE')return FLIGHT_WORDS.test(text)?'AIRBORNE_FLIGHT':'STATIC_PRODUCT_REVEAL';
  if(direction.showdown_role==='CONTROLLED_RETURN')return TRANSITION_WORDS.test(text)?'AIRBORNE_DEPARTURE':GROUND_WORDS.test(text)?'GROUND_MOVEMENT':'AIRBORNE_FLIGHT';
  if(direction.showdown_role)return GROUND_WORDS.test(text)?'GROUND_MOVEMENT':'STATIC_PRODUCT_REVEAL';
  const family=direction.visual_family;
  if(family==='OPERATIONAL_CONTEXT'||family==='DYNAMIC_TESTING'||family==='DELIVERY_AND_ROLLOUT'){
    if(TRANSITION_WORDS.test(text))return 'AIRBORNE_DEPARTURE';
    if(FLIGHT_WORDS.test(text))return 'AIRBORNE_FLIGHT';
    if(GROUND_WORDS.test(text)||family==='DELIVERY_AND_ROLLOUT')return 'GROUND_MOVEMENT';
    return family==='DYNAMIC_TESTING'?'INSPECTION_AND_TEST':'STATIC_PRODUCT_REVEAL';
  }
  switch(family){
    case 'FACTORY_AERIAL':case 'FACTORY_EXTERIOR':case 'FACILITY_APPROACH':case 'FACTORY_INTERIOR_WIDE':case 'MAP_OR_SUPPLY_CHAIN':case 'ATMOSPHERIC_INTERSTITIAL':case 'CHAPTER_TRANSITION':return 'ESTABLISHING_ENVIRONMENT';
    case 'MATERIAL_FLOW':case 'COMPONENT_LOGISTICS':return 'MATERIAL_FLOW';
    case 'ASSEMBLY_PROCESS':case 'WORKER_POV':return 'ASSEMBLY_INTERACTION';
    case 'COMPONENT_MACRO':case 'TOOL_LEVEL_DETAIL':return 'MACRO_DETAIL';
    case 'MACHINERY_ACTION':return 'MACHINERY_CYCLE';
    case 'QUALITY_CONTROL':case 'MEASUREMENT_AND_CALIBRATION':case 'ENVIRONMENTAL_TESTING':case 'STATIC_GROUND_TEST':return 'INSPECTION_AND_TEST';
    default:return direction.product_visibility==='DETAIL_ONLY'?'MACRO_DETAIL':'STATIC_PRODUCT_REVEAL';
  }
}

function archetypeProfile(archetype:MotionArchetype,ref:string,topic:TopicBrief|null):ArchetypeProfile {
  const cls=productClass(topic);
  const rotor=ROTOR_PRODUCT.test(cls);
  const spinning=rotor?'Main and tail rotors turn at operating speed with natural rotational blur':'Propellers, fans, or rotating parts turn at operating speed with natural rotational blur, if the product has them';
  const common=['morphing or melting geometry','objects or people appearing from nowhere','scene cuts or jump edits','sudden speed changes','flickering or strobing light'];
  switch(archetype){
    case 'AIRBORNE_FLIGHT':return {
      frame:`${ref} is captured at one exact instant of stable flight, with a clearly readable flight attitude, the full airframe inside the frame, and open sky ahead of the nose in the direction of travel`,
      primary:`${ref} continues forward along its existing heading with continuous momentum and a constant size in frame; any bank, climb, or descent is gradual and coordinated`,
      secondary:`${spinning}, and control surfaces make only small corrective movements`,
      environment:'Clouds, terrain, or sea surface drift past at a speed consistent with forward flight, with heat haze or condensation only where propulsion or airflow physically causes it',
      stability:`${ref} stays a rigid airframe with fixed wings, unchanged configuration, constant proportions, and identical markings; nothing bends, detaches, or duplicates`,
      motionExclusions:[...common,'sideways sliding or drifting against the heading','sudden altitude jumps','wings flexing like fabric','extra aircraft appearing','camera passing through the aircraft'],
    };
    case 'AIRBORNE_DEPARTURE':return {
      frame:`${ref} is captured at the opening instant of its takeoff, launch, approach, or landing, with landing gear, the runway or deck surface, and the clear path ahead all readable`,
      primary:`${ref} accelerates or decelerates smoothly along one straight path, the nose rotates gradually, and the single transition between ground and air happens once with believable weight and lift`,
      secondary:`${spinning}; landing gear compresses or extends only as the transition requires`,
      environment:'Heat haze, spray, dust, or downwash responds to thrust at the correct place behind or beneath the aircraft, and ground markings slide past in perspective',
      stability:`${ref} keeps fixed geometry, configuration, and markings throughout the transition`,
      motionExclusions:[...common,'instant vertical lift-off of a fixed-wing aircraft','wheels hovering above the surface','more than one takeoff or landing','extra aircraft appearing'],
    };
    case 'COCKPIT_IMMERSION':return {
      frame:'A stable interior view from a fixed canopy-side or cockpit-mounted position, with the operator in a restrained professional posture, gloved hands on the controls, and the horizon clearly visible through the canopy',
      primary:'The horizon tilts and drifts gradually through the canopy as the aircraft maneuvers, while the operator makes small, controlled inputs',
      secondary:'Subtle airframe vibration, a slight head adjustment, and reflections sliding across the canopy glass',
      environment:'Sunlight and cloud shadows sweep across the cockpit as the aircraft turns',
      stability:'The camera stays rigidly mounted to the airframe; the canopy frame, instruments, and operator remain identical, and no display content changes',
      motionExclusions:[...common,'camera floating free of the cockpit','changing or readable screen content','exaggerated head shaking'],
    };
    case 'GROUND_MOVEMENT':return {
      frame:`${ref} is captured at the start of its ground movement, with wheels or tracks in firm contact with the surface and open space ahead in the direction of travel`,
      primary:`${ref} moves forward slowly and steadily along one straight or gently curving path, wheels or tracks rolling in contact with the ground with believable weight`,
      secondary:'Any tow vehicle, ground crew, or support equipment moves in step with it at a calm, professional pace',
      environment:'Surface dust, spray, or exhaust shimmer responds to the movement, and reflections slide across the surface',
      stability:`${ref} keeps fixed geometry and configuration; wheels turn without sliding, and it never lifts off the ground`,
      motionExclusions:[...common,'sliding without wheel rotation','floating above the ground','sudden turns or spins'],
    };
    case 'STATIC_PRODUCT_REVEAL':return {
      frame:`${ref} is presented at rest in a clear hero composition with its full silhouette readable and strong separation from the background`,
      primary:`${ref} itself stays completely still; the shot comes alive through the single camera move and restrained ambient activity`,
      secondary:'Distant personnel or support equipment make small, unhurried movements',
      environment:'Light shifts slowly across the surfaces, and haze, dust, steam, or flags drift gently in the air',
      stability:`${ref} remains static in position, shape, scale, and configuration`,
      motionExclusions:[...common,'the product moving, rotating, or changing configuration on its own'],
    };
    case 'ASSEMBLY_INTERACTION':return {
      frame:'The instant just before the key assembly action: the technician\'s hands and tool are positioned at the workpiece but have not yet completed the task, with the part clearly readable',
      primary:'The technician performs one deliberate, controlled assembly action with realistic hand-to-tool contact, applying force exactly where the tool meets the part',
      secondary:'Fingers adjust their grip, the tool engages and settles, and small fasteners or parts move only as the action causes',
      environment:'Workshop light holds steady while distant workers and machinery continue softly in the background',
      stability:'Hands keep natural anatomy with five fingers; the tool, workpiece, and parts keep their exact shape and count, and only the assigned action changes the part',
      motionExclusions:[...common,'extra fingers or merging hands','tools passing through parts','parts assembling themselves'],
    };
    case 'MACHINERY_CYCLE':return {
      frame:'The machine at the start of its working cycle, with the tool head, workpiece, and fixture clearly separated and readable',
      primary:'The machine performs one working cycle along its fixed mechanical axis at a believable industrial speed',
      secondary:'Chips, sparks, coolant, or steam appear only where the tool meets the material',
      environment:'Indicator lights glow steadily and surrounding equipment stays in its place',
      stability:'The machine frame stays rigidly fixed; moving parts travel only along their mechanical axes, and the workpiece changes only where it is worked',
      motionExclusions:[...common,'machine parts bending or stretching','tools passing through material without contact'],
    };
    case 'MATERIAL_FLOW':return {
      frame:'The material or component at the start of its path on its conveyor, crane, cart, or vehicle, with the route ahead clear',
      primary:'The load moves steadily along one defined path at constant speed with believable mass, staying aligned with its carrier',
      secondary:'Rollers turn, cables stay taut, and the carrier mechanism moves in sync with the load',
      environment:'Workers and equipment along the route continue their own work at a calm pace',
      stability:'The load keeps its exact shape, count, and orientation and never detaches from its carrier',
      motionExclusions:[...common,'loads floating without support','items multiplying or vanishing'],
    };
    case 'MACRO_DETAIL':return {
      frame:'An extreme close-up with shallow depth of field and the critical feature in razor-sharp focus on the focal plane',
      primary:'Movement is minimal and precise: one small mechanical or tool action within the detail',
      secondary:'A narrow highlight glides across the surface, revealing texture and machining marks',
      environment:'Fine dust or vapor drifts slowly through the light',
      stability:'The focal plane stays locked on the feature, and its geometry and surface detail remain identical',
      motionExclusions:[...common,'focus hunting','surface texture crawling or boiling'],
    };
    case 'INSPECTION_AND_TEST':return {
      frame:'The inspector, probe, sensor, or test rig positioned against the product with the measured feature clearly visible',
      primary:'One controlled measurement or test action progresses: a probe or sensor moves into contact and scans, or the test load is applied smoothly',
      secondary:'Indicator lights change state softly while the technician observes with small, natural movements',
      environment:'The test space stays clean and steady, with only ventilation or test-induced airflow moving',
      stability:'The product and test equipment keep their exact geometry; no readable numbers or screen content appear or change',
      motionExclusions:[...common,'readable numbers or changing screen text'],
    };
    case 'ESTABLISHING_ENVIRONMENT':return {
      frame:'A wide, stable establishing view with a clear horizon and readable layers of foreground, midground, and background',
      primary:'The scene stays calm and mostly still; the single camera move carries the shot',
      secondary:'Small vehicles or people move slowly at believable scale',
      environment:'Clouds drift, light shifts gradually, and steam or exhaust rises gently from vents',
      stability:'Buildings, terrain, and structures remain rigid and unchanged',
      motionExclusions:[...common,'buildings warping','time-lapse speed changes'],
    };
    case 'STATIC_GRAPHIC':case 'MOTION_GRAPHIC':return {
      frame:'The complete technical composition is already fully established in the opening frame',
      primary:'',
      secondary:'',
      environment:'The background stays completely static',
      stability:'All major geometry keeps its exact shape, proportions, and position, and no new elements appear',
      motionExclusions:['generated words or numbers','morphing or duplicated geometry','moving backgrounds','camera orbit or 3D rotation','photorealistic or cinematic 3D materials'],
    };
  }
}

function framingForCamera(behavior:string,archetype:MotionArchetype):string {
  if(archetype==='STATIC_GRAPHIC'||archetype==='MOTION_GRAPHIC')return 'Keep balanced margins around the composition';
  if(/push-in/.test(behavior))return 'Keep comfortable space around the subject so the frame can tighten later';
  if(/pull-back/.test(behavior))return 'Frame the subject tightly so the wider surroundings can be revealed later';
  if(/lateral|pan|dolly/.test(behavior))return 'Leave open space on one side of the frame for later lateral movement';
  if(/crane/.test(behavior))return 'Frame from a slightly low position with open space above the subject';
  if(/tracking/.test(behavior))return 'Keep the subject centered with lead room ahead of it';
  return 'Compose a balanced frame that reads clearly as a still';
}

const CAMERA_MOVE=/\b(?:camera (?:moves|pans|tracks|pushes|pulls|rises|orbits|follows|dollies)|dolly(?:ing)?|panning|pans|pan across|push(?:es|ing)?[- ]in|pull(?:s|ing)?[- ]back|crane (?:rise|up|down)|orbit(?:s|ing)?|zoom(?:s|ing)?(?: in| out)?|tracking shot|whip pan)\b/i;
const BLUR_WORDS=/\b(?:motion blur(?:red)?|speed (?:lines|streaks)|streak(?:s|ing)|blurred motion|long exposure|panning blur|ghosting|smeared)\b/i;
const sentences=(value:string)=>cleanSpace(value).split(/(?<=[.!?])\s+/).map(cleanSpace).filter(Boolean);

/** Drops sentences that would make an image model render camera movement or blur. */
export function stillFrameText(value:unknown):string {
  return sentences(String(value??'')).filter(part=>!CAMERA_MOVE.test(part)&&!BLUR_WORDS.test(part)).join(' ').trim();
}

// Motion-specific exclusions belong in the animation prompt; in a still prompt they only prime movement.
const MOTION_ONLY_EXCLUSION=/\b(?:camera|sliding|aerobatics?|morphing|changing|recreation|claims?|paths?|motion|moving)\b/i;
const splitList=(value:string)=>cleanSpace(value).replace(/,?\s+and\s+(?=[^,]*$)/,', ').split(/\s*,\s*/).map(cleanSpace).filter(Boolean);
const STILL_ARTIFACTS=['motion blur','speed lines','ghosting or double exposure','text, captions, or watermarks','logos or labels that are not part of the product','borders, frames, or split panels','distorted or extra limbs and fingers'];

function cameraMotionSentence(direction:SceneDirection,resolved:ResolvedProductionScene,archetype:MotionArchetype):string {
  if(archetype==='STATIC_GRAPHIC')return 'The viewpoint stays fixed with only minimal parallax';
  if(archetype==='MOTION_GRAPHIC')return 'The viewpoint stays fixed; only the assigned graphic elements move';
  if(archetype==='COCKPIT_IMMERSION')return 'The camera stays rigidly mounted to the aircraft with no independent movement';
  const behavior=resolved.camera.behavior;
  const platform=direction.camera_platform?.toLowerCase().replaceAll('_',' ');
  const speed=resolved.camera.speed&&behavior!=='locked camera'&&!(resolved.camera.speed==='slow'&&behavior.startsWith('slow '))?` at ${resolved.camera.speed} speed`:'';
  const base=behavior==='locked camera'?'The camera stays locked off with no movement':`The camera performs one smooth ${behavior}${speed}`;
  return platform?`${base}, physically consistent with a ${platform}`:base;
}

function soundSentence(direction:SceneDirection,archetype:MotionArchetype,topic:TopicBrief|null):string {
  const cls=productClass(topic);
  if(archetype==='STATIC_GRAPHIC'||archetype==='MOTION_GRAPHIC')return 'Use restrained abstract documentary sound synchronized only to the visible graphic motion, with no dialogue, narration, or music';
  if(archetype==='AIRBORNE_FLIGHT'||archetype==='AIRBORNE_DEPARTURE'||archetype==='COCKPIT_IMMERSION')
    return ROTOR_PRODUCT.test(cls)?'Generate synchronized rotor, engine, airflow, and wind sound with no dialogue, narration, or music':'Generate synchronized propulsion, airflow, and wind sound matched to the motion, with no dialogue, narration, or music';
  if(archetype==='GROUND_MOVEMENT')return 'Generate synchronized engine, tire or track, and surface sound with no dialogue, narration, or music';
  if(/carrier|maritime|deck/i.test(direction.environment_description))return 'Generate synchronized maritime deck ambience with wind and distant machinery, with no dialogue, narration, or music';
  if(archetype==='ESTABLISHING_ENVIRONMENT')return 'Generate quiet synchronized environmental ambience with distant industrial sound, with no dialogue, narration, or music';
  return 'Generate synchronized factory ambience with restrained machinery hum and tool contact matched to the visible action, with no dialogue, narration, or music';
}

const firstSentenceLimit=(value:string,maxWords:number)=>{
  const words=cleanSpace(value).split(/\s+/).filter(Boolean);
  return words.length>maxWords?`${words.slice(0,maxWords).join(' ').replace(/[,;:]+$/,'')}`:cleanSpace(value);
};

export interface RawI2VSections { image?: Partial<I2VImageSections>; animation?: Partial<I2VAnimationSections>; }

export function normalizeI2VSections(raw:RawI2VSections|undefined,direction:SceneDirection,topic:TopicBrief|null):I2VPromptSections {
  const resolved=resolveProductionScene(topic,direction);
  const archetype=classifyMotionArchetype(direction,topic);
  const ref=subjectReference(topic,direction);
  const profile=archetypeProfile(archetype,ref,topic);
  const graphic=archetype==='STATIC_GRAPHIC'||archetype==='MOTION_GRAPHIC';
  const spec=direction.graphic_spec;
  const visibility=direction.product_visibility||(direction.state==='C'?'FULL':'PARTIAL');
  const temporal=direction.temporal_action;
  const image=raw?.image||{};
  const animation=raw?.animation||{};

  // ---------- Image: one frozen opening frame ----------
  const composition=graphic
    ? `A 16:9 ${spec?`flat vector composition with ${graphicCompositionPhrase(spec.composition)}`:'stable orthographic technical composition'}, viewed straight on. ${profile.frame}`
    : `${direction.camera_platform?`As seen from a physically credible ${direction.camera_platform.toLowerCase().replaceAll('_',' ')}, a`:'A'} ${resolved.camera.shotScale} ${resolved.camera.viewpoint} view on a ${resolved.camera.lens} lens. ${profile.frame}. ${framingForCamera(resolved.camera.behavior,archetype)}`;
  const graphicSubject=spec?`A premium technical vector explainer of one claim: ${spec.visual_claim}${spec.annotation_devices.length?`, using ${graphicAnnotationPhrase(spec.annotation_devices)}`:''}`:'An unlabeled documentary technical composition of clean geometric forms, components, and material layers';
  const subject=graphic?(stillFrameText(image.subject)||graphicSubject):(stillFrameText(image.subject)||stillFrameText(direction.subject)||cleanSpace(direction.subject));
  const frozen=stillFrameText(image.frozen_moment)||stillFrameText(temporal?.opening_state)||'';
  const environment=graphic?'A clean neutral technical background with no literal set, map, interface, or readable annotation':(stillFrameText(image.environment)||stillFrameText(direction.environment_description)||cleanSpace(direction.environment_description));
  const lighting=graphic
    ?'Geometric silhouettes, minimal texture, restrained outlines, two- or three-tone cel shading, pale cyan and sky blue, cool gray and charcoal, one red accent, and yellow-orange only for active heat or energy'
    :(stillFrameText(image.lighting_and_materials)||stillFrameText(direction.lighting_and_material)||'Realistic documentary lighting with accurate material response');
  const identity=visibility==='NONE'?sentence(`Do not show the ${productName(topic)} or its silhouette`)
    :visibility==='DETAIL_ONLY'?(preferSpecific(resolved.identity,2).length?sentence(`Show only this component detail: ${naturalList(preferSpecific(resolved.identity,2))}`):sentence(direction.product_visual_state))
    :visibility==='FULL'?[canonicalIdentitySignature(topic).replace(/ in every clip/i,''),viewpointIdentitySentence(resolved)].filter(Boolean).join(' ')
    :stateSentence(direction,resolved,topic);
  const rendering=graphic
    ?'Render a crisp, complete, high-resolution flat 2D vector frame with clean edges and no text, numbers, or placeholder label cards'
    :'Render as a photorealistic, high-resolution cinema-camera documentary frame with true-to-scale proportions, realistic materials, and natural depth of field. Freeze this exact instant as if shot with a fast shutter: every edge is crisp and tack-sharp';
  // Exclusions come only from the authoritative handoff so local recompiles are deterministic.
  const omniExclusions=normalizeOmniSections({},direction,topic).sections.exclusions;
  const imageSections:I2VImageSections={
    composition,subject,frozen_moment:frozen,environment,lighting_and_materials:lighting,product_identity:identity,rendering,
    exclusions:naturalList(uniqueStrings([splitList(omniExclusions).filter(item=>!MOTION_ONLY_EXCLUSION.test(item)),STILL_ARTIFACTS])),
  };

  // ---------- Animation: motion only ----------
  const graphicPrimary=spec?`${graphicMotionPhrase(spec.motion_pattern)}, moving no more than ${spec.maximum_animated_elements} element${spec.maximum_animated_elements===1?'':'s'}`:archetype==='STATIC_GRAPHIC'?'Only a restrained light pass moves across the composition':'One component, path, or layer moves in one controlled, keyframed relationship';
  const primary=cleanSpace(animation.primary_motion)||(graphic?graphicPrimary:[temporal?.primary_motion,temporal?.physical_interaction].map(cleanSpace).filter(Boolean).join('; ')||cleanSpace(direction.primary_action)||profile.primary);
  const secondary=graphic?'':(cleanSpace(animation.secondary_motion)||cleanSpace(direction.supporting_motion)||profile.secondary);
  const environmentMotion=cleanSpace(animation.environment_motion)||profile.environment;
  const purpose=showdownPurpose(direction);
  const timeline=graphic
    ?'Begin exactly on the provided frame. Animate the single relationship through the middle half, then hold the completed composition steadily for the final quarter'
    :`Begin exactly on the provided frame. ${temporal?.mid_shot_progression?`By mid-shot, ${cleanSpace(temporal.mid_shot_progression).replace(/^by mid-?shot,?\s*/i,'')}. `:''}End with ${cleanSpace(temporal?.ending_state)||'a settled, stable composition'}, holding steady through the final moment${purpose?`. Shot intent: ${purpose}`:''}`;
  const stateGuard=!graphic&&visibility!=='NONE'&&direction.state!=='C'?` Do not complete, install, or reveal any component that is not already in the frame.`:'';
  const identityGuard=graphic||visibility==='NONE'?'':`Keep ${ref} exactly as it appears in the provided image: same geometry, proportions, configuration, colors, and markings.`;
  const stability=`${identityGuard} ${profile.stability}.${stateGuard}`;
  const animationSections:I2VAnimationSections={
    primary_motion:primary,
    secondary_motion:secondary,
    environment_motion:environmentMotion,
    camera_motion:cameraMotionSentence(direction,resolved,archetype),
    timeline,
    stability:cleanSpace(stability),
    sound:soundSentence(direction,archetype,topic),
    exclusions:naturalList(uniqueStrings([
      profile.motionExclusions,
      ['OPERATIONAL_CONTEXT','DYNAMIC_TESTING','DELIVERY_AND_ROLLOUT'].includes(direction.visual_family||'')?['weapon discharge','explosions or active combat','impossible aerobatics','changing product configuration']:[],
      direction.showdown_role?['impossible camera paths','unverified flares or external stores']:[],
      ['readable generated text'],
    ])),
  };
  return {archetype,image:imageSections,animation:animationSections};
}

const join=(parts:string[])=>{
  const seen=new Set<string>();
  return parts.map(sentence).filter(Boolean).filter(part=>{const normalized=key(part);if(seen.has(normalized))return false;seen.add(normalized);return true;})
    .join(' ').replace(/\s+/g,' ').replace(/\.\s*\./g,'.').replace(/(^|[.!?]\s+)([a-z])/g,(_,lead,letter)=>lead+letter.toUpperCase()).trim();
};

export function compileImagePrompt(sections:I2VPromptSections):string {
  const s=sections.image;
  const graphic=sections.archetype==='STATIC_GRAPHIC'||sections.archetype==='MOTION_GRAPHIC';
  const header=graphic?'Still image, 16:9, opening frame of a technical explainer animation':'Still photograph, 16:9, the opening frame of a documentary shot';
  return join([header,s.composition,s.subject,s.frozen_moment,s.environment,s.lighting_and_materials,s.product_identity,s.rendering,s.exclusions?`Exclude ${s.exclusions}`:'']);
}

export function compileAnimationPrompt(sections:I2VPromptSections,direction:SceneDirection,profile:T2VPromptProfile):string {
  const a=sections.animation;
  const header=`Animate the provided image as one ${Number(direction.duration.toFixed(3))}-second continuous shot`;
  const exclusions=a.exclusions?(profile==='veo-flow'?`Negative prompt: ${a.exclusions}`:`Exclude ${a.exclusions}`):'';
  return join([header,a.primary_motion,a.secondary_motion,a.environment_motion,a.camera_motion,a.timeline,a.stability,a.sound,exclusions]);
}

export function buildI2VPrompt(base:Omit<T2VPrompt,'video_prompt'|'image_prompt'|'animation_prompt'|'i2vSections'>,raw:RawI2VSections|undefined,direction:SceneDirection,topic:TopicBrief|null,profile:T2VPromptProfile):T2VPrompt {
  const i2vSections=normalizeI2VSections(raw,direction,topic);
  const image_prompt=compileImagePrompt(i2vSections);
  const animation_prompt=compileAnimationPrompt(i2vSections,direction,profile);
  return {...base,image_prompt,animation_prompt,video_prompt:animation_prompt,i2vSections};
}

/** Rebuilds every image/animation prompt locally from stored sections; no API call. */
export function recompileI2VPrompts(prompts:T2VPrompt[],directions:SceneDirection[],topic:TopicBrief|null,profile:T2VPromptProfile):T2VPrompt[] {
  const byNumber=new Map(directions.map(direction=>[direction.number,direction]));
  return prompts.map(prompt=>{
    const direction=byNumber.get(prompt.number);
    if(!direction)return prompt;
    const {video_prompt,image_prompt,animation_prompt,i2vSections,...rest}=prompt;
    return buildI2VPrompt({...rest,voiceover:direction.voiceover},i2vSections,direction,topic,profile);
  }).sort((a,b)=>a.number-b.number);
}

/** One-line description of each archetype, sent to Gemini so its creative fields match the deterministic rules. */
export function archetypeBrief(archetype:MotionArchetype):string {
  return ({
    AIRBORNE_FLIGHT:'Aircraft in stable flight. Image: one frozen instant with readable attitude and open sky ahead. Animation: continuous forward momentum, coordinated gradual maneuver, spinning propulsion, passing clouds or terrain.',
    AIRBORNE_DEPARTURE:'Takeoff, launch, approach, or landing. Image: the opening instant on the runway, deck, or approach path. Animation: one smooth acceleration or deceleration and a single ground-air transition with physical thrust effects.',
    COCKPIT_IMMERSION:'Inside the cockpit. Image: restrained operator, hands on controls, horizon through canopy. Animation: horizon tilts, small control inputs, vibration, sliding reflections; camera rigidly mounted.',
    GROUND_MOVEMENT:'Taxi, tow, rollout, or drive. Image: start of the movement with ground contact and space ahead. Animation: slow steady travel with rolling wheels or tracks and surface response.',
    STATIC_PRODUCT_REVEAL:'Product at rest. Image: hero composition with full silhouette. Animation: the product stays still; the camera move, light shifts, and ambient activity carry the shot.',
    ASSEMBLY_INTERACTION:'Hands-on assembly. Image: the instant just before the action, hands and tool at the part. Animation: one deliberate tool action with realistic contact and force.',
    MACHINERY_CYCLE:'Machine at work. Image: start of the cycle, tool and workpiece separated. Animation: one working cycle along fixed mechanical axes with chips, sparks, or coolant at the contact point.',
    MATERIAL_FLOW:'Material or component logistics. Image: the load at the start of its path. Animation: steady travel with its carrier, believable mass.',
    MACRO_DETAIL:'Extreme close-up. Image: razor-sharp critical feature, shallow depth of field. Animation: one tiny precise action and a gliding highlight.',
    INSPECTION_AND_TEST:'Inspection, measurement, or test. Image: probe or rig against the feature. Animation: one controlled measurement or test action, no readable data.',
    ESTABLISHING_ENVIRONMENT:'Wide establishing view. Image: layered wide composition with horizon. Animation: mostly still scene, drifting clouds, light, steam, small distant movement, camera move carries it.',
    STATIC_GRAPHIC:'Flat vector graphic. Image: complete text-free composition. Animation: minimal parallax or one light pass.',
    MOTION_GRAPHIC:'Flat vector graphic. Image: complete text-free composition. Animation: the assigned graphic motion only, then a final-quarter hold.',
  } as Record<MotionArchetype,string>)[archetype];
}
