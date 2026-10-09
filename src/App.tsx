import { useEffect, useRef, useState } from 'react';
import './cad.css';
import * as THREE from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { ArrowLeft, ArrowRight, Box, Check, ChevronDown, ChevronRight, CircleHelp, Download, Eye, EyeOff, FileBox, FolderOpen, Layers, Maximize, MousePointer2, Move, Play, Plus, RotateCcw, Save, ScanLine, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Square, Target, Upload, X, ZoomIn, ZoomOut } from 'lucide-react';
import Workspace, { type CameraAction, type CadTool, type DisplayMode, type Settings } from './Workspace';
import LayersPanel from './LayersPanel';
import { availableLayers, initialLocks, initialOpacity, initialVisibility, presets, type LayerId, type LayerLocks, type LayerValues, type LayerVisibility } from './cadLayers';
import { PanelRightClose, PanelRightOpen, Crosshair, Rotate3D, Sliders, Scissors } from 'lucide-react';
import { toothIds } from './geometry';
import { contactLayout, contactSlots, guideLayout, type SlotCounts } from './guideGeometry';
import { bestFitRigid, type BestFitResult } from './bestFit';

const stages = ['Модели', 'Препарирование', 'Бор и стоппер', 'Траектория', 'Шаблоны', 'Валидация'];
const initial: Settings = { diameter: 1.6, length: 6, shaft: 1.6, totalLength: 19, stopper: 4.5, stopperInner: 1.7, stopperShape: 0, stopperEnabled: 1, stopperHeight: 1, stopperPosition: 5, clearance: .15, wall: 1.5, angle: 0, profile: 0 };
function Numeric({ label, value, onChange, min = .1, max = 40, step = .1, unit = 'мм' }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number; unit?: string }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const parsed = Number(draft.replace(',', '.'));
  const valid = draft.trim() !== '' && Number.isFinite(parsed) && parsed >= min && parsed <= max;
  return <label className="numeric"><span>{label}</span><div><input type="text" inputMode="decimal" aria-label={label} aria-invalid={!valid} title={`Ручной ввод: ${min}–${max} ${unit}, шаг ${step}`} value={draft} onChange={event => {
    const next = event.target.value;
    setDraft(next);
    const number = Number(next.replace(',', '.'));
    if (next.trim() !== '' && Number.isFinite(number) && number >= min && number <= max) onChange(number);
  }} onBlur={() => { if (!valid) setDraft(String(value)); }} /><small>{unit}</small></div></label>;
}
function ToothSelection({ selected, onToggle, onClear }: { selected: number[]; onToggle: (id: number) => void; onClear: () => void }) {
  return <div className="treatment-selector"><div className="treatment-heading"><b>Обрабатываемые зубы</b><span>FDI · {selected.length}</span></div><div className="treatment-grid">{toothIds.map(id => <button key={id} className={selected.includes(id) ? 'active' : ''} aria-pressed={selected.includes(id)} onClick={() => onToggle(id)}>{id}</button>)}</div><div className="treatment-summary"><span>{selected.length ? [...selected].sort((first, second) => first - second).join(', ') : 'Выберите зубы для шаблона'}</span><button onClick={onClear} disabled={!selected.length}>Снять выбор</button></div><p>Направляющие — у обоих контактов выбранных зубов. Один шаблон фиксируется на крайних опорных зубах.</p></div>;
}
export default function App() {
  const [stage, setStage] = useState(2);
  const [settings, setSettings] = useState(initial);
  const [selected, setSelected] = useState([33, 32, 31, 41, 42, 43]);
  const [activeTooth, setActiveTooth] = useState(31);
  const [slotCounts, setSlotCounts] = useState<SlotCounts>({});
  const [activeSlot, setActiveSlot] = useState(0);
  const [templatePreview, setTemplatePreview] = useState<'A' | 'B' | 'both'>('A');
  const burTooth = selected.includes(activeTooth) ? activeTooth : selected[0] ?? null;
  const [layers, setLayers] = useState<LayerVisibility>(initialVisibility);
  const [layerOpacities, setLayerOpacities] = useState<LayerValues>(initialOpacity);
  const [layerLocks, setLayerLocks] = useState<LayerLocks>(initialLocks);
  const [activeLayer, setActiveLayer] = useState<LayerId>('guide');
  const [sidebarTab, setSidebarTab] = useState<'layers' | 'parameters'>('layers');
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [activePreset, setActivePreset] = useState('custom');
  const [cadTool, setCadTool] = useState<CadTool>('rotate');
  const [cameraAction, setCameraAction] = useState<CameraAction>({ id: 0, action: 'fit' });
  const [sectionEnabled, setSectionEnabled] = useState(false);
  const [sectionOffset, setSectionOffset] = useState(0);
  const guide = 1;
  const [displayMode, setDisplayMode] = useState<DisplayMode>('installed');
  const translucent = layerOpacities.guide < 100;
  const sourceOpacity = layerOpacities.original;
  const guideOpacity = layerOpacities.guide;
  const setTranslucent = (next: boolean) => setLayerOpacities(current => ({ ...current, guide: next ? 55 : 100 }));
  const setSourceOpacity = (value: number) => setLayerOpacities(current => ({ ...current, original: value }));
  const setGuideOpacity = (value: number) => setLayerOpacities(current => ({ ...current, guide: value }));
  const [wireframe, setWireframe] = useState(false);
  const [heatmap, setHeatmap] = useState(false);
  const [collision, setCollision] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(40);
  const [view, setView] = useState('Перспектива');
  const [construction, setConstruction] = useState('Коронка');
  const [modal, setModal] = useState('');
  const [toast, setToast] = useState('');
  const [validated, setValidated] = useState(false);
  const [imported, setImported] = useState<THREE.BufferGeometry | null>(null);
  const [targetImported, setTargetImported] = useState<THREE.BufferGeometry | null>(null);
  const [bestFit, setBestFit] = useState<BestFitResult | null>(null);
  const [bestFitBusy, setBestFitBusy] = useState(false);
  const [files, setFiles] = useState({ original: 'Не загружен', target: 'Не загружен' });
  const opacity = layerOpacities.target;
  const setOpacity = (value: number) => setLayerOpacities(current => ({ ...current, target: value }));
  const [project, setProject] = useState('Нижняя дуга · 33–43');
  const guideRef = useRef<THREE.Group>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const layout = guideLayout(selected);
  const availability = availableLayers(Boolean(imported), Boolean(targetImported), selected.length > 0);
  const contacts = contactLayout(settings, selected);
  const burSlots = burTooth === null ? [] : contactSlots(settings, burTooth);
  const effectiveSlot = Math.min(activeSlot, Math.max(0, burSlots.length - 1));
  const parameterIssues = [
    selected.some(id => contactSlots(settings, id).length < 2) ? 'Для выбранного зуба недоступны оба контакта: проверьте соседние зубы и ширину инструмента.' : '',
    selected.length > 0 && layout.supports.length < 2 ? 'Для фиксации нужны неперепарируемые опорные зубы с обеих сторон рабочей зоны.' : '',
    settings.totalLength <= settings.length ? 'Общая длина бора должна быть больше длины рабочей части.' : '',
    settings.stopperInner < settings.shaft ? 'Внутренний диаметр стоппера меньше диаметра хвостовика.' : '',
    settings.stopperInner >= settings.stopper ? 'Наружный диаметр стоппера должен быть больше внутреннего.' : '',
    settings.stopper < settings.shaft + settings.clearance * 2 ? 'Стоппер не перекрывает ширину прорези.' : '',
    settings.shaft + settings.clearance * 2 > 4.05 ? 'Контактные прорези такой ширины сливаются. Уменьшите диаметр инструмента или зазор.' : '',
    settings.stopperPosition > settings.length ? 'Положение стоппера выходит за длину рабочей части.' : '',
    !settings.stopperEnabled ? 'Стоппер отключён: ограничение глубины отсутствует.' : '',
    !selected.length ? 'Не выбраны обрабатываемые зубы.' : '',
    settings.angle > 15 ? 'Превышен демонстрационный порог наклона 15°.' : '',
  ].filter(Boolean);
  const unsafe = parameterIssues.length > 0;
  const notify = (text: string) => { setToast(text); window.setTimeout(() => setToast(''), 4500); };
  const update = (key: keyof Settings, value: number) => {
    if (layerLocks.guide || layerLocks.bur) { notify('Guide или инструмент заблокирован. Снимите блокировку в панели слоёв.'); return; }
    setSettings(current => ({ ...current, [key]: value })); setValidated(false);
  };
  const toggleTooth = (id: number) => {
    if (layerLocks.guide) { notify('Guide заблокирован. Снимите блокировку, чтобы изменить рабочие зубы.'); return; }
    setSelected(current => current.includes(id) ? current.filter(tooth => tooth !== id) : [...current, id]); setValidated(false);
  };
  const moveBur = (id: number) => {
    if (!selected.includes(id)) return;
    setActiveTooth(id);
    setActiveSlot(0);
    setPlaying(false);
    setProgress(50);
  };
  const toggleLayer = (key: LayerId) => {
    if (!availability[key].available) return;
    if (key === 'roots' && !layers.roots) setLayerOpacities(current => ({ ...current, gum: Math.min(current.gum, 25) }));
    setLayers(current => ({ ...current, [key]: !current[key] }));
    setDisplayMode('installed');
    setActivePreset('custom');
  };
  const applyPreset = (id: string) => {
    const preset = presets.find(item => item.id === id);
    if (!preset || id === 'anatomy' && imported || id === 'teeth' && imported || id === 'preparation' && !targetImported) return;
    const names: readonly string[] = preset.layers;
    setLayers(Object.fromEntries(Object.keys(initialVisibility).map(key => [key, names.includes(key) && availability[key as LayerId].available])) as LayerVisibility);
    setDisplayMode('installed'); setActivePreset(id);
    if (id === 'anatomy') { setLayerOpacities(current => ({ ...current, gum: 20, original: 75, roots: 100 })); setView('Спереди'); cameraCommand('fit'); }
  };
  const cameraCommand = (action: CameraAction['action']) => setCameraAction(current => ({ id: current.id + 1, action }));
  const toggleTransparency = () => {
    if (!availability[activeLayer].available) return;
    setLayerOpacities(current => ({ ...current, [activeLayer]: current[activeLayer] === 100 ? 45 : 100 }));
  };
  const save = () => { localStorage.setItem('yu-prep-project', JSON.stringify({ settings, selected, slotCounts, project, construction })); notify('Версия проекта сохранена локально'); };
  const exportSTL = () => {
    if (!validated || unsafe) { setStage(5); notify('Сначала выполните проверку геометрии'); return; }
    const frame = guideRef.current;
    if (!frame) { notify('Направляющий не найден в сцене'); return; }
    frame.updateMatrixWorld(true);
    // Корпус направляющего — Mesh, прямой потомок guide-frame (бор и линии лежат в других дочерних объектах)
    const body = frame.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh);
    if (!body?.geometry) { notify('Корпус направляющего не найден'); return; }
    const geometry = body.geometry.clone();
    geometry.applyMatrix4(body.matrixWorld);
    const exportMesh = new THREE.Mesh(geometry);
    const data = new STLExporter().parse(exportMesh, { binary: true });
    geometry.dispose();
    const url = URL.createObjectURL(new Blob([data], { type: 'application/octet-stream' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'YU-024_Contacts_prototype.stl'; anchor.click(); URL.revokeObjectURL(url); save();
  };
