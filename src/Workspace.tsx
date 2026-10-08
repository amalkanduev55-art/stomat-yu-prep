import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, ContactShadows, Grid, Line, Html, GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import { crownGeometry, stopperGeometry, toothIds, toothPosition } from './geometry';
import { contactLayout, contactSlots, guideLayout, guideSurfacePoint, unifiedGuideGeometry, type SlotCounts } from './guideGeometry';
import gingivaGeometry from './gingivaGeometry';
import rootGeometry from './rootGeometry';
import ErrorBoundary from './ErrorBoundary';
import type { LayerLocks, LayerValues, LayerVisibility } from './cadLayers';

export type CameraAction = { id: number; action: 'fit' | 'reset' | 'zoom-in' | 'zoom-out' };
export type CadTool = 'rotate' | 'pan' | 'zoom';

export type Settings = { diameter: number; length: number; shaft: number; totalLength: number; stopper: number; stopperInner: number; stopperShape: number; stopperEnabled: number; stopperHeight: number; stopperPosition: number; clearance: number; wall: number; angle: number; profile: number };
type Props = { selected: number[]; onSelect: (id: number) => void; burTooth: number | null; slotCounts: SlotCounts; activeSlot: number; mode: DisplayMode; translucent: boolean; sourceOpacity: number; guideOpacity: number; wireframe: boolean; settings: Settings; guide: number; layers: LayerVisibility; layerOpacities: LayerValues; layerLocks: LayerLocks; tool: CadTool; cameraAction: CameraAction; sectionEnabled: boolean; sectionOffset: number; heatmap: boolean; collision: boolean; playing: boolean; progress: number; view: string; onViewChange: (view: string) => void; guideRef: React.RefObject<THREE.Group | null>; imported: THREE.BufferGeometry | null; targetImported: THREE.BufferGeometry | null; targetTransform: THREE.Matrix4 | null; opacity: number; guidePose?: GuidePose };
export type DisplayMode = 'installed' | 'detached' | 'guide' | 'fragment' | 'teeth';
export type GuidePose = { x: number; y: number; z: number; rx: number; ry: number; rz: number };
export const identityGuidePose: GuidePose = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };

function Model(props: Props & { mode: DisplayMode; translucent: boolean }) {
  const bur = useRef<THREE.Group>(null);
  const firstIndex = Math.max(0, toothIds.indexOf(props.burTooth ?? props.selected[0] ?? 31));
  const fragment = props.mode === 'fragment';
  const lifted = props.mode === 'detached' ? 12 : 0;
  const pose = props.guidePose ?? identityGuidePose;
  const thickness = Math.min(1.2, Math.max(.25, props.settings.wall * .4));
  const slots = contactSlots(props.settings, props.burTooth ?? toothIds[firstIndex]);
  const coordinate = slots[props.activeSlot]?.coordinate ?? firstIndex;
  const guideGeometry = useMemo(() => unifiedGuideGeometry(props.settings, props.guide, props.selected, fragment ? firstIndex : undefined, props.slotCounts), [props.settings.shaft, props.settings.clearance, props.settings.wall, props.guide, props.selected, fragment, firstIndex, props.slotCounts]);
  useEffect(() => () => guideGeometry.dispose(), [guideGeometry]);
  const crowns = useMemo(() => toothIds.map((_, index) => crownGeometry(index)), []);
  const roots = useMemo(() => toothIds.map((_, index) => rootGeometry(index)), []);
  useEffect(() => () => roots.flat().forEach(geometry => geometry.dispose()), [roots]);
  const gingiva = useMemo(() => gingivaGeometry(), []);
  const stopper = useMemo(() => stopperGeometry(props.settings.stopper, props.settings.stopperInner, props.settings.stopperHeight, props.settings.stopperShape), [props.settings.stopper, props.settings.stopperInner, props.settings.stopperHeight, props.settings.stopperShape]);
  const layout = guideLayout(props.selected);
  const showTeeth = props.mode !== 'guide';
  const showGuide = props.mode !== 'teeth' && props.layers.guide;
  const showBur = slots.length > 0 && props.selected.length > 0 && props.layers.bur && props.mode !== 'detached' && props.mode !== 'guide';
  const pointAt = useMemo(() => {
    const tooth = toothPosition(firstIndex);
    const transform = new THREE.Matrix4().makeRotationY(-(firstIndex - 6.5) * .215).multiply(new THREE.Matrix4().makeTranslation(-tooth[0], 0, -tooth[2]));
    return (crossAngle: number) => {
      const point = guideSurfacePoint(coordinate, crossAngle, thickness);
      if (fragment) point.applyMatrix4(transform);
      point.y += lifted;
      return point;
    };
  }, [coordinate, thickness, firstIndex, fragment, lifted]);
  const worldPath = useMemo(() => Array.from({ length: 65 }, (_, step) => pointAt(-1.42 + 2.84 * step / 64).add(new THREE.Vector3(0, .08, 0))), [pointAt]);
  const guideLocalPoint = useMemo(() => {
    const tooth = toothPosition(firstIndex);
    const transform = new THREE.Matrix4().makeRotationY(-(firstIndex - 6.5) * .215).multiply(new THREE.Matrix4().makeTranslation(-tooth[0], 0, -tooth[2]));
    return (crossAngle: number) => {
      const point = guideSurfacePoint(coordinate, crossAngle, thickness);
      if (fragment) point.applyMatrix4(transform);
      return point;
    };
  }, [coordinate, thickness, firstIndex, fragment]);
  useFrame(({ clock }) => {
    if (!bur.current) return;
    const travel = props.playing ? (Math.sin(clock.elapsedTime * 1.4) + 1) / 2 : props.progress / 100;
    const pathAngle = -1.42 + 2.84 * travel;
    const contact = guideLocalPoint(pathAngle);
    const tangent = guideLocalPoint(pathAngle + .001).sub(guideLocalPoint(pathAngle - .001)).normalize();
    const insertion = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(1, 0, 0));
    if (insertion.lengthSq() < 1e-8) insertion.crossVectors(tangent, new THREE.Vector3(0, 0, 1));
    insertion.normalize();
    if (insertion.y < 0) insertion.negate();
    bur.current.position.copy(contact).addScaledVector(insertion, props.settings.stopperPosition + .08);
    bur.current.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), insertion);
    bur.current.rotateZ(props.settings.angle * Math.PI / 180);
  });
  const localPath = useMemo(() => Array.from({ length: 65 }, (_, step) => guideLocalPoint(-1.42 + 2.84 * step / 64).add(new THREE.Vector3(0, .08, 0))), [guideLocalPoint]);
  const channels = useMemo(() => contactLayout(props.settings, props.selected).filter(slot => !fragment || Math.abs(slot.coordinate - firstIndex) <= .51).map(slot => {
    const tooth = toothPosition(firstIndex);
    const transform = new THREE.Matrix4().makeRotationY(-(firstIndex - 6.5) * .215).multiply(new THREE.Matrix4().makeTranslation(-tooth[0], 0, -tooth[2]));
    return { key: slot.key, points: Array.from({ length: 65 }, (_, step) => {
      const point = guideSurfacePoint(slot.coordinate, -1.42 + 2.84 * step / 64, thickness);
      if (fragment) point.applyMatrix4(transform);
      point.y += .12;
      return point;
    }) };
  }), [props.settings.shaft, props.settings.clearance, props.selected, thickness, fragment, firstIndex]);
  return <group name="cad-model">
    {showTeeth && props.layers.roots && !props.imported && toothIds.map((id, index) => fragment && index !== firstIndex ? null : <group key={`roots-${id}`} name={`demo-roots-${id}`} position={fragment ? [0, 0, 0] : toothPosition(index)} rotation={[0, fragment ? 0 : (index - 6.5) * .215, 0]}>{roots[index].map((geometry, rootIndex) => <group key={rootIndex}><mesh geometry={geometry}><meshStandardMaterial color="#d6c6a5" roughness={.72} transparent={props.layerOpacities.roots < 100} opacity={props.layerOpacities.roots / 100} depthWrite={props.layerOpacities.roots === 100} /></mesh>{props.wireframe && <mesh geometry={geometry}><meshBasicMaterial color="#7d7057" wireframe transparent opacity={.12} /></mesh>}</group>)}</group>)}
    {showTeeth && props.layers.gum && !props.imported && !fragment && <group><mesh geometry={gingiva}><meshPhysicalMaterial vertexColors roughness={.5} clearcoat={.16} clearcoatRoughness={.45} side={THREE.DoubleSide} transparent={props.layerOpacities.gum < 100} opacity={props.layerOpacities.gum / 100} /></mesh>{props.wireframe && <mesh geometry={gingiva}><meshBasicMaterial color="#934e60" wireframe transparent opacity={.08} /></mesh>}</group>}
    {showTeeth && props.layers.original && (props.imported && !fragment ? <group><mesh geometry={props.imported}><meshStandardMaterial color={props.imported.getAttribute('color') ? '#ffffff' : '#d8dbd6'} vertexColors={Boolean(props.imported.getAttribute('color'))} roughness={.65} side={THREE.DoubleSide} transparent={props.sourceOpacity < 100} opacity={props.sourceOpacity / 100} /></mesh>{props.wireframe && <mesh geometry={props.imported}><meshBasicMaterial color="#7a8f9d" wireframe transparent opacity={.18} /></mesh>}</group> : toothIds.map((id, index) => fragment && index !== firstIndex ? null : <group key={id} position={fragment ? [0, 0, 0] : toothPosition(index)} rotation={[0, fragment ? 0 : (index - 6.5) * .215, 0]}>
      {fragment && props.layers.gum && <mesh position={[0, -2.4, 0]} scale={[2.8, 2.3, 3]}><sphereGeometry args={[1, 32, 24]} /><meshPhysicalMaterial color="#d28b8c" roughness={.5} clearcoat={.16} /></mesh>}
      <mesh geometry={crowns[index]} onClick={event => { event.stopPropagation(); if (!props.layerLocks.original) props.onSelect(id); }}><meshPhysicalMaterial vertexColors color="#ffffff" roughness={.4} metalness={0} clearcoat={.2} clearcoatRoughness={.3} transparent={props.sourceOpacity < 100} opacity={props.sourceOpacity / 100} /></mesh>
      {props.wireframe && <mesh geometry={crowns[index]}><meshBasicMaterial color="#82939b" wireframe transparent opacity={.12} /></mesh>}
      {layout.supports.includes(index) && props.layers.supports && <Html center position={[0, -4.7, 0]}><span className="support-tooth-label">{id} · опора</span></Html>}
    </group>))}
    {showTeeth && !fragment && props.layers.target && props.targetImported && <mesh geometry={props.targetImported} matrixAutoUpdate={false} matrix={props.targetTransform ?? new THREE.Matrix4()}><meshStandardMaterial color="#6da5a2" transparent opacity={props.opacity / 100} side={THREE.DoubleSide} depthWrite={false} /></mesh>}
    {showTeeth && !props.imported && props.layers.supports && !fragment && layout.supports.map(index => <mesh key={`support-${index}`} geometry={crowns[index]} position={toothPosition(index)} rotation={[0, (index - 6.5) * .215, 0]} scale={1.013}><meshStandardMaterial color="#6e9cba" transparent opacity={props.layerOpacities.supports / 100} depthWrite={false} /></mesh>)}
    <group ref={props.guideRef} name="guide-frame" visible={showGuide} position={[pose.x, lifted + pose.y, pose.z]} rotation={[pose.rx, pose.ry, pose.rz]}>
      {layout.working.length > 0 && <mesh geometry={guideGeometry}><meshPhysicalMaterial color="#edc832" roughness={.28} metalness={0} clearcoat={.3} transparent={props.guideOpacity < 100} opacity={props.guideOpacity / 100} side={THREE.DoubleSide} depthWrite={props.guideOpacity === 100} /></mesh>}

        {showBur && <group ref={bur}>
        {props.settings.totalLength > props.settings.length && <mesh position={[0, (props.settings.totalLength - props.settings.length) / 2, 0]}><cylinderGeometry args={[props.settings.shaft / 2, props.settings.shaft / 2, props.settings.totalLength - props.settings.length, 32]} /><meshStandardMaterial color="#b9c3ca" metalness={.85} roughness={.22} transparent={props.layerOpacities.bur < 100} opacity={props.layerOpacities.bur / 100} /></mesh>}
        <mesh position={[0, -props.settings.length / 2, 0]}><cylinderGeometry args={[props.settings.diameter / 2, props.settings.diameter / 2 * (props.settings.profile === 1 ? 1 : .7), props.settings.length, 32]} /><meshStandardMaterial color={props.collision && props.settings.angle > 15 ? '#ef6b57' : '#87929a'} metalness={.8} roughness={.65} transparent={props.layerOpacities.bur < 100} opacity={props.layerOpacities.bur / 100} /></mesh>
        {props.settings.stopperEnabled === 1 && stopper && <mesh position={[0, -props.settings.stopperPosition, 0]} geometry={stopper}><meshStandardMaterial color="#aab5bf" metalness={.9} roughness={.25} side={THREE.DoubleSide} transparent={props.layerOpacities.bur < 100} opacity={props.layerOpacities.bur / 100} /></mesh>}
        </group>}
      {props.layers.channels && channels.map(channel => <Line key={channel.key} points={channel.points} color="#8fadb8" transparent opacity={props.layerOpacities.channels / 100} lineWidth={2} />)}
      {slots.length > 0 && props.selected.length > 0 && props.layers.trajectory && <Line points={localPath} color="#26a9b5" lineWidth={fragment ? 3 : 2} transparent opacity={props.layerOpacities.trajectory / 100} dashed dashSize={.25} gapSize={.15} />}
      {fragment && showGuide && slots.length > 0 && props.selected.length > 0 && <group>
        {[12, 32, 52].map(step => {
          const tangent = localPath[step + 1].clone().sub(localPath[step - 1]).normalize();
          return <mesh key={`direction-${step}`} position={localPath[step]} quaternion={new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent)}><coneGeometry args={[.23, .65, 16]} /><meshBasicMaterial color="#287f91" /></mesh>;
        })}
        {[0, 32, 64].map((step, index) => <group key={step} position={localPath[step]}><mesh><sphereGeometry args={[.13, 12, 12]} /><meshBasicMaterial color="#287f91" /></mesh><Html center position={[index === 1 ? 3.6 : 4, index === 1 ? 1.7 : .4, 0]}><span className="channel-label">{['① Передний вход', '② Через верх', '③ Задний выход'][index]}</span></Html><Line points={[[0, 0, 0], [index === 1 ? 3.3 : 3.7, index === 1 ? 1.7 : .4, 0]]} color="#287f91" lineWidth={1} /></group>)}
        <Html center position={[-3.8, .6, 0]}><span className="channel-label base-label">Цельная нижняя часть</span></Html>
      </group>}
    </group>


  </group>;
}
function CameraControl({ view, mode, tool, command }: { view: string; mode: DisplayMode; tool: CadTool; command: CameraAction }) {
  const controls = useRef<any>(null);
  const scene = useThree(state => state.scene);
  useEffect(() => {
    if (!controls.current) return;
    const camera = controls.current.object;
    const fragment = mode === 'fragment';
    const distance = fragment ? 22 : view === 'Окклюзионный' ? 54 : 72;
    const target = new THREE.Vector3(0, mode === 'detached' ? 8 : 2, fragment ? 0 : 2);
    const direction = new THREE.Vector3(...(view === 'Сверху' || view === 'Окклюзионный' ? [0, 1, .001] : view === 'Спереди' ? [0, .15, 1] : view === 'Сбоку' ? [1, .12, .12] : view === 'Сзади / изнутри' ? [0, .22, -1] : [.22, .72, .8]) as [number, number, number]).normalize();
    camera.position.copy(target.clone().addScaledVector(direction, distance));
    controls.current.target.copy(target); controls.current.update();
  }, [view, mode]);
  useEffect(() => {
    if (!controls.current || command.id === 0) return;
    const control = controls.current;
    const camera = control.object;
    const direction = camera.position.clone().sub(control.target).normalize();
    if (command.action === 'zoom-in' || command.action === 'zoom-out') {
      const distance = camera.position.distanceTo(control.target) * (command.action === 'zoom-in' ? .8 : 1.25);
      camera.position.copy(control.target.clone().addScaledVector(direction, Math.max(5, Math.min(180, distance))));
    } else if (command.action === 'reset') {
      control.target.set(0, 2, mode === 'fragment' ? 0 : 2);
      camera.position.copy(control.target.clone().addScaledVector(new THREE.Vector3(.22, .72, .8).normalize(), mode === 'fragment' ? 22 : 72));
    } else {
      const bounds = new THREE.Box3();
      scene.getObjectByName('cad-model')?.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        let parent: THREE.Object3D | null = object;
        while (parent) { if (!parent.visible) return; parent = parent.parent; }
        object.updateWorldMatrix(true, false);
        if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
        if (object.geometry.boundingBox) bounds.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));
      });
      if (!bounds.isEmpty()) {
        const center = bounds.getCenter(new THREE.Vector3());
        const size = bounds.getSize(new THREE.Vector3());
        const verticalFov = camera.fov * Math.PI / 180;
        const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
        const distance = size.length() / (2 * Math.tan(Math.min(verticalFov, horizontalFov) / 2)) * 1.08;
        control.target.copy(center); camera.position.copy(center.addScaledVector(direction, distance));
      }
    }
    control.update();
  }, [command, scene, mode]);
  return <OrbitControls ref={controls} makeDefault minDistance={5} maxDistance={200} target={[0, 2, 2]} mouseButtons={{ LEFT: tool === 'pan' ? THREE.MOUSE.PAN : tool === 'zoom' ? THREE.MOUSE.DOLLY : THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }} />;
}
function SectionPlane({ enabled, offset }: { enabled: boolean; offset: number }) {
  const renderer = useThree(state => state.gl);
  useEffect(() => {
    renderer.localClippingEnabled = true;
    renderer.clippingPlanes = enabled ? [new THREE.Plane(new THREE.Vector3(1, 0, 0), -offset)] : [];
    return () => { renderer.clippingPlanes = []; };
  }, [renderer, enabled, offset]);
  return null;
}
function ContextMonitor() {
  const [lost, setLost] = useState(false);
  const renderer = useThree(state => state.gl);
  useEffect(() => {
    const element = renderer.domElement;
    const onLost = (event: Event) => { event.preventDefault(); setLost(true); };
    element.addEventListener('webglcontextlost', onLost);
    return () => element.removeEventListener('webglcontextlost', onLost);
  }, [renderer]);
  if (lost) throw new Error('WebGL context lost: графический драйвер прервал отрисовку.');
  return null;
}

export default function Workspace(props: Props) {
  const [lightweight, setLightweight] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [guidePose, setGuidePose] = useState<GuidePose>(identityGuidePose);
  const { mode, translucent } = props;
  const posed = { ...props, guidePose };
  return <div className="geometry-workspace"><ErrorBoundary scope="viewer" onRetry={() => { setLightweight(true); setAttempt(current => current + 1); }}><Canvas key={attempt} shadows={!lightweight} dpr={lightweight ? 1 : [1, 1.5]} camera={{ position: [34, 36, 49], fov: 40 }} gl={{ antialias: !lightweight, powerPreference: 'default' }} fallback={<div className="recovery-screen viewer-recovery"><div className="recovery-card"><h2>WebGL недоступен</h2><p>Для интерактивной 3D-сцены нужен WebGL 2. Включите аппаратное ускорение в настройках браузера и перезапустите его.</p></div></div>}>
    <color attach="background" args={['#181d23']} />
    <ambientLight intensity={1.8} /><directionalLight position={[15, 40, 20]} intensity={3} castShadow /><directionalLight position={[-30, 20, -10]} intensity={1.4} />
    <Suspense fallback={null}><Model {...posed} mode={mode} translucent={translucent} />{!lightweight && <ContactShadows resolution={256} position={[0, props.layers.roots && !props.imported ? -16 : -8, 0]} opacity={.28} scale={85} blur={2.5} far={20} />}<Grid position={[0, props.layers.roots && !props.imported ? -16.1 : -8.1, 0]} args={[160, 160]} cellSize={5} cellThickness={.4} cellColor="#2d353f" sectionSize={25} sectionThickness={.6} sectionColor="#414c59" fadeDistance={110} infiniteGrid /><GizmoHelper alignment="bottom-right" margin={[55, 112]}><GizmoViewport axisColors={['#b97873', '#78a18c', '#7a98b0']} labelColor="#e2e9ef" hideNegativeAxes /></GizmoHelper><CameraControl view={props.view} mode={mode} tool={props.tool} command={props.cameraAction} /><SectionPlane enabled={props.sectionEnabled} offset={props.sectionOffset} /><ContextMonitor /></Suspense>
  </Canvas></ErrorBoundary><div className="geometry-controls"><div className="geometry-views">{['Спереди', 'Сбоку', 'Сверху', 'Сзади / изнутри', 'Окклюзионный'].map(view => <button key={view} className={(props.view) === view ? 'active' : ''} onClick={() => props.onViewChange(view)}>{view}</button>)}</div><span className="geometry-caption">Направляющий задаёт систему координат бора. Зубы эту ориентацию не задают.</span></div><div className="geometry-views"><button onClick={() => setGuidePose(identityGuidePose)}>Напр. спереди</button><button onClick={() => setGuidePose({ ...identityGuidePose, ry: Math.PI })}>Сзади</button><button onClick={() => setGuidePose({ ...identityGuidePose, ry: Math.PI / 2 })}>Сбоку</button><button onClick={() => setGuidePose({ ...identityGuidePose, rx: -Math.PI / 2 })}>Сверху</button><button onClick={() => setGuidePose(current => ({ ...current, y: current.y + 1 }))}>Выше</button><button onClick={() => setGuidePose(current => ({ ...current, y: current.y - 1 }))}>Ниже</button><button onClick={() => setGuidePose(current => ({ ...current, rz: current.rz + Math.PI / 12 }))}>Поворот</button></div></div>;
}
