export type LayerId = 'original' | 'gum' | 'roots' | 'bone' | 'pulp' | 'nerves' | 'target' | 'preparation' | 'supports' | 'guide' | 'channels' | 'trajectory' | 'bur';
export type LayerVisibility = Record<LayerId, boolean>;
export type LayerValues = Record<LayerId, number>;
export type LayerLocks = Record<LayerId, boolean>;
export type Availability = Record<LayerId, { available: boolean; reason?: string }>;
export const initialVisibility: LayerVisibility = { original: true, gum: true, roots: false, bone: false, pulp: false, nerves: false, target: false, preparation: false, supports: true, guide: true, channels: false, trajectory: true, bur: true };
export const initialOpacity: LayerValues = { original: 100, gum: 100, roots: 100, bone: 60, pulp: 100, nerves: 100, target: 35, preparation: 65, supports: 40, guide: 55, channels: 70, trajectory: 100, bur: 100 };
export const initialLocks: LayerLocks = { original: false, gum: false, roots: false, bone: false, pulp: false, nerves: false, target: false, preparation: false, supports: false, guide: false, channels: false, trajectory: false, bur: false };
export const layerGroups: { title: string; layers: { id: LayerId; label: string; swatch: string }[] }[] = [
  { title: 'АНАТОМИЯ', layers: [
    { id: 'original', label: 'Зубы', swatch: 'ivory' }, { id: 'gum', label: 'Десна', swatch: 'rose' },
    { id: 'roots', label: 'Корни', swatch: 'ivory' }, { id: 'bone', label: 'Альвеолярная кость', swatch: 'bone' },
    { id: 'pulp', label: 'Пульпа / корневые каналы', swatch: 'rose' },
    { id: 'nerves', label: 'Нервы', swatch: 'orange' },
  ] },
  { title: 'ПРОЕКТИРОВАНИЕ', layers: [
    { id: 'target', label: 'Target / Wax-up', swatch: 'teal' }, { id: 'preparation', label: 'Зона препарирования', swatch: 'orange' },
    { id: 'supports', label: 'Опорные зубы', swatch: 'blue' }, { id: 'guide', label: 'Направляющая конструкция', swatch: 'yellow' },
    { id: 'channels', label: 'Каналы для бора', swatch: 'slate' }, { id: 'trajectory', label: 'Траектории бора', swatch: 'cyan' },
    { id: 'bur', label: 'Бор и стоппер', swatch: 'slate' },
  ] },
];
export const presets = [
  { id: 'clinical', label: 'Клинический', description: 'Зубы + десна', layers: ['original', 'gum'] },
  { id: 'teeth', label: 'Зубы', description: 'Только зубы', layers: ['original'] },
  { id: 'anatomy', label: 'Корни · демо', description: 'Демонстрационные корни и зубы · не данные пациента', layers: ['original', 'gum', 'roots'] },
  { id: 'preparation', label: 'Препарирование', description: 'Исходная поверхность + Target', layers: ['original', 'target', 'preparation'] },
  { id: 'guide', label: 'Guide', description: 'Зубы + опоры + шаблон', layers: ['original', 'supports', 'guide'] },
  { id: 'navigation', label: 'Навигация', description: 'Шаблон + каналы + траектория', layers: ['original', 'guide', 'supports', 'channels', 'trajectory', 'bur'] },
] as const;

export function availableLayers(imported: boolean, target: boolean, hasGuide: boolean): Availability {
  const cbct = { available: false, reason: 'Нет CBCT и сегментированных внутренних структур' };
  return {
    original: { available: true }, gum: { available: !imported, reason: 'В загруженном STL / PLY нет раздельной сегментации десны' },
    roots: { available: !imported, reason: 'Демо-корни доступны только на демо-челюсти, не на скане пациента' }, bone: cbct, pulp: cbct, nerves: cbct, target: { available: target, reason: 'Загрузите Target Model (STL / PLY)' },
    preparation: { available: false, reason: 'Нет рассчитанной зоны препарирования' },
    supports: { available: hasGuide && !imported, reason: imported ? 'Нет сегментации зубов в исходном скане' : 'Выберите рабочие зубы' },
    guide: { available: hasGuide, reason: 'Выберите рабочие зубы' }, channels: { available: hasGuide, reason: 'Нет рассчитанных направляющих' },
    trajectory: { available: hasGuide, reason: 'Выберите рабочий зуб' }, bur: { available: hasGuide, reason: 'Выберите рабочий зуб' },
  };
}
