# YU-Prep — изменения 3D PoC

## Выполнено
- В форме импорта убраны демонстрационные имена STL/PLY: до загрузки явно показывается «Не загружен».
- Управление «Прозрачность Target» теперь напрямую применяется к загруженной Target-модели в 3D-сцене.
- В описании этапа навигационных шаблонов зафиксировано соответствие концепции ТЗ: два сопряжённых шаблона. При этом текущий PoC честно показывает единую параметрическую оболочку; раздельная генерация двух STL оставлена для этапа геометрического ядра.

## Важно
Это изменения визуального PoC. Best Fit, реальный анализ Original/Target, heatmap толщины, коллизии, оптимизация траектории и полноценная генерация двух клинических шаблонов по-прежнему требуют вычислительного ядра.

## Проверка сборки
Локальная сборка в текущей среде не подтверждена: зависимости `node_modules` отсутствуют, а установка npm не завершилась в отведённое время. Поэтому статус `build passed` не заявляется.

## v4 — first geometric core step
- Added deterministic point-to-point rigid ICP Best Fit for uploaded Original/Target meshes.
- Registration preserves mesh coordinates (no automatic centering or scaling).
- Target preview now receives the calculated rigid transform.
- UI reports RMSE, iterations, sampled points and convergence state.
- Heatmap, preparation depth/volume, collision, trajectory optimization and clinical validation remain intentionally unimplemented.
