# Space Y — технический документ текущего состояния игры

Дата аудита: 2026-06-27  
Проект: `starframe-arena-mvp` / Space Y  
Статус: локальный Next.js/Pixi прототип мобильной 2D action-builder игры.

## 1. Краткое состояние

На текущий момент реализован клиентский прототип без backend-части. В игре есть:

- главный экран с живой Pixi-сценой;
- ангар со сборкой корабля из панелей и модулей;
- локальная арена боя с управлением движением, автооружием, врагами, снарядами, коллизиями, VFX и аудио;
- сохранение сборки в localStorage через Zustand persist;
- набор базовых игровых данных: 4 фрейма, 25 панелей, 13 модулей;
- ассетные атласы модулей, оружия, VFX, фонов, UI и AI-generated ассетов;
- вспомогательные скрипты генерации/нормализации ассетов.

Не реализованы как реальные игровые системы:

- миссии/контракты;
- кабины, экипаж, груз, бурение, salvage, market;
- полноценная экономика, инвентарь, research, battle pass;
- Telegram Mini App, social/viral mechanics;
- аккаунты, сервер, синхронизация, PvP, matchmaking;
- permanent progression;
- модульные повреждения с потерей конкретных деталей.

## 2. Технологическая основа

Основной стек:

- Next.js `16.2.9`;
- React `19.2.7`;
- Pixi.js `8.19.0`;
- Zustand `5.0.14`;
- animejs `4.5.0`;
- TypeScript strict mode;
- Node/sharp-скрипты для генерации ассетов.

Скрипты из `package.json`:

- `npm run dev` — запуск Next.js dev server;
- `npm run build` — production build;
- `npm run typecheck` — `tsc --noEmit`.

`next.config.ts` включает `typedRoutes: true`.

## 3. Маршруты и экраны

### `/`

Файл: `app/page.tsx`  
Главный экран. Рендерит `HomeSceneCanvas` и две кнопки:

- `Бой` -> `/battle`;
- `Ангар` -> `/hangar`.

Это не маркетинговая страница, а интерактивная заставка на Pixi.

### `/hangar`

Файл: `app/hangar/page.tsx`  
Основной экран сборки корабля:

- мобильный фрейм;
- верхняя панель со статами;
- grid-сцена сборки;
- зум и панорамирование;
- переключатель слоев `Panels` / `Modules`;
- drawer со списком доступных панелей или модулей;
- drag/drop из палитры и drag/drop уже установленных элементов;
- кнопки `Rotate`, `Reset`, `Test Battle`.

### `/battle`

Файл: `app/battle/page.tsx`  
Боевой экран:

- динамически импортирует `BattleCanvas` без SSR;
- берет текущую сборку из Zustand;
- считает статы;
- запускает локальный бой;
- при победе добавляет `+65 scrap`;
- показывает result panel `Victory` / `Ship Destroyed`.

### `/ui-kit`

Файл: `app/ui-kit/page.tsx`  
Демо-экран UI-ассетов:

- кнопки;
- input/select/checkbox;
- progress/slider;
- popup;
- bottom nav;
- reference images и scale9 kit.

## 4. Модель данных

Основные типы находятся в `game/types.ts`.

### ModuleType

Поддерживаются типы модулей:

- `core`;
- `hull`;
- `armor`;
- `engine`;
- `weapon`;
- `reactor`;
- `battery`;
- `shield`;
- `utility`.

### DamageType

Поддерживаются типы урона:

- `kinetic`;
- `explosive`;
- `energy`;
- `plasma`;
- `emp`;
- `thermal`;
- `piercing`.

В текущем бою реально используются в основном:

- kinetic;
- explosive;
- energy;
- plasma.

### SocketType

Типы сокетов описаны в данных модулей:

- `none`;
- `hard`;
- `power`;
- `weapon`;
- `engine`;
- `utility`.

Важно: сокеты пока почти не участвуют в правилах установки. Они заданы в `ModuleDef`, но `canInstallModule` проверяет не socket-совместимость, а наличие панели, лимиты и занятость ячеек.

### BuildMode

Ангар работает в двух слоях:

- `panels`;
- `modules`.

### PanelState

Панель может иметь состояние:

- `ideal`;
- `damaged`;
- `critical`;
- `debris`.

В текущей сборке новые панели всегда ставятся как `ideal`. Система изменения состояния панелей в бою не реализована.

### ShipBuild

Сборка корабля состоит из:

- `frameId`;
- массива `panels`;
- массива `modules`;
- имени и id билда.

## 5. Игровые данные

### Фреймы

Файл: `game/data/frames.ts`  
Реализовано 4 фрейма:

- `scout_frame`;
- `enemy_drone_frame`;
- `enemy_raider_frame`;
- `enemy_bomber_frame`.

Фрейм содержит:

- размеры grid;
- список `activeCells`;
- базовую массу;
- базовое HP;
- лимиты модулей, оружия, реакторов;
- максимальную массу.

Ограничение: `activeCells` сейчас фактически не используется при установке панелей. `canInstallPanel` проверяет границы прямоугольной сетки фрейма, но не проверяет попадание в `activeCells`.

### Панели

Файл: `game/data/panels.ts`  
Реализовано 25 панелей:

- одиночные node-панели;
- рельсы 2-5 клеток;
- вертикальные spine-панели;
- 2x2 блоки;
- L/J/corner формы;
- T-формы;
- Z/S формы;
- cross/U/arrow/blade/wide/hull формы.

Панели имеют:

- shape;
- массу;
- HP;
- spriteIndex;
- набор connector edge ids.

Connector ids генерируются автоматически из формы и seed:

- вертикальные семейства: `V1`-`V5`;
- горизонтальные семейства: `H1`-`H5`.

### Модули

Файл: `game/data/modules.ts`  
Реализовано 13 модулей:

- `core_mk1`;
- `hull_block`;
- `hull_bridge_2x1`;
- `light_armor`;
- `ion_engine`;
- `plasma_thruster`;
- `side_thruster`;
- `small_reactor`;
- `autocannon`;
- `laser_turret`;
- `plasma_cannon`;
- `missile_pod`;
- `shield_generator`.

Модули описывают:

- форму;
- массу;
- HP;
- энергию;
- тепло;
- thrust/maneuverThrust;
- weapon params;
- shield params;
- sprite id/tags.

## 6. Стартовая сборка

Файл: `game/data/defaultBuild.ts`  
Стартовый билд: `Starter Scout`.

Стартовые панели:

- `spine_4` в центре;
- 4 `node_plate` под оружие, щит и двигатели.

Стартовые модули:

- core;
- reactor;
- 2 ion engines;
- autocannon;
- laser turret;
- shield generator;
- hull block.

Этот билд сразу боеспособен и используется как дефолтное состояние persisted store.

## 7. Правила сборки

Файл: `game/ship/build.ts`

### Общие функции

Реализованы:

- поиск фрейма/модуля/панели по id;
- поворот ячеек на 0/90/180/270;
- преобразование shape в world grid cells;
- поиск занятой ячейки модуля;
- поиск занятой ячейки панели;
- получение всех buildable panel cells;
- получение connector edge keys.

### Установка панелей

`canInstallPanel` проверяет:

- не выходит ли панель за прямоугольные границы фрейма;
- не пересекается ли с уже установленными панелями;
- первая панель должна покрывать центральную клетку;
- последующие панели должны иметь хотя бы одно соприкосновение с существующей панелью;
- на каждом соприкасающемся edge должен совпадать connector id.

Итог: панельная система уже реализует не просто свободное рисование корпуса, а конструктор с connector-логикой.

Ограничения:

- нет лимита количества панелей;
- `activeCells` фрейма не ограничивают размещение;
- connector mismatch блокирует установку всей панели;
- нет стоимости установки;
- нет повреждения/ремонта панелей.

### Установка модулей

`canInstallModule` проверяет:

- общий лимит модулей фрейма;
- лимит оружия;
- лимит реакторов;
- каждая клетка модуля должна лежать на установленной панели;
- клетка не должна быть занята другим модулем.

Ограничения:

- socket-система не применяется;
- energy/heat/mass warnings не блокируют установку;
- модуль можно поставить на любую панельную клетку, если она свободна;
- установка бесплатна;
- нет инвентаря и количества доступных экземпляров.

## 8. Расчет характеристик

Файл: `game/ship/stats.ts`

Система считает:

- HP;
- shield;
- mass;
- thrust;
- acceleration;
- maxSpeed;
- turnRate;
- energyProduction;
- energyConsumption;
- energyBalance;
- heat;
- dps;
- warnings.

Формулы текущего прототипа:

- `mass = frame.baseMass + sum(panel.mass) + sum(module.mass)`;
- `hp = frame.baseHp + sum(panel.hp) + sum(module.hp)`;
- `thrust = sum(module.thrust)`;
- `maneuverThrust = sum(module.maneuverThrust)`;
- `energyBalance = production - consumption`;
- `heat = generation - dissipation`;
- `dps = sum(weapon.damage * weapon.fireRate)`;
- `acceleration = thrust / mass`;
- `maxSpeed = max(80, 82 + acceleration * 92 + sqrt(thrust) * 5.5)`;
- `turnRate = max(1.2, (maneuverThrust + thrust * 0.18) / max(40, mass))`.

Warnings:

- нет core;
- нет engine;
- нет reactor;
- energyBalance < 0;
- mass > frame.maxMass;
- heat > 40.

Ограничение: warnings не блокируют бой и установку. Shield считается в статах, но в боевой симуляции отдельного shield pool/regen нет.

## 9. Хранилище состояния

Файл: `game/store/shipStore.ts`

Используется Zustand + persist.

Сохраняется:

- текущая сборка;
- buildMode;
- selectedModuleId;
- selectedPanelId;
- rotation;
- scrap.

Ключ localStorage: `starframe-arena-ship`.  
Версия persist: `2`.

Действия:

- `setBuildMode`;
- `selectModule`;
- `selectPanel`;
- `rotateSelected`;
- `installModule`;
- `moveModule`;
- `removeModule`;
- `installPanel`;
- `movePanel`;
- `removePanel`;
- `resetBuild`;
- `addReward`.

Особые правила:

- при перемещении/удалении панели операция запрещается, если на ее клетках стоит модуль;
- `resetBuild` возвращает стартовую сборку, но не сбрасывает `scrap`;
- `addReward` просто увеличивает число scrap.

## 10. Ангар

Файл: `app/hangar/page.tsx`

### Основные механики

В ангаре реализованы:

- редактирование панели корпуса;
- редактирование модулей;
- выбор текущего элемента из drawer;
- установка по клику;
- удаление по клику по занятой клетке;
- drag/drop из палитры на grid;
- drag/drop уже установленного модуля/панели;
- поворот выбранного элемента;
- зум сцены;
- панорамирование сцены;
- reset билда;
- переход в бой.

### Grid

Grid строится из `frame.size.width` x `frame.size.height`.

Клетки получают классы:

- inactive;
- has-panel;
- occupied;
- valid/invalid preview;
- draggable-cell;
- panel state class.

### Preview

Preview работает отдельно для:

- panel mode: через `canInstallPanel`;
- module mode: через `canInstallModule`.

### Drag/drop

Drag/drop реализован через `createDraggable` из animejs:

- snap равен pitch grid;
- при release считается target cell;
- для palette item вызывается установка;
- для существующего item вызывается move;
- если move невозможен, состояние не меняется.

### Зум и панорамирование

Zoom steps:

- 100%;
- 115%;
- 130%;
- 150%;
- 175%.

Позиция сцены clamp-ится по размерам stage.

### UI статистики

В верхней панели отображается:

- HP;
- MASS;
- SPD;
- DPS.

В drawer summary отображается:

- количество панелей;
- energy balance.

## 11. Боевая арена

Файл: `components/battle/BattleCanvas.tsx`

### Инициализация

Боевой canvas:

- создается только на клиенте;
- инициализирует Pixi Application;
- грузит texture atlases;
- создает слои;
- строит корабль игрока из текущего `ShipBuild`;
- создает 4 врага;
- запускает `app.ticker`.

### Слои Pixi

Основные слои:

- background;
- farParticles;
- debris;
- ships;
- engineVfx;
- projectiles;
- impactVfx;
- explosions;
- uiWorld;
- screenVfx;
- hud.

Background дополнительно разбит на:

- deep space background;
- nebula blue;
- nebula purple;
- planets;
- far stars;
- close stars;
- asteroid debris;
- dust particles;
- battlefield grid;
- soft clouds.

### Управление игроком

Игрок управляет только движением:

- pointerdown активирует виртуальный joystick;
- pointermove задает вектор;
- pointerup сбрасывает input;
- оружие стреляет автоматически.

Клавиатурного управления нет.

### Физика движения

Функция `applyShipPhysics`:

- плавно поворачивает корабль к желаемому направлению;
- добавляет acceleration по inputPower;
- ограничивает скорость maxSpeed;
- применяет damping `0.99`;
- обновляет позицию.

Характеристики движения берутся из `calculateShipStats`.

### Игрок

Игрок создается из текущей сборки:

- HP = `stats.hp`;
- maxSpeed = `stats.maxSpeed`;
- acceleration = `max(35, stats.acceleration * 70)`;
- turnRate = `max(1.8, stats.turnRate)`.

### Враги

Создаются 4 врага:

- 2 `drone`;
- 1 `raider`;
- 1 `bomber`.

Враги имеют готовые build templates:

- Drone: core, reactor, engine, autocannon, hull;
- Raider: core, reactor, 2 engines, autocannon, laser, shield;
- Bomber: core, reactor, plasma thruster, 2 missile pods, armor, hull blocks.

AI врагов:

- выбирает направление к игроку;
- держит идеальную дистанцию;
- bomber держит большую дистанцию;
- стреляет автоматически при попадании игрока в range.

### Оружие

Оружие собирается из модулей, у которых есть `weapon`.

Поддержано:

- autocannon / kinetic projectile;
- laser / instant beam;
- plasma cannon / projectile;
- missile pod / explosive projectile.

Алгоритм игрока:

- каждый weaponState уменьшает cooldown;
- ищется ближайший живой враг в range;
- turret разворачивается к цели;
- если cooldown <= 0, оружие стреляет;
- laser сразу наносит урон;
- остальные типы создают projectile.

Алгоритм врагов аналогичный, но цель всегда игрок.

### Снаряды

Projectile содержит:

- позицию;
- previous position;
- velocity;
- owner;
- damageType;
- damage;
- radius;
- life;
- sprite;
- trail;
- smoke flag.

Каждый тик:

- life уменьшается;
- позиция обновляется;
- trail перерисовывается;
- missile/explosive оставляет smoke;
- проверяется попадание по кораблям;
- при hit создаются impact/explosion эффекты;
- projectile уничтожается.

### Коллизии

Есть две коллизионные системы:

1. ship-vs-ship collision;
2. projectile-vs-ship collision.

Коллизионные точки строятся из установленных модулей корабля. Для каждой ячейки модуля считается world point.

Ограничения:

- панели не участвуют в collision points;
- rotation установленного модуля в battle render/collision не учитывается;
- урон всегда снимается с общего HP корабля, а не с конкретной детали;
- AOE radius из weapon definition не применяется как splash damage.

### Победа и поражение

Условия:

- поражение: `player.hp <= 0`;
- победа: все враги имеют `hp <= 0`.

При завершении:

- ставится `resultRef`;
- engine audio power = 0;
- создается explosion;
- вызывается `onResult`.

`/battle` при victory добавляет `+65 scrap`.

### Визуальные состояния повреждений

Корабль имеет damage state:

- `ideal`;
- `lightDamage`;
- `heavyDamage`;
- `debris`.

Состояние зависит от доли HP:

- `>= 68%` ideal;
- `< 68%` lightDamage;
- `< 34%` heavyDamage;
- `<= 0` debris.

Damage state меняет текстуры модулей/оружия на соответствующие строки state-atlas.

### Enemy markers

Для врагов есть UI-маркеры:

- имя;
- hull percent;
- distance;
- pointer на краю экрана, если враг вне видимой области.

### Camera/background

Камера центрируется на игроке. Фоновые слои получают разные parallax factors.

Реализованы:

- screen shake;
- damage flash;
- moving tiled space background;
- planets;
- star fields;
- nebula layers;
- asteroid debris;
- dust;
- battlefield grid.

### VFX

Реализованы:

- engine glows;
- projectile trails;
- shell casings;
- impacts;
- beams;
- explosions;
- animated explosion frames;
- smoke;
- sparks;
- shockwave;
- debris particles.

### Аудио

Файл: `components/battle/BattleCanvas.tsx`

Используются HTMLAudioElement:

- engine idle loop;
- engine thrust loop;
- thruster burst;
- autocannon shot;
- laser shot;
- plasma shot;
- missile launch;
- kinetic impact;
- energy impact;
- plasma impact;
- explosive impact.

Аудио unlock происходит на pointerdown. Для one-shot звуков есть небольшой pool из 2 экземпляров и min gap.

## 12. Главная Pixi-сцена

Файл: `components/home/HomeSceneCanvas.tsx`

Главная страница содержит отдельную декоративно-интерактивную симуляцию.

### Основная идея сцены

Вокруг логотипа Space Y летают процедурные корабли, стреляют по логотипу и друг другу, создают осколки, трещины, взрывы и дым.

### Слои

Сцена использует слои:

- background;
- planets;
- farStars;
- closeStars;
- debris;
- engineVfx;
- ships;
- projectiles;
- vfx;
- logo;
- screen.

### Логотип

Используется `/assets/spacey/spacey-debris-logo.png`.

Логика:

- логотип появляется сверху через `easeOutBack`;
- измеряется alpha bounds через canvas;
- попадания считаются по эллипсу вокруг alpha bounds;
- при попадании меняется tint, добавляется shake, impact, explosion, crack и осколки.

### Корабли

Количество:

- обычный режим: 12 кораблей;
- prefers-reduced-motion: 6 кораблей.

Корабли генерируются из 4 layout templates:

- kinetic;
- laser;
- plasma;
- missile.

Каждый корабль:

- получает команду `team` 0/1/2;
- имеет позицию за краем экрана;
- летит к центральной области;
- орбитит вокруг фокуса;
- может переключать фокус между логотипом и ближайшим врагом;
- имеет weapon mounts;
- имеет engine mounts;
- использует реальные weapon definitions из `game/data/modules.ts`.

### Бой на главной сцене

Корабли:

- ищут ближайшего врага другой команды;
- иногда выбирают целью логотип;
- разворачивают турели;
- стреляют laser/projectiles;
- projectile может попасть по кораблю или логотипу;
- попадание по кораблю толкает его velocity;
- HP для кораблей главной сцены не реализовано, это визуальная симуляция без смерти.

### Осколки логотипа

При попадании создаются drifting pieces из `/assets/spacey/pieces/*.png`.

Ограничения:

- pieces ограничиваются по количеству;
- старые удаляются через `removeOldPiece`;
- трещины тоже ограничиваются количеством children.

## 13. Визуальные ассеты

Файл: `game/assets/moduleSprites.ts`

### Атласы runtime

Используются:

- `/assets/modules/modules-atlas-v2.png`;
- `/assets/modules/module-states-atlas.png`;
- `/assets/weapons/weapon-parts-atlas.png`;
- `/assets/weapons/weapon-states-atlas.png`;
- `/assets/vfx/hover-vfx-atlas.png`;
- `/assets/vfx/battle-vfx-atlas.png`;
- `/assets/generated/ai/module-ai-normalized-atlas.png`;
- `/assets/generated/ai/explosion-ai-effects-atlas.png`.

Фоновые tile-текстуры, используемые главной и боевой Pixi-сценами:

- `/assets/backgrounds/deep-space-tile-01.webp`;
- `/assets/backgrounds/deep-space-tile-02.webp`;
- `/assets/backgrounds/deep-space-tile-03.webp`;
- `/assets/backgrounds/deep-space-tile-04.webp`;
- `/assets/backgrounds/deep-space-tile-05.webp`;
- `/assets/backgrounds/deep-space-tile-06.webp`;
- `/assets/backgrounds/deep-space-tile-07.webp`;
- `/assets/backgrounds/deep-space-tile-08.webp`.

### Module sprites

Есть mapping module type/id -> sprite key:

- core -> core;
- armor -> armor;
- plasma_thruster -> plasmaThruster;
- side_thruster -> sideThruster;
- engine -> ionEngine;
- reactor/battery -> reactor;
- missile_pod -> missileHousing;
- weapon -> railgunHousing;
- shield -> shield;
- utility -> utility;
- fallback -> hull.

Для ангара используется `getAiModuleSpriteStyle`, то есть модульные карточки и клетки используют AI-normalized atlas.

### Weapon sprites

Оружие разделено на base и turret:

- autocannon;
- laser;
- plasma;
- missile.

В бою турели являются отдельными sprites и поворачиваются к цели.

### Panel sprites

`getPanelSpriteStyle` ожидает atlas:

- `/assets/panels/panel-states-atlas.png`;
- 25 columns;
- 4 rows.

Текущий риск: файл `public/assets/panels/panel-states-atlas.png` сейчас удален в рабочем дереве, поэтому визуалы панелей в ангаре могут не отображаться.

## 14. Asset pipeline

### `scripts/generate-module-state-atlases.mjs`

Генерирует state atlases для:

- modules;
- weapons.

Состояния:

- original/ideal;
- light damage;
- heavy damage;
- debris.

Использует `sharp`, SVG overlays и cutouts.

### `scripts/generate-expanded-asset-catalog.mjs`

Генерирует расширенный каталог:

- module catalog;
- frame catalog;
- vfx catalog;
- общий `asset-catalog.json`.

Текущий каталог содержит:

- 90 module assets;
- 40 frame assets;
- VFX catalog описан в `asset-catalog.json`, но отдельный `vfx-catalog-atlas.json/png` сейчас отсутствует в рабочем дереве.

Категории module catalog:

- hull;
- armor;
- engine;
- weapon_base;
- weapon_turret;
- energy;
- shield.

Состояния module catalog:

- ideal;
- light_damage;
- heavy_damage;
- debris.

### `scripts/normalize-ai-module-sheet.mjs`

Нормализует AI-generated module sheet:

- ищет alpha-components flood fill;
- фильтрует маленькие компоненты;
- сортирует по строкам;
- режет в 192px atlas cells;
- пишет manifest.

### `scripts/normalize-ai-explosion-frames.mjs`

Нормализует AI-generated VFX sheet:

- ищет alpha-components;
- группирует по animation specs;
- собирает explosion atlas 256px cells;
- пишет manifest.

### AI-generated metadata

Файл: `public/assets/generated/ai/ai-generated-assets.json`

Описаны группы:

- modules;
- frames;
- vfx.

## 15. UI и стили

Файл: `app/globals.css`

### Общая структура

Игра стилизована как мобильный portrait-прототип:

- `.app-shell`;
- `.mobile-frame`;
- `.screen`;
- `.hangar-screen`;
- `.battle-host`.

Максимальная ширина мобильного frame: `430px`.

### Шрифт

Подключен локальный Monitorica:

- Regular;
- Italic;
- Bold;
- Bold Italic.

### Цвета

Основные CSS variables:

- dark background;
- cyan;
- violet;
- orange;
- red;
- green;
- muted text.

### UI kit

Есть sprite-based UI набор:

- buttons;
- input;
- dropdown;
- checkbox;
- progress;
- slider;
- nav;
- popup/card.

## 16. Экономика и прогрессия

Реализовано только:

- поле `scrap` в Zustand store;
- награда `+65 scrap` за победу в `/battle`.

Не реализовано:

- отображение scrap в UI;
- траты scrap;
- инвентарь деталей;
- цены;
- покупка;
- ремонт;
- research;
- blueprints;
- материалы;
- currencies;
- battle pass;
- market.

## 17. Сопоставление с design docs

В корне есть проектные документы:

- `design-doc.md`;
- `design-doc2.md`;
- `freetoplay.md`;
- `battlepass.md`;
- `viral.md`.

Текущая реализация покрывает базовую MVP-часть из GDD:

- сборка корабля из деталей;
- управление движением;
- автострельба;
- враги;
- визуально заметные двигатели, снаряды, попадания, взрывы;
- связь массы/тяги/оружия со статами.

Частично покрывает обновленную формулу из `design-doc2.md`:

- панели корпуса уже существуют;
- элементы на панелях уже существуют;
- connector-логика панелей уже существует.

Не покрывает:

- кабины вместо core module;
- миссии/контракты;
- mission requirements;
- экипаж;
- грузовые/буровые/спасательные системы;
- специализированные mission builds;
- социальные Telegram-механики;
- free-to-play economy;
- battle pass/market/liveops.

## 18. Текущие технические риски

### 18.1. Удаленные ассеты, которые еще ожидаются кодом

В рабочем дереве сейчас удалены:

- `public/assets/panels/panel-states-atlas.png`;
- `public/assets/generated/vfx-catalog-atlas.json`;
- `public/assets/generated/vfx-catalog-atlas.png`;
- старые `space-tile-seamless-*.webp`, которые в текущем коде уже заменены на `deep-space-tile-*.webp`;
- несколько старых `.png` planet assets;
- `public/assets/backgrounds/planet-atlas.png`.

Критично:

- `game/assets/moduleSprites.ts` ссылается на `/assets/panels/panel-states-atlas.png`;
- `game/assets/generatedAssetCatalog.ts` импортирует `vfx-catalog-atlas.json`.

Если эти файлы не восстановить или не обновить ссылки, часть визуалов/импортов может ломаться.

### 18.2. `game/assets/generatedAssetCatalog.ts` может ломать typecheck/build

Файл импортирует отсутствующий `@/public/assets/generated/vfx-catalog-atlas.json`.

Даже если этот модуль сейчас нигде не используется, TypeScript может проверить его из-за include `**/*.ts`.

### 18.3. Панельный atlas отсутствует

Ангар использует `getPanelSpriteStyle`, но ожидаемый файл panel atlas удален.

Вероятный эффект:

- клетки панели остаются логически рабочими;
- визуальные panel sprites не загружаются.

### 18.4. Rotation неполно реализован в бою

В ангаре rotation учитывается при установке и перемещении.  
В бою `buildShipGraphic` и collision points используют `module.shape.cells` без применения `installed.rotation`.

Вероятный эффект:

- rotated multi-cell modules могут отличаться между редактором и battle render/collision.

### 18.5. Сокеты описаны, но не работают как правило сборки

Сокеты есть в `ModuleDef`, но установка модулей не проверяет socket compatibility.

### 18.6. Shield считается, но не защищает

`shield_generator` добавляет shield stat.  
В бою входящий урон снимает общий HP игрока/врага без shield pool и regeneration.

### 18.7. Energy/heat/mass warnings не блокируют действия

Статы и warnings есть, но:

- отрицательная энергия не отключает оружие;
- heat не перегревает корабль;
- превышение массы не блокирует бой;
- требования core/engine/reactor не блокируют запуск.

### 18.8. Урон не модульный

Урон применяется к общему HP корабля.  
Нет:

- hit location;
- HP конкретной детали;
- отрыва модулей;
- ремонта;
- salvage по поврежденным деталям.

### 18.9. Нет серверной авторитетности

Все состояние локальное:

- сборка;
- scrap;
- бой;
- награды.

Это нормально для прототипа, но не для production/game economy.

## 19. Что считать текущей игрой

Текущая игра — это вертикальный мобильный прототип с двумя реальными игровыми фазами:

1. Игрок собирает корабль из панелей и модулей в ангаре.
2. Игрок проверяет сборку в локальной survival-арене.

Ключевая реализованная петля:

```text
Ангар
↓
Сборка панелей
↓
Сборка модулей
↓
Расчет статов
↓
Тестовый бой
↓
Победа/поражение
↓
Награда scrap при победе
↓
Возврат к сборке
```

Самая сильная реализованная часть:

- визуальная и интерактивная связка "моя сборка -> мои статы -> мой корабль в бою".

Самая слабая часть текущего состояния:

- отсутствие production-экономики, миссий, серверного состояния и нескольких ожидаемых ассетов.

## 20. Рекомендуемый следующий технический шаг

Перед расширением геймплея стоит сначала стабилизировать текущий прототип:

1. Восстановить или пересоздать `panel-states-atlas.png`.
2. Восстановить или удалить/заменить импорт `vfx-catalog-atlas.json`.
3. Запустить `npm run typecheck`.
4. Проверить `/`, `/hangar`, `/battle`, `/ui-kit` в браузере.
5. После этого выбирать следующий слой:
   - миссии/контракты;
   - кабины;
   - инвентарь и стоимость деталей;
   - shield/energy/heat в бою;
   - модульные повреждения.

## 21. Проверенные файлы

Код:

- `package.json`;
- `next.config.ts`;
- `tsconfig.json`;
- `app/layout.tsx`;
- `app/page.tsx`;
- `app/hangar/page.tsx`;
- `app/battle/page.tsx`;
- `app/ui-kit/page.tsx`;
- `app/globals.css`;
- `components/home/HomeSceneCanvas.tsx`;
- `components/battle/BattleCanvas.tsx`;
- `game/types.ts`;
- `game/data/frames.ts`;
- `game/data/panels.ts`;
- `game/data/modules.ts`;
- `game/data/defaultBuild.ts`;
- `game/ship/build.ts`;
- `game/ship/stats.ts`;
- `game/store/shipStore.ts`;
- `game/assets/moduleSprites.ts`;
- `game/assets/generatedAssetCatalog.ts`.

Ассеты и скрипты:

- `scripts/generate-module-state-atlases.mjs`;
- `scripts/generate-expanded-asset-catalog.mjs`;
- `scripts/normalize-ai-module-sheet.mjs`;
- `scripts/normalize-ai-explosion-frames.mjs`;
- `public/assets/generated/asset-catalog.json`;
- `public/assets/generated/module-catalog-states-atlas.json`;
- `public/assets/generated/frame-catalog-atlas.json`;
- `public/assets/generated/ai/ai-generated-assets.json`.

Проектные документы:

- `design-doc.md`;
- `design-doc2.md`;
- `freetoplay.md`;
- `battlepass.md`;
- `viral.md`.
